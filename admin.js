/* Guest List admin dashboard — talks to the same Apps Script backend as the
 * public RSVP form (script.js), just with a password-gated set of actions. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
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
    notResponded: 'No Response',
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
  let editingHouseholdId = null;
  // Per-card expand/collapse overrides (id -> open). Every card is
  // collapsible; the DEFAULT differs — redundant-member couples start
  // closed, everything else starts open — and this map records where the
  // user has flipped a card away from its default, surviving re-renders
  // (search, refresh-after-save) within the session.
  const expandOverrides = new Map();

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
    const url = WORKER_URL + '?' + new URLSearchParams(params).toString();
    const res = await fetch(url);
    // The Worker sends a real HTTP status (401/404/500) alongside a JSON
    // body ({error: '...'}) — read the body first so callers can act on
    // data.error (e.g. "session expired") instead of just seeing a generic
    // failure for anything that isn't a 200.
    const data = await res.json().catch(() => null);
    if (!res.ok && !data) throw new Error('Request failed: ' + res.status);
    return data;
  }

  async function apiPost(body) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok && !data) throw new Error('Request failed: ' + res.status);
    return data;
  }

  // ---- Auth ----

  async function login(password) {
    setStatus(loginStatus, 'Checking…');
    try {
      const result = await apiPost({ action: 'adminLogin', password });
      if (!result || !result.ok) {
        setStatus(loginStatus, (result && result.error) || 'Wrong password.', 'error');
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
      if (!data || data.error) {
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

  let statListHouseholdsById = {};

  function renderStatListPage(key, households) {
    statListHouseholdsById = {};
    households.forEach(h => { statListHouseholdsById[h.id] = h; });

    const cats = categorizeGuests(households);
    const entries = cats[key] || [];
    statListTitle.textContent = STAT_LABELS[key] + ' (' + entries.length + ')';
    statListContent.innerHTML = entries.length
      ? entries.map(e =>
          '<li class="stat-list-item" data-household-id="' + e.householdId + '">' +
            '<button type="button" class="stat-list-name">' + escapeHtml(e.name) + '</button>' +
            '<div class="stat-list-detail" hidden></div>' +
          '</li>'
        ).join('')
      : '<li class="admin-stat-empty">None</li>';
    dashboardMain.hidden = true;
    statListView.hidden = false;
  }

  function categorizeGuests(households) {
    const cats = { invited: [], responded: [], notResponded: [], attending: [], declined: [] };
    households.forEach(h => {
      h.members.forEach(m => {
        const entry = { name: memberDisplayName(m), householdId: h.id };
        cats.invited.push(entry);
        if (m.isPlusOne && m.bringingPlusOne !== 'yes') {
          cats.notResponded.push(entry); // matches server stats: unclaimed +1 slots count as not-responded
          return;
        }
        if (m.attending === 'yes') { cats.responded.push(entry); cats.attending.push(entry); }
        else if (m.attending === 'no') { cats.responded.push(entry); cats.declined.push(entry); }
        else { cats.notResponded.push(entry); }
      });
    });
    Object.keys(cats).forEach(k => cats[k].sort((a, b) => a.name.localeCompare(b.name)));
    return cats;
  }

  function renderStats(stats) {
    const tiles = [
      ['invited', 'Invited', stats.invited],
      ['notResponded', 'No Response', stats.notResponded],
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

  // Shared by the main Guest List and the stat-detail expansion below —
  // opts.showRemove controls whether the per-member Remove button appears
  // (only makes sense on the main list, where removal is wired up).
  // "City, ST" for the quiet footer line — the full street address lives
  // behind Edit now that envelopes are generated from the data directly.
  function cityStateOf(address) {
    const m = String(address || '').match(/,\s*([^,]+),\s*([A-Za-z]{2})\s+\d{5}/);
    if (m) return m[1] + ', ' + m[2].toUpperCase();
    return address || 'No address';
  }

  function householdCounts(h) {
    let yes = 0, no = 0;
    h.members.forEach(m => {
      if (m.isPlusOne && m.bringingPlusOne !== 'yes') return;
      if (m.attending === 'yes') yes++;
      else if (m.attending === 'no') no++;
    });
    return { yes, no };
  }

  function householdCardHtml(h, opts) {
    const showRemove = !opts || opts.showRemove !== false;
    const editing = !!(opts && opts.editing);

    if (editing) {
      const memberRows = h.members.map(m =>
        '<div class="admin-member-row">' +
          '<span class="admin-member-name"><input type="text" class="admin-edit-input admin-edit-name" data-guest-id="' + m.id + '" value="' + escapeHtml(m.name) + '"></span>' +
          '<button type="button" class="admin-remove-btn" data-id="' + m.id + '" data-name="' + escapeHtml(m.name) + '" title="Remove ' + escapeHtml(memberDisplayName(m)) + '" aria-label="Remove ' + escapeHtml(memberDisplayName(m)) + '">&times;</button>' +
        '</div>'
      ).join('');

      const realGuestCount = h.members.filter(m => !m.isPlusOne).length;
      const plusOneMember = h.members.find(m => m.isPlusOne);
      const plusOneClaimed = !!(plusOneMember && plusOneMember.bringingPlusOne === 'yes');
      const plusOneToggleHtml = realGuestCount === 1
        ? '<label class="admin-plusone-toggle">' +
            '<input type="checkbox" class="admin-edit-plusone"' +
              (plusOneMember ? ' checked' : '') + (plusOneClaimed ? ' disabled' : '') + '>' +
            ' Allow a +1' + (plusOneClaimed ? ' (already claimed)' : '') +
          '</label>'
        : '';

      return (
        '<div class="admin-household admin-household-editing" data-household-id="' + h.id + '">' +
          '<div class="admin-household-head">' +
            '<input type="text" class="admin-edit-input admin-edit-group" placeholder="Household label (optional)" value="' + escapeHtml(h.group || '') + '">' +
            '<input type="text" class="admin-edit-input admin-edit-address" placeholder="Address" value="' + escapeHtml(h.address || '') + '">' +
          '</div>' +
          '<div class="admin-envelope-edit">' +
            '<input type="text" class="admin-edit-input admin-edit-envelope-name" placeholder="Envelope name (e.g. The Martin Family)" value="' + escapeHtml(h.envelopeName || '') + '">' +
            '<input type="text" class="admin-edit-input admin-edit-envelope-subline" placeholder="Envelope sub-line (e.g. Daniel, Alyson, Adalyn, & Jack)" value="' + escapeHtml(h.envelopeSubline || '') + '">' +
          '</div>' +
          memberRows +
          plusOneToggleHtml +
          '<div class="admin-household-foot admin-edit-foot">' +
            '<button type="button" class="admin-cancel-edit-btn" data-id="' + h.id + '">Cancel</button>' +
            '<button type="button" class="admin-save-edit-btn" data-id="' + h.id + '">Save</button>' +
          '</div>' +
        '</div>'
      );
    }

    // ---- View mode: "status at a glance" layout (Michael picked option B
    // from the Aug 10 mockups — summary pill first, two-column members with
    // status dots, quiet meta footer). ----
    const counts = householdCounts(h);
    const pill = h.alreadySubmitted
      ? '<span class="bx-pill" data-kind="mixed">' +
          (counts.yes ? '<b class="bx-yes">' + counts.yes + ' yes</b>' : '') +
          (counts.yes && counts.no ? ' · ' : '') +
          (counts.no ? '<b class="bx-no">' + counts.no + ' no</b>' : '') +
        '</span>'
      : '<span class="bx-pill" data-kind="none">No response</span>';

    // For an unanswered couple the member rows just restate the title
    // ("Dayly & Landon Ginnings" → "Landon Ginnings / Dayly Ginnings" —
    // Michael flagged the redundancy), so skip them when the title already
    // names everyone: every real member's first name appears in it, and
    // any open +1 slot is covered by a "Guest" mention. Rows come back the
    // moment the household responds, because then each row carries its own
    // status dot / dietary info.
    const title = h.envelopeName || h.label || '';
    const titleLower = title.toLowerCase();
    const membersRedundant = !h.alreadySubmitted && h.members.length > 0 && h.members.every(m => {
      // Open +1 slots are covered by the header's +N chip, so a "Plus 1
      // (open slot)" row never justifies keeping the list expanded.
      if (m.isPlusOne) return true;
      const first = m.name.trim().split(/\s+/)[0].toLowerCase();
      return first && titleLower.indexOf(first) !== -1;
    });

    const expanded = expandOverrides.has(h.id) ? expandOverrides.get(h.id) : !membersRedundant;

    const membersHtml = h.members.map(m => {
      const st = memberStatus(m);
      const diet = dietaryLabel(m);
      const dotState = st.status === 'yes' ? 'y' : (st.status === 'no' ? 'n' : 'p');
      return (
        '<div class="bx-member">' +
          '<span class="bx-dot" data-s="' + dotState + '"></span>' +
          '<span class="bx-name">' + escapeHtml(memberDisplayName(m)) +
            (m.isPlusOne ? ' <span class="admin-member-tag">+1</span>' : '') +
            (diet ? '<span class="bx-sub">' + escapeHtml(diet) + '</span>' : '') +
          '</span>' +
        '</div>'
      );
    }).join('');

    let detailsHtml = '';
    if (h.existing) {
      const d = [];
      if (h.existing.songRequest) d.push('<div><b>Song:</b> ' + escapeHtml(h.existing.songRequest) + '</div>');
      if (h.existing.pizzaTopping) d.push('<div><b>Pizza:</b> ' + escapeHtml(h.existing.pizzaTopping) + '</div>');
      if (h.existing.notes) d.push('<div><b>Notes:</b> ' + escapeHtml(h.existing.notes) + '</div>');
      const contactBits = [h.existing.email, h.existing.phone, h.existing.contactMethod ? 'prefers ' + h.existing.contactMethod.toLowerCase() : '']
        .filter(Boolean).map(escapeHtml).join(' · ');
      if (contactBits) d.push('<div><b>Contact:</b> ' + contactBits + '</div>');
      if (d.length) detailsHtml = '<div class="bx-details">' + d.join('') + '</div>';
    }

    const links = [];
    if (showRemove) links.push('<button type="button" class="bx-link admin-edit-btn" data-id="' + h.id + '">Edit</button>');
    if (h.envelopeName && h.address) links.push('<a class="bx-link" href="envelopes.html?household=' + h.id + '" target="_blank" rel="noopener">Envelope</a>');
    if (showRemove && h.alreadySubmitted) links.push('<button type="button" class="bx-link bx-link-danger admin-reset-btn" data-id="' + h.id + '">Reset</button>');

    // Every card's member grid sits inside an animated reveal
    // (grid-template-rows 0fr→1fr) so expand/collapse slides smoothly
    // instead of popping. The chevron toggles it.
    const chevron =
      '<button type="button" class="bx-expand-toggle' + (expanded ? ' open' : '') + '" data-id="' + h.id + '" aria-expanded="' + expanded + '" title="Show members" aria-label="Show members">' +
        '<svg viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1.5 6,6.5 11,1.5"/></svg>' +
      '</button>';
    const gridHtml =
      '<div class="bx-reveal' + (expanded ? ' open' : '') + '"><div class="bx-reveal-inner"><div class="bx-grid">' + membersHtml + '</div></div></div>';

    // At-a-glance +1 marker: envelopes no longer say "& Guest" (that moved
    // to an insert card), so the card header is where Michael sees who has
    // a plus-one invited. Counts every +1 slot the household was given.
    const plusOneCount = h.members.filter(m => m.isPlusOne).length;
    const plusOneChip = plusOneCount
      ? '<span class="bx-p1" title="' + plusOneCount + ' plus-one slot' + (plusOneCount === 1 ? '' : 's') + '">+' + plusOneCount + '</span>'
      : '';

    return (
      '<div class="admin-household bx-card" data-household-id="' + h.id + '">' +
        '<div class="bx-head">' +
          '<span class="bx-title">' + escapeHtml(title) + '</span>' +
          plusOneChip +
          chevron +
          pill +
        '</div>' +
        gridHtml +
        detailsHtml +
        '<div class="bx-meta">' +
          '<span class="bx-meta-text">' + (h.group ? escapeHtml(h.group) + ' · ' : '') + escapeHtml(cityStateOf(h.address)) + '</span>' +
          '<span class="bx-links">' + links.join('') + '</span>' +
        '</div>' +
      '</div>'
    );
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

    householdsEl.innerHTML = filtered.map(h => householdCardHtml(h, { editing: h.id === editingHouseholdId })).join('');
  }

  function populateHouseholdPicker(households) {
    const current = newGuestHousehold.value;
    newGuestHousehold.innerHTML = '<option value="">+ Start a new household</option>' +
      households.map(h =>
        '<option value="' + h.id + '">' + escapeHtml(h.label || '(unnamed)') +
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
      payload.householdId = Number(newGuestHousehold.value);
    } else {
      payload.group = newGuestGroup.value.trim();
      payload.address = newGuestAddress.value.trim();
    }

    setStatus(addGuestStatus, 'Adding…');
    try {
      const result = await apiPost({ action: 'adminAddGuest', token: session.token, payload });
      if (!result || !result.ok) {
        setStatus(addGuestStatus, (result && result.error) || 'Could not add guest.', 'error');
        return;
      }
      addGuestForm.reset();
      closeAddGuestModal();
      loadDashboard();
    } catch (err) {
      setStatus(addGuestStatus, 'Something went wrong — try again.', 'error');
    }
  }

  async function removeGuest(guestIdRaw, name) {
    const guestId = Number(guestIdRaw); // comes in as a string from a DOM attribute; household data uses real numbers
    const session = getSession();
    if (!session) { showLogin(); return; }
    if (!confirm('Remove ' + name + ' from the guest list?')) return;

    try {
      const result = await apiPost({
        action: 'adminRemoveGuest',
        token: session.token,
        payload: { guestId: guestId, name: name }
      });
      if (!result || !result.ok) {
        setStatus(dashboardStatus, (result && (result.message || result.error)) || 'Could not remove guest.', 'error');
        return;
      }
      // Update the view immediately from what we already have in memory —
      // don't wait on a fresh fetch. Still reconcile with the server after.
      if (lastData) {
        lastData.households = lastData.households
          .map(h => ({ ...h, members: h.members.filter(m => m.id !== guestId) }))
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

  async function resetRsvp(householdIdRaw) {
    const householdId = Number(householdIdRaw);
    const session = getSession();
    if (!session) { showLogin(); return; }
    if (!confirm("Reset this household's RSVP back to No Response? They'll be able to submit fresh.")) return;

    try {
      const result = await apiPost({
        action: 'adminResetRsvp',
        token: session.token,
        payload: { householdId: householdId }
      });
      if (!result || !result.ok) {
        setStatus(dashboardStatus, (result && result.error) || 'Could not reset RSVP.', 'error');
        return;
      }
      if (lastData) {
        lastData.households = lastData.households.map(h => {
          if (h.id !== householdId) return h;
          return {
            ...h,
            alreadySubmitted: false,
            alreadySubmittedFor: '',
            existing: null,
            members: h.members.map(m => ({
              ...m,
              attending: '',
              dietary: '',
              dietaryOther: '',
              bringingPlusOne: m.isPlusOne ? '' : undefined,
              actualName: m.isPlusOne ? '' : undefined
            }))
          };
        });
        renderStats(recomputeStats(lastData.households));
        renderHouseholds(lastData.households, searchInput.value);
        populateHouseholdPicker(lastData.households);
      }
      loadDashboard();
    } catch (err) {
      setStatus(dashboardStatus, 'Something went wrong — try again.', 'error');
    }
  }

  async function saveHouseholdEdit(householdId) {
    const session = getSession();
    if (!session) { showLogin(); return; }
    const card = householdsEl.querySelector('.admin-household[data-household-id="' + householdId + '"]');
    if (!card) return;

    const group = card.querySelector('.admin-edit-group').value.trim();
    const address = card.querySelector('.admin-edit-address').value.trim();
    const envelopeName = card.querySelector('.admin-edit-envelope-name').value.trim();
    const envelopeSubline = card.querySelector('.admin-edit-envelope-subline').value.trim();
    const guests = Array.from(card.querySelectorAll('.admin-edit-name')).map(input => ({
      id: Number(input.getAttribute('data-guest-id')),
      name: input.value.trim()
    }));

    if (guests.some(g => !g.name)) {
      setStatus(dashboardStatus, "Names can't be blank.", 'error');
      return;
    }

    const plusOneCheckbox = card.querySelector('.admin-edit-plusone');
    const allowPlusOne = plusOneCheckbox ? plusOneCheckbox.checked : null;

    setStatus(dashboardStatus, 'Saving…');
    try {
      const result = await apiPost({
        action: 'adminEditHousehold',
        token: session.token,
        payload: { householdId, group, address, envelopeName, envelopeSubline, guests, allowPlusOne }
      });
      if (!result || !result.ok) {
        setStatus(dashboardStatus, (result && (result.message || result.error)) || 'Could not save changes.', 'error');
        return;
      }
      editingHouseholdId = null;
      setStatus(dashboardStatus, '');
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
    const expandBtn = e.target.closest('.bx-expand-toggle');
    if (expandBtn) {
      // Toggle the DOM directly (not a re-render) so the CSS transition
      // actually plays; the Set keeps the state across later re-renders.
      const id = Number(expandBtn.getAttribute('data-id'));
      const card = expandBtn.closest('.admin-household');
      const reveal = card && card.querySelector('.bx-reveal');
      const nowOpen = !(reveal && reveal.classList.contains('open'));
      expandOverrides.set(id, nowOpen);
      expandBtn.classList.toggle('open', nowOpen);
      expandBtn.setAttribute('aria-expanded', String(nowOpen));
      if (reveal) reveal.classList.toggle('open', nowOpen);
      return;
    }
    const editBtn = e.target.closest('.admin-edit-btn');
    if (editBtn) {
      editingHouseholdId = Number(editBtn.getAttribute('data-id'));
      renderHouseholds(lastData.households, searchInput.value);
      return;
    }
    const cancelBtn = e.target.closest('.admin-cancel-edit-btn');
    if (cancelBtn) {
      editingHouseholdId = null;
      renderHouseholds(lastData.households, searchInput.value);
      return;
    }
    const saveBtn = e.target.closest('.admin-save-edit-btn');
    if (saveBtn) {
      saveHouseholdEdit(Number(saveBtn.getAttribute('data-id')));
      return;
    }
    const removeBtn = e.target.closest('.admin-remove-btn');
    if (removeBtn) {
      removeGuest(removeBtn.getAttribute('data-id'), removeBtn.getAttribute('data-name'));
      return;
    }
    const resetBtn = e.target.closest('.admin-reset-btn');
    if (resetBtn) {
      resetRsvp(resetBtn.getAttribute('data-id'));
    }
  });

  statListContent.addEventListener('click', function (e) {
    const nameBtn = e.target.closest('.stat-list-name');
    if (!nameBtn) return;
    const li = nameBtn.closest('.stat-list-item');
    const detail = li.querySelector('.stat-list-detail');
    if (!detail.hidden) { detail.hidden = true; return; }
    const household = statListHouseholdsById[Number(li.getAttribute('data-household-id'))];
    detail.innerHTML = household ? householdCardHtml(household, { showRemove: false }) : '';
    detail.hidden = false;
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
