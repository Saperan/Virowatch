/* Virowatch Settings popup — open/close (replaces the old slide-in sidebar) */
(function () {
  var overlay = document.getElementById('vwSettings');
  if (!overlay) return;

  function open() {
    overlay.classList.add('vws-open');
    overlay.setAttribute('aria-hidden', 'false');
    var search = document.getElementById('sgSearch');
    if (search) search.value = '';
  }

  function close() {
    overlay.classList.remove('vws-open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function toggle() {
    if (overlay.classList.contains('vws-open')) close();
    else open();
  }

  /* Exposed so other scripts (e.g. content.js when the player opens) can close it */
  window.vwSettingsClose = close;

  var railBtn = document.getElementById('railSettingsBtn');
  if (railBtn) railBtn.addEventListener('click', toggle);

  var legacyToggle = document.querySelector('.app-sidebar-toggle');
  if (legacyToggle) legacyToggle.addEventListener('click', toggle);

  var closeBtn = document.getElementById('vwSettingsClose');
  if (closeBtn) closeBtn.addEventListener('click', close);

  /* Click on the dimmed backdrop (not the modal itself) closes */
  overlay.addEventListener('mousedown', function (e) {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('vws-open')) close();
  });

  /* ── PitSport auto-load toggle (pitsport-live.js reads this at startup) ── */
  var pitToggle = document.getElementById('pitsportAutoToggle');
  if (pitToggle) {
    try {
      pitToggle.checked = localStorage.getItem('vw_pitsport_auto') === '1';
    } catch (_) {}
    pitToggle.addEventListener('change', function () {
      try {
        localStorage.setItem('vw_pitsport_auto', pitToggle.checked ? '1' : '0');
      } catch (_) {}
      // Turning it on fetches right away so the sports strip fills this session
      if (
        pitToggle.checked &&
        !window._pitsportLoaded &&
        !window._pitsportLoading &&
        typeof window.reloadPitSport === 'function'
      ) {
        window.reloadPitSport();
      }
    });
  }
})();
