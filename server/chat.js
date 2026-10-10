// Un tour de conversation : appel Claude en streaming, outils MCP (côté Anthropic) + outils locaux (ici).
import { config } from './config.js';
import { parametresMcp } from './mcp.js';
import { construirePromptSysteme } from './prompt.js';
import { definitionsOutilsLocaux, nomsOutilsLocaux, executerOutilLocal, outilsLocauxDisponibles } from './tools.js';
import { listerComptes } from './google.js';
import { lireConsignes } from './consignes.js';
import { pushDisponible } from './push.js';
import { listerRappels } from './store.js';

const BETAS = ['mcp-client-2025-11-20', 'server-side-fallback-2026-07-01'];
const MAX_ITERATIONS = 12;

function apercu(valeur, max = 200) {
  const s = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function texteDe(contenu) {
  return contenu.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Blocs à rejouer dans l'historique : on retire les blocs purement informatifs.
function nettoyerPourHistorique(contenu) {
  return contenu.filter((b) => b.type !== 'fallback');
}

/**
 * Exécute un tour complet et émet des événements pour l'interface :
 *   {type:'text', text} · {type:'tool_use', name, server} · {type:'tool_result', name, ok, preview}
 *   {type:'done', text} · {type:'error', message}
 * `conversation.messages` est enrichi en place (message utilisateur, réponses, résultats d'outils).
 */
export async function* executerTour({ client, conversation, contenuUtilisateur, serveurs, nonConnectes = [], outilsLocaux = null, effort = config.effort, consigne = null }) {
  if (!outilsLocaux) outilsLocaux = await outilsLocauxDisponibles();
  const comptesGmail = (await listerComptes().catch(() => [])).map((c) => c.email);
  const consignes = await lireConsignes().catch(() => []);
  conversation.messages.push({ role: 'user', content: contenuUtilisateur });

  const { mcp_servers, tools: toolsMcp } = parametresMcp(serveurs);
  const rappelsActifs = (await listerRappels()).filter((r) => !r.livreLe).length;
  const system = [
    { type: 'text', text: construirePromptSysteme(serveurs, { rappelsActifs, pushDisponible: pushDisponible(), nonConnectes, comptesGmail, consignes }) },
  ];
  const tools = [
    ...outilsLocaux,
    ...toolsMcp,
    { type: 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } },
  ];

  let texteFinal = '';
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stream = client.beta.messages.stream({
      model: config.model,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system,
      tools,
      ...(mcp_servers.length ? { mcp_servers } : {}),
      messages: consigne && iteration === 0 ? [...conversation.messages, { role: 'system', content: consigne }] : conversation.messages,
    });

    let texteIteration = '';
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const bloc = event.content_block;
        if (bloc.type === 'tool_use') yield { type: 'tool_use', name: bloc.name, server: 'local' };
        else if (bloc.type === 'mcp_tool_use') yield { type: 'tool_use', name: bloc.name, server: bloc.server_name };
        else if (bloc.type === 'server_tool_use') yield { type: 'tool_use', name: bloc.name, server: 'anthropic' };
        else if (bloc.type === 'mcp_tool_result') yield { type: 'tool_result', name: '', ok: !bloc.is_error, preview: '' };
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        texteIteration += event.delta.text;
        yield { type: 'text', text: event.delta.text };
      }
    }

    const reponse = await stream.finalMessage();
    if (!texteIteration) { const t = texteDe(reponse.content); if (t) { texteIteration = t; yield { type: 'text', text: t }; } } // sécurité : texte final sans delta streamé
    conversation.messages.push({ role: 'assistant', content: nettoyerPourHistorique(reponse.content) });
    texteFinal += texteIteration;

    if (reponse.stop_reason === 'tool_use') {
      const appels = reponse.content.filter((b) => b.type === 'tool_use');
      const resultats = [];
      for (const appel of appels) {
        if (!nomsOutilsLocaux.has(appel.name)) {
          resultats.push({ type: 'tool_result', tool_use_id: appel.id, is_error: true, content: `Outil inconnu : ${appel.name}` });
          continue;
        }
        try {
          const resultat = await executerOutilLocal(appel.name, appel.input);
          resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: resultat });
          yield { type: 'tool_result', name: appel.name, ok: true, preview: apercu(resultat) };
        } catch (e) {
          resultats.push({ type: 'tool_result', tool_use_id: appel.id, is_error: true, content: e.message });
          yield { type: 'tool_result', name: appel.name, ok: false, preview: e.message };
        }
      }
      conversation.messages.push({ role: 'user', content: resultats });
      continue;
    }
    if (reponse.stop_reason === 'pause_turn') continue;
    if (reponse.stop_reason === 'refusal') {
      const message = "Je ne peux pas traiter cette demande.";
      if (!texteIteration) yield { type: 'text', text: message };
      texteFinal = texteFinal || message;
    }
    if (reponse.stop_reason === 'max_tokens') yield { type: 'error', message: 'Réponse tronquée (limite de longueur atteinte).' };
    break;
  }

  if (conversation.titre === 'Nouvelle conversation') {
    const premier = texteDe(Array.isArray(contenuUtilisateur) ? contenuUtilisateur : [{ type: 'text', text: String(contenuUtilisateur) }]);
    conversation.titre = (premier || 'Image').slice(0, 60);
  }
  yield { type: 'done', text: texteFinal };
}
