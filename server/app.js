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

  app.get('/api/me', (c) => c.json({
    assistantName: config.assistantName,
    model: config.model,
    serveurs: lesServeurs().map((s) => ({ name: s.name, description: s.description })),
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
        for await (const ev of executerTour({ client: leClient(), conversation, contenuUtilisateur: corps.content, serveurs: lesServeurs() })) {
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

  // Fichiers statiques (PWA)
  app.get('/', (c) => c.redirect(estConnecte(c) ? '/app' : '/login'));
  app.get('/login', (c) => fichier(c, '/index.html'));
  app.get('/app', (c) => fichier(c, '/index.html'));
  app.get('/sw.js', async (c) => { const r = await fichier(c, '/sw.js'); const h = new Headers(r.headers); h.set('Cache-Control', 'no-cache'); return new Response(r.body, { status: r.status, headers: h }); });
  app.get('/*', (c) => fichier(c, new URL(c.req.url).pathname));

  return app;
}
