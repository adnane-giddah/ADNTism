import { h, icon, icons } from '../core/dom';
import { dailyGame, dailyKey, games } from '../games/registry';
import { settings, setSetting, toggleTheme } from '../core/settings';
import { stats } from '../core/records';
import { href } from '../core/route';

export interface Page {
  el: HTMLElement;
  title: string;
  fullscreen?: boolean;
  mounted?: () => void;
  destroy?: () => void;
}

export function soundButton(cls = 'iconbtn') {
  const b = h('button', { class: cls, type: 'button' });
  const paint = () => {
    b.replaceChildren(icon(settings.sound ? icons.soundOn : icons.soundOff));
    b.setAttribute('aria-label', settings.sound ? 'Sound on — mute' : 'Sound off — unmute');
    b.setAttribute('aria-pressed', String(settings.sound));
    b.title = settings.sound ? 'Mute (M)' : 'Unmute (M)';
  };
  b.addEventListener('click', () => {
    setSetting('sound', !settings.sound);
    paint();
  });
  paint();
  return b;
}

export function themeButton(cls = 'iconbtn') {
  return h(
    'button',
    { class: cls, type: 'button', 'aria-label': 'Toggle light / dark', title: 'Light / dark', onclick: toggleTheme },
    icon(icons.theme),
  );
}

export function siteBar(active: 'experiments' | 'daily' | 'records' | 'about' | null) {
  const g = dailyGame();
  const playedToday = stats(g.id, g.better).dailyCount(dailyKey()) > 0;
  // Each tab carries an icon (shown in the phone tab bar) and a label.
  const tabIcon = { experiments: icons.grid, daily: icons.calendar, records: icons.chart, about: icons.info };
  const link = (href: string, label: string, key: typeof active, extra?: Node) =>
    h('a', { href, 'aria-current': active === key ? 'page' : null }, h('span', { class: 'tab-ico' }, icon(tabIcon[key!])), h('span', { class: 'tab-lbl' }, label, extra ?? null));
  return h(
    'header',
    { class: 'site-bar' },
    h(
      'div',
      { class: 'wrap' },
      h(
        'a',
        { class: 'mark', href: href('/'), 'aria-label': 'epsilon — home' },
        h('span', { class: 'eps', 'aria-hidden': 'true' }, 'ε'),
        h('span', { class: 'word-stack' }, h('span', { class: 'word' }, 'Epsilon', h('span', { class: 'lab-badge' }, 'LAB·00')), h('span', { class: 'def' }, 'a laboratory of very small errors')),
      ),
      h('span', { class: 'site-status cap' }, h('i', { class: 'live-dot' }), `Apparatus online · ${games.length} experiments`),
      h(
        'nav',
        { class: 'site-nav', 'aria-label': 'Main' },
        link(href('/'), 'Experiments', 'experiments'),
        link(href('/daily'), 'Daily', 'daily', playedToday ? undefined : h('span', { class: 'dot', 'aria-label': 'not played today' })),
        link(href('/records'), 'Records', 'records'),
        link(href('/about'), 'About', 'about'),
      ),
      h('div', { class: 'site-tools' }, soundButton(), themeButton()),
    ),
  );
}

export function siteFoot() {
  return h(
    'footer',
    { class: 'site-foot' },
    h(
      'div',
      { class: 'wrap' },
      h(
        'p',
        { class: 'defn' },
        h('i', null, 'ε'),
        '  ',
        h('span', { class: 'cap' }, 'epsilon, n.'),
        ' — an arbitrarily small positive quantity. The amount by which you missed.',
      ),
      h(
        'dl',
        { class: 'foot-tele' },
        ...[
          ['Execution', 'In browser'],
          ['Records', 'On device'],
          ['Network', 'Optional'],
        ].map(([k, v]) => h('div', null, h('dt', { class: 'cap' }, k), h('dd', { class: 'mono' }, v))),
      ),
    ),
    h(
      'div',
      { class: 'wrap foot-base cap' },
      h('span', null, '© Epsilon Labs · all deviations archived'),
      h('span', null, 'Precision level: critical'),
    ),
  );
}

let toastTimer = 0;
export function toast(msg: string) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}
