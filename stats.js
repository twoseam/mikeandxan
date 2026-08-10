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

  // Every count on this page is attending guests only — a declined vegan
  // doesn't need a meal. Toppings/songs are per-household answers, counted
  // when at least one member of that household is attending.
  function aggregate(households) {
    let attending = 0, specialMeals = 0, noRestriction = 0;
    const dietary = {};   // label -> count
    const toppings = {};  // normalized -> { label, count }
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
        const key = topping.toLowerCase();
        if (!toppings[key]) toppings[key] = { label: topping.charAt(0).toUpperCase() + topping.slice(1), count: 0 };
        toppings[key].count++;
      }
      const song = String(h.existing.songRequest || '').trim();
      if (song) {
        const firstReal = h.members.find(m => !m.isPlusOne);
        const by = firstReal
          ? firstReal.name.trim().split(/\s+/).map((p, i, a) => i === 0 ? p : (i === a.length - 1 ? p.charAt(0) + '.' : '')).filter(Boolean).join(' ')
          : (h.envelopeName || '');
        songs.push({ song, by });
      }
    });

    const dietaryRows = Object.keys(dietary).map(label => ({ label, count: dietary[label] }));
    dietaryRows.sort((a, b) => b.count - a.count);
    if (noRestriction) dietaryRows.unshift({ label: 'No restriction', count: noRestriction });

    const toppingRows = Object.keys(toppings).map(k => toppings[k]);
    toppingRows.sort((a, b) => b.count - a.count);
    const toppingAnswers = toppingRows.reduce((n, t) => n + t.count, 0);

    return { attending, specialMeals, dietaryRows, toppingRows, toppingAnswers, songs };
  }

  function barsHtml(rows) {
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    return rows.map(r =>
      '<div class="stats-bar-row">' +
        '<span class="stats-bar-name" title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</span>' +
        '<span class="stats-bar-track"><span class="stats-bar-fill" style="width:' + Math.round(r.count / max * 100) + '%"></span></span>' +
        '<span class="stats-bar-val">' + r.count + '</span>' +
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
    if (!stats.toppingRows.length) {
      el('toppings-hero').textContent = '–';
      el('toppings-hero-sub').textContent = 'no answers yet';
      el('toppings-bars').innerHTML = '<p class="stats-empty">Check back once RSVPs come in.</p>';
    } else {
      el('toppings-hero').textContent = stats.toppingRows[0].label;
      el('toppings-hero-sub').textContent = 'current favorite';
      el('toppings-bars').innerHTML = barsHtml(stats.toppingRows);
    }

    el('songs-label').textContent = 'Song requests — ' + stats.songs.length + (stats.songs.length === 1 ? ' request' : ' so far');
    el('songs-list').innerHTML = stats.songs.length
      ? stats.songs.map(s =>
          '<div class="stats-song"><span class="stats-song-t">' + escapeHtml(s.song) + '</span><span class="stats-song-by">' + escapeHtml(s.by) + '</span></div>'
        ).join('')
      : '<p class="stats-empty">No requests yet — check back once RSVPs come in.</p>';
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
