// Serveur MCP (transport HTTP, JSON-RPC 2.0) exposant les outils de l'assistant à des clients externes (claude.ai…).
import { outilsLocauxDisponibles, executerOutilLocal, nomsOutilsLocaux } from './tools.js';
import { executerTour } from './chat.js';
import { resoudreServeurs } from './mcp.js';
import * as oauth from './oauth-mcp.js';
import * as store from './store.js';

export const VERSION_PROTOCOLE = '2025-06-18';

const OUTIL_DEMANDER = {
  name: 'demander_assistant',
  description: "Confie une demande complète à l'assistant personnel de Romain, qui l'exécute avec tous ses outils (agenda, e-mails, serveurs connectés, rappels, notifications, recherche web) et son historique, puis renvoie sa réponse en texte.",
  inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'La demande, en langage naturel' }, conversation_id: { type: 'string', description: "Identifiant d'une conversation existante pour poursuivre (optionnel)" } }, required: ['message'] },
};

export async function listerOutils() {
  const locaux = await outilsLocauxDisponibles();
  return [...locaux.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })), OUTIL_DEMANDER];
}

async function appelerOutil(nom, args, contexte) {
  if (nom === 'demander_assistant') {
    const message = String(args?.message || '').trim();
    if (!message) throw new Error('message requis');
    const conversation = args?.conversation_id ? await store.lireConversation(String(args.conversation_id)).catch(() => null) : await store.creerConversation();
    if (!conversation) throw new Error('Conversation introuvable');
    if (!args?.conversation_id) conversation.titre = `MCP : ${message.slice(0, 50)}`;
    const { prets, nonConnectes } = await resoudreServeurs(await contexte.serveurs(), (n) => oauth.jetonPour(n));
    let texte = ''; let erreur = null;
    try {
      for await (const ev of executerTour({ client: contexte.client(), conversation, contenuUtilisateur: [{ type: 'text', text: message }], serveurs: prets, nonConnectes })) {
        if (ev.type === 'done') texte = ev.text; else if (ev.type === 'error') erreur = ev.message;
      }
    } finally { await store.sauverConversation(conversation); }
    if (erreur && !texte) throw new Error(erreur);
    return `${texte}\n\n(conversation_id: ${conversation.id})`;
  }
  if (!nomsOutilsLocaux.has(nom)) throw new Error(`Outil inconnu : ${nom}`);
  return executerOutilLocal(nom, args || {});
}

const reponse = (id, result) => ({ jsonrpc: '2.0', id, result });
const erreur = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function traiterRequeteJsonRpc(msg, contexte) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return erreur(msg?.id, -32600, 'Requête invalide');
  const { id, method, params } = msg;
  const estNotification = id === undefined || id === null;
  try {
    switch (method) {
      case 'initialize':
        return reponse(id, { protocolVersion: VERSION_PROTOCOLE, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'assistant-vocal', version: '1.0.0' }, instructions: "Outils de l'assistant personnel de Romain : e-mails (Gmail), notifications et rappels sur ses appareils, et demander_assistant pour déléguer une demande complète." });
      case 'notifications/initialized': case 'notifications/cancelled': return null;
      case 'ping': return reponse(id, {});
      case 'tools/list': return reponse(id, { tools: await listerOutils() });
      case 'tools/call': {
        const nom = params?.name; const args = params?.arguments || {};
        try { const texte = await appelerOutil(nom, args, contexte); return reponse(id, { content: [{ type: 'text', text: String(texte) }], isError: false }); }
        catch (e) { return reponse(id, { content: [{ type: 'text', text: `Erreur : ${e.message}` }], isError: true }); }
      }
      default: return estNotification ? null : erreur(id, -32601, `Méthode inconnue : ${method}`);
    }
  } catch (e) { return erreur(id, -32603, e.message); }
}
