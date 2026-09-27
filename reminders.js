/* RSVP reminders — one row per household that hasn't answered. Each row
   has a cell-number box Michael fills in himself (the RSVP form is the
   only other place a phone is collected); "Text" opens Messages to that
   number with the reminder already written — or with no recipient if the
   box is empty, so he can pick from his contacts. Tapping the name
   checks the household off into the "Texted" pile. Households drop off the page on their own once they
   RSVP. State is phone + reminded_at on the household row in D1, so it follows
   Michael across devices. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const MESSAGE_KEY = 'mx_reminder_message';
  const DEFAULT_MESSAGE =
    'Hi {names}! It’s Mike & Xan. Quick reminder to RSVP for our wedding by ' +
    'October 1 — it only takes a minute: https://mikeandxan.com/#rsvp ' +
    'Hope you can make it!';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const searchInput = document.getElementById('rem-search');
  const messageInput = document.getElementById('rem-text');

  // Apple's Messages wants "sms:&body=", everything else "sms:?body=".
  const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

  let households = [];   // only the ones with no RSVP on file
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

  function realMembers(h) {
    return (h.members || []).filter(m => !m.isPlusOne).map(m => m.name);
  }
  function displayName(h) {
    return realMembers(h).join(', ') || h.envelopeName || h.label || '(unnamed household)';
  }
  // "Steve & Francesca", "Christina, Maddie, Brody & Ty"
  function firstNames(h) {
    const firsts = realMembers(h).map(n => String(n).trim().split(/\s+/)[0]).filter(Boolean);
    if (!firsts.length) return 'there';
    if (firsts.length === 1) return firsts[0];
    return firsts.slice(0, -1).join(', ') + ' & ' + firsts[firsts.length - 1];
  }
  function haystack(h) {
    return [h.envelopeName, h.label, h.group, h.phone, realMembers(h).join(' ')].join(' ').toLowerCase();
  }

  function messageFor(h) {
    return messageInput.value.replace(/\{names\}/gi, firstNames(h));
  }
  function smsHref(h) {
    let digits = String(h.phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '1' + digits;
    const to = digits ? '+' + digits : '';
    return 'sms:' + to + (IS_APPLE ? '&' : '?') + 'body=' + encodeURIComponent(messageFor(h));
  }

  function rowHtml(h) {
    return (
      '<div class="rem-row' + (h.remindedAt ? ' is-done' : '') + '">' +
        '<button type="button" class="rem-toggle" data-id="' + h.id + '">' +
          '<span class="mail-check" aria-hidden="true">' + (h.remindedAt ? '&#10003;' : '') + '</span>' +
          '<span class="mail-row-text">' +
            '<span class="mail-name">' + escapeHtml(displayName(h)) + '</span>' +
            (h.group ? '<span class="mail-sub">' + escapeHtml(h.group) + '</span>' : '') +
          '</span>' +
        '</button>' +
        '<input type="tel" class="rem-phone" data-id="' + h.id + '" value="' + escapeHtml(h.phone || '') + '"' +
          ' placeholder="Cell number" autocomplete="off" aria-label="Cell number for ' + escapeHtml(displayName(h)) + '" />' +
        '<a class="rem-send" data-id="' + h.id + '" href="' + escapeHtml(smsHref(h)) + '">Text</a>' +
      '</div>'
    );
  }

  function renderProgress() {
    const doneTotal = households.filter(h => h.remindedAt).length;
    const withPhone = households.filter(h => h.phone).length;
    el('rem-progress').textContent =
      withPhone + ' of ' + households.length + ' have a number · ' + doneTotal + ' texted';
  }

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    const visible = q ? households.filter(h => haystack(h).indexOf(q) !== -1) : households;

    const todo = visible.filter(h => !h.remindedAt);
    const done = visible.filter(h => h.remindedAt);

    renderProgress();

    el('todo-head').textContent = 'To Text — ' + todo.length + (q ? ' matching' : '');
    el('done-head').textContent = 'Texted — ' + done.length + (q ? ' matching' : '');

    el('todo-list').innerHTML = todo.length
      ? todo.map(rowHtml).join('')
      : '<p class="mail-empty">' + (q ? 'No matches here.' : 'All done — everyone’s been texted! 🎉') + '</p>';
    el('done-list').innerHTML = done.length
      ? done.map(rowHtml).join('')
      : '<p class="mail-empty">' + (q ? 'No matches here.' : 'Nobody checked off yet — tap a name above once their text is sent.') + '</p>';
  }

  async function toggle(id) {
    if (pendingIds[id]) return;
    const h = households.find(x => x.id === id);
    if (!h) return;

    const session = getSession();
    if (!session || !session.token) { window.location.href = 'admin.html'; return; }

    const wasReminded = h.remindedAt;
    h.remindedAt = wasReminded ? null : new Date().toISOString(); // optimistic
    pendingIds[id] = true;
    render();

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'adminSetReminded',
          token: session.token,
          payload: { householdId: id, reminded: !wasReminded }
        })
      });
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data && (data.message || data.error) || 'save failed');
      h.remindedAt = data.remindedAt;
    } catch (err) {
      h.remindedAt = wasReminded; // roll back
      alert('That didn’t save — check your connection and tap it again.');
    }
    delete pendingIds[id];
    render();
  }

  // Saves when he leaves the box (or hits Enter). Deliberately no full
  // re-render here — that would yank focus out of the next box he's
  // already tabbed into; only this row's box + Text link are touched.
  async function savePhone(input) {
    const id = Number(input.getAttribute('data-id'));
    const h = households.find(x => x.id === id);
    if (!h) return;
    const typed = input.value.trim();
    if (typed === (h.phone || '')) return;

    const session = getSession();
    if (!session || !session.token) { window.location.href = 'admin.html'; return; }

    input.classList.remove('is-saved', 'is-error');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'adminSetHouseholdPhone',
          token: session.token,
          payload: { householdId: id, phone: typed }
        })
      });
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data && (data.message || data.error) || 'save failed');
      h.phone = data.phone || '';
      if (document.activeElement !== input) input.value = h.phone;
      input.classList.add('is-saved');
      const link = document.querySelector('.rem-send[data-id="' + id + '"]');
      if (link) link.setAttribute('href', smsHref(h));
      renderProgress();
    } catch (err) {
      input.classList.add('is-error');
      input.title = String(err && err.message || 'That didn’t save.');
    }
  }

  document.addEventListener('focusout', function (e) {
    if (e.target.classList && e.target.classList.contains('rem-phone')) savePhone(e.target);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('rem-phone')) {
      e.preventDefault();
      e.target.blur();
    }
  });

  document.addEventListener('click', function (e) {
    const row = e.target.closest('.rem-toggle');
    if (row) toggle(Number(row.getAttribute('data-id')));
  });

  searchInput.addEventListener('input', render);

  // Wording is remembered on this device; the Text links rebuild as he types.
  function loadMessage() {
    let saved = '';
    try { saved = localStorage.getItem(MESSAGE_KEY) || ''; } catch (_) {}
    messageInput.value = saved || DEFAULT_MESSAGE;
  }
  messageInput.addEventListener('input', function () {
    try { localStorage.setItem(MESSAGE_KEY, messageInput.value); } catch (_) {}
    render();
  });
  el('rem-reset').addEventListener('click', function () {
    try { localStorage.removeItem(MESSAGE_KEY); } catch (_) {}
    messageInput.value = DEFAULT_MESSAGE;
    render();
  });

  // Test hook: lets a harness render fabricated data without a live backend.
  window.__renderReminders = function (hh) {
    households = hh; loadMessage(); render(); gate.hidden = true; app.hidden = false;
  };

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
    households = (data.households || [])
      .filter(function (h) { return !h.alreadySubmitted; })
      .sort(function (a, b) {
        return (a.group || 'zzz').localeCompare(b.group || 'zzz') ||
               displayName(a).localeCompare(displayName(b));
      });
    loadMessage();
    gate.hidden = true;
    app.hidden = false;
    render();
  }

  load();
})();
