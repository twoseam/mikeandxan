/* Admin menu — one shared bar across every admin page. The pages you work
   in are always-visible tabs (icon + name). Extras (printables, the public
   site) sit under "More". Shows only when logged in. Add a page here and it
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
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };

  const TABS = [
    { href: 'admin.html', label: 'Guests', icon: 'guests' },
    { href: 'schedule.html', label: 'Schedule', icon: 'schedule' },
    { href: 'seating.html', label: 'Seating', icon: 'seating' },
    { href: 'stats.html', label: 'Stats', icon: 'stats' },
    { href: 'reminders.html', label: 'Reminders', icon: 'reminders' },
    { href: 'mailing.html', label: 'Mailing', icon: 'mailing' }
  ];
  const MORE = [
    { href: 'day', label: 'Shared schedule (what guests see)' },
    { href: 'seating-chart.html', label: 'Print seating chart' },
    { href: 'envelopes.html', label: 'Print envelopes' },
    { href: 'index.html', label: 'Wedding website' },
    { href: 'photos.html', label: 'Guest photos' },
    { href: 'design.html', label: 'Design notes' }
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
        '<button type="button" class="anav-tab anav-more-btn" aria-expanded="false" aria-controls="anav-more">' +
          svg('more') + '<span>More</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="anav-more" id="anav-more" hidden>' +
      MORE.map(m => '<a href="' + m.href + '" target="_blank" rel="noopener">' + m.label + '</a>').join('') +
      '<p class="anav-more-note">These open in a new tab.</p>' +
    '</div>';

  function start() {
    document.body.insertBefore(bar, document.body.firstChild);
    const btn = bar.querySelector('.anav-more-btn'), panel = bar.querySelector('.anav-more');
    function set(open) {
      panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.classList.toggle('is-open', open);
      if (open) { // line the list up under the More button
        const r = btn.getBoundingClientRect();
        panel.style.right = 'auto';
        panel.style.left = Math.max(12, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12)) + 'px';
      }
    }
    btn.addEventListener('click', e => { e.stopPropagation(); set(panel.hidden); });
    document.addEventListener('click', e => { if (!bar.contains(e.target)) set(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
    const cur = bar.querySelector('.is-current');
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
