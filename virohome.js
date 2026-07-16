/**
 * virohome.js — Virowatch 3a Home UI wiring
 *
 * Drives the parts of the new home layout that content.js doesn't own:
 *  - rail active state + Home / Watchlist buttons
 *  - Continue watching list in the rail (localStorage "vw_continue",
 *    written by content.js saveState, resumed via window.viroResume)
 *  - Live sports strip built from PitSport data (window.shows.PITSORT)
 *  - Watchlist grid view rendered into #movieList
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var watchlistViewOpen = false;

  /* ── Rail active state (called by content.js on renderList/resetView) ── */
  window.setRailActive = function (name) {
    if (name !== "watchlist") {
      watchlistViewOpen = false;
      hideWlToolbar();
    }
    document.querySelectorAll(".rail-item").forEach(function (b) {
      b.classList.toggle(
        "active",
        b.dataset.cat === name || b.dataset.railId === name,
      );
    });
  };

  function goHome() {
    watchlistViewOpen = false;
    if (typeof window.viroHome === "function") window.viroHome();
  }

  /* ── Watchlist view (grid in the main column) ───────────────────── */
  var WL_PREFS_KEY = "vw_watchlist_prefs";
  var WL_STATUSES = [
    ["watching", "Watching"],
    ["planning", "Plan to watch"],
    ["watched", "Watched"],
  ];
  function wlStatusLabel(s) {
    for (var i = 0; i < WL_STATUSES.length; i++) {
      if (WL_STATUSES[i][0] === s) return WL_STATUSES[i][1];
    }
    return "Plan to watch";
  }
  function getWlPrefs() {
    var d = { sort: "recent", group: false, show: "all" };
    try {
      return Object.assign(d, JSON.parse(localStorage.getItem(WL_PREFS_KEY) || "{}"));
    } catch (_) {
      return d;
    }
  }
  function saveWlPrefs(p) {
    localStorage.setItem(WL_PREFS_KEY, JSON.stringify(p));
  }

  function wlBucket(item) {
    if (item.cat === "anime") return "Anime";
    if (item.cat === "shows") return "TV Shows";
    return "Movies"; // "movies" (Vidnest) and "lunora" (native) both live here
  }

  function sortWlList(list, mode) {
    var arr = list.slice();
    if (mode === "az") {
      arr.sort(function (a, b) {
        return (a.title || a.key || "").localeCompare(b.title || b.key || "");
      });
    } else if (mode === "za") {
      arr.sort(function (a, b) {
        return (b.title || b.key || "").localeCompare(a.title || a.key || "");
      });
    } else if (mode === "status") {
      // Watching first, then plan-to-watch, watched last; stable sort
      // keeps recently-added first inside each bucket
      var ORD = { watching: 0, planning: 1, watched: 2 };
      arr.sort(function (a, b) {
        var oa = ORD[a.status] != null ? ORD[a.status] : 1;
        var ob = ORD[b.status] != null ? ORD[b.status] : 1;
        return oa - ob;
      });
    }
    // "recent" = keep vwlGet()'s order as-is (newest added first already)
    return arr;
  }

  function filterWlList(list, show) {
    if (!show || show === "all") return list;
    return list.filter(function (i) {
      return (i.status || "planning") === show;
    });
  }

  /* ── Watch-status menu (one shared element, portaled to <body>) ── */
  var wlMenu = null;
  var wlMenuKey = null;

  function ensureWlMenu() {
    if (wlMenu) return;
    wlMenu = document.createElement("div");
    wlMenu.id = "wlStatusMenu";
    wlMenu.className = "wl-status-menu";
    var head = document.createElement("div");
    head.className = "wl-status-menu-label";
    head.textContent = "Watch status";
    wlMenu.appendChild(head);
    WL_STATUSES.forEach(function (pair) {
      var opt = document.createElement("button");
      opt.type = "button";
      opt.className = "wl-status-opt";
      opt.dataset.st = pair[0];
      opt.textContent = pair[1];
      opt.addEventListener("click", function (e) {
        e.stopPropagation();
        var key = wlMenuKey;
        closeWlMenu();
        if (key && typeof window.vwlSetStatus === "function") {
          window.vwlSetStatus(key, pair[0]);
        }
      });
      wlMenu.appendChild(opt);
    });
    document.body.appendChild(wlMenu);
  }

  function openWlMenu(pill, item) {
    ensureWlMenu();
    wlMenuKey = item.key;
    var cur = item.status || "planning";
    wlMenu.querySelectorAll(".wl-status-opt").forEach(function (o) {
      o.classList.toggle("active", o.dataset.st === cur);
    });
    // Anchored beside the pill on desktop; the mobile stylesheet turns
    // this into a bottom sheet and overrides these coordinates
    var r = pill.getBoundingClientRect();
    var w = 160;
    var x = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    var y = Math.min(window.innerHeight - 180, r.bottom + 8);
    wlMenu.style.left = x + "px";
    wlMenu.style.top = y + "px";
    wlMenu.classList.add("open");
  }

  function closeWlMenu() {
    if (wlMenu) wlMenu.classList.remove("open");
    wlMenuKey = null;
  }

  function buildWlCard(item) {
    var div = document.createElement("div");
    div.className = "movie-item";
    if (item.aniId != null) div.dataset.aniId = String(item.aniId);
    else {
      div.dataset.movie = item.key;
      div.dataset.cat = item.cat;
    }
    var img = document.createElement("img");
    img.src = item.image || "https://via.placeholder.com/150";
    img.loading = "lazy";
    var p = document.createElement("p");
    p.className = "kanit-extralight";
    p.textContent = item.title || item.key;
    div.appendChild(img);
    div.appendChild(p);

    // Status pill (top-right; the +/✓ button owns top-left). The menu is a
    // single element portaled to <body> — .movie-item clips overflow, so an
    // in-card dropdown would be cut off. vwlSetStatus fires vwl-updated,
    // which re-renders this whole view with the new pill.
    var status = item.status || "planning";
    var pill = document.createElement("button");
    pill.type = "button";
    pill.className = "wl-status-pill wl-st-" + status;
    pill.title = wlStatusLabel(status) + " — click to change";
    pill.setAttribute("aria-label", "Watch status: " + wlStatusLabel(status));
    pill.addEventListener("click", function (e) {
      e.stopPropagation();
      if (wlMenu && wlMenu.classList.contains("open") && wlMenuKey === item.key) {
        closeWlMenu();
      } else {
        openWlMenu(pill, item);
      }
    });
    div.appendChild(pill);
    div.addEventListener("click", function () {
      var aniId =
        item.aniId ||
        (item.key && item.key.indexOf("ANI_") === 0
          ? item.key.slice(4)
          : null);
      if (aniId && typeof window.openAnikotoById === "function") {
        window.openAnikotoById(aniId);
      } else if (
        item.key &&
        /^VD[MT]_/.test(item.key) &&
        typeof window.openVidnestById === "function"
      ) {
        // Vidnest items are injected into mediaData on demand — viroPlay()
        // below no-ops if the entry doesn't exist yet this session.
        window.openVidnestById(item.key);
      } else if (
        item.key &&
        item.key.indexOf("IPTVCH_") === 0 &&
        typeof window.openIptvChannel === "function"
      ) {
        // IPTV channel — iptv.js loads the playlist and jumps to it
        window.openIptvChannel(item.key);
      } else if (typeof window.viroPlay === "function") {
        window.viroPlay(item.cat, item.key);
      }
    });
    return div;
  }

  function renderWatchlistView() {
    var ml = $("movieList");
    if (!ml) return;
    ml.innerHTML = "";
    var list = typeof window.vwlGet === "function" ? window.vwlGet() : [];
    if (!list.length) {
      ml.innerHTML =
        '<p style="grid-column:1/-1;text-align:center;padding:40px 0;opacity:.55;">' +
        "Your watchlist is empty — hover a poster and press + to add titles.</p>";
      return;
    }
    var prefs = getWlPrefs();
    list = filterWlList(list, prefs.show);
    if (!list.length) {
      ml.innerHTML =
        '<p style="grid-column:1/-1;text-align:center;padding:40px 0;opacity:.55;">' +
        "Nothing marked as “" + wlStatusLabel(prefs.show) + "” yet.</p>";
      return;
    }
    if (!prefs.group) {
      sortWlList(list, prefs.sort).forEach(function (item) {
        ml.appendChild(buildWlCard(item));
      });
      return;
    }
    var groups = { Movies: [], "TV Shows": [], Anime: [] };
    list.forEach(function (item) {
      groups[wlBucket(item)].push(item);
    });
    ["Movies", "TV Shows", "Anime"].forEach(function (name) {
      if (!groups[name].length) return;
      var head = document.createElement("div");
      head.className = "wl-group-header";
      head.textContent = name + " (" + groups[name].length + ")";
      ml.appendChild(head);
      sortWlList(groups[name], prefs.sort).forEach(function (item) {
        ml.appendChild(buildWlCard(item));
      });
    });
  }

  /* ── Sort & group slide-out panel ────────────────────────────────── */
  function ensureWlToolbar() {
    if ($("wlToolbar")) return;
    var wrapper = $("movieListWrapper");
    if (!wrapper) return;

    var bar = document.createElement("div");
    bar.id = "wlToolbar";
    bar.className = "wl-toolbar";

    var toggle = document.createElement("button");
    toggle.id = "wlSortToggle";
    toggle.type = "button";
    toggle.className = "wl-sort-toggle";
    toggle.textContent = "⇅ Sort & Group";

    var panel = document.createElement("div");
    panel.id = "wlSortPanel";
    panel.className = "wl-sort-panel";

    var sortLabel = document.createElement("label");
    sortLabel.textContent = "Sort by";
    var sortSelect = document.createElement("select");
    sortSelect.id = "wlSortSelect";
    [
      ["recent", "Recently added"],
      ["status", "Watching first"],
      ["az", "Title A → Z"],
      ["za", "Title Z → A"],
    ].forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      sortSelect.appendChild(o);
    });
    sortLabel.appendChild(sortSelect);

    var showLabel = document.createElement("label");
    showLabel.textContent = "Show";
    var showSelect = document.createElement("select");
    showSelect.id = "wlShowSelect";
    [["all", "Everything"]].concat(WL_STATUSES).forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      showSelect.appendChild(o);
    });
    showLabel.appendChild(showSelect);

    var groupLabel = document.createElement("label");
    groupLabel.className = "wl-group-check";
    var groupCheck = document.createElement("input");
    groupCheck.type = "checkbox";
    groupCheck.id = "wlGroupCheck";
    groupLabel.appendChild(groupCheck);
    groupLabel.appendChild(document.createTextNode("Separate Movies / TV Shows / Anime"));

    panel.appendChild(sortLabel);
    panel.appendChild(showLabel);
    panel.appendChild(groupLabel);
    bar.appendChild(toggle);
    bar.appendChild(panel);
    wrapper.insertAdjacentElement("beforebegin", bar);

    var prefs = getWlPrefs();
    sortSelect.value = prefs.sort;
    showSelect.value = prefs.show || "all";
    groupCheck.checked = prefs.group;

    toggle.addEventListener("click", function () {
      panel.classList.toggle("wl-sort-open");
    });
    document.addEventListener("click", function (e) {
      if (!bar.contains(e.target)) panel.classList.remove("wl-sort-open");
    });
    sortSelect.addEventListener("change", function () {
      var p = getWlPrefs();
      p.sort = sortSelect.value;
      saveWlPrefs(p);
      renderWatchlistView();
    });
    showSelect.addEventListener("change", function () {
      var p = getWlPrefs();
      p.show = showSelect.value;
      saveWlPrefs(p);
      renderWatchlistView();
    });
    groupCheck.addEventListener("change", function () {
      var p = getWlPrefs();
      p.group = groupCheck.checked;
      saveWlPrefs(p);
      renderWatchlistView();
    });
  }

  function showWlToolbar() {
    ensureWlToolbar();
    var bar = $("wlToolbar");
    if (bar) bar.style.display = "flex";
  }
  function hideWlToolbar() {
    var bar = $("wlToolbar");
    if (bar) {
      bar.style.display = "none";
      var panel = $("wlSortPanel");
      if (panel) panel.classList.remove("wl-sort-open");
    }
  }

  function showWatchlist() {
    var hero = $("hero"),
      wrapper = $("movieListWrapper"),
      nav = $("categoryNavBar");
    if (hero) hero.style.display = "none";
    if (nav) nav.style.display = "none";
    if (wrapper) wrapper.style.display = "block";
    window._vwlCurrentCat = null; // keeps the Anikoto section hidden
    showWlToolbar();
    renderWatchlistView();
    window.setRailActive("watchlist");
    watchlistViewOpen = true;
  }

  /* ── Continue watching (rail) ───────────────────────────────────── */
  function getCW() {
    try {
      return JSON.parse(localStorage.getItem("vw_continue") || "[]");
    } catch (_) {
      return [];
    }
  }

  // How many entries the rail shows — user-set in Settings (sidebar.js)
  function cwLimit() {
    var n = parseInt(localStorage.getItem("vw_cw_count") || "3", 10);
    return n >= 1 && n <= 15 ? n : 3;
  }

  function renderCW() {
    var wrap = $("railCw"),
      holder = $("railCwItems");
    if (!wrap || !holder) return;
    var list = getCW();
    if (!list.length) {
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "";
    holder.innerHTML = "";
    list.slice(0, cwLimit()).forEach(function (it) {
      var btn = document.createElement("button");
      btn.className = "cw-item";
      btn.type = "button";

      var metaBits = [];
      if (it.seasonLabel) metaBits.push(it.seasonLabel);
      metaBits.push(it.live ? "LIVE" : it.total > 1 ? "E" + ((it.ep || 0) + 1) : "Movie");
      var meta = metaBits.join(" · ");
      btn.title = (it.title || it.mov) + " — " + meta;

      var thumb = document.createElement("span");
      thumb.className = "cw-thumb";
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.onerror = function () {
        img.style.display = "none";
      };
      // Old saves point at pitsport.xyz/favicon.ico, which no longer resolves
      if (it.image && it.image.indexOf("pitsport.xyz/favicon") !== -1) {
        it.image = window.shows?.PITSORT?.image || "";
      }
      if (it.image) img.src = it.image;
      else img.style.display = "none";
      var bar = document.createElement("i");
      bar.style.width =
        (it.total > 1
          ? Math.min(100, Math.round((((it.ep || 0) + 1) / it.total) * 100))
          : 100) + "%";
      thumb.appendChild(img);
      thumb.appendChild(bar);

      var text = document.createElement("span");
      text.className = "cw-text";
      var t = document.createElement("span");
      t.className = "t";
      t.textContent = it.title || it.mov;
      var m = document.createElement("span");
      m.className = "m";
      m.textContent = meta;
      text.appendChild(t);
      text.appendChild(m);

      btn.appendChild(thumb);
      btn.appendChild(text);
      btn.addEventListener("click", function () {
        if (typeof window.viroResume === "function") {
          window.viroResume(it.cat, it.mov, it.season, it.ep, it.dubbed);
        }
      });
      holder.appendChild(btn);
    });
  }

  /* ── Live sports strip (PitSport) ───────────────────────────────── */
  function renderSports() {
    var strip = $("sportsStrip");
    if (!strip) return;
    var d = window.shows && window.shows.PITSORT;
    var live = d && d.PSLiveNow,
      up = d && d.PSUpcoming;
    if (!live && !up) {
      strip.style.display = "none";
      return;
    }
    strip.innerHTML = "";

    var head = document.createElement("div");
    head.className = "sports-head";
    head.innerHTML = '<span class="live-dot"></span><b>Live sports</b>';
    strip.appendChild(head);

    function addItems(seasonKey, seasonData, badgeClass, badgeText, max) {
      (seasonData.episodeTitles || [])
        .slice(0, max)
        .forEach(function (title, i) {
          var el = document.createElement("div");
          el.className = "sport";
          var badge = document.createElement("span");
          badge.className = "sbadge " + badgeClass;
          badge.textContent = badgeText;
          var st = document.createElement("span");
          st.className = "st";
          st.textContent = title;
          el.appendChild(badge);
          el.appendChild(st);
          el.addEventListener("click", function () {
            if (typeof window.viroResume === "function") {
              window.viroResume("shows", "PITSORT", seasonKey, i);
            }
          });
          strip.appendChild(el);
        });
    }
    if (live) addItems("PSLiveNow", live, "live", "LIVE", 4);
    if (up) addItems("PSUpcoming", up, "soon", "SOON", 3);

    var more = document.createElement("span");
    more.className = "more";
    more.textContent = "all →";
    more.addEventListener("click", function () {
      if (typeof window.viroResume === "function") {
        window.viroResume("shows", "PITSORT");
      }
    });
    strip.appendChild(more);
    strip.style.display = "flex";
  }

  /* ── Watchlist state sync (hero + view) ─────────────────────────
     Poster +/✓ buttons are .vwl-add-btn now; watchlist.js syncs them. */
  function syncWatchlistButtons() {
    if (typeof window.vwlHas !== "function") return;
    var heroWl = $("heroWlBtn");
    if (heroWl && heroWl.dataset.key) {
      heroWl.textContent = window.vwlHas(heroWl.dataset.key)
        ? "✓ In watchlist"
        : "+ Watchlist";
    }
    if (watchlistViewOpen) renderWatchlistView();
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  function init() {
    var brand = $("railBrand");
    if (brand) brand.addEventListener("click", goHome);
    var home = $("railHomeBtn");
    if (home) home.addEventListener("click", goHome);
    var headerBrand = $("headerBrand");
    if (headerBrand) headerBrand.addEventListener("click", goHome);
    var wlBtn = $("railWatchlistBtn");
    if (wlBtn) wlBtn.addEventListener("click", showWatchlist);

    // "see all →" under Newest added → open the Anime catalog
    var seeAll = $("newestSeeAll");
    if (seeAll) {
      seeAll.addEventListener("click", function (e) {
        e.preventDefault();
        var animeBtn = document.querySelector('.rail-item[data-cat="anime"]');
        if (animeBtn) animeBtn.click();
      });
    }

    // Typing a search replaces the watchlist grid — drop the flag
    var si = $("searchInput");
    if (si) {
      si.addEventListener("input", function () {
        if (si.value) watchlistViewOpen = false;
      });
    }

    // Click/tap outside the status menu (or scrolling) closes it
    document.addEventListener("mousedown", function (e) {
      if (!wlMenu || !wlMenu.classList.contains("open")) return;
      if (wlMenu.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".wl-status-pill")) return;
      closeWlMenu();
    });
    window.addEventListener("scroll", closeWlMenu, {
      passive: true,
      capture: true,
    });

    renderCW();
    renderSports();
    window.addEventListener("vw-cw-updated", renderCW);
    window.addEventListener("pitsportReady", renderSports);
    window.addEventListener("vwl-updated", syncWatchlistButtons);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
