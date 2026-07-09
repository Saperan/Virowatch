/**
 * hover-info.js — Virowatch hover info cards (anime, movies, TV shows)
 *
 * Rest the pointer on a content card (native library, anikoto grid, vidnest
 * grids, search results, watchlist) and after a short delay a floating card
 * shows the banner/backdrop, description and genre tags.
 *
 * Sources:
 *  - Anime → public AniList GraphQL (no login). Genre chips run a tag
 *    search via window.vwTagSearch (content.js).
 *  - Movies / TV shows → TMDB through window.vidnestTmdb (vidnest-loader).
 *    TMDB genres aren't searchable tags here, so those chips are static.
 *
 * Cached a week in localStorage ("vw_ani_meta_v1"). Disabled on mobile /
 * touch — no pointer to hover with and no room for the card.
 */
(function () {
  "use strict";

  // ms the pointer must rest before the card shows (localStorage override)
  var HOVER_DELAY = Number(localStorage.getItem("vw_hover_delay")) || 1500;
  var CARD_W = 340;
  var META_KEY = "vw_ani_meta_v1";
  var META_TTL = 7 * 24 * 3600 * 1000;
  var META_MAX = 400; // prune oldest entries beyond this many titles
  var BACKDROP = "https://image.tmdb.org/t/p/w780";

  // Mobile / touch: no real hover and no space — stay out of the way
  function hoverUnavailable() {
    return (
      window.innerWidth <= 768 ||
      window.matchMedia("(hover: none), (pointer: coarse)").matches
    );
  }

  /* ── Metadata cache ─────────────────────────────────────────────── */
  var store = {};
  try {
    var o = JSON.parse(localStorage.getItem(META_KEY) || "null");
    if (o && o.d) store = o.d;
  } catch (_) {}

  function saveStore() {
    try {
      var keys = Object.keys(store);
      if (keys.length > META_MAX) {
        keys
          .sort(function (a, b) { return (store[a].t || 0) - (store[b].t || 0); })
          .slice(0, keys.length - META_MAX)
          .forEach(function (k) { delete store[k]; });
      }
      localStorage.setItem(META_KEY, JSON.stringify({ d: store }));
    } catch (_) {}
  }

  // Every fetcher resolves to this shape (or null on hard failure):
  // { t, src: "ani"|"tmdb", ti: title, de: description, ge: [genres], ba: art }
  function emptyMeta(src) {
    return { t: Date.now(), src: src, ti: "", de: "", ge: [], ba: "" };
  }

  var pending = {};
  function getMeta(key, fetcher) {
    var hit = store[key];
    if (hit && Date.now() - hit.t < META_TTL) return Promise.resolve(hit);
    if (pending[key]) return pending[key];
    pending[key] = fetcher().then(
      function (meta) {
        delete pending[key];
        store[key] = meta || emptyMeta("");
        saveStore();
        return store[key];
      },
      function () {
        delete pending[key];
        return hit || null; // stale beats nothing; misses stay unrecorded
      },
    );
    return pending[key];
  }

  /* ── AniList (anime) ────────────────────────────────────────────── */
  function gql(query, variables) {
    return fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: query, variables: variables }),
    }).then(function (r) { return r.json(); });
  }

  var ANI_FIELDS =
    "title{romaji english} description(asHtml:false) genres bannerImage coverImage{extraLarge}";

  // AniList descriptions arrive as loose HTML — reduce to plain text
  // (strip tags first, then a <textarea> decodes the entities safely)
  function cleanDesc(raw) {
    var txt = (raw || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\(Source:[^)]*\)\s*$/i, "");
    var ta = document.createElement("textarea");
    ta.innerHTML = txt;
    return ta.value.trim();
  }

  function metaFromAniList(m) {
    var meta = emptyMeta("ani");
    if (!m) return meta;
    meta.ti = (m.title && (m.title.english || m.title.romaji)) || "";
    meta.de = cleanDesc(m.description);
    meta.ge = m.genres || [];
    meta.ba =
      m.bannerImage || (m.coverImage && m.coverImage.extraLarge) || "";
    return meta;
  }

  function aniById(id) {
    return getMeta("id:" + id, function () {
      return gql(
        "query($id:Int){Media(id:$id,type:ANIME){" + ANI_FIELDS + "}}",
        { id: Number(id) },
      ).then(function (j) { return metaFromAniList(j && j.data && j.data.Media); });
    });
  }

  function aniByTitle(title) {
    return getMeta("q:" + title.toLowerCase(), function () {
      return gql(
        "query($q:String){Media(search:$q,type:ANIME){" + ANI_FIELDS + "}}",
        { q: title },
      ).then(function (j) { return metaFromAniList(j && j.data && j.data.Media); });
    });
  }

  /* ── TMDB (movies + TV shows) ───────────────────────────────────── */
  function tmdb(path, params) {
    return window.vidnestTmdb
      ? window.vidnestTmdb(path, params)
      : Promise.resolve(null);
  }

  function metaFromTmdb(d, tv) {
    var meta = emptyMeta("tmdb");
    if (!d) return meta;
    meta.ti = (tv ? d.name : d.title) || "";
    meta.de = (d.overview || "").trim();
    meta.ge = (d.genres || []).map(function (g) { return g.name; });
    meta.ba = d.backdrop_path
      ? BACKDROP + d.backdrop_path
      : d.poster_path
        ? BACKDROP + d.poster_path
        : "";
    return meta;
  }

  function tmdbById(id, tv) {
    return getMeta((tv ? "tt:" : "tm:") + id, function () {
      return tmdb((tv ? "/tv/" : "/movie/") + id, {}).then(function (d) {
        return metaFromTmdb(d, tv);
      });
    });
  }

  // Native entries only have a title — search TMDB, then pull the top
  // hit's details (the search payload has genre ids but not names)
  function tmdbByTitle(title, tv) {
    return getMeta((tv ? "tqt:" : "tqm:") + title.toLowerCase(), function () {
      return tmdb(tv ? "/search/tv" : "/search/movie", { query: title }).then(
        function (res) {
          var first = res && res.results && res.results[0];
          if (!first) return emptyMeta("tmdb");
          return tmdb((tv ? "/tv/" : "/movie/") + first.id, {}).then(
            function (d) { return metaFromTmdb(d, tv); },
          );
        },
      );
    });
  }

  /* ── Card element (one, reused) ─────────────────────────────────── */
  var card, bannerEl, titleEl, tagsEl, descEl;
  function ensureCard() {
    if (card) return;
    card = document.createElement("div");
    card.id = "vwHoverCard";
    card.innerHTML =
      '<div class="vwh-banner"></div>' +
      '<div class="vwh-body">' +
      '<div class="vwh-title"></div>' +
      '<div class="vwh-tags"></div>' +
      '<p class="vwh-desc"></p>' +
      "</div>";
    document.body.appendChild(card);
    bannerEl = card.querySelector(".vwh-banner");
    titleEl = card.querySelector(".vwh-title");
    tagsEl = card.querySelector(".vwh-tags");
    descEl = card.querySelector(".vwh-desc");
    // Moving onto the card keeps it open (anime genre chips are clickable)
    card.addEventListener("mouseenter", function () { clearTimeout(hideTid); });
    card.addEventListener("mouseleave", hide);
  }

  var hoverTid = null;
  var hideTid = null;
  var activeEl = null;
  var token = 0; // invalidates in-flight shows after hide()

  function hide() {
    clearTimeout(hoverTid);
    token++;
    activeEl = null;
    if (card) card.classList.remove("vwh-show");
  }

  function position(anchor) {
    var r = anchor.getBoundingClientRect();
    var h = card.offsetHeight || 320;
    var x = r.right + 14;
    if (x + CARD_W > window.innerWidth - 8) x = r.left - CARD_W - 14;
    if (x < 8) x = Math.min(window.innerWidth - CARD_W - 8, Math.max(8, r.left));
    var y = Math.max(8, Math.min(r.top, window.innerHeight - h - 8));
    card.style.left = x + "px";
    card.style.top = y + "px";
  }

  function show(el, meta) {
    ensureCard();
    titleEl.textContent = meta.ti || titleOf(el);
    bannerEl.style.backgroundImage = meta.ba ? 'url("' + meta.ba + '")' : "";
    bannerEl.style.display = meta.ba ? "" : "none";
    tagsEl.innerHTML = "";
    // Old cache entries predate `src` — they were all anime
    var searchableTags = meta.src !== "tmdb";
    (meta.ge || []).slice(0, 6).forEach(function (g) {
      var chip;
      if (searchableTags) {
        chip = document.createElement("button");
        chip.type = "button";
        chip.addEventListener("click", function (ev) {
          ev.stopPropagation();
          hide();
          if (window.vwTagSearch) window.vwTagSearch(g);
        });
      } else {
        chip = document.createElement("span");
        chip.className = "vwh-tag--static";
      }
      chip.classList.add("vwh-tag");
      chip.textContent = g;
      tagsEl.appendChild(chip);
    });
    tagsEl.style.display = meta.ge && meta.ge.length ? "" : "none";
    descEl.textContent = meta.de || "No description available yet.";
    card.style.width = CARD_W + "px";
    card.classList.add("vwh-show");
    position(el);
  }

  /* ── Which cards react, and where their data lives ──────────────── */
  var SELECTOR =
    "#movieList .movie-item, #anikoto-grid .ani-card, .vidnest-card";

  function titleOf(el) {
    var p = el.querySelector("p");
    return p ? p.textContent.trim() : "";
  }

  // "ani-id" | "ani-q" | "movie-id" | "tv-id" | "movie-q" | "tv-q" | null
  function kindOf(el) {
    if (el.dataset.aniListId) return "ani-id";
    if (el.classList.contains("ani-card") || el.dataset.aniId != null)
      return "ani-q"; // anikoto without a known AniList id → title search
    var key = el.dataset.movie || "";
    if (key === "PITSORT") return null; // live sports — no useful metadata
    if (key.indexOf("VDM_") === 0) return "movie-id";
    if (key.indexOf("VDT_") === 0) return "tv-id";
    var cat = el.dataset.cat;
    if (cat === "anime") return "ani-q";
    if (cat === "shows") return "tv-q";
    if (cat === "movies" || cat === "lunora") return "movie-q";
    return null;
  }

  function metaFor(el) {
    var kind = kindOf(el);
    if (!kind) return Promise.resolve(null);
    if (kind === "ani-id") return aniById(el.dataset.aniListId);
    if (kind === "movie-id")
      return tmdbById(el.dataset.movie.slice(4), false);
    if (kind === "tv-id") return tmdbById(el.dataset.movie.slice(4), true);
    var t = titleOf(el);
    if (!t) return Promise.resolve(null);
    if (kind === "ani-q") return aniByTitle(t);
    return tmdbByTitle(t, kind === "tv-q");
  }

  document.addEventListener("mouseover", function (e) {
    if (hoverUnavailable()) return;
    if (!e.target.closest) return;
    var el = e.target.closest(SELECTOR);
    if (!el) return;
    if (el === activeEl) {
      clearTimeout(hideTid);
      return;
    }
    if (!kindOf(el)) return;
    clearTimeout(hoverTid);
    clearTimeout(hideTid);
    activeEl = el;
    var myToken = ++token;
    var metaP = metaFor(el); // fetch right away…
    hoverTid = setTimeout(function () {
      // …show once the delay has passed AND the data is in
      metaP.then(function (meta) {
        if (myToken !== token || !meta) return;
        if (!meta.ti && !meta.de && !(meta.ge || []).length && !meta.ba) return;
        show(el, meta);
      });
    }, HOVER_DELAY);
  });

  document.addEventListener("mouseout", function (e) {
    if (!e.target.closest) return;
    var el = e.target.closest(SELECTOR);
    if (!el || el !== activeEl) return;
    var to = e.relatedTarget;
    if (to && (el.contains(to) || (card && card.contains(to)))) return;
    clearTimeout(hoverTid);
    hideTid = setTimeout(hide, 140);
  });

  // Anything that moves the page under the pointer kills the card
  window.addEventListener("scroll", hide, { passive: true, capture: true });
  window.addEventListener("wheel", hide, { passive: true, capture: true });
  document.addEventListener("mousedown", function (e) {
    if (card && card.contains(e.target)) return;
    hide();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") hide();
  });
})();
