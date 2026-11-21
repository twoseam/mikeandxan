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
  const NAME_KEY = 'mx_uploader_name';

  // Ask a guest their name once (branded pop-up, first upload), then
  // remember it on this phone so they're never asked again. Admins see it
  // on each tile.
  function uploaderName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function askName() {
    if (uploaderName()) return Promise.resolve();
    const modal = document.getElementById('ph-name');
    const form = document.getElementById('ph-name-form');
    const input = document.getElementById('ph-name-input');
    const skip = document.getElementById('ph-name-skip');
    return new Promise((resolve) => {
      function close(save) {
        const name = save ? input.value.trim().slice(0, 80) : '';
        if (name) { try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* ignore */ } }
        modal.hidden = true;
        form.removeEventListener('submit', onSubmit);
        skip.removeEventListener('click', onSkip);
        resolve();
      }
      function onSubmit(e) { e.preventDefault(); close(true); }
      function onSkip() { close(false); }
      form.addEventListener('submit', onSubmit);
      skip.addEventListener('click', onSkip);
      modal.hidden = false;
      setTimeout(() => input.focus(), 50);
    });
  }

  const fileInput = document.getElementById('ph-file');
  const pickBtn = document.getElementById('ph-pick');
  const queueEl = document.getElementById('ph-queue');
  const feedEl = document.getElementById('ph-feed');
  const emptyEl = document.getElementById('ph-empty');
  const lightbox = document.getElementById('ph-lightbox');
  const pager = document.getElementById('ph-pager');

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
    if (prepRow || (batch && !batch.finished)) return;
    // Safety: browsers without the input 'cancel' event would leave this
    // stuck after a dismissed picker — clear it after 3 minutes regardless.
    clearTimeout(prepTimer);
    prepTimer = setTimeout(clearPreparing, 3 * 60 * 1000);
    if (batch && batch.finished) { queueEl.textContent = ''; batch = null; }
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
    // Logged in as Michael → ask which album (Nov 21: his Fuji batch went
    // through this button and landed in Guest Photos).
    if (adminToken()) { document.getElementById('ph-pro-btn').click(); return; }
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

  fileInput.addEventListener('change', async () => {
    pickerOpen = false;
    clearPreparing();
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (files.length) await askName();
    files.forEach((f) => queueUpload(f));
  });

  // Send a few files at a time. Firing hundreds at once (Michael, Nov 21:
  // a big Fuji batch) jammed the browser and nothing finished.
  const UPLOAD_AT_ONCE = 3;
  // Leaving the page mid-upload silently drops the rest (Michael, Nov 21:
  // 18 picked, 6 arrived) — ask first.
  window.addEventListener('beforeunload', (e) => {
    if (active || waiting.length) { e.preventDefault(); e.returnValue = ''; }
  });
  const waiting = [];
  let active = 0;
  function queueUpload(file, opts) {
    waiting.push([file, opts, queueRow(file)]);  // counts in the bar right away
    pump();
  }
  function pump() {
    while (active < UPLOAD_AT_ONCE && waiting.length) {
      const [file, opts, row] = waiting.shift();
      active++;
      Promise.resolve(uploadFile(file, opts, row)).catch(() => {}).finally(() => { active--; pump(); });
    }
  }

  // One combined bar for everything being shared (Michael, Nov 5: a row
  // per file was too busy). Files picked while a batch is still going join
  // it; the bar is weighted by file size so one big video doesn't look
  // finished early. When all are done the row says "All shared!" (or how
  // many didn't make it, with the first reason) and clears itself.
  let batch = null;
  function ensureBatch() {
    if (batch && !batch.finished) return batch;
    queueEl.textContent = '';
    const el = document.createElement('div');
    el.className = 'ph-q-item';
    el.innerHTML =
      '<div class="ph-q-name"><b></b><span class="ph-q-state"></span></div>' +
      '<div class="ph-q-bar"><i></i></div>';
    queueEl.appendChild(el);
    queueEl.hidden = false;
    batch = { items: [], el, label: el.querySelector('b'), state: el.querySelector('.ph-q-state'), bar: el.querySelector('.ph-q-bar i'), finished: false };
    return batch;
  }
  function renderBatch(b) {
    const total = b.items.length;
    const done = b.items.filter(i => i.status === 'done').length;
    const failed = b.items.filter(i => i.status === 'fail');
    const bytes = b.items.reduce((n, i) => n + i.size, 0) || 1;
    const sent = b.items.reduce((n, i) => n + i.size * (i.status === 'active' ? i.frac : 1), 0);
    const pct = Math.round((sent / bytes) * 100);
    const active = total - done - failed.length;
    if (active) {
      b.label.textContent = total === 1 ? 'Sharing\u2026' : 'Sharing ' + total + ' photos & videos\u2026';
      b.state.textContent = total === 1 ? Math.min(pct, 99) + '%' : done + ' of ' + total;
      b.bar.style.width = Math.min(pct, 99) + '%';
      return;
    }
    b.finished = true;
    b.bar.style.width = '100%';
    if (!failed.length) {
      b.el.classList.add('is-done');
      b.label.textContent = total === 1 ? 'Your upload' : 'All ' + total + ' uploads';
      b.state.textContent = 'Shared!';
    } else {
      b.el.classList.add('is-error');
      b.label.textContent = done ? done + ' of ' + total + ' shared' : (total === 1 ? 'Didn\u2019t upload' : 'None uploaded');
      b.state.textContent = failed[0].msg + (failed.length > 1 ? ' (+' + (failed.length - 1) + ' more)' : '');
    }
    scheduleQueueClear();
  }
  function queueRow(file) {
    const b = ensureBatch();
    const item = { size: Math.max(file.size || 0, 1), frac: 0, status: 'active', msg: '' };
    b.items.push(item);
    renderBatch(b);
    return {
      progress(pct) { item.frac = Math.min(pct, 99) / 100; renderBatch(b); },
      done() { item.status = 'done'; renderBatch(b); },
      fail(msg) { item.status = 'fail'; item.msg = msg; renderBatch(b); }
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

  async function uploadFile(file, opts, existingRow) {
    const albumId = opts && opts.album;
    const row = existingRow || queueRow(file);

    if (!/^(image|video)\//.test(file.type)) { row.fail('Not a photo or video'); return; }

    try {
      // For videos, build tile assets locally while the upload runs:
      // a poster frame + a ~2.5s muted low-res looping preview clip.
      const assetsPromise = file.type.startsWith('video/') ? makeVideoAssets(file) : makePhotoThumb(file);

      let key = null;
      if (file.size <= SINGLE_MAX) {
        const params = albumId
          ? { name: (opts.albumName || 'Michael'), album: String(albumId), token: adminToken() }
          : { name: uploaderName() };
        const res = await xhrSend('POST', WORKER_URL + '/upload?' + new URLSearchParams(params), file, file.type, (loaded, total) => {
          row.progress(Math.round((loaded / total) * 100));
        });
        key = res.key || null;
      } else if (file.type.startsWith('video/') && file.size <= CHUNKED_MAX) {
        key = await uploadChunked(file, row, opts);
      } else {
        row.fail(file.type.startsWith('video/') ? 'Too big (1 GB max)' : 'Too big (95 MB max)');
        return;
      }
      // The video itself is in — say so now. The poster frame + preview
      // clip follow in the background (they used to hold the row at 100%,
      // which looked stuck — Michael, Nov 5).
      row.done();
      refreshFeed();
      if (assetsPromise && key) {
        (async () => {
          try {
            const assets = await assetsPromise;
            if (assets && assets.thumb) {
              await xhrSend('POST', WORKER_URL + '/upload-thumb?' + new URLSearchParams({ key }), assets.thumb, 'image/jpeg');
            }
            if (assets && assets.preview) {
              await xhrSend('POST', WORKER_URL + '/upload-preview?' + new URLSearchParams({ key }), assets.preview, assets.previewType);
            }
            refreshFeed();
          } catch (e) { /* no tile assets — falls back to the video element */ }
        })();
      }
    } catch (err) {
      row.fail(err.message || 'Upload failed — try again');
    }
  }

  // Small tile image for a photo (800px JPEG, phone rotation applied) so the
  // gallery doesn't download every full-size photo. Null if the browser
  // can't decode it — the Mac Studio scanner fills those in later.
  async function makePhotoThumb(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const s = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * s);
      canvas.height = Math.round(bmp.height * s);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close && bmp.close();
      const thumb = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
      return thumb ? { thumb, preview: null } : null;
    } catch (e) { return null; }
  }

  async function uploadChunked(file, row, opts) {
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
          row.progress(Math.round(((i * CHUNK_SIZE + loaded) / file.size) * 100));
        });
      parts.push({ partNumber: res.partNumber, etag: res.etag });
    }

    await xhrSend('POST', WORKER_URL + '/upload-complete',
      JSON.stringify(Object.assign(
        { key: init.key, uploadId: init.uploadId, type: file.type, parts, name: uploaderName() },
        opts && opts.album ? { album: opts.album, token: adminToken(), name: opts.albumName || 'Michael' } : {}
      )),
      'application/json');
    return init.key;
  }

  // One local decode pass over an uploaded video: seek ~1s in and paint a
  // poster frame, then play ~2.5s through a downscaled canvas recorded by
  // MediaRecorder into a tiny muted preview clip (mp4 on Safari, webm on
  // Chrome). Resolves {thumb, preview, previewType} — any piece may be
  // null if this browser can't decode/record the format.
  function makeVideoAssets(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      // iPhone Safari won't load a video that isn't on the page and hasn't
      // been asked to play — every iPhone upload was ending up with no
      // poster or loop (Nov 5). Park it off-screen and nudge it.
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(video);
      video.src = url;
      video.load();
      let loaded = false;
      video.addEventListener('loadeddata', () => { loaded = true; }, { once: true });
      const kick = setTimeout(() => {
        if (!loaded) video.play().then(() => video.pause()).catch(() => {});
      }, 1200);
      let thumb = null;
      const bail = setTimeout(() => cleanup({ thumb, preview: null }), 30000);
      let finished = false;
      function cleanup(result) {
        if (finished) return;
        finished = true;
        clearTimeout(bail); clearTimeout(kick);
        try { video.pause(); } catch (e) {}
        video.remove();
        URL.revokeObjectURL(url);
        resolve(result);
      }

      video.addEventListener('error', () => cleanup(null), { once: true });
      video.addEventListener('loadeddata', () => {
        try { video.currentTime = Math.min(1, (video.duration || 1) / 2); }
        catch (e) { cleanup(null); }
      }, { once: true });

      video.addEventListener('seeked', () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) { cleanup(null); return; }
        const scale = Math.min(1, 720 / w);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => { thumb = blob; recordPreview(); }, 'image/jpeg', 0.82);
      }, { once: true });

      function recordPreview() {
        let mime = '';
        if (window.MediaRecorder) {
          for (const m of ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']) {
            if (MediaRecorder.isTypeSupported(m)) { mime = m; break; }
          }
        }
        if (!mime || !HTMLCanvasElement.prototype.captureStream) { cleanup({ thumb, preview: null }); return; }

        const w = video.videoWidth, h = video.videoHeight;
        const scale = Math.min(1, 480 / w);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');

        let rec;
        try { rec = new MediaRecorder(canvas.captureStream(24), { mimeType: mime, videoBitsPerSecond: 1200000 }); }
        catch (e) { cleanup({ thumb, preview: null }); return; }

        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          const type = mime.split(';')[0];
          const blob = new Blob(chunks, { type });
          cleanup({ thumb, preview: blob.size > 1000 ? blob : null, previewType: type });
        };

        let raf;
        const draw = () => { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); raf = requestAnimationFrame(draw); };
        video.play().then(() => {
          rec.start(500);
          draw();
          setTimeout(() => {
            cancelAnimationFrame(raf);
            video.pause();
            try { rec.stop(); } catch (e) { cleanup({ thumb, preview: null }); }
          }, 2600);
        }).catch(() => cleanup({ thumb, preview: null }));
      }
    });
  }

  // ── Feed tiles ──

  let renderedIds = new Set();
  let feedItems = []; // latest feed order, drives the swipe viewer

  // Looping tile previews only play while on screen.
  const previewObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const v = en.target;
      if (en.isIntersecting) v.play().catch(() => {});
      else v.pause();
    });
  }, { threshold: 0.15 });

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
    if (isVideo && item.previewPath) {
      // Tiny recorded loop — the "living" tile. Poster shows while it loads;
      // if this browser can't play the clip's format, fall back to the poster.
      media = document.createElement('video');
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.preload = 'metadata';
      if (item.thumbPath) media.poster = WORKER_URL + item.thumbPath;
      media.src = WORKER_URL + item.previewPath;
      media.addEventListener('error', () => {
        previewObserver.unobserve(media);
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = 'Guest video';
        if (item.thumbPath) img.src = WORKER_URL + item.thumbPath;
        media.replaceWith(img);
      }, { once: true });
      previewObserver.observe(media);
      const badge = document.createElement('div');
      badge.className = 'ph-play';
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
      el.appendChild(badge);
    } else if (isVideo && item.thumbPath) {
      // Poster frame captured at upload — tile is a plain image, cheap to load.
      media = document.createElement('img');
      media.loading = 'lazy';
      media.alt = 'Guest video';
      media.src = WORKER_URL + item.thumbPath;
      if (media.complete && media.naturalWidth) focusOnFace(media);
      else media.addEventListener('load', () => focusOnFace(media));
      const badge = document.createElement('div');
      badge.className = 'ph-play';
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
      el.appendChild(badge);
    } else if (isVideo) {
      // No poster (older upload / undecodable at upload time): show the
      // video element and nudge it to paint a frame.
      media = document.createElement('video');
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.src = src;
      media.addEventListener('loadedmetadata', () => {
        try { media.currentTime = 0.1; } catch (e) { /* frame stays blank */ }
      }, { once: true });
      const badge = document.createElement('div');
      badge.className = 'ph-play';
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
      el.appendChild(badge);
    } else {
      media = document.createElement('img');
      media.loading = 'lazy';
      media.decoding = 'async';
      media.alt = 'Guest photo';
      // Small tile image when there is one (fast); full photo otherwise.
      media.src = item.thumbPath ? WORKER_URL + item.thumbPath : src;
      if (item.thumbPath) media.addEventListener('error', () => { media.src = src; }, { once: true });
      if (media.complete && media.naturalWidth) focusOnFace(media);
      else media.addEventListener('load', () => focusOnFace(media));
    }
    el.insertBefore(media, el.firstChild);

    el.addEventListener('click', (e) => {
      if (e.target.closest('.ph-item-meta')) return; // admin buttons
      openViewer(item.id, el);
    });

    if (isAdmin) {
      const meta = document.createElement('figcaption');
      meta.className = 'ph-item-meta';

      const who = document.createElement('span');
      who.className = 'ph-who';
      who.textContent = item.senderName || 'Unknown';
      meta.appendChild(who);

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

      if (allAlbums.length > 1) {
        const albumSel = document.createElement('select');
        albumSel.className = 'ph-album-sel';
        albumSel.setAttribute('aria-label', 'Album');
        albumSel.innerHTML = allAlbums.map((a) =>
          `<option value="${a.id}"${a.id === item.albumId ? ' selected' : ''}>${escHtml(a.name)}</option>`).join('');
        albumSel.addEventListener('click', (e) => e.stopPropagation());
        albumSel.addEventListener('change', () => moveToAlbum(item.id, Number(albumSel.value)));
        meta.appendChild(albumSel);
      }

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
    allItems = data.items || [];
    allPeople = data.people || [];
    isAdminView = !!token;
    renderAlbums(data.albums || []);
    renderFeed();
  }

  // ── Filters: album + who's in it ──

  let allItems = [];
  let allPeople = [];
  let allAlbums = [];
  let isAdminView = false;
  const filter = { album: 'all', person: null };
  let lastSignature = '';
  let albumSig = '';

  // Album buttons: All + every album that has something in it (admins see
  // empty ones too, so there's somewhere to upload into).
  function renderAlbums(albums) {
    allAlbums = albums;
    const counts = {};
    allItems.forEach((i) => { counts[i.albumId] = (counts[i.albumId] || 0) + 1; });
    const shown = albums;  // always show every album as a filter (Michael, Nov 21)
    const sig = shown.map((a) => a.id + ':' + a.name).join('|');
    if (sig === albumSig) return;
    albumSig = sig;
    const wrap = document.getElementById('ph-albums');
    wrap.innerHTML = '<button type="button" class="ph-seg-btn" data-album="all">All</button>' +
      shown.map((a) => `<button type="button" class="ph-seg-btn" data-album="${a.id}">${escHtml(a.name)}</button>`).join('');
    if (filter.album !== 'all' && !shown.some((a) => a.id === filter.album)) filter.album = 'all';
    wrap.querySelectorAll('.ph-seg-btn').forEach((b) => b.classList.toggle('is-on', String(filter.album) === b.dataset.album));
    wrap.querySelectorAll('.ph-seg-btn[data-album]').forEach((b) => {
      const n = b.dataset.album === 'all' ? allItems.length : (counts[Number(b.dataset.album)] || 0);
      b.dataset.count = n;
    });
  }

  function filteredItems() {
    return allItems.filter((i) => {
      if (filter.album !== 'all' && i.albumId !== filter.album) return false;
      if (filter.person && !(i.people || []).includes(filter.person.id)) return false;
      return true;
    });
  }

  function renderFeed(force) {
    const items = filteredItems();
    feedItems = items;

    const filtered = filter.album !== 'all' || filter.person;
    document.getElementById('ph-who-count').textContent = filter.person ? '(' + items.length + ')' : '';
    emptyEl.textContent = filtered ? 'No photos here yet.' : 'Nothing here yet — be the first!';
    emptyEl.hidden = items.length > 0;

    // Name picker only once people are tagged.
    document.getElementById('ph-pro-btn').hidden = !isAdminView;

    const sig = isAdminView + '|' + items.map(i => i.id + (i.hidden ? 'h' : '')).join(',');
    if (!force && sig === lastSignature) return;
    lastSignature = sig;

    feedEl.textContent = '';
    renderedIds = new Set();
    feedEl.classList.toggle('is-admin', isAdminView);
    items.forEach(item => {
      const tile = tileHtml(item, isAdminView);
      if (selected.has(item.id)) tile.classList.add('is-selected');
      feedEl.appendChild(tile);
      renderedIds.add(item.id);
    });
  }

  document.getElementById('ph-albums').addEventListener('click', (e) => {
    const b = e.target.closest('.ph-seg-btn');
    if (!b) return;
    document.querySelectorAll('#ph-albums .ph-seg-btn').forEach((x) => x.classList.toggle('is-on', x === b));
    filter.album = b.dataset.album === 'all' ? 'all' : Number(b.dataset.album);
    renderFeed();
    window.scrollTo({ top: 0 });
  });

  // Person search bar: type a name, pick from the list, photos filter.
  const searchEl = document.getElementById('ph-search');
  const searchList = document.getElementById('ph-search-list');
  let searchIdx = -1;
  function searchMatches() {
    const q = searchEl.value.trim().toLowerCase();
    return allPeople.filter((p) => !q || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().includes(q)).slice(0, 8);
  }
  function renderSearch() {
    const list = searchMatches();
    searchIdx = Math.min(searchIdx, list.length - 1);
    searchList.innerHTML = list.length
      ? list.map((p, i) => `<li role="option"><button type="button" data-id="${p.id}" class="${i === searchIdx ? 'is-active' : ''}"><span>${escHtml(p.name)}</span><small>${p.photos} photo${p.photos === 1 ? '' : 's'}</small></button></li>`).join('')
      : `<li class="ph-search-none">${allPeople.length ? 'No one by that name yet.' : 'No one is tagged yet.'}</li>`;
    searchList.hidden = false;
  }
  function choosePerson(p) {
    filter.person = p;
    searchEl.value = p.name;
    searchList.hidden = true;
    document.getElementById('ph-who-name').textContent = p.name.split(' ')[0];
    document.getElementById('ph-who-on').hidden = false;
    searchEl.blur();
    renderFeed();
    window.scrollTo({ top: 0 });
  }
  function clearPerson() {
    filter.person = null;
    searchEl.value = '';
    document.getElementById('ph-who-on').hidden = true;
    renderFeed();
  }
  searchEl.addEventListener('focus', () => { searchIdx = -1; renderSearch(); });
  searchEl.addEventListener('input', () => {
    searchIdx = -1;
    if (!searchEl.value && filter.person) clearPerson();
    renderSearch();
  });
  searchEl.addEventListener('keydown', (e) => {
    const list = searchMatches();
    if (e.key === 'ArrowDown') { searchIdx = Math.min(searchIdx + 1, list.length - 1); renderSearch(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { searchIdx = Math.max(searchIdx - 1, 0); renderSearch(); e.preventDefault(); }
    else if (e.key === 'Enter') { const p = list[Math.max(searchIdx, 0)]; if (p) choosePerson(p); e.preventDefault(); }
    else if (e.key === 'Escape') { searchList.hidden = true; searchEl.blur(); }
  });
  searchEl.addEventListener('blur', () => setTimeout(() => { searchList.hidden = true; }, 150));
  searchList.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus while clicking
  searchList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    const p = b && allPeople.find((x) => x.id === Number(b.dataset.id));
    if (p) choosePerson(p);
  });

  // Name picker
  const peopleSheet = document.getElementById('ph-people');
  const peopleInput = document.getElementById('ph-people-input');
  const peopleList = document.getElementById('ph-people-list');
  const escHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderPeopleList() {
    const q = peopleInput.value.trim().toLowerCase();
    const list = allPeople.filter((p) => !q || p.name.toLowerCase().includes(q));
    peopleList.innerHTML = list.length
      ? list.map((p) => `<li><button type="button" data-id="${p.id}"><span>${escHtml(p.name)}</span><small>${p.photos}</small></button></li>`).join('')
      : '<li class="ph-people-none">No one by that name yet.</li>';
  }
  (document.getElementById('ph-who-btn') || document.createElement('i')).addEventListener('click', () => {
    peopleInput.value = '';
    renderPeopleList();
    peopleSheet.hidden = false;
    setTimeout(() => peopleInput.focus(), 50);
  });
  peopleInput.addEventListener('input', renderPeopleList);
  document.getElementById('ph-people-close').addEventListener('click', () => { peopleSheet.hidden = true; });
  peopleList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const p = allPeople.find((x) => x.id === Number(b.dataset.id));
    if (!p) return;
    filter.person = p;
    document.getElementById('ph-who-name').textContent = p.name.split(' ')[0];
    document.getElementById('ph-who-on').hidden = false;
    peopleSheet.hidden = true;
    renderFeed();
    window.scrollTo({ top: 0 });
  });
  document.getElementById('ph-who-clear').addEventListener('click', clearPerson);

  // ── Select & download ──

  const selected = new Set();
  let selecting = false;
  const selBar = document.getElementById('ph-selbar');
  const selGo = document.getElementById('ph-sel-go');
  const selectBtn = document.getElementById('ph-select-btn');

  function updateSelBar() {
    selGo.disabled = !selected.size;
    selGo.textContent = selected.size ? 'Download ' + selected.size : 'Download';
    const allOn = feedItems.length && feedItems.every((i) => selected.has(i.id));
    document.getElementById('ph-sel-all').textContent = allOn ? 'Select none' : 'Select all';
  }
  function setSelecting(on) {
    selecting = on;
    if (!on) selected.clear();
    feedEl.classList.toggle('is-selecting', on);
    feedEl.querySelectorAll('.ph-item.is-selected').forEach((t) => { if (!on) t.classList.remove('is-selected'); });
    selBar.hidden = !on;
    pickBtn.hidden = on;
    selectBtn.classList.toggle('is-on', on);
    updateSelBar();
  }
  selectBtn.addEventListener('click', () => setSelecting(!selecting));
  document.getElementById('ph-sel-cancel').addEventListener('click', () => setSelecting(false));
  document.getElementById('ph-sel-all').addEventListener('click', () => {
    const allOn = feedItems.every((i) => selected.has(i.id));
    feedItems.forEach((i) => { if (allOn) selected.delete(i.id); else selected.add(i.id); });
    feedEl.querySelectorAll('.ph-item').forEach((t) => t.classList.toggle('is-selected', selected.has(Number(t.dataset.id))));
    updateSelBar();
  });
  // Tile taps toggle selection while selecting (capture phase beats the viewer).
  feedEl.addEventListener('click', (e) => {
    if (!selecting) return;
    const tile = e.target.closest('.ph-item');
    if (!tile) return;
    e.stopPropagation();
    e.preventDefault();
    const id = Number(tile.dataset.id);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    tile.classList.toggle('is-selected', selected.has(id));
    updateSelBar();
  }, true);

  selGo.addEventListener('click', () => {
    const items = allItems.filter((i) => selected.has(i.id));
    if (items.length) downloadItems(items);
  });

  const dl = {
    sheet: document.getElementById('ph-dl'),
    title: document.getElementById('ph-dl-title'),
    copy: document.getElementById('ph-dl-copy'),
    bar: document.getElementById('ph-dl-bar'),
    save: document.getElementById('ph-dl-save'),
    cancelled: false
  };
  document.getElementById('ph-dl-close').addEventListener('click', () => { dl.cancelled = true; dl.sheet.hidden = true; });

  function fileName(item, n) {
    const ext = (item.mediaPath.match(/\.[a-z0-9]+$/i) || [''])[0] || (item.contentType.startsWith('video/') ? '.mp4' : '.jpg');
    const who = filter.person ? '-' + filter.person.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : '';
    return 'mike-and-xan' + who + '-' + String(n + 1).padStart(3, '0') + ext;
  }

  // Phones: hand the files to the share sheet ("Save to Photos").
  // Computers (or big batches): one zip file.
  async function downloadItems(items) {
    const isPhone = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
    const useShare = isPhone && items.length <= 20 && navigator.canShare;
    dl.cancelled = false;
    dl.save.hidden = true;
    dl.title.textContent = 'Getting ' + items.length + (items.length === 1 ? ' file' : ' files') + '…';
    dl.copy.textContent = useShare ? '' : 'They’ll download as one zip file.';
    dl.bar.style.width = '0%';
    dl.sheet.hidden = false;

    try {
      if (useShare) {
        const files = [];
        for (let n = 0; n < items.length; n++) {
          if (dl.cancelled) return;
          const res = await fetch(WORKER_URL + items[n].mediaPath);
          const blob = await res.blob();
          files.push(new File([blob], fileName(items[n], n), { type: items[n].contentType }));
          dl.bar.style.width = Math.round(((n + 1) / items.length) * 100) + '%';
        }
        if (navigator.canShare({ files })) {
          // Sharing needs a fresh tap — downloading took too long to count as one.
          dl.title.textContent = 'Ready!';
          dl.copy.textContent = 'Tap Save, then “Save Images” or “Save Video”.';
          dl.save.hidden = false;
          dl.save.onclick = async () => {
            try { await navigator.share({ files }); dl.sheet.hidden = true; setSelecting(false); } catch (e) { /* closed the sheet */ }
          };
          return;
        }
      }
      const { downloadZip } = await import('https://cdn.jsdelivr.net/npm/client-zip@2.4.6/index.js');
      let done = 0;
      const total = items.length;
      async function* files() {
        for (let n = 0; n < items.length; n++) {
          if (dl.cancelled) return;
          const res = await fetch(WORKER_URL + items[n].mediaPath);
          yield { name: fileName(items[n], n), input: res };
          done++;
          dl.bar.style.width = Math.round((done / total) * 100) + '%';
        }
      }
      const blob = await downloadZip(files()).blob();
      if (dl.cancelled) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mike-and-xan' + (filter.person ? '-' + filter.person.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : '') + '-photos.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      dl.title.textContent = 'Downloaded!';
      dl.copy.textContent = 'Check your Downloads folder.';
      setSelecting(false);
    } catch (e) {
      dl.title.textContent = 'That didn’t work';
      dl.copy.textContent = 'Try fewer at a time.';
    }
  }

  // Admin: upload into a chosen album.
  const proInput = document.getElementById('ph-pro-file');
  const albumSheet = document.getElementById('ph-album-pick');
  let uploadAlbumId = null;
  document.getElementById('ph-pro-btn').addEventListener('click', () => {
    document.getElementById('ph-album-list').innerHTML = allAlbums.map((a) =>
      `<li><button type="button" data-id="${a.id}"><span>${escHtml(a.name)}</span></button></li>`).join('');
    albumSheet.hidden = false;
  });
  document.getElementById('ph-album-close').addEventListener('click', () => { albumSheet.hidden = true; });
  document.getElementById('ph-album-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    uploadAlbumId = Number(b.dataset.id);
    albumSheet.hidden = true;
    proInput.click();
  });
  proInput.addEventListener('change', () => {
    const files = Array.from(proInput.files || []);
    proInput.value = '';
    const album = allAlbums.find((a) => a.id === uploadAlbumId);
    files.forEach((f) => queueUpload(f, { album: uploadAlbumId, albumName: album ? album.name : '' }));
  });

  async function moveToAlbum(itemId, albumId) {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'setItemAlbum', token: adminToken(), payload: { itemId, albumId } })
    });
    refreshFeed();
  }

  // ── Viewer: full-screen vertical pager (swipe up/down = next/prev) ──
  // Native scroll + snap does the gesture work, so it inherits the OS's
  // momentum/rubber-banding — the "feels like Instagram" part.

  // Slides load their media only when within a screen of the viewport.
  const slideLoadObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { loadSlide(en.target); slideLoadObserver.unobserve(en.target); }
    });
  }, { root: null, rootMargin: '150% 0px' });

  // Videos play when snapped into view, pause when swiped away.
  const slidePlayObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const v = en.target.querySelector('video');
      if (!v) return;
      if (en.intersectionRatio >= 0.6) v.play().catch(() => {});
      else { v.pause(); }
    });
  }, { threshold: [0, 0.6] });

  function loadSlide(slide) {
    if (slide.dataset.loaded) return;
    slide.dataset.loaded = '1';
    const item = feedItems.find(i => String(i.id) === slide.dataset.id);
    if (!item) return;
    const src = WORKER_URL + item.mediaPath;
    let media;
    if (item.contentType.startsWith('video/')) {
      media = document.createElement('video');
      media.controls = true;
      media.playsInline = true;
      media.loop = false;
      media.preload = 'metadata';
      if (item.thumbPath) media.poster = WORKER_URL + item.thumbPath;
      media.src = src;
    } else {
      // Show the small tile image instantly, swap in the full photo when it lands.
      media = document.createElement('img');
      media.alt = 'Guest photo';
      if (item.thumbPath) {
        media.src = WORKER_URL + item.thumbPath;
        const full = new Image();
        full.onload = () => { media.src = src; };
        full.src = src;
      } else {
        media.src = src;
      }
    }
    slide.appendChild(media);
  }

  function openViewer(startId, tile) {
    pager.textContent = '';
    feedItems.forEach((item) => {
      const slide = document.createElement('div');
      slide.className = 'ph-slide';
      slide.dataset.id = item.id;
      pager.appendChild(slide);
      slideLoadObserver.observe(slide);
      slidePlayObserver.observe(slide);
    });

    lightbox.classList.add('is-opening');
    lightbox.hidden = false;

    const index = Math.max(0, feedItems.findIndex(i => i.id === startId));
    const startSlide = pager.children[index];
    loadSlide(startSlide); // don't wait for the observer on the tapped one
    pager.scrollTop = index * pager.clientHeight;

    // Zoom-open: fly the tile's current image up to the slide.
    const tileMedia = tile && tile.querySelector('img, video');
    requestAnimationFrame(() => {
      lightbox.classList.remove('is-opening'); // background fades in
      if (!tileMedia) return;
      const rect = tileMedia.getBoundingClientRect();
      const target = startSlide.querySelector('img, video');
      let end = target ? target.getBoundingClientRect() : null;
      if (!end || !end.width || !end.height) {
        // Full-size media not loaded yet — land on where it WILL sit:
        // the tile thumb's aspect ratio contained in the viewport.
        const nw = tileMedia.naturalWidth || tileMedia.videoWidth || 4;
        const nh = tileMedia.naturalHeight || tileMedia.videoHeight || 5;
        const vw = window.innerWidth - 16;
        const vh = window.innerHeight - 24;
        const s = Math.min(vw / nw, vh / nh);
        end = {
          left: (window.innerWidth - nw * s) / 2,
          top: (window.innerHeight - nh * s) / 2,
          width: nw * s,
          height: nh * s
        };
      }

      const clone = tileMedia.cloneNode();
      if (clone.tagName === 'VIDEO') { clone.muted = true; clone.playsInline = true; clone.autoplay = false; }
      clone.style.objectPosition = getComputedStyle(tileMedia).objectPosition;
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

      if (target) target.style.opacity = '0';
      const dx = rect.left - end.left;
      const dy = rect.top - end.top;
      const sx = rect.width / end.width;
      const sy = rect.height / end.height;

      clone.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1 },
          { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 }
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      ).finished.finally(() => {
        if (target) target.style.opacity = '';
        clone.remove();
      });
    });
  }

  function closeViewer() {
    pager.textContent = ''; // drops any playing video + observers' targets
    lightbox.hidden = true;
  }
  lightbox.querySelector('.ph-lb-close').addEventListener('click', closeViewer);
  pager.addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.classList.contains('ph-slide')) closeViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeViewer();
    }
  }, true);

  refreshFeed();
  setInterval(refreshFeed, POLL_MS);
})();
