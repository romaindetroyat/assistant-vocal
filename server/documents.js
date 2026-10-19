// Coffre de documents (perso et pro) : le fichier est chiffré (AES-256-GCM) avant stockage, Claude en extrait une
// fiche structurée validée par l'utilisateur, l'assistant répond depuis les fiches. Les champs sensibles (numéros
// d'identité, IBAN, codes) sont chiffrés eux aussi et ne sont lus qu'avec une confirmation explicite.
import { config } from './config.js';
import { MODELES } from './reglages.js';
import { lireValeur, ecrireValeur, supprimerValeur } from './store.js';
import { ecrireBlob, lireBlob, supprimerBlob } from './blobs.js';
import { chiffrerBlob, dechiffrerBlob, chiffrerTexte, dechiffrerTexte, versBase64 } from './chiffrement.js';
import { enregistrerUsage } from './usage.js';

export const TYPES_FICHIER = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const TAILLE_MAX = 20 * 1024 * 1024;
export const TYPES_DOC = ['identite', 'vehicule', 'banque', 'assurance', 'sante', 'logement', 'contrat', 'facture', 'client', 'autre'];
export const ESPACES = ['perso', 'pro'];
const CLE_INDEX = 'docs:index';
const cleDoc = (id) => `doc:${id}`;
const MASQUE = '(sensible : demande ma confirmation orale explicite pour le lire)';
const erreur = (message, status = 400) => Object.assign(new Error(message), { status });

const texteBorne = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const dateIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const normaliser = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function validerFichier({ type, taille, nom = '' }) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (/heic|heif/.test(t) || /\.hei[cf]$/i.test(nom)) throw erreur("Format HEIC non pris en charge : convertissez la photo en JPEG avant l'envoi.", 415);
  if (!TYPES_FICHIER.has(t)) throw erreur(`Type de fichier non pris en charge : ${t || 'inconnu'} (JPEG, PNG, WebP ou PDF attendu)`, 415);
  if (taille > TAILLE_MAX) throw erreur('Fichier trop volumineux (20 Mo maximum)', 413);
  return t;
}

// ---------- Extraction de la fiche par Claude ----------
const CONSIGNE_EXTRACTION = `Tu extrais une fiche structurée d'un document personnel ou professionnel (pièce d'identité, permis, carte grise, RIB, attestation, contrat, facture, dossier client…).
Réponds UNIQUEMENT par un objet JSON, sans texte autour, de la forme :
{"titre": "titre court et explicite (ex. Permis de conduire de Romain)", "type": "${TYPES_DOC.join('|')}", "espace": "perso|pro", "personne": "titulaire ou client concerné", "organisme": "émetteur", "dateDocument": "AAAA-MM-JJ ou null", "dateExpiration": "AAAA-MM-JJ ou null", "champs": [{"nom": "Numéro de permis", "valeur": "…", "sensible": true}], "resume": "trois phrases maximum", "motsCles": ["…"]}
Règles : champs utiles seulement (numéros, dates, catégories, montants, adresses, références), 40 au maximum ; "sensible": true pour les numéros d'identité, de permis, de sécurité sociale, de passeport, IBAN, BIC, numéros de carte, codes et mots de passe ; dates au format AAAA-MM-JJ ; n'invente rien, laisse null ou omets ce qui est illisible ; espace "pro" pour un document lié à un client ou à l'activité professionnelle.`;

function parserJson(texte) {
  const t = String(texte || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const debut = t.indexOf('{'); const fin = t.lastIndexOf('}');
  if (debut < 0 || fin <= debut) throw new Error('JSON absent');
  return JSON.parse(t.slice(debut, fin + 1));
}

export function validerFiche(brut, { nom = 'Document', espace = null } = {}) {
  if (!brut || typeof brut !== 'object') throw new Error('Fiche invalide');
  const champs = (Array.isArray(brut.champs) ? brut.champs : []).slice(0, 40)
    .map((c) => ({ nom: texteBorne(c?.nom, 80), valeur: texteBorne(c?.valeur), sensible: Boolean(c?.sensible) }))
    .filter((c) => c.nom && c.valeur);
  return {
    titre: texteBorne(brut.titre, 120) || nom,
    type: TYPES_DOC.includes(brut.type) ? brut.type : 'autre',
    espace: ESPACES.includes(espace) ? espace : (ESPACES.includes(brut.espace) ? brut.espace : 'perso'),
    personne: texteBorne(brut.personne, 120),
    organisme: texteBorne(brut.organisme, 120),
    dateDocument: dateIso(brut.dateDocument),
    dateExpiration: dateIso(brut.dateExpiration),
    champs,
    resume: texteBorne(brut.resume, 600),
    motsCles: (Array.isArray(brut.motsCles) ? brut.motsCles : []).map((m) => texteBorne(m, 40)).filter(Boolean).slice(0, 15),
  };
}

export async function extraireFiche({ client, base64, type, nom, espace }) {
  const bloc = type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: type, data: base64 } };
  try {
    const reponse = await client.beta.messages.create({
      model: MODELES.sonnet.id, max_tokens: 4000, // extraction : Sonnet suffit (2 × moins cher qu'Opus)
      thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
      system: CONSIGNE_EXTRACTION,
      messages: [{ role: 'user', content: [bloc, { type: 'text', text: `Extrais la fiche de ce document (fichier « ${nom} »).` }] }],
    });
    await enregistrerUsage(reponse.usage, 'documents', new Date(), 'sonnet').catch(() => {});
    if (reponse.stop_reason === 'refusal') throw new Error('Extraction refusée');
    const texte = (reponse.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { fiche: validerFiche(parserJson(texte), { nom, espace }), extraite: true };
  } catch (e) {
    console.warn('[documents] extraction impossible :', e.message);
    return { fiche: validerFiche({ titre: nom }, { nom, espace }), extraite: false };
  }
}

// ---------- Index et fiches ----------
const lireIndex = async () => (await lireValeur(CLE_INDEX)) || [];
const entreeIndex = (d) => ({ id: d.id, espace: d.espace, titre: d.titre, type: d.type, personne: d.personne, organisme: d.organisme, dateExpiration: d.dateExpiration, valideLe: d.valideLe, motsCles: d.motsCles, nomsChamps: d.champs.map((c) => c.nom), resume: d.resume, creeLe: d.creeLe });
async function enregistrer(doc) {
  await ecrireValeur(cleDoc(doc.id), doc);
  const index = (await lireIndex()).filter((e) => e.id !== doc.id);
  index.unshift(entreeIndex(doc));
  await ecrireValeur(CLE_INDEX, index);
}
const chiffrerChamps = (champs) => Promise.all(champs.map(async (c) => (c.sensible ? { nom: c.nom, valeur: await chiffrerTexte(c.valeur), sensible: true, chiffre: true } : { nom: c.nom, valeur: c.valeur, sensible: false })));

export async function ajouterDocument({ client, octets, type, nom = 'document', espace = null }) {
  const t = validerFichier({ type, taille: octets.length, nom });
  const id = globalThis.crypto.randomUUID();
  const { fiche, extraite } = await extraireFiche({ client, base64: versBase64(octets), type: t, nom, espace });
  await ecrireBlob(id, await chiffrerBlob(octets), t);
  const doc = { id, ...fiche, champs: await chiffrerChamps(fiche.champs), fichier: { type: t, taille: octets.length, nom: texteBorne(nom, 120) }, creeLe: new Date().toISOString(), valideLe: null, extraite };
  await enregistrer(doc);
  return vueDocument(doc, { reveler: false });
}

// Vue d'une fiche : valeurs sensibles déchiffrées seulement si `reveler`.
async function vueDocument(doc, { reveler = false } = {}) {
  const champs = await Promise.all(doc.champs.map(async (c) => ({ nom: c.nom, sensible: c.sensible, valeur: !c.sensible ? c.valeur : reveler ? await dechiffrerTexte(c.valeur).catch(() => '(illisible)') : MASQUE })));
  const { fichier, ...reste } = doc;
  return { ...reste, champs, fichier, aValider: !doc.valideLe };
}

export async function lireDocument(id, { reveler = false } = {}) {
  const doc = await lireValeur(cleDoc(id));
  if (!doc) throw erreur('Document introuvable', 404);
  return vueDocument(doc, { reveler });
}

export async function listerDocuments({ espace = '', q = '' } = {}) {
  let index = await lireIndex();
  if (ESPACES.includes(espace)) index = index.filter((e) => e.espace === espace);
  return q ? rechercher(index, q) : index;
}

function rechercher(index, requete) {
  const mots = normaliser(requete).split(/[^a-z0-9]+/).filter((m) => m.length > 1);
  if (!mots.length) return index;
  const notes = index.map((e) => {
    const champsTexte = { titre: normaliser(e.titre), personne: normaliser(e.personne), organisme: normaliser(e.organisme), cles: normaliser((e.motsCles || []).join(' ')), champs: normaliser((e.nomsChamps || []).join(' ')), resume: normaliser(e.resume), type: e.type };
    let note = 0;
    for (const m of mots) {
      if (champsTexte.titre.includes(m)) note += 5;
      if (champsTexte.personne.includes(m)) note += 4;
      if (champsTexte.cles.includes(m) || champsTexte.type.includes(m)) note += 3;
      if (champsTexte.organisme.includes(m)) note += 2;
      if (champsTexte.champs.includes(m) || champsTexte.resume.includes(m)) note += 1;
    }
    return { e, note };
  });
  return notes.filter((n) => n.note > 0).sort((a, b) => b.note - a.note).map((n) => n.e);
}

export async function modifierDocument(id, modifs = {}) {
  const doc = await lireValeur(cleDoc(id));
  if (!doc) throw erreur('Document introuvable', 404);
  if (modifs.titre !== undefined) doc.titre = texteBorne(modifs.titre, 120) || doc.titre;
  if (ESPACES.includes(modifs.espace)) doc.espace = modifs.espace;
  if (TYPES_DOC.includes(modifs.type)) doc.type = modifs.type;
  for (const k of ['personne', 'organisme']) if (modifs[k] !== undefined) doc[k] = texteBorne(modifs[k], 120);
  for (const k of ['dateDocument', 'dateExpiration']) if (modifs[k] !== undefined) doc[k] = dateIso(modifs[k]);
  if (Array.isArray(modifs.champs)) {
    // Un champ sensible renvoyé masqué garde sa valeur chiffrée d'origine.
    const anciens = new Map(doc.champs.map((c) => [c.nom, c]));
    const nouveaux = [];
    for (const c of modifs.champs.slice(0, 40)) {
      const nom = texteBorne(c?.nom, 80); const valeur = texteBorne(c?.valeur); const sensible = Boolean(c?.sensible);
      if (!nom) continue;
      if (valeur === MASQUE && anciens.get(nom)?.chiffre) { nouveaux.push(anciens.get(nom)); continue; }
      if (!valeur) continue;
      nouveaux.push(sensible ? { nom, valeur: await chiffrerTexte(valeur), sensible: true, chiffre: true } : { nom, valeur, sensible: false });
    }
    doc.champs = nouveaux;
  }
  if (modifs.valider) doc.valideLe = new Date().toISOString();
  await enregistrer(doc);
  return vueDocument(doc);
}

export async function supprimerDocument(id) {
  const doc = await lireValeur(cleDoc(id));
  if (!doc) throw erreur('Document introuvable', 404);
  await supprimerBlob(id).catch(() => {});
  await supprimerValeur(cleDoc(id));
  await ecrireValeur(CLE_INDEX, (await lireIndex()).filter((e) => e.id !== id));
}

export async function lireFichier(id) {
  const doc = await lireValeur(cleDoc(id));
  if (!doc) throw erreur('Document introuvable', 404);
  const blob = await lireBlob(id);
  if (!blob) throw erreur('Fichier introuvable', 404);
  return { octets: await dechiffrerBlob(blob.bytes), type: doc.fichier?.type || blob.type, nom: doc.fichier?.nom || `${doc.titre}` };
}

export async function expirations(jours = 60, maintenant = new Date()) {
  const limite = new Date(maintenant.getTime() + jours * 86400000).toISOString().slice(0, 10);
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  return (await lireIndex()).filter((e) => e.dateExpiration && e.dateExpiration <= limite)
    .map((e) => ({ ...e, expire: e.dateExpiration < aujourdhui }))
    .sort((a, b) => a.dateExpiration.localeCompare(b.dateExpiration));
}

// ---------- Outils de l'assistant ----------
const dateFr = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const ligneIndex = (e) => `[${e.id}] ${e.titre} (${e.type}, ${e.espace}${e.personne ? `, ${e.personne}` : ''}${e.dateExpiration ? `, expire le ${dateFr(e.dateExpiration)}` : ''})${e.valideLe ? '' : ' — fiche à valider'}${e.resume ? ` : ${e.resume}` : ''}`;

export const definitionsOutilsDocuments = [
  { name: 'document_chercher', description: "Cherche dans le coffre de documents de l'utilisateur (pièces d'identité, permis, carte grise, RIB, assurances, contrats, factures, dossiers clients). Renvoie les fiches correspondantes avec leur identifiant. Requête vide = tout lister.", input_schema: { type: 'object', properties: { requete: { type: 'string', description: 'Mots-clés : type de document, personne, client, organisme…' }, espace: { type: 'string', enum: ['', 'perso', 'pro'], description: 'Filtre perso / pro ; vide = les deux' } }, required: ['requete'] } },
  { name: 'document_lire', description: "Lit la fiche complète d'un document du coffre (champs extraits). Les champs sensibles restent masqués tant que confirme est faux : ne passe confirme à true qu'après une confirmation orale explicite de l'utilisateur pour ce document précis, et jamais pendant qu'il conduit.", input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Identifiant renvoyé par document_chercher' }, confirme: { type: 'boolean', description: "true seulement après confirmation explicite de l'utilisateur" } }, required: ['id'] } },
  { name: 'document_expirations', description: 'Liste les documents du coffre qui expirent dans les N prochains jours (ou déjà expirés).', input_schema: { type: 'object', properties: { jours: { type: 'integer', description: 'Horizon en jours (défaut 60)' } }, required: [] } },
];
export const nomsOutilsDocuments = new Set(definitionsOutilsDocuments.map((t) => t.name));

export async function executerOutilDocuments(nom, entree = {}) {
  switch (nom) {
    case 'document_chercher': {
      const l = await listerDocuments({ espace: entree.espace || '', q: entree.requete || '' });
      return l.length ? l.slice(0, 10).map(ligneIndex).join('\n') : 'Aucun document correspondant dans le coffre.';
    }
    case 'document_lire': {
      const d = await lireDocument(String(entree.id || ''), { reveler: Boolean(entree.confirme) });
      const champs = d.champs.map((c) => `- ${c.nom} : ${c.valeur}`).join('\n');
      return `${d.titre} (${d.type}, ${d.espace})${d.personne ? `\nPersonne : ${d.personne}` : ''}${d.organisme ? `\nOrganisme : ${d.organisme}` : ''}${d.dateDocument ? `\nDate : ${dateFr(d.dateDocument)}` : ''}${d.dateExpiration ? `\nExpiration : ${dateFr(d.dateExpiration)}` : ''}${champs ? `\n${champs}` : ''}${d.resume ? `\nRésumé : ${d.resume}` : ''}${d.aValider ? '\n(Fiche pas encore validée par l\'utilisateur : précise-le.)' : ''}`;
    }
    case 'document_expirations': {
      const l = await expirations(Number(entree.jours) || 60);
      return l.length ? l.map((e) => `${e.titre} : ${e.expire ? 'expiré depuis le' : 'expire le'} ${dateFr(e.dateExpiration)}`).join('\n') : 'Aucun document n\'expire dans cette période.';
    }
    default: throw new Error(`Outil inconnu : ${nom}`);
  }
}
