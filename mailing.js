/* Mailing checklist — one row per household, tap to check off as sent.
   The envelopes are stuffed in no particular order, so rows are sorted
   alphabetically by the name printed on the envelope and searchable by
   any member name / envelope name / address. Checked rows drop into the
   "Sent" pile below; tapping there unchecks (typo insurance). State is
   mailed_at on the household row in D1, so it follows Michael across
   devices mid-stack. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const searchInput = document.getElementById('mail-search');

  let households = [];   // full admin list, annotated locally
  let pendingIds = {};   // household id -> true while a save is in flight

  function el(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function displayName(h) {
    return h.envelopeName || h.label || '(unnamed household)';
  }
  function hasPlusOne(h) {
    return (h.members || []).some(m => m.isPlusOne);
  }
  function realMembers(h) {
    return (h.members || []).filter(m => !m.isPlusOne).map(m => m.name);
  }
  function haystack(h) {
    return [
      h.envelopeName, h.envelopeSubline, h.label, h.group, h.address,
      realMembers(h).join(' ')
    ].join(' ').toLowerCase();
  }

  function rowHtml(h) {
    const sub = [];
    // Envelope name often hides the member names ("The Martin Family"),
    // so always show who's inside — that's what he's double-checking.
    const names = realMembers(h).join(', ');
    if (names && names !== displayName(h)) sub.push(escapeHtml(names));
    if (h.address) sub.push('<span class="mail-addr">' + escapeHtml(h.address) + '</span>');

    return (
      '<button type="button" class="mail-row' + (h.mailedAt ? ' is-done' : '') + '" data-id="' + h.id + '">' +
        '<span class="mail-check" aria-hidden="true">' + (h.mailedAt ? '&#10003;' : '') + '</span>' +
        '<span class="mail-row-text">' +
          '<span class="mail-name">' + escapeHtml(displayName(h)) + '</span>' +
          (sub.length ? '<span class="mail-sub">' + sub.join(' &middot; ') + '</span>' : '') +
        '</span>' +
        (hasPlusOne(h) ? '<span class="mail-plus1">+1</span>' : '') +
      '</button>'
    );
  }

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    const visible = q ? households.filter(h => haystack(h).indexOf(q) !== -1) : households;

    const todo = visible.filter(h => !h.mailedAt);
    const done = visible.filter(h => h.mailedAt);

    const doneTotal = households.filter(h => h.mailedAt).length;
    el('mail-progress').textContent = doneTotal + ' of ' + households.length + ' sent';

    el('todo-head').textContent = 'To Send — ' + todo.length + (q ? ' matching' : '');
    el('done-head').textContent = 'Sent — ' + done.length + (q ? ' matching' : '');

    el('todo-list').innerHTML = todo.length
      ? todo.map(rowHtml).join('')
      : '<p class="mail-empty">' + (q ? 'No matches here.' : 'All done — every envelope is checked off! 🎉') + '</p>';
    el('done-list').innerHTML = done.length
      ? done.map(rowHtml).join('')
      : '<p class="mail-empty">' + (q ? 'No matches here.' : 'Nothing checked off yet — tap a household above once its envelope is in the pile.') + '</p>';
  }

  async function toggle(id) {
    if (pendingIds[id]) return;
    const h = households.find(x => x.id === id);
    if (!h) return;

    const session = getSession();
    if (!session || !session.token) { window.location.href = 'admin.html'; return; }

    const wasMailed = h.mailedAt;
    h.mailedAt = wasMailed ? null : new Date().toISOString(); // optimistic
    pendingIds[id] = true;
    // Speed mode: checking one off resets the search so the next envelope's
    // name can be typed immediately — no manual clearing between envelopes.
    if (!wasMailed) {
      searchInput.value = '';
      searchInput.focus();
      window.scrollTo(0, 0);
    }
    render();

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'adminSetMailed',
          token: session.token,
          payload: { householdId: id, mailed: !wasMailed }
        })
      });
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data && (data.message || data.error) || 'save failed');
      h.mailedAt = data.mailedAt;
    } catch (err) {
      h.mailedAt = wasMailed; // roll back
      alert('That didn’t save — check your connection and tap it again.');
    }
    delete pendingIds[id];
    render();
  }

  document.addEventListener('click', function (e) {
    const row = e.target.closest('.mail-row');
    if (row) toggle(Number(row.getAttribute('data-id')));
  });

  searchInput.addEventListener('input', render);

  // Test hook: lets a harness render fabricated data without a live backend.
  window.__renderMailing = function (hh) { households = hh; render(); gate.hidden = true; app.hidden = false; };

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
      gate.textContent = 'Could not load the guest list — try again from the Guest List page.';
      return;
    }
    households = (data.households || []).slice().sort(function (a, b) {
      return displayName(a).localeCompare(displayName(b));
    });
    gate.hidden = true;
    app.hidden = false;
    render();
    searchInput.focus();
  }

  load();
})();
