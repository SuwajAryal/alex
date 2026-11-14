import { refreshHistory } from './history.js';
import { createExam, nextCard } from './exam.js';

const panel = document.querySelector('main');
const modes = document.querySelector('#modes');
const start = document.querySelector('#start');
const end = document.querySelector('#end');
const status = document.querySelector('#status');
const setup = document.querySelector('#setup');
const retry = document.querySelector('#retry-save');
const options = document.querySelector('#call-options');
const provider = document.querySelector('#provider');
const limit = document.querySelector('#limit');
const clock = document.querySelector('#call-clock');
const reset = document.querySelector('#reset-clock');
const audio = document.querySelector('#openai-audio');
const playVoice = document.querySelector('#play-voice');
const examPanel = document.querySelector('#exam-panel');
const examStage = document.querySelector('#exam-stage');
const cueCard = document.querySelector('#cue-card');
const prepare = document.querySelector('#start-preparation');
let activeCall;
let pendingSave;
let pendingNotice = '';
let configured = {};

function canStart() {
  return configured[provider.value] && !pendingSave && navigator.mediaDevices?.getUserMedia &&
    window.MediaRecorder && window.AudioContext &&
    (provider.value === 'gemini' ? window.AudioWorkletNode : window.RTCPeerConnection);
}

function updateClock(call) {
  if (call.exam) {
    call.exam.tick();
    return;
  }
  const elapsed = (Date.now() - call.clockStart) / 1000;
  if (call.limit && elapsed >= call.limit) {
    finish(call, 'Time limit reached.', true);
    return;
  }
  const seconds = call.limit ? Math.ceil(call.limit - elapsed) : Math.floor(elapsed);
  const display = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  clock.textContent = display + (call.limit ? ' remaining' : ' elapsed');
}

function startClock(call) {
  call.clockStart = Date.now();
  clock.hidden = false;
  reset.hidden = Boolean(call.exam);
  updateClock(call);
  call.clockTimer = setInterval(() => updateClock(call), 250);
}

function startExam(call, send) {
  let card;
  try {
    card = nextCard(window.localStorage);
  } catch {
    card = nextCard();
  }
  call.exam = createExam({
    card,
    send,
    finish: () => finish(call, 'IELTS mock complete.', true),
    setMicrophone(enabled) {
      for (const track of call.microphone.getAudioTracks()) track.enabled = enabled;
    },
    show(stage, seconds, card, canPrepare = false) {
      if (examStage.textContent !== stage) examStage.textContent = stage;
      prepare.hidden = !canPrepare;
      clock.hidden = seconds === null;
      if (seconds !== null) clock.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' remaining';
      if (card && cueCard.hidden) {
        cueCard.querySelector('strong').textContent = card.title;
        cueCard.querySelector('ul').replaceChildren(...card.points.map(point => {
          const row = document.createElement('li');
          row.textContent = point;
          return row;
        }));
        cueCard.hidden = false;
      }
      if (!card) cueCard.hidden = true;
    },
  });
  examPanel.hidden = false;
  call.exam.start();
}

prepare.addEventListener('click', () => activeCall?.exam?.startPreparation());

reset.addEventListener('click', () => {
  if (!activeCall || activeCall.ending) return;
  activeCall.clockStart = Date.now();
  updateClock(activeCall);
});

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
  call.audioOrigin = call.context.currentTime;
  startClock(call);
}

function recordingTime(call) {
  return Math.max(0, call.context.currentTime - call.audioOrigin);
}

function noteTurn(call, speaker, transcription) {
  if (!call.startedAt || !transcription) return;
  let turn = call.currentTurns[speaker];
  if (!turn && transcription.text) {
    const timing = speaker === 'you' ? call.inputTiming : call.outputTiming;
    turn = timing ?? { at: call.recordedDuration ?? recordingTime(call) };
    turn.speaker = speaker;
    turn.text = '';
    call.turns.push(turn);
    call.currentTurns[speaker] = turn;
  }
  if (turn && transcription.text) turn.text += transcription.text;
  if (transcription.finished) {
    delete call.currentTurns[speaker];
    if (speaker === 'you') call.inputTiming = undefined;
  }
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
  call.outputTiming ??= call.currentTurns.alex ?? { at: 0 };
  if (!call.outputTiming.end) call.outputTiming.at = Math.max(0, at - call.audioOrigin);
  call.outputTiming.end = call.playbackEnd - call.audioOrigin;
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
        if (call.pendingExamControl) {
          sendLive(call, call.pendingExamControl);
          call.pendingExamControl = undefined;
        }
        if (!resume) {
          startRecording(call);
          if (call.mode === 'mock') {
            startExam(call, text => {
              clearTimeout(call.examAudioTimer);
              stopPlayback(call);
              const command = { clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } };
              if (call.ready && call.socket?.readyState === WebSocket.OPEN) sendLive(call, command);
              else call.pendingExamControl = command;
            });
            reset.hidden = true;
          } else {
            sendLive(call, { realtimeInput: { text: 'Start the voice practice now.' } });
          }
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
      if (!call.ending) {
        if (content.interrupted) {
          if (call.outputTiming) call.outputTiming.end = Math.min(call.outputTiming.end, recordingTime(call));
          stopPlayback(call);
        }
        if (!call.exam?.suppressSpeech()) {
          for (const part of content.modelTurn?.parts ?? []) playAudio(call, part);
        }
      }
      noteTurn(call, 'you', content.inputTranscription);
      if (content.inputTranscription?.text) call.examHasAnswer = true;
      if (!call.exam?.suppressSpeech()) noteTurn(call, 'alex', content.outputTranscription);
      if ((content.generationComplete || content.turnComplete) && call.exam && !call.ending &&
          !content.interrupted && !call.exam.suppressSpeech() && call.playbackEnd > 0) {
          clearTimeout(call.examAudioTimer);
          call.examAudioTimer = setTimeout(() => call.exam.examinerFinished(), Math.max(0, call.playbackEnd - call.context.currentTime) * 1000);
      }
      if (content.turnComplete) {
        call.currentTurns = {};
        call.inputTiming = call.outputTiming = undefined;
      }
      if (!call.ending && call.examHasAnswer && (content.inputTranscription?.finished || content.turnComplete)) {
        call.examHasAnswer = false;
        call.exam?.discussionTurn();
      }
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
    await refreshHistory(log.id, log.mode === 'mock' && configured.gemini);
  } catch {
    status.textContent = 'Could not save this call. Keep this page open and retry.';
    retry.hidden = false;
  } finally {
    start.disabled = !canStart();
  }
}

async function finish(call, message, allowTranscript = false) {
  if (!call || activeCall !== call || call.ending) return;
  call.ending = true;
  const endedAt = call.endedAt = Date.now();
  if (call.recorder) call.recordedDuration = recordingTime(call);
  clearTimeout(call.timer);
  clearInterval(call.clockTimer);
  clearTimeout(call.examAudioTimer);
  examPanel.hidden = cueCard.hidden = true;
  clock.hidden = true;
  reset.hidden = true;
  call.abort.abort();
  if (call.recorder?.state === 'recording') call.recorder.stop();
  call.microphone?.getTracks().forEach(track => track.stop());
  clearTimeout(call.reconnectTimer);
  stopPlayback(call);
  audio.pause();
  if (allowTranscript) sendLive(call, { realtimeInput: { audioStreamEnd: true } });
  if (allowTranscript && call.recorder) {
    end.disabled = true;
    status.textContent = 'Finishing the transcript…';
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  activeCall = undefined;
  call.socket?.close();
  call.peer?.close();
  audio.srcObject = null;
  playVoice.hidden = true;
  if (call.context?.state !== 'closed') call.context?.close().catch(() => {});
  panel.removeAttribute('data-speaking');
  end.hidden = true;
  end.disabled = false;
  start.hidden = false;
  modes.disabled = false;
  options.disabled = false;
  start.disabled = !canStart();
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
      duration: call.recordedDuration ?? (endedAt - call.startedAt) / 1000,
      turns: call.turns,
    }));
    await savePending();
  } else {
    status.textContent = 'The browser could not save audio for this call.';
    start.disabled = !canStart();
  }
}

async function connectOpenAI(call, path) {
  const peer = new RTCPeerConnection();
  call.peer = peer;
  peer.addTrack(call.microphone.getAudioTracks()[0], call.microphone);
  peer.addEventListener('track', async event => {
    if (activeCall !== call || call.ending) return;
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    call.context.createMediaStreamSource(stream).connect(call.output);
    audio.srcObject = stream;
    try {
      await audio.play();
    } catch {
      if (activeCall === call && !call.ending) playVoice.hidden = false;
    }
  });
  const channel = peer.createDataChannel('oai-events');
  channel.addEventListener('close', () => finish(call, 'OpenAI disconnected.'));
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'failed') finish(call, 'OpenAI disconnected.');
  });
  const items = new Map();
  const outputTimes = new Map();
  channel.addEventListener('message', ({ data }) => {
    if (activeCall !== call) return;
    try {
      const event = JSON.parse(data);
      audio.muted = Boolean(call.exam?.suppressSpeech());
      const at = call.startedAt ? call.recordedDuration ?? recordingTime(call) : 0;
      if (event.type === 'output_audio_buffer.started') {
        const timing = outputTimes.get(event.response_id) ?? {};
        timing.at = at;
        for (const turn of timing.turns ?? []) turn.at = at;
        outputTimes.set(event.response_id, timing);
      }
      if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) {
        const timing = outputTimes.get(event.response_id);
        if (timing) {
          timing.end = at;
          for (const turn of timing.turns ?? []) turn.end = at;
        }
      }
      if (event.type === 'input_audio_buffer.speech_stopped') {
        const turn = items.get('you:' + event.item_id);
        if (turn) {
          turn.end = at;
          if (Number.isFinite(event.audio_end_ms) && Number.isFinite(turn.audioStart)) {
            turn.at = Math.max(0, at - (event.audio_end_ms - turn.audioStart) / 1000);
          }
        }
      }
      const speaker = event.type === 'conversation.item.input_audio_transcription.completed' ? 'you' : 'alex';
      const final = ['conversation.item.input_audio_transcription.completed', 'response.output_audio_transcript.done'].includes(event.type);
      if (call.startedAt && (final || ['input_audio_buffer.speech_started', 'response.output_audio_transcript.delta'].includes(event.type))) {
        const key = speaker === 'you' || event.type === 'input_audio_buffer.speech_started'
          ? 'you:' + event.item_id : 'alex:' + event.item_id + ':' + event.content_index;
        let turn = items.get(key);
        if (!turn) {
          const timing = key.startsWith('alex:') ? outputTimes.get(event.response_id) ?? { turns: [] } : null;
          turn = { speaker: timing ? 'alex' : 'you', at: timing?.at ?? at, end: timing?.end, text: '' };
          if (event.type === 'input_audio_buffer.speech_started') turn.audioStart = event.audio_start_ms;
          if (timing) {
            (timing.turns ??= []).push(turn);
            outputTimes.set(event.response_id, timing);
          }
          items.set(key, turn);
          call.turns.push(turn);
        }
        turn.text = event.transcript ?? (turn.text + (event.delta ?? ''));
      }
      if (call.ending) return;
      switch (event.type) {
        case 'session.created':
          clearTimeout(call.timer);
          startRecording(call);
          status.textContent = 'Connected. Alex will say hello.';
          if (call.mode === 'mock') {
            startExam(call, (text, stage) => {
              audio.muted = false;
              call.manualDiscussion = Boolean(stage.discussion);
              if (call.examResponse) channel.send(JSON.stringify({ type: 'response.cancel', response_id: call.examResponse }));
              if (call.examOutput) channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
              channel.send(JSON.stringify({
                type: 'session.update',
                session: { type: 'realtime', audio: { input: {
                  turn_detection: { type: 'semantic_vad', eagerness: 'low', create_response: !stage.wait && !stage.quietAfterPrompt && !stage.discussion, interrupt_response: !stage.wait },
                } } },
              }));
              channel.send(JSON.stringify({
                type: 'conversation.item.create',
                item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
              }));
              channel.send(JSON.stringify({ type: 'response.create' }));
            });
            reset.hidden = true;
          } else {
            channel.send(JSON.stringify({ type: 'response.create' }));
          }
          break;
        case 'response.created':
          call.examResponse = event.response?.id;
          break;
        case 'input_audio_buffer.committed':
          if (call.manualDiscussion && !call.exam.discussionTurn()) {
            channel.send(JSON.stringify({ type: 'response.create' }));
          }
          break;
        case 'output_audio_buffer.started':
          call.examOutput = event.response_id;
          panel.setAttribute('data-speaking', '');
          status.textContent = 'Alex is speaking…';
          break;
        case 'output_audio_buffer.stopped':
          if (call.examOutput === event.response_id) {
            call.examOutput = undefined;
            call.exam?.examinerFinished();
          }
          panel.removeAttribute('data-speaking');
          status.textContent = 'Alex is listening.';
          break;
        case 'output_audio_buffer.cleared':
          if (call.examOutput === event.response_id) call.examOutput = undefined;
        case 'input_audio_buffer.speech_started':
          panel.removeAttribute('data-speaking');
          status.textContent = 'Alex is listening.';
          break;
        case 'response.done':
          if (call.examResponse === event.response?.id) call.examResponse = undefined;
          if (event.response?.status === 'failed') finish(call, 'OpenAI could not reply. Check your API credits and usage limits.');
          break;
        case 'error':
          status.textContent = 'OpenAI reported a voice error.';
          break;
      }
    } catch {
      finish(call, 'Could not process the OpenAI voice stream.');
    }
  });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const answer = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: call.abort.signal,
  });
  if (!answer.ok) {
    if (answer.status === 401 || answer.status === 503) setup.open = true;
    throw new Error(await answer.text());
  }
  const sdp = await answer.text();
  if (activeCall === call && !call.ending) await peer.setRemoteDescription({ type: 'answer', sdp });
}

playVoice.addEventListener('click', async () => {
  try {
    await audio.play();
    playVoice.hidden = true;
  } catch {
    status.textContent = 'Audio playback was blocked. Check your browser’s sound settings.';
  }
});

async function startCall(previousId) {
  if (activeCall || start.disabled) return;
  const mode = modes.querySelector(':checked').value;
  const call = { mode, limit: mode === 'mock' ? 0 : Number(limit.value) * 60, abort: new AbortController(), turns: [], currentTurns: {}, playing: new Set(), playbackEnd: 0, resumeAttempts: 0 };
  const selectedProvider = provider.value;
  activeCall = call;
  start.hidden = true;
  end.hidden = false;
  modes.disabled = true;
  options.disabled = true;
  status.textContent = 'Allow microphone access to continue.';

  try {
    call.context = new AudioContext(selectedProvider === 'gemini' ? { sampleRate: 16000 } : undefined);
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
    call.input = call.context.createMediaStreamSource(microphone);
    call.output = call.context.createGain();
    const path = '/call/' + selectedProvider + '/' + mode + (previousId && mode === 'chat' ? '?continue=' + encodeURIComponent(previousId) : '');
    if (selectedProvider === 'openai') {
      await connectOpenAI(call, path);
      return;
    }
    await call.context.audioWorklet.addModule('/mic.js');
    if (activeCall !== call || call.ending) return;
    call.output.connect(call.context.destination);
    const capture = new AudioWorkletNode(call.context, 'microphone-capture', { numberOfOutputs: 0 });
    call.input.connect(capture);
    capture.port.onmessage = ({ data }) => {
      if (!call.ready || call.ending || call.socket?.bufferedAmount > 128000 ||
          !microphone.getAudioTracks()[0].enabled) return;
      if (call.recorder) {
        const samples = new Int16Array(data);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        if (Math.sqrt(energy / samples.length) > 450) {
          const end = recordingTime(call);
          if (!call.inputTiming) {
            call.inputTiming = call.currentTurns.you ?? { at: Math.max(0, end - samples.length / 16000) };
          }
          call.inputTiming.end = end;
        }
      }
      const encoded = btoa(String.fromCharCode(...new Uint8Array(data)));
      sendLive(call, { realtimeInput: { audio: { data: encoded, mimeType: 'audio/pcm;rate=16000' } } });
    };
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
modes.addEventListener('change', () => {
  limit.closest('label').hidden = modes.querySelector(':checked').value === 'mock';
});

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
function showSetup() {
  const name = provider.value === 'openai' ? 'OpenAI' : 'Gemini';
  document.querySelector('#key-label').textContent = name + ' API key';
  document.querySelector('#key').value = '';
  document.querySelector('#fallback').hidden = Boolean(configured[provider.value]);
  start.disabled = !canStart();
  if (activeCall || pendingSave) return;
  setup.open = !configured[provider.value];
  status.textContent = !configured[provider.value]
    ? 'Load a ' + name + ' key in Voice setup. Saved calls are available any time.'
    : canStart()
      ? 'Choose a practice mode and start your call.'
      : 'Open Alex in a current version of Chrome, Edge, or Firefox to use your microphone.';
}

provider.addEventListener('change', showSetup);

async function checkSetup() {
  try {
    const response = await fetch('/status');
    if (!response.ok) throw new Error();
    configured = (await response.json()).configured;
    showSetup();
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
    const response = await fetch('/setup/' + provider.value, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: key.value.trim() });
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
