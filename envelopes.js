(function () {
  'use strict';

  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';
  const SESSION_KEY = 'mx_admin_session';

  // Hardcoded from Michael's own reference design (Envelopes.pdf) — the
  // return address doesn't change per-envelope, so it isn't worth a DB field.
  const RETURN_NAME = 'Michael & Alexandria';
  const RETURN_LINE_1 = '501 W Country Lane';
  const RETURN_LINE_2 = 'Kansas City, MO 64114-4935';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const summaryEl = document.getElementById('env-summary');
  const warningsEl = document.getElementById('env-warnings');
  const warningsListEl = document.getElementById('env-warnings-list');
  const sheetsEl = document.getElementById('env-sheets');
  const printBtn = document.getElementById('print-btn');

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Extra Swash's flourishes are drawn for a word at the END of a phrase -
  // mid-phrase, a swash exit stroke runs into the next word. Michael's
  // rule: every word except the last should end in plain New Kansas, not
  // Extra Swash - so only the last word (and the swash typeface as a
  // whole) gets the full flourish. Splits on spaces (so "&" between two
  // names counts as its own word and gets the same treatment) and swaps
  // just the final character of every non-terminal word into a plain
  // New Kansas span.
  function swashify(text) {
    const words = String(text || '').split(' ');
    return words.map((word, i) => {
      if (i === words.length - 1 || !word) return escapeHtml(word);
      const chars = Array.from(word);
      const lastChar = chars.pop();
      return escapeHtml(chars.join('')) + '<span class="swash-break">' + escapeHtml(lastChar) + '</span>';
    }).join(' ');
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }

  // Splits a normalized "Street, City, ST ZIP[, extra]" address into the
  // two lines a printed envelope actually wants: street(+unit) on line 1,
  // "CITY, ST ZIP" on line 2. Any trailing bit after the ZIP (unit number,
  // "United States") gets folded onto the street line instead of dangling
  // after the ZIP — that's where USPS actually wants unit info.
  function splitAddress(address) {
    const m = String(address || '').match(
      /^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*(?:,\s*(.*))?$/
    );
    if (!m) return { street: address || '', cityStateZip: '' };
    const [, street, city, state, zip, trailing] = m;
    const isCountry = trailing && /^united states$/i.test(trailing.trim());
    const streetLine = trailing && !isCountry ? street + ', ' + trailing : street;
    return { street: streetLine, cityStateZip: city + ', ' + state.toUpperCase() + ' ' + zip };
  }

  // Matches Michael's own reference design exactly: directionals abbreviate
  // (SE, NW...) but street-suffix words stay spelled out ("12TH STREET",
  // not "12TH ST") — his sample did the former and not the latter on both
  // envelopes, so this isn't the full USPS Pub 28 standard, just the half
  // of it he actually used. The database itself stays spelled out (that's
  // a separate, deliberate choice from earlier cleanup); this abbreviates
  // only for what's printed. NOT \bTOKEN\b - a plain word boundary treats
  // an apostrophe as a break, so "Lee's" reads as two words and corrupts
  // into "Lee'S". Lookaround against real separator chars avoids that
  // (same fix as the address cleanup script).
  const USPS_ABBR = [
    ['Northeast', 'NE'], ['Northwest', 'NW'], ['Southeast', 'SE'], ['Southwest', 'SW'],
    ['North', 'N'], ['South', 'S'], ['East', 'E'], ['West', 'W']
  ];
  function abbreviateForEnvelope(text) {
    let out = String(text || '');
    USPS_ABBR.forEach(([full, abbr]) => {
      out = out.replace(new RegExp('(?<=^|[\\s,])' + full + '(?=$|[\\s,.])', 'gi'), abbr);
    });
    return out;
  }

  function envelopeHtml(h) {
    const addr = splitAddress(h.address);
    addr.street = abbreviateForEnvelope(addr.street);
    addr.cityStateZip = abbreviateForEnvelope(addr.cityStateZip);
    const sublineHtml = h.envelopeSubline
      ? '<p class="recipient-subline">' + escapeHtml(h.envelopeSubline) + '</p>'
      : '';
    return (
      '<div class="envelope" data-household-id="' + h.id + '">' +
        '<div class="return-block">' +
          '<p class="return-name">' + swashify(RETURN_NAME) + '</p>' +
          '<p class="return-addr-line">' + escapeHtml(RETURN_LINE_1) + '</p>' +
          '<p class="return-addr-line">' + escapeHtml(RETURN_LINE_2) + '</p>' +
        '</div>' +
        '<div class="recipient-block">' +
          '<p class="recipient-name">' + swashify(h.envelopeName) + '</p>' +
          sublineHtml +
          '<div class="recipient-address">' +
            '<p class="addr-line">' + escapeHtml(addr.street) + '</p>' +
            '<p class="addr-line">' + escapeHtml(addr.cityStateZip) + '</p>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // Michael's reference design stretches whichever address line is shorter
  // so both lines end flush at the same width (extra letter-spacing, not
  // word-spacing) — this reproduces that per-envelope, after layout.
  function balanceAddressLines(block) {
    const lines = block.querySelectorAll('.addr-line');
    if (lines.length < 2) return;
    // The stylesheet sets a base tracking (90 = 0.09em) on .addr-line -
    // this ADDS more letter-spacing on top of that to equalize widths, it
    // doesn't reset to 'normal' first and replace it. Read the base as
    // computed px so the final inline value (which overrides the CSS em
    // value) still includes it.
    const basePx = parseFloat(getComputedStyle(lines[0]).letterSpacing) || 0;
    const widths = Array.from(lines).map(l => l.getBoundingClientRect().width);
    const maxWidth = Math.max.apply(null, widths);
    lines.forEach((l, i) => {
      const w = widths[i];
      if (maxWidth - w < 0.5) return;
      const len = l.textContent.length || 1;
      l.style.letterSpacing = (basePx + (maxWidth - w) / len) + 'px';
    });
  }

  // Long recipient names ("Andrea Martin & Andrew Long & Guest") wrap onto
  // a second line at the script font's natural 34pt — shrink until it fits
  // one line rather than let it collide with the sub-line/address below.
  function fitNameToOneLine(el) {
    const minSizePt = 12;
    let sizePt = parseFloat(getComputedStyle(el).fontSize) / (96 / 72);
    const lineHeightPx = () => parseFloat(getComputedStyle(el).lineHeight);
    while (el.getBoundingClientRect().height > lineHeightPx() * 1.3 && sizePt > minSizePt) {
      sizePt -= 1;
      el.style.fontSize = sizePt + 'pt';
    }
  }

  async function loadEnvelopes() {
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

    const households = data.households || [];
    const printable = households.filter(h => h.address && h.envelopeName);
    const missingEnvelopeName = households.filter(h => h.address && !h.envelopeName);
    const missingAddress = households.filter(h => h.envelopeName && !h.address);

    gate.hidden = true;
    app.hidden = false;
    summaryEl.textContent = printable.length + ' envelope' + (printable.length === 1 ? '' : 's') + ' ready to print';

    const warnings = [];
    missingEnvelopeName.forEach(h => warnings.push(labelFor(h) + ' — has an address but no envelope name yet (set it in the Guest List).'));
    missingAddress.forEach(h => warnings.push(labelFor(h) + ' — has an envelope name but no address on file.'));
    if (warnings.length) {
      warningsEl.hidden = false;
      warningsListEl.innerHTML = warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
    }

    sheetsEl.innerHTML = printable.map(envelopeHtml).join('');

    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    document.querySelectorAll('.recipient-name').forEach(fitNameToOneLine);
    document.querySelectorAll('.recipient-address').forEach(balanceAddressLines);
  }

  function labelFor(h) {
    return h.envelopeName || h.label || ('Household #' + h.id);
  }

  printBtn.addEventListener('click', function () { window.print(); });

  loadEnvelopes();
})();
