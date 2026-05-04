/* ============================================================
   Dev copy-editor — Cmd/Ctrl+Click any text on the page to edit
   it inline. A small widget in the corner tracks pending changes
   and lets you copy the diff so the source files can be updated.
   This file is only loaded on localhost / private LAN (gated by
   the conditional <script> in index.html).
   ============================================================ */
(function () {
  'use strict';

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
