// 20 · COMMUNICATING VESSELS — equilibrium and conservation.
// Vessels of different shapes stand side by side, joined at the bottom by pipes with valves. Open a valve and
// liquid flows from the higher free surface to the lower until the SURFACES are level — the volumes need not
// be equal. If the common level would rise above the shortest vessel's rim, that vessel overflows.
// Predict rounds: place a line where the surface will settle, then watch it happen.
// Target rounds: operate the valves yourself and close them when a vessel reaches its mark.
// The flow is a conservative fixed-step simulation (1/120 s); the final state always matches equilibrium().
import { Controls } from '../core/controls';
import { clamp, easeOut, font, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { glassWall, liquidBody, liquidSurface, rr, slot, softShadow } from '../core/materials';
import { rng, type Rng } from '../core/rng';
import { equilibrium, flowStep, levelFor, pourTable, surfaceOf, type Tank } from '../core/scoring';
import { sensitivity } from '../core/settings';
import type { GameFactory, Level } from '../core/types';

export const DT = 1 / 120;
const K = 2.4; // pipe conductance: u³ per second per u of height difference (scaled by the smaller vessel)

export type Shape = 'box' | 'cone' | 'funnel' | 'bottle';
export interface VesselSpec {
  shape: Shape;
  w0: number; // width at the bottom (u)
  w1: number; // width at the top (u)
  H: number; // rim height (u)
  floor: number; // floor height (u)
  x: number; // centre (u)
}

export interface VesselsRound {
  kind: 'predict' | 'target';
  vessels: VesselSpec[];
  V0: number[];
  /** Pipes join neighbours i and i+1. */
  pipes: { a: number; b: number }[];
  /** Target rounds: which vessel, and the surface height (u) it must reach. */
  target: { i: number; s: number } | null;
}

export function widthAt(v: VesselSpec, y: number) {
  const u = clamp(y / v.H, 0, 1);
  switch (v.shape) {
    case 'box':
      return v.w0;
    case 'cone':
    case 'funnel':
      return v.w0 + (v.w1 - v.w0) * u;
    case 'bottle': {
      const t = clamp((u - 0.55) / 0.25, 0, 1);
      return v.w0 + (v.w1 - v.w0) * t * t * (3 - 2 * t);
    }
  }
}

export const tankOf = (v: VesselSpec): Tank => ({ tab: pourTable((y) => widthAt(v, y), v.H, 400), floor: v.floor });

function vessel(r: Rng, x: number, level: Level, short = false): VesselSpec {
  const shape = r.pick<Shape>(level === 'easy' ? ['box', 'cone', 'funnel'] : ['box', 'cone', 'funnel', 'bottle']);
  const a = r.range(8, 14);
  const b = r.range(18, 26);
  const [w0, w1] = shape === 'box' ? [r.range(8, 24), 0] : shape === 'cone' ? [a, b] : [b, a];
  return { shape, w0, w1: shape === 'box' ? w0 : w1, H: short ? r.range(30, 40) : r.range(55, 70), floor: level === 'hard' ? r.pick([0, 0, 8, 14]) : 0, x };
}

export function makeVessels(seed: number, level: Level): VesselsRound[] {
  const r = rng(seed);
  const plan: VesselsRound['kind'][] = level === 'easy' ? ['predict', 'predict', 'predict', 'target'] : level === 'medium' ? ['predict', 'predict', 'predict', 'target', 'target'] : ['predict', 'predict', 'target', 'target', 'target'];
  const out: VesselsRound[] = [];
  let guard = 0;
  while (out.length < plan.length && guard++ < 5000) {
    const kind = plan[out.length];
    const n = level === 'easy' ? 2 : 3;
    const xs = n === 2 ? [-22, 22] : [-33, 0, 33];
    // Medium/Hard predict rounds sometimes include a short vessel, so the answer can be an overflow.
    const shortIdx = level !== 'easy' && kind === 'predict' && r.next() < 0.4 ? r.int(0, n - 1) : -1;
    const vessels = xs.map((x, i) => vessel(r, x, level, i === shortIdx));
    const tanks = vessels.map(tankOf);
    const V0 = tanks.map((t, i) => t.tab.total * (i === 0 ? r.range(0.55, 0.9) : r.range(0.05, 0.45)));
    // Shuffle which vessel starts high.
    if (r.next() < 0.5) V0.reverse();
    const surfaces = tanks.map((t, i) => surfaceOf(t, V0[i]));
    if (Math.max(...surfaces) - Math.min(...surfaces) < 12) continue;
    const pipes = xs.slice(1).map((_, i) => ({ a: i, b: i + 1 }));
    let target: VesselsRound['target'] = null;
    if (kind === 'target') {
      // A reachable target: move a neighbour of the highest vessel part-way to their pair equilibrium.
      const hi = surfaces.indexOf(Math.max(...surfaces));
      const nb = hi === 0 ? 1 : hi === n - 1 ? n - 2 : surfaces[hi - 1] < surfaces[hi + 1] ? hi - 1 : hi + 1;
      const pair = equilibrium([tanks[hi], tanks[nb]], [V0[hi], V0[nb]]);
      if (pair.overflow > 0) continue;
      const from = surfaces[nb];
      if (pair.surface - from < 8) continue;
      target = { i: nb, s: from + (pair.surface - from) * r.range(0.4, 0.8) };
    }
    const eq = equilibrium(tanks, V0);
    if (kind === 'predict' && shortIdx < 0 && eq.overflow > 0) continue;
    out.push({ kind, vessels, V0, pipes, target });
  }
  return out;
}

/** Pipe conductance for a pair, so small vessels don't slosh instantly and big ones don't take forever. */
export const conductance = (a: VesselSpec, b: VesselSpec) => K * Math.min((a.w0 + a.w1) / 2, (b.w0 + b.w1) / 2);

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: VesselsRound[] = [];
  let round = 0;
  let tanks: Tank[] = [];
  let V: number[] = [];
  let open: boolean[] = [];
  let spilled = 0;
  let simT = 0; // s of simulated flow
  let flowAt = 0; // performance.now() when the simulation clock started
  let running = false;
  let phase: 'act' | 'flow' | 'reveal' | 'done' = 'act';
  let pred = 30; // predicted surface height (u)
  let revealAt = 0;
  let dragging = false;
  let results: { err: number; signed: number; kind: VesselsRound['kind'] }[] = [];
  let finTimer = 0;
  let pouring = -1; // sandbox: vessel being filled
  const keys = new Set<string>();
  let lastK = 0;
  let fine = false;
  const sandbox = () => api.mode === 'sandbox';
  const controls = new Controls(stage, () => commit());

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 70;
    const F = Math.max(160, Math.min(W - 32, H - top - 74, 620));
    return { k: F / 100, F, cx: W / 2, cy: top + F / 2, ctrlY: top + F + 4 };
  };

  const pipesOf = (rd: VesselsRound) => rd.pipes.map((p, j) => ({ ...p, k: conductance(rd.vessels[p.a], rd.vessels[p.b]), open: open[j] }));

  /** Advance the flow simulation to wall-clock time t (ms). Deterministic: fixed steps only. */
  function advance(t: number) {
    if (!running) return;
    const rd = rounds[round];
    const target = (t - flowAt) / 1000;
    let steps = 0;
    while (simT + DT <= target && steps < 2400) {
      const res = flowStep(tanks, V, pipesOf(rd), DT);
      V = res.V;
      spilled += res.spilled;
      simT += DT;
      steps++;
    }
  }

  function setRound() {
    const rd = rounds[round];
    tanks = rd.vessels.map(tankOf);
    V = rd.V0.slice();
    open = rd.pipes.map(() => false);
    spilled = 0;
    simT = 0;
    running = false;
    phase = 'act';
    const ss = tanks.map((t, i) => surfaceOf(t, V[i]));
    pred = (Math.min(...ss) + Math.max(...ss)) / 2 + rng(round * 31 + 7).range(-8, 8);
    controls.set([]);
    controls.enabled = true;
    controls.lockLabel = sandbox() ? 'Reset' : rd.kind === 'predict' ? 'Open all' : 'Done';
    api.progress(sandbox() ? 'sandbox' : `${round + 1} / ${rounds.length}`);
    if (sandbox()) {
      running = true;
      flowAt = performance.now();
      api.prompt('Sandbox: tap a valve to open or close it · hold on a vessel to pour in.', 'Nothing is scored · Reset (Enter) restores the start');
      controls.touched = true;
    } else if (rd.kind === 'predict') {
      api.prompt('Where will the surface settle when the valves open?', 'Drag the dashed line (or ↑ ↓) · then Open all · heights level out, volumes don’t');
    } else {
      api.prompt(`Bring vessel ${'ABC'[rd.target!.i]} up to its mark, then press Done.`, 'Tap a valve to open / close it · Done closes every valve and measures');
      running = true;
      flowAt = performance.now();
      controls.touched = true;
    }
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    rounds = makeVessels(seed, api.level);
    round = 0;
    results = [];
    keys.clear();
    setRound();
    stage.request();
  }

  function commit() {
    const rd = rounds[round];
    if (sandbox()) {
      setRound();
      stage.request();
      return;
    }
    if (phase !== 'act') return;
    if (rd.kind === 'predict') {
      // Lock the prediction, open every valve and let it flow.
      open = open.map(() => true);
      phase = 'flow';
      running = true;
      simT = 0;
      flowAt = performance.now();
      controls.enabled = false;
      api.sfx.press();
      api.prompt('Flowing…', 'Your prediction is the dashed line');
    } else {
      advance(performance.now());
      open = open.map(() => false);
      running = false;
      settle();
    }
    stage.request();
  }

  function settle() {
    const rd = rounds[round];
    phase = 'reveal';
    revealAt = performance.now();
    controls.enabled = false;
    running = false;
    let err: number;
    let s: number;
    if (rd.kind === 'predict') {
      // Score against the exact equilibrium (the simulation converges to it; they agree to < 0.05 u).
      const eq = equilibrium(tanks, rd.V0);
      V = eq.volumes;
      spilled = eq.overflow;
      s = eq.surface;
      err = pred - s;
      const vols = eq.volumes.map((v) => Math.round(v)).join(' / ');
      api.prompt(
        `${signed(err, 1)} u. The surfaces settled at ${s.toFixed(1)} u${eq.overflow > 0 ? ' — the shortest vessel overflowed, so the level stopped at its rim' : ''}.`,
        `Same height, different volumes: ${vols} u²${eq.overflow > 0 ? ` · ${Math.round(eq.overflow)} u² spilled` : ''}${round < rounds.length - 1 ? ' · tap for the next' : ''}`,
      );
    } else {
      s = surfaceOf(tanks[rd.target!.i], V[rd.target!.i]);
      err = s - rd.target!.s;
      api.prompt(`${signed(err, 1)} u from the mark.`, `${err > 0 ? 'Closed too late' : err < 0 ? 'Closed too early' : 'Exact'} · total liquid conserved: ${Math.round(V.reduce((a, b) => a + b, 0) + spilled)} u²${round < rounds.length - 1 ? ' · tap for the next' : ''}`);
    }
    results.push({ err: Math.abs(err), signed: err, kind: rd.kind });
    api.judge(Math.abs(err));
    api.sfx.release();
    if (round === rounds.length - 1) finish();
  }

  function next() {
    if (phase !== 'reveal' || round >= rounds.length - 1) return;
    round++;
    setRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const mean = results.reduce((a, r) => a + r.err, 0) / results.length;
    const disp = mean.toFixed(1);
    const pr = results.filter((r) => r.kind === 'predict');
    const tg = results.filter((r) => r.kind === 'target');
    const rows: [string, string][] = results.map((r, i) => [`${i + 1} · ${r.kind === 'predict' ? 'predict the level' : 'reach the mark'}`, `${signed(r.signed, 1)} u`]);
    if (pr.length) rows.push(['Prediction error (mean)', (pr.reduce((a, r) => a + r.err, 0) / pr.length).toFixed(1) + ' u']);
    if (tg.length) rows.push(['Valve control error (mean)', (tg.reduce((a, r) => a + r.err, 0) / tg.length).toFixed(1) + ' u']);
    rows.push(['Rule', 'Connected free surfaces settle at one height; Σ volume is conserved (or spills at the lowest rim)']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'u',
          label: 'surface height error',
          headline: disp === '0.0' ? 'Every level exactly where physics put it.' : `Off by ${disp} u on average. Remember: the surfaces level out — the volumes don’t.`,
          rows,
          perfect: disp === '0.0',
          near: mean < 0.8,
          share: [`COMMUNICATING VESSELS · ${api.level} — predict where the surfaces settle`, `${disp} u`],
        }),
      api.motion() ? 700 : 0,
    );
  }

  // Valve hit areas and vessel areas, from the current layout.
  const valvePos = (rd: VesselsRound, j: number) => {
    const p = rd.pipes[j];
    const a = rd.vessels[p.a];
    const b = rd.vessels[p.b];
    return { x: (a.x + b.x) / 2, y: Math.min(a.floor, b.floor) };
  };

  const toggleValve = (j: number, ts: number) => {
    const rd = rounds[round];
    advance(ts); // everything up to this instant used the old valve state
    open[j] = !open[j];
    api.sfx.tick();
    stage.request();
    void rd;
  };

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'reveal') return next();
    const rd = rounds[round];
    const { k, cx, cy } = layout();
    const p = stage.pt(e);
    const u = { x: (p.x - cx) / k, y: 35 - (p.y - cy) / k }; // y up, datum at the field's lower part
    const canValve = phase === 'act' && (sandbox() || rd.kind === 'target');
    if (canValve) {
      for (let j = 0; j < rd.pipes.length; j++) {
        const vp = valvePos(rd, j);
        if (Math.hypot(u.x - vp.x, u.y - (vp.y - 6)) < 7) return toggleValve(j, e.timeStamp);
      }
    }
    if (sandbox()) {
      const i = rd.vessels.findIndex((v) => Math.abs(u.x - v.x) < widthAt(v, u.y - v.floor) / 2 + 3 && u.y > v.floor - 2);
      if (i >= 0) {
        capture(stage.canvas, e.pointerId);
        advance(e.timeStamp);
        pouring = i;
      }
      return;
    }
    if (phase === 'act' && rd.kind === 'predict') {
      capture(stage.canvas, e.pointerId);
      dragging = true;
      pred = clamp(u.y, 0, 75);
      controls.touched = true;
      stage.request();
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || !primary(e)) return;
    const { k, cy } = layout();
    pred = clamp(35 - (stage.pt(e).y - cy) / k, 0, 75);
    stage.request();
  };
  const onUp = () => {
    dragging = false;
    pouring = -1;
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e) || e.defaultPrevented) return;
      const rd = rounds[round];
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && phase === 'act' && rd?.kind === 'predict' && !sandbox()) {
        e.preventDefault();
        if (!keys.size) lastK = performance.now();
        keys.add(e.key);
        controls.touched = true;
        stage.request();
      } else if (/^[1-9]$/.test(e.key)) {
        // digits are the shell's level keys; valves use letters instead
      } else if ((e.key === 'q' || e.key === 'w') && phase === 'act' && (sandbox() || rd?.kind === 'target')) {
        const j = e.key === 'q' ? 0 : 1;
        if (j < rd.pipes.length) toggleValve(j, e.timeStamp);
      } else if ((e.key === 'Enter' || e.code === 'Space') && phase === 'reveal' && !e.repeat) {
        e.preventDefault();
        next();
      }
    }),
    listen('keyup', (e) => {
      fine = e.shiftKey;
      keys.delete(e.key);
    }),
    listen('blur', () => keys.clear()),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const { k, cx, cy, ctrlY } = layout();
    const X = (u: number) => cx + u * k;
    const Y = (u: number) => cy + (35 - u) * k; // u measured up from the datum
    let more = false;
    if (keys.size && phase === 'act') {
      const dt = Math.min(0.05, (now - lastK) / 1000);
      lastK = now;
      pred = clamp(pred + ((keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)) * (fine ? 3 : 18) * sensitivity() * dt, 0, 75);
      more = true;
    }
    if (running) {
      if (pouring >= 0) {
        // Sandbox top-up: a steady inflow, applied in the same fixed steps.
        const before = simT;
        advance(now);
        V[pouring] += 40 * (simT - before);
        const cap = tanks[pouring].tab.total;
        if (V[pouring] > cap) {
          spilled += V[pouring] - cap;
          V[pouring] = cap;
        }
      } else advance(now);
      more = true;
      if (phase === 'flow') {
        // Stop when the flow has converged on the exact equilibrium (every vessel within 0.3% of its
        // capacity), or after 12 s of simulated time. A raised vessel may drain below its own floor, so
        // comparing surfaces alone would never converge.
        const eq = equilibrium(tanks, rounds[round].V0);
        if (tanks.every((t, i) => Math.abs(V[i] - eq.volumes[i]) < 0.003 * t.tab.total) || simT > 12) settle();
      }
    }

    // Floor (a bench) and pipes
    slot(c, X(-50), Y(0) + 9, X(50), Y(0) + 9, 5);
    rd.pipes.forEach((p, j) => {
      const a = rd.vessels[p.a];
      const b = rd.vessels[p.b];
      const y = Math.min(a.floor, b.floor);
      // A pipe: an outer tube, an inner channel, and liquid in it while it is open.
      const route = () => {
        c.beginPath();
        c.moveTo(X(a.x), Y(a.floor) + 4);
        c.lineTo(X(a.x), Y(y) + 4);
        c.lineTo(X(b.x), Y(y) + 4);
        c.lineTo(X(b.x), Y(b.floor) + 4);
      };
      c.save();
      c.lineJoin = 'round';
      c.lineCap = 'round';
      route();
      c.strokeStyle = pal.ink2;
      c.lineWidth = 7;
      c.stroke();
      route();
      c.strokeStyle = pal.paper2;
      c.lineWidth = 3.5;
      c.stroke();
      if (open[j]) {
        route();
        c.strokeStyle = pal.liquidDeep;
        c.lineWidth = 3.5;
        c.stroke();
        if (running && api.motion()) {
          // Flow: dashes moving from the higher surface towards the lower one.
          const sa = a.floor + levelFor(tanks[p.a].tab, V[p.a]);
          const sb = b.floor + levelFor(tanks[p.b].tab, V[p.b]);
          if (Math.abs(sa - sb) > 0.05) {
            route();
            c.setLineDash([3, 7]);
            c.lineDashOffset = ((sa > sb ? -1 : 1) * now) / 25;
            c.strokeStyle = pal.glass;
            c.lineWidth = 1.5;
            c.stroke();
            c.setLineDash([]);
          }
        }
      }
      c.restore();
      const vp = valvePos(rd, j);
      const vx = X(vp.x);
      const vy = Y(vp.y) + 4;
      softShadow(c, vx, vy + 9, 11, 3, 1.2);
      c.fillStyle = pal.paper;
      c.beginPath();
      c.arc(vx, vy, 9, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = pal.ink;
      c.lineWidth = 2;
      c.stroke();
      // Handle: along the pipe = open, across = closed (shape, not colour).
      if (open[j]) line(c, vx - 7, vy, vx + 7, vy, pal.ink, 3);
      else line(c, vx, vy - 7, vx, vy + 7, pal.ink, 3);
      text(c, `${open[j] ? 'OPEN' : 'SHUT'}${phase === 'act' && (sandbox() || rd.kind === 'target') ? ` · ${'QW'[j]}` : ''}`, vx, vy + 22, font.mono(9, 500), open[j] ? pal.ink : pal.ink3, 'center');
    });

    // Vessels with liquid
    rd.vessels.forEach((v, i) => {
      const t = tanks[i];
      const lv = levelFor(t.tab, V[i]);
      const N = 50;
      const edge = (y: number, side: number) => X(v.x + (side * widthAt(v, y)) / 2);
      softShadow(c, X(v.x), Y(v.floor) + 6, (widthAt(v, 0) / 2 + 3) * k, 4);
      if (lv > 0.01) {
        liquidBody(
          c,
          (cc) => {
            for (let s = 0; s <= N; s++) {
              const y = (lv * s) / N;
              if (s) cc.lineTo(edge(y, -1), Y(v.floor + y));
              else cc.moveTo(edge(y, -1), Y(v.floor + y));
            }
            for (let s = N; s >= 0; s--) cc.lineTo(edge((lv * s) / N, 1), Y(v.floor + (lv * s) / N));
          },
          Y(v.floor + lv),
          Y(v.floor),
        );
        liquidSurface(c, edge(lv, -1), edge(lv, 1), Y(v.floor + lv));
      }
      for (const side of [-1, 1]) glassWall(c, Array.from({ length: N + 1 }, (_, s) => ({ x: edge((v.H * s) / N, side), y: Y(v.floor + (v.H * s) / N) })), -side);
      line(c, edge(0, -1), Y(v.floor), edge(0, 1), Y(v.floor), pal.ink, 2.5);
      // The vessel's name on a small badge.
      rr(c, X(v.x) - 10, Y(v.floor + v.H) - 26, 20, 18, 9);
      c.fillStyle = pal.paper2;
      c.fill();
      text(c, 'ABC'[i], X(v.x), Y(v.floor + v.H) - 17, font.mono(11, 600), pal.ink, 'center', 'middle');
      if (sandbox()) text(c, `${Math.round(V[i])} u²`, X(v.x), Y(v.floor) + 34, font.mono(9), pal.ink3, 'center');
    });

    if (rd.target && !sandbox()) {
      const v = rd.vessels[rd.target.i];
      const w = widthAt(v, rd.target.s - v.floor) / 2 + 5;
      line(c, X(v.x - w), Y(rd.target.s), X(v.x + w), Y(rd.target.s), pal.ink, 2, [5, 3]);
      tag(c, 'mark', X(v.x + w) + 18, Y(rd.target.s), pal.ink, 10);
    }
    if (rd.kind === 'predict' && !sandbox()) {
      line(c, X(-50), Y(pred), X(50), Y(pred), phase === 'act' ? pal.ink : pal.ink2, 1.5, [7, 4]);
      if (phase === 'act') tag(c, 'your prediction', X(-48), Y(pred) - 10, pal.ink, 10, 'left');
      if (phase === 'reveal' || phase === 'done') {
        const p = api.motion() ? easeOut((now - revealAt) / 500) : 1;
        if (p < 1) more = true;
        const eq = equilibrium(tanks, rd.V0);
        c.globalAlpha = p;
        line(c, X(-50), Y(eq.surface), X(50), Y(eq.surface), pal.signal, 1.5);
        tag(c, `settled ${eq.surface.toFixed(1)} u`, X(48), Y(eq.surface) - 10, pal.signal, 10, 'right');
        c.globalAlpha = 1;
      }
    }
    if (phase === 'act') controls.draw(c, cx - 90, ctrlY - 8, 180);
    else if (phase === 'reveal' && round < rounds.length - 1) text(c, 'tap for the next ▸', cx, ctrlY + 22, font.mono(11, 500), pal.ink2, 'center');
    if (!sandbox()) {
      const sy = stage.h - 10;
      for (let i = 0; i < rounds.length; i++) text(c, i < results.length ? results[i].err.toFixed(1) : i === round ? '•' : '·', stage.w / 2 + (i - (rounds.length - 1) / 2) * 52, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    }
    return more || phase === 'flow';
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
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
