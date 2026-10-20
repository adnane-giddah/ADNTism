// 00 · CALIBRATION — the homepage's own instrument. Hold, release at exactly a target duration.
import { sfx } from '../core/audio';
import { h } from '../core/dom';
import { bracket, clamp, easeOut, font, hair, line, pal, tag, text } from '../core/draw';
import { buzz, reducedMotion } from '../core/settings';
import { Stage } from '../core/stage';
import { capture } from '../core/input';
import { median } from '../core/scoring';

const TARGETS = [
  { v: 1, label: '1.000', name: 'one second' },
  { v: 0.5, label: '0.500', name: 'half a second' },
  { v: Math.SQRT2, label: '1.414', name: '√2 seconds' },
  { v: (Math.sqrt(5) - 1) / 2, label: '0.618', name: '1/φ seconds' },
  { v: Math.sqrt(3), label: '1.732', name: '√3 seconds' },
  { v: Math.PI / 2, label: '1.571', name: 'π/2 seconds' },
  { v: 2, label: '2.000', name: 'two seconds' },
  { v: 0.25, label: '0.250', name: 'a quarter second' },
];
const PASS = 0.025; // within 25 ms: calibrated, move on
const KEY = 'eps:cal';
const MAX = 2.5;

interface Saved {
  i: number;
  n: number;
  best: number | null;
  /** Personal baseline: last signed errors (ms) per target label. */
  bias?: Record<string, number[]>;
}

function load(): Saved {
  try {
    return { i: 0, n: 0, best: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { i: 0, n: 0, best: null };
  }
}

export function calibration() {
  const saved = load();
  let ti = saved.i % TARGETS.length;
  let target = TARGETS[ti];
  let holding = false;
  let t0 = 0;
  let last: { v: number; at: number } | null = null;
  let hist: number[] = [];
  let advanceNext = false;

  const num = h('span', { class: 'v', style: 'color:var(--ink-3)' }, '0.000');
  const errLine = h('p', { class: 'cal-err' }, 'Press and hold anywhere in this box. Release at exactly one second.');
  const tgtLabel = h('span', { class: 'mono' }, target.label + ' s');
  const tgtName = h('span', { class: 'cap' }, target.name);
  const status = h('span', { class: 'cap' }, saved.n ? `${saved.n} attempts on this device` : 'Space works too');
  // Personal baseline: over/under-estimation at this target. Not a device-latency calibration.
  const tendency = h('p', { class: 'cal-tend cap' });
  const paintTendency = () => {
    const b = saved.bias?.[target.label] ?? [];
    if (b.length < 3) {
      tendency.textContent = 'Measures duration control — how well you produce a length of time. Not reaction speed.';
      return;
    }
    const m = median(b);
    tendency.textContent = `Your tendency at ${target.label} s: ${Math.abs(Math.round(m))} ms ${m < 0 ? 'early' : 'late'} (median of your last ${b.length}). A personal baseline, not a device calibration.`;
  };
  paintTendency();
  const rec = h('span', { class: 'cap rec', hidden: true }, '● measuring');
  const host = h('div', { class: 'cal-canvas' });

  const el = h(
    'div',
    {
      class: 'cal frame',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Calibration. Press and hold, release at exactly the target duration.',
    },
    h(
      'div',
      { class: 'cal-head' },
      h('span', { class: 'cap' }, '00 · Calibration'),
      rec,
      h('span', { class: 'cal-target' }, h('span', { class: 'cap' }, 'Target '), tgtLabel, ' ', tgtName),
    ),
    h('div', { class: 'cal-read', 'aria-live': 'polite' }, num, h('span', { class: 'u' }, 's'), errLine),
    host,
    tendency,
    h('div', { class: 'cal-foot' }, status, h('span', { class: 'cap' }, 'press → release')),
  );

  const stage = new Stage(host);

  function setTarget(i: number) {
    ti = i % TARGETS.length;
    target = TARGETS[ti];
    tgtLabel.textContent = target.label + ' s';
    tgtName.textContent = target.name;
    hist = [];
    last = null;
    persist();
    paintTendency();
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ i: ti, n: saved.n, best: saved.best, bias: saved.bias }));
    } catch {
      /* ignore */
    }
  }

  function down(ts: number) {
    if (holding) return;
    if (advanceNext) {
      advanceNext = false;
      setTarget(ti + 1);
    }
    holding = true;
    t0 = ts;
    el.dataset.holding = '';
    rec.hidden = false;
    num.textContent = '·.···';
    num.style.color = 'var(--ink-3)';
    errLine.textContent = 'Release at ' + target.label + ' s.';
    sfx.press();
    buzz(8);
    stage.request();
  }

  function up(ts: number) {
    if (!holding) return;
    holding = false;
    delete el.dataset.holding;
    rec.hidden = true;
    const v = (ts - t0) / 1000;
    const err = v - target.v;
    last = { v, at: performance.now() };
    hist.push(v);
    if (hist.length > 12) hist.shift();
    saved.n++;
    const abs = Math.abs(err);
    if (saved.best == null || abs < saved.best) saved.best = abs;
    saved.bias ??= {};
    const b = (saved.bias[target.label] ??= []);
    b.push(Math.round(err * 1000));
    if (b.length > 10) b.shift();
    persist();
    paintTendency();

    num.textContent = v.toFixed(3);
    num.style.color = '';
    const ms = Math.round(abs * 1000);
    if (ms === 0) {
      errLine.innerHTML = '<b>Exact.</b> Less than half a millisecond off.';
      sfx.perfect();
    } else {
      const dir = err < 0 ? 'early' : 'late';
      errLine.innerHTML = `<b>${ms} ms ${dir}.</b> ${abs <= PASS ? 'Calibrated — next target unlocked.' : abs < 0.06 ? 'Close. Again.' : 'Try again.'}`;
      if (abs <= PASS) sfx.near();
      else sfx.release();
    }
    if (abs <= PASS) advanceNext = true;
    status.textContent = `${saved.n} attempts · best ${Math.round((saved.best ?? 0) * 1000)} ms off`;
    buzz(abs <= PASS ? [10, 40, 10] : 12);
    stage.request();
  }

  // Pointer: anywhere in the box. Keyboard: Space / Enter while focused.
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    capture(el, e.pointerId);
    down(e.timeStamp);
  });
  el.addEventListener('pointerup', (e) => up(e.timeStamp));
  el.addEventListener('pointercancel', (e) => up(e.timeStamp));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('keydown', (e) => {
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      down(e.timeStamp);
    }
  });
  el.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      up(e.timeStamp);
    }
  });
  el.addEventListener('blur', () => holding && up(performance.now()));

  stage.draw = (now) => {
    const c = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    const L = 10;
    const R = W - 10;
    const x = (v: number) => L + (clamp(v, 0, MAX) / MAX) * (R - L);
    const y = Math.round(H * 0.34);
    let anim = false;

    // Main ruler
    hair(c, L, y, R, y, pal.ink);
    for (let i = 0; i <= MAX * 10 + 1e-6; i++) {
      const v = i / 10;
      const major = i % 5 === 0;
      hair(c, x(v), y, x(v), y + (major ? 10 : 4), major ? pal.ink2 : pal.ink3);
      if (major) text(c, v.toFixed(1) + (i === MAX * 10 ? ' s' : ''), x(v), y + 24, font.mono(10), pal.ink3, i === MAX * 10 ? 'right' : i === 0 ? 'left' : 'center');
    }

    // History: faint ticks for earlier attempts
    hist.slice(0, -1).forEach((v, i, arr) => {
      c.globalAlpha = 0.25 + (0.5 * (i + 1)) / arr.length;
      hair(c, x(v), y - 6, x(v), y + 1, pal.ink3);
      c.globalAlpha = 1;
    });

    // Target
    const tx = x(target.v);
    line(c, tx, y - 34, tx, y, pal.ink, 1.5);
    c.beginPath();
    c.moveTo(tx - 5, y - 40);
    c.lineTo(tx + 5, y - 40);
    c.lineTo(tx, y - 34);
    c.closePath();
    c.fillStyle = pal.ink;
    c.fill();

    if (last) {
      const p = reducedMotion() ? 1 : easeOut((now - last.at) / 380);
      anim = p < 1;
      const lx = x(last.v);
      const err = last.v - target.v;
      const drop = y - 20 - (1 - p) * 30;
      c.globalAlpha = p;
      line(c, lx, drop, lx, y, pal.signal, 2);
      c.beginPath();
      c.arc(lx, y, 3.5, 0, Math.PI * 2);
      c.fillStyle = pal.signal;
      c.fill();
      if (Math.abs(lx - tx) > 3) bracket(c, tx, y - 26, lx, y - 26, pal.signal, 4);
      c.globalAlpha = 1;
      if (last.v > MAX) tag(c, '> 2.5 s', R - 30, y - 50, pal.signal, 10);

      // Magnifier: target ± 100 ms, so small errors are visible.
      const zy = Math.round(H * 0.74);
      const span = 0.1;
      const zx = (v: number) => L + ((clamp(v, target.v - span, target.v + span) - (target.v - span)) / (2 * span)) * (R - L);
      c.globalAlpha = 0.5 * p;
      c.fillStyle = pal.line2;
      c.beginPath();
      c.moveTo(x(target.v - span), y + 1);
      c.lineTo(x(target.v + span), y + 1);
      c.lineTo(R, zy);
      c.lineTo(L, zy);
      c.closePath();
      c.fill();
      c.globalAlpha = p;
      hair(c, L, zy, R, zy, pal.ink);
      for (let i = -10; i <= 10; i++) {
        const v = target.v + i / 100;
        hair(c, zx(v), zy, zx(v), zy + (i % 5 === 0 ? 8 : 4), i % 5 === 0 ? pal.ink2 : pal.ink3);
        if (i % 5 === 0 && i !== 0) text(c, (i > 0 ? '+' : '−') + Math.abs(i * 10), zx(v), zy + 20, font.mono(10), pal.ink3, i === -10 ? 'left' : i === 10 ? 'right' : 'center');
      }
      text(c, '×' + Math.round(MAX / (2 * span)) + ' · ms', L, zy - 8, font.mono(10, 500), pal.ink3, 'left');
      line(c, zx(target.v), zy - 18, zx(target.v), zy, pal.ink, 1.5);
      if (Math.abs(err) <= span) {
        const zl = zx(last.v);
        line(c, zl, zy - 14, zl, zy, pal.signal, 2);
        if (Math.abs(zl - zx(target.v)) > 2) bracket(c, zx(target.v), zy - 22, zl, zy - 22, pal.signal, 4);
        tag(c, (err < 0 ? '−' : '+') + Math.round(Math.abs(err) * 1000) + ' ms', zl, zy - 36, pal.signal, 11);
      } else {
        tag(c, err < 0 ? '◂ off scale' : 'off scale ▸', err < 0 ? L + 44 : R - 44, zy - 14, pal.signal, 10);
      }
      c.globalAlpha = 1;
    } else {
      text(c, 'A ruler. Somewhere on it is the moment you let go.', (L + R) / 2, H * 0.74, font.mono(11), pal.ink3, 'center');
    }
    return anim;
  };
  stage.start();

  return { el, destroy: () => stage.destroy() };
}
