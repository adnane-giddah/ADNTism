// SESSION — the game, full screen, nothing else: the stage fills the display, with only a discreet pause
// control and the game's own one-line instruction over it. Pausing freezes the stage; the Android back button
// pauses too. When the run ends, the Debrief slides over the frozen game: score, stars, details, Again.
// The GameAPI contract is the same one the website's play page provides (records, judgements, stars, seeds).
import { sfx } from '../core/audio';
import { h, icon, icons } from '../core/dom';
import { Fx } from '../core/fx';
import { hardUnlocked, starsFor, starString, starThresholds, tierOf, TIER_LABEL } from '../core/progress';
import { pushRun, seen, stats, type RunKind } from '../core/records';
import { randomSeed } from '../core/rng';
import { seedToString, validScore } from '../core/scoring';
import { buzz, flashOK, reducedMotion } from '../core/settings';
import { Stage } from '../core/stage';
import type { GameAPI, GameHandle, Result } from '../core/types';
import { byId, DAILY_TRIES, dailyKey, dailySeed, fmtScore, levelLabel, recId } from '../games/registry';
import type { Nav, Screen, Setup } from './app';
import { btn, frame, label, sparkline } from './ui';

/** Landscape phones are ~360 px tall: lay games out at least this tall and scale the drawing to fit. */
const MIN_STAGE_H = 540;

export async function sessionScreen(nav: Nav, setup: Setup): Promise<Screen> {
  const g = byId(setup.id)!;
  const mod = await g.load();
  const { level, mode } = setup;
  const dKey = dailyKey();
  const official = () => setup.daily && stats(g.id, g.better).dailyCount(dKey) < DAILY_TRIES;
  // The very first attempt at a game on this device is an unranked warm-up, as on the website.
  let warmup = !seen.get(g.id) && !setup.daily;
  const kind = (): RunKind => (setup.practice || warmup ? 'practice' : official() ? 'daily' : 'ranked');
  let inputCond: string | null = null;
  const baseRid = () => recId(g.id, level, mode || undefined);
  const rid = () => (inputCond ? `${baseRid()}~${inputCond}` : baseRid());

  // ── DOM ────────────────────────────────────────────────────────────────
  const host = h('div', { class: 's-stage', tabindex: '-1' });
  const pauseBtn = h('button', { type: 'button', class: 's-pause-btn', 'aria-label': 'Pause' }, icon(icons.pause));
  const pips = h('div', { class: 's-pips', 'aria-hidden': 'true' });
  const promptMain = h('div', { class: 's-prompt-main' });
  const promptSub = h('div', { class: 's-prompt-sub' });
  // One slim bar at top centre — the strip every game already keeps clear for its instruction:
  // pause · the instruction (its second line folded to one; tap to unfold) · round pips.
  const prompt = h('div', { class: 's-prompt', 'aria-live': 'polite' }, promptMain, promptSub);
  prompt.addEventListener('click', () => prompt.classList.toggle('open'));
  const bar = h('div', { class: 's-bar' }, pauseBtn, prompt, pips);
  const pauseLayer = h('div', { class: 's-layer s-paused', hidden: true });
  const debrief = h('div', { class: 's-layer s-debrief', hidden: true });
  const el = h('div', { class: 's-session' }, host, bar, pauseLayer, debrief);

  const stage = new Stage(host);
  stage.setMinHeight(MIN_STAGE_H);
  const fx = new Fx(host, () => stage.k);
  stage.onResize = () => fx.refit();
  fx.onShake = () => {
    stage.shakeX = fx.sx;
    stage.shakeY = fx.sy;
    stage.request();
  };
  host.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || state !== 'play') return;
    const p = stage.pt(e);
    fx.tap(p.x, p.y);
  });
  host.addEventListener('contextmenu', (e) => e.preventDefault());

  let seed = official() ? dailySeed() : randomSeed();
  let state: 'play' | 'paused' | 'result' = 'play';
  let combo = 0;
  let shownAt = 0;

  function showJudge(word: string, tier: string, n: number, at?: { x: number; y: number }) {
    const j = h('div', { class: 's-judge', 'data-tier': tier, 'aria-hidden': 'true' }, h('b', null, word), n >= 2 ? h('small', null, `×${n} STREAK`) : null);
    j.style.left = at ? `${at.x * stage.k}px` : '50%';
    j.style.top = at ? `${at.y * stage.k}px` : '38%';
    host.append(j);
    window.setTimeout(() => j.remove(), 1100);
  }

  function paintProgress(t: string) {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(t);
    if (m && +m[2] >= 2 && +m[2] <= 20) pips.replaceChildren(...Array.from({ length: +m[2] }, (_, i) => h('i', { 'data-s': i + 1 < +m[1] ? 'done' : i + 1 === +m[1] ? 'now' : 'todo' })));
    else pips.replaceChildren(t ? h('span', null, t) : '');
  }

  const api: GameAPI = {
    stage,
    fx,
    seed,
    level,
    mode: mode || g.modes?.[0].id || 'default',
    daily: official(),
    practice: setup.practice || warmup,
    setInput: (c) => (inputCond = c),
    firstTime: !seen.get(g.id),
    motion: () => !reducedMotion(),
    prompt: (main, sub) => {
      promptMain.textContent = main;
      promptSub.textContent = sub ?? '';
      prompt.classList.remove('open');
      prompt.hidden = !main && !sub;
    },
    progress: paintProgress,
    finish: (r) => showDebrief(r),
    sfx,
    buzz,
    voidRun: (reason) => {
      if (state !== 'play') return;
      sfx.over();
      restart();
      api.prompt(reason, 'Nothing was recorded · start again when ready');
    },
    judge: (err, at) => {
      const tier = tierOf(g, level, err);
      const rank = { off: 0, good: 1, great: 2, excellent: 3, exact: 4 }[tier];
      combo = rank >= 2 ? combo + 1 : 0;
      showJudge(TIER_LABEL[tier], tier, combo, at);
      fx.judge(tier, at ? at.x : stage.w / 2, at ? at.y : stage.h * 0.36, combo);
      if (rank >= 1) sfx.chime(rank, combo);
      if (rank >= 3) buzz(12);
      return tier;
    },
    ownKeys: () => {},
    best: () => stats(baseRid(), g.better).best,
    stars: () => starThresholds(g, level),
    again: () => again(),
  };

  // ── Pause ─────────────────────────────────────────────────────────────
  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    stage.pause();
    pauseLayer.hidden = false;
    sfx.step();
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'play';
    pauseLayer.hidden = true;
    stage.resume();
    host.focus({ preventScroll: true });
  }
  pauseBtn.addEventListener('click', pause);
  pauseLayer.append(
    frame(
      's-pause-card',
      label(`PROTOCOL PAUSED // EXP ${g.no}`, 'teal'),
      h('h2', null, h('em', null, g.name)),
      h('p', null, `${levelLabel[level]} · ${kind() === 'ranked' ? 'Ranked' : kind() === 'daily' ? 'Daily' : 'Practice'} · seed ${seedToString(seed)}`),
      h(
        'div',
        { class: 's-actions' },
        btn('RESUME', resume, { kind: 'primary', icon: icons.play }),
        btn('RESTART', () => {
          resume();
          restart();
        }, { icon: icons.again }),
        btn('BRIEFING', () => nav.back()),
        btn('LAB', () => nav.lab()),
      ),
    ),
  );

  // ── Runs ──────────────────────────────────────────────────────────────
  function restart() {
    combo = 0;
    fx.streak(0);
    state = 'play';
    debrief.hidden = true;
    pauseLayer.hidden = true;
    inputCond = null;
    seed = official() ? dailySeed() : randomSeed();
    Object.assign(api, { seed, daily: official(), practice: setup.practice || warmup });
    stage.resume();
    handle.reset(seed);
    host.focus({ preventScroll: true });
  }
  function again() {
    if (state !== 'result') return;
    restart();
  }

  function showDebrief(r: Result) {
    if (state === 'result') return;
    if (!validScore(r.score)) return api.voidRun('That measurement was invalid and has been discarded.');
    const k = kind();
    const before = stats(baseRid(), g.better).best;
    const starsBefore = starsFor(g, level, before);
    const unlockedBefore = hardUnlocked(g);
    const { isBest, first } = pushRun(rid(), r.score, g.better, { kind: k, daily: k === 'daily' ? dKey : undefined, seed, input: inputCond ?? undefined });
    if (!seen.get(g.id)) seen.set(g.id);
    api.firstTime = false;
    warmup = false;
    state = 'result';
    shownAt = performance.now();
    window.setTimeout(() => stage.pause(), 400);
    const runStars = starsFor(g, level, r.score);
    const nowBest = stats(baseRid(), g.better).best;
    const ranked = k === 'ranked' || k === 'daily';
    const outcome = r.perfect ? 'perfect' : isBest && !first ? 'best' : r.near ? 'near' : 'plain';
    fx.celebrate(outcome);
    if (r.perfect) {
      sfx.perfect();
      buzz([12, 60, 12, 60, 30]);
    } else if (isBest && !first) {
      sfx.record();
      buzz([10, 50, 10]);
    } else if (r.near) sfx.near();
    else sfx.result();

    const spark = h('canvas', { class: 'a-spark' });
    const tags = [
      r.perfect ? h('span', { class: 'a-badge gold' }, 'EXACT') : null,
      isBest && !first && ranked ? h('span', { class: 'a-badge teal' }, 'NEW BEST') : null,
      ranked && starsFor(g, level, nowBest) > starsBefore ? h('span', { class: 'a-badge gold' }, 'NEW ★') : null,
      !unlockedBefore && hardUnlocked(g) ? h('span', { class: 'a-badge coral' }, 'HARD UNLOCKED') : null,
      h('span', { class: 'a-badge' }, `${levelLabel[level].toUpperCase()} · ${k === 'ranked' ? 'RANKED' : k === 'daily' ? 'DAILY' : 'PRACTICE'}`),
    ];
    debrief.replaceChildren(
      frame(
        's-deb-card',
        h(
          'div',
          { class: 's-deb-l' },
          label(`PROTOCOL // DEBRIEF · EXP ${g.no}`, 'teal'),
          h('div', { class: 's-deb-score', 'data-outcome': outcome }, h('b', null, r.value), h('small', null, r.unit)),
          label(r.label.toUpperCase()),
          g.stars ? h('div', { class: 's-deb-stars', 'aria-label': `${runStars} of 3 stars` }, starString(runStars)) : null,
          h('p', { class: 's-deb-line' }, r.headline),
          h('div', { class: 'a-row a-wrap' }, ...tags.filter(Boolean)),
          ranked ? null : h('p', { class: 'a-note' }, warmup || k === 'practice' ? 'Practice and warm-up runs are kept in Telemetry, not in your bests.' : ''),
        ),
        h(
          'div',
          { class: 's-deb-r' },
          h('dl', { class: 's-rows' }, ...r.rows.slice(0, 14).flatMap(([a, b]) => [h('dt', null, a), h('dd', null, b)])),
          h('div', { class: 'a-spark-wrap' }, label(`TRAJECTORY · BEST ${nowBest == null ? '—' : `${fmtScore(g, nowBest)} ${g.unit}`}`), spark),
          h(
            'div',
            { class: 's-actions' },
            btn('AGAIN', again, { kind: 'primary', icon: icons.again }),
            ...(r.actions ?? []).map((a) => btn(a.label.toUpperCase(), a.run)),
            btn('BRIEFING', () => nav.back()),
            btn('LAB', () => nav.lab()),
          ),
        ),
      ),
    );
    debrief.hidden = false;
    if (r.perfect && flashOK()) {
      el.classList.add('s-flash');
      window.setTimeout(() => el.classList.remove('s-flash'), 600);
    }
    requestAnimationFrame(() => sparkline(spark, g, baseRid()));
  }

  // Keyboard (tablets with keyboards, and the browser preview): Escape pauses, Enter / Space again.
  const onKey = (e: KeyboardEvent) => {
    if (state === 'paused') {
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        resume();
      }
      e.stopImmediatePropagation();
    } else if (state === 'result' && (e.key === 'Enter' || e.code === 'Space') && performance.now() - shownAt > 400) {
      e.preventDefault();
      e.stopImmediatePropagation();
      again();
    }
  };
  const onVis = () => document.hidden && pause();
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', onVis);

  const handle: GameHandle = mod.default(api);

  return {
    el,
    fullscreen: true,
    mounted: () => {
      stage.fit();
      fx.refit();
      stage.start();
      handle.reset(seed);
      host.focus({ preventScroll: true });
    },
    back: () => {
      if (state === 'play') pause();
      else if (state === 'paused') resume();
      else return false;
      return true;
    },
    destroy: () => {
      handle.destroy();
      stage.destroy();
      fx.destroy();
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
