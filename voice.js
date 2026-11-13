import { refreshHistory } from './history.js';

const panel = document.querySelector('main');
const modes = document.querySelector('#modes');
const start = document.querySelector('#start');
const end = document.querySelector('#end');
const status = document.querySelector('#status');
const audio = document.querySelector('#audio');
const unmute = document.querySelector('#unmute');
const setup = document.querySelector('#setup');
const retry = document.querySelector('#retry-save');
let activeCall;
let pendingSave;
let configured = false;

function startRecording(call) {
  const destination = call.context.createMediaStreamDestination();
  destination.channelCount = 1;
  call.context.createMediaStreamSource(call.microphone).connect(destination);
  if (call.remote) call.context.createMediaStreamSource(call.remote).connect(destination);
  call.destination = destination;
  const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser cannot record compressed audio. Try Edge or Chrome.');
  const recorder = new MediaRecorder(destination.stream, { mimeType, audioBitsPerSecond: 32000 });
  const chunks = [];
  call.recording = new Promise(resolve => {
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: recorder.mimeType })), { once: true });
    recorder.addEventListener('error', () => resolve(null), { once: true });
  });
  recorder.start(1000);
  call.recorder = recorder;
  call.startedAt = Date.now();
}

function noteTurn(call, event, speaker, text) {
  if (!event.item_id || !call.startedAt) return;
  const key = event.item_id + ':' + (event.content_index ?? 0);
  const previous = call.turns.get(key);
  const at = previous?.at ?? call.turnTimes.get(event.item_id) ?? (Date.now() - call.startedAt) / 1000;
  call.turns.set(key, { at, speaker, text: text ?? previous?.text ?? '' });
}

async function savePending() {
  if (!pendingSave) return;
  retry.hidden = true;
  start.disabled = true;
  status.textContent = 'Saving your conversation…';
  try {
    const result = await fetch('/history', { method: 'POST', body: pendingSave });
    if (!result.ok) throw new Error();
    const log = await result.json();
    pendingSave = undefined;
    status.textContent = 'Call saved to practice history.';
    await refreshHistory(log.id);
  } catch {
    status.textContent = 'Could not save this call. Keep this page open and retry.';
    retry.hidden = false;
  } finally {
    start.disabled = !configured || Boolean(pendingSave);
  }
}

async function finish(call, message, allowTranscript = false) {
  if (!call || activeCall !== call || call.ending) return;
  call.ending = true;
  const endedAt = Date.now();
  clearTimeout(call.timer);
  call.abort.abort();
  if (call.recorder?.state === 'recording') call.recorder.stop();
  call.microphone?.getTracks().forEach(track => track.stop());
  audio.pause();
  if (allowTranscript && call.recorder) {
    end.disabled = true;
    status.textContent = 'Finishing the transcript…';
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  activeCall = undefined;
  call.peer?.close();
  if (call.context?.state !== 'closed') call.context?.close().catch(() => {});
  audio.srcObject = null;
  panel.removeAttribute('data-speaking');
  unmute.hidden = true;
  end.hidden = true;
  end.disabled = false;
  start.hidden = false;
  modes.disabled = false;
  status.textContent = message;
  if (!call.recording) return;
  start.disabled = true;
  const blob = await call.recording;
  if (blob?.size) {
    pendingSave = new FormData();
    pendingSave.set('audio', blob);
    pendingSave.set('metadata', JSON.stringify({
      mode: call.mode,
      startedAt: new Date(call.startedAt).toISOString(),
      duration: (endedAt - call.startedAt) / 1000,
      turns: [...call.turns.values()].filter(turn => turn.at <= (endedAt - call.startedAt) / 1000),
    }));
    await savePending();
  } else {
    status.textContent = 'The browser could not save audio for this call.';
    start.disabled = !configured;
  }
}

async function startCall(previousId) {
  if (activeCall || start.disabled) return;
  const mode = modes.querySelector(':checked').value;
  const call = { mode, abort: new AbortController(), turns: new Map(), turnTimes: new Map() };
  activeCall = call;
  start.hidden = true;
  end.hidden = false;
  modes.disabled = true;
  status.textContent = 'Allow microphone access to continue.';

  try {
    call.context = new AudioContext();
    await call.context.resume();
    if (activeCall !== call || call.ending) return;
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (activeCall !== call || call.ending) {
      microphone.getTracks().forEach(track => track.stop());
      return;
    }
    call.microphone = microphone;
    call.timer = setTimeout(() => finish(call, 'The call took too long to connect. Try again.'), 35000);
    status.textContent = 'Connecting to Alex…';
    const peer = new RTCPeerConnection();
    call.peer = peer;
    peer.addTrack(microphone.getAudioTracks()[0], microphone);
    peer.addEventListener('track', async event => {
      if (activeCall !== call || call.ending) return;
      call.remote = event.streams[0] ?? new MediaStream([event.track]);
      if (call.destination) call.context.createMediaStreamSource(call.remote).connect(call.destination);
      audio.srcObject = call.remote;
      try {
        await audio.play();
      } catch {
        if (activeCall === call) unmute.hidden = false;
      }
    });
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'failed') finish(call, 'The connection dropped. Start a new call to try again.');
    });
    const events = peer.createDataChannel('oai-events');
    events.addEventListener('close', () => finish(call, 'The call disconnected. You can start a new one.'));
    events.addEventListener('message', ({ data }) => {
      if (activeCall !== call) return;
      const event = JSON.parse(data);
      if (event.type === 'input_audio_buffer.speech_started' && call.startedAt) {
        call.turnTimes.set(event.item_id, Math.max(0, (Date.now() - call.startedAt) / 1000));
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        noteTurn(call, event, 'you', event.transcript);
      }
      if (event.type === 'response.output_audio_transcript.delta' || event.type === 'response.output_audio_transcript.done') {
        const key = event.item_id + ':' + (event.content_index ?? 0);
        const text = event.transcript ?? ((call.turns.get(key)?.text ?? '') + event.delta);
        noteTurn(call, event, 'alex', text);
      }
      if (call.ending) return;
      switch (event.type) {
        case 'session.created':
          try {
            startRecording(call);
          } catch (error) {
            finish(call, error.message);
            break;
          }
          clearTimeout(call.timer);
          status.textContent = 'Connected. Alex will say hello.';
          events.send(JSON.stringify({ type: 'response.create' }));
          break;
        case 'output_audio_buffer.started':
          panel.setAttribute('data-speaking', '');
          status.textContent = 'Alex is speaking…';
          break;
        case 'input_audio_buffer.speech_started':
        case 'output_audio_buffer.stopped':
        case 'output_audio_buffer.cleared':
          panel.removeAttribute('data-speaking');
          status.textContent = 'Alex is listening. Go ahead and speak.';
          break;
        case 'error':
          status.textContent = 'Alex ran into a problem. Try speaking again or start a new call.';
          break;
        case 'response.done':
          if (event.response?.status === 'failed') {
            status.textContent = 'Alex couldn’t reply. Check your API usage limits or try again.';
          }
          break;
      }
    });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const path = `/call/${mode}` + (previousId ? '?continue=' + encodeURIComponent(previousId) : '');
    const answer = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: call.abort.signal,
    });
    const sdp = await answer.text();
    if (!answer.ok) {
      if (answer.status === 401 || answer.status === 503) setup.open = true;
      throw new Error(sdp);
    }
    if (activeCall === call && !call.ending) await peer.setRemoteDescription({ type: 'answer', sdp });
  } catch (error) {
    const microphoneErrors = {
      NotAllowedError: 'Allow microphone access in your browser, then try again.',
      NotFoundError: 'Connect a microphone, then try again.',
      NotReadableError: 'Your microphone is unavailable. Check your sound settings and try again.',
    };
    finish(call, microphoneErrors[error.name] ?? (error.name === 'Error' ? error.message : 'Could not start the voice call. Try again.'));
  }
}

start.addEventListener('click', () => startCall());
start.addEventListener('continue-call', event => startCall(event.detail));

end.addEventListener('click', () => finish(activeCall, 'Call ended.', true));
retry.addEventListener('click', savePending);
window.addEventListener('beforeunload', event => {
  if (activeCall?.recorder || pendingSave) {
    event.preventDefault();
    event.returnValue = true;
  }
});
window.addEventListener('pagehide', () => {
  if (activeCall) finish(activeCall, 'Call ended.');
});
unmute.addEventListener('click', async () => {
  try {
    await audio.play();
    unmute.hidden = true;
  } catch {
    status.textContent = 'Audio playback was blocked. Check your browser’s sound settings.';
  }
});

async function checkSetup() {
  try {
    const response = await fetch('/status');
    if (!response.ok) throw new Error();
    const result = await response.json();
    configured = result.configured;
    if (!configured) {
      document.querySelector('#fallback').hidden = false;
      setup.open = true;
      status.textContent = 'Load an API key in Voice setup to start a call. Saved calls are available any time.';
    } else if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.MediaRecorder || !window.AudioContext) {
      status.textContent = 'Open Alex in a current version of Chrome, Edge, or Firefox to use your microphone.';
    } else {
      document.querySelector('#fallback').hidden = true;
      setup.open = false;
      start.disabled = Boolean(pendingSave);
      status.textContent = 'Choose a practice mode and start your call.';
    }
  } catch {
    status.textContent = 'Alex could not connect to the local launcher. Restart it and reload this page.';
  }
}

document.querySelector('#key-form').addEventListener('submit', async event => {
  event.preventDefault();
  const key = document.querySelector('#key');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/setup', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: key.value.trim() });
    if (!response.ok) throw new Error(await response.text());
    key.value = '';
    await checkSetup();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

checkSetup();
refreshHistory();
