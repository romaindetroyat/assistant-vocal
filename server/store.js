// Façade de stockage : le point d'entrée choisit le backend (fichiers sur Node, KV sur Cloudflare).
let backend = null;

export function utiliserBackend(b) { backend = b; }
function b() {
  if (!backend) throw new Error('Aucun backend de stockage configuré (utiliserBackend)');
  return backend;
}

export const ID_CONVERSATION = /^[a-z0-9-]{8,64}$/;
export function nouvelleConversation() {
  const maintenant = new Date().toISOString();
  return { id: crypto.randomUUID(), titre: 'Nouvelle conversation', creeLe: maintenant, modifieLe: maintenant, messages: [] };
}
export function resumeDe(conv) {
  return { id: conv.id, titre: conv.titre, modifieLe: conv.modifieLe, nbMessages: conv.messages.length };
}

export const listerConversations = () => b().listerConversations();
export const creerConversation = () => b().creerConversation();
export const lireConversation = (id) => b().lireConversation(id);
export const sauverConversation = (conv) => b().sauverConversation(conv);
export const supprimerConversation = (id) => b().supprimerConversation(id);
export const listerAbonnements = () => b().listerAbonnements();
export const ajouterAbonnement = (abo) => b().ajouterAbonnement(abo);
export const retirerAbonnement = (endpoint) => b().retirerAbonnement(endpoint);
export const listerRappels = () => b().listerRappels();
export const sauverRappels = (rappels) => b().sauverRappels(rappels);

export async function ajouterRappel({ quand, titre, corps }) {
  const rappels = await listerRappels();
  const rappel = { id: crypto.randomUUID().slice(0, 8), quand, titre, corps, creeLe: new Date().toISOString() };
  rappels.push(rappel);
  await sauverRappels(rappels);
  return rappel;
}
