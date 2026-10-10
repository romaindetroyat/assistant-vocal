// Compaction des longues conversations : les messages anciens sont résumés par Claude et remplacés par un
// court échange, les derniers messages restent intacts. Les résumés sont conservés dans `conversation.resumes`.
import { enregistrerUsage } from './usage.js';
import { config } from './config.js';

const env = () => (typeof process !== 'undefined' && process.env) || {};
export const SEUIL_CARACTERES = 120_000;
const MESSAGES_CONSERVES = 6;
const APERCU_RESULTAT = 200;

export function seuilCompaction() { return Number(env().COMPACTION_SEUIL) || SEUIL_CARACTERES; }
export function tailleConversation(conversation) { return JSON.stringify(conversation.messages || []).length; }

function estUniquementResultats(message) {
  return message.role === 'user' && Array.isArray(message.content) && message.content.length > 0 && message.content.every((b) => b.type === 'tool_result');
}

// Index du premier message conservé : on garde au moins les N derniers, puis on recule jusqu'à un message
// utilisateur « vrai » (pas uniquement des tool_result) pour ne jamais séparer un tool_use de ses résultats.
export function indexCoupure(messages, conserves = MESSAGES_CONSERVES) {
  let i = Math.max(0, messages.length - conserves);
  while (i > 0 && !(messages[i].role === 'user' && !estUniquementResultats(messages[i]))) i--;
  return i;
}

function apercu(valeur) {
  const s = typeof valeur === 'string' ? valeur : JSON.stringify(valeur ?? '');
  return s.length > APERCU_RESULTAT ? `${s.slice(0, APERCU_RESULTAT)}…` : s;
}

// Transcription en texte simple des messages (texte, outils appelés, aperçu des résultats ; images et thinking ignorés).
export function messagesEnTexte(messages) {
  const lignes = [];
  for (const m of messages) {
    const blocs = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
    const parties = [];
    for (const b of blocs) {
      if (b.type === 'text' && b.text?.trim()) parties.push(b.text.trim());
      else if (b.type === 'tool_use' || b.type === 'mcp_tool_use' || b.type === 'server_tool_use') parties.push(`[appel de l'outil ${b.name}${b.input ? ` : ${apercu(b.input)}` : ''}]`);
      else if (b.type === 'tool_result' || b.type === 'mcp_tool_result') parties.push(`[résultat d'outil${b.is_error ? ' (erreur)' : ''} : ${apercu(b.content)}]`);
      else if (b.type === 'image') parties.push('[image]');
    }
    if (parties.length) lignes.push(`${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${parties.join(' ')}`);
  }
  return lignes.join('\n');
}

async function resumer(client, messages) {
  const texte = messagesEnTexte(messages);
  const reponse = await client.beta.messages.create({
    model: config.model,
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: "Tu résumes en français, pour un assistant personnel, le début d'une conversation qui va être compactée. Conserve : faits établis, décisions prises, demandes en cours ou non terminées, noms, dates et chiffres importants. Quinze lignes maximum, phrases courtes, pas d'introduction ni de conclusion.",
    messages: [{ role: 'user', content: `Voici la conversation à résumer :\n\n${texte}` }],
  });
  await enregistrerUsage(reponse.usage, 'compaction').catch(() => {});
  const resume = (reponse.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!resume) throw new Error('résumé vide');
  return resume;
}

/**
 * Compacte la conversation si elle dépasse le seuil. Retourne true si une compaction a eu lieu.
 * `conversation.messages` est modifié en place ; `conversation.resumes` reçoit { date, messagesCompactes, texte }.
 */
export async function compacterSiNecessaire({ client, conversation, seuil = seuilCompaction() }) {
  const messages = conversation.messages || [];
  if (tailleConversation(conversation) <= seuil) return false;
  const coupure = indexCoupure(messages);
  if (coupure <= 0) return false;
  const anciens = messages.slice(0, coupure);
  const texte = await resumer(client, anciens);
  conversation.messages = [
    { role: 'user', content: [{ type: 'text', text: `[Résumé de la conversation précédente]\n${texte}` }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Compris, je poursuis avec ce contexte.' }] },
    ...messages.slice(coupure),
  ];
  conversation.resumes = [...(conversation.resumes || []), { date: new Date().toISOString(), messagesCompactes: anciens.length, texte }];
  return true;
}
