/* Seating chart — the printable version of the seating planner.
   Reads the same admin payload as seating.html, keeps only people who are
   coming AND have a table, and lays them out two ways: an A-to-Z list
   (by last name) saying which table each person is at, and a by-table
   list. The "Save as PDF" button is just the browser's print dialog. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const EVENT_LINE = 'Michael & Alexandria · November 14, 2026';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const sheetsEl = document.getElementById('chart-sheets');
  const summaryEl = document.getElementById('chart-summary');
  const warningsEl = document.getElementById('chart-warnings');
  const warningsListEl = document.getElementById('chart-warnings-list');
  const optAz = document.getElementById('opt-az');
  const optTables = document.getElementById('opt-tables');

  let guests = [];   // { id, name, householdId, host, coming }
  let seating = {};  // guest id -> table no

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function tableName(no) { return no === 0 ? 'Head table' : 'Table ' + no; }
  function tableShort(no) { return no === 0 ? 'Head' : String(no); }

  // Same rules as seating.js so the two pages always agree on who is coming.
  function buildGuests(households) {
    const out = [];
    households.forEach(h => {
      const realNames = h.members.filter(m => !m.isPlusOne).map(m => m.name);
      const hostMember = h.members.find(m => !m.isPlusOne);
      h.members.forEach(m => {
        let coming, name, host = null, hostId = null;
        if (m.isPlusOne) {
          coming = m.bringingPlusOne === 'yes';
          host = realNames[0] || '';
          hostId = hostMember ? hostMember.id : null;
          const hostFirst = host.split(/\s+/)[0];
          name = (m.actualName || '').trim() || ('Guest of ' + hostFirst);
        } else {
          coming = m.attending === 'yes';
          name = m.name;
        }
        out.push({ id: m.id, name, householdId: h.id, host, hostId, coming });
      });
    });
    return out;
  }

  // "Mary Ann de la Cruz Jr." -> { first: "Mary Ann", last: "de la Cruz",
  // suffix: "Jr." }. Lower-case particles (de, la, van, von...) stay with
  // the last name so "de la Cruz" files under D, the way a guest would
  // look for it. An unnamed +1 ("Guest of Brooke") files under the host's
  // last name so they find themselves next to the person they came with.
  const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;
  const PARTICLE = /^(de|del|della|der|den|di|da|du|la|le|van|von|st\.?|ter|ten|op|af|el|al|bin|ibn|mac|o')$/i;
  function splitName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '', suffix: '' };
    let suffix = '';
    if (parts.length > 2 && SUFFIX.test(parts[parts.length - 1])) suffix = parts.pop();
    if (parts.length === 1) return { first: '', last: parts[0], suffix };
    const lastParts = [parts.pop()];
    while (parts.length > 1 && PARTICLE.test(parts[parts.length - 1]) && parts[parts.length - 1] === parts[parts.length - 1].toLowerCase()) {
      lastParts.unshift(parts.pop());
    }
    return { first: parts.join(' '), last: lastParts.join(' '), suffix };
  }
  function entryFor(g) {
    if (g.host !== null && /^Guest of /.test(g.name)) {
      const hostParts = splitName(g.host);
      return { id: g.id, hostId: g.hostId, first: g.name, last: hostParts.last || hostParts.first, suffix: '', guestOf: true, andGuest: false, table: seating[g.id] };
    }
    const p = splitName(g.name);
    return { id: g.id, hostId: null, first: p.first, last: p.last, suffix: p.suffix, guestOf: false, andGuest: false, table: seating[g.id] };
  }
  // An unnamed +1 rides on the line of the person who brought them:
  // "Henderson, Brooke & Guest". Only when the host is on the chart at the
  // same table; otherwise the +1 keeps their own "Guest of Brooke" line.
  function foldGuests(entries) {
    const byId = new Map(entries.map(e => [e.id, e]));
    return entries.filter(e => {
      if (!e.guestOf) return true;
      const host = byId.get(e.hostId);
      if (!host || host.table !== e.table) return true;
      host.andGuest = true;
      return false;
    });
  }
  function byName(a, b) {
    return a.last.localeCompare(b.last, 'en', { sensitivity: 'base' }) ||
      a.first.localeCompare(b.first, 'en', { sensitivity: 'base' });
  }
  // "First Last Jr. & Guest" for the by-table list; a +1 whose host isn't
  // on the chart stays "Guest of Brooke".
  function displayName(e) {
    if (e.guestOf) return e.first;
    return [e.first, e.last, e.suffix].filter(Boolean).join(' ') + (e.andGuest ? ' & Guest' : '');
  }
  // A-to-Z list: sorted by last name but shown "First Last Jr. & Guest",
  // with the last name in bold so the eye can scan the sort key.
  function azName(e) {
    if (e.guestOf) return escapeHtml(e.first);
    return (e.first ? escapeHtml(e.first) + ' ' : '') + escapeHtml(e.last) +
      (e.suffix ? ' ' + escapeHtml(e.suffix) : '') + (e.andGuest ? ' &amp; Guest' : '');
  }
  function headCount(list) { return list.reduce((n, e) => n + (e.andGuest ? 2 : 1), 0); }
  // Letter heading: strip accents so "Ødegaard" and "Émile" file under O and E.
  const LETTER_MAP = { 'Ø': 'O', 'Œ': 'O', 'Æ': 'A', 'Ł': 'L', 'Đ': 'D', 'Ð': 'D', 'Þ': 'T', 'ß': 'S' };
  function letterOf(last) {
    const c = (last || '').trim()[0] || '#';
    const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '')[0] || c;
    return (LETTER_MAP[base.toUpperCase()] || base).toUpperCase();
  }

  // ---------- Sheets ----------

  function sheetHead(title) {
    return '<header class="sheet-head"><h2 class="sheet-title">' + escapeHtml(title) + '</h2>' +
      '<p class="sheet-sub">' + escapeHtml(EVENT_LINE) + '</p></header>';
  }

  function azSheet(entries) {
    let html = '';
    let letter = null;
    entries.forEach(e => {
      const L = letterOf(e.last);
      if (L !== letter) { letter = L; html += '<div class="az-letter">' + escapeHtml(L) + '</div>'; }
      html += '<div class="az-row">' +
        '<span class="name">' + azName(e) + '</span>' +
        '<span class="lead"></span>' +
        '<span class="tbl">' + escapeHtml(tableShort(e.table)) + '</span>' +
        '</div>';
    });
    return '<section class="sheet">' + sheetHead('Seating Chart') + '<div class="az">' + html + '</div></section>';
  }

  function tablesSheet(entries) {
    const byTable = new Map();
    entries.forEach(e => {
      if (!byTable.has(e.table)) byTable.set(e.table, []);
      byTable.get(e.table).push(e);
    });
    const nos = Array.from(byTable.keys()).sort((a, b) => a - b);
    const cards = nos.map(no => {
      const list = byTable.get(no).slice().sort(byName);
      return '<div class="table-card"><h3>' + escapeHtml(tableName(no)) + '<span>' + headCount(list) + '</span></h3><ul>' +
        list.map(e => '<li>' + escapeHtml(displayName(e)) + '</li>').join('') + '</ul></div>';
    });
    return '<section class="sheet">' + sheetHead('By Table') + '<div class="tables">' + cards.join('') + '</div></section>';
  }

  function render() {
    // The head table (Mike & Xan) stays off the chart — guests don't need
    // to look the two of them up.
    const seatedComing = guests.filter(g => g.coming && seating[g.id] !== undefined && seating[g.id] !== 0);
    const entries = foldGuests(seatedComing.map(entryFor)).sort(byName);
    const tableCount = new Set(entries.map(e => e.table)).size;
    const people = headCount(entries);

    let html = '';
    if (optAz.checked) html += azSheet(entries);
    if (optTables.checked) html += tablesSheet(entries);
    sheetsEl.innerHTML = html || '<p class="chart-gate">Tick at least one list above.</p>';

    summaryEl.textContent = people + (people === 1 ? ' person' : ' people') +
      ' across ' + tableCount + (tableCount === 1 ? ' table' : ' tables');

    // Screen-only heads-up about anyone the printed chart skips.
    const unseated = guests.filter(g => g.coming && seating[g.id] === undefined);
    const gone = guests.filter(g => !g.coming && seating[g.id] !== undefined);
    const warnings = [];
    if (unseated.length) {
      warnings.push(unseated.length + ' coming but not seated yet: ' + unseated.map(g => g.name).join(', ') + '.');
    }
    gone.forEach(g => warnings.push(g.name + ' — at ' + tableName(seating[g.id]).toLowerCase() + ' but marked not coming.'));
    warningsEl.hidden = !warnings.length;
    warningsListEl.innerHTML = warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
  }

  // ---------- Load ----------

  // Test hook: render fabricated data without a live backend.
  window.__renderChart = function (households, seats) {
    guests = buildGuests(households);
    seating = {};
    Object.keys(seats || {}).forEach(k => { seating[Number(k)] = seats[k]; });
    gate.hidden = true; app.hidden = false; render();
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
    guests = buildGuests(data.households || []);
    seating = {};
    Object.keys(data.seating || {}).forEach(k => { seating[Number(k)] = data.seating[k]; });
    gate.hidden = true;
    app.hidden = false;
    render();
  }

  optAz.addEventListener('change', render);
  optTables.addEventListener('change', render);
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });

  if (!window.__SEATING_CHART_TEST__) load();
})();
