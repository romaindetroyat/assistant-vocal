// Backend de stockage Cloudflare KV.
import { ID_CONVERSATION, nouvelleConversation, resumeDe } from './store.js';

export function creerBackendKv(kv) {
  const cle = (id) => {
    if (!ID_CONVERSATION.test(id)) throw new Error('Identifiant de conversation invalide');
    return `conv:${id}`;
  };
  const lire = (k, defaut) => kv.get(k, 'json').then((v) => (v === null || v === undefined ? defaut : v));
  const ecrire = (k, v) => kv.put(k, JSON.stringify(v));
  async function majIndex(resume, supprimer = false) {
    const index = (await lire('conv-index', [])).filter((r) => r.id !== resume.id);
    if (!supprimer) index.push(resume);
    index.sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
    await ecrire('conv-index', index);
  }
  return {
    listerConversations: () => lire('conv-index', []),
    async creerConversation() { const c = nouvelleConversation(); await ecrire(cle(c.id), c); await majIndex(resumeDe(c)); return c; },
    lireConversation: (id) => lire(cle(id), null),
    async sauverConversation(c) { c.modifieLe = new Date().toISOString(); await ecrire(cle(c.id), c); await majIndex(resumeDe(c)); return c; },
    async supprimerConversation(id) { await kv.delete(cle(id)); await majIndex({ id }, true); },
    listerAbonnements: () => lire('push-subs', []),
    async ajouterAbonnement(abo) {
      const liste = await lire('push-subs', []);
      if (!liste.some((a) => a.endpoint === abo.endpoint)) { liste.push({ ...abo, ajouteLe: new Date().toISOString() }); await ecrire('push-subs', liste); }
      return liste.length;
    },
    async retirerAbonnement(endpoint) { await ecrire('push-subs', (await lire('push-subs', [])).filter((a) => a.endpoint !== endpoint)); },
    listerRappels: () => lire('reminders', []),
    sauverRappels: (r) => ecrire('reminders', r),
  };
}
