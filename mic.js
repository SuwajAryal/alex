class MicrophoneCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(Math.round(sampleRate * 0.04));
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      const sample = Math.max(-1, Math.min(1, value));
      this.samples[this.offset++] = sample * (sample < 0 ? 32768 : 32767);
      if (this.offset === this.samples.length) {
        const buffer = this.samples.buffer;
        this.port.postMessage(buffer, [buffer]);
        this.samples = new Int16Array(Math.round(sampleRate * 0.04));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('microphone-capture', MicrophoneCapture);
