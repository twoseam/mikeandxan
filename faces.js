/* Faces — name the faces the Mac Studio helper found.
   To do: "Is this ___?" suggestions first (Yes/No), then brand-new faces
   (pick a guest, type a new name, or ignore). Every answer re-matches the
   rest, so the queue shrinks fast. People: review each person's faces and
   remove wrong tags. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const $ = (id) => document.getElementById(id);

  let token = '';
  try {
    const s = JSON.parse(localStorage.getItem('mx_admin_session') || 'null');
    if (s && s.token && Date.now() < s.expiresAt) token = s.token;
  } catch (e) { /* ignore */ }
  if (!token) return;
  $('gate').hidden = true;
  $('app').hidden = false;

  let queue = null;          // last faceQueue response
  let current = null;        // face on the card
  let mode = '';             // 'ask' | 'name'
  const skipped = new Set(); // faces skipped this visit

  const api = {
    get: (action) => fetch(WORKER_URL + '/?action=' + action + '&token=' + encodeURIComponent(token)).then(r => r.json()),
    post: (action, payload) => fetch(WORKER_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, token, payload })
    }).then(r => r.json())
  };
  const media = (p) => (p ? WORKER_URL + p : '');
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- helper status ----------
  function ago(iso) {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 48 ? h + ' hr ago' : Math.round(h / 24) + ' days ago';
  }
  function showHelper() {
    const h = queue.helper || {}, c = queue.counts || {};
    const awake = h.last_seen && Date.now() - new Date(h.last_seen).getTime() < 5 * 60000;
    const el = $('helper');
    el.classList.toggle('is-off', !awake);
    el.textContent =
      (awake ? 'Mac Studio scanner: on' : 'Mac Studio scanner: off (last seen ' + ago(h.last_seen) + ')') +
      ' · ' + c.scanned + ' scanned' +
      (c.waiting ? ' · ' + c.waiting + ' waiting' : '') +
      (c.failed ? ' · ' + c.failed + " couldn't open" : '') +
      ' · ' + c.confirmed + ' named by you, ' + c.auto + ' auto';
    const todo = (c.ask || 0) + (c.fresh || 0);
    $('todo-count').textContent = todo ? '(' + todo + ')' : '';
  }

  // ---------- To do ----------
  async function load() {
    queue = await api.get('faceQueue');
    if (!queue.ok) { $('helper').textContent = 'Could not load: ' + (queue.error || 'error'); return; }
    showHelper();
    next();
  }

  function next() {
    const ask = queue.suggested.find((f) => !skipped.has(f.id));
    const fresh = queue.fresh.find((f) => !skipped.has(f.id));
    current = ask || fresh || null;
    mode = ask ? 'ask' : 'name';
    if (!current) {
      $('card').hidden = true;
      $('done').hidden = false;
      const c = queue.counts;
      $('done-sub').textContent = c.waiting ? c.waiting + ' photos still waiting for the scanner.' : (skipped.size ? 'Skipped faces come back next visit.' : '');
      return;
    }
    $('done').hidden = true;
    $('card').hidden = false;
    $('card-face').src = media(current.thumb);
    $('name-input').value = '';
    if (mode === 'ask') {
      $('card-q').textContent = 'Is this ' + current.suggestName + '?';
      $('card-ref-wrap').hidden = !current.suggestThumb;
      $('card-ref').src = media(current.suggestThumb);
      $('card-ref-name').textContent = current.suggestName;
      $('ask-actions').hidden = false;
      $('name-box').hidden = true;
      $('btn-other').hidden = false;
    } else {
      $('card-q').textContent = 'Who is this?';
      $('card-ref-wrap').hidden = true;
      $('ask-actions').hidden = true;
      $('name-box').hidden = false;
      $('btn-other').hidden = true;
      renderNames('');
    }
  }

  // Name list: people already tagged first, then guests, then "add new".
  function renderNames(q) {
    const needle = q.trim().toLowerCase();
    const match = (n) => !needle || n.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle)) || n.toLowerCase().includes(needle);
    const people = queue.people.filter((p) => !p.ignored && match(p.name));
    const taken = new Set(queue.people.map((p) => p.guestId).filter(Boolean));
    const guests = queue.guests.filter((g) => !taken.has(g.id) && match(g.name));
    const rows = [];
    people.slice(0, 30).forEach((p) => rows.push(`<li><button type="button" data-person="${p.id}">${esc(p.name)}<small>${p.photos} photo${p.photos === 1 ? '' : 's'}</small></button></li>`));
    guests.slice(0, 60).forEach((g) => rows.push(`<li><button type="button" data-guest="${g.id}">${esc(g.name)}<small>guest</small></button></li>`));
    const exact = queue.people.concat(queue.guests).some((x) => x.name.toLowerCase() === needle);
    if (needle && !exact) rows.push(`<li class="fc-new"><button type="button" data-new="1">+ Add &ldquo;${esc(q.trim())}&rdquo; as a new name</button></li>`);
    $('name-list').innerHTML = rows.join('');
  }

  async function act(promise, label) {
    $('card').style.opacity = '.4';
    try {
      const r = await promise;
      if (!r.ok) { toast(r.error || 'Something went wrong'); return; }
      const extra = r.autoTagged ? ' · ' + r.autoTagged + ' more tagged automatically' : '';
      toast(label + extra);
      await load();
    } catch (e) {
      toast('No connection — try again');
    } finally {
      $('card').style.opacity = '';
    }
  }

  $('name-input').addEventListener('input', (e) => renderNames(e.target.value));
  $('name-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !current) return;
    const payload = { faceId: current.id };
    let label = 'Tagged';
    if (b.dataset.person) { payload.personId = Number(b.dataset.person); label = 'Tagged ' + b.firstChild.textContent; }
    else if (b.dataset.guest) { payload.guestId = Number(b.dataset.guest); label = 'Tagged ' + b.firstChild.textContent; }
    else { payload.name = $('name-input').value.trim(); label = 'Added ' + payload.name; }
    act(api.post('faceLabel', payload), label);
  });

  $('btn-yes').addEventListener('click', () => current && act(api.post('faceLabel', { faceId: current.id, personId: current.suggestId }), 'Tagged ' + current.suggestName));
  $('btn-no').addEventListener('click', () => current && act(api.post('faceReject', { faceId: current.id, personId: current.suggestId }), 'Got it'));
  $('btn-other').addEventListener('click', () => {
    mode = 'name';
    $('card-q').textContent = 'Who is this?';
    $('card-ref-wrap').hidden = true;
    $('ask-actions').hidden = true;
    $('name-box').hidden = false;
    $('btn-other').hidden = true;
    renderNames('');
    $('name-input').focus();
  });
  $('btn-ignore').addEventListener('click', () => current && act(api.post('faceLabel', { faceId: current.id, ignore: true }), 'Ignored'));
  $('btn-skip').addEventListener('click', () => { if (current) { skipped.add(current.id); next(); } });

  // ---------- photo viewer ----------
  function openViewer(face) {
    const v = $('viewer'), img = $('viewer-img'), box = $('viewer-box');
    box.hidden = true;
    img.onload = () => {
      if (face.isVideo || !face.box) return;
      const [x, y, w, h] = face.box;
      Object.assign(box.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' });
      box.hidden = false;
    };
    img.src = media(face.photo);
    v.hidden = false;
  }
  $('card-photo').addEventListener('click', () => current && openViewer(current));
  $('viewer-close').addEventListener('click', () => { $('viewer').hidden = true; });
  $('viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer') $('viewer').hidden = true; });

  // ---------- People ----------
  let openPerson = null;
  function renderPeople() {
    $('person').hidden = true;
    $('people').hidden = false;
    const list = [...queue.people].sort((a, b) => (a.ignored - b.ignored) || a.name.localeCompare(b.name));
    $('people').innerHTML = list.length ? list.map((p) =>
      `<li><button type="button" data-id="${p.id}" class="${p.ignored ? 'fc-ignored' : ''}">` +
      `<span>${esc(p.ignored ? 'Ignored faces' : p.name)}</span><span class="fc-count">${p.photos} photo${p.photos === 1 ? '' : 's'}</span></button></li>`
    ).join('') : '<li>No one tagged yet.</li>';
  }
  async function showPerson(id) {
    openPerson = queue.people.find((p) => p.id === id);
    if (!openPerson) return;
    $('people').hidden = true;
    $('person').hidden = false;
    $('person-name').textContent = openPerson.ignored ? 'Ignored faces' : openPerson.name;
    $('person-rename').hidden = openPerson.ignored;
    $('person-faces').innerHTML = 'Loading…';
    const r = await api.post('personFaces', { personId: id });
    $('person-faces').innerHTML = (r.faces || []).map((f) =>
      `<button type="button" data-face="${f.id}" class="${f.status === 'auto' ? 'is-auto' : ''}"><img src="${media(f.thumb)}" alt="" loading="lazy" /></button>`
    ).join('') || 'No faces (only added by hand).';
  }
  $('people').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) showPerson(Number(b.dataset.id));
  });
  $('person-back').addEventListener('click', renderPeople);
  $('person-faces').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-face]');
    if (!b || !openPerson) return;
    const what = openPerson.ignored ? 'Un-ignore this face? It goes back to To do.' : 'Not ' + openPerson.name + '? Remove this tag.';
    if (!confirm(what)) return;
    const r = await api.post('faceReject', { faceId: Number(b.dataset.face), personId: openPerson.id });
    if (r.ok) { b.remove(); toast('Removed'); queue = await api.get('faceQueue'); showHelper(); }
  });
  $('person-rename').addEventListener('click', async () => {
    if (!openPerson) return;
    const name = prompt('New name', openPerson.name);
    if (!name || !name.trim()) return;
    const r = await api.post('renamePerson', { personId: openPerson.id, name: name.trim() });
    if (r.ok) { openPerson.name = name.trim(); $('person-name').textContent = openPerson.name; toast('Renamed'); }
  });

  $('btn-rescan').addEventListener('click', async () => {
    if (!confirm('Re-scan every photo and video? Your tags stay. The Mac Studio does the work.')) return;
    const r = await api.post('faceRescanAll', {});
    toast(r.ok ? 'Re-scan queued' : (r.error || 'Failed'));
  });
  $('btn-clear').addEventListener('click', async () => {
    if (!confirm('Delete every face fingerprint? Tags stay, but this cannot be undone and new photos won\'t auto-match.')) return;
    if (prompt('Type DELETE to confirm') !== 'DELETE') return;
    const r = await api.post('faceClearEmbeddings', {});
    toast(r.ok ? 'Fingerprints deleted' : (r.error || 'Failed'));
  });

  // ---------- Not tagged / All photos (scrub, see who's tagged, add/remove) ----------
  let utMode = 'untagged'; // 'untagged' | 'all'
  let ut = [];             // items in the grid
  let utIdx = -1;          // open item
  let utTags = [];         // [{id, name}] people on the open item
  let utFaces = [];        // face boxes on the open item
  let utReq = 0;           // guards against out-of-order loads when moving fast
  const tagCache = {};     // itemId -> {tags, faces}

  async function loadUntagged() {
    $('ut-hint').textContent = utMode === 'all'
      ? 'Every photo. Open one and use the arrows to move through them. Add or remove names as you go.'
      : 'Photos with no one tagged. Tap one to add names, or mark it as having no people.';
    const r = await api.post('untaggedItems', { all: utMode === 'all' });
    if (!r.ok) { toast(r.error || 'Could not load'); return; }
    ut = r.items;
    renderUntagged();
  }
  function renderUntagged() {
    if (utMode === 'untagged') $('untagged-count').textContent = ut.length ? '(' + ut.length + ')' : '';
    $('ut-empty').hidden = ut.length > 0 || utMode === 'all';
    $('ut-grid').innerHTML = ut.map((it, i) =>
      `<button type="button" data-i="${i}" class="fc-ut-tile">` +
      (it.thumb ? `<img src="${media(it.thumb)}" alt="" loading="lazy" />` : '<span>Video</span>') +
      (it.isVideo ? '<em>Video</em>' : '') + '</button>'
    ).join('');
  }
  $('ut-grid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) openUt(Number(b.dataset.i));
  });

  function tagsFrom(r) {
    const seen = new Set(), tags = [];
    (r.faces || []).forEach((f) => { if (f.personId && f.name && !seen.has(f.personId)) { seen.add(f.personId); tags.push({ id: f.personId, name: f.name }); } });
    (r.manual || []).forEach((m) => { if (!seen.has(m.id)) { seen.add(m.id); tags.push({ id: m.id, name: m.name }); } });
    return tags;
  }
  async function fetchTags(it) {
    const r = await api.post('itemTags', { itemId: it.id });
    if (!r.ok) return null;
    tagCache[it.id] = { tags: tagsFrom(r), faces: r.faces || [] };
    return tagCache[it.id];
  }
  function preload(i) {
    const it = ut[i];
    if (!it) return;
    new Image().src = media(it.photo);
    if (!tagCache[it.id]) fetchTags(it);
  }

  async function openUt(i) {
    if (i < 0 || i >= ut.length) return;
    utIdx = i;
    const it = ut[i];
    const req = ++utReq;
    $('ut-sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    $('ut-boxes').innerHTML = '';
    $('ut-img').src = media(it.photo);
    $('ut-pos').textContent = (i + 1) + ' of ' + ut.length;
    $('ut-prev').disabled = i === 0;
    $('ut-next').disabled = i === ut.length - 1;
    $('ut-nobody').hidden = utMode !== 'untagged';
    $('ut-done').textContent = 'Next photo';
    const cached = tagCache[it.id];
    utTags = cached ? cached.tags.slice() : [];
    utFaces = cached ? cached.faces : [];
    renderUtTags(); renderBoxes();
    renderUtNames($('ut-input').value);
    preload(i + 1); preload(i + 2);
    const fresh = await fetchTags(it);
    if (req !== utReq || !fresh) return;
    utTags = fresh.tags.slice(); utFaces = fresh.faces;
    renderUtTags(); renderBoxes();
  }
  function closeUt() {
    $('ut-sheet').hidden = true;
    document.body.style.overflow = '';
    utIdx = -1;
    if (utMode === 'untagged') { ut = ut.filter((it) => !it.done); renderUntagged(); }
  }
  function renderUtTags() {
    $('ut-tags').innerHTML = utTags.length ? utTags.map((t) =>
      `<li>${esc(t.name)}<button type="button" data-remove="${t.id}" aria-label="Remove ${esc(t.name)}">&times;</button></li>`
    ).join('') : '<li class="fc-ut-none">No one yet</li>';
  }
  // Outline faces on the photo: named ones get a label, unnamed ones a dashed box.
  function renderBoxes() {
    const named = new Set(utTags.map((t) => t.id));
    $('ut-boxes').innerHTML = utFaces.filter((f) => f.box).map((f) => {
      const [x, y, w, h] = f.box;
      const on = f.personId && named.has(f.personId);
      return `<div class="fc-ut-box${on ? '' : ' is-unknown'}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%">` +
        (on ? `<span>${esc(f.name)}</span>` : '') + '</div>';
    }).join('');
  }
  function utCandidates(q) {
    const needle = q.trim().toLowerCase();
    if (!queue || !needle) return [];
    const match = (n) => n.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle)) || n.toLowerCase().includes(needle);
    const have = new Set(utTags.map((t) => t.id));
    const people = queue.people.filter((p) => !p.ignored && !have.has(p.id) && match(p.name)).slice(0, 20)
      .map((p) => ({ kind: 'person', id: p.id, name: p.name, sub: p.photos + ' photo' + (p.photos === 1 ? '' : 's') }));
    const taken = new Set(queue.people.map((p) => p.guestId).filter(Boolean));
    const guests = queue.guests.filter((g) => !taken.has(g.id) && match(g.name)).slice(0, 30)
      .map((g) => ({ kind: 'guest', id: g.id, name: g.name, sub: 'guest' }));
    const out = people.concat(guests);
    const exact = queue.people.concat(queue.guests).some((x) => x.name.toLowerCase() === needle);
    if (!exact) out.push({ kind: 'new', name: q.trim() });
    return out;
  }
  function renderUtNames(q) {
    const list = utCandidates(q);
    $('ut-list').innerHTML = list.map((c, i) => c.kind === 'new'
      ? `<li class="fc-new"><button type="button" data-k="${i}" class="${i === 0 ? 'is-first' : ''}">+ Add &ldquo;${esc(c.name)}&rdquo; as a new name</button></li>`
      : `<li><button type="button" data-k="${i}" class="${i === 0 ? 'is-first' : ''}">${esc(c.name)}<small>${esc(c.sub)}</small></button></li>`
    ).join('');
  }
  async function addTag(c) {
    if (utIdx < 0 || !c) return;
    const it = ut[utIdx];
    const payload = { itemId: it.id };
    if (c.kind === 'person') payload.personId = c.id;
    else if (c.kind === 'guest') payload.guestId = c.id;
    else payload.name = c.name;
    $('ut-input').value = '';
    renderUtNames('');
    // Show it right away; roll back if the save fails.
    const temp = { id: -Date.now(), name: c.name };
    utTags.push(temp); renderUtTags();
    const r = await api.post('photoTagAdd', payload);
    if (!r.ok) { utTags = utTags.filter((t) => t !== temp); renderUtTags(); toast(r.error || 'Could not tag'); return; }
    temp.id = r.personId;
    it.done = true;
    tagCache[it.id] = { tags: utTags.slice(), faces: utFaces };
    renderUtTags(); renderBoxes();
    if (c.kind !== 'person') queue = await api.get('faceQueue'); // new person ids
  }
  $('ut-input').addEventListener('input', (e) => renderUtNames(e.target.value));
  $('ut-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(utCandidates($('ut-input').value)[0]); }
    else if (e.key === 'Escape') { if ($('ut-input').value) { $('ut-input').value = ''; renderUtNames(''); } else $('ut-input').blur(); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !$('ut-input').value) {
      e.preventDefault(); openUt(utIdx + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
  $('ut-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b) addTag(utCandidates($('ut-input').value)[Number(b.dataset.k)]);
  });
  $('ut-tags').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-remove]');
    if (!b || utIdx < 0) return;
    const it = ut[utIdx], pid = Number(b.dataset.remove);
    const before = utTags.slice();
    utTags = utTags.filter((t) => t.id !== pid);
    renderUtTags(); renderBoxes();
    const r = await api.post('photoTagRemove', { itemId: it.id, personId: pid });
    if (!r.ok) { utTags = before; renderUtTags(); renderBoxes(); toast(r.error || 'Could not remove'); return; }
    utFaces = utFaces.map((f) => (f.personId === pid ? { ...f, personId: null, name: '' } : f));
    it.done = utTags.length > 0;
    tagCache[it.id] = { tags: utTags.slice(), faces: utFaces };
    renderBoxes();
  });
  function nextUt() {
    const cur = ut[utIdx];
    if (utMode === 'untagged' && cur && cur.done) {
      ut.splice(utIdx, 1);
      renderUntagged();
      if (utIdx < ut.length) openUt(utIdx); else closeUt();
    } else if (utIdx + 1 < ut.length) openUt(utIdx + 1);
    else closeUt();
  }
  $('ut-done').addEventListener('click', nextUt);
  $('ut-next').addEventListener('click', () => openUt(utIdx + 1));
  $('ut-prev').addEventListener('click', () => openUt(utIdx - 1));
  $('ut-close').addEventListener('click', closeUt);
  $('ut-sheet').addEventListener('click', (e) => { if (e.target.id === 'ut-sheet') closeUt(); });
  $('ut-nobody').addEventListener('click', async () => {
    const it = ut[utIdx];
    if (!it) return;
    const r = await api.post('markNoPeople', { itemId: it.id });
    if (!r.ok) { toast(r.error || 'Failed'); return; }
    toast('Marked: no people');
    it.done = true;
    nextUt();
  });
  document.addEventListener('keydown', (e) => {
    if ($('ut-sheet').hidden || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); openUt(utIdx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); openUt(utIdx - 1); }
    else if (e.key === 'Escape') closeUt();
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) $('ut-input').focus(); // start typing a name anywhere
  });
  // Swipe left/right on the photo (phones).
  let sx = null;
  $('ut-img').parentNode.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $('ut-img').parentNode.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) openUt(utIdx + (dx < 0 ? 1 : -1));
  });

  // ---------- view switch ----------
  document.querySelectorAll('.fc-switch-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.fc-switch-btn').forEach((x) => x.classList.toggle('is-on', x === b));
    const view = b.dataset.view;
    $('view-todo').hidden = view !== 'todo';
    $('view-people').hidden = view !== 'people';
    $('view-untagged').hidden = view !== 'untagged' && view !== 'all';
    if (view === 'people' && queue) renderPeople();
    if (view === 'untagged' || view === 'all') { utMode = view; $('ut-grid').innerHTML = ''; loadUntagged(); }
  }));

  load();
  loadUntagged();
  setInterval(() => { if (!document.hidden && $('card').hidden) load(); }, 30000);
})();
