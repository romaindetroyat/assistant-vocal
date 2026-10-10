import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connecterBring, etatBring, listerListes, lireListe, executerOutilBring, deconnecterBring } from '../server/bring.js';
import { outilsLocauxDisponibles, executerOutilLocal } from '../server/tools.js';

function bringSimule(journal, { expiresIn = 3600 } = {}) {
  const liste = { purchase: [{ itemId: 'Lait', specification: '2 L' }, { itemId: 'Œufs', specification: '' }], recently: [{ itemId: 'Pain', specification: '' }] };
  return async (url, init = {}) => {
    const u = String(url); journal.push({ u, init });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    assert.equal(init.headers['X-BRING-API-KEY'], 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp');
    if (u.endsWith('v2/bringauth')) { const p = new URLSearchParams(init.body); if (p.get('password') !== 'bon') return json({ message: 'Invalid' }, 401); return json({ uuid: 'U1', publicUuid: 'P1', access_token: 'AT1', refresh_token: 'RT1', expires_in: expiresIn, bringListUUID: 'L1', name: 'Romain' }); }
    if (u.endsWith('v2/bringauth/token')) return json({ access_token: 'AT2', expires_in: 3600 });
    if (u.endsWith('bringusers/U1/lists')) { assert.equal(init.headers['X-BRING-USER-UUID'], 'U1'); return json({ lists: [{ listUuid: 'L1', name: 'Maison' }, { listUuid: 'L2', name: 'Bateau' }] }); }
    if (u.endsWith('v2/bringlists/L1')) return json({ uuid: 'L1', status: 'REGISTERED', items: liste });
    if (u.endsWith('v2/bringlists/L2/items') || u.endsWith('v2/bringlists/L1/items')) return new Response(null, { status: 204 });
    return json({ message: `inattendu ${u}` }, 500);
  };
}

test('Bring! : connexion, listes, lecture, ajout/cocher/retirer, rafraîchissement, déconnexion', async () => {
  const journal = []; const f = bringSimule(journal, { expiresIn: 30 });
  await assert.rejects(() => connecterBring({ email: 'r@x.fr', password: 'faux' }, f), /Invalid/);
  const r = await connecterBring({ email: 'R@x.fr', password: 'bon' }, f);
  assert.deepEqual(r, { email: 'r@x.fr', name: 'Romain' });
  assert.equal((await etatBring()).connecte, true);
  assert.ok((await outilsLocauxDisponibles()).some((t) => t.name === 'courses_ajouter'));
  assert.deepEqual((await listerListes(f)).map((l) => l.nom), ['Maison', 'Bateau']);
  assert.ok(journal.some((j) => j.u.endsWith('v2/bringauth/token')), 'jeton presque expiré → rafraîchi');
  const lecture = await lireListe('', f);
  assert.equal(lecture.liste.nom, 'Maison'); assert.equal(lecture.aAcheter[0].precision, '2 L');
  assert.match(await executerOutilBring('courses_lire', { liste: 'mais' }, f), /Lait \(2 L\), Œufs/);
  assert.match(await executerOutilBring('courses_ajouter', { liste: 'bateau', articles: [{ nom: 'Glaçons', precision: '2 sacs' }, { nom: '', precision: '' }] }, f), /1 article\(s\) ajouté\(s\) à « Bateau »/);
  const envoi = JSON.parse(journal.findLast((j) => j.u.endsWith('L2/items')).init.body);
  assert.deepEqual(envoi.changes.map((c) => [c.itemId, c.spec, c.operation]), [['Glaçons', '2 sacs', 'TO_PURCHASE']]);
  await executerOutilBring('courses_cocher', { liste: '', articles: [{ nom: 'Lait', precision: '' }] }, f);
  assert.equal(JSON.parse(journal.findLast((j) => j.u.endsWith('L1/items')).init.body).changes[0].operation, 'TO_RECENTLY');
  await executerOutilBring('courses_retirer', { liste: '', articles: [{ nom: 'Œufs', precision: '' }] }, f);
  assert.equal(JSON.parse(journal.findLast((j) => j.u.endsWith('L1/items')).init.body).changes[0].operation, 'REMOVE');
  await assert.rejects(() => executerOutilBring('courses_lire', { liste: 'voiture' }, f), /introuvable/);
  assert.doesNotMatch(await executerOutilLocal('courses_listes', {}).catch((e) => e.message), /inconnu/, 'le routage vers les outils Bring! est en place');
  await deconnecterBring();
  assert.equal((await etatBring()).connecte, false);
  assert.ok(!(await outilsLocauxDisponibles()).some((t) => t.name.startsWith('courses_')));
});
