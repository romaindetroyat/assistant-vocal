import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajouterDocument, lireDocument, listerDocuments, modifierDocument, supprimerDocument, lireFichier, expirations, executerOutilDocuments, validerFiche } from '../server/documents.js';
import { lireBlob } from '../server/blobs.js';
import { lireUsage } from '../server/usage.js';
import { traiterPartage } from '../server/partage.js';
import { outilsLocauxDisponibles, nomsOutilsLocaux } from '../server/tools.js';
import { construirePromptSysteme } from '../server/prompt.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode('PERMIS-B-123456789')]);
function clientFiche(fiche, requetes = []) {
  return { beta: { messages: { async create(params) {
    requetes.push(params);
    return { stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 200 }, content: [{ type: 'text', text: typeof fiche === 'string' ? fiche : `\`\`\`json\n${JSON.stringify(fiche)}\n\`\`\`` }] };
  } } } };
}
const FICHE_PERMIS = { titre: 'Permis de conduire de Romain', type: 'identite', espace: 'perso', personne: 'Romain de Troyat', organisme: 'Préfecture du Var', dateDocument: '2015-03-02', dateExpiration: '2030-03-02', champs: [{ nom: 'Numéro de permis', valeur: '123456789', sensible: true }, { nom: 'Catégories', valeur: 'B', sensible: false }], resume: 'Permis B.', motsCles: ['permis', 'conduire'] };

test('coffre : ajout chiffré, fiche extraite, champs sensibles masqués puis révélés, recherche, outils', async () => {
  const requetes = [];
  const doc = await ajouterDocument({ client: clientFiche(FICHE_PERMIS, requetes), octets: PNG, type: 'image/png', nom: 'permis.png' });
  // Requête d'extraction : image en base64, effort low, pas d'outils
  const r = requetes[0];
  assert.equal(r.output_config.effort, 'low'); assert.equal(r.tools, undefined);
  assert.equal(r.messages[0].content[0].type, 'image'); assert.equal(r.messages[0].content[0].source.media_type, 'image/png');
  // Blob chiffré : les octets d'origine n'y figurent pas, et l'original est restitué
  const blob = await lireBlob(doc.id);
  assert.ok(!Buffer.from(blob.bytes).includes(Buffer.from('123456789')));
  assert.deepEqual((await lireFichier(doc.id)).octets, PNG);
  // Fiche : champ sensible masqué par défaut, révélé sur demande ; à valider
  assert.equal(doc.aValider, true);
  assert.match(doc.champs.find((c) => c.nom === 'Numéro de permis').valeur, /sensible/);
  assert.equal((await lireDocument(doc.id, { reveler: true })).champs.find((c) => c.nom === 'Numéro de permis').valeur, '123456789');
  // Recherche par mot-clé, personne, espace
  assert.equal((await listerDocuments({ q: 'permis' }))[0].id, doc.id);
  assert.equal((await listerDocuments({ q: 'troyat' }))[0].id, doc.id);
  assert.equal((await listerDocuments({ espace: 'pro' })).some((e) => e.id === doc.id), false);
  // Outils : lecture masquée sans confirmation, révélée avec
  assert.match(await executerOutilDocuments('document_chercher', { requete: 'permis' }), /Permis de conduire de Romain/);
  assert.match(await executerOutilDocuments('document_lire', { id: doc.id }), /Numéro de permis : \(sensible/);
  assert.match(await executerOutilDocuments('document_lire', { id: doc.id, confirme: true }), /Numéro de permis : 123456789/);
  assert.match(await executerOutilDocuments('document_lire', { id: doc.id }), /pas encore validée/);
  // Validation et correction : un champ sensible renvoyé masqué garde sa valeur
  const masque = (await lireDocument(doc.id)).champs;
  await modifierDocument(doc.id, { champs: [...masque, { nom: 'Points', valeur: '12', sensible: false }], valider: true });
  const valide = await lireDocument(doc.id, { reveler: true });
  assert.equal(valide.aValider, false);
  assert.equal(valide.champs.find((c) => c.nom === 'Numéro de permis').valeur, '123456789');
  assert.equal(valide.champs.find((c) => c.nom === 'Points').valeur, '12');
  // Usage enregistré
  assert.ok((await lireUsage(1)).jours[0].sources.documents >= 1);
  await supprimerDocument(doc.id);
  assert.equal(await lireBlob(doc.id), null);
  await assert.rejects(() => lireDocument(doc.id), /introuvable/);
});

test('coffre : expirations, JSON invalide → fiche minimale, types refusés, PDF en bloc document', async () => {
  const bientot = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const d1 = await ajouterDocument({ client: clientFiche({ ...FICHE_PERMIS, titre: 'Assurance auto', type: 'assurance', dateExpiration: bientot }), octets: PNG, type: 'image/png', nom: 'assu.png' });
  assert.ok((await expirations(60)).some((e) => e.id === d1.id));
  assert.match(await executerOutilDocuments('document_expirations', {}), /Assurance auto : expire le/);
  const d2 = await ajouterDocument({ client: clientFiche('pas du json'), octets: PNG, type: 'image/png', nom: 'scan.png' });
  assert.equal(d2.titre, 'scan.png'); assert.equal(d2.aValider, true); assert.equal(d2.extraite, false);
  await assert.rejects(() => ajouterDocument({ client: clientFiche(FICHE_PERMIS), octets: PNG, type: 'image/heic', nom: 'a.heic' }), (e) => e.status === 415);
  await assert.rejects(() => ajouterDocument({ client: clientFiche(FICHE_PERMIS), octets: new Uint8Array(21 * 1024 * 1024), type: 'image/png', nom: 'gros.png' }), (e) => e.status === 413);
  const requetes = [];
  const d3 = await ajouterDocument({ client: clientFiche({ ...FICHE_PERMIS, titre: 'Contrat Durand', espace: 'pro', type: 'client' }, requetes), octets: new TextEncoder().encode('%PDF-1.4 contrat'), type: 'application/pdf', nom: 'contrat.pdf' });
  assert.equal(requetes[0].messages[0].content[0].type, 'document');
  assert.equal(d3.espace, 'pro');
  assert.equal(validerFiche({ type: 'inexistant', espace: 'x', champs: [{ nom: '', valeur: 'v' }] }, { nom: 'n' }).type, 'autre');
  for (const d of [d1, d2, d3]) await supprimerDocument(d.id);
});

test('coffre : partage « range dans le coffre pro », routes (401, 415, fichier déchiffré), outils déclarés', async () => {
  const image = { media_type: 'image/png', data: Buffer.from(PNG).toString('base64') };
  const envois = [];
  const r = await traiterPartage({ client: clientFiche({ ...FICHE_PERMIS, titre: 'Facture client Martin', espace: 'perso' }), consigne: 'range ça dans le coffre pro', image, envoyer: async (n) => envois.push(n) });
  assert.match(r.texte, /Document ajouté au coffre pro : Facture client Martin/);
  assert.equal((await lireDocument(r.documentId)).espace, 'pro');
  await supprimerDocument(r.documentId);

  const app = creerApplication({ client: clientFiche(FICHE_PERMIS), serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  assert.equal((await app.request('/api/documents')).status, 401);
  const form = new FormData(); form.append('fichier', new File([PNG], 'permis.png', { type: 'image/png' }));
  const ajout = await app.request('/api/documents', { method: 'POST', headers: { cookie }, body: form });
  assert.equal(ajout.status, 201);
  const doc = await ajout.json();
  const fichier = await app.request(`/api/documents/${doc.id}/fichier`, { headers: { cookie } });
  assert.equal(fichier.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await fichier.arrayBuffer()), PNG);
  assert.equal((await app.request(`/api/documents/${doc.id}/fichier`)).status, 401);
  const heic = new FormData(); heic.append('fichier', new File([PNG], 'photo.heic', { type: 'image/heic' }));
  assert.equal((await app.request('/api/documents', { method: 'POST', headers: { cookie }, body: heic })).status, 415);
  assert.equal((await app.request(`/api/documents/${doc.id}`, { method: 'DELETE', headers: { cookie } })).status, 200);

  for (const n of ['document_chercher', 'document_lire', 'document_expirations']) assert.ok(nomsOutilsLocaux.has(n));
  assert.ok((await outilsLocauxDisponibles()).filter((t) => t.name.startsWith('document_')).every((t) => !t.strict));
  assert.match(construirePromptSysteme([], {}), /document_chercher/);
});
