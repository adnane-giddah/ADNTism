// TELEMETRY — your records. Left: every experiment with its best and stars. Right: the selected
// experiment's vault — per-level bests, the trajectory of ranked runs, and the recent run log.
import { h } from '../core/dom';
import { bestStars, hardUnlocked, playStreak, totalStars } from '../core/progress';
import { journal, stats } from '../core/records';
import { seedToString } from '../core/scoring';
import { LEVELS } from '../core/types';
import { byId, fmtScore, games, levelLabel, recId } from '../games/registry';
import type { Nav, Screen } from './app';
import { btn, frame, label, metric, sparkline } from './ui';

export function telemetryScreen(nav: Nav, startId?: string): Screen {
  const all = journal();
  const played = new Set(all.map((e) => e.game));
  let sel = startId ?? games.find((g) => played.has(g.id))?.id ?? games[0].id;
  const t = totalStars();
  const st = playStreak();

  const list = h('div', { class: 't-list' });
  const vault = h('div', { class: 't-vault' });

  function paintList() {
    list.replaceChildren(
      ...games.map((g) => {
        const s = stats(g.id, g.better);
        const stars = LEVELS.reduce((a, l) => a + bestStars(g, l), 0);
        const b = h(
          'button',
          { type: 'button', class: 't-row', 'aria-current': g.id === sel ? 'true' : null },
          h('span', { class: 'a-label' }, g.no),
          h('span', { class: 't-name' }, g.name),
          h('span', { class: 'mono t-best' }, s.best == null ? '—' : `${fmtScore(g, s.best)} ${g.unit}`),
          h('span', { class: 'a-stars' }, stars ? `${stars}★` : ''),
        );
        b.addEventListener('click', () => {
          sel = g.id;
          paintList();
          paintVault();
        });
        return b;
      }),
    );
  }

  function paintVault() {
    const g = byId(sel)!;
    const rows = LEVELS.map((l) => {
      const s = stats(recId(g.id, l), g.better);
      const locked = l === 'hard' && !hardUnlocked(g);
      return h(
        'div',
        { class: 't-level' },
        label(levelLabel[l].toUpperCase(), l === 'hard' ? 'coral' : l === 'easy' ? 'gold' : 'teal'),
        h('b', { class: 'mono' }, s.best == null ? '—' : `${fmtScore(g, s.best)}`),
        h('small', null, s.best == null ? (locked ? 'locked' : 'no runs') : g.unit),
        h('span', { class: 'a-stars' }, '★'.repeat(bestStars(g, l)) + '☆'.repeat(3 - bestStars(g, l))),
        h('span', { class: 'a-label' }, `${s.n} RUNS`),
      );
    });
    const m = stats(recId(g.id, 'medium'), g.better);
    const spark = h('canvas', { class: 'a-spark tall' });
    const log = all.filter((e) => e.game === g.id).slice(-8).reverse();
    vault.replaceChildren(
      h('div', { class: 'a-sec-row' }, label(`ACTIVE CHAMBER // EXP ${g.no}`, 'teal'), btn('OPEN BRIEFING', () => nav.briefing(g.id), { kind: 'primary', cls: 'sm' })),
      h('h1', null, h('em', null, g.name)),
      h('div', { class: 't-levels' }, ...rows),
      h('div', { class: 'a-metrics three' }, metric('MEDIAN · LAST 10', m.median10 == null ? '—' : fmtScore(g, m.median10), m.median10 == null ? '' : g.unit, 'medium, ranked', 'blue'), metric('SPREAD', m.spread10 == null ? '—' : '±' + fmtScore(g, m.spread10), m.spread10 == null ? '' : g.unit, 'run-to-run', 'coral'), metric('TREND', m.trend == null ? '—' : `${m.trend > 0 ? '▲' : '▼'} ${Math.abs(Math.round(m.trend * 100))}%`, '', 'vs your first runs', 'teal')),
      frame('a-spark-wrap', label('PILOT TRAJECTORY · MEDIUM · RANKED'), spark),
      h('div', { class: 'a-sec-row' }, label('TRIAL RUN LOG'), label('RECENT')),
      log.length
        ? h(
            'div',
            { class: 't-log' },
            ...log.map((e) =>
              h(
                'div',
                { class: 't-log-row' },
                label(new Date(e.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
                h('span', { class: `a-badge ${e.level === 'hard' ? 'coral' : e.level === 'easy' ? 'gold' : ''}` }, e.level.toUpperCase()),
                h('b', { class: 'mono' }, `${fmtScore(g, e.s)} ${g.unit}`),
                label(e.kind.toUpperCase(), e.kind === 'ranked' || e.kind === 'daily' ? 'teal' : ''),
                e.seed != null ? label(`SEED ${seedToString(e.seed)}`) : null,
              ),
            ),
          )
        : h('p', { class: 'a-note' }, 'No runs recorded yet — launch it from the briefing.'),
    );
    requestAnimationFrame(() => sparkline(spark, g, recId(g.id, 'medium')));
  }

  const el = h(
    'div',
    { class: 'a-screen a-telemetry' },
    h('header', { class: 'a-strip' }, h('span', { class: 'a-label teal' }, h('i', { class: 'a-sq' }), 'PROTOCOL // TELEMETRY VAULT'), h('div', { class: 'a-row' }, h('span', { class: 'a-badge' }, `${t.earned} / ${t.possible} ★`), h('span', { class: 'a-badge gold' }, `${st.days}-DAY STREAK`), h('span', { class: 'a-badge' }, `${all.length} RUNS LOGGED`))),
    h('div', { class: 't-cols' }, list, vault),
  );
  return {
    el,
    tab: 'telemetry',
    mounted: () => {
      paintList();
      paintVault();
      list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
    },
  };
}
