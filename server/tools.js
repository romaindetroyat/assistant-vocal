// Outils locaux exécutés par ce serveur (en plus des serveurs MCP).
import { envoyerNotification, pushDisponible } from './push.js';
import { ajouterRappel, listerRappels, sauverRappels } from './store.js';
import { definitionsOutilsGmail, nomsOutilsGmail, executerOutilGmail } from './gmail.js';
import { listerComptes } from './google.js';
import { definitionOutilDev, executerOutilDev, devDisponible } from './dev.js';
import { definitionsOutilsBring, nomsOutilsBring, executerOutilBring, bringDisponible } from './bring.js';
import { definitionsOutilsConsignes, nomsOutilsConsignes, executerOutilConsignes } from './consignes.js';
import { definitionsOutilsMemoire, nomsOutilsMemoire, executerOutilMemoire } from './memoire.js';
import { definitionsOutilsTaches, nomsOutilsTaches, executerOutilTaches } from './taches.js';
import { definitionOutilBrief, executerOutilBrief } from './brief.js';

export const definitionsOutilsLocaux = [
  {
    name: 'notify_me',
    description: "Envoie immédiatement une notification push sur les appareils de l'utilisateur (téléphone et ordinateur).",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre court (≤ 60 caractères)' },
        body: { type: 'string', description: 'Texte de la notification (≤ 200 caractères)' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'schedule_reminder',
    description: "Programme un rappel livré par notification push à une date et heure précises (heure de Paris). Calcule d'abord la date absolue à partir de la date courante donnée dans le prompt système.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        when: { type: 'string', description: 'Date-heure ISO 8601 avec fuseau, ex. 2026-10-07T18:30:00+02:00' },
        title: { type: 'string', description: 'Titre du rappel' },
        body: { type: 'string', description: 'Texte du rappel' },
      },
      required: ['when', 'title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_reminders',
    description: 'Liste les rappels programmés non encore livrés.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'cancel_reminder',
    description: 'Annule un rappel programmé par son identifiant.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifiant renvoyé par schedule_reminder ou list_reminders' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

export const nomsOutilsLocaux = new Set([...definitionsOutilsLocaux.map((t) => t.name), ...nomsOutilsGmail, ...nomsOutilsBring, ...nomsOutilsConsignes, ...nomsOutilsMemoire, ...nomsOutilsTaches, definitionOutilBrief.name, definitionOutilDev.name]);

// L'API n'accepte que 20 outils « stricts » : on réserve le mode strict aux schémas complexes.
const STRICTS_PRIORITAIRES = new Set(['gmail_envoyer', 'gmail_repondre', 'tache_ajouter', 'courses_ajouter', 'schedule_reminder', 'memoire_noter']);
export const LIMITE_STRICTS = 20;
export function limiterStricts(outils) {
  let n = 0;
  return outils.map((t) => {
    const garder = t.strict && STRICTS_PRIORITAIRES.has(t.name) && n < LIMITE_STRICTS;
    if (garder) n++;
    return garder ? t : { ...t, strict: false };
  });
}

// Outils disponibles pour une requête : outils de base + Gmail si au moins un compte Google est connecté.
export async function outilsLocauxDisponibles() {
  const comptes = await listerComptes().catch(() => []);
  const bring = await bringDisponible().catch(() => false);
  return limiterStricts([...definitionsOutilsLocaux, ...definitionsOutilsConsignes, ...definitionsOutilsMemoire, ...definitionsOutilsTaches, definitionOutilBrief, ...(comptes.length ? definitionsOutilsGmail : []), ...(bring ? definitionsOutilsBring : []), ...(devDisponible() ? [definitionOutilDev] : [])]);
}

function texte(s, max) {
  return typeof s === 'string' ? s.trim().slice(0, max) : '';
}

export async function executerOutilLocal(nom, entree) {
  if (nomsOutilsGmail.has(nom)) return executerOutilGmail(nom, entree);
  if (nom === definitionOutilDev.name) return executerOutilDev(entree);
  if (nomsOutilsBring.has(nom)) return executerOutilBring(nom, entree);
  if (nomsOutilsConsignes.has(nom)) return executerOutilConsignes(nom, entree);
  if (nomsOutilsMemoire.has(nom)) return executerOutilMemoire(nom, entree);
  if (nomsOutilsTaches.has(nom)) return executerOutilTaches(nom, entree);
  if (nom === definitionOutilBrief.name) return executerOutilBrief();
  switch (nom) {
    case 'notify_me': {
      const titre = texte(entree.title, 60);
      const corps = texte(entree.body, 200);
      if (!titre || !corps) throw new Error('title et body sont obligatoires');
      const n = await envoyerNotification({ titre, corps });
      return n ? `Notification envoyée à ${n} appareil(s).` : 'Aucun appareil abonné aux notifications : demande à l\'utilisateur de les activer dans l\'application.';
    }
    case 'schedule_reminder': {
      const quand = new Date(entree.when);
      if (Number.isNaN(quand.getTime())) throw new Error(`Date invalide : ${entree.when}`);
      if (quand.getTime() < Date.now() - 60_000) throw new Error('La date est déjà passée');
      if (!pushDisponible()) throw new Error('Notifications push non configurées côté serveur');
      const rappel = await ajouterRappel({ quand: quand.toISOString(), titre: texte(entree.title, 60), corps: texte(entree.body, 200) });
      return `Rappel ${rappel.id} programmé pour ${quand.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.`;
    }
    case 'list_reminders': {
      const rappels = (await listerRappels()).filter((r) => !r.livreLe);
      if (!rappels.length) return 'Aucun rappel programmé.';
      return rappels
        .map((r) => `${r.id} — ${new Date(r.quand).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} — ${r.titre} : ${r.corps}`)
        .join('\n');
    }
    case 'cancel_reminder': {
      const rappels = await listerRappels();
      const restant = rappels.filter((r) => r.id !== entree.id);
      if (restant.length === rappels.length) throw new Error(`Rappel ${entree.id} introuvable`);
      await sauverRappels(restant);
      return `Rappel ${entree.id} annulé.`;
    }
    default:
      throw new Error(`Outil local inconnu : ${nom}`);
  }
}
