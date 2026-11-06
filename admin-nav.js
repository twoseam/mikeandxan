/* Admin menu — one shared bar across every admin page: always-visible tabs
   (icon + name). Shows only when logged in. Add a page to TABS and it
   appears everywhere. */
(function () {
  'use strict';

  const ICON = {
    guests: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    seating: '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="3" r="1.5"/><circle cx="12" cy="21" r="1.5"/><circle cx="3" cy="12" r="1.5"/><circle cx="21" cy="12" r="1.5"/>',
    stats: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
    reminders: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    mailing: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6 12 13 2 6"/>',
    photos: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    design: '<path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>'
  };

  const TABS = [
    { href: 'admin.html', label: 'Guests', icon: 'guests' },
    { href: 'schedule.html', label: 'Schedule', icon: 'schedule' },
    { href: 'seating.html', label: 'Seating', icon: 'seating' },
    { href: 'stats.html', label: 'Stats', icon: 'stats' },
    { href: 'mailing.html', label: 'Mailing', icon: 'mailing' },
    { href: 'photos.html', label: 'Photos', icon: 'photos' },
    { href: 'design.html', label: 'Design', icon: 'design' }
  ];

  try {
    const s = JSON.parse(localStorage.getItem('mx_admin_session') || 'null');
    if (!s || !s.token || Date.now() >= s.expiresAt) return;
  } catch (_) { return; }

  const here = (location.pathname.split('/').pop() || 'admin.html').replace(/\.html$/, '') + '.html';
  const svg = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>';

  const bar = document.createElement('nav');
  bar.className = 'anav';
  bar.setAttribute('aria-label', 'Admin');
  bar.innerHTML =
    '<div class="anav-bar">' +
      '<div class="anav-tabs">' +
        TABS.map(t => '<a href="' + t.href + '" class="anav-tab' + (t.href === here ? ' is-current" aria-current="page' : '') + '">' +
          svg(t.icon) + '<span>' + t.label + '</span></a>').join('') +
      '</div>' +
    '</div>';

  function start() {
    document.body.insertBefore(bar, document.body.firstChild);
    const cur = bar.querySelector('.is-current');
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
