/* Day-of schedule — the wedding day in 30-minute slots, 8 AM to midnight.
   Each slot has: what's happening, who's involved, notes. Saves on its own
   (a moment after you stop typing) to D1, so it follows Michael + Xan
   across devices. Same login as the Guest List. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const START_HOUR = 8;
  const SLOTS = 32; // 8:00 AM ... 11:30 PM
  const FIELDS = ['what', 'who', 'notes'];

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const list = document.getElementById('sched-list');
  const statusEl = document.getElementById('sched-status');
  const filledToggle = document.getElementById('sched-filled');

  let schedule = {};     // slot -> { what, who, notes }
  const timers = {};     // slot -> pending save timer

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function status(msg) { statusEl.textContent = msg || ''; }

  function timeLabel(slot) {
    const mins = START_HOUR * 60 + slot * 30;
    const h24 = Math.floor(mins / 60), m = mins % 60;
    const h12 = ((h24 + 11) % 12) + 1;
    return h12 + ':' + (m ? '30' : '00') + ' ' + (h24 < 12 ? 'AM' : 'PM');
  }
  function isFilled(slot) {
    const s = schedule[slot];
    return !!(s && (s.what || s.who || s.notes));
  }

  // ---------- Drawing ----------

  function render() {
    list.innerHTML = '';
    for (let slot = 0; slot < SLOTS; slot++) {
      const s = schedule[slot] || {};
      const li = document.createElement('li');
      li.className = 'sched-row' + (slot % 2 === 0 ? ' is-hour' : '');
      li.dataset.slot = slot;

      const time = document.createElement('div');
      time.className = 'sched-time';
      time.textContent = timeLabel(slot);
      li.appendChild(time);

      const body = document.createElement('div');
      body.className = 'sched-fields';
      FIELDS.forEach(f => {
        const input = document.createElement(f === 'notes' ? 'textarea' : 'input');
        if (f !== 'notes') input.type = 'text';
        else input.rows = 1;
        input.className = 'sched-' + f;
        input.dataset.field = f;
        input.value = s[f] || '';
        input.placeholder = f === 'what' ? 'What’s happening' : f === 'who' ? 'Who' : 'Notes';
        input.setAttribute('aria-label', timeLabel(slot) + ' — ' + input.placeholder);
        input.addEventListener('input', () => onEdit(slot, li));
        body.appendChild(input);
      });
      li.appendChild(body);
      list.appendChild(li);
      markRow(li, slot);
    }
    applyFilter();
  }

  function markRow(li, slot) {
    li.classList.toggle('is-filled', isFilled(slot));
  }
  function applyFilter() {
    app.classList.toggle('only-filled', filledToggle.checked);
  }

  // ---------- Saving ----------

  function onEdit(slot, li) {
    const next = {};
    FIELDS.forEach(f => { next[f] = li.querySelector('[data-field="' + f + '"]').value; });
    schedule[slot] = next;
    markRow(li, slot);
    status('Saving…');
    clearTimeout(timers[slot]);
    timers[slot] = setTimeout(() => save(slot), 700);
  }

  async function save(slot) {
    const session = getSession();
    if (!session || !session.token) { window.location.href = 'admin.html'; return; }
    const s = schedule[slot] || {};
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'adminSetSlot', token: session.token,
          payload: { slot: slot, what: s.what || '', who: s.who || '', notes: s.notes || '' }
        })
      });
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data && (data.error || data.message) || 'save failed');
      status('Saved');
    } catch (err) {
      status('Didn’t save ' + timeLabel(slot) + ' — check your connection and type again.');
    } finally {
      timers[slot] = null;
    }
  }

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
    schedule = {};
    Object.keys(data.schedule || {}).forEach(k => { schedule[Number(k)] = data.schedule[k]; });
    gate.hidden = true;
    app.hidden = false;
    render();
  }

  filledToggle.addEventListener('change', applyFilter);
  document.getElementById('sched-print').addEventListener('click', () => window.print());
  window.addEventListener('beforeunload', e => {
    if (Object.values(timers).some(Boolean)) { e.preventDefault(); e.returnValue = ''; }
  });

  load();
})();
