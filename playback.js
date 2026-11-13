export function makePlayer() {
  const toggle = document.querySelector('#play-recording');
  const slider = document.querySelector('#seek-recording');
  const clock = document.querySelector('#recording-time');
  const status = document.querySelector('#playback-status');
  let url, context, buffer, loading, source, clip, frame;
  let cursor = 0, started = 0, stopAt = 0, action = 0;

  function time(value) {
    return Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0');
  }

  function update() {
    cancelAnimationFrame(frame);
    const position = source ? Math.min(stopAt, cursor + context.currentTime - started) : cursor;
    slider.value = position;
    clock.textContent = time(position) + ' / ' + time(Number(slider.max));
    toggle.textContent = source ? 'Pause' : 'Play';
    if (source) frame = requestAnimationFrame(update);
  }

  function pause() {
    action++;
    if (source) {
      cursor = Math.min(stopAt, cursor + context.currentTime - started);
      const playing = source;
      source = undefined;
      playing.stop();
    }
    update();
  }

  function open(path, duration) {
    pause();
    loading?.abort.abort();
    loading = buffer = clip = undefined;
    cursor = 0;
    url = path;
    slider.max = duration;
    status.textContent = '';
    update();
  }

  async function play(at, segment) {
    pause();
    const request = action;
    clip = segment;
    try {
      context ??= new AudioContext({ sampleRate: 16000 });
      await context.resume();
      if (request !== action) return;
      if (!buffer) {
        status.textContent = 'Preparing audio…';
        if (!loading) {
          const abort = new AbortController();
          const promise = fetch(url, { signal: abort.signal }).then(response => {
            if (!response.ok) throw new Error();
            return response.arrayBuffer();
          }).then(bytes => context.decodeAudioData(bytes));
          loading = { abort, promise };
        }
        const decoded = await loading.promise;
        if (request !== action) return;
        buffer = decoded;
        slider.max = buffer.duration;
      }
      status.textContent = '';
      stopAt = Math.min(buffer.duration, segment?.end ?? buffer.duration);
      cursor = Math.min(stopAt, Math.max(0, at));
      if (cursor >= stopAt) cursor = Math.min(segment?.start ?? 0, stopAt);
      if (cursor >= stopAt) return update();
      const playing = context.createBufferSource();
      playing.buffer = buffer;
      playing.connect(context.destination);
      source = playing;
      started = context.currentTime;
      playing.onended = () => {
        if (source !== playing) return;
        source = undefined;
        cursor = stopAt;
        clip = undefined;
        update();
      };
      playing.start(started, cursor, stopAt - cursor);
      update();
    } catch {
      if (request !== action) return;
      if (source) pause();
      loading = undefined;
      status.textContent = 'Could not play this recording here. Try downloading the audio.';
      update();
    }
  }

  toggle.addEventListener('click', () => source ? pause() : play(cursor, clip));
  slider.addEventListener('input', () => {
    const target = Number(slider.value);
    const wasPlaying = Boolean(source);
    pause();
    clip = undefined;
    cursor = target;
    update();
    if (wasPlaying) play(target);
  });
  return { open, pause, segment: (start, end) => play(start, { start, end }) };
}
