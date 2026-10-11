// Suivi de la consommation Claude par jour (tokens et coût estimé), pour voir la dépense sans attendre la facture.
import { lireValeur, ecrireValeur } from './store.js';

// Tarifs par modèle (USD par million de tokens) : entrée, lecture de cache (0,1 ×), écriture de cache 1 h (2 × entrée), sortie.
export const TARIFS_MODELES = {
  opus: { entree: 4, cache_lecture: 0.2, cache_ecriture: 8, sortie: 20 },
  sonnet: { entree: 2, cache_lecture: 0.2, cache_ecriture: 4, sortie: 10 },
  haiku: { entree: 0.1, cache_lecture: 0.01, cache_ecriture: 0.2, sortie: 0.5 },
};
export const TARIFS = TARIFS_MODELES.opus; // historique (avant la phase 24, tout était compté au tarif Opus)

const jourParis = (d = new Date()) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const cle = (jour) => `usage:${jour}`;

const coutTokens = (u, t) => ((u.entree || 0) * t.entree + (u.cache_lecture || 0) * t.cache_lecture + (u.cache_ecriture || 0) * t.cache_ecriture + (u.sortie || 0) * t.sortie) / 1e6;
// Coût d'une journée : par modèle quand le détail existe ; le reste (jours plus anciens) au tarif Opus.
export function coutUsd(u) {
  const modeles = u.modeles || {};
  let cout = 0; const compte = { entree: 0, cache_lecture: 0, cache_ecriture: 0, sortie: 0 };
  for (const [cle, m] of Object.entries(modeles)) {
    cout += coutTokens(m, TARIFS_MODELES[cle] || TARIFS);
    for (const k of Object.keys(compte)) compte[k] += m[k] || 0;
  }
  const reste = Object.fromEntries(Object.keys(compte).map((k) => [k, Math.max(0, (u[k] || 0) - compte[k])]));
  return cout + coutTokens(reste, TARIFS);
}

// `usage` : objet usage de l'API ; `source` : chat, voix, brief, siri, partage, memoire, compaction…
export async function enregistrerUsage(usage, source = 'chat', maintenant = new Date(), modele = 'opus') {
  if (!usage) return null;
  const jour = jourParis(maintenant);
  const actuel = (await lireValeur(cle(jour))) || { jour, appels: 0, entree: 0, cache_lecture: 0, cache_ecriture: 0, sortie: 0, sources: {} };
  actuel.appels++;
  actuel.entree += usage.input_tokens || 0;
  actuel.cache_lecture += usage.cache_read_input_tokens || 0;
  actuel.cache_ecriture += usage.cache_creation_input_tokens || 0;
  actuel.sortie += usage.output_tokens || 0;
  actuel.sources[source] = (actuel.sources[source] || 0) + 1;
  actuel.modeles = actuel.modeles || {};
  const m = actuel.modeles[modele] || (actuel.modeles[modele] = { appels: 0, entree: 0, cache_lecture: 0, cache_ecriture: 0, sortie: 0 });
  m.appels++;
  m.entree += usage.input_tokens || 0;
  m.cache_lecture += usage.cache_read_input_tokens || 0;
  m.cache_ecriture += usage.cache_creation_input_tokens || 0;
  m.sortie += usage.output_tokens || 0;
  await ecrireValeur(cle(jour), actuel);
  return actuel;
}

export async function lireUsage(jours = 14, maintenant = new Date()) {
  const lignes = [];
  for (let i = 0; i < jours; i++) {
    const d = new Date(maintenant.getTime() - i * 86400000);
    const u = await lireValeur(cle(jourParis(d)));
    if (u) lignes.push({ ...u, cout: Number(coutUsd(u).toFixed(3)) });
  }
  const total = lignes.reduce((s, l) => s + l.cout, 0);
  return { jours: lignes, totalCout: Number(total.toFixed(2)), tarifs: TARIFS, tarifsModeles: TARIFS_MODELES };
}
