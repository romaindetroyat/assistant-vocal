// Modèle automatique (phase 24) : choix instantané du modèle Claude pour une demande, par règles (pas d'appel au modèle).
// Haiku pour les questions simples du quotidien, Sonnet pour les informations à chercher, Opus pour les vraies tâches ;
// Haiku peut escalader s'il se trompe.

// Sources concernées : demandes de l'utilisateur. Le brief, les documents, la consolidation gardent le modèle par défaut.
export const SOURCES_AUTO = new Set(['chat', 'voix', 'siri', 'partage']);

// Mots qui signalent une vraie tâche : rédaction, analyse, conseil, décision, envoi.
const COMPLEXE = /\b(r[ée]dige|r[ée]diger|[ée]cris|[ée]crire|brouillon|r[ée]ponds|r[ée]pondre|envoie|envoyer|transf[eè]re|analyse|analyser|compare|comparer|r[ée]sume|r[ée]sumer|synth[eè]se|explique|expliquer|pourquoi|strat[ée]gie|plan d|propose|proposer|conseil|conseille|avis|recommande|pr[ée]pare|pr[ée]parer|organise|organiser|corrige|corriger|traduis|traduire|reformule|code|programme|calcule|calculer|n[ée]gocie|argumente|d[ée]taille|approfondi|id[ée]es?|lettre|courrier|contrat|devis|facture|document|coffre)\b/i;

// Mots qui demandent de chercher une information à l'extérieur (actualité, sport, prix, horaires…) : Sonnet, dont la
// recherche web filtre les résultats (Haiku n'a que la recherche de base et trouve mal les scores ou l'actualité).
const SAVOIR = /\b(r[ée]sultats?|scores?|match|matchs|classement|rugby|foot(ball)?|tennis|cyclisme|formule 1|f1|sport|top 14|champions cup|challenge cup|ligue|coupe|actualit[ée]s?|actus?|news|nouvelles|infos?|derni[eè]res? nouvelles|qui est|c'est qui|qui a gagn[ée]|combien co[uû]te|prix|tarif|cours|bourse|horaires?|programme t[ée]l[ée]|film|s[ée]rie|livre|recherche|cherche sur (internet|le web)|wikip[ée]dia|d[ée]finition|histoire de)\b/i;

function texteDe(contenu) {
  if (typeof contenu === 'string') return contenu;
  return (Array.isArray(contenu) ? contenu : []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n');
}

/**
 * Renvoie { cle: 'haiku' | 'sonnet' | 'opus', raison } pour un contenu utilisateur (chaîne ou blocs de l'API).
 * Règles : image ou document joint, message long (> 280 caractères) ou mot de tâche → Opus ; information à chercher
 * (actualité, sport, prix, horaires…) → Sonnet ; sinon Haiku (outils personnels : agenda, météo, rappels, courses…).
 */
export function choisirModeleAuto(contenu) {
  const blocs = Array.isArray(contenu) ? contenu : [];
  if (blocs.some((b) => b?.type === 'image' || b?.type === 'document')) return { cle: 'opus', raison: 'pièce jointe' };
  const texte = texteDe(contenu).trim();
  if (texte.length > 280) return { cle: 'opus', raison: 'demande longue' };
  if (COMPLEXE.test(texte)) return { cle: 'opus', raison: 'tâche' };
  if (SAVOIR.test(texte)) return { cle: 'sonnet', raison: 'information à chercher' };
  return { cle: 'haiku', raison: 'question simple' };
}

export const OUTIL_ESCALADER = {
  name: 'escalader',
  description: "Passe la demande à un modèle plus puissant. Appelle-le immédiatement, sans rien écrire avant, si la demande dépasse une question simple : rédaction ou envoi d'un message, analyse, comparaison, conseil, décision délicate, plusieurs étapes, ou si tu n'es pas sûr de bien faire. Ne l'appelle pas pour l'heure, la météo, l'agenda, les rappels, les courses, les tâches, un trajet ou une adresse.",
  input_schema: { type: 'object', properties: { raison: { type: 'string', description: 'Raison en quelques mots' } }, required: [] },
};
