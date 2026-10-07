// Stockage simple en fichiers JSON (usage mono-utilisateur).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const dossiers = {
  conversations: () => path.join(config.dataDir, 'conversations'),
};
const fichiers = {
  abonnements: () => path.join(config.dataDir, 'push-subscriptions.json'),
  rappels: () => path.join(config.dataDir, 'reminders.json'),
};

async function lireJson(fichier, defaut) {
  try {
    return JSON.parse(await fs.readFile(fichier, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return defaut;
    throw e;
  }
}

async function ecrireJson(fichier, valeur) {
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(valeur, null, 2));
  await fs.rename(tmp, fichier);
}

// --- Conversations ---

function cheminConversation(id) {
  if (!/^[a-z0-9-]{8,64}$/.test(id)) throw new Error('Identifiant de conversation invalide');
  return path.join(dossiers.conversations(), `${id}.json`);
}

export async function listerConversations() {
  await fs.mkdir(dossiers.conversations(), { recursive: true });
  const noms = (await fs.readdir(dossiers.conversations())).filter((n) => n.endsWith('.json'));
  const resumes = await Promise.all(
    noms.map(async (nom) => {
      const conv = await lireJson(path.join(dossiers.conversations(), nom), null);
      if (!conv) return null;
      return { id: conv.id, titre: conv.titre, modifieLe: conv.modifieLe, nbMessages: conv.messages.length };
    }),
  );
  return resumes.filter(Boolean).sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
}

export async function creerConversation() {
  const conv = {
    id: crypto.randomUUID(),
    titre: 'Nouvelle conversation',
    creeLe: new Date().toISOString(),
    modifieLe: new Date().toISOString(),
    messages: [],
  };
  await ecrireJson(cheminConversation(conv.id), conv);
  return conv;
}

export async function lireConversation(id) {
  return lireJson(cheminConversation(id), null);
}

export async function sauverConversation(conv) {
  conv.modifieLe = new Date().toISOString();
  await ecrireJson(cheminConversation(conv.id), conv);
  return conv;
}

export async function supprimerConversation(id) {
  await fs.rm(cheminConversation(id), { force: true });
}

// --- Abonnements push ---

export async function listerAbonnements() {
  return lireJson(fichiers.abonnements(), []);
}

export async function ajouterAbonnement(abonnement) {
  const liste = await listerAbonnements();
  if (!liste.some((a) => a.endpoint === abonnement.endpoint)) {
    liste.push({ ...abonnement, ajouteLe: new Date().toISOString() });
    await ecrireJson(fichiers.abonnements(), liste);
  }
  return liste.length;
}

export async function retirerAbonnement(endpoint) {
  const liste = (await listerAbonnements()).filter((a) => a.endpoint !== endpoint);
  await ecrireJson(fichiers.abonnements(), liste);
}

// --- Rappels programmés ---

export async function listerRappels() {
  return lireJson(fichiers.rappels(), []);
}

export async function sauverRappels(rappels) {
  await ecrireJson(fichiers.rappels(), rappels);
}

export async function ajouterRappel({ quand, titre, corps }) {
  const rappels = await listerRappels();
  const rappel = { id: crypto.randomUUID().slice(0, 8), quand, titre, corps, creeLe: new Date().toISOString() };
  rappels.push(rappel);
  await sauverRappels(rappels);
  return rappel;
}
