// Page d'options : hôte et jeton d'appareil dans chrome.storage.sync, test via POST /api/raccourci.
import { lireReglages, enregistrerReglages, normaliserHote, HOTE_PAR_DEFAUT } from './reglages.js';

const champHote = document.getElementById('hote');
const champJeton = document.getElementById('jeton');
const etat = document.getElementById('etat');
const resultat = document.getElementById('resultat');

const reglages = await lireReglages();
champHote.value = reglages.hote === HOTE_PAR_DEFAUT ? '' : reglages.hote;
champJeton.value = reglages.jeton;

// Un hôte autre que la production : on demande l'accès au site (facultatif, le serveur répond aussi en CORS).
async function demanderAcces(hote) {
  if (hote === HOTE_PAR_DEFAUT || !chrome.permissions?.request) return true;
  try { return await chrome.permissions.request({ origins: [`${hote}/*`] }); } catch { return false; }
}

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  resultat.textContent = '';
  try {
    const hote = normaliserHote(champHote.value);
    const accorde = await demanderAcces(hote);
    await enregistrerReglages({ hote, jeton: champJeton.value });
    etat.textContent = accorde ? 'Enregistré.' : 'Enregistré (accès au site refusé : l\'envoi passera par le CORS du serveur).';
  } catch (err) { etat.textContent = err.message; }
});

document.getElementById('afficher').addEventListener('click', (e) => {
  champJeton.type = champJeton.type === 'password' ? 'text' : 'password';
  e.target.textContent = champJeton.type === 'password' ? 'Afficher le jeton' : 'Masquer le jeton';
});

document.getElementById('tester').addEventListener('click', async () => {
  resultat.textContent = 'Test en cours…';
  try {
    const hote = normaliserHote(champHote.value);
    const jeton = champJeton.value.trim();
    if (!jeton) throw new Error("Collez d'abord un jeton d'appareil.");
    const r = await fetch(`${hote}/api/raccourci`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` }, body: JSON.stringify({ texte: 'Dis bonjour en trois mots' }) });
    const donnees = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Jeton refusé (401) : faux ou révoqué.');
    if (!r.ok) throw new Error(`Erreur ${r.status} : ${donnees.erreur || 'réponse inattendue'}`);
    resultat.textContent = `Réponse : ${donnees.texte || '(vide)'}`;
  } catch (err) { resultat.textContent = err.message; }
});
