/* RSVP reminders — one card per household that hasn't answered. Each
   card lists everyone in the household, a cell-number box Michael fills
   in himself, a "Text" button (opens Messages with the reminder written),
   and a reach-out log: tap Texted / Called / Emailed / In person (plus an
   optional note) and it's saved with today's date. Households drop off
   the page on their own once they RSVP. Phone + log live in D1, so they
   follow Michael across devices. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const MESSAGE_KEY = 'mx_reminder_message';
  const MATCHES_KEY = 'mx_contact_matches';
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
  let matches = {};      // household id -> [{ name, candidates: [...] }] from his phone book
  let pendingIds = {};   // household id -> true while a save is in flight
  let noteDrafts = {};   // household id -> unsaved note text (survives re-renders)

  const METHODS = [
    { key: 'text', label: 'Texted' },
    { key: 'call', label: 'Called' },
    { key: 'email', label: 'Emailed' },
    { key: 'person', label: 'In person' }
  ];
  function methodLabel(key) {
    const m = METHODS.find(x => x.key === key);
    return m ? m.label : 'Other';
  }

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
  function householdTitle(h) {
    return h.envelopeName || h.label || displayName(h);
  }
  // Sort key: last name of the first person, then their first name.
  function sortKey(h) {
    const first = String(realMembers(h)[0] || householdTitle(h)).trim().split(/\s+/);
    return (first[first.length - 1] + ' ' + first[0]).toLowerCase();
  }
  function lastOutreach(h) { return (h.outreach || [])[0] || null; }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function daysAgo(iso) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const then = new Date(iso); then.setHours(0, 0, 0, 0);
    const n = Math.round((start - then) / 86400000);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
  }
  // "Steve & Francesca", "Christina, Maddie, Brody & Ty"
  function firstNames(h) {
    const firsts = realMembers(h).map(n => String(n).trim().split(/\s+/)[0]).filter(Boolean);
    if (!firsts.length) return 'there';
    if (firsts.length === 1) return firsts[0];
    return firsts.slice(0, -1).join(', ') + ' & ' + firsts[firsts.length - 1];
  }
  function firstNameOf(n) { return String(n).trim().split(/\s+/)[0]; }
  function haystack(h) {
    return [h.envelopeName, h.label, h.group, h.phone, realMembers(h).join(' '),
      (h.outreach || []).map(o => o.note).join(' ')].join(' ').toLowerCase();
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

  // Phone-book matches come from a file made on Michael's Mac and loaded
  // by hand — they never touch the server. Nothing is saved until he
  // taps a suggestion, and he picks whose number the household gets.
  function suggestHtml(h) {
    const members = (matches[h.id] || []).filter(m => m.candidates && m.candidates.length);
    if (!members.length) return '';
    return '<div class="rem-suggest">' + members.map(function (m) {
      return '<div class="rem-suggest-member">' +
        '<span class="rem-suggest-who">' + escapeHtml(m.name) + '</span>' +
        m.candidates.map(function (c) {
          const chosen = h.phone && c.phone === h.phone && (h.phoneOwner || '') === m.name;
          return '<button type="button" class="rem-pick' + (chosen ? ' is-chosen' : '') +
            (c.strength === 'possible' ? ' is-maybe' : '') + '"' +
            ' data-id="' + h.id + '" data-phone="' + escapeHtml(c.phone) + '" data-owner="' + escapeHtml(m.name) + '">' +
            '<span class="rem-pick-num">' + escapeHtml(c.phone) + '</span>' +
            '<span class="rem-pick-src">' +
              (c.strength === 'possible' ? 'maybe &middot; ' : '') +
              'saved as &ldquo;' + escapeHtml(c.contact) + '&rdquo;' +
              (c.label ? ' &middot; ' + escapeHtml(c.label) : '') +
            '</span>' +
            '<span class="rem-pick-act">' + (chosen ? '&#10003; Using' : 'Use') + '</span>' +
          '</button>';
        }).join('') +
      '</div>';
    }).join('') + '</div>';
  }

  function cardHtml(h) {
    const last = lastOutreach(h);
    const members = realMembers(h);
    const busy = pendingIds[h.id];
    return (
      '<div class="rem-card' + (last ? ' is-done' : '') + '">' +
        '<div class="rem-card-head">' +
          '<div class="rem-card-who">' +
            '<span class="rem-house">' + escapeHtml(householdTitle(h)) + '</span>' +
            (members.join(', ') !== householdTitle(h)
              ? '<span class="rem-members">' + members.map(escapeHtml).join(' &middot; ') + '</span>' : '') +
            (h.group ? '<span class="rem-group">' + escapeHtml(h.group) + '</span>' : '') +
          '</div>' +
          '<span class="rem-last' + (last ? '' : ' is-never') + '">' +
            (last ? 'Last: ' + escapeHtml(methodLabel(last.method)) + ' &middot; ' + escapeHtml(daysAgo(last.at))
                  : 'Not contacted yet') +
          '</span>' +
        '</div>' +
        '<div class="rem-contact">' +
          '<input type="tel" class="rem-phone" data-id="' + h.id + '" value="' + escapeHtml(h.phone || '') + '"' +
            ' placeholder="Cell number" autocomplete="off" aria-label="Cell number for ' + escapeHtml(householdTitle(h)) + '" />' +
          (h.phoneOwner ? '<span class="rem-owner">' + escapeHtml(firstNameOf(h.phoneOwner)) + '’s cell</span>' : '') +
          '<a class="rem-send" data-id="' + h.id + '" href="' + escapeHtml(smsHref(h)) + '">Open text</a>' +
        '</div>' +
        suggestHtml(h) +
        '<div class="rem-log">' +
          '<span class="rem-log-label">I just&hellip;</span>' +
          '<div class="rem-log-btns">' +
            METHODS.map(m =>
              '<button type="button" class="rem-log-btn" data-id="' + h.id + '" data-method="' + m.key + '"' +
              (busy ? ' disabled' : '') + '>' + m.label + '</button>').join('') +
          '</div>' +
          '<input type="text" class="rem-note" data-id="' + h.id + '" value="' + escapeHtml(noteDrafts[h.id] || '') + '"' +
            ' placeholder="Note (optional) — e.g. left voicemail" autocomplete="off" maxlength="500" />' +
        '</div>' +
        ((h.outreach || []).length
          ? '<ul class="rem-history">' + h.outreach.map(o =>
              '<li><span class="rem-hist-what">' + escapeHtml(methodLabel(o.method)) + '</span>' +
              '<span class="rem-hist-when">' + escapeHtml(fmtDate(o.at)) + '</span>' +
              '<button type="button" class="rem-hist-del" data-id="' + h.id + '" data-entry="' + o.id + '"' +
                ' aria-label="Remove this entry">Remove</button>' +
              (o.note ? '<span class="rem-hist-note">' + escapeHtml(o.note) + '</span>' : '') + '</li>').join('') + '</ul>'
          : '') +
      '</div>'
    );
  }

  function renderProgress() {
    const reached = households.filter(h => lastOutreach(h)).length;
    const withPhone = households.filter(h => h.phone).length;
    el('rem-progress').textContent =
      households.length + ' households haven’t RSVP’d · ' + reached + ' reached out to · ' + withPhone + (withPhone === 1 ? ' has' : ' have') + ' a number';
  }

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    const visible = q ? households.filter(h => haystack(h).indexOf(q) !== -1) : households;

    // Never contacted: A–Z by last name. Reached out: longest-ago first,
    // so whoever's due a follow-up is at the top.
    const todo = visible.filter(h => !lastOutreach(h))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const done = visible.filter(h => lastOutreach(h))
      .sort((a, b) => lastOutreach(a).at.localeCompare(lastOutreach(b).at));

    renderProgress();

    el('todo-head').textContent = 'Not contacted yet — ' + todo.length + (q ? ' matching' : '');
    el('done-head').textContent = 'Reached out — ' + done.length + (q ? ' matching' : '') + ' (longest ago first)';

    el('todo-list').innerHTML = todo.length
      ? todo.map(cardHtml).join('')
      : '<p class="mail-empty">' + (q ? 'No matches here.' : 'Everyone’s been contacted at least once! 🎉') + '</p>';
    el('done-list').innerHTML = done.length
      ? done.map(cardHtml).join('')
      : '<p class="mail-empty">' + (q ? 'No matches here.' : 'Nobody logged yet — tap Texted / Called / Emailed on a card once you reach out.') + '</p>';
  }

  async function post(action, payload) {
    const session = getSession();
    if (!session || !session.token) { window.location.href = 'admin.html'; throw new Error('logged out'); }
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: action, token: session.token, payload: payload })
    });
    const data = await res.json();
    if (!data || !data.ok) throw new Error(data && (data.message || data.error) || 'save failed');
    return data;
  }

  async function logOutreach(id, method) {
    if (pendingIds[id]) return;
    const h = households.find(x => x.id === id);
    if (!h) return;
    const note = (noteDrafts[id] || '').trim();
    pendingIds[id] = true;
    render();
    try {
      const data = await post('adminAddOutreach', { householdId: id, method: method, note: note });
      h.outreach = [data.entry].concat(h.outreach || []);
      delete noteDrafts[id];
    } catch (err) {
      alert('That didn’t save — check your connection and tap it again.');
    }
    delete pendingIds[id];
    render();
  }

  async function deleteOutreach(id, entryId) {
    const h = households.find(x => x.id === id);
    if (!h || pendingIds[id]) return;
    if (!confirm('Remove this entry?')) return;
    pendingIds[id] = true;
    try {
      await post('adminDeleteOutreach', { id: entryId });
      h.outreach = (h.outreach || []).filter(o => o.id !== entryId);
    } catch (err) {
      alert('That didn’t delete — check your connection and try again.');
    }
    delete pendingIds[id];
    render();
  }

  // Saves when he leaves the box (or hits Enter). Deliberately no full
  // re-render here — that would yank focus out of the next box he's
  // already tabbed into; only this row's box + Text link are touched.
  async function savePhone(input, pick) {
    const id = Number(input.getAttribute('data-id'));
    const h = households.find(x => x.id === id);
    if (!h) return;
    const typed = pick ? pick.phone : input.value.trim();
    const owner = pick ? pick.owner : '';
    if (!pick && typed === (h.phone || '')) return;

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
          payload: { householdId: id, phone: typed, owner: owner }
        })
      });
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data && (data.message || data.error) || 'save failed');
      h.phone = data.phone || '';
      h.phoneOwner = data.phoneOwner || '';
      if (pick) { render(); return; }
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

  // Tapping a suggestion records it; tapping the chosen one again clears it.
  document.addEventListener('click', function (e) {
    const pick = e.target.closest('.rem-pick');
    if (!pick) return;
    const id = pick.getAttribute('data-id');
    const input = document.querySelector('.rem-phone[data-id="' + id + '"]');
    if (!input) return;
    const undo = pick.classList.contains('is-chosen');
    savePhone(input, { phone: undo ? '' : pick.getAttribute('data-phone'), owner: undo ? '' : pick.getAttribute('data-owner') });
  });

  function setMatches(data) {
    matches = {};
    ((data && data.households) || []).forEach(function (e) { matches[e.id] = e.members || []; });
    const n = households.filter(h => (matches[h.id] || []).some(m => m.candidates && m.candidates.length)).length;
    el('rem-matches-status').textContent = n ? 'Matches found for ' + n + ' households.' : '';
  }
  function loadMatches() {
    try { setMatches(JSON.parse(localStorage.getItem(MATCHES_KEY) || 'null')); } catch (_) {}
  }
  el('rem-matches-file').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.households)) throw new Error('wrong file');
        try { localStorage.setItem(MATCHES_KEY, reader.result); } catch (_) {}
        setMatches(data);
        render();
      } catch (err) {
        el('rem-matches-status').textContent = 'That isn’t the matches file — pick contact-matches.json.';
      }
    };
    reader.readAsText(file);
  });

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.rem-log-btn');
    if (btn) logOutreach(Number(btn.getAttribute('data-id')), btn.getAttribute('data-method'));
    const del = e.target.closest('.rem-hist-del');
    if (del) deleteOutreach(Number(del.getAttribute('data-id')), Number(del.getAttribute('data-entry')));
  });
  document.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('rem-note')) {
      noteDrafts[Number(e.target.getAttribute('data-id'))] = e.target.value;
    }
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
  window.__renderReminders = function (hh, mm) {
    households = hh; loadMessage(); setMatches(mm); render(); gate.hidden = true; app.hidden = false;
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
      .filter(function (h) { return !h.alreadySubmitted; });
    loadMessage();
    loadMatches();
    gate.hidden = true;
    app.hidden = false;
    render();
  }

  load();
})();
