// Bonnes adresses : recherche de lieux (restaurants, commerces, services…) via Google Places API (New), avec la même clé
// Google Maps Platform que les trajets. Résultats classés par note, filtrables « ouvert maintenant », avec liens Plans
// et Google Maps.
import { configTrajets, lirePositionCourante, resoudreLieu, MESSAGE_SANS_CLE } from './trajets.js';
import { geocoder } from './meteo.js';

const URL_PLACES = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours.openNow,places.location,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,places.primaryTypeDisplayName';
const NOMBRE_MAX = 5;
const PRIX = { PRICE_LEVEL_FREE: 'gratuit', PRICE_LEVEL_INEXPENSIVE: '€', PRICE_LEVEL_MODERATE: '€€', PRICE_LEVEL_EXPENSIVE: '€€€', PRICE_LEVEL_VERY_EXPENSIVE: '€€€€' };
const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

// Centre de la recherche : « pres_de » vide → position partagée, sinon domicile ; une ville ou une adresse → géocodée.
export async function centreRecherche(presDe, fetchImpl = fetch) {
  const t = String(presDe || '').trim();
  if (!t) {
    const position = lirePositionCourante();
    if (position) return { lat: position.lat, lng: position.lng, nom: 'votre position' };
    const domicile = await resoudreLieu('domicile').catch(() => null);
    if (domicile) { const g = await geocoder(domicile, fetchImpl).catch(() => null); if (g) return { lat: g.lat, lng: g.lng, nom: 'la maison' }; }
    return null;
  }
  const m = COORDS.exec(t);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), nom: 'ce point' };
  const texte = await resoudreLieu(t).catch(() => t);
  const g = await geocoder(texte, fetchImpl);
  return { lat: g.lat, lng: g.lng, nom: g.nom || texte };
}

export async function chercherLieux({ requete, presDe = '', ouvertMaintenant = false, noteMin = 0, nombre = NOMBRE_MAX } = {}, fetchImpl = fetch) {
  const { cle } = await configTrajets();
  if (!cle) throw new Error(MESSAGE_SANS_CLE.replace('Les trajets ne sont pas configurés', 'La recherche de lieux n\'est pas configurée'));
  const q = String(requete || '').trim();
  if (!q) throw new Error('Précise ce que tu cherches (ex. « restaurant italien », « pharmacie de garde »)');
  const centre = await centreRecherche(presDe, fetchImpl);
  const corps = { textQuery: q, languageCode: 'fr', regionCode: 'FR', pageSize: Math.min(20, Math.max(5, Number(nombre) || NOMBRE_MAX) * 3), rankPreference: 'RELEVANCE' };
  if (ouvertMaintenant) corps.openNow = true;
  if (Number(noteMin) > 0) corps.minRating = Math.min(5, Number(noteMin));
  if (centre) corps.locationBias = { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: 5000 } };
  const r = await fetchImpl(URL_PLACES, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cle, 'X-Goog-FieldMask': FIELD_MASK }, body: JSON.stringify(corps) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Places : ${json.error?.message || `HTTP ${r.status}`}`);
  const lieux = (json.places || []).map((p) => ({
    id: p.id, nom: p.displayName?.text || '?', adresse: p.formattedAddress || '', type: p.primaryTypeDisplayName?.text || '',
    note: p.rating ?? null, avis: p.userRatingCount ?? 0, prix: PRIX[p.priceLevel] || '', ouvert: p.currentOpeningHours?.openNow ?? null,
    telephone: p.nationalPhoneNumber || '', site: p.websiteUri || '', lat: p.location?.latitude, lng: p.location?.longitude, lienGoogle: p.googleMapsUri || '',
  }));
  // « Bonnes adresses » : note pondérée par le nombre d'avis (une 4,9 sur 3 avis vaut moins qu'une 4,6 sur 400).
  const score = (l) => (l.note ? l.note - 1.5 / Math.sqrt(Math.max(1, l.avis)) : 0);
  lieux.sort((a, b) => score(b) - score(a));
  return { centre, lieux: lieux.slice(0, Math.min(NOMBRE_MAX, Math.max(1, Number(nombre) || NOMBRE_MAX))) };
}

export const lienPlans = (l) => `https://maps.apple.com/?q=${encodeURIComponent(l.nom)}&ll=${l.lat},${l.lng}`;

// Texte lisible à voix haute ; les lignes de liens sont retirées en mode vocal par `sansLiensItineraire`.
export function formaterLieux({ centre, lieux }, requete) {
  if (!lieux.length) return `Je ne trouve pas de ${requete}${centre ? ` près de ${centre.nom}` : ''}.`;
  const lignes = lieux.map((l, i) => {
    const note = l.note ? ` ${l.note.toFixed(1).replace('.', ',')} sur 5 (${l.avis} avis)` : ' sans note';
    const details = [l.prix, l.ouvert === true ? 'ouvert en ce moment' : l.ouvert === false ? 'fermé en ce moment' : '', l.type].filter(Boolean).join(', ');
    return `${i + 1}. ${l.nom},${note}${details ? `, ${details}` : ''}. ${l.adresse}${l.telephone ? `, ${l.telephone}` : ''}.`;
  });
  const liens = lieux.map((l) => `Plans : ${lienPlans(l)}\nGoogle Maps : ${l.lienGoogle}`).join('\n');
  return `${lieux.length === 1 ? 'Meilleure adresse' : `${lieux.length} bonnes adresses`}${centre ? ` près de ${centre.nom}` : ''} :\n${lignes.join('\n')}\n${liens}`;
}

export const definitionOutilLieux = {
  name: 'lieux_chercher',
  description: "Trouve de bonnes adresses (restaurants, bars, commerces, médecins, garages, hôtels, activités…) via Google Places, classées par note pondérée par le nombre d'avis. « pres_de » vide = position partagée ou domicile ; sinon une ville, une adresse ou « bureau ». Pour « ouvert maintenant », « bien noté », utilise les filtres.",
  input_schema: {
    type: 'object',
    properties: {
      requete: { type: 'string', description: 'Ce que l\'utilisateur cherche, en français (ex. « restaurant italien », « boulangerie », « pédiatre »)' },
      pres_de: { type: 'string', description: 'Lieu de recherche : vide = ici / domicile ; ou ville, adresse, « bureau »' },
      ouvert_maintenant: { type: 'boolean', description: 'Ne garder que les lieux ouverts en ce moment' },
      note_min: { type: 'number', description: 'Note minimale sur 5 (ex. 4.3) ; 0 = pas de filtre' },
      nombre: { type: 'integer', description: 'Nombre de résultats souhaités (1 à 5, défaut 3)' },
    },
    required: ['requete'],
  },
};
export async function executerOutilLieux(entree = {}, fetchImpl = fetch) {
  const resultat = await chercherLieux({ requete: entree.requete, presDe: entree.pres_de || '', ouvertMaintenant: Boolean(entree.ouvert_maintenant), noteMin: entree.note_min || 0, nombre: entree.nombre || 3 }, fetchImpl);
  return formaterLieux(resultat, entree.requete);
}
