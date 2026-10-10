// Météo : prévisions Open-Meteo (modèles ECMWF IFS + Météo-France AROME via best_match, comme tameteo.com),
// géocodage Open-Meteo, rendu en français lisible à voix haute. Aucune clé nécessaire.
import { lireValeur, ecrireValeur } from './store.js';
import { lireReglages } from './reglages.js';
import { lirePositionCourante } from './trajets.js';

const URL_GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const URL_PREVISIONS = 'https://api.open-meteo.com/v1/forecast';
const HORAIRE = 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m';
const QUOTIDIEN = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset';
export const FUSEAU = 'Europe/Paris';
export const LIEU_PAR_DEFAUT = 'Toulon';
export const JOURS_MAX = 7;
export const DUREE_CACHE_MS = 30 * 60_000;
const SEUIL_PARAPLUIE = 50; // probabilité de pluie (%) à partir de laquelle on conseille le parapluie

// ---------- Libellés ----------
export const LIBELLES_WMO = {
  0: 'ensoleillé', 1: 'peu nuageux', 2: 'partiellement nuageux', 3: 'ciel couvert',
  45: 'brouillard', 48: 'brouillard givrant',
  51: 'bruine légère', 53: 'bruine', 55: 'bruine forte', 56: 'bruine verglaçante', 57: 'bruine verglaçante forte',
  61: 'pluie faible', 63: 'pluie modérée', 65: 'pluie forte', 66: 'pluie verglaçante', 67: 'pluie verglaçante forte',
  71: 'neige faible', 73: 'neige modérée', 75: 'neige forte', 77: 'grésil',
  80: 'averses faibles', 81: 'averses', 82: 'averses violentes', 85: 'averses de neige', 86: 'fortes averses de neige',
  95: 'orage', 96: 'orage avec grêle', 99: 'orage avec forte grêle',
};
// Le soir, « ensoleillé » devient « ciel dégagé ».
export function libelleWMO(code, { nuit = false } = {}) {
  if (code === null || code === undefined || code === '') return 'temps indéterminé';
  const c = Number(code);
  if (!Number.isFinite(c)) return 'temps indéterminé';
  if (c === 0 && nuit) return 'ciel dégagé';
  return LIBELLES_WMO[c] || 'temps indéterminé';
}
const DIRECTIONS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
export function direction(degres) {
  const d = Number(degres);
  if (!Number.isFinite(d)) return '';
  return DIRECTIONS[Math.round((((d % 360) + 360) % 360) / 45) % 8];
}
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// « jeudi 15 octobre » à partir d'une date AAAA-MM-JJ (jour civil, sans fuseau).
export function jourEnLettres(jourIso, { mois = true } = {}) {
  const [a, m, j] = String(jourIso).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return `${JOURS[d.getUTCDay()]} ${j}${mois ? ` ${MOIS[m - 1]}` : ''}`;
}
const arrondi = (n) => Math.round(Number(n) || 0);
const mm = (n) => { const v = Math.round(Number(n) * 10) / 10; return v >= 10 ? `${Math.round(v)} mm` : `${String(v).replace('.', ',')} mm`; };

// ---------- Date et heure de Paris ----------
export function jourParis(d = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d);
  const v = (t) => parts.find((p) => p.type === t)?.value;
  return { jour: `${v('year')}-${v('month')}-${v('day')}`, heure: Number(v('hour')) % 24 };
}
const joursEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ---------- Géocodage (cache permanent dans le store) ----------
export const normaliserNom = (nom) => String(nom || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const cleGeo = (nom) => `geo:${normaliserNom(nom)}`;

async function rechercherLieu(nom, fetchImpl) {
  const url = new URL(URL_GEO);
  url.searchParams.set('name', nom); url.searchParams.set('language', 'fr'); url.searchParams.set('count', '1'); url.searchParams.set('format', 'json');
  const r = await fetchImpl(url.toString());
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Géocodage : ${json.reason || `HTTP ${r.status}`}`);
  const res = json.results?.[0];
  if (!res) return null;
  return { nom: res.name, lat: Number(res.latitude), lng: Number(res.longitude), region: res.admin1 || '', pays: res.country || '' };
}

// Candidats pour une adresse postale : texte complet, puis la ville après le code postal, puis le dernier segment.
function candidats(texte) {
  const t = String(texte || '').trim();
  const liste = [t];
  const ville = /\b\d{5}\s+([^,;\d]+)/.exec(t)?.[1]?.trim();
  if (ville) liste.push(ville);
  const segments = t.split(/[,;]/).map((s) => s.replace(/\b\d{5}\b/g, '').trim()).filter(Boolean);
  if (segments.length > 1) liste.push(segments.at(-1));
  return [...new Set(liste.filter(Boolean))];
}

/** Géocode un nom de lieu ou une adresse. Résultat { nom, lat, lng, region, pays } mis en cache (clé geo:<nom normalisé>). */
export async function geocoder(nom, fetchImpl = fetch) {
  const texte = String(nom || '').trim();
  if (!texte) throw new Error('Lieu manquant');
  const cle = cleGeo(texte);
  const enCache = normaliserNom(texte) ? await lireValeur(cle) : null;
  if (enCache && Number.isFinite(enCache.lat) && Number.isFinite(enCache.lng)) return enCache;
  let lieu = null;
  for (const c of candidats(texte)) { lieu = await rechercherLieu(c, fetchImpl); if (lieu) break; }
  if (!lieu) throw new Error(`Lieu introuvable : ${texte}`);
  if (normaliserNom(texte)) await ecrireValeur(cle, lieu);
  return lieu;
}

// ---------- Prévisions (cache 30 min par lieu, coordonnées arrondies à deux décimales) ----------
const enc = (v) => v.toFixed(2).replace('-', 'm').replace('.', '-');
export const clePrevisions = (lat, lng) => `meteo:${enc(Number(lat))}_${enc(Number(lng))}`;

/** Prévisions brutes Open-Meteo (horaire + quotidien, 7 jours, heure de Paris) pour un point. */
export async function previsions({ lat, lng, jours = JOURS_MAX } = {}, fetchImpl = fetch, maintenant = new Date()) {
  const la = Number(lat); const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error('Coordonnées invalides');
  const cle = clePrevisions(la, lo);
  const cache = await lireValeur(cle);
  if (cache?.data && cache.a && maintenant.getTime() - Date.parse(cache.a) < DUREE_CACHE_MS && jourParis(new Date(cache.a)).jour === jourParis(maintenant).jour) return cache.data;
  const url = new URL(URL_PREVISIONS);
  url.searchParams.set('latitude', String(Math.round(la * 1e4) / 1e4)); url.searchParams.set('longitude', String(Math.round(lo * 1e4) / 1e4));
  url.searchParams.set('hourly', HORAIRE); url.searchParams.set('daily', QUOTIDIEN);
  url.searchParams.set('timezone', FUSEAU); url.searchParams.set('forecast_days', String(Math.min(JOURS_MAX, Math.max(1, Number(jours) || JOURS_MAX))));
  url.searchParams.set('models', 'best_match'); url.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetchImpl(url.toString());
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) throw new Error(`Open-Meteo : ${json.reason || `HTTP ${r.status}`}`);
  if (!json.daily?.time?.length || !json.hourly?.time?.length) throw new Error('Open-Meteo : réponse sans prévisions');
  await ecrireValeur(cle, { a: maintenant.toISOString(), data: json });
  return json;
}

// ---------- Résumés ----------
const TRANCHES = [
  { cle: 'matin', libelle: 'le matin', de: 6, a: 12 },
  { cle: 'apresMidi', libelle: "l'après-midi", de: 12, a: 18 },
  { cle: 'soiree', libelle: 'en soirée', de: 18, a: 24, nuit: true },
];
const serie = (prev, nom) => prev.hourly?.[nom] || [];
const max = (xs) => xs.reduce((m, x) => (Number.isFinite(x) && (m === null || x > m) ? x : m), null);
const min = (xs) => xs.reduce((m, x) => (Number.isFinite(x) && (m === null || x < m) ? x : m), null);
const somme = (xs) => xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);

/** Tranches matin / après-midi / soirée du jour `index` (0 = aujourd'hui) à partir des données horaires. */
export function resumerTranches(prev, index = 0) {
  const jour = prev.daily.time[index];
  if (!jour) throw new Error(`Pas de prévision pour le jour ${index}`);
  const heures = prev.hourly.time;
  const tranches = [];
  for (const t of TRANCHES) {
    const idx = [];
    for (let i = 0; i < heures.length; i++) { if (heures[i].startsWith(jour)) { const h = Number(heures[i].slice(11, 13)); if (h >= t.de && h < t.a) idx.push(i); } }
    if (!idx.length) continue;
    const prendre = (nom) => idx.map((i) => serie(prev, nom)[i]);
    const codes = prendre('weather_code');
    const temps = prendre('temperature_2m');
    tranches.push({
      cle: t.cle, libelle: t.libelle, de: t.de, a: t.a,
      code: max(codes), ciel: libelleWMO(max(codes), { nuit: t.nuit }),
      tMin: min(temps), tMax: max(temps),
      probabilite: max(prendre('precipitation_probability')) ?? 0, pluieMm: somme(prendre('precipitation')),
      vent: max(prendre('wind_speed_10m')), rafales: max(prendre('wind_gusts_10m')),
    });
  }
  return tranches;
}

/** Résumé quotidien du jour `index` (0 = aujourd'hui). */
export function resumerJour(prev, index = 0) {
  const d = prev.daily;
  const jour = d.time[index];
  if (!jour) throw new Error(`Pas de prévision pour le jour ${index}`);
  const v = (nom) => d[nom]?.[index];
  return {
    jour, code: v('weather_code'), ciel: libelleWMO(v('weather_code')),
    tMin: v('temperature_2m_min'), tMax: v('temperature_2m_max'),
    probabilite: v('precipitation_probability_max') ?? 0, pluieMm: v('precipitation_sum') ?? 0,
    vent: v('wind_speed_10m_max'), rafales: v('wind_gusts_10m_max'), direction: direction(v('wind_direction_10m_dominant')),
    lever: v('sunrise'), coucher: v('sunset'),
  };
}

/** Conseil pratique déduit de règles simples (parapluie, vent, chaleur, gel, orage). Chaîne vide si rien à signaler. */
export function conseil(prev, index = 0) {
  const j = resumerJour(prev, index);
  const codes = [j.code, ...resumerTranches(prev, index).map((t) => t.code)].filter((c) => Number.isFinite(c));
  const conseils = [];
  if (codes.some((c) => c >= 95)) conseils.push('Orages possibles : évitez les sorties en mer et en montagne.');
  else if (codes.some((c) => c >= 71 && c <= 77) || codes.some((c) => c === 85 || c === 86)) conseils.push('Chaussures et vêtements chauds, il va neiger.');
  else if (j.probabilite >= SEUIL_PARAPLUIE || Number(j.pluieMm) >= 1) conseils.push('Prenez un parapluie.');
  if (Number(j.rafales) >= 70) conseils.push('Vent violent : attachez ce qui peut s\'envoler.');
  else if (Number(j.rafales) >= 50) conseils.push('Attention aux rafales.');
  if (Number(j.tMax) >= 30) conseils.push('Forte chaleur : pensez à boire.');
  if (Number(j.tMin) <= 0) conseils.push('Gel possible : attention au verglas.');
  else if (Number(j.tMin) <= 5 && Number(j.tMax) < 12) conseils.push('Couvrez-vous, il fait froid.');
  return conseils.join(' ');
}

// ---------- Mise en forme lisible à voix haute ----------
const pluie = (p, mmValeur) => (p >= 30 || mmValeur >= 0.5 ? ` (${arrondi(p)} %${mmValeur >= 0.5 ? `, ${mm(mmValeur)}` : ''})` : '');
function phraseVent(vent, rafales, dir) {
  const v = arrondi(vent);
  if (!v) return '';
  const r = arrondi(rafales);
  return `vent${dir ? ` de ${dir}` : ''} ${v} km/h${r >= v + 15 ? ` en rafales à ${r}` : ''}`;
}
function phraseTranches(tranches) {
  if (!tranches.length) return '';
  const groupes = [];
  for (const t of tranches) {
    const dernier = groupes.at(-1);
    if (dernier && dernier.code === t.code) { dernier.libelles.push(t.libelle); dernier.probabilite = Math.max(dernier.probabilite, t.probabilite); dernier.pluieMm += t.pluieMm; }
    else groupes.push({ ciel: t.ciel, code: t.code, libelles: [t.libelle], probabilite: t.probabilite, pluieMm: t.pluieMm });
  }
  if (groupes.length === 1 && tranches.length === TRANCHES.length) { const g = groupes[0]; return `${g.ciel} toute la journée${pluie(g.probabilite, g.pluieMm)}`; }
  return groupes.map((g) => `${g.ciel} ${g.libelles.join(' et ')}${pluie(g.probabilite, g.pluieMm)}`).join(', ');
}

/** Texte d'un jour en tranches (aujourd'hui, demain) : « Demain à Toulon : … ». Les tranches passées d'aujourd'hui sont omises. */
export function texteJourDetaille(prev, index, { nom, libelleJour, maintenant = new Date() } = {}) {
  const j = resumerJour(prev, index);
  let tranches = resumerTranches(prev, index);
  if (index === 0) { const h = jourParis(maintenant).heure; const avenir = tranches.filter((t) => t.a > h); if (avenir.length) tranches = avenir; }
  const ciel = phraseTranches(tranches) || j.ciel;
  const temps = tranches.length ? [min(tranches.map((t) => t.tMin)), max(tranches.map((t) => t.tMax))] : [j.tMin, j.tMax];
  const [tMin, tMax] = [arrondi(temps[0]), arrondi(temps[1])];
  const vent = phraseVent(max(tranches.map((t) => t.vent)) ?? j.vent, max(tranches.map((t) => t.rafales)) ?? j.rafales, j.direction);
  const morceaux = [ciel, tMin === tMax ? `${tMax} degrés` : `${tMin} à ${tMax} degrés`, vent].filter(Boolean);
  const c = conseil(prev, index);
  return `${libelleJour} à ${nom} : ${morceaux.join(', ')}.${c ? ` ${c}` : ''}`;
}

/** Ligne d'un jour en résumé : « Jeudi 15 : pluie faible, 12 à 17 degrés, pluie 80 %, vent 40 km/h. » */
export function ligneJour(prev, index) {
  const j = resumerJour(prev, index);
  const morceaux = [j.ciel, `${arrondi(j.tMin)} à ${arrondi(j.tMax)} degrés`];
  if (j.probabilite >= 30 || Number(j.pluieMm) >= 0.5) morceaux.push(`pluie ${arrondi(j.probabilite)} %${Number(j.pluieMm) >= 0.5 ? ` (${mm(j.pluieMm)})` : ''}`);
  const vent = arrondi(j.vent); if (vent >= 30) morceaux.push(`vent ${vent} km/h${arrondi(j.rafales) >= vent + 15 ? ` en rafales à ${arrondi(j.rafales)}` : ''}`);
  return `${majuscule(jourEnLettres(j.jour, { mois: false }))} : ${morceaux.join(', ')}.`;
}

// ---------- Lieu par défaut et quand ----------
const ALIAS_DOMICILE = /^(domicile|maison|chez moi|home)$/i;
const ALIAS_ICI = /^(ici|position|position actuelle|ma position)$/i;

/** Lieu effectif : texte donné (géocodé), sinon position courante, sinon domicile des réglages, sinon Toulon. */
export async function resoudreLieuMeteo(lieu, fetchImpl = fetch) {
  const t = String(lieu || '').trim();
  const reglages = await lireReglages().catch(() => ({}));
  if (t && !ALIAS_DOMICILE.test(t) && !ALIAS_ICI.test(t)) return geocoder(t, fetchImpl);
  if (ALIAS_DOMICILE.test(t)) { if (!reglages.domicile) throw new Error("Adresse du domicile inconnue : demande-la et enregistre-la avec trajet_adresse_definir"); return { ...(await geocoder(reglages.domicile, fetchImpl)), nom: 'la maison' }; }
  const position = lirePositionCourante();
  if (position) return { nom: 'votre position', lat: position.lat, lng: position.lng, region: '', pays: '' };
  if (reglages.domicile) return geocoder(reglages.domicile, fetchImpl);
  return geocoder(LIEU_PAR_DEFAUT, fetchImpl);
}

const QUAND = { aujourdhui: 0, 'aujourd-hui': 0, 'aujourd hui': 0, demain: 1, 'apres-demain': 2, 'apres demain': 2, semaine: 'semaine', '': 0 };
export function interpreterQuand(quand, maintenant = new Date()) {
  const q = String(quand || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/'/g, '-');
  if (q in QUAND) return QUAND[q];
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const d = joursEntre(jourParis(maintenant).jour, q);
    if (Number.isNaN(d)) throw new Error(`Date invalide : ${quand}`);
    if (d < 0) throw new Error(`La date ${q} est passée : je n'ai que les prévisions à venir.`);
    if (d >= JOURS_MAX) throw new Error(`La date ${q} est trop lointaine : les prévisions couvrent ${JOURS_MAX} jours.`);
    return d;
  }
  throw new Error(`Période inconnue : « ${quand} ». Utilise aujourdhui, demain, semaine ou une date AAAA-MM-JJ.`);
}

/** Texte météo complet pour { lieu, quand }. */
export async function texteMeteo({ lieu = '', quand = 'aujourdhui' } = {}, fetchImpl = fetch, maintenant = new Date()) {
  const cible = interpreterQuand(quand, maintenant);
  const l = await resoudreLieuMeteo(lieu, fetchImpl);
  const prev = await previsions({ lat: l.lat, lng: l.lng }, fetchImpl, maintenant);
  const nom = l.nom;
  if (cible === 'semaine') {
    const lignes = [];
    for (let i = 0; i < Math.min(JOURS_MAX, prev.daily.time.length); i++) lignes.push(ligneJour(prev, i));
    return `Semaine à ${nom} :\n${lignes.join('\n')}`;
  }
  if (cible >= prev.daily.time.length) throw new Error('Prévision indisponible pour ce jour');
  if (cible <= 1) return texteJourDetaille(prev, cible, { nom, libelleJour: cible === 0 ? "Aujourd'hui" : 'Demain', maintenant });
  const ligne = ligneJour(prev, cible);
  const c = conseil(prev, cible);
  return `${majuscule(jourEnLettres(prev.daily.time[cible]))} à ${nom} ${ligne.replace(/^[^:]+/, '').trim()}${c ? ` ${c}` : ''}`;
}

// ---------- Outil local ----------
export const definitionOutilMeteo = {
  name: 'meteo',
  description: "Prévisions météo (modèles ECMWF et AROME) lisibles à voix haute : ciel, température, pluie (probabilité et quantité), vent, conseil. lieu vide = position actuelle de l'utilisateur si partagée, sinon son domicile. quand : aujourdhui, demain, semaine (une ligne par jour) ou une date AAAA-MM-JJ dans les sept jours.",
  input_schema: {
    type: 'object',
    properties: {
      lieu: { type: 'string', description: 'Ville ou adresse ; vide = ici ou domicile' },
      quand: { type: 'string', description: 'aujourdhui (défaut), demain, semaine ou AAAA-MM-JJ' },
    },
  },
};
export const nomOutilMeteo = definitionOutilMeteo.name;

export async function executerOutilMeteo(entree = {}, fetchImpl = fetch, maintenant = new Date()) {
  try { return await texteMeteo({ lieu: String(entree.lieu || '').slice(0, 200), quand: String(entree.quand || 'aujourdhui').slice(0, 30) }, fetchImpl, maintenant); }
  catch (e) { return `Météo indisponible : ${e.message}`; }
}
