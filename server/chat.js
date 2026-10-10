// Un tour de conversation : appel Claude en streaming, outils MCP (côté Anthropic) + outils locaux (ici).
import { config } from './config.js';
import { parametresMcp, SERVEURS_PRIORITAIRES } from './mcp.js';
import { blocsPromptSysteme } from './prompt.js';
import { definitionsOutilsLocaux, nomsOutilsLocaux, executerOutilLocal, outilsLocauxDisponibles } from './tools.js';
import { listerComptes } from './google.js';
import { lireConsignes } from './consignes.js';
import { lireMemoire } from './memoire.js';
import { pushDisponible } from './push.js';
import { listerRappels } from './store.js';
import { compacterSiNecessaire } from './compaction.js';

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
 *   {type:'done', text} · {type:'error', message} · {type:'compaction', messages} (historique ancien résumé, n messages compactés)
 * `conversation.messages` est enrichi en place (message utilisateur, réponses, résultats d'outils).
 */
export async function* executerTour({ client, conversation, contenuUtilisateur, serveurs, nonConnectes = [], outilsLocaux = null, effort = config.effort, consigne = null }) {
  if (!outilsLocaux) outilsLocaux = await outilsLocauxDisponibles();
  const comptesGmail = (await listerComptes().catch(() => [])).map((c) => c.email);
  const consignes = await lireConsignes().catch(() => []);
  const memoire = await lireMemoire().catch(() => []);
  // Longue conversation : les messages anciens sont résumés avant d'ajouter le nouveau tour.
  const compactee = await compacterSiNecessaire({ client, conversation }).catch((e) => { console.warn('[compaction]', e.message); return false; });
  if (compactee) yield { type: 'compaction', messages: conversation.resumes.at(-1).messagesCompactes };
  conversation.messages.push({ role: 'user', content: contenuUtilisateur });

  // Latence : chaque serveur MCP attaché coûte une connexion côté API (plusieurs secondes pour sept serveurs).
  // Seuls les serveurs prioritaires (agenda, courrier) sont attachés d'emblée ; les autres le sont à la demande via
  // l'outil activer_serveur, et restent actifs pour toute la conversation (`conversation.serveursActifs`).
  const estPrioritaire = (s) => SERVEURS_PRIORITAIRES.test(`${s.name} ${s.description || ''}`);
  conversation.serveursActifs = Array.isArray(conversation.serveursActifs) ? conversation.serveursActifs : [];
  const serveursAttaches = () => serveurs.filter((s) => estPrioritaire(s) || conversation.serveursActifs.includes(s.name));
  const secondaires = serveurs.filter((s) => !estPrioritaire(s));
  const outilActiver = secondaires.length ? [{
    name: 'activer_serveur',
    description: `Active un serveur MCP secondaire pour cette conversation (ses outils deviennent appelables au tour suivant). Serveurs disponibles : ${secondaires.map((s) => `${s.name} (${s.description || 'sans description'})`).join(' ; ')}.`,
    input_schema: { type: 'object', properties: { serveur: { type: 'string', enum: secondaires.map((s) => s.name), description: 'Nom du serveur à activer' } }, required: ['serveur'] },
  }] : [];
  const rappelsActifs = (await listerRappels()).filter((r) => !r.livreLe).length;
  const system = blocsPromptSysteme(serveurs, { rappelsActifs, pushDisponible: pushDisponible(), nonConnectes, comptesGmail, consignes, memoire, serveursActifs: serveursAttaches().map((s) => s.name) });
  // Recherche d'outils en tête (jamais différée) : les outils différés sont chargés à la demande.
  const construireOutils = () => {
    const { mcp_servers, tools: toolsMcp } = parametresMcp(serveursAttaches());
    return { mcp_servers, tools: [
      { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
      ...outilsLocaux,
      ...outilActiver,
      ...toolsMcp,
      { type: 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } },
    ] };
  };
  let { mcp_servers, tools } = construireOutils();

  let texteFinal = '';
  const debutTour = Date.now();
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const debutIteration = Date.now(); let premierEvenement = 0;
    const stream = client.beta.messages.stream({
      model: config.model,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort },
      cache_control: { type: 'ephemeral' }, // cache automatique de la fin de conversation (le bloc système stable a son propre point)
      system,
      tools,
      ...(mcp_servers.length ? { mcp_servers } : {}),
      messages: consigne && iteration === 0 ? [...conversation.messages, { role: 'system', content: consigne }] : conversation.messages,
    });

    let texteIteration = '';
    for await (const event of stream) {
      if (!premierEvenement) premierEvenement = Date.now();
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
    // Chronométrage (journal) : latence avant le premier événement, durée de l'itération, outils appelés.
    console.log(`[chat] itération ${iteration + 1} : premier événement ${premierEvenement ? premierEvenement - debutIteration : '-'} ms, durée ${Date.now() - debutIteration} ms, arrêt ${reponse.stop_reason}, outils ${reponse.content.filter((b) => b.type === 'tool_use' || b.type === 'mcp_tool_use' || b.type === 'server_tool_use').map((b) => b.name).join(',') || '-'}, cache ${reponse.usage?.cache_read_input_tokens ?? 0}/${reponse.usage?.input_tokens ?? 0}`);
    if (!texteIteration) { const t = texteDe(reponse.content); if (t) { texteIteration = t; yield { type: 'text', text: t }; } } // sécurité : texte final sans delta streamé
    conversation.messages.push({ role: 'assistant', content: nettoyerPourHistorique(reponse.content) });
    texteFinal += texteIteration;

    if (reponse.stop_reason === 'tool_use') {
      const appels = reponse.content.filter((b) => b.type === 'tool_use');
      const resultats = [];
      for (const appel of appels) {
        if (appel.name === 'activer_serveur') {
          const nom = String(appel.input?.serveur || '');
          const existe = secondaires.some((s) => s.name === nom);
          if (existe && !conversation.serveursActifs.includes(nom)) conversation.serveursActifs.push(nom);
          ({ mcp_servers, tools } = construireOutils());
          const texte = existe ? `Serveur ${nom} activé : ses outils sont disponibles dès maintenant (cherche-les avec tool_search_tool_bm25 si besoin), appelle-les.` : `Serveur inconnu : ${nom}`;
          resultats.push({ type: 'tool_result', tool_use_id: appel.id, is_error: !existe, content: texte });
          yield { type: 'tool_result', name: appel.name, ok: existe, preview: texte };
          continue;
        }
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
  console.log(`[chat] tour terminé en ${Date.now() - debutTour} ms`);
  yield { type: 'done', text: texteFinal };
}
