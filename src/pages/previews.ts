// Miniature, looping previews of each experiment's actual mechanic. Not videos: tiny live systems.
import { arrow, bracket, circle, clamp, cross, easeInOut, easeOut, font, hair, line, pal, springOut, text, TAU } from '../core/draw';

type C = CanvasRenderingContext2D;
type Preview = (c: C, w: number, h: number, t: number) => void;

const ph = (t: number, period: number) => (t % period) / period;

const zero: Preview = (c, w, h, t) => {
  const vals = [0.71, -0.64, 0.38, -0.44];
  const cx = w / 2;
  const sc = w * 0.36;
  const p = ph(t, 7) * 6;
  hair(c, cx, 14, cx, h - 14, pal.ink3, [2, 3]);
  text(c, '0', cx, 12, font.mono(10), pal.ink3, 'center', 'middle');
  let s = 0;
  const rowH = (h - 50) / 4;
  vals.forEach((v, i) => {
    const k = clamp(p - i, 0, 1);
    if (k <= 0) return;
    const y = 34 + i * rowH;
    const a = s;
    const b = s + v * easeOut(k);
    c.fillStyle = v > 0 ? pal.ink : pal.ink2;
    c.globalAlpha = v > 0 ? 0.9 : 0.55;
    c.fillRect(cx + Math.min(a, b) * sc, y, Math.abs(b - a) * sc, rowH * 0.42);
    c.globalAlpha = 1;
    text(c, (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2), cx + b * sc + (v > 0 ? 6 : -6), y + rowH * 0.32, font.mono(10), pal.ink2, v > 0 ? 'left' : 'right');
    s += v * easeOut(k);
  });
  if (p > 4.2) {
    const y = h - 12;
    line(c, cx, y - 8, cx + s * sc, y - 8, pal.signal, 2);
    circle(c, cx + s * sc, y - 8, 3, undefined, pal.signal);
    text(c, '+0.01', cx + s * sc + 8, y - 4, font.mono(10, 500), pal.signal);
  }
};

const exact: Preview = (c, w, h, t) => {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.4;
  const targets = [137, 263, 48, 311];
  const k = Math.floor(t / 3.2) % targets.length;
  const p = ph(t, 3.2);
  const tgt = (targets[k] * Math.PI) / 180;
  const miss = (((k * 7) % 5) - 2) * 0.035 + 0.02;
  circle(c, cx, cy, r, pal.ink3);
  line(c, cx, cy - r - 6, cx, cy - r + 8, pal.ink, 1.5);
  const prev = (targets[(k + targets.length - 1) % targets.length] * Math.PI) / 180;
  const a = prev + (tgt + miss - prev) * springOut(p * 1.6);
  const ang = (v: number) => v - Math.PI / 2;
  if (p > 0.55) {
    const g = clamp((p - 0.55) * 4, 0, 1);
    c.globalAlpha = g;
    line(c, cx, cy, cx + Math.cos(ang(tgt)) * r, cy + Math.sin(ang(tgt)) * r, pal.ink3, 1, [3, 3]);
    c.beginPath();
    c.arc(cx, cy, r * 0.72, ang(Math.min(tgt, tgt + miss)), ang(Math.max(tgt, tgt + miss)));
    c.strokeStyle = pal.signal;
    c.lineWidth = 3;
    c.stroke();
    text(c, targets[k] + '°', cx, cy + r + 18, font.mono(11, 500), pal.ink2, 'center');
    c.globalAlpha = 1;
  }
  line(c, cx, cy, cx + Math.cos(ang(a)) * r * 0.94, cy + Math.sin(ang(a)) * r * 0.94, pal.ink, 2);
  circle(c, cx, cy, 3.5, undefined, pal.ink);
};

const loop: Preview = (c, w, h, t) => {
  const s = Math.min(w, h) / 200;
  const ox = w / 2 - 40 * s;
  const oy = h / 2 + 35 * s;
  const vs = [
    [80, -30],
    [10, -60],
    [-50, 15],
  ];
  const p = ph(t, 5);
  let x = ox;
  let y = oy;
  const pts: [number, number][] = [[x, y]];
  vs.forEach(([dx, dy], i) => {
    const k = easeOut(clamp(p * 5 - i * 0.6, 0, 1));
    if (k <= 0) return;
    arrow(c, x, y, x + dx * s * k, y + dy * s * k, pal.ink, 1.5, 7);
    x += dx * s * k;
    y += dy * s * k;
    pts.push([x, y]);
  });
  circle(c, ox, oy, 6, pal.ink, undefined, 1.25);
  const k = easeInOut(clamp(p * 3 - 1.4, 0, 1));
  if (k > 0) {
    const ex = ox + 4 * s;
    const ey = oy - 5 * s;
    const tx = x + (ex - x) * k;
    const ty = y + (ey - y) * k;
    arrow(c, x, y, tx, ty, pal.accent, 1.75, 8);
    if (k >= 1) {
      c.fillStyle = pal.line2;
      c.beginPath();
      pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.closePath();
      c.fill();
      bracket(c, ex, ey, ox, oy, pal.signal, 3);
    }
  }
};

const draw: Preview = (c, w, h, t) => {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.36;
  const p = ph(t, 4.5);
  if (p < 0.2) circle(c, cx, cy, R, pal.ink, undefined, 1.5);
  else circle(c, cx, cy, R, pal.ink3, undefined, 1, [3, 4]);
  cross(c, cx, cy, 5, pal.ink3);
  const prog = clamp((p - 0.22) / 0.55, 0, 1);
  if (prog > 0) {
    c.beginPath();
    for (let i = 0; i <= 120 * prog; i++) {
      const a = (i / 120) * TAU * 1.02 - Math.PI / 2;
      const rr = R * (1 + 0.035 * Math.sin(3 * a + 1) + 0.02 * Math.sin(5 * a)) * 1.03;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i) c.lineTo(px, py);
      else c.moveTo(px, py);
    }
    c.strokeStyle = pal.ink;
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.stroke();
  }
  if (p > 0.8) text(c, 'RMS 1.84 u', cx, cy + R + 22, font.mono(10, 500), pal.signal, 'center');
};

const stop: Preview = (c, w, h, t) => {
  const L = 16;
  const R = w - 16;
  const y = h * 0.34;
  const tgt = L + (R - L) * 0.72;
  const p = ph(t, 4);
  const bx = 0.35;
  const xs = (u: number) => (u < bx ? u / bx * 0.5 : 0.5 + 0.23 * (1 - (1 - (u - bx) / (1 - bx)) ** 2));
  const u = clamp(p / 0.8, 0, 1);
  const px = L + (R - L) * xs(u);
  hair(c, L, y, R, y, pal.ink3);
  line(c, tgt, y - 14, tgt, y + 14, pal.ink, 1.5);
  line(c, R, y - 20, R, y + 20, pal.ink, 3);
  circle(c, px, y, 6, undefined, pal.ink);
  // phase plot: v against x
  const by = h - 18;
  const top = h * 0.55;
  hair(c, L, by, R, by, pal.line);
  c.beginPath();
  for (let i = 0; i <= 60 * u; i++) {
    const uu = i / 60;
    const v = uu < bx ? 1 : 1 - (uu - bx) / (1 - bx);
    const X = L + (R - L) * xs(uu);
    const Y = by - (by - top) * v;
    if (i) c.lineTo(X, Y);
    else c.moveTo(X, Y);
  }
  c.strokeStyle = pal.ink;
  c.lineWidth = 1.5;
  c.stroke();
  if (u >= 1) bracket(c, px, y + 18, tgt, y + 18, pal.signal, 3);
};

const balance: Preview = (c, w, h, t) => {
  const cx = w / 2;
  const cy = h * 0.55;
  const L = Math.min(w * 0.42, 150);
  const p = ph(t, 4);
  const ang = 0.12 * Math.exp(-3 * p) * Math.cos(p * 18) + 0.02;
  c.save();
  c.translate(cx, cy);
  c.rotate(ang);
  line(c, -L, 0, L, 0, pal.ink, 3);
  c.fillStyle = pal.ink;
  c.fillRect(-L * 0.7 - 11, -24, 22, 22);
  c.fillStyle = pal.ink2;
  c.fillRect(L * 0.55 - 9, -18, 18, 18);
  c.restore();
  c.beginPath();
  c.moveTo(cx, cy + 2);
  c.lineTo(cx - 10, cy + 22);
  c.lineTo(cx + 10, cy + 22);
  c.closePath();
  c.fillStyle = pal.ink;
  c.fill();
  hair(c, cx - L - 10, cy + 22, cx + L + 10, cy + 22, pal.line);
  hair(c, cx, cy - 50, cx, cy - 34, pal.ink3, [2, 2]);
  text(c, (ang * 57.3).toFixed(1) + '°', cx, cy - 56, font.mono(10, 500), Math.abs(ang) > 0.03 ? pal.signal : pal.ink2, 'center');
};

const drift: Preview = (c, w, h, t) => {
  const cx = w / 2;
  const sc = w * 0.32;
  const f = (tt: number) => 0.45 * Math.sin(tt * 1.3) * Math.sin(tt * 0.37 + 1) + 0.18 * Math.sin(tt * 3.1);
  hair(c, cx, 10, cx, h - 10, pal.ink, [2, 3]);
  c.fillStyle = pal.line2;
  c.fillRect(cx - sc * 0.12, 10, sc * 0.24, h - 20);
  c.beginPath();
  for (let i = 0; i <= 80; i++) {
    const yy = 20 + (i / 80) * (h - 40);
    const tt = t - (1 - i / 80) * 3;
    const x = cx + f(tt) * sc;
    if (i) c.lineTo(x, yy);
    else c.moveTo(x, yy);
  }
  c.strokeStyle = pal.ink;
  c.lineWidth = 1.25;
  c.stroke();
  const x = cx + f(t) * sc;
  circle(c, x, h - 20, 6, undefined, pal.ink);
  if (Math.abs(f(t)) > 0.12) line(c, cx, h - 20, x, h - 20, pal.signal, 2);
};

const echo: Preview = (c, w, h, t) => {
  const L = 16;
  const R = w - 16;
  const pat = [0, 0.25, 0.5, 0.625, 1];
  const mine = [0, 0.27, 0.49, 0.66, 1.03];
  const p = ph(t, 4);
  const y1 = h * 0.36;
  const y2 = h * 0.68;
  hair(c, L, y1, R, y1, pal.line);
  hair(c, L, y2, R, y2, pal.line);
  text(c, 'HEARD', L, y1 - 26, font.mono(9, 500), pal.ink3);
  text(c, 'TAPPED', L, y2 - 26, font.mono(9, 500), pal.ink3);
  const X = (v: number) => L + 10 + v * (R - L - 20);
  pat.forEach((v, i) => {
    const k = clamp((p * 2.2 - v) * 8, 0, 1);
    line(c, X(v), y1 - 16 * k, X(v), y1, pal.ink, 2);
    if (i && p > 0.9) hair(c, X(pat[i - 1]), y1 + 8, X(v), y1 + 8, pal.ink3);
  });
  mine.forEach((v, i) => {
    const k = clamp((p * 2.2 - 1.1 - v) * 8, 0, 1);
    line(c, X(v), y2 - 16 * k, X(v), y2, pal.ink, 2);
    if (k > 0 && Math.abs(v - pat[i]) > 0.01) {
      c.globalAlpha = k;
      line(c, X(pat[i]), y2 + 6, X(v), y2 + 6, pal.signal, 2);
      c.globalAlpha = 1;
    }
  });
  const head = clamp(p * 2.2, 0, 2.2);
  const hx = head <= 1.05 ? X(head) : X(head - 1.1);
  if (head < 2.15) hair(c, hx, head <= 1.05 ? y1 - 22 : y2 - 22, hx, head <= 1.05 ? y1 + 4 : y2 + 4, pal.signal);
};

const center: Preview = (c, w, h, t) => {
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h) / 200;
  const tx = cx + 12 * s;
  const ty = cy - 6 * s;
  const pts = [
    [-62, -48],
    [70, -40],
    [-30, 66],
    [72, 4],
  ].map(([x, y]) => [cx + x * s, cy + y * s]);
  const p = ph(t, 5);
  circle(c, tx, ty, 26 * s, pal.line, undefined, 1, [2, 3]);
  cross(c, tx, ty, 7, pal.ink, 1.5);
  const n = Math.min(4, Math.floor(p * 7));
  pts.slice(0, n).forEach(([x, y]) => circle(c, x, y, 5, undefined, pal.ink));
  if (n === 4) {
    const k = easeOut((p * 7 - 4) / 1.5);
    const mx = pts.reduce((a, q) => a + q[0], 0) / 4;
    const my = pts.reduce((a, q) => a + q[1], 0) / 4;
    pts.forEach(([x, y]) => line(c, x, y, x + (mx - x) * k, y + (my - y) * k, pal.ink3, 1, [2, 3]));
    if (k >= 1) {
      circle(c, mx, my, 4, pal.signal, undefined, 2);
      bracket(c, mx, my, tx, ty, pal.signal, 3);
    }
  }
};

const plumb: Preview = (c, w, h, t) => {
  const ax = w * 0.18;
  const ay = h * 0.68;
  const bx = w * 0.82;
  const by = h * 0.3;
  const p = ph(t, 3.6);
  line(c, ax, ay, bx, by, pal.ink3, 1, [3, 4]);
  circle(c, ax, ay, 4.5, undefined, pal.ink);
  circle(c, bx, by, 4.5, undefined, pal.ink);
  const k = easeInOut(clamp(p / 0.6, 0, 1));
  const nx = -(by - ay);
  const ny = bx - ax;
  const nl = Math.hypot(nx, ny);
  c.beginPath();
  for (let i = 0; i <= 60 * k; i++) {
    const u = i / 60;
    const bow = Math.sin(u * Math.PI) * 9 + Math.sin(u * 13) * 1.2;
    const x = ax + (bx - ax) * u + (nx / nl) * bow;
    const y = ay + (by - ay) * u + (ny / nl) * bow;
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  }
  c.strokeStyle = pal.ink;
  c.lineWidth = 2;
  c.lineCap = 'round';
  c.stroke();
  if (p > 0.65) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    line(c, mx, my, mx + (nx / nl) * 9, my + (ny / nl) * 9, pal.signal, 2);
    text(c, 'RMS 0.84 u', w / 2, h - 14, font.mono(10, 500), pal.signal, 'center');
  }
};

const phase: Preview = (c, w, h, t) => {
  const R = Math.min(w / 5.2, h / 2.8);
  const ax = w / 2 - R * 1.3;
  const bx = w / 2 + R * 1.3;
  const cy = h / 2;
  // ■ starts ahead and slightly fast; it eases into step and stays there.
  const settle = clamp((ph(t, 6) - 0.15) / 0.5, 0, 1);
  const thA = t * 2.4;
  const thB = thA + (1 - easeInOut(settle)) * 1.4;
  for (const [x, th, me] of [
    [ax, thA, false],
    [bx, thB, true],
  ] as const) {
    circle(c, x, cy, R, pal.ink3);
    line(c, x, cy - R - 5, x, cy - R + 6, pal.ink, 1.5);
    const mx = x + Math.sin(th) * R;
    const my = cy - Math.cos(th) * R;
    line(c, x, cy, mx, my, me ? pal.ink2 : pal.ink, 1.25, me ? [3, 2] : undefined);
    if (me) {
      c.strokeStyle = pal.accent;
      c.lineWidth = 2;
      c.strokeRect(mx - 5, my - 5, 10, 10);
    } else circle(c, mx, my, 5, undefined, pal.ink);
  }
  if (settle >= 1) text(c, 'in step', w / 2, h - 10, font.mono(10, 500), pal.accent, 'center');
};

const beat: Preview = (c, w, h, t) => {
  const L = 16;
  const R = w - 16;
  const y = h * 0.55;
  const P = 0.55;
  const p = t % (P * 8);
  const n = Math.floor(p / P);
  const lx = L + (R - L) * 0.78;
  hair(c, L, y + 12, R, y + 12, pal.ink3);
  line(c, lx, y - 22, lx, y + 18, pal.ink, 2);
  const flash = n < 4 ? clamp(1 - (p - n * P) / 0.15, 0, 1) : 0;
  circle(c, w / 2, h * 0.2, 9, pal.ink2, flash > 0 ? pal.accent : undefined, 1.5);
  text(c, n < 4 ? String(n + 1) : '…', w / 2, h * 0.2 + 22, font.mono(10, 500), pal.ink2, 'center');
  const x = L + ((lx - L) * p) / (P * 7);
  c.fillStyle = pal.paper2;
  c.fillRect(L + (R - L) * 0.5, y - 14, (R - L) * 0.26, 28);
  if (x < L + (R - L) * 0.5 || x > L + (R - L) * 0.76) {
    c.fillStyle = pal.ink;
    c.fillRect(x - 6, y - 6, 12, 12);
  }
  if (n === 7) text(c, 'tap', lx, y - 28, font.mono(10, 500), pal.signal, 'center');
};

const intersect: Preview = (c, w, h, t) => {
  const s = Math.min(w, h) / 100;
  const X = (u: number) => w / 2 + u * s;
  const Y = (u: number) => h / 2 + u * s;
  const P = { x: 8, y: -6 };
  const A0 = { x: 40, y: -36 };
  const L = { x: -36, y: 34 };
  const k = clamp(ph(t, 3.4) / 0.75, 0, 1);
  line(c, X(A0.x), Y(A0.y), X(P.x - (A0.x - P.x) * 0.5), Y(P.y - (A0.y - P.y) * 0.5), pal.ink3, 1, [3, 3]);
  cross(c, X(P.x), Y(P.y), 6, pal.ink, 1.5);
  const a = { x: A0.x + (P.x - A0.x) * k, y: A0.y + (P.y - A0.y) * k };
  const b = { x: L.x + (P.x - L.x) * k * 0.97, y: L.y + (P.y - L.y) * k * 0.97 };
  line(c, X(L.x), Y(L.y), X(b.x), Y(b.y), pal.accent, 1.25);
  circle(c, X(a.x), Y(a.y), 5, undefined, pal.ink);
  c.strokeStyle = pal.accent;
  c.lineWidth = 2;
  c.strokeRect(X(b.x) - 4, Y(b.y) - 4, 8, 8);
  if (k >= 1) text(c, 'miss 0.9 u', w / 2, h - 10, font.mono(10, 500), pal.signal, 'center');
};

const perception: Preview = (c, w, h, t) => {
  const L = Math.min(w * 0.36, 90);
  const cx = w / 2;
  const y1 = h * 0.35;
  const y2 = h * 0.68;
  const p = ph(t, 4.5);
  const adj = L * (1.18 - 0.18 * easeInOut(clamp(p / 0.6, 0, 1)));
  const fin = (x: number, y: number, dir: number) => {
    line(c, x, y, x + dir * 9, y - 7, pal.ink, 1.5);
    line(c, x, y, x + dir * 9, y + 7, pal.ink, 1.5);
  };
  line(c, cx - L / 2, y1, cx + L / 2, y1, pal.ink, 2);
  fin(cx - L / 2, y1, -1);
  fin(cx + L / 2, y1, 1);
  line(c, cx - adj / 2, y2, cx + adj / 2, y2, pal.ink, 2);
  fin(cx - adj / 2, y2, 1);
  fin(cx + adj / 2, y2, -1);
  if (p > 0.7) {
    line(c, cx - L / 2, y2 + 10, cx + L / 2, y2 + 10, pal.signal, 1.5, [3, 2]);
    text(c, 'equal', cx, h - 8, font.mono(10, 500), pal.signal, 'center');
  }
};

const afterimage: Preview = (c, w, h, t) => {
  const p = ph(t, 6);
  const cy = h / 2;
  const A = h * 0.3;
  const show = p < 0.4;
  const x1 = show || p > 0.7 ? (p > 0.7 ? w * 0.35 : w / 2) : w / 2;
  hair(c, x1, cy - A - 6, x1, cy + A + 6, pal.line);
  if (show || p > 0.7) circle(c, x1, cy - A * Math.sin(t * 4), 6, undefined, pal.ink);
  else text(c, '…', w / 2, cy, font.mono(14), pal.ink3, 'center', 'middle');
  if (p > 0.7) {
    const x2 = w * 0.65;
    hair(c, x2, cy - A - 6, x2, cy + A + 6, pal.line);
    circle(c, x2, cy - A * 0.85 * Math.sin(t * 4.3), 6, pal.accent, undefined, 2);
    text(c, '−15%', x2, h - 8, font.mono(10, 500), pal.signal, 'center');
  }
};

const pour: Preview = (c, w, h, t) => {
  const cx = w / 2;
  const top = h * 0.12;
  const bot = h * 0.88;
  const H = bot - top;
  const wd = (u: number) => (12 + 70 * u) * Math.min(1, w / 220);
  const p = clamp(ph(t, 5) / 0.7, 0, 1);
  // Fill to half the area of a cone: level at √½ of the height.
  const hl = H * Math.SQRT1_2 * easeInOut(p);
  c.beginPath();
  c.moveTo(cx - wd(0) / 2, bot);
  c.lineTo(cx - wd(hl / H) / 2, bot - hl);
  c.lineTo(cx + wd(hl / H) / 2, bot - hl);
  c.lineTo(cx + wd(0) / 2, bot);
  c.closePath();
  c.fillStyle = pal.signalSoft;
  c.fill();
  line(c, cx - wd(0) / 2, bot, cx - wd(1) / 2, top, pal.ink, 1.5);
  line(c, cx + wd(0) / 2, bot, cx + wd(1) / 2, top, pal.ink, 1.5);
  line(c, cx - wd(0) / 2, bot, cx + wd(0) / 2, bot, pal.ink, 1.5);
  if (p < 1) line(c, cx, top - 6, cx, bot - hl, pal.signal, 1.5);
  else {
    line(c, cx - wd(0.5) / 2 - 6, bot - H / 2, cx + wd(0.5) / 2 + 6, bot - H / 2, pal.ink3, 1, [1, 3]);
    text(c, '½ volume ≠ ½ height', cx, h - 2, font.mono(9, 500), pal.signal, 'center');
  }
};

const shadow: Preview = (c, w, h, t) => {
  const s = Math.min(w, h) * 0.38;
  const f = (tt: number) => ({ x: w / 2 + s * (0.7 * Math.sin(tt * 0.9) + 0.25 * Math.sin(tt * 2.3 + 1)), y: h / 2 + s * (0.6 * Math.sin(tt * 1.3 + 2) + 0.2 * Math.sin(tt * 2.9)) });
  c.beginPath();
  for (let i = 0; i <= 60; i++) {
    const q = f(t - 2 + i / 30);
    if (i) c.lineTo(q.x, q.y);
    else c.moveTo(q.x, q.y);
  }
  c.strokeStyle = pal.line;
  c.lineWidth = 1;
  c.stroke();
  const tg = f(t);
  const me = f(t - 0.18);
  circle(c, tg.x, tg.y, 5, undefined, pal.ink);
  cross(c, me.x + 2, me.y - 1, 7, pal.accent, 1.5, 2);
};

const mirror: Preview = (c, w, h, t) => {
  const cx = w / 2;
  const cy = h / 2;
  const a = 1.1;
  const L = Math.max(w, h);
  line(c, cx - Math.cos(a) * L, cy - Math.sin(a) * L, cx + Math.cos(a) * L, cy + Math.sin(a) * L, pal.ink, 2);
  const p = { x: cx - w * 0.22, y: cy + h * 0.05 };
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const k = (p.x - cx) * d.x + (p.y - cy) * d.y;
  const foot = { x: cx + d.x * k, y: cy + d.y * k };
  const img = { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
  circle(c, p.x, p.y, 5, undefined, pal.ink);
  const q = ph(t, 3.6);
  if (q > 0.35) {
    const guess = { x: img.x + 6, y: img.y - 4 };
    cross(c, guess.x, guess.y, 6, pal.signal, 1.5);
    if (q > 0.6) {
      line(c, p.x, p.y, img.x, img.y, pal.ink3, 1, [3, 3]);
      circle(c, img.x, img.y, 5, pal.ink, undefined, 1.5);
      text(c, '7.2 u', w / 2, h - 8, font.mono(10, 500), pal.signal, 'center');
    }
  }
};


const vessels: Preview = (c, w, h, t) => {
  // Two different vessels joined at the bottom: the surfaces meet, the volumes don't.
  const p = easeInOut(clamp((ph(t, 5) - 0.15) / 0.55, 0, 1));
  const bot = h * 0.82;
  const wa = w * 0.14;
  const wb = w * 0.32;
  const xa = w * 0.3;
  const xb = w * 0.66;
  const ha0 = h * 0.6;
  const hb0 = h * 0.12;
  const eq = (wa * ha0 + wb * hb0) / (wa + wb);
  const ha = ha0 + (eq - ha0) * p;
  const hb = hb0 + (eq - hb0) * p;
  c.fillStyle = pal.liquid;
  c.fillRect(xa - wa / 2, bot - ha, wa, ha);
  c.fillRect(xb - wb / 2, bot - hb, wb, hb);
  for (const [x, ww] of [
    [xa, wa],
    [xb, wb],
  ]) {
    line(c, x - ww / 2, bot - h * 0.7, x - ww / 2, bot, pal.ink, 1.5);
    line(c, x + ww / 2, bot - h * 0.7, x + ww / 2, bot, pal.ink, 1.5);
  }
  line(c, xa - wa / 2, bot, xb + wb / 2, bot, pal.ink, 1.5);
  line(c, xa, bot + 6, xb, bot + 6, pal.ink2, 3);
  circle(c, (xa + xb) / 2, bot + 6, 5, pal.ink, pal.paper, 1.5);
  if (p >= 1) line(c, xa - wa, bot - eq, xb + wb, bot - eq, pal.signal, 1, [3, 3]);
};

const valves: Preview = (c, w, h, t) => {
  const p = ph(t, 4);
  const S = { x: w / 2, y: h * 0.22 };
  const A = { x: w * 0.28, y: h * 0.75 };
  const B = { x: w * 0.72, y: h * 0.75 };
  const box = (q: { x: number; y: number }, ww: number, f: number) => {
    c.fillStyle = pal.liquid;
    c.fillRect(q.x - ww / 2, q.y + 14 - 28 * f, ww, 28 * f);
    c.strokeStyle = pal.ink;
    c.lineWidth = 1.5;
    c.strokeRect(q.x - ww / 2, q.y - 14, ww, 28);
  };
  const fa = Math.min(0.7, p * 1.4);
  const fb = Math.min(0.45, Math.max(0, p - 0.2) * 1.1);
  box(S, 60, 0.9 - (fa + fb) * 0.6);
  for (const [q, f] of [
    [A, fa],
    [B, fb],
  ] as const) {
    line(c, S.x, S.y + 14, q.x, q.y - 14, pal.ink3, 3);
    circle(c, (S.x + q.x) / 2, (S.y + q.y) / 2, 6, pal.ink, pal.paper, 1.5);
    box(q, 36, f);
  }
  line(c, A.x - 22, A.y + 14 - 28 * 0.7, A.x + 22, A.y + 14 - 28 * 0.7, pal.signal, 1, [2, 2]);
};

const verbatim: Preview = (c, _w, h, t) => {
  const p = ph(t, 5);
  const L = 16;
  if (p < 0.4) {
    text(c, 'The kettle sings', L, h * 0.42, font.serif(20), pal.ink, 'left');
    text(c, 'before the water boils.', L, h * 0.42 + 24, font.serif(20), pal.ink, 'left');
  } else {
    const typed = 'The kettle sings before the water'.slice(0, Math.floor(((p - 0.4) / 0.4) * 34));
    text(c, typed, L, h * 0.45, font.sans(13), pal.ink, 'left');
    if (p > 0.82) {
      text(c, 'boils.', L, h * 0.45 + 22, font.sans(13), pal.ink3, 'left');
      line(c, L, h * 0.45 + 18, L + 38, h * 0.45 + 18, pal.ink3, 1);
      text(c, '1 word left out', L, h - 14, font.mono(10, 500), pal.signal, 'left');
    }
  }
};

const letterfall: Preview = (c, w, h, t) => {
  const lanes = ['D', 'F', 'J', 'K'];
  const lw = Math.min(46, (w - 20) / 4);
  const L = w / 2 - lw * 2;
  const ly = h * 0.8;
  line(c, L, ly, L + lw * 4, ly, pal.ink, 2);
  const notes = [0.3, 0.7, 1.1, 1.3, 1.8, 2.2];
  notes.forEach((nt, i) => {
    const dt = nt - (t % 2.6);
    if (dt < -0.15 || dt > 1) return;
    const y = ly - dt * (ly - 10);
    const x = L + (i % 4) * lw + 5;
    c.fillStyle = pal.paper2;
    c.fillRect(x, y - 11, lw - 10, 22);
    c.strokeStyle = pal.ink2;
    c.strokeRect(x + 0.5, y - 10.5, lw - 11, 21);
    text(c, lanes[i % 4], x + (lw - 10) / 2, y, font.mono(12, 600), pal.ink, 'center', 'middle');
  });
  lanes.forEach((l, i) => text(c, l, L + i * lw + lw / 2, ly + 16, font.mono(10, 500), pal.ink3, 'center'));
};

const rules: Preview = (c, w, h, t) => {
  // A glider-like shape rotating a quarter turn each step.
  const shape = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 1],
  ];
  const s = Math.min(12, w / 24);
  const step = Math.floor(t / 1.2) % 4;
  for (let k = 0; k < 3; k++) {
    let g = shape;
    for (let r = 0; r < (step + k) % 4; r++) g = g.map((row, i) => row.map((_, j) => g[2 - j][i]));
    const x0 = w / 2 - 2 * (3 * s + 14) + k * (3 * s + 28) + 6;
    const y0 = h / 2 - 1.5 * s;
    g.forEach((row, i) =>
      row.forEach((v, j) => {
        c.strokeStyle = pal.line;
        c.strokeRect(x0 + j * s + 0.5, y0 + i * s + 0.5, s, s);
        if (v) {
          c.fillStyle = k === 2 ? pal.accent : pal.ink;
          c.fillRect(x0 + j * s + 1, y0 + i * s + 1, s - 2, s - 2);
        }
      }),
    );
    if (k < 2) text(c, '→', x0 + 3 * s + 8, h / 2, font.mono(12), pal.ink3, 'center', 'middle');
  }
  text(c, 'rotate 90°', w / 2, h - 12, font.mono(10, 500), pal.ink3, 'center');
};

const diff: Preview = (c, w, h, t) => {
  const pts = [
    [0.2, 0.3],
    [0.45, 0.2],
    [0.75, 0.32],
    [0.6, 0.62],
    [0.3, 0.7],
    [0.82, 0.75],
  ];
  const changed = ph(t, 4) > 0.5;
  const E = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 0],
    [3, 5],
  ];
  const P = pts.map(([x, y], i) => ({ x: w * x + (changed && i === 2 ? 14 : 0), y: h * y + (changed && i === 2 ? 10 : 0) }));
  E.forEach(([a, b]) => line(c, P[a].x, P[a].y, P[b].x, P[b].y, pal.ink2, 1.25));
  P.forEach((p) => circle(c, p.x, p.y, 3.5, undefined, pal.ink));
  if (changed && ph(t, 4) > 0.8) circle(c, P[2].x, P[2].y, 10, pal.signal, undefined, 2);
};

const quantity: Preview = (c, w, h, t) => {
  const r = (i: number) => Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
  for (let i = 0; i < 34; i++) {
    const x = 14 + r(i) * (w - 28);
    const y = 14 + r(i + 99) * (h - 40);
    if (i < 13) circle(c, x, y, 6, undefined, pal.ink);
    else {
      c.strokeStyle = pal.ink;
      c.lineWidth = 1.2;
      c.strokeRect(x - 3, y - 3, 6, 6);
    }
  }
  const p = ph(t, 4);
  const L = 16;
  const R = w - 16;
  line(c, L, h - 12, R, h - 12, pal.ink3, 1);
  line(c, L + (R - L) * (0.38 * Math.min(1, p * 2)), h - 18, L + (R - L) * (0.38 * Math.min(1, p * 2)), h - 6, pal.signal, 2);
};

const brake: Preview = (c, w, h, t) => {
  const L = 14;
  const R = w - 14;
  const hy = (u: number) => h * 0.6 - Math.sin(u * 5) * h * 0.12 - u * h * 0.05;
  c.beginPath();
  for (let i = 0; i <= 50; i++) (i ? c.lineTo : c.moveTo).call(c, L + (R - L) * (i / 50), hy(i / 50));
  c.strokeStyle = pal.ink;
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = pal.liquid;
  c.fillRect(L + (R - L) * 0.45, hy(0.5) - 1, (R - L) * 0.15, 5);
  const p = clamp(ph(t, 4) / 0.8, 0, 1);
  const u = 0.78 * (1 - (1 - p) ** 2);
  c.fillStyle = pal.ink;
  c.fillRect(L + (R - L) * u - 7, hy(u) - 12, 14, 12);
  line(c, L + (R - L) * 0.78, hy(0.78) - 20, L + (R - L) * 0.78, hy(0.78) + 4, pal.ink, 1.5);
};

const pendulum: Preview = (c, w, h, t) => {
  const pv = { x: w / 2, y: 14 };
  const L = h * 0.72;
  const a = 1.1 * Math.cos(t * 2.2);
  const bx = pv.x + Math.sin(a) * L;
  const by = pv.y + Math.cos(a) * L;
  c.beginPath();
  c.arc(pv.x, pv.y, L, Math.PI / 2 - 1.1, Math.PI / 2 + 1.1);
  c.strokeStyle = pal.line;
  c.stroke();
  const ta = 0.5;
  line(c, pv.x + Math.sin(ta) * (L - 12), pv.y + Math.cos(ta) * (L - 12), pv.x + Math.sin(ta) * (L + 12), pv.y + Math.cos(ta) * (L + 12), pal.ink, 2);
  line(c, pv.x, pv.y, bx, by, pal.ink2, 1.25);
  circle(c, bx, by, 8, undefined, pal.ink);
};


const slipstream: Preview = (c, w, h, t) => {
  // The tube rushes past; the ship slides round to each ring's gap just in time.
  const cx = w / 2;
  const F = Math.min(h * 0.8, w * 0.6);
  const CAM = 3.2;
  const R = 3;
  const CY = 1.15;
  const sy = h * 0.84;
  const vy = sy - ((R - 0.22 - CY) * F) / CAM;
  const sp = 28;
  const vs = t * sp;
  const period = 1.4;
  const gap = (i: number) => Math.sin(i * 2.3) * 1.5;
  const n = Math.floor(t / period);
  const th = gap(n - 1) + (gap(n) - gap(n - 1)) * easeInOut(clamp((t - n * period) / (period * 0.55), 0, 1));
  const P = (phi: number, d: number, rr: number) => {
    const k = F / (CAM + d);
    return [cx + rr * Math.sin(phi) * k, vy + (rr * Math.cos(phi) - CY) * k] as const;
  };
  c.lineWidth = 1;
  c.strokeStyle = pal.ink3;
  for (let k = Math.ceil((vs - 2) / 7.5); k * 7.5 < vs + 90; k++) {
    const d = k * 7.5 - vs;
    c.globalAlpha = clamp(1 - d / 90, 0, 1) * (k % 4 === 0 ? 0.8 : 0.4);
    c.beginPath();
    for (let i = 0; i <= 36; i++) {
      const [x, y] = P((i / 36) * TAU, d, R);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.stroke();
  }
  for (let j = 0; j < 12; j++) {
    c.globalAlpha = j % 3 === 0 ? 0.45 : 0.2;
    c.beginPath();
    [-2, 0, 4, 10, 20, 40, 90].forEach((d, i) => {
      const [x, y] = P((j / 12) * TAU - th, d, R);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.stroke();
  }
  for (let i = n + 2; i >= n; i--) {
    const d = (i + 1) * period * sp - vs;
    if (d < -1 || d > 90) continue;
    const a0 = gap(i) - th + 0.5;
    const span = TAU - 1;
    c.globalAlpha = clamp((90 - d) / 25, 0, 1);
    c.beginPath();
    for (let q = 0; q <= 40; q++) {
      const [x, y] = P(a0 + (span * q) / 40, d, R);
      if (q) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    for (let q = 40; q >= 0; q--) {
      const [x, y] = P(a0 + (span * q) / 40, d, R - 0.9);
      c.lineTo(x, y);
    }
    c.closePath();
    c.fillStyle = '#ffffff';
    c.fill();
    c.strokeStyle = pal.accent;
    c.stroke();
  }
  c.globalAlpha = 1;
  const [sx, y0] = P(0, 0, R - 0.22);
  const u = F * 0.045;
  c.beginPath();
  c.moveTo(sx, y0 - 1.35 * u);
  c.lineTo(sx + 1.1 * u, y0 + 0.55 * u);
  c.lineTo(sx, y0 + 0.3 * u);
  c.lineTo(sx - 1.1 * u, y0 + 0.55 * u);
  c.closePath();
  c.fillStyle = pal.accent;
  c.fill();
};

const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;

const density: Preview = (c, w, h, t) => {
  // Two outlined fields: the left holds more dots, the right is smaller and denser.
  const fw = (w - 44) / 2;
  const fh = h * 0.62;
  const y0 = h * 0.14;
  const fields = [
    { x: 14, n: 16, w: fw, h: fh, r: 3.6 },
    { x: 30 + fw, n: 11, w: fw * 0.62, h: fh * 0.62, r: 3 },
  ];
  fields.forEach((f, k) => {
    c.strokeStyle = pal.ink3;
    c.lineWidth = 1;
    c.strokeRect(f.x + 0.5, y0 + 0.5, f.w, f.h);
    for (let i = 0; i < f.n; i++) circle(c, f.x + 8 + rnd(i + k * 40) * (f.w - 16), y0 + 8 + rnd(i + 77 + k * 40) * (f.h - 16), f.r, undefined, pal.ink);
  });
  const p = ph(t, 4);
  if (p > 0.55) {
    const g = fields[1];
    c.strokeStyle = pal.accent;
    c.lineWidth = 2;
    c.strokeRect(g.x - 2.5, y0 - 2.5, g.w + 5, g.h + 5);
    text(c, 'denser', g.x + g.w / 2, y0 + g.h + 20, font.mono(10, 500), pal.accent, 'center');
  }
  text(c, 'N ÷ A', 14, h - 12, font.mono(10, 500), pal.ink3, 'left');
};

const area: Preview = (c, w, h, t) => {
  const cy = h * 0.46;
  const p = ph(t, 5);
  const col = w / 3;
  const shapes = [
    () => {
      // A long thin bar: eye-catching, small area.
      c.fillRect(-col * 0.4, -3, col * 0.8, 6);
    },
    () => {
      c.beginPath();
      c.arc(0, 0, col * 0.26, 0, TAU);
      c.fill();
    },
    () => {
      c.beginPath();
      c.moveTo(0, -col * 0.3);
      c.lineTo(col * 0.32, col * 0.24);
      c.lineTo(-col * 0.32, col * 0.24);
      c.closePath();
      c.fill();
    },
  ];
  const rank = [3, 2, 1];
  shapes.forEach((draw, i) => {
    c.save();
    c.translate(col * (i + 0.5), cy);
    c.fillStyle = pal.ink;
    c.globalAlpha = 0.85;
    draw();
    c.restore();
    c.globalAlpha = 1;
    const k = clamp(p * 4 - (3 - rank[i]) * 0.6, 0, 1);
    if (k > 0) {
      c.globalAlpha = k;
      text(c, String(rank[i]), col * (i + 0.5), h - 16, font.mono(13, 600), rank[i] === 1 ? pal.accent : pal.ink2, 'center', 'middle');
      c.globalAlpha = 1;
    }
  });
};

const trace: Preview = (c, w, h, t) => {
  const s = Math.min(w, h) * 0.22;
  const g = 6;
  const x0 = w / 2 - (3 * s + 2 * g) / 2;
  const y0 = h / 2 - (3 * s + 2 * g) / 2;
  const seq = [4, 0, 8, 2];
  const p = ph(t, 6) * 8;
  const lit = p < 4 ? seq[Math.floor(p)] : -1;
  const tapped = p >= 4.5 ? Math.min(seq.length, Math.floor((p - 4.5) / 0.8) + 1) : 0;
  for (let i = 0; i < 9; i++) {
    const x = x0 + (i % 3) * (s + g);
    const y = y0 + Math.floor(i / 3) * (s + g);
    const on = i === lit && p % 1 < 0.8;
    c.fillStyle = on ? pal.accent : pal.paper2;
    c.fillRect(x, y, s, s);
    c.strokeStyle = on ? pal.accent : pal.line;
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    const n = seq.indexOf(i);
    if (n >= 0 && n < tapped) text(c, String(n + 1), x + s / 2, y + s / 2, font.mono(12, 600), pal.ink, 'center', 'middle');
  }
};

const weigh: Preview = (c, w, h, t) => {
  // A balance whose beam settles tilted: the heavier pan is the one that dips.
  const cx = w / 2;
  const py = h * 0.3;
  const L = w * 0.3;
  const tilt = 0.2 * easeOut(clamp(ph(t, 4) * 2.2, 0, 1)) * (ph(t, 8) < 0.5 ? 1 : -1);
  const ax = cx - Math.cos(tilt) * L;
  const ay = py - Math.sin(tilt) * L;
  const bx = cx + Math.cos(tilt) * L;
  const by = py + Math.sin(tilt) * L;
  line(c, cx, py, cx, h - 14, pal.ink3, 1.5);
  line(c, ax, ay, bx, by, pal.ink, 2);
  circle(c, cx, py, 3.5, undefined, pal.ink);
  [[ax, ay, 'A'], [bx, by, 'B']].forEach(([x, y, s]) => {
    line(c, x as number, y as number, x as number, (y as number) + h * 0.2, pal.ink2, 1);
    c.fillStyle = pal.paper2;
    c.fillRect((x as number) - 16, (y as number) + h * 0.2, 32, 8);
    c.strokeStyle = pal.ink2;
    c.strokeRect((x as number) - 15.5, (y as number) + h * 0.2 + 0.5, 31, 7);
    text(c, s as string, x as number, (y as number) + h * 0.2 - 8, font.mono(11, 600), pal.ink, 'center', 'middle');
  });
  text(c, 'A + B > C ?', cx, h - 4, font.mono(10, 500), pal.ink3, 'center');
};

const intersection: Preview = (c, w, h, t) => {
  const cy = h * 0.46;
  const r = Math.min(w, h) * 0.26;
  const d = r * (1.5 + 0.55 * Math.sin(t * 1.1));
  const ax = w / 2 - d / 2;
  const bx = w / 2 + d / 2;
  if (d < 2 * r) {
    // The lens between them, filled.
    const a = Math.acos(d / (2 * r));
    c.save();
    c.beginPath();
    c.arc(ax, cy, r, -a, a);
    c.arc(bx, cy, r, Math.PI - a, Math.PI + a);
    c.closePath();
    c.fillStyle = pal.accent;
    c.globalAlpha = 0.55;
    c.fill();
    c.restore();
    c.globalAlpha = 1;
  }
  circle(c, ax, cy, r, pal.ink, undefined, 1.5);
  circle(c, bx, cy, r, pal.ink2, undefined, 1.5, [4, 3]);
  const lens = d < 2 * r ? Math.round((1 - d / (2 * r)) * 60) : 0;
  text(c, d < 2 * r ? `${lens}% of A` : 'apart', w / 2, h - 12, font.mono(10, 500), d < 2 * r ? pal.accent : pal.ink3, 'center');
};

const count: Preview = (c, w, h, t) => {
  // A scatter of marked discs, then the counts as ranked bars.
  const mark = (x: number, y: number, k: number) => {
    if (k === 0) circle(c, x, y, 4, undefined, pal.ink);
    else if (k === 1) circle(c, x, y, 4, pal.ink, undefined, 1.4);
    else cross(c, x, y, 4, pal.ink, 1.4);
  };
  const counts = [11, 8, 6];
  let n = 0;
  counts.forEach((cn, k) => {
    for (let i = 0; i < cn; i++, n++) mark(14 + rnd(n) * (w - 28), 14 + rnd(n + 150) * (h * 0.5), k);
  });
  const p = ph(t, 4.5);
  const by = h * 0.8;
  counts.forEach((cn, k) => {
    const g = easeOut(clamp((p - 0.45) * 3 - k * 0.2, 0, 1));
    const bw = (w - 60) * (cn / 12) * g;
    c.fillStyle = k === 0 ? pal.accent : pal.ink2;
    c.globalAlpha = 0.85;
    c.fillRect(30, by - 12 + k * 9, bw, 6);
    c.globalAlpha = 1;
    mark(18, by - 9 + k * 9, k);
  });
};

const hypothesis: Preview = (c, w, h, t) => {
  // Test numbers one by one: IN or OUT narrows down the hidden rule.
  const tests: [number, boolean][] = [
    [12, true],
    [15, false],
    [48, true],
    [33, false],
    [90, true],
  ];
  const p = ph(t, 6) * (tests.length + 1.5);
  const row = Math.min(tests.length, Math.floor(p));
  const rh = (h - 44) / tests.length;
  tests.forEach(([n, inn], i) => {
    if (i >= row) return;
    const y = 16 + i * rh + rh / 2;
    text(c, String(n), w * 0.3, y, font.mono(13, 500), pal.ink, 'center', 'middle');
    text(c, inn ? 'IN' : 'OUT', w * 0.58, y, font.mono(11, 600), inn ? pal.accent : pal.ink3, 'left', 'middle');
    line(c, w * 0.22, y + rh * 0.45, w * 0.78, y + rh * 0.45, pal.line, 1);
  });
  if (p > tests.length + 0.6) text(c, 'rule: even numbers', w / 2, h - 12, font.mono(10, 500), pal.signal, 'center');
  else text(c, 'rule: ?', w / 2, h - 12, font.mono(10, 500), pal.ink3, 'center');
};

const rotate: Preview = (c, w, h, t) => {
  // A chiral piece, and the same piece turned (the mirror image is wrong).
  const shape = [
    [1, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const s = Math.min(w, h) * 0.12;
  const draw = (cx: number, cy: number, ang: number, flip: boolean, fill: string) => {
    c.save();
    c.translate(cx, cy);
    c.rotate(ang);
    if (flip) c.scale(-1, 1);
    shape.forEach((rw, i) =>
      rw.forEach((v, j) => {
        if (!v) return;
        c.fillStyle = fill;
        c.fillRect((j - 1) * s, (i - 2) * s, s - 1.5, s - 1.5);
      }),
    );
    c.restore();
  };
  const turn = easeInOut(clamp(ph(t, 4) * 1.6, 0, 1)) * (Math.PI / 2);
  draw(w * 0.26, h * 0.45, 0, false, pal.ink);
  text(c, '→', w * 0.44, h * 0.45, font.mono(14), pal.ink3, 'center', 'middle');
  draw(w * 0.62, h * 0.45, turn, false, pal.accent);
  draw(w * 0.86, h * 0.45, 0, true, pal.ink3);
  text(c, '✕', w * 0.86, h - 14, font.mono(12, 600), pal.signal, 'center', 'middle');
  text(c, '✓', w * 0.62, h - 14, font.mono(12, 600), pal.accent, 'center', 'middle');
};

const intercept: Preview = (c, w, h, t) => {
  // An object runs behind a frosted screen; press where it crosses the line.
  const y = h * 0.45;
  const L = 14;
  const R = w - 14;
  const tx = L + (R - L) * 0.86;
  const sx0 = L + (R - L) * 0.38;
  const sx1 = L + (R - L) * 0.7;
  const p = ph(t, 4.5);
  const u = (p / 0.8) ** 1.5 * 0.9;
  const x = L + (R - L) * Math.min(u, 1);
  line(c, L, y, R, y, pal.line, 1);
  line(c, tx, y - 22, tx, y + 22, pal.ink, 2);
  const hidden = x > sx0 && x < sx1;
  if (!hidden) circle(c, x, y, 6, undefined, pal.ink);
  c.fillStyle = pal.paper2;
  c.globalAlpha = 0.9;
  c.fillRect(sx0, y - 24, sx1 - sx0, 48);
  c.globalAlpha = 1;
  c.strokeStyle = pal.ink3;
  c.strokeRect(sx0 + 0.5, y - 23.5, sx1 - sx0 - 1, 47);
  if (p > 0.82) {
    line(c, tx, y - 30, tx, y + 30, pal.signal, 2);
    text(c, '+12 ms', tx, y + 46, font.mono(10, 500), pal.signal, 'center');
  }
};

const length: Preview = (c, w, h, t) => {
  // A wavy path is longer than the straight distance between its ends.
  const L = 18;
  const R = w - 18;
  const y = h * 0.42;
  const p = easeOut(clamp(ph(t, 4.5) * 2, 0, 1));
  c.beginPath();
  for (let i = 0; i <= 80 * p; i++) {
    const u = i / 80;
    const px = L + (R - L) * u;
    const py = y + Math.sin(u * TAU * 2.5) * h * 0.18;
    if (i) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.strokeStyle = pal.ink;
  c.lineWidth = 2;
  c.lineCap = 'round';
  c.stroke();
  circle(c, L, y, 3.5, undefined, pal.ink);
  circle(c, R, y, 3.5, undefined, pal.ink);
  if (p >= 1) {
    bracket(c, L, h * 0.84, R, h * 0.84, pal.ink3, 4);
    text(c, 'path ≠ distance', w / 2, h - 4, font.mono(10, 500), pal.accent, 'center');
  }
};

const filter: Preview = (c, w, h, t) => {
  // A stream of symbols; only the match (a circle straight after a triangle) is pressed.
  const seq = ['sq', 'tri', 'circ', 'sq', 'circ', 'tri', 'sq', 'tri', 'circ', 'sq'];
  const gapX = 46;
  const off = (t * 38) % (gapX * seq.length);
  const y = h * 0.42;
  const mx = w * 0.62;
  for (let i = -1; i < seq.length + 1; i++) {
    const k = ((i % seq.length) + seq.length) % seq.length;
    const x = -gapX + i * gapX - off + gapX * seq.length;
    const xx = ((x % (gapX * seq.length)) + gapX * seq.length) % (gapX * seq.length) - gapX;
    if (xx < -20 || xx > w + 20) continue;
    const prev = seq[(k + seq.length - 1) % seq.length];
    const hit = seq[k] === 'circ' && prev === 'tri';
    const near = Math.abs(xx - mx) < gapX / 2;
    const col = hit && near ? pal.accent : pal.ink;
    if (seq[k] === 'circ') circle(c, xx, y, 9, col, undefined, 2);
    else if (seq[k] === 'sq') {
      c.strokeStyle = col;
      c.lineWidth = 2;
      c.strokeRect(xx - 8, y - 8, 16, 16);
    } else {
      c.beginPath();
      c.moveTo(xx, y - 10);
      c.lineTo(xx + 10, y + 8);
      c.lineTo(xx - 10, y + 8);
      c.closePath();
      c.strokeStyle = col;
      c.lineWidth = 2;
      c.stroke();
    }
  }
  line(c, mx, y - 26, mx, y + 26, pal.ink3, 1, [3, 3]);
  text(c, '△ then ○ → press', w / 2, h - 14, font.mono(10, 500), pal.ink3, 'center');
};

const fpath: Preview = (c, w, h, t) => {
  // A formula's graph threading obstacles from the start point to the end point.
  const L = 18;
  const R = w - 18;
  const cy = h * 0.5;
  const f = (u: number) => -Math.sin(u * Math.PI * 1.6) * h * 0.26 * (1 - u * 0.4) + (u - 0.5) * h * 0.1;
  line(c, L, h - 16, R, h - 16, pal.line, 1);
  line(c, L, 10, L, h - 16, pal.line, 1);
  [[0.34, -0.24], [0.62, 0.3]].forEach(([u, dy]) => {
    c.fillStyle = pal.ink;
    c.globalAlpha = 0.75;
    c.fillRect(L + (R - L) * u - 6, cy + (dy as number) * h - 11, 12, 22);
    c.globalAlpha = 1;
  });
  const p = easeInOut(clamp(ph(t, 5) * 1.5, 0, 1));
  c.beginPath();
  for (let i = 0; i <= 80 * p; i++) {
    const u = i / 80;
    if (i) c.lineTo(L + (R - L) * u, cy + f(u));
    else c.moveTo(L + (R - L) * u, cy + f(u));
  }
  c.strokeStyle = pal.accent;
  c.lineWidth = 2;
  c.lineCap = 'round';
  c.stroke();
  circle(c, L, cy + f(0), 4, undefined, pal.accent);
  circle(c, R, cy + f(1), 4, pal.accent, undefined, 1.5);
  text(c, 'f(x) = …', w / 2, h - 3, font.mono(10, 500), pal.ink3, 'center');
};

// ── 41–52 ────────────────────────────────────────────────────────────────────────

const fovea: Preview = (c, w, h, t) => {
  // A blurry field of rings; a sharp lens wanders over it and finds the one with the gap up-right.
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 18; i++) pts.push([((i * 37) % 97) / 97, ((i * 61) % 89) / 89, (i * 3) % 8]);
  pts[11][2] = 7;
  const lx = w * (0.5 + 0.32 * Math.sin(t * 0.7));
  const ly = h * (0.5 + 0.28 * Math.sin(t * 1.1 + 1));
  const L = Math.min(w, h) * 0.22;
  for (const [u, v, g] of pts) {
    const x = 14 + u * (w - 28);
    const y = 14 + v * (h - 28);
    const near = Math.hypot(x - lx, y - ly) < L;
    if (!near) circle(c, x, y, 6, undefined, 'rgba(244,240,232,.18)');
    else {
      c.beginPath();
      c.arc(x, y, 6, (g * Math.PI) / 4 + 0.45, (g * Math.PI) / 4 - 0.45 + TAU);
      c.strokeStyle = g === 7 ? pal.accent : pal.ink;
      c.lineWidth = 1.6;
      c.stroke();
    }
  }
  circle(c, lx, ly, L, pal.accent, undefined, 1.25);
};

const aliasP: Preview = (c, w, h, t) => {
  // A fast wave and a slow wave pass through the same samples.
  const y0 = h * 0.48;
  const A = h * 0.3;
  const fs = 4;
  const f1 = 0.75;
  const f2 = f1 + fs;
  const X = (s: number) => 12 + (s / 2) * (w - 24);
  const wave = (f: number, col: string, lw: number) => {
    c.beginPath();
    for (let i = 0; i <= 300; i++) {
      const s = (i / 300) * 2;
      const y = y0 - A * Math.sin(TAU * f * s + 0.6);
      i ? c.lineTo(X(s), y) : c.moveTo(X(s), y);
    }
    c.strokeStyle = col;
    c.lineWidth = lw;
    c.stroke();
  };
  const p = ph(t, 6);
  if (p > 0.15) wave(f2, 'rgba(244,240,232,.3)', 1);
  wave(f1, pal.ink2, 1.5);
  for (let k = 0; k <= 8; k++) circle(c, X(k / fs), y0 - A * Math.sin(TAU * f1 * (k / fs) + 0.6), 3.5, undefined, pal.accent);
  text(c, 'same dots, two waves', w / 2, h - 6, font.mono(10, 500), pal.ink3, 'center');
};

const lagP: Preview = (c, w, h, t) => {
  // A dot follows commands that arrive late: the tape shows the queue.
  const p = ph(t, 5);
  const cmd = Math.sin(p * TAU) > 0 ? 1 : -1;
  const late = Math.sin((p - 0.15) * TAU) > 0 ? 1 : -1;
  const x = w / 2 + Math.sin((p - 0.15) * TAU) * w * 0.3;
  line(c, 16, h * 0.4, w - 16, h * 0.4, pal.line, 1);
  circle(c, x, h * 0.4, 7, undefined, pal.accent);
  const ty = h * 0.72;
  c.fillStyle = 'rgba(244,240,232,.08)';
  c.fillRect(20, ty - 8, w - 40, 16);
  for (let i = 0; i < 20; i++) {
    const v = Math.sin((p - 0.15 + (i / 20) * 0.15) * TAU) > 0 ? 1 : -1;
    c.fillStyle = 'rgba(242,184,75,.6)';
    c.fillRect(30 + (i * (w - 60)) / 20, v > 0 ? ty - 6 : ty, (w - 60) / 22, 6);
  }
  circle(c, 20, ty, 6, undefined, late > 0 ? '#F2B84B' : 'rgba(242,184,75,.4)');
  circle(c, w - 20, ty, 6, undefined, cmd > 0 ? pal.accent : 'rgba(46,233,215,.4)');
};

const foldP: Preview = (c, w, h, t) => {
  // A sheet folds in half, gets one punch, and opens with two mirrored holes.
  const s = Math.min(w, h) * 0.6;
  const x0 = w / 2 - s / 2;
  const y0 = h / 2 - s / 2;
  const p = ph(t, 5);
  const k = p < 0.35 ? Math.cos(Math.PI * (p / 0.35)) : p < 0.65 ? -1 : Math.cos(Math.PI * (1 - (p - 0.65) / 0.35));
  c.fillStyle = 'rgba(244,240,232,.14)';
  c.fillRect(x0 + s / 2, y0, s / 2, s);
  c.fillStyle = k < 0 ? 'rgba(242,184,75,.3)' : 'rgba(244,240,232,.14)';
  const fw = (s / 2) * Math.abs(k);
  c.fillRect(k >= 0 ? x0 + s / 2 - fw : x0 + s / 2, y0, fw, s);
  if (p > 0.45) circle(c, x0 + s * 0.75, y0 + s * 0.35, 5, pal.accent, pal.paper, 2);
  if (p > 0.9) circle(c, x0 + s * 0.25, y0 + s * 0.35, 5, pal.accent, pal.paper, 2);
};

const lastlook: Preview = (c, w, h, t) => {
  // Offers arrive one by one; one is taken.
  const vals = [42, 67, 31, 78, 55, 84, 49, 62];
  const n = Math.min(vals.length, 1 + Math.floor(ph(t, 8) * 10));
  const bw = (w - 40) / vals.length;
  vals.forEach((v, i) => {
    const x = 20 + i * bw;
    if (i >= n) return text(c, '?', x + bw / 2, h * 0.6, font.serif(14, true), pal.ink3, 'center');
    const bh = (v / 100) * h * 0.7;
    c.fillStyle = i === 5 && n > 5 ? pal.accent : i < Math.min(n, 5) ? 'rgba(244,240,232,.3)' : pal.ink;
    c.fillRect(x + 3, h - 14 - bh, bw - 6, bh);
  });
  line(c, 20, h * 0.42, w - 20, h * 0.52, 'rgba(46,233,215,.6)', 1, [4, 3]);
};

const checksumP: Preview = (c, w, h, t) => {
  // A parity grid with one flipped bit: its row and column fail and cross at it.
  const n = 5;
  const s = Math.min(w, h) / 7;
  const x0 = w / 2 - (n * s) / 2 - s / 2;
  const y0 = h / 2 - (n * s) / 2;
  const fixed = ph(t, 4) > 0.6;
  const g = [1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0];
  for (let i = 0; i < n * n; i++) {
    const bad = i === 12 && !fixed;
    text(c, String(bad ? 1 - g[i] : g[i]), x0 + (i % n) * s + s / 2, y0 + Math.floor(i / n) * s + s / 2, font.mono(12, 600), i === 12 ? (fixed ? pal.accent : pal.signal) : pal.ink2, 'center', 'middle');
  }
  text(c, fixed ? '✓' : '✗', x0 + n * s + s * 0.6, y0 + 2.5 * s, font.mono(12, 700), fixed ? pal.accent : pal.signal, 'center', 'middle');
  text(c, fixed ? '✓' : '✗', x0 + 2.5 * s, y0 + n * s + s * 0.5, font.mono(12, 700), fixed ? pal.accent : pal.signal, 'center', 'middle');
};

const descent: Preview = (c, w, h, t) => {
  // A probe walks downhill into a shallow valley; the deeper one waits elsewhere.
  const f = (u: number) => 0.6 - 0.35 * Math.exp(-(((u - 0.25) / 0.08) ** 2)) - 0.55 * Math.exp(-(((u - 0.75) / 0.06) ** 2));
  const X = (u: number) => 14 + u * (w - 28);
  const Y = (v: number) => 10 + v * (h - 24);
  const p = ph(t, 6);
  c.beginPath();
  for (let i = 0; i <= 120; i++) i ? c.lineTo(X(i / 120), Y(f(i / 120))) : c.moveTo(X(0), Y(f(0)));
  c.strokeStyle = p > 0.7 ? pal.ink2 : 'rgba(244,240,232,.08)';
  c.lineWidth = 1.5;
  c.stroke();
  for (let k = 0; k <= Math.min(5, Math.floor(p * 9)); k++) {
    const u = 0.05 + k * 0.04;
    circle(c, X(u), Y(f(u)), 3.5, undefined, '#F2B84B');
  }
  if (p > 0.7) circle(c, X(0.75), Y(f(0.75)), 5, undefined, pal.accent);
};

const projectionP: Preview = (c, w, h, t) => {
  // An isometric stack and its front silhouette.
  const s = Math.min(w, h) * 0.09;
  const hm = [2, 1, 0, 3, 1, 0, 1, 2, 1];
  const cx = w * 0.38;
  const cy = h * 0.35;
  const P = (x: number, y: number, z: number) => ({ x: cx + (x - y) * s * 0.87, y: cy + (x + y) * s * 0.5 - z * s });
  const grow = Math.min(1, ph(t, 4) * 1.5);
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++)
      for (let z = 0; z < Math.round(hm[y * 3 + x] * grow); z++) {
        const q = [P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)];
        c.beginPath();
        q.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.closePath();
        c.fillStyle = 'rgba(46,233,215,.6)';
        c.fill();
        c.strokeStyle = pal.paper;
        c.stroke();
      }
  const fx = w * 0.72;
  [3, 2, 2].forEach((v, i) => {
    for (let z = 0; z < v; z++) {
      c.fillStyle = 'rgba(244,240,232,.3)';
      c.fillRect(fx + i * 12, h * 0.75 - (z + 1) * 12, 10, 10);
    }
  });
};

const jndP: Preview = (c, w, h, t) => {
  // Two lines, nearly equal; the difference shrinks.
  const d = 0.25 * Math.pow(0.6, Math.floor(t / 1.6) % 5);
  const L = w * 0.3;
  line(c, w * 0.25 - L / 2, h * 0.42, w * 0.25 + L / 2, h * 0.42, pal.ink, 3);
  line(c, w * 0.75 - (L * (1 + d)) / 2, h * 0.5, w * 0.75 + (L * (1 + d)) / 2, h * 0.5, pal.ink, 3);
  text(c, `Δ ${(d * 100).toFixed(1)}%`, w / 2, h - 10, font.mono(10, 500), pal.ink3, 'center');
};

const regimeP: Preview = (c, w, h, t) => {
  // A stream of ✓ that breaks into ✗ after the rule changes, then recovers.
  const marks = '✓✓✓✓✓✓✗✗✓✓✓✓';
  const n = Math.min(marks.length, Math.floor(ph(t, 6) * 15));
  for (let i = 0; i < n; i++) text(c, marks[i], 16 + (i * (w - 32)) / marks.length, h * 0.55, font.mono(12, 700), marks[i] === '✓' ? pal.accent : pal.signal, 'left');
  if (n > 6) line(c, 16 + (6 * (w - 32)) / marks.length - 3, h * 0.3, 16 + (6 * (w - 32)) / marks.length - 3, h * 0.7, '#F2B84B', 1.5);
  circle(c, w / 2 - 14, h * 0.25, 7, undefined, pal.accent);
  c.fillStyle = '#F2B84B';
  c.fillRect(w / 2 + 7, h * 0.25 - 7, 14, 14);
};

const bifurcationP: Preview = (c, w, h, t) => {
  // The logistic bifurcation diagram, drawn left to right.
  const n = Math.floor(ph(t, 6) * 140);
  c.fillStyle = 'rgba(244,240,232,.6)';
  for (let i = 0; i < n; i++) {
    const r = 2.8 + (i / 140) * 1.2;
    let x = 0.3;
    for (let k = 0; k < 120; k++) x = r * x * (1 - x);
    for (let k = 0; k < 24; k++) {
      x = r * x * (1 - x);
      c.fillRect(12 + (i / 140) * (w - 24), h - 10 - x * (h - 20), 1, 1);
    }
  }
  line(c, 12 + (n / 140) * (w - 24), 8, 12 + (n / 140) * (w - 24), h - 8, pal.accent, 1);
};

const counterpointP: Preview = (c, w, h, t) => {
  // Two gates; an A token flips the first and the next B goes the other way.
  const p = ph(t, 4);
  const g1 = p < 0.5 ? 0 : 1;
  const gate = (x: number, y: number, s: number) => {
    const d = s ? 1 : -1;
    line(c, x - 12 * d, y - 6, x + 12 * d, y + 6, pal.ink, 3);
  };
  gate(w * 0.4, h * 0.32, g1);
  gate(w * 0.6, h * 0.6, 1);
  text(c, 'A', w * 0.4, h * 0.12, font.mono(11, 700), pal.accent, 'center');
  text(c, 'B', w * 0.6, h * 0.12, font.mono(11, 700), '#F2B84B', 'center');
  const tok = p < 0.5 ? { x: w * 0.4 - 20 * (p / 0.5), y: h * 0.2 + (h * 0.55 * p) / 0.5, col: pal.accent } : { x: w * 0.4 + 20 * ((p - 0.5) / 0.5), y: h * 0.2 + (h * 0.55 * (p - 0.5)) / 0.5, col: '#F2B84B' };
  circle(c, tok.x, tok.y, 5, undefined, tok.col);
  for (let b = 0; b < 3; b++) {
    c.strokeStyle = pal.line;
    c.strokeRect(w * (0.25 + b * 0.2) - 14, h - 22, 28, 14);
  }
};

export const previews: Record<string, Preview> = {
  fovea,
  alias: aliasP,
  lag: lagP,
  fold: foldP,
  lastlook,
  checksum: checksumP,
  descent,
  projection: projectionP,
  jnd: jndP,
  regime: regimeP,
  bifurcation: bifurcationP,
  counterpoint: counterpointP,
  density,
  area,
  trace,
  weigh,
  intersection,
  count,
  hypothesis,
  rotate,
  intercept,
  length,
  filter,
  fpath,
  slipstream,
  vessels,
  valves,
  verbatim,
  letterfall,
  rules,
  diff,
  quantity,
  brake,
  pendulum,
  zero, exact, loop, draw, stop, balance, drift, echo, center, plumb, phase, beat, intersect, perception, afterimage, pour, shadow, mirror };
