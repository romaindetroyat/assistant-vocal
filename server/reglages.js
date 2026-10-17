// Réglages modifiables depuis l'application (stockés côté serveur).
import { lireValeur, ecrireValeur } from './store.js';

export const VOIX = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
// Longueur des réponses, en cinq crans (du plus court au plus développé).
export const CONCISIONS = {
  tres_court: 'Une phrase, dix à vingt mots. Jamais plus, sauf si on te demande explicitement des détails.',
  court: 'Une à deux phrases courtes. Pas de liste, pas de détails non demandés.',
  normal: 'Deux à quatre phrases, l\'essentiel seulement.',
  developpe: 'Une réponse développée : un ou deux paragraphes, avec les détails utiles et le contexte.',
  tres_developpe: 'Une réponse complète et approfondie : plusieurs paragraphes, exemples, nuances et étapes si utile ; une liste courte est permise à l\'écrit.',
};
// Modèle de réflexion (Claude) choisi dans l'application : délai et coût par question indicatifs, cache compris.
export const MODELES = {
  auto: { id: null, nom: 'Automatique', role: 'Haiku pour les questions simples, Sonnet pour chercher une information, Opus pour les vraies tâches', delai: '≈ 2 à 7 s', cout: '≈ 0,05 à 1 ct' },
  haiku: { id: 'claude-haiku-5-5', nom: 'Haiku 5.5', role: 'Instantané, pour les questions simples', delai: '≈ 2 s', cout: '≈ 0,05 ct' },
  sonnet: { id: 'claude-sonnet-5-5', nom: 'Sonnet 5.5', role: 'Rapide et précis au quotidien', delai: '≈ 4 s', cout: '≈ 0,5 ct' },
  opus: { id: 'claude-opus-5-5', nom: 'Opus 5.5', role: 'Le plus fin, pour les vraies tâches', delai: '≈ 7 s', cout: '≈ 1 ct' },
};
// Identifiant de modèle à utiliser : le choix de l'application, sinon la variable CLAUDE_MODEL (« auto » : voir routage.js).
export function modeleClaude(reglages, defaut) { return MODELES[reglages?.modele]?.id || defaut; }
// mainsLibres : après un appel, l'application reste en veille et relance la conversation sur le mot d'activation.
// domicile / bureau : adresses pour les trajets ; partagerPosition : le front joint la position GPS à chaque message.
// iphoneVoiture : sur iPhone, l'application s'ouvre directement en mode voiture.
// voitureAutoAppel : en mode voiture, le premier tap sur l'écran lance la conversation (sinon seul le bouton « Parler »).
// parole : « maintenir » (appui maintenu pour parler, micro ouvert seulement pendant l'appui) ou « mains_libres »
// (détection automatique de la fin de phrase).
export const MODES_PAROLE = ['maintenir', 'mains_libres'];
const DEFAUTS = { parole: 'maintenir', voix: 'marin', concision: 'court', modele: 'auto', mainsLibres: false, motActivation: 'assistant', domicile: '', bureau: '', partagerPosition: false, voitureAutoAppel: true, iphoneVoiture: true };
const MOT_ACTIVATION_MAX = 40;
const ADRESSE_MAX = 200;

export async function lireReglages() {
  const r = (await lireValeur('reglages')) || {};
  return { ...DEFAUTS, ...r };
}

export async function modifierReglages(modifs) {
  const actuels = await lireReglages();
  if (modifs.voix !== undefined) { if (!VOIX.includes(modifs.voix)) throw new Error(`Voix inconnue : ${modifs.voix}`); actuels.voix = modifs.voix; }
  if (modifs.parole !== undefined) { if (!MODES_PAROLE.includes(modifs.parole)) throw new Error(`Mode de parole inconnu : ${modifs.parole}`); actuels.parole = modifs.parole; }
  if (modifs.modele !== undefined) { if (!MODELES[modifs.modele]) throw new Error(`Modèle inconnu : ${modifs.modele}`); actuels.modele = modifs.modele; }
  if (modifs.concision !== undefined) { if (!CONCISIONS[modifs.concision]) throw new Error('Niveau de concision inconnu'); actuels.concision = modifs.concision; }
  if (modifs.mainsLibres !== undefined) { if (typeof modifs.mainsLibres !== 'boolean') throw new Error('mainsLibres doit être un booléen'); actuels.mainsLibres = modifs.mainsLibres; }
  if (modifs.iphoneVoiture !== undefined) { if (typeof modifs.iphoneVoiture !== 'boolean') throw new Error('iphoneVoiture doit être un booléen'); actuels.iphoneVoiture = modifs.iphoneVoiture; }
  if (modifs.voitureAutoAppel !== undefined) { if (typeof modifs.voitureAutoAppel !== 'boolean') throw new Error('voitureAutoAppel doit être un booléen'); actuels.voitureAutoAppel = modifs.voitureAutoAppel; }
  if (modifs.motActivation !== undefined) {
    const mot = String(modifs.motActivation).trim().replace(/\s+/g, ' ').toLowerCase();
    if (mot.length < 2 || mot.length > MOT_ACTIVATION_MAX) throw new Error(`Le mot d'activation doit faire entre 2 et ${MOT_ACTIVATION_MAX} caractères`);
    actuels.motActivation = mot;
  }
  for (const lieu of ['domicile', 'bureau']) {
    if (modifs[lieu] === undefined) continue;
    const adresse = String(modifs[lieu]).trim().replace(/\s+/g, ' ');
    if (adresse.length > ADRESSE_MAX) throw new Error(`L'adresse du ${lieu} dépasse ${ADRESSE_MAX} caractères`);
    actuels[lieu] = adresse;
  }
  if (modifs.proactif !== undefined) actuels.proactif = validerProactif(modifs.proactif, actuels.proactif);
  if (modifs.partagerPosition !== undefined) { if (typeof modifs.partagerPosition !== 'boolean') throw new Error('partagerPosition doit être un booléen'); actuels.partagerPosition = modifs.partagerPosition; }
  await ecrireValeur('reglages', actuels);
  return actuels;
}

// Assistant proactif (phase 25) : interrupteurs et heures (HH:MM) ; fusion partielle avec les valeurs actuelles.
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
function validerProactif(m, actuel = {}) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('proactif doit être un objet');
  const res = { ...actuel };
  for (const k of ['mailsUrgents', 'rappelsRdv', 'resumeSoir']) if (m[k] !== undefined) { if (typeof m[k] !== 'boolean') throw new Error(`proactif.${k} doit être un booléen`); res[k] = m[k]; }
  for (const k of ['heureSoir', 'silenceDebut', 'silenceFin']) if (m[k] !== undefined) { if (!HEURE.test(String(m[k]))) throw new Error(`proactif.${k} : heure attendue au format HH:MM`); res[k] = String(m[k]); }
  return res;
}

export function consigneConcision(concision) { return CONCISIONS[concision] || CONCISIONS.court; }

// Contexte d'usage transmis par le front (`contexte: 'voiture'`, phase 19) : seule la valeur « voiture » est reconnue.
export const CONTEXTE_VOITURE = 'voiture';
export function contexteValide(valeur) { return valeur === CONTEXTE_VOITURE ? CONTEXTE_VOITURE : null; }
// Consigne ajoutée à Claude quand l'utilisateur conduit : brièveté maximale, aucun lien.
export const CONSIGNE_VOITURE_CLAUDE = "L'utilisateur conduit : ne donne jamais de lien, annonce seulement les durées.";
