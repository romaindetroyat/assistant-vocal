// Backend de stockage en fichiers JSON (Node).
import fs from 'node:fs/promises';
import path from 'node:path';
import { ID_CONVERSATION, nouvelleConversation, resumeDe } from './store.js';

async function lireJson(fichier, defaut) {
  try { return JSON.parse(await fs.readFile(fichier, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return defaut; throw e; }
}
async function ecrireJson(fichier, valeur) {
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(valeur, null, 2));
  await fs.rename(tmp, fichier);
}

export function creerBackendFs(dataDir) {
  const dossier = path.resolve(dataDir);
  const dossierConv = path.join(dossier, 'conversations');
  const fichierAbos = path.join(dossier, 'push-subscriptions.json');
  const fichierRappels = path.join(dossier, 'reminders.json');
  const fichierValeur = (cle) => {
    if (!/^[a-z0-9:_-]{1,80}$/.test(cle)) throw new Error('Clé invalide');
    return path.join(dossier, 'valeurs', `${cle.replace(/:/g, '__')}.json`);
  };
  const chemin = (id) => {
    if (!ID_CONVERSATION.test(id)) throw new Error('Identifiant de conversation invalide');
    return path.join(dossierConv, `${id}.json`);
  };
  return {
    async listerConversations() {
      await fs.mkdir(dossierConv, { recursive: true });
      const noms = (await fs.readdir(dossierConv)).filter((n) => n.endsWith('.json'));
      const resumes = await Promise.all(noms.map(async (n) => { const c = await lireJson(path.join(dossierConv, n), null); return c && resumeDe(c); }));
      return resumes.filter(Boolean).sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
    },
    async creerConversation() { const c = nouvelleConversation(); await ecrireJson(chemin(c.id), c); return c; },
    lireConversation: (id) => lireJson(chemin(id), null),
    async sauverConversation(c) { c.modifieLe = new Date().toISOString(); await ecrireJson(chemin(c.id), c); return c; },
    supprimerConversation: (id) => fs.rm(chemin(id), { force: true }),
    listerAbonnements: () => lireJson(fichierAbos, []),
    async ajouterAbonnement(abo) {
      const liste = await lireJson(fichierAbos, []);
      if (!liste.some((a) => a.endpoint === abo.endpoint)) { liste.push({ ...abo, ajouteLe: new Date().toISOString() }); await ecrireJson(fichierAbos, liste); }
      return liste.length;
    },
    async retirerAbonnement(endpoint) { await ecrireJson(fichierAbos, (await lireJson(fichierAbos, [])).filter((a) => a.endpoint !== endpoint)); },
    listerRappels: () => lireJson(fichierRappels, []),
    sauverRappels: (r) => ecrireJson(fichierRappels, r),
    lireValeur: (cle) => lireJson(fichierValeur(cle), null),
    ecrireValeur: (cle, v) => ecrireJson(fichierValeur(cle), v),
    supprimerValeur: (cle) => fs.rm(fichierValeur(cle), { force: true }),
  };
}
