// 02 · EXACT — angle. Turn a needle to a target angle on a dial with no numbers. Five targets.
import { circle, clamp, easeOut, font, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { dialFace, glow, needle, plate, rr } from '../core/materials';
import { rng } from '../core/rng';
import { angleDiff } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

const norm = (d: number) => ((d % 360) + 360) % 360;
const diff = angleDiff;
const fmtDeg = (d: number) => (Math.abs(d - Math.round(d)) < 1e-9 ? String(Math.round(d)) : d.toFixed(1)) + '°';

export function makeTargets(seed: number, level: Level) {
  const r = rng(seed);
  if (level === 'easy') {
    const t: number[] = [];
    while (t.length < 5) {
      const v = r.int(1, 71) * 5;
      if (v !== 360 && !t.includes(v)) t.push(v);
    }
    return t;
  }
  if (level === 'hard') {
    // Seven targets, every one with a decimal, none near a quadrant.
    const t: number[] = [];
    while (t.length < 7) {
      const v = r.int(5, 354) + r.int(1, 9) / 10;
      if (Math.abs(diff(v, Math.round(v / 45) * 45)) < 6) continue;
      if (t.some((u) => Math.abs(diff(u, v)) < 25)) continue;
      t.push(v);
    }
    return t;
  }
  const t1 = r.pick([90, 180, 270]);
  const t2 = r.pick([45, 135, 225, 315]);
  const odd = () => {
    let v = 0;
    do v = r.int(8, 352);
    while (v % 45 === 0 || Math.abs(diff(v, 0)) < 8);
    return v;
  };
  const t3 = odd();
  let t4 = odd();
  while (Math.abs(diff(t4, t3)) < 30) t4 = odd();
  const t5 = odd() + 0.5;
  return [t1, t2, t3, t4, t5];
}

export type Notation = 'deg' | 'turn' | 'clock' | 'rad';
const FRACS: [number, number][] = [
  [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 6], [5, 6], [1, 8], [3, 8], [5, 8], [7, 8], [1, 12], [5, 12], [7, 12], [11, 12],
];
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const fracGlyph = (n: number, d: number) => [...String(n)].map((c) => SUP[+c]).join('') + '⁄' + [...String(d)].map((c) => SUB[+c]).join('');

/**
 * The same angle, said differently. Each notation is converted back to the exact angle it expresses, and that
 * angle is the target that is scored (so a rounded notation never hides a different answer).
 *   deg   — 137°           turn  — ⅜ turn, or 0.588 turn
 *   clock — the hour hand at 4:20 (30° per hour, measured from 12)       rad — 2.39 rad
 */
export function notate(t: number, kind: Notation): { label: string; value: number } {
  if (kind === 'turn') {
    const f = FRACS.find(([n, d]) => Math.abs((t / 360) * d - n) < 1e-9);
    if (f) return { label: `${fracGlyph(f[0], f[1])} turn`, value: (f[0] / f[1]) * 360 };
    const tu = Math.round((t / 360) * 1000) / 1000;
    return { label: `${tu.toFixed(3)} turn`, value: tu * 360 };
  }
  if (kind === 'clock') {
    // Hour-hand position, minutes rounded to 2: angle = (h + m/60) · 30.
    let mins = Math.round(((t / 30) * 60) / 2) * 2;
    const h = Math.floor(mins / 60) % 12;
    mins %= 60;
    const hh = h === 0 ? 12 : h;
    return { label: `${hh}:${String(mins).padStart(2, '0')} hour hand`, value: ((h + mins / 60) * 30) % 360 };
  }
  if (kind === 'rad') {
    const r = Math.round(((t * Math.PI) / 180) * 100) / 100;
    return { label: `${r.toFixed(2)} rad`, value: (r * 180) / Math.PI };
  }
  return { label: fmtDeg(t), value: t };
}

/**
 * Which notation each round uses. Degrees mode (default, unchanged): degrees only. Mixed-units mode:
 * Easy and Medium mix in turns and clock times; Hard adds radians and decimal turns.
 */
export function notations(level: Level, n: number, mixed = true): Notation[] {
  if (!mixed) return Array(n).fill('deg');
  if (level === 'easy') return ['deg', 'turn', 'clock', 'deg', 'clock'].slice(0, n) as Notation[];
  if (level === 'medium') return ['turn', 'clock', 'deg', 'deg', 'turn'].slice(0, n) as Notation[];
  const cyc: Notation[] = ['deg', 'turn', 'clock', 'rad'];
  return Array.from({ length: n }, (_, i) => cyc[i % cyc.length]);
}

const factory: GameFactory = (api) => {
  let labels: string[] = [];
  const { stage } = api;
  let targets: number[] = [];
  let answers: number[] = [];
  let round = 0;
  let angle = 0;
  let phase: 'aim' | 'dragging' | 'reveal' | 'done' = 'aim';
  let revealAt = 0;
  let touched = false;
  const keys = new Set<string>();
  let lastT = 0;
  let fine = false;
  let finTimer = 0;
  let ROUNDS = 5;
  let rots: number[] = [];
  let rot = 0; // Hard: the whole dial is turned, so "up" is no longer 0°
  let kbAim = false;
  // Spinning dial mode: the dial turns at a seeded speed each round; the pointer's screen angle is kept so the
  // needle's reading changes under a still finger, exactly as on a real turning dial.
  let spinWs: number[] = [];
  let spinT0 = 0;
  let ptrAbs: number | null = null;
  const spin = () => api.mode === 'spin';
  const rotAt = (t: number) => (rots[round] ?? 0) + (spin() ? ((spinWs[round] ?? 0) * (t - spinT0)) / 1000 : 0);
  const rad = (deg: number) => ((deg + rot - 90) * Math.PI) / 180; // 0° at the mark, clockwise

  const geom = () => {
    const W = stage.w;
    const H = stage.h;
    // Clear of the prompt above, the target plate and round strip below.
    const R = clamp(Math.min(W * 0.4, (H - 270) * 0.5), 70, 300);
    return { cx: W / 2, cy: Math.max(R + 110, H * 0.5 - 20), R };
  };

  function promptRound() {
    api.progress(`${round + 1} / ${ROUNDS}`);
    const t = labels[round];
    rot = rots[round] ?? 0;
    // Explain a notation the first time it appears in this attempt.
    const firstOf = (k: string) => labels.findIndex((l) => l.includes(k)) === round;
    const how = t.includes('hour hand') && firstOf('hour hand')
      ? 'Clock: where the hour hand points — 12 is the 0 mark, each hour is 30°'
      : t.includes('turn') && firstOf('turn')
        ? 'Turns: a whole turn is 360° — ¼ turn is 90°'
        : t.includes('rad') && firstOf('rad')
          ? 'Radians: π rad = 180°, so 1 rad ≈ 57.3°'
          : '';
    if (spin()) {
      api.prompt(`${t}`, how || `The dial turns ${spinWs[round] > 0 ? 'clockwise' : 'anticlockwise'} — the angle is read from its moving 0 mark the instant you let go`);
      return;
    }
    if (api.level === 'hard') {
      api.prompt(`${t}`, how || (round === 0 ? 'The dial is turned — 0° is wherever the mark is · the needle stays hidden until you let go' : 'The dial has turned again'));
      return;
    }
    if (how) {
      api.prompt(`${t}`, how);
      return;
    }
    if (api.level === 'easy') {
      api.prompt(`${t}`, round === 0 ? 'A mark every 30° · 0° is up, clockwise · drag, release to lock' : 'Drag · release to lock');
      return;
    }
    if (round === 0 && api.firstTime) api.prompt(`Point the needle at ${t}. 0° is straight up, angles go clockwise.`, 'Drag anywhere · release to lock');
    else if (round === 2) api.prompt(`${t}. The guide marks are gone now.`, 'Only 0° remains');
    else api.prompt(`${t}`, round === 4 ? 'Last one' : 'Drag · release to lock');
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    // Each target is announced in a notation (degrees, turns, clock, radians) and scored at the exact
    // angle that notation expresses.
    const raw = makeTargets(seed, api.level);
    const kinds = notations(api.level, raw.length, api.mode === 'mixed');
    const said = raw.map((t, i) => notate(t, kinds[i]));
    targets = said.map((s) => s.value);
    labels = said.map((s) => s.label);
    ROUNDS = targets.length;
    const rr = rng(seed ^ 0x5bd1e995);
    rots = targets.map(() => (api.level === 'hard' ? rr.range(25, 335) : 0));
    const rs = rng(seed ^ 0x2545f491);
    spinWs = targets.map(() => rs.sign() * rs.range(9, 22));
    spinT0 = performance.now();
    ptrAbs = null;
    rot = rots[0];
    kbAim = false;
    answers = [];
    round = 0;
    angle = 0;
    touched = false;
    phase = 'aim';
    keys.clear();
    promptRound();
    stage.request();
  }

  function nextRound() {
    round++;
    spinT0 = performance.now();
    ptrAbs = null;
    angle = 0;
    touched = false;
    phase = 'aim';
    promptRound();
  }

  function lock() {
    if (phase !== 'aim' && phase !== 'dragging') return;
    if (!touched) return;
    if (spin()) {
      rot = rotAt(performance.now());
      if (ptrAbs != null && !kbAim) angle = norm(ptrAbs - rot);
    }
    answers.push(angle);
    phase = 'reveal';
    revealAt = performance.now();
    const e = Math.abs(diff(angle, targets[round]));
    const g = geom();
    const tip = rad(angle);
    api.judge(e, { x: g.cx + Math.cos(tip) * g.R * 0.7, y: g.cy + Math.sin(tip) * g.R * 0.7 });
    if (e < 0.05) api.sfx.perfect();
    else if (e < 1) api.sfx.near();
    else api.sfx.release();
    api.buzz(10);
    api.prompt(`${signed(diff(angle, targets[round]), 1)}°`, round < ROUNDS - 1 ? 'Press again for the next target' : '');
    if (!spin()) rot = rots[round];
    if (round === ROUNDS - 1) finish();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const errs = answers.map((a, i) => diff(a, targets[i]));
    const mean = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length;
    const worst = Math.max(...errs.map(Math.abs));
    const meanDisp = mean.toFixed(1);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: meanDisp,
          unit: '°',
          label: 'mean angular error',
          headline:
            meanDisp === '0.0'
              ? `${ROUNDS} angles, all within a twentieth of a degree.`
              : `Off by ${meanDisp}° on average. Your worst was ${worst.toFixed(1)}°.`,
          rows: [
            ...targets.map((t, i) => [`${labels[i] === fmtDeg(t) ? fmtDeg(t) : `${labels[i]} (${t.toFixed(1)}°)`} → ${answers[i].toFixed(1)}°`, `${signed(errs[i], 1)}° ${Math.abs(errs[i]) < 0.05 ? '' : errs[i] > 0 ? 'cw' : 'ccw'}`.trim()] as [string, string]),
            ['Bias (mean signed)', `${signed(errs.reduce((a, e) => a + e, 0) / errs.length, 1)}° ${errs.reduce((a, e) => a + e, 0) >= 0 ? 'clockwise' : 'counter-clockwise'}`],
            ['Accuracy', (100 * (1 - mean / 180)).toFixed(2) + '%'],
          ],
          accuracy: 1 - mean / 180,
          perfect: meanDisp === '0.0',
          near: mean < 1,
          share: [`EXACT · ${api.level} — ${ROUNDS} angles, no numbers on the dial`, `mean error ${meanDisp}°`],
        }),
      api.motion() ? 900 : 0,
    );
  }

  const aimAt = (x: number, y: number) => {
    const { cx, cy } = geom();
    const dx = x - cx;
    const dy = y - cy;
    if (Math.hypot(dx, dy) < 10) return;
    if (spin()) rot = rotAt(performance.now());
    ptrAbs = (Math.atan2(dx, -dy) * 180) / Math.PI;
    angle = norm(ptrAbs - rot);
    kbAim = false;
    touched = true;
  };

  // ── Input ──────────────────────────────────────────────────────────────────
  const onDown = (e: PointerEvent) => {
    if (!primary(e) || phase === 'done') return;
    if (phase === 'reveal') nextRound();
    capture(stage.canvas, e.pointerId);
    phase = 'dragging';
    const p = stage.pt(e);
    aimAt(p.x, p.y);
    api.sfx.tick();
    stage.request();
  };
  const onMove = (e: PointerEvent) => {
    if (phase !== 'dragging' || !primary(e)) return;
    const p = stage.pt(e);
    aimAt(p.x, p.y);
    stage.request();
  };
  const onUp = (e: PointerEvent) => {
    if (phase !== 'dragging' || !primary(e)) return;
    lock();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  const onCancel = (e: PointerEvent) => {
    if (phase !== 'dragging' || !primary(e)) return;
    phase = 'aim';
    touched = false;
    stage.request();
  };
  stage.canvas.addEventListener('pointercancel', onCancel);
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e) || phase === 'done') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (phase === 'reveal') nextRound();
        keys.add(e.key);
        touched = true;
        kbAim = true;
        // On Hard, keyboard aiming shows the needle (otherwise it can't be aimed at all). That is a
        // different information condition, so the run is recorded in its own category.
        if (api.level === 'hard') api.setInput('keyboard');
        lastT = performance.now();
        stage.request();
      } else if ((e.key === 'Enter' || e.code === 'Space') && !e.repeat) {
        e.preventDefault();
        if (phase === 'reveal') {
          nextRound();
          stage.request();
        } else lock();
      }
    }),
    listen('keyup', (e) => {
      fine = e.shiftKey;
      keys.delete(e.key);
    }),
    listen('blur', () => keys.clear()),
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  stage.draw = (now) => {
    const c = stage.ctx;
    const { cx, cy, R } = geom();
    let more = false;
    if (spin() && (phase === 'aim' || phase === 'dragging')) {
      rot = rotAt(now);
      // A held finger stays put on screen while the dial turns under it.
      if (phase === 'dragging' && ptrAbs != null && !kbAim) angle = norm(ptrAbs - rot);
      more = true;
    }

    if (keys.size && (phase === 'aim' || phase === 'dragging')) {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      // Shift = fine control. Continuous, so it's still a feel thing, not counting presses.
      const speed = fine ? 6 : 48;
      if (keys.has('ArrowRight')) angle = norm(angle + speed * dt);
      if (keys.has('ArrowLeft')) angle = norm(angle - speed * dt);
      more = true;
    }

    // Dial: a lit instrument face (no marks beyond the level's own guides — shading only).
    dialFace(c, cx, cy, R);
    circle(c, cx, cy, R, pal.ink, undefined, 1.25);
    circle(c, cx, cy, R + 10, pal.line2);
    // 0° mark — the only fixed reference, with a pointer just outside the rim.
    const z = rad(0);
    glow(c, cx + Math.cos(z) * R, cy + Math.sin(z) * R, 28, pal.accent, 0.7);
    line(c, cx + Math.cos(z) * (R - 14), cy + Math.sin(z) * (R - 14), cx + Math.cos(z) * (R + 12), cy + Math.sin(z) * (R + 12), pal.accent, 2.5);
    {
      const px = cx + Math.cos(z) * (R + 14);
      const py = cy + Math.sin(z) * (R + 14);
      const nx = -Math.sin(z);
      const ny = Math.cos(z);
      c.beginPath();
      c.moveTo(px - Math.cos(z) * 2, py - Math.sin(z) * 2);
      c.lineTo(px + Math.cos(z) * 7 + nx * 5, py + Math.sin(z) * 7 + ny * 5);
      c.lineTo(px + Math.cos(z) * 7 - nx * 5, py + Math.sin(z) * 7 - ny * 5);
      c.closePath();
      c.fillStyle = pal.accent;
      c.fill();
    }
    text(c, '0°', cx + Math.cos(z) * (R + 26), cy + Math.sin(z) * (R + 26), font.mono(11, 600), pal.accent, 'center', 'middle');
    const guides = api.level === 'easy' ? [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] : api.level === 'medium' && round < 2 ? [90, 180, 270] : [];
    {
      for (const a of guides) {
        const r1 = R - 7;
        const r2 = R + 7;
        line(c, cx + Math.cos(rad(a)) * r1, cy + Math.sin(rad(a)) * r1, cx + Math.cos(rad(a)) * r2, cy + Math.sin(rad(a)) * r2, pal.ink3, 1.25);
      }
    }
    // clockwise hint
    c.beginPath();
    c.arc(cx, cy, R + 22, rad(8), rad(28));
    c.strokeStyle = pal.ink3;
    c.lineWidth = 1;
    c.stroke();
    const ah = rad(28);
    c.beginPath();
    c.moveTo(cx + Math.cos(ah) * (R + 22), cy + Math.sin(ah) * (R + 22));
    c.lineTo(cx + Math.cos(ah - 0.05) * (R + 27), cy + Math.sin(ah - 0.05) * (R + 27));
    c.lineTo(cx + Math.cos(ah - 0.05) * (R + 17), cy + Math.sin(ah - 0.05) * (R + 17));
    c.closePath();
    c.fillStyle = pal.ink3;
    c.fill();

    // Reveal: target ghost, error arc
    const showing = phase === 'reveal' || phase === 'done';
    if (showing && answers.length) {
      const tgt = targets[answers.length - 1];
      const you = answers[answers.length - 1];
      const p = api.motion() ? easeOut((now - revealAt) / 450) : 1;
      if (p < 1) more = true;
      const e = diff(you, tgt);
      c.globalAlpha = p;
      line(c, cx, cy, cx + Math.cos(rad(tgt)) * (R + 4), cy + Math.sin(rad(tgt)) * (R + 4), pal.accent, 1.5, [4, 4]);
      glow(c, cx + Math.cos(rad(tgt)) * R, cy + Math.sin(rad(tgt)) * R, 20, pal.accent, 0.8);
      tag(c, fmtDeg(tgt), cx + Math.cos(rad(tgt)) * (R + 30), cy + Math.sin(rad(tgt)) * (R + 30), pal.accent, 11);
      if (Math.abs(e) > 0.02) {
        const a0 = rad(tgt);
        const a1 = rad(tgt) + ((e * Math.PI) / 180) * p;
        const rr = R * 0.78;
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, rr, Math.min(a0, a1), Math.max(a0, a1));
        c.closePath();
        c.fillStyle = pal.signalSoft;
        c.fill();
        c.beginPath();
        c.arc(cx, cy, rr, Math.min(a0, a1), Math.max(a0, a1));
        c.strokeStyle = pal.signal;
        c.lineWidth = 2.5;
        c.stroke();
        const mid = rad(tgt + e / 2);
        tag(c, signed(e, 1) + '°', cx + Math.cos(mid) * (rr - 26), cy + Math.sin(mid) * (rr - 26), pal.signal, 12);
      }
      c.globalAlpha = 1;
    }

    // Needle
    const a = rad(angle);
    const live = phase === 'dragging' || keys.size > 0;
    const hidden = api.level === 'hard' && !showing && !kbAim;
    if (hidden && phase === 'dragging') {
      text(c, 'aiming — needle hidden', cx, cy + 26, font.mono(10, 500), pal.ink3, 'center');
    } else if (touched || showing) {
      if (live) glow(c, cx + Math.cos(a) * R * 0.97, cy + Math.sin(a) * R * 0.97, 34, pal.accent, 0.8);
      needle(c, cx, cy, a, R * 0.97, live ? pal.accent : pal.ink, live ? 4 : 3.2);
    } else {
      // resting at 0 with a gentle hint
      const wob = api.motion() && api.firstTime ? Math.sin(now / 500) * 6 : 0;
      const ra = rad(wob);
      line(c, cx, cy, cx + Math.cos(ra) * R * 0.97, cy + Math.sin(ra) * R * 0.97, pal.ink3, 2, [5, 4]);
      if (wob) more = true;
    }
    circle(c, cx, cy, 5, undefined, pal.ink);
    circle(c, cx, cy, 2, undefined, pal.paper);

    // Target readout under the dial
    const ty = cy + R + 48;
    if (round < ROUNDS) {
      const lbl = labels[Math.min(round, ROUNDS - 1)];
      const fs = lbl.length > 8 ? 22 : 32;
      c.font = font.mono(fs, 400);
      const pw = Math.max(150, c.measureText(lbl).width + 48);
      plate(c, cx - pw / 2, ty - 18, pw, fs + 34, 14);
      text(c, 'TARGET', cx, ty, font.mono(10, 500), pal.ink3, 'center');
      text(c, lbl, cx, ty + 34, font.mono(fs, 400), pal.ink, 'center');
    }

    // Round strip: a pill per round — filled when done, outlined when current.
    const sy = stage.h - 26;
    const gap = Math.min(64, stage.w / (ROUNDS + 2));
    for (let i = 0; i < ROUNDS; i++) {
      const x = stage.w / 2 + (i - (ROUNDS - 1) / 2) * gap;
      const done = i < answers.length;
      const cur = i === round && !done;
      rr(c, x - 12, sy - 1.5, 24, 4, 2);
      c.fillStyle = done ? pal.ink : cur ? pal.accent : pal.line;
      c.fill();
      if (done) text(c, Math.abs(diff(answers[i], targets[i])).toFixed(1), x, sy - 8, font.mono(11, 500), pal.ink, 'center');
      else text(c, i === round ? '•' : '·', x, sy - 8, font.mono(12), i === round ? pal.ink : pal.ink3, 'center');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onCancel);
    },
  };
};

export default factory;
