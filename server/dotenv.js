// Chargement de .env (Node uniquement).
import fs from 'node:fs';
import path from 'node:path';

export function chargerDotenv(fichier = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(fichier)) return;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || ligne.trim().startsWith('#')) continue;
    const valeur = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = valeur;
  }
}
