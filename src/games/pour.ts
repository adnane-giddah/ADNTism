// 16 · POUR — fill a strangely shaped tank to exactly a fraction of its volume.
// The tank is flat (uniform depth), so volume is area: V(h) = ∫₀ʰ w(y) dy. Hold to pour, release to stop.
// Half the volume is almost never half the height — the walls decide.
// The fluids are real-ish: the valve takes a moment to open fully (the flow ramps up), the stream needs time to
// fall, and the nozzle drips after it closes — so what is in the air when you let go still lands. Mercury is
// sluggish to start and drips the longest; xenon is nearly instant. Everything that lands is a pure function of
// your press and release timestamps, never of the drawing or the frame rate.
import { Controls } from '../core/controls';
import { alpha, glassWall, glow, reticle, rr, slot, softShadow } from '../core/materials';
import { clamp, easeOut, font, hair, hatch, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { rng } from '../core/rng';
import { fillError, levelFor, pourTable, volumeAt } from '../core/scoring';
import type { GameFactory, Level } from '../core/types';

const ROUNDS = 3;
/** Tank height in field units. */
export const TANK_H = 70;

export type ShapeKind = 'cone' | 'funnel' | 'bulb' | 'hourglass' | 'flask';
export type Fluid = 'xenon' | 'water' | 'mercury';

export interface FluidSpec {
  name: string;
  /** Valve opening time constant (s): the flow ramps up as 1 − e^(−t/ramp). */
  ramp: number;
  /** Nozzle drip time constant (s) after the valve closes. */
  drip: number;
  visc: string;
  angle: string;
  /** −1 concave, 0 flat, +1 convex meniscus. */
  menisc: number;
  top: string;
  deep: string;
}

export const FLUIDS: Record<Fluid, FluidSpec> = {
  xenon: { name: 'Liquid xenon', ramp: 0.03, drip: 0.04, visc: '0.052 mPa·s', angle: '14.2° concave', menisc: -1, top: '#48f8e6', deep: '#005b53' },
  water: { name: 'Heavy water · D₂O', ramp: 0.12, drip: 0.12, visc: '1.248 mPa·s', angle: '0.0° flat', menisc: 0, top: '#8fd3ff', deep: '#123f73' },
  mercury: { name: 'Mercury', ramp: 0.32, drip: 0.26, visc: '1.526 mPa·s', angle: '137.5° convex', menisc: 1, top: '#f2f3f7', deep: '#4b4f5a' },
};
/** Seconds a drop takes from the nozzle to the surface. */
export const FALL = 0.14;

/** Volume the nozzle has let out d s after the valve opened (the flow ramps up with time constant τ). */
export const emitted = (Q: number, tau: number, d: number) => (d <= 0 ? 0 : Q * (d - tau * (1 - Math.exp(-d / tau))));
/** Flow rate d s after the valve opened. */
export const rateAt = (Q: number, tau: number, d: number) => (d <= 0 ? 0 : Q * (1 - Math.exp(-d / tau)));
/** Volume of one pour that has landed t s after its valve opened; `open` = s the valve stayed open (null: still open). */
export function landed(Q: number, fl: FluidSpec, open: number | null, t: number) {
  const e = t - FALL;
  if (e <= 0) return 0;
  if (open == null || e <= open) return emitted(Q, fl.ramp, e);
  return emitted(Q, fl.ramp, open) + rateAt(Q, fl.ramp, open) * fl.drip * (1 - Math.exp(-(e - open) / fl.drip));
}
/** Everything one pour will eventually deliver: the stream still in the air and the drip land too. */
export const finalOf = (Q: number, fl: FluidSpec, open: number) => emitted(Q, fl.ramp, open) + rateAt(Q, fl.ramp, open) * fl.drip;

export interface PourRound {
  kind: ShapeKind;
  /** Narrow and wide widths (u). */
  wn: number;
  wb: number;
  /** Lean of the tank (u of horizontal shift from bottom to top). Shear: area is unchanged. */
  lean: number;
  /** Target fraction of capacity. */
  f: number;
  /** Seconds a perfect continuous pour (at full flow) takes. Sets the flow rate. */
  T: number;
  /** Pours allowed (Infinity = top up as often as you like). */
  pours: number;
  fluid: Fluid;
}

const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Width (u) at height y (u from the bottom). */
export function widthAt(rd: PourRound, y: number) {
  const u = clamp(y / TANK_H, 0, 1);
  const { wn, wb } = rd;
  switch (rd.kind) {
    case 'cone':
      return wn + (wb - wn) * u;
    case 'funnel':
      return wb + (wn - wb) * u;
    case 'bulb':
      return wn + (wb - wn) * Math.sin(Math.PI * u);
    case 'hourglass':
      return wb - (wb - wn) * Math.sin(Math.PI * u);
    case 'flask':
      return wb + (wn - wb) * smooth((u - 0.45) / 0.25);
  }
}
export const centerAt = (rd: PourRound, y: number) => rd.lean * (clamp(y / TANK_H, 0, 1) - 0.5);

const SHAPE_NAME: Record<ShapeKind, string> = { cone: 'Inverse cone', funnel: 'Funnel', bulb: 'Spherical bulb', hourglass: 'Hyperbolic hourglass', flask: 'Erlenmeyer flask' };

const FRACS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
export const fracLabel = (f: number) => {
  const known: [number, string][] = [
    [1 / 4, '¼'],
    [1 / 3, '⅓'],
    [1 / 2, '½'],
    [2 / 3, '⅔'],
    [3 / 4, '¾'],
  ];
  const k = known.find(([v]) => Math.abs(v - f) < 1e-9);
  return k ? k[1] : `${Math.round(f * 100)}%`;
};

export function makePour(seed: number, level: Level): PourRound[] {
  const r = rng(seed);
  const kinds: ShapeKind[] = level === 'easy' ? ['cone', 'funnel'] : ['cone', 'funnel', 'bulb', 'hourglass', 'flask'];
  // Medium meets all three fluids once each; Hard is the sluggish ones.
  const order: Fluid[] = ['xenon', 'water', 'mercury'];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return Array.from({ length: ROUNDS }, (_, i) => {
    const kind = r.pick(kinds);
    const wn = level === 'easy' ? r.range(16, 22) : r.range(12, 20);
    const wb = level === 'easy' ? wn * r.range(2.2, 3) : r.range(52, 68);
    return {
      kind,
      wn,
      wb,
      lean: level === 'hard' ? r.sign() * r.range(8, 16) : 0,
      f: level === 'easy' ? 0.5 : level === 'medium' ? r.pick(FRACS) : Math.round(r.range(0.22, 0.82) * 100) / 100,
      T: r.range(2.8, 4.4),
      pours: level === 'easy' ? Infinity : level === 'medium' ? 3 : 1,
      fluid: level === 'easy' ? 'xenon' : level === 'medium' ? order[i] : r.pick<Fluid>(['water', 'mercury']),
    };
  });
}

interface Pour {
  start: number;
  end: number | null;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: PourRound[] = [];
  let round = 0;
  let tab = pourTable(() => 1, TANK_H);
  let Q = 1; // u²/s at full flow
  let pours: Pour[] = [];
  let phase: 'fill' | 'settle' | 'reveal' | 'done' = 'fill';
  let revealAt = 0;
  let overflow = false;
  let finals: { V: number; err: number; signed: number; overflow: boolean; fluid: Fluid }[] = [];
  let finTimer = 0;
  let settleTimer = 0;
  let keyDown = false;
  const controls = new Controls(stage, () => done());
  const rd = () => rounds[round];
  const fl = () => FLUIDS[rd().fluid];
  const pouring = () => pours.length > 0 && pours[pours.length - 1].end == null;
  const openOf = (p: Pour) => (p.end == null ? null : (p.end - p.start) / 1000);

  /** Volume landed in the tank at time t (ms, event clock). */
  const landedAt = (t: number) => Math.min(tab.total, pours.reduce((a, p) => a + landed(Q, fl(), openOf(p), (t - p.start) / 1000), 0));
  /** Volume that will have landed once everything settles (pours still open count up to t). */
  const finalAt = (t: number) => Math.min(tab.total, pours.reduce((a, p) => a + finalOf(Q, fl(), ((p.end ?? t) - p.start) / 1000), 0));
  /** Milliseconds after the last valve closes until the surface is still. */
  const settleMs = () => (FALL + 5 * fl().drip) * 1000;

  const layout = () => {
    const W = stage.w;
    const H = stage.h;
    const top = 92;
    const ctrlH = 74;
    const F = Math.max(150, Math.min(W - 32, H - top - ctrlH - 24, 600));
    return { k: F / 100, F, cx: W / 2, cy: top + F / 2, ctrlY: top + F + 4, cw: Math.min(W - 32, 360) };
  };

  function setRound() {
    const r = rd();
    tab = pourTable((y) => widthAt(r, y), TANK_H);
    Q = (r.f * tab.total) / r.T;
    pours = [];
    overflow = false;
    phase = 'fill';
    clearTimeout(settleTimer);
    controls.set([]);
    controls.enabled = r.pours > 1;
    controls.lockLabel = 'Done';
    api.progress(`${round + 1} / ${ROUNDS}`);
    const f = FLUIDS[r.fluid];
    const n = r.pours === Infinity ? 'top up as often as you like' : r.pours === 1 ? 'one pour only' : `${r.pours} pours`;
    const feel = r.fluid === 'mercury' ? 'Mercury: slow to start, drips long after — cut early' : r.fluid === 'water' ? 'D₂O: a little lag, a little drip' : 'Xenon: almost instant';
    api.prompt(`Fill it to exactly ${fracLabel(r.f)} of its volume.`, `${f.name} · ${feel} · ${n}`);
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    clearTimeout(settleTimer);
    rounds = makePour(seed, api.level);
    round = 0;
    finals = [];
    keyDown = false;
    setRound();
    stage.request();
  }

  function startPour(ts: number) {
    if (phase !== 'fill' || pouring() || pours.length >= rd().pours) return;
    if (finalAt(ts) >= tab.total - 1e-9) return;
    pours.push({ start: ts, end: null });
    controls.touched = true;
    api.sfx.press();
    api.prompt('');
    stage.request();
  }

  function stopPour(ts: number) {
    if (!pouring()) return;
    const p = pours[pours.length - 1];
    p.end = Math.max(p.start, ts);
    api.sfx.release();
    if (finalAt(ts) >= tab.total - 1e-9) overflow = true;
    const r = rd();
    if (overflow || pours.length >= r.pours) settleThenJudge();
    else {
      const left = r.pours - pours.length;
      api.prompt(`Target: ${fracLabel(r.f)} of the volume.`, `${r.pours === Infinity ? 'Top up' : `${left} pour${left > 1 ? 's' : ''} left`} · or Done`);
    }
    stage.request();
  }

  /** The valve is shut for good: let the stream in the air and the drip land, then judge. */
  function settleThenJudge() {
    if (phase !== 'fill') return;
    phase = 'settle';
    controls.enabled = false;
    api.prompt('Afterflow — what is already falling still lands.', '');
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(judge, api.motion() ? settleMs() : 0);
  }

  function done() {
    if (phase !== 'fill') return;
    if (pouring()) stopPour(performance.now());
    if (!pours.length || phase !== 'fill') return;
    settleThenJudge();
  }

  function judge() {
    if (phase !== 'settle') return;
    const r = rd();
    const V = finalAt(Infinity);
    if (V >= tab.total - 1e-9) overflow = true;
    const err = fillError(V, tab.total, r.f);
    {
      const { k, cx, cy } = layout();
      const h = levelFor(tab, V);
      api.judge(err, { x: cx + centerAt(r, h) * k, y: cy + (TANK_H / 2 - h) * k - 40 });
    }
    finals.push({ V, err, signed: (V / tab.total - r.f) * 100, overflow, fluid: r.fluid });
    phase = 'reveal';
    revealAt = performance.now();
    api.buzz(10);
    const hTrue = levelFor(tab, r.f * tab.total);
    const hNaive = r.f * TANK_H;
    const trap = Math.abs(hTrue - hNaive) > 3 ? ` (${fracLabel(r.f)} of the volume sits at ${Math.round((hTrue / TANK_H) * 100)}% of the height)` : '';
    const lastOpen = openOf(pours[pours.length - 1]) ?? 0;
    const after = rateAt(Q, fl().ramp, lastOpen) * (fl().drip + 0) + (emitted(Q, fl().ramp, lastOpen) - emitted(Q, fl().ramp, Math.max(0, lastOpen - FALL)));
    const afterPct = (after / tab.total) * 100;
    api.prompt(
      overflow ? 'Overflow — the tank was full.' : `${signed((V / tab.total - r.f) * 100, 1)} points of capacity${trap}.`,
      `${afterPct >= 0.3 ? `${afterPct.toFixed(1)} points landed after you let go · ` : ''}${round < ROUNDS - 1 ? 'Tap / Enter for the next tank' : ''}`,
    );
    if (round === ROUNDS - 1) finish();
    stage.request();
  }

  function next() {
    if (phase !== 'reveal' || round >= ROUNDS - 1) return;
    round++;
    setRound();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const mean = finals.reduce((a, f) => a + f.err, 0) / finals.length;
    const disp = mean.toFixed(1);
    const rows: [string, string][] = finals.map((f, i) => {
      const r = rounds[i];
      return [
        `${i + 1} · ${SHAPE_NAME[r.kind].toLowerCase()}, ${FLUIDS[r.fluid].name.toLowerCase()}, target ${fracLabel(r.f)}`,
        f.overflow ? 'overflowed' : `${((f.V / pourTable((y) => widthAt(r, y), TANK_H).total) * 100).toFixed(1)}% of capacity (${signed(f.signed, 1)} pts)`,
      ];
    });
    const bias = finals.reduce((a, f) => a + f.signed, 0) / finals.length;
    rows.push(['Bias', `${signed(bias, 1)} pts — ${Math.abs(bias) < 1 ? 'centred' : bias > 0 ? 'you overfill (the afterflow?)' : 'you underfill'}`]);
    rows.push(['Metric', '|your volume ÷ capacity − target| in percentage points; the tank is flat, so volume = area']);
    rows.push(['Physics', 'valve ramp, fall time and nozzle drip per fluid — everything in the air when you let go still lands']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: '%',
          label: 'fill error (points of capacity)',
          headline: disp === '0.0' ? 'Three tanks, filled to the drop.' : `Off by ${disp} points of capacity on average${Math.abs(bias) >= 1 ? ` — you tend to ${bias > 0 ? 'overfill' : 'underfill'}` : ''}.`,
          rows,
          accuracy: 1 - mean / 100,
          perfect: disp === '0.0',
          near: mean < 0.8,
          share: [`POUR · ${api.level} — fill a strange tank to an exact volume`, `${disp} points off`],
        }),
      api.motion() ? 700 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'reveal') return next();
    capture(stage.canvas, e.pointerId);
    startPour(e.timeStamp);
  };
  const onUp = (e: PointerEvent) => {
    if (primary(e)) stopPour(e.timeStamp);
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointerup', onUp);
  stage.canvas.addEventListener('pointercancel', onUp);
  const onVis = () => {
    keyDown = false;
    if (document.hidden && (pouring() || phase === 'settle')) {
      clearTimeout(settleTimer);
      api.voidRun('Attempt voided — the tab was hidden mid-pour.');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.defaultPrevented) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat || keyDown) return;
        keyDown = true;
        if (phase === 'reveal') next();
        else startPour(e.timeStamp);
      } else if (e.key === 'Enter' && !e.repeat && phase === 'reveal') {
        e.preventDefault();
        next();
      }
    }),
    listen('keyup', (e) => {
      if (e.code !== 'Space') return;
      keyDown = false;
      stopPour(e.timeStamp);
    }),
    listen('blur', () => {
      keyDown = false;
      stopPour(performance.now());
    }),
  ];

  stage.draw = (now) => {
    const c = stage.ctx;
    const r = rd();
    if (!r) return false;
    const f = fl();
    const { k, F, cx, cy, ctrlY, cw } = layout();
    const X = (u: number) => cx + u * k;
    const Yb = (y: number) => cy + (TANK_H / 2 - y) * k; // y up from the tank's bottom
    const motion = api.motion();
    const open = pouring();
    // The tank can only hold so much: an open valve shuts itself when what it has let out fills it.
    if (open && finalAt(now) >= tab.total - 1e-9) {
      overflow = true;
      stopPour(now);
    }
    const lastEnd = pours.length ? (pours[pours.length - 1].end ?? now) : -1e9;
    const settling = !open && pours.length > 0 && now - lastEnd < settleMs();
    const v = phase === 'reveal' || phase === 'done' ? (motion ? landedAt(now) : finalAt(Infinity)) : landedAt(now);
    const h = levelFor(tab, v);
    let more = open || settling || phase === 'settle';

    const N = 90;
    const edge = (y: number, side: number) => X(centerAt(r, y) + (side * widthAt(r, y)) / 2);
    const trace = (y0: number, y1: number) => {
      c.beginPath();
      for (let i = 0; i <= N; i++) {
        const y = y0 + ((y1 - y0) * i) / N;
        if (i) c.lineTo(edge(y, -1), Yb(y));
        else c.moveTo(edge(y, -1), Yb(y));
      }
      for (let i = N; i >= 0; i--) {
        const y = y0 + ((y1 - y0) * i) / N;
        c.lineTo(edge(y, 1), Yb(y));
      }
      c.closePath();
    };

    // Ambient glow of the fluid behind the vessel, and its contact shadow on the bench.
    glow(c, cx, cy + F * 0.12, F * 0.62, f.top, 0.22);
    softShadow(c, X(centerAt(r, 0)), Yb(0) + 5, (widthAt(r, 0) / 2 + 8) * k, 7, 1.2);

    // The glass: a smoked interior, so the empty part of the vessel reads as glass, not as a drawing.
    trace(0, TANK_H);
    c.fillStyle = 'rgba(28,27,29,0.45)';
    c.fill();

    // Height graduations etched on the left wall — heights, deliberately: they are what deceives you.
    c.save();
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const y = TANK_H * p;
      const x0 = edge(y, -1) + 6;
      hair(c, x0, Yb(y), x0 + (p === 0.5 ? 18 : 12), Yb(y), alpha(pal.ink, 0.32));
      text(c, `${Math.round(p * 100)}% H`, x0 + (p === 0.5 ? 22 : 16), Yb(y) + 3, font.mono(9, 500), alpha(pal.ink, 0.32), 'left');
    }
    c.restore();

    // Liquid: a gradient body, bubbles rising, and a surface that ripples where the stream lands.
    const tx = X(centerAt(r, TANK_H));
    const nozzleY = Yb(TANK_H + 9);
    const stir = !motion ? 0 : open ? 1 : clamp(1 - (now - lastEnd) / 1600, 0, 1);
    if (stir > 0) more = true;
    const land = h > 0 ? clamp(tx, edge(h, -1) + 3, edge(h, 1) - 3) : tx;
    const wave = (x: number) => stir * 1.8 * Math.sin(Math.abs(x - land) * 0.12 - now / 85) * (0.35 + 0.65 * Math.exp(-Math.abs(x - land) / 70));
    if (h > 0.05) {
      c.save();
      c.beginPath();
      for (let i = 0; i <= N; i++) {
        const y = (h * i) / N;
        if (i) c.lineTo(edge(y, -1), Yb(y));
        else c.moveTo(edge(y, -1), Yb(y));
      }
      const M = 40;
      for (let i = 0; i <= M; i++) {
        const x = edge(h, -1) + ((edge(h, 1) - edge(h, -1)) * i) / M;
        c.lineTo(x, Yb(h) + wave(x));
      }
      for (let i = N; i >= 0; i--) c.lineTo(edge((h * i) / N, 1), Yb((h * i) / N));
      c.closePath();
      const lg = c.createLinearGradient(0, Yb(h), 0, Yb(0));
      lg.addColorStop(0, alpha(f.top, 0.82));
      lg.addColorStop(1, alpha(f.deep, 0.92));
      c.fillStyle = lg;
      c.fill();
      c.clip();
      if (r.fluid === 'mercury') {
        // Metal: a bright vertical sheen band, sliding a little as the surface moves.
        const sx = X(centerAt(r, h / 2)) - widthAt(r, h / 2) * k * 0.25 + (motion ? Math.sin(now / 900) * 6 : 0);
        const sg = c.createLinearGradient(sx - 30, 0, sx + 30, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)');
        sg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = sg;
        c.fillRect(sx - 30, Yb(h) - 10, 60, Yb(0) - Yb(h) + 10);
      } else if (motion) {
        // Bubbles rising through the liquid.
        for (let i = 0; i < 14; i++) {
          const life = (now / (1800 + (i % 5) * 260) + i * 0.137) % 1;
          const y = h * life * 0.98;
          const wy = widthAt(r, y);
          const bx = X(centerAt(r, y) + Math.sin(i * 2.17 + now / 760) * wy * 0.32);
          c.globalAlpha = (0.15 + 0.35 * (1 - life)) * (open || settling ? 1 : 0.5);
          c.beginPath();
          c.arc(bx, Yb(y), 1.2 + (i % 3) * 0.9, 0, Math.PI * 2);
          c.strokeStyle = '#ffffff';
          c.lineWidth = 1;
          c.stroke();
        }
        c.globalAlpha = 1;
        more = true;
      }
      c.restore();
      // The meniscus: a lit ellipse across the surface — dipped for xenon, flat for D₂O, domed for mercury.
      const ml = edge(h, -1);
      const mr = edge(h, 1);
      const my = Yb(h);
      const ry = Math.min(7, (mr - ml) * 0.06) * (f.menisc === 0 ? 0.5 : 1);
      c.save();
      c.shadowColor = alpha(f.top, 0.8);
      c.shadowBlur = 12;
      const mg = c.createLinearGradient(ml, 0, mr, 0);
      mg.addColorStop(0, 'rgba(255,255,255,0.75)');
      mg.addColorStop(0.5, alpha(f.top, 0.95));
      mg.addColorStop(1, 'rgba(255,255,255,0.75)');
      c.strokeStyle = mg;
      c.lineWidth = 2;
      c.beginPath();
      const bulge = f.menisc === 1 ? -1 : 1; // convex rises in the middle, concave dips
      const MS = 40;
      for (let i = 0; i <= MS; i++) {
        const t = i / MS;
        const x = ml + (mr - ml) * t;
        const y = my + wave(x) + (f.menisc === 0 ? 0 : bulge * ry * Math.sin(Math.PI * t) * 0.6) - (f.menisc === -1 ? ry * 0.6 * (1 - Math.sin(Math.PI * t)) : 0);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.stroke();
      c.restore();
      // Height pin on the right wall (height only — the volume is yours to judge).
      if (phase === 'fill' || phase === 'settle') {
        const px = mr + 10;
        c.fillStyle = f.top;
        c.beginPath();
        c.moveTo(px, my);
        c.lineTo(px + 7, my - 4);
        c.lineTo(px + 7, my + 4);
        c.closePath();
        c.fill();
        text(c, `h ${((h / TANK_H) * 100).toFixed(1)}%`, px + 12, my + 3.5, font.mono(10, 600), f.top, 'left');
      }
    }

    // Glass walls with a refraction sheen (brighter on the lit left side), and the base.
    for (const side of [-1, 1]) {
      const pts = Array.from({ length: N + 1 }, (_, i) => {
        const y = (TANK_H * i) / N;
        return { x: edge(y, side), y: Yb(y) };
      });
      glassWall(c, pts, -side);
      c.save();
      c.strokeStyle = alpha(pal.ink, side < 0 ? 0.22 : 0.1);
      c.lineWidth = 3;
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x - side * 4, p.y) : c.moveTo(p.x - side * 4, p.y)));
      c.stroke();
      c.restore();
    }
    line(c, edge(0, -1), Yb(0), edge(0, 1), Yb(0), pal.ink, 2.5);
    line(c, edge(TANK_H, -1) - 3, Yb(TANK_H), edge(TANK_H, -1) + 3, Yb(TANK_H), pal.ink, 2);
    line(c, edge(TANK_H, 1) - 3, Yb(TANK_H), edge(TANK_H, 1) + 3, Yb(TANK_H), pal.ink, 2);

    // The dispenser: a housing, a spout and a valve lamp.
    c.save();
    rr(c, tx - 26, nozzleY - 30, 52, 16, 3);
    c.fillStyle = pal.paper2;
    c.fill();
    c.strokeStyle = pal.line;
    c.lineWidth = 1;
    c.stroke();
    rr(c, tx - 12, nozzleY - 23, 24, 3, 1.5);
    c.fillStyle = pal.line;
    c.fill();
    rr(c, tx - 9, nozzleY - 14, 18, 14, 2);
    c.fillStyle = pal.paper2;
    c.fill();
    c.stroke();
    c.restore();
    glow(c, tx + 34, nozzleY - 22, 12, open ? f.top : pal.ink3, open ? 0.9 : 0.3);
    c.beginPath();
    c.arc(tx + 34, nozzleY - 22, 3, 0, Math.PI * 2);
    c.fillStyle = open ? f.top : pal.ink3;
    c.fill();

    // The stream. Its thickness follows the flow (it swells as the valve opens), and after the valve closes
    // its tail is still falling — you can watch the afterflow land.
    const surfY = Yb(h);
    const fallPx = surfY - nozzleY;
    if (pours.length && fallPx > 0) {
      const p = pours[pours.length - 1];
      const tOpen = (now - p.start) / 1000;
      const openS = openOf(p);
      // Head of the falling column (how far the first drop has got) and its tail (the last drop to leave).
      const head = clamp(tOpen / FALL, 0, 1);
      const tail = openS == null ? 0 : clamp((tOpen - openS) / FALL, 0, 1);
      const q = rateAt(Q, f.ramp, openS == null ? tOpen : openS) / Q;
      if (head > tail && tail < 1) {
        const y0 = nozzleY + fallPx * tail;
        const y1 = nozzleY + fallPx * head;
        const w0 = 0.6 + 2.6 * q;
        c.save();
        c.shadowColor = alpha(f.top, 0.9);
        c.shadowBlur = 12;
        const sg = c.createLinearGradient(0, y0, 0, y1);
        sg.addColorStop(0, alpha(f.top, 0.95));
        sg.addColorStop(1, alpha(f.top, 0.75));
        c.fillStyle = sg;
        c.beginPath();
        const wob = (yy: number) => (motion ? Math.sin(now / 45 + yy * 0.05) * 0.6 * ((yy - nozzleY) / Math.max(1, fallPx)) : 0);
        c.moveTo(tx - w0 + wob(y0), y0);
        c.lineTo(tx + w0 + wob(y0), y0);
        c.lineTo(tx + w0 * 0.7 + wob(y1), y1);
        c.lineTo(tx - w0 * 0.7 + wob(y1), y1);
        c.closePath();
        c.fill();
        c.restore();
        more = true;
        // Splash where it lands.
        if (head >= 1 && h > 0 && Math.random() < 0.5 + q * 0.4) api.fx.spray(tx, surfY - 1, -Math.PI / 2, 1.1, f.top, 1, 90 + 50 * q, 1.3, 520);
      }
      // The nozzle drips after it closes.
      if (openS != null && motion) {
        const since = tOpen - openS;
        const dripLeft = Math.exp(-since / f.drip);
        if (dripLeft > 0.04) {
          for (let i = 0; i < 3; i++) {
            const ph = ((since * 6 + i / 3) % 1) * fallPx;
            c.globalAlpha = dripLeft;
            c.beginPath();
            c.arc(tx, nozzleY + ph, 1.8, 0, Math.PI * 2);
            c.fillStyle = f.top;
            c.fill();
          }
          c.globalAlpha = 1;
          more = true;
        }
      }
    }

    // Reveal: the true target level, the "same fraction of the height" trap, the hatched difference,
    // and the volume curve V(h) that explains it.
    if (phase === 'reveal' || phase === 'done') {
      const p = motion ? easeOut((now - revealAt) / 500) : 1;
      if (p < 1) more = true;
      c.globalAlpha = p;
      const hT = levelFor(tab, r.f * tab.total);
      const hN = r.f * TANK_H;
      glow(c, (edge(hT, -1) + edge(hT, 1)) / 2, Yb(hT), 60, pal.accent, 0.35);
      line(c, edge(hT, -1) - 14, Yb(hT), edge(hT, 1) + 14, Yb(hT), pal.accent, 1.75, [5, 4]);
      for (const sd of [-1, 1]) {
        const bx = sd < 0 ? edge(hT, -1) - 22 : edge(hT, 1) + 22;
        line(c, bx, Yb(hT) - 6, bx + sd * 8, Yb(hT), pal.accent, 1.5);
        line(c, bx, Yb(hT) + 6, bx + sd * 8, Yb(hT), pal.accent, 1.5);
      }
      tag(c, `TARGET ${fracLabel(r.f)} V`, edge(hT, 1) + 34, Yb(hT), pal.accent, 10, 'left');
      if (Math.abs(hN - hT) > 2) {
        line(c, edge(hN, -1) - 12, Yb(hN), edge(hN, 1) + 12, Yb(hN), pal.ink3, 1, [1, 3]);
        tag(c, `${fracLabel(r.f)} of the height`, edge(hN, -1) - 14, Yb(hN), pal.ink3, 10, 'right');
      }
      const hF = levelFor(tab, finalAt(Infinity));
      if (Math.abs(hF - hT) * k > 1.5) {
        trace(Math.min(hF, hT), Math.max(hF, hT));
        c.fillStyle = hatch(c, pal.signal, 5);
        c.fill();
      }
      // Volume calculus: the fraction of volume against the fraction of height.
      const gw = Math.min(250, (stage.w - F) / 2 - 30);
      if (gw > 150) {
        const gx = stage.w - gw - 28;
        const gy = cy - 40;
        const gh = 110;
        rr(c, gx - 14, gy - 34, gw + 28, gh + 62, 4);
        c.fillStyle = alpha(pal.paper2, 0.9);
        c.fill();
        c.strokeStyle = pal.line2;
        c.stroke();
        reticle(c, gx - 9, gy - 29, gw + 18, gh + 52, 7, alpha(pal.accent, 0.45));
        text(c, 'VOLUME CALCULUS: ∫ w(h) dh', gx, gy - 16, font.mono(9, 600), pal.ink3, 'left');
        text(c, 'NON-LINEAR', gx + gw, gy - 16, font.mono(9, 600), pal.accent, 'right');
        const GX = (u: number) => gx + u * gw;
        const GY = (u: number) => gy + gh - u * gh;
        hair(c, gx, gy + gh, gx + gw, gy + gh, pal.line);
        hair(c, gx, gy, gx, gy + gh, pal.line);
        c.beginPath();
        for (let i = 0; i <= 60; i++) {
          const hh = (TANK_H * i) / 60;
          const vv = volumeAt(tab, hh) / tab.total;
          if (i) c.lineTo(GX(i / 60), GY(vv));
          else c.moveTo(GX(0), GY(vv));
        }
        c.strokeStyle = pal.ink2;
        c.lineWidth = 1.5;
        c.stroke();
        hair(c, GX(hT / TANK_H), gy, GX(hT / TANK_H), gy + gh, alpha(pal.accent, 0.6), [2, 2]);
        glow(c, GX(hT / TANK_H), GY(r.f), 14, pal.accent, 0.8);
        c.beginPath();
        c.arc(GX(hT / TANK_H), GY(r.f), 3.5, 0, Math.PI * 2);
        c.fillStyle = pal.accent;
        c.fill();
        const vf = Math.min(1, finalAt(Infinity) / tab.total);
        c.beginPath();
        c.arc(GX(hF / TANK_H), GY(vf), 3.5, 0, Math.PI * 2);
        c.fillStyle = pal.signal;
        c.fill();
        text(c, 'h = 0', gx, gy + gh + 14, font.mono(9), pal.ink3, 'left');
        text(c, 'h = H', gx + gw, gy + gh + 14, font.mono(9), pal.ink3, 'right');
        text(c, `${fracLabel(r.f)} V = ${Math.round((hT / TANK_H) * 100)}% H`, gx + gw / 2, gy + gh + 14, font.mono(9, 600), pal.accent, 'center');
      }
      c.globalAlpha = 1;
    }

    // The fluid card (top left): what is in the dispenser and how it behaves.
    {
      const bx = 18;
      const by = 18;
      const bw = 230;
      rr(c, bx, by, bw, 92, 4);
      c.fillStyle = alpha(pal.paper2, 0.85);
      c.fill();
      c.strokeStyle = pal.line2;
      c.lineWidth = 1;
      c.stroke();
      c.beginPath();
      c.arc(bx + 14, by + 16, 3, 0, Math.PI * 2);
      c.fillStyle = f.top;
      c.fill();
      text(c, 'FLUID MEDIUM', bx + 24, by + 19, font.mono(9, 600), pal.ink3, 'left');
      text(c, f.name, bx + 12, by + 42, font.serif(17, true), pal.ink, 'left');
      const meter = (y: number, label: string, v: number, val: string) => {
        text(c, label, bx + 12, y, font.mono(9, 500), pal.ink3, 'left');
        rr(c, bx + 78, y - 6, 80, 5, 2.5);
        c.fillStyle = pal.line2;
        c.fill();
        rr(c, bx + 78, y - 6, 80 * v, 5, 2.5);
        c.fillStyle = f.top;
        c.fill();
        text(c, val, bx + bw - 12, y, font.mono(9, 500), pal.ink2, 'right');
      };
      meter(by + 62, 'VALVE LAG', clamp(f.ramp / 0.35, 0.08, 1), `${Math.round(f.ramp * 1000)} ms`);
      meter(by + 78, 'AFTER-DRIP', clamp((f.drip + FALL) / 0.42, 0.08, 1), `${Math.round((f.drip + FALL) * 1000)} ms`);
      text(c, `${SHAPE_NAME[r.kind].toUpperCase()}`, stage.w - 18, 30, font.mono(10, 600), pal.ink2, 'right');
      text(c, `MENISCUS ${f.angle.toUpperCase()}`, stage.w - 18, 46, font.mono(9, 500), pal.ink3, 'right');
    }

    // Status line, pours left, the bench.
    slot(c, X(centerAt(r, 0)) - (widthAt(r, 0) / 2 + 14) * k, Yb(0) + 6, X(centerAt(r, 0)) + (widthAt(r, 0) / 2 + 14) * k, Yb(0) + 6, 5);
    const status = open
      ? 'DISPENSING · VALVE OPEN'
      : phase === 'settle' || settling
        ? 'AFTERFLOW · STREAM IN TRANSIT'
        : phase === 'fill'
          ? pours.length
            ? 'SETTLED · VALVE SEALED'
            : 'STANDBY · FLUID VALVE SEALED'
          : overflow
            ? 'OVERFLOW'
            : 'MENISCUS SETTLED · MEASURED';
    text(c, status, cx, Yb(0) + 30, font.mono(10, 600), open ? f.top : phase === 'settle' || settling ? '#FFB834' : pal.ink3, 'center');
    if (phase === 'fill') {
      const finite = r.pours !== Infinity;
      const left = finite ? Math.max(0, r.pours - pours.length) : Infinity;
      text(c, 'POURS LEFT', cx - cw / 2, ctrlY + 22, font.mono(10, 500), pal.ink3, 'left');
      if (finite) {
        for (let i = 0; i < r.pours; i++) {
          const dx = cx - cw / 2 + 84 + i * 16;
          const dy = ctrlY + 18;
          c.beginPath();
          c.moveTo(dx, dy - 7);
          c.bezierCurveTo(dx + 6, dy, dx + 5, dy + 5, dx, dy + 5);
          c.bezierCurveTo(dx - 5, dy + 5, dx - 6, dy, dx, dy - 7);
          c.closePath();
          if (i < left) {
            c.fillStyle = f.top;
            c.fill();
          } else {
            c.strokeStyle = pal.ink3;
            c.lineWidth = 1;
            c.stroke();
          }
        }
      } else text(c, '∞', cx - cw / 2 + 84, ctrlY + 22, font.mono(12, 500), pal.ink2, 'left');
      if (r.pours > 1) controls.draw(c, cx - cw / 2, ctrlY - 6, cw);
    } else if (phase !== 'settle') text(c, round < ROUNDS - 1 ? 'tap for the next tank ▸' : '', cx, ctrlY + 24, font.mono(11, 500), pal.ink2, 'center');
    // Round strip
    const sy = stage.h - 12;
    for (let i = 0; i < ROUNDS; i++) text(c, i < finals.length ? finals[i].err.toFixed(1) : i === round ? '•' : '·', stage.w / 2 + (i - 1) * 56, sy, font.mono(11, 500), i <= round ? pal.ink : pal.ink3, 'center');
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      clearTimeout(settleTimer);
      controls.destroy();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
      stage.canvas.removeEventListener('pointerup', onUp);
      stage.canvas.removeEventListener('pointercancel', onUp);
    },
  };
};

export default factory;
