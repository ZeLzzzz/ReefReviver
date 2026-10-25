import { vi } from "vitest";

// A stand-in for the browser's AudioContext (jsdom has none): it records the nodes the engine makes and what it sets
// on them. A parameter's `value` follows the last value set, as if every glide had finished.

export class FakeParam {
  value = 0;
  /** The glides asked for: the value aimed at and the time constant. */
  glides: { value: number; tc: number }[] = [];
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }
  setTargetAtTime(value: number, _time: number, tc: number) {
    this.value = value;
    this.glides.push({ value, tc });
  }
}

export class FakeNode {
  to: FakeNode[] = [];
  connect(node: FakeNode) {
    this.to.push(node);
    return node;
  }
  disconnect() {}
}

export class FakeGain extends FakeNode {
  gain = new FakeParam();
}

export class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
}

export class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  started: number[] = [];
  start(when = 0) {
    this.started.push(when);
  }
  stop() {}
}

export class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  started: number[] = [];
  start(when = 0) {
    this.started.push(when);
  }
  stop() {}
}

export class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData() {}
}

export class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state: "running" | "suspended" = "running";
  destination = new FakeNode();
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  oscillators: FakeOscillator[] = [];
  sources: FakeSource[] = [];
  /** What decodeAudioData does; make it reject to fail the music. */
  decode: () => Promise<{ duration: number }> = async () => ({ duration: 16.67 });
  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  decodeAudioData(_bytes: ArrayBuffer) {
    return this.decode();
  }

  // The engine makes its buses in this order (see AudioEngine.ensure).
  get master() {
    return this.gains[0];
  }
  get musicBus() {
    return this.gains[1];
  }
  get effectsBus() {
    return this.gains[2];
  }
  get worldBus() {
    return this.gains[3];
  }
  get menuBus() {
    return this.gains[4];
  }
  get musicFilter() {
    return this.filters[0];
  }
}

/** Lets the engine's pending promises (the music's fetch and decode) finish. */
export const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
