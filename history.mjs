import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('./history/', import.meta.url));
const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const formats = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
export const historyLimit = 48 * 1024 * 1024;

export async function getLog(id) {
  if (!idPattern.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(root, id, 'conversation.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function listLogs() {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const logs = await Promise.all(entries.filter(entry => entry.isDirectory() && idPattern.test(entry.name)).map(entry => getLog(entry.name)));
  return logs.filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(({ id, mode, startedAt, duration, bytes, filename }) => ({ id, mode, startedAt, duration, bytes, filename }));
}

export async function saveLog(form) {
  const audio = form.get('audio');
  const type = audio instanceof File ? audio.type.split(';')[0] : '';
  const extension = Object.hasOwn(formats, type) ? formats[type] : null;
  let metadata;
  try {
    metadata = JSON.parse(form.get('metadata'));
  } catch {
    return null;
  }
  if (!extension || !audio.size || !metadata || !['chat', 'mock'].includes(metadata.mode) ||
      !Number.isFinite(metadata.duration) || metadata.duration < 0 ||
      !Number.isFinite(Date.parse(metadata.startedAt)) || !Array.isArray(metadata.turns)) return null;
  const turns = metadata.turns.slice(0, 3000).flatMap(turn => {
    if (!turn || !['you', 'alex'].includes(turn.speaker) || typeof turn.text !== 'string' ||
        !Number.isFinite(turn.at) || turn.at < 0) return [];
    return [{ speaker: turn.speaker, text: turn.text.trim().slice(0, 4000), at: turn.at }];
  }).filter(turn => turn.text).sort((a, b) => a.at - b.at);
  const id = randomUUID();
  const filename = 'audio.' + extension;
  const log = {
    id, mode: metadata.mode, startedAt: new Date(metadata.startedAt).toISOString(),
    duration: Math.round(metadata.duration), turns, filename, type, bytes: audio.size,
  };
  await mkdir(root, { recursive: true });
  const pending = join(root, '.' + id);
  await mkdir(pending);
  try {
    await writeFile(join(pending, filename), Buffer.from(await audio.arrayBuffer()));
    await writeFile(join(pending, 'conversation.json'), JSON.stringify(log, null, 2));
    await rename(pending, join(root, id));
  } catch (error) {
    await rm(pending, { recursive: true, force: true });
    throw error;
  }
  return log;
}

export async function playLog(req, res, log) {
  const path = join(root, log.id, log.filename);
  const { size } = await stat(path);
  let start = 0;
  let end = size - 1;
  const headers = { 'Content-Type': log.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range?.[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else if (range?.[2]) {
      start = Math.max(0, size - Number(range[2]));
    }
    if (!range || (!range[1] && !range[2]) || start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
      return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(req.headers.range ? 206 : 200, headers);
  const stream = createReadStream(path, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
