/* ============================================================
   Mike & Xan — Wedding Site
   Frontend JS: nav toggle + RSVP form
   ============================================================ */

/* ── Polaroid discovery — probes assets/Polaroid-1.png, 2, 3…
      until a 404, so adding new files is automatic everywhere. ── */
var _polaroidCache = null;
async function getPolaroids() {
  if (_polaroidCache) return _polaroidCache;
  var found = [];
  for (var i = 1; i <= 99; i++) {
    try {
      var res = await fetch('assets/Polaroid-' + i + '.png', { method: 'HEAD' });
      if (!res.ok) break;
      found.push('assets/Polaroid-' + i + '.png');
    } catch (e) { break; }
  }
  _polaroidCache = found;
  return found;
}

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

  const FONTS = [
    '"Fraunces", serif',
    '"Playfair Display", serif',
    '"DM Serif Display", serif',
    '"Bodoni Moda", serif',
    '"Pinyon Script", cursive',
    '"Special Elite", monospace',
    '"Italianno", cursive',
    '"Yeseva One", serif',
    '"Abril Fatface", serif',
    '"Cormorant Garamond", serif',
    '"Petit Formal Script", cursive',
    '"Carattere", cursive',
  ];

  // Weighted glyph pool — & dominates, "and" / "+" appear occasionally.
  const GLYPHS = ['&', '&', '&', '&', '&', '&', '&', 'and', '+'];

  let i = 0;
  let lastWasSpecial = false;
  const FRAME_MS = 1000 / 3; // 3fps

  function pickGlyph() {
    // Force & after any non-& so "and" and "+" never appear back-to-back.
    if (lastWasSpecial) { lastWasSpecial = false; return '&'; }
    const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    if (g !== '&') lastWasSpecial = true;
    return g;
  }

  function tick() {
    i = (i + 1) % FONTS.length;
    amp.style.fontFamily = FONTS[i];
    amp.textContent = pickGlyph();
    // Subtle wiggle: ±3px translate, ±4° rotate, ±5% scale.
    const tx = (Math.random() * 6 - 3).toFixed(2);
    const ty = (Math.random() * 6 - 3).toFixed(2);
    const rot = (Math.random() * 8 - 4).toFixed(2);
    const scale = (1 + (Math.random() * 0.1 - 0.05)).toFixed(3);
    amp.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${scale})`;
  }

  // Wait for fonts to be loaded before cycling, so first frames don't fall back.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => setInterval(tick, FRAME_MS));
  } else {
    setInterval(tick, FRAME_MS);
  }
})();

/* ============================================================
   Hero countdown — proper flip-clock cards counting down to the
   wedding (Saturday Nov 14, 2026, 5:30pm CST / UTC-6).

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
  const target = new Date('2026-11-14T17:30:00-06:00');
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
  setInterval(update, 1000);
})();

(function () {
  'use strict';

  // --- Apps Script endpoint ---
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyMb-WTUEot-fa5LroXVE28lJZ4IWuNvf2-Qz4-UwEfop-vu4D-28GjxmIVjiXBo5vJJg/exec';

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

          <div class="plusone-details" hidden>
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
            details.hidden = !(yes && yes.value === 'yes');
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
      setStatus(submitStatus, "Please add your plus one's name (or change the answer to no).", 'error');
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
    if (!APPS_SCRIPT_URL) {
      console.warn('APPS_SCRIPT_URL not set — using mock household for testing.');
      return {
        households: [{
          label: query + ' (mock household)',
          address: '123 Mock Street',
          members: [{ name: query }, { name: 'Mock Partner' }]
        }]
      };
    }
    const url = APPS_SCRIPT_URL + '?action=lookup&name=' + encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Lookup failed: ' + res.status);
    return res.json();
  }

  async function submitRsvp(submission) {
    if (!APPS_SCRIPT_URL) {
      console.warn('APPS_SCRIPT_URL not set — submission logged to console only:', submission);
      await new Promise(r => setTimeout(r, 500));
      return { ok: true };
    }
    const res = await fetch(APPS_SCRIPT_URL, {
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
   Dev copy-editor — Cmd/Ctrl+Click any text on the page to edit
   it inline. A small widget in the corner tracks pending changes
   and lets you copy the diff so the source files can be updated.
   Only runs on localhost / private LAN — never on the public site.
   ============================================================ */
(function () {
  'use strict';

  const host = window.location.hostname;
  const isDev =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!isDev) return;

  const edits = new Map(); // element → { originalText, originalHTML, originalOuterHTML, isDeleted }
  const deleteBadges = new Map(); // element → badge DOM node
  let widget = null;

  document.addEventListener('click', (e) => {
    if (!e.metaKey && !e.ctrlKey) return;
    const target = e.target;
    if (!isEditable(target)) return;
    e.preventDefault();
    e.stopPropagation();
    makeEditable(target);
  }, true);

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IMG', 'SVG'].indexOf(tag) !== -1) return false;
    if (el.closest('#dev-edit-widget')) return false;
    if (el.isContentEditable) return false;
    if (!el.textContent || !el.textContent.trim()) return false;
    return true;
  }

  // Returns outerHTML with JS-added runtime classes stripped so it matches the source file.
  function sourceOuterHTML(el) {
    const clone = el.cloneNode(true);
    clone.classList.remove('anim-in', 'dev-editing', 'is-open');
    if (clone.classList.length === 0) clone.removeAttribute('class');
    return clone.outerHTML;
  }

  function makeEditable(el) {
    if (!edits.has(el)) {
      edits.set(el, {
        originalText: el.textContent,
        originalHTML: el.innerHTML,
        originalOuterHTML: sourceOuterHTML(el),
        isDeleted: false
      });
    }
    el.contentEditable = 'true';
    el.classList.add('dev-editing');
    el.focus();

    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    el.addEventListener('blur', onBlur, { once: true });
    showDeleteBadge(el);
    showWidget();
  }

  function showDeleteBadge(el) {
    if (deleteBadges.has(el)) {
      positionBadge(el, deleteBadges.get(el));
      return;
    }
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'dev-delete-badge';
    badge.title = 'Delete this element entirely';
    badge.textContent = '×';
    badge.addEventListener('mousedown', (e) => {
      // Prevent the editable element from losing focus before the click fires.
      e.preventDefault();
    });
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteElement(el);
    });
    document.body.appendChild(badge);
    deleteBadges.set(el, badge);
    positionBadge(el, badge);
  }

  function positionBadge(el, badge) {
    const rect = el.getBoundingClientRect();
    badge.style.top = (rect.top + window.scrollY - 12) + 'px';
    badge.style.left = (rect.right + window.scrollX - 12) + 'px';
  }

  function repositionAllBadges() {
    deleteBadges.forEach((badge, el) => {
      if (!document.contains(el)) {
        badge.remove();
        deleteBadges.delete(el);
      } else {
        positionBadge(el, badge);
      }
    });
  }

  window.addEventListener('scroll', repositionAllBadges, { passive: true });
  window.addEventListener('resize', repositionAllBadges, { passive: true });

  function deleteElement(el) {
    if (!edits.has(el)) {
      edits.set(el, {
        originalText: el.textContent,
        originalHTML: el.innerHTML,
        originalOuterHTML: sourceOuterHTML(el),
        isDeleted: true
      });
    } else {
      edits.get(el).isDeleted = true;
    }
    el.dataset.devDeleted = 'true';
    el.style.display = 'none';
    el.contentEditable = 'false';
    el.classList.remove('dev-editing');

    const badge = deleteBadges.get(el);
    if (badge) {
      badge.remove();
      deleteBadges.delete(el);
    }
    updateWidget();
  }

  function onBlur(e) {
    const el = e.target;
    el.classList.remove('dev-editing');
    el.contentEditable = 'false';
    const original = edits.get(el);
    if (original && !original.isDeleted && el.textContent === original.originalText) {
      edits.delete(el);
      const badge = deleteBadges.get(el);
      if (badge) {
        badge.remove();
        deleteBadges.delete(el);
      }
    }
    updateWidget();
  }

  function showWidget() {
    if (widget) return updateWidget();
    widget = document.createElement('div');
    widget.id = 'dev-edit-widget';
    widget.innerHTML =
      '<div class="dev-edit-header">' +
        '<span>✎ Copy editor</span>' +
        '<button type="button" id="dev-edit-close" title="Close (keeps edits in DOM)">×</button>' +
      '</div>' +
      '<div class="dev-edit-count">No changes yet</div>' +
      '<div class="dev-edit-list"></div>' +
      '<div class="dev-edit-actions">' +
        '<button type="button" id="dev-edit-save">Save to file</button>' +
        '<button type="button" id="dev-edit-undo">Undo all</button>' +
      '</div>' +
      '<div id="dev-edit-output" hidden></div>';
    document.body.appendChild(widget);
    document.getElementById('dev-edit-save').onclick = saveChangesToFile;
    document.getElementById('dev-edit-undo').onclick = undoAll;
    document.getElementById('dev-edit-close').onclick = closeWidget;
    updateWidget();
  }

  function updateWidget() {
    if (!widget) return;
    const n = edits.size;
    widget.querySelector('.dev-edit-count').textContent =
      n === 0 ? 'No changes yet — Cmd-click any text to edit.' :
      n === 1 ? '1 pending change:' :
      n + ' pending changes:';

    const list = widget.querySelector('.dev-edit-list');
    list.innerHTML = '';
    edits.forEach((data, el) => {
      const row = document.createElement('div');
      row.className = 'dev-edit-row' + (data.isDeleted ? ' dev-edit-row-deleted' : '');

      const xBtn = document.createElement('button');
      xBtn.type = 'button';
      xBtn.className = 'dev-edit-row-undo';
      xBtn.title = 'Revert this change';
      xBtn.textContent = '↶';
      xBtn.onclick = () => undoOne(el);

      const label = document.createElement('div');
      label.className = 'dev-edit-row-label';
      const preview = data.originalText.trim().slice(0, 60);
      if (data.isDeleted) {
        label.title = 'DELETED: ' + data.originalText.trim();
        label.textContent = 'deleted: ' + preview;
      } else {
        label.title = data.originalText.trim() + ' → ' + el.textContent.trim();
        label.textContent = el.textContent.trim();
      }

      row.appendChild(xBtn);
      row.appendChild(label);
      list.appendChild(row);
    });
    list.hidden = n === 0;
  }

  function undoOne(el) {
    const data = edits.get(el);
    if (!data) return;
    if (data.isDeleted) {
      el.style.display = '';
      delete el.dataset.devDeleted;
    } else {
      el.innerHTML = data.originalHTML;
    }
    el.contentEditable = 'false';
    el.classList.remove('dev-editing');
    edits.delete(el);
    const badge = deleteBadges.get(el);
    if (badge) {
      badge.remove();
      deleteBadges.delete(el);
    }
    updateWidget();
  }

  function describePath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 5) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) {
        p += '#' + cur.id;
      } else if (typeof cur.className === 'string') {
        const cls = cur.className.split(/\s+/)
          .filter(c => c && !c.startsWith('dev-'))
          .slice(0, 2)
          .join('.');
        if (cls) p += '.' + cls;
      }
      parts.unshift(p);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  async function saveChangesToFile() {
    const out = document.getElementById('dev-edit-output');
    out.innerHTML = '';
    if (edits.size === 0) {
      renderOutput(out, 'No changes to save.');
      return;
    }

    const payload = { edits: [] };
    const editList = [];
    edits.forEach((data, el) => {
      let newHTML;
      if (data.isDeleted) {
        newHTML = '';
      } else {
        // Strip dev-editor artifacts before serializing.
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
        el.classList.remove('dev-editing');
        if (el.classList.length === 0) el.removeAttribute('class');
        newHTML = el.outerHTML;
      }
      payload.edits.push({
        originalOuterHTML: data.originalOuterHTML,
        newOuterHTML: newHTML
      });
      editList.push({ el, data });
    });

    renderOutput(out, 'Saving…');

    let resp;
    try {
      const res = await fetch('/dev-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      resp = await res.json();
    } catch (err) {
      renderOutput(out,
        'Save failed: ' + err.message + '\n\n' +
        'Make sure dev-server.py is running (not the basic http.server).\n' +
        'Run from the project root: python3 dev-server.py\n\n' +
        showDiffText()
      );
      return;
    }

    const lines = [];
    const results = (resp && resp.results) || [];
    let okCount = 0;
    results.forEach((r, idx) => {
      if (r.ok) {
        okCount++;
        lines.push('✓ Change ' + (idx + 1) + ' written to ' + r.file);
      } else {
        lines.push('✗ Change ' + (idx + 1) + ' failed: ' + r.error);
        if (r.snippet) lines.push('   snippet: ' + r.snippet);
      }
    });
    lines.push('');
    lines.push(okCount + ' of ' + results.length + ' changes saved.');
    if (okCount === results.length) {
      // Clear pending edits since they're all on disk now.
      edits.clear();
      updateWidget();
      lines.push('Refresh the page to see the saved version from disk.');
    }
    renderOutput(out, lines.join('\n'));
  }

  function renderOutput(out, text) {
    out.innerHTML = '';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dev-output-close';
    closeBtn.title = 'Discard all pending changes';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => {
      undoAll(true);
    };
    out.appendChild(closeBtn);

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.rows = Math.min(20, text.split('\n').length + 2);
    ta.spellcheck = false;
    ta.readOnly = true;
    out.appendChild(ta);

    out.hidden = false;
  }

  function showDiffText() {
    const lines = [];
    let i = 1;
    edits.forEach((data, el) => {
      lines.push('=== Change ' + (i++) + ' ===');
      lines.push('Element: ' + describePath(el));
      lines.push('Before: ' + data.originalText.trim());
      lines.push('After:  ' + el.textContent.trim());
      lines.push('');
    });
    return lines.join('\n');
  }

  function undoAll(skipConfirm) {
    if (edits.size === 0) {
      const out = document.getElementById('dev-edit-output');
      if (out) { out.hidden = true; out.innerHTML = ''; }
      return;
    }
    if (!skipConfirm && !confirm('Undo all ' + edits.size + ' changes?')) return;
    edits.forEach((data, el) => {
      if (data.isDeleted) {
        el.style.display = '';
        delete el.dataset.devDeleted;
      } else {
        el.innerHTML = data.originalHTML;
      }
      el.contentEditable = 'false';
      el.classList.remove('dev-editing');
    });
    edits.clear();
    deleteBadges.forEach((badge) => badge.remove());
    deleteBadges.clear();
    updateWidget();
    const out = document.getElementById('dev-edit-output');
    if (out) { out.hidden = true; out.innerHTML = ''; }
  }

  function closeWidget() {
    if (widget) widget.remove();
    widget = null;
  }


})();

/* ============================================================
   Timeline CMS — localhost only. Edit button on each event opens
   a modal to update date / title / copy / photos, then saves to
   disk via dev-server.py and commits via git.
   ============================================================ */
(function () {
  'use strict';

  const host = window.location.hostname;
  const isDev = host === 'localhost' || host === '127.0.0.1' ||
    /^192\.168\./.test(host) || /^10\./.test(host);
  if (!isDev) return;

  // Strip JS-added runtime attributes so the HTML matches the source file
  function sourceHTML(li) {
    const clone = li.cloneNode(true);
    clone.classList.remove('anim-in');
    clone.removeAttribute('style');
    if (clone.classList.length === 0) clone.removeAttribute('class');
    else clone.setAttribute('class', clone.className);
    const editBtn = clone.querySelector('.cms-edit-btn');
    if (editBtn) editBtn.remove();
    // story-accent spans are injected at runtime — strip them back to plain text
    clone.querySelectorAll('.story-accent').forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    const stack = clone.querySelector('.photo-stack');
    if (stack) {
      stack.removeAttribute('data-current');
      stack.removeAttribute('style');
      const btn = stack.querySelector('.stack-expand');
      if (btn) btn.remove();
      stack.querySelectorAll('.stack-photo').forEach(img => img.removeAttribute('style'));
    }
    return clone.outerHTML;
  }

  function buildNewHTML(li, date, title, body, photos) {
    const clone = li.cloneNode(true);
    clone.classList.remove('anim-in');
    clone.removeAttribute('style');
    if (clone.classList.length === 0) clone.removeAttribute('class');

    const dateEl = clone.querySelector('.timeline-date');
    if (dateEl) dateEl.textContent = date;

    const titleEl = clone.querySelector('h3');
    if (titleEl) titleEl.textContent = title;

    const bodyEls = clone.querySelectorAll('.timeline-content p:not(.timeline-date)');
    if (bodyEls.length) bodyEls[0].textContent = body;

    const stack = clone.querySelector('.photo-stack');
    if (stack) {
      stack.removeAttribute('data-current');
      stack.removeAttribute('style');
      const btn = stack.querySelector('.stack-expand');
      if (btn) btn.remove();
      stack.querySelectorAll('.stack-photo').forEach(img => img.remove());
      photos.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '[Photo TBD]';
        img.className = 'stack-photo';
        stack.appendChild(img);
      });
    }
    return clone.outerHTML;
  }

  async function openModal(li) {
    const dateText  = (li.querySelector('.timeline-date')  || {}).textContent || '';
    const titleText = (li.querySelector('h3')              || {}).textContent || '';
    const bodyEl    = li.querySelector('.timeline-content p:not(.timeline-date)');
    const bodyText  = bodyEl ? bodyEl.textContent : '';
    const currentPhotos = Array.from(li.querySelectorAll('.stack-photo'))
      .map(img => img.src.replace(window.location.origin, '').replace(/^\//, ''));

    const overlay = document.createElement('div');
    overlay.className = 'cms-overlay';

    const modal = document.createElement('div');
    modal.className = 'cms-modal';
    modal.innerHTML = `
      <h3>Edit Timeline Event</h3>
      <div class="cms-field"><label>Date</label><input type="text" class="cms-date" value="${dateText}"></div>
      <div class="cms-field"><label>Title</label><input type="text" class="cms-title" value="${titleText}"></div>
      <div class="cms-field"><label>Body Copy</label><textarea class="cms-body"></textarea></div>
      <div class="cms-photos-label">Photos — click to select up to 3, in order</div>
      <div class="cms-photo-grid"></div>
      <div class="cms-actions">
        <button class="cms-save">Save &amp; Commit</button>
        <button class="cms-cancel">Cancel</button>
        <span class="cms-status"></span>
      </div>
    `;
    modal.querySelector('.cms-body').value = bodyText;

    // Build photo picker
    const grid = modal.querySelector('.cms-photo-grid');
    const selected = [...currentPhotos];

    const allPolaroids = await getPolaroids();
    allPolaroids.forEach((src, i) => {
      const item = document.createElement('div');
      item.className = 'cms-photo-item';
      item.dataset.src = src;
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Polaroid ' + (i + 1);
      const badge = document.createElement('span');
      badge.className = 'cms-photo-badge';
      item.appendChild(img);
      item.appendChild(badge);
      grid.appendChild(item);

      const idx = selected.indexOf(src);
      if (idx !== -1) {
        item.classList.add('selected');
        badge.textContent = idx + 1;
      }

      item.addEventListener('click', () => {
        const pos = selected.indexOf(src);
        if (pos !== -1) {
          selected.splice(pos, 1);
          item.classList.remove('selected');
        } else {
          if (selected.length >= 3) return;
          selected.push(src);
          item.classList.add('selected');
        }
        // Refresh all badges
        grid.querySelectorAll('.cms-photo-item').forEach(it => {
          const p = selected.indexOf(it.dataset.src);
          const b = it.querySelector('.cms-photo-badge');
          it.classList.toggle('selected', p !== -1);
          b.textContent = p !== -1 ? p + 1 : '';
        });
      });
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modal.querySelector('.cms-date').focus();

    // Cancel
    modal.querySelector('.cms-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Save & Commit
    modal.querySelector('.cms-save').addEventListener('click', async () => {
      const status  = modal.querySelector('.cms-status');
      const dateVal = modal.querySelector('.cms-date').value.trim();
      const titleVal = modal.querySelector('.cms-title').value.trim();
      const bodyVal  = modal.querySelector('.cms-body').value.trim();

      if (!dateVal || !titleVal) { status.textContent = 'Date and title are required.'; return; }
      if (selected.length === 0) { status.textContent = 'Select at least one photo.'; return; }

      status.textContent = 'Saving…';
      const originalHTML = sourceHTML(li);
      const newHTML = buildNewHTML(li, dateVal, titleVal, bodyVal, selected);

      let saveResp;
      try {
        const res = await fetch('/dev-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edits: [{ originalOuterHTML: originalHTML, newOuterHTML: newHTML }] })
        });
        saveResp = await res.json();
      } catch (err) {
        status.textContent = 'Save failed — is dev-server.py running?';
        return;
      }

      const result = (saveResp.results || [])[0];
      if (!result || !result.ok) {
        status.textContent = 'Save failed: ' + (result ? result.error : 'unknown error');
        return;
      }

      status.textContent = 'Committing…';
      try {
        await fetch('/dev-commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update timeline event: ' + titleVal })
        });
      } catch (_) { /* commit failure is non-fatal */ }

      status.textContent = '✓ Saved. Reloading…';
      setTimeout(() => { overlay.remove(); window.location.reload(); }, 800);
    });
  }

  // Add edit button to each timeline event
  document.querySelectorAll('.timeline-event').forEach(li => {
    li.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'cms-edit-btn';
    btn.textContent = '✎ Edit';
    btn.addEventListener('click', e => { e.stopPropagation(); openModal(li); });
    li.appendChild(btn);
  });
}());

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
    grid.addEventListener('click', (e) => {
      const img = e.target.closest('img.polaroid');
      if (!img) return;
      openLightbox(img.src, img.alt, img.getBoundingClientRect());
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

    function showSlide(idx) {
      photos.forEach((photo, i) => {
        const offset = (i - idx + photos.length) % photos.length;
        if (offset === 0) {
          photo.style.position  = 'relative';
          photo.style.zIndex    = '10';
          photo.style.transform = `rotate(${baseRot}deg)`;
        } else if (offset === 1) {
          photo.style.position  = 'absolute';
          photo.style.top       = '0';
          photo.style.left      = '0';
          photo.style.zIndex    = '5';
          photo.style.transform = 'rotate(5deg) translate(18px, 8px)';
        } else {
          photo.style.position  = 'absolute';
          photo.style.top       = '0';
          photo.style.left      = '0';
          photo.style.zIndex    = '3';
          photo.style.transform = 'rotate(-6deg) translate(-14px, 12px)';
        }
      });
      stack.dataset.current = idx;
    }

    showSlide(0);

    // Click: advance stack (multi) or open lightbox (single)
    stack.addEventListener('click', (e) => {
      if (e.target.closest('.stack-expand')) return;
      if (photos.length > 1) {
        const cur = parseInt(stack.dataset.current) || 0;
        showSlide((cur + 1) % photos.length);
      } else {
        openLightbox(photos[0].src, photos[0].alt, photos[0].getBoundingClientRect());
      }
    });

    // Swipe on mobile — lock axis on first move so horizontal swipes
    // don't also scroll the page.
    let touchStartX = 0, touchStartY = 0, swipeAxis = null;
    stack.addEventListener('touchstart', (e) => {
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
      showSlide((cur + dir + photos.length) % photos.length);
    }, { passive: true });

    // Expand button (desktop hover → opens lightbox)
    const expandBtn = document.createElement('button');
    expandBtn.className = 'stack-expand';
    expandBtn.setAttribute('aria-label', 'Expand photo');
    expandBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="#efe7d8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1h4v4M5 13H1V9M13 1L8 6M1 13l5-5"/></svg>';
    stack.appendChild(expandBtn);

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
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

    const bigImg = document.createElement('img');
    bigImg.src = src;
    bigImg.alt = alt;
    overlay.appendChild(bigImg);

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

      function showPhoto(idx) {
        currentIdx = idx;
        bigImg.style.transition = 'opacity 0.15s ease';
        bigImg.style.opacity = '0';
        setTimeout(() => {
          bigImg.src = allPhotos[idx].src;
          bigImg.alt = allPhotos[idx].alt;
          bigImg.style.opacity = '1';
        }, 150);
        overlay.querySelectorAll('.lb-dot').forEach((d, i) => {
          d.classList.toggle('is-active', i === idx);
        });
      }

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
        if (Math.abs(dx) < 40) { closeLightbox(); return; }
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
      const imgRect = bigImg.getBoundingClientRect();
      const thumbCx = thumbRect.left + thumbRect.width  / 2;
      const thumbCy = thumbRect.top  + thumbRect.height / 2;
      const imgCx   = imgRect.left   + imgRect.width    / 2;
      const imgCy   = imgRect.top    + imgRect.height   / 2;
      const tx      = thumbCx - imgCx;
      const ty      = thumbCy - imgCy;
      const scale   = thumbRect.width / imgRect.width;

      bigImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      bigImg.style.opacity   = '0';

      requestAnimationFrame(() => {
        bigImg.style.transition = 'transform .45s cubic-bezier(0.34, 1.4, 0.64, 1), opacity .2s ease';
        bigImg.style.transform  = 'translate(0, 0) scale(1)';
        bigImg.style.opacity    = '1';
        overlay.classList.add('is-open');
      });
    });

    overlay.addEventListener('click', closeLightbox);
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

/* ── Random polaroids (registry + details) ── */
(function () {
  async function randomPolaroid(id) {
    var img = document.getElementById(id);
    if (!img) return;
    var polaroids = await getPolaroids();
    if (!polaroids.length) return;
    var src = polaroids[Math.floor(Math.random() * polaroids.length)];
    var tilt = (Math.random() * 6 - 3).toFixed(1);
    img.src = src;
    img.style.transform = 'rotate(' + tilt + 'deg)';
  }
  randomPolaroid('registry-polaroid');
  randomPolaroid('details-polaroid');
  randomPolaroid('faq-polaroid');
}());

/* ── Canvas favicon + web app icon — DM Serif Display italic & once fonts load ── */
document.fonts.ready.then(function () {
  var size = 512;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c8362c';
  try { ctx.roundRect(0, 0, size, size, size * 0.15); } catch (e) { ctx.rect(0, 0, size, size); }
  ctx.fill();
  ctx.fillStyle = '#efe7d8';
  ctx.strokeStyle = '#efe7d8';
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

/* ── Story body copy — style & and … in red bold ── */
(function () {
  var story = document.getElementById('story');
  if (!story) return;
  var pattern = /(&amp;|\.{3}|…)/g;
  story.querySelectorAll('p').forEach(function (p) {
    p.innerHTML = p.innerHTML.replace(pattern, '<span class="story-accent">$1</span>');
  });
}());
