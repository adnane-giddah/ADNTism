// "Get the app" — the website's download section (hidden inside the installed apps).
// Android: the APK from the latest GitHub release. iPhone: Add to Home Screen (Safari), which installs the
// web app full-screen and offline. Computer: the browser's own install (Chrome / Edge), also offline.
import { h, icon, icons } from '../core/dom';
import { canInstall, onInstallChange, platform, promptInstall } from '../core/install';
import { APK_RELEASE_URL, APK_URL } from '../core/route';
import { toast } from './chrome';

export function getAppSection() {
  const mine = platform();
  const installBtn = h('button', { class: 'btn brand', type: 'button' }, icon(icons.download), 'Install');
  const installHint = h('p', { class: 'ga-sub' });
  const paint = () => {
    installBtn.hidden = !canInstall();
    installHint.textContent = canInstall() ? 'One click — no store, no account.' : 'Chrome or Edge: use the ⊕ Install icon at the right of the address bar.';
  };
  installBtn.addEventListener('click', async () => {
    if (await promptInstall()) toast('Installed — epsilon now opens like an app, even offline');
    paint();
  });
  paint();
  const off = onInstallChange(paint);

  const card = (id: string, ico: string, title: string, sub: string, ...body: (Node | null)[]) =>
    h('article', { class: 'ga-card', 'data-mine': mine === id ? '1' : '0' }, h('div', { class: 'ga-top' }, h('span', { class: 'ga-ico' }, icon(ico)), h('div', null, h('h3', null, title), h('p', { class: 'ga-sub' }, sub))), ...body);

  const el = h(
    'section',
    { class: 'wrap get-app', id: 'get-app', 'aria-label': 'Get the app' },
    h('div', { class: 'ga-head' }, h('h2', null, 'Take it ', h('em', null, 'offline')), h('span', { class: 'cap' }, 'Free · no account · records stay on your device')),
    h(
      'div',
      { class: 'ga-cards' },
      card(
        'android',
        icons.android,
        'Android',
        'App · APK download',
        h('p', null, 'The full lab as a phone app. Plays with no connection at all.'),
        h('ol', null, h('li', null, 'Download the APK.'), h('li', null, 'Open it; if asked, allow installing from your browser.'), h('li', null, 'Launch epsilon from your home screen.')),
        h('div', { class: 'ga-act' }, h('a', { class: 'btn brand', href: APK_URL, download: 'epsilon.apk' }, icon(icons.download), 'Download APK')),
        h('p', { class: 'ga-sub' }, 'Download stuck? Open Files → Downloads — it is usually already there. ', h('a', { href: APK_RELEASE_URL, rel: 'noopener', target: '_blank' }, 'Or get it from GitHub')),
      ),
      card(
        'ios',
        icons.apple,
        'iPhone & iPad',
        'Home-screen app · Safari',
        h('p', null, 'Installs from Safari in seconds and then works offline, full screen.'),
        h('ol', null, h('li', null, 'Open this page in Safari.'), h('li', null, 'Tap Share (the square with an arrow).'), h('li', null, 'Choose “Add to Home Screen”, then Add.')),
      ),
      card('desktop', icons.monitor, 'Computer', 'Installed web app · Windows, Mac, Linux', h('p', null, 'Runs in its own window and works offline after the first visit.'), installHint, h('div', { class: 'ga-act' }, installBtn)),
    ),
    h('p', { class: 'ga-note' }, 'The Android app is not on the Play Store, so Android asks once for permission to install it. Every version is built automatically from this site’s source.'),
  );
  return { el, destroy: off };
}
