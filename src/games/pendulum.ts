// 28 · PENDULUM CATCH — catch the bob exactly as it passes the mark.
// The pendulum is the real, nonlinear one: θ'' = −(g/L)·sin θ, integrated with RK4 at 1 ms. Its period is
// T = 4·√(L/g)·K(sin(θ₀/2)) — the small-angle formula 2π√(L/g) is only an approximation, and the reveal shows
// how far off it is at your amplitude. You release the bob, then tap when it crosses the mark in the stated
// direction. Score: |tap − true crossing| in ms (both from input timestamps).
import { Controls } from '../core/controls';
import { circle, clamp, cross, font, hair, line, pal, tag, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { alpha, glow, neon, plate, reticle, rr, solidBlock } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

export const GRAV = 9.81; // m/s²
export const PDT = 0.001; // s
const RUN = 14; // s simulated per round
const MAX_ERR = 500; // ms
const DEG = Math.PI / 180;

/** Arithmetic–geometric mean. */
export function agm(a: number, b: number) {
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return a;
}
/** Complete elliptic integral of the first kind, K(k) = π / (2·AGM(1, √(1−k²))). */
export const ellipticK = (k: number) => Math.PI / (2 * agm(1, Math.sqrt(1 - k * k)));
/** Exact period of a pendulum released from rest at amplitude θ0 (radians). */
export const exactPeriod = (L: number, th0: number) => 4 * Math.sqrt(L / GRAV) * ellipticK(Math.sin(th0 / 2));
export const smallAnglePeriod = (L: number) => 2 * Math.PI * Math.sqrt(L / GRAV);

/** A gust: an instant kick to the angular velocity (rad/s) at time t (s). */
export interface Gust {
  t: number;
  dw: number;
}

/** θ(t) sampled every PDT from release at rest (RK4), with optional gusts. */
export function simulate(L: number, th0: number, T = RUN, gusts: Gust[] = []) {
  const n = Math.ceil(T / PDT) + 1;
  const th = new Float64Array(n);
  let x = th0;
  let w = 0;
  const f = (x: number) => -(GRAV / L) * Math.sin(x);
  th[0] = x;
  let gi = 0;
  for (let i = 1; i < n; i++) {
    while (gi < gusts.length && gusts[gi].t <= (i - 1) * PDT) w += gusts[gi++].dw;
    const k1x = w;
    const k1w = f(x);
    const k2x = w + (PDT / 2) * k1w;
    const k2w = f(x + (PDT / 2) * k1x);
    const k3x = w + (PDT / 2) * k2w;
    const k3w = f(x + (PDT / 2) * k2x);
    const k4x = w + PDT * k3w;
    const k4w = f(x + PDT * k3x);
    x += (PDT / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    w += (PDT / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    th[i] = x;
  }
  return th;
}

export const thetaAt = (th: Float64Array, t: number) => {
  const i = clamp(t / PDT, 0, th.length - 1);
  const i0 = Math.floor(i);
  const i1 = Math.min(th.length - 1, i0 + 1);
  return th[i0] + (th[i1] - th[i0]) * (i - i0);
};

/** Times (s) at which θ crosses `target`, moving in direction dir (+1 increasing, −1 decreasing, 0 either). */
export function crossings(th: Float64Array, target: number, dir: number) {
  const out: number[] = [];
  for (let i = 1; i < th.length; i++) {
    const a = th[i - 1] - target;
    const b = th[i] - target;
    // A sign change from one sample to the next (touching zero counts once, on the way through).
    const crosses = (a < 0 && b >= 0) || (a > 0 && b <= 0);
    if (!crosses) continue;
    const up = th[i] > th[i - 1];
    if (dir !== 0 && (dir > 0) !== up) continue;
    out.push((i - 1 + a / (a - b)) * PDT);
  }
  return out;
}

export interface PendulumRound {
  L: number; // m
  th0: number; // rad (released at +th0, i.e. on the right)
  target: number; // rad
  dir: number;
  curtain: boolean;
}

export function makePendulum(seed: number, level: Level): PendulumRound[] {
  const r = rng(seed);
  return Array.from({ length: 4 }, () => {
    const L = r.range(level === 'easy' ? 0.8 : 0.5, level === 'easy' ? 1.6 : 2.2);
    const amp = level === 'easy' ? r.range(18, 32) : level === 'medium' ? r.range(40, 70) : r.range(65, 110);
    const th0 = amp * DEG;
    const target = level === 'easy' ? 0 : r.sign() * r.range(0.2, 0.55) * th0;
    return { L, th0, target, dir: level === 'easy' ? 0 : r.sign(), curtain: level === 'hard' };
  });
}

/**
 * Gusts mode: two or three seeded kicks per swing, sized to the pendulum (a fraction of its natural speed at the
 * bottom), never enough to send the bob over the top.
 */
export function makeGusts(seed: number, rds: PendulumRound[], level: Level): Gust[][] {
  const r = rng(seed ^ 0x6a09e667);
  return rds.map((rd) => {
    const n = level === 'hard' ? 3 : 2;
    const vmax = rd.th0 * Math.sqrt(GRAV / rd.L);
    let t = r.range(1.1, 2.6);
    const g: Gust[] = [];
    for (let i = 0; i < n; i++) {
      g.push({ t, dw: r.sign() * r.range(0.18, 0.38) * vmax });
      t += r.range(1.4, 2.8);
    }
    for (let k = 0; k < 6; k++) {
      const th = simulate(rd.L, rd.th0, RUN, g);
      let peak = 0;
      for (let i = 0; i < th.length; i += 10) peak = Math.max(peak, Math.abs(th[i]));
      if (peak < 2.7) break;
      g.forEach((q) => (q.dw *= 0.6));
    }
    return g;
  });
}

/** Signed timing error (ms) of a catch at time t against the nearest valid crossing after 0.25 s. */
export function catchError(rd: PendulumRound, th: Float64Array, t: number) {
  const xs = crossings(th, rd.target, rd.dir).filter((x) => x > 0.25);
  if (!xs.length) return { err: MAX_ERR, signedErr: NaN, at: NaN };
  let best = xs[0];
  for (const x of xs) if (Math.abs(x - t) < Math.abs(best - t)) best = x;
  const e = (t - best) * 1000;
  return { err: Math.min(MAX_ERR, Math.abs(e)), signedErr: e, at: best };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: PendulumRound[] = [];
  let round = 0;
  let th = new Float64Array(1);
  let phase: 'held' | 'swing' | 'reveal' | 'done' | 'sandbox' = 'held';
  let releaseAt = 0;
  let catchT = 0;
  let missTimer = 0;
  let finTimer = 0;
  let results: ReturnType<typeof catchError>[] = [];
  let sbL = 1;
  let sbA = 60;
  let sbAt = 0;
  let keyDown = false;
  const sandbox = () => api.mode === 'sandbox';
  const gusty = () => api.mode === 'gusts';
  let gusts: Gust[][] = [];
  let fired = 0;
  let gustAt = -1e9;
  let gustDir = 1;
  const controls = new Controls(stage, () => {});

  /** Fit the whole swing: beyond 90° the bob rises above the pivot, so the pivot moves down to make room. */
  const geom = () => {
    const W = stage.w;
    const H = stage.h;
    const amp = sandbox() ? sbA * DEG : (rounds[round]?.th0 ?? 1);
    const L = sandbox() ? 2.5 : 2.3;
    const above = Math.max(0, -Math.cos(amp)); // fraction of L above the pivot
    const top = 118;
    const ppm = Math.max(20, Math.min((H - top - 150) /(L * (1 + above) + 0.1), (W / 2 - 30) / (L * Math.min(1, Math.sin(Math.min(amp, Math.PI / 2))) + 0.15))); // px per metre
    const pivot = { x: W / 2, y: top + 14 + above * L * ppm };
    return { pivot, ppm };
  };

  function setRound() {
    const rd = rounds[round];
    th = simulate(rd.L, rd.th0, RUN, gusty() ? gusts[round] : []);
    fired = 0;
    phase = 'held';
    api.progress(`${round + 1} / ${rounds.length}`);
    const dirTxt = rd.dir > 0 ? 'swinging right' : rd.dir < 0 ? 'swinging left' : 'in either direction';
    api.prompt(`Catch it at the mark, ${dirTxt}.`, `Press to release · then tap the instant it crosses${gusty() ? ' · wind gusts will knock it off rhythm — re-time after each one' : ''}${rd.curtain ? ' · the mark is behind a screen: predict it' : ''}`);
  }

  function reset(seed: number) {
    clearTimeout(missTimer);
    clearTimeout(finTimer);
    keyDown = false;
    if (sandbox()) {
      phase = 'sandbox';
      sbAt = performance.now();
      controls.set([
        { id: 'L', label: 'length', lo: 0.3, hi: 2.5, value: sbL, speed: 0.5, readout: (v) => `${v.toFixed(2)} m`, onChange: (v) => ((sbL = v), resim()) },
        { id: 'A', label: 'release angle', lo: 5, hi: 170, value: sbA, speed: 30, readout: (v) => `${v.toFixed(0)}°`, onChange: (v) => ((sbA = v), resim()) },
      ]);
      controls.enabled = true;
      resim();
      api.progress('sandbox');
      api.prompt('Sandbox: change the length and the release angle.', 'Compare the exact period with the small-angle formula · nothing is scored');
      stage.request();
      return;
    }
    controls.set([]);
    controls.enabled = false;
    rounds = makePendulum(seed, api.level);
    gusts = gusty() ? makeGusts(seed, rounds, api.level) : rounds.map(() => []);
    round = 0;
    results = [];
    setRound();
    stage.request();
  }

  function resim() {
    th = simulate(sbL, sbA * DEG, 30);
    sbAt = performance.now();
  }

  function input(ts: number) {
    if (phase === 'held') {
      phase = 'swing';
      releaseAt = ts;
      api.sfx.tick();
      api.prompt('');
      clearTimeout(missTimer);
      missTimer = window.setTimeout(() => phase === 'swing' && doCatch(releaseAt + 12000), 12500);
    } else if (phase === 'swing') doCatch(ts);
    else if (phase === 'reveal') next();
    stage.request();
  }

  function doCatch(ts: number) {
    clearTimeout(missTimer);
    const rd = rounds[round];
    catchT = (ts - releaseAt) / 1000;
    const res = catchError(rd, th, catchT);
    const { pivot, ppm } = geom();
    const q = thetaAt(th, catchT);
    api.judge(res.err, { x: pivot.x + Math.sin(q) * rd.L * ppm, y: pivot.y + Math.cos(q) * rd.L * ppm - 50 });
    results.push(res);
    phase = 'reveal';
    api.sfx[res.err < 20 ? 'near' : 'release']();
    api.buzz(10);
    const T = exactPeriod(rd.L, rd.th0);
    const T0 = smallAnglePeriod(rd.L);
    const angErr = (thetaAt(th, catchT) - rd.target) / DEG;
    api.prompt(
      Number.isFinite(res.signedErr) ? `${res.signedErr >= 0 ? '+' : '−'}${Math.abs(Math.round(res.signedErr))} ms ${res.signedErr < 0 ? 'early' : 'late'} · ${angErr >= 0 ? '+' : '−'}${Math.abs(angErr).toFixed(1)}° from the mark.` : 'No catch.',
      gusty()
        ? `${fired} gust${fired === 1 ? '' : 's'} reshaped this swing before your catch${round < rounds.length - 1 ? ' · tap for the next' : ''}`
        : `Period ${T.toFixed(3)} s — the small-angle formula says ${T0.toFixed(3)} s (${(((T - T0) / T0) * 100).toFixed(1)}% short at ${(rd.th0 / DEG).toFixed(0)}°)${round < rounds.length - 1 ? ' · tap for the next' : ''}`,
    );
    if (round === rounds.length - 1) finish();
  }

  function next() {
    if (phase !== 'reveal' || round >= rounds.length - 1) return;
    round++;
    setRound();
  }

  function finish() {
    phase = 'done';
    const mean = results.reduce((a, r) => a + r.err, 0) / results.length;
    const disp = String(Math.round(mean));
    const signedOnes = results.filter((r) => Number.isFinite(r.signedErr)).map((r) => r.signedErr);
    const bias = signedOnes.length ? signedOnes.reduce((a, b) => a + b, 0) / signedOnes.length : 0;
    const rows: [string, string][] = rounds.map((rd, i) => [
      `${i + 1} · ${rd.L.toFixed(2)} m, ${(rd.th0 / DEG).toFixed(0)}°`,
      Number.isFinite(results[i].signedErr) ? `${results[i].signedErr >= 0 ? '+' : '−'}${Math.abs(Math.round(results[i].signedErr))} ms · T = ${exactPeriod(rd.L, rd.th0).toFixed(3)} s (small-angle ${smallAnglePeriod(rd.L).toFixed(3)} s)` : 'no catch',
    ]);
    rows.push(['Bias', `${bias >= 0 ? '+' : '−'}${Math.abs(Math.round(bias))} ms — ${Math.abs(bias) < 10 ? 'centred' : bias < 0 ? 'you anticipate' : 'you lag'}`]);
    rows.push(['Model', 'θ″ = −(g/L)·sin θ, RK4 at 1 ms; exact period via the elliptic integral K']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'ms',
          label: 'mean catch timing error',
          headline: disp === '0' ? 'Four perfect catches.' : `${disp} ms off on average${Math.abs(bias) > 20 ? `, mostly ${bias < 0 ? 'early' : 'late'}` : ''}.`,
          rows,
          perfect: disp === '0',
          near: mean < 15,
          share: [`PENDULUM CATCH · ${api.level} — catch the bob at the mark`, `${disp} ms`],
        }),
      api.motion() ? 600 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e) || sandbox()) return;
    input(e.timeStamp);
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  const onVis = () => {
    keyDown = false;
    if (document.hidden && phase === 'swing') api.voidRun('Attempt voided — the tab was hidden mid-swing.');
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      if (e.code !== 'Space' || !gameKey(e) || sandbox()) return;
      e.preventDefault();
      if (e.repeat || keyDown) return;
      keyDown = true;
      input(e.timeStamp);
    }),
    listen('keyup', (e) => {
      if (e.code === 'Space') keyDown = false;
    }),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const { pivot, ppm } = geom();
    let more = false;
    const rd = rounds[round];
    const L = sandbox() ? sbL : rd?.L ?? 1;
    const len = L * ppm;
    let t = 0;
    if (sandbox()) {
      more = controls.tick(now) || true;
      t = ((now - sbAt) / 1000) % 29;
    } else if (phase === 'swing') {
      t = Math.min(RUN - 0.01, (now - releaseAt) / 1000);
      more = true;
    } else if (phase === 'reveal' || phase === 'done') t = catchT;
    const theta = phase === 'held' && rd ? rd.th0 : thetaAt(th, t);
    const bob = { x: pivot.x + Math.sin(theta) * len, y: pivot.y + Math.cos(theta) * len };
    // Gusts: each one announces itself as it hits — a whoosh and a spray of air past the bob.
    if (gusty() && phase === 'swing' && rd) {
      const gs = gusts[round] ?? [];
      while (fired < gs.length && t >= gs[fired].t) {
        const g = gs[fired++];
        const behind = rd.curtain && Math.abs(theta - rd.target) < 0.5;
        gustDir = Math.sign(g.dw);
        if (!behind) {
          gustAt = now;
          api.sfx.whoosh();
          const tx = Math.cos(theta) * gustDir;
          const ty = -Math.sin(theta) * gustDir;
          api.fx.spray(bob.x - tx * 30, bob.y - ty * 30, Math.atan2(ty, tx), 0.35, pal.accent, 16, 320, 1.4, 0);
        }
      }
    }
    const amp = sandbox() ? sbA * DEG : rd.th0;
    const hidden = !sandbox() && !!rd?.curtain && phase === 'swing';

    // The CRT: a dark tube face with a phosphor graticule, centred on the pivot's vertical.
    const crtX = 24;
    const crtY = 70;
    const crtW = stage.w - 48;
    const crtH = stage.h - (sandbox() ? 190 : 100);
    c.save();
    rr(c, crtX, crtY, crtW, crtH, 6);
    c.fillStyle = alpha(pal.paper, 0.72);
    c.fill();
    c.clip();
    const gs = 40;
    c.strokeStyle = alpha(pal.accent, 0.05);
    c.lineWidth = 1;
    c.beginPath();
    for (let x = pivot.x % gs; x < stage.w; x += gs) {
      c.moveTo(Math.round(x) + 0.5, crtY);
      c.lineTo(Math.round(x) + 0.5, crtY + crtH);
    }
    for (let y = crtY + ((pivot.y - crtY) % gs); y < crtY + crtH; y += gs) {
      c.moveTo(crtX, Math.round(y) + 0.5);
      c.lineTo(crtX + crtW, Math.round(y) + 0.5);
    }
    c.stroke();
    hair(c, pivot.x, crtY, pivot.x, crtY + crtH, alpha(pal.accent, 0.14));
    hair(c, crtX, pivot.y + len, crtX + crtW, pivot.y + len, alpha(pal.accent, 0.1));
    // Concentric rings around the pivot, faint, like a polar overlay.
    for (const k of [0.5, 1, 1.25]) {
      c.beginPath();
      c.arc(pivot.x, pivot.y, len * k, 0, Math.PI * 2);
      c.strokeStyle = alpha(pal.accent, k === 1 ? 0.0 : 0.05);
      c.stroke();
    }
    // Phosphor bloom in the middle of the tube.
    const bl = c.createRadialGradient(pivot.x, pivot.y + len * 0.6, 0, pivot.x, pivot.y + len * 0.6, Math.max(crtW, crtH) * 0.6);
    bl.addColorStop(0, alpha(pal.accent, 0.06));
    bl.addColorStop(1, alpha(pal.accent, 0));
    c.fillStyle = bl;
    c.fillRect(crtX, crtY, crtW, crtH);
    c.restore();
    c.strokeStyle = pal.line2;
    rr(c, crtX, crtY, crtW, crtH, 6);
    c.stroke();
    reticle(c, crtX + 8, crtY + 8, crtW - 16, crtH - 16, 12, alpha(pal.accent, 0.4));

    // Telemetry, top left of the tube (blank while the bob is behind Hard's screen — it would give it away).
    if (!hidden) {
      const w = phase === 'swing' || sandbox() ? (thetaAt(th, t + 0.001) - thetaAt(th, Math.max(0, t - 0.001))) / 0.002 : 0;
      const Lm = sandbox() ? sbL : rd?.L ?? 1;
      const lines = [
        `THETA θ(t): ${theta >= 0 ? '+' : '−'}${Math.abs(theta / DEG).toFixed(3)}°`,
        `ANGULAR VEL: ${w >= 0 ? '+' : '−'}${Math.abs(w).toFixed(3)} rad/s`,
        `RESTORING FORCE: ${(GRAV * Math.abs(Math.sin(theta))).toFixed(3)} N/kg`,
        `LENGTH: ${Lm.toFixed(2)} m`,
      ];
      lines.forEach((s, i) => text(c, s, crtX + 22, crtY + 32 + i * 21, font.mono(i === 0 ? 14 : 12, i === 0 ? 500 : 400), i === 0 ? pal.ink : pal.ink2, 'left', 'middle'));
    } else text(c, 'THETA θ(t): ——— · SCREENED', crtX + 22, crtY + 32, font.mono(14, 500), pal.ink3, 'left', 'middle');

    // Arc of possible positions, and the zero-gate
    c.beginPath();
    c.arc(pivot.x, pivot.y, len, Math.PI / 2 - amp, Math.PI / 2 + amp);
    c.strokeStyle = alpha(pal.accent, 0.18);
    c.lineWidth = 1;
    c.setLineDash([2, 5]);
    c.stroke();
    c.setLineDash([]);
    if (!sandbox() && rd) {
      const tg = { x: pivot.x + Math.sin(rd.target) * len, y: pivot.y + Math.cos(rd.target) * len };
      const nx = Math.sin(rd.target);
      const ny = Math.cos(rd.target);
      // The gate: a short dotted coral arc around the mark and a crisp tick across the path.
      for (let k = -5; k <= 5; k++) {
        const a = rd.target + (k / 5) * 0.09;
        c.beginPath();
        c.arc(pivot.x + Math.sin(a) * (len + 30), pivot.y + Math.cos(a) * (len + 30), k === 0 ? 0 : 2.4, 0, Math.PI * 2);
        c.fillStyle = alpha(pal.signal, 0.75 - Math.abs(k) * 0.1);
        c.fill();
      }
      glow(c, tg.x, tg.y, 30, pal.signal, 0.5);
      line(c, tg.x - nx * 24, tg.y - ny * 24, tg.x + nx * 40, tg.y + ny * 40, pal.signal, 2);
      if (rd.dir) {
        const tx = Math.cos(rd.target) * rd.dir;
        const ty = -Math.sin(rd.target) * rd.dir;
        const ax = tg.x + nx * 54;
        const ay = tg.y + ny * 54;
        line(c, ax - tx * 10, ay - ty * 10, ax + tx * 10, ay + ty * 10, pal.signal, 1.5);
        line(c, ax + tx * 10, ay + ty * 10, ax + tx * 4 - ty * 4, ay + ty * 4 + tx * 4, pal.signal, 1.5);
        line(c, ax + tx * 10, ay + ty * 10, ax + tx * 4 + ty * 4, ay + ty * 4 - tx * 4, pal.signal, 1.5);
      }
      text(c, `ZERO-GATE [${rd.dir > 0 ? '→' : rd.dir < 0 ? '←' : '↔'} ${rd.target >= 0 ? '+' : '−'}${Math.abs(rd.target / DEG).toFixed(1)}°]`, tg.x + nx * 72, tg.y + ny * 72 + 4, font.mono(10, 600), pal.signal, 'center', 'middle');
    }
    // Phosphor persistence: the recent path glows and fades (decorative; off with reduced motion).
    if ((phase === 'swing' || sandbox()) && api.motion() && !hidden) {
      for (let k = 14; k >= 1; k--) {
        const q = thetaAt(th, Math.max(0, t - k * 0.016));
        const x = pivot.x + Math.sin(q) * len;
        const y = pivot.y + Math.cos(q) * len;
        c.globalAlpha = 0.35 * (1 - k / 15);
        circle(c, x, y, 3 + 6 * (1 - k / 15), undefined, pal.accent);
      }
      c.globalAlpha = 1;
    }
    // Wind streaks for a moment after a gust.
    if (gusty() && now - gustAt < 450) {
      const p = (now - gustAt) / 450;
      c.save();
      c.strokeStyle = alpha(pal.accent, 0.5 * (1 - p));
      c.lineWidth = 1.25;
      for (let i = 0; i < 9; i++) {
        const y = pivot.y + len * (0.35 + i * 0.09);
        const x0 = pivot.x - gustDir * len * (1.1 - p * 2.2) + ((i * 37) % 60) * gustDir;
        c.beginPath();
        c.moveTo(x0, y);
        c.lineTo(x0 + gustDir * (40 + (i % 3) * 25), y);
        c.stroke();
      }
      c.restore();
      more = true;
    }
    // Rod, pivot, bob: luminous vectors.
    neon(c, (c) => (c.moveTo(pivot.x, pivot.y), c.lineTo(bob.x, bob.y)), alpha(pal.accent, 0.85), 1.6, 10);
    // The mount
    solidBlock(c, pivot.x - 30, pivot.y - 13, 60, 9, pal.ink2);
    circle(c, pivot.x, pivot.y, 9, alpha(pal.accent, 0.8), alpha(pal.paper, 0.9), 1.5);
    cross(c, pivot.x, pivot.y, 16, alpha(pal.accent, 0.6), 1, 11);
    circle(c, pivot.x, pivot.y, 2.5, undefined, pal.accent);
    // The bob: a reticle — ring, rotating ticks, a bright core.
    glow(c, bob.x, bob.y, 46, pal.accent, 0.8);
    circle(c, bob.x, bob.y, 18, pal.accent, alpha(pal.paper, 0.85), 2);
    const spin = api.motion() ? now / 900 : 0;
    for (let k = 0; k < 4; k++) {
      const a = spin + (k * Math.PI) / 2;
      line(c, bob.x + Math.cos(a) * 11, bob.y + Math.sin(a) * 11, bob.x + Math.cos(a) * 15, bob.y + Math.sin(a) * 15, pal.accent, 1.5);
    }
    circle(c, bob.x, bob.y, 4.5, undefined, pal.ink);

    // The oscilloscope strip: θ over the last seconds, scrolling, along the bottom of the tube.
    if (phase === 'swing' && !hidden && !sandbox()) {
      const sx0 = crtX + 40;
      const sx1 = crtX + crtW * 0.62;
      const sy = crtY + crtH - 50;
      const win = 3;
      c.beginPath();
      for (let i = 0; i <= 160; i++) {
        const tt = t - win + (win * i) / 160;
        const q = tt < 0 ? rd.th0 : thetaAt(th, tt);
        const x = sx0 + ((sx1 - sx0) * i) / 160;
        const y = sy - (q / (Math.max(rd.th0, 0.2) * 1.1)) * 26;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.save();
      c.strokeStyle = alpha('#3BE38B', 0.85);
      c.shadowColor = alpha('#3BE38B', 0.6);
      c.shadowBlur = 8;
      c.lineWidth = 1.6;
      c.stroke();
      c.restore();
      hair(c, sx0, sy - (rd.target / (Math.max(rd.th0, 0.2) * 1.1)) * 26, sx1, sy - (rd.target / (Math.max(rd.th0, 0.2) * 1.1)) * 26, alpha(pal.signal, 0.45), [3, 4]);
    }
    // Status chips, bottom right of the tube.
    if (!sandbox() && rd) {
      const chip = phase === 'held' ? 'GATE ARMED' : phase === 'swing' ? 'TRACKING' : 'LATCHED';
      c.font = font.mono(13, 500);
      const cw = c.measureText(chip).width + 28;
      const cx2 = crtX + crtW - 150 - cw;
      const cy2 = crtY + crtH - 54;
      rr(c, cx2, cy2, cw, 32, 4);
      c.fillStyle = alpha(pal.paper2, 0.9);
      c.fill();
      c.strokeStyle = phase === 'swing' ? alpha(pal.accent, 0.6) : pal.line;
      c.stroke();
      text(c, chip, cx2 + cw / 2, cy2 + 16.5, font.mono(13, 500), phase === 'swing' ? pal.accent : pal.ink, 'center', 'middle');
      text(c, 'CYCLE NO.', crtX + crtW - 30, cy2 + 6, font.mono(11, 400), pal.ink2, 'right', 'middle');
      text(c, String(round + 1).padStart(3, '0'), crtX + crtW - 30, cy2 + 26, font.mono(14, 500), pal.ink, 'right', 'middle');
    }

    // Hard: a frosted screen hides the bob around the mark (it is still there — predict it).
    if (!sandbox() && rd?.curtain && phase !== 'reveal' && phase !== 'done') {
      const a0 = rd.target - 0.45;
      const a1 = rd.target + 0.45;
      c.save();
      c.beginPath();
      c.moveTo(pivot.x, pivot.y);
      c.arc(pivot.x, pivot.y, len + 30, Math.PI / 2 - a1, Math.PI / 2 - a0);
      c.closePath();
      c.clip();
      c.fillStyle = pal.paper2;
      c.fillRect(0, 0, stage.w, stage.h);
      // Frosted: a pale sheen across the screen.
      const fg = c.createLinearGradient(pivot.x - len, pivot.y, pivot.x + len, pivot.y + len);
      fg.addColorStop(0, 'rgba(255,255,255,0)');
      fg.addColorStop(0.5, pal.glass);
      fg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = fg;
      c.fillRect(0, 0, stage.w, stage.h);
      c.restore();
      for (const a of [a0, a1]) line(c, pivot.x + Math.sin(a) * 30, pivot.y + Math.cos(a) * 30, pivot.x + Math.sin(a) * (len + 30), pivot.y + Math.cos(a) * (len + 30), pal.line, 1);
      const tg = { x: pivot.x + Math.sin(rd.target) * len, y: pivot.y + Math.cos(rd.target) * len };
      const nx = Math.sin(rd.target);
      const ny = Math.cos(rd.target);
      line(c, tg.x - nx * 22, tg.y - ny * 22, tg.x + nx * 22, tg.y + ny * 22, pal.ink3, 2, [4, 3]);
    }

    if (sandbox()) {
      const T = exactPeriod(sbL, sbA * DEG);
      const T0 = smallAnglePeriod(sbL);
      text(c, `exact period ${T.toFixed(3)} s · small-angle ${T0.toFixed(3)} s · ${(((T - T0) / T0) * 100).toFixed(1)}% longer`, stage.w / 2, stage.h - 150, font.mono(11, 500), pal.ink, 'center');
      controls.draw(c, stage.w / 2 - Math.min(stage.w - 32, 460) / 2, stage.h - 130, Math.min(stage.w - 32, 460), { lock: false });
    } else if ((phase === 'reveal' || phase === 'done') && results[round]) {
      // θ(t) around the catch: the true crossing and your tap.
      const res = results[round];
      const L0 = stage.w / 2 - 220;
      const R0 = stage.w / 2 + 220;
      const y0 = stage.h - 60;
      const span = 1.2;
      const t0 = Number.isFinite(res.at) ? res.at : catchT;
      const X = (tt: number) => L0 + ((tt - (t0 - span / 2)) / span) * (R0 - L0);
      const Y = (q: number) => y0 - (q / (rd.th0 * 1.1)) * 36;
      plate(c, L0 - 16, y0 - 68, R0 - L0 + 32, 100, 12);
      hair(c, L0, Y(rd.target), R0, Y(rd.target), pal.ink3, [3, 3]);
      c.beginPath();
      for (let i = 0; i <= 120; i++) {
        const tt = t0 - span / 2 + (span * i) / 120;
        if (tt < 0) continue;
        const yy = Y(thetaAt(th, tt));
        if (i) c.lineTo(X(tt), yy);
        else c.moveTo(X(tt), yy);
      }
      c.strokeStyle = pal.ink;
      c.lineWidth = 1.5;
      c.stroke();
      if (Number.isFinite(res.at)) line(c, X(res.at), y0 - 44, X(res.at), y0 + 8, pal.ink, 1.5);
      const cx2 = clamp(X(catchT), L0, R0);
      line(c, cx2, y0 - 44, cx2, y0 + 8, pal.signal, 2);
      tag(c, X(catchT) < L0 ? '◂ you (earlier)' : X(catchT) > R0 ? 'you (later) ▸' : 'you', cx2, y0 + 18, pal.signal, 10);
      text(c, 'ANGLE OVER TIME AROUND YOUR CATCH', L0, y0 - 52, font.mono(9, 500), pal.ink3, 'left');
    }
    if (phase === 'held') text(c, 'press to release', stage.w / 2, stage.h - 40, font.mono(12, 500), pal.ink2, 'center');
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(missTimer);
      clearTimeout(finTimer);
      controls.destroy();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
