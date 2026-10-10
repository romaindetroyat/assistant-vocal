// Réglages modifiables depuis l'application (stockés côté serveur).
import { lireValeur, ecrireValeur } from './store.js';

export const VOIX = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
export const CONCISIONS = { tres_court: 'Une phrase, dix à vingt mots. Jamais plus, sauf si on te demande explicitement des détails.', court: 'Une à deux phrases courtes. Pas de liste, pas de détails non demandés.', normal: 'Deux à quatre phrases, l\'essentiel seulement.' };
// mainsLibres : après un appel, l'application reste en veille et relance la conversation sur le mot d'activation.
// voitureAutoAppel : en mode voiture, le premier tap sur l'écran lance la conversation (sinon seul le bouton « Parler »).
const DEFAUTS = { voix: 'marin', concision: 'court', mainsLibres: false, motActivation: 'assistant', voitureAutoAppel: true };
const MOT_ACTIVATION_MAX = 40;

export async function lireReglages() {
  const r = (await lireValeur('reglages')) || {};
  return { ...DEFAUTS, ...r };
}

export async function modifierReglages(modifs) {
  const actuels = await lireReglages();
  if (modifs.voix !== undefined) { if (!VOIX.includes(modifs.voix)) throw new Error(`Voix inconnue : ${modifs.voix}`); actuels.voix = modifs.voix; }
  if (modifs.concision !== undefined) { if (!CONCISIONS[modifs.concision]) throw new Error('Niveau de concision inconnu'); actuels.concision = modifs.concision; }
  if (modifs.mainsLibres !== undefined) { if (typeof modifs.mainsLibres !== 'boolean') throw new Error('mainsLibres doit être un booléen'); actuels.mainsLibres = modifs.mainsLibres; }
  if (modifs.voitureAutoAppel !== undefined) { if (typeof modifs.voitureAutoAppel !== 'boolean') throw new Error('voitureAutoAppel doit être un booléen'); actuels.voitureAutoAppel = modifs.voitureAutoAppel; }
  if (modifs.motActivation !== undefined) {
    const mot = String(modifs.motActivation).trim().replace(/\s+/g, ' ').toLowerCase();
    if (mot.length < 2 || mot.length > MOT_ACTIVATION_MAX) throw new Error(`Le mot d'activation doit faire entre 2 et ${MOT_ACTIVATION_MAX} caractères`);
    actuels.motActivation = mot;
  }
  await ecrireValeur('reglages', actuels);
  return actuels;
}

export function consigneConcision(concision) { return CONCISIONS[concision] || CONCISIONS.court; }

// Contexte d'usage transmis par le front (`contexte: 'voiture'`, phase 19) : seule la valeur « voiture » est reconnue.
export const CONTEXTE_VOITURE = 'voiture';
export function contexteValide(valeur) { return valeur === CONTEXTE_VOITURE ? CONTEXTE_VOITURE : null; }
// Consigne ajoutée à Claude quand l'utilisateur conduit : brièveté maximale, aucun lien.
export const CONSIGNE_VOITURE_CLAUDE = "L'utilisateur conduit : ne donne jamais de lien, annonce seulement les durées.";
