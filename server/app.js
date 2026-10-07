// Application Hono partagée entre Node et Cloudflare Workers.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { exigerSession, estConnecte, motDePasseValide, poserCookie, retirerCookie } from './auth.js';
import { executerTour } from './chat.js';
import { pushDisponible } from './push.js';
import { transcriptionDisponible, transcrire } from './transcribe.js';
import * as store from './store.js';
import { resoudreServeurs } from './mcp.js';
import * as oauth from './oauth-mcp.js';

/**
 * @param client  client Anthropic (ou simulé)
 * @param serveurs serveurs MCP analysés, ou fonction () => serveurs (évaluée à chaque requête)
 * @param fichier (c, chemin) => Response : sert un fichier statique de public/
 */
export function creerApplication({ client, serveurs = [], fichier }) {
  const app = new Hono();
  const lesServeurs = () => (typeof serveurs === 'function' ? serveurs() : serveurs);
  const leClient = () => (typeof client === 'function' ? client() : client);

  app.post('/api/login', async (c) => {
    const { password } = await c.req.json().catch(() => ({}));
    if (!motDePasseValide(password)) { await new Promise((r) => setTimeout(r, 500)); return c.json({ erreur: 'Mot de passe incorrect' }, 401); }
    poserCookie(c);
    return c.json({ ok: true });
  });
  app.post('/api/logout', (c) => { retirerCookie(c); return c.json({ ok: true }); });
  app.use('/api/*', exigerSession);

  const etatServeurs = () => Promise.all(lesServeurs().map(async (s) => ({ name: s.name, description: s.description, auth: s.auth || 'token', ...(s.auth === 'oauth' ? await oauth.etatConnexion(s.name) : { connecte: true }) })));

  app.get('/api/me', async (c) => c.json({
    assistantName: config.assistantName,
    model: config.model,
    serveurs: await etatServeurs(),
    push: pushDisponible(),
    vapidPublicKey: config.vapid.publicKey || null,
    transcription: transcriptionDisponible(),
  }));

  app.get('/api/conversations', async (c) => c.json(await store.listerConversations()));
  app.post('/api/conversations', async (c) => c.json(await store.creerConversation(), 201));
  app.get('/api/conversations/:id', async (c) => {
    const conv = await store.lireConversation(c.req.param('id')).catch(() => null);
    return conv ? c.json(conv) : c.json({ erreur: 'Introuvable' }, 404);
  });
  app.delete('/api/conversations/:id', async (c) => { await store.supprimerConversation(c.req.param('id')); return c.json({ ok: true }); });

  app.post('/api/chat', async (c) => {
    const corps = await c.req.json().catch(() => null);
    if (!corps || !Array.isArray(corps.content) || !corps.content.length) return c.json({ erreur: 'content requis' }, 400);
    const conversation = corps.conversationId ? await store.lireConversation(corps.conversationId).catch(() => null) : await store.creerConversation();
    if (!conversation) return c.json({ erreur: 'Conversation introuvable' }, 404);
    return streamSSE(c, async (flux) => {
      await flux.writeSSE({ event: 'start', data: JSON.stringify({ conversationId: conversation.id }) });
      try {
        const { prets, nonConnectes } = await resoudreServeurs(lesServeurs(), (nom) => oauth.jetonPour(nom));
        for await (const ev of executerTour({ client: leClient(), conversation, contenuUtilisateur: corps.content, serveurs: prets, nonConnectes })) {
          await flux.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } catch (e) {
        console.error('[chat]', e);
        const message = e instanceof Anthropic.APIError ? `Erreur API (${e.status}) : ${e.message}` : e.message;
        await flux.writeSSE({ event: 'error', data: JSON.stringify({ type: 'error', message }) });
      } finally {
        await store.sauverConversation(conversation);
      }
    });
  });

  app.post('/api/transcribe', async (c) => {
    const form = await c.req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File)) return c.json({ erreur: 'Fichier audio manquant' }, 400);
    try { return c.json({ text: await transcrire(f) }); }
    catch (e) { return c.json({ erreur: e.message }, e.status || 500); }
  });

  // --- Connexion OAuth aux serveurs MCP ---
  const serveurOauth = (nom) => lesServeurs().find((s) => s.name === nom && s.auth === 'oauth');
  app.get('/api/mcp', async (c) => c.json(await etatServeurs()));
  app.post('/api/mcp/:nom/connect', async (c) => {
    const s = serveurOauth(c.req.param('nom'));
    if (!s) return c.json({ erreur: 'Serveur inconnu ou sans OAuth' }, 404);
    try {
      const redirectUri = new URL('/oauth/callback', c.req.url).toString();
      return c.json(await oauth.demarrerConnexion({ nom: s.name, urlMcp: s.url, redirectUri, nomClient: config.assistantName }));
    } catch (e) { return c.json({ erreur: e.message }, 502); }
  });
  app.post('/api/mcp/:nom/finish', async (c) => {
    const s = serveurOauth(c.req.param('nom'));
    if (!s) return c.json({ erreur: 'Serveur inconnu ou sans OAuth' }, 404);
    const corps = await c.req.json().catch(() => ({}));
    const params = corps.code && corps.state ? { code: corps.code, state: corps.state } : oauth.extraireCodeEtState(corps.url || '');
    if (!params) return c.json({ erreur: "Adresse de retour sans code ni state" }, 400);
    try { await oauth.terminerConnexion({ nom: s.name, ...params }); return c.json({ ok: true }); }
    catch (e) { return c.json({ erreur: e.message }, 400); }
  });
  app.delete('/api/mcp/:nom', async (c) => {
    const s = serveurOauth(c.req.param('nom'));
    if (!s) return c.json({ erreur: 'Serveur inconnu ou sans OAuth' }, 404);
    await oauth.deconnecter(s.name);
    return c.json({ ok: true });
  });

  app.get('/api/push/key', (c) => c.json({ key: config.vapid.publicKey || null }));
  app.post('/api/push/subscribe', async (c) => {
    const abo = await c.req.json().catch(() => null);
    if (!abo?.endpoint || !abo?.keys?.p256dh || !abo?.keys?.auth) return c.json({ erreur: 'Abonnement invalide' }, 400);
    return c.json({ ok: true, total: await store.ajouterAbonnement({ endpoint: abo.endpoint, keys: abo.keys }) });
  });
  app.delete('/api/push/subscribe', async (c) => {
    const { endpoint } = await c.req.json().catch(() => ({}));
    if (endpoint) await store.retirerAbonnement(endpoint);
    return c.json({ ok: true });
  });

  // Retour OAuth automatique (quand le serveur MCP autorise l'adresse du Worker). Le state identifie le serveur.
  app.get('/oauth/callback', async (c) => {
    if (!estConnecte(c)) return c.redirect('/login');
    const code = c.req.query('code'); const state = c.req.query('state');
    if (!code || !state) return c.text(`Retour OAuth incomplet : ${c.req.query('error_description') || c.req.query('error') || 'code manquant'}`, 400);
    for (const s of lesServeurs().filter((x) => x.auth === 'oauth')) {
      try { await oauth.terminerConnexion({ nom: s.name, code, state }); return c.redirect(`/app?connecte=${encodeURIComponent(s.name)}`); }
      catch (e) { if (!/attente|state/.test(e.message)) return c.text(`Connexion refusée : ${e.message}`, 400); }
    }
    return c.text('Aucune connexion en attente ne correspond.', 400);
  });

  // Fichiers statiques (PWA)
  app.get('/', (c) => c.redirect(estConnecte(c) ? '/app' : '/login'));
  app.get('/login', (c) => fichier(c, '/index.html'));
  app.get('/app', (c) => fichier(c, '/index.html'));
  app.get('/sw.js', async (c) => { const r = await fichier(c, '/sw.js'); const h = new Headers(r.headers); h.set('Cache-Control', 'no-cache'); return new Response(r.body, { status: r.status, headers: h }); });
  app.get('/*', (c) => fichier(c, new URL(c.req.url).pathname));

  return app;
}
