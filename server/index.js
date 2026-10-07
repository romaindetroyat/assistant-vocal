import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { config, verifierConfig } from './config.js';
import { exigerSession, estConnecte, motDePasseValide, poserCookie, retirerCookie } from './auth.js';
import { chargerServeursMcp } from './mcp.js';
import { executerTour } from './chat.js';
import { pushDisponible } from './push.js';
import { transcriptionDisponible, transcrire } from './transcribe.js';
import { demarrerPlanificateur } from './scheduler.js';
import * as store from './store.js';

const ici = path.dirname(fileURLToPath(import.meta.url));
const dossierPublic = path.relative(process.cwd(), path.join(ici, '..', 'public')) || '.';

export function creerApplication({ client = new Anthropic(), serveurs = chargerServeursMcp() } = {}) {
  const app = new Hono();

  // --- Authentification ---
  app.post('/api/login', async (c) => {
    const { password } = await c.req.json().catch(() => ({}));
    if (!motDePasseValide(password)) {
      await new Promise((r) => setTimeout(r, 500));
      return c.json({ erreur: 'Mot de passe incorrect' }, 401);
    }
    poserCookie(c);
    return c.json({ ok: true });
  });
  app.post('/api/logout', (c) => {
    retirerCookie(c);
    return c.json({ ok: true });
  });
  app.use('/api/*', exigerSession);

  app.get('/api/me', (c) =>
    c.json({
      assistantName: config.assistantName,
      model: config.model,
      serveurs: serveurs.map((s) => ({ name: s.name, description: s.description })),
      push: pushDisponible(),
      vapidPublicKey: config.vapid.publicKey || null,
      transcription: transcriptionDisponible(),
    }),
  );

  // --- Conversations ---
  app.get('/api/conversations', async (c) => c.json(await store.listerConversations()));
  app.post('/api/conversations', async (c) => c.json(await store.creerConversation(), 201));
  app.get('/api/conversations/:id', async (c) => {
    const conv = await store.lireConversation(c.req.param('id')).catch(() => null);
    return conv ? c.json(conv) : c.json({ erreur: 'Introuvable' }, 404);
  });
  app.delete('/api/conversations/:id', async (c) => {
    await store.supprimerConversation(c.req.param('id'));
    return c.json({ ok: true });
  });

  // --- Chat (SSE) ---
  app.post('/api/chat', async (c) => {
    const corps = await c.req.json().catch(() => null);
    if (!corps || !Array.isArray(corps.content) || !corps.content.length) return c.json({ erreur: 'content requis' }, 400);
    const conversation = corps.conversationId
      ? await store.lireConversation(corps.conversationId).catch(() => null)
      : await store.creerConversation();
    if (!conversation) return c.json({ erreur: 'Conversation introuvable' }, 404);

    return streamSSE(c, async (flux) => {
      await flux.writeSSE({ event: 'start', data: JSON.stringify({ conversationId: conversation.id }) });
      try {
        for await (const ev of executerTour({ client, conversation, contenuUtilisateur: corps.content, serveurs })) {
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

  // --- Transcription des vocaux ---
  app.post('/api/transcribe', async (c) => {
    const form = await c.req.formData().catch(() => null);
    const fichier = form?.get('file');
    if (!(fichier instanceof File)) return c.json({ erreur: 'Fichier audio manquant' }, 400);
    try {
      return c.json({ text: await transcrire(fichier) });
    } catch (e) {
      return c.json({ erreur: e.message }, e.status || 500);
    }
  });

  // --- Notifications push ---
  app.get('/api/push/key', (c) => c.json({ key: config.vapid.publicKey || null }));
  app.post('/api/push/subscribe', async (c) => {
    const abo = await c.req.json().catch(() => null);
    if (!abo?.endpoint || !abo?.keys?.p256dh || !abo?.keys?.auth) return c.json({ erreur: 'Abonnement invalide' }, 400);
    const total = await store.ajouterAbonnement({ endpoint: abo.endpoint, keys: abo.keys });
    return c.json({ ok: true, total });
  });
  app.delete('/api/push/subscribe', async (c) => {
    const { endpoint } = await c.req.json().catch(() => ({}));
    if (endpoint) await store.retirerAbonnement(endpoint);
    return c.json({ ok: true });
  });

  // --- Fichiers statiques (PWA) ---
  app.get('/sw.js', serveStatic({ root: dossierPublic, path: 'sw.js', onFound: (_p, c) => c.header('Cache-Control', 'no-cache') }));
  app.get('/', (c) => (estConnecte(c) ? c.redirect('/app') : c.redirect('/login')));
  app.get('/login', serveStatic({ root: dossierPublic, path: 'index.html' }));
  app.get('/app', serveStatic({ root: dossierPublic, path: 'index.html' }));
  app.use('/*', serveStatic({ root: dossierPublic }));

  return app;
}

const estPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (estPrincipal) {
  const manquants = verifierConfig();
  if (manquants.length) {
    console.error(`Configuration incomplète, variables manquantes : ${manquants.join(', ')} (voir .env.example)`);
    process.exit(1);
  }
  const serveurs = chargerServeursMcp();
  console.log(`[mcp] ${serveurs.length} serveur(s) : ${serveurs.map((s) => s.name).join(', ') || '—'}`);
  console.log(`[push] ${pushDisponible() ? 'activé' : 'désactivé (npm run vapid)'} · [transcription] ${transcriptionDisponible() ? 'activée' : 'désactivée'}`);
  demarrerPlanificateur();
  serve({ fetch: creerApplication({ serveurs }).fetch, port: config.port }, (info) => {
    console.log(`Assistant prêt sur http://localhost:${info.port}`);
  });
}
