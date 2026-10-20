// 23 · LETTERFALL — keys fall toward a line; press each as it crosses.
// Lanes are physical keys; their labels follow the layout you pick (QWERTY, AZERTY, QWERTZ, Dvorak,
// detected, or your own mapping) and are always shown. Timing uses input-event timestamps (≈1 ms resolution
// in browsers, plus a constant display delay — so the mean signed error, your bias, is reported separately).
// Score: mean |timing error| per note; a missed note counts as the full window (150 ms).
import { clamp, font, line, pal, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { detectLayout, isDetected, LAYOUT_NAMES, LAYOUT_ORDER, loadKeymap, resolveLanes, saveKeymap, type LayoutId } from '../core/keymap';
import { alpha, bar, glow, neon, plate, ripple, rr, softShadow } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

export const WINDOW = 150; // ms, either side
const LEAD: Record<string, number> = { slow: 2300, normal: 1600, fast: 1100 };

export interface Note {
  t: number; // ms from the start of the song
  lane: number;
}

export function makeLetterfall(seed: number, level: Level) {
  const r = rng(seed);
  const lanes = level === 'easy' ? 4 : level === 'medium' ? 6 : 8;
  const count = level === 'easy' ? 24 : level === 'medium' ? 36 : 48;
  const bpm = level === 'easy' ? r.range(90, 104) : level === 'medium' ? r.range(100, 116) : r.range(108, 124);
  const eighth = 60000 / bpm / 2;
  const notes: Note[] = [];
  const lastIn = new Array(lanes).fill(-1e9);
  let step = 0;
  while (notes.length < count) {
    step += level === 'easy' ? r.pick([2, 2, 4]) : r.pick([1, 2, 2, 3]);
    const t = step * eighth;
    const chord = level === 'hard' && r.next() < 0.25 && notes.length < count - 1;
    const want = chord ? 2 : 1;
    const used: number[] = [];
    for (let k = 0; k < 30 && used.length < want; k++) {
      const lane = r.int(0, lanes - 1);
      // Same lane at least 320 ms apart, so the ±150 ms windows never overlap within a lane.
      if (used.includes(lane) || t - lastIn[lane] < 320) continue;
      used.push(lane);
    }
    for (const lane of used) {
      notes.push({ t, lane });
      lastIn[lane] = t;
    }
  }
  return { lanes, notes, bpm };
}

export interface Judged {
  hits: { note: number; err: number }[];
  misses: number[];
  strays: number;
}

/**
 * Judge presses against notes. Each press takes the closest not-yet-hit note in its lane within the window;
 * a press with none is a stray (reported, not scored). Unhit notes are misses.
 */
export function judge(notes: Note[], presses: { t: number; lane: number }[], win = WINDOW): Judged {
  const hit = new Map<number, number>();
  let strays = 0;
  for (const p of [...presses].sort((a, b) => a.t - b.t)) {
    let best = -1;
    let bd = Infinity;
    notes.forEach((n, i) => {
      if (n.lane !== p.lane || hit.has(i)) return;
      const d = Math.abs(p.t - n.t);
      if (d <= win && d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) hit.set(best, p.t - notes[best].t);
    else strays++;
  }
  return {
    hits: [...hit.entries()].map(([note, err]) => ({ note, err })),
    misses: notes.map((_, i) => i).filter((i) => !hit.has(i)),
    strays,
  };
}

export function letterfallScore(notes: Note[], j: Judged, win = WINDOW) {
  const total = j.hits.reduce((a, h) => a + Math.abs(h.err), 0) + j.misses.length * win;
  return total / notes.length;
}

const factory: GameFactory = (api) => {
  const { stage } = api;
  let song = makeLetterfall(1, 'medium');
  let lanes: { code: string; label: string }[] = [];
  let km = loadKeymap();
  let phase: 'ready' | 'remap' | 'play' | 'paused' | 'done' = 'ready';
  let start = 0; // performance.now() of song time 0
  let pausedAt = 0;
  let presses: { t: number; lane: number }[] = [];
  let live: Judged = { hits: [], misses: [], strays: 0 };
  let flashes: { lane: number; at: number; err: number | null }[] = [];
  /** Notes already announced as missed (judged OFF once, which breaks the streak). */
  let missed = new Set<number>();
  let remapIdx = 0;
  let remapList: { code: string; label: string }[] = [];
  let finTimer = 0;
  let endTimer = 0;
  const down = new Set<string>();
  const lead = () => LEAD[api.mode] ?? LEAD.normal;

  const geom = () => {
    const W = stage.w;
    const H = stage.h;
    const n = lanes.length || 4;
    const laneW = Math.min(108, (W - 40) / n);
    const L = W / 2 - (laneW * n) / 2;
    return { laneW, L, top: 76, lineY: H - 110, n };
  };

  function refreshLanes() {
    lanes = resolveLanes(song.lanes, km);
  }

  function readyPrompt() {
    const name = km.layout === 'auto' ? (isDetected() ? 'Auto (detected)' : 'Auto → QWERTY (detection unavailable)') : LAYOUT_NAMES[km.layout];
    api.progress('');
    api.prompt(`Layout: ${name}. Press each key as its letter crosses the line.`, '← → change layout · ↓ remap keys · Space or tap to start · Space pauses');
  }

  function reset(seed: number) {
    clearTimeout(finTimer);
    clearTimeout(endTimer);
    song = makeLetterfall(seed, api.level);
    api.ownKeys(false);
    presses = [];
    live = { hits: [], misses: [], strays: 0 };
    flashes = [];
    missed = new Set();
    down.clear();
    phase = 'ready';
    refreshLanes();
    readyPrompt();
    void detectLayout().then(() => {
      refreshLanes();
      if (phase === 'ready') readyPrompt();
      stage.request();
    });
    stage.request();
  }

  function begin() {
    phase = 'play';
    start = performance.now() + lead() + 600;
    api.ownKeys(true);
    api.prompt('');
    scheduleEnd();
    stage.request();
  }

  function scheduleEnd() {
    clearTimeout(endTimer);
    const last = song.notes[song.notes.length - 1].t;
    endTimer = window.setTimeout(() => phase === 'play' && finish(), Math.max(0, start + last + WINDOW + 400 - performance.now()));
  }

  function pause(ts: number) {
    if (phase === 'play') {
      phase = 'paused';
      pausedAt = ts;
      clearTimeout(endTimer);
      api.prompt('Paused.', 'Space to resume — the song continues after a one-second lead-in');
    } else if (phase === 'paused') {
      // Shift the whole schedule by the pause, plus a 1 s lead-in: deterministic, nothing is lost.
      start += ts - pausedAt + 1000;
      phase = 'play';
      api.prompt('');
      scheduleEnd();
    }
    stage.request();
  }

  function press(lane: number, ts: number) {
    if (phase !== 'play') return;
    const t = ts - start;
    presses.push({ t, lane });
    live = judge(song.notes, presses);
    const h = live.hits.find((x) => Math.abs(song.notes[x.note].t + x.err - t) < 0.001 && song.notes[x.note].lane === lane);
    flashes.push({ lane, at: performance.now(), err: h ? h.err : null });
    if (h) {
      const g = geom();
      api.judge(Math.abs(h.err), { x: g.L + lane * g.laneW + g.laneW / 2, y: g.lineY - 70 });
    }
    if (flashes.length > 24) flashes.shift();
    api.sfx.tick();
    stage.request();
  }

  function finish() {
    phase = 'done';
    clearTimeout(endTimer);
    const j = judge(song.notes, presses);
    const score = letterfallScore(song.notes, j);
    api.ownKeys(false);
    const disp = String(Math.round(score));
    const errs = j.hits.map((h) => h.err);
    const bias = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
    const tight = errs.filter((e) => Math.abs(e) <= 30).length;
    const rows: [string, string][] = [
      ['Hits', `${j.hits.length} of ${song.notes.length}`],
      ['Misses (scored as 150 ms)', String(j.misses.length)],
      ['Within ±30 ms', `${tight} (${Math.round((tight / song.notes.length) * 100)}%)`],
      ['Bias (mean signed)', `${bias >= 0 ? '+' : '−'}${Math.abs(Math.round(bias))} ms — ${Math.abs(bias) < 10 ? 'centred' : bias < 0 ? 'early' : 'late'} (includes your display’s constant delay)`],
      ['Stray presses', `${j.strays} (not scored)`],
      ['Layout', `${km.layout === 'auto' ? (isDetected() ? 'detected' : 'QWERTY (assumed)') : LAYOUT_NAMES[km.layout]} · ${lanes.map((l) => l.label).join(' ')}`],
      ['Resolution', 'input timestamps ≈ 1 ms; shown to whole milliseconds'],
    ];
    api.sfx.release();
    stage.request();
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score,
          value: disp,
          unit: 'ms',
          label: 'mean timing error per note',
          headline: `${j.hits.length} of ${song.notes.length} keys hit, ${disp} ms off on average${Math.abs(bias) >= 15 ? `, mostly ${bias < 0 ? 'early' : 'late'}` : ''}.`,
          rows,
          perfect: disp === '0',
          near: score < 20,
          share: [`LETTERFALL · ${api.level} · ${api.mode} — keys on the line`, `${disp} ms mean error`],
        }),
      api.motion() ? 500 : 0,
    );
  }

  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e)) return;
      if (phase === 'remap') {
        if (e.code === 'Escape' || e.code === 'Space' || e.key === 'Enter') return;
        e.preventDefault();
        if (remapList.some((l) => l.code === e.code)) {
          api.sfx.over();
          return;
        }
        remapList.push({ code: e.code, label: (e.key.length === 1 ? e.key : e.code.replace(/^Key|^Digit/, '')).toUpperCase() });
        api.sfx.tick();
        if (remapList.length === 8) {
          km = { layout: 'custom', custom: remapList };
          api.ownKeys(false);
          saveKeymap(km);
          phase = 'ready';
          refreshLanes();
          readyPrompt();
        } else api.prompt(`Remap: press the key for lane ${remapList.length + 1} of 8.`, 'Left to right · keys must be different');
        stage.request();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        if (phase === 'ready') begin();
        else pause(e.timeStamp);
        return;
      }
      if (phase === 'ready') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const i = LAYOUT_ORDER.indexOf(km.layout);
          let n = (i + (e.key === 'ArrowRight' ? 1 : -1) + LAYOUT_ORDER.length) % LAYOUT_ORDER.length;
          if (LAYOUT_ORDER[n] === 'custom' && !km.custom) n = (n + (e.key === 'ArrowRight' ? 1 : -1) + LAYOUT_ORDER.length) % LAYOUT_ORDER.length;
          km = { ...km, layout: LAYOUT_ORDER[n] as LayoutId };
          saveKeymap(km);
          refreshLanes();
          readyPrompt();
          stage.request();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          phase = 'remap';
          api.ownKeys(true);
          remapList = [];
          remapIdx = 0;
          api.prompt('Remap: press the key for lane 1 of 8.', 'Left to right · keys must be different');
          stage.request();
        }
        return;
      }
      const lane = lanes.findIndex((l) => l.code === e.code);
      if (lane < 0 || e.repeat || down.has(e.code)) return;
      e.preventDefault();
      down.add(e.code);
      press(lane, e.timeStamp);
    }),
    listen('keyup', (e) => down.delete(e.code)),
    listen('blur', () => {
      down.clear();
      if (phase === 'play') pause(performance.now());
    }),
  ];
  void remapIdx;

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'ready') return begin();
    if (phase === 'paused') return pause(e.timeStamp);
    if (phase !== 'play') return;
    const g = geom();
    const p = stage.pt(e);
    const lane = Math.floor((p.x - g.L) / g.laneW);
    if (lane < 0 || lane >= g.n) return;
    api.setInput('touch');
    press(lane, e.timeStamp);
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  const onVis = () => {
    if (document.hidden && phase === 'play') pause(performance.now());
  };
  document.addEventListener('visibilitychange', onVis);

  function keycap(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, ghost = false) {
    const r = 6;
    if (!ghost) softShadow(c, x + w / 2, y + h + 2, w * 0.45, 4, 0.8);
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fillStyle = ghost ? pal.paper : pal.paper2;
    c.fill();
    c.strokeStyle = ghost ? pal.line : pal.ink2;
    c.lineWidth = 1.25;
    c.stroke();
    // A slightly darker lower lip: the key's side, seen from above.
    if (!ghost) {
      c.fillStyle = pal.shade;
      c.fillRect(x + 2, y + h - 5, w - 4, 3);
    }
    text(c, label, x + w / 2, y + h / 2, font.mono(Math.min(20, h * 0.5), 600), ghost ? pal.ink3 : pal.ink, 'center', 'middle');
  }

  stage.draw = (now) => {
    const c = stage.ctx;
    const g = geom();
    const tNow = phase === 'paused' ? pausedAt - start : now - start;
    // Lanes (every other one faintly shaded) and the target line with a soft band around it.
    for (let i = 0; i < g.n; i += 2) {
      rr(c, g.L + i * g.laneW + 2, g.top, g.laneW - 4, g.lineY + 40 - g.top, 8);
      c.fillStyle = pal.line2;
      c.fill();
    }
    for (let i = 0; i <= g.n; i++) line(c, g.L + i * g.laneW, g.top, g.L + i * g.laneW, g.lineY + 40, pal.line2, 1);
    {
      const band = c.createLinearGradient(0, g.lineY - 16, 0, g.lineY + 16);
      band.addColorStop(0, alpha(pal.ink, 0));
      band.addColorStop(0.5, alpha(pal.ink, 0.08));
      band.addColorStop(1, alpha(pal.ink, 0));
      c.fillStyle = band;
      c.fillRect(g.L - 6, g.lineY - 16, g.n * g.laneW + 12, 32);
    }
    neon(c, (cc) => (cc.moveTo(g.L - 6, g.lineY), cc.lineTo(g.L + g.n * g.laneW + 6, g.lineY)), pal.accent, 2.5, 14);
    lanes.forEach((l, i) => keycap(c, g.L + i * g.laneW + 6, g.lineY + 14, g.laneW - 12, 34, l.label, true));
    if (phase === 'remap') {
      remapList.forEach((l, i) => text(c, l.label, g.L + i * g.laneW + g.laneW / 2, g.lineY - 30, font.mono(16, 600), pal.ink, 'center'));
      return true;
    }
    // Falling keys: position from the schedule, never from frame counts.
    const span = g.lineY - g.top;
    const judgedHit = new Set(live.hits.map((h) => h.note));
    if (phase === 'play') {
      // A note that slipped past its window unhit: judged OFF once (breaks the streak).
      song.notes.forEach((n, i) => {
        if (missed.has(i) || judgedHit.has(i) || n.t > tNow - WINDOW) return;
        missed.add(i);
        api.judge(WINDOW, { x: g.L + n.lane * g.laneW + g.laneW / 2, y: g.lineY - 70 });
      });
    }
    song.notes.forEach((n, i) => {
      if (phase === 'ready') return; // nothing falls before the song starts
      const dt = n.t - tNow;
      if (dt > lead() || dt < -WINDOW - 250) return;
      if (judgedHit.has(i)) return;
      const y = g.lineY - (dt / lead()) * span;
      const h = 30;
      const x = g.L + n.lane * g.laneW + 8;
      c.globalAlpha = dt < -WINDOW ? clamp(1 + (dt + WINDOW) / 250, 0, 1) * 0.5 : 1;
      // Ghost mode: about two keys in five fade out on the last stretch — keep the rhythm in your head.
      const ghost = api.mode === 'ghost' && (i * 7919 + song.notes.length * 31) % 5 < 2;
      if (ghost) c.globalAlpha *= clamp((dt / lead() - 0.3) / 0.25, 0, 1);
      if (c.globalAlpha <= 0.01) {
        c.globalAlpha = 1;
        return;
      }
      // Keys light up as they reach the line.
      const near = ghost ? 0 : clamp(1 - Math.abs(dt) / 350, 0, 1);
      if (near > 0 && dt > -WINDOW) glow(c, x + (g.laneW - 16) / 2, y, g.laneW * 0.9, pal.accent, near * 0.9);
      keycap(c, x, y - h / 2, g.laneW - 16, h, lanes[n.lane]?.label ?? '?');
      if (near > 0.2 && dt > -WINDOW) {
        c.beginPath();
        c.roundRect(x, y - h / 2, g.laneW - 16, h, 6);
        c.strokeStyle = alpha(pal.accent, near);
        c.lineWidth = 1.5;
        c.stroke();
      }
      c.globalAlpha = 1;
    });
    // Feedback at the line: signed ms for hits, × for stray presses.
    for (const f of flashes) {
      const age = now - f.at;
      if (age > 600) continue;
      const x = g.L + f.lane * g.laneW + g.laneW / 2;
      // The pressed lane lights up: a beam rising from the line.
      if (age < 260) {
        const bg = c.createLinearGradient(0, g.lineY, 0, g.top);
        const col = f.err == null ? pal.ink3 : Math.abs(f.err) <= 30 ? pal.accent : '#FFB834';
        bg.addColorStop(0, alpha(col, 0.32 * (1 - age / 260)));
        bg.addColorStop(1, alpha(col, 0));
        c.fillStyle = bg;
        c.fillRect(g.L + f.lane * g.laneW + 2, g.top, g.laneW - 4, g.lineY - g.top);
      }
      // A hit bursts a ring from the line.
      if (f.err != null && api.motion()) ripple(c, x, g.lineY, 8, g.laneW * 0.7, age / 450, Math.abs(f.err) <= 30 ? pal.ink : pal.signal, 2.5);
      c.globalAlpha = 1 - age / 600;
      text(c, f.err == null ? '×' : `${f.err >= 0 ? '+' : '−'}${Math.abs(Math.round(f.err))}`, x, g.lineY - 16 - age / 30, font.mono(12, 600), f.err == null ? pal.ink3 : Math.abs(f.err) <= 30 ? pal.ink : pal.signal, 'center');
      c.globalAlpha = 1;
    }
    if (phase === 'paused') text(c, '❚❚ PAUSED', stage.w / 2, g.top + 40, font.mono(14, 600), pal.ink, 'center');
    if (phase === 'play') {
      const done = song.notes.filter((n) => n.t < tNow - WINDOW).length;
      api.progress(`${done} / ${song.notes.length}`);
    }
    if (phase === 'done') {
      // Timing histogram: −150 … +150 ms
      const j = judge(song.notes, presses);
      const bins = new Array(15).fill(0);
      j.hits.forEach((h) => bins[clamp(Math.floor((h.err + WINDOW) / 20), 0, 14)]++);
      const mx = Math.max(1, ...bins);
      const bw = Math.min(28, (stage.w - 80) / 15);
      const bx = stage.w / 2 - (bw * 15) / 2;
      const by = g.top + 150;
      plate(c, bx - 20, by - 132, bw * 15 + 40, 184, 14);
      bins.forEach((b, i) => {
        const hh = (b / mx) * 110;
        if (hh > 0.5) bar(c, bx + i * bw + 2, by - hh, bw - 4, hh, i === 7 ? pal.ink : pal.ink2, 3);
      });
      line(c, bx, by, bx + bw * 15, by, pal.ink3, 1);
      text(c, '−150 ms', bx, by + 16, font.mono(10), pal.ink3, 'left');
      text(c, 'on time', bx + bw * 7.5, by + 16, font.mono(10), pal.ink3, 'center');
      text(c, '+150 ms', bx + bw * 15, by + 16, font.mono(10), pal.ink3, 'right');
      text(c, `${j.misses.length} missed`, stage.w / 2, by + 36, font.mono(11, 500), pal.ink2, 'center');
    }
    return phase === 'play' || flashes.some((f) => now - f.at < 600);
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(finTimer);
      clearTimeout(endTimer);
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
