/* ============================================================
   Mike & Xan — Wedding Site
   Frontend JS: nav toggle + RSVP form (no backend wired yet)
   ============================================================ */

(function () {
  'use strict';

  // --- Apps Script endpoint (filled in once we deploy the script) ---
  // Example: 'https://script.google.com/macros/s/AKfyc.../exec'
  const APPS_SCRIPT_URL = '';

  // --- Mobile nav toggle ---
  const navToggle = document.querySelector('.nav-toggle');
  const primaryNav = document.getElementById('primary-nav');

  if (navToggle && primaryNav) {
    navToggle.addEventListener('click', () => {
      const open = primaryNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Close the menu when a nav link is tapped (so smooth-scroll feels right on mobile)
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
  const stepFind = form.querySelector('[data-step="1"]');
  const stepConfirm = form.querySelector('[data-step="2"]');
  const stepThanks = form.querySelector('[data-step="3"]');

  const DIETARY_OPTIONS = [
    { value: '', label: 'No preference' },
    { value: 'vegetarian', label: 'Vegetarian' },
    { value: 'vegan', label: 'Vegan' },
    { value: 'gluten-free', label: 'Gluten Free' },
    { value: 'other', label: 'Other (please specify)' }
  ];

  // ---- Lookup step ----
  lookupBtn.addEventListener('click', async () => {
    const q = (lookupInput.value || '').trim();
    if (q.length < 2) {
      setStatus(lookupStatus, 'Please type your name.', 'error');
      return;
    }
    setStatus(lookupStatus, 'Looking up your invitation…', '');

    try {
      const household = await lookupHousehold(q);
      if (!household || !household.members || household.members.length === 0) {
        setStatus(
          lookupStatus,
          "We couldn't find that name. Try your full name as it appears on your invitation, or include a partner's name.",
          'error'
        );
        return;
      }

      renderHousehold(household);
      stepFind.hidden = true;
      stepConfirm.hidden = false;
      stepConfirm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      setStatus(
        lookupStatus,
        "Something went wrong looking up your invitation. Please try again, or contact Mike.",
        'error'
      );
    }
  });

  // ---- Submit step ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submission = collectSubmission();
    if (!submission) return; // collectSubmission sets its own error

    setStatus(submitStatus, 'Submitting your RSVP…', '');

    try {
      await submitRsvp(submission);
      stepConfirm.hidden = true;
      stepThanks.hidden = false;
      stepThanks.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      setStatus(
        submitStatus,
        "Something went wrong submitting your RSVP. Please try again, or contact Mike.",
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

  function renderHousehold(household) {
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

      // Show/hide the "other" text field when "other" is chosen.
      const select = wrap.querySelector('select');
      const otherField = wrap.querySelector('.dietary-other');
      select.addEventListener('change', () => {
        otherField.classList.toggle('is-shown', select.value === 'other');
      });
    });
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

    return {
      members,
      songRequest: (document.getElementById('song-request').value || '').trim(),
      notes: (document.getElementById('notes').value || '').trim(),
      submittedAt: new Date().toISOString()
    };
  }

  // ---- Backend calls (Apps Script — placeholders until deployed) ----

  async function lookupHousehold(query) {
    if (!APPS_SCRIPT_URL) {
      // Backend not wired up yet — return a mock so the form is testable end-to-end.
      console.warn('APPS_SCRIPT_URL not set — using mock household for testing.');
      return {
        members: [
          { name: query },
          { name: query.split(' ').slice(0, -1).join(' ') + ' (partner — placeholder)' }
        ]
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
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoid CORS preflight
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

})();
