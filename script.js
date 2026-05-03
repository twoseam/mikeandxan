/* ============================================================
   Mike & Xan — Wedding Site
   Frontend JS: nav toggle + RSVP form
   ============================================================ */

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

  const lookupInput = document.getElementById('lookup-name');
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
  // Pressing Enter inside the lookup field would otherwise submit the whole
  // form (because there's a type="submit" button further down in the DOM),
  // which fires the RSVP submit handler before any household is loaded.
  lookupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookupBtn.click();
    }
  });

  lookupBtn.addEventListener('click', async () => {
    const q = (lookupInput.value || '').trim();
    if (q.length < 2) {
      setStatus(lookupStatus, 'Please type your name.', 'error');
      return;
    }
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
        stepPicker.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      stepConfirm.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      stepThanks.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    stepConfirm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showAlreadySubmitted(household) {
    pendingEditHousehold = household;
    const target = document.getElementById('already-submitted-name');
    if (target) target.textContent = household.alreadySubmittedFor || 'someone in your household';
    stepFind.hidden = true;
    stepPicker.hidden = true;
    stepConfirm.hidden = true;
    stepAlready.hidden = false;
    stepAlready.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPicker(households) {
    householdPicker.innerHTML = '';
    households.forEach((h) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'household-pick-btn';
      btn.textContent = h.members.map(m => m.name).join(' & ');
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
    lookupInput.focus();
    lookupInput.select();
    stepFind.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderHousehold(household, existing) {
    householdContainer.innerHTML = '';

    household.members.forEach((member, i) => {
      const memberId = 'm' + i;
      const wrap = document.createElement('div');
      wrap.className = 'household-member';
      wrap.dataset.memberIndex = String(i);
      wrap.dataset.memberName = member.name;

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
    });

    if (existing) {
      prefillExisting(existing);
    } else {
      // Reset household-level fields in case the user came back from a previous render
      const emailEl = document.getElementById('email');
      const phoneEl = document.getElementById('phone');
      const songEl = document.getElementById('song-request');
      const notesEl = document.getElementById('notes');
      if (emailEl) emailEl.value = '';
      if (phoneEl) phoneEl.value = '';
      if (songEl) songEl.value = '';
      if (notesEl) notesEl.value = '';
      form.querySelectorAll('input[name="contact-method"]').forEach(r => { r.checked = false; });
    }
  }

  function prefillExisting(existing) {
    (existing.members || []).forEach((m, i) => {
      const memberEl = householdContainer.querySelector(`[data-member-index="${i}"]`);
      if (!memberEl) return;
      if (m.attending === 'yes' || m.attending === 'no') {
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
    const notesEl = document.getElementById('notes');
    if (emailEl) emailEl.value = existing.email || '';
    if (phoneEl) phoneEl.value = existing.phone || '';
    if (songEl) songEl.value = existing.songRequest || '';
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

    memberEls.forEach((el) => {
      const i = el.dataset.memberIndex;
      const name = el.dataset.memberName;
      const attendingInput = el.querySelector(`input[name="attending-m${i}"]:checked`);
      const dietaryEl = el.querySelector(`#dietary-m${i}`);
      const dietaryOtherEl = el.querySelector(`#dietary-other-m${i}`);

      if (!attendingInput) missingAttending = true;

      members.push({
        name,
        attending: attendingInput ? attendingInput.value : null,
        dietary: dietaryEl ? dietaryEl.value : '',
        dietaryOther: dietaryOtherEl ? dietaryOtherEl.value.trim() : ''
      });
    });

    if (missingAttending) {
      setStatus(submitStatus, "Please mark each guest as attending or not attending.", 'error');
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

})();
