// Outil de développement : l'assistant ouvre une issue GitHub mentionnant @claude ; Claude Code (GitHub Actions)
// implémente la demande et ouvre une pull request ; la fusion sur main déploie automatiquement.
const env = () => (typeof process !== 'undefined' && process.env) || {};
export const devDisponible = () => Boolean(env().GITHUB_TOKEN);
const depot = () => env().GITHUB_REPO || 'romaindetroyat/assistant-vocal';

export const definitionOutilDev = {
  name: 'demander_developpement',
  description: "Demande une évolution ou une correction de l'assistant lui-même (cette application). Ouvre une issue GitHub que Claude Code implémente automatiquement, puis une pull request à valider. À utiliser quand l'utilisateur veut ajouter une fonctionnalité, changer un comportement ou corriger un bug de l'assistant.",
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      titre: { type: 'string', description: 'Titre court de la demande' },
      description: { type: 'string', description: "Description précise : comportement attendu, où dans l'application, cas limites. Reformule fidèlement ce que l'utilisateur a demandé." },
    },
    required: ['titre', 'description'],
    additionalProperties: false,
  },
};

export async function executerOutilDev(e, fetchImpl = fetch) {
  if (!devDisponible()) throw new Error('Développement non configuré (secret GITHUB_TOKEN manquant)');
  const titre = String(e.titre || '').trim().slice(0, 120);
  const description = String(e.description || '').trim().slice(0, 6000);
  if (!titre || !description) throw new Error('titre et description obligatoires');
  const corps = `@claude Merci d'implémenter cette demande, avec les tests correspondants (npm test doit rester vert), puis d'ouvrir une pull request.\n\n## Demande\n\n${description}\n\n_Demande transmise par l'assistant vocal._`;
  const r = await fetchImpl(`https://api.github.com/repos/${depot()}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env().GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'assistant-vocal' },
    body: JSON.stringify({ title: titre, body: corps, labels: ['assistant'] }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.message || `GitHub : HTTP ${r.status}`);
  return `Demande enregistrée : issue #${json.number} (${json.html_url}). Claude Code va l'implémenter et ouvrir une pull request ; l'utilisateur recevra une notification GitHub et devra valider la fusion.`;
}
