/**
 * Virowatch Watchlist — v1.1
 * Requires window.viroPlay (exposed by content.js)
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────
     Storage
  ───────────────────────────────────────────────────── */
  var STORE_KEY = 'vwl_watchlist';

  function getList() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (_) { return []; }
  }

  function setList(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  }

  function isInList(key) {
    return getList().some(function (i) { return i.key === key; });
  }

  function addItem(item) {
    var list = getList();
    if (list.some(function (i) { return i.key === item.key; })) return;
    if (!item.status) item.status = 'planning'; // watching | planning | watched
    list.unshift(item);
    setList(list);
    refreshSidebar();
    if (window.vwAniListPush) window.vwAniListPush('add', item); // sync to AniList
  }

  /* Status change from the watchlist view — pushes to AniList (anime) */
  window.vwlSetStatus = function (key, status) {
    var list = getList();
    var it = null;
    list.forEach(function (i) { if (i.key === key) it = i; });
    if (!it || it.status === status) return;
    it.status = status;
    setList(list);
    refreshSidebar();
    if (window.vwAniListPush) window.vwAniListPush('status', it);
  };

  /* Bulk status update without AniList pushes — used by the pull-sync so
     imported statuses don't echo back. byKey = { key: status } */
  window.vwlBulkSetStatus = function (byKey) {
    var list = getList();
    var changed = 0;
    list.forEach(function (i) {
      var s = byKey && byKey[i.key];
      if (s && i.status !== s) { i.status = s; changed++; }
    });
    if (changed) { setList(list); refreshSidebar(); }
    return changed;
  };

  function removeItem(key) {
    var removed = getList().find(function (i) { return i.key === key; });
    setList(getList().filter(function (i) { return i.key !== key; }));
    refreshSidebar();
    if (removed && window.vwAniListPush) window.vwAniListPush('remove', removed);
  }

  /* Bulk add without AniList pushes — used by the AniList pull-sync
     (anilist.js) so imported entries don't echo back to AniList. */
  window.vwlBulkAdd = function (items) {
    var list = getList();
    var added = 0;
    (items || []).forEach(function (it) {
      if (!it || !it.key) return;
      if (list.some(function (i) { return i.key === it.key; })) return;
      if (!it.status) it.status = 'planning';
      list.push(it);
      added++;
    });
    if (added) { setList(list); refreshSidebar(); }
    return added;
  };

  /* Keep every +/✓ card button (movie grid, Anikoto grid, home posters)
     in step with the list, no matter where the change came from. */
  function syncAddButtons() {
    document.querySelectorAll('.vwl-add-btn[data-key]').forEach(function (btn) {
      if (btn.classList.contains('vwl-spinning')) return; // mid add-animation
      var active = isInList(btn.dataset.key);
      btn.classList.toggle('vwl-checked', active);
      btn.innerHTML = active ? SVG_CHECK : SVG_PLUS;
      btn.title = active ? 'In watchlist' : 'Add to watchlist';
    });
  }

  /* Exposed for the home UI (hero + newest-added + watchlist view) */
  window.vwlHas = isInList;
  window.vwlGet = getList;
  window.vwlToggle = function (item) {
    if (isInList(item.key)) { removeItem(item.key); return false; }
    addItem(item);
    return true;
  };
  window.vwlAttachButton = attachButton;

  /* ─────────────────────────────────────────────────────
     SVG icons
  ───────────────────────────────────────────────────── */
  var SVG_PLUS  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/></svg>';
  var SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 13 9 18 20 7"/></svg>';
  var SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
  var SVG_DL    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var SVG_UL    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 5 17 10"/><line x1="12" y1="5" x2="12" y2="17"/></svg>';

  /* ─────────────────────────────────────────────────────
     Export / Import
  ───────────────────────────────────────────────────── */
  function exportList() {
    var list = getList();
    if (!list.length) { showToast('Watchlist is empty'); return; }
    var blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'virowatch-watchlist.json';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function importList(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error();
        var existing = getList();
        var added = 0;
        imported.forEach(function (item) {
          if (item && item.key && item.title && item.cat) {
            if (!existing.some(function (i) { return i.key === item.key; })) {
              existing.push(item); added++;
            }
          }
        });
        setList(existing);
        refreshSidebar();
        showToast(added + ' item' + (added !== 1 ? 's' : '') + ' imported');
      } catch (_) {
        showToast('Invalid watchlist file');
      }
    };
    reader.readAsText(file);
  }

  /* ─────────────────────────────────────────────────────
     Toast
  ───────────────────────────────────────────────────── */
  function showToast(msg) {
    var t = document.getElementById('vwl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'vwl-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'vwl-show';
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.className = ''; }, 2400);
  }

  /* ─────────────────────────────────────────────────────
     Load item into player — uses window.viroPlay from content.js
  ───────────────────────────────────────────────────── */
  function loadItem(item) {
    if (window.vwSettingsClose) window.vwSettingsClose(); // close settings popup

    // Anikoto items must be fetched + injected before playing.
    var aniId = item.aniId ||
      (item.key && item.key.indexOf('ANI_') === 0 ? item.key.slice(4) : null);
    if (aniId && typeof window.openAnikotoById === 'function') {
      showToast('Loading…');
      window.openAnikotoById(aniId).then(function (ok) {
        if (!ok) showToast('Could not load — not available yet');
      }).catch(function () { showToast('Failed to load item'); });
      return;
    }

    // Vidnest items (movies/shows/anime) are injected on demand too.
    if (item.key && /^VD[MTA]_/.test(item.key) && typeof window.openVidnestById === 'function') {
      showToast('Loading…');
      window.openVidnestById(item.key).then(function (ok) {
        if (!ok) showToast('Could not load — not available yet');
      }).catch(function () { showToast('Failed to load item'); });
      return;
    }

    if (typeof window.viroPlay !== 'function') {
      showToast('Player not ready — try again');
      return;
    }
    window.viroPlay(item.cat, item.key).then(function (ok) {
      if (!ok) showToast('Could not load — content may have been removed');
    }).catch(function () {
      showToast('Failed to load item');
    });
  }

  /* ─────────────────────────────────────────────────────
     Sidebar section
  ───────────────────────────────────────────────────── */
  function refreshSidebar() {
    syncAddButtons();
    window.dispatchEvent(new CustomEvent('vwl-updated'));
    var container = document.getElementById('vwl-list');
    if (!container) return;
    var list = getList();
    container.innerHTML = '';

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'vwl-empty';
      empty.textContent = 'Nothing added yet';
      container.appendChild(empty);
      return;
    }

    list.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'vwl-item';
      row.title = 'Play — ' + item.title;

      var img = document.createElement('img');
      img.className = 'vwl-item-img';
      img.src = item.image; img.alt = ''; img.loading = 'lazy';

      var name = document.createElement('span');
      name.className = 'vwl-item-title';
      name.textContent = item.title;

      var del = document.createElement('button');
      del.className = 'vwl-item-remove';
      del.title = 'Remove'; del.setAttribute('aria-label', 'Remove');
      del.innerHTML = SVG_TRASH;
      del.addEventListener('click', function (e) { e.stopPropagation(); removeItem(item.key); });

      row.appendChild(img); row.appendChild(name); row.appendChild(del);
      row.addEventListener('click', function () { loadItem(item); });
      container.appendChild(row);
    });
  }

  function buildSidebarSection() {
    /* Settings popup body (falls back to the legacy sidebar if present) */
    var nav = document.querySelector('#vwSettingsNav, .app-sidebar nav');
    if (!nav || document.getElementById('vwl-section')) return;

    var section = document.createElement('div');
    section.id = 'vwl-section';
    section.className = 'app-sidebar-custom-section';

    var label = document.createElement('span');
    label.className = 'app-sidebar-theme-label';
    label.textContent = 'Watchlist';

    var listEl = document.createElement('div');
    listEl.id = 'vwl-list';
    listEl.className = 'vwl-list';

    // Import file input (hidden)
    var importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    importInput.style.display = 'none';
    importInput.addEventListener('change', function () {
      if (importInput.files && importInput.files[0]) {
        importList(importInput.files[0]);
        importInput.value = '';
      }
    });

    var btnRow = document.createElement('div');
    btnRow.className = 'vwl-btn-row';

    var exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'app-sidebar-import-btn vwl-half-btn';
    exportBtn.innerHTML = SVG_DL + ' Export';
    exportBtn.addEventListener('click', exportList);

    var importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'app-sidebar-import-btn vwl-half-btn';
    importBtn.innerHTML = SVG_UL + ' Import';
    importBtn.addEventListener('click', function () { importInput.click(); });

    btnRow.appendChild(exportBtn);
    btnRow.appendChild(importBtn);

    section.appendChild(label);
    section.appendChild(listEl);
    section.appendChild(importInput);
    section.appendChild(btnRow);
    nav.appendChild(section);

    refreshSidebar();
  }

  /* ─────────────────────────────────────────────────────
     Add (+) button on each movie-item card
  ───────────────────────────────────────────────────── */
  function attachButton(mi) {
    if (mi.querySelector('.vwl-add-btn')) return;

    // Anikoto cards carry data-ani-id; native cards carry data-movie.
    var aniId = mi.dataset.aniId;
    var key   = aniId ? ('ANI_' + aniId) : mi.dataset.movie;
    if (!key) return;

    var p   = mi.querySelector('p, .title'); // .title = home poster cards
    var img = mi.querySelector('img');
    if (!p || !img) return;

    var title  = p.textContent.trim();
    var image  = img.src || '';
    var cat    = aniId ? 'anime' : (mi.dataset.cat || window._vwlCurrentCat || 'shows');
    var active = isInList(key);

    var btn = document.createElement('button');
    btn.className = 'vwl-add-btn' + (active ? ' vwl-checked' : '');
    btn.dataset.key = key;
    btn.title = active ? 'In watchlist' : 'Add to watchlist';
    btn.setAttribute('aria-label', 'Watchlist');
    btn.innerHTML = active ? SVG_CHECK : SVG_PLUS;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();

      if (isInList(key)) {
        removeItem(key);
        btn.classList.remove('vwl-checked', 'vwl-spinning');
        btn.innerHTML = SVG_PLUS;
        btn.title = 'Add to watchlist';
      } else {
        btn.classList.add('vwl-spinning');
        var item = { key: key, title: title, image: image, cat: cat };
        if (aniId) item.aniId = Number(aniId);
        addItem(item);
        setTimeout(function () {
          btn.classList.remove('vwl-spinning');
          btn.classList.add('vwl-checked');
          btn.innerHTML = SVG_CHECK;
          btn.title = 'In watchlist';
        }, 430);
      }
    });

    mi.appendChild(btn);
  }

  /* ─────────────────────────────────────────────────────
     Observe #movieList
  ───────────────────────────────────────────────────── */
  function observeContainer(el) {
    if (!el) return;
    el.querySelectorAll('.movie-item').forEach(attachButton);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1 && node.classList.contains('movie-item')) attachButton(node);
        });
      });
    }).observe(el, { childList: true });
  }

  function observeMovieList() {
    observeContainer(document.getElementById('movieList'));
    // These grids are built a moment after load (Anikoto's own catalog
    // index, Vidnest's TMDB-backed sections) — wait for each to appear.
    ['anikoto-grid', 'vidnest-movies-grid', 'vidnest-shows-grid'].forEach(function (id) {
      var tries = 0;
      (function waitGrid() {
        var g = document.getElementById(id);
        if (g) observeContainer(g);
        else if (tries++ < 15) setTimeout(waitGrid, 700);
      })();
    });
  }

  /* ─────────────────────────────────────────────────────
     Track active category for add button context
  ───────────────────────────────────────────────────── */
  function trackCategory() {
    document.querySelectorAll('.movie-item-banner[data-category]').forEach(function (b) {
      b.addEventListener('click', function () { window._vwlCurrentCat = b.dataset.category; });
    });
  }

  /* ─────────────────────────────────────────────────────
     Styles
  ───────────────────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('vwl-styles')) return;
    var s = document.createElement('style');
    s.id = 'vwl-styles';
    s.textContent =
      /* + button on card */
      '.vwl-add-btn{position:absolute;top:5px;left:5px;width:22px;height:22px;padding:0;border:none;border-radius:50%;background:transparent;color:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10;transition:background .18s,transform .15s;filter:drop-shadow(0 1px 3px rgba(0,0,0,.75));}' +
      '.vwl-add-btn svg{width:12px;height:12px;pointer-events:none;}' +
      '.movie-item:hover .vwl-add-btn,.poster:hover .vwl-add-btn{background:rgba(0,0,0,.52);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}' +
      /* home posters keep their badge top-left, so the + sits top-right */
      '.poster .vwl-add-btn{left:auto;right:5px;}' +
      '.vwl-add-btn:hover{transform:scale(1.18);}' +
      '.vwl-add-btn.vwl-checked{background:rgba(255,255,255,.16);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#fff;}' +
      '.vwl-add-btn.vwl-checked:hover{background:rgba(200,55,55,.52);}' +
      '@keyframes vwl-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
      '.vwl-add-btn.vwl-spinning{animation:vwl-spin .42s ease-out forwards;background:rgba(0,0,0,.52);}' +

      /* watchlist section (inside the settings popup — uses theme tokens) */
      '.vwl-list{display:flex;flex-direction:column;gap:5px;max-height:250px;overflow-y:auto;margin:8px 0;}' +
      '.vwl-list::-webkit-scrollbar{width:3px;}' +
      '.vwl-list::-webkit-scrollbar-thumb{background:var(--vw-border-strong,rgba(255,255,255,.14));border-radius:2px;}' +
      '.vwl-item{display:flex;align-items:center;gap:8px;padding:6px 7px;background:var(--vw-chip-bg,rgba(255,255,255,.06));border:1px solid var(--vw-border,rgba(255,255,255,.09));border-radius:8px;cursor:pointer;transition:background .18s,border-color .18s;min-width:0;}' +
      '.vwl-item:hover{background:var(--vw-hover-strong,rgba(255,255,255,.12));border-color:var(--vw-active-border,rgba(255,255,255,.2));}' +
      '.vwl-item-img{width:30px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;}' +
      '.vwl-item-title{flex:1;font-size:.78rem;font-weight:500;color:var(--vw-text,rgba(255,255,255,.88));line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-width:0;}' +
      '.vwl-item-remove{flex-shrink:0;width:26px;height:26px;padding:5px;border:none;border-radius:5px;background:rgba(255,60,60,.14);color:rgba(255,110,110,.85);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .18s,color .18s;}' +
      '.vwl-item-remove:hover{background:rgba(255,60,60,.4);color:#fff;}' +
      '.vwl-item-remove svg{width:13px;height:13px;}' +
      '.vwl-empty{font-size:.76rem;color:var(--vw-faint,rgba(255,255,255,.3));text-align:center;padding:12px 0 4px;}' +

      /* export/import row */
      '.vwl-btn-row{display:flex;gap:6px;margin-top:4px;}' +
      '.vwl-half-btn{flex:1;padding:8px 4px!important;margin-bottom:0!important;font-size:.78rem!important;display:flex!important;align-items:center;justify-content:center;gap:4px;}' +

      /* toast */
      '#vwl-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(8px);background:rgba(20,20,20,.92);color:rgba(255,255,255,.93);padding:7px 18px;border-radius:18px;font-size:.82rem;font-family:"Kanit",sans-serif;opacity:0;pointer-events:none;z-index:99999;white-space:nowrap;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);transition:opacity .22s,transform .22s;}' +
      '#vwl-toast.vwl-show{opacity:1;transform:translateX(-50%) translateY(0);}';
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────
     Init
  ───────────────────────────────────────────────────── */
  function init() {
    injectCSS();
    buildSidebarSection();
    trackCategory();
    observeMovieList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
