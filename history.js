import { makePlayer } from './playback.js';

const list = document.querySelector('#history-list');
const historyStatus = document.querySelector('#history-status');
const detail = document.querySelector('#log');
const player = makePlayer();
const download = document.querySelector('#download');
const turns = document.querySelector('#turns');
const practiceAgain = document.querySelector('#practice-again');
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const modeName = mode => ({ mock: 'IELTS mock', listening: 'Clip discussion', chat: 'Casual chat' })[mode] ?? 'Casual chat';
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
    const titles = { coherence: 'Fluency and coherence', vocabulary: 'Lexical resource', grammar: 'Grammatical range and accuracy', pronunciation: 'Pronunciation' };
    const rows = feedback.version === 2 ? [
      ['Estimated Speaking band', feedback.overall === null ? 'Insufficient evidence for an overall estimate' : feedback.overall.toFixed(1)],
      ['Review coverage', (feedback.audioIncluded ? 'Transcript and recording supplied. ' : 'Transcript only. ') + feedback.coverage],
      ['What worked', feedback.strength],
      ...Object.entries(titles).map(([key, title]) => {
        const criterion = feedback.criteria[key];
        return [title + ' · ' + (criterion.band === null ? 'Not scored' : 'Band ' + criterion.band.toFixed(1)),
          criterion.evidence + '\n\nTry: ' + criterion.tip];
      }),
      ['Next speaking drill', feedback.drill],
    ] : [
      ['What worked', feedback.strength],
      ...Object.entries(titles).filter(([key]) => feedback[key]).map(([key, title]) => [title, feedback[key]]),
      ['Next speaking drill', feedback.drill],
    ];
    feedbackResult.replaceChildren(...rows.flatMap(([title, content]) => {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = title;
      description.textContent = content;
      return [term, description];
    }));
    generate.hidden = feedback.version === 2;
    if (!generate.hidden) generate.textContent = 'Update feedback with band estimates';
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
  practiceAgain.hidden = log.mode === 'listening';
  practiceAgain.dataset.id = log.id;
  practiceAgain.textContent = log.mode === 'mock' ? 'Start a new IELTS mock' : 'Continue this conversation';
  document.querySelector('#resume-note').hidden = log.mode !== 'chat';
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
  generate.textContent = 'Generate feedback';
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
