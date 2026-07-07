/**
 * Virowatch Style GUI — v4.0 (Settings popup integration)
 * Renders the searchable style list into #sgGrid inside the #vwSettings
 * popup (sidebar.js owns open/close). Add "extra css/" files to STYLES.
 */
(function () {
  'use strict';

  var STYLES = [
    { name: 'Auto', description: 'Follows your screen size — desktop or mobile dark.', file: 'auto' },
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
     STATE (unified with the 'theme' localStorage key)
  ───────────────────────────────────────────────────────────────── */
  var keyToBuiltin = {
    'desktop-dark':  'virostyle.css',
    'desktop-light': 'virostyle-light.css',
    'mobile-dark':   'virostyle2.css',
    'mobile-light':  'virostyle2-light.css'
  };
  var builtinToKey = {
    'virostyle.css':        'desktop-dark',
    'virostyle-light.css':  'desktop-light',
    'virostyle2.css':       'mobile-dark',
    'virostyle2-light.css': 'mobile-light'
  };

  var currentKey  = localStorage.getItem('theme') || 'auto';
  var hoverLink   = null;
  var hoverTimer  = null;
  var searchQuery = '';

  function autoFile() {
    var w = window.innerWidth, h = window.innerHeight;
    return (w <= 768 || (w / h) <= (9 / 16)) ? 'virostyle2.css' : 'virostyle.css';
  }
  function resolveFile(file) { return file === 'auto' ? autoFile() : file; }
  function isActive(style) {
    if (style.file === 'auto') return currentKey === 'auto';
    if (currentKey === 'auto') return false;
    return (keyToBuiltin[currentKey] || currentKey) === style.file;
  }

  /* ─────────────────────────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    var search = document.getElementById('sgSearch');
    if (search) {
      search.addEventListener('input', function () {
        searchQuery = search.value.toLowerCase().trim();
        renderList();
      });
    }
    renderList();
  });

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
    var card = document.createElement('div');
    card.className = 'sg-card' + (isActive(style) ? ' sg-card--active' : '');
    card.dataset.file = style.file;

    card.innerHTML =
      '<div class="sg-card-body">' +
        '<div class="sg-card-name">' + esc(style.name) + '</div>' +
        (style.description ? '<div class="sg-card-desc">' + esc(style.description) + '</div>' : '') +
        '<div class="sg-card-actions">' +
          '<button class="sg-btn sg-btn-apply" type="button">Apply</button>' +
          (style.file !== 'auto'
            ? '<button class="sg-btn sg-btn-download" type="button">↓ CSS</button>'
            : '') +
        '</div>' +
      '</div>';

    card.addEventListener('mouseenter', function () {
      hoverTimer = setTimeout(function () { previewHover(resolveFile(style.file)); }, 220);
    });
    card.addEventListener('mouseleave', function () {
      clearHover();
    });

    card.querySelector('.sg-btn-apply').addEventListener('click', function (e) {
      e.stopPropagation();
      applyStyle(style);
    });

    var dl = card.querySelector('.sg-btn-download');
    if (dl) {
      dl.addEventListener('click', function (e) {
        e.stopPropagation();
        downloadStyle(style);
      });
    }

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
     APPLY STYLE
  ───────────────────────────────────────────────────────────────── */
  function applyStyle(style) {
    var href = resolveFile(style.file);
    var themeLink = document.getElementById('themeStylesheet');
    if (themeLink) themeLink.href = href;
    // Home UI (virohome.css) picks light/dark tokens from this attribute
    document.documentElement.setAttribute('data-vw-theme', href);

    currentKey = style.file === 'auto'
      ? 'auto'
      : (builtinToKey[style.file] || style.file);
    localStorage.setItem('theme', currentKey);

    clearHover();
    document.querySelectorAll('.sg-card').forEach(function (c) {
      c.classList.toggle('sg-card--active', c.dataset.file === style.file);
    });

    toast('Applied: ' + style.name);
  }

  /* ─────────────────────────────────────────────────────────────────
     DOWNLOAD STYLE (scrapes the loaded sheet; needs it applied once)
  ───────────────────────────────────────────────────────────────── */
  function downloadStyle(style) {
    var cssText = '';

    try {
      var sheets = Array.prototype.slice.call(document.styleSheets);
      var targetSheet = sheets.find(function (s) {
        return s.href && s.href.includes(style.file);
      });
      if (targetSheet && targetSheet.cssRules) {
        cssText = Array.prototype.map.call(targetSheet.cssRules, function (rule) {
          return rule.cssText;
        }).join('\n');
      }
    } catch (e) {
      console.warn('Could not scrape CSS rules due to browser security.');
    }

    if (cssText) {
      var blob = new Blob([cssText], { type: 'text/css' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = style.file.split('/').pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Downloaded ' + a.download);
    } else {
      toast('Apply the style first to download, or use a local server.', true);
    }
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
})();
