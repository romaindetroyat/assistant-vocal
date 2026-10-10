// Point d'entrée Cloudflare Workers : KV pour les données, assets statiques, cron pour les rappels, le point du matin
// et la consolidation hebdomadaire de la mémoire.
import Anthropic from '@anthropic-ai/sdk';
import { creerApplication } from './app.js';
import { serveursDepuisEnv } from './mcp.js';
import { utiliserBackend } from './store.js';
import { creerBackendKv } from './store-kv.js';
import { livrerRappelsDus, pointDuMatin } from './scheduler.js';
import { consolidationHebdo } from './memoire-consolidation.js';
import { fichiersInline, infosBuild } from './assets-inline.js';

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

const clientAnthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : undefined });

const app = creerApplication({
  client: clientAnthropic,
  serveurs,
  fichier: (_c, chemin) => servirInline(chemin),
  version: infosBuild,
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
    // Brief du matin : le cron passe le client Anthropic et les serveurs MCP (env + ajoutés, jetons OAuth résolus).
    ctx.waitUntil(Promise.all([
      livrerRappelsDus().catch((e) => console.warn('[rappels]', e.message)),
      pointDuMatin({ client: clientAnthropic, serveurs }).catch((e) => console.warn('[matin]', e.message)),
      env.ANTHROPIC_API_KEY ? consolidationHebdo({ client: clientAnthropic() }).catch((e) => console.warn('[mémoire]', e.message)) : Promise.resolve(false),
    ]));
  },
};
