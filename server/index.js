// Point d'entrée Node : .env, stockage en fichiers, fichiers statiques locaux, planificateur de rappels.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { chargerDotenv } from './dotenv.js';
chargerDotenv();
import { config, verifierConfig } from './config.js';
import { creerApplication } from './app.js';
import { analyserConfigMcp, serveursDepuisEnv } from './mcp.js';
import { pushDisponible } from './push.js';
import { transcriptionDisponible } from './transcribe.js';
import { demarrerPlanificateur } from './scheduler.js';
import { utiliserBackend } from './store.js';
import { creerBackendFs } from './store-fs.js';
import { infosBuild } from './version.js';

const ici = path.dirname(fileURLToPath(import.meta.url));
const dossierPublic = path.relative(process.cwd(), path.join(ici, '..', 'public')) || '.';
const statique = new Hono().use('/*', serveStatic({ root: dossierPublic }));

export function chargerServeursMcp() {
  const depuisEnv = serveursDepuisEnv();
  if (depuisEnv) return depuisEnv;
  const chemin = path.resolve(config.mcpConfigPath);
  if (!fs.existsSync(chemin)) { console.warn(`[mcp] ${chemin} absent : aucun serveur MCP (copiez mcp.config.example.json)`); return []; }
  return analyserConfigMcp(fs.readFileSync(chemin, 'utf8'));
}

const clientAnthropic = () => new Anthropic({ defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : undefined });

export function creerApplicationNode({ client = clientAnthropic(), serveurs = chargerServeursMcp() } = {}) {
  utiliserBackend(creerBackendFs(config.dataDir));
  return creerApplication({ client, serveurs, fichier: (c, chemin) => statique.fetch(new Request(new URL(chemin, c.req.url))), version: infosBuild() });
}

const estPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (estPrincipal) {
  const manquants = verifierConfig();
  if (manquants.length) { console.error(`Configuration incomplète, variables manquantes : ${manquants.join(', ')} (voir .env.example)`); process.exit(1); }
  const serveurs = chargerServeursMcp();
  console.log(`[mcp] ${serveurs.length} serveur(s) : ${serveurs.map((s) => s.name).join(', ') || '—'}`);
  console.log(`[push] ${pushDisponible() ? 'activé' : 'désactivé (npm run vapid)'} · [transcription] ${transcriptionDisponible() ? 'activée' : 'désactivée'}`);
  const client = clientAnthropic();
  demarrerPlanificateur(20_000, { client });
  serve({ fetch: creerApplicationNode({ client, serveurs }).fetch, port: config.port }, (info) => console.log(`Assistant prêt sur http://localhost:${info.port}`));
}
