/* Shareable day-of schedule — phone-first, read-only. Reads the live
   schedule from the backend (needs the share key in the link: day.html?k=...)
   and checks for changes every minute, so edits on the admin Schedule page
   show up here on their own. On the wedding day it marks what's on now. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const START_HOUR = 8;
  const WEDDING_DAY = '2026-11-14';
  const TZ = 'America/Chicago';
  const REFRESH_MS = 60 * 1000;

  const $ = id => document.getElementById(id);
  const list = $('day-list'), foot = $('day-foot'), nowBox = $('day-now');
  const key = new URLSearchParams(location.search).get('k') || '';

  let events = [];
  let lastJson = '';
  let lastChecked = null;
  let scrolledToNow = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function timeLabel(slot) {
    const mins = START_HOUR * 60 + slot * 30;
    const h24 = Math.floor(mins / 60), m = mins % 60;
    const h12 = ((h24 + 11) % 12) + 1;
    return h12 + ':' + (m ? '30' : '00') + ' ' + (h24 % 24 < 12 ? 'AM' : 'PM');
  }
  function lengthLabel(e) {
    const mins = (e.end - e.start) * 30;
    const h = Math.floor(mins / 60), m = mins % 60;
    return (h ? h + ' hr' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
  }

  // Where "now" falls on the schedule, in half-hour slots (fractional), or null if it isn't the day.
  function nowSlot() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
    const date = parts.year + '-' + parts.month + '-' + parts.day;
    let mins = Number(parts.hour) * 60 + Number(parts.minute);
    if (date === WEDDING_DAY) return (mins - START_HOUR * 60) / 30;
    // After midnight, still the wedding night.
    if (date === '2026-11-15' && mins < 3 * 60) return (mins + 24 * 60 - START_HOUR * 60) / 30;
    return null;
  }

  function render() {
    if (!events.length) {
      list.innerHTML = '<li class="day-msg">Nothing scheduled yet.</li>';
      nowBox.hidden = true;
      return;
    }
    const now = nowSlot();
    const isNow = e => now != null && now >= e.start && now < e.end;
    const isPast = e => now != null && now >= e.end;
    const next = now == null ? null : events.find(e => e.start > now);

    list.innerHTML = events.map(e =>
      '<li class="day-ev' + (isNow(e) ? ' is-now' : '') + (isPast(e) ? ' is-past' : '') + (e === next ? ' is-next' : '') + '">' +
        '<div class="day-when">' +
          '<span class="day-start">' + timeLabel(e.start) + '</span>' +
          '<span class="day-len">' + lengthLabel(e) + '</span>' +
        '</div>' +
        '<div class="day-body-col">' +
          (isNow(e) ? '<span class="day-tag">Now</span>' : e === next ? '<span class="day-tag is-next">Next</span>' : '') +
          '<span class="day-what">' + esc(e.what || 'Untitled') + '</span>' +
          '<span class="day-until">' + timeLabel(e.start) + ' &ndash; ' + timeLabel(e.end) + '</span>' +
          (e.notes ? '<span class="day-notes">' + esc(e.notes).replace(/\n/g, '<br>') + '</span>' : '') +
        '</div>' +
      '</li>'
    ).join('');

    const current = events.filter(isNow);
    if (current.length) {
      nowBox.hidden = false;
      nowBox.innerHTML = '<span class="day-tag">Now</span> ' + current.map(e => '<strong>' + esc(e.what) + '</strong>').join(' &middot; ') +
        (next ? '<span class="day-now-next">Next: ' + esc(next.what) + ' at ' + timeLabel(next.start) + '</span>' : '');
    } else nowBox.hidden = true;

    if (!scrolledToNow && now != null) {
      const target = list.querySelector('.is-now') || list.querySelector('.is-next');
      if (target) { target.scrollIntoView({ block: 'center' }); scrolledToNow = true; }
    }
  }

  function renderFoot() {
    if (!lastChecked) return;
    foot.textContent = 'Live · checked ' + lastChecked.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
      '. Updates on its own.';
  }

  async function refresh() {
    if (!key) {
      list.innerHTML = '<li class="day-msg">This link is missing its key. Ask Michael or Alexandria for the full link.</li>';
      return;
    }
    try {
      const res = await fetch(WORKER_URL + '?action=schedule&k=' + encodeURIComponent(key), { cache: 'no-store' });
      if (res.status === 404) {
        list.innerHTML = '<li class="day-msg">This link isn’t working. Ask Michael or Alexandria for a fresh one.</li>';
        return;
      }
      const data = await res.json();
      if (!data || !data.ok) throw new Error('bad response');
      const json = JSON.stringify(data.events);
      if (json !== lastJson) { lastJson = json; events = data.events; render(); }
      else render(); // keeps Now / Next moving along with the clock
      lastChecked = new Date();
      renderFoot();
    } catch (err) {
      foot.textContent = 'Couldn’t reach the schedule just now — showing the last version. Will keep trying.';
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
