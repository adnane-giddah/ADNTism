// 12 · FALSE BEAT — keep a beat through silence while the eyes are being lied to.
// A count-in sets the tempo; then the clicks stop. A block keeps sliding toward a line. You tap once, on the
// target beat (or, on Hard rounds that say so, on the crossing). Everything is scheduled before the round:
// beatTime(n) = start + n·60000/BPM, crossing = when x(t) = x0 + v·t reaches the line. Decoys (a flash, a
// moving background, an offset crossing) are drawn from that schedule — never scored.
import { bracket, clamp, font, hair, line, pal, tag, text, beatLamp } from '../core/draw';
import { signed } from '../core/format';
import { gameKey, listen, primary } from '../core/input';
import { latency, saveLatency } from '../core/latency';
import { glow, plate, rr, slot, softShadow, solidBlock, sphere } from '../core/materials';
import { Metronome } from '../core/metronome';
import { rng } from '../core/rng';
import { beatTime, latencyEstimate, tapError } from '../core/scoring';
import { settings } from '../core/settings';
import type { GameFactory, Level } from '../core/types';

const COUNT_IN = 4;
const LEAD = 900; // ms from the press to beat 0
/** A tap further than this from its target is scored as this (a missed or wild tap). */
export const MAX_ERR = 600;
const LINE_X = 78;
const X0 = 4;
const TUNNEL = [50, 76] as const;

export type Objective = 'both' | 'beat' | 'cross';

export interface BeatRound {
  bpm: number;
  /** Index of the target beat (beats 0..COUNT_IN−1 are heard). */
  target: number;
  objective: Objective;
  /** Crossing time minus target-beat time (ms). 0 when the crossing is on the beat. */
  crossOff: number;
  /** Decoy flash time minus target-beat time (ms); null for none. */
  decoy: number | null;
  /** Background stripe drift (u/s; 0 = still). Moving it makes the block look faster or slower. */
  bg: number;
  tunnel: boolean;
  trail: boolean;
  /** The block changes shape partway (Hard): context changes, trajectory doesn't. */
  morph: boolean;
}

export function makeBeat(seed: number, level: Level): BeatRound[] {
  const r = rng(seed);
  const n = level === 'hard' ? 5 : 4;
  return Array.from({ length: n }, (_, i) => {
    const bpm = level === 'easy' ? r.range(84, 104) : level === 'medium' ? r.range(90, 120) : r.range(92, 132);
    const silent = level === 'easy' ? 2 : level === 'medium' ? r.int(3, 4) : r.int(4, 6);
    const target = COUNT_IN - 1 + silent;
    // Hard alternates which event is asked for; the other is offset so the two answers differ.
    const objective: Objective = level === 'hard' ? (i % 2 === 0 ? 'beat' : 'cross') : 'both';
    const crossOff = objective === 'both' ? 0 : r.sign() * r.range(90, 190);
    return {
      bpm,
      target,
      objective,
      crossOff,
      decoy: level === 'hard' ? r.sign() * r.range(70, 150) : null,
      bg: level === 'easy' ? 0 : r.sign() * r.range(14, 26),
      tunnel: level !== 'easy',
      trail: level === 'hard',
      morph: level === 'hard',
    };
  });
}

/** The ideal tap time and the competing (decoy) event time, both in ms from beat 0. */
export function idealTimes(rd: BeatRound) {
  const beat = beatTime(0, rd.target, rd.bpm);
  const cross = beat + rd.crossOff;
  const ideal = rd.objective === 'cross' ? cross : beat;
  const other = rd.objective === 'cross' ? beat : rd.objective === 'beat' ? cross : null;
  return { beat, cross, ideal, other };
}

/** Score one tap (ms from beat 0, already latency-corrected) — signed error capped at ±MAX_ERR. */
export function scoreTap(rd: BeatRound, tap: number | null) {
  const { ideal, other } = idealTimes(rd);
  if (tap == null) return { err: MAX_ERR, signedErr: NaN, tracked: false, missed: true };
  const e = tap - ideal;
  const tracked = other == null ? Math.abs(e) <= MAX_ERR : Math.abs(tap - ideal) < Math.abs(tap - other);
  return { err: Math.min(MAX_ERR, Math.abs(e)), signedErr: e, tracked, missed: false };
}

const CAL_BPM = 100;
const CAL_BEATS = 12;

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: BeatRound[] = [];
  let round = 0;
  let phase: 'ready' | 'run' | 'reveal' | 'done' | 'calib' | 'calibDone' = 'ready';
  let start = 0; // beat 0, performance.now() ms
  let tapAt: number | null = null; // ms from beat 0, corrected
  let rawTap: number | null = null;
  let results: ReturnType<typeof scoreTap>[] = [];
  let missTimer = 0;
  let calTimer = 0;
  let finTimer = 0;
  let keyDown = false;
  let calTaps: number[] = [];
  let calMsg = '';
  const metro = new Metronome();
  const offset = () => latency()?.offset ?? 0;

  const P = (rd: BeatRound) => 60000 / rd.bpm;
  const velocity = (rd: BeatRound) => {
    const { cross } = idealTimes(rd);
    return (LINE_X - X0) / (cross / 1000);
  };
  const xAt = (rd: BeatRound, t: number) => X0 + (velocity(rd) * t) / 1000;

  const objectiveText = (rd: BeatRound) =>
    rd.objective === 'cross' ? `Tap when the block CROSSES the line (not on the beat).` : rd.objective === 'beat' ? `Tap on BEAT ${rd.target + 1} (not when it crosses).` : `Tap on beat ${rd.target + 1} — the block crosses the line right on it.`;

  function readyPrompt() {
    const rd = rounds[round];
    const cal = latency();
    api.progress(`${round + 1} / ${rounds.length}`);
    const sound = settings.sound ? '' : ' · sound is off: the count-in flashes instead';
    api.prompt(
      `Round ${round + 1}: ${objectiveText(rd)}`,
      round === 0
        ? (cal ? `Latency correction ${signed(-cal.offset, 0)} ms · press C to recalibrate` : 'Press C first to calibrate your latency (recommended)') + sound
        : 'Press anywhere to start the count-in',
    );
  }

  function reset(seed: number) {
    clearTimeout(missTimer);
    clearTimeout(finTimer);
    clearTimeout(calTimer);
    metro.stop();
    rounds = makeBeat(seed, api.level);
    round = 0;
    results = [];
    tapAt = null;
    rawTap = null;
    phase = 'ready';
    keyDown = false;
    readyPrompt();
    stage.request();
  }

  function startRound() {
    const rd = rounds[round];
    phase = 'run';
    api.progress(`${round + 1} / ${rounds.length}`);
    tapAt = null;
    rawTap = null;
    start = performance.now() + LEAD;
    metro.run(start, rd.bpm, (n) => n < COUNT_IN, COUNT_IN - 1);
    api.prompt(objectiveText(rd), `Count-in: ${COUNT_IN} beats, then silence${rd.decoy != null ? ' · a flash during the silence may lie' : ''}`);
    const { ideal } = idealTimes(rd);
    clearTimeout(missTimer);
    missTimer = window.setTimeout(() => {
      if (phase === 'run' && tapAt == null) commit(null);
    }, LEAD + ideal + MAX_ERR + 300);
    stage.request();
  }

  function commit(tap: number | null) {
    clearTimeout(missTimer);
    const rd = rounds[round];
    const res = scoreTap(rd, tap);
    const L = Math.max(24, stage.w * 0.07);
    api.judge(res.err, { x: L + (LINE_X / 100) * (stage.w - 2 * L), y: Math.round(Math.max(150, stage.h * 0.42)) - 90 });
    results.push(res);
    phase = 'reveal';
    api.buzz(8);
    if (res.missed) {
      api.sfx.over();
      api.prompt('No tap in time — scored as the maximum.', `${MAX_ERR} ms`);
    } else {
      const s = res.signedErr;
      const word = Math.abs(s) < 0.5 ? 'dead on' : s < 0 ? 'early' : 'late';
      const trackedNote = rd.objective === 'both' ? '' : res.tracked ? ' You followed the right event.' : ` You were closer to the ${rd.objective === 'beat' ? 'crossing' : 'beat'} — the decoy.`;
      api.prompt(`${signed(s, 0)} ms ${word}.${trackedNote}`, round < rounds.length - 1 ? 'Tap for the next round' : '');
    }
    if (round === rounds.length - 1) finish();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const mean = results.reduce((a, r) => a + r.err, 0) / results.length;
    const disp = String(Math.round(mean));
    const signedOnes = results.filter((r) => !r.missed).map((r) => r.signedErr);
    const bias = signedOnes.length ? signedOnes.reduce((a, b) => a + b, 0) / signedOnes.length : NaN;
    const decoyRounds = rounds.filter((r) => r.objective !== 'both').length;
    const tracked = results.filter((r, i) => rounds[i].objective !== 'both' && r.tracked).length;
    const cal = latency();
    const rows: [string, string][] = results.map((r, i) => {
      const rd = rounds[i];
      const what = rd.objective === 'cross' ? 'crossing' : `beat ${rd.target + 1}`;
      return [`${i + 1} · ${Math.round(rd.bpm)} BPM · ${what}`, r.missed ? 'no tap' : `${signed(r.signedErr, 0)} ms`];
    });
    if (Number.isFinite(bias)) rows.push(['Bias (mean signed)', `${signed(bias, 0)} ms — ${Math.abs(bias) < 10 ? 'centred' : bias < 0 ? 'you anticipate' : 'you lag'}`]);
    if (decoyRounds) rows.push(['Tracked the asked-for event', `${tracked} / ${decoyRounds}`]);
    rows.push(['Latency correction', cal ? `${signed(-cal.offset, 0)} ms (${settings.sound ? 'sound' : 'visual'} calibration)` : 'none (press C before a run to calibrate)']);
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: mean,
          value: disp,
          unit: 'ms',
          label: 'mean timing error',
          headline:
            disp === '0'
              ? 'Every tap on the millisecond. The silence didn’t move you.'
              : `${disp} ms off on average${Number.isFinite(bias) && Math.abs(bias) > 15 ? `, mostly ${bias < 0 ? 'early' : 'late'} — the silence ${bias < 0 ? 'rushed' : 'dragged'} you` : ''}.${decoyRounds ? ` You followed the right event ${tracked} of ${decoyRounds} times.` : ''}`,
          rows,
          accuracy: 1 - mean / MAX_ERR,
          perfect: disp === '0',
          near: mean < 15,
          share: [`FALSE BEAT · ${api.level} — keep the beat through silence and decoys`, `${disp} ms mean timing error`],
          actions: [{ label: 'Calibrate latency', run: () => startCalib() }],
        }),
      api.motion() ? 700 : 0,
    );
  }

  // ── Latency calibration: tap along with audible (or visible) beats ──────────
  function startCalib() {
    clearTimeout(missTimer);
    phase = 'calib';
    calTaps = [];
    start = performance.now() + LEAD;
    metro.run(start, CAL_BPM, () => true, CAL_BEATS - 1);
    api.prompt(`Tap along with all ${CAL_BEATS} ${settings.sound ? 'clicks' : 'flashes'}.`, 'Calibration only — nothing is recorded as a score');
    stage.request();
    clearTimeout(calTimer);
    calTimer = window.setTimeout(() => {
      if (phase !== 'calib') return;
      const errs = calTaps
        .map((t) => {
          const n = Math.round((t * CAL_BPM) / 60000);
          return n >= 2 && n < CAL_BEATS ? t - beatTime(0, n, CAL_BPM) : NaN;
        })
        .filter(Number.isFinite);
      const est = latencyEstimate(errs);
      phase = 'calibDone';
      if (est) {
        saveLatency({ offset: est.offset, spread: est.spread, at: Date.now() });
        calMsg = `Calibrated: your taps land ${signed(est.offset, 0)} ms from the ${settings.sound ? 'heard' : 'seen'} beat (spread ±${est.spread.toFixed(0)} ms). This offset is now removed from every tap.`;
        api.sfx.near();
      } else {
        calMsg = errs.length < 5 ? 'Not enough taps to calibrate — tap on every beat.' : 'Too unsteady to trust — nothing was changed. Try again, relaxed.';
        api.sfx.over();
      }
      api.prompt(calMsg, 'Press anywhere to continue');
      stage.request();
    }, LEAD + beatTime(0, CAL_BEATS - 1, CAL_BPM) + 700);
  }

  function input(ts: number) {
    if (phase === 'ready') return startRound();
    if (phase === 'calibDone') {
      // Calibrated from the result screen: the run is over; the next attempt uses the new offset.
      if (results.length === rounds.length) {
        phase = 'done';
        api.prompt('Calibration saved.', 'Press Again for a new run with it');
        stage.request();
        return;
      }
      phase = 'ready';
      readyPrompt();
      stage.request();
      return;
    }
    if (phase === 'calib') {
      calTaps.push(ts - start);
      api.sfx.tick();
      stage.request();
      return;
    }
    if (phase === 'reveal') {
      if (round < rounds.length - 1) {
        round++;
        phase = 'ready';
        startRound();
      }
      return;
    }
    if (phase !== 'run') return;
    const t = ts - start;
    const rd = rounds[round];
    // Taps during the count-in are tapping along — not the answer.
    if (t < beatTime(0, COUNT_IN - 1, rd.bpm) + P(rd) / 2) {
      api.sfx.soft();
      return;
    }
    rawTap = t;
    tapAt = tapError(t, 0, offset());
    api.sfx.tick();
    commit(tapAt);
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    input(e.timeStamp);
  };
  const onVis = () => {
    keyDown = false;
    if (document.hidden && (phase === 'run' || phase === 'calib')) {
      metro.stop();
      if (phase === 'calib') {
        phase = 'ready';
        readyPrompt();
      } else api.voidRun('Attempt voided — the tab was hidden mid-beat.');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  stage.canvas.addEventListener('pointerdown', onDown);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e)) return;
      if ((e.key === 'c' || e.key === 'C') && !e.repeat && (phase === 'ready' || phase === 'calibDone')) {
        startCalib();
        return;
      }
      if (e.code !== 'Space' && e.key !== 'Enter') return;
      e.preventDefault();
      if (e.repeat || keyDown) return;
      keyDown = true;
      input(e.timeStamp);
    }),
    listen('keyup', (e) => {
      if (e.code === 'Space' || e.key === 'Enter') keyDown = false;
    }),
  ];

  // ── Rendering ───────────────────────────────────────────────────────────────
  stage.draw = (now) => {
    const c = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    const L = Math.max(24, W * 0.07);
    const R = W - L;
    const X = (u: number) => L + (u / 100) * (R - L);
    const ty = Math.round(Math.max(150, H * 0.42));
    const t = now - start;
    let more = phase === 'run' || phase === 'calib';
    const rd = rounds[round];
    if (!rd) return false;

    // Beat lamp (top centre). Lit on heard beats only — and once, on Hard, by a decoy.
    const lampX = W / 2;
    const lampY = ty - 110;
    const bpm = phase === 'calib' ? CAL_BPM : rd.bpm;
    const pos = (t * bpm) / 60000;
    const lastHeard = phase === 'calib' ? CAL_BEATS - 1 : COUNT_IN - 1;
    let flash = 0;
    if ((phase === 'run' || phase === 'calib') && pos >= 0) {
      const n = Math.floor(pos);
      const since = t - beatTime(0, n, bpm);
      if (n <= lastHeard) flash = clamp(1 - since / 150, 0, 1);
      if (phase === 'run' && rd.decoy != null) {
        const dt = t - (idealTimes(rd).beat + rd.decoy);
        if (dt >= 0 && dt < 150) flash = Math.max(flash, 1 - dt / 150);
      }
    }
    beatLamp(c, lampX, lampY, 16, flash);
    // Beat counter: only during the count-in (and calibration).
    if (phase === 'run' || phase === 'calib') {
      const n = Math.floor(pos);
      const label = pos < 0 ? 'ready' : n <= lastHeard ? String(n + 1) : '…';
      text(c, label, lampX, lampY + 42, font.mono(14, 500), pal.ink2, 'center');
    }
    if (phase === 'calib' || phase === 'calibDone') {
      // Calibration: show your taps against the beats.
      const y = ty;
      const span = beatTime(0, CAL_BEATS, CAL_BPM);
      const Xt = (ms: number) => L + (ms / span) * (R - L);
      plate(c, L - 14, y - 46, R - L + 28, 96, 14);
      hair(c, L, y, R, y, pal.ink3);
      for (let n = 0; n < CAL_BEATS; n++) line(c, Xt(beatTime(0, n, CAL_BPM)), y - 20, Xt(beatTime(0, n, CAL_BPM)), y, pal.ink, 2);
      for (const tp of calTaps) line(c, Xt(tp), y, Xt(tp), y + 20, pal.signal, 2);
      text(c, 'BEATS', L, y - 30, font.mono(9, 500), pal.ink3);
      text(c, 'YOUR TAPS', L, y + 36, font.mono(9, 500), pal.ink3);
      return more;
    }

    // Track, line, background stripes
    const bandTop = ty - 40;
    const bandH = 60;
    // The lane the block travels in.
    rr(c, L - 6, bandTop - 4, R - L + 12, bandH + 8, 12);
    c.fillStyle = pal.line2;
    c.fill();
    c.save();
    c.beginPath();
    c.rect(L, bandTop, R - L, bandH);
    c.clip();
    if (rd.bg && phase === 'run') {
      const off = (((rd.bg * Math.max(0, t)) / 1000) % 8 + 8) % 8;
      for (let u = -8; u < 108; u += 8) {
        const x = X(u + off);
        line(c, x, bandTop, x, bandTop + bandH, pal.line2, 3);
      }
      more = true;
    }
    c.restore();
    slot(c, L, ty + 20, R, ty + 20, 5);
    glow(c, X(LINE_X), ty - 8, 40, pal.accent, 0.5);
    line(c, X(LINE_X), ty - 46, X(LINE_X), ty + 30, pal.accent, 2);
    text(c, 'LINE', X(LINE_X), ty - 52, font.mono(9, 600), pal.accent, 'center');

    // The block — position from the trajectory, never from frame counting.
    if (phase !== 'ready' || round > 0) {
      const tt = phase === 'run' ? Math.max(0, t) : phase === 'ready' ? 0 : Math.max(0, t);
      const x = phase === 'ready' ? X0 : xAt(rd, Math.min(tt, idealTimes(rd).cross + 1500));
      const small = rd.morph && x > 40;
      if (rd.trail && phase === 'run') {
        for (let i = 1; i <= 6; i++) {
          c.globalAlpha = 0.18 * (1 - i / 7);
          const xt = xAt(rd, Math.max(0, tt - i * 45));
          rr(c, X(xt) - 9, ty - 9, 18, 18, 3);
          c.fillStyle = pal.ink;
          c.fill();
        }
        c.globalAlpha = 1;
      }
      softShadow(c, X(x), ty + 14, small ? 7 : 13, small ? 2 : 3.5, 1.2);
      if (small) sphere(c, X(x), ty, 5, pal.ink);
      else solidBlock(c, X(x) - 9, ty - 9, 18, 18, pal.ink);
    }
    // Tunnel: the block is hidden on its last stretch (Medium / Hard), until the reveal.
    if (rd.tunnel && phase === 'run') {
      const tx0 = X(TUNNEL[0]);
      const tw = X(TUNNEL[1]) - tx0;
      rr(c, tx0, ty - 24, tw, 48, 10);
      c.fillStyle = pal.paper2;
      c.fill();
      const tg = c.createLinearGradient(0, ty - 24, 0, ty + 24);
      tg.addColorStop(0, 'rgba(0,0,0,0.08)');
      tg.addColorStop(0.3, 'rgba(0,0,0,0)');
      tg.addColorStop(1, 'rgba(0,0,0,0.12)');
      c.fillStyle = tg;
      c.fill();
      c.strokeStyle = pal.ink3;
      c.lineWidth = 1;
      c.stroke();
      text(c, 'tunnel', X((TUNNEL[0] + TUNNEL[1]) / 2), ty + 4, font.mono(10, 500), pal.ink3, 'center');
    }

    // Reveal: a timeline around the target
    if ((phase === 'reveal' || phase === 'done') && results[round]) {
      const res = results[round];
      const { beat, cross, ideal, other } = idealTimes(rd);
      const y = ty + 92;
      const span = 700;
      const Xt = (ms: number) => W / 2 + ((ms - ideal) / span) * ((R - L) / 2);
      plate(c, L - 14, y - 66, R - L + 28, 132, 14);
      hair(c, L, y, R, y, pal.ink3);
      for (let ms = -600; ms <= 600; ms += 100) hair(c, Xt(ideal + ms), y, Xt(ideal + ms), y + (ms % 500 === 0 ? 9 : 5), pal.ink3);
      line(c, Xt(beat), y - 26, Xt(beat), y, pal.accent, 2);
      tag(c, `beat ${rd.target + 1}`, Xt(beat), y - 34, pal.accent, 10);
      if (other != null || rd.crossOff) {
        line(c, Xt(cross), y - 18, Xt(cross), y, pal.ink3, 2, [3, 2]);
        tag(c, 'crossing', Xt(cross), y + 22, pal.ink3, 10);
      }
      if (rd.decoy != null) {
        hair(c, Xt(beat + rd.decoy), y - 12, Xt(beat + rd.decoy), y, pal.ink3, [1, 2]);
        text(c, 'decoy flash', Xt(beat + rd.decoy), y - 46, font.mono(9), pal.ink3, 'center');
      }
      if (!res.missed && rawTap != null) {
        const tp = ideal + res.signedErr;
        const tx = Xt(clamp(tp, ideal - span, ideal + span));
        line(c, tx, y, tx, y + 26, pal.signal, 2.5);
        if (Math.abs(tx - Xt(ideal)) > 2) bracket(c, Xt(ideal), y + 34, tx, y + 34, pal.signal, 3, 1.5);
        tag(c, `you ${signed(res.signedErr, 0)} ms`, tx, y + 48, pal.signal, 11);
      }
      text(c, rd.objective === 'cross' ? 'ASKED: THE CROSSING' : `ASKED: BEAT ${rd.target + 1}`, L, y - 52, font.mono(9, 500), pal.ink3);
    }

    if (phase === 'ready') text(c, round === 0 ? 'press anywhere to start · C to calibrate' : 'press to start', W / 2, ty + 80, font.mono(12, 500), pal.ink2, 'center');
    if (phase === 'run' && t > 0 && Math.floor(pos) > lastHeard) text(c, 'silence — keep counting', W / 2, ty + 80, font.mono(11, 500), pal.ink3, 'center');
    if (phase === 'run') more = true;
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(missTimer);
      clearTimeout(finTimer);
      clearTimeout(calTimer);
      metro.stop();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
    },
  };
};

export default factory;
