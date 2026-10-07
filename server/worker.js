// Point d'entrée Cloudflare Workers : KV pour les données, assets statiques, cron pour les rappels.
import Anthropic from '@anthropic-ai/sdk';
import { creerApplication } from './app.js';
import { serveursDepuisEnv } from './mcp.js';
import { utiliserBackend } from './store.js';
import { creerBackendKv } from './store-kv.js';
import { livrerRappelsDus } from './scheduler.js';
import { fichiersInline } from './assets-inline.js';

function preparer(env) {
  // Les variables et secrets du Worker alimentent process.env (lu par config.js).
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;
  utiliserBackend(creerBackendKv(env.DATA));
}

let serveursCache = null;
function serveurs() {
  if (serveursCache) return serveursCache;
  try { serveursCache = serveursDepuisEnv() || []; }
  catch (e) { console.error('[mcp]', e.message); serveursCache = []; }
  return serveursCache;
}

// Fichiers statiques embarqués dans le bundle (évite l'étape d'envoi d'assets).
const cacheBinaire = new Map();
function servirInline(chemin) {
  const f = fichiersInline[chemin];
  if (!f) return new Response('Introuvable', { status: 404 });
  if (!cacheBinaire.has(chemin)) cacheBinaire.set(chemin, Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0)));
  const immuable = /\.(png|svg)$/.test(chemin);
  return new Response(cacheBinaire.get(chemin), { headers: { 'Content-Type': f.type, 'Cache-Control': immuable ? 'public, max-age=86400' : 'public, max-age=300' } });
}

const app = creerApplication({
  client: () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : undefined }),
  serveurs,
  fichier: (_c, chemin) => servirInline(chemin),
});

export default {
  fetch(request, env, ctx) {
    preparer(env);
    if (!env.ASSISTANT_PASSWORD || !env.SESSION_SECRET || !env.ANTHROPIC_API_KEY) {
      return new Response('Configuration incomplète : définissez les secrets ASSISTANT_PASSWORD, SESSION_SECRET et ANTHROPIC_API_KEY (wrangler secret put …).', { status: 503 });
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event, env, ctx) {
    preparer(env);
    ctx.waitUntil(livrerRappelsDus().catch((e) => console.warn('[rappels]', e.message)));
  },
};
