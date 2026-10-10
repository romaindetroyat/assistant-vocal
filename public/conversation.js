// Mode conversation : WebRTC vers GPT-Realtime (voix), délégation des demandes à Claude via /api/voice/ask.
// Fiabilité : les états WebRTC « disconnected » sont tolérés quelques secondes, puis reconnexion automatique
// (nouvelle session, même conversation) ; une réponse de Claude arrivée pendant une coupure est rejouée.
// Mains libres : `delaiInactivite()` (ms, 0 = jamais) raccroche automatiquement après un silence sans parole ni réponse ;
// `conserverFlux()` (booléen) garde le micro ouvert à la fin de l'appel pour que la veille le réutilise sans nouvelle
// permission (indispensable sur iPhone) ; `recupererFlux()` transfère ce flux à l'appelant, `demarrer(id, { flux })` le rend.
// Contexte : `contexte()` (chaîne, '' = aucun) est joint aux corps JSON de /api/voice/session et /api/voice/ask ('voiture' en
// mode voiture) ; `dire(texte)` fait annoncer un texte par la voix en cours (rappel, notification) sans passer par Claude.
export function creerConversationVocale({ api, surEtat, surTexteUtilisateur, surTexteAssistant, surOutils, surFin, delaiInactivite = () => 0, conserverFlux = () => false, contexte = () => '' }) {
  let pc = null; let canal = null; let flux = null; let audioEl = null; let conversationId = null;
  let actif = false; let reconnexions = 0; let minuteurDeco = null; let minuteurInactivite = null;
  const enCours = new Set(); const resultatsEnAttente = [];
  const MAX_RECONNEXIONS = 4;

  // Temporisateur d'inactivité : réarmé à chaque signe de vie (parole, réponse, délégation) ; suspendu pendant qu'on attend Claude.
  function armerInactivite() {
    clearTimeout(minuteurInactivite); minuteurInactivite = null;
    const delai = Number(delaiInactivite()) || 0;
    if (!actif || delai <= 0) return;
    minuteurInactivite = setTimeout(() => { if (actif && !enCours.size) arreter('Fin automatique après un silence'); }, delai);
  }

  async function demarrer(idConversation, { flux: fluxFourni = null } = {}) {
    if (actif) return conversationId;
    if (fluxFourni && fluxFourni.getTracks().some((t) => t.readyState === 'live')) flux = fluxFourni;
    actif = true; reconnexions = 0;
    conversationId = idConversation || null;
    try { await connecter(); return conversationId; }
    catch (e) { arreter(`Impossible de démarrer : ${e.message}`); throw e; }
  }

  async function connecter() {
    surEtat(reconnexions ? `Reconnexion (${reconnexions})…` : 'Connexion…');
    const session = await api('/api/voice/session', { method: 'POST', body: JSON.stringify({ conversationId, contexte: contexte() || undefined }) });
    conversationId = session.conversationId;
    if (!flux) flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (!audioEl) { audioEl = document.createElement('audio'); audioEl.autoplay = true; audioEl.playsInline = true; document.body.append(audioEl); }
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; audioEl.play?.().catch(() => {}); };
    for (const piste of flux.getTracks()) pc.addTrack(piste, flux);
    const monPc = pc;
    canal = pc.createDataChannel('oai-events');
    canal.onmessage = (e) => { try { traiter(JSON.parse(e.data)); } catch { /* ignoré */ } };
    canal.onopen = () => { clearTimeout(minuteurDeco); surEtat('Je vous écoute'); rejouerResultats(); armerInactivite(); };
    pc.onconnectionstatechange = () => {
      if (monPc !== pc || !actif) return;
      const s = monPc.connectionState;
      if (s === 'connected') { clearTimeout(minuteurDeco); reconnexions = 0; }
      else if (s === 'disconnected') { surEtat('Connexion instable…'); clearTimeout(minuteurDeco); minuteurDeco = setTimeout(() => { if (actif && monPc === pc && monPc.connectionState !== 'connected') reconnecter(`état ${monPc.connectionState}`); }, 6000); }
      else if (s === 'failed' || s === 'closed') reconnecter(`état ${s}`);
    };
    const offre = await pc.createOffer();
    await pc.setLocalDescription(offre);
    const r = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(session.model)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.value}`, 'Content-Type': 'application/sdp' }, body: offre.sdp,
    });
    if (!r.ok) throw new Error(`OpenAI : HTTP ${r.status}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
  }

  async function reconnecter(raison) {
    if (!actif) return;
    fermerPc();
    if (reconnexions >= MAX_RECONNEXIONS) { arreter(`Connexion perdue (${raison})`); return; }
    reconnexions++;
    await new Promise((res) => setTimeout(res, 800 * reconnexions));
    if (!actif) return;
    try { await connecter(); }
    catch (e) { reconnecter(e.message); }
  }

  function envoyer(evenement) { if (canal?.readyState === 'open') { canal.send(JSON.stringify(evenement)); return true; } return false; }

  // Après une reconnexion, on redonne au modèle les réponses de Claude arrivées entre-temps.
  function rejouerResultats() {
    while (resultatsEnAttente.length) {
      const { message, texte } = resultatsEnAttente.shift();
      envoyer({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[Reprise après coupure] Ma demande était : « ${message} ». La réponse de l'assistant est : « ${texte} ». Restitue-la-moi à l'oral.` }] } });
      envoyer({ type: 'response.create' });
    }
  }

  // Filtre anti-bruit : la session ne répond pas d'elle-même ; on crée la réponse seulement si la transcription
  // ressemble à une vraie phrase (pas un fragment d'écho, un bruit ou une hallucination de transcription).
  const MOTS_SEULS = new Set(['oui', 'non', 'stop', 'merci', 'bonjour', 'salut', 'continue', 'annule', 'pardon', 'ok', 'allo', 'attends', 'arrête', 'arrete', 'répète', 'repete']);
  const HALLUCINATIONS = /sous-titr|amara\.org|abonnez|merci d'avoir regard|\u266a|♪/i;
  function transcriptionValide(t) {
    const texte = String(t || '').trim();
    if (!texte || HALLUCINATIONS.test(texte)) return false;
    const mots = texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) || [];
    if (mots.length >= 2 && mots.join('').length >= 4) return true;
    return mots.length === 1 && MOTS_SEULS.has(mots[0]);
  }
  let minuteurTranscription = null;
  function repondre() { clearTimeout(minuteurTranscription); minuteurTranscription = null; envoyer({ type: 'response.create' }); }

  async function traiter(ev) {
    if (ev.type?.startsWith('input_audio_buffer.') || ev.type?.startsWith('response.') || ev.type?.startsWith('conversation.item.')) armerInactivite();
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': surEtat('Je vous écoute…'); break;
      case 'input_audio_buffer.speech_stopped': surEtat('…'); break;
      case 'input_audio_buffer.committed':
        // Si la transcription n'arrive pas (panne du service), on répond quand même après 4 s plutôt que de rester muet.
        clearTimeout(minuteurTranscription);
        minuteurTranscription = setTimeout(() => { minuteurTranscription = null; envoyer({ type: 'response.create' }); }, 4000);
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const t = (ev.transcript || '').trim();
        if (transcriptionValide(t)) { surTexteUtilisateur(t); repondre(); }
        else { clearTimeout(minuteurTranscription); minuteurTranscription = null; surEtat('Je vous écoute'); if (ev.item_id) envoyer({ type: 'conversation.item.delete', item_id: ev.item_id }); }
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': clearTimeout(minuteurTranscription); minuteurTranscription = null; surEtat('Je vous écoute'); break;
      case 'response.output_audio_transcript.done': if (ev.transcript?.trim()) surTexteAssistant(ev.transcript.trim()); surEtat('Je vous écoute'); break;
      case 'response.output_audio.delta': case 'response.output_audio_transcript.delta': surEtat('Je parle…'); break;
      case 'response.done': {
        for (const item of ev.response?.output || []) {
          if (item.type === 'function_call' && item.name === 'demander_assistant' && !enCours.has(item.call_id)) {
            enCours.add(item.call_id);
            deleguer(item).finally(() => enCours.delete(item.call_id));
          }
        }
        break;
      }
      case 'error': console.warn('[realtime]', ev.error); surEtat(`Erreur : ${ev.error?.message || 'inconnue'}`); break;
      default: break;
    }
  }

  async function deleguer(item) {
    let message = '';
    try { message = JSON.parse(item.arguments || '{}').message || ''; } catch { message = ''; }
    surEtat('Je réfléchis…');
    clearTimeout(minuteurInactivite); // pas de raccrochage pendant que Claude travaille
    let texte;
    try {
      const r = await api('/api/voice/ask', { method: 'POST', body: JSON.stringify({ conversationId, message, contexte: contexte() || undefined }) });
      if (r.outils?.length) surOutils(r.outils);
      texte = r.text;
    } catch (e) { texte = `Désolé, une erreur est survenue : ${e.message}`; }
    if (!actif) return;
    armerInactivite();
    const livre = envoyer({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ reponse: texte }) } }) && envoyer({ type: 'response.create' });
    if (!livre) resultatsEnAttente.push({ message, texte }); // le canal est tombé pendant le traitement : rejoué après reconnexion
  }

  function fermerPc() {
    clearTimeout(minuteurDeco); clearTimeout(minuteurInactivite);
    try { canal?.close(); } catch { /* ignoré */ }
    try { pc?.close(); } catch { /* ignoré */ }
    pc = canal = null;
  }

  function arreter(raison) {
    if (!actif) return;
    actif = false;
    fermerPc();
    if (!conserverFlux()) { flux?.getTracks().forEach((t) => t.stop()); flux = null; }
    // L'élément audio est conservé : « débloqué » par le premier appel (geste), il peut rejouer sans geste sur Safari (veille).
    if (audioEl) audioEl.srcObject = null;
    resultatsEnAttente.length = 0;
    surFin(raison || null);
  }

  // Transfère le micro conservé (ou null) : l'appelant en devient responsable.
  function recupererFlux() { const f = flux; flux = null; return f; }

  // Fait annoncer un texte par la voix de l'appel (message système + réponse) ; renvoie false si le canal n'est pas ouvert.
  function dire(texte) {
    const t = String(texte || '').trim();
    if (!t || !actif) return false;
    const livre = envoyer({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Annonce à l'utilisateur : ${t}` }] } }) && envoyer({ type: 'response.create' });
    if (livre) armerInactivite();
    return livre;
  }

  return { demarrer, arreter, recupererFlux, dire, get actif() { return actif; }, get conversationId() { return conversationId; } };
}
