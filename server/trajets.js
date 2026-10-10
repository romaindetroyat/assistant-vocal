// Trajets : Google Routes API (trafic réel, transports en commun), liens Plans / Google Maps, heure de départ conseillée.
// La clé est saisie dans « Mes outils › Trajets » (ecrireValeur('trajets-config')) ou fournie par GOOGLE_MAPS_API_KEY ;
// elle n'est jamais renvoyée au front en clair.
import { lireValeur, ecrireValeur } from './store.js';
import { lireReglages, modifierReglages } from './reglages.js';

const env = () => (typeof process !== 'undefined' && process.env) || {};
const URL_ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.legs.steps.navigationInstruction';
const CLE_CONFIG = 'trajets-config';
export const MARGE_MIN = 5; // marge ajoutée à l'heure de départ conseillée
export const MODES = {
  DRIVE: { libelle: 'en voiture', plans: 'd', google: 'driving' },
  TRANSIT: { libelle: 'en transports en commun', plans: 'r', google: 'transit' },
  WALK: { libelle: 'à pied', plans: 'w', google: 'walking' },
  BICYCLE: { libelle: 'à vélo', plans: 'w', google: 'bicycling' },
};
export const MESSAGE_SANS_CLE = "Les trajets ne sont pas configurés : demande à l'utilisateur de coller une clé Google Maps Platform (API Routes) dans « Mes outils › Trajets ».";

// ---------- Configuration ----------
export async function configTrajets() {
  const stockee = (await lireValeur(CLE_CONFIG)) || {};
  const cle = String(stockee.cle || env().GOOGLE_MAPS_API_KEY || '').trim();
  return { cle, source: stockee.cle ? 'app' : cle ? 'env' : null };
}
export async function enregistrerConfigTrajets({ cle }) {
  const c = String(cle || '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(c)) throw new Error('Clé Google Maps invalide (attendue : AIza… sans espace)');
  await ecrireValeur(CLE_CONFIG, { cle: c, ajouteLe: new Date().toISOString() });
}
export async function retirerConfigTrajets() { await ecrireValeur(CLE_CONFIG, {}); }
export const masquerCle = (cle) => (cle ? `${cle.slice(0, 4)}…${cle.slice(-4)}` : null);

// ---------- Position courante (fournie par le front à chaque message quand « partager ma position » est actif) ----------
let positionCourante = null; // { lat, lng, precision } ou null
export function definirPositionCourante(position) {
  const lat = Number(position?.lat); const lng = Number(position?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { positionCourante = null; return null; }
  const precision = Number.isFinite(Number(position.precision)) ? Math.round(Number(position.precision)) : null;
  positionCourante = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, precision };
  return positionCourante;
}
export const lirePositionCourante = () => positionCourante;
export function consignePosition(position) {
  const p = definirPositionCourante(position);
  return p ? `Position actuelle de l'utilisateur : ${p.lat},${p.lng}${p.precision ? ` (±${p.precision} m)` : ''}. Pour un trajet depuis « ici », laisse l'origine vide.` : null;
}

// ---------- Lieux ----------
const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
export function lieuRoutes(texte) {
  const m = COORDS.exec(texte);
  return m ? { location: { latLng: { latitude: Number(m[1]), longitude: Number(m[2]) } } } : { address: texte };
}
// Origine effective : texte donné (alias « domicile »/« bureau » résolus), sinon position courante, sinon domicile.
export async function resoudreLieu(texte, { parDefaut = false } = {}) {
  const t = String(texte || '').trim();
  const reglages = await lireReglages();
  if (/^(domicile|maison|chez moi|home)$/i.test(t)) { if (!reglages.domicile) throw new Error("Adresse du domicile inconnue : demande-la et enregistre-la avec trajet_adresse_definir"); return reglages.domicile; }
  if (/^(bureau|travail|boulot|work)$/i.test(t)) { if (!reglages.bureau) throw new Error("Adresse du bureau inconnue : demande-la et enregistre-la avec trajet_adresse_definir"); return reglages.bureau; }
  if (t) return t;
  if (!parDefaut) throw new Error('Destination manquante');
  if (positionCourante) return `${positionCourante.lat},${positionCourante.lng}`;
  if (reglages.domicile) return reglages.domicile;
  throw new Error("Origine inconnue : ni position partagée ni domicile enregistré (trajet_adresse_definir ou « Mes outils › Trajets »)");
}

// ---------- Liens ----------
export function liens({ origine, destination, mode = 'DRIVE' }) {
  const m = MODES[mode] || MODES.DRIVE;
  const plans = new URL('https://maps.apple.com/');
  if (origine) plans.searchParams.set('saddr', origine);
  plans.searchParams.set('daddr', destination); plans.searchParams.set('dirflg', m.plans);
  const google = new URL('https://www.google.com/maps/dir/');
  google.searchParams.set('api', '1');
  if (origine) google.searchParams.set('origin', origine);
  google.searchParams.set('destination', destination); google.searchParams.set('travelmode', m.google);
  return { lienPlans: plans.toString(), lienGoogle: google.toString() };
}

// ---------- Appel Routes ----------
const secondes = (d) => { const n = Number(String(d || '').replace(/s$/, '')); return Number.isFinite(n) ? n : 0; };
const dateValide = (iso) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d; };

async function appelRoutes({ cle, origine, destination, mode, departureTime, arrivalTime, trafic = true }, fetchImpl) {
  const corps = { origin: lieuRoutes(origine), destination: lieuRoutes(destination), travelMode: mode, languageCode: 'fr-FR', units: 'METRIC' };
  if (mode === 'DRIVE') corps.routingPreference = trafic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE';
  if (departureTime && mode !== 'WALK' && mode !== 'BICYCLE') corps.departureTime = departureTime;
  if (arrivalTime && mode === 'TRANSIT') corps.arrivalTime = arrivalTime;
  const r = await fetchImpl(URL_ROUTES, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cle, 'X-Goog-FieldMask': FIELD_MASK }, body: JSON.stringify(corps) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Routes : ${json.error?.message || `HTTP ${r.status}`}`);
  const route = json.routes?.[0];
  if (!route) throw new Error(`Aucun itinéraire trouvé entre « ${origine} » et « ${destination} »`);
  const etapes = (route.legs || []).flatMap((l) => l.steps || []).map((s) => s.navigationInstruction?.instructions).filter(Boolean);
  return { dureeS: secondes(route.duration), dureeStatiqueS: secondes(route.staticDuration) || secondes(route.duration), distanceM: Number(route.distanceMeters) || 0, description: route.description || '', etapes };
}

// Heure de départ future (Routes refuse les dates passées) : au plus tôt maintenant + 1 min.
const futur = (d, maintenant) => (d.getTime() < maintenant.getTime() + 60_000 ? null : d.toISOString());

/**
 * Calcule un trajet. `origine` vide = position courante, sinon domicile. `mode` : DRIVE (défaut), TRANSIT, WALK, BICYCLE.
 * `arriveeA` (ISO) : calcule l'heure de départ conseillée (voiture : deux appels, sans puis avec trafic à l'heure prévue).
 * `departA` (ISO, futur) : trafic prévu à cette heure. Retourne { dureeMin, dureeTraficMin, distanceKm, resume, heureDepart, lienPlans, lienGoogle, etapes, mode, origine, destination }.
 */
export async function calculerTrajet({ origine = '', destination, mode = 'DRIVE', departA = null, arriveeA = null } = {}, fetchImpl = fetch, maintenant = new Date()) {
  const { cle } = await configTrajets();
  if (!cle) throw new Error(MESSAGE_SANS_CLE);
  const m = String(mode || 'DRIVE').toUpperCase();
  if (!MODES[m]) throw new Error(`Mode inconnu : ${mode} (DRIVE, TRANSIT, WALK, BICYCLE)`);
  const de = await resoudreLieu(origine, { parDefaut: true });
  const vers = await resoudreLieu(destination);
  const arrivee = dateValide(arriveeA); const depart = dateValide(departA);
  if (arriveeA && !arrivee) throw new Error(`Heure d'arrivée invalide : ${arriveeA}`);
  if (departA && !depart) throw new Error(`Heure de départ invalide : ${departA}`);

  let route; let heureDepart = null;
  if (arrivee) {
    if (m === 'TRANSIT') {
      route = await appelRoutes({ cle, origine: de, destination: vers, mode: m, arrivalTime: arrivee.toISOString() }, fetchImpl);
      heureDepart = new Date(arrivee.getTime() - route.dureeS * 1000);
    } else if (m === 'DRIVE') {
      // Première estimation sans trafic, puis trafic prévu à l'heure de départ estimée (marge comprise).
      const sansTrafic = await appelRoutes({ cle, origine: de, destination: vers, mode: m, trafic: false }, fetchImpl);
      const estime = new Date(arrivee.getTime() - (sansTrafic.dureeStatiqueS + MARGE_MIN * 60) * 1000);
      route = await appelRoutes({ cle, origine: de, destination: vers, mode: m, departureTime: futur(estime, maintenant) }, fetchImpl);
      heureDepart = new Date(arrivee.getTime() - (route.dureeS + MARGE_MIN * 60) * 1000);
    } else {
      route = await appelRoutes({ cle, origine: de, destination: vers, mode: m }, fetchImpl);
      heureDepart = new Date(arrivee.getTime() - (route.dureeS + MARGE_MIN * 60) * 1000);
    }
  } else {
    route = await appelRoutes({ cle, origine: de, destination: vers, mode: m, departureTime: depart ? futur(depart, maintenant) : null }, fetchImpl);
  }
  const dureeTraficMin = Math.round(route.dureeS / 60);
  const dureeMin = Math.round(route.dureeStatiqueS / 60);
  const distanceKm = Math.round(route.distanceM / 100) / 10;
  const resume = route.description || route.etapes[0] || '';
  return { origine: de, destination: vers, mode: m, dureeMin, dureeTraficMin, distanceKm, resume, etapes: route.etapes.slice(0, 8), heureDepart: heureDepart ? heureDepart.toISOString() : null, arriveeA: arrivee ? arrivee.toISOString() : null, ...liens({ origine: de, destination: vers, mode: m }) };
}

export async function heureDepart({ destination, arriveeA, origine = '', mode = 'DRIVE' }, fetchImpl = fetch, maintenant = new Date()) {
  const t = await calculerTrajet({ origine, destination, mode, arriveeA }, fetchImpl, maintenant);
  return { heureDepart: t.heureDepart, dureeTraficMin: t.dureeTraficMin, trajet: t };
}

// ---------- Mise en forme lisible à voix haute ----------
export const heureParis = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
export function formaterDuree(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
export function formaterTrajet(t) {
  const lignes = [];
  const trafic = t.mode === 'DRIVE' && t.dureeTraficMin !== t.dureeMin ? ` avec le trafic (${formaterDuree(t.dureeMin)} sans)` : t.mode === 'DRIVE' ? ' avec le trafic actuel' : '';
  lignes.push(`Environ ${formaterDuree(t.dureeTraficMin)}${trafic}, ${t.distanceKm} km ${MODES[t.mode].libelle}${t.resume ? ` par ${t.resume}` : ''}, jusqu'à ${t.destination}.`);
  if (t.heureDepart) lignes.push(`Départ conseillé à ${heureParis(t.heureDepart)} (marge de ${MARGE_MIN} min comprise) pour arriver à ${heureParis(t.arriveeA)}.`);
  lignes.push(`Plans : ${t.lienPlans}`, `Google Maps : ${t.lienGoogle}`);
  return lignes.join('\n');
}

// ---------- Adresses connues ----------
export async function definirAdresse(lieu, adresse) {
  const l = String(lieu || '').toLowerCase();
  if (l !== 'domicile' && l !== 'bureau') throw new Error('lieu doit valoir domicile ou bureau');
  const r = await modifierReglages({ [l]: String(adresse || '') });
  return r[l];
}

// ---------- Outils locaux ----------
export const definitionsOutilsTrajets = [
  {
    name: 'trajet_calculer',
    description: "Temps de trajet, distance, itinéraire et heure de départ conseillée (Google Routes, trafic réel). origine vide = position actuelle de l'utilisateur si partagée, sinon son domicile ; « domicile » et « bureau » sont acceptés. Pour un rendez-vous, donne son adresse en destination et son heure de début en arriveeA. La réponse contient des liens Plans et Google Maps à recopier tels quels, chacun sur sa ligne.",
    input_schema: {
      type: 'object',
      properties: {
        origine: { type: 'string', description: 'Adresse ou lieu de départ ; vide = position actuelle ou domicile' },
        destination: { type: 'string', description: "Adresse ou lieu d'arrivée" },
        mode: { type: 'string', enum: ['DRIVE', 'TRANSIT', 'WALK', 'BICYCLE'], description: 'DRIVE par défaut' },
        arriveeA: { type: 'string', description: "Heure d'arrivée souhaitée (ISO 8601 avec fuseau) : calcule quand partir" },
        departA: { type: 'string', description: 'Heure de départ prévue (ISO 8601 avec fuseau, futur) ; vide = maintenant' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'trajet_adresse_definir',
    description: "Enregistre l'adresse du domicile ou du bureau de l'utilisateur pour les trajets (adresse vide = effacer).",
    input_schema: {
      type: 'object',
      properties: {
        lieu: { type: 'string', enum: ['domicile', 'bureau'] },
        adresse: { type: 'string', description: 'Adresse postale complète' },
      },
      required: ['lieu', 'adresse'],
    },
  },
];
export const nomsOutilsTrajets = new Set(definitionsOutilsTrajets.map((t) => t.name));

export async function executerOutilTrajets(nom, entree = {}, fetchImpl = fetch) {
  if (nom === 'trajet_adresse_definir') {
    const adresse = await definirAdresse(entree.lieu, entree.adresse);
    return adresse ? `Adresse du ${entree.lieu} enregistrée : ${adresse}.` : `Adresse du ${entree.lieu} effacée.`;
  }
  if (nom === 'trajet_calculer') {
    if (!(await configTrajets()).cle) return MESSAGE_SANS_CLE;
    try { return formaterTrajet(await calculerTrajet(entree, fetchImpl)); }
    catch (e) { return `Trajet impossible : ${e.message}`; }
  }
  throw new Error(`Outil trajets inconnu : ${nom}`);
}
