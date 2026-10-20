// LAB — the app's library: status strip, the daily protocol, the four leading experiments as large featured
// cards, then every experiment in play order, filterable by what it challenges.
import { h, icon, icons } from '../core/dom';
import { bestStars, playStreak, totalStars } from '../core/progress';
import { stats } from '../core/records';
import type { Category, GameMeta } from '../core/types';
import { categories, DAILY_TRIES, dailyGame, dailyKey, dailyNo, fmtScore, games } from '../games/registry';
import type { Nav, Screen } from './app';
import { frame, label, PreviewLoop } from './ui';

const FEATURED = 4;

export function labScreen(nav: Nav): Screen {
  const loop = new PreviewLoop();
  const t = totalStars();
  const st = playStreak();

  const card = (g: GameMeta, big: boolean) => {
    const s = stats(g.id, g.better);
    const stars = Math.max(bestStars(g, 'easy'), bestStars(g, 'medium'), bestStars(g, 'hard'));
    const el = h(
      'button',
      { type: 'button', class: `a-card ${big ? 'big' : ''}`, 'data-cats': g.categories.join(' ') },
      h('div', { class: 'a-card-top' }, label(`EXP ${g.no}${big ? ' // FEATURED' : ''}`, big ? 'gold' : ''), label(g.categories.slice(0, 2).join(' · '))),
      h('div', { class: 'a-card-viz' }, loop.add(g.id)),
      h('h3', null, g.name),
      h('p', null, g.tagline),
      h(
        'div',
        { class: 'a-card-foot' },
        h('div', null, label('MEASURES'), h('span', { class: 'teal mono' }, g.measures)),
        h('div', { class: 'r' }, label('BEST'), h('span', { class: 'mono' }, s.best == null ? '—' : `${fmtScore(g, s.best)} ${g.unit}`), h('span', { class: 'a-stars' }, '★'.repeat(stars) + '☆'.repeat(3 - stars))),
      ),
    );
    el.addEventListener('click', () => nav.briefing(g.id));
    return el;
  };

  const dg = dailyGame();
  const dTries = stats(dg.id, dg.better).dailyCount(dailyKey());
  const daily = frame(
    'a-daily',
    h('div', { class: 'a-daily-l' }, h('div', { class: 'a-row' }, label(`DAILY NO. ${dailyNo()}`, 'gold'), label(`· ${Math.max(0, DAILY_TRIES - dTries)} ATTEMPTS REMAIN`)), h('h3', null, dg.name), h('p', null, 'Identical initial conditions worldwide')),
    (() => {
      const b = h('button', { type: 'button', class: 'a-btn primary' }, h('span', null, dTries >= DAILY_TRIES ? 'PRACTICE' : dTries ? 'CONTINUE' : 'BEGIN'), icon(icons.arrow));
      b.addEventListener('click', () => nav.briefing(dg.id, true));
      return b;
    })(),
  );

  const featured = games.slice(0, FEATURED).map((g) => card(g, true));
  const rest = games.slice(FEATURED).map((g) => card(g, false));
  let filter: Category | 'all' = 'all';
  const chips = h('div', { class: 'a-chips' });
  const paintChips = () =>
    chips.replaceChildren(
      ...([{ id: 'all', label: 'All' }, ...categories] as { id: string; label: string }[]).map((c) => {
        const n = c.id === 'all' ? games.length : games.filter((g) => g.categories.includes(c.id as Category)).length;
        const b = h('button', { type: 'button', class: 'a-chip', 'aria-pressed': String(filter === c.id) }, `${c.label.toUpperCase()} ${n}`);
        b.addEventListener('click', () => {
          filter = c.id as typeof filter;
          [...featured, ...rest].forEach((el, i) => (el.hidden = filter !== 'all' && !games[i].categories.includes(filter as Category)));
          paintChips();
          loop.kick();
        });
        return b;
      }),
    );
  paintChips();

  const el = h(
    'div',
    { class: 'a-screen a-lab' },
    h(
      'header',
      { class: 'a-strip' },
      h('span', { class: 'a-label teal' }, h('i', { class: 'a-sq' }), `APPARATUS ONLINE // ${games.length} PROTOCOLS`),
      h('div', { class: 'a-row' }, h('span', { class: 'a-badge' }, `${t.earned} / ${t.possible} ★`), st.days ? h('span', { class: 'a-badge gold' }, `${st.days}-DAY STREAK`) : null, h('span', { class: 'a-badge' }, 'OFFLINE READY')),
    ),
    h(
      'section',
      { class: 'a-hero' },
      h('div', null, h('h1', null, 'How ', h('em', { class: 'teal' }, 'close'), h('br'), 'can you ', h('em', { class: 'coral' }, 'get?')), h('p', { class: 'a-lede' }, 'Tiny experiments in timing, aiming, memory, balance and control. ', h('b', null, 'A thousandth of a second. A tenth of a degree.'))),
      daily,
    ),
    h('section', null, h('div', { class: 'a-sec-head' }, h('h2', null, 'Featured ', h('em', null, 'protocols')), label('MOST PLAYED · START HERE', 'gold')), h('div', { class: 'a-featured' }, ...featured)),
    h('section', null, h('div', { class: 'a-sec-head' }, h('h2', null, h('em', null, 'Experiments')), label(`${String(FEATURED + 1).padStart(2, '0')} — ${games.length}`)), chips, h('div', { class: 'a-grid' }, ...rest)),
    h('footer', { class: 'a-foot' }, h('p', null, '“A thousandth of a second. A tenth of a degree.”'), label('EPSILON LOCAL APPARATUS · NO NETWORK REQUIRED')),
  );

  return { el, tab: 'lab', mounted: () => loop.kick(), destroy: () => loop.destroy() };
}
