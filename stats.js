(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');

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

  const DIETARY_LABELS = {
    'vegetarian': 'Vegetarian',
    'vegan': 'Vegan',
    'gluten-free': 'Gluten Free'
  };

  // The topping field is free text ("Kevin Canadian bacon Jenny cheese and
  // more cheese"), so bucket answers into canonical toppings by keyword.
  // One answer can mention several toppings; each bucket counts once per
  // answer. Order matters: "Canadian bacon" is stripped from the text
  // before plain "bacon" is tested, and "pepper" must not match pepperoni.
  const TOPPING_BUCKETS = [
    { label: 'Pepperoni',      re: /pep+eroni/ },
    { label: 'Cheese',         re: /cheese|margherita|\bplain\b/ },
    { label: 'Canadian bacon', re: /canadian\s*bacon|\bham\b/ },
    { label: 'Sausage',        re: /sausage/ },
    { label: 'Bacon',          re: /bacon/ },
    { label: 'Mushrooms',      re: /mushroom/ },
    { label: 'Pineapple',      re: /pineapple|hawaiian/ },
    { label: 'Peppers',        re: /pepper(?!oni)|jalape/ },
    { label: 'Onions',         re: /onion/ },
    { label: 'Olives',         re: /olive/ },
    { label: 'Chicken',        re: /chicken|bbq/ },
    { label: 'Meat lovers',    re: /meat\s*lover|all\s*meat/ },
    { label: 'Veggie',         re: /veggie|vegetable/ },
    { label: 'Supreme',        re: /supreme|the\s*works|everything/ },
  ];

  function bucketToppings(answerText) {
    const hits = [];
    let t = answerText.toLowerCase();
    TOPPING_BUCKETS.forEach(b => {
      if (b.re.test(t)) {
        hits.push(b.label);
        // Strip the match so a broader bucket lower in the list can't
        // double-claim it (Canadian bacon → bacon).
        t = t.replace(new RegExp(b.re.source, 'g'), ' ');
      }
    });
    return hits;
  }

  // Short attribution for a household's free-text answers: "Jenny T."
  function bylineOf(h) {
    const firstReal = h.members.find(m => !m.isPlusOne);
    return firstReal
      ? firstReal.name.trim().split(/\s+/).map((p, i, a) => i === 0 ? p : (i === a.length - 1 ? p.charAt(0) + '.' : '')).filter(Boolean).join(' ')
      : (h.envelopeName || '');
  }

  // Every count on this page is attending guests only — a declined vegan
  // doesn't need a meal. Toppings/songs are per-household answers, counted
  // when at least one member of that household is attending.
  function aggregate(households) {
    let attending = 0, specialMeals = 0, noRestriction = 0;
    const dietary = {};   // label -> count
    const toppingCounts = {}; // bucket label -> count
    const toppingQuotes = []; // { text, by }
    let toppingAnswers = 0, toppingOther = 0;
    const songs = [];     // { song, by }

    households.forEach(h => {
      let householdAttending = 0;
      h.members.forEach(m => {
        if (m.attending !== 'yes') return;
        householdAttending++;
        attending++;
        if (m.dietary) {
          specialMeals++;
          const label = m.dietary === 'other'
            ? (String(m.dietaryOther || '').trim() || 'Other')
            : (DIETARY_LABELS[m.dietary] || m.dietary);
          dietary[label] = (dietary[label] || 0) + 1;
        } else {
          noRestriction++;
        }
      });
      if (!householdAttending || !h.existing) return;

      const topping = String(h.existing.pizzaTopping || '').trim();
      if (topping) {
        toppingAnswers++;
        toppingQuotes.push({ text: topping, by: bylineOf(h) });
        const hits = bucketToppings(topping);
        if (hits.length) hits.forEach(label => { toppingCounts[label] = (toppingCounts[label] || 0) + 1; });
        else toppingOther++;
      }
      const song = String(h.existing.songRequest || '').trim();
      if (song) songs.push({ song, by: bylineOf(h) });
    });

    const dietaryRows = Object.keys(dietary).map(label => ({ label, count: dietary[label] }));
    dietaryRows.sort((a, b) => b.count - a.count);
    if (noRestriction) dietaryRows.unshift({ label: 'No restriction', count: noRestriction });

    let toppingRows = Object.keys(toppingCounts).map(label => ({ label, count: toppingCounts[label] }));
    toppingRows.sort((a, b) => b.count - a.count);
    // Keep the board readable once the list fills in: top 8 named buckets,
    // the tail folded into one quiet row (raw answers stay listed below).
    if (toppingRows.length > 9) {
      const rest = toppingRows.slice(8);
      toppingRows = toppingRows.slice(0, 8);
      toppingRows.push({ label: 'Everything else', count: rest.reduce((n, r) => n + r.count, 0), rest: true });
    }
    if (toppingOther) toppingRows.push({ label: 'Unclassified', count: toppingOther, rest: true });

    return { attending, specialMeals, dietaryRows, toppingRows, toppingAnswers, toppingQuotes, songs };
  }

  function barsHtml(rows) {
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    return rows.map(r =>
      '<div class="stats-bar-row"' + (r.rest ? ' data-kind="rest"' : '') + '>' +
        '<span class="stats-bar-name" title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</span>' +
        '<span class="stats-bar-track"><span class="stats-bar-fill" style="width:' + Math.round(r.count / max * 100) + '%"></span></span>' +
        '<span class="stats-bar-val">' + r.count + '</span>' +
      '</div>'
    ).join('');
  }

  function quotesHtml(list, textKey) {
    return list.map(q =>
      '<div class="stats-quote">' +
        '<p class="stats-quote-t">' + escapeHtml(q[textKey]) + '</p>' +
        (q.by ? '<p class="stats-quote-by">' + escapeHtml(q.by) + '</p>' : '') +
      '</div>'
    ).join('');
  }

  function render(stats) {
    el('stats-updated').textContent = stats.attending + ' attending so far';

    el('dietary-label').textContent = 'Dietary — ' + stats.attending + ' attending';
    if (!stats.attending) {
      el('dietary-hero').textContent = '0';
      el('dietary-hero-sub').textContent = 'no attending guests yet';
      el('dietary-bars').innerHTML = '<p class="stats-empty">Check back once RSVPs come in.</p>';
    } else {
      el('dietary-hero').textContent = stats.specialMeals;
      el('dietary-hero-sub').textContent = stats.specialMeals === 1 ? 'needs a special meal' : 'need a special meal';
      el('dietary-bars').innerHTML = barsHtml(stats.dietaryRows);
    }

    el('toppings-label').textContent = 'Pizza toppings — ' + stats.toppingAnswers + ' answered';
    if (!stats.toppingAnswers) {
      el('toppings-hero').textContent = '–';
      el('toppings-hero-sub').textContent = 'no answers yet';
      el('toppings-bars').innerHTML = '<p class="stats-empty">Check back once RSVPs come in.</p>';
    } else {
      const top = stats.toppingRows.find(r => !r.rest);
      el('toppings-hero').textContent = top ? top.label : String(stats.toppingAnswers);
      el('toppings-hero-sub').textContent = top ? 'current favorite' : 'answers so far';
      el('toppings-bars').innerHTML = barsHtml(stats.toppingRows);
    }

    renderSongs(stats.songs);
  }

  // ---- Song verification (Michael, Aug 19 2026): guests type anything into
  // the song field, so the playlist here only lists requests that match a
  // real song in Apple's catalog (iTunes Search API — public, no key). The
  // unmatched ones aren't lost: every raw answer stays on the household's
  // card in the Guest List. Verdicts are cached in localStorage so the page
  // doesn't re-query on every visit. ----

  const SONG_CACHE_KEY = 'mx_song_verdicts_v2';
  const FILLER_RE = /\bum+\b|\bidk\b|\bdunno\b|\bno idea\b|\bwhatever\b|\bsurprise us\b|\banything\b|\bliterally\b/i;
  const STOP_WORDS = new Set(['by', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'feat', 'ft', 'featuring', 'please', 'something', 'song', 'version', 'sorry', 'mom', 'dad', 'our', 'my', 'me', 'us', 'first']);

  function songTokens(s) {
    return Array.from(new Set(
      String(s).toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)
        .filter(t => t && !STOP_WORDS.has(t))
    ));
  }

  // "Sweet Caroline (Single Version)" → "Sweet Caroline"
  function cleanTitle(t) {
    return String(t).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function loadVerdicts() {
    try { return JSON.parse(localStorage.getItem(SONG_CACHE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  // One free-text answer can hold several songs ("Fall on Me by Andrea
  // Bocelli Judas Priest the Ripper" is two). Extraction loop: search the
  // catalog for the remaining words, accept a result only when its TITLE is
  // essentially present in the guest's words (artist-only matches like
  // "anything by Fleetwood Mac" are requests, not songs), subtract the
  // matched words, and go again on what's left. Returns [{title, artist}].
  async function verifySongs(text, verdicts) {
    if (Object.prototype.hasOwnProperty.call(verdicts, text)) return verdicts[text];
    const hits = [];
    if (!FILLER_RE.test(text)) {
      let remaining = songTokens(text);
      for (let round = 0; round < 3 && remaining.length; round++) {
        // A two-songs-in-one answer fails as a single query (the catalog
        // ANDs every word), so also try the front and back halves.
        const windows = [remaining];
        if (remaining.length > 4) { windows.push(remaining.slice(0, 4)); windows.push(remaining.slice(4)); }
        let match = null;
        for (const w of windows) {
          const res = await fetch('https://itunes.apple.com/search?media=music&entity=song&limit=8&term=' + encodeURIComponent(w.join(' ')));
          const data = await res.json();
          for (const r of (data.results || [])) {
            const trackTokens = songTokens(cleanTitle(r.trackName));
            if (!trackTokens.length) continue;
            const trackCov = trackTokens.filter(t => remaining.indexOf(t) !== -1).length / trackTokens.length;
            if (trackCov >= 0.8) { match = r; break; }
          }
          if (match) break;
        }
        if (!match) break;
        hits.push({ title: cleanTitle(match.trackName), artist: match.artistName });
        const consumed = new Set(songTokens(cleanTitle(match.trackName) + ' ' + match.artistName));
        remaining = remaining.filter(t => !consumed.has(t));
        if (remaining.length < 2) break;
      }
    }
    verdicts[text] = hits;
    try { localStorage.setItem(SONG_CACHE_KEY, JSON.stringify(verdicts)); } catch (_) {}
    return hits;
  }

  async function renderSongs(songs) {
    if (!songs.length) {
      el('songs-label').textContent = 'Song requests';
      el('songs-list').innerHTML = '<p class="stats-empty">No requests yet — check back once RSVPs come in.</p>';
      return;
    }
    el('songs-label').textContent = 'Song requests';
    el('songs-list').innerHTML = '<p class="stats-empty">Checking requests against the song catalog…</p>';

    const verdicts = loadVerdicts();
    let anyVerified = false, anyFailed = false;
    const checked = [];
    for (const s of songs) {
      try {
        const v = await verifySongs(s.song, verdicts);
        if (v.length) anyVerified = true;
        checked.push({ raw: s.song, by: s.by, v });
      } catch (_) {
        anyFailed = true;
        checked.push({ raw: s.song, by: s.by, v: [] });
      }
    }

    // If the catalog can't be reached at all, show everything raw rather
    // than an empty board.
    if (!anyVerified && anyFailed) {
      el('songs-label').textContent = 'Song requests — ' + songs.length + ' so far';
      el('songs-list').innerHTML = '<div class="stats-songs-cols">' + quotesHtml(songs, 'song') + '</div>';
      return;
    }

    // Same song requested twice → one row, both names.
    const byKey = {};
    const rows = [];
    checked.forEach(c => {
      c.v.forEach(hit => {
        const key = (hit.title + '|' + hit.artist).toLowerCase();
        if (byKey[key]) { if (c.by && byKey[key].bys.indexOf(c.by) === -1) byKey[key].bys.push(c.by); return; }
        byKey[key] = { title: hit.title, artist: hit.artist, bys: c.by ? [c.by] : [] };
        rows.push(byKey[key]);
      });
    });

    const skipped = checked.filter(c => !c.v.length).length;
    el('songs-label').textContent = 'Song requests — ' + rows.length + (rows.length === 1 ? ' song' : ' songs');
    el('songs-list').innerHTML =
      (rows.length
        ? '<div class="stats-songs-cols">' + rows.map(r =>
            '<div class="stats-quote stats-track">' +
              '<p class="stats-track-title">' + escapeHtml(r.title) + '</p>' +
              '<p class="stats-track-artist">' + escapeHtml(r.artist) + '</p>' +
              (r.bys.length ? '<p class="stats-quote-by">' + escapeHtml(r.bys.join(' · ')) + '</p>' : '') +
            '</div>'
          ).join('') + '</div>'
        : '<p class="stats-empty">Nothing matched a real song yet.</p>') +
      (skipped ? '<p class="stats-note">' + skipped + (skipped === 1 ? ' request' : ' requests') + ' didn’t match a song — find them on the household cards in the Guest List.</p>' : '');
  }

  // Test hook: lets a harness render fabricated data without a live backend.
  window.__renderStats = function (households) { render(aggregate(households)); };

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
    gate.hidden = true;
    app.hidden = false;
    render(aggregate(data.households || []));
  }

  load();
})();
