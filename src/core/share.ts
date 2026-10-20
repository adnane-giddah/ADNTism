import type { GameMeta, Result } from './types';
import { font, pal } from './draw';
import { publicUrl } from './route';

/** Render a compact result card (1200×630) — the result itself is the marketing. */
export async function resultCard(g: GameMeta, r: Result, tag: string, link?: string): Promise<Blob | null> {
  await document.fonts?.ready;
  const W = 1200;
  const H = 630;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = pal.paper;
  c.fillRect(0, 0, W, H);

  // registration marks
  c.strokeStyle = pal.ink;
  c.lineWidth = 2;
  const m = 40;
  const k = 22;
  for (const [x, y, sx, sy] of [
    [m, m, 1, 1],
    [W - m, m, -1, 1],
    [m, H - m, 1, -1],
    [W - m, H - m, -1, -1],
  ]) {
    c.beginPath();
    c.moveTo(x + sx * k, y);
    c.lineTo(x, y);
    c.lineTo(x, y + sy * k);
    c.stroke();
  }

  const t = (s: string, x: number, y: number, f: string, col: string, align: CanvasTextAlign = 'left') => {
    c.font = f;
    c.fillStyle = col;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillText(s, x, y);
  };

  t('ε', 80, 118, font.serif(64, true), pal.ink);
  t('epsilon', 122, 112, font.mono(22, 500), pal.ink);
  t(tag.toUpperCase(), W - 80, 112, font.mono(20, 500), pal.ink2, 'right');

  t(g.name, 80, 250, font.serif(104), pal.ink);
  t(r.label.toUpperCase(), 80, 318, font.mono(20, 500), pal.ink3);

  c.font = font.mono(150, 400);
  const vw = c.measureText(r.value).width;
  t(r.value, 74, 470, font.mono(150, 400), r.perfect ? pal.signal : pal.ink);
  t(r.unit, 74 + vw + 14, 470, font.mono(44, 400), pal.ink2);

  t(r.headline, 80, 540, font.sans(26, 450), pal.ink2);

  let y = 210;
  for (const [a, b] of r.rows.slice(0, 5)) {
    c.fillStyle = pal.line;
    c.fillRect(760, y - 30, 360, 1);
    t(a, 760, y, font.sans(20), pal.ink2);
    t(b, W - 80, y, font.mono(20, 500), pal.ink, 'right');
    y += 52;
  }
  t('how close can you get?', W - 80, H - 72, font.serif(30, true), pal.ink, 'right');
  if (link) t(link.replace(/^https?:\/\//, ''), 80, H - 72, font.mono(16, 450), pal.ink3, 'left');

  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}

export async function shareResult(g: GameMeta, r: Result, tag: string, link?: string): Promise<string> {
  const lines = r.share ?? [`${g.name.toUpperCase()} — ${r.label}`, `${r.value} ${r.unit}`, r.headline];
  // The link replays the same seed, level and scoring. It is a challenge, not a verified score.
  const body = ['ε epsilon · ' + tag, ...lines, link ? 'Same conditions: ' + link : publicUrl('/e/' + g.id)].join('\n');
  const blob = await resultCard(g, r, tag, link);
  const name = `epsilon-${g.id}-${r.value}${r.unit}.png`.replace(/[^\w.-]/g, '_');
  const file = blob ? new File([blob], name, { type: 'image/png' }) : null;

  if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: body });
      return 'Shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return '';
    }
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(body);
    copied = true;
  } catch {
    /* clipboard blocked */
  }
  if (file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return copied ? 'Result copied · card saved' : 'Card saved';
}
