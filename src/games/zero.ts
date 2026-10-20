// 01 · ZERO — signed time. Blind holds with alternating signs. The total must end at exactly zero.
// Easy: 2 holds, live total. Medium: 4 blind holds. Hard: 6 blind holds and the total is never shown.
import { clamp, easeOut, font, hair, hatch, line, pal, bracket, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { alpha, bar, glow, plate, rr } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

/**
 * Weighted mode: each hold carries a coefficient — ×½ counts half, ×2 counts double (Hard adds ×⅓ and ×3).
 * Signs still alternate + − + −; at least one weight differs from 1. Seeded, so a run can be replayed.
 */
export function makeWeights(seed: number, level: Level): number[] {
  const r = rng(seed);
  const n = level === 'easy' ? 2 : level === 'hard' ? 6 : 4;
  const mags = level === 'hard' ? [1 / 3, 1 / 2, 1, 2, 3] : [1 / 2, 1, 2];
  for (let t = 0; t < 100; t++) {
    const w = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : -1) * r.pick(mags));
    if (w.some((x) => Math.abs(x) !== 1)) return w;
  }
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 2 : -1));
}

/** "+", "−", "+×2", "−×½" … */
export const coefLabel = (w: number) => {
  const m = Math.abs(w);
  const k = m === 1 ? '' : m === 0.5 ? '×½' : Math.abs(m - 1 / 3) < 1e-9 ? '×⅓' : `×${m}`;
  return (w > 0 ? '+' : '−') + k;
};


const factory: GameFactory = (api) => {
  const { stage } = api;
  let strokes: number[] = [];
  let holding = false;
  let t0 = 0;
  let animAt = 0;
  let scale = 1.5;
  let finishedAt = 0;
  let shortAt = -1e9;
  let keyDown = false;
  let finTimer = 0;
  let sparkedFor = 0;
  // Decoy mode: a false metronome that ticks while you hold.
  let seedV = 0;
  let decoyTimer = 0;
  let decoyFlash = -1e9;
  const decoy = () => api.mode === 'decoy';
  let SIGNS = [1, -1, 1, -1];
  let MIN = 0.3;
  let live = false; // Easy: watch the bar grow while holding
  let dark = false; // Hard: the running total is never shown
  const n = () => SIGNS.length;
  const words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

  const total = () => strokes.reduce((a, v, i) => a + SIGNS[i] * v, 0);

  function promptFor() {
    const i = strokes.length;
    const S = total();
    const N = n();
    api.progress(`${Math.min(i + 1, N)} / ${N}`);
    const w = Math.abs(SIGNS[i] ?? 1);
    const weight = w === 1 ? '' : w > 1 ? ` · counts ${coefLabel(SIGNS[i]).slice(1)}` : ` · counts only ${coefLabel(SIGNS[i]).slice(1)}`;
    const sub = `Stroke ${i + 1} · ${SIGNS[i] > 0 ? 'adds' : 'subtracts'}${weight}${live ? '' : ' · you can’t see the clock'}`;
    const min = MIN.toFixed(3);
    if (dark) {
      if (i === 0) api.prompt(`${words[N]} holds: ${SIGNS.map(coefLabel).join(' ')}. You will never see the total. Keep it in your head.`, `${sub} · each hold ≥ ${min} s`);
      else if (i === N - 1) api.prompt('Last one. Wherever you think the total is — cancel it.', sub);
      else api.prompt(SIGNS[i] > 0 ? 'Add.' : 'Subtract.', sub);
      return;
    }
    if (i === 0) api.prompt(api.firstTime ? 'Press and hold anywhere. Let go whenever you like.' : 'Hold. Release.', `Stroke 1 · adds time · ≥ ${min} s`);
    else if (i === N - 1) api.prompt(`Last one. Bring ${signed(S, 3)} to zero.`, sub);
    else if (SIGNS[i] < 0) api.prompt(`Subtract. Hold for ${(S / Math.abs(SIGNS[i])).toFixed(3)} s to cancel it — or don’t, and fix it later.`, sub);
    else api.prompt(`Add again — anything over ${min} s.`, sub);
  }

  function reset(seed: number) {
    seedV = seed;
    clearTimeout(decoyTimer);
    const lv = api.level;
    SIGNS = api.mode === 'weighted' ? makeWeights(seed, lv) : lv === 'easy' ? [1, -1] : lv === 'hard' ? [1, -1, 1, -1, 1, -1] : [1, -1, 1, -1];
    MIN = lv === 'hard' ? 0.4 : 0.3;
    live = lv === 'easy';
    // Practice on Hard reveals the running total; ranked Hard keeps it hidden.
    dark = lv === 'hard' && !api.practice;
    strokes = [];
    sparkedFor = 0;
    holding = false;
    keyDown = false;
    scale = 1.5;
    finishedAt = 0;
    animAt = 0;
    clearTimeout(finTimer);
    promptFor();
    stage.request();
  }

  function down(ts: number) {
    if (holding || strokes.length >= n()) return;
    holding = true;
    t0 = ts;
    api.sfx.press();
    api.buzz(6);
    api.prompt(SIGNS[strokes.length] > 0 ? 'Adding…' : 'Subtracting…', decoy() ? 'Release to commit · the ticking is a decoy' : 'Release to commit');
    if (decoy()) startDecoy();
    stage.request();
  }

  /** Seeded per stroke: a tempo near — never at — one second, with a little jitter so it can't be locked onto. */
  function startDecoy() {
    clearTimeout(decoyTimer);
    const r = rng((seedV ^ 0x9e3779b9) + strokes.length * 7919);
    const period = r.range(780, 1260);
    const tick = () => {
      if (!holding) return;
      api.sfx.pulse();
      decoyFlash = performance.now();
      stage.request();
      decoyTimer = window.setTimeout(tick, period * r.range(0.95, 1.05));
    };
    decoyTimer = window.setTimeout(tick, r.range(150, period));
  }

  function up(ts: number) {
    if (!holding) return;
    holding = false;
    clearTimeout(decoyTimer);
    const d = (ts - t0) / 1000;
    if (d < MIN) {
      shortAt = performance.now();
      api.sfx.over();
      api.prompt(`Too short: ${d.toFixed(3)} s. Every hold must be at least ${MIN.toFixed(3)} s.`, 'That one didn’t count');
      stage.request();
      return;
    }
    strokes.push(d);
    animAt = performance.now();
    api.sfx.release();
    api.buzz(10);
    if (strokes.length < n()) promptFor();
    else finish();
    stage.request();
  }

  function finish() {
    finishedAt = performance.now();
    const S = total();
    const ms = Math.round(Math.abs(S) * 1000);
    const perfect = ms === 0;
    api.prompt('');
    api.progress('done');
    const fmt = strokes.map((v, i) => [`Stroke ${i + 1} (${coefLabel(SIGNS[i])})`, `${signed(SIGNS[i] * v, 3)} s${Math.abs(SIGNS[i]) !== 1 ? ` · held ${v.toFixed(3)} s` : ''}`] as [string, string]);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: Math.abs(S),
          value: Math.abs(S).toFixed(3),
          unit: 's',
          label: 'distance from zero',
          headline: perfect
            ? `${words[n()]} holds cancelled to the millisecond.`
            : `Your ${words[n()].toLowerCase()} holds summed to ${signed(S, 3)} s — ${ms} ms ${S > 0 ? 'over' : 'under'} zero.`,
          rows: [['Final total', signed(S, 3) + ' s'], ...fmt, ['Time held', strokes.reduce((a, b) => a + b, 0).toFixed(3) + ' s']],
          perfect,
          near: ms <= 10,
          share: [`ZERO · ${api.level} — ${words[n()].toLowerCase()} holds, ${SIGNS.map(coefLabel).join(' ')}`, `ended ${signed(S, 3)} s from zero`],
        }),
      api.motion() ? 550 : 0,
    );
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    capture(stage.canvas, e.pointerId);
    down(e.timeStamp);
  };
  const onUp = (e: PointerEvent) => primary(e) && up(e.timeStamp);
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointerup', onUp);
  // A cancelled touch (system gesture, palm rejection) must never commit a hold.
  const onCancel = (e: PointerEvent) => {
    if (!primary(e) || !holding) return;
    holding = false;
    api.prompt('That press was interrupted — it didn’t count.', 'Hold again');
    stage.request();
  };
  stage.canvas.addEventListener('pointercancel', onCancel);
  const offs = [
    listen('keydown', (e) => {
      if (e.code !== 'Space' || !gameKey(e)) return;
      e.preventDefault();
      if (e.repeat || keyDown) return;
      keyDown = true;
      down(e.timeStamp);
    }),
    listen('keyup', (e) => {
      if (e.code !== 'Space') return;
      keyDown = false;
      up(e.timeStamp);
    }),
    listen('blur', () => {
      keyDown = false;
      if (holding) {
        holding = false;
        promptFor();
        stage.request();
      }
    }),
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  stage.draw = (now) => {
    const c = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    // The ledger sits right of a gutter holding the row numbers and ADD / SUB chips.
    const gutter = 100;
    const cx = W / 2 + gutter / 2;
    const motion = api.motion();
    let more = false;

    const ap = motion ? easeOut((now - animAt) / 320) : 1;
    if (ap < 1) more = true;

    // Partial sums with the newest one animating in.
    const parts: number[] = [];
    let s = 0;
    strokes.forEach((v, i) => {
      const k = i === strokes.length - 1 ? ap : 1;
      s += SIGNS[i] * v * k;
      parts.push(s);
    });
    const done = strokes.length === n();
    // Hard: the scale must not move either, or it would leak the total.
    const need = dark && !done ? 2.5 : Math.max(1.2, ...parts.map((p) => Math.abs(p) * 1.25));
    const target = Math.ceil(need * 2) / 2;
    scale += (target - scale) * (motion ? 0.15 : 1);
    if (Math.abs(target - scale) > 0.002) more = true;
    else scale = target;
    const half = Math.max(60, Math.min((W - gutter - 48) / 2, 520));
    const X = (v: number) => cx + (v / scale) * half;

    const rows = n();
    const rh = clamp((H * 0.46) / rows, 30, 62);
    const bh = rh * 0.62;
    const big = clamp(Math.min(W * 0.07, H * 0.085), 30, 58);
    // Centre the whole apparatus (header, ledger, total, gauge) vertically on the bench.
    const contentH = rows * rh + 48 + big + 120;
    const top = Math.max(150, (H - contentH) / 2 + 30);
    const chipW = 62;
    const laneL = X(-scale);
    const laneR = X(scale);

    // Apparatus header: index, stroke vector, cycle stage dots.
    const hy = top - 58;
    text(c, 'APPARATUS: ', laneL - chipW - 8, hy, font.mono(11, 400), pal.ink3, 'left', 'middle');
    c.font = font.mono(11, 400);
    const aw = c.measureText('APPARATUS: ').width;
    text(c, 'CALIBRATED QUARTZ GAUGE', laneL - chipW - 8 + aw, hy, font.mono(11, 600), pal.ink, 'left', 'middle');
    const iNow = Math.min(strokes.length, rows - 1);
    if (!done) {
      const sv = `STROKE VECTOR: ${iNow + 1} (${SIGNS[iNow] > 0 ? '+' : '−'}) ${SIGNS[iNow] > 0 ? 'POSITIVE ACCUMULATION' : 'NEGATIVE CANCELLATION'}`;
      text(c, sv, cx, hy, font.mono(10, 600), SIGNS[iNow] > 0 ? pal.accent : pal.signal, 'center', 'middle');
    } else text(c, 'CYCLE COMPLETE · SEALED', cx, hy, font.mono(10, 600), pal.accent, 'center', 'middle');
    for (let i = 0; i < rows; i++) {
      const dx = laneR - (rows - 1 - i) * 13;
      const on = i < strokes.length;
      const cur = i === strokes.length && !done;
      if (on || cur) glow(c, dx, hy, 9, pal.accent, cur ? 0.8 : 0.4);
      c.beginPath();
      c.arc(dx, hy, 3.5, 0, Math.PI * 2);
      c.fillStyle = on ? pal.accent : cur ? pal.ink : pal.line;
      c.fill();
    }
    hair(c, laneL - chipW - 8, hy + 18, laneR, hy + 18, pal.line2);

    // Scale ruler, labelled in seconds; the datum at zero is the lab's cyan.
    const ry = top - 14;
    const step = scale > 2.5 ? 1 : 0.5;
    const minor = step / 5;
    for (let k = Math.ceil(-scale / minor - 1e-9); k <= Math.floor(scale / minor + 1e-9); k++) {
      const v = k * minor;
      const major = k % 5 === 0;
      if (v === 0) continue;
      hair(c, X(v), ry - (major ? 7 : 3), X(v), ry, major ? pal.ink3 : pal.line2);
      if (major) text(c, signed(v, 1) + 's', X(v), ry - 14, font.mono(10), pal.ink3, 'center');
    }
    line(c, cx, ry - 12, cx, ry, pal.accent, 2.5);
    text(c, '0.000', cx, ry - 18, font.mono(10, 600), pal.accent, 'center');
    hair(c, cx, ry, cx, top + rows * rh + 2, alpha(pal.accent, 0.55), [3, 3]);

    // Ledger rows: an ADD / SUB chip, then a recessed lane.
    for (let i = 0; i < rows; i++) {
      const y = top + i * rh + (rh - bh) / 2;
      const sign = SIGNS[i];
      const pos = sign > 0;
      const cur = i === strokes.length && !done;
      text(c, String(i + 1).padStart(2, '0'), laneL - chipW - 30, y + bh / 2, font.mono(11, 500), cur ? pal.ink : pal.ink3, 'left', 'middle');
      rr(c, laneL - chipW - 6, y, chipW, bh, 3);
      c.fillStyle = alpha(pos ? pal.accent : pal.signal, cur ? 0.18 : 0.08);
      c.fill();
      c.strokeStyle = alpha(pos ? pal.accent : pal.signal, cur ? 0.8 : 0.35);
      c.lineWidth = 1;
      c.stroke();
      const lab = `${pos ? '+' : '−'} ${pos ? 'ADD' : 'SUB'}${Math.abs(sign) !== 1 ? coefLabel(sign).slice(1) : ''}`;
      text(c, lab, laneL - chipW / 2 - 6, y + bh / 2 + 0.5, font.mono(Math.abs(sign) !== 1 ? 11 : 12, 600), pos ? pal.accent : pal.signal, 'center', 'middle');
      rr(c, laneL, y, laneR - laneL, bh, 3);
      c.fillStyle = alpha(pal.ink, cur ? 0.05 : 0.03);
      c.fill();
      c.strokeStyle = cur ? alpha(pal.ink, 0.16) : pal.line2;
      c.stroke();
      const a = i === 0 ? 0 : parts[i - 1];
      if (i < strokes.length && dark && !done) {
        // Committed, but unknown — a sealed row.
        rr(c, cx - 46, y + 3, 92, bh - 6, 2);
        c.fillStyle = hatch(c, pal.ink3, 4);
        c.fill();
        tag(c, 'SEALED', cx, y + bh / 2, pal.ink3, 9);
      } else if (i < strokes.length) {
        const b = parts[i];
        const x1 = X(Math.min(a, b));
        const w = Math.abs(X(b) - X(a));
        const over = done && i === rows - 1 && Math.abs(b) > 0.0005 && Math.sign(b) !== Math.sign(a) && a !== 0;
        if (pos) {
          // Added time: a polished ivory bar.
          const g = c.createLinearGradient(x1, 0, x1 + w, 0);
          g.addColorStop(0, alpha(pal.ink, 0.75));
          g.addColorStop(1, pal.ink);
          bar(c, x1, y + 2, w, bh - 4, pal.ink, 2);
          c.save();
          rr(c, x1, y + 2, w, bh - 4, 2);
          c.fillStyle = g;
          c.fill();
          c.restore();
        } else if (over) {
          // The final cancellation went past zero: coral hatch, the overrun made visible.
          rr(c, x1, y + 2, w, bh - 4, 2);
          c.fillStyle = alpha(pal.signal, 0.55);
          c.fill();
          c.fillStyle = hatch(c, alpha(pal.paper, 0.6), 6);
          c.fill();
        } else {
          // Subtracted time: a luminous cyan bar.
          const g = c.createLinearGradient(x1, 0, x1 + w, 0);
          g.addColorStop(0, alpha(pal.accent, 0.95));
          g.addColorStop(1, alpha(pal.accent, 0.6));
          c.save();
          c.shadowColor = alpha(pal.accent, 0.4);
          c.shadowBlur = 14;
          rr(c, x1, y + 2, w, bh - 4, 2);
          c.fillStyle = g;
          c.fill();
          c.restore();
        }
        const lbl = signed(sign * strokes[i], 3) + 's';
        c.font = font.mono(12, 600);
        const lw = c.measureText(lbl).width;
        const right = b >= a;
        if (w > lw + 18) text(c, lbl, right ? X(b) - 9 : X(b) + 9, y + bh / 2 + 0.5, font.mono(12, 600), pos ? pal.paper : over ? pal.ink : pal.paper, right ? 'right' : 'left', 'middle');
        else text(c, lbl, X(b) + (right ? 8 : -8), y + bh / 2, font.mono(12, 500), pal.ink2, right ? 'left' : 'right', 'middle');
        // carry line to next row
        if (i < rows - 1) hair(c, X(b), y + bh, X(b), y + rh, pal.ink3, [1, 2]);
        if (i === strokes.length - 1 && sparkedFor !== strokes.length && ap > 0.9) {
          sparkedFor = strokes.length;
          api.fx.burst(X(b), y + bh / 2, pos ? pal.ink : pal.accent, 14, 170, 2);
        }
      } else if (i === strokes.length && holding && live) {
        // Easy: the bar grows in real time.
        const d = Math.max(0, (now - t0) / 1000);
        const b = a + sign * d;
        c.globalAlpha = 0.55;
        bar(c, X(Math.min(a, b)), y + 2, Math.abs(X(b) - X(a)), bh - 4, pos ? pal.ink : pal.accent, 2);
        c.globalAlpha = 1;
        if (motion) glow(c, X(b), y + bh / 2, bh * 1.6, pal.accent);
        line(c, X(b), y - 6, X(b), y + bh + 6, pal.accent, 2);
        text(c, signed(b, 3), X(b) + (sign > 0 ? 8 : -8), y + bh / 2, font.mono(12, 600), pal.accent, sign > 0 ? 'left' : 'right', 'middle');
        more = true;
      } else if (i === strokes.length && holding) {
        // Measuring blind: a glow that shimmers without any countable rhythm (it must not become a clock).
        const sh = 0.6 + 0.4 * Math.random();
        if (decoy() && now - decoyFlash < 180) glow(c, X(a), y + bh / 2, bh * 3.2, '#FFB834', 1 - (now - decoyFlash) / 180);
        glow(c, X(a), y + bh / 2, bh * 1.9, pal.accent, 0.7 * sh);
        c.fillStyle = pal.accent;
        c.fillRect(X(a) - 1.5, y - 5, 3, bh + 10);
        text(c, sign > 0 ? 'ACCUMULATING  ▸' : '◂  CANCELLING', X(a) + (sign > 0 ? 14 : -14), y + bh / 2, font.mono(11, 600), pal.accent, sign > 0 ? 'left' : 'right', 'middle');
        more = true;
      } else if (cur) {
        // Waiting for this stroke: an arrow at its start, pointing the way it will go.
        const ax = X(a);
        const dir = sign > 0 ? 1 : -1;
        c.fillStyle = alpha(pos ? pal.accent : pal.signal, 0.75);
        c.beginPath();
        c.moveTo(ax + dir * 12, y + bh / 2);
        c.lineTo(ax + dir * 3, y + bh / 2 - 6);
        c.lineTo(ax + dir * 3, y + bh / 2 + 6);
        c.closePath();
        c.fill();
      }
    }

    // Cumulative residual deviation: the running total.
    const S = parts.length ? parts[parts.length - 1] : 0;
    const by = top + rows * rh + Math.max(30, H * 0.05);
    hair(c, laneL - chipW - 30, by - 14, laneR, by - 14, pal.line2);
    text(c, 'C U M U L A T I V E   R E S I D U A L   D E V I A T I O N   [ Σ Δ ]', cx, by + 10, font.mono(11, 500), pal.ink3, 'center');
    const shown = holding ? '· · ·' : dark && !done ? (strokes.length ? '?.???' : '0.000') : signed(S, 3);
    const col = done ? (Math.abs(S) < 0.0005 ? pal.accent : pal.signal) : pal.ink;
    if (done) glow(c, cx, by + 14 + big * 0.62, big * 2.2, col, 0.5);
    text(c, shown, cx, by + 18 + big, font.mono(big, 300), col, 'center');
    c.font = font.mono(big, 300);
    const sw = c.measureText(shown).width;
    text(c, 's', cx + sw / 2 + 6, by + 18 + big, font.serif(big * 0.42, true), pal.ink3, 'left');

    // Vernier gauge around zero: ±100 ms, only when it matters.
    const zy = Math.min(H - 52, by + 18 + big + 52);
    if (strokes.length >= 2 && !holding && (!dark || done) && zy > by + big + 30) {
      const span = 0.1;
      const zw = Math.min(W * 0.32, 300);
      const Z = (v: number) => cx + (clamp(v, -span, span) / span) * zw;
      plate(c, cx - zw - 30, zy - 36, zw * 2 + 60, 74, 4, alpha(pal.paper2, 0.92));
      for (const v of [-100, -50, 0, 50, 100]) {
        const lab = v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}${Math.abs(v) === 100 ? ' ms' : ''}`;
        const hot = Math.abs(S * 1000) >= Math.abs(v) && v !== 0 && Math.sign(v) === Math.sign(S);
        text(c, lab, Z(v / 1000), zy - 18, font.mono(10, 500), v === 0 ? pal.accent : hot ? pal.signal : pal.ink3, 'center');
      }
      rr(c, cx - zw, zy - 3, zw * 2, 6, 3);
      c.fillStyle = alpha(pal.ink, 0.08);
      c.fill();
      for (let i = -10; i <= 10; i++) hair(c, Z(i / 100), zy + 5, Z(i / 100), zy + (i % 5 === 0 ? 11 : 8), i === 0 ? pal.accent : pal.line);
      line(c, cx, zy - 7, cx, zy + 7, pal.accent, 2);
      const inside = Math.abs(S) <= span;
      const mx = Z(S);
      const mcol = Math.abs(S) < 0.0005 ? pal.accent : pal.signal;
      glow(c, mx, zy, 16, mcol, 0.9);
      rr(c, mx - 4, zy - 5, 8, 10, 2);
      c.fillStyle = mcol;
      c.fill();
      if (inside && Math.abs(mx - cx) > 3) bracket(c, cx, zy + 18, mx, zy + 18, mcol, 3);
      const pol = Math.abs(S) < 0.0005 ? 'POLARITY: BALANCED' : S > 0 ? 'POLARITY: POSITIVE OVERRUN' : 'POLARITY: NEGATIVE SHORTFALL';
      text(c, pol, cx - zw, zy + 28, font.mono(9.5, 500), pal.ink2, 'left');
      const ms = Math.round(S * 1000);
      text(c, inside ? `${ms >= 0 ? '+' : '−'}${Math.abs(ms)} ms ${ms === 0 ? 'ON ZERO' : ms > 0 ? 'EXCEEDS ZERO' : 'SHORT OF ZERO'}` : S < 0 ? '◂ BEYOND −100 MS' : 'BEYOND +100 MS ▸', cx + zw, zy + 28, font.mono(9.5, 600), mcol, 'right');
    }

    if (now - shortAt < 900) more = true;
    if (finishedAt && now - finishedAt < 600) more = true;
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      clearTimeout(decoyTimer);
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onCancel);
    },
  };
};

export default factory;
