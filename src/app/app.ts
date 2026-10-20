// The phone app (landscape). Its own interface — the "Obsidian Telemetry" design — around the same games as
// the website: Lab (library) → Briefing (every setting chosen before playing) → Session (the game alone,
// full screen) → Debrief. Telemetry holds the records, System the settings. A screen stack drives navigation;
// the Android back button walks it (and pauses a game instead of leaving it).
import './app.css';
import { h, icon, icons } from '../core/dom';
import { refreshPalette } from '../core/draw';
import { NATIVE } from '../core/route';
import type { Level } from '../core/types';

export interface Screen {
  el: HTMLElement;
  /** Session screens cover everything (no rail). */
  fullscreen?: boolean;
  tab?: 'lab' | 'telemetry' | 'system';
  mounted?: () => void;
  destroy?: () => void;
  /** Handle the back button inside the screen; true when handled. */
  back?: () => boolean;
}

export interface Setup {
  id: string;
  level: Level;
  mode: string;
  practice: boolean;
  daily: boolean;
}

export interface Nav {
  lab: () => void;
  briefing: (id: string, daily?: boolean) => void;
  play: (s: Setup) => void;
  telemetry: (id?: string) => void;
  system: () => void;
  back: () => void;
  /** Replace the current screen (e.g. Debrief → Briefing without growing the stack). */
  replace: (f: () => Promise<Screen> | Screen) => void;
}

type Factory = () => Promise<Screen> | Screen;

export function start(root: HTMLElement) {
  const html = document.documentElement;
  html.classList.add('app');
  // The app's look is fixed: the dark telemetry palette, regardless of the website's theme choice.
  html.dataset.theme = 'dark';
  refreshPalette();

  const rail = h('nav', { class: 'a-rail', 'aria-label': 'Sections' });
  const view = h('main', { class: 'a-view' });
  const rotate = h('div', { class: 'a-rotate', role: 'alert' }, icon(icons.rotate), h('p', null, 'Turn your phone sideways'), h('span', { class: 'a-label' }, 'EPSILON PLAYS IN LANDSCAPE'));
  root.replaceChildren(h('div', { class: 'a-shell' }, rail, view), rotate);

  const stack: Factory[] = [];
  let cur: Screen | null = null;
  let token = 0;

  async function show(f: Factory) {
    const t = ++token;
    const s = await f();
    if (t !== token) return s.destroy?.();
    cur?.destroy?.();
    cur = s;
    view.replaceChildren(s.el);
    html.classList.toggle('a-full', !!s.fullscreen);
    paintRail(s.tab);
    view.scrollTop = 0;
    s.mounted?.();
  }
  const push = (f: Factory) => {
    stack.push(f);
    void show(f);
  };

  const nav: Nav = {
    lab: () => {
      stack.length = 0;
      push(async () => (await import('./lab')).labScreen(nav));
    },
    briefing: (id, daily = false) => push(async () => (await import('./briefing')).briefingScreen(nav, id, daily)),
    play: (s) => push(async () => (await import('./session')).sessionScreen(nav, s)),
    telemetry: (id) => {
      stack.length = 0;
      push(async () => (await import('./telemetry')).telemetryScreen(nav, id));
    },
    system: () => {
      stack.length = 0;
      push(async () => (await import('./system')).systemScreen(nav));
    },
    back: () => {
      if (cur?.back?.()) return;
      if (stack.length > 1) {
        stack.pop();
        void show(stack[stack.length - 1]);
      } else if (cur?.tab !== 'lab') nav.lab();
      else if (NATIVE) void import('@capacitor/app').then(({ App }) => App.exitApp());
    },
    replace: (f) => {
      stack.pop();
      push(f);
    },
  };

  function paintRail(tab?: Screen['tab']) {
    const item = (id: NonNullable<Screen['tab']>, ico: string, name: string, go: () => void) => {
      const b = h('button', { type: 'button', class: 'a-rail-item', 'aria-current': tab === id ? 'page' : null, 'aria-label': name }, icon(ico), h('span', null, name));
      b.addEventListener('click', () => tab !== id && go());
      return b;
    };
    rail.replaceChildren(
      h('div', { class: 'a-logo', 'aria-hidden': 'true' }, 'ε'),
      item('lab', icons.flask, 'Lab', nav.lab),
      item('telemetry', icons.pulse, 'Telemetry', () => nav.telemetry()),
      item('system', icons.sliders, 'System', nav.system),
      h('div', { class: 'a-rail-foot' }, h('i', { class: 'a-dot' }), 'LIVE'),
    );
  }

  if (NATIVE) {
    void import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => nav.back()));
  }
  // Browser preview (?app): Escape and the browser's back act like the Android back button.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      nav.back();
    }
  });
  nav.lab();
}
