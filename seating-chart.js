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

  let guests = [];   // { id, name, householdId, order, anon, coming }
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
  // A +1 "name" that is really a placeholder, not a person.
  const PLACEHOLDER = /^(\+\s*1|plus\s*-?\s*(1|one)|guest|tbd|tba|unknown|n\/?a|none|-+|\?+)$/i;

  function buildGuests(households) {
    const out = [];
    households.forEach(h => {
      h.members.forEach((m, order) => {
        let coming, name, anon = false;
        if (m.isPlusOne) {
          coming = m.bringingPlusOne === 'yes';
          name = (m.actualName || '').trim();
          if (!name || PLACEHOLDER.test(name)) { anon = true; name = ''; }
        } else {
          coming = m.attending === 'yes';
          name = m.name;
          // Someone added by hand as a regular guest named "Plus 1" is
          // still an unnamed +1, not a person called "1".
          if (PLACEHOLDER.test(String(name || '').trim())) { anon = true; name = ''; }
        }
        out.push({ id: m.id, name, householdId: h.id, order, anon, coming });
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
    const p = splitName(g.name);
    return { id: g.id, householdId: g.householdId, order: g.order, anon: g.anon,
      first: p.first, last: p.last, suffix: p.suffix, guests: 0, table: seating[g.id] };
  }
  // Every unnamed +1 rides on the line of someone from their own household:
  // "Brooke Henderson & Guest". First choice is a household member at the
  // same table; failing that, any household member on the chart (the line
  // shows the +1's own table, "Guest of Brooke Henderson"). Only if nobody
  // from the household is on the chart does a bare "Guest" line remain.
  function foldGuests(entries) {
    const real = entries.filter(e => !e.anon);
    const kept = real.slice();
    entries.filter(e => e.anon).forEach(e => {
      const family = real.filter(r => r.householdId === e.householdId).sort((a, b) => a.order - b.order);
      const sameTable = family.find(r => r.table === e.table);
      if (sameTable) { sameTable.guests++; return; }
      const host = family[0];
      kept.push(Object.assign(e, {
        guestOfName: host ? [host.first, host.last].filter(Boolean).join(' ') : '',
        last: host ? host.last : 'Guest',
        first: host ? host.first : ''
      }));
    });
    return kept;
  }
  function byName(a, b) {
    return a.last.localeCompare(b.last, 'en', { sensitivity: 'base' }) ||
      a.first.localeCompare(b.first, 'en', { sensitivity: 'base' }) ||
      (a.anon ? 1 : 0) - (b.anon ? 1 : 0);
  }
  function guestTail(e) {
    if (!e.guests) return '';
    return e.guests === 1 ? ' & Guest' : ' & ' + e.guests + ' Guests';
  }
  // "First Last Jr. & Guest" — used on both sheets (A-to-Z is still sorted
  // by last name).
  function displayName(e) {
    if (e.anon) return e.guestOfName ? 'Guest of ' + e.guestOfName : 'Guest';
    return [e.first, e.last, e.suffix].filter(Boolean).join(' ') + guestTail(e);
  }
  function azName(e) { return escapeHtml(displayName(e)); }
  function headCount(list) { return list.reduce((n, e) => n + 1 + (e.guests || 0), 0); }
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
      warnings.push(unseated.length + ' coming but not seated yet: ' + unseated.map(g => g.name || 'a +1').join(', ') + '.');
    }
    gone.forEach(g => warnings.push((g.name || 'A +1') + ' — at ' + tableName(seating[g.id]).toLowerCase() + ' but marked not coming.'));
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
