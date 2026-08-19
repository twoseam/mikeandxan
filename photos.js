/* Share the Day — uploads (XHR for progress) + live feed (20s poll).
   Public page: no login. If an admin session token is present
   (mx_admin_session, same as admin.js), hidden items show too, with
   Hide/Unhide moderation buttons. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const MAX_BYTES = 95 * 1024 * 1024;
  const POLL_MS = 20000;

  const captionInput = document.getElementById('ph-caption');
  const fileInput = document.getElementById('ph-file');
  const pickBtn = document.getElementById('ph-pick');
  const queueEl = document.getElementById('ph-queue');
  const feedEl = document.getElementById('ph-feed');
  const feedStatus = document.getElementById('ph-feed-status');
  const lightbox = document.getElementById('ph-lightbox');
  const lightboxContent = lightbox.querySelector('.ph-lb-content');

  function adminToken() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.token && s.expiresAt > Date.now()) return s.token;
    } catch (e) { /* ignore */ }
    return '';
  }

  // ── Uploading ──

  pickBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    files.forEach(uploadFile);
  });

  function uploadFile(file) {
    const row = document.createElement('div');
    row.className = 'ph-q-item';
    row.innerHTML =
      '<div class="ph-q-name"><b></b><span class="ph-q-state">0%</span></div>' +
      '<div class="ph-q-bar"><i></i></div>';
    row.querySelector('b').textContent = file.name;
    queueEl.appendChild(row);
    const stateEl = row.querySelector('.ph-q-state');
    const barEl = row.querySelector('.ph-q-bar i');

    if (!/^(image|video)\//.test(file.type)) {
      row.classList.add('is-error');
      stateEl.textContent = 'Not a photo or video';
      return;
    }
    if (file.size > MAX_BYTES) {
      row.classList.add('is-error');
      stateEl.textContent = 'Too big (95 MB max)';
      return;
    }

    const params = new URLSearchParams({
      caption: captionInput.value.trim()
    });

    const xhr = new XMLHttpRequest();
    xhr.open('POST', WORKER_URL + '/upload?' + params.toString());
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      stateEl.textContent = pct + '%';
      barEl.style.width = pct + '%';
    });
    xhr.addEventListener('load', () => {
      let ok = false, err = '';
      try {
        const res = JSON.parse(xhr.responseText);
        ok = xhr.status === 200 && res.ok;
        err = res.error || '';
      } catch (e) { /* fall through */ }
      if (ok) {
        row.classList.add('is-done');
        stateEl.textContent = 'Shared!';
        barEl.style.width = '100%';
        refreshFeed();
      } else {
        row.classList.add('is-error');
        stateEl.textContent = err || 'Upload failed — try again';
      }
    });
    xhr.addEventListener('error', () => {
      row.classList.add('is-error');
      stateEl.textContent = 'Upload failed — try again';
    });
    xhr.send(file);
  }

  // ── Feed ──

  let renderedIds = new Set();

  function itemHtml(item, isAdmin) {
    const el = document.createElement('figure');
    el.className = 'ph-item' + (item.hidden ? ' is-hidden' : '');
    el.dataset.id = item.id;

    const src = WORKER_URL + item.mediaPath;
    let media;
    if (item.contentType.startsWith('video/')) {
      media = document.createElement('video');
      media.controls = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.src = src;
    } else {
      media = document.createElement('img');
      media.loading = 'lazy';
      media.alt = item.caption || 'Guest photo';
      media.src = src;
      media.addEventListener('click', () => openLightbox(src, media.alt));
    }
    el.appendChild(media);

    const meta = document.createElement('figcaption');
    meta.className = 'ph-item-meta';
    if (item.senderName) {
      const who = document.createElement('b');
      who.textContent = item.senderName;
      meta.appendChild(who);
    }
    if (item.caption) {
      const cap = document.createElement('div');
      cap.className = 'ph-cap';
      cap.textContent = item.caption;
      meta.appendChild(cap);
    }
    const when = document.createElement('div');
    when.className = 'ph-when';
    when.textContent = new Date(item.createdAt).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    meta.appendChild(when);

    if (isAdmin) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ph-hide-btn';
      btn.textContent = item.hidden ? 'Unhide' : 'Hide';
      btn.addEventListener('click', () => setHidden(item.id, !item.hidden));
      meta.appendChild(btn);
    }

    el.appendChild(meta);
    return el;
  }

  async function setHidden(id, hidden) {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'adminSetFeedHidden', token: adminToken(), payload: { id, hidden } })
    });
    renderedIds = new Set(); // force full re-render
    refreshFeed();
  }

  async function refreshFeed() {
    const token = adminToken();
    let data;
    try {
      const res = await fetch(WORKER_URL + '/?action=feed' + (token ? '&token=' + encodeURIComponent(token) : ''));
      data = await res.json();
    } catch (e) {
      feedStatus.textContent = 'Couldn’t load the feed — retrying…';
      return;
    }
    const items = data.items || [];

    feedStatus.textContent = items.length
      ? items.length + (items.length === 1 ? ' memory shared so far' : ' memories shared so far')
      : 'Nothing here yet — be the first!';

    const isAdmin = !!token;
    const knownAll = items.every(i => renderedIds.has(i.id));
    if (knownAll && renderedIds.size === items.length) return;

    feedEl.textContent = '';
    renderedIds = new Set();
    items.forEach(item => {
      feedEl.appendChild(itemHtml(item, isAdmin));
      renderedIds.add(item.id);
    });
  }

  // ── Lightbox ──

  function openLightbox(src, alt) {
    lightboxContent.textContent = '';
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    lightboxContent.appendChild(img);
    lightbox.hidden = false;
  }
  lightbox.addEventListener('click', () => { lightbox.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      lightbox.hidden = true;
    }
  }, true);

  refreshFeed();
  setInterval(refreshFeed, POLL_MS);
})();
