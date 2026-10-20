import { h, icon, icons } from '../core/dom';
import { onRecords, stats } from '../core/records';
import { reducedMotion } from '../core/settings';
import type { Category, GameMeta, Level } from '../core/types';
import { bestStars, hardUnlocked, playStreak, totalStars } from '../core/progress';
import { categories, DAILY_TRIES, dailyGame, dailyKey, dailyNo, fmtScore, games } from '../games/registry';
import { calibration } from './calibrate';
import { siteBar, siteFoot, type Page } from './chrome';
import { previews } from './previews';
import { href } from '../core/route';
import { getAppSection } from './getapp';

function ticks(n: number) {
  return h(
    'span',
    { class: 'ticks', 'aria-label': `difficulty ${n} of 5` },
    ...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= n ? '' : 'off' })),
  );
}

function specimen(g: GameMeta, canvases: Map<HTMLCanvasElement, string>) {
  const s = stats(g.id, g.better);
  const cv = h('canvas', { 'aria-hidden': 'true' });
  canvases.set(cv, g.id);
  const best = h('span', { class: 'v best' }, s.best == null ? '—' : `${fmtScore(g, s.best)} ${g.unit}`);
  // Star progress per level: E ★★☆ · M ★☆☆ · H ☆☆☆ (Hard shows locked until ★ on Medium).
  const starsEl = h('div', { class: 'spec-stars' });
  const paintStars = () =>
    starsEl.replaceChildren(
      ...(['easy', 'medium', 'hard'] as Level[]).flatMap((l, i) => {
        const n = bestStars(g, l);
        const lock = l === 'hard' && !hardUnlocked(g);
        return [i ? ' · ' : '', `${l[0].toUpperCase()} `, lock ? h('span', { title: 'Earn ★ on Medium to unlock Hard' }, 'locked') : h('b', null, '★'.repeat(n)), lock ? '' : '☆'.repeat(3 - n)];
      }),
    );
  paintStars();
  const el = h(
    'a',
    { class: 'spec', href: href(`/e/${g.id}`), 'data-cats': g.categories.join(' ') },
    h('div', { class: 'spec-top' }, h('span', { class: 'cap spec-no' }, 'EXP ' + g.no), h('span', { class: 'cap spec-cat' }, g.categories.join(' · '))),
    h('div', { class: 'spec-viz' }, cv),
    h('h3', null, g.name, h('span', { class: 'spec-go' }, icon(icons.arrow))),
    h('p', null, g.tagline),
    g.stars ? starsEl : null,
    h(
      'div',
      { class: 'spec-meta' },
      h('div', null, h('span', { class: 'cap' }, 'Measures'), h('span', { class: 'v' }, `${g.measures}`)),
      h('div', null, h('span', { class: 'cap' }, 'Best'), best),
      h('div', null, h('span', { class: 'cap' }, `~${g.seconds}s`), ticks(g.difficulty)),
    ),
  );
  return {
    el,
    refresh: () => {
      const b = stats(g.id, g.better).best;
      best.textContent = b == null ? '—' : `${fmtScore(g, b)} ${g.unit}`;
      paintStars();
    },
  };
}

function dailyBand() {
  const g = dailyGame();
  const key = dailyKey();
  const s = stats(g.id, g.better);
  const tries = s.dailyCount(key);
  const best = s.dailyBest(key);
  return h(
    'section',
    { class: 'band', 'aria-label': 'Daily experiment' },
    h(
      'div',
      { class: 'wrap' },
      h('span', { class: 'cap' }, `Daily No. ${dailyNo()}`),
      h(
        'div',
        { class: 'what' },
        h('span', { class: 'nm' }, g.name),
        h('span', { class: 'cap' }, 'Same conditions for everyone today'),
        h(
          'span',
          { class: 'cap', style: 'color:var(--ink)' },
          tries ? `Your best ${fmtScore(g, best)} ${g.unit} · ${Math.min(tries, DAILY_TRIES)}/${DAILY_TRIES} official tries` : `${DAILY_TRIES} official tries`,
        ),
      ),
      h('a', { class: 'btn go', href: href(`/e/${g.id}?daily`) }, tries >= DAILY_TRIES ? 'Practice' : tries ? 'Continue' : 'Begin', icon(icons.arrow)),
    ),
  );
}

export function homePage(): Page {
  const cal = calibration();
  const canvases = new Map<HTMLCanvasElement, string>();
  const specs = games.map((g) => specimen(g, canvases));
  let filter: Category | 'all' = 'all';

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by what you want to challenge' });
  const paintChips = () => {
    chips.replaceChildren(
      ...([{ id: 'all', label: 'All', hint: 'everything' }, ...categories] as const).map((c) => {
        const n = c.id === 'all' ? games.length : games.filter((g) => g.categories.includes(c.id as Category)).length;
        return h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(filter === c.id),
            title: c.hint,
            onclick: () => {
              filter = c.id as typeof filter;
              specs.forEach((s, i) => {
                s.el.hidden = filter !== 'all' && !games[i].categories.includes(filter as Category);
              });
              paintChips();
              kick();
            },
          },
          c.label,
          h('span', { class: 'n' }, n),
        );
      }),
    );
  };
  paintChips();
  const getApp = getAppSection();

  const el = h(
    'div',
    null,
    siteBar('experiments'),
    h(
      'main',
      null,
      h(
        'section',
        { class: 'wrap hero' },
        h(
          'div',
          null,
          h('div', { class: 'eyebrow cap' }, h('i', { class: 'live-dot' }), '00 · Calibration', h('span', { class: 'sep' }, '/'), 'Precision reaction laboratory'),
          h('h1', null, 'How ', h('em', null, 'close'), h('br'), 'can you get', h('span', { class: 'q' }, '?')),
          h(
            'p',
            { class: 'lede' },
            'Tiny experiments in timing, aiming, memory, balance and control. ',
            h('b', null, 'A thousandth of a second. A tenth of a degree. Three pixels.'),
            ' Each one takes a second to understand and much longer to get right.',
          ),
          h(
            'ul',
            { class: 'facts cap' },
            h('li', null, `${games.length} experiments`),
            h('li', null, (() => {
              const t = totalStars();
              return `${t.earned} / ${t.possible} ★`;
            })()),
            (() => {
              const st = playStreak();
              return st.days ? h('li', null, `${st.days}-day streak${st.playedToday ? '' : ' · play today to keep it'}`) : null;
            })(),
            h('li', null, 'no account'),
            h('li', null, 'works offline'),
          ),
        ),
        cal.el,
      ),
      dailyBand(),
      getApp.el,
      h(
        'section',
        { class: 'wrap', id: 'experiments', 'aria-label': 'Experiments' },
        h('div', { class: 'index-head' }, h('h2', null, h('em', null, 'Experiments'), h('sup', null, `01—${String(games.length).padStart(2, '0')}`)), chips),
        h('div', { class: 'specimens' }, ...specs.map((s) => s.el)),
      ),
    ),
    siteFoot(),
  );

  // One shared animation loop for all previews; only visible ones are drawn.
  const visible = new Set<HTMLCanvasElement>();
  const sizes = new Map<HTMLCanvasElement, { w: number; h: number; dpr: number }>();
  let raf = 0;
  const t0 = performance.now();
  const frame = (now: number) => {
    raf = 0;
    const still = reducedMotion();
    const t = still ? 2.6 : (now - t0) / 1000;
    for (const cv of visible) {
      const sz = sizes.get(cv);
      if (!sz) continue;
      const c = cv.getContext('2d')!;
      c.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
      c.clearRect(0, 0, sz.w, sz.h);
      previews[canvases.get(cv)!]?.(c, sz.w, sz.h, t + (canvases.get(cv)!.length % 3) * 0.7);
    }
    if (!still && visible.size && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const cv = e.target as HTMLCanvasElement;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = e.contentRect.width;
      const hh = e.contentRect.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hh * dpr);
      sizes.set(cv, { w, h: hh, dpr });
    }
    kick();
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const cv = e.target as HTMLCanvasElement;
      if (e.isIntersecting) visible.add(cv);
      else visible.delete(cv);
    }
    kick();
  });
  canvases.forEach((_, cv) => {
    ro.observe(cv);
    io.observe(cv);
  });
  const onVis = () => !document.hidden && kick();
  document.addEventListener('visibilitychange', onVis);
  void document.fonts?.ready.then(kick);
  const off = onRecords(() => specs.forEach((s) => s.refresh()));

  return {
    el,
    title: 'epsilon — how close can you get?',
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      off();
      getApp.destroy();
      cal.destroy();
    },
  };
}
