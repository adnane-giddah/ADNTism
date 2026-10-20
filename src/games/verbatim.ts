// 22 · VERBATIM — read a passage, it disappears, write it back exactly.
// Scoring is transparent and stated before each round:
//   • spaces are collapsed and curly quotes / dashes are normalised — layout noise doesn't count;
//   • capitalisation and punctuation DO count;
//   • primary score: character error rate = edit distance ÷ original length (%);
//   • details: word accuracy, omissions, insertions, substitutions (word-level alignment), case-only and
//     punctuation-only slips. It is not a typing-speed test: time is never scored.
import { font, hair, line, pal, text } from '../core/draw';
import { gameKey, listen, primary } from '../core/input';
import { alpha, bar, plate, rr, slot } from '../core/materials';
import { rng } from '../core/rng';
import type { GameFactory, Level } from '../core/types';

// Original passages, written for epsilon.
const SHORT = [
  'The kettle sings before the water boils.',
  'Seven crows sat on the cold copper roof.',
  'A thin moon hung over the quiet harbour.',
  'She folded the map along its oldest crease.',
  'Rain erased the chalk lines by noon.',
  'The clock in the hallway runs four minutes fast.',
  'He kept the brass key in a tin of buttons.',
  'Every lamp on the bridge flickered twice.',
  'The orchard smelled of cut grass and pears.',
  'Two violins tuned against one patient piano.',
  'Salt dried white on the edge of the boat.',
  'Our neighbour paints her door a new colour every spring.',
];
const MEDIUM = [
  'The lighthouse keeper wrote one line each evening: the wind, the swell, and whether any ship had passed.',
  'If you hold a spoon close to a running tap, the water bends toward it, curving like a ribbon in the light.',
  'At the market, the fishmonger weighed everything twice; once for the customer, and once, quietly, for himself.',
  'Glaciers move so slowly that a stone dropped on the ice today may reach the valley in three hundred years.',
  'My grandmother never measured flour. She lifted the bowl, felt its weight, and said, "That will do."',
  'The night train stopped at a station with no name, waited exactly four minutes, and left without a single passenger.',
  'A good paper aeroplane needs a sharp fold at the nose, a little weight up front, and a calm afternoon.',
  'In the archive, every letter was kept flat in grey boxes, labelled by year, then by sender, then by mood.',
  'The pianist paused before the final chord, and for one long second the whole hall forgot to breathe.',
  'Bees returning to the hive dance a figure eight; its angle points the others toward the flowers.',
];
const LONG = [
  'The surveyors arrived in March with tripods, chains and a notebook bound in green cloth. For six weeks they measured the valley, the river and the slope of every field; in the evenings they argued, politely, about a single stubborn hill that refused to agree with their map.',
  'When the power failed, the town did not panic. Candles appeared in windows, someone carried a radio into the square, and the baker, who had a wood oven, kept working until dawn. By morning, the whole street smelled of bread and smoke, and nobody wanted the lights back.',
  'An astronomer once explained that most of the stars we see tonight are older than any mountain, and some have already gone dark. "You are reading a letter," she said, "sent long ago by someone who may no longer be there." Then she closed the dome and went home.',
  'The old ferry crossed the lake nine times a day, always at twenty past the hour. Its captain knew every rock beneath the surface, every heron on the shore and every passenger by name; when he finally retired, the ferry kept the same timetable, but it never felt quite on time again.',
  'In a small workshop at the end of the lane, a clockmaker repaired watches that no one else would touch. He worked with a loupe in one eye and a radio murmuring in the corner, and he charged, without exception, exactly what he thought the owner could afford.',
  'Water expands when it freezes, which is why pipes burst in winter and why ice floats instead of sinking. If it behaved like most liquids, lakes would freeze from the bottom up, and the fish that sleep beneath the ice each January would have nowhere left to wait for spring.',
];

export interface VerbatimRound {
  text: string;
  show: number; // seconds of viewing (ignored in Relaxed mode)
}

export function makeVerbatim(seed: number, level: Level): VerbatimRound[] {
  const r = rng(seed);
  const pick = (arr: string[], n: number) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  };
  if (level === 'easy') return pick(SHORT, 3).map((t) => ({ text: t, show: 6 }));
  if (level === 'medium') return pick(MEDIUM, 2).map((t) => ({ text: t, show: 12 }));
  return pick(LONG, 1).map((t) => ({ text: t, show: 25 }));
}

// ── Scoring (pure) ────────────────────────────────────────────────────────────

/** Layout noise only: trim, collapse whitespace, straighten quotes, unify dashes and ellipses. */
export function normalize(s: string) {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein distance (insert, delete, substitute = 1). */
export function editDistance<T>(a: ArrayLike<T>, b: ArrayLike<T>, eq: (x: T, y: T) => boolean = (x, y) => x === y) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (eq(a[i - 1], b[j - 1]) ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export type WordOp = { op: 'ok' | 'sub' | 'omit' | 'insert'; orig?: string; mine?: string };

/** Word-level alignment with a backtrace: which original words were kept, changed, left out or added. */
export function alignWords(orig: string[], mine: string[]): WordOp[] {
  const m = orig.length;
  const n = mine.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (orig[i - 1] === mine[j - 1] ? 0 : 1));
  const ops: WordOp[] = [];
  let i = m;
  let j = n;
  // On ties, prefer keeping a word and reporting an omission / insertion over two substitutions: "on left
  // out, big added" tells you more about what you remembered than "on → the, the → big".
  while (i > 0 || j > 0) {
    const match = i > 0 && j > 0 && orig[i - 1] === mine[j - 1];
    if (match && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ op: 'ok', orig: orig[i - 1], mine: mine[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'omit', orig: orig[i - 1] });
      i--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      ops.push({ op: 'insert', mine: mine[j - 1] });
      j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ op: 'sub', orig: orig[i - 1], mine: mine[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'omit', orig: orig[i - 1] });
      i--;
    } else {
      ops.push({ op: 'insert', mine: mine[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

const stripPunct = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '');

export function scoreRecall(original: string, typed: string) {
  const o = normalize(original);
  const t = normalize(typed);
  const chars = editDistance(o, t);
  const cer = (chars / Math.max(1, o.length)) * 100;
  const ow = o ? o.split(' ') : [];
  const tw = t ? t.split(' ') : [];
  const ops = alignWords(ow, tw);
  const count = (k: WordOp['op']) => ops.filter((x) => x.op === k).length;
  const subs = ops.filter((x) => x.op === 'sub');
  const caseOnly = subs.filter((x) => x.orig!.toLowerCase() === x.mine!.toLowerCase()).length;
  const punctOnly = subs.filter((x) => x.orig!.toLowerCase() !== x.mine!.toLowerCase() && stripPunct(x.orig!).toLowerCase() === stripPunct(x.mine!).toLowerCase()).length;
  return {
    cer,
    chars,
    length: o.length,
    words: ow.length,
    wordAcc: ow.length ? (count('ok') / ow.length) * 100 : 100,
    ok: count('ok'),
    subs: subs.length,
    omissions: count('omit'),
    insertions: count('insert'),
    caseOnly,
    punctOnly,
    ops,
  };
}

/** Greedy word wrap for canvas text. */
export function wrap(c: CanvasRenderingContext2D, s: string, width: number) {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width > width && cur) {
      out.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

const DELAY = 6; // s, Delayed mode

const factory: GameFactory = (api) => {
  const { stage } = api;
  let rounds: VerbatimRound[] = [];
  let round = 0;
  let phase: 'ready' | 'show' | 'delay' | 'recall' | 'reveal' | 'done' = 'ready';
  let phaseAt = 0;
  let timer = 0;
  let finTimer = 0;
  let results: ReturnType<typeof scoreRecall>[] = [];
  let answers: string[] = [];
  const relaxed = () => api.mode === 'relaxed';
  const delayed = () => api.mode === 'delayed';

  // A real text field for the answer (mobile keyboards, IME, accessibility). Spellcheck and autocorrect
  // are off: they would "remember" for you.
  const host = stage.canvas.parentElement!;
  const ta = document.createElement('textarea');
  ta.className = 'text-answer';
  ta.setAttribute('spellcheck', 'false');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocorrect', 'off');
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('aria-label', 'Your recall of the passage');
  ta.placeholder = 'Type it exactly as you read it… (Enter to check)';
  ta.hidden = true;
  host.append(ta);
  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'btn primary text-check';
  checkBtn.textContent = 'Check';
  checkBtn.style.display = 'none';
  checkBtn.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);z-index:2';
  host.append(checkBtn);

  const placeField = () => {
    const top = 96 * stage.k;
    ta.style.top = top + 'px';
    const hgt = Math.max(110, Math.min(260, stage.h * 0.35)) * stage.k;
    ta.style.height = hgt + 'px';
    checkBtn.style.top = top + hgt + 14 + 'px';
  };

  const rules = 'Capitalisation and punctuation count · extra spaces don’t · time is not scored';

  function readyPrompt() {
    const rd = rounds[round];
    const words = rd.text.split(' ').length;
    api.progress(`${round + 1} / ${rounds.length}`);
    api.prompt(
      `A passage of ${words} words. ${relaxed() ? 'Read it as long as you like.' : `You get ${rd.show} s.`}${delayed() ? ` Then ${DELAY} s of nothing.` : ''}`,
      `Press to read · ${rules}`,
    );
  }

  function reset(seed: number) {
    clearTimeout(timer);
    clearTimeout(finTimer);
    rounds = makeVerbatim(seed, api.level);
    round = 0;
    results = [];
    answers = [];
    phase = 'ready';
    ta.hidden = true;
    checkBtn.style.display = 'none';
    ta.value = '';
    readyPrompt();
    stage.request();
  }

  function show() {
    const rd = rounds[round];
    phase = 'show';
    phaseAt = performance.now();
    clearTimeout(timer);
    if (relaxed()) api.prompt('Read. Press when you are ready to write it.', rules);
    else {
      api.prompt('Read.', rules);
      timer = window.setTimeout(endShow, rd.show * 1000);
    }
    stage.request();
  }

  function endShow() {
    if (phase !== 'show') return;
    clearTimeout(timer);
    if (delayed()) {
      phase = 'delay';
      phaseAt = performance.now();
      api.prompt('Hold it…', `${DELAY} s`);
      timer = window.setTimeout(recall, DELAY * 1000);
    } else recall();
    stage.request();
  }

  function recall() {
    phase = 'recall';
    placeField();
    ta.value = '';
    ta.hidden = false;
    checkBtn.style.display = '';
    api.prompt('Write it back, exactly.', rules);
    ta.focus();
    stage.request();
  }

  function check() {
    if (phase !== 'recall') return;
    const rd = rounds[round];
    answers.push(ta.value);
    results.push(scoreRecall(rd.text, ta.value));
    api.judge(results[results.length - 1].cer);
    ta.hidden = true;
    checkBtn.style.display = 'none';
    ta.blur();
    stage.canvas.parentElement?.focus({ preventScroll: true });
    phase = 'reveal';
    phaseAt = performance.now();
    const s = results[results.length - 1];
    api.sfx.release();
    api.prompt(
      `${s.cer.toFixed(1)}% character error · ${s.ok} of ${s.words} words exact.`,
      `${s.omissions} left out · ${s.insertions} added · ${s.subs} changed${s.caseOnly ? ` (${s.caseOnly} only in capitals)` : ''}${s.punctOnly ? ` (${s.punctOnly} only in punctuation)` : ''}${round < rounds.length - 1 ? ' · tap for the next' : ''}`,
    );
    if (round === rounds.length - 1) finish();
    stage.request();
  }
  checkBtn.addEventListener('click', check);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      check();
    }
  });

  function next() {
    if (phase !== 'reveal' || round >= rounds.length - 1) return;
    round++;
    phase = 'ready';
    readyPrompt();
    stage.request();
  }

  function finish() {
    phase = 'done';
    const totalLen = results.reduce((a, r) => a + r.length, 0);
    const totalEd = results.reduce((a, r) => a + r.chars, 0);
    const cer = (totalEd / totalLen) * 100;
    const words = results.reduce((a, r) => a + r.words, 0);
    const ok = results.reduce((a, r) => a + r.ok, 0);
    const disp = cer.toFixed(1);
    const sum = (k: 'omissions' | 'insertions' | 'subs' | 'caseOnly' | 'punctOnly') => results.reduce((a, r) => a + r[k], 0);
    const rows: [string, string][] = [
      ['Word accuracy', `${((ok / words) * 100).toFixed(1)}% (${ok} of ${words} words)`],
      ['Character edits', `${totalEd} over ${totalLen} characters`],
      ['Omissions (words left out)', String(sum('omissions'))],
      ['Insertions (words added)', String(sum('insertions'))],
      ['Substitutions (words changed)', `${sum('subs')} — ${sum('caseOnly')} only in capitals, ${sum('punctOnly')} only in punctuation`],
      ['Rules', 'edit distance on the normalised text; capitals and punctuation count; whitespace and quote styles don’t'],
    ];
    finTimer = window.setTimeout(
      () =>
        api.finish({
          score: cer,
          value: disp,
          unit: '%',
          label: 'character error rate',
          headline: disp === '0.0' ? 'Word for word, comma for comma. Verbatim.' : `${disp}% of the characters needed an edit. ${((ok / words) * 100).toFixed(0)}% of the words came back exactly.`,
          rows,
          accuracy: 1 - Math.min(100, cer) / 100,
          perfect: disp === '0.0',
          near: cer < 2,
          share: [`VERBATIM · ${api.level}${api.mode !== 'timed' ? ' · ' + api.mode : ''} — exact recall`, `${disp}% character error`],
        }),
      api.motion() ? 500 : 0,
    );
  }

  const onDown = (e: PointerEvent) => {
    if (!primary(e)) return;
    if (phase === 'ready') show();
    else if (phase === 'show' && relaxed()) endShow();
    else if (phase === 'reveal') next();
  };
  stage.canvas.addEventListener('pointerdown', onDown);
  const onVis = () => {
    if (document.hidden && (phase === 'show' || phase === 'delay')) {
      clearTimeout(timer);
      api.voidRun('Attempt voided — the tab was hidden while the passage was showing.');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  const offs = [
    listen('keydown', (e) => {
      if (!gameKey(e) || e.repeat) return;
      if (e.key !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault();
      if (phase === 'ready') show();
      else if (phase === 'show' && relaxed()) endShow();
      else if (phase === 'reveal') next();
    }),
  ];
  const ro = new ResizeObserver(() => phase === 'recall' && placeField());
  ro.observe(host);

  stage.draw = (now) => {
    const c = stage.ctx;
    const rd = rounds[round];
    if (!rd) return false;
    const W = Math.min(stage.w - 48, 760);
    const L = (stage.w - W) / 2;
    let more = false;
    if (phase === 'show') {
      c.font = font.serif(30);
      const lines = wrap(c, rd.text, W);
      const lh = 40;
      const y0 = Math.max(120, stage.h / 2 - (lines.length * lh) / 2);
      // The passage on a card.
      plate(c, L - 26, y0 - 44, W + 52, lines.length * lh + 70, 16);
      lines.forEach((l, i) => text(c, l, L, y0 + i * lh, font.serif(30), pal.ink, 'left'));
      if (!relaxed()) {
        const left = 1 - (now - phaseAt) / (rd.show * 1000);
        const by = y0 + lines.length * lh + 6;
        slot(c, L, by, L + W, by, 6);
        bar(c, L, by - 2.5, W * Math.max(0, left), 5, pal.accent, 2.5);
        more = true;
      } else text(c, 'press when ready ▸', L, y0 + lines.length * lh + 14, font.mono(11, 500), pal.ink2, 'left');
    } else if (phase === 'delay') {
      text(c, '…', stage.w / 2, stage.h / 2, font.serif(40), pal.ink3, 'center', 'middle');
      const left = 1 - (now - phaseAt) / (DELAY * 1000);
      slot(c, stage.w / 2 - 80, stage.h / 2 + 30, stage.w / 2 + 80, stage.h / 2 + 30, 6);
      bar(c, stage.w / 2 - 80, stage.h / 2 + 27.5, 160 * Math.max(0, left), 5, pal.ink3, 2.5);
      more = true;
    } else if (phase === 'reveal' || phase === 'done') {
      // The original, word by word: kept (ink), changed (struck, then yours underlined), left out (struck),
      // added (yours, underlined, in brackets). Shape, not only colour, tells them apart.
      const s = results[results.length - 1];
      const fs = 20;
      c.font = font.sans(fs);
      let x = L;
      let y = 130;
      const lh = 34;
      let drawing = false;
      // The comparison cascades in, a word at a time.
      const shownN = api.motion() ? Math.floor((now - phaseAt) / 35) : Infinity;
      if (shownN < s.ops.length * 2 + 2) more = true;
      let idx = 0;
      const put = (w: string, style: 'ok' | 'strike' | 'under', color: string) => {
        idx++;
        c.font = font.sans(fs);
        const ww = c.measureText(w + ' ').width;
        if (x + ww > L + W && x > L) {
          x = L;
          y += lh;
        }
        const tw = c.measureText(w).width;
        if (drawing && idx <= shownN) {
          // What you wrote instead sits on a soft highlight.
          if (style === 'under') {
            rr(c, x - 4, y - fs * 0.95, tw + 8, fs * 1.35, 6);
            c.fillStyle = alpha(pal.signal, 0.12);
            c.fill();
          }
          text(c, w, x, y, font.sans(fs), color, 'left');
          if (style === 'strike') hair(c, x, y - fs * 0.32, x + tw, y - fs * 0.32, color);
          if (style === 'under') line(c, x, y + 4, x + tw, y + 4, color, 1.5);
        }
        x += ww;
      };
      const layoutOps = () => {
        x = L;
        y = 130;
        idx = 0;
        for (const op of s.ops) {
          if (op.op === 'ok') put(op.orig!, 'ok', pal.accent);
          else if (op.op === 'omit') put(op.orig!, 'strike', pal.ink3);
          else if (op.op === 'sub') {
            put(op.orig!, 'strike', pal.ink3);
            put(op.mine!, 'under', pal.signal);
          } else put(`[+${op.mine}]`, 'under', pal.signal);
        }
      };
      // Measure first (to size the card), then draw.
      layoutOps();
      plate(c, L - 24, 82, W + 48, y - 82 + 30, 16);
      text(c, 'ORIGINAL vs YOURS', L, 106, font.mono(10, 500), pal.ink3, 'left');
      drawing = true;
      layoutOps();
      y += lh + 10;
      text(c, 'kept · struck = left out / replaced · underlined = what you wrote instead · [+ ] = added', L, y, font.mono(10), pal.ink3, 'left');
    } else if (phase === 'ready') {
      text(c, 'press anywhere to read', stage.w / 2, stage.h / 2, font.mono(12, 500), pal.ink2, 'center', 'middle');
    }
    return more;
  };

  return {
    reset,
    destroy: () => {
      clearTimeout(timer);
      clearTimeout(finTimer);
      ro.disconnect();
      offs.forEach((f) => f());
      document.removeEventListener('visibilitychange', onVis);
      stage.canvas.removeEventListener('pointerdown', onDown);
      ta.remove();
      checkBtn.remove();
    },
  };
};

export default factory;
