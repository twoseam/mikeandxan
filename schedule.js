/* Day-of schedule — a timeline for the wedding day, 8 AM to midnight in
   half-hours. Events can span several half-hours, and several events can
   happen at once (shown side by side). Tap a time to add, tap an event to
   edit. Saves on its own to D1, so it follows Michael + Xan across devices.
   "Print run of show" prints a clean call-sheet style table. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const START_HOUR = 8;
  const ROWS = 33;        // labelled half-hours: 8:00 AM ... 12:00 AM
  const END_MAX = 34;     // last possible end: 12:30 AM
  const ROW_PX = 44;

  const $ = id => document.getElementById(id);
  const gate = $('gate'), app = $('app'), grid = $('sched-grid'), statusEl = $('sched-status');
  const editor = $('sched-editor');
  const ed = { what: $('ed-what'), who: $('ed-who'), notes: $('ed-notes'), start: $('ed-start'), end: $('ed-end') };

  let events = [];        // { id, start, end, what, who, notes }
  let editing = null;     // event being edited
  let saveTimer = null;
  let saving = Promise.resolve();

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
  function sorted() {
    return events.slice().sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);
  }

  // Side-by-side layout: events that overlap share the width.
  function layout() {
    const list = sorted(), out = new Map();
    let cluster = [], clusterEnd = -1;
    function flush() {
      const lanes = [];
      cluster.forEach(e => {
        let lane = lanes.findIndex(end => end <= e.start);
        if (lane === -1) { lane = lanes.length; lanes.push(e.end); } else lanes[lane] = e.end;
        out.set(e, { lane });
      });
      cluster.forEach(e => { out.get(e).lanes = lanes.length; });
      cluster = []; clusterEnd = -1;
    }
    list.forEach(e => {
      if (cluster.length && e.start >= clusterEnd) flush();
      cluster.push(e); clusterEnd = Math.max(clusterEnd, e.end);
    });
    if (cluster.length) flush();
    return out;
  }

  // ---------- Drawing ----------

  function render() {
    grid.style.height = (ROWS * ROW_PX) + 'px';
    let html = '';
    for (let r = 0; r < ROWS; r++) {
      html += '<button type="button" class="sched-slot' + (r % 2 ? '' : ' is-hour') + '" data-slot="' + r +
        '" style="top:' + (r * ROW_PX) + 'px;height:' + ROW_PX + 'px" aria-label="Add event at ' + timeLabel(r) + '">' +
        '<span class="sched-slot-time">' + timeLabel(r) + '</span></button>';
    }
    const pos = layout();
    sorted().forEach(e => {
      const p = pos.get(e);
      const w = 100 / p.lanes;
      const h = Math.max(1, e.end - e.start) * ROW_PX - 4;
      html += '<button type="button" class="sched-event' + (h < 60 ? ' is-short' : '') + (e.what ? '' : ' is-empty') +
        '" data-id="' + e.id + '" style="top:' + (e.start * ROW_PX + 2) + 'px;height:' + h + 'px;' +
        'left:calc(var(--lane-x) + (100% - var(--lane-x)) * ' + (p.lane * w / 100) + ');' +
        'width:calc((100% - var(--lane-x)) * ' + (w / 100) + ' - 4px)">' +
        '<span class="ev-time">' + timeLabel(e.start) + ' &ndash; ' + timeLabel(e.end) + '</span>' +
        '<span class="ev-what">' + esc(e.what || 'Untitled') + '</span>' +
        (e.who ? '<span class="ev-who">' + esc(e.who) + '</span>' : '') +
        '</button>';
    });
    grid.innerHTML = html;
    renderPrint();
  }

  function renderPrint() {
    const rows = sorted().filter(e => e.what || e.who || e.notes);
    $('ros-body').innerHTML = rows.length ? rows.map(e =>
      '<tr><td class="c-time">' + timeLabel(e.start) + '<span class="ros-to"> &ndash; ' + timeLabel(e.end) + '</span></td>' +
      '<td class="c-len">' + lengthLabel(e) + '</td>' +
      '<td class="c-what">' + esc(e.what) + '</td>' +
      '<td class="c-who">' + esc(e.who) + '</td>' +
      '<td class="c-notes">' + esc(e.notes).replace(/\n/g, '<br>') + '</td></tr>'
    ).join('') : '<tr><td colspan="5">Nothing scheduled yet.</td></tr>';
    const d = new Date();
    $('ros-foot').textContent = 'Printed ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // ---------- Editor ----------

  function fillTimes() {
    let s = '', e = '';
    for (let i = 0; i < ROWS; i++) s += '<option value="' + i + '">' + timeLabel(i) + '</option>';
    for (let i = 1; i <= END_MAX; i++) e += '<option value="' + i + '">' + timeLabel(i) + '</option>';
    ed.start.innerHTML = s; ed.end.innerHTML = e;
  }

  function openEditor(ev) {
    editing = ev;
    ed.what.value = ev.what || ''; ed.who.value = ev.who || ''; ed.notes.value = ev.notes || '';
    ed.start.value = ev.start; ed.end.value = ev.end;
    editor.hidden = false;
    setTimeout(() => ed.what.focus(), 30);
  }

  async function closeEditor() {
    if (!editing) return;
    const ev = editing;
    editing = null;
    editor.hidden = true;
    clearTimeout(saveTimer);
    if (!ev.what && !ev.who && !ev.notes) { await removeEvent(ev); return; }
    await queueSave(ev);
  }

  function onEditorChange(e) {
    if (!editing) return;
    const ev = editing;
    ev.what = ed.what.value; ev.who = ed.who.value; ev.notes = ed.notes.value;
    let start = Number(ed.start.value), end = Number(ed.end.value);
    if (e && e.target === ed.start && end <= start) {
      end = Math.min(END_MAX, start + Math.max(1, ev.end - ev.start)); ed.end.value = end;
    }
    if (end <= start) { start = end - 1; ed.start.value = start; }
    ev.start = start; ev.end = end;
    render();
    status('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => queueSave(ev), 600);
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

  // Saves run one after another so a new event gets its id before it's updated.
  function queueSave(ev) {
    saving = saving.then(async () => {
      try {
        const data = await post('adminSaveEvent', {
          id: ev.id > 0 ? ev.id : undefined,
          start: ev.start, end: ev.end, what: ev.what, who: ev.who, notes: ev.notes
        });
        if (!(ev.id > 0)) { ev.id = data.id; render(); }
        status('Saved');
      } catch (err) {
        status('Didn’t save “' + (ev.what || 'event') + '” — check your connection and try again.');
      }
    });
    return saving;
  }

  function removeEvent(ev) {
    events = events.filter(x => x !== ev);
    render();
    saving = saving.then(async () => {
      if (!(ev.id > 0)) return;
      try { await post('adminDeleteEvent', { id: ev.id }); status('Deleted'); }
      catch (err) { status('Couldn’t delete — reload and try again.'); }
    });
    return saving;
  }

  let tempId = 0;
  function addAt(slot) {
    const ev = { id: --tempId, start: slot, end: Math.min(END_MAX, slot + 1), what: '', who: '', notes: '' };
    events.push(ev);
    render();
    openEditor(ev);
  }

  // ---------- Wiring ----------

  grid.addEventListener('click', e => {
    const evBtn = e.target.closest('.sched-event');
    if (evBtn) {
      const ev = events.find(x => String(x.id) === evBtn.dataset.id);
      if (ev) closeEditor().then(() => { if (events.includes(ev)) openEditor(ev); });
      return;
    }
    const slot = e.target.closest('.sched-slot');
    if (slot) closeEditor().then(() => addAt(Number(slot.dataset.slot)));
  });
  $('sched-add').addEventListener('click', () => {
    const last = sorted().reduce((m, x) => Math.max(m, x.end), 0);
    closeEditor().then(() => addAt(Math.min(ROWS - 1, last)));
  });
  $('sched-print').addEventListener('click', () => closeEditor().then(() => { renderPrint(); window.print(); }));
  ['input', 'change'].forEach(t => [ed.what, ed.who, ed.notes, ed.start, ed.end].forEach(f => f.addEventListener(t, onEditorChange)));
  $('ed-done').addEventListener('click', closeEditor);
  $('ed-close').addEventListener('click', closeEditor);
  editor.addEventListener('click', e => { if (e.target === editor) closeEditor(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && editing) closeEditor(); });
  $('ed-delete').addEventListener('click', () => {
    if (!editing) return;
    const ev = editing;
    if ((ev.what || ev.who || ev.notes) && !confirm('Delete “' + (ev.what || 'this event') + '”?')) return;
    editing = null; editor.hidden = true; clearTimeout(saveTimer);
    removeEvent(ev);
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
    fillTimes();
    gate.hidden = true;
    app.hidden = false;
    render();
  }

  load();
})();
