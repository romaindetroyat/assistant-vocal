// Livraison des rappels programmés (vérification périodique).
import { listerRappels, sauverRappels } from './store.js';
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

export function demarrerPlanificateur(intervalleMs = 20_000) {
  const t = setInterval(() => livrerRappelsDus().catch((e) => console.warn('[rappels]', e.message)), intervalleMs);
  t.unref();
  return t;
}
