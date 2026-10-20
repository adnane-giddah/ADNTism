// 27 · BRAKE POINT — stop on the mark across real terrain.
// Builds on Stop, but the hidden rule is the ground itself: slopes push or hold the object back, ice cuts the
// brake's grip, air drag grows with v², and on Hard the brake fades as it heats. Acceleration along the
// track:  a = −G·sinθ(x) − r₀ − c·v² − B·grip(x)·(1 − fade)   (B only while you hold the brake).
// Integrated with a fixed 0.5 ms step from your press/release timestamps, so the result does not depend on the
// frame rate. When the object stops, its parking brake holds it.
import { bracket, clamp, easeOut, font, hair, hatch, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { alpha, glow, neon, plate, rr, softShadow, solidBlock } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

export const BDT = 0.0005; // s — fine enough that brake timing, not the step, limits precision
export const WALL = 100;
const G = 30; // u/s², gravity along a 45° slope would be G·0.71
const R0 = 1.2; // rolling resistance, u/s²
const ROUNDS = 3;

export interface Terrain {
  /** Heights (u) at x = 0, 10, …, 100 — linear between. */
  h: number[];
  /** Ice patches [from, to] (brake grip ×0.3). */
  ice: [number, number][];
  drag: number; // c, 1/u
  brake: number; // B, u/s²
  fade: boolean; // Hard: brake heats up
  v0: number;
  target: number;
}

export const heightAt = (t: Terrain, x: number) => {
  const i = clamp(Math.floor(x / 10), 0, 9);
  const f = clamp((x - i * 10) / 10, 0, 1);
  return t.h[i] + (t.h[i + 1] - t.h[i]) * f;
};
export const slopeAt = (t: Terrain, x: number) => {
  const i = clamp(Math.floor(x / 10), 0, 9);
  return (t.h[i + 1] - t.h[i]) / 10;
};
export const gripAt = (t: Terrain, x: number) => (t.ice.some(([a, b]) => x >= a && x < b) ? 0.3 : 1);

export interface SimState {
  x: number;
  v: number;
  heat: number; // 0..1
}

/** One fixed step. Returns the new state; v never goes negative (the parking brake holds at v = 0). */
export function brakeStep(t: Terrain, s: SimState, braking: boolean, dt = BDT): SimState {
  if (s.v <= 0) return { ...s, v: 0 };
  const sl = slopeAt(t, s.x);
  const sinT = sl / Math.sqrt(1 + sl * sl);
  const fade = t.fade ? 0.65 * s.heat : 0;
  const a = -G * sinT - R0 - t.drag * s.v * s.v - (braking ? t.brake * gripAt(t, s.x) * (1 - fade) : 0);
  const v = s.v + a * dt;
  const x = s.x + Math.max(0, (s.v + Math.max(0, v)) / 2) * dt;
  const heat = t.fade ? clamp(s.heat + (braking ? dt / 2.2 : -dt / 6), 0, 1) : 0;
  return { x, v: Math.max(0, v), heat };
}

/** Run with the brake held from position `from` onwards (or never). Returns where it stops (no wall). */
export function stopFrom(t: Terrain, from: number, maxT = 60) {
  let s: SimState = { x: 0, v: t.v0, heat: 0 };
  for (let i = 0; i < maxT / BDT && s.v > 0; i++) s = brakeStep(t, s, s.x >= from);
  return s.x;
}

/** The single-brake onset that stops exactly on the target (bisection on the onset position). */
export function idealOnset(t: Terrain) {
  let lo = 0;
  let hi = t.target;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (stopFrom(t, m) < t.target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export function makeBrake(seed: number, level: Level): Terrain[] {
  const r = rng(seed);
  const out: Terrain[] = [];
  let guard = 0;
  while (out.length < ROUNDS && guard++ < 2000) {
    const h = [0];
    for (let i = 1; i <= 10; i++) {
      const step = level === 'easy' ? 0 : r.range(-6, 6) * (level === 'hard' ? 1.3 : 1);
      h.push(clamp(h[i - 1] + step, -18, 18));
    }
    const ice: [number, number][] = [];
    const nIce = level === 'easy' ? 1 : r.int(1, 2);
    for (let k = 0; k < nIce; k++) {
      const a = r.range(25, 80);
      ice.push([a, a + r.range(8, 16)]);
    }
    const t: Terrain = {
      h,
      ice,
      drag: level === 'easy' ? 0 : r.range(0.002, 0.006),
      brake: level === 'hard' ? r.range(42, 60) : 52,
      fade: level === 'hard',
      v0: level === 'easy' ? r.range(32, 42) : r.range(36, 52),
      target: r.range(55, 88),
    };
    // Feasible both ways: full braking from the start stops well short, coasting gets well past the target
    // (or into the wall), so some single brake point lands exactly on it.
    const full = stopFrom(t, 0);
    const coast = stopFrom(t, Infinity);
    if (full > t.target - 8 || coast < t.target + 6) continue;
    // A hill can make the stopping point jump (brake a touch early and it stalls on the upslope; a touch
    // later and it crests and runs on). Keep only tracks where one clean brake really lands on the line.
    if (Math.abs(stopFrom(t, idealOnset(t)) - t.target) > 0.05) continue;
    out.push(t);
  }
  return out;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let terrains: Terrain[] = [];
  let round = 0;
  let tr: Terrain = makeBrake(1, 'medium')[0];
  let phase: 'ready' | 'run' | 'stopped' | 'done' = 'ready';
  let s: SimState = { x: 0, v: 0, heat: 0 };
  let simT = 0;
  let steps = 0; // total fixed steps this run (for sampling the trace)
  let t0 = 0;
  let braking = false;
  let trail: { x: number; v: number; b: boolean }[] = [];
  let firstBrake: number | null = null;
  let finalX = 0;
  let crashed = false;
  let endAt = 0;
  let results: { err: number; signed: number; crashed: boolean; onset: number | null; ideal: number }[] = [];
  let finTimer = 0;
  let keyDown = false;
  let idealCurve: { x: number; v: number }[] = [];
  let idealX = 0;

  function advanceTo(ts: number) {
    if (phase !== 'run') return;
    const target = (ts - t0) / 1000;
    let n = 0;
    while (simT + BDT <= target && n++ < 80000) {
      s = brakeStep(tr, s, braking);
      simT += BDT;
      if (++steps % 40 === 0) trail.push({ x: s.x, v: s.v, b: braking });
      if (s.x >= WALL) {
        crash();
        return;
      }
      if (s.v <= 0) {
        settle(false);
        return;
      }
    }
  }

  function crash() {
    // Virtual stop: where full braking from the wall would have stopped it (keeps the score continuous).
    let v = { ...s };
    for (let i = 0; i < 60 / BDT && v.v > 0; i++) v = brakeStep({ ...tr, h: tr.h.map(() => 0) }, v, true);
    finalX = v.x;
    crashed = true;
    settle(true);
  }

  function settle(isCrash: boolean) {
    phase = 'stopped';
    endAt = performance.now();
    if (!isCrash) finalX = s.x;
    trail.push({ x: Math.min(s.x, WALL), v: 0, b: braking });
    braking = false;
    const ideal = idealOnset(tr);
    idealX = ideal;
    // Cache the ideal single-brake curve once (the reveal draws it every frame).
    idealCurve = [];
    let st: SimState = { x: 0, v: tr.v0, heat: 0 };
    for (let i = 0; i < 60 / BDT && st.v > 0; i++) {
      st = brakeStep(tr, st, st.x >= ideal);
      if (i % 40 === 0) idealCurve.push({ x: st.x, v: st.v });
    }
    const err = finalX - tr.target;
    results.push({ err: Math.abs(err), signed: err, crashed: isCrash, onset: firstBrake, ideal });
    {
      const L = Math.max(24, stage.w * 0.06);
      const X = (u: number) => L + (u / WALL) * (stage.w - 2 * L);
      const base = Math.round(Math.max(170, stage.h * 0.42));
      const ty = base - heightAt(tr, tr.target) * ((stage.w - 2 * L) / 140);
      api.judge(Math.abs(err), { x: X(tr.target), y: ty - 100 });
      if (isCrash) {
        api.fx.burst(X(WALL), base - heightAt(tr, WALL) * ((stage.w - 2 * L) / 140) - 20, pal.signal, 26, 240, 2.2);
        api.fx.shake(5, 0.3);
      }
    }
    if (isCrash) {
      api.sfx.thud();
      api.buzz([30, 40, 30]);
    } else api.sfx.release();
    api.prompt(`${isCrash ? 'Wall! ' : ''}${signed(err, 1)} u — ${reason(err, isCrash, ideal)}`, round < ROUNDS - 1 ? 'Tap for the next track' : '');
    if (round === ROUNDS - 1) finish();
  }

  /** The main reason, from the true terrain along the way. */
  function reason(err: number, isCrash: boolean, ideal: number) {
    const brakedOnIce = trail.some((p) => p.b && gripAt(tr, p.x) < 1);
    const downhill = (() => {
      for (let x = Math.max(0, (firstBrake ?? 0) - 5); x < Math.min(finalX, WALL); x += 1) if (slopeAt(tr, x) < -0.25) return x;
      return null;
    })();
    if (isCrash) return brakedOnIce ? 'you braked on ice, where the brake has only 30% of its grip.' : 'too late: not enough track left to stop.';
    if (Math.abs(err) < 0.5) return 'dead on.';
    if (firstBrake == null) return 'you never braked.';
    if (err < 0) return firstBrake < ideal - 1 ? `braked early: one clean brake from ${ideal.toFixed(1)} u was enough.` : 'too much brake near the end.';
    if (brakedOnIce) return 'part of your braking was on ice — 30% grip — so it ran on.';
    if (downhill != null) return `the downhill near ${downhill.toFixed(0)} u kept feeding it speed.`;
    if (tr.fade && trail.length && s.heat > 0.4) return 'the brake faded as it heated up.';
    return firstBrake > ideal + 1 ? `braked late: the ideal single brake starts at ${ideal.toFixed(1)} u.` : 'you let go of the brake too soon.';
  }

  function setRound() {
    tr = terrains[round];
    phase = 'ready';
    s = { x: 0, v: tr.v0, heat: 0 };
    simT = 0;
    steps = 0;
    braking = false;
    trail = [];
    firstBrake = null;
    crashed = false;
    keyDown = false;
    api.progress(`${round + 1} / ${ROUNDS}`);
    api.prompt(
      api.level === 'easy' ? 'Tap to launch. Hold to brake. On ice (hatched) the brake keeps only 30% of its grip.' : api.level === 'medium' ? 'Hills, ice and air drag. Stop on the line.' : 'Hills, ice, drag — and a brake that fades when it gets hot. Stop on the line.',
      'Tap / Space to launch · hold to brake · release to coast',
    );
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    terrains = makeBrake(seed, api.level);
    round = 0;
    results = [];
    setRound();
    stage.request();
  }

  function press(ts: number) {
    if (phase === 'ready') {
      phase = 'run';
      t0 = ts;
      simT = 0;
      trail = [{ x: 0, v: tr.v0, b: false }];
      api.prompt('');
      api.sfx.tick();
      stage.request();
      return;
    }
    if (phase === 'stopped') return next();
    if (phase !== 'run' || braking) return;
    advanceTo(ts);
    if (phase !== 'run') return;
    braking = true;
    if (firstBrake == null) firstBrake = s.x;
    api.sfx.press();
    api.buzz(8);
  }
  function release(ts: number) {
    if (phase !== 'run' || !braking) return;
    advanceTo(ts);
    braking = false;
    api.sfx.release();
  }

  function next() {
    if (phase !== 'stopped' || round >= ROUNDS - 1) return;
    round++;
    setRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const mean = results.reduce((a, r) => a + r.err, 0) / results.length;
    const disp = mean.toFixed(1);
    const rows: [string, string][] = results.map((r, i) => [
      `Track ${i + 1}${r.crashed ? ' (wall)' : ''}`,
      `${signed(r.signed, 1)} u · first brake ${r.onset == null ? '—' : r.onset.toFixed(1) + ' u'} · ideal ${r.ideal.toFixed(1)} u`,
    ]);
    rows.push(['Physics', 'a = −G·sinθ − r₀ − c·v² − B·grip·(1 − fade); ice grip ×0.3; 0.5 ms fixed steps']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'u',
          label: 'stopping error',
          headline: disp === '0.0' ? 'Three tracks, three perfect stops.' : `Off by ${disp} u on average across three tracks.`,
          rows,
          perfect: disp === '0.0' && !results.some((r) => r.crashed),
          near: mean < 0.6,
          share: [`BRAKE POINT · ${api.level} — stop on the line over hills and ice`, `${disp} u`],
        }),
      api.motion() ? 700 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    capture(stage.canvas, e.pointerId);
    press(e.timeStamp);
  };
  const onUp = (e: PointerEvent) => primary(e) && release(e.timeStamp);
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const onVis = () => {
    keyDown = false;
    if (document.hidden && phase === 'run') api.voidRun('Run voided — the tab was hidden while it was moving.');
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      if (e.code !== 'Space' || !gameKey(e)) return;
      e.preventDefault();
      if (e.repeat || keyDown) return;
      keyDown = true;
      press(e.timeStamp);
    }),
    listen('keyup', (e) => {
      if (e.code !== 'Space') return;
      keyDown = false;
      release(e.timeStamp);
    }),
    listen('blur', () => {
      keyDown = false;
      release(performance.now());
    }),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    const L = Math.max(24, W * 0.06);
    const R = W - L;
    const X = (u: number) => L + (u / WALL) * (R - L);
    const base = Math.round(Math.max(170, H * 0.42));
    const vs = (R - L) / 140; // vertical scale (u → px), a little exaggerated for readability
    const Yh = (u: number) => base - u * vs;
    advanceTo(now);
    let more = phase === 'run';

    // Ground: profile, fill, ice patches (hatched + labelled — not colour alone)
    c.beginPath();
    c.moveTo(X(0), Yh(heightAt(tr, 0)));
    for (let x = 0; x <= WALL; x += 1) c.lineTo(X(x), Yh(heightAt(tr, x)));
    c.lineTo(X(WALL), H);
    c.lineTo(X(0), H);
    c.closePath();
    c.fillStyle = pal.paper2;
    c.fill();
    {
      // Depth: the ground darkens below its surface.
      const gg = c.createLinearGradient(0, base - 60, 0, H);
      gg.addColorStop(0, alpha(pal.accent, 0.14));
      gg.addColorStop(0.6, alpha(pal.accent, 0.02));
      gg.addColorStop(1, alpha(pal.accent, 0));
      c.fillStyle = gg;
      c.fill();
    }
    for (const [a, b] of tr.ice) {
      c.beginPath();
      c.moveTo(X(a), Yh(heightAt(tr, a)));
      for (let x = a; x <= b; x += 1) c.lineTo(X(x), Yh(heightAt(tr, x)));
      c.lineTo(X(b), Yh(heightAt(tr, b)) + 10);
      c.lineTo(X(a), Yh(heightAt(tr, a)) + 10);
      c.closePath();
      c.fillStyle = hatch(c, pal.liquidDeep, 4);
      c.fill();
      // A glassy sheen on the ice.
      c.beginPath();
      for (let x = a; x <= b; x += 1) (x === a ? c.moveTo : c.lineTo).call(c, X(x), Yh(heightAt(tr, x)) + 2);
      c.strokeStyle = pal.liquidDeep;
      c.lineWidth = 2;
      c.stroke();
      text(c, 'GLACIAL ICE FIELD · μ LOW', X((a + b) / 2), Yh(heightAt(tr, (a + b) / 2)) + 26, font.mono(9, 600), pal.accent, 'center');
    }
    neon(c, (cc) => {
      for (let x = 0; x <= WALL; x += 1) (x ? cc.lineTo : cc.moveTo).call(cc, X(x), Yh(heightAt(tr, x)));
    }, pal.accent, 2, 12);
    // A lit ridge just under the surface.
    c.beginPath();
    for (let x = 0; x <= WALL; x += 1) (x ? c.lineTo : c.moveTo).call(c, X(x), Yh(heightAt(tr, x)) + 2);
    c.strokeStyle = pal.glass;
    c.lineWidth = 1;
    c.stroke();
    // Wall and target
    solidBlock(c, X(WALL), Yh(heightAt(tr, WALL)) - 46, 6, 46);
    const tx = X(tr.target);
    const ty = Yh(heightAt(tr, tr.target));
    glow(c, tx, ty - 10, 44, pal.accent, 0.6);
    hair(c, tx, ty - 90, tx, H, alpha(pal.accent, 0.3), [2, 4]);
    line(c, tx, ty - 44, tx, ty + 6, pal.accent, 2);
    c.beginPath();
    c.moveTo(tx, ty - 44);
    c.lineTo(tx + 11, ty - 40);
    c.lineTo(tx, ty - 36);
    c.closePath();
    c.fillStyle = pal.accent;
    c.fill();
    {
      const lbl = `TARGET ${tr.target.toFixed(1)} u`;
      c.font = font.mono(11, 600);
      const lw = c.measureText(lbl).width + 16;
      rr(c, tx - lw / 2, ty - 72, lw, 20, 3);
      c.fillStyle = alpha(pal.accent, 0.12);
      c.fill();
      c.strokeStyle = alpha(pal.accent, 0.7);
      c.lineWidth = 1;
      c.stroke();
      text(c, lbl, tx, ty - 61.5, font.mono(11, 600), pal.accent, 'center', 'middle');
    }

    // The object, sitting on the slope
    const x = phase === 'stopped' || phase === 'done' ? Math.min(finalX, WALL) : s.x;
    const gx = X(x);
    const gy = Yh(heightAt(tr, x));
    const ang = Math.atan2(-slopeAt(tr, x) * vs, (R - L) / WALL);
    softShadow(c, gx, gy + 2, 14, 4);
    if (braking && phase === 'run') {
      glow(c, gx, gy - 6, 32, pal.signal, 0.8);
      if (s.v > 2) api.fx.spray(gx - 10 * Math.cos(ang), gy - 10 * Math.sin(ang), Math.PI + ang + 0.3, 0.5, Math.random() < 0.5 ? '#FFB834' : pal.signal, 2, 60 + s.v * 3, 1.5);
    }
    c.save();
    c.translate(gx, gy);
    c.rotate(ang);
    // Speed streaks behind it while it moves.
    if (phase === 'run' && s.v > 1 && api.motion()) {
      const len = Math.min(44, s.v * 0.9);
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = 0.22 - i * 0.05;
        line(c, -14 - i * 3, -14 + i * 5, -14 - i * 3 - len * (1 - i * 0.2), -14 + i * 5, pal.ink, 2);
      }
      c.globalAlpha = 1;
    }
    solidBlock(c, -10, -18, 20, 18);
    if (braking) {
      rr(c, -14, -1, 28, 3, 1.5);
      c.fillStyle = pal.signal;
      c.fill();
    }
    c.restore();
    if (phase === 'ready') {
      const bob = api.motion() ? Math.sin(now / 300) * 3 : 0;
      text(c, 'tap ▸', gx + 22 + bob, gy - 9, font.mono(11, 500), pal.ink2, 'left', 'middle');
      if (api.motion()) more = true;
    }
    // Readouts: speed always, brake heat on Hard
    text(c, 'CURRENT VELOCITY', L, 84, font.mono(10, 500), pal.ink3, 'left');
    text(c, s.v.toFixed(2), L, 112, font.mono(24, 300), phase === 'run' ? pal.ink : pal.ink2, 'left');
    c.font = font.mono(24, 300);
    text(c, 'u/s', L + c.measureText(s.v.toFixed(2)).width + 6, 112, font.mono(11), pal.ink3, 'left');
    if (tr.fade) {
      const hx = L + 190;
      hair(c, hx - 18, 76, hx - 18, 114, pal.line2);
      text(c, 'BRAKE HEAT FLUX', hx, 84, font.mono(10, 500), pal.ink3, 'left');
      rr(c, hx, 98, 140, 8, 4);
      c.fillStyle = pal.line2;
      c.fill();
      const hg = c.createLinearGradient(hx, 0, hx + 140, 0);
      hg.addColorStop(0, pal.accent);
      hg.addColorStop(0.5, '#FFB834');
      hg.addColorStop(1, pal.signal);
      c.save();
      rr(c, hx, 98, Math.max(4, 140 * s.heat), 8, 4);
      c.fillStyle = hg;
      c.fill();
      c.restore();
      text(c, `${Math.round(s.heat * 100)}%`, hx + 150, 105, font.mono(11, 500), s.heat > 0.6 ? pal.signal : pal.ink2, 'left', 'middle');
    }

    // Phase plot: speed against position, with the ideal single-brake curve after the run.
    // Below the deepest valley, so the plot never covers the track.
    let ground = base;
    for (let x = 0; x <= WALL; x += 2) ground = Math.max(ground, Yh(heightAt(tr, x)));
    const py0 = Math.max(base + 60, ground + 70);
    const py1 = H - 26;
    if (py1 - py0 > 60) {
      const vmax = Math.max(60, tr.v0 * 1.4);
      const Y = (v: number) => py1 - (v / vmax) * (py1 - py0);
      plate(c, L - 10, py0 - 18, R - L + 20, py1 - py0 + 30, 12);
      hair(c, L, py1, R, py1, pal.line);
      text(c, 'SPEED vs POSITION', L, py0 - 4, font.mono(9, 500), pal.ink3, 'left');
      hair(c, tx, py0, tx, py1, pal.line, [2, 3]);
      if (phase === 'stopped' || phase === 'done') {
        const p = api.motion() ? easeOut((now - endAt) / 600) : 1;
        if (p < 1) more = true;
        c.globalAlpha = p;
        const onset = idealX;
        c.beginPath();
        c.moveTo(X(0), Y(tr.v0));
        for (const q of idealCurve) c.lineTo(X(Math.min(q.x, WALL)), Y(q.v));
        c.setLineDash([4, 4]);
        c.strokeStyle = pal.accent;
        c.lineWidth = 1.25;
        c.stroke();
        c.setLineDash([]);
        tag(c, `ideal: brake at ${onset.toFixed(1)} u`, X(onset), Y(tr.v0) - 12, pal.accent, 10);
        c.globalAlpha = 1;
      }
      if (trail.length > 1) {
        for (let i = 1; i < trail.length; i++) line(c, X(Math.min(trail[i - 1].x, WALL)), Y(trail[i - 1].v), X(Math.min(trail[i].x, WALL)), Y(trail[i].v), trail[i].b ? pal.signal : pal.ink, 2);
      }
    }
    if (phase === 'stopped' || phase === 'done') {
      const ex = X(clamp(finalX, 0, WALL + 30));
      if (Math.abs(ex - tx) > 2) bracket(c, tx, ty + 30, Math.min(ex, W - 6), ty + 30, pal.signal, 4, 1.5);
      tag(c, `${signed(finalX - tr.target, 1)} u${crashed ? ' (virtual)' : ''}`, (tx + Math.min(ex, W - 6)) / 2, ty + 44, pal.signal, 11);
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onUp);
    },
  };
};

export default factory;
