// Popup de l'icône : trois actions déléguées au service worker, puis fermeture.
import { lireReglages } from './reglages.js';

const etat = document.getElementById('etat');
async function agir(type) {
  etat.textContent = type === 'envoyer-page' ? 'Envoi…' : '';
  const r = await chrome.runtime.sendMessage({ type }).catch((e) => ({ ok: false, erreur: e.message }));
  if (r?.ok) window.close(); else etat.textContent = r?.erreur || 'Erreur';
}
for (const id of ['parler', 'ouvrir', 'envoyer-page']) document.getElementById(id).addEventListener('click', () => agir(id));
document.getElementById('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

const { jeton } = await lireReglages();
if (!jeton) etat.textContent = "Jeton absent : l'envoi de pages ne fonctionnera pas. Ouvrez les options.";
