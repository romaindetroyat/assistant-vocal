// Interface de l'assistant : connexion, conversations, envoi multimodal, dictée, voix, notifications, conversation en direct.
import { creerConversationVocale } from '/conversation.js';
const $ = (s) => document.querySelector(s);
const ui = {
  login: $('#ecran-login'), app: $('#ecran-app'), formLogin: $('#form-login'), motDePasse: $('#mot-de-passe'), loginErreur: $('#login-erreur'),
  messages: $('#messages'), saisie: $('#saisie'), pieces: $('#pieces'), etat: $('#etat'), titre: $('#titre-conv'),
  tiroir: $('#tiroir'), voile: $('#voile'), liste: $('#liste-conversations'), listeOutils: $('#liste-outils'),
  btnMicro: $('#btn-micro'), btnVocal: $('#btn-vocal'), btnEnvoyer: $('#btn-envoyer'), btnVoix: $('#btn-voix'),
  btnMainsLibres: $('#btn-mains-libres'), btnNotifs: $('#btn-notifs'), btnAppel: $('#btn-appel'), bandeauAppel: $('#bandeau-appel'), appelEtat: $('#appel-etat'),
  bandeauVeille: $('#bandeau-veille'), veilleEtat: $('#veille-etat'), btnQuitterVeille: $('#btn-quitter-veille'),
};

const etat = {
  moi: null,
  reglages: {}, // réglages serveur (/api/reglages) : voix, concision, mainsLibres, motActivation
  conversationId: null,
  images: [], // {data (base64), media_type, url}
  envoiEnCours: false,
  voix: localStorage.getItem('voix') === '1',
  mainsLibres: localStorage.getItem('mainsLibres') === '1',
  reconnaissance: null,
  enregistreur: null,
};

// ---------- Utilitaires ----------
async function api(chemin, options = {}) {
  const r = await fetch(chemin, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (r.status === 401) { afficherLogin(); throw new Error('Session expirée'); }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.erreur || `HTTP ${r.status}`);
  return json;
}
function echapper(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function rendreMarkdown(texte) {
  let h = echapper(texte);
  h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>');
  h = h.replace(/^\s*[-*]\s+/gm, '• ');
  // Lignes « Plans : https://… » / « Google Maps : https://… » (outil trajet_calculer) → gros boutons qui ouvrent l'itinéraire.
  h = h.replace(/^\s*(Plans|Google Maps)\s*:\s*(https?:\/\/\S+)\s*$/gm, (_, nom, url) => `<a class="btn btn-itineraire" href="${url}" target="_blank" rel="noopener">Ouvrir dans ${nom}</a>`);
  return h;
}
function texteALire(texte) {
  return texte.replace(/^\s*(Plans|Google Maps)\s*:\s*https?:\/\/\S+\s*$/gm, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/https?:\/\/\S+/g, 'lien');
}
function setEtat(texte) { ui.etat.textContent = texte || ''; ui.etat.hidden = !texte; }

// ---------- Position (réglage « partager ma position ») ----------
// Jointe aux messages et aux délégations vocales pour les trajets « depuis ici » ; cache de 5 min ; échec silencieux.
const POSITION_CACHE_MS = 5 * 60_000;
const position = { valeur: null, obtenueLe: 0, enCours: null };
async function obtenirPosition() {
  if (!etat.reglages.partagerPosition || !navigator.geolocation) return null;
  if (position.valeur && Date.now() - position.obtenueLe < POSITION_CACHE_MS) return position.valeur;
  if (!position.enCours) {
    position.enCours = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => { position.valeur = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy || 0) }; position.obtenueLe = Date.now(); resolve(position.valeur); },
        () => resolve(position.valeur), // refus ou échec : dernière position connue, sinon rien
        { enableHighAccuracy: false, timeout: 4000, maximumAge: POSITION_CACHE_MS },
      );
    }).finally(() => { position.enCours = null; });
  }
  return position.enCours;
}
// Variante de api() qui joint la position aux délégations vocales (/api/voice/ask).
async function apiAvecPosition(chemin, options = {}) {
  if (chemin === '/api/voice/ask' && options.body) {
    const pos = await obtenirPosition();
    if (pos) options = { ...options, body: JSON.stringify({ ...JSON.parse(options.body), position: pos }) };
  }
  return api(chemin, options);
}
function defiler() { ui.messages.scrollTop = ui.messages.scrollHeight; }

// ---------- Connexion ----------
function afficherLogin() { ui.app.hidden = true; ui.login.hidden = false; setTimeout(() => ui.motDePasse.focus(), 50); }
ui.formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  ui.loginErreur.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: ui.motDePasse.value }) });
    ui.motDePasse.value = '';
    const suite = new URLSearchParams(location.search).get('next');
    if (suite && suite.startsWith('/') && !suite.startsWith('//')) { location.href = suite; return; }
    await demarrer();
  } catch (err) { ui.loginErreur.textContent = err.message; }
});
$('#btn-logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; });

// ---------- Démarrage ----------
async function demarrer() {
  try { etat.moi = await api('/api/me'); } catch { return; }
  ui.login.hidden = true; ui.app.hidden = false;
  document.title = etat.moi.assistantName;
  afficherOutils(etat.moi.serveurs);
  etat.reglages = await api('/api/reglages').catch(() => ({}));
  const connecte = new URLSearchParams(location.search).get('connecte');
  if (connecte) { history.replaceState(null, '', '/app'); setEtat(`${connecte} connecté ✓`); }
  ui.btnVoix.setAttribute('aria-pressed', String(etat.voix));
  ui.btnMainsLibres.setAttribute('aria-pressed', String(etat.mainsLibres));
  ui.btnNotifs.hidden = !etat.moi.push;
  ui.btnAppel.hidden = !etat.moi.voix;
  if (etat.moi.voix) ui.btnAppel.title = `Conversation vocale en direct (${etat.moi.voix.modele})`;
  if (!etat.moi.transcription) ui.btnVocal.title = 'Vocal : service de transcription non configuré, utilisez la dictée';
  if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
    ui.btnMicro.disabled = true; ui.btnMicro.title = 'Dictée non disponible dans ce navigateur : écrivez ou enregistrez un vocal';
  }
  await chargerListe();
  const dernier = localStorage.getItem('conversationId');
  const existe = dernier && [...ui.liste.querySelectorAll('li')].some((li) => li.dataset.id === dernier);
  await ouvrirConversation(existe ? dernier : null);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(verifierAbonnementPush).catch(() => {});
}

// ---------- Outils (serveurs MCP) ----------
function afficherOutils(serveurs) {
  ui.listeOutils.innerHTML = '';
  if (!serveurs.length) { const li = document.createElement('li'); li.className = 'discret'; li.textContent = 'Aucun outil : ajoutez-en dans « Mes outils »'; ui.listeOutils.append(li); return; }
  for (const s of serveurs) {
    const li = document.createElement('li');
    const point = document.createElement('span'); point.className = `point${s.connecte ? '' : ' off'}`;
    const nom = document.createElement('span'); nom.className = 'nom'; nom.textContent = s.name; nom.title = s.description || '';
    li.append(point, nom);
    if (s.auth === 'oauth' && !s.connecte) {
      const b = document.createElement('button'); b.className = 'btn btn-secondaire'; b.textContent = 'Connecter';
      b.onclick = () => { location.href = `/connect/${encodeURIComponent(s.name)}`; };
      li.append(b);
    }
    ui.listeOutils.append(li);
  }
}
async function rafraichirOutils() { try { afficherOutils(await api('/api/mcp')); } catch { /* ignoré */ } }
async function connecterOutil(nom) {
  try {
    const { url, manuel } = await api(`/api/mcp/${nom}/connect`, { method: 'POST' });
    if (!manuel) { location.href = url; return; }
    window.open(url, '_blank');
    const colle = prompt(`Autorisez ${nom} dans l'onglet qui vient de s'ouvrir. À la fin, le navigateur affiche une page "localhost" introuvable : copiez son adresse complète et collez-la ici.`);
    if (!colle) return;
    await api(`/api/mcp/${nom}/finish`, { method: 'POST', body: JSON.stringify({ url: colle }) });
    setEtat(`${nom} connecté ✓`); await rafraichirOutils();
  } catch (e) { setEtat(`Connexion ${nom} : ${e.message}`); }
}
async function deconnecterOutil(nom) {
  if (!confirm(`Déconnecter ${nom} ?`)) return;
  await api(`/api/mcp/${nom}`, { method: 'DELETE' }); await rafraichirOutils();
}

// ---------- Conversations ----------
async function chargerListe() {
  const liste = await api('/api/conversations');
  ui.liste.innerHTML = '';
  for (const c of liste) {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    li.classList.toggle('active', c.id === etat.conversationId);
    const b = document.createElement('button'); b.textContent = c.titre; b.onclick = () => { ouvrirConversation(c.id); fermerTiroir(); };
    const s = document.createElement('button'); s.className = 'suppr'; s.textContent = '🗑'; s.setAttribute('aria-label', 'Supprimer');
    s.onclick = async () => { if (!confirm('Supprimer cette conversation ?')) return; await api(`/api/conversations/${c.id}`, { method: 'DELETE' }); if (etat.conversationId === c.id) await ouvrirConversation(null); await chargerListe(); };
    li.append(b, s); ui.liste.append(li);
  }
}
async function ouvrirConversation(id) {
  etat.conversationId = id;
  localStorage.setItem('conversationId', id || '');
  ui.messages.innerHTML = '';
  ui.titre.textContent = etat.moi.assistantName;
  if (!id) {
    const p = document.createElement('p'); p.className = 'vide-accueil';
    p.textContent = 'Appuyez sur le micro et parlez, ou écrivez. Collez une image, prenez une photo, enregistrez un vocal.';
    ui.messages.append(p);
  } else {
    const conv = await api(`/api/conversations/${id}`);
    ui.titre.textContent = conv.titre;
    if (conv.resumes?.length) afficherResumes(conv.resumes);
    for (const m of conv.messages) afficherMessageHistorique(m);
    defiler();
  }
  [...ui.liste.querySelectorAll('li')].forEach((li) => li.classList.toggle('active', li.dataset.id === id));
}
function afficherMessageHistorique(m) {
  const blocs = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
  if (m.role === 'user') {
    if (blocs.every((b) => b.type === 'tool_result')) return;
    if (blocs[0]?.type === 'text' && blocs[0].text.startsWith(MARQUE_RESUME)) { creerBulle('systeme').textContent = 'Historique compacté'; return; }
    const el = creerBulle('user');
    for (const b of blocs) {
      if (b.type === 'image' && b.source?.type === 'base64') { const img = document.createElement('img'); img.src = `data:${b.source.media_type};base64,${b.source.data}`; el.append(img); }
      else if (b.type === 'text') el.append(document.createTextNode(b.text));
    }
  } else {
    const outils = blocs.filter((b) => ['tool_use', 'mcp_tool_use', 'server_tool_use'].includes(b.type));
    if (outils.length) { const o = creerLigneOutils(); for (const t of outils) ajouterBadge(o, t.name, t.server_name || (t.type === 'server_tool_use' ? 'anthropic' : 'local'), 'ok'); }
    const texte = blocs.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (texte === ACCUSE_RESUME) return;
    if (texte) creerBulle('assistant').innerHTML = rendreMarkdown(texte);
  }
}
// Historique compacté côté serveur : les résumés restent consultables dans un bloc repliable en tête.
const MARQUE_RESUME = '[Résumé de la conversation précédente]';
const ACCUSE_RESUME = 'Compris, je poursuis avec ce contexte.';
function afficherResumes(resumes) {
  const det = document.createElement('details'); det.className = 'resume-historique';
  const sum = document.createElement('summary'); sum.textContent = `Résumé de l'historique (${resumes.length})`; det.append(sum);
  for (const r of resumes) {
    const bloc = document.createElement('div'); bloc.className = 'resume';
    const meta = document.createElement('div'); meta.className = 'discret';
    const date = r.date ? new Date(r.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    meta.textContent = `${date}${r.messagesCompactes ? ` · ${r.messagesCompactes} messages résumés` : ''}`;
    const texte = document.createElement('div'); texte.textContent = r.texte || '';
    bloc.append(meta, texte); det.append(bloc);
  }
  ui.messages.append(det);
}
function creerBulle(role) { const el = document.createElement('div'); el.className = `msg ${role}`; ui.messages.append(el); return el; }
function creerLigneOutils() { const el = document.createElement('div'); el.className = 'outils'; ui.messages.append(el); return el; }
function ajouterBadge(ligne, nom, serveur, classe = 'actif') {
  const b = document.createElement('span'); b.className = `outil ${classe}`; b.textContent = serveur && serveur !== 'local' ? `${serveur} · ${nom}` : nom; ligne.append(b); return b;
}

// ---------- Envoi ----------
async function envoyer() {
  if (etat.envoiEnCours) return;
  const texte = ui.saisie.value.trim();
  if (!texte && !etat.images.length) return;
  const content = [];
  for (const img of etat.images) content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
  if (texte) content.push({ type: 'text', text: texte });

  ui.messages.querySelector('.vide-accueil')?.remove();
  const bulleUser = creerBulle('user');
  for (const img of etat.images) { const i = document.createElement('img'); i.src = img.url; bulleUser.append(i); }
  if (texte) bulleUser.append(document.createTextNode(texte));
  ui.saisie.value = ''; redimensionnerSaisie(); viderPieces();
  etat.envoiEnCours = true; ui.btnEnvoyer.disabled = true; setEtat('Réflexion…');
  window.speechSynthesis?.cancel();

  const bulle = creerBulle('assistant'); bulle.classList.add('vide');
  let ligneOutils = null; let badgeActif = null; let texteRecu = ''; let texteFinal = '';
  defiler();
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: etat.conversationId, content, position: await obtenirPosition() }) });
    if (r.status === 401) { afficherLogin(); return; }
    if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).erreur || `HTTP ${r.status}`);
    for await (const ev of lireSSE(r.body)) {
      if (ev.event === 'start') { if (!etat.conversationId) { etat.conversationId = ev.data.conversationId; localStorage.setItem('conversationId', etat.conversationId); } }
      else if (ev.event === 'text') { texteRecu += ev.data.text; bulle.classList.remove('vide'); bulle.innerHTML = rendreMarkdown(texteRecu); setEtat(''); defiler(); }
      else if (ev.event === 'tool_use') { if (!ligneOutils) { ligneOutils = creerLigneOutils(); ui.messages.insertBefore(ligneOutils, bulle); } badgeActif = ajouterBadge(ligneOutils, ev.data.name, ev.data.server); setEtat(`Outil : ${ev.data.name}…`); defiler(); }
      else if (ev.event === 'tool_result') { if (badgeActif) { badgeActif.className = `outil ${ev.data.ok ? 'ok' : 'ko'}`; badgeActif.title = ev.data.preview || ''; } }
      else if (ev.event === 'done') { texteFinal = ev.data.text; }
      else if (ev.event === 'compaction') { const s = creerBulle('systeme'); s.textContent = `Historique compacté (${ev.data.messages} messages résumés)`; ui.messages.insertBefore(s, bulleUser); }
      else if (ev.event === 'error') { const e = creerBulle('erreur'); e.textContent = ev.data.message; }
    }
    if (!texteRecu) bulle.remove();
    if (etat.voix && texteFinal) await lire(texteFinal);
  } catch (e) {
    bulle.remove(); const el = creerBulle('erreur'); el.textContent = e.message;
  } finally {
    etat.envoiEnCours = false; ui.btnEnvoyer.disabled = false; setEtat('');
    chargerListe().then(() => { const li = ui.liste.querySelector(`li[data-id="${etat.conversationId}"] button`); if (li) ui.titre.textContent = li.textContent; });
    if (etat.mainsLibres && !dictee.actif) demarrerDictee();
  }
}
async function* lireSSE(body) {
  const lecteur = body.getReader(); const dec = new TextDecoder(); let tampon = '';
  while (true) {
    const { value, done } = await lecteur.read();
    if (done) break;
    tampon += dec.decode(value, { stream: true });
    let idx;
    while ((idx = tampon.indexOf('\n\n')) >= 0) {
      const brut = tampon.slice(0, idx); tampon = tampon.slice(idx + 2);
      let event = 'message'; const donnees = [];
      for (const ligne of brut.split('\n')) { if (ligne.startsWith('event:')) event = ligne.slice(6).trim(); else if (ligne.startsWith('data:')) donnees.push(ligne.slice(5).trim()); }
      if (donnees.length) { try { yield { event, data: JSON.parse(donnees.join('\n')) }; } catch { /* ignore */ } }
    }
  }
}
ui.btnEnvoyer.addEventListener('click', envoyer);
ui.saisie.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); envoyer(); } });
function redimensionnerSaisie() { ui.saisie.style.height = 'auto'; ui.saisie.style.height = `${Math.min(ui.saisie.scrollHeight, window.innerHeight * 0.4)}px`; }
ui.saisie.addEventListener('input', redimensionnerSaisie);

// ---------- Images (collage, pièce jointe, appareil photo) ----------
async function ajouterImage(fichier) {
  if (!fichier.type.startsWith('image/')) return;
  const { data, media_type, url } = await redimensionner(fichier);
  etat.images.push({ data, media_type, url });
  const piece = document.createElement('div'); piece.className = 'piece';
  const img = document.createElement('img'); img.src = url;
  const x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'Retirer');
  x.onclick = () => { etat.images = etat.images.filter((i) => i.url !== url); piece.remove(); ui.pieces.hidden = !etat.images.length; };
  piece.append(img, x); ui.pieces.append(piece); ui.pieces.hidden = false;
}
function viderPieces() { etat.images = []; ui.pieces.innerHTML = ''; ui.pieces.hidden = true; }
function redimensionner(fichier, max = 1568) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio); canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ data: url.split(',')[1], media_type: 'image/jpeg', url });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(fichier);
  });
}
for (const id of ['#input-image', '#input-camera']) $(id).addEventListener('change', async (e) => { for (const f of e.target.files) await ajouterImage(f); e.target.value = ''; });
document.addEventListener('paste', async (e) => {
  const fichiers = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (fichiers.length) { e.preventDefault(); for (const f of fichiers) await ajouterImage(f); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => { e.preventDefault(); for (const f of e.dataTransfer?.files || []) await ajouterImage(f); });

// ---------- Dictée (Web Speech API) ----------
// Écoute continue : le navigateur coupe après ~1 s de silence en mode phrase ; ici on gère nous-mêmes le
// silence (SILENCE_MS), on relance quand le navigateur s'arrête seul, et on propose l'appui maintenu.
const SILENCE_MS = Number(localStorage.getItem('silenceMs')) || 3000;
const dictee = { actif: false, maintien: false, rec: null, final: '', base: '', minuteur: null, debutAppui: 0, echecs: 0 };

function demarrerDictee({ maintien = false } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || dictee.actif) return;
  window.speechSynthesis?.cancel(); arreterVeille();
  dictee.actif = true; dictee.maintien = maintien; dictee.final = ''; dictee.echecs = 0;
  dictee.base = ui.saisie.value ? `${ui.saisie.value.trim()} ` : '';
  ui.btnMicro.setAttribute('aria-pressed', 'true');
  setEtat(maintien ? 'Je vous écoute… relâchez pour envoyer' : 'Je vous écoute… (envoi après un silence)');
  lancerReconnaissance();
}

function lancerReconnaissance() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  // Mode « phrase » (le plus fiable partout) enchaîné automatiquement tant que l'écoute est active.
  rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  let finalSession = ''; let aRecu = false; let erreur = null;
  const debut = Date.now();
  rec.onresult = (e) => {
    let interim = '';
    finalSession = '';
    for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalSession += t; else interim += t; }
    aRecu = true;
    ui.saisie.value = (dictee.base + dictee.final + finalSession + (finalSession ? ' ' : '') + interim).replace(/\s+/g, ' '); redimensionnerSaisie();
    armerSilence();
  };
  rec.onerror = (e) => { erreur = e.error; };
  rec.onend = () => {
    dictee.final += finalSession ? `${finalSession} ` : ''; finalSession = '';
    dictee.rec = null;
    if (!dictee.actif) return;
    if (erreur === 'not-allowed' || erreur === 'service-not-allowed') { setEtat('Micro refusé par le navigateur : autorisez-le dans les réglages du site'); arreterDictee({ envoyer: false }); return; }
    if (erreur && erreur !== 'no-speech' && erreur !== 'aborted') { setEtat(`Dictée interrompue (${erreur})`); arreterDictee({ envoyer: true }); return; }
    // Protection contre les boucles : une session qui meurt tout de suite sans rien entendre, plusieurs fois de suite → on arrête.
    dictee.echecs = aRecu || Date.now() - debut > 1500 ? 0 : dictee.echecs + 1;
    if (dictee.echecs >= 3) { setEtat("Le navigateur coupe le micro aussitôt : utilisez le bouton ⏺ (vocal) ou le clavier"); arreterDictee({ envoyer: false }); return; }
    // Fin de phrase : on relance pour continuer d'écouter (appui maintenu ou silence pas encore atteint).
    setTimeout(() => { if (dictee.actif && !dictee.rec) { try { lancerReconnaissance(); } catch { arreterDictee({ envoyer: true }); } } }, 150);
  };
  dictee.rec = rec;
  try { rec.start(); } catch (e) { setEtat(`Dictée impossible : ${e.message}`); dictee.actif = false; ui.btnMicro.setAttribute('aria-pressed', 'false'); }
}

function armerSilence() {
  clearTimeout(dictee.minuteur);
  if (dictee.maintien) return; // en appui maintenu, c'est le relâchement qui envoie
  dictee.minuteur = setTimeout(() => { if (dictee.actif && texteDicte().trim()) arreterDictee({ envoyer: true }); }, SILENCE_MS);
}
function texteDicte() { return ui.saisie.value; }

function arreterDictee({ envoyer = false } = {}) {
  clearTimeout(dictee.minuteur);
  if (!dictee.actif) return;
  dictee.actif = false;
  const rec = dictee.rec; dictee.rec = null;
  if (rec) { rec.onend = null; try { rec.stop(); } catch { /* ignoré */ } }
  ui.btnMicro.setAttribute('aria-pressed', 'false'); setEtat('');
  const texte = texteDicte().trim();
  if (envoyer && texte) envoyer_();
  else if (etat.mainsLibres && !etat.envoiEnCours && !texte) setTimeout(() => demarrerDictee(), 300);
}
function envoyer_() { envoyer(); }

// Bouton micro : appui bref = écoute jusqu'au silence ; appui maintenu = écoute tant qu'on tient, envoi au relâchement.
ui.btnMicro.addEventListener('pointerdown', (e) => {
  e.preventDefault(); ui.btnMicro.setPointerCapture?.(e.pointerId);
  dictee.debutAppui = Date.now();
  if (dictee.actif) { arreterDictee({ envoyer: true }); dictee.debutAppui = 0; return; }
  demarrerDictee({ maintien: true });
});
function finAppui() {
  if (!dictee.debutAppui) return;
  const duree = Date.now() - dictee.debutAppui; dictee.debutAppui = 0;
  if (!dictee.actif) return;
  if (duree < 500) { dictee.maintien = false; setEtat('Je vous écoute… (envoi après un silence)'); armerSilence(); } // appui bref : on continue jusqu'au silence
  else arreterDictee({ envoyer: true }); // appui maintenu : relâcher envoie
}
ui.btnMicro.addEventListener('pointerup', finAppui);
ui.btnMicro.addEventListener('pointercancel', finAppui);
ui.btnMicro.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Vocal enregistré (MediaRecorder → /api/transcribe) ----------
async function demarrerEnregistrement() {
  if (etat.enregistreur) return;
  if (!etat.moi.transcription) { setEtat('Vocal indisponible : service de transcription non configuré. Utilisez la dictée 🎤.'); return; }
  arreterVeille();
  try {
    const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(flux); const morceaux = [];
    rec.ondataavailable = (e) => morceaux.push(e.data);
    rec.onstop = async () => {
      flux.getTracks().forEach((t) => t.stop());
      ui.btnVocal.classList.remove('enregistre'); setEtat('Transcription…');
      const blob = new Blob(morceaux, { type: rec.mimeType || 'audio/webm' });
      const form = new FormData(); form.append('file', blob, 'vocal.webm');
      try {
        const r = await fetch('/api/transcribe', { method: 'POST', body: form });
        const json = await r.json();
        if (!r.ok) throw new Error(json.erreur || `HTTP ${r.status}`);
        ui.saisie.value = `${ui.saisie.value.trim()} ${json.text}`.trim(); redimensionnerSaisie(); setEtat('');
        if (json.text) envoyer();
      } catch (e) { setEtat(`Transcription impossible : ${e.message}`); }
    };
    etat.enregistreur = rec; rec.start(); ui.btnVocal.classList.add('enregistre'); setEtat('Enregistrement… relâchez pour envoyer');
  } catch (e) { setEtat(`Micro refusé : ${e.message}`); }
}
function arreterEnregistrement() { if (etat.enregistreur) { etat.enregistreur.stop(); etat.enregistreur = null; } }
ui.btnVocal.addEventListener('pointerdown', (e) => { e.preventDefault(); demarrerEnregistrement(); });
ui.btnVocal.addEventListener('pointerup', arreterEnregistrement);
ui.btnVocal.addEventListener('pointerleave', arreterEnregistrement);
ui.btnVocal.addEventListener('pointercancel', arreterEnregistrement);

// ---------- Lecture à voix haute ----------
let voixFr = null;
function choisirVoix() {
  const voix = window.speechSynthesis?.getVoices() || [];
  voixFr = voix.find((v) => v.lang === 'fr-FR' && /natural|premium|enhanced|google|siri/i.test(v.name)) || voix.find((v) => v.lang?.startsWith('fr')) || null;
}
window.speechSynthesis?.addEventListener('voiceschanged', choisirVoix); choisirVoix();
function lire(texte) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const u = new SpeechSynthesisUtterance(texteALire(texte));
    u.lang = 'fr-FR'; if (voixFr) u.voice = voixFr; u.rate = 1.05;
    u.onend = resolve; u.onerror = resolve;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  });
}
ui.btnVoix.addEventListener('click', () => {
  etat.voix = !etat.voix; localStorage.setItem('voix', etat.voix ? '1' : '0'); ui.btnVoix.setAttribute('aria-pressed', String(etat.voix));
  if (!etat.voix) window.speechSynthesis?.cancel(); else lire('Lecture à voix haute activée.');
});
ui.btnMainsLibres.addEventListener('click', () => {
  etat.mainsLibres = !etat.mainsLibres; localStorage.setItem('mainsLibres', etat.mainsLibres ? '1' : '0');
  ui.btnMainsLibres.setAttribute('aria-pressed', String(etat.mainsLibres));
  if (etat.mainsLibres) { etat.voix = true; localStorage.setItem('voix', '1'); ui.btnVoix.setAttribute('aria-pressed', 'true'); demarrerDictee(); } else arreterDictee({ envoyer: false });
});

// ---------- Notifications push ----------
function base64VersUint8(b64) { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
async function verifierAbonnementPush(reg) {
  if (!etat.moi.push || !('pushManager' in reg)) return;
  const abo = await reg.pushManager.getSubscription();
  ui.btnNotifs.setAttribute('aria-pressed', String(Boolean(abo)));
  if (abo) await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(abo.toJSON()) }).catch(() => {});
}
ui.btnNotifs.addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    const existant = await reg.pushManager.getSubscription();
    if (existant) { await api('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: existant.endpoint }) }); await existant.unsubscribe(); ui.btnNotifs.setAttribute('aria-pressed', 'false'); setEtat('Notifications désactivées sur cet appareil'); return; }
    if ((await Notification.requestPermission()) !== 'granted') { setEtat('Notifications refusées par le navigateur'); return; }
    const abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64VersUint8(etat.moi.vapidPublicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(abo.toJSON()) });
    ui.btnNotifs.setAttribute('aria-pressed', 'true'); setEtat('Notifications activées sur cet appareil');
  } catch (e) { setEtat(`Notifications : ${e.message}${/iP(hone|ad)/.test(navigator.userAgent) ? ' (sur iPhone, installez d\'abord l\'app sur l\'écran d\'accueil)' : ''}`); }
});

// ---------- Conversation vocale en direct (GPT-Realtime + Claude) ----------
const INACTIVITE_APPEL_MS = 45_000; // mains libres : raccrochage automatique après ce silence, retour en veille
const appel = creerConversationVocale({
  api: apiAvecPosition,
  surEtat: (t) => { ui.appelEtat.textContent = t; },
  surTexteUtilisateur: (t) => { ui.messages.querySelector('.vide-accueil')?.remove(); creerBulle('user').textContent = t; defiler(); },
  surTexteAssistant: (t) => { creerBulle('assistant').innerHTML = rendreMarkdown(t); defiler(); },
  surOutils: (noms) => { const l = creerLigneOutils(); for (const n of noms) ajouterBadge(l, n, '', 'ok'); defiler(); },
  surFin: (raison) => {
    ui.bandeauAppel.hidden = true; ui.btnAppel.setAttribute('aria-pressed', 'false');
    if (raison) setEtat(raison);
    chargerListe();
    // Mains libres : après la fin de l'appel (automatique, erreur, coupure ou raccrochage), on repasse en veille
    // en récupérant le micro de l'appel (pas de nouvelle demande de permission sur iPhone).
    if (etat.reglages.mainsLibres) { veille.flux = appel.recupererFlux() || veille.flux; setTimeout(demarrerVeille, 600); }
    else appel.recupererFlux()?.getTracks().forEach((t) => t.stop());
  },
  delaiInactivite: () => (etat.reglages.mainsLibres ? INACTIVITE_APPEL_MS : 0),
  conserverFlux: () => Boolean(etat.reglages.mainsLibres),
});
async function demarrerAppel() {
  if (appel.actif) return;
  window.speechSynthesis?.cancel(); arreterDictee({ envoyer: false }); arreterVeille({ garderFlux: true });
  if (etat.reglages.mainsLibres) preparerContexteAudio(); // geste utilisateur : débloque Web Audio pour la veille (Safari)
  ui.bandeauAppel.hidden = false; ui.btnAppel.setAttribute('aria-pressed', 'true');
  try {
    const flux = veille.flux; veille.flux = null;
    const id = await appel.demarrer(etat.conversationId, { flux });
    if (id !== etat.conversationId) { etat.conversationId = id; localStorage.setItem('conversationId', id); ui.messages.querySelector('.vide-accueil')?.remove(); chargerListe(); }
  } catch { /* état déjà affiché */ }
}
ui.btnAppel.addEventListener('click', () => { if (appel.actif) appel.arreter(); else demarrerAppel(); });
$('#btn-raccrocher').addEventListener('click', () => appel.arreter());

// ---------- Mains libres : veille à mot d'activation ----------
// Après un appel, l'application reste en veille et relance l'appel quand elle entend le mot d'activation.
// Deux moteurs :
//  - « reconnaissance » : SpeechRecognition continue du navigateur (Chrome ordinateur / Android) ;
//  - « ecoute » : détection locale de voix (niveau sonore, Web Audio) + court extrait transcrit par le serveur
//    (/api/transcribe). C'est le moteur de l'iPhone, où SpeechRecognition s'interrompt sans cesse, et le repli
//    automatique des autres navigateurs après 5 échecs. Le micro de l'appel est conservé pour éviter une nouvelle demande.
// Garde-fous : au plus un redémarrage par seconde, un extrait à la fois, 60 extraits par veille, veille suspendue
// quand l'onglet est caché (batterie), jamais pendant un appel, une dictée ou un vocal.
const veille = { actif: false, moteur: null, rec: null, dernierDemarrage: 0, echecs: 0, minuteur: null, suspendue: false,
  flux: null, ctx: null, analyseur: null, boucle: null, enregistreur: null, extraits: 0, transcriptionEnCours: false, wakeLock: null, debutParole: 0, dernierSon: 0, plancher: 0.01 };
const EXTRAITS_MAX = 60; const EXTRAIT_MAX_MS = 3000; const SILENCE_FIN_MS = 700; const PAROLE_MIN_MS = 250;
const normaliser = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function motActivation() { return normaliser(etat.reglages.motActivation || 'assistant').trim() || 'assistant'; }
function speechRecognitionDisponible() { return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition); }
const estSafari = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Safari/.test(navigator.userAgent) && !/Chrom/.test(navigator.userAgent));
// Le contexte audio doit être créé lors d'un geste de l'utilisateur (Safari) : on le prépare au clic d'appel.
function preparerContexteAudio() {
  try {
    if (!veille.ctx) veille.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (veille.ctx.state === 'suspended') veille.ctx.resume().catch(() => {});
  } catch { /* pas de Web Audio : le moteur « ecoute » sera indisponible */ }
}
function contientMot(texte) {
  const t = normaliser(texte); const mot = motActivation();
  if (t.includes(mot)) return true;
  // Tolérance aux variantes de transcription (« assistante », « assistants ») : préfixe de 6 lettres minimum.
  return mot.length >= 6 && t.split(/[^a-z0-9]+/).some((m) => m.startsWith(mot.slice(0, Math.max(6, mot.length - 2))));
}
function choisirMoteur() {
  if (etat.moi?.transcription && (estSafari || !speechRecognitionDisponible())) return 'ecoute';
  if (speechRecognitionDisponible()) return 'reconnaissance';
  return etat.moi?.transcription ? 'ecoute' : null;
}

function demarrerVeille() {
  if (veille.actif || !etat.reglages.mainsLibres || appel.actif || dictee.actif || etat.enregistreur) return;
  if (document.hidden) { veille.suspendue = true; return; }
  const moteur = choisirMoteur();
  if (!moteur) { setEtat('Mains libres non pris en charge par ce navigateur'); return; }
  veille.actif = true; veille.suspendue = false; veille.echecs = 0; veille.extraits = 0; veille.moteur = moteur;
  ui.veilleEtat.textContent = `En veille · dites « ${etat.reglages.motActivation || 'assistant'} »`;
  ui.bandeauVeille.hidden = false;
  demanderWakeLock();
  if (moteur === 'ecoute') lancerEcouteLocale(); else lancerEcouteVeille();
}

function declencher() {
  arreterVeille({ garderFlux: true });
  setEtat(`« ${etat.reglages.motActivation || 'assistant'} » entendu : je vous appelle`);
  demarrerAppel();
}

// Moteur « reconnaissance » (SpeechRecognition continue).
function lancerEcouteVeille() {
  if (!veille.actif || veille.rec) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  const debut = Date.now(); veille.dernierDemarrage = debut;
  let erreur = null; let declenche = false;
  rec.onresult = (e) => {
    if (declenche) return;
    for (let i = e.resultIndex; i < e.results.length; i++) if (contientMot(e.results[i][0]?.transcript)) { declenche = true; break; }
    if (declenche) declencher();
  };
  rec.onerror = (e) => { erreur = e.error; };
  rec.onend = () => {
    veille.rec = null;
    if (!veille.actif) return;
    if (erreur === 'not-allowed' || erreur === 'service-not-allowed') { arreterVeille(); setEtat('Micro refusé par le navigateur : la veille mains libres est arrêtée'); return; }
    // Échec = session morte en moins de 1,5 s ou sur erreur réseau/audio ; « no-speech » et « aborted » sont normaux.
    const echec = (erreur && erreur !== 'no-speech' && erreur !== 'aborted') || Date.now() - debut < 1500;
    veille.echecs = echec ? veille.echecs + 1 : 0;
    if (veille.echecs >= 5) {
      if (etat.moi?.transcription) { veille.moteur = 'ecoute'; veille.echecs = 0; lancerEcouteLocale(); return; } // repli : écoute locale
      arreterVeille(); setEtat('La reconnaissance vocale s\'interrompt sans cesse : veille mains libres arrêtée'); return;
    }
    const attente = Math.max(250, 1000 - (Date.now() - veille.dernierDemarrage)); // au plus un redémarrage par seconde
    clearTimeout(veille.minuteur);
    veille.minuteur = setTimeout(() => { if (veille.actif && !veille.rec) { try { lancerEcouteVeille(); } catch (err) { arreterVeille(); setEtat(`Veille impossible : ${err.message}`); } } }, attente);
  };
  veille.rec = rec;
  try { rec.start(); } catch (e) { veille.rec = null; arreterVeille(); setEtat(`Veille impossible : ${e.message}`); }
}

// Moteur « ecoute » : détection de voix locale puis transcription d'un court extrait.
async function lancerEcouteLocale() {
  if (!veille.actif || veille.boucle) return;
  try {
    preparerContexteAudio();
    if (!veille.ctx) throw new Error('Web Audio indisponible');
    if (!veille.flux || !veille.flux.getTracks().some((t) => t.readyState === 'live')) {
      veille.flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }
    if (!veille.actif) return;
    const source = veille.ctx.createMediaStreamSource(veille.flux);
    const analyseur = veille.ctx.createAnalyser(); analyseur.fftSize = 1024; source.connect(analyseur);
    veille.analyseur = analyseur; veille.debutParole = 0; veille.dernierSon = 0; veille.plancher = 0.01;
    const tampon = new Float32Array(analyseur.fftSize);
    ui.veilleEtat.textContent = `En veille (écoute locale) · dites « ${etat.reglages.motActivation || 'assistant'} »`;
    veille.boucle = setInterval(() => mesurerNiveau(tampon), 60);
  } catch (e) {
    arreterVeille(); setEtat(`Veille impossible : ${e.message}`);
  }
}
function mesurerNiveau(tampon) {
  if (!veille.actif || !veille.analyseur) return;
  veille.analyseur.getFloatTimeDomainData(tampon);
  let somme = 0; for (let i = 0; i < tampon.length; i++) somme += tampon[i] * tampon[i];
  const rms = Math.sqrt(somme / tampon.length);
  const maintenant = Date.now();
  // Plancher de bruit adaptatif : descend vite, remonte lentement ; la parole dépasse 3 × le plancher (et un minimum absolu).
  veille.plancher = rms < veille.plancher ? rms : veille.plancher * 0.995 + rms * 0.005;
  const parle = rms > Math.max(0.015, veille.plancher * 3);
  if (parle) veille.dernierSon = maintenant;
  if (veille.enregistreur) {
    if (maintenant - veille.dernierSon > SILENCE_FIN_MS || maintenant - veille.debutParole > EXTRAIT_MAX_MS) terminerExtrait();
    return;
  }
  if (parle) {
    if (!veille.debutParole) veille.debutParole = maintenant;
    else if (maintenant - veille.debutParole >= PAROLE_MIN_MS && !veille.transcriptionEnCours) commencerExtrait();
  } else if (maintenant - veille.dernierSon > SILENCE_FIN_MS) veille.debutParole = 0;
}
function commencerExtrait() {
  if (veille.extraits >= EXTRAITS_MAX) { arreterVeille(); setEtat('Veille arrêtée après une longue période sans activation (économie)'); return; }
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  let rec;
  try { rec = new MediaRecorder(veille.flux, type ? { mimeType: type } : undefined); } catch (e) { arreterVeille(); setEtat(`Veille impossible : ${e.message}`); return; }
  const morceaux = [];
  rec.ondataavailable = (e) => { if (e.data?.size) morceaux.push(e.data); };
  rec.onstop = () => { veille.enregistreur = null; veille.debutParole = 0; transcrireExtrait(new Blob(morceaux, { type: rec.mimeType || type || 'audio/webm' })); };
  veille.enregistreur = rec; veille.extraits++;
  try { rec.start(); } catch { veille.enregistreur = null; }
}
function terminerExtrait() {
  const rec = veille.enregistreur; if (!rec) return;
  try { if (rec.state !== 'inactive') rec.stop(); } catch { veille.enregistreur = null; }
}
async function transcrireExtrait(blob) {
  if (!veille.actif || veille.transcriptionEnCours || blob.size < 1000) return;
  veille.transcriptionEnCours = true;
  try {
    const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
    const form = new FormData(); form.append('file', blob, `veille.${ext}`); form.append('indice', etat.reglages.motActivation || 'assistant');
    const r = await fetch('/api/transcribe', { method: 'POST', body: form });
    const json = await r.json().catch(() => ({}));
    if (r.status === 401) { arreterVeille(); afficherLogin(); return; }
    if (r.ok && veille.actif && contientMot(json.text)) declencher();
  } catch { /* extrait perdu : on continue d'écouter */ }
  finally { veille.transcriptionEnCours = false; }
}

async function demanderWakeLock() {
  try { if (navigator.wakeLock && !veille.wakeLock) { veille.wakeLock = await navigator.wakeLock.request('screen'); veille.wakeLock.addEventListener('release', () => { veille.wakeLock = null; }); } } catch { /* refusé : l'écran pourra s'éteindre */ }
}
function arreterVeille({ garderFlux = false } = {}) {
  clearTimeout(veille.minuteur); veille.minuteur = null;
  clearInterval(veille.boucle); veille.boucle = null;
  ui.bandeauVeille.hidden = true;
  const rec = veille.rec; veille.rec = null;
  if (rec) { rec.onend = null; rec.onresult = null; try { rec.abort(); } catch { /* ignoré */ } }
  if (veille.enregistreur) { const e = veille.enregistreur; veille.enregistreur = null; e.onstop = null; try { e.stop(); } catch { /* ignoré */ } }
  try { veille.analyseur?.disconnect(); } catch { /* ignoré */ }
  veille.analyseur = null; veille.debutParole = 0;
  if (!garderFlux && veille.flux) { veille.flux.getTracks().forEach((t) => t.stop()); veille.flux = null; }
  try { veille.wakeLock?.release(); } catch { /* ignoré */ } veille.wakeLock = null;
  veille.actif = false;
}
ui.btnQuitterVeille.addEventListener('click', () => { arreterVeille(); veille.suspendue = false; setEtat('Veille quittée'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (veille.actif) { arreterVeille({ garderFlux: true }); veille.suspendue = true; } }
  else if (veille.suspendue && etat.reglages.mainsLibres) { veille.suspendue = false; demarrerVeille(); }
});

// ---------- Tiroir ----------
function ouvrirTiroir() { ui.tiroir.hidden = false; ui.voile.hidden = false; }
function fermerTiroir() { ui.tiroir.hidden = true; ui.voile.hidden = true; }
$('#btn-menu').addEventListener('click', ouvrirTiroir);
$('#btn-fermer-tiroir').addEventListener('click', fermerTiroir);
ui.voile.addEventListener('click', fermerTiroir);
$('#btn-nouvelle').addEventListener('click', async () => { await ouvrirConversation(null); fermerTiroir(); ui.saisie.focus(); });

// ---------- Lancement ----------
demarrer().then(() => { if (ui.app.hidden) afficherLogin(); });
