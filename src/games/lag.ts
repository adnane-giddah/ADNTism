// 43 · LAG — control a system that obeys you late.
// The simulation runs on a fixed 1/120 s step, independent of the frame rate. Every step records the
// command you are giving now; the system is driven by the command recorded D = round(τ / step) steps
// earlier — a plain first-in-first-out delay, nothing random or hidden. The tape at the bottom shows exactly
// that queue: the right end is what you press now, the left end is what is acting now. Five dynamics:
//   reach      ẋ = v·u(t − τ)                      (2-D, settle in the ring)
//   brake      v̇ = −b while the delayed brake is on (stop on the line)
//   steer      θ̇ = ω·u(t − τ), constant speed       (thread the gates)
//   stabilize  ẋ = λx + k·u(t − τ) + d(t)          (unstable: keep it in the band; d is a known smooth drift)
//   mixed      ẍ = k·u(t − τ) − c·ẋ                (momentum and damping: settle on the target)
// Feasibility is built in: braking at once always stops before the line; λτ ≤ 0.6 and the control
// authority beats the drift; gates are spaced within the turning circle; targets lie inside the field.
import { clamp, font, pal, text, TAU } from '../core/draw';
import { listen } from '../core/input';
import { alpha, plate, rr } from '../core/materials';
import type { Rng } from '../core/rng';
import type { GameFactory } from '../core/types';
import { AMBER, Bench, roundStrip } from './kit';
import { famChip, Session, type Band, type Family } from './lab';

export const DT = 1 / 120;
export type LagKind = 'reach' | 'brake' | 'steer' | 'stabilize' | 'mixed';
export type U = [number, number];

export interface LagSpec {
  kind: LagKind;
  tau: number;
  /** Ghost of where the queued commands will take the system (onboarding bands only). */
  ghost: boolean;
  /** Show the queued commands on the tape (hidden at mastery: only the acting command is shown). */
  tape: boolean;
  limit: number;
  start: { x: number; y: number };
  target?: { x: number; y: number; r: number };
  v0?: number;
  decel?: number;
  line?: number;
  wall?: number;
  speed?: number;
  omega?: number;
  gates?: { x: number; y: number; w: number }[];
  lambda?: number;
  dist?: { a: number; w: number; p: number }[];
  damp?: number;
  hold?: number;
}

const VMAX = 0.5;
const K_STAB = 1.5;
const K_MIX = 1.2;

export class LagSim {
  readonly D: number;
  step = 0;
  hist: U[] = [];
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  h = 0;
  constructor(readonly s: LagSpec) {
    this.D = Math.max(1, Math.round(s.tau / DT));
    this.x = s.start.x;
    this.y = s.start.y;
    this.vx = s.v0 ?? 0;
  }
  get t() {
    return this.step * DT;
  }
  /** The command acting now (recorded D steps ago). */
  applied(): U {
    const i = this.step - this.D;
    return i >= 0 ? this.hist[i] : [0, 0];
  }
  /** Commands recorded but not yet acting, oldest first. */
  pending(): U[] {
    return this.hist.slice(Math.max(0, this.step - this.D), this.step);
  }
  disturbance(t: number) {
    return (this.s.dist ?? []).reduce((a, d) => a + d.a * Math.sin(d.w * t + d.p), 0);
  }
  advance(u: U) {
    this.hist.push(u);
    const a = this.applied();
    const s = this.s;
    switch (s.kind) {
      case 'reach':
        this.x = clamp(this.x + VMAX * a[0] * DT, -1, 1);
        this.y = clamp(this.y + VMAX * a[1] * DT, -1, 1);
        break;
      case 'brake':
        if (a[0] > 0.5) this.vx = Math.max(0, this.vx - s.decel! * DT);
        this.x += this.vx * DT;
        break;
      case 'steer':
        this.h += s.omega! * a[0] * DT;
        this.x += s.speed! * Math.cos(this.h) * DT;
        this.y = clamp(this.y + s.speed! * Math.sin(this.h) * DT, -0.62, 0.62);
        break;
      case 'stabilize':
        this.x += (s.lambda! * this.x + K_STAB * a[0] + this.disturbance(this.t)) * DT;
        break;
      case 'mixed':
        this.vx += (K_MIX * a[0] - s.damp! * this.vx) * DT;
        this.x += this.vx * DT;
        if (Math.abs(this.x) > 1.2) {
          this.x = Math.sign(this.x) * 1.2;
          this.vx = 0;
        }
        break;
    }
    this.step++;
  }
  clone() {
    const c = new LagSim(this.s);
    Object.assign(c, { step: this.step, hist: this.hist.slice(), x: this.x, y: this.y, vx: this.vx, vy: this.vy, h: this.h });
    return c;
  }
}

const TAUS = [0.35, 0.6, 0.85, 1.1];
const tauOf = (r: Rng, band: Band) => Math.round((TAUS[band] + r.range(-0.05, 0.05)) * 100) / 100;

function base(r: Rng, band: Band, kind: LagKind): LagSpec {
  return { kind, tau: tauOf(r, band), ghost: band === 0, tape: band < 3, limit: 30, start: { x: 0, y: 0 } };
}

function genReach(r: Rng, band: Band): LagSpec {
  const s = base(r, band, 'reach');
  const a = r.range(0, TAU);
  const d = r.range(0.8, 1.3);
  const cx = r.range(-0.15, 0.15);
  const cy = r.range(-0.15, 0.15);
  s.start = { x: clamp(cx - (Math.cos(a) * d) / 2, -0.9, 0.9), y: clamp(cy - (Math.sin(a) * d) / 2, -0.9, 0.9) };
  s.target = { x: clamp(cx + (Math.cos(a) * d) / 2, -0.85, 0.85), y: clamp(cy + (Math.sin(a) * d) / 2, -0.85, 0.85), r: [0.12, 0.1, 0.08, 0.065][band] };
  s.hold = 1.5;
  const dist = Math.hypot(s.target.x - s.start.x, s.target.y - s.start.y);
  s.limit = Math.ceil((dist / VMAX + s.tau + s.hold) * 3 + 4);
  return s;
}

export const stopDist = (v0: number, b: number, tau: number) => v0 * tau + (v0 * v0) / (2 * b);

function genBrake(r: Rng, band: Band): LagSpec {
  const s = base(r, band, 'brake');
  s.v0 = r.range(0.45, 0.7);
  s.decel = r.range(0.25, 0.45);
  const minStop = stopDist(s.v0, s.decel, s.tau);
  // The line is beyond the shortest possible stop (braking from the first instant), never at it.
  s.line = minStop + r.range(0.25, 0.9);
  s.wall = s.line + r.range(0.18, 0.3);
  s.start = { x: 0, y: 0 };
  s.limit = 20;
  return s;
}

function genSteer(r: Rng, band: Band): LagSpec | null {
  const s = base(r, band, 'steer');
  s.speed = 0.32;
  s.omega = 1.6;
  const n = [4, 4, 5, 6][band];
  const w = [0.2, 0.16, 0.13, 0.11][band];
  const gates: { x: number; y: number; w: number }[] = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const x = 0.55 + (i * 2.25) / (n - 1 || 1);
    // Lateral change between gates stays inside what a turning circle of radius v/ω allows.
    const dy = r.sign() * r.range(0.08, [0.18, 0.24, 0.3, 0.34][band]);
    y = clamp(y + dy, -0.42, 0.42);
    gates.push({ x, y, w });
  }
  if (gates.every((g) => Math.abs(g.y) < 0.08)) return null;
  s.gates = gates;
  s.start = { x: 0, y: 0 };
  s.limit = 3.1 / s.speed + 3;
  return s;
}

function genStabilize(r: Rng, band: Band): LagSpec {
  const s = base(r, band, 'stabilize');
  // λτ ≤ 0.6 keeps the delayed loop stabilisable by a patient player.
  s.lambda = Math.min(r.range(0.6, 1.1), 0.6 / s.tau);
  s.dist = [
    { a: r.range(0.06, 0.12) * (1 + band * 0.2), w: r.range(0.5, 0.9), p: r.range(0, TAU) },
    { a: r.range(0.03, 0.07), w: r.range(1.3, 2.1), p: r.range(0, TAU) },
  ];
  s.start = { x: r.sign() * r.range(0.05, 0.15), y: 0 };
  s.limit = [15, 18, 22, 25][band];
  return s;
}

function genMixed(r: Rng, band: Band): LagSpec {
  const s = base(r, band, 'mixed');
  s.damp = r.range(0.2, 0.9) * (band >= 2 ? 0.6 : 1);
  s.start = { x: 0, y: 0 };
  s.target = { x: r.sign() * r.range(0.45, 0.85), y: 0, r: [0.075, 0.06, 0.05, 0.04][band] };
  s.hold = 1.5;
  s.limit = 30;
  return s;
}

const tauBucket = (t: number) => Math.round(t * 10);
export const FAMILIES: Family<LagSpec>[] = [
  { id: 'reach', name: 'Constant delay', teach: 'Steer the dot into the ring and keep it there. Your commands arrive late — watch the tape.', bands: [0, 3], intro: true, gen: genReach, sig: (s) => `${tauBucket(s.tau)}|${Math.round(Math.atan2(s.target!.y - s.start.y, s.target!.x - s.start.x) / (Math.PI / 4))}` },
  { id: 'brake', name: 'Delayed brake', teach: 'Hold to brake, release to coast. The brake engages (and lets go) a moment after you press.', bands: [0, 3], gen: genBrake, sig: (s) => `${tauBucket(s.tau)}|${Math.round(s.line! * 4)}|${Math.round(s.v0! * 10)}` },
  { id: 'steer', name: 'Delayed steering', teach: 'The craft turns a moment after you steer. Thread every gate.', bands: [0, 3], gen: genSteer, sig: (s) => `${tauBucket(s.tau)}|${s.gates!.map((g) => Math.round(g.y * 5)).join(',')}` },
  { id: 'stabilize', name: 'Stabilise', teach: 'This system runs away on its own. Keep the dot inside the band — small, early corrections.', bands: [1, 3], gen: genStabilize, sig: (s) => `${tauBucket(s.tau)}|${Math.round(s.lambda! * 5)}|${Math.sign(s.start.x)}` },
  { id: 'mixed', name: 'Momentum', teach: 'Thrust changes speed, not position, and arrives late. Settle on the target without overshooting.', bands: [1, 3], gen: genMixed, sig: (s) => `${tauBucket(s.tau)}|${Math.round(s.target!.x * 5)}|${Math.round(s.damp! * 5)}` },
];

export const ROUNDS = 5;

const factory: GameFactory = (api) => {
  const { stage } = api;
  const bench = new Bench(api);
  const sess = new Session<LagSpec>(api, 'lag', FAMILIES, ROUNDS);
  let spec: LagSpec;
  let sim: LagSim;
  let phase: 'ready' | 'run' | 'reveal' | 'done' = 'ready';
  let keys = new Set<string>();
  let ptr: { x: number; y: number } | null = null;
  let last = 0;
  let acc = 0;
  // Metrics.
  let inZone = 0;
  let entered = false;
  let exits = 0;
  let settleAt = -1;
  let changes = 0;
  let lastQ = '0,0';
  let outside = 0;
  let sq = 0;
  let crashed = false;
  let gateRes: number[] = [];
  let over = 0;
  let trail: { x: number; y: number }[] = [];
  let geo = { x: 0, y: 0, w: 1, h: 1 };
  const offKeys = [
    listen('keyup', (e) => keys.delete(e.key)),
    listen('blur', () => {
      keys.clear();
      ptr = null;
    }),
  ];

  function reset(seed: number) {
    bench.clear();
    sess.start(seed);
    begin();
  }

  function begin() {
    spec = sess.next().rd;
    sim = new LagSim(spec);
    phase = 'ready';
    keys.clear();
    ptr = null;
    inZone = 0;
    entered = false;
    exits = 0;
    settleAt = -1;
    changes = 0;
    lastQ = '0,0';
    outside = 0;
    sq = 0;
    crashed = false;
    gateRes = [];
    over = 0;
    trail = [];
    api.ownKeys(true);
    api.progress(`${sess.round + 1} / ${ROUNDS}`);
    const how = { reach: 'Arrows or drag the pad', brake: 'Hold Space or press anywhere to brake', steer: '← → or hold the left / right half', stabilize: '← → or drag the pad', mixed: '← → or drag the pad' }[spec.kind];
    const ask = {
      reach: 'Bring the dot into the ring and hold it there for 1.5 s.',
      brake: 'Bring the block to rest on the line.',
      steer: 'Fly through every gate.',
      stabilize: `Keep the dot inside the band for ${spec.limit} s.`,
      mixed: 'Settle the mass on the target and hold it there for 1.5 s.',
    }[spec.kind];
    api.prompt(ask, `${sess.teach ? sess.teach + ' · ' : ''}Delay ${spec.tau.toFixed(2)} s · ${how} · press Start`);
    stage.request();
  }

  function startRun() {
    if (phase !== 'ready') return;
    phase = 'run';
    last = 0;
    acc = 0;
    api.sfx.press();
    stage.request();
  }

  /** The command you are giving right now. */
  function command(): U {
    const k = (a: string) => (keys.has(a) ? 1 : 0);
    if (spec.kind === 'brake') return [keys.has(' ') || ptr ? 1 : 0, 0];
    let ux = k('ArrowRight') - k('ArrowLeft');
    let uy = k('ArrowDown') - k('ArrowUp');
    if (ptr) {
      if (spec.kind === 'steer') ux = ptr.x < stage.w / 2 ? -1 : 1;
      else {
        const pad = padGeo();
        ux = clamp((ptr.x - pad.x) / pad.r, -1, 1);
        uy = spec.kind === 'reach' ? clamp((ptr.y - pad.y) / pad.r, -1, 1) : 0;
      }
    }
    // Steer: screen y points down, so a negative turn rate swings the nose up — Left.
    const m = Math.hypot(ux, uy);
    return m > 1 ? [ux / m, uy / m] : [ux, uy];
  }

  const padGeo = () => ({ x: stage.w - 90, y: stage.h - 150, r: 56 });

  function stepOnce() {
    const u = command();
    const q = `${Math.sign(Math.round(u[0] * 2))},${Math.sign(Math.round(u[1] * 2))}`;
    if (q !== lastQ && q !== '0,0') changes++;
    lastQ = q;
    sim.advance(u);
    const s = spec;
    if (s.kind === 'reach' || s.kind === 'mixed') {
      const tg = s.target!;
      const inside = Math.hypot(sim.x - tg.x, s.kind === 'reach' ? sim.y - tg.y : 0) <= tg.r && (s.kind === 'reach' || Math.abs(sim.vx) < 0.06);
      if (inside) {
        if (!entered) entered = true;
        inZone += DT;
        if (inZone >= s.hold! && settleAt < 0) settleAt = sim.t;
      } else {
        if (inZone > 0 && entered) exits++;
        inZone = 0;
      }
      if (s.kind === 'mixed' && entered) over = Math.max(over, Math.sign(tg.x) * (sim.x - tg.x));
      if (settleAt >= 0 || sim.t >= s.limit) end();
    } else if (s.kind === 'brake') {
      if (sim.x >= s.wall!) {
        crashed = true;
        end();
      } else if (sim.vx <= 0) end();
      else if (sim.t >= s.limit) end();
    } else if (s.kind === 'steer') {
      const g = s.gates![gateRes.length];
      if (g && sim.x >= g.x) gateRes.push(sim.y - g.y);
      if (sim.x >= 3.05 || sim.t >= s.limit) {
        while (gateRes.length < s.gates!.length) gateRes.push(9);
        end();
      }
    } else if (s.kind === 'stabilize') {
      if (Math.abs(sim.x) > 0.3) outside += DT;
      sq += sim.x * sim.x * DT;
      if (Math.abs(sim.x) >= 1) {
        crashed = true;
        end();
      } else if (sim.t >= s.limit) end();
    }
    if (sim.step % 6 === 0) {
      trail.push({ x: sim.x, y: sim.y });
      if (trail.length > 400) trail.shift();
    }
  }

  function end() {
    if (phase !== 'run') return;
    phase = 'reveal';
    const s = spec;
    let pen = 1;
    let main = '';
    let sub = '';
    let note = '';
    const tau = s.tau.toFixed(2);
    if (s.kind === 'reach' || s.kind === 'mixed') {
      const d0 = Math.hypot(s.target!.x - s.start.x, s.target!.y - s.start.y);
      // Reference: full speed straight there (reach), or full thrust then full counter-thrust (mixed).
      const ideal = (s.kind === 'reach' ? d0 / VMAX : 2 * Math.sqrt(d0 / K_MIX)) + s.tau + s.hold!;
      if (settleAt >= 0) {
        pen = clamp((0.45 * (settleAt - ideal)) / ideal, 0, 0.6) + (s.kind === 'reach' ? 0.05 * Math.min(4, exits) : 0.3 * Math.min(1, over / 0.3));
        main = `Settled in ${settleAt.toFixed(1)} s (a delay-aware ideal is about ${ideal.toFixed(1)} s).`;
        note = `settled ${settleAt.toFixed(1)} s · ${exits} exits · ${changes} corrections`;
      } else {
        const fd = Math.hypot(sim.x - s.target!.x, s.kind === 'reach' ? sim.y - s.target!.y : 0);
        pen = 0.7 + 0.3 * Math.min(1, fd / d0);
        main = `Not settled in ${s.limit} s.`;
        note = `not settled · ${exits} exits · ${changes} corrections`;
      }
      sub =
        exits || over > 0.05
          ? `You overshot ${s.kind === 'mixed' ? `by ${over.toFixed(2)} u` : `${exits}×`}: when it reached the target, the last ${tau} s of commands were still on their way. Stop pushing before you arrive.`
          : changes > 8
            ? `${changes} corrections: with a ${tau} s delay, each correction needs ${tau} s before you can see whether it worked.`
            : 'Clean: you let the queued commands play out instead of chasing the error.';
    } else if (s.kind === 'brake') {
      const err = Math.abs(sim.x - s.line!);
      pen = crashed ? 1 : Math.min(1, err / 0.3);
      main = crashed ? 'It hit the wall.' : `Stopped ${err.toFixed(3)} u ${sim.x < s.line! ? 'short of' : 'past'} the line.`;
      sub = `The brake acts ${tau} s after you press; at ${s.v0!.toFixed(2)} u/s that is ${(s.v0! * s.tau).toFixed(2)} u travelled before it bites — and releasing is late too.`;
      note = crashed ? 'crashed' : `${err.toFixed(3)} u ${sim.x < s.line! ? 'short' : 'past'} · ${changes} presses`;
    } else if (s.kind === 'steer') {
      const G = s.gates!.length;
      const hit = gateRes.filter((d, i) => Math.abs(d) <= s.gates![i].w / 2);
      const avg = hit.length ? hit.reduce((a, d, i) => a + Math.abs(d) / (s.gates![i].w / 2), 0) / hit.length : 1;
      const missed = G - hit.length;
      pen = Math.min(1, (missed / G) * 0.9 + 0.1 * avg);
      main = missed ? `${missed} of ${G} gates missed.` : `All ${G} gates threaded.`;
      sub = missed ? `Turns start ${tau} s after you steer: begin each turn before the craft lines up with the gap, and straighten early.` : 'You steered ahead of the craft — exactly what a delay demands.';
      note = `${G - missed}/${G} gates · ${changes} steering changes`;
    } else {
      const T = sim.t;
      const frac = outside / Math.max(T, 1e-6);
      const rms = Math.sqrt(sq / Math.max(T, 1e-6));
      pen = crashed ? 1 - 0.5 * (T / s.limit) : clamp(1.2 * frac + 0.6 * Math.max(0, rms - 0.08), 0, 1);
      main = crashed ? `Lost control after ${T.toFixed(1)} s.` : `Held for ${s.limit} s · ${(frac * 100).toFixed(0)}% of the time outside the band.`;
      sub = crashed ? `With a ${tau} s delay, big corrections arrive when the error has already changed sign — and amplify it. Use small, early pushes.` : `RMS position ${rms.toFixed(3)} u. Gentle corrections that anticipate the drift keep a delayed loop stable.`;
      note = crashed ? `lost at ${T.toFixed(1)} s` : `${(frac * 100).toFixed(0)}% outside · RMS ${rms.toFixed(2)}`;
    }
    sess.done(pen, note, { x: stage.w / 2, y: 130 });
    api.sfx[pen < 0.5 ? 'press' : 'fail']();
    api.prompt(main, sub + (sess.last ? '' : ' · Tap for the next'));
    api.ownKeys(false);
    keys.clear();
    ptr = null;
    if (sess.last) {
      phase = 'done';
      const r = sess.result({ label: 'mean penalty per run (settling, overshoot, misses, loss of control)', share: 'LAG' });
      if (r) bench.finish(r);
    }
  }

  bench.onAway = () => {
    keys.clear();
    ptr = null;
    last = 0; // pause: the next frame restarts the clock instead of catching up
  };
  bench.onTap = (p) => {
    if (phase === 'reveal') return begin();
    if (phase === 'ready') return;
    if (phase === 'run') ptr = p;
  };
  bench.onMove = (p) => {
    if (ptr && Number.isFinite(p.x)) ptr = p;
  };
  bench.onUp = () => {
    ptr = null;
  };
  bench.onKey = (e) => {
    if (phase === 'reveal' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return begin();
    }
    if (phase === 'ready' && (e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      return startRun();
    }
    if (phase === 'run' && (e.key.startsWith('Arrow') || e.key === ' ')) {
      keys.add(e.key);
      e.preventDefault();
    }
  };

  /** World → stage for each kind's field. */
  function map(x: number, y: number) {
    const s = spec;
    if (s.kind === 'reach') return { x: geo.x + ((x + 1) / 2) * geo.w, y: geo.y + ((y + 1) / 2) * geo.h };
    if (s.kind === 'steer') return { x: geo.x + (x / 3.1) * geo.w, y: geo.y + geo.h / 2 + (y / 0.62) * (geo.h / 2) };
    if (s.kind === 'brake') return { x: geo.x + (x / (s.wall! + 0.08)) * geo.w, y: geo.y + geo.h / 2 };
    return { x: geo.x + geo.w / 2 + (x / 1.25) * (geo.w / 2), y: geo.y + geo.h / 2 };
  }

  function drawTape(c: CanvasRenderingContext2D, x: number, y: number, w: number) {
    const D = sim.D;
    const pend = sim.pending();
    const act = sim.applied();
    const now = phase === 'run' ? command() : ([0, 0] as U);
    text(c, 'ACTING NOW', x, y - 8, font.mono(9, 600), AMBER);
    text(c, spec.tape ? `QUEUED · ${spec.tau.toFixed(2)} s` : 'QUEUE HIDDEN', x + w / 2, y - 8, font.mono(9, 600), pal.ink3, 'center');
    text(c, 'YOU PRESS', x + w, y - 8, font.mono(9, 600), pal.accent, 'right');
    rr(c, x, y, w, 26, 5);
    c.fillStyle = pal.paper2;
    c.fill();
    c.strokeStyle = pal.line;
    c.stroke();
    const cell = (w - 60) / D;
    const val = (u: U) => (spec.kind === 'reach' ? Math.hypot(u[0], u[1]) * Math.sign(u[0] || u[1] || 1) : u[0]);
    if (spec.tape)
      for (let i = 0; i < pend.length; i++) {
        const v = val(pend[i]);
        if (!v) continue;
        const cx = x + 30 + (D - pend.length + i) * cell;
        c.fillStyle = alpha(AMBER, 0.55);
        const hh = Math.abs(v) * 10;
        c.fillRect(cx, y + 13 - (v > 0 ? hh : 0), Math.max(1, cell), hh);
      }
    const dot = (cx: number, u: U, col: string) => {
      c.beginPath();
      c.arc(cx, y + 13, 9, 0, TAU);
      c.fillStyle = alpha(col, Math.hypot(u[0], u[1]) > 0.05 ? 0.9 : 0.15);
      c.fill();
      if (spec.kind !== 'brake' && Math.hypot(u[0], u[1]) > 0.05) {
        const dir = spec.kind === 'steer' ? [0, u[0]] : u;
        c.strokeStyle = pal.paper;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(cx, y + 13);
        c.lineTo(cx + dir[0] * 6, y + 13 + dir[1] * 6);
        c.stroke();
      }
    };
    dot(x + 14, act, AMBER);
    dot(x + w - 14, now, pal.accent);
  }

  stage.draw = (now) => {
    bench.frame();
    const c = stage.ctx;
    if (!spec) return false;
    if (phase === 'run') {
      if (!last) last = now;
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      while (acc >= DT && phase === 'run') {
        stepOnce();
        acc -= DT;
      }
    }
    const W = stage.w;
    const H = stage.h;
    famChip(c, 16, 80, sess.fam.name, sess.curBand);
    const s = spec;
    const top = 116;
    const bottom = H - 96;
    if (s.kind === 'reach') {
      const side = Math.min(bottom - top, W - 220);
      geo = { x: (W - side) / 2 - (W > 640 ? 50 : 0), y: top, w: side, h: side };
    } else if (s.kind === 'steer') geo = { x: 24, y: top, w: W - 48, h: Math.min(bottom - top, (W - 48) * 0.45) };
    else geo = { x: 40, y: top + 20, w: W - 80 - (s.kind === 'brake' ? 0 : 140), h: Math.min(140, bottom - top) };
    plate(c, geo.x - 8, geo.y - 8, geo.w + 16, geo.h + 16, 8);
    // Ghost: where the queued commands alone will take the system (onboarding).
    let ghost: { x: number; y: number } | null = null;
    if (s.ghost && phase === 'run') {
      const g = sim.clone();
      for (let i = 0; i < sim.D; i++) g.advance([0, 0]);
      ghost = { x: g.x, y: g.y };
    }
    if (s.kind === 'reach') {
      const t = map(s.target!.x, s.target!.y);
      c.beginPath();
      c.arc(t.x, t.y, (s.target!.r / 2) * geo.w, 0, TAU);
      c.strokeStyle = pal.ink2;
      c.setLineDash([5, 4]);
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
      if (inZone > 0) {
        c.beginPath();
        c.arc(t.x, t.y, (s.target!.r / 2) * geo.w + 5, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, inZone / s.hold!));
        c.strokeStyle = pal.accent;
        c.lineWidth = 2;
        c.stroke();
      }
    } else if (s.kind === 'brake') {
      const y = geo.y + geo.h / 2;
      c.fillStyle = pal.line;
      c.fillRect(geo.x, y + 16, geo.w, 1);
      const L = map(s.line!, 0);
      c.fillStyle = pal.ink;
      c.fillRect(L.x - 1, y - 30, 2, 52);
      const Wl = map(s.wall!, 0);
      c.fillStyle = alpha(pal.signal, 0.6);
      c.fillRect(Wl.x, y - 34, 6, 56);
    } else if (s.kind === 'steer') {
      for (const [i, g] of s.gates!.entries()) {
        const a = map(g.x, g.y - g.w / 2);
        const b = map(g.x, g.y + g.w / 2);
        const done = i < gateRes.length;
        const ok = done && Math.abs(gateRes[i]) <= g.w / 2;
        c.fillStyle = done ? (ok ? pal.accent : pal.signal) : pal.ink;
        c.fillRect(a.x - 2, geo.y, 4, a.y - geo.y);
        c.fillRect(b.x - 2, b.y, 4, geo.y + geo.h - b.y);
      }
    } else {
      const zx = s.kind === 'stabilize' ? 0 : s.target!.x;
      const zw = s.kind === 'stabilize' ? 0.3 : s.target!.r;
      const a = map(zx - zw, 0);
      const b = map(zx + zw, 0);
      c.fillStyle = alpha(pal.accent, 0.1);
      c.fillRect(a.x, geo.y, b.x - a.x, geo.h);
      c.strokeStyle = alpha(pal.accent, 0.5);
      c.strokeRect(a.x + 0.5, geo.y + 0.5, b.x - a.x - 1, geo.h - 1);
      if (s.kind === 'stabilize') {
        for (const e of [-1, 1]) {
          const q = map(e, 0);
          c.fillStyle = alpha(pal.signal, 0.6);
          c.fillRect(q.x - 2, geo.y, 4, geo.h);
        }
      }
      if (s.kind === 'mixed' && inZone > 0) {
        c.fillStyle = pal.accent;
        c.fillRect(a.x, geo.y + geo.h - 4, (b.x - a.x) * Math.min(1, inZone / s.hold!), 4);
      }
    }
    // Trail, ghost and the system itself (cyan: your live element; amber: what is queued).
    if (trail.length > 1 && (s.kind === 'reach' || s.kind === 'steer')) {
      c.strokeStyle = alpha(pal.accent, 0.35);
      c.lineWidth = 1.5;
      c.beginPath();
      trail.forEach((p, i) => {
        const q = map(p.x, p.y);
        i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y);
      });
      c.stroke();
    }
    const P = map(sim.x, sim.y);
    if (ghost) {
      const G = map(ghost.x, ghost.y);
      c.beginPath();
      c.arc(G.x, G.y, 8, 0, TAU);
      c.strokeStyle = alpha(AMBER, 0.8);
      c.setLineDash([3, 3]);
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
    }
    if (s.kind === 'steer') {
      c.save();
      c.translate(P.x, P.y);
      c.rotate(sim.h);
      c.beginPath();
      c.moveTo(12, 0);
      c.lineTo(-8, -7);
      c.lineTo(-4, 0);
      c.lineTo(-8, 7);
      c.closePath();
      c.fillStyle = pal.accent;
      c.fill();
      c.restore();
    } else if (s.kind === 'brake') {
      c.fillStyle = pal.accent;
      c.fillRect(P.x - 14, P.y - 14, 28, 28);
    } else {
      c.beginPath();
      c.arc(P.x, P.y, 9, 0, TAU);
      c.fillStyle = pal.accent;
      c.fill();
    }
    // Pad (pointer control) for the analogue kinds.
    if (s.kind === 'reach' || s.kind === 'stabilize' || s.kind === 'mixed') {
      const pad = padGeo();
      c.beginPath();
      c.arc(pad.x, pad.y, pad.r, 0, TAU);
      c.strokeStyle = pal.line;
      c.lineWidth = 1;
      c.stroke();
      if (s.kind !== 'reach') {
        c.beginPath();
        c.moveTo(pad.x - pad.r, pad.y);
        c.lineTo(pad.x + pad.r, pad.y);
        c.stroke();
      }
      const u = phase === 'run' ? command() : ([0, 0] as U);
      c.beginPath();
      c.arc(pad.x + u[0] * pad.r, pad.y + u[1] * pad.r, 10, 0, TAU);
      c.fillStyle = alpha(pal.accent, 0.7);
      c.fill();
      text(c, 'PAD', pad.x, pad.y + pad.r + 14, font.mono(9, 600), pal.ink3, 'center');
    }
    if (phase === 'run' || phase === 'ready') {
      const tw = Math.min(520, W - 32);
      drawTape(c, (W - tw) / 2, H - 70, tw);
      text(c, `${sim.t.toFixed(1)} s`, W - 20, 100, font.mono(11, 500), pal.ink3, 'right');
    }
    if (phase === 'ready') bench.button(c, W / 2 - 70, geo.y + geo.h / 2 - 22, 140, 44, 'Start', startRun, { primary: true, key: 'Space' });
    roundStrip(c, W, H - 6, sess.marks(), ROUNDS, sess.round);
    return phase === 'run';
  };

  return {
    reset,
    destroy: () => {
      api.ownKeys(false);
      offKeys.forEach((f) => f());
      bench.destroy();
    },
  };
};

export default factory;
