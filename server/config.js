// Configuration lue depuis l'environnement, avec valeurs par défaut sûres.
import fs from 'node:fs';
import path from 'node:path';

function chargerDotenv() {
  const fichier = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(fichier)) return;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || ligne.trim().startsWith('#')) continue;
    const valeur = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = valeur;
  }
}
chargerDotenv();

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  password: env.ASSISTANT_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || '',
  model: env.CLAUDE_MODEL || 'claude-opus-5-5',
  effort: env.CLAUDE_EFFORT || 'medium',
  assistantName: env.ASSISTANT_NAME || 'Assistant',
  userName: env.USER_NAME || '',
  mcpConfigPath: path.resolve(env.MCP_CONFIG || './mcp.config.json'),
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:assistant@example.com',
  },
  transcribe: {
    url: env.TRANSCRIBE_URL || '',
    apiKey: env.TRANSCRIBE_API_KEY || '',
    model: env.TRANSCRIBE_MODEL || '',
  },
};

export function verifierConfig() {
  const manquants = [];
  if (!config.password) manquants.push('ASSISTANT_PASSWORD');
  if (!config.sessionSecret) manquants.push('SESSION_SECRET');
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) manquants.push('ANTHROPIC_API_KEY');
  return manquants;
}
