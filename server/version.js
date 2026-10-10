// Version de l'application et date du dernier déploiement (affichées en bas de « Mes outils »).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lit le champ "version" du package.json et l'horodatage de déploiement (DEPLOYED_AT, ISO 8601) s'il existe.
export function infosBuild({ racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), deployeLe = process.env.DEPLOYED_AT } = {}) {
  const { version } = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8'));
  return { version, deployeLe: deployeLe || null };
}

// « Version 1.4.2 · déployée le 10/10/2026 à 04:54 » (heure de Paris), ou « Version 1.4.2 · dev » sans date valide.
export function formaterVersion({ version, deployeLe } = {}) {
  const v = `Version ${version || '?'}`;
  const date = deployeLe ? new Date(deployeLe) : null;
  if (!date || Number.isNaN(date.getTime())) return `${v} · dev`;
  const parties = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value]));
  return `${v} · déployée le ${parties.day}/${parties.month}/${parties.year} à ${parties.hour}:${parties.minute}`;
}
