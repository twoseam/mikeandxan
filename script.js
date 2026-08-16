/* ============================================================
   Mike & Xan — Wedding Site
   Frontend JS: nav toggle + RSVP form
   ============================================================ */

if ('scrollRestoration' in history) history.scrollRestoration = 'auto';

/* Wrap every "&" in body text with <span class="amp"> so it renders in
   DM Serif Display Regular — keeps the brand mark consistent everywhere
   without hand-wrapping each occurrence in HTML. Skips form fields,
   script/style/code, and elements that already style their own "&"
   (.brand-amp, .hero-amp, .amp). */
(function () {
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, INPUT: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  var SKIP_CLASSES = ['amp', 'brand-amp', 'hero-amp'];
  function shouldSkipEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName]) return true;
    var cl = el.classList;
    if (cl) for (var i = 0; i < SKIP_CLASSES.length; i++) if (cl.contains(SKIP_CLASSES[i])) return true;
    return false;
  }
  function walk(node) {
    if (node.nodeType === 3) {
      if (node.nodeValue.indexOf('&') === -1) return;
      var parent = node.parentElement;
      for (var p = parent; p; p = p.parentElement) if (shouldSkipEl(p)) return;
      var parts = node.nodeValue.split(/(&)/);
      var frag = document.createDocumentFragment();
      for (var j = 0; j < parts.length; j++) {
        if (parts[j] === '&') {
          var span = document.createElement('span');
          span.className = 'amp';
          span.textContent = '&';
          frag.appendChild(span);
        } else if (parts[j]) {
          frag.appendChild(document.createTextNode(parts[j]));
        }
      }
      node.parentNode.replaceChild(frag, node);
      return;
    }
    if (node.nodeType !== 1 || shouldSkipEl(node)) return;
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var k = 0; k < kids.length; k++) walk(kids[k]);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { walk(document.body); });
  } else {
    walk(document.body);
  }
}());

/* Toggle a body class once the user scrolls past the hero. Used to:
   - reveal the mobile site-header (hidden until the user starts scrolling)
   - fade out the bouncing scroll-cue arrow */
(function () {
  var threshold = 80;
  function update() {
    document.body.classList.toggle('is-scrolled', window.scrollY > threshold);
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
}());

/* Photo-break focal-point sliders were removed once positions/scales were
   locked in. Values now live in the inline `style` of each .photo-break
   in index.html. To re-enable adjustment later, restore from git history. */

/* Heart-eye position sliders removed once positions/scales were locked in.
   Per-heart values now live in the inline `style` of the .has-heart-eyes
   section in index.html. Restore from git history if re-adjustment is
   ever needed. The /dev-save-attr endpoint in dev-server.py is what made
   the save reliable — keep that around for similar future tools. */

/* ── Subtle parallax for .photo-break sections + scroll-driven heart-eye draw ──
   - Each section's --parallax-offset CSS var drives a small vertical translate.
   - Sections marked .has-heart-eyes additionally have <svg.heart-eye> overlays
     whose stroke-dashoffset follows the scroll position (draws on the way down,
     un-draws on the way back up). */
(function () {
  var sections = document.querySelectorAll('.photo-break');
  if (!sections.length) return;
  var maxOffset = 60;
  var ticking = false;

  // Pre-measure each heart path's length and prime stroke-dasharray.
  document.querySelectorAll('.heart-eye path').forEach(function (path) {
    try {
      var len = Math.ceil(path.getTotalLength());
      path.dataset.len = len;
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len; // start fully un-drawn
    } catch (e) { /* layout not ready */ }
  });

  function update() {
    var viewH = window.innerHeight;
    sections.forEach(function (s) {
      var rect = s.getBoundingClientRect();
      var sectionCenter = rect.top + rect.height / 2;
      var range = viewH / 2 + rect.height / 2;
      var progress = (sectionCenter - viewH / 2) / range; // +1 below view, 0 centered, -1 above
      if (progress > 1) progress = 1;
      if (progress < -1) progress = -1;
      s.style.setProperty('--parallax-offset', (-progress * maxOffset).toFixed(1) + 'px');

      if (s.classList.contains('has-heart-eyes')) {
        // Each heart draws over a short window of scroll progress, staggered
        // so they don't all land at once. progress goes +1 (just emerging)
        // → 0 (centered) → −1 (passed). Hearts start drawing later (lower
        // values of progress) so the unmarked photo is visible first.
        var heartStarts = [0.5, 0.42, 0.34, 0.26]; // start prog per heart 1..4
        var heartDuration = 0.18;                  // scroll-progress range per heart
        s.querySelectorAll('.heart-eye').forEach(function (heart, idx) {
          var startProg = heartStarts[idx] != null ? heartStarts[idx] : 0.3;
          var d = (startProg - progress) / heartDuration;
          if (d < 0) d = 0;
          if (d > 1) d = 1;
          heart.querySelectorAll('path').forEach(function (path) {
            var len = parseFloat(path.dataset.len) || 0;
            if (!len) return;
            path.style.strokeDashoffset = (len * (1 - d)).toFixed(0);
          });
        });
      }
    });
    ticking = false;
  }
  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}());

/* ── Polaroid manifest — known set on disk. Saved 30+ HEAD requests
      vs. the runtime probing loop. Update this array if you add/remove
      polaroid files. ── */
var _polaroids = [2,3,4,5,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]
  .map(function (n) { return 'assets/Polaroid-' + n + '.webp'; });
async function getPolaroids() { return _polaroids; }

/* ============================================================
   Hero ampersand — cycles through six font styles at ~12fps
   with a tiny per-frame transform jitter. Lo-fi cut-out feel.
   Pauses if the user prefers reduced motion.
   ============================================================ */
(function () {
  'use strict';
  const amp = document.querySelector('.hero-amp');
  if (!amp) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Curated glyph × font pairs — each tick picks one from the weighted pool.
  // Edit via amp-editor.html (localhost), then paste the PAIRS array here.
  const PAIRS = [
    { glyph: '&', font: '"DM Serif Display", serif', key: 'dm' },
    { glyph: '+', font: '"Yeseva One", serif', key: 'yeseva' },
    { glyph: 'and', font: '"DM Serif Display", serif', key: 'dm' },
    { glyph: 'plus', font: '"DM Serif Display", serif', key: 'dm' },
    { glyph: 'marries', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: 'y', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: 'et', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: '&', font: '"Bodoni Moda", serif', key: 'bodoni' },
    { glyph: 'with', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: 'loves', font: '"Bodoni Moda", serif', key: 'bodoni' },
    { glyph: '&', font: '"Yeseva One", serif', key: 'yeseva' },
    { glyph: 'e', font: '"Yeseva One", serif', key: 'yeseva' },
    { glyph: '&', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: '+', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: 'n\'', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: 'hearts', font: '"new-kansas-thin", serif', key: 'nk' },
    { glyph: 'e', font: '"new-kansas-thin", serif', key: 'nk' },
  ];

  // Expand into a weighted pool once.
  const POOL = [];
  PAIRS.forEach(p => { for (let n = 0; n < (p.weight || 1); n++) POOL.push(p); });

  const FRAME_MS = 1000 / 4; // 4fps, steady
  const SCALE = 1.5;

  function tierFor(g) {
    if (g === '&') return 'amp';
    if (g === '+') return 'plus';
    if (g.length <= 2) return 'amp';   // single chars + "et" — get full size
    if (g.length <= 4) return 'and';    // and, Plus, with
    return 'long';                       // loves, marries
  }

  function tick() {
    const p = POOL[Math.floor(Math.random() * POOL.length)];
    amp.style.fontFamily = p.font;
    amp.dataset.font = p.key;
    amp.textContent = p.glyph;
    amp.dataset.glyph = tierFor(p.glyph);
    amp.style.setProperty('transform', `scale(${SCALE})`, 'important');
  }

  // Pause when hero is off-screen — saves CPU/battery during scroll.
  let intervalId = null;
  function startCycle() { if (!intervalId) intervalId = setInterval(tick, FRAME_MS); }
  function stopCycle()  { if (intervalId) { clearInterval(intervalId); intervalId = null; } }

  function init() {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        entries[0].isIntersecting ? startCycle() : stopCycle();
      }, { threshold: 0 });
      io.observe(amp);
    } else {
      startCycle();
    }
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(init);
  } else {
    init();
  }
})();

/* ============================================================
   Hero countdown — proper flip-clock cards counting down to the
   wedding (Saturday Nov 14, 2026, 4:00pm CST / UTC-6).

   Each card has four stacked halves:
     .flip-static-top    — always shows the current top half
     .flip-static-bottom — shows the OLD bottom until flap-bottom
                           lands on top of it
     .flip-flap-top      — overlay on the top half; flips DOWN
                           (0 → -90 on its bottom hinge)
     .flip-flap-bottom   — overlay on the bottom half; flips UP
                           (90 → 0 on its top hinge)
   ============================================================ */
(function () {
  'use strict';
  const target = new Date('2026-11-14T16:00:00-06:00');
  const root = document.getElementById('countdown');
  if (!root) return;

  const slots = {};
  ['months', 'days', 'hours', 'minutes', 'seconds'].forEach(unit => {
    const card = root.querySelector(`.flip-card[data-unit="${unit}"]`);
    if (!card) return;
    slots[unit] = {
      card: card,
      staticTop:    card.querySelector('.flip-static-top span'),
      staticBottom: card.querySelector('.flip-static-bottom span'),
      flapTop:      card.querySelector('.flip-flap-top span'),
      flapBottom:   card.querySelector('.flip-flap-bottom span'),
      current:      null
    };
  });

  function update() {
    const now = new Date();
    let months, days, hours, minutes, seconds;
    if (target <= now) {
      months = days = hours = minutes = seconds = 0;
    } else {
      months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
      if (
        target.getDate() < now.getDate() ||
        (target.getDate() === now.getDate() &&
          (target.getHours() < now.getHours() ||
            (target.getHours() === now.getHours() && target.getMinutes() < now.getMinutes())))
      ) {
        months -= 1;
      }
      if (months < 0) months = 0;

      const after = new Date(now);
      after.setMonth(after.getMonth() + months);

      let remaining = target - after;
      const dayMs = 24 * 60 * 60 * 1000;
      days = Math.floor(remaining / dayMs);
      remaining -= days * dayMs;
      hours = Math.floor(remaining / (60 * 60 * 1000));
      remaining -= hours * 60 * 60 * 1000;
      minutes = Math.floor(remaining / (60 * 1000));
      remaining -= minutes * 60 * 1000;
      seconds = Math.floor(remaining / 1000);
    }

    flipTo(slots.months,  months);
    flipTo(slots.days,    days);
    flipTo(slots.hours,   hours);
    flipTo(slots.minutes, minutes);
    flipTo(slots.seconds, seconds);
  }

  function flipTo(slot, value) {
    if (!slot) return;
    const next = String(value).padStart(2, '0');
    if (slot.current === null) {
      slot.staticTop.textContent = next;
      slot.staticBottom.textContent = next;
      slot.current = next;
      return;
    }
    if (slot.current === next) return;

    slot.flapTop.textContent = slot.current;
    slot.flapBottom.textContent = next;
    slot.staticTop.textContent = next;

    slot.card.classList.remove('is-flipping');
    void slot.card.offsetWidth;
    slot.card.classList.add('is-flipping');

    setTimeout(() => {
      slot.staticBottom.textContent = next;
      slot.card.classList.remove('is-flipping');
    }, 620);

    slot.current = next;
  }

  update();

  // Pause when countdown is off-screen — no point updating DOM the user can't see.
  let countdownId = null;
  function startCountdown() { if (!countdownId) countdownId = setInterval(update, 1000); }
  function stopCountdown()  { if (countdownId) { clearInterval(countdownId); countdownId = null; } }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries[0].isIntersecting ? startCountdown() : stopCountdown();
    }, { threshold: 0 });
    io.observe(root);
  } else {
    startCountdown();
  }
})();

(function () {
  'use strict';

  // --- Apps Script endpoint ---
  const WORKER_URL = 'https://mikeandxan-rsvp.michael-afc.workers.dev';

  // --- Mobile nav toggle ---
  const navToggle = document.querySelector('.nav-toggle');
  const primaryNav = document.getElementById('primary-nav');

  if (navToggle && primaryNav) {
    navToggle.addEventListener('click', () => {
      const open = primaryNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    primaryNav.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        primaryNav.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // --- RSVP form ---
  const form = document.getElementById('rsvp-form');
  if (!form) return;

  const lookupFirstInput = document.getElementById('lookup-first');
  const lookupLastInput = document.getElementById('lookup-last');
  const lookupBtn = document.getElementById('lookup-btn');
  const lookupStatus = document.getElementById('lookup-status');
  const submitStatus = document.getElementById('submit-status');
  const householdContainer = document.getElementById('household-members');
  const householdPicker = document.getElementById('household-picker');
  const editRsvpBtn = document.getElementById('edit-rsvp-btn');
  const submitBtn = document.getElementById('rsvp-submit-btn');
  const stepFind = form.querySelector('[data-step="1"]');
  const stepPicker = form.querySelector('[data-step="picker"]');
  const stepConfirm = form.querySelector('[data-step="2"]');
  const stepAlready = form.querySelector('[data-step="already-submitted"]');
  const stepThanks = form.querySelector('[data-step="3"]');

  const DIETARY_OPTIONS = [
    { value: '', label: 'No preference' },
    { value: 'vegetarian', label: 'Vegetarian' },
    { value: 'vegan', label: 'Vegan' },
    { value: 'gluten-free', label: 'Gluten Free' },
    { value: 'other', label: 'Other (please specify)' }
  ];

  // Holds the household whose halt screen is showing, so the Edit button
  // can re-render the form pre-filled with that household's previous answers.
  let pendingEditHousehold = null;
  let editingMode = false;
  // True when the user arrived via the Change-RSVP email link. If their
  // household has already submitted, we skip the halt screen and drop
  // them straight into edit mode — clicking the email button already
  // signals intent to make changes.
  let autoEditFromEmail = false;
  // Tracks how many times we've shown the multi-match picker. After the
  // user has been here once and tried again, we offer a "contact us" out.
  let pickerVisitCount = 0;

  // ---- Lookup step ----
  // Pressing Enter inside either lookup field would otherwise submit the
  // whole form (because there's a type="submit" button further down in the
  // DOM), which fires the RSVP submit handler before any household is loaded.
  [lookupFirstInput, lookupLastInput].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        lookupBtn.click();
      }
    });
  });

  lookupBtn.addEventListener('click', async () => {
    const first = (lookupFirstInput.value || '').trim();
    const last = (lookupLastInput.value || '').trim();
    if (!first || !last) {
      setStatus(lookupStatus, 'Please enter both your first and last name.', 'error');
      return;
    }
    const q = first + ' ' + last;
    setStatus(lookupStatus, 'Looking up your invitation…', '');

    try {
      const result = await lookupHouseholds(q);
      const households = (result && result.households) || [];

      if (households.length === 0) {
        setStatus(
          lookupStatus,
          "We couldn't find that name. Try your full name as it appears on your invitation, or include a partner's name.",
          'error'
        );
        return;
      }

      if (households.length === 1) {
        loadHousehold(households[0]);
      } else {
        pickerVisitCount++;
        renderPicker(households);
        stepFind.hidden = true;
        stepPicker.hidden = false;
      }
    } catch (err) {
      console.error(err);
      setStatus(
        lookupStatus,
        "Something went wrong looking up your invitation. Please try again, or contact Mike & Xan at hello@mikeandxan.com.",
        'error'
      );
    }
  });

  // ---- Mirror `inert` to match `hidden` on each form step ----
  // The CSS keeps [hidden] steps rendered off-screen (so browser autofill
  // sees the email/phone fields on page load). The `inert` attribute makes
  // those off-screen steps non-focusable / non-clickable, matching the
  // behavior users expect from `hidden`.
  [stepFind, stepPicker, stepConfirm, stepAlready, stepThanks].forEach((step) => {
    if (!step) return;
    const sync = () => {
      if (step.hidden) step.setAttribute('inert', '');
      else step.removeAttribute('inert');
    };
    sync();
    new MutationObserver(sync).observe(step, {
      attributes: true,
      attributeFilter: ['hidden']
    });
  });

  // ---- Phone number auto-formatter — (xxx) xxx-xxxx as the user types ----
  const phoneEl = document.getElementById('phone');
  if (phoneEl) {
    phoneEl.addEventListener('input', () => {
      const digits = phoneEl.value.replace(/\D/g, '').slice(0, 10);
      let formatted;
      if (digits.length === 0)      formatted = '';
      else if (digits.length <= 3)  formatted = '(' + digits;
      else if (digits.length <= 6)  formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
      else                          formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
      phoneEl.value = formatted;
    });
  }

  // ---- Auto-lookup from email link (?name=Michael+Martin) ----
  // The Change-RSVP button in the confirmation email passes the guest's
  // name as a URL param. If we see one on page load, fill the inputs and
  // fire the lookup so they don't have to retype.
  (function () {
    try {
      const params = new URLSearchParams(location.search);
      const nameParam = params.get('name');
      if (!nameParam) return;
      const parts = nameParam.trim().split(/\s+/);
      if (parts.length < 2) return;
      autoEditFromEmail = true;
      lookupFirstInput.value = parts[0];
      lookupLastInput.value = parts.slice(1).join(' ');
      lookupBtn.click();
    } catch (_) {}
  })();

  // ---- Edit RSVP button on the halt screen ----
  if (editRsvpBtn) {
    editRsvpBtn.addEventListener('click', () => {
      if (!pendingEditHousehold) return;
      editingMode = true;
      renderHousehold(pendingEditHousehold, pendingEditHousehold.existing);
      stepAlready.hidden = true;
      stepConfirm.hidden = false;
      if (submitBtn) submitBtn.textContent = 'Update RSVP';
    });
  }

  // ---- Submit step ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Belt-and-suspenders: only run the submit logic when the confirmation
    // step is actually on screen.
    if (stepConfirm.hidden) return;

    const submission = collectSubmission();
    if (!submission) return;

    setStatus(submitStatus, editingMode ? 'Updating your RSVP…' : 'Submitting your RSVP…', '');

    try {
      const result = await submitRsvp(submission);

      if (result && result.error === 'duplicate') {
        const who = result.alreadySubmittedFor || 'someone in your household';
        setStatus(
          submitStatus,
          `It looks like an RSVP for ${who} has already been submitted. If you need to change your response, please email us at hello@mikeandxan.com and we'll take care of it.`,
          'error'
        );
        return;
      }

      if (!result || !result.ok) {
        setStatus(
          submitStatus,
          (result && result.error)
            ? `Submission failed: ${result.error}. Please email hello@mikeandxan.com if it keeps happening.`
            : "Submission failed — please try again, or email hello@mikeandxan.com.",
          'error'
        );
        return;
      }

      stepConfirm.hidden = true;
      const thanksHeading = stepThanks.querySelector('h3');
      const thanksBody = stepThanks.querySelector('p');
      if (editingMode) {
        if (thanksHeading) thanksHeading.textContent = 'Updated!';
        if (thanksBody) thanksBody.textContent = "Your RSVP has been updated. Thanks for letting us know.";
      }
      stepThanks.hidden = false;
      requestAnimationFrame(() => {
        stepThanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } catch (err) {
      console.error(err);
      setStatus(
        submitStatus,
        "Something went wrong submitting your RSVP. Please try again, or contact Mike & Xan at hello@mikeandxan.com.",
        'error'
      );
    }
  });

  // ---- Helpers ----

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-error', 'is-ok');
    if (kind === 'error') el.classList.add('is-error');
    if (kind === 'ok') el.classList.add('is-ok');
  }

  function loadHousehold(household) {
    if (household && household.alreadySubmitted) {
      if (autoEditFromEmail) {
        pendingEditHousehold = household;
        editingMode = true;
        renderHousehold(household, household.existing);
        stepFind.hidden = true;
        stepPicker.hidden = true;
        stepAlready.hidden = true;
        stepConfirm.hidden = false;
        if (submitBtn) submitBtn.textContent = 'Update RSVP';
        return;
      }
      showAlreadySubmitted(household);
      return;
    }
    editingMode = false;
    if (submitBtn) submitBtn.textContent = 'Submit RSVP';
    renderHousehold(household);
    stepFind.hidden = true;
    stepPicker.hidden = true;
    stepConfirm.hidden = false;
  }

  function showAlreadySubmitted(household) {
    pendingEditHousehold = household;
    const target = document.getElementById('already-submitted-name');
    if (target) target.textContent = household.alreadySubmittedFor || 'someone in your household';
    stepFind.hidden = true;
    stepPicker.hidden = true;
    stepConfirm.hidden = true;
    stepAlready.hidden = false;
  }

  function renderPicker(households) {
    householdPicker.innerHTML = '';
    households.forEach((h) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'household-pick-btn';
      btn.textContent = oxfordJoin(h.members.map(m => m.name));
      btn.addEventListener('click', () => loadHousehold(h));
      householdPicker.appendChild(btn);
    });

    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = 'household-pick-btn picker-back-btn';
    noneBtn.textContent = 'None of the above — try again';
    noneBtn.addEventListener('click', backToLookup);
    householdPicker.appendChild(noneBtn);

    if (pickerVisitCount >= 2) {
      const contactLink = document.createElement('a');
      contactLink.className = 'household-pick-btn picker-contact-link';
      contactLink.href = 'mailto:hello@mikeandxan.com';
      contactLink.textContent = "Don't see your name? Contact us.";
      householdPicker.appendChild(contactLink);
    }
  }

  function backToLookup() {
    stepPicker.hidden = true;
    stepFind.hidden = false;
    setStatus(lookupStatus, '', '');
    lookupFirstInput.focus();
    lookupFirstInput.select();
  }

  function renderHousehold(household, existing) {
    householdContainer.innerHTML = '';

    household.members.forEach((member, i) => {
      const memberId = 'm' + i;
      const wrap = document.createElement('div');
      wrap.className = 'household-member' + (member.isPlusOne ? ' household-member-plusone' : '');
      wrap.dataset.memberIndex = String(i);
      wrap.dataset.memberName = member.name;
      wrap.dataset.memberId = member.id;
      if (member.isPlusOne) wrap.dataset.isPlusOne = 'true';

      if (member.isPlusOne) {
        wrap.innerHTML = `
          <div class="member-name">Are you bringing a +1?</div>

          <div class="attending-toggle">
            <label>
              <input type="radio" name="bringing-${memberId}" value="yes" />
              Yes
            </label>
            <label>
              <input type="radio" name="bringing-${memberId}" value="no" />
              No
            </label>
          </div>

          <div class="plusone-details">
            <label for="plusone-name-${memberId}">+1's name</label>
            <input type="text" id="plusone-name-${memberId}" class="plusone-name" placeholder="First and last name" />

            <div class="dietary-row">
              <label for="dietary-${memberId}">Dietary preference (optional)</label>
              <select id="dietary-${memberId}" name="dietary-${memberId}">
                ${DIETARY_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
              </select>
              <input type="text" class="dietary-other" id="dietary-other-${memberId}" placeholder="Tell us more (e.g. nut allergy)" />
            </div>
          </div>
        `;

        householdContainer.appendChild(wrap);

        const details = wrap.querySelector('.plusone-details');
        const bringingRadios = wrap.querySelectorAll(`input[name="bringing-${memberId}"]`);
        bringingRadios.forEach(r => {
          r.addEventListener('change', () => {
            const yes = wrap.querySelector(`input[name="bringing-${memberId}"]:checked`);
            const isYes = !!(yes && yes.value === 'yes');
            details.classList.toggle('is-open', isYes);
            wrap.classList.toggle('is-bringing', isYes);
          });
        });

        const select = wrap.querySelector('select');
        const otherField = wrap.querySelector('.dietary-other');
        select.addEventListener('change', () => {
          otherField.classList.toggle('is-shown', select.value === 'other');
        });
      } else {
        wrap.innerHTML = `
          <div class="member-name">${escapeHtml(member.name)}</div>

          <div class="attending-toggle">
            <label>
              <input type="radio" name="attending-${memberId}" value="yes" />
              Will attend
            </label>
            <label>
              <input type="radio" name="attending-${memberId}" value="no" />
              Cannot attend
            </label>
          </div>

          <div class="dietary-row">
            <label for="dietary-${memberId}">Dietary preference (optional)</label>
            <select id="dietary-${memberId}" name="dietary-${memberId}">
              ${DIETARY_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
            <input type="text" class="dietary-other" id="dietary-other-${memberId}" placeholder="Tell us more (e.g. nut allergy)" />
          </div>
        `;

        householdContainer.appendChild(wrap);

        const select = wrap.querySelector('select');
        const otherField = wrap.querySelector('.dietary-other');
        select.addEventListener('change', () => {
          otherField.classList.toggle('is-shown', select.value === 'other');
        });
      }
    });

    if (existing) {
      prefillExisting(existing);
    } else {
      // Reset household-level fields in case the user came back from a previous render
      const emailEl = document.getElementById('email');
      const phoneEl = document.getElementById('phone');
      const songEl = document.getElementById('song-request');
      const pizzaEl = document.getElementById('pizza-topping');
      const notesEl = document.getElementById('notes');
      if (emailEl) emailEl.value = '';
      if (phoneEl) phoneEl.value = '';
      if (songEl) songEl.value = '';
      if (pizzaEl) pizzaEl.value = '';
      if (notesEl) notesEl.value = '';
      form.querySelectorAll('input[name="contact-method"]').forEach(r => { r.checked = false; });
    }
  }

  function prefillExisting(existing) {
    (existing.members || []).forEach((m, i) => {
      const memberEl = householdContainer.querySelector(`[data-member-index="${i}"]`);
      if (!memberEl) return;

      if (memberEl.dataset.isPlusOne === 'true') {
        const memberId = 'm' + i;
        if (m.bringingPlusOne === 'yes' || m.bringingPlusOne === 'no') {
          const radio = memberEl.querySelector(`input[name="bringing-${memberId}"][value="${m.bringingPlusOne}"]`);
          if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
          }
        }
        if (m.bringingPlusOne === 'yes' && m.actualName) {
          const nameInput = memberEl.querySelector('.plusone-name');
          if (nameInput) nameInput.value = m.actualName;
        }
      } else if (m.attending === 'yes' || m.attending === 'no') {
        const radio = memberEl.querySelector(`input[type="radio"][value="${m.attending}"]`);
        if (radio) radio.checked = true;
      }

      const select = memberEl.querySelector('select');
      const otherInput = memberEl.querySelector('.dietary-other');
      if (select && m.dietary) {
        select.value = m.dietary;
        if (m.dietary === 'other' && otherInput) {
          otherInput.value = m.dietaryOther || '';
          otherInput.classList.add('is-shown');
        }
      }
    });

    const emailEl = document.getElementById('email');
    const phoneEl = document.getElementById('phone');
    const songEl = document.getElementById('song-request');
    const pizzaEl = document.getElementById('pizza-topping');
    const notesEl = document.getElementById('notes');
    if (emailEl) emailEl.value = existing.email || '';
    if (phoneEl) phoneEl.value = existing.phone || '';
    if (songEl) songEl.value = existing.songRequest || '';
    if (pizzaEl) pizzaEl.value = existing.pizzaTopping || '';
    if (notesEl) notesEl.value = existing.notes || '';
    if (existing.contactMethod) {
      const radio = form.querySelector(`input[name="contact-method"][value="${cssAttrEscape(existing.contactMethod)}"]`);
      if (radio) radio.checked = true;
    }
  }

  function collectSubmission() {
    const memberEls = householdContainer.querySelectorAll('.household-member');
    if (memberEls.length === 0) {
      setStatus(submitStatus, "No household loaded — please look up your invitation first.", 'error');
      return null;
    }

    const members = [];
    let missingAttending = false;
    let missingBringing = false;
    let missingPlusOneName = false;

    memberEls.forEach((el) => {
      const i = el.dataset.memberIndex;
      const name = el.dataset.memberName;
      const id = el.dataset.memberId ? Number(el.dataset.memberId) : null;
      const isPlusOne = el.dataset.isPlusOne === 'true';
      const dietaryEl = el.querySelector(`#dietary-m${i}`);
      const dietaryOtherEl = el.querySelector(`#dietary-other-m${i}`);

      if (isPlusOne) {
        const bringingInput = el.querySelector(`input[name="bringing-m${i}"]:checked`);
        if (!bringingInput) {
          missingBringing = true;
          return;
        }
        const bringing = bringingInput.value;
        let actualName = '';
        if (bringing === 'yes') {
          const nameInput = el.querySelector('.plusone-name');
          actualName = nameInput ? nameInput.value.trim() : '';
          if (!actualName) {
            missingPlusOneName = true;
            return;
          }
        }
        members.push({
          id,
          name,
          isPlusOne: true,
          bringingPlusOne: bringing,
          actualName,
          attending: bringing === 'yes' ? 'yes' : 'no',
          dietary: bringing === 'yes' && dietaryEl ? dietaryEl.value : '',
          dietaryOther: bringing === 'yes' && dietaryOtherEl ? dietaryOtherEl.value.trim() : ''
        });
      } else {
        const attendingInput = el.querySelector(`input[name="attending-m${i}"]:checked`);
        if (!attendingInput) missingAttending = true;
        members.push({
          id,
          name,
          attending: attendingInput ? attendingInput.value : null,
          dietary: dietaryEl ? dietaryEl.value : '',
          dietaryOther: dietaryOtherEl ? dietaryOtherEl.value.trim() : ''
        });
      }
    });

    if (missingAttending) {
      setStatus(submitStatus, "Please mark each guest as attending or not attending.", 'error');
      return null;
    }
    if (missingBringing) {
      setStatus(submitStatus, "Please answer whether you're bringing a plus one.", 'error');
      return null;
    }
    if (missingPlusOneName) {
      setStatus(submitStatus, "Please let us know the name of your guest and we will add them to your RSVP.", 'error');
      return null;
    }

    const email = (document.getElementById('email').value || '').trim();
    const phone = (document.getElementById('phone').value || '').trim();
    const contactMethodInput = form.querySelector('input[name="contact-method"]:checked');
    const contactMethod = contactMethodInput ? contactMethodInput.value : '';

    if (!email) {
      setStatus(submitStatus, "Please add an email so we can be in touch.", 'error');
      return null;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus(submitStatus, "That email doesn't look right — please double-check.", 'error');
      return null;
    }
    if (!contactMethod) {
      setStatus(submitStatus, "Please choose a preferred contact method.", 'error');
      return null;
    }
    if (contactMethod === 'Text message' && !phone) {
      setStatus(submitStatus, "Please add a phone number, or choose Email as the preferred contact method.", 'error');
      return null;
    }
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      const valid = digits.length === 10 || (digits.length === 11 && digits[0] === '1');
      if (!valid) {
        setStatus(submitStatus, "That phone number doesn't look right — please enter a 10-digit US number.", 'error');
        return null;
      }
    }

    return {
      members,
      email,
      phone,
      contactMethod,
      songRequest: (document.getElementById('song-request').value || '').trim(),
      pizzaTopping: (document.getElementById('pizza-topping').value || '').trim(),
      notes: (document.getElementById('notes').value || '').trim(),
      editing: editingMode,
      submittedAt: new Date().toISOString()
    };
  }

  // ---- Backend calls (Apps Script) ----

  async function lookupHouseholds(query) {
    if (!WORKER_URL) {
      console.warn('WORKER_URL not set — using mock household for testing.');
      return {
        households: [{
          label: query + ' (mock household)',
          address: '123 Mock Street',
          members: [{ name: query }, { name: 'Mock Partner' }]
        }]
      };
    }
    const url = WORKER_URL + '?action=lookup&name=' + encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Lookup failed: ' + res.status);
    return res.json();
  }

  async function submitRsvp(submission) {
    if (!WORKER_URL) {
      console.warn('WORKER_URL not set — submission logged to console only:', submission);
      await new Promise(r => setTimeout(r, 500));
      return { ok: true };
    }
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'submit', payload: submission })
    });
    if (!res.ok) throw new Error('Submit failed: ' + res.status);
    return res.json();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function cssAttrEscape(s) {
    // Escape for use inside a CSS attribute selector value (we wrap in double quotes).
    return String(s).replace(/(["\\])/g, '\\$1');
  }

  function oxfordJoin(names) {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' & ' + names[1];
    return names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1];
  }

})();

/* ============================================================
   Email-link popover — globally intercept clicks on any mailto:
   anchor and offer the user a choice between opening their mail
   app or copying the address.
   ============================================================ */
(function () {
  'use strict';

  let activePopover = null;
  let activeOutsideHandler = null;

  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a[href^="mailto:"]');
    if (!anchor) return;
    if (anchor.closest('.email-popover')) return;
    e.preventDefault();
    showEmailMenu(anchor);
  });

  function showEmailMenu(anchor) {
    closePopover();

    const email = anchor.getAttribute('href').replace(/^mailto:/i, '').split('?')[0];

    const popover = document.createElement('div');
    popover.className = 'email-popover';

    const mailtoLink = document.createElement('a');
    mailtoLink.href = 'mailto:' + email;
    mailtoLink.className = 'email-popover-option';
    mailtoLink.textContent = 'Open in email app';
    mailtoLink.addEventListener('click', () => {
      // Let the browser handle the mailto. Close after.
      setTimeout(closePopover, 0);
    });
    popover.appendChild(mailtoLink);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'email-popover-option';
    copyBtn.textContent = 'Copy address (' + email + ')';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(email);
      copyBtn.textContent = ok ? 'Copied!' : 'Copy failed — ' + email;
      if (ok) setTimeout(closePopover, 900);
    });
    popover.appendChild(copyBtn);

    document.body.appendChild(popover);

    const rect = anchor.getBoundingClientRect();
    const popWidth = popover.offsetWidth;
    let left = rect.left + window.scrollX;
    if (left + popWidth > window.scrollX + document.documentElement.clientWidth - 8) {
      left = window.scrollX + document.documentElement.clientWidth - popWidth - 8;
    }
    popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popover.style.left = Math.max(8, left) + 'px';

    activePopover = popover;

    activeOutsideHandler = (ev) => {
      if (activePopover && !activePopover.contains(ev.target)) {
        closePopover();
      }
    };
    setTimeout(() => {
      document.addEventListener('click', activeOutsideHandler);
    }, 0);
  }

  function closePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
    if (activeOutsideHandler) {
      document.removeEventListener('click', activeOutsideHandler);
      activeOutsideHandler = null;
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through to fallback */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

})();

/* ============================================================
   Maps-link popover — clicks on any .maps-link anchor open a
   small menu offering Apple Maps or Google Maps.
   ============================================================ */
(function () {
  'use strict';

  let activePopover = null;
  let activeOutsideHandler = null;

  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a.maps-link');
    if (!anchor) return;
    if (anchor.closest('.maps-popover')) return;
    e.preventDefault();
    showMapsMenu(anchor);
  });

  function showMapsMenu(anchor) {
    closePopover();

    const query = anchor.getAttribute('data-maps-query') || anchor.textContent.trim();
    const encoded = encodeURIComponent(query);

    const popover = document.createElement('div');
    popover.className = 'email-popover maps-popover';

    const apple = document.createElement('a');
    apple.href = 'https://maps.apple.com/?q=' + encoded;
    apple.target = '_blank';
    apple.rel = 'noopener';
    apple.className = 'email-popover-option';
    apple.textContent = 'Open in Apple Maps';
    apple.addEventListener('click', () => setTimeout(closePopover, 0));
    popover.appendChild(apple);

    const google = document.createElement('a');
    google.href = 'https://www.google.com/maps/search/?api=1&query=' + encoded;
    google.target = '_blank';
    google.rel = 'noopener';
    google.className = 'email-popover-option';
    google.textContent = 'Open in Google Maps';
    google.addEventListener('click', () => setTimeout(closePopover, 0));
    popover.appendChild(google);

    document.body.appendChild(popover);

    const rect = anchor.getBoundingClientRect();
    const popWidth = popover.offsetWidth;
    let left = rect.left + window.scrollX;
    if (left + popWidth > window.scrollX + document.documentElement.clientWidth - 8) {
      left = window.scrollX + document.documentElement.clientWidth - popWidth - 8;
    }
    popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popover.style.left = Math.max(8, left) + 'px';

    activePopover = popover;

    activeOutsideHandler = (ev) => {
      if (activePopover && !activePopover.contains(ev.target)) {
        closePopover();
      }
    };
    setTimeout(() => {
      document.addEventListener('click', activeOutsideHandler);
    }, 0);
  }

  function closePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
    if (activeOutsideHandler) {
      document.removeEventListener('click', activeOutsideHandler);
      activeOutsideHandler = null;
    }
  }

})();


/* ============================================================
   FAQ accordion — animates the open/close of each details item.
   ============================================================ */
(function () {
  'use strict';

  document.querySelectorAll('#faq details').forEach(function (details) {
    var summary = details.querySelector('summary');
    var body    = details.querySelector('.faq-body');
    if (!summary || !body) return;

    summary.addEventListener('click', function (e) {
      e.preventDefault();

      if (details.open) {
        // Closing: lock height then animate to 0
        body.style.maxHeight = body.scrollHeight + 'px';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            body.style.maxHeight = '0';
          });
        });
        body.addEventListener('transitionend', function () {
          details.open = false;
        }, { once: true });
      } else {
        // Opening: set open, then animate from 0 to height
        details.open = true;
        body.style.maxHeight = '0';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            body.style.maxHeight = body.scrollHeight + 'px';
          });
        });
        body.addEventListener('transitionend', function () {
          body.style.maxHeight = 'none';
        }, { once: true });
      }
    });
  });
}());

/* ============================================================
   Polaroid lightbox + photo stacks
   ============================================================ */
(function () {
  'use strict';

  let overlay    = null;
  let navKeyFn   = null;

  // ── Gallery grid ──
  const grid = document.querySelector('.gallery-grid');
  if (grid) {
    const photos = Array.from(grid.querySelectorAll('img.polaroid'));
    const galleryData = photos.map(p => ({ src: p.src, alt: p.alt }));
    grid.addEventListener('click', (e) => {
      const img = e.target.closest('img.polaroid');
      if (!img) return;
      const idx = photos.indexOf(img);
      openLightbox(img.src, img.alt, img.getBoundingClientRect(), galleryData, idx);
    });
  }

  // ── Photo stacks ──
  function initStack(stack) {
    const photos = Array.from(stack.querySelectorAll('.stack-photo'));

    const event = stack.closest('.timeline-event');
    const isEven = event
      ? Array.from(event.parentElement.children).indexOf(event) % 2 === 1
      : false;
    const baseRot = isEven ? 2 : -2;

    function restingStyle(offset) {
      if (offset === 0) return { position: 'relative', zIndex: 10, transform: `rotate(${baseRot}deg)` };
      if (offset === 1) return { position: 'absolute', zIndex: 5, transform: 'rotate(5deg) translate(18px, 8px)' };
      return { position: 'absolute', zIndex: 3, transform: 'rotate(-6deg) translate(-14px, 12px)' };
    }

    function applyStyle(photo, style, transition) {
      photo.style.position = style.position;
      if (style.position === 'absolute') { photo.style.top = '0'; photo.style.left = '0'; }
      photo.style.zIndex = String(style.zIndex);
      photo.style.transition = transition;
      photo.style.transform = style.transform;
    }

    // idx=0 on load is instant. Advancing (animate=true) gives the card
    // leaving the front a two-phase "lift and tuck": it arcs up and over
    // — briefly above everything, scaled up like a hand picked it up —
    // then settles into its resting spot at the back of the stack.
    function showSlide(idx, animate) {
      const prevIdx = parseInt(stack.dataset.current) || 0;
      const outgoing = animate && photos.length > 1 ? photos[prevIdx] : null;

      photos.forEach((photo, i) => {
        const offset = (i - idx + photos.length) % photos.length;
        if (photo === outgoing && offset !== 0) {
          const lift = isEven ? 26 : -26;
          applyStyle(photo, {
            position: 'absolute',
            zIndex: 20,
            transform: `rotate(${baseRot + (isEven ? 10 : -10)}deg) translate(${lift}px, -34px) scale(1.06)`
          }, 'transform 0.16s ease-out');
          const rest = restingStyle(offset);
          setTimeout(() => applyStyle(photo, rest, 'transform 0.38s cubic-bezier(0.34, 1.2, 0.64, 1)'), 160);
          return;
        }
        applyStyle(photo, restingStyle(offset), 'transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1)');
      });
      stack.dataset.current = idx;
    }

    showSlide(0);

    // Auto-advance every few seconds so visitors notice there's more than
    // one photo — stops for good the moment someone interacts with this
    // stack themselves (click, swipe, or the expand button), so it never
    // fights a visitor already browsing through it. A random start delay
    // (rather than one shared setInterval) staggers stacks so they don't
    // all flip in unison.
    const AUTO_INTERVAL = 3500;
    let autoTimer = null;
    if (photos.length > 1) {
      const scheduleNext = () => {
        autoTimer = setTimeout(() => {
          const cur = parseInt(stack.dataset.current) || 0;
          showSlide((cur + 1) % photos.length, true);
          scheduleNext();
        }, AUTO_INTERVAL);
      };
      autoTimer = setTimeout(scheduleNext, Math.random() * AUTO_INTERVAL);
    }
    function stopAuto() {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    }

    // Click: advance stack (multi) or open lightbox (single)
    stack.addEventListener('click', (e) => {
      stopAuto();
      if (e.target.closest('.stack-expand')) return;
      if (photos.length > 1) {
        const cur = parseInt(stack.dataset.current) || 0;
        showSlide((cur + 1) % photos.length, true);
      } else {
        openLightbox(photos[0].src, photos[0].alt, photos[0].getBoundingClientRect());
      }
    });

    // Swipe on mobile — lock axis on first move so horizontal swipes
    // don't also scroll the page.
    let touchStartX = 0, touchStartY = 0, swipeAxis = null;
    stack.addEventListener('touchstart', (e) => {
      stopAuto();
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      swipeAxis = null;
    }, { passive: true });
    stack.addEventListener('touchmove', (e) => {
      if (swipeAxis === 'v') return;
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx < 4 && dy < 4) return;
      if (swipeAxis === null) swipeAxis = dx > dy ? 'h' : 'v';
      if (swipeAxis === 'h') e.preventDefault();
    }, { passive: false });
    stack.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      const cur = parseInt(stack.dataset.current) || 0;
      const dir = dx < 0 ? 1 : -1;
      showSlide((cur + dir + photos.length) % photos.length, true);
    }, { passive: true });

    // Expand button (desktop hover → opens lightbox)
    const expandBtn = document.createElement('button');
    expandBtn.className = 'stack-expand';
    expandBtn.setAttribute('aria-label', 'Expand photo');
    expandBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="#fde6d5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1h4v4M5 13H1V9M13 1L8 6M1 13l5-5"/></svg>';
    stack.appendChild(expandBtn);

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopAuto();
      const cur = parseInt(stack.dataset.current) || 0;
      const stackData = photos.map(p => ({ src: p.src, alt: p.alt }));
      openLightbox(photos[cur].src, photos[cur].alt, photos[cur].getBoundingClientRect(), stackData, cur);
    });
  }

  document.querySelectorAll('.photo-stack').forEach(initStack);

  // ── Lightbox ──
  function openLightbox(src, alt, thumbRect, stackPhotos, startIdx) {
    overlay = document.createElement('div');
    overlay.className = 'polaroid-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const allPhotos = stackPhotos || [{ src, alt }];
    let currentIdx  = startIdx || 0;

    const stackEl = document.createElement('div');
    stackEl.className = 'lb-stack';
    overlay.appendChild(stackEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'lb-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
    overlay.appendChild(closeBtn);

    const viewedCards = [];     // oldest→newest; last is current
    const STACK_CAP   = 6;

    const randRot = () => (Math.random() * 6 - 3).toFixed(2);

    function makeCard(photoSrc, photoAlt) {
      const img = document.createElement('img');
      img.src = photoSrc;
      img.alt = photoAlt;
      img.className = 'lb-card';
      const r = randRot();
      img.dataset.baseRot = r;
      img.style.setProperty('--rot', r + 'deg');
      return img;
    }

    function arrangeStack() {
      const n = viewedCards.length;
      viewedCards.forEach((card, i) => {
        const depth = n - 1 - i; // 0 = top/current
        const baseRot = parseFloat(card.dataset.baseRot) || 0;
        if (depth === 0) {
          card.style.transform = `rotate(${baseRot}deg)`;
          card.style.opacity   = '1';
          card.style.zIndex    = String(50 + i);
        } else {
          const tx     = depth * 14;
          const ty     = depth * 8;
          const extra  = depth * -1.6;
          const scale  = (1 - depth * 0.04).toFixed(3);
          const op     = Math.max(0, 1 - depth * 0.18).toFixed(2);
          card.style.transform = `translate(${tx}px, ${ty}px) rotate(${baseRot + extra}deg) scale(${scale})`;
          card.style.opacity   = op;
          card.style.zIndex    = String(50 + i);
        }
      });
      // Trim oldest beyond cap
      while (viewedCards.length > STACK_CAP) {
        const old = viewedCards.shift();
        old.style.opacity = '0';
        setTimeout(() => old.remove(), 350);
      }
    }

    function showPhoto(idx) {
      currentIdx = idx;
      const card = makeCard(allPhotos[idx].src, allPhotos[idx].alt);
      card.classList.add('lb-card-incoming');
      stackEl.appendChild(card);
      // Force layout, then settle into position to trigger slide-in
      requestAnimationFrame(() => {
        viewedCards.push(card);
        card.classList.remove('lb-card-incoming');
        arrangeStack();
      });
      overlay.querySelectorAll('.lb-dot').forEach((d, i) => {
        d.classList.toggle('is-active', i === idx);
      });
    }

    // First card — animated from thumb position
    const firstImg = makeCard(src, alt);
    stackEl.appendChild(firstImg);
    viewedCards.push(firstImg);

    // Click on a card → advance
    stackEl.addEventListener('click', (e) => {
      const card = e.target.closest('.lb-card');
      if (!card) return;
      e.stopPropagation();
      if (allPhotos.length > 1) {
        showPhoto((currentIdx + 1) % allPhotos.length);
      } else {
        closeLightbox();
      }
    });

    // Stack navigation (when more than one photo)
    if (allPhotos.length > 1) {
      const prev = document.createElement('button');
      prev.className = 'lb-nav lb-prev';
      prev.innerHTML = '&#8592;';
      prev.setAttribute('aria-label', 'Previous photo');

      const next = document.createElement('button');
      next.className = 'lb-nav lb-next';
      next.innerHTML = '&#8594;';
      next.setAttribute('aria-label', 'Next photo');

      const dots = document.createElement('div');
      dots.className = 'lb-dots';
      allPhotos.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'lb-dot' + (i === currentIdx ? ' is-active' : '');
        dot.setAttribute('aria-label', `Photo ${i + 1}`);
        dot.addEventListener('click', (e) => { e.stopPropagation(); showPhoto(i); });
        dots.appendChild(dot);
      });

      overlay.appendChild(prev);
      overlay.appendChild(next);
      overlay.appendChild(dots);

      prev.addEventListener('click', (e) => {
        e.stopPropagation();
        showPhoto((currentIdx - 1 + allPhotos.length) % allPhotos.length);
      });
      next.addEventListener('click', (e) => {
        e.stopPropagation();
        showPhoto((currentIdx + 1) % allPhotos.length);
      });

      // Swipe in lightbox
      let lbTouchX = 0;
      overlay.addEventListener('touchstart', (e) => { lbTouchX = e.touches[0].clientX; }, { passive: true });
      overlay.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - lbTouchX;
        if (Math.abs(dx) < 40) return; // tap → let click handlers run
        showPhoto((currentIdx + (dx < 0 ? 1 : -1) + allPhotos.length) % allPhotos.length);
      }, { passive: true });

      // Arrow keys
      navKeyFn = (e) => {
        if (e.key === 'ArrowLeft')  showPhoto((currentIdx - 1 + allPhotos.length) % allPhotos.length);
        if (e.key === 'ArrowRight') showPhoto((currentIdx + 1) % allPhotos.length);
      };
      document.addEventListener('keydown', navKeyFn);
    }

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      const imgRect = firstImg.getBoundingClientRect();
      const thumbCx = thumbRect.left + thumbRect.width  / 2;
      const thumbCy = thumbRect.top  + thumbRect.height / 2;
      const imgCx   = imgRect.left   + imgRect.width    / 2;
      const imgCy   = imgRect.top    + imgRect.height   / 2;
      const tx      = thumbCx - imgCx;
      const ty      = thumbCy - imgCy;
      const scale   = thumbRect.width / imgRect.width;
      const baseRot = parseFloat(firstImg.dataset.baseRot) || 0;

      firstImg.style.transition = 'none';
      firstImg.style.transform  = `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${baseRot}deg)`;
      firstImg.style.opacity    = '0';

      requestAnimationFrame(() => {
        firstImg.style.transition = 'transform .45s cubic-bezier(0.34, 1.4, 0.64, 1), opacity .2s ease';
        firstImg.style.transform  = `rotate(${baseRot}deg)`;
        firstImg.style.opacity    = '1';
        overlay.classList.add('is-open');
      });
    });

    overlay.addEventListener('click', (e) => {
      // Close only if clicking the overlay background, not a card or control
      if (e.target === overlay) closeLightbox();
    });
    document.addEventListener('keydown', onKey);
  }

  function closeLightbox() {
    if (!overlay) return;
    const bigImg = overlay.querySelector('img');
    if (bigImg) {
      bigImg.style.transition = 'transform .25s ease, opacity .2s ease';
      bigImg.style.transform  = 'scale(0.88)';
      bigImg.style.opacity    = '0';
    }
    overlay.classList.remove('is-open');
    setTimeout(() => {
      if (overlay) { overlay.remove(); overlay = null; }
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (navKeyFn) { document.removeEventListener('keydown', navKeyFn); navKeyFn = null; }
    }, 280);
  }

  function onKey(e) {
    if (e.key === 'Escape') closeLightbox();
  }
}());

/* ============================================================
   Reveal animations — fade-up on load (hero) + scroll
   ============================================================ */
(function () {
  'use strict';

  var SELECTORS = [
    '.section-hero .kicker',
    '.hero-name', '.hero-amp', '.hero-info', '.hero-actions',
    'section:not(#home) h2', '.section-lede', '.details-block',
    '#faq details', '#registry .registry-text > p'
  ].join(',');

  var HERO_SEL = '.section-hero .kicker, .hero-name, .hero-amp, .hero-info, .hero-actions';

  document.querySelectorAll(HERO_SEL).forEach(function (el, i) {
    el.style.setProperty('--reveal-delay', (i * 0.13) + 's');
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('anim-in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.12 });

  document.querySelectorAll(SELECTORS).forEach(function (el) { io.observe(el); });

  /* Timeline events: individual stagger, observed separately */
  document.querySelectorAll('.timeline-event').forEach(function (el) {
    el.style.setProperty('--reveal-delay', '0s');
    io.observe(el);
  });

  /* Draw the timeline line when the list scrolls into view */
  var lineIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('line-drawn');
      lineIO.unobserve(e.target);
    });
  }, { threshold: 0.05 });
  var tl = document.querySelector('.timeline');
  if (tl) lineIO.observe(tl);

  // Scribble draw-on animations
  var scribbleIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-drawn');
      scribbleIO.unobserve(e.target);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.scribble, .deco-amp, .scr').forEach(function (el) { scribbleIO.observe(el); });
}());

/* Randomise .scr positions on every page load */
(function () {
  'use strict';
  document.querySelectorAll('.scr').forEach(function (el) {
    if (el.dataset.fixed) return;
    var useRight = Math.random() > 0.5;
    var edge = (Math.random() * 6 + 1).toFixed(1) + '%';
    /* Keep scribbles out of the heading zone (roughly 15–45% from top) */
    var topPct = Math.random() > 0.5
      ? (Math.random() * 12 + 3)   /* 3–15% — sits in top padding above heading */
      : (Math.random() * 30 + 52); /* 52–82% — lower half of section */
    el.style.top    = topPct.toFixed(1) + '%';
    el.style.bottom = 'auto';
    if (useRight) {
      el.style.right = edge;
      el.style.left  = 'auto';
    } else {
      el.style.left  = edge;
      el.style.right = 'auto';
    }
    var existingRotate = (el.style.transform.match(/rotate\(([^)]+)\)/) || [])[1];
    var baseDeg = existingRotate ? parseFloat(existingRotate) : 0;
    var jitter = (Math.random() * 20 - 10).toFixed(1);
    el.style.transform = 'rotate(' + (baseDeg + parseFloat(jitter)).toFixed(1) + 'deg)';
  });
}());

/* ── Random polaroids (registry, details, FAQ) ──
   Each random slot gets a different polaroid, AND we exclude any polaroid
   already used in the timeline so nothing repeats across the page. */
(function () {
  function timelineUsedSrcs() {
    var used = new Set();
    document.querySelectorAll('#story .stack-photo').forEach(function (img) {
      var src = img.getAttribute('src');
      if (src) used.add(src);
    });
    return used;
  }

  async function assignRandomPolaroids(ids) {
    var pool = await getPolaroids();
    if (!pool.length) return;
    var used = timelineUsedSrcs();
    var available = pool.filter(function (src) { return !used.has(src); });

    // Shuffle available pool (Fisher–Yates)
    for (var i = available.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = available[i]; available[i] = available[j]; available[j] = tmp;
    }

    ids.forEach(function (id, idx) {
      var img = document.getElementById(id);
      if (!img || !available.length) return;
      var src = available[idx % available.length];
      var tilt = (Math.random() * 6 - 3).toFixed(1);
      img.src = src;
      img.style.transform = 'rotate(' + tilt + 'deg)';
    });
  }

  assignRandomPolaroids(['registry-polaroid', 'details-polaroid', 'faq-polaroid']);
}());

/* ── Canvas favicon + web app icon — DM Serif Display italic & once fonts load ── */
document.fonts.ready.then(function () {
  var size = 512;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f15826';
  try { ctx.roundRect(0, 0, size, size, size * 0.15); } catch (e) { ctx.rect(0, 0, size, size); }
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 16;
  ctx.font = 'italic 400 420px "DM Serif Display", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('&', size / 2, size * 0.82);
  ctx.strokeText('&', size / 2, size * 0.82);
  var png = canvas.toDataURL('image/png');
  var favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = png;
  var touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (touch) touch.href = png;
});

/* ============================================================
   Venue map — Google Maps JavaScript API.
   Pins: venue + nearby hotels. Loaded via async script in HTML;
   `initVenueMap` is the callback Google calls once the API is ready.
   ============================================================ */
function initVenueMap() {
  var el = document.getElementById('venue-map');
  if (!el || typeof google === 'undefined') return;

  var venue = {
    key: 'venue',
    lat: 38.9255115, lng: -94.7615422,
    name: 'The Thompson Barn',
    address: '11184 Lackman Rd, Lenexa, KS',
    isVenue: true
  };
  var hotels = [
    {
      key: 'embassy',
      lat: 38.9394847, lng: -94.7966108,
      name: 'Embassy Suites by Hilton — Olathe',
      address: '10401 S Ridgeview Rd, Olathe, KS 66061'
    }
  ];
  var parking = {
    key: 'parking',
    lat: 38.9249020069167, lng: -94.76180747762298,
    name: 'Event Parking',
    address: '11184 Lackman Rd, Lenexa, KS',
    isParking: true
  };
  var allPoints = [venue].concat(hotels).concat([parking]);
  var pinByKey = {};

  var map = new google.maps.Map(el, {
    center: { lat: venue.lat, lng: venue.lng },
    zoom: 13,
    gestureHandling: 'cooperative',
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: true,
    zoomControl: true,
    styles: [
      // Base — lighter than the page bg so the map pops from the section
      { elementType: 'geometry', stylers: [{ color: '#faf3e4' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#2b1f1a' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#faf3e4' }, { weight: 3 }] },
      { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

      // Hide most POIs and transit clutter
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'poi.park', stylers: [{ visibility: 'simplified' }] },
      { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#c8d1ac' }] },
      { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6e7a4e' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },

      // Landscape
      { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f6eed9' }] },
      { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#ece1c4' }] },

      // Administrative
      { featureType: 'administrative', stylers: [{ visibility: 'simplified' }] },
      { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#2b1f1a' }] },

      // Roads
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#fffaee' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#5a4a3a' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f0c8b8' }] },
      { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#eb5519' }, { weight: 0.6 }] },
      { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#faecd0' }] },
      { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#fdf7e8' }] },

      // Water — muted grey-green so it doesn't fight the warm palette
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#bfc6b8' }] },
      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6e7a4e' }] }
    ]
  });

  var infoWindow = new google.maps.InfoWindow();

  allPoints.forEach(function (p) {
    var fillColor = '#6e7a4e';        // hotel default (olive)
    if (p.isVenue)   fillColor = '#eb5519';   // venue red
    if (p.isParking) fillColor = '#c79232';   // parking gold

    var marker = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map: map,
      title: p.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: p.isVenue ? 11 : 8,
        fillColor: fillColor,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3
      },
      zIndex: p.isParking ? 2 : 3
    });

    var query = encodeURIComponent(p.name + ', ' + p.address);
    var directionsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + query;
    var content =
      '<div class="map-popup">' +
        '<strong>' + p.name + '</strong><br>' +
        p.address + '<br>' +
        '<a href="' + directionsUrl + '" target="_blank" rel="noopener">Directions</a>' +
      '</div>';

    function openPin() {
      infoWindow.setContent(content);
      infoWindow.open({ anchor: marker, map: map });
      if (p.isParking) {
        map.setMapTypeId('hybrid');
        map.setZoom(18);
        map.setCenter({ lat: p.lat, lng: p.lng });
      } else {
        map.panTo({ lat: p.lat, lng: p.lng });
      }
      marker.setAnimation(google.maps.Animation.BOUNCE);
      setTimeout(function () { marker.setAnimation(null); }, 1400);
    }
    marker.addListener('click', openPin);
    pinByKey[p.key] = { marker: marker, openPin: openPin, content: content };
  });

  var bounds = new google.maps.LatLngBounds();
  allPoints.forEach(function (p) { bounds.extend({ lat: p.lat, lng: p.lng }); });
  map.fitBounds(bounds, 60);

  var venuePin = pinByKey['venue'];
  if (venuePin) {
    google.maps.event.addListenerOnce(map, 'idle', function () {
      venuePin.openPin();
    });
  }

  // Wire up the legend below the map — clicking a legend entry opens its pin.
  document.querySelectorAll('.venue-map-legend [data-pin]').forEach(function (li) {
    var key = li.getAttribute('data-pin');
    var pin = pinByKey[key];
    if (!pin) return;
    li.addEventListener('click', pin.openPin);
    li.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pin.openPin();
      }
    });
  });

  initParkingMap();
}
window.initVenueMap = initVenueMap;

/* Parking detail map — satellite view, zoomed in, single pin. */
function initParkingMap() {
  var el = document.getElementById('parking-map');
  if (!el || typeof google === 'undefined') return;

  var spot = { lat: 38.9249020069167, lng: -94.76180747762298 };

  var map = new google.maps.Map(el, {
    center: spot,
    zoom: 18,
    mapTypeId: 'hybrid',
    gestureHandling: 'cooperative',
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: true,
    zoomControl: true,
    tilt: 0
  });

  new google.maps.Marker({
    position: spot,
    map: map,
    title: 'Parking',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 11,
      fillColor: '#eb5519',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 3
    }
  });

  // Force re-render when the FAQ <details> opens (otherwise Google Maps
  // renders into a 0×0 container and stays grey until you interact).
  var detailsEl = el.closest('details');
  if (detailsEl) {
    detailsEl.addEventListener('toggle', function () {
      if (detailsEl.open) {
        setTimeout(function () {
          google.maps.event.trigger(map, 'resize');
          map.setCenter(spot);
        }, 50);
      }
    });
  }
}

/* Photo break + heart pin sliders removed once values were locked in.
   Values now live in the inline `style` of .photo-break.has-heart-eyes
   in index.html. Restore from git history if re-tuning is needed. */

/* ---- Branded dropdowns ----
   The closed <select> box is styleable, but the open options menu is
   drawn by the OS and can't be branded. So each .rsvp-form select is
   replaced with a button + styled list that proxies the hidden native
   select (form logic keeps reading select.value unchanged). Member
   blocks are built dynamically, so a MutationObserver enhances new
   selects as they appear. */
(function () {
  'use strict';

  function closeAll(except) {
    document.querySelectorAll('.mx-select.is-open').forEach(function (w) {
      if (w !== except) {
        w.classList.remove('is-open');
        w.querySelector('.mx-select-btn').setAttribute('aria-expanded', 'false');
      }
    });
  }

  function enhance(sel) {
    sel.dataset.mxEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'mx-select';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('mx-select-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mx-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    wrap.appendChild(btn);

    const menu = document.createElement('ul');
    menu.className = 'mx-select-menu';
    menu.setAttribute('role', 'listbox');
    wrap.appendChild(menu);

    const options = [];
    Array.prototype.forEach.call(sel.options, function (o) {
      const li = document.createElement('li');
      li.className = 'mx-option';
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      li.dataset.value = o.value;
      li.textContent = o.textContent;
      menu.appendChild(li);
      options.push(li);
    });

    function sync() {
      const cur = sel.options[sel.selectedIndex];
      btn.textContent = cur ? cur.textContent : '';
      options.forEach(function (li) {
        li.classList.toggle('is-selected', li.dataset.value === sel.value);
      });
    }
    sync();

    function open() {
      closeAll(wrap);
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      const cur = options.find ? options.find(function (li) { return li.dataset.value === sel.value; }) : null;
      (cur || options[0]).focus();
    }
    function close(refocus) {
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
    function choose(li) {
      sel.value = li.dataset.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close(true);
    }

    btn.addEventListener('click', function () {
      wrap.classList.contains('is-open') ? close(true) : open();
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
    });

    menu.addEventListener('click', function (e) {
      const li = e.target.closest('.mx-option');
      if (li) choose(li);
    });
    menu.addEventListener('keydown', function (e) {
      const li = e.target.closest('.mx-option');
      if (!li) return;
      const i = options.indexOf(li);
      if (e.key === 'ArrowDown') { e.preventDefault(); (options[i + 1] || options[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (options[i - 1] || options[options.length - 1]).focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(li); }
      else if (e.key === 'Tab') { close(false); }
    });

    // Programmatic prefill (edit-RSVP flow sets select.value directly,
    // no change event) — re-sync whenever the menu is about to matter.
    sel.addEventListener('change', sync);
    wrap.addEventListener('focusin', sync);
  }

  function scan() {
    document.querySelectorAll('.rsvp-form select:not([data-mx-enhanced])').forEach(enhance);
  }

  // Escape closes an open menu before the site's admin-login Escape
  // shortcut can see the keypress; outside clicks close too.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.querySelector('.mx-select.is-open')) {
      e.stopImmediatePropagation();
      e.preventDefault();
      closeAll(null);
    }
  }, true);
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.mx-select')) closeAll(null);
  });

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
