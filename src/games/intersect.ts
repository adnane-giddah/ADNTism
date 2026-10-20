// 13 · INTERSECT — make two moving objects meet at ✛, at the same moment.
// Object ● follows a fixed trajectory and passes ✛ at a known time tA. You set ■'s heading and speed, then
// launch both together. The score is where ■ is when ● passes ✛ — |pB(tA) − ✛| in u: zero only if they meet
// at the right place at the right time. Direction error (how far ■'s path passes from ✛) and timing error
// (when ■ is nearest ✛, minus tA) are reported separately. A near miss is never called a collision.
//   Modes: Linear (default) · Misleading (visual distortions, combo with Perception) ·
//          Phase collision (● orbits; meet it at ✛ on one of its passes, combo with Phaseshift).
import { Controls } from '../core/controls';
import { arrow, bracket, circle, clamp, cross, easeOut, font, line, pal, tag, text, beatLamp } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { Metronome } from '../core/metronome';
import { glow, plate, ripple, rr, softShadow, sphere } from '../core/materials';
import { rng } from '../core/rng';
import { add, closestApproach, dist, idealLaunch, interceptErrors, scale, sub, type V } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

const ROUNDS = 3;
const LAUNCHER: V = { x: -40, y: 40 };
/** Arrow length (u) per unit of speed (u/s): the arrow shows half a second of travel. */
const ARROW_K = 0.5;
/** Contact distance (u): radius of ● plus radius of ■. */
export const CONTACT = 4.5;
const DEG = Math.PI / 180;

export interface Track {
  kind: 'line' | 'orbit';
  /** line: start point and velocity (u/s). */
  a0: V;
  va: V;
  /** orbit: centre, radius, start angle (rad), angular speed (rad/s). */
  c: V;
  r: number;
  th0: number;
  w: number;
}

export interface IntersectRound {
  track: Track;
  P: V;
  /** Times (s) at which ● passes ✛ within the run (one for a line, several for an orbit). */
  passes: number[];
  /** Knob ranges. */
  sLo: number;
  sHi: number;
  aLo: number;
  aHi: number;
  sStart: number;
  aStart: number;
  /** Rhythm rounds (Hard): beats per minute and the beat on which ● reaches ✛. */
  bpm: number | null;
  beat: number;
  fixedAim: boolean;
  shots: number;
}

export const posA = (tr: Track, t: number): V =>
  tr.kind === 'line' ? add(tr.a0, scale(tr.va, t)) : { x: tr.c.x + Math.cos(tr.th0 + tr.w * t) * tr.r, y: tr.c.y + Math.sin(tr.th0 + tr.w * t) * tr.r };

export function makeIntersect(seed: number, level: Level, mode: string): IntersectRound[] {
  const r = rng(seed);
  const out: IntersectRound[] = [];
  while (out.length < ROUNDS) {
    let track: Track;
    let P: V;
    let passes: number[];
    let bpm: number | null = null;
    let beat = 0;
    if (mode === 'orbit') {
      const c = { x: r.range(8, 18), y: r.range(-18, -6) };
      const rad = r.range(16, 24);
      const period = r.range(2.6, 3.6);
      const w = (r.sign() * 2 * Math.PI) / period;
      const thP = r.range(Math.PI * 0.55, Math.PI * 1.1); // ✛ on the side facing the launcher
      P = { x: c.x + Math.cos(thP) * rad, y: c.y + Math.sin(thP) * rad };
      const th0 = thP + r.range(0.6, 2.2) * Math.sign(-w);
      track = { kind: 'orbit', a0: { x: 0, y: 0 }, va: { x: 0, y: 0 }, c, r: rad, th0, w };
      const first = (((thP - th0) / w) % period + period) % period;
      passes = [first, first + period, first + 2 * period].filter((t) => t > 0.6 && t < 7.5);
    } else {
      P = { x: r.range(-8, 24), y: r.range(-24, 8) };
      const dirA = r.range(0, Math.PI * 2);
      const dA = r.range(34, 52);
      const a0 = { x: P.x - Math.cos(dirA) * dA, y: P.y - Math.sin(dirA) * dA };
      if (Math.max(Math.abs(a0.x), Math.abs(a0.y)) > 46) continue;
      let tA = r.range(1.6, 2.9);
      if (level === 'hard' && mode === 'line') {
        // Rhythm round: ● reaches ✛ exactly on beat `beat` after the launch.
        bpm = r.range(92, 120);
        beat = r.int(3, 4);
        tA = (beat * 60) / bpm;
      }
      const va = { x: (Math.cos(dirA) * dA) / tA, y: (Math.sin(dirA) * dA) / tA };
      // ● must not start (or pass) on top of the launcher.
      if (closestApproach(a0, va, LAUNCHER, { x: 0, y: 0 }, tA * 1.6).d < 14) continue;
      track = { kind: 'line', a0, va, c: { x: 0, y: 0 }, r: 0, th0: 0, w: 0 };
      passes = [tA];
    }
    if (!passes.length) continue;
    // The intended pass: the first one reachable at a sensible speed.
    const ideal = passes.map((t) => idealLaunch(LAUNCHER, P, t)).find((l) => l.s >= 12 && l.s <= 60);
    if (!ideal) continue;
    const sLo = ideal.s * r.range(0.55, 0.7);
    const sHi = ideal.s * r.range(1.4, 1.6);
    const aLo = ideal.theta - r.range(22, 35) * DEG;
    const aHi = ideal.theta + r.range(22, 35) * DEG;
    let sStart = r.range(sLo, sHi);
    for (let i = 0; i < 50 && Math.abs(sStart - ideal.s) < 0.12 * ideal.s; i++) sStart = r.range(sLo, sHi);
    let aStart = r.range(aLo, aHi);
    for (let i = 0; i < 50 && Math.abs(aStart - ideal.theta) < 6 * DEG; i++) aStart = r.range(aLo, aHi);
    const fixedAim = level === 'easy';
    out.push({
      track,
      P,
      passes,
      sLo,
      sHi,
      aLo,
      aHi,
      sStart,
      aStart: fixedAim ? ideal.theta : aStart,
      bpm,
      beat,
      fixedAim,
      shots: level === 'hard' ? 1 : 2,
    });
  }
  return out;
}

/** Score a launch: against the pass of ● that it comes closest to using (orbit) or the only pass (line). */
export function scoreLaunch(rd: IntersectRound, s: number, theta: number) {
  let best: (ReturnType<typeof interceptErrors> & { tA: number }) | null = null;
  for (const tA of rd.passes) {
    const e = interceptErrors(LAUNCHER, s, theta, rd.P, tA);
    if (!best || e.miss < best.miss) best = { ...e, tA };
  }
  const b = best!;
  // Actual meeting: closest approach of the two objects over the run.
  const T = Math.max(...rd.passes) + 1.5;
  const vb = { x: Math.cos(theta) * s, y: Math.sin(theta) * s };
  let closest: { t: number; d: number };
  if (rd.track.kind === 'line') closest = closestApproach(rd.track.a0, rd.track.va, LAUNCHER, vb, T);
  else {
    closest = { t: 0, d: Infinity };
    for (let t = 0; t <= T; t += 0.002) {
      const d = dist(posA(rd.track, t), add(LAUNCHER, scale(vb, t)));
      if (d < closest.d) closest = { t, d };
    }
  }
  const hit = closest.d <= CONTACT;
  const meet = add(LAUNCHER, scale(vb, closest.t));
  const ideal = idealLaunch(LAUNCHER, rd.P, b.tA);
  return { ...b, closest, hit, meet, meetErr: dist(meet, rd.P), ideal, s, theta };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: IntersectRound[] = [];
  let round = 0;
  let shot = 0;
  let phase: 'aim' | 'run' | 'shown' | 'done' = 'aim';
  let launchAt = 0;
  let setupAt = 0;
  let last: ReturnType<typeof scoreLaunch> | null = null;
  let finals: ReturnType<typeof scoreLaunch>[] = [];
  let shotsTaken: number[] = [];
  let finTimer = 0;
  let dragging = false;
  const metro = new Metronome();
  const mislead = () => api.mode === 'mislead';
  const controls = new Controls(stage, () => launch());

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const rd = rounds[round];
    const ctrlH = rd?.fixedAim ? 66 : 120;
    const top = 70;
    const F = Math.max(150, Math.min(W - 32, H - top - ctrlH - 26, 620));
    return { k: F / 100, F, cx: W / 2, cy: top + F / 2, ctrlY: top + F + 10, cw: Math.min(W - 32, 520) };
  };

  const speed = () => controls.get('speed').value;
  const aim = () => controls.get('aim').value;

  function setRound(keepShot = false) {
    const rd = rounds[round];
    if (!keepShot) shot = 0;
    controls.set([
      { id: 'speed', label: 'speed', lo: rd.sLo, hi: rd.sHi, value: rd.sStart, speed: (rd.sHi - rd.sLo) / 4 },
      { id: 'aim', label: 'heading', lo: rd.aLo, hi: rd.aHi, value: rd.aStart, speed: (rd.aHi - rd.aLo) / 5, hidden: rd.fixedAim },
    ]);
    controls.lockLabel = 'Launch';
    controls.enabled = true;
    phase = 'aim';
    setupAt = performance.now();
    if (rd.bpm) metro.run(performance.now() + 300, rd.bpm, () => true);
    else metro.stop();
    api.progress(`${round + 1} / ${ROUNDS}`);
    const shotsLeft = rd.shots - shot;
    const what =
      api.mode === 'orbit'
        ? '● circles. Launch ■ so it hits ● exactly at ✛ — on any pass.'
        : rd.bpm
          ? `● reaches ✛ on beat ${rd.beat} after launch. Launch ■ to meet it there.`
          : rd.fixedAim
            ? '■ is aimed at ✛. Set its speed so it meets ● there.'
            : 'Aim ■ and set its speed so it meets ● exactly at ✛.';
    const sub = rd.bpm
      ? `No preview: feel the tempo · ${shotsLeft} shot${shotsLeft > 1 ? 's' : ''}`
      : `The ghost shows ●’s pace · drag the arrow or use the sliders · ${shotsLeft} shot${shotsLeft > 1 ? 's' : ''}${mislead() ? ' · the picture is distorted, the motion is not' : ''}`;
    api.prompt(what, sub);
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    rounds = makeIntersect(seed, api.level, api.mode);
    round = 0;
    shot = 0;
    finals = [];
    shotsTaken = [];
    last = null;
    setRound();
    stage.request();
  }

  function launch() {
    if (phase !== 'aim') return;
    const rd = rounds[round];
    phase = 'run';
    controls.enabled = false;
    dragging = false;
    launchAt = performance.now();
    if (rd.bpm) metro.run(launchAt, rd.bpm, (n) => n <= rd.beat, rd.beat);
    last = scoreLaunch(rd, speed(), aim());
    shot++;
    api.sfx.press();
    api.prompt('');
    stage.request();
  }

  function settle() {
    if (phase !== 'run' || !last) return;
    const rd = rounds[round];
    phase = 'shown';
    metro.stop();
    if (last.hit) {
      api.sfx.thud();
      api.buzz([15, 30, 15]);
    } else api.sfx.release();
    {
      const { k, cx, cy } = layout();
      const at = last.hit ? last.meet : rd.P;
      api.judge(last.miss, { x: cx + at.x * k, y: cy + at.y * k - 40 });
      if (last.hit) {
        api.fx.burst(cx + last.meet.x * k, cy + last.meet.y * k, '#FFB834', 22, 240, 2.2);
        api.fx.shake(3, 0.2);
      }
    }
    const head = last.hit ? `Collision, ${last.meetErr.toFixed(1)} u from ✛.` : `No collision — closest approach ${last.closest.d.toFixed(1)} u.`;
    const left = rd.shots - shot;
    if (left > 0) {
      api.prompt(`${head} At ●’s pass, ■ was ${last.miss.toFixed(1)} u from ✛.`, `${suggest(last)} · tap / Enter: adjust and launch again (${left} left)`);
    } else {
      finals.push(last);
      shotsTaken.push(shot);
      api.prompt(`${head} Final miss ${last.miss.toFixed(1)} u.`, round < ROUNDS - 1 ? 'Tap / Enter for the next round' : '');
      if (round === ROUNDS - 1) finish();
    }
    stage.request();
  }

  /** The single adjustment that most improves the next attempt (computed from the true geometry). */
  function suggest(s: ReturnType<typeof scoreLaunch>) {
    const dA = (s.ideal.theta - s.theta) / DEG;
    const dS = (s.ideal.s / s.s - 1) * 100;
    const parts: string[] = [];
    if (!rounds[round].fixedAim && Math.abs(dA) >= 0.3) parts.push(`turn ${Math.abs(dA).toFixed(1)}° ${dA > 0 ? 'clockwise' : 'anticlockwise'}`);
    if (Math.abs(dS) >= 0.5) parts.push(`${Math.abs(dS).toFixed(0)}% ${dS > 0 ? 'faster' : 'slower'}`);
    return parts.length ? 'Next: ' + parts.join(', ') : 'Next: change nothing';
  }

  function next() {
    if (phase !== 'shown') return;
    const rd = rounds[round];
    if (shot < rd.shots) {
      // Same scenario, your settings kept.
      const sv = speed();
      const av = aim();
      setRound(true);
      controls.get('speed').value = sv;
      controls.get('aim').value = av;
      controls.touched = true;
      return;
    }
    if (round < ROUNDS - 1) {
      round++;
      setRound();
    }
  }

  function finish() {
    phase = 'done';
    const mean = finals.reduce((a, f) => a + f.miss, 0) / finals.length;
    const disp = mean.toFixed(1);
    const rows: [string, string][] = finals.map((f, i) => [
      `Round ${i + 1}${shotsTaken[i] > 1 ? ` (shot ${shotsTaken[i]})` : ''}`,
      `${f.miss.toFixed(1)} u · path ${f.spatial.toFixed(1)} u off ✛ · ${Number.isFinite(f.timing) ? `${signed(f.timing * 1000, 0)} ms` : 'never reaches ✛'} · ${f.hit ? 'collision' : `no collision (closest ${f.closest.d.toFixed(1)} u)`}`,
    ]);
    const sp = finals.reduce((a, f) => a + f.spatial, 0) / finals.length;
    const tm = finals.filter((f) => Number.isFinite(f.timing));
    rows.push(['Mean direction error (path vs ✛)', sp.toFixed(1) + ' u']);
    if (tm.length) rows.push(['Mean timing error (■ nearest ✛ vs ●’s pass)', Math.round((tm.reduce((a, f) => a + Math.abs(f.timing), 0) / tm.length) * 1000) + ' ms']);
    rows.push(['Collisions', `${finals.filter((f) => f.hit).length} / ${finals.length}`]);
    if (rounds.some((r) => r.bpm)) rows.push(['Rhythm', 'Hard: ● reached ✛ exactly on the stated beat']);
    const timingDominant = tm.length && sp < 1.5;
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'u',
          label: 'miss at ●’s pass through ✛',
          headline:
            disp === '0.0'
              ? 'Three perfect meetings: the right place, the right moment.'
              : `■ was ${disp} u from ✛ on average when ● passed it — ${timingDominant ? 'your aim was good; the speed (timing) was off' : 'mostly a direction error'}.`,
          rows,
          perfect: disp === '0.0',
          near: mean < 1,
          share: [`INTERSECT · ${api.level}${api.mode !== 'line' ? ' · ' + api.mode : ''} — meet at ✛, on time`, `miss ${disp} u`],
        }),
      api.motion() ? 600 : 0,
    );
  }

  // Direct manipulation: drag the arrow's tip (heading = direction, length = speed).
  const setFromTip = (x: number, y: number, ts: number) => {
    const { k, cx, cy } = layout();
    const p = { x: (x - cx) / k, y: (y - cy) / k };
    const rd = rounds[round];
    const d = sub(p, LAUNCHER);
    let s = Math.hypot(d.x, d.y) / ARROW_K;
    if (rd.fixedAim) s = (d.x * Math.cos(rd.aStart) + d.y * Math.sin(rd.aStart)) / ARROW_K;
    const sp = controls.get('speed');
    sp.value = clamp(s, sp.lo, sp.hi);
    if (!rd.fixedAim) {
      const ak = controls.get('aim');
      let a = Math.atan2(d.y, d.x);
      while (a < ak.lo - Math.PI) a += 2 * Math.PI;
      while (a > ak.hi + Math.PI) a -= 2 * Math.PI;
      ak.value = clamp(a, ak.lo, ak.hi);
    }
    controls.touched = true;
    void ts;
    stage.request();
  };
  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'shown') return next();
    if (phase !== 'aim') return;
    const { k, cx, cy } = layout();
    const p = stage.pt(e);
    // Only inside the field.
    if (Math.abs(p.x - cx) > 50 * k || Math.abs(p.y - cy) > 50 * k) return;
    capture(stage.canvas, e.pointerId);
    dragging = true;
    setFromTip(p.x, p.y, e.timeStamp);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || !primary(e)) return;
    const p = stage.pt(e);
    setFromTip(p.x, p.y, e.timeStamp);
  };
  const onUp = () => {
    dragging = false;
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.repeat || e.defaultPrevented) return;
      if ((e.key === 'Enter' || e.code === 'Space') && phase === 'shown') {
        e.preventDefault();
        next();
      } else if (e.code === 'Space' && phase === 'aim' && controls.touched) {
        e.preventDefault();
        launch();
      }
    }),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    let more = controls.tick(now) || phase === 'run';
    const { k, F, cx, cy, ctrlY, cw } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + u * k;
    const tr = rd.track;
    const big = mislead();

    // Field
    plate(c, cx - F / 2, cy - F / 2, F, F, 14);
    if (big) {
      // Drifting background: induced motion makes ● look faster or slower than it is.
      c.save();
      c.beginPath();
      c.rect(cx - F / 2, cy - F / 2, F, F);
      c.clip();
      const off = ((now / 1000) * 9) % 10;
      for (let u = -60; u < 60; u += 10) line(c, X(u + off), Y(-50), X(u + off - 30), Y(50), pal.line2, 4);
      c.restore();
      more = true;
    }

    // ●'s path (always shown — it is the given), and the target ✛.
    const clipped = (fn: () => void) => {
      c.save();
      c.beginPath();
      c.rect(cx - F / 2, cy - F / 2, F, F);
      c.clip();
      fn();
      c.restore();
    };
    if (tr.kind === 'line') clipped(() => line(c, X(tr.a0.x), Y(tr.a0.y), X(tr.a0.x + tr.va.x * 10), Y(tr.a0.y + tr.va.y * 10), pal.ink3, 1, [3, 4]));
    else circle(c, X(tr.c.x), Y(tr.c.y), tr.r * k, pal.ink3, undefined, 1, [3, 4]);
    glow(c, X(rd.P.x), Y(rd.P.y), 40, pal.accent, 0.9);
    cross(c, X(rd.P.x), Y(rd.P.y), 9, pal.accent, 2);
    circle(c, X(rd.P.x), Y(rd.P.y), CONTACT * k, pal.line, undefined, 1);

    // Launcher
    softShadow(c, X(LAUNCHER.x), Y(LAUNCHER.y) + 8, 10, 3, 1.2);
    rr(c, X(LAUNCHER.x) - 7, Y(LAUNCHER.y) - 7, 14, 14, 4);
    c.fillStyle = pal.ink2;
    c.fill();

    const rA = (big ? 6 : 2.5) * k;
    if (phase === 'aim') {
      // Preview ghost of ●, looping from its start to just past ✛ (not on rhythm rounds).
      const tA = rd.passes[0];
      if (!rd.bpm) {
        const loop = (tr.kind === 'line' ? tA : rd.passes[rd.passes.length - 1]) + 0.7;
        const tt = ((now - setupAt) / 1000) % loop;
        const pa = posA(tr, tt);
        if (big) {
          for (let i = 1; i <= 5; i++) {
            const q = posA(tr, Math.max(0, tt - i * 0.06));
            c.globalAlpha = 0.12;
            circle(c, X(q.x), Y(q.y), rA, undefined, pal.ink);
          }
          c.globalAlpha = 1;
        }
        circle(c, X(pa.x), Y(pa.y), rA, pal.ink2, undefined, 1.5, [2, 2]);
        more = true;
      } else {
        const p0 = posA(tr, 0);
        circle(c, X(p0.x), Y(p0.y), rA, undefined, pal.ink);
        // Beat lamp
        const pos = metro.pos(now);
        const flash = clamp(1 - (pos - Math.floor(pos)) * 4, 0, 1);
        beatLamp(c, X(44), Y(-44), 8, flash > 0.05 ? flash : 0);
        text(c, `♩ ${Math.round(rd.bpm)}`, X(40), Y(-44), font.mono(10, 500), pal.ink3, 'right', 'middle');
        more = true;
      }
      if (tr.kind === 'line' && !rd.bpm) circle(c, X(tr.a0.x), Y(tr.a0.y), 3, undefined, pal.ink3);
      // Your arrow
      const s = speed();
      const a = aim();
      const tip = { x: LAUNCHER.x + Math.cos(a) * s * ARROW_K, y: LAUNCHER.y + Math.sin(a) * s * ARROW_K };
      clipped(() => line(c, X(LAUNCHER.x), Y(LAUNCHER.y), X(LAUNCHER.x + Math.cos(a) * 200), Y(LAUNCHER.y + Math.sin(a) * 200), pal.line, 1, [2, 5]));
      arrow(c, X(LAUNCHER.x), Y(LAUNCHER.y), X(tip.x), Y(tip.y), pal.accent, 2.5, 11);
      glow(c, X(tip.x), Y(tip.y), 30, pal.accent, 0.8);
      circle(c, X(tip.x), Y(tip.y), 7, pal.accent, undefined, 1.5);
      controls.draw(c, cx - cw / 2, ctrlY, cw, { lock: true });
    } else if (last) {
      const t = phase === 'run' ? (now - launchAt) / 1000 : Infinity;
      const end = last.hit ? last.closest.t : Math.max(...rd.passes) + 1.2;
      const tt = Math.min(t, end);
      if (phase === 'run' && t >= end) {
        settle();
      }
      const vb = { x: Math.cos(last.theta) * last.s, y: Math.sin(last.theta) * last.s };
      const pa = posA(tr, tt);
      const pb = add(LAUNCHER, scale(vb, tt));
      clipped(() => {
        line(c, X(LAUNCHER.x), Y(LAUNCHER.y), X(pb.x), Y(pb.y), pal.accent, 1.25);
        // Motion trails: where both were a moment ago.
        if (phase === 'run' && api.motion()) {
          for (let i = 5; i >= 1; i--) {
            const ts = Math.max(0, tt - i * 0.035);
            const qa = posA(tr, ts);
            const qb = add(LAUNCHER, scale(vb, ts));
            c.globalAlpha = 0.16 * (1 - i / 6);
            circle(c, X(qa.x), Y(qa.y), rA, undefined, pal.ink);
            rr(c, X(qb.x) - 6, Y(qb.y) - 6, 12, 12, 3);
            c.fillStyle = pal.accent;
            c.fill();
          }
          c.globalAlpha = 1;
        }
        softShadow(c, X(pa.x), Y(pa.y) + rA * 0.8, rA * 1.2, rA * 0.4, 1.1);
        sphere(c, X(pa.x), Y(pa.y), rA, pal.ink);
        softShadow(c, X(pb.x), Y(pb.y) + 8, 9, 3, 1.1);
        glow(c, X(pb.x), Y(pb.y), 26, pal.accent, 0.7);
        rr(c, X(pb.x) - 6, Y(pb.y) - 6, 12, 12, 3);
        c.fillStyle = pal.paper;
        c.fill();
        c.strokeStyle = pal.accent;
        c.lineWidth = 2.5;
        c.stroke();
      });
      if (rd.bpm && phase === 'run') {
        const pos = metro.pos(now);
        const n = Math.floor(pos);
        text(c, n >= 0 && n <= rd.beat ? `beat ${n}` : '', X(44), Y(-44), font.mono(11, 500), pal.ink2, 'right', 'middle');
      }
      if (phase !== 'run') {
        // Reveal: the ideal launch, where ■ was at ●'s pass, and the closest approach.
        const rp = api.motion() ? easeOut((now - launchAt - end * 1000) / 500) : 1;
        if (rp < 1) more = true;
        c.globalAlpha = clamp(rp, 0, 1);
        const id = last.ideal;
        line(c, X(LAUNCHER.x), Y(LAUNCHER.y), X(rd.P.x), Y(rd.P.y), pal.ink3, 1.25, [5, 4]);
        tag(c, `ideal ${id.s.toFixed(1)} u/s`, X((LAUNCHER.x + rd.P.x) / 2), Y((LAUNCHER.y + rd.P.y) / 2) + 14, pal.ink3, 10);
        const pB = last.pB;
        c.strokeStyle = pal.signal;
        c.lineWidth = 1.5;
        c.setLineDash([2, 2]);
        c.strokeRect(X(pB.x) - 6, Y(pB.y) - 6, 12, 12);
        c.setLineDash([]);
        if (last.miss * k > 3) bracket(c, X(pB.x), Y(pB.y), X(rd.P.x), Y(rd.P.y), pal.signal, 4, 1.5);
        tag(c, `${last.miss.toFixed(1)} u at ●’s pass`, X((pB.x + rd.P.x) / 2), Y((pB.y + rd.P.y) / 2) - 14, pal.signal, 11);
        if (!last.hit) {
          const qa = posA(tr, last.closest.t);
          const qb = add(LAUNCHER, scale(vb, last.closest.t));
          line(c, X(qa.x), Y(qa.y), X(qb.x), Y(qb.y), pal.ink2, 1, [1, 2]);
          tag(c, `closest ${last.closest.d.toFixed(1)} u — no collision`, X((qa.x + qb.x) / 2), Y((qa.y + qb.y) / 2) + 14, pal.ink2, 10);
        } else {
          // A hit: a ring spreads from the point of contact.
          const hp = (now - launchAt - end * 1000) / 700;
          if (api.motion() && hp < 1) {
            ripple(c, X(last.meet.x), Y(last.meet.y), 6, 46, Math.max(0.001, hp), pal.accent, 2.5);
            more = true;
          }
          tag(c, 'collision', X(last.meet.x), Y(last.meet.y) - 16, pal.ink, 11);
        }
        c.globalAlpha = 1;
        text(c, 'tap / Enter to continue ▸', cx, ctrlY + 30, font.mono(11, 500), pal.ink2, 'center');
      }
    }
    // Round strip
    const sy = stage.h - 12;
    for (let i = 0; i < ROUNDS; i++) {
      const x = stage.w / 2 + (i - 1) * 56;
      text(c, i < finals.length ? finals[i].miss.toFixed(1) : i === round ? '•' : '·', x, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      metro.stop();
      controls.destroy();
      offs.forEach((f) => f());
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointermove', onMove);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onUp);
    },
  };
};

export default factory;
