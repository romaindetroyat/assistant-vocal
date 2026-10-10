// Brief du matin : agenda du jour, tâches, e-mails importants, courses — un seul push à 8 h, et à la demande.
import { config } from './config.js';
import { lireValeur, ecrireValeur } from './store.js';
import { resumeDuJour } from './taches.js';
import { envoyerNotification, pushDisponible } from './push.js';
import { listerComptes } from './google.js';
import { resoudreServeurs, listerServeursAjoutes } from './mcp.js';
import { jetonPour } from './oauth-mcp.js';
import { configTrajets } from './trajets.js';

const CLE_GARDE = 'brief-du-matin';
const CLE_BRIEF = 'dernier-brief';
const LONGUEUR_PUSH = 200;

// Jour (AAAA-MM-JJ) et heure en Europe/Paris.
export function dateHeureParis(d = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d);
  const v = (t) => parts.find((p) => p.type === t)?.value;
  return { jour: `${v('year')}-${v('month')}-${v('day')}`, heure: Number(v('hour')) % 24 };
}

export function tronquer(texte, max = LONGUEUR_PUSH) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function consigneBrief({ serveurs, comptesGmail, trajets = false }) {
  const agenda = serveurs.find((s) => /agenda|calendar|calendrier/i.test(`${s.name} ${s.description || ''}`));
  const etapes = [
    agenda
      ? `Lis obligatoirement l'agenda du jour avec les outils du serveur « ${agenda.name} » (rendez-vous d'aujourd'hui, heures et lieux).`
      : "Aucun serveur d'agenda n'est connecté : ne cherche pas d'agenda, signale-le en quelques mots.",
    'Appelle tache_lister avec le filtre aujourdhui (tâches du jour et en retard).',
    comptesGmail.length
      ? `Appelle gmail_rechercher (requête « is:unread is:important newer_than:1d ») sur chaque compte connecté (${comptesGmail.join(', ')}) pour les e-mails importants non lus des dernières 24 heures.`
      : "Aucun compte Gmail n'est connecté : ne mentionne pas les e-mails.",
    "Si des listes de courses sont disponibles (outils courses_*) et que c'est utile aujourd'hui, mentionne-les en une phrase, sinon ignore-les.",
    ...(trajets ? ["Pour chaque rendez-vous ayant une adresse, appelle trajet_calculer depuis le domicile (origine vide) avec arriveeA = heure de début du rendez-vous, et indique l'heure de départ conseillée dans le brief (sans recopier les liens)."] : []),
  ];
  return `Tu prépares le brief du matin de l'utilisateur ; il sera lu à voix haute ou affiché en notification. Étapes obligatoires : ${etapes.map((e, i) => `${i + 1}) ${e}`).join(' ')} Ensuite rédige le brief : un texte lisible en vingt secondes, quatre à huit phrases maximum, sans aucune mise en forme (ni titre, ni liste, ni gras), qui commence par la date du jour en toutes lettres. Donne les faits (heures, noms, objets), pas de commentaires. N'utilise pas l'outil brief_du_jour.`;
}

// Tour Claude éphémère (conversation non sauvegardée) avec une consigne : utilisé par le brief et les rappels de départ.
// Retourne { texte, outils }.
export async function tourEphemere({ client, serveurs = [], nonConnectes = [], message, consigne, id = 'ephemere', titre = 'Tour éphémère' }) {
  if (!client) throw new Error('Client Anthropic absent');
  // Import différé : chat.js → tools.js → brief.js, on évite le cycle à l'évaluation des modules.
  const { executerTour } = await import('./chat.js');
  const { outilsLocauxDisponibles } = await import('./tools.js');
  const outilsLocaux = (await outilsLocauxDisponibles()).filter((t) => t.name !== definitionOutilBrief.name);
  const conversation = { id, titre, messages: [] };
  const outils = [];
  let texte = '';
  for await (const ev of executerTour({ source: 'brief',  client, conversation, contenuUtilisateur: [{ type: 'text', text: message }], serveurs, nonConnectes, outilsLocaux, effort: config.effortVoix, consigne })) {
    if (ev.type === 'tool_use') outils.push(ev.name);
    else if (ev.type === 'done') texte = ev.text;
    else if (ev.type === 'error' && !texte) throw new Error(ev.message);
  }
  return { texte: texte.trim(), outils };
}

// Génère le brief par un tour Claude éphémère (non sauvegardé). Retourne { texte, outils }.
export async function genererBrief({ client, serveurs = [], nonConnectes = [] }) {
  const comptesGmail = (await listerComptes().catch(() => [])).map((c) => c.email);
  const trajets = Boolean((await configTrajets().catch(() => ({}))).cle);
  const { texte, outils } = await tourEphemere({ client, serveurs, nonConnectes, id: 'brief', titre: 'Brief du matin', message: 'Prépare le brief du matin.', consigne: consigneBrief({ serveurs, comptesGmail, trajets }) });
  if (!texte) throw new Error('Brief vide');
  return { texte, outils };
}

export const lireDernierBrief = async () => (await lireValeur(CLE_BRIEF)) || null;
export async function enregistrerBrief(texte, maintenant = new Date()) {
  const brief = { jour: dateHeureParis(maintenant).jour, texte, genereLe: maintenant.toISOString() };
  await ecrireValeur(CLE_BRIEF, brief);
  return brief;
}

// Serveurs utilisables hors requête HTTP (cron, planificateur) : env + ajoutés dans l'app, jetons OAuth injectés.
export async function resoudreContexteBrief(serveursEnv = []) {
  const noms = new Set(serveursEnv.map((s) => s.name));
  const ajoutes = (await listerServeursAjoutes().catch(() => [])).filter((s) => !noms.has(s.name)).map((s) => ({ ...s, source: 'app' }));
  const { prets, nonConnectes } = await resoudreServeurs([...serveursEnv, ...ajoutes], (nom) => jetonPour(nom));
  return { serveurs: prets, nonConnectes };
}

/**
 * Point du matin : à partir de 8 h (Europe/Paris), une fois par jour, génère le brief, l'enregistre et envoie UN push.
 * Si la génération échoue, repli sur le résumé des tâches (resumeDuJour) pour ne jamais rater le point du matin.
 */
export async function briefDuMatin({ client = null, serveurs = [], nonConnectes = [], maintenant = new Date(), envoyer = envoyerNotification } = {}) {
  if (!pushDisponible()) return false;
  const { jour, heure } = dateHeureParis(maintenant);
  if (heure < 8) return false;
  const etat = (await lireValeur(CLE_GARDE)) || {};
  if (etat.jour === jour) return false;
  await ecrireValeur(CLE_GARDE, { jour });

  let notification;
  try {
    const { texte } = await genererBrief({ client, serveurs, nonConnectes });
    await enregistrerBrief(texte, maintenant);
    notification = { titre: 'Votre journée', corps: tronquer(texte), url: '/app', tag: 'brief-du-matin' };
  } catch (e) {
    console.warn('[brief] génération impossible, repli sur les tâches :', e.message);
    const r = await resumeDuJour();
    if (!r) return false;
    notification = { titre: r.titre, corps: r.corps, url: '/taches', tag: 'brief-du-matin' };
  }
  await envoyer(notification);
  return true;
}

// Outil local : renvoie le brief du jour s'il existe, sinon invite Claude à le composer lui-même.
export const definitionOutilBrief = {
  name: 'brief_du_jour',
  description: "Renvoie le brief du matin déjà préparé aujourd'hui (agenda, tâches, e-mails importants). À utiliser quand l'utilisateur demande son brief ou sa journée ; s'il n'existe pas encore, compose-le toi-même avec tes outils agenda, tâches et mails.",
  input_schema: { type: 'object', properties: {} },
};
export async function executerOutilBrief() {
  const b = await lireDernierBrief();
  if (b?.texte && b.jour === dateHeureParis().jour) return b.texte;
  return "Pas encore de brief généré aujourd'hui, génère-le toi-même maintenant avec tes outils agenda, tâches et mails.";
}
