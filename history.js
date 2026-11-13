const list = document.querySelector('#history-list');
const historyStatus = document.querySelector('#history-status');
const detail = document.querySelector('#log');
const recording = document.querySelector('#recording');
const download = document.querySelector('#download');
const turns = document.querySelector('#turns');
const practiceAgain = document.querySelector('#practice-again');
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const modeName = mode => mode === 'mock' ? 'IELTS mock' : 'Casual chat';
let selected;

function clock(seconds) {
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

function show(log) {
  detail.hidden = false;
  document.querySelector('#log-title').textContent = modeName(log.mode);
  recording.src = '/history/' + log.id + '/audio';
  download.href = recording.src;
  download.download = 'alex-' + log.startedAt.slice(0, 10) + '-' + log.id.slice(0, 8) + '-' + log.filename;
  practiceAgain.dataset.mode = log.mode;
  practiceAgain.dataset.id = log.id;
  turns.replaceChildren(...log.turns.map(turn => {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = (turn.speaker === 'you' ? 'You' : 'Alex') + ' · ' + clock(turn.at);
    const text = document.createElement('p');
    text.textContent = turn.text;
    row.append(name, text);
    return row;
  }));
  document.querySelector('#no-turns').hidden = log.turns.length > 0;
}

async function select(id) {
  selected = id;
  for (const button of list.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.id === id));
  }
  try {
    const response = await fetch('/history/' + id);
    if (!response.ok) throw new Error();
    const log = await response.json();
    if (selected === id) {
      show(log);
      historyStatus.textContent = '';
    }
  } catch {
    if (selected === id) historyStatus.textContent = 'Could not open that conversation.';
  }
}

export async function refreshHistory(openId) {
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
    if (openId) await select(openId);
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
  recording.pause();
  start.scrollIntoView({ block: 'center' });
  start.dispatchEvent(new CustomEvent('continue-call', { detail: practiceAgain.dataset.id }));
});
