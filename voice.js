import { refreshHistory } from './history.js';

const panel = document.querySelector('main');
const modes = document.querySelector('#modes');
const start = document.querySelector('#start');
const end = document.querySelector('#end');
const status = document.querySelector('#status');
const setup = document.querySelector('#setup');
const retry = document.querySelector('#retry-save');
let activeCall;
let pendingSave;
let pendingNotice = '';
let configured = false;

function startRecording(call) {
  const destination = call.context.createMediaStreamDestination();
  destination.channelCount = 1;
  call.input.connect(destination);
  call.output.connect(destination);
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

function noteTurn(call, speaker, transcription) {
  if (!call.startedAt || !transcription) return;
  let turn = call.currentTurns[speaker];
  if (!turn && transcription.text) {
    const now = Math.min(Date.now(), call.endedAt ?? Infinity);
    turn = { speaker, text: '', at: (now - call.startedAt) / 1000 };
    call.turns.push(turn);
    call.currentTurns[speaker] = turn;
  }
  if (turn && transcription.text) turn.text += transcription.text;
  if (transcription.finished) delete call.currentTurns[speaker];
}

function stopPlayback(call) {
  clearTimeout(call.playbackTimer);
  for (const source of call.playing) source.stop();
  call.playing.clear();
  call.playbackEnd = 0;
  panel.removeAttribute('data-speaking');
}

function playAudio(call, part) {
  const { inlineData } = part;
  if (!inlineData?.mimeType.startsWith('audio/pcm') || part.thought) return;
  const bytes = Uint8Array.from(atob(inlineData.data), char => char.charCodeAt(0));
  if (bytes.length < 2) return;
  const pcm = new DataView(bytes.buffer);
  const buffer = call.context.createBuffer(1, Math.floor(bytes.length / 2), 24000);
  const output = buffer.getChannelData(0);
  for (let index = 0; index < output.length; index++) {
    output[index] = pcm.getInt16(index * 2, true) / 32768;
  }
  const source = call.context.createBufferSource();
  source.buffer = buffer;
  source.connect(call.output);
  source.onended = () => call.playing.delete(source);
  const at = Math.max(call.context.currentTime + 0.025, call.playbackEnd);
  source.start(at);
  call.playing.add(source);
  call.playbackEnd = at + buffer.duration;
  panel.setAttribute('data-speaking', '');
  status.textContent = 'Alex is speaking…';
  clearTimeout(call.playbackTimer);
  call.playbackTimer = setTimeout(() => {
    panel.removeAttribute('data-speaking');
    if (!call.ending && call.ready) status.textContent = 'Alex is listening.';
  }, (call.playbackEnd - call.context.currentTime) * 1000);
}

function sendLive(call, message) {
  if (call.socket?.readyState === WebSocket.OPEN) call.socket.send(JSON.stringify(message));
}

function connectLive(call, resume) {
  const endpoint = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const socket = new WebSocket(endpoint + '?access_token=' + encodeURIComponent(call.token));
  socket.binaryType = 'arraybuffer';
  call.socket = socket;
  call.ready = false;
  clearTimeout(call.timer);
  call.timer = setTimeout(() => finish(call, 'Gemini took too long to connect.'), 25000);
  socket.addEventListener('open', () => sendLive(call, {
    setup: { ...call.setup, sessionResumption: resume ? { handle: resume } : {} },
  }));
  socket.addEventListener('message', ({ data }) => {
    if (activeCall !== call || call.socket !== socket) return;
    try {
      const message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
      if (message.setupComplete && !call.ending) {
        clearTimeout(call.timer);
        call.ready = true;
        call.resumeAttempts = 0;
        status.textContent = resume ? 'Reconnected. Keep speaking.' : 'Connected. Alex will say hello.';
        if (!resume) {
          startRecording(call);
          sendLive(call, { realtimeInput: { text: 'Start the voice practice now.' } });
        }
      }
      const update = message.sessionResumptionUpdate;
      if (update?.resumable && update.newHandle) call.handle = update.newHandle;
      if (message.goAway) {
        status.textContent = 'Alex will reconnect shortly. Pause if the call disconnects.';
        const timeLeft = Number.parseFloat(message.goAway.timeLeft);
        clearTimeout(call.reconnectTimer);
        if (Number.isFinite(timeLeft)) {
          call.reconnectTimer = setTimeout(() => socket.close(1000), Math.max(0, timeLeft * 1000 - 500));
        }
      }
      if (message.error) {
        const quota = /quota|resource_exhausted/i.test(JSON.stringify(message.error));
        finish(call, quota ? 'Gemini’s free quota is exhausted.' : 'Gemini reported a voice error.');
        return;
      }
      const content = message.serverContent;
      if (!content) return;
      noteTurn(call, 'you', content.inputTranscription);
      noteTurn(call, 'alex', content.outputTranscription);
      if (content.turnComplete) call.currentTurns = {};
      if (call.ending) return;
      if (content.interrupted) stopPlayback(call);
      for (const part of content.modelTurn?.parts ?? []) playAudio(call, part);
    } catch (error) {
      finish(call, error.message || 'Could not process the voice stream.');
    }
  });
  socket.addEventListener('close', event => {
    if (activeCall !== call || call.ending || call.socket !== socket) return;
    clearTimeout(call.reconnectTimer);
    const quota = /quota|resource.exhausted|rate limit/i.test(event.reason) || event.code === 1013;
    if (!quota && call.handle && call.resumeAttempts < 1) {
      call.resumeAttempts++;
      status.textContent = 'Reconnecting to the same conversation…';
      connectLive(call, call.handle);
      return;
    }
    finish(call, quota
      ? 'Gemini’s free quota is exhausted. Try again after your quota resets.'
      : 'Gemini disconnected. Check your project’s Live API access or continue from history.');
  });
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
    status.textContent = [pendingNotice, 'Call saved to practice history.'].filter(Boolean).join(' ');
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
  const endedAt = call.endedAt = Date.now();
  clearTimeout(call.timer);
  call.abort.abort();
  if (call.recorder?.state === 'recording') call.recorder.stop();
  call.microphone?.getTracks().forEach(track => track.stop());
  clearTimeout(call.reconnectTimer);
  stopPlayback(call);
  if (allowTranscript) sendLive(call, { realtimeInput: { audioStreamEnd: true } });
  if (allowTranscript && call.recorder) {
    end.disabled = true;
    status.textContent = 'Finishing the transcript…';
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  activeCall = undefined;
  call.socket?.close();
  if (call.context?.state !== 'closed') call.context?.close().catch(() => {});
  panel.removeAttribute('data-speaking');
  end.hidden = true;
  end.disabled = false;
  start.hidden = false;
  modes.disabled = false;
  status.textContent = message;
  if (!call.recording) return;
  start.disabled = true;
  const blob = await call.recording;
  if (blob?.size) {
    pendingNotice = message === 'Call ended.' ? '' : message;
    pendingSave = new FormData();
    pendingSave.set('audio', blob);
    pendingSave.set('metadata', JSON.stringify({
      mode: call.mode,
      startedAt: new Date(call.startedAt).toISOString(),
      duration: (endedAt - call.startedAt) / 1000,
      turns: call.turns,
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
  const call = { mode, abort: new AbortController(), turns: [], currentTurns: {}, playing: new Set(), playbackEnd: 0, resumeAttempts: 0 };
  activeCall = call;
  start.hidden = true;
  end.hidden = false;
  modes.disabled = true;
  status.textContent = 'Allow microphone access to continue.';

  try {
    call.context = new AudioContext({ sampleRate: 16000 });
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
    await call.context.audioWorklet.addModule('/mic.js');
    if (activeCall !== call || call.ending) return;
    call.input = call.context.createMediaStreamSource(microphone);
    call.output = call.context.createGain();
    call.output.connect(call.context.destination);
    const capture = new AudioWorkletNode(call.context, 'microphone-capture', { numberOfOutputs: 0 });
    call.input.connect(capture);
    capture.port.onmessage = ({ data }) => {
      if (!call.ready || call.ending || call.socket?.bufferedAmount > 128000) return;
      const encoded = btoa(String.fromCharCode(...new Uint8Array(data)));
      sendLive(call, { realtimeInput: { audio: { data: encoded, mimeType: 'audio/pcm;rate=16000' } } });
    };
    const path = '/call/' + mode + (previousId ? '?continue=' + encodeURIComponent(previousId) : '');
    const answer = await fetch(path, { method: 'POST', signal: call.abort.signal });
    if (!answer.ok) {
      if (answer.status === 401 || answer.status === 503) setup.open = true;
      throw new Error(await answer.text());
    }
    const session = await answer.json();
    if (activeCall === call && !call.ending) {
      call.token = session.token;
      call.setup = session.setup;
      connectLive(call);
    }
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
    } else if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.MediaRecorder || !window.AudioContext) {
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
