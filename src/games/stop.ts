// 05 · STOP — momentum. A mass slides; hold to brake, release to coast. Bring it to rest on the line.
import { bracket, circle, clamp, easeOut, font, hair, hatch, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { stoppingDistance, virtualStop } from '../core/scoring';
import { alpha, glow, plate, slot, softShadow, solidBlock } from '../core/materials';

const A_STD = 60; // brake deceleration, u/s² — constant on Easy/Medium so it can be learned
const FOG = 58; // Hard: everything beyond this is hidden while the mass moves
const WALL = 100;

/** Run conditions. Guarantees one clean brake from launch can still stop on the line. */
export function makeStop(seed: number, level: Level) {
  const r = rng(seed);
  // Hard: the brake strength is secret and different every run — feel it out mid-slide.
  const A = level === 'hard' ? r.range(32, 95) : A_STD;
  let v0 = level === 'easy' ? r.range(30, 42) : level === 'hard' ? r.range(56, 74) : r.range(38, 62);
  const target = level === 'hard' ? r.range(68, 90) : r.range(56, 86);
  if (stoppingDistance(v0, A) > target - 4) v0 = Math.sqrt(2 * A * (target - 6));
  return { A, v0, target };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let v0 = 50;
  let target = 70;
  let phase: 'ready' | 'run' | 'stopped' | 'crashed' = 'ready';
  // Piecewise-constant acceleration, anchored at the last input event (exact, not frame-stepped).
  let ref = { t: 0, x: 0, v: 0 };
  let braking = false;
  let brakeCount = 0;
  let firstBrakeX: number | null = null;
  let trail: { x: number; v: number }[] = [];
  let endAt = 0;
  let finalX = 0;
  let finTimer = 0;
  let keyDown = false;
  let A = A_STD;
  let hard = false;
  let easy = false;
  // Moving-line mode: the line oscillates round `base`; the score uses its position at the stop instant.
  let base = 70;
  let amp = 0;
  let period = 3;
  let phi = 0;
  let clock0 = 0;
  const moving = () => api.mode === 'moving';
  const lineAt = (t: number) => base + amp * Math.sin((2 * Math.PI * (t - clock0)) / 1000 / period + phi);

  function reset(seed: number) {
    clearTimeout(finTimer);
    hard = api.level === 'hard';
    easy = api.level === 'easy';
    ({ A, v0, target } = makeStop(seed, api.level));
    base = target;
    amp = 0;
    if (moving()) {
      const r = rng(seed ^ 0x51ed27);
      amp = api.level === 'easy' ? 5 : api.level === 'hard' ? 9 : 7;
      base = clamp(target, 50 + amp, 92 - amp);
      period = r.range(2.4, 4.2);
      phi = r.range(0, Math.PI * 2);
      // Still always stoppable at the line's nearest point with one clean brake.
      if (stoppingDistance(v0, A) > base - amp - 4) v0 = Math.sqrt(2 * A * (base - amp - 6));
    }
    clock0 = performance.now();
    phase = 'ready';
    ref = { t: 0, x: 0, v: 0 };
    braking = false;
    keyDown = false;
    brakeCount = 0;
    firstBrakeX = null;
    trail = [];
    api.progress('');
    if (moving()) api.prompt('Tap to launch. The line won’t keep still.', 'You are scored against where the line is when your mass stops — time your brake to its swing');
    else if (hard) api.prompt('Tap to launch. The brake’s strength is a secret, and the end of the track is in fog.', 'Test the brake early — then commit');
    else if (easy) api.prompt('Tap to launch. Hold to brake — the shadow shows where you’d stop.', 'Stop on the line · don’t hit the wall');
    else api.prompt(api.firstTime ? 'Tap to launch. Then hold to brake, release to coast.' : 'Tap to launch.', 'Stop on the line · don’t hit the wall');
    stage.request();
  }

  /** State at time t (ms, same clock as event timestamps). */
  function at(t: number) {
    const dt = Math.max(0, (t - ref.t) / 1000);
    if (braking) {
      const tStop = ref.v / A;
      if (dt >= tStop) return { x: ref.x + (ref.v * ref.v) / (2 * A), v: 0 };
      return { x: ref.x + ref.v * dt - (A * dt * dt) / 2, v: ref.v - A * dt };
    }
    return { x: ref.x + ref.v * dt, v: ref.v };
  }

  function press(ts: number) {
    if (phase === 'ready') {
      phase = 'run';
      ref = { t: ts, x: 0, v: v0 };
      trail = [{ x: 0, v: v0 }];
      api.sfx.tick();
      api.prompt('');
      api.progress('running');
      stage.request();
      return;
    }
    if (phase !== 'run' || braking) return;
    const s = at(ts);
    ref = { t: ts, ...s };
    braking = true;
    brakeCount++;
    if (firstBrakeX == null) firstBrakeX = s.x;
    trail.push({ x: s.x, v: s.v });
    api.sfx.press();
    api.buzz(8);
    stage.request();
  }

  function release(ts: number) {
    if (phase !== 'run' || !braking) return;
    const s = at(ts);
    if (s.v <= 0) return; // already stopped; the render loop will settle it
    ref = { t: ts, ...s };
    braking = false;
    trail.push({ x: s.x, v: s.v });
    api.sfx.release();
    stage.request();
  }

  function settle(x: number, crashed: boolean, vAtWall = 0, tEnd = performance.now()) {
    if (moving()) target = lineAt(tEnd);
    phase = crashed ? 'crashed' : 'stopped';
    endAt = performance.now();
    braking = false;
    // Where it would have stopped with full braking after the wall — keeps the metric continuous.
    const virtual = crashed ? virtualStop(WALL, vAtWall, A) : x;
    finalX = virtual;
    const err = virtual - target;
    const abs = Math.abs(err);
    const W = stage.w;
    const px = (u: number) => Math.max(24, W * 0.06) + (u / WALL) * (W - 2 * Math.max(24, W * 0.06));
    const ty = Math.round(Math.max(110, stage.h * 0.3));
    if (crashed) {
      api.sfx.thud();
      api.buzz([30, 40, 30]);
      api.fx.burst(px(WALL), ty - 9, pal.signal, 30, 260, 2.2);
      api.fx.shake(5, 0.3);
    } else {
      api.sfx.release();
      if (Math.abs(x - target) < 1.5) api.fx.ring(px(x), ty - 9, pal.accent, 60, 2, 0.6);
    }
    const disp = abs.toFixed(1);
    const idealBrake = target - (v0 * v0) / (2 * A);
    // Plain-language cause, from the first brake point versus the single-brake ideal.
    const diagnosis = crashed
      ? 'too late: by the time you braked, there was not enough track left.'
      : err < 0
        ? firstBrakeX != null && firstBrakeX < idealBrake - 0.5
          ? `you braked early (at ${firstBrakeX.toFixed(1)} u; one clean brake from ${idealBrake.toFixed(1)} u was enough) and never coasted back.`
          : 'too much braking near the end.'
        : firstBrakeX != null && firstBrakeX > idealBrake + 0.5
          ? `you braked late (at ${firstBrakeX.toFixed(1)} u; the ideal single brake starts at ${idealBrake.toFixed(1)} u).`
          : 'you let off the brake too soon and coasted past.';
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: abs,
          value: disp,
          unit: 'u',
          label: crashed ? 'virtual stopping error' : 'stopping error',
          headline: crashed
            ? `Hit the wall at ${vAtWall.toFixed(0)} u/s. Full braking would have stopped it ${(virtual - WALL).toFixed(1)} u beyond — ${diagnosis}`
            : disp === '0.0'
              ? 'Dead on the line.'
              : `Came to rest ${disp} u ${err < 0 ? 'short of' : 'past'} the line — ${diagnosis}`,
          rows: [
            ['Line at', target.toFixed(1) + ' u'],
            [crashed ? 'Would have stopped' : 'Stopped at', virtual.toFixed(1) + ' u'],
            ['Error', signed(err, 1) + ' u'],
            ['Launch speed', v0.toFixed(1) + ' u/s'],
            ['Brake strength', A.toFixed(0) + ' u/s²' + (hard ? ' (secret)' : '')],
            ['Brake presses', String(brakeCount)],
            ['First brake at', firstBrakeX == null ? '—' : firstBrakeX.toFixed(1) + ' u'],
            ['Ideal single brake', idealBrake.toFixed(1) + ' u'],
          ],
          perfect: disp === '0.0' && !crashed,
          near: abs < 0.5 && !crashed,
          share: [`STOP · ${api.level} — brake a sliding mass onto a line`, `${signed(err, 1)} u ${crashed ? '(wall)' : ''}`],
        }),
      api.motion() ? 650 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    capture(stage.canvas, e.pointerId);
    press(e.timeStamp);
  };
  const onUp = (e: PointerEvent) => primary(e) && release(e.timeStamp);
  // Motion is computed from real time, so a hidden tab would let the mass slide unseen: void the run.
  const onVis = () => {
    keyDown = false;
    if (document.hidden && phase === 'run') api.voidRun('Run voided — the tab was hidden while the mass was moving.');
  };
  document.addEventListener('visibilitychange', onVis);
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
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
    const ty = Math.round(Math.max(110, H * 0.3));
    let more = false;
    if (moving() && (phase === 'ready' || phase === 'run')) {
      target = lineAt(now);
      more = true;
    }
    if (moving()) {
      // The line's travel: a lit rail between its extremes.
      line(c, X(base - amp), ty - 44, X(base + amp), ty - 44, alpha(pal.accent, 0.25), 3);
      for (const e of [base - amp, base + amp]) hair(c, X(e), ty - 50, X(e), ty - 38, alpha(pal.accent, 0.5));
    }

    let s = { x: 0, v: 0 };
    if (phase === 'run') {
      s = at(now);
      if (s.x >= WALL) {
        // Exact wall-hit speed from the current segment
        const dx = WALL - ref.x;
        const vw = braking ? Math.sqrt(Math.max(0, ref.v * ref.v - 2 * A * dx)) : ref.v;
        const tw = braking ? (ref.v - vw) / A : dx / Math.max(1e-9, ref.v);
        trail.push({ x: WALL, v: vw });
        settle(WALL, true, vw, ref.t + tw * 1000);
        s = { x: WALL, v: 0 };
      } else if (braking && s.v <= 0) {
        trail.push({ x: s.x, v: 0 });
        settle(s.x, false, 0, ref.t + (ref.v / A) * 1000);
      } else {
        trail.push(s);
        more = true;
      }
    } else if (phase === 'stopped' || phase === 'crashed') {
      s = { x: Math.min(finalX, WALL), v: 0 };
    }

    // Track: a recessed rail
    slot(c, L, ty + 1, R, ty + 1, 7);
    for (let u = 0; u <= WALL; u += 5) hair(c, X(u), ty + 6, X(u), ty + (u % 25 === 0 ? 14 : 9), u % 25 === 0 ? pal.ink3 : pal.line);
    for (let u = 0; u <= 75; u += 25) text(c, String(u), X(u), ty + 28, font.mono(10), pal.ink3, 'center');
    // Wall
    c.fillStyle = pal.ink;
    solidBlock(c, X(WALL), ty - 34, 5, 48);
    // Target line, with a small flag
    glow(c, X(target), ty - 10, 40, pal.accent, 0.6);
    line(c, X(target), ty - 40, X(target), ty + 18, pal.accent, 2);
    c.beginPath();
    c.moveTo(X(target), ty - 40);
    c.lineTo(X(target) + 11, ty - 36);
    c.lineTo(X(target), ty - 32);
    c.closePath();
    c.fillStyle = pal.accent;
    c.fill();
    text(c, target.toFixed(1), X(target), ty - 48, font.mono(12, 600), pal.accent, 'center');

    const running = phase === 'run';
    const fogged = hard && running;
    // Easy: shadow where full braking from now would stop the mass.
    if (easy && running) {
      const sx = Math.min(s.x + (s.v * s.v) / (2 * A), WALL + 20);
      c.globalAlpha = 0.35;
      c.strokeStyle = pal.ink;
      c.setLineDash([3, 3]);
      c.strokeRect(Math.round(X(Math.min(sx, WALL))) - 9 + 0.5, ty - 17.5, 18, 18);
      c.setLineDash([]);
      c.globalAlpha = 1;
    }

    // Mass
    const mx = X(s.x);
    const shake = phase === 'crashed' && api.motion() ? Math.sin((now - endAt) / 18) * 4 * Math.max(0, 1 - (now - endAt) / 300) : 0;
    if (phase === 'crashed' && now - endAt < 300) more = true;
    c.fillStyle = pal.ink;
    // Speed streaks behind the moving mass.
    if (phase === 'run' && s.v > 1 && api.motion()) {
      const len = Math.min(46, s.v * 0.9);
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = 0.22 - i * 0.05;
        line(c, mx - 13 - i * 3, ty - 14 + i * 5, mx - 13 - i * 3 - len * (1 - i * 0.2), ty - 14 + i * 5, pal.ink, 2);
      }
      c.globalAlpha = 1;
    }
    softShadow(c, mx + shake, ty + 1, 13, 3.5);
    solidBlock(c, mx - 9 + shake, ty - 18, 18, 18);
    if (braking) {
      // Brake shoes bite: sparks fly back off the rail while it is still moving.
      if (phase === 'run' && s.v > 2) api.fx.spray(mx - 9, ty, Math.PI + 0.25, 0.5, Math.random() < 0.5 ? '#FFB834' : pal.signal, 2, 60 + s.v * 3, 1.5);
      glow(c, mx, ty - 9, 30, pal.signal, 0.8);
      c.fillStyle = pal.signal;
      c.fillRect(mx - 13, ty - 22, 26, 3);
      c.fillRect(mx - 13, ty + 1, 26, 3);
    }
    if (phase === 'ready') {
      const bob = api.motion() ? Math.sin(now / 300) * 3 : 0;
      text(c, 'tap ▸', mx + 22 + bob, ty - 5, font.mono(11, 500), pal.ink2, 'left', 'middle');
      if (api.motion()) more = true;
    }

    // Fog over the far end of the track (Hard, while moving). The line stays visible through it.
    if (fogged) {
      const fx = X(FOG);
      c.fillStyle = pal.paper;
      c.fillRect(fx, ty - 30, X(WALL) - fx + 6, 46);
      c.fillStyle = hatch(c, pal.line, 5);
      c.fillRect(fx, ty - 30, X(WALL) - fx + 6, 46);
      line(c, X(target), ty - 40, X(target), ty + 18, pal.ink, 1.5);
      text(c, 'fog', fx + 6, ty - 34, font.mono(9, 500), pal.ink3, 'left');
    }

    // Speed readout (not on Hard — speed has to be felt)
    if (!hard || !running) text(c, `${s.v.toFixed(1)} u/s`, L, ty - 48, font.mono(11, 500), pal.ink2, 'left');

    // Phase plot: speed (up) against position (across)
    const py0 = ty + 64;
    const py1 = H - 30;
    if (py1 - py0 > 60) {
      const vmax = Math.max(65, v0 * 1.1);
      const Y = (v: number) => py1 - (v / vmax) * (py1 - py0);
      plate(c, L - 10, py0 - 10, R - L + 20, py1 - py0 + 30, 12);
      hair(c, L, py1, R, py1, pal.line);
      hair(c, L, py0, L, py1, pal.line);
      text(c, 'SPEED', L + 6, py0 + 4, font.mono(9, 500), pal.ink3, 'left', 'top');
      text(c, 'POSITION →', R, py1 + 14, font.mono(9, 500), pal.ink3, 'right');
      hair(c, X(target), py0, X(target), py1, pal.line, [2, 3]);

      const done = phase === 'stopped' || phase === 'crashed';
      if (done) {
        // Ideal: coast, then one clean brake that ends exactly on the line.
        const p = api.motion() ? easeOut((now - endAt) / 600) : 1;
        if (p < 1) more = true;
        const xb = target - (v0 * v0) / (2 * A);
        c.globalAlpha = p;
        c.beginPath();
        c.moveTo(X(0), Y(v0));
        c.lineTo(X(xb), Y(v0));
        for (let i = 0; i <= 40; i++) {
          const x = xb + ((target - xb) * i) / 40;
          c.lineTo(X(x), Y(Math.sqrt(Math.max(0, 2 * A * (target - x)))));
        }
        c.setLineDash([4, 4]);
        c.strokeStyle = pal.accent;
        c.lineWidth = 1.25;
        c.stroke();
        c.setLineDash([]);
        tag(c, 'ideal', X(xb), Y(v0) - 12, pal.accent, 10);
        c.globalAlpha = 1;
      }
      c.save();
      if (fogged) {
        c.beginPath();
        c.rect(0, 0, X(FOG), H);
        c.clip();
      }
      if (trail.length > 1) {
        // Area under your curve, then the curve.
        c.beginPath();
        trail.forEach((q, i) => (i ? c.lineTo(X(q.x), Y(q.v)) : c.moveTo(X(q.x), Y(q.v))));
        c.lineTo(X(trail[trail.length - 1].x), Y(0));
        c.lineTo(X(trail[0].x), Y(0));
        c.closePath();
        c.fillStyle = pal.line2;
        c.fill();
        c.beginPath();
        trail.forEach((q, i) => (i ? c.lineTo(X(q.x), Y(q.v)) : c.moveTo(X(q.x), Y(q.v))));
        c.strokeStyle = pal.ink;
        c.lineWidth = 2;
        c.lineJoin = 'round';
        c.stroke();
      }
      const last = trail[trail.length - 1];
      if (last) circle(c, X(last.x), Y(last.v), 3.5, undefined, phase === 'run' ? pal.ink : pal.signal);
      c.restore();
    }

    // Error bracket on the track
    if (phase === 'stopped' || phase === 'crashed') {
      const p = api.motion() ? easeOut((now - endAt) / 400) : 1;
      c.globalAlpha = p;
      const ex = X(clamp(finalX, 0, WALL + 30));
      if (Math.abs(ex - X(target)) > 2) bracket(c, X(target), ty + 40, Math.min(ex, W - 6), ty + 40, pal.signal, 4, 1.5);
      tag(c, `${signed(finalX - target, 1)} u`, (X(target) + Math.min(ex, W - 6)) / 2, ty + 54, pal.signal, 11);
      c.globalAlpha = 1;
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
