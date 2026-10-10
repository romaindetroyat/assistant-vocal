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
import * as google from './google.js';
import * as as from './oauth-server.js';
import * as bring from './bring.js';
import { lireConsignes, remplacerConsignes } from './consignes.js';
import { lireMemoire, remplacerMemoire } from './memoire.js';
import * as taches from './taches.js';
import * as brief from './brief.js';
import { traiterRequeteJsonRpc, VERSION_PROTOCOLE } from './mcp-server.js';
import { formaterVersion } from './version.js';

/**
 * @param client  client Anthropic (ou simulé)
 * @param serveurs serveurs MCP analysés, ou fonction () => serveurs (évaluée à chaque requête)
 * @param fichier (c, chemin) => Response : sert un fichier statique de public/
 * @param version { version, deployeLe } : version du package.json et horodatage du déploiement (null en dev)
 */
export function creerApplication({ client, serveurs = [], fichier, version = {} }) {
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
  app.get('/api/version', (c) => c.json({ version: version.version || null, deployeLe: version.deployeLe || null, texte: formaterVersion(version) }));

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

  // --- Google (Gmail) : identifiants OAuth et comptes connectés ---
  app.get('/api/google', async (c) => {
    const cfg = await google.configGoogle();
    return c.json({ configure: Boolean(cfg.clientId && cfg.clientSecret), source: cfg.source, clientId: cfg.clientId ? `${cfg.clientId.slice(0, 12)}…` : null, redirectUri: new URL('/oauth/google/callback', c.req.url).toString(), comptes: (await google.listerComptes()).map((x) => ({ email: x.email, ajouteLe: x.ajouteLe })) });
  });
  app.put('/api/google/config', async (c) => {
    try { await google.enregistrerConfigGoogle(await c.req.json().catch(() => ({}))); return c.json({ ok: true }); }
    catch (e) { return c.json({ erreur: e.message }, 400); }
  });
  app.post('/api/google/connect', async (c) => {
    try { return c.json({ url: await google.demarrerConnexionGoogle(new URL('/oauth/google/callback', c.req.url).toString()) }); }
    catch (e) { return c.json({ erreur: e.message }, 400); }
  });
  app.get('/api/google/signatures', async (c) => c.json(await google.lireSignatures()));
  app.put('/api/google/signatures/:email', async (c) => {
    try { const { signature } = await c.req.json().catch(() => ({})); return c.json({ email: c.req.param('email'), signature: await google.definirSignature(c.req.param('email'), signature) }); }
    catch (e) { return c.json({ erreur: e.message }, 400); }
  });
  app.delete('/api/google/comptes/:email', async (c) => { await google.retirerCompte(c.req.param('email')); return c.json({ ok: true }); });

  // --- Bring! (listes de courses) ---
  app.get('/api/bring', async (c) => c.json(await bring.etatBring()));
  app.put('/api/bring', async (c) => {
    try { return c.json(await bring.connecterBring(await c.req.json().catch(() => ({})))); }
    catch (e) { return c.json({ erreur: e.message }, 400); }
  });
  app.delete('/api/bring', async (c) => { await bring.deconnecterBring(); return c.json({ ok: true }); });

  // --- Consignes personnelles ---
  app.get('/api/consignes', async (c) => c.json(await lireConsignes()));
  app.put('/api/consignes', async (c) => { const { textes } = await c.req.json().catch(() => ({})); return c.json(await remplacerConsignes(Array.isArray(textes) ? textes : [])); });

  // --- Mémoire de personnalisation ---
  app.get('/api/memoire', async (c) => c.json(await lireMemoire()));
  app.put('/api/memoire', async (c) => { const { entrees } = await c.req.json().catch(() => ({})); await remplacerMemoire(Array.isArray(entrees) ? entrees.filter((e) => e?.texte) : []); return c.json(await lireMemoire()); });

  // --- Tâches ---
  app.get('/api/taches', async (c) => c.json(await taches.listerTaches({ filtre: c.req.query('filtre') || 'a_faire', projet: c.req.query('projet') || '' })));
  app.post('/api/taches', async (c) => { try { return c.json(await taches.ajouterTache(await c.req.json().catch(() => ({}))), 201); } catch (e) { return c.json({ erreur: e.message }, 400); } });
  app.put('/api/taches/:id', async (c) => { try { return c.json(await taches.modifierTache(c.req.param('id'), await c.req.json().catch(() => ({})))); } catch (e) { return c.json({ erreur: e.message }, 400); } });
  app.delete('/api/taches/:id', async (c) => { try { await taches.supprimerTache(c.req.param('id')); return c.json({ ok: true }); } catch (e) { return c.json({ erreur: e.message }, 404); } });

  // --- Brief du matin : dernier brief enregistré, ou génération à la demande ---
  app.get('/api/brief', async (c) => c.json((await brief.lireDernierBrief()) || { jour: null, texte: null, genereLe: null }));
  app.post('/api/brief', async (c) => {
    try {
      const { prets, nonConnectes } = await resoudreServeurs(await lesServeurs(), (nom) => oauth.jetonPour(nom));
      const { texte } = await brief.genererBrief({ client: leClient(), serveurs: prets, nonConnectes });
      const enregistre = await brief.enregistrerBrief(texte);
      return c.json({ texte, jour: enregistre.jour, genereLe: enregistre.genereLe });
    } catch (e) { return c.json({ erreur: e.message }, 500); }
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

  // ======== L'assistant exposé en serveur MCP (claude.ai, Claude Code…) ========
  const origine = (c) => new URL(c.req.url).origin;
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(as.metadonnees(origine(c))));
  app.get('/.well-known/oauth-authorization-server/*', (c) => c.json(as.metadonnees(origine(c))));
  app.get('/.well-known/oauth-protected-resource', (c) => c.json(as.metadonneesRessource(origine(c))));
  app.get('/.well-known/oauth-protected-resource/*', (c) => c.json(as.metadonneesRessource(origine(c))));
  app.options('/.well-known/*', (c) => c.body(null, 204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }));
  app.post('/oauth/register', async (c) => {
    try { const client = await as.inscrireClient(await c.req.json().catch(() => ({}))); await as.indexerClient({ client_id: client.client_id, client_name: client.client_name }); return c.json(client, 201); }
    catch (e) { return c.json({ error: e.code || 'invalid_client_metadata', error_description: e.message }, 400); }
  });
  app.get('/oauth/authorize', async (c) => {
    const q = Object.fromEntries(new URL(c.req.url).searchParams);
    let client;
    try { client = await as.validerAutorisation(q); } catch (e) { return c.text(`Demande d'autorisation invalide : ${e.message}`, 400); }
    if (!estConnecte(c)) return c.redirect(`/login?next=${encodeURIComponent(new URL(c.req.url).pathname + new URL(c.req.url).search)}`);
    const champs = ['client_id', 'redirect_uri', 'code_challenge', 'state', 'scope'].map((k) => `<input type="hidden" name="${k}" value="${(q[k] || '').replace(/"/g, '&quot;')}">`).join('');
    const nom = client.client_name.replace(/[<>&]/g, '');
    return c.html(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Autoriser ${nom}</title><link rel="stylesheet" href="/styles.css"><style>body{overflow:auto}main{max-width:480px;margin:0 auto;padding:40px var(--gouttiere);display:flex;flex-direction:column;gap:14px}</style></head><body><main>
      <img src="/icons/icon.svg" alt="" width="56" height="56"><h1 style="margin:0">Autoriser « ${nom} » ?</h1>
      <p>Cette application pourra utiliser votre assistant : lire et envoyer vos e-mails, vous notifier, programmer des rappels et lui confier des demandes. Vous pourrez retirer cet accès à tout moment dans « Mes outils ».</p>
      <form method="post" action="/oauth/authorize">${champs}<button class="btn btn-primaire" name="decision" value="oui">Autoriser</button> <button class="btn btn-secondaire" name="decision" value="non">Refuser</button></form>
    </main></body></html>`);
  });
  app.post('/oauth/authorize', async (c) => {
    if (!estConnecte(c)) return c.redirect('/login');
    const f = Object.fromEntries((await c.req.formData()).entries());
    let client;
    try { client = await as.validerAutorisation({ ...f, response_type: 'code', code_challenge_method: 'S256' }); } catch (e) { return c.text(`Demande invalide : ${e.message}`, 400); }
    const retour = new URL(f.redirect_uri);
    if (f.state) retour.searchParams.set('state', f.state);
    if (f.decision !== 'oui') { retour.searchParams.set('error', 'access_denied'); return c.redirect(retour.toString()); }
    retour.searchParams.set('code', await as.emettreCode({ client_id: client.client_id, redirect_uri: f.redirect_uri, code_challenge: f.code_challenge, scope: f.scope }));
    return c.redirect(retour.toString());
  });
  app.post('/oauth/token', async (c) => {
    const type = c.req.header('content-type') || '';
    const params = type.includes('json') ? new URLSearchParams(await c.req.json().catch(() => ({}))) : new URLSearchParams(await c.req.text());
    try { return c.json(await as.echangerJeton(params, c.req.header('authorization')), 200, { 'Cache-Control': 'no-store' }); }
    catch (e) { return c.json({ error: e.code || 'invalid_request', error_description: e.message }, e.code === 'invalid_client' ? 401 : 400); }
  });
  app.post('/oauth/revoke', async (c) => { const p = new URLSearchParams(await c.req.text()); await as.revoquer(p.get('token')); return c.body(null, 200); });

  const nonAutorise = (c) => c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Non autorisé' } }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${origine(c)}/.well-known/oauth-protected-resource/mcp"` });
  app.options('/mcp', (c) => c.body(null, 204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' }));
  app.get('/mcp', async (c) => ((await as.verifierAcces(c.req.header('authorization'))) ? c.body(null, 405) : nonAutorise(c)));
  app.delete('/mcp', (c) => c.body(null, 204));
  app.post('/mcp', async (c) => {
    if (!(await as.verifierAcces(c.req.header('authorization')))) return nonAutorise(c);
    const corps = await c.req.json().catch(() => null);
    if (!corps) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }, 400);
    const contexte = { client: leClient, serveurs: lesServeurs };
    const messages = Array.isArray(corps) ? corps : [corps];
    const reponses = (await Promise.all(messages.map((m) => traiterRequeteJsonRpc(m, contexte)))).filter(Boolean);
    const entetes = { 'MCP-Protocol-Version': VERSION_PROTOCOLE };
    if (!reponses.length) return c.body(null, 202, entetes);
    return c.json(Array.isArray(corps) ? reponses : reponses[0], 200, entetes);
  });
  // Gestion des clients autorisés (depuis l'application)
  app.get('/api/mcp-serveur/clients', async (c) => c.json({ url: `${origine(c)}/mcp`, clients: await as.listerClients() }));
  app.delete('/api/mcp-serveur/clients/:id', async (c) => { await as.supprimerClient(c.req.param('id')); return c.json({ ok: true }); });

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

  app.get('/oauth/google/callback', async (c) => {
    if (!estConnecte(c)) return c.redirect('/login');
    const code = c.req.query('code'); const state = c.req.query('state');
    if (!code || !state) return c.text(`Connexion Google refusée : ${c.req.query('error') || 'code manquant'}`, 400);
    try { const email = await google.terminerConnexionGoogle({ code, state }); return c.redirect(`/outils?google=${encodeURIComponent(email)}`); }
    catch (e) { return c.text(`Connexion Google impossible : ${e.message}`, 400); }
  });

  // Fichiers statiques (PWA)
  app.get('/', (c) => c.redirect(estConnecte(c) ? '/app' : '/login'));
  app.get('/login', (c) => fichier(c, '/index.html'));
  app.get('/app', (c) => fichier(c, '/index.html'));
  app.get('/connect/:nom', (c) => (estConnecte(c) ? fichier(c, '/connect.html') : c.redirect('/login')));
  app.get('/outils', (c) => (estConnecte(c) ? fichier(c, '/outils.html') : c.redirect('/login')));
  app.get('/taches', (c) => (estConnecte(c) ? fichier(c, '/taches.html') : c.redirect('/login')));
  app.get('/sw.js', async (c) => { const r = await fichier(c, '/sw.js'); const h = new Headers(r.headers); h.set('Cache-Control', 'no-cache'); return new Response(r.body, { status: r.status, headers: h }); });
  app.get('/*', (c) => fichier(c, new URL(c.req.url).pathname));

  return app;
}
