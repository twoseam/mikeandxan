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
      // For videos, build tile assets locally while the upload runs:
      // a poster frame + a ~2.5s muted low-res looping preview clip.
      const assetsPromise = file.type.startsWith('video/') ? makeVideoAssets(file) : null;

      let key = null;
      if (file.size <= SINGLE_MAX) {
        const res = await xhrSend('POST', WORKER_URL + '/upload', file, file.type, (loaded, total) => {
          const pct = Math.round((loaded / total) * 100);
          row.state.textContent = pct + '%';
          row.bar.style.width = pct + '%';
        });
        key = res.key || null;
      } else if (file.type.startsWith('video/') && file.size <= CHUNKED_MAX) {
        key = await uploadChunked(file, row);
      } else {
        row.fail(file.type.startsWith('video/') ? 'Too big (1 GB max)' : 'Too big (95 MB max)');
        return;
      }
      if (assetsPromise && key) {
        try {
          const assets = await assetsPromise;
          if (assets && assets.thumb) {
            await xhrSend('POST', WORKER_URL + '/upload-thumb?' + new URLSearchParams({ key }), assets.thumb, 'image/jpeg');
          }
          if (assets && assets.preview) {
            await xhrSend('POST', WORKER_URL + '/upload-preview?' + new URLSearchParams({ key }), assets.preview, assets.previewType);
          }
        } catch (e) { /* no tile assets — falls back to the video element */ }
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
      video.preload = 'auto';
      video.src = url;
      let thumb = null;
      const bail = setTimeout(() => cleanup({ thumb, preview: null }), 30000);
      function cleanup(result) { clearTimeout(bail); URL.revokeObjectURL(url); resolve(result); }

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

      // Fly a clone of whatever the tile is already showing (thumb or frame)
      const tileMedia = tile.querySelector('img, video');
      const clone = tileMedia ? tileMedia.cloneNode() : document.createElement('img');
      if (clone.tagName === 'VIDEO') { clone.muted = true; clone.playsInline = true; }
      clone.style.objectPosition = tileMedia ? getComputedStyle(tileMedia).objectPosition : '50% 35%';
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
