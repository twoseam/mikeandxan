/* Share the Day — pure media feed.
   - Instagram-style 4:5 tiles, cover-cropped. Where the browser has a
     FaceDetector (Chrome/Android) each photo's crop recenters on the
     first face found; elsewhere a 35%-from-top bias approximates faces.
   - Tap a tile → the photo/video animates open (FLIP: fixed clone flies
     from the tile to center) into a lightbox; videos get controls+play.
   - Uploads: files ≤95MB post raw to /upload. Bigger videos are sliced
     into 50MB chunks client-side and reassembled via R2 multipart
     (/upload-init → /upload-part×N → /upload-complete) — full quality,
     1GB cap. XHR per request for progress events.
   - Admin (mx_admin_session, same as admin.js): Hide/Delete overlay. */
(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';
  const SINGLE_MAX = 95 * 1024 * 1024;
  const CHUNK_SIZE = 50 * 1024 * 1024;
  const CHUNKED_MAX = 1024 * 1024 * 1024;
  const POLL_MS = 20000;

  const fileInput = document.getElementById('ph-file');
  const pickBtn = document.getElementById('ph-pick');
  const queueEl = document.getElementById('ph-queue');
  const feedEl = document.getElementById('ph-feed');
  const emptyEl = document.getElementById('ph-empty');
  const lightbox = document.getElementById('ph-lightbox');
  const lightboxContent = lightbox.querySelector('.ph-lb-content');

  const faceDetector = ('FaceDetector' in window)
    ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 })
    : null;

  function adminToken() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.token && s.expiresAt > Date.now()) return s.token;
    } catch (e) { /* ignore */ }
    return '';
  }

  // ── Uploading ──

  // iOS converts/exports a picked video BEFORE handing it to the page —
  // that gap looks like a freeze. Show "Preparing…" from the moment the
  // picker closes until the file actually arrives (change) or the picker
  // was dismissed (cancel, Safari 16.4+).
  let prepRow = null;
  let pickerOpen = false;

  let prepTimer = null;
  function showPreparing() {
    if (prepRow) return;
    // Safety: browsers without the input 'cancel' event would leave this
    // stuck after a dismissed picker — clear it after 3 minutes regardless.
    clearTimeout(prepTimer);
    prepTimer = setTimeout(clearPreparing, 3 * 60 * 1000);
    prepRow = document.createElement('div');
    prepRow.className = 'ph-q-item ph-q-prep';
    prepRow.innerHTML =
      '<div class="ph-q-name"><b>Getting it from your phone&hellip;</b><span class="ph-q-state"></span></div>' +
      '<div class="ph-q-bar ph-q-bar-wait"><i></i></div>';
    queueEl.hidden = false;
    queueEl.appendChild(prepRow);
  }
  function clearPreparing() {
    if (prepRow) { prepRow.remove(); prepRow = null; }
    if (!queueEl.children.length) queueEl.hidden = true;
  }

  pickBtn.addEventListener('click', () => {
    pickerOpen = true;
    fileInput.click();
  });

  window.addEventListener('focus', () => {
    if (!pickerOpen) return;
    pickerOpen = false;
    // If the file hasn't arrived shortly after the picker closed, iOS is
    // still exporting — reassure. Cleared by change/cancel below.
    setTimeout(() => { if (!fileInput.files.length) showPreparing(); }, 400);
  });

  fileInput.addEventListener('cancel', () => {
    pickerOpen = false;
    clearPreparing();
  });

  fileInput.addEventListener('change', () => {
    pickerOpen = false;
    clearPreparing();
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    files.forEach(uploadFile);
  });

  function queueRow(fileName) {
    queueEl.hidden = false;
    const row = document.createElement('div');
    row.className = 'ph-q-item';
    row.innerHTML =
      '<div class="ph-q-name"><b></b><span class="ph-q-state">0%</span></div>' +
      '<div class="ph-q-bar"><i></i></div>';
    row.querySelector('b').textContent = fileName;
    queueEl.appendChild(row);
    return {
      state: row.querySelector('.ph-q-state'),
      bar: row.querySelector('.ph-q-bar i'),
      done(msg) { row.classList.add('is-done'); this.state.textContent = msg; this.bar.style.width = '100%'; scheduleQueueClear(); },
      fail(msg) { row.classList.add('is-error'); this.state.textContent = msg; scheduleQueueClear(); }
    };
  }

  let clearTimer = null;
  function scheduleQueueClear() {
    if (queueEl.querySelector('.ph-q-item:not(.is-done):not(.is-error)')) return;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (!queueEl.querySelector('.ph-q-item:not(.is-done):not(.is-error)')) {
        queueEl.textContent = '';
        queueEl.hidden = true;
      }
    }, 3500);
  }

  function xhrSend(method, urlStr, body, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, urlStr);
      if (contentType) xhr.setRequestHeader('content-type', contentType);
      if (onProgress) xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
      xhr.addEventListener('load', () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status === 200 && res.ok) resolve(res);
          else reject(new Error(res.error || 'Upload failed'));
        } catch (e) { reject(new Error('Upload failed')); }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.send(body);
    });
  }

  async function uploadFile(file) {
    const row = queueRow(file.name);

    if (!/^(image|video)\//.test(file.type)) { row.fail('Not a photo or video'); return; }

    try {
      if (file.size <= SINGLE_MAX) {
        await xhrSend('POST', WORKER_URL + '/upload', file, file.type, (loaded, total) => {
          const pct = Math.round((loaded / total) * 100);
          row.state.textContent = pct + '%';
          row.bar.style.width = pct + '%';
        });
      } else if (file.type.startsWith('video/') && file.size <= CHUNKED_MAX) {
        await uploadChunked(file, row);
      } else {
        row.fail(file.type.startsWith('video/') ? 'Too big (1 GB max)' : 'Too big (95 MB max)');
        return;
      }
      row.done('Shared!');
      refreshFeed();
    } catch (err) {
      row.fail(err.message || 'Upload failed — try again');
    }
  }

  async function uploadChunked(file, row) {
    const init = await xhrSend('POST',
      WORKER_URL + '/upload-init?' + new URLSearchParams({ type: file.type, size: String(file.size) }));

    const totalParts = Math.ceil(file.size / CHUNK_SIZE);
    const parts = [];
    for (let i = 0; i < totalParts; i++) {
      const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
      const res = await xhrSend('POST',
        WORKER_URL + '/upload-part?' + new URLSearchParams({
          key: init.key, uploadId: init.uploadId, part: String(i + 1)
        }),
        chunk, 'application/octet-stream',
        (loaded) => {
          const pct = Math.round(((i * CHUNK_SIZE + loaded) / file.size) * 100);
          row.state.textContent = Math.min(pct, 99) + '%';
          row.bar.style.width = Math.min(pct, 99) + '%';
        });
      parts.push({ partNumber: res.partNumber, etag: res.etag });
    }

    await xhrSend('POST', WORKER_URL + '/upload-complete',
      JSON.stringify({ key: init.key, uploadId: init.uploadId, type: file.type, parts }),
      'application/json');
  }

  // ── Feed tiles ──

  let renderedIds = new Set();

  async function focusOnFace(img) {
    if (!faceDetector) return;
    try {
      const faces = await faceDetector.detect(img);
      if (!faces.length) return;
      const box = faces[0].boundingBox;
      const cx = ((box.x + box.width / 2) / img.naturalWidth) * 100;
      const cy = ((box.y + box.height / 2) / img.naturalHeight) * 100;
      img.style.objectPosition = Math.round(cx) + '% ' + Math.round(cy) + '%';
    } catch (e) { /* keep the default bias */ }
  }

  function tileHtml(item, isAdmin) {
    const el = document.createElement('figure');
    el.className = 'ph-item' + (item.hidden ? ' is-hidden' : '');
    el.dataset.id = item.id;

    const src = WORKER_URL + item.mediaPath;
    const isVideo = item.contentType.startsWith('video/');
    let media;
    if (isVideo) {
      media = document.createElement('video');
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.src = src;
      const badge = document.createElement('div');
      badge.className = 'ph-play';
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
      el.appendChild(badge);
    } else {
      media = document.createElement('img');
      media.loading = 'lazy';
      media.alt = 'Guest photo';
      media.src = src;
      if (media.complete && media.naturalWidth) focusOnFace(media);
      else media.addEventListener('load', () => focusOnFace(media));
    }
    el.insertBefore(media, el.firstChild);

    el.addEventListener('click', (e) => {
      if (e.target.closest('.ph-item-meta')) return; // admin buttons
      openLightbox(el, src, isVideo);
    });

    if (isAdmin) {
      const meta = document.createElement('figcaption');
      meta.className = 'ph-item-meta';

      const hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.className = 'ph-hide-btn';
      hideBtn.textContent = item.hidden ? 'Unhide' : 'Hide';
      hideBtn.addEventListener('click', () => setHidden(item.id, !item.hidden));
      meta.appendChild(hideBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ph-del-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        if (confirm('Permanently delete this from the feed? This can’t be undone.')) {
          deleteItem(item.id);
        }
      });
      meta.appendChild(delBtn);

      el.appendChild(meta);
    }
    return el;
  }

  async function setHidden(id, hidden) {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'adminSetFeedHidden', token: adminToken(), payload: { id, hidden } })
    });
    renderedIds = new Set();
    refreshFeed();
  }

  async function deleteItem(id) {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'adminDeleteFeedItem', token: adminToken(), payload: { id } })
    });
    renderedIds = new Set();
    refreshFeed();
  }

  async function refreshFeed() {
    const token = adminToken();
    let data;
    try {
      const res = await fetch(WORKER_URL + '/?action=feed' + (token ? '&token=' + encodeURIComponent(token) : ''));
      data = await res.json();
    } catch (e) { return; }
    const items = data.items || [];

    emptyEl.hidden = items.length > 0;

    const knownAll = items.every(i => renderedIds.has(i.id));
    if (knownAll && renderedIds.size === items.length) return;

    feedEl.textContent = '';
    renderedIds = new Set();
    const isAdmin = !!token;
    items.forEach(item => {
      feedEl.appendChild(tileHtml(item, isAdmin));
      renderedIds.add(item.id);
    });
  }

  // ── Lightbox with FLIP open animation ──

  function openLightbox(tile, src, isVideo) {
    const rect = tile.getBoundingClientRect();

    lightboxContent.textContent = '';
    let media;
    if (isVideo) {
      media = document.createElement('video');
      media.controls = true;
      media.playsInline = true;
      media.autoplay = true;
      media.src = src;
    } else {
      media = document.createElement('img');
      media.src = src;
      media.alt = 'Guest photo';
    }
    lightboxContent.appendChild(media);
    lightbox.classList.add('is-opening');
    lightbox.hidden = false;

    // FLIP: measure the media's final box, then fly a cover-cropped clone
    // from the tile's rect to it.
    requestAnimationFrame(() => {
      const end = media.getBoundingClientRect();
      if (!end.width || !end.height) { lightbox.classList.remove('is-opening'); return; }

      const clone = document.createElement(isVideo ? 'video' : 'img');
      clone.src = src;
      if (isVideo) { clone.muted = true; clone.playsInline = true; }
      Object.assign(clone.style, {
        position: 'fixed',
        left: end.left + 'px',
        top: end.top + 'px',
        width: end.width + 'px',
        height: end.height + 'px',
        objectFit: 'cover',
        borderRadius: '8px',
        zIndex: 70,
        transformOrigin: 'top left',
        pointerEvents: 'none'
      });
      document.body.appendChild(clone);

      media.style.opacity = '0';
      const dx = rect.left - end.left;
      const dy = rect.top - end.top;
      const sx = rect.width / end.width;
      const sy = rect.height / end.height;

      lightbox.classList.remove('is-opening'); // background fades in
      clone.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transform: 'translate(0, 0) scale(1, 1)' }
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      ).finished.finally(() => {
        media.style.opacity = '';
        clone.remove();
      });
    });
  }

  function closeLightbox() {
    lightboxContent.textContent = ''; // drops any playing video
    lightbox.hidden = true;
  }
  lightbox.addEventListener('click', (e) => {
    if (e.target.tagName !== 'VIDEO') closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeLightbox();
    }
  }, true);

  refreshFeed();
  setInterval(refreshFeed, POLL_MS);
})();
