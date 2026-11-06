/* Admin menu — one shared bar across every admin page (Guest List, Stats,
   Reminders, Mailing, Seating, Schedule). Tap "Menu" to see everything,
   grouped. Shows only when logged in. Add a page here and it appears
   everywhere. */
(function () {
  'use strict';

  const GROUPS = [
    { name: 'Guests', items: [
      { href: 'admin.html', label: 'Guest List' },
      { href: 'stats.html', label: 'Stats' },
      { href: 'reminders.html', label: 'RSVP Reminders' },
      { href: 'mailing.html', label: 'Mailing' }
    ] },
    { name: 'Day-of', items: [
      { href: 'schedule.html', label: 'Schedule' },
      { href: 'day', label: 'Shared schedule', ext: true },
      { href: 'seating.html', label: 'Seating' }
    ] },
    { name: 'Print', items: [
      { href: 'seating-chart.html', label: 'Seating chart', ext: true },
      { href: 'envelopes.html', label: 'Envelopes', ext: true }
    ] },
    { name: 'Site', items: [
      { href: 'index.html', label: 'Wedding site', ext: true },
      { href: 'photos.html', label: 'Guest photos', ext: true },
      { href: 'design.html', label: 'Design', ext: true }
    ] }
  ];

  try {
    const s = JSON.parse(localStorage.getItem('mx_admin_session') || 'null');
    if (!s || !s.token || Date.now() >= s.expiresAt) return;
  } catch (_) { return; }

  const here = (location.pathname.split('/').pop() || 'admin.html').replace(/\.html$/, '') + '.html';
  let current = 'Admin';
  GROUPS.forEach(g => g.items.forEach(i => { if (!i.ext && i.href === here) current = i.label; }));

  const bar = document.createElement('nav');
  bar.className = 'anav';
  bar.setAttribute('aria-label', 'Admin menu');
  bar.innerHTML =
    '<div class="anav-bar">' +
      '<a href="admin.html" class="anav-brand">m &amp; a</a>' +
      '<span class="anav-here">' + current + '</span>' +
      '<button type="button" class="anav-toggle" aria-expanded="false" aria-controls="anav-panel">' +
        '<span class="anav-burger" aria-hidden="true"></span>Menu</button>' +
    '</div>' +
    '<div class="anav-panel" id="anav-panel" hidden>' +
      GROUPS.map(g =>
        '<div class="anav-group"><p class="anav-group-name">' + g.name + '</p>' +
        g.items.map(i =>
          '<a href="' + i.href + '"' + (i.ext ? ' target="_blank" rel="noopener"' : '') +
          ' class="anav-link' + (!i.ext && i.href === here ? ' is-current' : '') + '">' + i.label +
          (i.ext ? ' <span class="anav-ext" aria-label="opens in new tab">↗</span>' : '') + '</a>'
        ).join('') + '</div>'
      ).join('') +
    '</div>';

  function start() {
    document.body.insertBefore(bar, document.body.firstChild);
    const btn = bar.querySelector('.anav-toggle'), panel = bar.querySelector('.anav-panel');
    function set(open) { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); bar.classList.toggle('is-open', open); }
    btn.addEventListener('click', e => { e.stopPropagation(); set(panel.hidden); });
    document.addEventListener('click', e => { if (!bar.contains(e.target)) set(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
