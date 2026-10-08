// Mode conversation : WebRTC vers GPT-Realtime (voix), délégation des demandes à Claude via /api/voice/ask.
export function creerConversationVocale({ api, surEtat, surTexteUtilisateur, surTexteAssistant, surOutils, surFin }) {
  let pc = null; let canal = null; let flux = null; let audioEl = null; let conversationId = null; let actif = false;
  const enCours = new Set();

  async function demarrer(idConversation) {
    if (actif) return;
    actif = true;
    surEtat('Connexion…');
    try {
      const session = await api('/api/voice/session', { method: 'POST', body: JSON.stringify({ conversationId: idConversation || null }) });
      conversationId = session.conversationId;
      flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      pc = new RTCPeerConnection();
      audioEl = document.createElement('audio'); audioEl.autoplay = true; audioEl.playsInline = true; document.body.append(audioEl);
      pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };
      for (const piste of flux.getTracks()) pc.addTrack(piste, flux);
      canal = pc.createDataChannel('oai-events');
      canal.onmessage = (e) => { try { traiter(JSON.parse(e.data)); } catch { /* ignoré */ } };
      canal.onopen = () => surEtat('Je vous écoute');
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc?.connectionState) && actif) arreter('Connexion perdue'); };
      const offre = await pc.createOffer();
      await pc.setLocalDescription(offre);
      const r = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(session.model)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.value}`, 'Content-Type': 'application/sdp' }, body: offre.sdp,
      });
      if (!r.ok) throw new Error(`OpenAI : HTTP ${r.status}`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
      return conversationId;
    } catch (e) {
      arreter(`Impossible de démarrer : ${e.message}`);
      throw e;
    }
  }

  function envoyer(evenement) { if (canal?.readyState === 'open') canal.send(JSON.stringify(evenement)); }

  async function traiter(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': surEtat('Je vous écoute…'); break;
      case 'input_audio_buffer.speech_stopped': surEtat('…'); break;
      case 'conversation.item.input_audio_transcription.completed': if (ev.transcript?.trim()) surTexteUtilisateur(ev.transcript.trim()); break;
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
    let sortie;
    try {
      const r = await api('/api/voice/ask', { method: 'POST', body: JSON.stringify({ conversationId, message }) });
      if (r.outils?.length) surOutils(r.outils);
      sortie = { reponse: r.text };
    } catch (e) {
      sortie = { erreur: e.message };
    }
    envoyer({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(sortie) } });
    envoyer({ type: 'response.create' });
  }

  function arreter(raison) {
    if (!actif) return;
    actif = false;
    try { canal?.close(); } catch { /* ignoré */ }
    try { pc?.close(); } catch { /* ignoré */ }
    flux?.getTracks().forEach((t) => t.stop());
    audioEl?.remove();
    pc = canal = flux = audioEl = null;
    surFin(raison || null);
  }

  return { demarrer, arreter, get actif() { return actif; }, get conversationId() { return conversationId; } };
}
