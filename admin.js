/* Guest List admin dashboard — talks to the same Apps Script backend as the
 * public RSVP form (script.js), just with a password-gated set of actions. */
(function () {
  'use strict';

  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyMb-WTUEot-fa5LroXVE28lJZ4IWuNvf2-Qz4-UwEfop-vu4D-28GjxmIVjiXBo5vJJg/exec';
  const SESSION_KEY = 'mx_admin_session';

  const loginGate = document.getElementById('login-gate');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('login-form');
  const loginPassword = document.getElementById('login-password');
  const loginStatus = document.getElementById('login-status');
  const logoutBtn = document.getElementById('logout-btn');
  const statsEl = document.getElementById('admin-stats');
  const householdsEl = document.getElementById('households-list');
  const dashboardStatus = document.getElementById('dashboard-status');
  const searchInput = document.getElementById('search-input');
  const dashboardMain = document.getElementById('dashboard-main');
  const statListView = document.getElementById('stat-list-view');
  const statListTitle = document.getElementById('stat-list-title');
  const statListContent = document.getElementById('stat-list-content');

  const STAT_LABELS = {
    invited: 'Invited',
    responded: 'Responded',
    notResponded: 'Not Yet Responded',
    attending: 'Attending',
    declined: 'Declined'
  };

  const addGuestOpen = document.getElementById('add-guest-open');
  const addGuestClose = document.getElementById('add-guest-close');
  const addGuestModal = document.getElementById('add-guest-modal');
  const addGuestForm = document.getElementById('add-guest-form');
  const addGuestStatus = document.getElementById('add-guest-status');
  const newGuestName = document.getElementById('new-guest-name');
  const newGuestHousehold = document.getElementById('new-guest-household');
  const newHouseholdFields = document.getElementById('new-household-fields');
  const newGuestGroup = document.getElementById('new-guest-group');
  const newGuestAddress = document.getElementById('new-guest-address');

  let lastData = null;

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function setSession(token, expiresAt) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function setStatus(el, msg, tone) {
    el.textContent = msg || '';
    if (tone) el.setAttribute('data-tone', tone); else el.removeAttribute('data-tone');
  }

  function showLogin(message) {
    loginGate.hidden = false;
    dashboard.hidden = true;
    if (message) setStatus(loginStatus, message, 'error');
  }

  function showDashboard() {
    loginGate.hidden = true;
    dashboard.hidden = false;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- API calls ----

  async function apiGet(params) {
    const url = APPS_SCRIPT_URL + '?' + new URLSearchParams(params).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    return res.json();
  }

  async function apiPost(body) {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    return res.json();
  }

  // ---- Auth ----

  async function login(password) {
    setStatus(loginStatus, 'Checking…');
    try {
      const result = await apiPost({ action: 'adminLogin', password });
      if (!result.ok) {
        setStatus(loginStatus, result.error || 'Wrong password.', 'error');
        return;
      }
      setSession(result.token, result.expiresAt);
      showDashboard();
      loadDashboard();
    } catch (err) {
      setStatus(loginStatus, 'Something went wrong — try again.', 'error');
    }
  }

  function logout() {
    clearSession();
    showLogin();
  }

  // ---- Dashboard ----

  async function loadDashboard() {
    const session = getSession();
    if (!session || !session.token) { showLogin(); return; }
    setStatus(dashboardStatus, 'Loading…');
    try {
      const data = await apiGet({ action: 'admin', token: session.token });
      if (data.error) {
        clearSession();
        showLogin('Session expired — log in again.');
        return;
      }
      lastData = data;
      setStatus(dashboardStatus, '');

      // A stat tile is a real link to admin.html?list=<key> — if that's
      // present, show the dedicated list page and skip the normal
      // dashboard rendering entirely (nothing else is visible anyway).
      const listKey = new URLSearchParams(location.search).get('list');
      if (listKey && STAT_LABELS[listKey]) {
        renderStatListPage(listKey, data.households);
        return;
      }

      statListView.hidden = true;
      dashboardMain.hidden = false;
      renderStats(data.stats);
      renderHouseholds(data.households, searchInput.value);
      populateHouseholdPicker(data.households);
    } catch (err) {
      setStatus(dashboardStatus, 'Could not load guest list — check your connection and try again.', 'error');
    }
  }

  function renderStatListPage(key, households) {
    const cats = categorizeGuests(households);
    const names = cats[key] || [];
    statListTitle.textContent = STAT_LABELS[key] + ' (' + names.length + ')';
    statListContent.innerHTML = names.length
      ? names.map(n => '<li>' + escapeHtml(n) + '</li>').join('')
      : '<li class="admin-stat-empty">None</li>';
    dashboardMain.hidden = true;
    statListView.hidden = false;
  }

  function categorizeGuests(households) {
    const cats = { invited: [], responded: [], notResponded: [], attending: [], declined: [] };
    households.forEach(h => {
      h.members.forEach(m => {
        const name = memberDisplayName(m);
        cats.invited.push(name);
        if (m.isPlusOne && m.bringingPlusOne !== 'yes') {
          cats.notResponded.push(name); // matches server stats: unclaimed +1 slots count as not-responded
          return;
        }
        if (m.attending === 'yes') { cats.responded.push(name); cats.attending.push(name); }
        else if (m.attending === 'no') { cats.responded.push(name); cats.declined.push(name); }
        else { cats.notResponded.push(name); }
      });
    });
    Object.keys(cats).forEach(k => cats[k].sort((a, b) => a.localeCompare(b)));
    return cats;
  }

  function renderStats(stats) {
    const tiles = [
      ['invited', 'Invited', stats.invited],
      ['responded', 'Responded', stats.responded],
      ['notResponded', 'Not Yet', stats.notResponded],
      ['attending', 'Attending', stats.attending],
      ['declined', 'Declined', stats.declined]
    ];
    statsEl.innerHTML = tiles.map(([key, label, num]) =>
      '<a class="admin-stat" href="?list=' + key + '">' +
        '<div class="admin-stat-num">' + num + '</div>' +
        '<div class="admin-stat-label">' + label + '</div>' +
      '</a>'
    ).join('');
  }

  function memberDisplayName(m) {
    if (m.isPlusOne) {
      if (m.bringingPlusOne === 'yes' && m.actualName) return m.actualName;
      return m.name + ' (open slot)';
    }
    return m.name;
  }

  function memberStatus(m) {
    if (m.isPlusOne && m.bringingPlusOne !== 'yes') {
      return { status: 'pending', label: m.bringingPlusOne === 'no' ? 'Not bringing' : 'Open +1' };
    }
    if (m.attending === 'yes') return { status: 'yes', label: 'Attending' };
    if (m.attending === 'no') return { status: 'no', label: 'Not attending' };
    return { status: 'pending', label: 'Pending' };
  }

  function dietaryLabel(m) {
    if (!m.dietary) return '';
    if (m.dietary === 'other') return m.dietaryOther || 'Other';
    return m.dietary.charAt(0).toUpperCase() + m.dietary.slice(1);
  }

  function renderHouseholds(households, filterText) {
    const q = (filterText || '').trim().toLowerCase();
    const filtered = !q ? households : households.filter(h =>
      h.members.some(m => memberDisplayName(m).toLowerCase().indexOf(q) !== -1) ||
      (h.address || '').toLowerCase().indexOf(q) !== -1
    );

    if (filtered.length === 0) {
      householdsEl.innerHTML = '<p class="admin-status">No guests match “' + escapeHtml(filterText) + '”.</p>';
      return;
    }

    householdsEl.innerHTML = filtered.map(h => {
      const extras = [];
      if (h.existing) {
        if (h.existing.email) extras.push('<span>' + escapeHtml(h.existing.email) + '</span>');
        if (h.existing.phone) extras.push('<span>' + escapeHtml(h.existing.phone) + '</span>');
        if (h.existing.songRequest) extras.push('<span>🎵 ' + escapeHtml(h.existing.songRequest) + '</span>');
        if (h.existing.pizzaTopping) extras.push('<span>🍕 ' + escapeHtml(h.existing.pizzaTopping) + '</span>');
        if (h.existing.notes) extras.push('<span>📝 ' + escapeHtml(h.existing.notes) + '</span>');
      }

      const memberRows = h.members.map(m => {
        const st = memberStatus(m);
        const diet = dietaryLabel(m);
        return (
          '<div class="admin-member-row">' +
            '<span class="admin-member-name">' + escapeHtml(memberDisplayName(m)) +
              (m.isPlusOne ? ' <span class="admin-member-tag">+1</span>' : '') +
            '</span>' +
            (diet ? '<span class="admin-member-dietary">' + escapeHtml(diet) + '</span>' : '') +
            '<span class="admin-pill" data-status="' + st.status + '">' + st.label + '</span>' +
            '<button type="button" class="admin-remove-btn" data-row="' + m.sheetRow + '" data-name="' + escapeHtml(m.name) + '">Remove</button>' +
          '</div>'
        );
      }).join('');

      const addressAttr = escapeHtml(h.address || '');
      return (
        '<div class="admin-household">' +
          '<div class="admin-household-head">' +
            (h.group ? '<span class="admin-household-group">' + escapeHtml(h.group) + '</span>' : '') +
            '<span class="admin-household-address">' + (h.address ? escapeHtml(h.address) : '<em>No address on file</em>') + '</span>' +
            (h.address ? '<button type="button" class="admin-copy-btn" data-address="' + addressAttr + '">Copy address</button>' : '') +
          '</div>' +
          (extras.length ? '<div class="admin-household-extra">' + extras.join('') + '</div>' : '') +
          memberRows +
        '</div>'
      );
    }).join('');
  }

  function populateHouseholdPicker(households) {
    const current = newGuestHousehold.value;
    newGuestHousehold.innerHTML = '<option value="">+ Start a new household</option>' +
      households.map(h =>
        '<option value="' + h.members[0].sheetRow + '">' + escapeHtml(h.label || '(unnamed)') +
        (h.address ? ' — ' + escapeHtml(h.address) : '') + '</option>'
      ).join('');
    newGuestHousehold.value = current;
    toggleNewHouseholdFields();
  }

  function toggleNewHouseholdFields() {
    newHouseholdFields.style.display = newGuestHousehold.value ? 'none' : '';
  }

  // ---- Add / remove guest ----

  async function addGuest(e) {
    e.preventDefault();
    const session = getSession();
    if (!session) { showLogin(); return; }

    const name = newGuestName.value.trim();
    if (!name) return;

    const payload = { name };
    if (newGuestHousehold.value) {
      payload.joinRow = newGuestHousehold.value;
    } else {
      payload.group = newGuestGroup.value.trim();
      payload.address = newGuestAddress.value.trim();
    }

    setStatus(addGuestStatus, 'Adding…');
    try {
      const result = await apiPost({ action: 'adminAddGuest', token: session.token, payload });
      if (!result.ok) {
        setStatus(addGuestStatus, result.error || 'Could not add guest.', 'error');
        return;
      }
      addGuestForm.reset();
      closeAddGuestModal();
      loadDashboard();
    } catch (err) {
      setStatus(addGuestStatus, 'Something went wrong — try again.', 'error');
    }
  }

  async function removeGuest(sheetRowRaw, name) {
    const sheetRow = Number(sheetRowRaw); // comes in as a string from a DOM attribute; household data uses real numbers
    const session = getSession();
    if (!session) { showLogin(); return; }
    if (!confirm('Remove ' + name + ' from the guest list?')) return;

    try {
      const result = await apiPost({
        action: 'adminRemoveGuest',
        token: session.token,
        payload: { sheetRow: sheetRow, name: name }
      });
      if (!result.ok) {
        setStatus(dashboardStatus, result.message || result.error || 'Could not remove guest.', 'error');
        return;
      }
      // Update the view immediately from what we already have in memory —
      // don't wait on a fresh fetch (Sheets can be slow to reflect a write
      // on the very next read). Still reconcile with the server after.
      if (lastData) {
        lastData.households = lastData.households
          .map(h => ({ ...h, members: h.members.filter(m => m.sheetRow !== sheetRow) }))
          .filter(h => h.members.length > 0);
        renderStats(recomputeStats(lastData.households));
        renderHouseholds(lastData.households, searchInput.value);
        populateHouseholdPicker(lastData.households);
      }
      loadDashboard();
    } catch (err) {
      setStatus(dashboardStatus, 'Something went wrong — try again.', 'error');
    }
  }

  // Mirrors the server's buildAdminData() counting rules, for instant local
  // re-renders after an optimistic update (add/remove) without a round trip.
  function recomputeStats(households) {
    let invited = 0, responded = 0, attending = 0, declined = 0;
    households.forEach(h => {
      h.members.forEach(m => {
        invited++;
        if (m.isPlusOne && m.bringingPlusOne !== 'yes') return;
        if (m.attending === 'yes') { responded++; attending++; }
        else if (m.attending === 'no') { responded++; declined++; }
      });
    });
    return { invited, responded, notResponded: invited - responded, attending, declined };
  }

  function openAddGuestModal() {
    addGuestModal.hidden = false;
    setStatus(addGuestStatus, '');
    newGuestName.focus();
  }
  function closeAddGuestModal() {
    addGuestModal.hidden = true;
  }

  // ---- Wire up ----

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    login(loginPassword.value);
  });

  logoutBtn.addEventListener('click', logout);

  searchInput.addEventListener('input', function () {
    if (lastData) renderHouseholds(lastData.households, searchInput.value);
  });

  addGuestOpen.addEventListener('click', openAddGuestModal);
  addGuestClose.addEventListener('click', closeAddGuestModal);
  addGuestModal.addEventListener('click', function (e) {
    if (e.target === addGuestModal) closeAddGuestModal();
  });
  addGuestForm.addEventListener('submit', addGuest);
  newGuestHousehold.addEventListener('change', toggleNewHouseholdFields);

  householdsEl.addEventListener('click', function (e) {
    const copyBtn = e.target.closest('.admin-copy-btn');
    if (copyBtn) {
      const address = copyBtn.getAttribute('data-address');
      navigator.clipboard.writeText(address).then(function () {
        copyBtn.setAttribute('data-copied', '1');
        copyBtn.textContent = 'Copied!';
        setTimeout(function () {
          copyBtn.removeAttribute('data-copied');
          copyBtn.textContent = 'Copy address';
        }, 1500);
      });
      return;
    }
    const removeBtn = e.target.closest('.admin-remove-btn');
    if (removeBtn) {
      removeGuest(removeBtn.getAttribute('data-row'), removeBtn.getAttribute('data-name'));
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !addGuestModal.hidden) closeAddGuestModal();
  });

  // ---- Init ----

  const session = getSession();
  if (session && session.token && Date.now() < session.expiresAt) {
    showDashboard();
    loadDashboard();
  } else {
    clearSession();
    showLogin();
  }
})();
