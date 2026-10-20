import { h, icon, icons } from '../core/dom';
import { stats } from '../core/records';
import { DAILY_TRIES, dailyGame, dailyKey, dailyNo, fmtScore } from '../games/registry';
import { siteBar, siteFoot, type Page } from './chrome';
import { previews } from './previews';
import { reducedMotion } from '../core/settings';
import { href } from '../core/route';

function dayOffset(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function streak() {
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const d = dayOffset(i);
    const g = dailyGame(d);
    const played = stats(g.id, g.better).dailyCount(dailyKey(d)) > 0;
    if (played) n++;
    else if (i > 0) break; // today not played yet doesn't break the streak
  }
  return n;
}

export function dailyPage(): Page {
  const g = dailyGame();
  const key = dailyKey();
  const s = stats(g.id, g.better);
  const tries = s.dailyCount(key);
  const best = s.dailyBest(key);

  const clock = h('span', { class: 'mono', style: 'font-size:22px' });
  const tick = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    const p = (v: number) => String(Math.floor(v)).padStart(2, '0');
    clock.textContent = `${p(ms / 3600000)}:${p((ms / 60000) % 60)}:${p((ms / 1000) % 60)}`;
  };
  tick();
  const timer = window.setInterval(tick, 1000);

  const cv = h('canvas', { 'aria-hidden': 'true', style: 'position:absolute;inset:0;width:100%;height:100%' });
  let raf = 0;
  const draw = (now: number) => {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(r.width * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    previews[g.id](c, r.width, r.height, reducedMotion() ? 2.6 : now / 1000);
    if (!reducedMotion()) raf = requestAnimationFrame(draw);
  };

  const past = h(
    'div',
    { class: 'specimens', style: 'grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-top:16px' },
    ...Array.from({ length: 14 }, (_, i) => {
      const d = dayOffset(i);
      const pg = dailyGame(d);
      const b = stats(pg.id, pg.better).dailyBest(dailyKey(d));
      return h(
        'div',
        { class: 'spec', style: 'min-height:0;padding:12px 14px;gap:6px' },
        h('span', { class: 'cap' }, i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })),
        h('span', { style: 'font:400 24px/1 var(--serif)' }, pg.name),
        h('span', { class: 'mono', style: `font-size:13px;color:${b == null ? 'var(--ink-3)' : 'var(--ink)'}` }, b == null ? 'not played' : `${fmtScore(pg, b)} ${pg.unit}`),
      );
    }),
  );

  const el = h(
    'div',
    null,
    siteBar('daily'),
    h(
      'main',
      null,
      h(
        'header',
        { class: 'wrap page-head daily-head' },
        h(
          'div',
          null,
          h('span', { class: 'cap' }, `Daily experiment No. ${dailyNo()} · ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}`),
          h('h1', null, g.name),
          h('p', null, g.tagline),
          h(
            'p',
            { class: 'cap', style: 'color:var(--ink)' },
            'Same seed, same targets, same conditions for everyone today. ',
            `${DAILY_TRIES} official tries — your best counts.`,
          ),
          h(
            'div',
            { style: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:24px;align-items:center' },
            h(
              'a',
              { class: 'btn primary', href: href(`/e/${g.id}?daily`) },
              tries >= DAILY_TRIES ? 'Practice' : tries ? `Continue · try ${tries + 1}/${DAILY_TRIES}` : 'Begin',
              icon(icons.arrow),
            ),
            h('span', { class: 'cap' }, tries ? `Today's best: ${fmtScore(g, best)} ${g.unit}` : 'Not attempted yet'),
          ),
        ),
        h('div', { class: 'frame', style: 'position:relative;aspect-ratio:4/3;max-height:380px' }, cv),
      ),
      h(
        'section',
        { class: 'wrap', style: 'padding-top:28px;padding-bottom:80px' },
        h(
          'div',
          { style: 'display:flex;flex-wrap:wrap;gap:12px 48px' },
          h('div', { class: 'ro' }, h('span', { class: 'cap' }, 'Next experiment in'), clock),
          h('div', { class: 'ro' }, h('span', { class: 'cap' }, 'Streak'), h('span', { class: 'mono', style: 'font-size:22px' }, `${streak()} d`)),
        ),
        h('h2', { style: 'font:400 34px/1 var(--serif);margin:44px 0 0' }, 'The last two weeks'),
        past,
        h(
          'p',
          { class: 'cap', style: 'margin-top:16px' },
          'Results are kept on this device. Share your card to compare — a global board needs a server, and this lab has none yet.',
        ),
      ),
    ),
    siteFoot(),
  );

  return {
    el,
    title: `Daily No. ${dailyNo()} — epsilon`,
    mounted: () => (raf = requestAnimationFrame(draw)),
    destroy: () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
    },
  };
}
