const panel = document.querySelector('#listening-panel');
const form = document.querySelector('#clip-form');
const link = document.querySelector('#clip-link');
const file = document.querySelector('#clip-file');
const player = document.querySelector('#clip-player');
const status = document.querySelector('#clip-status');
const maxBytes = 12 * 1024 * 1024;
const extensions = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', aiff: 'audio/aiff' };
let notes, objectUrl, operation;

export const preparedNotes = () => notes;
export const stopClip = () => player.pause();
export function showListening(visible, busy = false) {
  panel.hidden = !visible;
  form.querySelector('fieldset').disabled = busy;
}

function clearClip() {
  operation?.abort();
  operation = undefined;
  notes = undefined;
  player.pause();
  player.removeAttribute('src');
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  player.hidden = true;
  status.textContent = '';
  panel.dispatchEvent(new Event('clip-change'));
}

link.addEventListener('input', () => { file.value = ''; clearClip(); });
file.addEventListener('change', () => { link.value = ''; clearClip(); });

async function readLink(value, signal) {
  let url;
  try { url = new URL(value); } catch {}
  if (url?.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Paste a public HTTPS link directly to an audio file.');
  }
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal }).catch(() => null);
  if (!response?.ok || !response.body) throw new Error('This link blocks direct access. Download the audio and choose the file below.');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Choose a clip under 12 MB.');
  const type = response.headers.get('content-type')?.split(';')[0] ?? '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Choose a clip under 12 MB.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new File(chunks, url.pathname, { type });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearClip();
  const controller = new AbortController();
  operation = controller;
  status.textContent = 'Loading clip…';
  try {
    const clip = file.files[0] ?? await readLink(link.value.trim(), AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]));
    if (controller.signal.aborted) return;
    if (!clip.size || clip.size > maxBytes) throw new Error('Choose an audio clip under 12 MB.');
    const type = clip.type.startsWith('audio/') ? clip.type : extensions[clip.name.toLowerCase().split('.').pop()];
    if (!type) throw new Error('Use a direct audio file link or choose an MP3, WAV, OGG, FLAC, AAC or AIFF file.');
    objectUrl = URL.createObjectURL(new Blob([clip], { type }));
    player.src = objectUrl;
    player.hidden = false;
    status.textContent = 'You can listen now while Alex prepares.';
    const response = await fetch('/listening/analyze', {
      method: 'POST', headers: { 'Content-Type': type }, body: clip, signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    if (controller.signal.aborted) return;
    notes = result.notes;
    status.textContent = 'Alex is ready. When you’re done listening, start the conversation.';
    panel.dispatchEvent(new Event('clip-change'));
  } catch (error) {
    if (!controller.signal.aborted) status.textContent = error.message || 'Could not prepare the clip.';
  } finally {
    if (operation === controller) operation = undefined;
  }
});
