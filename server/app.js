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
import { resoudreServeurs, listerServeursAjoutes, ajouterServeur, retirerServeur } from './mcp.js';
import * as oauth from './oauth-mcp.js';
import { voixDisponible, modeleVoix, creerJetonEphemere, apercuVoix } from './voice.js';
import { lireReglages, modifierReglages, consigneConcision, VOIX, CONCISIONS } from './reglages.js';
import { CATALOGUE, parId } from './catalogue.js';

/**
 * @param client  client Anthropic (ou simulé)
 * @param serveurs serveurs MCP analysés, ou fonction () => serveurs (évaluée à chaque requête)
 * @param fichier (c, chemin) => Response : sert un fichier statique de public/
 */
export function creerApplication({ client, serveurs = [], fichier }) {
  const app = new Hono();
  const serveursEnv = () => (typeof serveurs === 'function' ? serveurs() : serveurs);
  // Serveurs déclarés par l'environnement + serveurs ajoutés dans l'application.
  const lesServeurs = async () => {
    const env = serveursEnv(); const noms = new Set(env.map((s) => s.name));
    return [...env, ...(await listerServeursAjoutes()).filter((s) => !noms.has(s.name)).map((s) => ({ ...s, source: 'app' }))];
  };
  const leClient = () => (typeof client === 'function' ? client() : client);

  app.post('/api/login', async (c) => {
    const { password } = await c.req.json().catch(() => ({}));
    if (!motDePasseValide(password)) { await new Promise((r) => setTimeout(r, 500)); return c.json({ erreur: 'Mot de passe incorrect' }, 401); }
    poserCookie(c);
    return c.json({ ok: true });
  });
  app.post('/api/logout', (c) => { retirerCookie(c); return c.json({ ok: true }); });
  app.use('/api/*', exigerSession);

  const etatServeurs = async () => Promise.all((await lesServeurs()).map(async (s) => ({ name: s.name, description: s.description, auth: s.auth || 'token', source: s.source || 'env', ...(s.auth === 'oauth' ? await oauth.etatConnexion(s.name) : { connecte: true }) })));

  app.get('/api/me', async (c) => c.json({
    assistantName: config.assistantName,
    model: config.model,
    serveurs: await etatServeurs(),
    push: pushDisponible(),
    vapidPublicKey: config.vapid.publicKey || null,
    transcription: transcriptionDisponible(),
    voix: voixDisponible() ? { modele: modeleVoix() } : null,
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
        const { prets, nonConnectes } = await resoudreServeurs(await lesServeurs(), (nom) => oauth.jetonPour(nom));
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

  // --- Mode conversation (GPT-Realtime en voix, Claude en cerveau) ---
  app.post('/api/voice/session', async (c) => {
    if (!voixDisponible()) return c.json({ erreur: 'Mode conversation non configuré (OPENAI_API_KEY)' }, 501);
    const corps = await c.req.json().catch(() => ({}));
    const conversation = corps.conversationId ? await store.lireConversation(corps.conversationId).catch(() => null) : await store.creerConversation();
    if (!conversation) return c.json({ erreur: 'Conversation introuvable' }, 404);
    if (!corps.conversationId) { conversation.titre = 'Conversation vocale'; await store.sauverConversation(conversation); }
    try { return c.json({ ...(await creerJetonEphemere()), conversationId: conversation.id }); }
    catch (e) { return c.json({ erreur: e.message }, 502); }
  });
  // Délégation : la voix transmet la demande, Claude répond avec ses outils, l'historique est partagé avec le mode texte.
  app.post('/api/voice/ask', async (c) => {
    const corps = await c.req.json().catch(() => null);
    const message = String(corps?.message || '').trim();
    if (!message) return c.json({ erreur: 'message requis' }, 400);
    const conversation = corps.conversationId ? await store.lireConversation(corps.conversationId).catch(() => null) : await store.creerConversation();
    if (!conversation) return c.json({ erreur: 'Conversation introuvable' }, 404);
    const outils = [];
    let texte = ''; let erreur = null;
    try {
      const { prets, nonConnectes } = await resoudreServeurs(await lesServeurs(), (nom) => oauth.jetonPour(nom));
      for await (const ev of executerTour({ client: leClient(), conversation, contenuUtilisateur: [{ type: 'text', text: message }], serveurs: prets, nonConnectes, effort: config.effortVoix, consigne: `Réponse destinée à être lue à voix haute. ${consigneConcision((await lireReglages()).concision)} Pas de mise en forme.` })) {
        if (ev.type === 'tool_use') outils.push(ev.name);
        else if (ev.type === 'done') texte = ev.text;
        else if (ev.type === 'error') erreur = ev.message;
      }
    } catch (e) {
      console.error('[voice/ask]', e);
      erreur = e instanceof Anthropic.APIError ? `Erreur API (${e.status})` : e.message;
    } finally {
      await store.sauverConversation(conversation);
    }
    return c.json({ text: texte || (erreur ? `Désolé, une erreur est survenue : ${erreur}` : "Je n'ai pas de réponse."), outils, conversationId: conversation.id });
  });

  // --- Réglages ---
  app.get('/api/reglages', async (c) => c.json({ ...(await lireReglages()), voixDisponibles: VOIX, concisions: Object.keys(CONCISIONS) }));
  app.put('/api/reglages', async (c) => {
    try { return c.json(await modifierReglages(await c.req.json().catch(() => ({})))); }
    catch (e) { return c.json({ erreur: e.message }, 400); }
  });

  app.get('/api/reglages/apercu/:voix', async (c) => {
    const voix = c.req.param('voix');
    if (!VOIX.includes(voix)) return c.json({ erreur: 'Voix inconnue' }, 404);
    if (!voixDisponible()) return c.json({ erreur: 'OPENAI_API_KEY manquante' }, 501);
    try {
      const octets = await apercuVoix(voix, store);
      return new Response(octets, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' } });
    } catch (e) { return c.json({ erreur: e.message }, 502); }
  });

  // --- Catalogue de serveurs MCP (connexion en un clic) ---
  app.get('/api/catalogue', async (c) => {
    const presents = new Set((await lesServeurs()).map((s) => s.name));
    return c.json(CATALOGUE.map(({ id, nom, categorie, description }) => ({ id, nom, categorie, description, ajoute: presents.has(id) })));
  });
  app.post('/api/mcp/catalogue/:id', async (c) => {
    const entree = parId(c.req.param('id'));
    if (!entree) return c.json({ erreur: 'Entrée de catalogue inconnue' }, 404);
    try {
      const presents = await lesServeurs();
      if (!presents.some((s) => s.name === entree.id)) await ajouterServeur({ name: entree.id, url: entree.url, description: entree.description, auth: 'oauth' }, serveursEnv());
      return c.json({ ok: true, name: entree.id }, 201);
    } catch (e) { return c.json({ erreur: e.message }, 400); }
  });

  app.post('/api/transcribe', async (c) => {
    const form = await c.req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File)) return c.json({ erreur: 'Fichier audio manquant' }, 400);
    try { return c.json({ text: await transcrire(f) }); }
    catch (e) { return c.json({ erreur: e.message }, e.status || 500); }
  });

  // --- Connexion OAuth aux serveurs MCP ---
  const serveurOauth = async (nom) => (await lesServeurs()).find((s) => s.name === nom && s.auth === 'oauth');
  app.get('/api/mcp', async (c) => c.json(await etatServeurs()));
  // Ajout depuis l'application : le mode (jeton ou OAuth) est détecté automatiquement.
  app.post('/api/mcp', async (c) => {
    const corps = await c.req.json().catch(() => ({}));
    try {
      let auth = corps.authorization_token ? 'token' : 'token';
      if (!corps.authorization_token) {
        try { await oauth.decouvrir(String(corps.url || '').trim()); auth = 'oauth'; } catch { auth = 'token'; }
      }
      const serveur = await ajouterServeur({ ...corps, auth }, serveursEnv());
      return c.json({ ok: true, name: serveur.name, auth: serveur.auth }, 201);
    } catch (e) { return c.json({ erreur: e.message }, 400); }
  });
  app.delete('/api/mcp/:nom/remove', async (c) => {
    const nom = c.req.param('nom');
    await oauth.deconnecter(nom).catch(() => {});
    return (await retirerServeur(nom)) ? c.json({ ok: true }) : c.json({ erreur: 'Ce serveur vient de la configuration, pas de l\'application' }, 400);
  });
  app.post('/api/mcp/:nom/connect', async (c) => {
    const s = await serveurOauth(c.req.param('nom'));
    if (!s) return c.json({ erreur: 'Serveur inconnu ou sans OAuth' }, 404);
    try {
      const redirectUri = new URL('/oauth/callback', c.req.url).toString();
      return c.json(await oauth.demarrerConnexion({ nom: s.name, urlMcp: s.url, redirectUri, nomClient: config.assistantName }));
    } catch (e) { return c.json({ erreur: e.message }, 502); }
  });
  app.post('/api/mcp/:nom/finish', async (c) => {
    const s = await serveurOauth(c.req.param('nom'));
    if (!s) return c.json({ erreur: 'Serveur inconnu ou sans OAuth' }, 404);
    const corps = await c.req.json().catch(() => ({}));
    const params = corps.code && corps.state ? { code: corps.code, state: corps.state } : oauth.extraireCodeEtState(corps.url || '');
    if (!params) return c.json({ erreur: "Adresse de retour sans code ni state" }, 400);
    try { await oauth.terminerConnexion({ nom: s.name, ...params }); return c.json({ ok: true }); }
    catch (e) { return c.json({ erreur: e.message }, 400); }
  });
  app.delete('/api/mcp/:nom', async (c) => {
    const s = await serveurOauth(c.req.param('nom'));
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
    for (const s of (await lesServeurs()).filter((x) => x.auth === 'oauth')) {
      try { await oauth.terminerConnexion({ nom: s.name, code, state }); return c.redirect(`/app?connecte=${encodeURIComponent(s.name)}`); }
      catch (e) { if (!/attente|state/.test(e.message)) return c.text(`Connexion refusée : ${e.message}`, 400); }
    }
    return c.text('Aucune connexion en attente ne correspond.', 400);
  });

  // Fichiers statiques (PWA)
  app.get('/', (c) => c.redirect(estConnecte(c) ? '/app' : '/login'));
  app.get('/login', (c) => fichier(c, '/index.html'));
  app.get('/app', (c) => fichier(c, '/index.html'));
  app.get('/connect/:nom', (c) => (estConnecte(c) ? fichier(c, '/connect.html') : c.redirect('/login')));
  app.get('/outils', (c) => (estConnecte(c) ? fichier(c, '/outils.html') : c.redirect('/login')));
  app.get('/sw.js', async (c) => { const r = await fichier(c, '/sw.js'); const h = new Headers(r.headers); h.set('Cache-Control', 'no-cache'); return new Response(r.body, { status: r.status, headers: h }); });
  app.get('/*', (c) => fichier(c, new URL(c.req.url).pathname));

  return app;
}
