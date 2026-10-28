/* Seating planner — the barn floor plan (to scale, 60' x 38') with the
   head table + 18 round tables of 8. Attending guests (incl. +1s who are
   coming) start in "Not seated yet"; drag a name / household onto a
   table, or tap names then tap a table. Tap a table to see who's there
   and take people off. Saved per guest in D1 (seating table), so it
   follows Michael + Xan across devices. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Floor plan, in the diagram's own pixels (~30px per foot).
  const HEAD = { no: 0, x: 400, y: 140, w: 183, h: 70, seats: 2 };
  const ROUND_SEATS = 8;
  const TABLE_R = 79;
  const TABLES = [
    [253, 362], [250, 646], [253, 915], [253, 1210], [253, 1480],
    [503, 537], [491, 813], [511, 1098], [503, 1353],
    [735, 362], [743, 656], [743, 939], [743, 1234], [758, 1496],
    [985, 537], [972, 830], [972, 1098], [972, 1361]
  ].map((p, i) => ({ no: i + 1, x: p[0], y: p[1] }));
  const BENCHES = [370, 542, 773, 946, 1179, 1352].map(y => [56, y])
    .concat([379, 551, 783, 955, 1188, 1360].map(y => [1115, y]));
  const PX_PER_FOOT = 1157 / 38;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const plan = document.getElementById('plan');
  const ghost = document.getElementById('ghost');
  const searchInput = document.getElementById('seat-search');
  const panel = document.getElementById('table-panel');

  let guests = [];        // { id, name, householdId, household, group, coming }
  let seating = {};       // guest id -> table no
  let selected = new Set();
  let openTable = null;   // table no shown in the panel

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
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }
  function tableName(no) { return no === 0 ? 'Head table' : 'Table ' + no; }
  function capacity(no) { return no === 0 ? HEAD.seats : ROUND_SEATS; }
  function guestsAt(no) {
    return guests.filter(g => seating[g.id] === no);
  }
  function status(msg) { el('seat-status').textContent = msg || ''; }

  // ---------- Guests from the admin payload ----------

  function buildGuests(households) {
    const out = [];
    households.forEach(h => {
      const realNames = h.members.filter(m => !m.isPlusOne).map(m => m.name);
      const household = realNames.join(' & ') || h.label || '';
      h.members.forEach(m => {
        let coming, name;
        if (m.isPlusOne) {
          coming = m.bringingPlusOne === 'yes';
          const host = (realNames[0] || '').split(/\s+/)[0];
          name = (m.actualName || '').trim() || ('Guest of ' + host);
        } else {
          coming = m.attending === 'yes';
          name = m.name;
        }
        out.push({ id: m.id, name, householdId: h.id, household, group: h.group || '', coming });
      });
    });
    return out;
  }
  // Coming, plus anyone already seated who has since dropped out (so they
  // show up flagged instead of silently vanishing from a table).
  function relevant() {
    return guests.filter(g => g.coming || seating[g.id] !== undefined);
  }

  // ---------- Floor plan ----------

  function chairPath(cx, cy, angleDeg, dist) {
    const g = svg('g', { transform: 'rotate(' + angleDeg + ' ' + cx + ' ' + cy + ') translate(' + cx + ' ' + (cy - dist) + ')' });
    svg('path', { d: 'M-23 17 V-6 a11 11 0 0 1 11 -11 h24 a11 11 0 0 1 11 11 V17 Z', class: 'chair' }, g);
    return g;
  }

  function drawPlan() {
    plan.innerHTML = '';
    // Outside the room (bottom) — left as plain blocks, as on the diagram.
    svg('rect', { x: 105, y: 1806, width: 250, height: 91, class: 'outside-dark' }, plan);
    svg('rect', { x: 909, y: 1806, width: 280, height: 139, class: 'outside-grey' }, plan);
    svg('rect', { x: 50, y: 52, width: 1157, height: 1754, class: 'room' }, plan);

    BENCHES.forEach(b => svg('rect', { x: b[0], y: b[1], width: 59, height: 151, class: 'bench' }, plan));

    // Pizza buffet
    svg('rect', { x: 801, y: 1715, width: 182, height: 68, class: 'buffet' }, plan);
    svg('rect', { x: 983, y: 1715, width: 183, height: 68, class: 'buffet' }, plan);
    const pz = svg('text', { x: 983, y: 1758, class: 'plan-label' }, plan);
    pz.textContent = 'Pizza';

    // Scale bar — 10 feet
    const len = PX_PER_FOOT * 10;
    const sb = svg('g', { class: 'scale' }, plan);
    svg('path', { d: 'M100 1755 v-14 M100 1748 H' + (100 + len) + ' M' + (100 + len) + ' 1755 v-14' }, sb);
    const st = svg('text', { x: 100 + len / 2, y: 1730 }, sb);
    st.textContent = '10 ft';

    // Head table
    const hg = svg('g', { class: 'tbl tbl-head', 'data-table': 0 }, plan);
    const headSeated = guestsAt(0);
    [468, 527].forEach((x, i) => {
      const c = svg('path', { d: 'M' + (x - 23) + ' 133 V108 a11 11 0 0 1 11 -11 h24 a11 11 0 0 1 11 11 V133 Z', class: 'chair' + (headSeated[i] ? ' taken' : '') }, hg);
      if (headSeated[i]) svg('title', {}, c).textContent = headSeated[i].name;
    });
    svg('rect', { x: HEAD.x, y: HEAD.y, width: HEAD.w, height: HEAD.h, class: 'top' }, hg);
    const ht = svg('text', { x: HEAD.x + HEAD.w / 2, y: HEAD.y + 45, class: 'tbl-sub' }, hg);
    ht.textContent = 'Mike & Xan';
    if (openTable === 0) hg.classList.add('is-open');

    // Round tables
    TABLES.forEach(t => {
      const seated = guestsAt(t.no);
      const g = svg('g', { class: 'tbl', 'data-table': t.no }, plan);
      for (let k = 0; k < ROUND_SEATS; k++) {
        const c = chairPath(t.x, t.y, k * 45, TABLE_R + 24);
        const who = seated[k];
        c.firstChild.setAttribute('class', 'chair' + (who ? (who.coming ? ' taken' : ' taken gone') : ''));
        if (who) svg('title', {}, c).textContent = who.name;
        g.appendChild(c);
      }
      svg('circle', { cx: t.x, cy: t.y, r: TABLE_R, class: 'top' }, g);
      const num = svg('text', { x: t.x, y: t.y + 8, class: 'tbl-no' }, g);
      num.textContent = t.no;
      const cnt = svg('text', { x: t.x, y: t.y + 46, class: 'tbl-sub' }, g);
      cnt.textContent = seated.length + '/' + ROUND_SEATS;
      if (seated.length > ROUND_SEATS) g.classList.add('is-over');
      else if (seated.length === ROUND_SEATS) g.classList.add('is-full');
      if (openTable === t.no) g.classList.add('is-open');
      svg('title', {}, g).textContent = tableName(t.no) + (seated.length ? ': ' + seated.map(s => s.name).join(', ') : '');
    });
  }

  // ---------- Side list ----------

  function chipHtml(g, opts) {
    const cls = ['seat-chip'];
    if (selected.has(g.id)) cls.push('is-selected');
    if (!g.coming) cls.push('is-gone');
    return '<span class="' + cls.join(' ') + '" data-guest="' + g.id + '">' +
      escapeHtml(g.name) + (g.coming ? '' : ' <em>not coming</em>') +
      (opts && opts.remove ? '<button type="button" class="seat-x" data-unseat="' + g.id + '" aria-label="Take ' + escapeHtml(g.name) + ' off this table">&times;</button>' : '') +
      '</span>';
  }

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const unseated = relevant().filter(g => seating[g.id] === undefined);
    const byHh = new Map();
    unseated.forEach(g => {
      if (!byHh.has(g.householdId)) byHh.set(g.householdId, []);
      byHh.get(g.householdId).push(g);
    });
    let hhs = Array.from(byHh.values()).filter(list =>
      !q || list.some(g => g.name.toLowerCase().includes(q) || g.household.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)));
    hhs.sort((a, b) => (a[0].group || '~').localeCompare(b[0].group || '~') || a[0].household.localeCompare(b[0].household));

    let html = '';
    let lastGroup = null;
    hhs.forEach(list => {
      const grp = list[0].group || 'No group';
      if (grp !== lastGroup) { html += '<h3 class="seat-group">' + escapeHtml(grp) + '</h3>'; lastGroup = grp; }
      html += '<div class="seat-hh">' +
        '<button type="button" class="seat-hh-head" data-household="' + list[0].householdId + '">' +
        list.length + (list.length === 1 ? ' guest' : ' guests') + ' &middot; all</button>' +
        list.map(g => chipHtml(g)).join('') + '</div>';
    });
    el('unseated-list').innerHTML = html ||
      '<p class="seat-empty">' + (q ? 'No matches.' : 'Everyone coming has a seat.') + '</p>';
    el('unseated-head').textContent = 'Not seated yet (' + unseated.length + ')';

    const coming = guests.filter(g => g.coming);
    const seatedCount = coming.filter(g => seating[g.id] !== undefined).length;
    el('seat-progress').textContent = seatedCount + ' of ' + coming.length + ' seated';
    el('seat-hint').textContent = selected.size
      ? selected.size + ' picked — tap a table to seat them.'
      : 'Drag names onto a table — or tap names, then tap a table.';
  }

  function renderPanel() {
    if (openTable === null) { panel.hidden = true; return; }
    const seated = guestsAt(openTable);
    const cap = capacity(openTable);
    panel.hidden = false;
    panel.setAttribute('data-table', openTable);
    panel.innerHTML =
      '<div class="seat-panel-top"><h2>' + tableName(openTable) +
      ' <span class="' + (seated.length > cap ? 'over' : '') + '">' + seated.length + '/' + cap + '</span></h2>' +
      '<button type="button" class="seat-panel-close" id="panel-close" aria-label="Close">&times;</button></div>' +
      (seated.length
        ? '<div class="seat-panel-list">' + seated.map(g => chipHtml(g, { remove: true })).join('') + '</div>'
        : '<p class="seat-empty">Nobody here yet.</p>');
  }

  function render() { drawPlan(); renderList(); renderPanel(); }

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
    if (!data || !data.ok) throw new Error(data && (data.message || data.error) || 'save failed');
    return data;
  }

  async function seat(ids, table) {
    ids = ids.filter(id => (table === null ? seating[id] !== undefined : seating[id] !== table));
    if (!ids.length) return;
    const before = {};
    ids.forEach(id => { before[id] = seating[id]; if (table === null) delete seating[id]; else seating[id] = table; });
    selected.clear();
    if (table !== null && seating !== null) {
      const over = guestsAt(table).length - capacity(table);
      status(over > 0 ? tableName(table) + ' is over by ' + over + '.' : '');
    } else status('');
    render();
    try {
      await post('adminSetSeats', { guestIds: ids, table: table });
    } catch (err) {
      ids.forEach(id => { if (before[id] === undefined) delete seating[id]; else seating[id] = before[id]; });
      status('Didn’t save — ' + err.message + '. Try again.');
      render();
    }
  }
  window.__seat = seat; // test hook

  // ---------- Tap + drag ----------

  function idsFor(target) {
    const chip = target.closest('[data-guest]');
    if (chip) {
      const id = Number(chip.getAttribute('data-guest'));
      return selected.has(id) ? Array.from(selected) : [id];
    }
    const hh = target.closest('[data-household]');
    if (hh) {
      const hid = Number(hh.getAttribute('data-household'));
      return relevant().filter(g => g.householdId === hid && seating[g.id] === undefined).map(g => g.id);
    }
    return null;
  }

  function dropTargetAt(x, y) {
    ghost.hidden = true;
    const under = document.elementFromPoint(x, y);
    if (!under) return null;
    const t = under.closest('[data-table]');
    if (t) return { table: Number(t.getAttribute('data-table')) };
    if (under.closest('[data-drop="unseat"]')) return { table: null };
    return null;
  }

  let drag = null;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button.seat-x')) return;
    const ids = idsFor(e.target);
    if (!ids || !ids.length) return;
    drag = { ids, x: e.clientX, y: e.clientY, on: false, pointerId: e.pointerId };
  });
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.on = true;
      const first = guests.find(g => g.id === drag.ids[0]);
      ghost.textContent = drag.ids.length === 1 ? (first ? first.name : '1 guest') : drag.ids.length + ' guests';
      document.body.classList.add('is-dragging');
    }
    e.preventDefault();
    ghost.hidden = false;
    ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY + 12) + 'px)';
    document.querySelectorAll('.is-target').forEach(n => n.classList.remove('is-target'));
    const t = dropTargetAt(e.clientX, e.clientY);
    ghost.hidden = false;
    if (t && t.table !== null) {
      const n = plan.querySelector('[data-table="' + t.table + '"]');
      if (n) n.classList.add('is-target');
    }
  });
  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove('is-dragging');
    document.querySelectorAll('.is-target').forEach(n => n.classList.remove('is-target'));
    ghost.hidden = true;
    if (!d.on || e.type === 'pointercancel') return;
    d.dragged = true;
    suppressClick = true;
    const t = dropTargetAt(e.clientX, e.clientY);
    if (t) seat(d.ids, t.table);
  }
  let suppressClick = false;
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  document.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    const x = e.target.closest('[data-unseat]');
    if (x) { seat([Number(x.getAttribute('data-unseat'))], null); return; }
    if (e.target.closest('#panel-close')) { openTable = null; render(); return; }

    const t = e.target.closest('#plan [data-table]');
    if (t) {
      const no = Number(t.getAttribute('data-table'));
      if (selected.size) { openTable = no; seat(Array.from(selected), no); }
      else { openTable = openTable === no ? null : no; render(); }
      return;
    }
    const chip = e.target.closest('[data-guest]');
    if (chip) {
      const id = Number(chip.getAttribute('data-guest'));
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      render();
      return;
    }
    const hh = e.target.closest('[data-household]');
    if (hh) {
      const ids = idsFor(hh);
      const allOn = ids.every(id => selected.has(id));
      ids.forEach(id => allOn ? selected.delete(id) : selected.add(id));
      render();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selected.size) { e.preventDefault(); selected.clear(); render(); }
  });
  searchInput.addEventListener('input', renderList);

  // ---------- Load ----------

  // Test hook: render fabricated data without a live backend.
  window.__renderSeating = function (households, seats) {
    guests = buildGuests(households); seating = seats || {};
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

  if (!window.__SEATING_TEST__) load();
})();
