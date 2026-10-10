// Réglages partagés (service worker, popup, options) : hôte de l'assistant et jeton d'appareil dans chrome.storage.sync.
export const HOTE_PAR_DEFAUT = 'https://assistant-vocal.romaindetroyat.workers.dev';

export function normaliserHote(valeur) {
  const brut = String(valeur || '').trim().replace(/\/+$/, '');
  if (!brut) return HOTE_PAR_DEFAUT;
  try { const u = new URL(brut); if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error(); return u.origin; }
  catch { throw new Error('Adresse invalide : attendu https://… (ou http://localhost)'); }
}

export async function lireReglages() {
  const { hote, jeton } = await chrome.storage.sync.get(['hote', 'jeton']);
  return { hote: hote || HOTE_PAR_DEFAUT, jeton: String(jeton || '').trim() };
}

export async function enregistrerReglages({ hote, jeton }) {
  await chrome.storage.sync.set({ hote: normaliserHote(hote), jeton: String(jeton || '').trim() });
}
