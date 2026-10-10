import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genererBrief, briefDuMatin, lireDernierBrief, enregistrerBrief, executerOutilBrief, tronquer } from '../server/brief.js';
import { executerOutilLocal, outilsLocauxDisponibles, nomsOutilsLocaux } from '../server/tools.js';
import { ajouterTache } from '../server/taches.js';
import { ecrireValeur, lireValeur, sauverRappels } from '../server/store.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

// Client Anthropic simulé (même principe que chat.test.js) : rejoue des réponses, enregistre les requêtes.
function clientSimule(reponses) {
  const requetes = [];
  return {
    requetes,
    beta: { messages: { stream(params) {
      requetes.push(structuredClone(params));
      const reponse = reponses.shift();
      if (!reponse) throw new Error('API indisponible (simulation)');
      const evenements = [];
      for (const bloc of reponse.content) {
        evenements.push({ type: 'content_block_start', content_block: bloc });
        if (bloc.type === 'text') evenements.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: bloc.text } });
      }
      return { async *[Symbol.asyncIterator]() { for (const e of evenements) yield e; }, async finalMessage() { return reponse; } };
    } } },
  };
}
const BRIEF = "Samedi dix octobre deux mille vingt-six. Vous avez deux rendez-vous : le point TakeOff à dix heures et le dentiste à quinze heures. Une tâche en retard : ranger le garage. Aucun e-mail important non lu.";
const reponsesBrief = () => [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'tache_lister', input: { filtre: 'aujourdhui', projet: '' } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: BRIEF }] },
];
const dixHeuresParis = new Date('2026-10-10T08:00:00Z'); // 10 h CEST
const cookie = `assistant_session=${creerJeton()}`;

test('genererBrief : tour éphémère, consigne avec agenda, effort voix, outils utilisés', async () => {
  const client = clientSimule(reponsesBrief());
  const serveurs = [{ name: 'agenda-hub', url: 'https://x.invalid/agenda', description: 'Agenda unifié', authorization_token: 'jeton-agenda' }];
  const { texte, outils } = await genererBrief({ client, serveurs });
  assert.equal(texte, BRIEF);
  assert.deepEqual(outils, ['tache_lister']);
  const req = client.requetes[0];
  assert.deepEqual(req.output_config, { effort: 'low' });
  const consigne = req.messages.at(-1);
  assert.equal(consigne.role, 'system');
  assert.match(consigne.content, /agenda-hub/);
  assert.match(consigne.content, /tache_lister/);
  assert.match(consigne.content, /quatre à huit phrases/);
  assert.ok(!consigne.content.includes('jeton-agenda'));
  assert.ok(!req.tools.some((t) => t.name === 'brief_du_jour'), "le brief ne s'appelle pas lui-même");
  assert.ok(client.requetes[1].messages.some((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'), "résultat de l'outil renvoyé à Claude");
});

test('briefDuMatin : un seul push par jour, pas avant 8 h, brief enregistré', async () => {
  process.env.VAPID_PUBLIC_KEY = 'pub-test'; process.env.VAPID_PRIVATE_KEY = 'priv-test';
  await ecrireValeur('brief-du-matin', {}); await ecrireValeur('dernier-brief', null);
  const envois = []; const envoyer = async (n) => { envois.push(n); return 1; };

  assert.equal(await briefDuMatin({ client: clientSimule(reponsesBrief()), maintenant: new Date('2026-10-10T03:00:00Z'), envoyer }), false, 'avant 8 h : rien');
  assert.equal(await briefDuMatin({ client: clientSimule(reponsesBrief()), maintenant: dixHeuresParis, envoyer }), true);
  assert.equal(await briefDuMatin({ client: clientSimule(reponsesBrief()), maintenant: new Date('2026-10-10T15:00:00Z'), envoyer }), false, 'déjà envoyé aujourd\'hui');
  assert.equal(envois.length, 1, 'un seul push');
  assert.equal(envois[0].titre, 'Votre journée');
  assert.equal(envois[0].url, '/app');
  assert.ok(envois[0].corps.length <= 200);
  assert.ok(BRIEF.startsWith(envois[0].corps.slice(0, 150)));
  const dernier = await lireDernierBrief();
  assert.equal(dernier.texte, BRIEF);
  assert.equal(dernier.jour, '2026-10-10');
  assert.deepEqual(await lireValeur('brief-du-matin'), { jour: '2026-10-10' });
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
});

test('briefDuMatin : repli sur le résumé des tâches si Claude échoue', async () => {
  process.env.VAPID_PUBLIC_KEY = 'pub-test'; process.env.VAPID_PRIVATE_KEY = 'priv-test';
  await ecrireValeur('brief-du-matin', {}); await ecrireValeur('dernier-brief', null); await ecrireValeur('taches', []); await sauverRappels([]);
  await ajouterTache({ titre: 'Ranger le garage', echeance: '2020-01-01' });
  const envois = []; const envoyer = async (n) => { envois.push(n); return 1; };
  assert.equal(await briefDuMatin({ client: clientSimule([]), maintenant: dixHeuresParis, envoyer }), true);
  assert.equal(envois.length, 1);
  assert.match(envois[0].titre, /1 tâche\(s\) aujourd'hui, 1 en retard/);
  assert.equal(envois[0].corps, 'Ranger le garage');
  assert.equal(await lireDernierBrief(), null, 'pas de faux brief enregistré');
  assert.equal(await briefDuMatin({ client: clientSimule(reponsesBrief()), maintenant: dixHeuresParis, envoyer }), false, 'pas de second push après le repli');
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
});

test('outil brief_du_jour : brief du jour, sinon invitation à le composer ; non strict', async () => {
  await ecrireValeur('dernier-brief', { jour: '2000-01-01', texte: 'Vieux brief', genereLe: '2000-01-01T08:00:00Z' });
  assert.match(await executerOutilBrief(), /Pas encore de brief généré aujourd'hui/);
  await enregistrerBrief(BRIEF);
  assert.equal(await executerOutilLocal('brief_du_jour', {}), BRIEF);
  assert.ok(nomsOutilsLocaux.has('brief_du_jour'));
  const outil = (await outilsLocauxDisponibles()).find((t) => t.name === 'brief_du_jour');
  assert.ok(outil && !outil.strict);
  assert.equal(tronquer('a'.repeat(300)).length, 200);
});

test('routes /api/brief : génération à la demande puis lecture', async () => {
  await ecrireValeur('dernier-brief', null);
  const app = creerApplication({ client: clientSimule(reponsesBrief()), serveurs: [] });
  let r = await app.request('/api/brief', { headers: { cookie } });
  assert.equal((await r.json()).texte, null);
  r = await app.request('/api/brief', { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).texte, BRIEF);
  r = await app.request('/api/brief', { headers: { cookie } });
  assert.equal((await r.json()).texte, BRIEF);
  r = await app.request('/api/brief', { method: 'POST' });
  assert.equal(r.status, 401, 'session obligatoire');
  const appEnPanne = creerApplication({ client: clientSimule([]), serveurs: [] });
  r = await appEnPanne.request('/api/brief', { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 500);
});
