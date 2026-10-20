import { settings } from './settings';

// Every sound is synthesized: zero audio files, zero network.
let ac: AudioContext | null = null;
let out: GainNode;

function ctx(): AudioContext | null {
  if (!settings.sound) return null;
  if (!ac) {
    try {
      ac = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.connect(ac.destination);
    out = ac.createGain();
    out.gain.value = 0.55;
    out.connect(comp);
  }
  out.gain.value = 0.55 * settings.volume;
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

/** Call from a user gesture so mobile browsers allow sound later. */
export function unlockAudio() {
  ctx();
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  at?: number;
  to?: number;
}

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
function click(gain = 0.25, hp = 2400, dur = 0.018, at = 0) {
  const c = ctx();
  if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.05), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  }
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.02);
}

let burstBuf: AudioBuffer | null = null;
/** A longer filtered noise burst (crashes, wind). */
function burst(gain: number, lp: number, dur: number, at = 0) {
  const c = ctx();
  if (!c) return;
  if (!burstBuf) {
    burstBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.8), c.sampleRate);
    const d = burstBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = burstBuf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(lp, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, lp * 0.08), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + Math.min(0.8, dur + 0.05));
}

export const sfx = {
  /** Slipstream's engine room: kick, hat and bass, scheduled ahead (`at` = seconds from now). */
  kick: (at = 0) => {
    tone(150, 0.16, { gain: 0.3, at, to: 42 });
    click(0.05, 3200, 0.006, at);
  },
  hat: (at = 0) => click(0.06, 7500, 0.022, at),
  bass: (f: number, at = 0, dur = 0.16) => tone(f, dur, { type: 'sawtooth', gain: 0.035, at, attack: 0.006 }),
  /** A graze: a bright blip that climbs with the chain. */
  graze: (chain: number) => tone(1320 * 2 ** (Math.min(chain, 12) / 12), 0.07, { type: 'square', gain: 0.022 }),
  gear: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.05, at: i * 0.045 })),
  crash: () => {
    burst(0.5, 5200, 0.7);
    tone(110, 0.55, { type: 'sawtooth', gain: 0.1, to: 28 });
  },
  /** A shield charged: a bright rising triad. */
  shield: () => [659.25, 987.77, 1318.5].forEach((f, i) => tone(f, 0.32, { gain: 0.05, at: i * 0.06 })),
  /** A shield breaks a wall: glass and a falling tone. */
  shatter: () => {
    burst(0.4, 9000, 0.4);
    tone(880, 0.3, { type: 'triangle', gain: 0.06, to: 180 });
  },
  /** A perfect graze: air rushing past as time slows. */
  whoosh: () => {
    burst(0.22, 2400, 0.45);
    tone(300, 0.4, { type: 'sine', gain: 0.05, to: 120 });
  },
  /** Mechanical input click. */
  tick: () => click(0.22, 2600),
  soft: () => click(0.12, 1800, 0.012),
  press: () => {
    click(0.16, 3000, 0.012);
    tone(520, 0.06, { gain: 0.05 });
  },
  release: () => {
    click(0.2, 2000, 0.016);
    tone(390, 0.07, { gain: 0.05 });
  },
  /** Metronome pulse (ECHO). `at` is seconds from now. */
  pulse: (at = 0) => {
    click(0.3, 1400, 0.02, at);
    tone(1760, 0.05, { gain: 0.08, at });
  },
  step: () => tone(1200, 0.05, { gain: 0.04 }),
  /** Round judgement: higher tier and longer combo → higher, brighter chime (tier 1 good … 4 exact). */
  chime: (tier: number, combo: number) => {
    const f = 660 * 2 ** ((tier * 3 + Math.min(combo, 8)) / 12);
    tone(f, 0.16, { gain: 0.05 });
    if (tier >= 3) tone(f * 1.5, 0.22, { gain: 0.03, at: 0.07 });
    if (tier >= 4) tone(f * 2, 0.3, { gain: 0.025, at: 0.14 });
  },
  /** A star landing on the result screen (n = 1, 2, 3). */
  star: (n: number) => tone(880 * 2 ** ((n * 4) / 12), 0.22, { gain: 0.06, attack: 0.002 }),
  result: () => tone(660, 0.18, { gain: 0.06 }),
  near: () => {
    tone(1318.5, 0.35, { gain: 0.07 });
    tone(1975.5, 0.3, { gain: 0.025, at: 0.05 });
  },
  /** Exact: a small glass bell. Rare by design. */
  perfect: () => {
    const f = 1046.5;
    tone(f, 2.2, { gain: 0.12, attack: 0.002 });
    tone(f * 2.76, 1.2, { gain: 0.035, attack: 0.002 });
    tone(f * 5.4, 0.5, { gain: 0.015, attack: 0.002 });
    tone(f * 1.5, 2.0, { gain: 0.07, at: 0.11 });
    tone(f * 2, 1.8, { gain: 0.045, at: 0.22 });
  },
  record: () => {
    [784, 987.8, 1174.7].forEach((f, i) => tone(f, 0.4, { gain: 0.06, at: i * 0.075 }));
  },
  over: () => tone(170, 0.22, { type: 'triangle', gain: 0.14, to: 110 }),
  fail: () => {
    tone(110, 0.25, { type: 'triangle', gain: 0.16, to: 70 });
    click(0.15, 400, 0.05);
  },
  thud: () => {
    tone(90, 0.18, { gain: 0.22, to: 55 });
    click(0.12, 600, 0.03);
  },
};
export type Sfx = typeof sfx;
