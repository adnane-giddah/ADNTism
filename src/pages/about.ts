import { h } from '../core/dom';
import { settings, setSetting } from '../core/settings';
import { siteBar, siteFoot, type Page } from './chrome';
import { href } from '../core/route';

function toggleRow(label: string, hint: string, get: () => boolean, set: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox', class: 'toggle', role: 'switch' });
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return h('label', null, h('span', null, label, h('small', null, hint)), input);
}

function volumeRow() {
  const input = h('input', { type: 'range', min: '0', max: '100', step: '5', class: 'vol', 'aria-label': 'Volume' });
  input.value = String(Math.round(settings.volume * 100));
  const out = h('small', null, `${input.value}%`);
  input.addEventListener('input', () => {
    out.textContent = `${input.value}%`;
    setSetting('volume', Number(input.value) / 100);
  });
  return h('label', null, h('span', null, 'Volume', out), input);
}

function choiceRow<T extends string>(label: string, hint: string, options: [T, string][], get: () => T, set: (v: T) => void) {
  const sel = h('select', { class: 'choice', 'aria-label': label }, ...options.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = get();
  sel.addEventListener('change', () => set(sel.value as T));
  return h('label', null, h('span', null, label, h('small', null, hint)), sel);
}

export function aboutPage(): Page {
  const el = h(
    'div',
    null,
    siteBar('about'),
    h(
      'main',
      null,
      h(
        'header',
        { class: 'wrap page-head' },
        h('span', { class: 'cap' }, 'About the laboratory'),
        h('h1', null, 'Very simple action.', h('br'), h('em', null, 'Surprisingly deep consequence.')),
      ),
      h(
        'div',
        { class: 'wrap prose' },
        h(
          'p',
          null,
          'Computers measure perfectly. Bodies don’t. Every experiment here asks one thing: ',
          h('strong', null, 'can your hand actually produce the answer?'),
          ' Not “can you solve it” — you usually can, instantly. The question is whether your timing, your aim and your sense of space can get it exactly right.',
        ),
        h(
          'p',
          null,
          'You’ll understand each one in seconds. Then you’ll be off by 0.031. Then 0.019. Then 0.012. That shrinking number is the whole thing.',
        ),

        h('h2', null, 'Honest measurement'),
        h(
          'ul',
          null,
          h(
            'li',
            null,
            h('strong', null, 'Time'),
            ' comes from your input events’ own high-resolution timestamps, never from timers. Browsers coarsen these to protect privacy (about 0.1 ms in Chromium, ~1 ms in Firefox and Safari), so time is shown to the millisecond and no finer.',
          ),
          h(
            'li',
            null,
            h('strong', null, 'Latency'),
            ' — the delay between your finger and the event — is roughly constant on one device. Duration games (Zero, Echo, Calibration) measure the gap between two of your own events, so it mostly cancels. Scores are still best compared on the same device.',
          ),
          h(
            'li',
            null,
            h('strong', null, 'Space'),
            ' is measured in ',
            h('strong', null, 'u'),
            ': each experiment’s field is a fixed number of units wide whatever the screen size, so a phone and a monitor are judged alike. Precision is shown only to what a pointer can resolve.',
          ),
          h(
            'li',
            null,
            h('strong', null, 'Randomness'),
            ' is seeded. The seed shown in the corner reproduces the exact same conditions; the daily experiment uses one seed for everyone that day.',
          ),
          h(
            'li',
            null,
            h('strong', null, 'Records'),
            ' stay in this browser. There is no account and no server. Global leaderboards would need one, and would need cheat resistance this build doesn’t pretend to have.',
          ),
        ),

        h('h2', null, 'Fair play'),
        h(
          'ul',
          null,
          h('li', null, h('strong', null, 'Ranked'), ' runs use a fresh random seed and count towards your bests. Your very first attempt at each experiment is an unranked ', h('strong', null, 'warm-up'), '.'),
          h('li', null, h('strong', null, 'Practice'), ' (P) is never ranked, and some experiments show extra help in it — e.g. Zero shows the running total on Hard; Close the Loop shows your arrow’s components.'),
          h(
            'li',
            null,
            h('strong', null, 'Challenge links'),
            ' (click the RUN seed, or “Copy challenge link”) replay exactly the same seed, level and scoring. They are never ranked — a known seed can be rehearsed — and they never use up an official daily attempt. A link proves nothing about a score; it only shares the conditions.',
          ),
          h('li', null, h('strong', null, 'Daily'), ' attempts are always Medium with the default scoring: three official tries, best counts.'),
          h('li', null, 'Hiding the tab during Stop, Drift or Echo ', h('strong', null, 'voids'), ' the attempt (nothing is recorded), so it can’t be used as a pause. An interrupted touch never commits an answer.'),
          h(
            'li',
            null,
            'When an input method changes what you can see — aiming Exact Hard with the keyboard shows the needle — the run is recorded in a ',
            h('strong', null, 'separate category'),
            ', not mixed with pointer runs.',
          ),
          h(
            'li',
            null,
            h('strong', null, 'Calibration'),
            ' is a personal baseline for producing durations. It is not a reaction-time test and it does not correct any other score for your device’s latency.',
          ),
          h('li', null, 'The Precision Profile groups your results by skill but never adds them up: milliseconds, degrees and units are different things. It describes these tasks, not your abilities.'),
        ),

        h('h2', { id: 'settings' }, 'Settings'),
        h(
          'div',
          { class: 'settings' },
          toggleRow('Sound', 'Subtle synthesized feedback. M toggles it anywhere.', () => settings.sound, (v) => setSetting('sound', v)),
          volumeRow(),
          toggleRow('No flashes', 'No screen inversion on EXACT; beat lamps glow gently instead of flashing. Timing cues stay visible.', () => settings.noFlash, (v) => setSetting('noFlash', v)),
          toggleRow('Large text', 'Bigger interface and in-game text.', () => settings.textSize === 'large', (v) => setSetting('textSize', v ? 'large' : 'normal')),
          toggleRow('Large targets', 'Bigger slider knobs and start zones. Never changes how a result is scored.', () => settings.targets === 'large', (v) => setSetting('targets', v ? 'large' : 'normal')),
          choiceRow(
            'Key sensitivity',
            'How fast arrow keys move sliders and cursors.',
            [
              ['low', 'Low (½×)'],
              ['normal', 'Normal'],
              ['high', 'High (2×)'],
            ],
            () => settings.sensitivity,
            (v) => setSetting('sensitivity', v),
          ),
          toggleRow('Haptics', 'Tiny vibrations on supported phones.', () => settings.haptics, (v) => setSetting('haptics', v)),
          toggleRow('Reduce motion', 'No flashes or easing; results appear instantly.', () => settings.motion === 'reduce', (v) => setSetting('motion', v ? 'reduce' : 'system')),
          toggleRow('High contrast', 'Stronger lines and secondary text.', () => settings.contrast, (v) => setSetting('contrast', v)),
          toggleRow('Dark', 'Ink on black instead of ink on paper.', () => document.documentElement.dataset.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches), (v) => setSetting('theme', v ? 'dark' : 'light')),
        ),

        h('h2', null, 'Keys'),
        h(
          'p',
          null,
          'Every experiment works with mouse, touch and keyboard. ',
          h('kbd', null, 'Space'),
          ' / ',
          h('kbd', null, 'Enter'),
          ' or ',
          h('kbd', null, 'R'),
          ' for another attempt, ',
          h('kbd', null, 'Esc'),
          ' to leave, ',
          h('kbd', null, '?'),
          ' for the rules, ',
          h('kbd', null, 'M'),
          ' for sound.',
        ),
        h('h2', null, 'Colour'),
        h(
          'p',
          null,
          'Red means error, and only error — but nothing relies on colour alone. Errors are always drawn as dimension lines with a signed number, and ideal positions as dashed ghosts.',
        ),
      ),
    ),
    siteFoot(),
  );
  return { el, title: 'About — epsilon' };
}

export function notFound(): Page {
  const el = h(
    'div',
    null,
    siteBar(null),
    h(
      'main',
      { class: 'wrap lost' },
      h('span', { class: 'cap' }, 'Error: +1 page'),
      h('h1', { style: 'font:400 clamp(56px,9vw,120px)/.9 var(--serif);margin:12px 0 24px' }, 'Overshot.'),
      h('a', { class: 'btn primary', href: href('/') }, 'Back to the experiments'),
    ),
  );
  return { el, title: 'Not found — epsilon' };
}
