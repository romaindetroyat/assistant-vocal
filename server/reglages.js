// Réglages modifiables depuis l'application (stockés côté serveur).
import { lireValeur, ecrireValeur } from './store.js';

export const VOIX = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
export const CONCISIONS = { tres_court: 'Une phrase, dix à vingt mots. Jamais plus, sauf si on te demande explicitement des détails.', court: 'Une à deux phrases courtes. Pas de liste, pas de détails non demandés.', normal: 'Deux à quatre phrases, l\'essentiel seulement.' };
const DEFAUTS = { voix: 'marin', concision: 'court' };

export async function lireReglages() {
  const r = (await lireValeur('reglages')) || {};
  return { ...DEFAUTS, ...r };
}

export async function modifierReglages(modifs) {
  const actuels = await lireReglages();
  if (modifs.voix !== undefined) { if (!VOIX.includes(modifs.voix)) throw new Error(`Voix inconnue : ${modifs.voix}`); actuels.voix = modifs.voix; }
  if (modifs.concision !== undefined) { if (!CONCISIONS[modifs.concision]) throw new Error('Niveau de concision inconnu'); actuels.concision = modifs.concision; }
  await ecrireValeur('reglages', actuels);
  return actuels;
}

export function consigneConcision(concision) { return CONCISIONS[concision] || CONCISIONS.court; }
