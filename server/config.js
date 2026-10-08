// Configuration lue (paresseusement) depuis process.env : sur Node via .env, sur Cloudflare via les bindings.
const env = () => (typeof process !== 'undefined' && process.env) || {};

export const config = {
  get port() { return Number(env().PORT || 3000); },
  get dataDir() { return env().DATA_DIR || './data'; },
  get password() { return env().ASSISTANT_PASSWORD || ''; },
  get sessionSecret() { return env().SESSION_SECRET || ''; },
  get model() { return env().CLAUDE_MODEL || 'claude-opus-5-5'; },
  get effort() { return env().CLAUDE_EFFORT || 'medium'; },
  get effortVoix() { return env().CLAUDE_EFFORT_VOICE || 'low'; },
  get assistantName() { return env().ASSISTANT_NAME || 'Assistant'; },
  get userName() { return env().USER_NAME || ''; },
  get mcpConfigPath() { return env().MCP_CONFIG || './mcp.config.json'; },
  get mcpConfigJson() { return env().MCP_CONFIG_JSON || ''; },
  get vapid() {
    const e = env();
    return { publicKey: e.VAPID_PUBLIC_KEY || '', privateKey: e.VAPID_PRIVATE_KEY || '', subject: e.VAPID_SUBJECT || 'mailto:assistant@example.com' };
  },
  get transcribe() {
    const e = env();
    return { url: e.TRANSCRIBE_URL || '', apiKey: e.TRANSCRIBE_API_KEY || '', model: e.TRANSCRIBE_MODEL || '' };
  },
};

export function verifierConfig() {
  const manquants = [];
  if (!config.password) manquants.push('ASSISTANT_PASSWORD');
  if (!config.sessionSecret) manquants.push('SESSION_SECRET');
  if (!env().ANTHROPIC_API_KEY && !env().ANTHROPIC_AUTH_TOKEN) manquants.push('ANTHROPIC_API_KEY');
  return manquants;
}
