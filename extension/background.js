// Service worker de l'extension « Assistant vocal » (Manifest V3).
// Raccourcis globaux, menus contextuels, fenêtre dédiée de l'app réutilisée, envoi à /api/partage avec le jeton d'appareil.
import { lireReglages, HOTE_PAR_DEFAUT } from './reglages.js';

const TAILLE_FENETRE = { width: 440, height: 820 };
const LIMITE_TEXTE = 20000;
const LIMITE_NOTIFICATION = 300;
const CLE_FENETRE = 'fenetreAssistant';
const MENUS = {
  'envoyer-selection': { title: "Envoyer la sélection à l'assistant", contexts: ['selection'] },
  'envoyer-lien': { title: "Envoyer ce lien à l'assistant", contexts: ['link'] },
  'envoyer-page': { title: "Envoyer cette page à l'assistant", contexts: ['page'] },
};

// ---------- Fenêtre dédiée ----------
async function lireFenetre() {
  const { [CLE_FENETRE]: f } = await chrome.storage.session.get(CLE_FENETRE);
  if (!f) return null;
  try { await chrome.windows.get(f.windowId); return f; } catch { await chrome.storage.session.remove(CLE_FENETRE); return null; }
}

// Ouvre (ou ramène au premier plan) la fenêtre de l'assistant. `chemin` : « /app?action=appel » pour parler tout de suite.
export async function ouvrirAssistant(chemin = '/app') {
  const { hote } = await lireReglages();
  const url = hote + chemin;
  const existante = await lireFenetre();
  if (existante) {
    await chrome.windows.update(existante.windowId, { focused: true });
    // « Parler » dans une fenêtre déjà ouverte = interrupteur : l'app lance l'écoute, ou l'arrête si elle est en cours
    // (micro éteint). Repli sur la navigation si la page ne répond pas (onglet rechargé, autre adresse).
    if (chemin.includes('action=appel')) {
      const bascule = await executerDansOnglet(existante.tabId, () => { if (!window.__assistantBasculerEcoute) return false; window.__assistantBasculerEcoute(); return true; }, [], 'MAIN'); // monde de la page : accès à la fonction exposée par l'app
      if (!bascule) await chrome.tabs.update(existante.tabId, { url, active: true });
    } else if (chemin.includes('conversation=')) await chrome.tabs.update(existante.tabId, { url, active: true });
    return existante;
  }
  const fenetre = await chrome.windows.create({ url, type: 'popup', focused: true, ...TAILLE_FENETRE });
  const f = { windowId: fenetre.id, tabId: fenetre.tabs?.[0]?.id };
  await chrome.storage.session.set({ [CLE_FENETRE]: f });
  return f;
}
chrome.windows.onRemoved.addListener(async (id) => { const f = await lireFenetre(); if (f && f.windowId === id) await chrome.storage.session.remove(CLE_FENETRE); });

// ---------- Notifications ----------
function notifier(message, { id = `assistant-${Date.now()}`, titre = 'Assistant' } = {}) {
  return chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon-128.png', title: titre, message: String(message || '').slice(0, LIMITE_NOTIFICATION) });
}
chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  if (id.startsWith('partage-')) await ouvrirAssistant(`/app?conversation=${encodeURIComponent(id.slice('partage-'.length))}`);
  else if (id === 'jeton-absent') chrome.runtime.openOptionsPage();
});

// ---------- Contenu de la page ----------
async function executerDansOnglet(tabId, func, args = [], world = 'ISOLATED') {
  try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world }); return r?.result; }
  catch { return undefined; } // pages chrome://, Web Store, PDF… : scripts interdits
}
const extraireTexte = (limite) => ({ titre: document.title, texte: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, limite) });
const demanderConsigne = () => window.prompt("Que faire ? (vide = l'assistant choisit)") ?? null;

async function contenuPage(tab) {
  const extrait = await executerDansOnglet(tab.id, extraireTexte, [LIMITE_TEXTE]);
  const titre = extrait?.titre || tab.title || '';
  const corps = extrait?.texte || '';
  return { texte: titre ? `${titre}\n\n${corps}`.trim().slice(0, LIMITE_TEXTE) : corps, url: tab.url || '' };
}

// ---------- Envoi à l'assistant ----------
async function envoyerPartage({ texte = '', url = '', consigne = '' }, tab) {
  const { hote, jeton } = await lireReglages();
  if (!jeton) {
    await notifier("Aucun jeton d'appareil : ouvrez les options de l'extension pour le coller.", { id: 'jeton-absent' });
    chrome.runtime.openOptionsPage();
    return;
  }
  if (consigne === undefined || consigne === '') {
    // Demande la consigne dans l'onglet ; prompt annulé (null) = envoi abandonné ; impossible (undefined) = consigne vide.
    const saisie = tab ? await executerDansOnglet(tab.id, demanderConsigne) : undefined;
    if (saisie === null) return;
    consigne = saisie || '';
  }
  const idEnCours = `attente-${Date.now()}`;
  await notifier("Envoi à l'assistant…", { id: idEnCours });
  try {
    const r = await fetch(`${hote}/api/partage`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` }, body: JSON.stringify({ texte, url, consigne }) });
    const donnees = await r.json().catch(() => ({}));
    chrome.notifications.clear(idEnCours);
    if (r.status === 401) { await notifier("Jeton refusé : il est faux ou révoqué. Créez-en un nouveau dans Mes outils et collez-le dans les options.", { id: 'jeton-absent' }); return; }
    if (!r.ok) { await notifier(`Erreur ${r.status} : ${donnees.erreur || 'réponse inattendue'}`); return; }
    await notifier(donnees.texte || 'Partage traité.', { id: `partage-${donnees.conversationId || ''}` });
  } catch (e) {
    chrome.notifications.clear(idEnCours);
    await notifier(`Assistant injoignable (${hote}) : ${e.message}`);
  }
}

async function ongletActif() { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return tab; }
async function envoyerPage(tab) { tab = tab || (await ongletActif()); if (!tab) return; await envoyerPartage(await contenuPage(tab), tab); }

// ---------- Commandes, menus, popup ----------
chrome.runtime.onInstalled.addListener(() => {
  for (const [id, menu] of Object.entries(MENUS)) chrome.contextMenus.create({ id, ...menu });
});
chrome.commands.onCommand.addListener(async (commande, tab) => {
  if (commande === 'parler') await ouvrirAssistant('/app?action=appel');
  else if (commande === 'ouvrir') await ouvrirAssistant('/app');
  else if (commande === 'envoyer-page') await envoyerPage(tab);
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'envoyer-selection') await envoyerPartage({ texte: (info.selectionText || '').slice(0, LIMITE_TEXTE), url: info.pageUrl || tab?.url || '' }, tab);
  else if (info.menuItemId === 'envoyer-lien') await envoyerPartage({ texte: (info.linkText || info.selectionText || '').slice(0, 500), url: info.linkUrl || '' }, tab);
  else if (info.menuItemId === 'envoyer-page') await envoyerPage(tab);
});
chrome.runtime.onMessage.addListener((message, _expediteur, repondre) => {
  (async () => {
    if (message?.type === 'parler') await ouvrirAssistant('/app?action=appel');
    else if (message?.type === 'ouvrir') await ouvrirAssistant('/app');
    else if (message?.type === 'envoyer-page') await envoyerPage();
    repondre({ ok: true });
  })().catch((e) => repondre({ ok: false, erreur: e.message }));
  return true;
});

export { HOTE_PAR_DEFAUT };
