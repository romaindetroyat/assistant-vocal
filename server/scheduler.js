// Livraison des rappels programmés (vérification périodique) et brief du matin.
import { listerRappels, sauverRappels } from './store.js';
import { envoyerNotification, pushDisponible } from './push.js';
import { briefDuMatin, resoudreContexteBrief } from './brief.js';

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
  return briefDuMatin({ client: typeof client === 'function' ? client() : client, ...contexte, maintenant });
}

export function demarrerPlanificateur({ client = null, serveurs = [] } = {}, intervalleMs = 20_000) {
  const t = setInterval(() => {
    livrerRappelsDus().catch((e) => console.warn('[rappels]', e.message));
    pointDuMatin({ client, serveurs }).catch((e) => console.warn('[matin]', e.message));
  }, intervalleMs);
  t.unref();
  return t;
}
