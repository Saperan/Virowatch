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
  function getWlPrefs() {
    var d = { sort: "recent", group: false };
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
    }
    // "recent" = keep vwlGet()'s order as-is (newest added first already)
    return arr;
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
      ["az", "Title A → Z"],
      ["za", "Title Z → A"],
    ].forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      sortSelect.appendChild(o);
    });
    sortLabel.appendChild(sortSelect);

    var groupLabel = document.createElement("label");
    groupLabel.className = "wl-group-check";
    var groupCheck = document.createElement("input");
    groupCheck.type = "checkbox";
    groupCheck.id = "wlGroupCheck";
    groupLabel.appendChild(groupCheck);
    groupLabel.appendChild(document.createTextNode("Separate Movies / TV Shows / Anime"));

    panel.appendChild(sortLabel);
    panel.appendChild(groupLabel);
    bar.appendChild(toggle);
    bar.appendChild(panel);
    wrapper.insertAdjacentElement("beforebegin", bar);

    var prefs = getWlPrefs();
    sortSelect.value = prefs.sort;
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
    list.slice(0, 3).forEach(function (it) {
      var btn = document.createElement("button");
      btn.className = "cw-item";
      btn.type = "button";

      var metaBits = [];
      if (it.seasonLabel) metaBits.push(it.seasonLabel);
      metaBits.push(it.total > 1 ? "E" + ((it.ep || 0) + 1) : "Movie");
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
