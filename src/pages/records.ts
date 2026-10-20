import { h } from '../core/dom';
import { font, pal, text } from '../core/draw';
import { clearAll, exportAll, importAll, journal, onRecords, setNote, stats, type JournalEntry, type RunKind } from '../core/records';
import { seedToString } from '../core/scoring';
import { LEVELS } from '../core/types';
import { byId, fmtScore, games, levelLabel, recId } from '../games/registry';
import { siteBar, siteFoot, toast, type Page } from './chrome';
import { href } from '../core/route';

function spark(cv: HTMLCanvasElement, data: number[], better: 'lower' | 'higher') {
  const W = 140;
  const H = 32;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = W * dpr;
  cv.height = H * dpr;
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (data.length < 2) {
    text(c, data.length ? '·' : '', 0, H / 2, font.mono(10), pal.ink3, 'left', 'middle');
    return;
  }
  const log = better === 'lower' && data.every((v) => v > 0);
  const f = (v: number) => (log ? Math.log10(v) : v);
  const vals = data.map(f);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals) + 1e-9;
  c.beginPath();
  vals.forEach((v, i) => {
    const n = (v - lo) / (hi - lo);
    const y = 3 + (better === 'lower' ? n : 1 - n) * (H - 6);
    const x = (i / (vals.length - 1)) * (W - 4) + 2;
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.strokeStyle = pal.ink;
  c.lineWidth = 1.25;
  c.stroke();
}

// ── Precision Profile ─────────────────────────────────────────────────────────
// Category-level view. Deliberately no universal score: ms, degrees, u and % cannot be added.
const PROFILE: { name: string; what: string; ids: string[] }[] = [
  { name: 'Timing & rhythm', what: 'producing and reproducing durations', ids: ['zero', 'echo', 'beat'] },
  { name: 'Spatial estimation', what: 'angles, vectors, averages and reflections', ids: ['exact', 'loop', 'center', 'mirror'] },
  { name: 'Motor control', what: 'steering and tracking moving systems', ids: ['stop', 'drift', 'shadow'] },
  { name: 'Drawing & shape memory', what: 'producing a shape or a line by hand', ids: ['draw', 'plumb'] },
  { name: 'Physical inference', what: 'deducing hidden quantities from behaviour', ids: ['balance'] },
  { name: 'Synchronisation & prediction', what: 'matching and meeting moving systems', ids: ['phase', 'intersect', 'pendulum'] },
  { name: 'Perception & memory', what: 'real geometry under illusions; signals from memory', ids: ['perception', 'afterimage', 'quantity', 'diff'] },
  { name: 'Fluids', what: 'volume, equilibrium and flow', ids: ['pour', 'vessels', 'valves'] },
  { name: 'Exact recall & keys', what: 'remembering text; pressing keys on time', ids: ['verbatim', 'letterfall'] },
  { name: 'Reasoning', what: 'inferring hidden rules; deducing; experimenting', ids: ['rules', 'weigh', 'hypothesis'] },
  { name: 'Quantity & shape', what: 'density, numerosity, area, length and overlap', ids: ['density', 'count', 'area', 'length', 'intersection'] },
  { name: 'Spatial & sequence memory', what: 'mental rotation; recalling a lit sequence (cells — higher is better)', ids: ['rotate', 'trace'] },
  { name: 'Prediction & attention', what: 'timing an unseen crossing; filtering a stream', ids: ['intercept', 'filter'] },
  { name: 'Mathematical construction', what: 'writing a function whose graph avoids obstacles', ids: ['fpath'] },
  { name: 'Stopping over terrain', what: 'braking across hills, ice and drag', ids: ['brake'] },
  { name: 'Reflexes at speed', what: 'steering through gaps at full speed (metres — higher is better)', ids: ['slipstream'] },
];
const MIN_RUNS = 5;

function profile() {
  return h(
    'div',
    { class: 'profile' },
    ...PROFILE.map((cat) => {
      const rows = cat.ids.map((id) => {
        const g = byId(id)!;
        const s = stats(id, g.better); // Medium, default scoring: the comparable baseline
        const enough = s.n >= MIN_RUNS && s.median10 != null;
        return h(
          'div',
          { class: 'prof-row' },
          h('a', { href: href(`/e/${id}`) }, g.name),
          enough
            ? h(
                'span',
                { class: 'mono' },
                `${fmtScore(g, s.median10)} ${g.unit}`,
                h('small', null, ` ±${fmtScore(g, s.spread10 ?? 0)}`),
                s.trend != null ? h('small', { class: s.trend > 0.02 ? 'up' : s.trend < -0.02 ? 'down' : '' }, s.trend > 0.02 ? ' ▲' : s.trend < -0.02 ? ' ▼' : ' —') : '',
              )
            : h('span', { class: 'cap' }, `not enough data · ${s.n}/${MIN_RUNS}`),
        );
      });
      return h('section', { class: 'prof-cat' }, h('h3', null, cat.name), h('p', { class: 'cap' }, cat.what), ...rows);
    }),
  );
}

// ── Journal ───────────────────────────────────────────────────────────────────
const KIND: Record<RunKind, string> = { ranked: 'ranked', daily: 'daily', practice: 'practice', challenge: 'challenge' };

function journalRow(e: JournalEntry) {
  const g = byId(e.game);
  if (!g) return null;
  const d = new Date(e.t);
  const note = h('input', { class: 'note', type: 'text', value: e.note ?? '', placeholder: 'note…', maxlength: '280', 'aria-label': `Note for ${g.name} run` });
  note.addEventListener('change', () => {
    setNote(e.recordId, e.t, note.value);
    toast(note.value.trim() ? 'Note saved' : 'Note removed');
  });
  const replay =
    e.seed != null
      ? (() => {
          const u = new URLSearchParams({ seed: seedToString(e.seed!) });
          if (e.level !== 'medium') u.set('level', e.level);
          if (e.mode && g.modes?.some((m) => m.id === e.mode) && e.mode !== g.modes[0].id) u.set('mode', e.mode);
          return h('a', { href: href(`/e/${g.id}?${u}`), title: 'Replay these exact conditions (as an unranked challenge)' }, seedToString(e.seed!));
        })()
      : h('span', { class: 'cap' }, '—');
  const modeName = e.mode ? (g.modes?.find((m) => m.id === e.mode)?.name ?? e.mode) : '';
  return h(
    'tr',
    { 'data-kind': e.kind },
    h('td', { class: 'mono' }, d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), h('br'), h('small', null, d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))),
    h('td', null, g.name, h('br'), h('small', { class: 'cap' }, [levelLabel[e.level], modeName].filter(Boolean).join(' · '))),
    h('td', { class: 'mono' }, `${fmtScore(g, e.s)} ${g.unit}`),
    h('td', null, h('span', { class: 'kind', 'data-kind': e.kind }, KIND[e.kind])),
    h('td', { class: 'mono hide-s' }, replay),
    h('td', { class: 'hide-s' }, note),
  );
}

export function recordsPage(): Page {
  const body = h('tbody');
  const profileHost = h('div');
  const jBody = h('tbody');
  const jGame = h('select', { 'aria-label': 'Filter by experiment' }, h('option', { value: '' }, 'All experiments'), ...games.map((g) => h('option', { value: g.id }, g.name)));
  const jKind = h(
    'select',
    { 'aria-label': 'Filter by run type' },
    h('option', { value: '' }, 'All runs'),
    ...(['ranked', 'daily', 'practice', 'challenge'] as RunKind[]).map((k) => h('option', { value: k }, KIND[k])),
  );
  const jCount = h('span', { class: 'cap' });
  const jMore = h('button', { class: 'btn quiet', type: 'button' }, 'Show more');
  let limit = 60;

  const paintJournal = () => {
    const all = journal().filter((e) => (!jGame.value || e.game === jGame.value) && (!jKind.value || e.kind === jKind.value));
    jBody.replaceChildren(...all.slice(0, limit).map(journalRow).filter((r): r is HTMLTableRowElement => !!r));
    jCount.textContent = `${all.length} ${all.length === 1 ? 'run' : 'runs'}`;
    jMore.hidden = all.length <= limit;
  };
  jGame.addEventListener('change', paintJournal);
  jKind.addEventListener('change', paintJournal);
  jMore.addEventListener('click', () => {
    limit += 120;
    paintJournal();
  });

  const paint = () => {
    body.replaceChildren(
      ...games.flatMap((g) => (g.modes ?? [undefined]).map((m) => ({ g, m }))).map(({ g, m }) => {
        const s = stats(recId(g.id, 'medium', m?.id), g.better);
        const per = LEVELS.map((l) => stats(recId(g.id, l, m?.id), g.better));
        const runs = per.reduce((a, x) => a + x.n, 0);
        const cv = h('canvas', { 'aria-hidden': 'true' });
        requestAnimationFrame(() => spark(cv, s.history, g.better));
        return h(
          'tr',
          null,
          h('td', { class: 'nm' }, h('span', { class: 'cap no' }, g.no), h('a', { href: href(m && m !== g.modes![0] ? `/e/${g.id}?mode=${m.id}` : `/e/${g.id}`) }, g.name), m ? h('span', { class: 'cap', style: 'margin-left:10px' }, m.label + ' ' + m.name) : ''),
          ...per.map((x, i) => h('td', { class: 'mono' + (i === 1 ? '' : ' hide-s') + (i === 2 && x.best != null ? ' hard' : '') }, x.best == null ? '—' : `${fmtScore(g, x.best)} ${g.unit}`)),
          h('td', { class: 'mono' }, String(runs)),
          h('td', { class: 'mono hide-s' }, s.median10 == null ? '—' : `${fmtScore(g, s.median10)} ± ${fmtScore(g, s.spread10 ?? 0)}`),
          h('td', { class: 'mono hide-s' }, s.trend == null ? '—' : (s.trend >= 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(s.trend) * 100) + '%'),
          h('td', { class: 'hide-s' }, cv),
        );
      }),
    );
    profileHost.replaceChildren(profile());
    paintJournal();
  };
  paint();

  const total = journal().length;
  const file = h('input', { type: 'file', accept: 'application/json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const added = importAll(await f.text());
      paint();
      toast(added ? `Imported ${added} runs` : 'Nothing new to import');
    } catch (e) {
      toast((e as Error).message);
    }
    file.value = '';
  });

  let armed = false;
  const resetBtn = h('button', { class: 'btn quiet', type: 'button' }, 'Erase all records');
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      resetBtn.textContent = 'Click again to erase';
      resetBtn.style.borderColor = 'var(--signal)';
      resetBtn.style.color = 'var(--signal)';
      setTimeout(() => {
        armed = false;
        resetBtn.textContent = 'Erase all records';
        resetBtn.style.cssText = '';
      }, 3000);
      return;
    }
    clearAll();
    paint();
    toast('Records erased');
  });

  const el = h(
    'div',
    null,
    siteBar('records'),
    h(
      'main',
      null,
      h(
        'header',
        { class: 'wrap page-head' },
        h('span', { class: 'cap' }, `${total} runs on this device`),
        h('h1', null, 'Records'),
        h(
          'p',
          null,
          'Your best, your typical run and whether you are getting better — always in each experiment’s own unit. Only ranked and daily runs count; practice and challenge runs are kept in the journal.',
        ),
      ),

      h(
        'section',
        { class: 'wrap rec-section' },
        h('h2', null, 'Precision profile'),
        h(
          'p',
          { class: 'rec-sub' },
          `Median of your last ten Medium runs ± spread, grouped by skill. There is no overall score: milliseconds, degrees and units can’t be added together. These groups describe how you did on these tasks — not a validated measure of any ability. At least ${MIN_RUNS} ranked runs are needed per experiment.`,
        ),
        profileHost,
      ),

      h(
        'section',
        { class: 'wrap rec-section' },
        h('h2', null, 'Every experiment'),
        h(
          'div',
          { style: 'overflow-x:auto' },
          h(
            'table',
            { class: 'rec-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                { class: 'cap' },
                h('th', null, 'Experiment'),
                h('th', { class: 'hide-s' }, 'Easy'),
                h('th', null, 'Medium'),
                h('th', { class: 'hide-s', style: 'color:var(--signal)' }, 'Hard'),
                h('th', null, 'Runs'),
                h('th', { class: 'hide-s', title: 'Median of the last 10 ranked Medium runs ± median absolute deviation' }, 'Median ± spread (M)'),
                h('th', { class: 'hide-s' }, 'Trend'),
                h('th', { class: 'hide-s' }, 'History'),
              ),
            ),
            body,
          ),
        ),
      ),

      h(
        'section',
        { class: 'wrap rec-section' },
        h('h2', null, 'Run journal'),
        h('p', { class: 'rec-sub' }, 'Every attempt, newest first. Click a seed to replay exactly those conditions (as an unranked challenge). Notes stay on this device.'),
        h('div', { class: 'j-filters' }, jGame, jKind, jCount),
        h(
          'div',
          { style: 'overflow-x:auto' },
          h(
            'table',
            { class: 'rec-table journal' },
            h(
              'thead',
              null,
              h('tr', { class: 'cap' }, h('th', null, 'When'), h('th', null, 'Experiment'), h('th', null, 'Score'), h('th', null, 'Type'), h('th', { class: 'hide-s' }, 'Seed'), h('th', { class: 'hide-s' }, 'Note')),
            ),
            jBody,
          ),
        ),
        jMore,
      ),

      h(
        'div',
        { class: 'wrap row-actions' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              const blob = new Blob([exportAll()], { type: 'application/json' });
              const a = h('a', { href: URL.createObjectURL(blob), download: `epsilon-records-${new Date().toISOString().slice(0, 10)}.json` });
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            },
          },
          'Export backup',
        ),
        h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Import backup'),
        resetBtn,
        file,
      ),
    ),
    siteFoot(),
  );
  const off = onRecords(() => profileHost.replaceChildren(profile()));
  return { el, title: 'Records — epsilon', destroy: off };
}
