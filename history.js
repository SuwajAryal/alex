import { makePlayer } from './playback.js';

const list = document.querySelector('#history-list');
const historyStatus = document.querySelector('#history-status');
const detail = document.querySelector('#log');
const player = makePlayer();
const download = document.querySelector('#download');
const turns = document.querySelector('#turns');
const practiceAgain = document.querySelector('#practice-again');
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const modeName = mode => mode === 'mock' ? 'IELTS mock' : 'Casual chat';
let selected;
let selection = 0;
const feedbackPanel = document.querySelector('#feedback');
const feedbackStatus = document.querySelector('#feedback-status');
const feedbackResult = document.querySelector('#feedback-result');
const generate = document.querySelector('#generate-feedback');

async function review(id, create = false) {
  const current = selection;
  generate.disabled = true;
  feedbackStatus.textContent = create ? 'Generating feedback…' : '';
  try {
    const response = await fetch('/history/' + id + '/feedback', { method: create ? 'POST' : 'GET' });
    if (!response.ok) throw new Error(await response.text());
    const feedback = await response.json();
    if (selection !== current) return;
    feedbackStatus.textContent = '';
    if (!feedback) return;
    const fields = { strength: 'What worked', coherence: 'Answer development and coherence', vocabulary: 'Vocabulary', grammar: 'Grammar', drill: 'Try this speaking drill' };
    feedbackResult.replaceChildren(...Object.entries(fields).flatMap(([key, title]) => {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = title;
      description.textContent = feedback[key];
      return [term, description];
    }));
    generate.hidden = true;
  } catch (error) {
    if (selection === current) feedbackStatus.textContent = error.message;
  } finally {
    if (selection === current) generate.disabled = false;
  }
}

generate.addEventListener('click', () => review(selected, true));

function clock(seconds) {
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

function show(log, autoFeedback) {
  detail.hidden = false;
  document.querySelector('#log-title').textContent = modeName(log.mode);
  download.href = '/history/' + log.id + '/audio';
  player.open(download.href, log.duration);
  download.download = 'alex-' + log.startedAt.slice(0, 10) + '-' + log.id.slice(0, 8) + '-' + log.filename;
  practiceAgain.dataset.mode = log.mode;
  practiceAgain.dataset.id = log.id;
  practiceAgain.textContent = log.mode === 'mock' ? 'Start a new IELTS mock' : 'Continue this conversation';
  document.querySelector('#resume-note').hidden = log.mode === 'mock';
  turns.replaceChildren(...log.turns.map((turn, index) => {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = (turn.speaker === 'you' ? 'You' : 'Alex') + ' · ' + clock(turn.at);
    const text = document.createElement('span');
    text.textContent = turn.text;
    const button = document.createElement('button');
    button.type = 'button';
    button.append(name, text);
    const at = Math.max(0, Math.min(turn.at, log.duration));
    let following = index + 1;
    while (following < log.turns.length && log.turns[following].at <= at) following++;
    const next = log.turns[following]?.at ?? log.duration;
    const start = turn.end > at ? at : Math.min(Math.max(0, at - 1), Math.max(0, log.duration - 1));
    const end = turn.end > at ? turn.end : Math.min(log.duration, Math.max(next, start + 2));
    button.addEventListener('click', () => player.segment(start, end));
    row.append(button);
    return row;
  }));
  document.querySelector('#no-turns').hidden = log.turns.length > 0;
  feedbackPanel.hidden = log.mode !== 'mock';
  feedbackStatus.textContent = '';
  feedbackResult.replaceChildren();
  generate.hidden = false;
  if (log.mode === 'mock') review(log.id, autoFeedback && log.turns.some(turn => turn.speaker === 'you'));
}

async function select(id, autoFeedback = false) {
  selected = id;
  const current = ++selection;
  detail.hidden = true;
  player.pause();
  for (const button of list.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.id === id));
  }
  try {
    const response = await fetch('/history/' + id);
    if (!response.ok) throw new Error();
    const log = await response.json();
    if (selection === current) {
      show(log, autoFeedback);
      historyStatus.textContent = '';
    }
  } catch {
    if (selection === current) historyStatus.textContent = 'Could not open that conversation.';
  }
}

export async function refreshHistory(openId, autoFeedback = false) {
  try {
    const response = await fetch('/history');
    if (!response.ok) throw new Error();
    const logs = await response.json();
    list.replaceChildren(...logs.map(log => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.dataset.id = log.id;
      button.textContent = modeName(log.mode);
      button.setAttribute('aria-pressed', String(selected === log.id));
      const meta = document.createElement('small');
      meta.textContent = dates.format(new Date(log.startedAt)) + ' · ' + clock(log.duration) + ' · ' + Math.ceil(log.bytes / 1024) + ' KB';
      button.append(meta);
      button.addEventListener('click', () => select(log.id));
      row.append(button);
      return row;
    }));
    historyStatus.textContent = logs.length ? '' : 'Your saved conversations will appear here.';
    if (openId) await select(openId, autoFeedback);
  } catch {
    historyStatus.textContent = 'Could not load practice history.';
  }
}

practiceAgain.addEventListener('click', () => {
  const start = document.querySelector('#start');
  if (start.hidden || start.disabled) {
    document.querySelector('#status').scrollIntoView({ block: 'center' });
    return;
  }
  document.querySelector('input[name="mode"][value="' + practiceAgain.dataset.mode + '"]').checked = true;
  document.querySelector('#modes').dispatchEvent(new Event('change'));
  player.pause();
  start.scrollIntoView({ block: 'center' });
  start.dispatchEvent(new CustomEvent('continue-call', { detail: practiceAgain.dataset.id }));
});
