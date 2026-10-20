// Render every app icon from one design: a yellow ε on black. Run `npm run icons` after changing it.
// Writes the web / iPhone icons into public/ and, if the Android project exists, its launcher icons.
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const YELLOW = '#FFD60A';
const EPS = (s) =>
  `<path d="M42.5 21.5c-2.4-2.8-6-4.4-10-4.4-6.2 0-10.6 3.6-10.6 8.4 0 3.3 2.2 5.7 5.5 6.7-4.2 1-7.1 4-7.1 8 0 5.3 5.1 9 12.2 9 4.2 0 8-1.6 10.6-4.4" fill="none" stroke="${YELLOW}" stroke-width="5" stroke-linecap="round" transform="${s}"/><path d="M27.5 32.2h9" stroke="${YELLOW}" stroke-width="5" stroke-linecap="round" transform="${s}"/>`;
/** rounded: tile with corners (favicon); full: full-bleed square (OS masks it); scale: ε size inside. */
const svg = (rounded, scale = 1, bg = '#000000') => {
  const t = `translate(32 32) scale(${scale}) translate(-32 -32)`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg ? `<rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="${bg}"/>` : ''}${EPS(t)}</svg>`);
};
const png = (buf, size, out) => sharp(buf, { density: 600 }).resize(size, size).png().toFile(out);

const pub = resolve('public');
await png(svg(true), 192, resolve(pub, 'icon-192.png'));
await png(svg(true), 512, resolve(pub, 'icon-512.png'));
// Maskable: full bleed, ε inside the 80% safe zone.
await png(svg(false, 0.78), 512, resolve(pub, 'icon-maskable-512.png'));
// iPhone rounds the corners itself.
await png(svg(false, 0.9), 180, resolve(pub, 'apple-touch-icon.png'));

// Android launcher icons (legacy square + round, and the adaptive-icon foreground on transparent).
const res = resolve('android/app/src/main/res');
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = resolve(res, `mipmap-${d}`);
    mkdirSync(dir, { recursive: true });
    await png(svg(true, 0.95), Math.round(48 * k), resolve(dir, 'ic_launcher.png'));
    await png(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#000"/>${EPS('translate(32 32) scale(0.82) translate(-32 -32)')}</svg>`), Math.round(48 * k), resolve(dir, 'ic_launcher_round.png'));
    await png(svg(false, 0.62, ''), Math.round(108 * k), resolve(dir, 'ic_launcher_foreground.png'));
  }
  // Splash screens: every existing splash.png, redrawn at its own size — the ε centred on the app's paper colour.
  for (const d of readdirSync(res).filter((x) => x.startsWith('drawable'))) {
    const f = resolve(res, d, 'splash.png');
    if (!existsSync(f)) continue;
    const { width, height } = await sharp(f).metadata();
    const s = Math.round(Math.min(width, height) * 0.28);
    const mark = await sharp(svg(true, 0.95), { density: 600 }).resize(s, s).png().toBuffer();
    await sharp({ create: { width, height, channels: 4, background: '#0A0A0C' } })
      .composite([{ input: mark, gravity: 'center' }])
      .png()
      .toFile(f + '.tmp');
    renameSync(f + '.tmp', f);
  }
}
console.log('icons written');
