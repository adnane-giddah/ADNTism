// Headless lifecycle check for games 41–52: open each game against a recording 2-D context, play it with a
// long stream of taps, drags and keys while time advances, and require that it draws without throwing,
// reaches its result exactly once with a valid score, restarts cleanly, and stops reacting after destroy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rng } from '../src/core/rng';
import type { GameAPI, GameFactory, Level, Result } from '../src/core/types';
import { byId } from '../src/games/registry';

/** A 2-D context that accepts every call: methods return harmless values. */
function fakeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => {} };
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: String(s).length * 7 }),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    createPattern: () => ({}),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const IDS = ['fovea', 'alias', 'lag', 'fold', 'lastlook', 'checksum', 'descent', 'projection', 'jnd', 'regime', 'bifurcation', 'counterpoint'];
const KEYS = ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '1', '2', '3', '4', '0', 'a', 'b', 'r', 'd', 'i', 'm', 'u', 'x', 'f', 'j', 'Backspace'];

beforeEach(() => {
  vi.useFakeTimers();
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as never;
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

async function play(id: string, level: Level, seed: number, steps: number) {
  const meta = byId(id)!;
  const factory: GameFactory = (await meta.load()).default;
  const host = document.createElement('div');
  document.body.append(host);
  const canvas = document.createElement('canvas');
  host.append(canvas);
  const results: Result[] = [];
  let prompts = 0;
  const stage = {
    canvas,
    ctx: fakeCtx(),
    w: 1200,
    h: 760,
    dpr: 1,
    k: 1,
    shakeX: 0,
    shakeY: 0,
    draw: (_t: number) => false as boolean | void,
    onResize: () => {},
    request: () => {},
    start: () => {},
    fit: () => {},
    pt: (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY }),
    destroy: () => {},
  };
  const noop = () => {};
  const sfx = new Proxy({}, { get: () => noop });
  const api: GameAPI = {
    stage: stage as never,
    fx: new Proxy({}, { get: () => noop }) as never,
    seed,
    level,
    mode: 'default',
    daily: false,
    practice: false,
    setInput: noop,
    firstTime: seed % 2 === 0,
    motion: () => false,
    prompt: () => void prompts++,
    progress: noop,
    finish: (r) => results.push(r),
    sfx: sfx as never,
    buzz: noop,
    voidRun: noop,
    judge: () => 'good',
    ownKeys: noop,
  };
  const handle = factory(api);
  handle.reset(seed);
  const r = rng(seed);
  let now = 1000;
  const ptr = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse', button: 0, bubbles: true }));
  for (let i = 0; i < steps && !results.length; i++) {
    now += 16 + r.int(0, 40);
    stage.draw(now);
    const roll = r.next();
    if (roll < 0.45) {
      const x = r.range(0, stage.w);
      const y = r.range(60, stage.h);
      ptr('pointerdown', x, y);
      if (r.next() < 0.3) ptr('pointermove', x + r.range(-60, 60), y + r.range(-30, 30));
      ptr('pointerup', x, y);
    } else if (roll < 0.85) {
      const key = r.pick(KEYS);
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true }));
      if (r.next() < 0.5) window.dispatchEvent(new KeyboardEvent('keyup', { key, code: key === ' ' ? 'Space' : key, bubbles: true }));
    } else {
      // Let real-time rounds run and pending transitions fire.
      for (let k = 0; k < 20; k++) {
        now += 50;
        stage.draw(now);
      }
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(30);
  }
  vi.advanceTimersByTime(2000);
  // A restart produces a clean new run.
  handle.reset(seed + 1);
  stage.draw(now + 100);
  handle.destroy();
  const before = prompts;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ptr('pointerdown', 600, 400);
  vi.advanceTimersByTime(3000);
  host.remove();
  return { results, quietAfterDestroy: prompts === before };
}

describe('every new game opens, plays to a single result, restarts and cleans up', () => {
  for (const id of IDS)
    it(id, async () => {
      let finished = 0;
      for (const [level, seed] of [
        ['easy', 2],
        ['medium', 7],
        ['hard', 12],
      ] as [Level, number][]) {
        const { results, quietAfterDestroy } = await play(id, level, seed, 9000);
        expect(results.length, `${id} ${level}: finish called ${results.length}×`).toBeLessThanOrEqual(1);
        for (const res of results) {
          expect(Number.isFinite(res.score) && res.score >= 0, `${id} score`).toBe(true);
          expect(res.rows.length).toBeGreaterThan(0);
        }
        finished += results.length;
        expect(quietAfterDestroy, `${id} reacts after destroy`).toBe(true);
      }
      // Random play reaches the result screen on at least one level.
      expect(finished, `${id} never finished under random play`).toBeGreaterThan(0);
    }, 120000);
});
