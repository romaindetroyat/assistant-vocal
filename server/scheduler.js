// Livraison des rappels programmés (vérification périodique).
import { listerRappels, sauverRappels, lireValeur, ecrireValeur } from './store.js';
import { resumeDuJour } from './taches.js';
import { envoyerNotification, pushDisponible } from './push.js';

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

// Point du matin : tâches du jour, envoyé en push une fois par jour à partir de 8 h (Europe/Paris).
export async function pointDuMatin(maintenant = new Date()) {
  if (!pushDisponible()) return false;
  const paris = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(maintenant);
  const v = (t) => paris.find((p) => p.type === t)?.value;
  const jour = `${v('year')}-${v('month')}-${v('day')}`; const heure = Number(v('hour'));
  if (heure < 8) return false;
  const etat = (await lireValeur('point-du-matin')) || {};
  if (etat.jour === jour) return false;
  await ecrireValeur('point-du-matin', { jour });
  const r = await resumeDuJour();
  if (!r) return false;
  await envoyerNotification({ titre: r.titre, corps: r.corps, url: '/taches', tag: 'point-du-matin' });
  return true;
}

export function demarrerPlanificateur(intervalleMs = 20_000) {
  const t = setInterval(() => { livrerRappelsDus().catch((e) => console.warn('[rappels]', e.message)); pointDuMatin().catch((e) => console.warn('[matin]', e.message)); }, intervalleMs);
  t.unref();
  return t;
}
