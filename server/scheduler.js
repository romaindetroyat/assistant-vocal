// Livraison des rappels programmés, brief du matin, rappels de départ et consolidation hebdomadaire de la mémoire (vérification périodique).
import { listerRappels, sauverRappels, ajouterRappel, lireValeur, ecrireValeur } from './store.js';
import { envoyerNotification, pushDisponible } from './push.js';
import { briefDuMatin, resoudreContexteBrief, tourEphemere, dateHeureParis, tronquer } from './brief.js';
import { consolidationHebdo } from './memoire-consolidation.js';
import { configTrajets, calculerTrajet, formaterDuree, heureParis } from './trajets.js';

const CLE_DEPARTS = 'departs-du-jour';
const HEURE_DEPARTS = 7; // heure de Paris à partir de laquelle les départs du jour sont programmés
const CONSIGNE_DEPARTS = (agenda) => `Tâche technique, pas de réponse à l'utilisateur. Lis l'agenda d'aujourd'hui avec les outils du serveur « ${agenda} » et réponds UNIQUEMENT par un tableau JSON des rendez-vous du jour qui ont une adresse ou un lieu précis, au format [{"id": "identifiant de l'événement", "titre": "…", "debut": "date-heure ISO 8601 avec fuseau", "adresse": "adresse postale ou nom du lieu"}]. Ignore les événements sans lieu, en visio, sur toute la journée ou déjà terminés. S'il n'y en a aucun, réponds [].`;

// Extrait le tableau JSON de la réponse de Claude ; tolère du texte autour.
export function extraireRendezVous(texte) {
  const m = /\[[\s\S]*\]/.exec(String(texte || ''));
  if (!m) return [];
  let liste; try { liste = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(liste)) return [];
  return liste.filter((e) => e && typeof e === 'object' && e.adresse && e.debut && !Number.isNaN(new Date(e.debut).getTime()))
    .map((e) => ({ id: String(e.id || `${e.debut}-${e.titre || ''}`).slice(0, 120), titre: String(e.titre || 'rendez-vous').trim().slice(0, 80), debut: new Date(e.debut).toISOString(), adresse: String(e.adresse).trim().slice(0, 200) }));
}

/**
 * Rappels « Partez pour … » : une fois par jour (clé departs-du-jour), à partir de 7 h (Paris), si une clé Google Routes est
 * configurée et qu'un serveur d'agenda est connecté. Demande à Claude la liste JSON des rendez-vous du jour avec adresse,
 * calcule l'heure de départ depuis le domicile (voiture, trafic prévu, marge 5 min) et programme un rappel push par événement
 * (pas de doublon : les identifiants programmés sont mémorisés dans la même valeur KV). Retourne le nombre de rappels créés.
 */
export async function programmerDeparts({ client = null, serveurs = [], nonConnectes = [], maintenant = new Date(), fetchImpl = fetch } = {}) {
  if (!client || !pushDisponible()) return 0;
  if (!(await configTrajets()).cle) return 0;
  const agenda = serveurs.find((s) => /agenda|calendar|calendrier/i.test(`${s.name} ${s.description || ''}`));
  if (!agenda) return 0;
  const { jour, heure } = dateHeureParis(maintenant);
  if (heure < HEURE_DEPARTS) return 0;
  const etat = (await lireValeur(CLE_DEPARTS)) || {};
  if (etat.jour === jour && etat.fait) return 0;
  const programmes = etat.jour === jour && etat.programmes ? etat.programmes : {};
  await ecrireValeur(CLE_DEPARTS, { jour, fait: true, programmes });

  const { texte } = await tourEphemere({ client, serveurs, nonConnectes, id: 'departs', titre: 'Départs du jour', message: "Liste les rendez-vous du jour avec adresse.", consigne: CONSIGNE_DEPARTS(agenda.name) });
  let crees = 0;
  for (const rdv of extraireRendezVous(texte)) {
    if (programmes[rdv.id]) continue;
    if (new Date(rdv.debut).getTime() <= maintenant.getTime()) continue;
    try {
      const t = await calculerTrajet({ origine: '', destination: rdv.adresse, mode: 'DRIVE', arriveeA: rdv.debut }, fetchImpl, maintenant);
      if (!t.heureDepart || new Date(t.heureDepart).getTime() <= maintenant.getTime()) continue;
      const rappel = await ajouterRappel({ quand: t.heureDepart, titre: tronquer(`Partez pour ${rdv.titre}`, 60), corps: `${formaterDuree(t.dureeTraficMin)} de trajet pour arriver à ${heureParis(rdv.debut)} (${rdv.adresse}). Plans : ${t.lienPlans}` });
      programmes[rdv.id] = rappel.id; crees++;
    } catch (e) {
      console.warn('[départs] trajet impossible pour', rdv.titre, e.message);
    }
  }
  await ecrireValeur(CLE_DEPARTS, { jour, fait: true, programmes });
  return crees;
}

export async function livrerRappelsDus(maintenant = Date.now()) {
  if (!pushDisponible()) return 0;
  const rappels = await listerRappels();
  let livres = 0;
  for (const r of rappels) {
    if (r.livreLe || new Date(r.quand).getTime() > maintenant) continue;
    try {
      await envoyerNotification({ titre: r.titre, corps: r.corps, tag: `rappel-${r.id}` });
      r.livreLe = new Date().toISOString();
      livres++;
    } catch (e) {
      console.warn('[rappels] échec de livraison', r.id, e.message);
    }
  }
  if (livres) {
    // On garde 7 jours d'historique de rappels livrés.
    const limite = maintenant - 7 * 24 * 3600 * 1000;
    await sauverRappels(rappels.filter((r) => !r.livreLe || new Date(r.livreLe).getTime() > limite));
  }
  return livres;
}

// Point du matin = brief complet (agenda, tâches, mails) en un seul push, à partir de 8 h, une fois par jour.
// `client` : client Anthropic ; `serveurs` : serveurs MCP de l'environnement (ou fonction qui les renvoie).
export async function pointDuMatin({ client = null, serveurs = [], maintenant = new Date() } = {}) {
  if (!pushDisponible()) return false;
  const env = typeof serveurs === 'function' ? serveurs() : serveurs;
  const contexte = await resoudreContexteBrief(env);
  const leClient = typeof client === 'function' ? client() : client;
  const envoye = await briefDuMatin({ client: leClient, ...contexte, maintenant });
  await programmerDeparts({ client: leClient, ...contexte, maintenant }).catch((e) => console.warn('[départs]', e.message));
  return envoye;
}

// `client` : client Anthropic (ou fabrique) pour le brief et la consolidation de la mémoire ; sans client, elle est ignorée.
export function demarrerPlanificateur({ client = null, serveurs = [] } = {}, intervalleMs = 20_000) {
  const leClient = () => (typeof client === 'function' ? client() : client);
  const t = setInterval(() => {
    livrerRappelsDus().catch((e) => console.warn('[rappels]', e.message));
    pointDuMatin({ client, serveurs }).catch((e) => console.warn('[matin]', e.message));
    if (client) consolidationHebdo({ client: leClient() }).catch((e) => console.warn('[mémoire]', e.message));
  }, intervalleMs);
  t.unref();
  return t;
}
