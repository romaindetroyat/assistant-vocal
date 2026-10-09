// Outils Gmail (API Gmail directe) : chercher, lire, répondre, envoyer, brouillons.
import { jetonAcces, resoudreCompte, listerComptes } from './google.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const texte = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

export const definitionsOutilsGmail = [
  { name: 'gmail_comptes', description: 'Liste les comptes Gmail connectés (adresses).', strict: true, input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  { name: 'gmail_rechercher', description: "Recherche des e-mails (syntaxe de recherche Gmail : from:, to:, subject:, newer_than:2d, is:unread, has:attachment, label:…). Renvoie pour chaque message : id, date, expéditeur, objet, extrait.", strict: true,
    input_schema: { type: 'object', properties: { compte: { type: 'string', description: "Adresse ou mot-clé du compte (ex. perso, altapyx). Vide si un seul compte." }, requete: { type: 'string', description: 'Requête Gmail, ex. "from:kevin newer_than:7d"' }, max: { type: 'integer', description: 'Nombre maximum de résultats (défaut 10, max 25)' } }, required: ['compte', 'requete', 'max'], additionalProperties: false } },
  { name: 'gmail_lire', description: "Lit un e-mail complet (en-têtes et texte) à partir de son id.", strict: true,
    input_schema: { type: 'object', properties: { compte: { type: 'string', description: 'Adresse ou mot-clé du compte' }, id: { type: 'string', description: 'Identifiant du message (de gmail_rechercher)' } }, required: ['compte', 'id'], additionalProperties: false } },
  { name: 'gmail_envoyer', description: "Envoie un nouvel e-mail. À utiliser seulement quand destinataire, objet et contenu sont clairs.", strict: true,
    input_schema: { type: 'object', properties: { compte: { type: 'string', description: "Compte expéditeur (adresse ou mot-clé)" }, a: { type: 'string', description: 'Destinataire(s), séparés par des virgules' }, cc: { type: 'string', description: 'Copie (optionnel, chaîne vide sinon)' }, objet: { type: 'string' }, corps: { type: 'string', description: 'Texte du message (texte brut)' } }, required: ['compte', 'a', 'cc', 'objet', 'corps'], additionalProperties: false } },
  { name: 'gmail_repondre', description: "Répond à un e-mail existant (dans le même fil, à l'expéditeur).", strict: true,
    input_schema: { type: 'object', properties: { compte: { type: 'string' }, id: { type: 'string', description: 'Identifiant du message auquel répondre' }, corps: { type: 'string', description: 'Texte de la réponse' }, repondre_a_tous: { type: 'boolean' } }, required: ['compte', 'id', 'corps', 'repondre_a_tous'], additionalProperties: false } },
  { name: 'gmail_brouillon', description: "Crée un brouillon (non envoyé) que l'utilisateur relira dans Gmail.", strict: true,
    input_schema: { type: 'object', properties: { compte: { type: 'string' }, a: { type: 'string' }, objet: { type: 'string' }, corps: { type: 'string' } }, required: ['compte', 'a', 'objet', 'corps'], additionalProperties: false } },
];
export const nomsOutilsGmail = new Set(definitionsOutilsGmail.map((t) => t.name));

async function gmail(email, chemin, { method = 'GET', body, query } = {}, fetchImpl) {
  const jeton = await jetonAcces(email, fetchImpl);
  const u = new URL(`${API}/${chemin}`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const r = await fetchImpl(u, { method, headers: { Authorization: `Bearer ${jeton}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error?.message || `Gmail : HTTP ${r.status}`);
  return json;
}

const entete = (msg, nom) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === nom.toLowerCase())?.value || '';
const b64urlDecode = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))); };
const htmlVersTexte = (h) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

function extraireTexte(partie) {
  if (!partie) return '';
  if (partie.mimeType === 'text/plain' && partie.body?.data) return b64urlDecode(partie.body.data);
  if (partie.parts) { for (const p of partie.parts) { const t = extraireTexte(p); if (t) return t; } }
  if (partie.mimeType === 'text/html' && partie.body?.data) return htmlVersTexte(b64urlDecode(partie.body.data));
  return '';
}

const encoderObjet = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`);
function construireMime({ de, a, cc, objet, corps, enReponseA, references }) {
  const lignes = [`From: ${de}`, `To: ${a}`];
  if (cc) lignes.push(`Cc: ${cc}`);
  lignes.push(`Subject: ${encoderObjet(objet)}`);
  if (enReponseA) { lignes.push(`In-Reply-To: ${enReponseA}`); lignes.push(`References: ${references || enReponseA}`); }
  lignes.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', btoa(unescape(encodeURIComponent(corps))));
  const brut = lignes.join('\r\n');
  return btoa(unescape(encodeURIComponent(brut))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function executerOutilGmail(nom, e, fetchImpl = fetch) {
  switch (nom) {
    case 'gmail_comptes': { const c = await listerComptes(); return c.length ? c.map((x) => x.email).join(', ') : 'Aucun compte Google connecté.'; }
    case 'gmail_rechercher': {
      const email = await resoudreCompte(e.compte);
      const max = Math.min(Math.max(Number(e.max) || 10, 1), 25);
      const liste = await gmail(email, 'messages', { query: { q: texte(e.requete, 500), maxResults: String(max) } }, fetchImpl);
      if (!liste.messages?.length) return `Aucun message pour « ${e.requete} » sur ${email}.`;
      const details = await Promise.all(liste.messages.map((m) => gmail(email, `messages/${m.id}`, { query: { format: 'metadata' } }, fetchImpl)));
      return `Compte ${email} :\n` + details.map((m) => `- id ${m.id} · ${entete(m, 'Date')} · de ${entete(m, 'From')} · objet « ${entete(m, 'Subject')} » · ${m.snippet || ''}`).join('\n');
    }
    case 'gmail_lire': {
      const email = await resoudreCompte(e.compte);
      const m = await gmail(email, `messages/${texte(e.id, 64)}`, { query: { format: 'full' } }, fetchImpl);
      const corps = extraireTexte(m.payload).slice(0, 12000);
      return `De : ${entete(m, 'From')}\nÀ : ${entete(m, 'To')}\nDate : ${entete(m, 'Date')}\nObjet : ${entete(m, 'Subject')}\n\n${corps || '(message sans texte lisible)'}`;
    }
    case 'gmail_envoyer': {
      const email = await resoudreCompte(e.compte);
      if (!texte(e.a, 500) || !texte(e.objet, 300)) throw new Error('Destinataire et objet obligatoires');
      const raw = construireMime({ de: email, a: texte(e.a, 500), cc: texte(e.cc, 500), objet: texte(e.objet, 300), corps: String(e.corps || '') });
      const r = await gmail(email, 'messages/send', { method: 'POST', body: { raw } }, fetchImpl);
      return `E-mail envoyé depuis ${email} à ${e.a} (id ${r.id}).`;
    }
    case 'gmail_repondre': {
      const email = await resoudreCompte(e.compte);
      const orig = await gmail(email, `messages/${texte(e.id, 64)}`, { query: { format: 'metadata' } }, fetchImpl);
      const a = entete(orig, 'Reply-To') || entete(orig, 'From');
      const cc = e.repondre_a_tous ? [entete(orig, 'To'), entete(orig, 'Cc')].filter(Boolean).join(', ') : '';
      const objetOrig = entete(orig, 'Subject');
      const raw = construireMime({ de: email, a, cc, objet: /^re\s*:/i.test(objetOrig) ? objetOrig : `Re: ${objetOrig}`, corps: String(e.corps || ''), enReponseA: entete(orig, 'Message-ID') || entete(orig, 'Message-Id'), references: entete(orig, 'References') });
      const r = await gmail(email, 'messages/send', { method: 'POST', body: { raw, threadId: orig.threadId } }, fetchImpl);
      return `Réponse envoyée à ${a} depuis ${email} (id ${r.id}).`;
    }
    case 'gmail_brouillon': {
      const email = await resoudreCompte(e.compte);
      const raw = construireMime({ de: email, a: texte(e.a, 500), objet: texte(e.objet, 300), corps: String(e.corps || '') });
      const r = await gmail(email, 'drafts', { method: 'POST', body: { message: { raw } } }, fetchImpl);
      return `Brouillon créé dans ${email} (id ${r.id}). L'utilisateur peut le relire et l'envoyer depuis Gmail.`;
    }
    default: throw new Error(`Outil Gmail inconnu : ${nom}`);
  }
}
