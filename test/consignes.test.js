import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajouterConsigne, retirerConsigne, lireConsignes, remplacerConsignes, executerOutilConsignes } from '../server/consignes.js';
import { construirePromptSysteme } from '../server/prompt.js';

test('consignes : ajout, doublon, prompt, retrait, remplacement', async () => {
  await remplacerConsignes([]);
  await ajouterConsigne('Quand il parle de liste de courses, il s\'agit de Bring!');
  await executerOutilConsignes('retenir', { consigne: 'quand il parle de liste de courses, il s\'agit de bring!' });
  assert.equal((await lireConsignes()).length, 1, 'doublon ignoré');
  const prompt = construirePromptSysteme([], { consignes: await lireConsignes() });
  assert.match(prompt, /Consignes de l'utilisateur[\s\S]*Bring!/);
  await assert.rejects(() => retirerConsigne('zzz'), /Aucune/);
  assert.match(await executerOutilConsignes('oublier', { quoi: 'courses' }), /retirée/);
  assert.deepEqual(await lireConsignes(), []);
  const l = await remplacerConsignes(['A', '', 'B']);
  assert.deepEqual(l.map((c) => c.texte), ['A', 'B']);
});
