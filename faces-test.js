/* Face matching test — admin-only, read-only. Nothing is saved anywhere.
   Loads the Share the Day feed, finds faces in every photo (and sampled
   video frames) using the open-source Human library running in this
   browser, then groups faces that look like the same person.
   The strictness menu re-groups instantly (no re-scan). */
import Human from 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js';

const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
const MAX_EDGE = 2400;       // downscale big photos to this long edge
const MIN_FACE = 40;         // px — smaller faces give unreliable matches
const VIDEO_STEP = 2;        // seconds between video samples
const VIDEO_MAX_SAMPLES = 20;
const SAME_IN_VIDEO = 0.6;   // collapse repeat faces within one video

const $ = (id) => document.getElementById(id);

function session() {
  try {
    const s = JSON.parse(localStorage.getItem('mx_admin_session') || 'null');
    return s && s.token && Date.now() < s.expiresAt ? s : null;
  } catch (e) { return null; }
}

const sess = session();
if (!sess) { $('login').hidden = false; } else { $('app').hidden = false; init(); }

const human = new Human({
  modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/',
  backend: 'webgl',
  cacheSensitivity: 0,
  filter: { enabled: false },
  gesture: { enabled: false },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  segmentation: { enabled: false },
  face: {
    enabled: true,
    detector: { maxDetected: 50, rotation: true, minConfidence: 0.4, skipFrames: 0, skipTime: 0 },
    mesh: { enabled: true },
    iris: { enabled: false },
    emotion: { enabled: false },
    description: { enabled: true, skipFrames: 0, skipTime: 0 },
    antispoof: { enabled: false },
    liveness: { enabled: false }
  }
});

let faces = [];   // { emb, thumb, itemId, src, size }
let stats = null;

async function init() {
  try {
    await human.load();
    await human.warmup();
    $('go').textContent = 'Scan guest uploads';
    $('go').disabled = false;
  } catch (e) {
    $('go').textContent = 'Face tool failed to load';
    $('status').textContent = String(e && e.message || e);
  }
  $('go').addEventListener('click', scan);
  $('thresh').addEventListener('change', render);
}

function setStatus(t) { $('status').textContent = t; }
function setProgress(f) { $('progress').firstElementChild.style.width = Math.round(f * 100) + '%'; }

async function scan() {
  $('go').disabled = true;
  faces = [];
  stats = { photos: 0, videos: 0, failed: 0, start: performance.now() };
  setStatus('Loading feed…');
  const res = await fetch(WORKER_URL + '/?action=feed&token=' + encodeURIComponent(sess.token));
  const data = await res.json();
  const items = (data.items || []).filter((i) => !i.hidden);

  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    setStatus(`Scanning ${n + 1} of ${items.length} — ${faces.length} faces so far`);
    setProgress(n / items.length);
    const src = WORKER_URL + it.mediaPath;
    try {
      if ((it.contentType || '').startsWith('video/')) {
        await scanVideo(src, it.id);
        stats.videos++;
      } else {
        const img = await loadImage(src);
        const found = await findFaces(img, img.naturalWidth, img.naturalHeight);
        found.forEach((f) => faces.push({ ...f, itemId: it.id, src }));
        stats.photos++;
      }
    } catch (e) {
      console.warn('Could not scan', it.id, e);
      stats.failed++;
    }
  }
  setProgress(1);
  stats.seconds = Math.round((performance.now() - stats.start) / 1000);
  setStatus('Done.');
  $('go').disabled = false;
  $('go').textContent = 'Scan again';
  render();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

// Draw the source onto a canvas (downscaled), then run the detector on the
// whole frame plus overlapping 2×2 and 3×3 tiles so small faces in group
// shots aren't missed. Duplicate hits from overlapping tiles are merged.
async function findFaces(source, w, h, light) {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.getContext('2d').drawImage(source, 0, 0, W, H);

  const regions = [[0, 0, W, H]];
  const grids = light ? [2] : [2, 3];
  if (Math.max(W, H) > 900) {
    for (const g of grids) {
      const tw = W / g, th = H / g, ox = tw * 0.25, oy = th * 0.25;
      for (let r = 0; r < g; r++) for (let c = 0; c < g; c++) {
        const x = Math.max(0, c * tw - ox), y = Math.max(0, r * th - oy);
        regions.push([x, y, Math.min(W, (c + 1) * tw + ox) - x, Math.min(H, (r + 1) * th + oy) - y]);
      }
    }
  }

  const hits = [];
  const tile = document.createElement('canvas');
  for (const [x, y, rw, rh] of regions) {
    tile.width = Math.round(rw); tile.height = Math.round(rh);
    tile.getContext('2d').drawImage(canvas, x, y, rw, rh, 0, 0, tile.width, tile.height);
    const result = await human.detect(tile);
    for (const f of result.face || []) {
      if (!f.embedding || !f.embedding.length) continue;
      const [bx, by, bw, bh] = f.box;
      if (Math.min(bw, bh) < MIN_FACE) continue;
      hits.push({ box: [bx + x, by + y, bw, bh], score: f.boxScore || f.score || 0, emb: Array.from(f.embedding) });
    }
  }

  // merge overlapping detections (same face seen in several tiles)
  hits.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const h1 of hits) {
    if (!kept.some((k) => iou(k.box, h1.box) > 0.3 || centerInside(h1.box, k.box))) kept.push(h1);
  }

  return kept.map((k) => ({ emb: k.emb, size: Math.min(k.box[2], k.box[3]), thumb: crop(canvas, k.box) }));
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}
function centerInside(a, b) {
  const cx = a[0] + a[2] / 2, cy = a[1] + a[3] / 2;
  return cx > b[0] && cx < b[0] + b[2] && cy > b[1] && cy < b[1] + b[3];
}

function crop(canvas, box) {
  const pad = 0.25;
  const [x, y, w, h] = box;
  const s = Math.max(w, h) * (1 + pad * 2);
  const cx = x + w / 2, cy = y + h / 2;
  const c = document.createElement('canvas');
  c.width = c.height = 144;
  c.getContext('2d').drawImage(canvas, cx - s / 2, cy - s / 2, s, s, 0, 0, 144, 144);
  return c.toDataURL('image/jpeg', 0.8);
}

async function scanVideo(src, itemId) {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video load failed')); });
  const dur = v.duration || 0;
  const times = [];
  for (let t = 0.5; t < dur && times.length < VIDEO_MAX_SAMPLES; t += VIDEO_STEP) times.push(t);
  if (!times.length) times.push(0);

  const mine = [];
  for (const t of times) {
    v.currentTime = t;
    await new Promise((res) => { v.onseeked = res; });
    const found = await findFaces(v, v.videoWidth, v.videoHeight, true);
    for (const f of found) {
      // one entry per person per video — keep the biggest view
      const same = mine.find((m) => human.match.similarity(m.emb, f.emb) >= SAME_IN_VIDEO);
      if (!same) mine.push(f);
      else if (f.size > same.size) Object.assign(same, f);
    }
  }
  mine.forEach((f) => faces.push({ ...f, itemId, src }));
  v.removeAttribute('src');
  v.load();
}

// Group faces: biggest/clearest faces seed the groups; each face joins the
// group with its closest match if that match clears the strictness level.
function group(threshold) {
  const order = [...faces].sort((a, b) => b.size - a.size);
  const groups = [];
  for (const f of order) {
    let best = null, bestSim = 0;
    for (const g of groups) {
      for (const m of g) {
        const s = human.match.similarity(f.emb, m.emb);
        if (s > bestSim) { bestSim = s; best = g; }
      }
    }
    if (best && bestSim >= threshold) best.push(f); else groups.push([f]);
  }
  return groups.sort((a, b) => b.length - a.length);
}

function render() {
  if (!stats) return;
  const t = Number($('thresh').value);
  const groups = group(t);
  const multi = groups.filter((g) => g.length > 1);
  const singles = groups.filter((g) => g.length === 1);

  $('summary').hidden = false;
  $('summary').innerHTML =
    `<b>${stats.photos}</b> photos and <b>${stats.videos}</b> videos scanned in ${stats.seconds}s` +
    (stats.failed ? ` (${stats.failed} couldn’t be opened)` : '') +
    ` &middot; <b>${faces.length}</b> faces found &middot; <b>${multi.length}</b> people seen more than once &middot; <b>${singles.length}</b> faces seen once`;

  const html = [];
  multi.forEach((g, i) => {
    const items = new Set(g.map((f) => f.itemId)).size;
    html.push(`<div class="group"><h3>Person ${i + 1} <span>&middot; in ${items} photo${items === 1 ? '' : 's'}/videos</span></h3><div class="faces">` +
      g.map((f) => `<img src="${f.thumb}" data-src="${f.src}" alt="">`).join('') + '</div></div>');
  });
  if (singles.length) {
    html.push(`<div class="group single"><h3>Seen once (${singles.length})</h3><div class="faces">` +
      singles.map((g) => `<img src="${g[0].thumb}" data-src="${g[0].src}" alt="">`).join('') + '</div></div>');
  }
  $('groups').innerHTML = html.join('');
}

$('groups').addEventListener('click', (e) => {
  const img = e.target.closest('img[data-src]');
  if (img) window.open(img.dataset.src, '_blank');
});
