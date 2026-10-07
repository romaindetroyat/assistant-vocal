// Notifications Web Push (VAPID, RFC 8291/8292) via WebCrypto : fonctionne sur Node et Cloudflare Workers.
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { config } from './config.js';
import { listerAbonnements, retirerAbonnement } from './store.js';

export function pushDisponible() {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}

// Envoie une notification à tous les appareils abonnés. Retourne le nombre de livraisons réussies.
export async function envoyerNotification({ titre, corps, url = '/app', tag }, fetchImpl = fetch) {
  if (!pushDisponible()) throw new Error('Notifications push non configurées (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
  const abonnements = await listerAbonnements();
  const message = { data: JSON.stringify({ titre, corps, url, tag: tag || `assistant-${Date.now()}` }), options: { ttl: 3600 } };
  let reussites = 0;
  for (const abo of abonnements) {
    try {
      const charge = await buildPushPayload(message, { endpoint: abo.endpoint, expirationTime: null, keys: abo.keys }, config.vapid);
      const r = await fetchImpl(abo.endpoint, charge);
      if (r.status === 404 || r.status === 410) await retirerAbonnement(abo.endpoint);
      else if (r.ok) reussites++;
      else console.warn('[push] échec', r.status);
    } catch (e) {
      console.warn('[push] échec', e.message);
    }
  }
  return reussites;
}
