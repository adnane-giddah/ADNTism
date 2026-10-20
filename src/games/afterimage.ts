// 15 · AFTERIMAGE — watch a signal, it disappears, rebuild it from memory.
// A dot moves on a vertical track: y(t) = A·sin(2π·f·t + φ), radius ρ. Or a lamp blinks every P ms.
// Each round asks for one parameter (two on Hard); the others stay as they were, so you only ever rebuild
// what you were shown. Errors are normalised before they are combined: amplitude, frequency, size and
// interval as relative errors, phase as a fraction of a full cycle. After each lock both signals replay
// side by side.
import { addBias, biasOf } from '../core/bias';
import { Controls } from '../core/controls';
import { circle, clamp, font, hair, pal, text } from '../core/draw';
import { signed } from '../core/format';
import { gameKey, listen, primary } from '../core/input';
import { bar, glow, slot, sphere } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import { angleDiff, phaseFraction, relError } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

export type Param = 'amp' | 'freq' | 'phase' | 'size' | 'interval';

export interface Signal {
  amp: number; // u
  freq: number; // Hz
  phase: number; // degrees
  size: number; // u (dot radius)
  interval: number; // ms (lamp rounds)
}

export interface AfterRound {
  ask: Param[];
  sig: Signal;
  /** Hard: a look-alike shown during the delay. Never scored. */
  distractor: Signal | null;
  /** Knob ranges for the asked parameters, and start values. */
  ranges: Partial<Record<Param, { lo: number; hi: number; start: number }>>;
  /** Phase knob offset, so its position says nothing about the phase. */
  phaseRot: number;
  observe: number; // s
  delay: number; // s
}

export const PARAM_INFO: Record<Param, { name: string; unit: string; fmt: (v: number) => string }> = {
  amp: { name: 'amplitude', unit: 'u', fmt: (v) => v.toFixed(1) + ' u' },
  freq: { name: 'frequency', unit: 'Hz', fmt: (v) => v.toFixed(2) + ' Hz' },
  phase: { name: 'phase (start)', unit: '°', fmt: (v) => (((v % 360) + 360) % 360).toFixed(0) + '°' },
  size: { name: 'size', unit: 'u', fmt: (v) => v.toFixed(1) + ' u' },
  interval: { name: 'beat interval', unit: 'ms', fmt: (v) => Math.round(v) + ' ms' },
};

const DEFAULT: Signal = { amp: 24, freq: 0.9, phase: 0, size: 4.5, interval: 600 };

function randSignal(r: Rng): Signal {
  return { amp: r.range(12, 34), freq: r.range(0.55, 1.5), phase: r.range(0, 360), size: r.range(2.5, 7.5), interval: r.range(380, 900) };
}

function range(r: Rng, p: Param, v: number) {
  if (p === 'phase') return { lo: 0, hi: 360, start: r.range(0, 360) };
  const lo = v * r.range(0.5, 0.65);
  const hi = v * r.range(1.4, 1.6);
  let start = r.range(lo, hi);
  for (let i = 0; i < 50 && Math.abs(start - v) < 0.12 * v; i++) start = r.range(lo, hi);
  return { lo, hi, start };
}

export function makeAfterimage(seed: number, level: Level): AfterRound[] {
  const r = rng(seed);
  const pool: Param[] = level === 'easy' ? ['amp', 'freq', 'size', 'interval'] : ['amp', 'freq', 'phase', 'size', 'interval'];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const asks: Param[][] =
    level === 'hard'
      ? [
          ['amp', 'freq'],
          ['freq', 'phase'],
          ['size', 'amp'],
        ]
      : pool.slice(0, 4).map((p) => [p]);
  return asks.map((ask) => {
    const rnd = randSignal(r);
    // Only the asked parameters vary; the rest are the familiar defaults.
    const sig: Signal = { ...DEFAULT };
    for (const p of ask) sig[p] = rnd[p];
    let distractor: Signal | null = null;
    if (level === 'hard') {
      distractor = { ...sig };
      for (const p of ask) distractor[p] = p === 'phase' ? sig.phase + r.sign() * r.range(70, 130) : sig[p] * (1 + r.sign() * r.range(0.2, 0.35));
    }
    const ranges: AfterRound['ranges'] = {};
    for (const p of ask) if (p !== 'interval') ranges[p] = range(r, p, sig[p]);
    return {
      ask,
      sig,
      distractor,
      ranges,
      phaseRot: r.range(0, 360),
      observe: level === 'easy' ? 4 : 3,
      delay: level === 'easy' ? 0 : level === 'medium' ? 2 : 3,
    };
  });
}

/** Normalised error of one parameter: relative error, or the fraction of a cycle for phase. */
export function paramError(p: Param, mine: number, truth: number) {
  return p === 'phase' ? phaseFraction(mine, truth) : relError(mine, truth);
}
/** Signed version (for bias): positive = too big / too fast / phase ahead. */
export function paramSigned(p: Param, mine: number, truth: number) {
  return p === 'phase' ? angleDiff(mine, truth) / 360 : (mine - truth) / truth;
}

const isLamp = (rd: AfterRound) => rd.ask.includes('interval');
/** Phase rounds loop every 1.5 cycles so the starting point is seen more than once. */
const loopLen = (rd: AfterRound, s: Signal) => (rd.ask.includes('phase') ? 1.5 / s.freq : Infinity);

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: AfterRound[] = [];
  let round = 0;
  let phase: 'ready' | 'observe' | 'delay' | 'recon' | 'reveal' | 'done' = 'ready';
  let phaseAt = 0;
  let mine: Signal = { ...DEFAULT };
  let taps: number[] = [];
  let answers: Signal[] = [];
  let timer = 0;
  let finTimer = 0;
  const controls = new Controls(stage, () => lock());

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 74;
    const rd = rounds[round];
    const ctrlH = rd && !isLamp(rd) ? rd.ask.length * 54 + 30 : 90;
    const F = Math.max(150, Math.min(W - 32, H - top - ctrlH - 26, 560));
    return { k: F / 100, F, cx: W / 2, cy: top + F / 2, ctrlY: top + F + 6, cw: Math.min(W - 32, 520) };
  };

  function prompt() {
    const rd = rounds[round];
    const names = rd.ask.map((p) => PARAM_INFO[p].name).join(' and ');
    api.progress(`${round + 1} / ${rounds.length}`);
    if (phase === 'ready') api.prompt(`Remember its ${names}.`, `Press to watch for ${rd.observe} s${rd.delay ? ` · then ${rd.delay} s ${rd.distractor ? 'of a look-alike (not this one)' : 'of nothing'}` : ''}`);
  }

  function reset(seed: number) {
    clearTimeout(timer);
    clearTimeout(finTimer);
    rounds = makeAfterimage(seed, api.level);
    round = 0;
    answers = [];
    phase = 'ready';
    controls.set([]);
    controls.enabled = false;
    prompt();
    stage.request();
  }

  function observe() {
    const rd = rounds[round];
    phase = 'observe';
    phaseAt = performance.now();
    api.prompt(`Watch.`, `${rd.ask.map((p) => PARAM_INFO[p].name).join(' + ')}`);
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (rd.delay) {
        phase = 'delay';
        phaseAt = performance.now();
        api.prompt(rd.distractor ? 'This is NOT it — a look-alike. Hold on to the first one.' : 'Hold it in mind…', '');
        timer = window.setTimeout(recon, rd.delay * 1000);
      } else recon();
      stage.request();
    }, rd.observe * 1000);
    stage.request();
  }

  function recon() {
    const rd = rounds[round];
    phase = 'recon';
    phaseAt = performance.now();
    mine = { ...rd.sig };
    taps = [];
    const knobs = rd.ask
      .filter((p) => p !== 'interval')
      .map((p) => {
        const g = rd.ranges[p]!;
        mine[p] = p === 'phase' ? g.start + rd.phaseRot : g.start;
        return {
          id: p,
          label: PARAM_INFO[p].name,
          lo: g.lo,
          hi: g.hi,
          value: g.start,
          speed: (g.hi - g.lo) / 4,
          onChange: (v: number) => {
            mine[p] = p === 'phase' ? v + rd.phaseRot : v;
            phaseAt = performance.now(); // restart your signal so each change is seen from its start
          },
        };
      });
    controls.set(knobs);
    controls.enabled = true;
    controls.lockLabel = 'Lock';
    if (isLamp(rd)) {
      mine.interval = NaN;
      api.prompt('Tap the beat interval: at least 5 taps, steady.', 'Your lamp blinks at your tempo · Lock when it matches');
    } else api.prompt(`Rebuild its ${rd.ask.map((p) => PARAM_INFO[p].name).join(' and ')}.`, 'Your signal runs live · ↑ ↓ choose · ← → adjust · Lock');
    stage.request();
  }

  function lock() {
    if (phase !== 'recon') return;
    const rd = rounds[round];
    if (isLamp(rd) && !Number.isFinite(mine.interval)) return;
    answers.push({ ...mine });
    {
      const { k, cx, cy } = layout();
      api.judge(roundErr(rd, mine) * 100, { x: cx, y: cy - 56 * k });
    }
    for (const p of rd.ask) addBias('afterimage', p, { e: paramSigned(p, mine[p], rd.sig[p]), ctx: !!rd.delay });
    phase = 'reveal';
    phaseAt = performance.now();
    controls.enabled = false;
    api.sfx.release();
    api.buzz(10);
    const parts = rd.ask.map((p) => `${PARAM_INFO[p].name} ${PARAM_INFO[p].fmt(rd.sig[p])} → ${PARAM_INFO[p].fmt(mine[p])} (${signed(paramSigned(p, mine[p], rd.sig[p]) * 100, 1)}%)`);
    api.prompt(parts.join(' · '), round < rounds.length - 1 ? 'Left: the original · right: yours · tap / Enter for the next' : 'Left: the original · right: yours');
    if (round === rounds.length - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal' || round >= rounds.length - 1) return;
    round++;
    phase = 'ready';
    controls.set([]);
    prompt();
    stage.request();
  }

  const roundErr = (rd: AfterRound, a: Signal) => rd.ask.reduce((s, p) => s + paramError(p, a[p], rd.sig[p]), 0) / rd.ask.length;

  function finish() {
    phase = 'done';
    const errs = rounds.map((rd, i) => roundErr(rd, answers[i]));
    const mean = (errs.reduce((a, b) => a + b, 0) / errs.length) * 100;
    const disp = mean.toFixed(1);
    const rows: [string, string][] = [];
    rounds.forEach((rd, i) =>
      rd.ask.forEach((p) => rows.push([`${i + 1} · ${PARAM_INFO[p].name}`, `${PARAM_INFO[p].fmt(rd.sig[p])} → ${PARAM_INFO[p].fmt(answers[i][p])} (${signed(paramSigned(p, answers[i][p], rd.sig[p]) * 100, 1)}%)`])),
    );
    for (const p of ['amp', 'freq', 'size', 'interval', 'phase'] as Param[]) {
      const b = biasOf('afterimage', p);
      if (b.n >= 8) rows.push([`Your ${PARAM_INFO[p].name} memory`, b.systematic ? `${b.mean > 0 ? 'exaggerates' : 'shrinks'} by ${Math.abs(b.mean * 100).toFixed(1)}% ± ${(b.se * 100).toFixed(1)} (n = ${b.n})` : `no consistent direction (n = ${b.n})`]);
    }
    rows.push(['How errors combine', 'relative error per parameter; phase as a fraction of a cycle; then the mean']);
    const worst = errs.reduce((w, e, i) => (e > errs[w] ? i : w), 0);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: '%',
          label: 'mean normalised error',
          headline: disp === '0.0' ? 'A perfect afterimage. Every parameter, exactly.' : `Off by ${disp}% on average. Hardest: the ${rounds[worst].ask.map((p) => PARAM_INFO[p].name).join(' + ')} in round ${worst + 1}.`,
          rows,
          accuracy: 1 - mean / 100,
          perfect: disp === '0.0',
          near: mean < 2,
          share: [`AFTERIMAGE · ${api.level} — rebuild a signal from memory`, `mean error ${disp}%`],
        }),
      api.motion() ? 600 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'ready') return observe();
    if (phase === 'reveal') return next();
    if (phase === 'recon' && isLamp(rounds[round])) tapLamp(e.timeStamp);
  };

  function tapLamp(ts: number) {
    if (taps.length && ts - taps[taps.length - 1] > 2000) taps = [];
    taps.push(ts);
    api.sfx.tick();
    if (taps.length >= 5) {
      const g = taps.slice(-5).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1);
      mine.interval = g.reduce((a, b) => a + b, 0) / g.length;
      controls.touched = true;
      phaseAt = performance.now();
    }
    stage.request();
  }

  const onVis = () => {
    if (document.hidden && (phase === 'observe' || phase === 'delay')) {
      clearTimeout(timer);
      api.voidRun('Attempt voided — the tab was hidden while the signal was shown.');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  stage.canvas.addEventListener('pointerdown', onDown);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.repeat || e.defaultPrevented) return;
      const rd = rounds[round];
      if (e.code === 'Space' && phase === 'recon' && rd && isLamp(rd)) {
        e.preventDefault();
        tapLamp(e.timeStamp);
        return;
      }
      if (e.key !== 'Enter' && e.code !== 'Space') return;
      if (phase === 'ready') {
        e.preventDefault();
        observe();
      } else if (phase === 'reveal') {
        e.preventDefault();
        next();
      }
    }),
  ];

  // ── Rendering ───────────────────────────────────────────────────────────────
  function drawSignal(c: CanvasRenderingContext2D, rd: AfterRound, s: Signal, x: number, y: number, k: number, t: number, label: string, style: 'solid' | 'ghost' | 'dashed') {
    text(c, label, x, y - 44 * k, font.mono(10, 500), pal.ink3, 'center');
    if (isLamp(rd)) {
      if (!Number.isFinite(s.interval)) {
        circle(c, x, y, 14, pal.ink3, undefined, 1.5, [3, 3]);
        text(c, 'tap…', x, y + 30, font.mono(10), pal.ink3, 'center');
        return;
      }
      const since = (t * 1000) % s.interval;
      const on = since < 110;
      const lc = style === 'dashed' ? pal.accent : pal.ink;
      if (on && style !== 'ghost') glow(c, x, y, 40, lc, 1 - since / 110);
      circle(c, x, y, 14, pal.ink2, on ? (style === 'ghost' ? pal.ink3 : lc) : undefined, 1.5, style === 'dashed' ? [3, 3] : undefined);
      return;
    }
    // Track: full possible extent, so the amplitude must be judged against a fixed frame.
    slot(c, x, y - 40 * k, x, y + 40 * k, 6);
    hair(c, x - 8, y, x + 8, y, pal.ink3);
    const L = loopLen(rd, s);
    const tt = Number.isFinite(L) ? t % L : t;
    const yy = y - s.amp * k * Math.sin(2 * Math.PI * s.freq * tt + (s.phase * Math.PI) / 180);
    // The ball keeps exactly its radius (size is measured): shading only inside the edge.
    if (style === 'ghost') circle(c, x, yy, s.size * k, pal.ink3, undefined, 2, [3, 3]);
    else if (style === 'dashed') {
      glow(c, x, yy, s.size * k * 2.4, pal.accent, 0.5);
      circle(c, x, yy, s.size * k, pal.accent, undefined, 2.5);
    }
    else sphere(c, x, yy, s.size * k, pal.ink);
  }

  stage.draw = (now) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    let more = controls.tick(now);
    const { k, cx, cy, ctrlY, cw } = layout();
    const t = (now - phaseAt) / 1000;
    if (phase === 'observe') {
      drawSignal(c, rd, rd.sig, cx, cy, k, t, 'ORIGINAL', 'solid');
      slot(c, cx - 60, cy + 46 * k, cx + 60, cy + 46 * k, 6);
      bar(c, cx - 60, cy + 46 * k - 2.5, 120 * (1 - clamp(t / rd.observe, 0, 1)), 5, pal.accent, 2.5);
      more = true;
    } else if (phase === 'delay') {
      if (rd.distractor) {
        drawSignal(c, rd, rd.distractor, cx, cy, k, t, 'LOOK-ALIKE · NOT THIS ONE', 'ghost');
      } else text(c, '…', cx, cy, font.mono(18), pal.ink3, 'center', 'middle');
      slot(c, cx - 60, cy + 46 * k, cx + 60, cy + 46 * k, 6);
      bar(c, cx - 60, cy + 46 * k - 2.5, 120 * (1 - clamp(t / rd.delay, 0, 1)), 5, pal.ink3, 2.5);
      more = true;
    } else if (phase === 'recon') {
      drawSignal(c, rd, mine, cx, cy, k, t, 'YOURS', 'dashed');
      if (isLamp(rd) && taps.length) text(c, `${taps.length} tap${taps.length > 1 ? 's' : ''}${taps.length < 5 ? ` — ${5 - taps.length} more` : ''}`, cx, cy + 36, font.mono(10), pal.ink2, 'center');
      controls.draw(c, cx - cw / 2, ctrlY, cw);
      more = true;
    } else if (phase === 'reveal' || phase === 'done') {
      const a = answers[round];
      drawSignal(c, rd, rd.sig, cx - 26 * k, cy, k, t, 'ORIGINAL', 'solid');
      drawSignal(c, rd, a, cx + 26 * k, cy, k, t, 'YOURS', 'dashed');
      more = true;
    } else {
      text(c, 'press anywhere to watch', cx, cy, font.mono(12, 500), pal.ink2, 'center', 'middle');
    }
    // Round strip
    const sy = stage.h - 12;
    for (let i = 0; i < rounds.length; i++) {
      const x = stage.w / 2 + (i - (rounds.length - 1) / 2) * 56;
      text(c, i < answers.length ? (roundErr(rounds[i], answers[i]) * 100).toFixed(1) : i === round ? '•' : '·', x, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(timer);
      clearTimeout(finTimer);
      controls.destroy();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
