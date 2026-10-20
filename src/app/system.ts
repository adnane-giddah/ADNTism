// SYSTEM — settings for the app: sound, haptics, motion and flashes, text and target size.
import { sfx } from '../core/audio';
import { h } from '../core/dom';
import { settings, setSetting, type Settings } from '../core/settings';
import { games } from '../games/registry';
import { SITE } from '../core/route';
import type { Nav, Screen } from './app';
import { frame, label } from './ui';

export function systemScreen(_nav: Nav): Screen {
  const body = h('div', { class: 'y-grid' });

  const toggle = (name: string, hint: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h('button', { type: 'button', class: 'y-toggle', role: 'switch' });
    const paint = () => {
      b.setAttribute('aria-checked', String(get()));
      b.replaceChildren(h('i'), h('span', null, get() ? 'ON' : 'OFF'));
    };
    b.addEventListener('click', () => {
      set(!get());
      sfx.tick();
      paint();
    });
    paint();
    return frame('y-item', h('div', null, h('h3', null, name), h('p', null, hint)), b);
  };
  const choice = <K extends keyof Settings>(name: string, hint: string, key: K, opts: [Settings[K], string][]) => {
    const wrap = h('div', { class: 'a-seg sm' });
    const paint = () =>
      wrap.replaceChildren(
        ...opts.map(([v, l]) => {
          const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(settings[key] === v) }, l);
          b.addEventListener('click', () => {
            setSetting(key, v);
            sfx.tick();
            paint();
          });
          return b;
        }),
      );
    paint();
    return frame('y-item', h('div', null, h('h3', null, name), h('p', null, hint)), wrap);
  };

  const vol = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(settings.volume * 100)), class: 'y-range', 'aria-label': 'Volume' }) as HTMLInputElement;
  vol.addEventListener('input', () => setSetting('volume', Number(vol.value) / 100));
  vol.addEventListener('change', () => sfx.tick());

  body.append(
    toggle('Sound', 'Clicks, chimes and the beat cues of the rhythm experiments.', () => settings.sound, (v) => setSetting('sound', v)),
    frame('y-item', h('div', null, h('h3', null, 'Volume'), h('p', null, 'Master level for every sound.')), vol),
    toggle('Haptics', 'Short vibrations on judgements and records.', () => settings.haptics, (v) => setSetting('haptics', v)),
    toggle('No flashes', 'No screen inversion on an EXACT; beat lamps glow instead of flashing.', () => settings.noFlash, (v) => setSetting('noFlash', v)),
    toggle('Reduce motion', 'Calmer animations and effects.', () => settings.motion === 'reduce', (v) => setSetting('motion', v ? 'reduce' : 'system')),
    choice('Text size', 'Interface and in-game text.', 'textSize', [
      ['normal', 'NORMAL'],
      ['large', 'LARGE'],
    ]),
    choice('Touch targets', 'Bigger knobs and hit zones (never changes a score).', 'targets', [
      ['normal', 'NORMAL'],
      ['large', 'LARGE'],
    ]),
  );

  const el = h(
    'div',
    { class: 'a-screen a-system' },
    h('header', { class: 'a-strip' }, h('span', { class: 'a-label teal' }, h('i', { class: 'a-sq' }), 'SYSTEM // CONFIGURATION'), h('span', { class: 'a-badge' }, `${games.length} PROTOCOLS INSTALLED`)),
    h('h1', null, h('em', null, 'System')),
    body,
    frame('y-about', label('LOCAL APPARATUS RUNTIME', 'teal'), h('p', null, 'No remote servers. Every experiment, timing and record runs and stays on this device, with no connection needed.'), h('p', { class: 'a-note' }, `Website: ${SITE.replace('https://', '')}`)),
  );
  return { el, tab: 'system' };
}
