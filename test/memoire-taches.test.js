import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noter, oublier, chercher, lireMemoire, blocProfil, executerOutilMemoire, remplacerMemoire } from '../server/memoire.js';
import { ajouterTache, listerTaches, modifierTache, executerOutilTaches, resumeDuJour, lireTaches } from '../server/taches.js';
import { listerRappels, sauverRappels, ecrireValeur } from '../server/store.js';
import { construirePromptSysteme } from '../server/prompt.js';
import { briefDuMatin } from '../server/brief.js';

test('mémoire : notation, mise à jour par clé, recherche, prompt, oubli', async () => {
  await remplacerMemoire([]);
  await noter({ categorie: 'personne', cle: 'kevin', texte: 'Kevin est développeur chez TakeOff.' });
  await noter({ categorie: 'personne', cle: 'kevin', texte: 'Kevin est CTO de TakeOff.' });
  await executerOutilMemoire('memoire_noter', { categorie: 'preference', cle: 'cafe', texte: 'Il boit son café sans sucre.' });
  const l = await lireMemoire();
  assert.equal(l.length, 2, 'même clé → mise à jour');
  assert.match(l.find((m) => m.cle === 'kevin').texte, /CTO/);
  assert.match(await executerOutilMemoire('memoire_chercher', { recherche: 'kevin' }), /CTO/);
  const prompt = construirePromptSysteme([], { memoire: l });
  assert.match(prompt, /Ce que tu sais de l'utilisateur[\s\S]*Préférences : Il boit[\s\S]*Personnes : Kevin est CTO/);
  assert.equal(await oublier('cafe'), 1);
  assert.equal((await chercher('')).length, 1);
  assert.equal(blocProfil([]), '');
});

test('tâches : ajout avec déduction, tri, filtres, rappel lié, terminer, résumé du matin', async () => {
  await ecrireValeur('taches', []); await sauverRappels([]);
  const auj = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const demain = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));
  await ajouterTache({ titre: 'Relire la proposition Exail', echeance: auj, priorite: 'haute', projet: 'TakeOff' });
  const avecHeure = await ajouterTache({ titre: 'Appeler Jeanne', echeance: demain, heure: '17:45', priorite: 'normale' });
  await ajouterTache({ titre: 'Ranger le garage', echeance: '2020-01-01', priorite: 'basse', projet: 'maison' });
  await ajouterTache({ titre: 'Idée de newsletter' });
  assert.ok(avecHeure.rappelId, 'tâche datée avec heure → rappel');
  assert.equal((await listerRappels()).length, 1);
  const auj2 = await listerTaches({ filtre: 'aujourdhui' });
  assert.deepEqual(auj2.map((t) => t.titre), ['Ranger le garage', 'Relire la proposition Exail'], 'retard d\'abord, puis aujourd\'hui');
  assert.deepEqual((await listerTaches({ filtre: 'retard' })).map((t) => t.titre), ['Ranger le garage']);
  assert.equal((await listerTaches({ projet: 'take' })).length, 1);
  assert.match(await executerOutilTaches('tache_lister', { filtre: 'a_faire', projet: '' }), /⚠ Ranger le garage/);
  const r = await resumeDuJour();
  assert.match(r.titre, /2 tâche\(s\) aujourd'hui, 1 en retard/);
  await executerOutilTaches('tache_terminer', { tache: 'jeanne' });
  assert.equal((await listerRappels()).length, 0, 'rappel supprimé quand la tâche est faite');
  assert.equal((await listerTaches({ filtre: 'faites' })).length, 1);
  await modifierTache('garage', { echeance: demain, priorite: 'haute' });
  assert.equal((await listerTaches({ filtre: 'retard' })).length, 0);
  await assert.rejects(() => executerOutilTaches('tache_terminer', { tache: 'inexistante' }), /introuvable/);
  // Brief du matin : seulement avec le push configuré (absent ici → false)
  assert.equal(await briefDuMatin({ maintenant: new Date() }), false);
  assert.equal((await lireTaches()).length, 4);
});

test("jamais plus de 20 outils stricts, même avec tout de connecté", async () => {
  const { limiterStricts, LIMITE_STRICTS } = await import('../server/tools.js');
  const { definitionsOutilsLocaux } = await import('../server/tools.js');
  const { definitionsOutilsGmail } = await import('../server/gmail.js');
  const { definitionsOutilsBring } = await import('../server/bring.js');
  const { definitionsOutilsConsignes } = await import('../server/consignes.js');
  const { definitionsOutilsMemoire } = await import('../server/memoire.js');
  const { definitionsOutilsTaches } = await import('../server/taches.js');
  const { definitionOutilDev } = await import('../server/dev.js');
  const tous = limiterStricts([...definitionsOutilsLocaux, ...definitionsOutilsConsignes, ...definitionsOutilsMemoire, ...definitionsOutilsTaches, ...definitionsOutilsGmail, ...definitionsOutilsBring, definitionOutilDev]);
  assert.ok(tous.length > 20);
  assert.ok(tous.filter((t) => t.strict).length <= LIMITE_STRICTS);
  assert.equal(tous.find((t) => t.name === 'gmail_envoyer').strict, false, 'mode strict désactivé (latence de compilation de grammaire)');
  assert.equal(tous.find((t) => t.name === 'list_reminders').strict, false);
});
