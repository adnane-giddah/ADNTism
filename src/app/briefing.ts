// BRIEFING — every setting is chosen here, before the game: difficulty, scoring mode, ranked or practice.
// Left: the protocol (title, levels, mode, how to play). Right: a live preview of the mechanic, your history
// and the star targets, and the launch button. The game itself then runs full screen with nothing else.
import { h, icon, icons } from '../core/dom';
import { hardUnlocked, nextStar, starCmp, starsFor, starThresholds } from '../core/progress';
import { stats } from '../core/records';
import { LEVELS, type Level } from '../core/types';
import { byId, DAILY_TRIES, dailyKey, dailyNo, fmtScore, levelLabel, recId, savedLevel, saveLevel, savedMode, saveMode } from '../games/registry';
import type { Nav, Screen } from './app';
import { btn, frame, label, metric, PreviewLoop, segmented, sparkline } from './ui';

export function briefingScreen(nav: Nav, id: string, daily: boolean): Screen {
  const g = byId(id)!;
  const loop = new PreviewLoop();
  const dKey = dailyKey();
  const dailyLeft = () => DAILY_TRIES - stats(g.id, g.better).dailyCount(dKey);
  const official = daily && dailyLeft() > 0;
  let level: Level = official ? 'medium' : savedLevel(g.id);
  let mode = official && g.modes ? g.modes[0].id : (savedMode(g.id) ?? '');
  let practice = false;
  const hardLocked = () => !hardUnlocked(g) && !practice;
  if (level === 'hard' && hardLocked()) level = 'medium';

  const levelNote = h('p', { class: 'a-note' });
  const resist = label('');
  const modeNote = h('p', { class: 'a-note' });
  const statsBox = h('div', { class: 'a-metrics' });
  const spark = h('canvas', { class: 'a-spark' });
  const targets = h('div', { class: 'a-targets' });
  const status = h('span', { class: 'a-badge' });
  const launchBtn = btn('LAUNCH PROTOCOL', () => launch(false), { kind: 'primary', icon: icons.arrow, cls: 'a-launch' });
  const practiceBtn = btn('PRACTICE RUN · NOT RANKED', () => launch(true), { kind: 'ghost', cls: 'a-practice' });

  const levelSeg = segmented(
    LEVELS.map((l) => ({ v: l, label: levelLabel[l].toUpperCase(), tone: l === 'hard' ? 'coral' : l === 'easy' ? 'gold' : '', locked: l === 'hard' && hardLocked(), title: g.levels[l] })),
    level,
    (v) => {
      if (official && v !== 'medium') return;
      if (v === 'hard' && hardLocked()) {
        levelNote.textContent = `Hard unlocks with ★ on Medium — or launch a practice run below.`;
        return;
      }
      level = v;
      saveLevel(g.id, v);
      paint();
    },
  );
  const modeSeg = g.modes
    ? segmented(
        g.modes.map((m) => ({ v: m.id, label: `${m.label} ${m.name}`.toUpperCase() })),
        mode,
        (v) => {
          if (official) return;
          mode = v;
          saveMode(g.id, v);
          paint();
        },
      )
    : null;

  function paint() {
    levelSeg.paint(level);
    modeSeg?.paint(mode);
    resist.textContent = level === 'hard' ? 'CRITICAL RESISTANCE' : level === 'easy' ? 'GUIDED' : 'STANDARD';
    resist.className = `a-label ${level === 'hard' ? 'coral' : level === 'easy' ? 'gold' : 'teal'}`;
    levelNote.replaceChildren(h('b', null, levelLabel[level].toUpperCase() + ' · '), g.levels[level]);
    const mi = g.modes?.find((m) => m.id === mode);
    modeNote.textContent = mi ? mi.hint : '';
    const rid = recId(g.id, level, mode);
    const s = stats(rid, g.better);
    const fmt = (v: number | null) => (v == null ? '—' : fmtScore(g, v));
    statsBox.replaceChildren(
      metric('RECORD BEST', fmt(s.best), s.best != null ? g.unit : '', s.best != null ? `${'★'.repeat(starsFor(g, level, s.best))} at ${levelLabel[level]}` : 'no ranked run yet', 'teal'),
      metric('MEDIAN · LAST 10', fmt(s.median10), s.median10 != null ? g.unit : '', 'your stable baseline', 'blue'),
      metric('TOTAL ATTEMPTS', String(s.n), 'RUNS', 'ranked runs at this level'),
      metric('SPREAD', s.spread10 == null ? '—' : '±' + fmtScore(g, s.spread10), s.spread10 != null ? g.unit : '', 'run-to-run scatter', 'coral'),
    );
    const t = starThresholds(g, level);
    const ns = nextStar(g, level, s.best);
    targets.replaceChildren(
      ...(t
        ? t.map((v, i) => h('div', { class: `a-target ${starsFor(g, level, s.best) > i ? 'got' : ''}` }, h('b', null, '★'.repeat(i + 1)), h('span', null, `${starCmp(g)} ${v.toFixed(g.digits)} ${g.unit}`)))
        : []),
      ns && ns.at != null ? label(`NEXT ${'★'.repeat(ns.have + 1)} AT ${starCmp(g)} ${ns.at.toFixed(g.digits)} ${g.unit}`, 'gold') : label('ALL STARS EARNED', 'gold'),
    );
    status.textContent = official ? `DAILY NO. ${dailyNo()} · ${dailyLeft()}/${DAILY_TRIES} LEFT` : `ISO · ${levelLabel[level].toUpperCase()}`;
    requestAnimationFrame(() => sparkline(spark, g, rid));
  }

  function launch(asPractice: boolean) {
    practice = asPractice && !official;
    if (level === 'hard' && !hardUnlocked(g) && !practice) return;
    nav.play({ id: g.id, level, mode, practice, daily: official });
  }

  const back = h('button', { type: 'button', class: 'a-icon-btn', 'aria-label': 'Back' }, icon(icons.back));
  back.addEventListener('click', () => nav.back());

  const el = h(
    'div',
    { class: 'a-screen a-brief' },
    h('header', { class: 'a-top' }, back, h('div', null, label('SYS // ENGAGED'), h('div', { class: 'a-top-title' }, `EXP ${g.no} // ${g.name.toUpperCase()}`)), h('div', { class: 'a-row a-right' }, h('span', { class: 'a-live' }, h('i', { class: 'a-dot coral' }), `LIVE TELEMETRY // EXP_${g.no}`), status)),
    h(
      'div',
      { class: 'a-brief-cols' },
      h(
        'section',
        { class: 'a-brief-l' },
        label('APPARATUS BRIEFING'),
        h('h1', null, h('em', null, g.name)),
        h('p', { class: 'a-lede' }, g.tagline),
        h('div', { class: 'a-sec-row' }, label('CALIBRATION PROTOCOL'), resist),
        levelSeg.el,
        levelNote,
        modeSeg ? h('div', { class: 'a-sec-row' }, label('SCORING MODE')) : null,
        modeSeg?.el ?? null,
        modeSeg ? modeNote : null,
        frame(
          'a-guide',
          h('div', { class: 'a-guide-head' }, icon(icons.hand), label('TACTILE INTERACTION GUIDE')),
          h('ol', null, ...(g.steps ?? [g.howto]).map((s) => h('li', null, s))),
          h('p', { class: 'a-measure' }, label('MEASURES'), ' ', g.measures, ' · ', label('UNIT'), ' ', g.unit, ' · ', label('BETTER'), ' ', g.better),
        ),
      ),
      h(
        'section',
        { class: 'a-brief-r' },
        frame('a-viewport', h('div', { class: 'a-vp-hud tl' }, label(`EXP ${g.no} · ${g.categories.join(' · ')}`)), h('div', { class: 'a-vp-hud tr' }, label(`~${g.seconds}s`, 'teal')), loop.add(g.id), h('div', { class: 'a-vp-hud bl' }, label('VECTOR READY', 'teal'))),
        h('div', { class: 'a-sec-row' }, label('HISTORICAL METRICS'), label(levelLabel[level].toUpperCase(), 'teal')),
        statsBox,
        frame('a-spark-wrap', label('RECENT TRAJECTORY · RANKED RUNS'), spark),
        targets,
        launchBtn,
        official ? null : practiceBtn,
      ),
    ),
  );

  return {
    el,
    mounted: () => {
      paint();
      loop.kick();
    },
    destroy: () => loop.destroy(),
  };
}
