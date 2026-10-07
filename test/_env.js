// Environnement de test : variables obligatoires + dossier de données temporaire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.ASSISTANT_PASSWORD = 'secret-de-test';
process.env.SESSION_SECRET = 'cle-de-test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-test-'));
process.env.MCP_CONFIG = path.join(process.env.DATA_DIR, 'absent.json');
