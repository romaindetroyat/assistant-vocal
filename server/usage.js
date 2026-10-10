// Suivi de la consommation Claude par jour (tokens et coût estimé), pour voir la dépense sans attendre la facture.
import { lireValeur, ecrireValeur } from './store.js';

// Tarifs Claude Opus 5.5 (USD par million de tokens) : entrée, lecture de cache, écriture de cache (1 h = 2 × entrée), sortie.
export const TARIFS = { entree: 4, cache_lecture: 0.2, cache_ecriture: 8, sortie: 20 };

const jourParis = (d = new Date()) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const cle = (jour) => `usage:${jour}`;

export function coutUsd(u) {
  return ((u.entree || 0) * TARIFS.entree + (u.cache_lecture || 0) * TARIFS.cache_lecture + (u.cache_ecriture || 0) * TARIFS.cache_ecriture + (u.sortie || 0) * TARIFS.sortie) / 1e6;
}

// `usage` : objet usage de l'API ; `source` : chat, voix, brief, siri, partage, memoire, compaction…
export async function enregistrerUsage(usage, source = 'chat', maintenant = new Date()) {
  if (!usage) return null;
  const jour = jourParis(maintenant);
  const actuel = (await lireValeur(cle(jour))) || { jour, appels: 0, entree: 0, cache_lecture: 0, cache_ecriture: 0, sortie: 0, sources: {} };
  actuel.appels++;
  actuel.entree += usage.input_tokens || 0;
  actuel.cache_lecture += usage.cache_read_input_tokens || 0;
  actuel.cache_ecriture += usage.cache_creation_input_tokens || 0;
  actuel.sortie += usage.output_tokens || 0;
  actuel.sources[source] = (actuel.sources[source] || 0) + 1;
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
  return { jours: lignes, totalCout: Number(total.toFixed(2)), tarifs: TARIFS };
}
