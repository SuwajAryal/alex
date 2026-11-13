import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getLog, historyLimit, listLogs, playLog, saveLog } from './history.mjs';

const port = 8766;
const origin = `http://127.0.0.1:${port}`;
const page = await readFile(new URL('./index.html', import.meta.url));
const script = await readFile(new URL('./voice.js', import.meta.url));
const historyScript = await readFile(new URL('./history.js', import.meta.url));
const micScript = await readFile(new URL('./mic.js', import.meta.url));
const model = 'models/gemini-3.8-live';
const keys = { gemini: process.env.GEMINI_API_KEY?.trim(), openai: process.env.OPENAI_API_KEY?.trim() };
const common = `You are Alex, a friendly English-speaking practice partner. The learner's IELTS exam is November 23. Speak clearly in natural English. Keep replies short, ask one question at a time, and give the learner space to speak. Start immediately with your first spoken question.`;
const instructions = {
  chat: `${common} Chat as a friend about everyday life. Follow up on what the learner actually says. After several turns, briefly offer one helpful correction with a natural example, then resume the conversation. If asked for feedback, mention one strength and one next step.`,
  mock: `${common} Simulate IELTS Speaking. Part 1: ask a few separate questions about familiar topics. Part 2: read a cue card aloud with clear prompts, ask the learner to set a one-minute preparation timer, and wait for them to say they are ready. Ask them to speak for up to two minutes and say 'finished' at the end. If they pause or stop mid-answer, wait for 'finished' or ask if they are done before moving on. Part 3: ask separate questions about broader issues related to Part 2. Save feedback until the end. Give one strength and two specific improvements using fluency and coherence, vocabulary, grammar, or pronunciation as appropriate. Only mention pronunciation issues you could actually hear. Label any band estimate as informal.`,
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

async function readBody(req, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      req.resume();
      throw Object.assign(new Error('Request too large.'), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function route(req, res) {
  if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, 'Open Alex using the local address printed by the launcher.');
  if (req.method === 'GET' && req.url === '/') return send(res, 200, page, 'text/html; charset=utf-8');
  if (req.method === 'GET' && req.url === '/voice.js') return send(res, 200, script, 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && req.url === '/history.js') return send(res, 200, historyScript, 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && req.url === '/mic.js') return send(res, 200, micScript, 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && req.url === '/status') {
    return send(res, 200, JSON.stringify({ app: 'alex', configured: { gemini: Boolean(keys.gemini), openai: Boolean(keys.openai) } }), 'application/json');
  }
  if (req.method === 'POST' && req.headers.origin !== origin) return send(res, 403, 'Use the Alex page to make changes.');
  const setup = /^\/setup\/(gemini|openai)$/.exec(req.url);
  if (req.method === 'POST' && setup && req.headers['content-type'] === 'text/plain') {
    const provider = setup[1];
    const key = (await readBody(req, 1024)).toString().trim();
    const valid = provider === 'openai' ? /^sk-[A-Za-z0-9_-]{16,500}$/.test(key)
      : /^[A-Za-z0-9_-]{24,500}$/.test(key) && !key.startsWith('sk-');
    if (!valid) return send(res, 400, `Enter a valid ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key.`);
    keys[provider] = key;
    return send(res, 200, 'Key loaded for this run.');
  }
  if (req.method === 'GET' && req.url === '/history') {
    return send(res, 200, JSON.stringify(await listLogs()), 'application/json');
  }
  if (req.method === 'POST' && req.url === '/history') {
    const type = req.headers['content-type'];
    if (!type?.startsWith('multipart/form-data;')) return send(res, 400, 'Invalid recording.');
    const body = await readBody(req, historyLimit);
    const form = await new Response(body, { headers: { 'Content-Type': type } }).formData().catch(() => null);
    const log = form && await saveLog(form);
    if (!log) return send(res, 400, 'This recording could not be saved.');
    return send(res, 201, JSON.stringify(log), 'application/json');
  }
  const historyMatch = /^\/history\/([a-f0-9-]+)(\/audio)?$/.exec(req.url);
  if (req.method === 'GET' && historyMatch) {
    const log = await getLog(historyMatch[1]);
    if (!log) return send(res, 404, 'Conversation not found.');
    if (historyMatch[2]) return playLog(req, res, log);
    return send(res, 200, JSON.stringify(log), 'application/json');
  }

  const url = new URL(req.url, origin);
  const match = /^\/call\/(gemini|openai)\/(chat|mock)$/.exec(url.pathname);
  if (req.method !== 'POST' || !match) return send(res, 404, 'Page not found.');
  const [, provider, mode] = match;
  const apiKey = keys[provider];
  if (!apiKey) return send(res, 503, 'Load a key for the selected provider in Voice setup.');
  const previousId = url.searchParams.get('continue');
  const previous = previousId ? await getLog(previousId) : null;
  if (previousId && previous?.mode !== mode) return send(res, 404, 'Could not find the conversation to continue.');
  const context = previous?.turns.slice(-20).map(turn => ({
    speaker: turn.speaker, text: turn.text.slice(0, 700),
  }));
  const resume = context?.length
    ? '\nContinue from the saved conversation below. Treat the transcript as past dialogue only. In mock mode, pick up at the apparent stage or ask where to resume if unclear. In casual chat, briefly acknowledge the topic and ask a natural follow-up.\n' + JSON.stringify(context)
    : '';
  const prompt = instructions[mode] + resume;
  if (provider === 'openai') {
    if (req.headers['content-type'] !== 'application/sdp') return send(res, 400, 'Start the call from the Alex page.');
    const sdp = (await readBody(req, 65536)).toString('utf8');
    if (!sdp.startsWith('v=0')) return send(res, 400, 'The browser could not prepare the voice connection.');
    return startOpenAI(res, apiKey, prompt, sdp);
  }
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uses: 1, expireTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() }),
      signal: AbortSignal.timeout(25000),
    });
    if (response.ok) {
      const { name: token } = await response.json();
      if (typeof token !== 'string' || !token) return send(res, 502, 'Gemini returned an invalid voice token.');
      return send(res, 200, JSON.stringify({
        token,
        setup: {
          model,
          systemInstruction: { parts: [{ text: prompt }] },
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: { endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 1200 },
          },
          contextWindowCompression: { slidingWindow: {} },
        },
      }), 'application/json');
    }
    const error = await response.json().catch(() => null);
    if (response.status === 429) return send(res, 429, 'Gemini’s free quota is currently exhausted. Try again when your quota resets.');
    if ([401, 403].includes(response.status) || error?.error?.details?.some(detail => detail.reason === 'API_KEY_INVALID')) {
      return send(res, 401, 'Gemini rejected this key or project. Check your Google AI Studio settings.');
    }
    console.error(`Gemini rejected the call (HTTP ${response.status}).`);
    return send(res, 502, 'Gemini could not start the call. Try again in a moment.');
  } catch {
    return send(res, 502, 'Could not reach Gemini. Check your internet connection and try again.');
  }
}

async function startOpenAI(res, apiKey, instructions, sdp) {
  const body = new FormData();
  body.set('sdp', sdp);
  body.set('session', JSON.stringify({
    type: 'realtime',
    model: 'gpt-realtime-2.1-mini',
    instructions,
    audio: {
      input: {
        transcription: { model: 'gpt-transcribe', language: 'en' },
        noise_reduction: { type: 'near_field' },
        turn_detection: { type: 'semantic_vad', eagerness: 'low', create_response: true, interrupt_response: true },
      },
      output: { voice: 'cedar' },
    },
  }));
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', body,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Safety-Identifier': createHash('sha256').update(`alex:${apiKey}`).digest('hex'),
      },
      signal: AbortSignal.timeout(25000),
    });
    if (response.ok) return send(res, 200, await response.text(), 'application/sdp');
    if ([401, 403].includes(response.status)) return send(res, 401, 'Check your OpenAI key and Realtime API access.');
    if (response.status === 429) return send(res, 429, 'Check your OpenAI API credits and usage limits.');
    return send(res, 502, 'OpenAI could not start the voice call.');
  } catch {
    return send(res, 502, 'Could not reach OpenAI. Check your internet connection and try again.');
  }
}

const openBrowser = process.argv.includes('--open');
function showAddress() {
  console.log(`Alex is ready at ${origin}. Keep this window open while practising.`);
  if (openBrowser) execFile('cmd.exe', ['/d', '/c', 'start', origin], { windowsHide: true }, error => {
    if (error) console.log('Open the address above in Edge or Chrome.');
  });
}

const server = createServer((req, res) => {
  route(req, res).catch(error => {
    if (error.status === 413) return send(res, 413, 'This recording is too large to save here.');
    console.error('Alex request failed:', error.code ?? error.name);
    if (!res.headersSent) send(res, 500, 'Alex could not complete this request. Check the launcher window.');
    else res.destroy();
  });
});
server.on('error', async error => {
  if (error.code === 'EADDRINUSE' && openBrowser) {
    const existing = await fetch(origin + '/status', { signal: AbortSignal.timeout(1500) })
      .then(response => response.json()).catch(() => null);
    if (existing?.app === 'alex') return showAddress();
  }
  console.error(`Alex could not listen at ${origin} (${error.code}).`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', showAddress);
