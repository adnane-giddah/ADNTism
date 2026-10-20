// 06 · BALANCE — inference. Hidden masses on the left. Slide your weight, drop it, read the tilt. Three drops.
import { bracket, clamp, easeOut, font, hair, hatch, line, pal, tag, text } from '../core/draw';
import { signed } from '../core/format';
import { capture, gameKey, listen, primary } from '../core/input';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';
import { BALANCE_MAX_X, BALANCE_MIN_X, balanceError, balancePoint } from '../core/scoring';
import { alpha, glow, plate, rr, softShadow } from '../core/materials';

const TMAX = 14; // degrees

export interface Mystery {
  d: number; // distance left of pivot (u)
  m: number; // mass relative to yours
  size: number; // drawn size — deliberately unrelated to mass
}

/**
 * Deterministic layout of hidden blocks. Guarantees BALANCE_MIN_X < x* < BALANCE_MAX_X, so the
 * balance point is always reachable (your arm reaches 100 u) and the relative score never divides by ~0.
 */
export function makeBalance(seed: number, lv: Level): { mysteries: Mystery[]; xStar: number } {
  const r = rng(seed);
  for (let tries = 0; tries < 5000; tries++) {
    const n = lv === 'easy' ? 1 : lv === 'hard' ? (r.next() < 0.5 ? 2 : 3) : r.next() < 0.55 ? 1 : 2;
    const mysteries = Array.from({ length: n }, () => ({ d: r.range(14, 94), m: r.range(0.25, n === 3 ? 1.1 : 1.9), size: r.range(15, 30) }));
    const ds = mysteries.map((q) => q.d).sort((a, b) => a - b);
    if (ds.some((d, i) => i > 0 && d - ds[i - 1] < 18)) continue;
    const xStar = balancePoint(mysteries);
    if (xStar > BALANCE_MIN_X && xStar < BALANCE_MAX_X) return { mysteries, xStar };
  }
  // Fallback (never observed in tests, but guaranteed valid): one block, x* = 50.
  const mysteries = [{ d: 40, m: 1.25, size: 22 }];
  return { mysteries, xStar: balancePoint(mysteries) };
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let mysteries: Mystery[] = [];
  let xStar = 50;
  let x = 50;
  let drops: { x: number; tilt: number }[] = [];
  let phase: 'place' | 'drag' | 'falling' | 'read' | 'done' = 'place';
  let dropAt = 0;
  let theta = 0; // current visual tilt (deg)
  let thetaFrom = 0;
  let thetaEq = 0;
  let finTimer = 0;
  const keys = new Set<string>();
  let fine = false;
  let landedFor = -1;
  let lastT = 0;
  let dragOff = 0;

  let DROPS = 3;
  let TS = 22; // torque scale for the tilt response (unknown to the player, learnable)
  let blindTilt = false; // Hard: no number, only the beam's angle
  const fmtTilt = (v: number) => (blindTilt ? '?' : signed(v, 2) + '°');
  const tiltFor = (xx: number) => TMAX * Math.tanh((xx - xStar) / TS);

  function reset(seed: number) {
    clearTimeout(finTimer);
    const lv = api.level;
    DROPS = lv === 'easy' ? 4 : lv === 'hard' ? 2 : 3;
    // Easy: almost linear. Hard: saturates early, so a far-off drop just slams to the stop.
    TS = lv === 'easy' ? 40 : lv === 'hard' ? 8 : 22;
    blindTilt = lv === 'hard';
    ({ mysteries, xStar } = makeBalance(seed, lv));
    x = 50;
    drops = [];
    phase = 'place';
    theta = 0;
    thetaEq = 0;
    thetaFrom = 0;
    dropAt = 0;
    keys.clear();
    api.progress(`drop 1 / ${DROPS}`);
    api.prompt(
      lv === 'hard'
        ? 'Two drops. No numbers — only the beam.'
        : api.firstTime
          ? 'Slide your weight along the right arm. Let go to drop it.'
          : 'Slide. Drop.',
      lv === 'hard' ? 'Several hidden blocks · the beam hits its stops early' : 'The blocks on the left have unknown weights — sizes lie',
    );
    stage.request();
  }

  function drop() {
    if (phase !== 'place' && phase !== 'drag') return;
    phase = 'falling';
    dropAt = performance.now();
    thetaFrom = 0;
    thetaEq = tiltFor(x);
    drops.push({ x, tilt: thetaEq });
    api.sfx.thud();
    api.buzz(14);
    api.progress(`drop ${drops.length} / ${DROPS}`);
    api.prompt('');
    stage.request();
  }

  function settled() {
    const last = drops[drops.length - 1];
    if (drops.length >= DROPS) {
      phase = 'done';
      const err = balanceError(last.x, xStar);
      const disp = err.toFixed(1);
      api.prompt('');
      finTimer = window.setTimeout(
        () =>
          api.finish({
            score: err,
            value: disp,
            unit: '%',
            label: 'residual imbalance',
            headline:
              disp === '0.0'
                ? 'Level. You weighed the invisible.'
                : `Final drop ${Math.abs(last.x - xStar).toFixed(1)} u ${last.x > xStar ? 'too far out' : 'too close in'} — the beam settled at ${signed(last.tilt, 1)}°. Block sizes were random: size never told you the weight.`,
            rows: [
              ...drops.map((d, i) => [`Drop ${i + 1} at ${d.x.toFixed(1)} u`, `${signed(d.tilt, 2)}°`] as [string, string]),
              ['Balance point', xStar.toFixed(1) + ' u'],
              ...mysteries.map((q, i) => [`Hidden block ${mysteries.length > 1 ? i + 1 : ''} weighed`.replace('  ', ' '), `×${q.m.toFixed(2)}`] as [string, string]),
            ],
            accuracy: 1 - err / 100,
            perfect: disp === '0.0',
            near: err < 0.5,
            share: [`BALANCE · ${api.level} — weigh the unknown in ${DROPS} drops`, `${disp}% off level`],
          }),
        api.motion() ? 500 : 0,
      );
    } else {
      phase = 'read';
      const dir = last.tilt > 0.02 ? 'Your side went down — too far out.' : last.tilt < -0.02 ? 'Their side went down — move out.' : 'Level.';
      api.prompt(blindTilt ? dir : `${signed(last.tilt, 2)}°. ${dir}`, `Drag to adjust · ${DROPS - drops.length} ${DROPS - drops.length === 1 ? 'drop' : 'drops'} left`);
    }
  }

  function lift() {
    // back to placing: beam re-levels on its supports, weight lifts at the same position
    phase = 'place';
    thetaFrom = theta;
    thetaEq = 0;
    dropAt = performance.now();
  }

  const geom = () => {
    const W = stage.w;
    const H = stage.h;
    const half = Math.min(W * 0.44, 560);
    return { cx: W / 2, cy: Math.max(170, H * 0.52), half, k: half / 100 };
  };

  const onDown = (e: PointerEvent) => {
    if (!primary(e) || phase === 'falling' || phase === 'done') return;
    if (phase === 'read') lift();
    capture(stage.canvas, e.pointerId);
    phase = 'drag';
    const { cx, k } = geom();
    const px = (stage.pt(e).x - cx) / k;
    // grab relative if pressing near the weight; jump otherwise
    dragOff = Math.abs(px - x) < 10 ? x - px : 0;
    x = clamp(px + dragOff, 2, 100);
    api.sfx.soft();
    stage.request();
  };
  const onMove = (e: PointerEvent) => {
    if (phase !== 'drag' || !primary(e)) return;
    const { cx, k } = geom();
    x = clamp((stage.pt(e).x - cx) / k + dragOff, 2, 100);
    stage.request();
  };
  const onUp = (e: PointerEvent) => {
    if (phase !== 'drag' || !primary(e)) return;
    drop();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  stage.canvas.addEventListener('pointermove', onMove);
  stage.canvas.addEventListener('pointerup', onUp);
  const onCancel = (e: PointerEvent) => {
    if (phase !== 'drag' || !primary(e)) return;
    phase = 'place';
    stage.request();
  };
  stage.canvas.addEventListener('pointercancel', onCancel);
  const offs = [
    listen('keydown', (e) => {
      fine = e.shiftKey;
      if (!gameKey(e) || phase === 'falling' || phase === 'done') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (phase === 'read') lift();
        keys.add(e.key);
        lastT = performance.now();
        stage.request();
      } else if ((e.key === 'Enter' || e.code === 'Space') && !e.repeat) {
        e.preventDefault();
        if (phase === 'read') {
          lift();
          stage.request();
        } else drop();
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
    const { cx, cy, half, k } = geom();
    let more = false;
    const motion = api.motion();

    if (keys.size && (phase === 'place' || phase === 'drag')) {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const sp = fine ? 3 : 24;
      if (keys.has('ArrowRight')) x = clamp(x + sp * dt, 2, 100);
      if (keys.has('ArrowLeft')) x = clamp(x - sp * dt, 2, 100);
      more = true;
    }

    // Beam dynamics: under-damped settle toward thetaEq.
    const t = (now - dropAt) / 1000;
    const fallT = 0.16;
    {
      const tt = phase === 'falling' || phase === 'read' || phase === 'done' ? t - fallT : t;
      if (tt <= 0) theta = thetaFrom;
      else if (!motion) theta = thetaEq;
      else {
        const a = 3.4;
        const b = 9.5;
        const resp = 1 - Math.exp(-a * tt) * (Math.cos(b * tt) + (a / b) * Math.sin(b * tt));
        theta = thetaFrom + (thetaEq - thetaFrom) * resp;
      }
      const settledNow = !motion || tt > 1.6;
      if (phase === 'falling' && settledNow) {
        theta = thetaEq;
        settled();
      } else if (!settledNow) more = true;
    }

    const rad = (theta * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const P = (u: number, h = 0) => ({ x: cx + u * k * cos - h * sin, y: cy + u * k * sin + h * cos });

    // Ground, fulcrum, supports
    hair(c, cx - half - 30, cy + 64, cx + half + 30, cy + 64, pal.line);
    softShadow(c, cx, cy + 64, 40, 6, 1.4);
    c.beginPath();
    c.moveTo(cx, cy + 3);
    c.lineTo(cx - 22, cy + 64);
    c.lineTo(cx + 22, cy + 64);
    c.closePath();
    c.fillStyle = pal.ink;
    c.fill();
    {
      // Light from the left: a bright edge and a shaded right flank.
      const fg = c.createLinearGradient(cx - 22, 0, cx + 22, 0);
      fg.addColorStop(0, 'rgba(255,255,255,0.14)');
      fg.addColorStop(1, 'rgba(0,0,0,0.22)');
      c.fillStyle = fg;
      c.fill();
      line(c, cx, cy + 4, cx - 21, cy + 63, pal.glass, 1);
    }
    const supports = phase === 'place' || phase === 'drag';
    for (const sx of [-1, 1]) {
      const bx = cx + sx * half * 0.92;
      rr(c, bx - 4, cy + (supports ? 6 : 30), 8, supports ? 58 : 34, 3);
      c.fillStyle = supports ? pal.ink3 : pal.line;
      c.fill();
    }
    // Plumb line: level reference
    hair(c, cx, cy - 120, cx, cy - 92, pal.ink3, [2, 3]);

    // Beam
    const a0 = P(-100);
    const a1 = P(100);
    c.lineCap = 'round';
    line(c, a0.x, a0.y, a1.x, a1.y, pal.ink, 6);
    c.lineCap = 'butt';
    // A highlight along the beam's top edge.
    {
      const h0 = P(-99, -2);
      const h1 = P(99, -2);
      line(c, h0.x, h0.y, h1.x, h1.y, pal.glass, 1);
    }
    for (let u = -100; u <= 100; u += 10) {
      if (u === 0) continue;
      const p0 = P(u, -3);
      const p1 = P(u, u % 50 === 0 ? -11 : -7);
      line(c, p0.x, p0.y, p1.x, p1.y, pal.ink3, 1);
    }
    for (const u of [-100, -50, 50, 100]) {
      const p = P(u, 18);
      text(c, String(Math.abs(u)), p.x, p.y, font.mono(10), pal.ink3, 'center', 'middle');
    }

    // Mystery blocks
    const reveal = phase === 'done';
    for (const q of mysteries) {
      const base = P(-q.d, -2.5);
      c.save();
      c.translate(base.x, base.y);
      c.rotate(rad);
      softShadow(c, 0, 0, q.size * 0.62, q.size * 0.12, 1.2);
      rr(c, -q.size / 2, -q.size, q.size, q.size, 3);
      c.fillStyle = pal.paper;
      c.fill();
      c.fillStyle = hatch(c, pal.ink, 4);
      c.fill();
      c.strokeStyle = pal.ink;
      c.lineWidth = 1.5;
      c.stroke();
      c.restore();
      if (reveal) tag(c, `×${q.m.toFixed(2)}`, base.x, base.y - q.size - 14, pal.ink, 11);
      else tag(c, '?', base.x, base.y - q.size - 14, pal.ink3, 11);
    }

    // Earlier drops: ghost marks with their tilt
    drops.slice(0, phase === 'done' || phase === 'read' || phase === 'falling' ? -1 : undefined).forEach((d, i) => {
      const p = P(d.x, -3);
      const q = P(d.x, -30);
      line(c, p.x, p.y, q.x, q.y, pal.ink3, 1, [2, 2]);
      text(c, `${i + 1}`, q.x, q.y - 6, font.mono(10, 500), pal.ink3, 'center');
    });

    // Your weight
    const S = 24;
    let wy: number;
    const placing = phase === 'place' || phase === 'drag';
    if (placing) {
      const lift = motion ? easeOut((now - dropAt) / 250) : 1;
      if (lift < 1) more = true;
      wy = -2.5 - 34 * lift;
    } else {
      const f = motion ? clamp(t / fallT, 0, 1) : 1;
      wy = -2.5 - 34 * (1 - f * f);
    }
    const wp = P(x, wy);
    // Touchdown: a puff of dust both ways along the beam, once per drop.
    if (!placing && t >= fallT && landedFor !== drops.length) {
      landedFor = drops.length;
      api.fx.spray(wp.x - 12, wp.y, Math.PI + rad, 0.35, alpha(pal.ink, 0.7), 7, 120, 1.4, 60);
      api.fx.spray(wp.x + 12, wp.y, rad, 0.35, alpha(pal.ink, 0.7), 7, 120, 1.4, 60);
      api.fx.shake(1.5, 0.12);
    }
    if (phase === 'drag') glow(c, wp.x, wp.y - S / 2, 48, pal.accent, 0.8);
    if (placing) {
      // Its shadow on the beam, sharper as it gets closer.
      const g0 = P(x, -3);
      softShadow(c, g0.x, g0.y, S * 0.7, S * 0.14, 1.2);
    }
    c.save();
    c.translate(wp.x, wp.y);
    c.rotate(placing ? 0 : rad);
    rr(c, -S / 2, -S, S, S, 4);
    c.fillStyle = pal.ink;
    c.fill();
    {
      const wg = c.createLinearGradient(0, -S, 0, 0);
      wg.addColorStop(0, 'rgba(255,255,255,0.16)');
      wg.addColorStop(1, 'rgba(0,0,0,0.2)');
      c.fillStyle = wg;
      c.fill();
    }
    c.fillStyle = pal.paper;
    c.font = font.mono(10, 600);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('×1', 0, -S / 2);
    c.restore();
    if (placing) {
      const g = P(x, -3);
      hair(c, wp.x, wp.y, g.x, g.y, pal.ink3, [2, 3]);
      tag(c, `${x.toFixed(1)} u`, wp.x, wp.y - S - 16, pal.ink, 11);
    }

    // Tilt readout
    const shown = phase === 'falling' || phase === 'read' || phase === 'done';
    plate(c, cx - 70, cy - 169, 140, 48, 14);
    text(c, 'TILT', cx, cy - 152, font.mono(10, 500), pal.ink3, 'center');
    text(c, shown && (!blindTilt || phase === 'done') ? `${signed(theta, 2)}°` : shown ? '?' : '—', cx, cy - 126, font.mono(26, 400), shown && Math.abs(theta) > 0.05 ? pal.signal : shown ? pal.accent : pal.ink, 'center');

    // Final: ideal position ghost + bracket
    if (reveal) {
      const ip = P(xStar, -2.5);
      c.save();
      c.translate(ip.x, ip.y);
      c.rotate(rad);
      c.setLineDash([3, 3]);
      c.strokeStyle = pal.accent;
      c.lineWidth = 1.5;
      c.strokeRect(-S / 2, -S, S, S);
      c.setLineDash([]);
      c.restore();
      const b0 = P(xStar, 34);
      const b1 = P(x, 34);
      if (Math.abs(b0.x - b1.x) > 2) bracket(c, b0.x, b0.y, b1.x, b1.y, pal.signal, 4, 1.5);
      tag(c, `balance at ${xStar.toFixed(1)} u`, b0.x, b0.y + 18, pal.accent, 10);
    }

    // Lab notebook
    const nx = 16;
    let ny = Math.max(80, cy - 210);
    if (drops.length && stage.w > 560) {
      plate(c, nx - 10, ny - 18, 236, 28 + drops.length * 18, 12);
      text(c, 'DROP   POSITION   TILT', nx, ny, font.mono(10, 500), pal.ink3, 'left');
      drops.forEach((d, i) => {
        if (i === drops.length - 1 && phase === 'falling') return;
        ny += 18;
        text(c, `${i + 1}      ${d.x.toFixed(1).padStart(5)} u   ${phase === 'done' ? signed(d.tilt, 2) + '°' : fmtTilt(d.tilt)}`, nx, ny, font.mono(11), pal.ink, 'left');
      });
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
