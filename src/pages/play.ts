import { sfx } from '../core/audio';
import { h, icon, icons } from '../core/dom';
import { clamp, font, hair, pal, text } from '../core/draw';
import { pushRun, seen, stats, type RunKind } from '../core/records';
import { randomSeed } from '../core/rng';
import { parseSeed, seedToString, validScore } from '../core/scoring';
import { buzz, flashOK, onSettings, reducedMotion, settings, setSetting } from '../core/settings';
import { shareResult } from '../core/share';
import { Fx } from '../core/fx';
import { Stage } from '../core/stage';
import { LEVELS, type GameAPI, type GameMeta, type Level, type Result } from '../core/types';
import { byId, DAILY_TRIES, dailyGame, dailyKey, dailyNo, dailySeed, fmtScore, levelLabel, recId, savedLevel, saveLevel, savedMode, saveMode } from '../games/registry';
import { hardUnlocked, nextStar, starCmp, starString, starsFor, starThresholds, tierOf, TIER_LABEL, type Stars } from '../core/progress';
import { soundButton, themeButton, toast, type Page } from './chrome';
import { notFound } from './about';
import { previews } from './previews';
import { href, publicUrl } from '../core/route';

/** Split "0.004" into a dim leading part and the significant digits. */
function dimLeading(v: string) {
  const m = v.match(/^([+−-]?[0.,]*)(.*)$/);
  const frag = document.createDocumentFragment();
  if (!m || !m[2]) {
    frag.append(v);
    return frag;
  }
  if (m[1]) frag.append(h('span', { class: 'dim' }, m[1]));
  frag.append(m[2]);
  return frag;
}

function sparkline(cv: HTMLCanvasElement, g: GameMeta, rid: string) {
  const s = stats(rid, g.better);
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width;
  const H = r.height;
  const data = s.history;
  hair(c, 0, H - 1, W, H - 1, pal.line);
  if (data.length < 2) {
    text(c, data.length ? 'one ranked run so far' : 'no ranked runs yet', 0, H - 10, font.mono(10), pal.ink3);
    return;
  }
  // Errors span orders of magnitude: plot on a log scale, better = up.
  const useLog = g.better === 'lower' && data.every((v) => v > 0);
  const f = (v: number) => (useLog ? Math.log10(v) : v);
  const vals = data.map(f);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const y = (v: number) => {
    const n = (f(v) - lo) / (hi - lo);
    return 6 + (g.better === 'lower' ? n : 1 - n) * (H - 14);
  };
  const x = (i: number) => (i / (data.length - 1)) * (W - 6) + 3;
  if (s.best != null) hair(c, 0, y(clamp(s.best, Math.min(...data), Math.max(...data))), W, y(s.best), pal.ink3, [2, 3]);
  c.beginPath();
  data.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
  c.strokeStyle = pal.ink;
  c.lineWidth = 1.25;
  c.lineJoin = 'round';
  c.stroke();
  const li = data.length - 1;
  c.beginPath();
  c.arc(x(li), y(data[li]), 3, 0, Math.PI * 2);
  c.fillStyle = pal.signal;
  c.fill();
  text(c, 'better ↑', W, 8, font.mono(9), pal.ink3, 'right', 'middle');
}

const KIND_LABEL: Record<RunKind, string> = { ranked: 'Ranked', daily: 'Daily', practice: 'Practice', challenge: 'Challenge' };

export async function playPage(id: string, wantDaily: boolean): Promise<Page> {
  const g = byId(id);
  if (!g) return notFound();
  const mod = await g.load();
  const q = new URLSearchParams(location.search);

  // ── Run type ───────────────────────────────────────────────────────────────
  // Challenge: a validated seed from a shared link. Never consumes daily attempts, never ranked.
  const challengeSeed = parseSeed(q.get('seed'));
  const isChallenge = challengeSeed != null;
  const dKey = dailyKey();
  const isDailyGame = !isChallenge && wantDaily && dailyGame().id === g.id;
  const officialLeft = () => DAILY_TRIES - stats(g.id, g.better).dailyCount(dKey);
  const official = () => isDailyGame && officialLeft() > 0;
  let practice = false;
  // The very first attempt on a device is a forgiving, unranked warm-up.
  let warmup = !seen.get(g.id) && !isDailyGame && !isChallenge;
  const nextSeed = () => (isChallenge ? challengeSeed! : official() ? dailySeed() : randomSeed());
  const kind = (): RunKind => (isChallenge ? 'challenge' : practice || warmup ? 'practice' : official() ? 'daily' : 'ranked');

  // Level: URL wins, then the last one used for this experiment. The daily is always Medium.
  const qLevel = q.get('level');
  let level: Level = qLevel === 'easy' || qLevel === 'medium' || qLevel === 'hard' ? qLevel : savedLevel(g.id);
  if (official()) level = 'medium';
  // Hard unlocks with ★ on Medium. Challenge links always open their level; Practice can try Hard too.
  const hardLocked = () => !hardUnlocked(g) && !practice && !isChallenge;
  let lockedHardNotice = false;
  if (level === 'hard' && hardLocked()) {
    level = 'medium';
    lockedHardNotice = true;
  }
  // Scoring mode (only for experiments that define modes). The daily uses the default one.
  const qMode = q.get('mode');
  let mode = g.modes?.some((m) => m.id === qMode) ? qMode! : (savedMode(g.id) ?? '');
  if (official() && g.modes) mode = g.modes[0].id;
  const modeInfo = () => g.modes?.find((m) => m.id === mode);
  // Input condition reported by the experiment (e.g. keyboard aiming). Recorded as its own category.
  let inputCond: string | null = null;
  const baseRid = () => recId(g.id, level, mode);
  const rid = () => (inputCond ? `${baseRid()}~${inputCond}` : baseRid());

  // ── DOM ────────────────────────────────────────────────────────────────────
  const progress = h('div', { class: 'xp-progress', 'aria-live': 'polite' });
  const seedEl = h('button', { class: 'cap seed seed-btn', type: 'button', title: 'Copy a challenge link for exactly this run' });
  const runTag = h('span', { class: 'cap xp-tag', hidden: true });
  const helpBtn = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'How it works', 'aria-expanded': 'false' }, icon(icons.help));
  const levelBtns = LEVELS.map((l) =>
    h(
      'button',
      { type: 'button', class: 'lvl-btn', 'data-level': l, role: 'radio', title: '' },
      h('span', { class: 'full' }, levelLabel[l]),
      h('span', { class: 'short' }, levelLabel[l][0]),
      l === 'hard' ? h('span', { class: 'lock', 'aria-hidden': 'true' }, icon(icons.lock)) : null,
    ),
  );
  const picker = h('div', { class: 'lvl', role: 'radiogroup', 'aria-label': 'Difficulty' }, ...levelBtns);
  const modeBtns = (g.modes ?? []).map((m) =>
    h('button', { type: 'button', class: 'lvl-btn mode-btn', 'data-mode': m.id, role: 'radio', 'aria-label': m.name }, h('span', { class: 'sym' }, m.label), h('span', { class: 'full' }, ' ' + m.name)),
  );
  const modePicker = g.modes ? h('div', { class: 'lvl modes', role: 'radiogroup', 'aria-label': 'Scoring' }, ...modeBtns) : null;
  const practiceBtn = h('button', { type: 'button', class: 'lvl-btn practice-btn', 'aria-pressed': 'false', title: 'Practice: unranked attempts, sometimes with extra help', 'aria-label': 'Practice mode' }, h('span', { class: 'full' }, 'Practice'), h('span', { class: 'short' }, 'P'));
  const bar = h(
    'header',
    { class: 'xp-bar' },
    h('a', { class: 'xp-back', href: href(isDailyGame ? '/daily' : '/'), 'aria-label': 'Back' }, icon(icons.back), h('span', { class: 'eps' }, 'ε')),
    h('div', { class: 'xp-title' }, h('span', { class: 'cap no' }, 'EXP ' + g.no), h('h1', { class: 'nm', style: 'margin:0;font-weight:400' }, g.name), runTag),
    h('div', { class: 'xp-controls' }, h('span', { class: 'cap ctl-label' }, 'Protocol'), picker, modePicker),
    h('div', { class: 'xp-tools' }, soundButton(), themeButton('iconbtn theme-btn'), helpBtn),
  );

  // HUD strip over the stage: where you are in the attempt, your stars and next target, your best.
  const hudGoal = h('div', { class: 'hud-goal' });
  const hudBest = h('div', { class: 'hud-best', title: 'Best ranked score at this level' });
  const hud = h('div', { class: 'xp-hud' }, progress, hudGoal, hudBest);

  const promptMain = h('p', { class: 'main' });
  const promptSub = h('p', { class: 'sub cap' });
  const promptEl = h('div', { class: 'xp-prompt', 'aria-live': 'polite' }, promptMain, promptSub);
  const tagKind = h('span', { class: 'st-kind' });
  const stageTags = h(
    'div',
    { class: 'stage-tags', 'aria-hidden': 'true' },
    h('span', { class: 'stage-tag tl' }, h('i', { class: 'live-dot' }), `${g.no} · ${g.measures}`),
    h('span', { class: 'stage-tag tr' }, tagKind),
  );
  const stageEl = h('main', { class: 'xp-stage', tabindex: '0', 'aria-label': `${g.name}. ${g.howto} Keys: ${g.keys}.` }, promptEl, stageTags);
  // The verdict: the result in the HUD strip, right above the stage (the panel holds the details). It sits
  // beside the canvas, never over it, so it can't hide a game's reveal.
  const vTag = h('span', { class: 'vt' });
  const vVal = h('span', { class: 'vv' });
  const vUnit = h('span', { class: 'vu' });
  const vStars = h('span', { class: 'vs' });
  const verdict = h(
    'button',
    { class: 'xp-verdict', type: 'button', hidden: true, title: 'Again' },
    h('span', { class: 'vl' }, vTag, h('span', { class: 'vn' }, vVal, vUnit)),
    vStars,
    h('span', { class: 'vh' }, icon(icons.again), 'Again', h('kbd', null, 'Space')),
  );
  hud.insertBefore(verdict, hudGoal);
  const rezeroBtn = h('button', { class: 'btn quiet act', type: 'button', title: 'Restart this attempt (R)' }, icon(icons.again), 'Re-zero', h('kbd', null, 'R'));
  const actions = h('div', { class: 'xp-actions' }, rezeroBtn, h('div', { class: 'lvl practice-wrap' }, practiceBtn), seedEl, h('span', { class: 'cap act-keys' }, g.keys));
  const mainCol = h('div', { class: 'xp-main' }, hud, stageEl, actions);

  // Result block
  const resBadges = h('span', { class: 'res-badges' });
  const resLabel = h('span', { class: 'cap' });
  const resV = h('span', { class: 'v' });
  const resU = h('span', { class: 'u' });
  const resLine = h('p', { class: 'res-line' });
  const resRows = h('dl', { class: 'res-rows more-hidden' });
  const moreBtn = h('button', { class: 'btn quiet res-more', type: 'button' }, 'Details');
  const againBtn = h('button', { class: 'btn primary', type: 'button' }, icon(icons.again), 'Again', h('kbd', null, 'Space'));
  const shareBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Share result card' }, icon(icons.share), 'Share');
  const linkBtn = h('button', { class: 'btn quiet', type: 'button' }, 'Copy challenge link');
  const extraActions = h('div', { class: 'res-extra' });
  const explain = h('p', { class: 'res-explain', hidden: true });
  const runNote = h('p', { class: 'cap daily-note', hidden: true });
  const resStars = h('div', { class: 'res-stars', 'aria-label': 'Stars' });
  const resGoal = h('p', { class: 'res-goal cap' });
  const res = h(
    'section',
    { class: 'res', hidden: true, 'aria-live': 'polite' },
    h('div', { class: 'res-head' }, resLabel, resBadges),
    h('div', { class: 'res-num' }, resV, resU),
    resStars,
    resLine,
    resGoal,
    resRows,
    h('div', { class: 'res-actions' }, againBtn, shareBtn, moreBtn),
    extraActions,
    explain,
    runNote,
  );

  // Readouts — raw units only. Spread is the median absolute deviation of your last 10 ranked runs.
  const ro = (label: string, title: string) => {
    const v = h('span', { class: 'v' });
    return { v, el: h('div', { class: 'ro', title }, h('span', { class: 'cap' }, label), v) };
  };
  const roBest = ro('Best', 'Best ranked score at this level');
  const roMed = ro('Median', 'Median of your last 10 ranked runs');
  const roRuns = ro('Runs', 'Ranked runs at this level (practice and challenges not counted)');
  const roSpread = ro('Spread', 'Median absolute deviation of your last 10 ranked runs — smaller is steadier');
  const sparkCv = h('canvas', { 'aria-hidden': 'true' });
  const trendEl = h('p', { class: 'cap', style: 'grid-column:1/-1;margin:0' });
  const readouts = h('section', { class: 'readouts' }, roBest.el, roMed.el, roRuns.el, roSpread.el, h('div', { class: 'spark' }, sparkCv), trendEl);

  const runInfo = h('p', { class: 'run-info' });
  const levelNote = h('p', { class: 'lvl-note' });
  const helpLevel = h('p');
  const deckBadge = h('span', { class: 'deck-badge' });
  const panel = h(
    'aside',
    { class: 'xp-panel', 'aria-label': 'Measurements' },
    h(
      'section',
      { class: 'deck-head' },
      h('div', { class: 'deck-top' }, h('span', { class: 'cap' }, 'Protocol telemetry'), deckBadge),
      h('h2', { class: 'deck-title' }, 'Observation ', h('em', null, 'Deck')),
    ),
    res,
    readouts,
    h('section', { class: 'measure' }, h('span', { class: 'cap' }, 'Measures · ' + g.measures), h('p', null, g.howto), runInfo, levelNote),
    h(
      'section',
      { class: 'keys cap' },
      h('span', null, g.keys),
      h('span', null, h('kbd', null, 'R'), ' again'),
      h('span', null, h('kbd', null, 'Esc'), ' back'),
      h('span', null, h('kbd', null, 'M'), ' sound'),
      h('span', null, h('kbd', null, '1'), h('kbd', null, '2'), h('kbd', null, '3'), ' level'),
      h('span', null, h('kbd', null, 'P'), ' practice'),
    ),
  );

  const help = h(
    'div',
    { class: 'help-pop', hidden: true, role: 'dialog', 'aria-label': 'How it works' },
    h('span', { class: 'cap' }, `${g.no} · ${g.measures}`),
    h('h4', null, g.name),
    ...(g.steps ? [h('ol', { class: 'help-steps' }, ...g.steps.map((s) => h('li', null, s)))] : [h('p', null, g.howto)]),
    h('p', null, h('b', null, 'How it is scored. '), g.explain),
    helpLevel,
    h('p', { class: 'cap' }, g.keys),
    h('p', { class: 'cap' }, h('a', { href: href('/about#settings') }, 'Settings'), ' — volume, text size, no flashes, larger targets, key sensitivity'),
  );

  // ── Tutorial: first visit (and on demand) — an animated demo, the steps, how it's scored ───────
  const tutCv = h('canvas', { class: 'tut-demo', 'aria-hidden': 'true' });
  const tutStart = h('button', { class: 'btn primary', type: 'button' }, 'Start', h('kbd', null, 'Enter'));
  const tutPractice = h('button', { class: 'btn quiet', type: 'button' }, 'Practice first');
  const tutStars = starThresholds(g, 'medium');
  const tutorial = h(
    'div',
    { class: 'tutorial', role: 'dialog', 'aria-modal': 'true', 'aria-label': `How to play ${g.name}`, hidden: true },
    h(
      'div',
      { class: 'tut-card' },
      h('span', { class: 'cap' }, `${g.no} · ${g.measures}`),
      h('h3', null, g.name),
      h('p', { class: 'tut-tag' }, g.tagline),
      h('div', { class: 'tut-demo-wrap' }, tutCv),
      h('ol', { class: 'tut-steps' }, ...(g.steps ?? [g.howto]).map((s) => h('li', null, s))),
      h(
        'p',
        { class: 'cap tut-score' },
        `Scored in ${g.unit} — ${g.better === 'higher' ? 'higher' : 'lower'} is better.`,
        tutStars
          ? ` Medium stars: ★ ${starCmp(g)} ${tutStars[0].toFixed(g.digits)} · ★★ ${starCmp(g)} ${tutStars[1].toFixed(g.digits)} · ★★★ ${starCmp(g)} ${tutStars[2].toFixed(g.digits)} ${g.unit}.`
          : '',
      ),
      h('div', { class: 'tut-actions' }, tutStart, tutPractice),
    ),
  );
  stageEl.append(tutorial);
  let tutRaf = 0;
  const tutT0 = performance.now();
  const tutFrame = (now: number) => {
    tutRaf = 0;
    if (tutorial.hidden) return;
    const r = tutCv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (tutCv.width !== Math.round(r.width * dpr)) {
      tutCv.width = Math.round(r.width * dpr);
      tutCv.height = Math.round(r.height * dpr);
    }
    const c = tutCv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    previews[g.id]?.(c, r.width, r.height, reducedMotion() ? 2.6 : (now - tutT0) / 1000);
    if (!reducedMotion()) tutRaf = requestAnimationFrame(tutFrame);
  };
  function openTutorial() {
    tutorial.hidden = false;
    el.dataset.tutorial = '1';
    if (!tutRaf) tutRaf = requestAnimationFrame(tutFrame);
    tutStart.focus({ preventScroll: true });
  }
  function closeTutorial(practiceFirst: boolean) {
    if (tutorial.hidden) return;
    tutorial.hidden = true;
    delete el.dataset.tutorial;
    cancelAnimationFrame(tutRaf);
    tutRaf = 0;
    if (practiceFirst && !practice && !official() && !isChallenge) practice = true;
    // A fresh start, so nothing timed ran behind the card.
    restart();
  }
  tutStart.addEventListener('click', () => closeTutorial(false));
  tutPractice.addEventListener('click', () => closeTutorial(true));
  help.append(h('p', null, h('button', { class: 'btn quiet', type: 'button', onclick: () => (toggleHelp(false), openTutorial()) }, 'Show the tutorial')));

  const el = h('div', { class: 'xp', 'data-state': 'play' }, bar, mainCol, panel, help);

  // ── State ──────────────────────────────────────────────────────────────────
  const stage = new Stage(stageEl);
  const fx = new Fx(stageEl);
  fx.onShake = () => {
    stage.shakeX = fx.sx;
    stage.shakeY = fx.sy;
    stage.request();
  };
  // A ripple under every press on the stage — feedback that the instrument felt it.
  stage.canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    const p = stage.pt(e);
    fx.tap(p.x, p.y);
  });
  let seed = nextSeed();
  let state: 'play' | 'result' = 'play';
  let shownAt = 0;
  let lastResult: Result | null = null;
  let lastKind: RunKind = 'ranked';
  let flashTimer = 0;
  let keysOwned = false;
  let combo = 0;

  /** The floating round judgement: tier word, combo, rising and fading (static with reduced motion). */
  function showJudge(label: string, tier: string, n: number, at?: { x: number; y: number }) {
    const el2 = h(
      'div',
      { class: 'judge', 'data-tier': tier, 'aria-hidden': 'true' },
      h('span', { class: 'judge-word' }, label),
      n >= 2 ? h('span', { class: 'judge-combo' }, `×${n} streak`) : null,
    );
    el2.style.left = at ? `${at.x * stage.k}px` : '50%';
    el2.style.top = at ? `${at.y * stage.k}px` : '36%';
    stageEl.append(el2);
    window.setTimeout(() => el2.remove(), 1200);
  }

  const challengeUrl = () => {
    const u = new URL(publicUrl('/e/' + g.id));
    u.searchParams.set('seed', seedToString(seed));
    if (level !== 'medium') u.searchParams.set('level', level);
    if (g.modes && mode !== g.modes[0].id) u.searchParams.set('mode', mode);
    return u.toString();
  };

  async function copyChallenge() {
    const url = challengeUrl();
    try {
      await navigator.clipboard.writeText(url);
      toast('Challenge link copied — same seed, level and scoring');
    } catch {
      // Clipboard blocked: show the link so it can be copied by hand.
      window.prompt('Copy this challenge link:', url);
    }
  }

  const paintRunInfo = () => {
    const k = kind();
    const mi = modeInfo();
    const parts = [KIND_LABEL[k], levelLabel[level], mi ? `${mi.label} ${mi.name}` : '', `seed ${seedToString(seed)}`].filter(Boolean);
    const why =
      k === 'daily'
        ? `Official daily attempt ${DAILY_TRIES - officialLeft() + 1} of ${DAILY_TRIES} — same conditions for everyone today.`
        : k === 'challenge'
          ? 'Challenge from a shared link — the exact same conditions as the sender. Not ranked.'
          : warmup
            ? 'Warm-up — your first attempt here is never ranked.'
            : practice
              ? 'Practice — not ranked; some experiments show extra help.'
              : 'Ranked — a fresh random seed; counts towards your best.';
    runInfo.replaceChildren(h('span', { class: 'cap' }, parts.join(' · ')), h('br'), why);
    runTag.hidden = k === 'ranked';
    runTag.textContent = k === 'daily' ? `Daily ${dailyNo()} · ${DAILY_TRIES - officialLeft() + 1}/${DAILY_TRIES}` : k === 'challenge' ? `Challenge ${seedToString(seed)}` : warmup ? 'Warm-up' : KIND_LABEL[k];
    runTag.dataset.kind = k;
    seedEl.textContent = (k === 'daily' ? 'DAILY ' : 'SEED ') + seedToString(seed);
    tagKind.textContent = [KIND_LABEL[k], levelLabel[level], seedToString(seed)].join(' · ');
    deckBadge.textContent = 'ISO · ' + KIND_LABEL[k].toUpperCase();
    practiceBtn.setAttribute('aria-pressed', String(practice));
    practiceBtn.disabled = official() || isChallenge;
    practiceBtn.title = official() ? 'Official daily attempts cannot be practice' : isChallenge ? 'Challenge runs are already unranked' : 'Practice: unranked attempts, sometimes with extra help';
  };

  const paintLevel = () => {
    const locked = official();
    levelBtns.forEach((b) => {
      const on = b.dataset.level === level;
      const hardLock = b.dataset.level === 'hard' && hardLocked();
      b.setAttribute('aria-checked', String(on));
      b.disabled = locked && !on;
      b.classList.toggle('locked', hardLock);
      b.title = locked ? 'The daily experiment is always Medium' : hardLock ? 'Locked — earn ★ on Medium to unlock Hard (or try it in Practice)' : g.levels[b.dataset.level as Level];
    });
    modeBtns.forEach((b) => {
      const on = b.dataset.mode === mode;
      b.setAttribute('aria-checked', String(on));
      b.disabled = locked && !on;
      b.title = locked ? 'The daily experiment uses the default scoring' : (g.modes?.find((m) => m.id === b.dataset.mode)?.hint ?? '');
    });
    const mi = modeInfo();
    levelNote.replaceChildren(h('span', { class: 'cap' }, levelLabel[level] + ' · '), g.levels[level], ...(mi ? [h('br'), h('span', { class: 'cap' }, mi.label + ' ' + mi.name + ' · '), mi.hint] : []));
    helpLevel.replaceChildren(h('b', null, levelLabel[level] + '. '), g.levels[level], ...(mi ? [h('br'), h('b', null, mi.name + ' scoring. '), mi.hint] : []));
    el.dataset.level = level;
    paintRunInfo();
  };

  const paintReadouts = () => {
    const s = stats(baseRid(), g.better);
    const fmt = (v: number | null) => (v == null ? '—' : fmtScore(g, v));
    const unit = (v: number | null) => (v != null ? h('small', null, g.unit) : '');
    roBest.v.replaceChildren(fmt(s.best), unit(s.best));
    roMed.v.replaceChildren(fmt(s.median10), unit(s.median10));
    roRuns.v.textContent = String(s.n);
    roSpread.v.replaceChildren(s.spread10 == null ? '—' : '±' + fmtScore(g, s.spread10), unit(s.spread10));
    trendEl.textContent =
      s.trend == null
        ? s.n
          ? s.n < 10
            ? `${10 - s.n} more ranked runs to see your trend`
            : 'trend undefined — your early runs were already near zero'
          : 'practice and challenge runs are kept in the journal, not here'
        : s.trend > 0.02
          ? `▲ ${Math.round(s.trend * 100)}% better than your first runs (median)`
          : s.trend < -0.02
            ? `▼ ${Math.round(-s.trend * 100)}% off your first runs (median)`
            : '— level with your first runs';
    sparkline(sparkCv, g, baseRid());
    paintGoal(s.best);
    hudBest.replaceChildren(h('span', { class: 'cap' }, 'Best'), h('b', null, fmt(s.best)), s.best != null ? h('small', null, g.unit) : '');
  };

  /** "★★☆ · next ★★★ at ≤ 1.2 °" — the target for this level, from the best so far. */
  const goalText = (best: number | null) => {
    const t = starThresholds(g, level);
    if (!t) return null;
    const have = starsFor(g, level, best);
    const fmtT = (v: number) => `${v.toFixed(g.digits)} ${g.unit}`;
    const ns = nextStar(g, level, best)!;
    const next = ns.at != null ? `next ${'★'.repeat(have + 1)} at ${starCmp(g)} ${fmtT(ns.at)}` : g.better === 'higher' ? 'all three stars — now go further' : 'all three stars — now chase EXACT';
    // How far towards the next star the best already is (0..1), for the meter.
    const near = ns.at == null ? 1 : best == null || best <= 0 ? 0 : g.better === 'higher' ? clamp(best / ns.at, 0, 1) : clamp(ns.at / best, 0, 1);
    return { have, next, t, near };
  };
  function paintGoal(best: number | null) {
    const gt = goalText(best);
    if (!gt) {
      hudGoal.replaceChildren();
      return;
    }
    hudGoal.replaceChildren(
      h('span', { class: 'goal-stars', role: 'img', 'aria-label': `${gt.have} of 3 stars at ${levelLabel[level]}` }, ...[0, 1, 2].map((i) => h('b', { 'data-on': String(i < gt.have) }, '★'))),
      h('span', { class: 'goal-meter', 'aria-hidden': 'true', title: 'Your best, on the way to the next star' }, h('i', { style: `width:${Math.round(gt.near * 100)}%` })),
      h('span', { class: 'goal-next' }, gt.next),
    );
  }

  /** "2 / 5" becomes pips; anything else ("12.4 s", "done") is shown as it is. */
  let progText = '';
  function paintProgress(t: string) {
    if (t === progText) return;
    progText = t;
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(t);
    if (m && +m[2] >= 2 && +m[2] <= 12 && +m[1] <= +m[2]) {
      const cur = +m[1];
      const n = +m[2];
      progress.replaceChildren(
        h('span', { class: 'pips', 'aria-hidden': 'true' }, ...Array.from({ length: n }, (_, i) => h('i', { 'data-s': i + 1 < cur ? 'done' : i + 1 === cur ? 'now' : 'todo' }))),
        h('span', { class: 'ptxt' }, `${cur} / ${n}`),
      );
    } else progress.replaceChildren(t ? h('span', { class: 'ptxt' }, t) : '');
  }

  /** Start a fresh attempt (after a result, a level/mode change, a void, or a practice toggle). */
  function restart(reason?: string) {
    keysOwned = false;
    combo = 0;
    fx.streak(0);
    state = 'play';
    el.dataset.state = 'play';
    res.hidden = true;
    verdict.hidden = true;
    inputCond = null;
    seed = nextSeed();
    api.seed = seed;
    api.level = level;
    api.mode = mode;
    api.daily = official();
    api.practice = practice || warmup;
    paintLevel();
    handle.reset(seed);
    if (reason) api.prompt(reason, 'Nothing was recorded · start again when ready');
    stageEl.focus({ preventScroll: true });
  }

  function setLevel(l: Level) {
    if (l === level || official()) return;
    if (l === 'hard' && hardLocked()) {
      sfx.over();
      const t = starThresholds(g!, 'medium');
      toast(`Hard unlocks with ★ on Medium${t ? ` (${starCmp(g!)} ${t[0].toFixed(g!.digits)} ${g!.unit})` : ''} — or try it now in Practice (P)`);
      return;
    }
    level = l;
    saveLevel(g!.id, l);
    const url = new URL(location.href);
    if (l === 'medium') url.searchParams.delete('level');
    else url.searchParams.set('level', l);
    history.replaceState(history.state, '', url.pathname + url.search);
    paintReadouts();
    sfx.step();
    restart();
    toast(levelLabel[l] + ' — ' + g!.levels[l]);
  }
  levelBtns.forEach((b) => b.addEventListener('click', () => setLevel(b.dataset.level as Level)));

  function setMode(m: string) {
    if (m === mode || official()) return;
    mode = m;
    saveMode(g!.id, m);
    const url = new URL(location.href);
    if (m === g!.modes![0].id) url.searchParams.delete('mode');
    else url.searchParams.set('mode', m);
    history.replaceState(history.state, '', url.pathname + url.search);
    paintReadouts();
    sfx.step();
    restart();
    const mi = modeInfo()!;
    toast(mi.name + ' — ' + mi.hint);
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode!)));

  function togglePractice() {
    if (official() || isChallenge) return;
    practice = !practice;
    sfx.step();
    // Leaving Practice on a still-locked Hard: back to Medium.
    if (!practice && level === 'hard' && hardLocked()) {
      level = 'medium';
      paintReadouts();
    }
    restart();
    toast(practice ? 'Practice — unranked, with extra help where available' : 'Ranked runs');
  }
  practiceBtn.addEventListener('click', togglePractice);

  const api: GameAPI = {
    stage,
    fx,
    seed,
    level,
    mode,
    daily: official(),
    practice: practice || warmup,
    setInput: (c) => {
      inputCond = c;
    },
    firstTime: !seen.get(g.id),
    motion: () => !reducedMotion(),
    prompt: (main, sub) => {
      promptMain.textContent = main;
      promptSub.textContent = sub ?? '';
      if (main || sub) delete promptEl.dataset.empty;
      else promptEl.dataset.empty = '';
    },
    progress: (t) => paintProgress(t),
    best: () => stats(baseRid(), g.better).best,
    stars: () => starThresholds(g, level),
    again: () => again(),
    finish: (r) => showResult(r),
    ownKeys: (on) => {
      keysOwned = on;
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
    voidRun: (reason) => {
      if (state !== 'play') return;
      sfx.over();
      restart(reason);
    },
    sfx,
    buzz,
  };

  /** The score counts up to its value (instant with reduced motion), then shows its significant digits. */
  let countRaf = 0;
  function countUp(r: Result) {
    cancelAnimationFrame(countRaf);
    const final = () => resV.replaceChildren(r.perfect ? r.value : dimLeading(r.value));
    const target = Number(r.value.replace('−', '-'));
    if (reducedMotion() || !Number.isFinite(target) || r.value.includes('/')) return final();
    const t0 = performance.now();
    const dur = 650;
    const digits = (r.value.split('.')[1] ?? '').length;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - p) ** 3;
      if (p >= 1) return final();
      resV.textContent = (target * e).toFixed(digits);
      countRaf = requestAnimationFrame(step);
    };
    countRaf = requestAnimationFrame(step);
  }

  /** Three stars, landing one after another; a "new" mark when this run raised your best rating. */
  const starTimers: number[] = [];
  function paintStars(n: Stars, raised: boolean) {
    starTimers.forEach(clearTimeout);
    starTimers.length = 0;
    if (!g!.stars) {
      resStars.replaceChildren();
      return;
    }
    const spans = [0, 1, 2].map((i) => h('span', { class: 'star', 'data-on': String(i < n) }, i < n ? '★' : '☆'));
    resStars.replaceChildren(...spans, raised ? h('span', { class: 'badge star-new' }, 'New ★') : '');
    resStars.setAttribute('aria-label', `${n} of 3 stars`);
    spans.forEach((s, i) => {
      if (i >= n) return;
      if (reducedMotion()) return s.classList.add('landed');
      starTimers.push(
        window.setTimeout(() => {
          s.classList.add('landed');
          sfx.star(i + 1);
        }, 450 + i * 220),
      );
    });
  }

  function showResult(r: Result) {
    // Measurement integrity: a non-finite or negative score is a bug, never a record.
    if (!validScore(r.score)) {
      restart('That measurement was invalid and has been discarded.');
      return;
    }
    const wasOfficial = official();
    const k = kind();
    lastKind = k;
    const unlockedBefore = hardUnlocked(g!);
    const starsBefore = starsFor(g!, level, stats(baseRid(), g!.better).best);
    const { isBest, first } = pushRun(rid(), r.score, g!.better, {
      kind: k,
      daily: wasOfficial ? dKey : undefined,
      seed,
      input: inputCond ?? undefined,
    });
    lastResult = r;
    state = 'result';
    shownAt = performance.now();
    el.dataset.state = 'result';

    resLabel.textContent = r.label;
    resU.textContent = r.unit;
    resLine.textContent = r.headline;
    countUp(r);
    // Stars for this run, and progress: a new star level, Hard unlocked.
    const runStars = starsFor(g!, level, r.score);
    const starsNow = starsFor(g!, level, stats(baseRid(), g!.better).best);
    const ranked = k === 'ranked' || k === 'daily';
    paintStars(runStars, ranked && starsNow > starsBefore);
    const gt = goalText(stats(baseRid(), g!.better).best);
    const nowUnlocked = !unlockedBefore && hardUnlocked(g!);
    resGoal.textContent = [
      gt ? (ranked ? gt.next[0].toUpperCase() + gt.next.slice(1) : `${k === 'challenge' ? 'Challenge' : warmup ? 'Warm-up' : 'Practice'} runs don’t earn stars · ${gt.next}`) : '',
      nowUnlocked ? 'Hard is now unlocked.' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (nowUnlocked) window.setTimeout(() => toast(`${g!.name}: Hard unlocked — press 3`), 900);
    resRows.replaceChildren(...r.rows.flatMap(([a, b]) => [h('dt', null, a), h('dd', null, b)]));
    resRows.classList.add('more-hidden');
    moreBtn.hidden = r.rows.length <= 2;
    moreBtn.textContent = 'Details';
    const badges: HTMLElement[] = [];
    if (r.perfect) badges.push(h('span', { class: 'badge signal' }, 'Exact'));
    badges.push(h('span', { class: 'badge lvl-badge', 'data-level': level }, levelLabel[level]));
    const mi = modeInfo();
    if (mi) badges.push(h('span', { class: 'badge lvl-badge' }, mi.label + ' ' + mi.name));
    if (k !== 'ranked') badges.push(h('span', { class: 'badge kind-badge', 'data-kind': k }, warmup && k === 'practice' ? 'Warm-up' : KIND_LABEL[k]));
    if (inputCond) badges.push(h('span', { class: 'badge kind-badge' }, inputCond));
    if (isBest) badges.push(h('span', { class: 'badge' }, 'New best'));
    resBadges.replaceChildren(...badges);
    // The outcome colours the result card and the verdict on the stage.
    const outcome = r.perfect ? 'perfect' : isBest && !first ? 'best' : r.near ? 'near' : 'plain';
    res.dataset.outcome = outcome;
    verdict.dataset.outcome = outcome;
    fx.celebrate(outcome);
    vTag.textContent = r.perfect ? 'Exact' : isBest && !first ? 'New best' : r.label;
    vVal.replaceChildren(r.perfect ? r.value : dimLeading(r.value));
    vUnit.textContent = r.unit;
    vStars.textContent = g!.stars ? starString(runStars) : '';
    vStars.hidden = !g!.stars;
    verdict.setAttribute('aria-label', `${r.value} ${r.unit}. Again`);
    verdict.hidden = false;
    extraActions.replaceChildren(linkBtn, ...(r.actions ?? []).map((a) => h('button', { class: 'btn quiet', type: 'button', onclick: a.run }, a.label)));

    if (!seen.get(g!.id)) {
      explain.innerHTML = '';
      explain.append(h('b', null, 'What was measured. '), g!.explain);
      explain.hidden = false;
      seen.set(g!.id);
      api.firstTime = false;
    } else explain.hidden = true;

    runNote.hidden = false;
    if (isDailyGame) {
      const left = officialLeft();
      const best = stats(g!.id, g!.better).dailyBest(dKey);
      runNote.textContent = wasOfficial
        ? left > 0
          ? `${left} official ${left === 1 ? 'try' : 'tries'} left today · today's best ${fmtScore(g!, best)} ${g!.unit}`
          : `Daily done · your score ${fmtScore(g!, best)} ${g!.unit} · new experiment tomorrow`
        : 'Practice run — does not count for the daily';
    } else if (k === 'challenge') runNote.textContent = 'Challenge run — kept in your journal, not in your bests (a known seed can be rehearsed).';
    else if (k === 'practice') runNote.textContent = warmup ? 'Warm-up — kept in your journal. Your next attempt is ranked.' : 'Practice — kept in your journal, not in your bests.';
    else if (inputCond) runNote.textContent = `Recorded separately (${inputCond}) — it changes what you could see.`;
    else runNote.hidden = true;

    warmup = false;
    res.hidden = false;
    panel.scrollTop = 0;
    paintReadouts();
    paintLevel();
    api.prompt('');

    if (r.perfect) {
      sfx.perfect();
      buzz([12, 60, 12, 60, 30]);
      if (flashOK()) {
        stageEl.classList.add('inverted');
        clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => stageEl.classList.remove('inverted'), 650);
      }
    } else if (isBest && !first) {
      sfx.record();
      buzz([10, 50, 10]);
    } else if (r.near) {
      sfx.near();
      buzz(15);
    } else sfx.result();
  }

  function again() {
    if (state !== 'result') return;
    restart();
  }

  againBtn.addEventListener('click', again);
  rezeroBtn.addEventListener('click', () => {
    if (state === 'result') again();
    else {
      inputCond = null;
      handle.reset(seed);
      stageEl.focus({ preventScroll: true });
    }
  });
  verdict.addEventListener('click', again);
  linkBtn.addEventListener('click', copyChallenge);
  seedEl.addEventListener('click', copyChallenge);
  moreBtn.addEventListener('click', () => {
    resRows.classList.toggle('more-hidden');
    moreBtn.textContent = resRows.classList.contains('more-hidden') ? 'Details' : 'Less';
  });
  shareBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    const mi = modeInfo();
    const base = lastKind === 'daily' ? `daily no. ${dailyNo()}` : `no. ${g.no} · ${level}${mi ? ' · ' + mi.name.toLowerCase() : ''}`;
    const tag = lastKind === 'ranked' || lastKind === 'daily' ? base : `${base} · ${lastKind}`;
    const msg = await shareResult(g, lastResult, tag, challengeUrl());
    if (msg) toast(msg);
  });
  const toggleHelp = (force?: boolean) => {
    const open = force ?? help.hidden;
    help.hidden = !open;
    helpBtn.setAttribute('aria-expanded', String(open));
  };
  helpBtn.addEventListener('click', () => toggleHelp());

  // Capture phase: the shell's keys win over the experiment's own listeners.
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // The tutorial card owns the keyboard while it is open: Enter / Space start, Esc closes.
    if (!tutorial.hidden) {
      if (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape') {
        e.preventDefault();
        if (!e.repeat) closeTutorial(false);
      }
      if (e.key !== 'Tab') e.stopImmediatePropagation();
      return;
    }
    // Typing into a text field (e.g. Verbatim): letters and digits are text, not shortcuts. Esc leaves the field.
    const field = (e.target as HTMLElement | null)?.closest?.('textarea, input[type="text"], [contenteditable]');
    if (field) {
      if (e.key === 'Escape') {
        (field as HTMLElement).blur();
        stageEl.focus({ preventScroll: true });
        e.preventDefault();
      }
      return;
    }
    const inControl = (e.target as HTMLElement)?.closest?.('button, a, input');
    if (e.key === 'Escape') {
      if (!help.hidden) toggleHelp(false);
      else bar.querySelector<HTMLAnchorElement>('.xp-back')!.click();
      e.preventDefault();
      return;
    }
    // An experiment that uses letters as controls (Letterfall) owns plain character keys while playing.
    if (keysOwned && state === 'play' && e.key.length === 1) return;
    if (e.key === '?') {
      toggleHelp();
      return;
    }
    if ((e.key === '1' || e.key === '2' || e.key === '3') && !e.repeat && !inControl) {
      setLevel(LEVELS[Number(e.key) - 1]);
      return;
    }
    if ((e.key === 'p' || e.key === 'P') && !e.repeat && !inControl) {
      togglePractice();
      return;
    }
    if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
      setSetting('sound', !settings.sound);
      toast(settings.sound ? 'Sound on' : 'Sound off');
      return;
    }
    if (state === 'result') {
      const isAgain = e.code === 'Space' || e.key === 'Enter' || e.key === 'r' || e.key === 'R';
      if (isAgain && !inControl) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && performance.now() - shownAt > 350) again();
      }
    } else if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
      // Restart the current attempt (same seed — nothing was recorded yet).
      e.stopImmediatePropagation();
      inputCond = null;
      handle.reset(seed);
    }
  };
  // Swallow keyups that belong to the "again" keypress, so hold-games don't see a stray release.
  const onKeyUp = (e: KeyboardEvent) => {
    if (state === 'result' && (e.code === 'Space' || e.key === 'Enter')) e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  const offSettings = onSettings(() => {
    stage.request();
    paintReadouts();
  });
  const onDocDown = (e: PointerEvent) => {
    if (!help.hidden && !help.contains(e.target as Node) && !helpBtn.contains(e.target as Node)) toggleHelp(false);
  };
  document.addEventListener('pointerdown', onDocDown);
  stageEl.addEventListener('contextmenu', (e) => e.preventDefault());

  const handle = mod.default(api);
  paintLevel();
  if (q.has('seed') && !isChallenge) toast('That challenge link has an invalid seed — starting a normal run');

  return {
    el,
    title: `${g.name} — epsilon`,
    fullscreen: true,
    mounted: () => {
      stage.fit();
      stage.start();
      handle.reset(seed);
      paintReadouts();
      stageEl.focus({ preventScroll: true });
      if (!seen.get(g.id)) openTutorial();
      if (lockedHardNotice) toast(`Hard unlocks with ★ on Medium — playing Medium (Practice can try Hard)`);
    },
    destroy: () => {
      handle.destroy();
      stage.destroy();
      fx.destroy();
      clearTimeout(flashTimer);
      cancelAnimationFrame(countRaf);
      cancelAnimationFrame(tutRaf);
      starTimers.forEach(clearTimeout);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('pointerdown', onDocDown);
      offSettings();
    },
  };
}
