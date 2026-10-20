type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> | null;

/** Tiny hyperscript. `on*` keys become listeners, everything else an attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'html') {
        el.innerHTML = String(v);
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function icon(markup: string): HTMLElement {
  const t = document.createElement('span');
  t.className = 'ico';
  t.setAttribute('aria-hidden', 'true');
  t.innerHTML = markup;
  return t;
}

export const icons = {
  back: '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  soundOn:
    '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M3.5 8h3l4-3.5v11l-4-3.5h-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M13.5 7.2a4 4 0 0 1 0 5.6M15.6 5.1a7 7 0 0 1 0 9.8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  soundOff:
    '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M3.5 8h3l4-3.5v11l-4-3.5h-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m13.5 8 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.4"/></svg>',
  share:
    '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 3v10M6 6.5 10 3l4 3.5M4 11v5h12v-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  again:
    '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M15.5 10a5.5 5.5 0 1 1-1.8-4.1M15.5 3.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  theme:
    '<svg viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
  help: '<svg viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 8a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="13.6" r=".9" fill="currentColor"/></svg>',
  arrow:
    '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  lock: '<svg viewBox="0 0 20 20" width="12" height="12"><rect x="4.5" y="9" width="11" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  // Tab bar (phone layout).
  grid: '<svg viewBox="0 0 20 20" width="22" height="22"><rect x="3" y="3" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  calendar: '<svg viewBox="0 0 20 20" width="22" height="22"><rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="12.6" r="1.6" fill="currentColor"/></svg>',
  chart: '<svg viewBox="0 0 20 20" width="22" height="22"><path d="M3.5 16.5h13" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 13.5v-3M10 13.5V5.5M14.5 13.5v-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 20 20" width="22" height="22"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="6.3" r="1.05" fill="currentColor"/></svg>',
  // Download section.
  android: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 9.5h10v7.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 17z" fill="currentColor"/><path d="M7.2 8.6a4.8 4.8 0 0 1 9.6 0z" fill="currentColor"/><path d="M8 4.6 9.2 6.3M16 4.6l-1.2 1.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 10v5M19 10v5M10 18.5v2.4M14 18.5v2.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  apple: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8C6.9 7.4 5.4 8.3 4.6 9.7c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.1.8c1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.8-1-2.8-4zM14.2 5.6c.6-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.8-1.3z" fill="currentColor"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="4.5" width="18" height="12" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 20.5h6M12 16.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 3v9.5M6 8.5l4 4 4-4M4 16.5h12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // App (landscape) shell.
  flask: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M9.5 3h5M10 3v6.2L4.8 18.4A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.6L14 9.2V3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.4 15h9.2" stroke="currentColor" stroke-width="1.6"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 12h4l2.5-6 4 12 2.5-6H21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="14" y="4.5" width="4" height="5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="14.5" width="4" height="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  pause: '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M7 4.5v11M13 4.5v11" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>',
  play: '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M6.5 4.5v11l9-5.5z" fill="currentColor"/></svg>',
  hand: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4.5A5.5 5.5 0 0 1 12.5 21h-1a5.5 5.5 0 0 1-4.6-2.5L4.3 14.4a1.5 1.5 0 0 1 2.4-1.8L9 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rotate: '<svg viewBox="0 0 48 48" width="56" height="56"><rect x="15" y="6" width="18" height="30" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 34a17 17 0 0 0 30 6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M38 34v6h-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};
