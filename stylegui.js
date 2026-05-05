/**
 * Virowatch Style GUI — v3.0 (Synced Integration)
 * Slides in from the right as a panel mirroring the left sidebar.
 * Add your "extra css/" files to STYLES below.
 */
(function () {
  'use strict';

  var STYLES = [
    { name: 'Desktop Dark', description: 'Default dark theme for widescreen.', file: 'virostyle.css' },
    { name: 'Desktop Light', description: 'Blindingly bright desktop theme.', file: 'virostyle-light.css' },
    { name: 'Mobile Dark', description: 'Mobile version', file: 'virostyle2.css' },
    { name: 'Mobile Light', description: 'Mobile version²', file: 'virostyle2-light.css' },
    { name: 'Virowatch+', description: 'Based off the Discord+ theme (suggested that you edit it yourself to add a different image https://github.com/PlusInsta/discord-plus)', file: 'extra_css/discordplus.css' },
    { name: 'FVUI Dark', description: 'Based off the FVUI theme (https://betterdiscord.app/theme/FVUI)', file: 'extra_css/fvui_dark.css' },
    { name: 'Lunora', description: 'Based off the Lunora website', file: 'extra_css/lunorastyle.css' },
    { name: 'System24', description: 'Based off the System24 Discord theme https://github.com/refact0r/system24/blob/main/theme/system24.theme.css "This is what Virowatch should look like." -Saperan', file: 'extra_css/system24.css' },
    { name: 'Frutiger Aero', description: 'Based off Frutiger Aero Images (one of the first custom CSS created for Virowatch in an idea to add customizability)', file: 'extra_css/virostyle-frutiger-aero.css' },
    { name: 'Amoled PC', description: 'Extra dark version (theoretically should turn off your amoled screen pixels)', file: 'extra_css/virostyle-amoled.css' },
    { name: 'Amoled Mobile', description: 'Extra dark version (theoretically should turn off your amoled screen pixels)', file: 'extra_css/virostyle-mobile-amoled.css' },
    /* ADD EXTRA CSS FILES HERE */
  ];

  /* ─────────────────────────────────────────────────────────────────
     STATE (Unified with 'theme' local storage)
  ───────────────────────────────────────────────────────────────── */
  var keyToBuiltin = {
    'desktop-dark':  'virostyle.css',
    'desktop-light': 'virostyle-light.css',
    'mobile-dark':   'virostyle2.css',
    'mobile-light':  'virostyle2-light.css'
  };

  var savedTheme = localStorage.getItem('theme') || 'auto';
  var currentFile = null;
  
  if (savedTheme === 'auto') {
     var w = window.innerWidth, h = window.innerHeight;
     currentFile = (w <= 768 || (w / h) <= (9 / 16)) ? 'virostyle2.css' : 'virostyle.css';
  } else {
     currentFile = keyToBuiltin[savedTheme] || savedTheme;
  }

  var hoverLink   = null;
  var hoverTimer  = null;
  var searchQuery = '';

  /* ─────────────────────────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    buildPanel();
    bindEvents();
    renderList();
  });

  /* ─────────────────────────────────────────────────────────────────
     BUILD PANEL HTML
  ───────────────────────────────────────────────────────────────── */
  function buildPanel() {
    var overlay = document.getElementById('styleGuiOverlay');
    if (!overlay) return;

    overlay.innerHTML =
      '<div class="sg-modal">' +
        '<div class="sg-header">' +
          '<div class="sg-header-left">' +
            '<span class="sg-header-icon">🎨</span>' +
            '<span class="sg-header-title">Styles</span>' +
          '</div>' +
          '<button class="sg-close-btn" id="sgCloseBtn" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="sg-toolbar">' +
          '<div class="sg-search-wrap">' +
            '<svg class="sg-search-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/>' +
              '<line x1="13" y1="13" x2="16.5" y2="16.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
            '</svg>' +
            '<input type="text" id="sgSearch" class="sg-search" placeholder="Search styles…" autocomplete="off" spellcheck="false">' +
          '</div>' +
        '</div>' +
        '<div class="sg-grid" id="sgGrid"></div>' +
      '</div>';
  }

  /* ─────────────────────────────────────────────────────────────────
     EVENTS
  ───────────────────────────────────────────────────────────────── */
  function bindEvents() {
    var openBtn = document.getElementById('openStyleGuiBtn');
    if (openBtn) openBtn.addEventListener('click', openPanel);

    document.addEventListener('click', function (e) {
      if (e.target.id === 'sgCloseBtn') { closePanel(); return; }
      var overlay = document.getElementById('styleGuiOverlay');
      if (!overlay || !overlay.classList.contains('sg-active')) return;
      if (!overlay.contains(e.target) && e.target.id !== 'openStyleGuiBtn') {
        closePanel();
      }
    });

    document.addEventListener('input', function (e) {
      if (e.target.id === 'sgSearch') {
        searchQuery = e.target.value.toLowerCase().trim();
        renderList();
      }
    });

    /* SYNC FROM SIDEBAR: If user uses the left sidebar dropdown */
    var sel = document.getElementById('app-sidebar-theme-select');
    if (sel) {
      sel.addEventListener('change', function(e) {
        var val = e.target.value;
        if (val === 'auto') {
           var w = window.innerWidth, h = window.innerHeight;
           currentFile = (w <= 768 || (w / h) <= (9 / 16)) ? 'virostyle2.css' : 'virostyle.css';
        } else {
           currentFile = keyToBuiltin[val] || val;
        }
        document.querySelectorAll('.sg-card').forEach(function (c) {
          c.classList.toggle('sg-card--active', c.dataset.file === currentFile);
        });
      });
    }
  }

function openPanel(e) {
  if (e) e.stopPropagation(); // Prevents the background from "stealing" the click
  var overlay = document.getElementById('styleGuiOverlay');
  if (overlay) overlay.classList.add('sg-active');
}

  function closePanel() {
    var overlay = document.getElementById('styleGuiOverlay');
    if (overlay) overlay.classList.remove('sg-active');
    clearHover();
  }

  /* ─────────────────────────────────────────────────────────────────
     RENDER LIST
  ───────────────────────────────────────────────────────────────── */
  function renderList() {
    var grid = document.getElementById('sgGrid');
    if (!grid) return;

    var filtered = STYLES.filter(function (s) {
      if (!searchQuery) return true;
      return s.name.toLowerCase().includes(searchQuery) ||
             (s.description || '').toLowerCase().includes(searchQuery);
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="sg-empty">No styles found.</div>';
      return;
    }

    grid.innerHTML = '';
    filtered.forEach(function (style) {
      grid.appendChild(buildCard(style));
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     BUILD CARD
  ───────────────────────────────────────────────────────────────── */
  function buildCard(style) {
    var isActive = (currentFile === style.file);
    var card = document.createElement('div');
    card.className = 'sg-card' + (isActive ? ' sg-card--active' : '');
    card.dataset.file = style.file;

    card.innerHTML =
      '<div class="sg-card-body">' +
        '<div class="sg-card-name">' + esc(style.name) + '</div>' +
        (style.description ? '<div class="sg-card-desc">' + esc(style.description) + '</div>' : '') +
        '<div class="sg-card-actions">' +
          '<button class="sg-btn sg-btn-apply">Apply</button>' +
          '<button class="sg-btn sg-btn-download">↓ CSS</button>' +
        '</div>' +
      '</div>';

    card.addEventListener('mouseenter', function () {
      hoverTimer = setTimeout(function () { previewHover(style.file); }, 220);
    });
    card.addEventListener('mouseleave', function () {
      clearTimeout(hoverTimer);
      clearHover();
    });

    card.querySelector('.sg-btn-apply').addEventListener('click', function (e) {
      e.stopPropagation();
      applyStyle(style);
    });

    card.querySelector('.sg-btn-download').addEventListener('click', function (e) {
      e.stopPropagation();
      downloadStyle(style);
    });

    return card;
  }

  /* ─────────────────────────────────────────────────────────────────
     HOVER PREVIEW 
  ───────────────────────────────────────────────────────────────── */
  function previewHover(file) {
    if (!hoverLink) {
      hoverLink = document.createElement('link');
      hoverLink.rel = 'stylesheet';
      hoverLink.id  = 'sg-hover-link';
      document.head.appendChild(hoverLink);
    }
    hoverLink.href = file + '?t=' + Date.now();
  }

  function clearHover() {
    clearTimeout(hoverTimer);
    if (hoverLink && hoverLink.parentNode) {
      hoverLink.parentNode.removeChild(hoverLink);
      hoverLink = null;
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     APPLY STYLE (And Sync with Sidebar)
  ───────────────────────────────────────────────────────────────── */
  function applyStyle(style) {
    var themeLink = document.getElementById('themeStylesheet');
    if (themeLink) themeLink.href = style.file;

    var builtins = {
      'virostyle.css':        'desktop-dark',
      'virostyle-light.css':  'desktop-light',
      'virostyle2.css':       'mobile-dark',
      'virostyle2-light.css': 'mobile-light'
    };

    var themeVal = builtins[style.file] || style.file;
    localStorage.setItem('theme', themeVal);
    currentFile = style.file;

    /* SYNC TO SIDEBAR */
    var sel = document.getElementById('app-sidebar-theme-select');
    if (sel) {
      if (builtins[style.file]) {
        sel.value = builtins[style.file];
      } else {
        // If it's a custom extra CSS file, dynamically add an option so the select box shows it properly.
        var customOpt = Array.from(sel.options).find(function(o) { 
          return !['auto','desktop-dark','desktop-light','mobile-dark','mobile-light'].includes(o.value); 
        });
        if (!customOpt) {
          customOpt = document.createElement('option');
          sel.appendChild(customOpt);
        }
        customOpt.value = style.file;
        customOpt.textContent = style.name + ' (Custom)';
        sel.value = style.file;
      }
    }

    /* Update card states */
    document.querySelectorAll('.sg-card').forEach(function (c) {
      c.classList.toggle('sg-card--active', c.dataset.file === style.file);
    });

    toast('Applied: ' + style.name);
  }

/* ─────────────────────────────────────────────────────────────────
     DOWNLOAD STYLE (Enhanced Fallback)
  ───────────────────────────────────────────────────────────────── */
function downloadStyle(style) {
    let cssText = '';

    try {
      // 1. Try to find the stylesheet in the document's loaded styles
      const sheets = Array.from(document.styleSheets);
      const targetSheet = sheets.find(s => s.href && s.href.includes(style.file));

      if (targetSheet && targetSheet.cssRules) {
        cssText = Array.from(targetSheet.cssRules)
          .map(rule => rule.cssText)
          .join('\n');
      }
    } catch (e) {
      console.warn("Could not scrape CSS rules due to browser security.");
    }

    // 2. If we got the text, download it locally
    if (cssText) {
      const blob = new Blob([cssText], { type: 'text/css' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = style.file.split('/').pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Downloaded ' + a.download);
    } else {
      // 3. Last resort: tell user to apply it first or use a server
      toast('Apply the style first to download, or use a local server.', true);
    }
  }

  function triggerDownload(text, filename) {
    var blob = new Blob([text], { type: 'text/css' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = filename.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Downloaded ' + a.download);
  }

  /* ─────────────────────────────────────────────────────────────────
     TOAST & UTIL
  ───────────────────────────────────────────────────────────────── */
  function toast(msg, isError) {
    var el = document.createElement('div');
    el.className = 'sg-toast' + (isError ? ' sg-toast--error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('sg-toast--show'); });
    });
    setTimeout(function () {
      el.classList.remove('sg-toast--show');
      setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 350);
    }, 2600);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

// Trigger the sync to the sidebar
  if (window.syncThemeDropdown) {
    window.syncThemeDropdown(STYLES);
  }
})();
