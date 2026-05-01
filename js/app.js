/* ─────────────────────────────────────────────────────────
   app.js  –  Premium STEP Viewer UI integration
   Uses OV.StartWebsite() which is called in <head> so the
   engine is already initialised when this runs.
   ───────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Drag-and-drop visual feedback ─────────────────────── */
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    document.body.classList.add('drag-over');
  });

  document.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      document.body.classList.remove('drag-over');
    }
  });

  document.addEventListener('dragover', (e) => e.preventDefault());

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('drag-over');
    // OV's own drop handler will take it from here
  });

  /* ── Page-title: show file name once loaded ─────────────── */
  const origTitle = document.title;

  const fileNameEl = document.getElementById('main_file_name');
  if (fileNameEl) {
    const titleObserver = new MutationObserver(() => {
      const name = fileNameEl.textContent.trim();
      document.title = name ? `${name} — STEP Viewer` : origTitle;
    });
    titleObserver.observe(fileNameEl, { childList: true, subtree: true, characterData: true });
  }

  /* ── Keyboard shortcuts hint (console) ──────────────────── */
  console.info(
    '%cSTEP Viewer ready ✓\n' +
    '%cKeyboard shortcuts:\n' +
    '  F  — Fit to view\n' +
    '  R  — Reset camera\n' +
    '  S  — Screenshot\n' +
    '  W  — Toggle wireframe\n' +
    '  E  — Explode model',
    'color:#5b6cf9;font-weight:700;font-size:13px;',
    'color:#8892b0;font-size:11px;'
  );

})();
