// 08 · ECHO — interval memory. Hear a rhythm; tap it back. Only your own gaps are scored.
import { bracket, clamp, font, hair, line, pal, tag, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { bar, glow, plate, slot } from '../core/materials';
import { rng } from '../core/rng';
import { settings } from '../core/settings';
import type { GameFactory, Level } from '../core/types';

const LEAD = 450; // ms before the first pulse
const REPEAT_GAP = 1000; // ms between the two playings on Easy

/** Gap vocabularies in beats. Hard mixes tuplets, dotted values and two irrational lengths. */
const VOCAB = {
  easy: [1, 2],
  medium: [0.5, 1, 1, 1.5, 2, 0.75],
  hard: [1 / 3, 2 / 3, 1 / 4, 3 / 4, 1 / 2, 3 / 2, 5 / 4, Math.SQRT1_2, (Math.sqrt(5) - 1) / 2, 1],
};

export function makePattern(seed: number, level: Level) {
  const r = rng(seed);
  if (level === 'easy') {
    const base = r.range(360, 440);
    for (let i = 0; i < 100; i++) {
      const g = Array.from({ length: 3 }, () => base * r.pick(VOCAB.easy));
      if (new Set(g).size > 1) return g;
    }
    return [base, base * 2, base];
  }
  if (level === 'medium') {
    const base = r.range(280, 420);
    for (let tries = 0; tries < 200; tries++) {
      const gaps = Array.from({ length: 4 }, () => base * r.pick(VOCAB.medium));
      const total = gaps.reduce((a, b) => a + b, 0);
      const distinct = new Set(gaps.map((g) => Math.round(g))).size;
      if (total < 2600 && total > 900 && Math.min(...gaps) >= 140 && distinct >= 2) return gaps;
    }
    return [base, base / 2, base / 2, base];
  }
  // Hard: an eight-gap theme over a slowing tempo (ritardando ≈ 4% per note).
  const base = r.range(390, 470);
  const triplets = [1 / 3, 2 / 3];
  const irrational = [Math.SQRT1_2, (Math.sqrt(5) - 1) / 2];
  for (let tries = 0; tries < 2000; tries++) {
    const beats = Array.from({ length: 8 }, () => r.pick(VOCAB.hard));
    if (!beats.some((b) => triplets.includes(b))) continue;
    if (!beats.some((b) => irrational.includes(b))) continue;
    if (!beats.some((b) => b === 3 / 4 || b === 3 / 2)) continue;
    if (new Set(beats).size < 6) continue;
    const gaps = beats.map((b, i) => base * b * (1 + 0.04 * i));
    const total = gaps.reduce((a, b) => a + b, 0);
    if (total > 4600 || total < 2400 || Math.min(...gaps) < 110) continue;
    return gaps;
  }
  return [1 / 3, 2 / 3, 3 / 4, Math.SQRT1_2, 1 / 2, 3 / 2, 1 / 4, 5 / 4].map((b, i) => base * b * (1 + 0.04 * i));
}

/** Rhythm memory (Held mode): the silent hold before you may tap, per level (ms). */
export const HOLD: Record<Level, number> = { easy: 3000, medium: 4000, hard: 5000 };

/**
 * Held mode: the same pattern, with a deliberate tempo change on top (accelerando or ritardando,
 * 6% per note). The changed schedule is the ground truth you must reproduce.
 */
export function makeHeldPattern(seed: number, level: Level) {
  const base = makePattern(seed, level);
  const dir = rng(seed ^ 0x2545f491).sign();
  return base.map((g, i) => g * (1 + dir * 0.06 * i));
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let gaps: number[] = [];
  let phase: 'ready' | 'play' | 'hold' | 'tap' | 'done' = 'ready';
  let holdAt = 0;
  const held = () => api.mode === 'held';
  let playAt = 0;
  let taps: number[] = [];
  let tapsWall: number[] = [];
  let timers: number[] = [];
  let doneAt = 0;
  let keyDown = false;
  let repeats = 1;
  let blind = false; // Hard: sound only
  let replayAt = 0; // result screen: hear the reference rhythm again

  const pulses = () => gaps.length + 1;
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const offsets = () => {
    const o = [0];
    for (const g of gaps) o.push(o[o.length - 1] + g);
    return o;
  };

  function reset(seed: number) {
    clearTimers();
    gaps = held() ? makeHeldPattern(seed, api.level) : makePattern(seed, api.level);
    replayAt = 0;
    repeats = api.level === 'easy' ? 2 : 1;
    // Without sound there is nothing to hear, so Hard falls back to showing the pulses.
    blind = api.level === 'hard' && settings.sound;
    phase = 'ready';
    taps = [];
    tapsWall = [];
    keyDown = false;
    api.progress('');
    const n = pulses();
    if (api.level === 'hard')
      api.prompt(
        `Press to hear ${n} pulses — once, with nothing to watch.`,
        settings.sound ? 'Triplets, dotted notes, irrational gaps · the tempo slows' : 'Sound is off, so the pulses will be drawn instead',
      );
    else if (api.firstTime) api.prompt(`Press to hear ${n} pulses${repeats > 1 ? ' — played twice' : ' — once'}. Then tap them back.`, 'Watch the gaps, not the beat');
    else api.prompt('Press to listen.', repeats > 1 ? 'You’ll hear it twice' : 'Once only');
    stage.request();
  }

  function play() {
    phase = 'play';
    playAt = performance.now() + LEAD;
    const off = offsets();
    const total = off[off.length - 1];
    for (let r = 0; r < repeats; r++) off.forEach((o) => api.sfx.pulse((LEAD + r * (total + REPEAT_GAP) + o) / 1000));
    api.prompt(blind ? 'Listen. Eyes closed, if you like.' : 'Listen.', '');
    api.progress('listening');
    const end = LEAD + (repeats - 1) * (total + REPEAT_GAP) + total + 500;
    const toTap = () => {
      phase = 'tap';
      api.prompt(`Your turn. ${pulses()} taps.`, held() ? 'Keep its tempo change · the first tap starts your clock' : 'The first tap starts your clock');
      api.progress(`0 / ${pulses()}`);
      stage.request();
    };
    timers.push(
      window.setTimeout(() => {
        if (!held()) return toTap();
        // Rhythm memory: a silent hold before you may answer.
        phase = 'hold';
        holdAt = performance.now();
        api.prompt(`Hold it in memory — ${HOLD[api.level] / 1000} s of silence.`, 'Taps now don’t count');
        api.progress('hold');
        timers.push(window.setTimeout(toTap, HOLD[api.level]));
        stage.request();
      }, end),
    );
    stage.request();
  }

  /** Result screen only: replay the reference with a moving playhead (works with sound off too). */
  function replay() {
    if (phase !== 'done') return;
    replayAt = performance.now() + 150;
    offsets().forEach((o) => api.sfx.pulse((150 + o) / 1000));
    stage.request();
  }

  function tap(ts: number) {
    if (phase === 'ready') return play();
    if (phase !== 'tap') return;
    taps.push(ts);
    tapsWall.push(performance.now());
    api.sfx.tick();
    api.buzz(6);
    api.progress(`${taps.length} / ${pulses()}`);
    if (taps.length === 1) api.prompt('');
    if (taps.length === pulses()) finish();
    stage.request();
  }

  function finish() {
    phase = 'done';
    doneAt = performance.now();
    const mine = taps.slice(1).map((t, i) => t - taps[i]);
    const errs = mine.map((g, i) => g - gaps[i]);
    const mean = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
    const totalT = gaps.reduce((a, b) => a + b, 0);
    const totalM = mine.reduce((a, b) => a + b, 0);
    // Shape error: forgive a uniformly faster/slower tempo.
    const k = totalT / totalM;
    const shape = mine.reduce((a, g, i) => a + Math.abs(g * k - gaps[i]), 0) / mine.length;
    const disp = String(Math.round(mean));
    const tempo = (totalM / totalT - 1) * 100;
    const worst = errs.reduce((w, e, i) => (Math.abs(e) > Math.abs(errs[w]) ? i : w), 0);
    // The reveal cascades along your taps: each lands with a burst coloured by how close that gap was.
    {
      const L = Math.max(28, stage.w * 0.06);
      const R = stage.w - L;
      const off = offsets();
      const span = off[off.length - 1] * 1.1;
      const y2 = Math.max(120, stage.h * 0.33) + Math.max(110, stage.h * 0.24);
      const st = api.stars?.();
      taps.forEach((tp, i) => {
        if (!i) return;
        const e = Math.abs(errs[i - 1]);
        const col = st && e <= st[2] ? pal.accent : st && e <= st[0] ? pal.ink : '#FFB834';
        const x = L + (clamp(tp - taps[0], -60, span) / span) * (R - L);
        timers.push(window.setTimeout(() => api.fx.burst(x, y2 - 20, col, 10, 140, 1.8), 120 + i * 90));
      });
    }
    timers.push(
      window.setTimeout(
        () =>
          api.finish({
            score: mean,
            value: disp,
            unit: 'ms',
            label: 'mean gap error',
            headline:
              Math.abs(tempo) > 4
                ? `You played it ${Math.abs(tempo).toFixed(0)}% ${tempo > 0 ? 'slower' : 'faster'}. With tempo forgiven, the shape was off by ${Math.round(shape)} ms.`
                : `Tempo held. Each gap was ${disp} ms off on average — gap ${worst + 1} was the hardest.`,
            rows: [
              ...gaps.map((g, i) => [`Gap ${i + 1} · ${Math.round(g)} ms`, `${errs[i] >= 0 ? '+' : '−'}${Math.abs(Math.round(errs[i]))} ms`] as [string, string]),
              ['Tempo', `${tempo >= 0 ? '+' : '−'}${Math.abs(tempo).toFixed(1)}%`],
              ['Shape (tempo forgiven)', `${Math.round(shape)} ms`],
            ],
            perfect: disp === '0',
            near: mean < (api.level === 'hard' ? 20 : 12),
            share: [`ECHO — ${pulses()} pulses, heard ${repeats > 1 ? 'twice' : 'once'}`, `${disp} ms mean gap error`],
            actions: [{ label: 'Hear the rhythm again', run: replay }],
          }),
        api.motion() ? 500 : 0,
      ),
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    tap(e.timeStamp);
  };
  // Hiding the tab mid-playback or mid-tapping voids the attempt.
  const onVis = () => {
    keyDown = false;
    if (document.hidden && (phase === 'play' || phase === 'hold' || phase === 'tap')) api.voidRun('Attempt voided — the tab was hidden mid-rhythm.');
  };
  document.addEventListener('visibilitychange', onVis);
  stage.canvas.addEventListener('pointerdown', onDown);
  const offs = [
    listen('keydown', (e) => {
      if (e.code !== 'Space' || !gameKey(e)) return;
      e.preventDefault();
      if (e.repeat || keyDown) return;
      keyDown = true;
      tap(e.timeStamp);
    }),
    listen('keyup', (e) => {
      if (e.code === 'Space') keyDown = false;
    }),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    const L = Math.max(28, W * 0.06);
    const R = W - L;
    const off = offsets();
    const total = off[off.length - 1];
    const span = total * 1.1;
    const X = (ms: number) => L + (clamp(ms, -60, span) / span) * (R - L);
    const y1 = Math.max(120, H * 0.33);
    const y2 = y1 + Math.max(110, H * 0.24);
    const step = total > 3000 ? 250 : 100;
    const label = total > 3000 ? 1000 : 500;
    let more = false;

    // A playhead: a fine line with a small pointer on top.
    const head = (x: number, top: number, bottom: number) => {
      glow(c, x, (top + bottom) / 2, 26, pal.accent, 0.5);
      hair(c, x, top, x, bottom, pal.accent);
      c.beginPath();
      c.moveTo(x - 4, top - 6);
      c.lineTo(x + 4, top - 6);
      c.lineTo(x, top);
      c.closePath();
      c.fillStyle = pal.accent;
      c.fill();
    };
    // A pulse: a rounded stem, with a bloom while it sounds.
    const pulse = (x: number, y: number, flash: number, color = pal.ink) => {
      if (flash > 0) glow(c, x, y - 30 - flash * 10, 34, color, flash);
      c.lineCap = 'round';
      line(c, x, y - 30 - flash * 10, x, y - 2, color, 3.5);
      c.lineCap = 'butt';
    };
    for (const [y, lbl] of [
      [y1, blind && phase !== 'done' ? 'HEARD · not shown' : 'HEARD'],
      [y2, 'TAPPED'],
    ] as const) {
      plate(c, L - 16, y - 60, R - L + 32, 92, 14);
      slot(c, L, y, R, y, 6);
      text(c, lbl, L, y - 52, font.mono(10, 500), pal.ink3, 'left');
      for (let ms = 0; ms <= span; ms += step) hair(c, X(ms), y + 4, X(ms), y + (ms % label === 0 ? 12 : 7), ms % label === 0 ? pal.ink3 : pal.line);
      for (let ms = 0; ms <= span; ms += label) text(c, `${ms / 1000}s`, X(ms), y + 24, font.mono(9), pal.ink3, 'center');
    }

    // Heard pulses appear as they sound (not on Hard, until the reveal).
    let heardT = phase === 'play' ? now - playAt : phase === 'ready' ? -1 : Infinity;
    if (phase === 'play' && heardT > total + REPEAT_GAP / 2 && repeats > 1) heardT -= total + REPEAT_GAP;
    // Held mode is a memory test: the heard pattern stays hidden while you hold and answer.
    const showHeard = (!blind || phase === 'done') && !(held() && (phase === 'hold' || phase === 'tap'));
    if (showHeard) {
      off.forEach((o, i) => {
        if (heardT < o) return;
        const flash = api.motion() ? clamp(1 - (heardT - o) / 160, 0, 1) : 0;
        pulse(X(o), y1, flash, pal.accent);
        if (i > 0 && (phase === 'tap' || phase === 'done') && X(o) - X(off[i - 1]) > 26) {
          hair(c, X(off[i - 1]) + 3, y1 - 14, X(o) - 3, y1 - 14, pal.ink3);
          text(c, String(Math.round(gaps[i - 1])), (X(off[i - 1]) + X(o)) / 2, y1 - 20, font.mono(10), pal.ink2, 'center');
        }
      });
    }
    if (phase === 'play') {
      if (!blind && heardT >= 0 && heardT <= total + 300) head(X(heardT), y1 - 44, y1 + 4);
      if (blind) {
        // Only a breathing dot: you know it's playing, nothing more.
        const p = api.motion() ? 0.5 + 0.5 * Math.sin(now / 180) : 1;
        c.globalAlpha = 0.3 + 0.7 * p;
        text(c, '● listening', (L + R) / 2, y1 - 20, font.mono(12, 500), pal.accent, 'center');
        c.globalAlpha = 1;
      }
      if (heardT < 0) text(c, 'get ready', (L + R) / 2, y1 - 64, font.mono(11), pal.ink3, 'center');
      more = true;
    }

    // Tapped pulses, aligned to your first tap
    if (taps.length) {
      const mine = taps.map((t) => t - taps[0]);
      mine.forEach((m, i) => {
        const flash = api.motion() ? clamp(1 - (now - tapsWall[i]) / 160, 0, 1) : 0;
        if (flash > 0) more = true;
        pulse(X(m), y2, flash);
        if (phase === 'done' && i > 0) {
          // Where this tap should have been, given your previous tap
          const should = mine[i - 1] + gaps[i - 1];
          const e = m - should;
          line(c, X(should), y2 - 26, X(should), y2, pal.ink3, 1, [2, 2]);
          if (Math.abs(X(m) - X(should)) > 2) bracket(c, X(should), y2 + 40 + (i % 2) * 18, X(m), y2 + 40 + (i % 2) * 18, pal.signal, 3, 1.5);
          tag(c, `${e >= 0 ? '+' : '−'}${Math.abs(Math.round(e))}`, (X(should) + X(m)) / 2, y2 + 54 + (i % 2) * 18, pal.signal, 10);
        }
      });
      if (phase === 'tap') {
        const el = now - tapsWall[0];
        head(X(el), y2 - 44, y2 + 4);
        more = true;
      }
    } else if (phase === 'tap') {
      const p = api.motion() ? 0.5 + 0.5 * Math.sin(now / 200) : 1;
      c.globalAlpha = 0.4 + 0.6 * p;
      text(c, 'tap anywhere ▾', L, y2 - 30, font.mono(11, 500), pal.ink, 'left');
      c.globalAlpha = 1;
      if (api.motion()) more = true;
    }

    if (phase === 'done' && replayAt) {
      const rt = now - replayAt;
      if (rt >= -150 && rt <= total + 200) {
        head(X(Math.max(0, rt)), y1 - 44, y1 + 4);
        more = true;
      }
    }
    if (phase === 'done') {
      const rp = api.motion() ? clamp((now - doneAt) / 400, 0, 1) : 1;
      if (rp < 1) more = true;
      c.globalAlpha = 0.35 * rp;
      off.forEach((o) => line(c, X(o), y2 - 30, X(o), y2, pal.ink3, 3));
      c.globalAlpha = 1;
    }
    if (phase === 'hold') {
      const left = clamp(1 - (now - holdAt) / HOLD[api.level], 0, 1);
      // Shown on the (still empty) TAPPED plate.
      const mid = (L + R) / 2;
      const hy = y2 - 22;
      slot(c, mid - 120, hy, mid + 120, hy, 6);
      bar(c, mid - 120, hy - 3, 240 * left, 6, pal.ink3, 3);
      text(c, 'silence — hold the rhythm', mid, hy - 12, font.mono(11, 500), pal.ink3, 'center');
      more = true;
    }
    if (phase === 'ready') text(c, 'press anywhere to listen', (L + R) / 2, (y1 + y2) / 2, font.mono(12, 500), pal.ink2, 'center');
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimers();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
