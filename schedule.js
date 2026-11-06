/* Day-of schedule — strip board. One row per half-hour, 8 AM to midnight.
   Each row can hold several events (strips). Each strip has its own start
   and end, so it can run longer than half an hour; the rows it runs through
   show a "continues" marker. Type straight into a strip; it saves on its own
   to D1, so it follows Michael + Xan across devices.
   "Print run of show" prints a clean call-sheet style table. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const START_HOUR = 8;
  const ROWS = 33;        // 8:00 AM ... 12:00 AM
  const END_MAX = 34;     // last possible end: 12:30 AM

  const $ = id => document.getElementById(id);
  const gate = $('gate'), app = $('app'), list = $('sched-list'), statusEl = $('sched-status');
  const filledToggle = $('sched-filled');

  let events = [];        // { id, start, end, what, who, notes }
  const timers = new Map();
  let queue = Promise.resolve();
  let tempId = 0;

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function status(msg) { statusEl.textContent = msg || ''; }
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
  function byTime(a, b) { return a.start - b.start || a.end - b.end || Math.abs(a.id) - Math.abs(b.id); }
  function sorted() { return events.slice().sort(byTime); }
  function find(id) { return events.find(e => String(e.id) === String(id)); }

  // ---------- Drawing ----------

  function timeOptions(from, to, selected) {
    let h = '';
    for (let i = from; i <= to; i++) h += '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + timeLabel(i) + '</option>';
    return h;
  }

  function stripHtml(e) {
    return '<div class="strip" data-id="' + e.id + '">' +
      '<div class="strip-main">' +
        '<input class="strip-what" data-f="what" type="text" placeholder="What’s happening" value="' + esc(e.what) + '" />' +
        '<span class="strip-times">' +
          '<select data-f="start" aria-label="Starts">' + timeOptions(0, ROWS - 1, e.start) + '</select>' +
          '<span class="strip-dash">to</span>' +
          '<select data-f="end" aria-label="Ends">' + timeOptions(e.start + 1, END_MAX, e.end) + '</select>' +
          '<span class="strip-len">' + lengthLabel(e) + '</span>' +
        '</span>' +
        '<button type="button" class="strip-del" aria-label="Delete">&times;</button>' +
      '</div>' +
      '<textarea class="strip-notes' + (e.notes ? ' has-text' : '') + '" data-f="notes" rows="1" placeholder="Where / notes">' + esc(e.notes) + '</textarea>' +
    '</div>';
  }

  function render(focusId) {
    const all = sorted();
    let html = '';
    // One row per hour (8 AM ... midnight). Half-hour starts live in their hour's row.
    for (let r = 0; r < ROWS; r += 2) {
      const starting = all.filter(e => e.start === r || e.start === r + 1);
      const running = all.filter(e => e.start < r && e.end > r);
      const filled = starting.length || running.length;
      const half = r + 1 < ROWS;
      const onHour = starting.filter(e => e.start === r), onHalf = starting.filter(e => e.start === r + 1);
      // Each line: time label on the left, strips on the right. Half-hour strips get their own "8:30" label.
      html += '<li class="sched-row' + (filled ? ' is-filled' : '') + '" data-slot="' + r + '">' +
        '<div class="sched-line"><div class="sched-time">' + timeLabel(r) + '</div><div class="sched-cell">' +
          running.map(e => '<button type="button" class="strip-cont" data-goto="' + e.id + '">\u21b3 ' +
            esc(e.what || 'Untitled') + ' <span>until ' + timeLabel(e.end) + '</span></button>').join('') +
          onHour.map(stripHtml).join('') +
        '</div></div>' +
        (onHalf.length ? '<div class="sched-line"><div class="sched-time">' + timeLabel(r + 1) + '</div><div class="sched-cell">' +
          onHalf.map(stripHtml).join('') + '</div></div>' : '') +
        '<div class="sched-line sched-adds-line"><div></div><div class="sched-adds">' +
          '<button type="button" class="sched-add" data-slot="' + r + '">+ Add at ' + timeLabel(r) + '</button>' +
          (half ? '<button type="button" class="sched-add is-half" data-slot="' + (r + 1) + '">+ ' + timeLabel(r + 1).replace(/ (AM|PM)$/, '') + '</button>' : '') +
        '</div></div></li>';
    }
    list.innerHTML = html;
    if (focusId != null) {
      const f = list.querySelector('.strip[data-id="' + focusId + '"] .strip-what');
      if (f) f.focus();
    }
    renderPrint();
  }

  // Print: the whole day as a half-hour strip on one page. Each event is one
  // block spanning its rows. Only events that overlap share the width; every
  // other block runs full width.
  function renderPrint() {
    const evs = sorted().filter(e => e.what || e.notes);
    const lastRow = Math.max(ROWS, ...evs.map(e => e.end));   // runs past midnight add a row
    const place = new Map();
    let cluster = [], clusterEnd = -1;
    function flush() {
      const lanes = [];
      cluster.forEach(e => {
        let lane = lanes.findIndex(end => end <= e.start);
        if (lane === -1) { lane = lanes.length; lanes.push(e.end); } else lanes[lane] = e.end;
        place.set(e, { lane });
      });
      cluster.forEach(e => { place.get(e).lanes = lanes.length; });
      cluster = []; clusterEnd = -1;
    }
    evs.forEach(e => {
      if (cluster.length && e.start >= clusterEnd) flush();
      cluster.push(e); clusterEnd = Math.max(clusterEnd, e.end);
    });
    if (cluster.length) flush();

    let html = '';
    for (let r = 0; r < lastRow; r++) {
      html += '<div class="ros-row ' + (r % 2 ? 'is-half' : 'is-hour') + '" style="top:calc(var(--row) * ' + r + ')">' +
        '<span class="ros-time">' + timeLabel(r) + '</span></div>';
    }
    evs.forEach(e => {
      const p = place.get(e), span = e.end - e.start;
      html += '<div class="ros-ev' + (span === 1 ? ' is-one' : '') + '" style="' +
        'top:calc(var(--row) * ' + e.start + ');height:calc(var(--row) * ' + span + ');' +
        'left:calc(var(--tcol) + (100% - var(--tcol)) * ' + (p.lane / p.lanes) + ');' +
        'width:calc((100% - var(--tcol)) / ' + p.lanes + ')"><div class="ev-box">' +
        '<span class="ev-name">' + esc(e.what || 'Untitled') + '</span>' +
        '<span class="ev-when">' + timeLabel(e.start) + ' &ndash; ' + timeLabel(e.end) + '</span>' +
        (e.notes ? '<span class="ev-notes">' + esc(e.notes).replace(/\n/g, ' · ') + '</span>' : '') +
        '</div></div>';
    });
    const day = $('ros-day');
    day.style.setProperty('--rows', lastRow);
    day.innerHTML = html;
    const d = new Date();
    $('ros-foot').textContent = 'Printed ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // ---------- Saving ----------

  async function post(action, payload) {
    const session = getSession();
    if (!session || !session.token) { window.location.href = 'admin.html'; throw new Error('logged out'); }
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: action, token: session.token, payload: payload })
    });
    const data = await res.json();
    if (!data || !data.ok) throw new Error(data && (data.error || data.message) || 'save failed');
    return data;
  }

  // Saves run one after another, so a new strip gets its id before it's updated.
  function save(ev) {
    timers.delete(ev);
    queue = queue.then(async () => {
      if (!events.includes(ev)) return;
      try {
        const oldId = ev.id;
        const data = await post('adminSaveEvent', {
          id: ev.id > 0 ? ev.id : undefined,
          start: ev.start, end: ev.end, what: ev.what, who: ev.who, notes: ev.notes
        });
        if (!(oldId > 0)) {
          ev.id = data.id;
          list.querySelectorAll('[data-id="' + oldId + '"]').forEach(n => { n.dataset.id = data.id; });
          list.querySelectorAll('[data-goto="' + oldId + '"]').forEach(n => { n.dataset.goto = data.id; });
        }
        if (!timers.size) status('Saved');
      } catch (err) {
        status('Didn’t save “' + (ev.what || 'event') + '” — check your connection and type again.');
      }
    });
    return queue;
  }
  function saveSoon(ev) {
    status('Saving…');
    clearTimeout(timers.get(ev));
    timers.set(ev, setTimeout(() => save(ev), 600));
  }

  function remove(ev) {
    clearTimeout(timers.get(ev)); timers.delete(ev);
    events = events.filter(x => x !== ev);
    render();
    queue = queue.then(async () => {
      if (!(ev.id > 0)) return;
      try { await post('adminDeleteEvent', { id: ev.id }); status('Deleted'); }
      catch (err) { status('Couldn’t delete — reload and try again.'); }
    });
  }

  function addAt(slot) {
    const ev = { id: --tempId, start: slot, end: Math.min(END_MAX, slot + 1), what: '', who: '', notes: '' };
    events.push(ev);
    filledToggle.checked = false; applyFilter();
    render(ev.id);
    save(ev);
  }

  function applyFilter() { app.classList.toggle('only-filled', filledToggle.checked); }

  // ---------- Wiring ----------

  list.addEventListener('input', e => {
    const strip = e.target.closest('.strip'); const f = e.target.dataset.f;
    if (!strip || !f || f === 'start' || f === 'end') return;
    const ev = find(strip.dataset.id); if (!ev) return;
    ev[f] = e.target.value;
    if (f === 'notes') e.target.classList.toggle('has-text', !!e.target.value);
    if (f === 'what') list.querySelectorAll('.strip-cont[data-goto="' + ev.id + '"]').forEach(n => {
      n.firstChild.nodeValue = '↳ ' + (ev.what || 'Untitled') + ' ';
    });
    renderPrint();
    saveSoon(ev);
  });

  list.addEventListener('change', e => {
    const strip = e.target.closest('.strip'); const f = e.target.dataset.f;
    if (!strip || (f !== 'start' && f !== 'end')) return;
    const ev = find(strip.dataset.id); if (!ev) return;
    const len = ev.end - ev.start;
    if (f === 'start') { ev.start = Number(e.target.value); ev.end = Math.min(END_MAX, ev.start + len); }
    else ev.end = Number(e.target.value);
    render();
    const moved = list.querySelector('.strip[data-id="' + ev.id + '"]');
    if (moved) moved.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    clearTimeout(timers.get(ev));
    status('Saving…');
    save(ev);
  });

  list.addEventListener('click', e => {
    const add = e.target.closest('.sched-add');
    if (add) { addAt(Number(add.dataset.slot)); return; }
    const del = e.target.closest('.strip-del');
    if (del) {
      const ev = find(del.closest('.strip').dataset.id);
      if (ev && (!(ev.what || ev.who || ev.notes) || confirm('Delete “' + (ev.what || 'this event') + '”?'))) remove(ev);
      return;
    }
    const cont = e.target.closest('.strip-cont');
    if (cont) {
      const s = list.querySelector('.strip[data-id="' + cont.dataset.goto + '"]');
      if (s) { s.scrollIntoView({ block: 'center', behavior: 'smooth' }); s.querySelector('.strip-what').focus({ preventScroll: true }); }
    }
  });

  filledToggle.addEventListener('change', applyFilter);
  $('sched-print').addEventListener('click', () => { renderPrint(); window.print(); });
  window.addEventListener('beforeunload', e => {
    if (timers.size) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Loading ----------

  async function load() {
    const session = getSession();
    if (!session || !session.token || Date.now() >= session.expiresAt) {
      window.location.href = 'admin.html';
      return;
    }
    let data;
    try {
      const res = await fetch(WORKER_URL + '?action=admin&token=' + encodeURIComponent(session.token));
      data = await res.json();
      if (!data || data.error) throw new Error(data && data.error);
    } catch (err) {
      gate.textContent = 'Could not load the schedule — try again from the Guest List page.';
      return;
    }
    events = (data.scheduleEvents || []).map(e => ({
      id: e.id, start: Number(e.start), end: Number(e.end), what: e.what || '', who: e.who || '', notes: e.notes || ''
    }));
    setupShare('https://mikeandxan.com/day');
    gate.hidden = true;
    app.hidden = false;
    render();
  }

  // Copy the guest-facing phone schedule link (day.html) for key people.
  function setupShare(url) {
    const btn = $('sched-share'), open = $('sched-share-open');
    btn.hidden = false; open.hidden = false; open.href = url;
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); btn.textContent = 'Copied!'; }
      catch (_) { window.prompt('Copy this link:', url); }
      setTimeout(() => { btn.textContent = 'Copy share link'; }, 2000);
    });
  }

  load();
})();
