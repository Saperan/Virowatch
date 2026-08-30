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

  // ms the pointer must rest before the card shows (localStorage override) — halved for quicker feel
  var HOVER_DELAY = Number(localStorage.getItem("vw_hover_delay")) || 750;
  var CARD_W = 340;
  var META_KEY = "vw_ani_meta_v1";
  var META_TTL = 7 * 24 * 3600 * 1000;
  var META_MAX = 400; // prune oldest entries beyond this many titles
  var BACKDROP = "https://image.tmdb.org/t/p/w780";

  // Mobile / touch: no real hover and no space — stay out of the way.
  // TV mode (tv-nav.js) forwards focus moves as synthetic mouseovers, so
  // the cards stay alive there even though TVs report coarse/no-hover.
  function hoverUnavailable() {
    if (document.body.classList.contains("vw-tv")) return false;
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
    txt = ta.value;
    // collapse 1-2 extra spaces/tabs/newlines that make gaps look wide
    txt = txt.replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").replace(/\n/g, " ").replace(/ {2,}/g, " ").trim();
    txt = txt.replace(/\s{2,}/g, " ");
    return txt;
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
    meta.de = (d.overview || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
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

  /* ── Age rating ─────────────────────────────────────────────────────── */
  var ageCache = {};
  function fetchAgeRating(kind, id, title) {
    var cacheKey = kind + ":" + (id || title || "");
    if (ageCache[cacheKey] != null) return Promise.resolve(ageCache[cacheKey]);
    // TMDB movies/TV with id
    if ((kind === "movie-id" || kind === "tv-id") && id && window.vidnestTmdb) {
      var isTv = kind === "tv-id";
      var path = isTv ? "/tv/" + id + "/content_ratings" : "/movie/" + id + "/release_dates";
      return window.vidnestTmdb(path, {}).then(function (d) {
        var rating = "";
        try {
          if (isTv) {
            var results = d && d.results;
            if (results && results.length) {
              var us = results.find(function (r) { return r.iso_3166_1 === "US"; }) || results[0];
              rating = us && us.rating ? us.rating : "";
            }
          } else {
            var results2 = d && d.results;
            if (results2 && results2.length) {
              var us2 = results2.find(function (r) { return r.iso_3166_1 === "US"; }) || results2[0];
              var rel = us2 && us2.release_dates && us2.release_dates[0];
              rating = rel && rel.certification ? rel.certification : "";
            }
          }
        } catch (_) {}
        if (!rating && d && d.rating) rating = d.rating;
        ageCache[cacheKey] = rating || "";
        return rating || "";
      }).catch(function () { ageCache[cacheKey] = ""; return ""; });
    }
    // Anime — try TMDB TV rating first for granularity, fallback to AniList isAdult
    if ((kind === "ani-id" || kind === "ani-q") && title) {
      var q2 = title;
      // try TMDB TV search for anime title
      if (window.vidnestTmdb) {
        return window.vidnestTmdb("/search/tv", { query: q2 }).then(function (r) {
          var first = r && r.results && r.results[0];
          if (first && first.id) {
            return fetchAgeRating("tv-id", String(first.id), "");
          }
          // fallback to AniList isAdult
          if (kind === "ani-id" && id) {
            return gql("query($id:Int){Media(id:$id,type:ANIME){isAdult}}", { id: Number(id) }).then(function (j) {
              var m = j && j.data && j.data.Media;
              var r2 = m && m.isAdult ? "18+" : "PG-13";
              ageCache[cacheKey] = r2;
              return r2;
            }).catch(function () { ageCache[cacheKey] = ""; return ""; });
          }
          if (q2) {
            return gql("query($q:String){Media(search:$q,type:ANIME){isAdult}}", { q: q2 }).then(function (j) {
              var m = j && j.data && j.data.Media;
              var r2 = m && m.isAdult ? "18+" : "PG-13";
              ageCache[cacheKey] = r2;
              return r2;
            }).catch(function () { ageCache[cacheKey] = ""; return ""; });
          }
          ageCache[cacheKey] = "PG-13";
          return "PG-13";
        }).catch(function () {
          // TMDB failed, fallback to AniList
          if (kind === "ani-id" && id) {
            return gql("query($id:Int){Media(id:$id,type:ANIME){isAdult}}", { id: Number(id) }).then(function (j) {
              var m = j && j.data && j.data.Media;
              var r2 = m && m.isAdult ? "18+" : "PG-13";
              ageCache[cacheKey] = r2;
              return r2;
            }).catch(function () { ageCache[cacheKey] = ""; return ""; });
          }
          ageCache[cacheKey] = "PG-13";
          return "PG-13";
        });
      }
      // no vidnestTmdb, use AniList
      if (kind === "ani-id" && id) {
        return gql("query($id:Int){Media(id:$id,type:ANIME){isAdult}}", { id: Number(id) }).then(function (j) {
          var m = j && j.data && j.data.Media;
          var r2 = m && m.isAdult ? "18+" : "PG-13";
          ageCache[cacheKey] = r2;
          return r2;
        }).catch(function () { ageCache[cacheKey] = ""; return ""; });
      }
      ageCache[cacheKey] = "PG-13";
      return Promise.resolve("PG-13");
    }
    // Fallback: try TMDB search for title
    if ((kind === "movie-q" || kind === "tv-q") && title && window.vidnestTmdb) {
      var tv2 = kind === "tv-q";
      return window.vidnestTmdb(tv2 ? "/search/tv" : "/search/movie", { query: title }).then(function (r) {
        var first = r && r.results && r.results[0];
        if (!first || !first.id) { ageCache[cacheKey] = ""; return ""; }
        return fetchAgeRating(tv2 ? "tv-id" : "movie-id", String(first.id), "");
      }).catch(function () { ageCache[cacheKey] = ""; return ""; });
    }
    return Promise.resolve("");
  }
  // Translate TV-MA/PG-13 etc. → +16/+13 for display
  function toPlus(raw) {
    if (!raw) return "";
    var s = String(raw).trim().toUpperCase();
    if (s[0] === "+") return s;
    if (s === "G" || s === "TV-G" || s === "TV-Y" || s === "TV-Y7") return "+0";
    if (s === "PG" || s === "TV-PG") return "+7";
    if (s === "PG-13" || s === "TV-14") return "+13";
    if (s === "R" || s === "TV-MA" || s === "NC-17") return "+16";
    if (s === "18+" || s === "X" || s === "NC-17") return "+18";
    if (/^\d+$/.test(s)) return "+" + s;
    return s;
  }
  window.vwAgeToPlus = toPlus;
  window.vwGetAgeRating = fetchAgeRating;
  window.vwAgeCache = ageCache;
  // Ensure every piece of content gets an age rating stored for randomizer
  var AGE_STORE_KEY = "vw_age_store_v1";
  var ageStore = {};
  try { ageStore = JSON.parse(localStorage.getItem(AGE_STORE_KEY) || "{}"); } catch (_) { ageStore = {}; }
  function saveAgeStore() { try { localStorage.setItem(AGE_STORE_KEY, JSON.stringify(ageStore)); } catch (_) {} }
  window.vwEnsureAge = function (key, kind, id, title) {
    if (!key || ageStore[key]) return Promise.resolve(ageStore[key]);
    return fetchAgeRating(kind, id, title).then(function (r) {
      if (r) { ageStore[key] = r; saveAgeStore(); }
      return r || "";
    });
  };
  window.vwAgeStore = ageStore;
  var card, bannerEl, titleEl, ageEl, tagsEl, descEl, moreBtn;
  function ensureCard() {
    if (card) return;
    injectDetailCSS();
    card = document.createElement("div");
    card.id = "vwHoverCard";
    card.innerHTML =
      '<div class="vwh-banner"></div>' +
      '<div class="vwh-body">' +
      '<div class="vwh-title-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><div class="vwh-title" style="margin-bottom:0;flex:1;"></div><span class="vwh-age" style="display:none;"></span></div>' +
      '<div class="vwh-tags"></div>' +
      '<p class="vwh-desc"></p>' +
      '<button class="vwh-more" type="button">Read more</button>' +
      "</div>";
    document.body.appendChild(card);
    bannerEl = card.querySelector(".vwh-banner");
    titleEl = card.querySelector(".vwh-title");
    ageEl = card.querySelector(".vwh-age");
    tagsEl = card.querySelector(".vwh-tags");
    descEl = card.querySelector(".vwh-desc");
    moreBtn = card.querySelector(".vwh-more");
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
    ageEl.textContent = "";
    ageEl.style.display = "none";
    (function () {
      var k = kindOf(el);
      var id = null;
      if (k === "movie-id" || k === "tv-id") { try { id = el.dataset.movie.slice(4); } catch (_) {} }
      else if (k === "ani-id") id = el.dataset.aniListId;
      var t = meta.ti || titleOf(el);
      fetchAgeRating(k, id, t).then(function (r) {
        var p = toPlus(r);
        if (p) { ageEl.textContent = p; ageEl.style.display = ""; position(el); }
      });
    })();
    bannerEl.style.backgroundImage = meta.ba ? 'url("' + meta.ba + '")' : "";
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
    // white Read more at the cut-off — always show when there is a real description
    var needsMore = meta.de && meta.de.length > 120;
    moreBtn.style.display = needsMore ? "" : "none";
    if (needsMore) {
      moreBtn._meta = meta;
      moreBtn._el = el;
      moreBtn.onclick = function (ev) {
        ev.stopPropagation();
        hide();
        openDetail(moreBtn._el, moreBtn._meta);
      };
    }
    card.style.width = CARD_W + "px";
    card.classList.add("vwh-show");
    position(el);
  }

  /* ── Detail popup (Read more) ───────────────────────────────────── */
  var detailOverlay = null;
  function injectDetailCSS() {
    if (document.getElementById("vwDetailCSS")) return;
    var s = document.createElement("style");
    s.id = "vwDetailCSS";
    s.textContent = `
      .vwh-more{margin-top:10px !important;padding:7px 16px !important;border-radius:99px !important;background:#fff !important;color:#000 !important;font-family:"Kanit",sans-serif !important;font-size:.78rem !important;font-weight:600 !important;border:none !important;cursor:pointer !important;box-shadow:0 2px 10px rgba(0,0,0,.25) !important;display:inline-block !important;}
      .vwh-more:hover{background:#eaeaea !important;}
      .vw-age-badge{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.82);color:#fff;font-family:"Kanit",sans-serif;font-size:.58rem;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:6px;z-index:3;pointer-events:none;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,.14);}
      .movie-item, .ani-card, .vidnest-card, .poster{position:relative;}
      #vwDetailOverlay.vws-overlay{ z-index: 10060; }
      .vw-detail-modal{ width: 70vw; max-width: 70vw; max-height: 70vh; overflow-y:auto; overflow-x:hidden; display:block; background:#141417; border-radius:14px; position:relative; }
      .vw-detail-banner{ height: 280px; background-size: cover; background-position: center 30%; background-color: #101013; flex-shrink:0; border-radius:14px 14px 0 0; position:relative; z-index:0; }
      .vw-detail-close{ position:sticky; top:10px; float:right; margin:10px 10px -32px 0; width:32px; height:32px; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; border:1px solid rgba(255,255,255,.15); font-size:1.2rem; line-height:1; cursor:pointer; backdrop-filter:blur(4px); z-index:4; display:flex; align-items:center; justify-content:center; }
      .vw-detail-body{ display:flex; gap:20px; padding:0 20px 20px; overflow:visible; background:transparent; position:relative; z-index:1; }
      .vw-detail-poster{ width:160px; height:230px; object-fit:cover; border-radius:12px; flex-shrink:0; background:#1a1a1a; margin-top:-80px; border:3px solid #141417; box-shadow:0 12px 32px rgba(0,0,0,.5); position:relative; z-index:2; }
      .vw-detail-info{ flex:1; min-width:0; padding-top:4px; }
      .vw-detail-title{ font-family:"Kanit",sans-serif; font-size:1.45rem; font-weight:700; color:#fff; line-height:1.25; margin-bottom:8px; }
      .vwh-age, .vw-detail-age{ padding:2px 8px; border-radius:6px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18); color:#fff; font-size:.68rem; font-weight:700; letter-spacing:.03em; white-space:nowrap; }
      .vw-detail-age{ font-size:.75rem; padding:3px 10px; }
      .vw-detail-meta{ font-size:.78rem; color:rgba(255,255,255,.55); margin-bottom:10px; }
      .vw-detail-tags{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
      .vw-detail-tag{ padding:4px 12px; border-radius:99px; background:#fff !important; color:#000 !important; font-family:"Kanit",sans-serif; font-size:.72rem; font-weight:600; border:none; cursor:pointer; }
      .vw-detail-tag:hover{ background:#eaeaea !important; }
      .vw-detail-desc{ font-size:.85rem; line-height:1.6; color:rgba(255,255,255,.78); white-space:pre-wrap; word-spacing:normal !important; letter-spacing:normal !important; word-break:break-word; }
      .vw-detail-cast{ margin-top:12px; font-size:.8rem; line-height:1.5; color:rgba(255,255,255,.65); }
      .vwh-desc{ word-spacing:normal !important; letter-spacing:normal !important; white-space:normal !important; }
      .vw-detail-cast b{ color:#fff; }
      @media(max-width:480px){ .vw-detail-body{ flex-direction:column; align-items:center; text-align:center; padding:0 16px 16px; } .vw-detail-poster{ width:140px; height:200px; margin-top:-50px; } .vw-detail-banner{ height: 200px; } .vw-detail-info{ width:100%; padding-top:8px; } }
    `;
    document.head.appendChild(s);
  }
  function ensureDetail() {
    injectDetailCSS();
    if (detailOverlay) return;
    detailOverlay = document.createElement("div");
    detailOverlay.id = "vwDetailOverlay";
    detailOverlay.className = "vws-overlay";
    detailOverlay.setAttribute("aria-hidden", "true");
    detailOverlay.innerHTML =
      '<div class="vws-modal vw-detail-modal" role="dialog" aria-modal="true" aria-label="Details">' +
        '<div class="vw-detail-banner"></div>' +
        '<button type="button" class="vws-close vw-detail-close" aria-label="Close">×</button>' +
        '<div class="vw-detail-body">' +
          '<img class="vw-detail-poster" alt="" />' +
          '<div class="vw-detail-info">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;"><div class="vw-detail-title" style="margin-bottom:0;flex:1;"></div><span class="vw-detail-age" style="display:none;"></span></div>' +
            '<div class="vw-detail-meta"></div>' +
            '<div class="vw-detail-tags"></div>' +
            '<div class="vw-detail-desc"></div>' +
            '<div class="vw-detail-cast"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(detailOverlay);
    detailOverlay.addEventListener("mousedown", function (e) { if (e.target === detailOverlay) closeDetail(); });
    detailOverlay.querySelector(".vw-detail-close").addEventListener("click", closeDetail);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && detailOverlay.classList.contains("vws-open")) closeDetail(); });
  }
  function closeDetail() {
    if (!detailOverlay) return;
    detailOverlay.classList.remove("vws-open");
    detailOverlay.setAttribute("aria-hidden", "true");
  }
  function openDetail(el, meta) {
    ensureDetail();
    var posterSrc = "";
    var imgEl = el.querySelector("img");
    if (imgEl && imgEl.src) posterSrc = imgEl.src;
    var bannerSrc = meta.ba || "";
    var title = meta.ti || titleOf(el) || "";
    var desc = meta.de || "No description available.";
    var dBanner = detailOverlay.querySelector(".vw-detail-banner");
    var dPoster = detailOverlay.querySelector(".vw-detail-poster");
    var dTitle = detailOverlay.querySelector(".vw-detail-title");
    var dAge = detailOverlay.querySelector(".vw-detail-age");
    var dMeta = detailOverlay.querySelector(".vw-detail-meta");
    var dTags = detailOverlay.querySelector(".vw-detail-tags");
    var dDesc = detailOverlay.querySelector(".vw-detail-desc");
    var dCast = detailOverlay.querySelector(".vw-detail-cast");
    dAge.textContent = "";
    dAge.style.display = "none";
    (function () {
      var k = kindOf(el);
      var id2 = null;
      if (k === "movie-id" || k === "tv-id") { try { id2 = el.dataset.movie.slice(4); } catch (_) {} }
      else if (k === "ani-id") id2 = el.dataset.aniListId;
      var t2 = title;
      fetchAgeRating(k, id2, t2).then(function (r) {
        var p = toPlus(r);
        if (p) { dAge.textContent = p; dAge.style.display = ""; }
      });
    })();
    dBanner.style.backgroundImage = bannerSrc ? 'url("' + bannerSrc + '")' : "";
    dBanner.style.display = bannerSrc ? "" : "none";
    dPoster.src = posterSrc;
    dPoster.style.display = posterSrc ? "" : "none";
    dTitle.textContent = title;
    dDesc.textContent = desc;
    // white pilled genres — clickable to search
    dTags.innerHTML = "";
    (meta.ge || []).forEach(function (g) {
      var pill = document.createElement("button");
      pill.type = "button";
      pill.className = "vw-detail-tag";
      pill.textContent = g;
      pill.addEventListener("click", function () {
        closeDetail();
        hide();
        if (window.vwTagSearch) window.vwTagSearch(g);
        else {
          var si = document.getElementById("searchInput");
          if (si) { si.value = g; si.dispatchEvent(new Event("input", { bubbles: true })); si.focus(); }
        }
      });
      dTags.appendChild(pill);
    });
    dTags.style.display = meta.ge && meta.ge.length ? "" : "none";
    dMeta.textContent = "";
    dCast.innerHTML = '<span style="opacity:.6">Loading cast & rating…</span>';
    detailOverlay.classList.add("vws-open");
    detailOverlay.setAttribute("aria-hidden", "false");
    // fetch actors / rating from TMDB (movies/TV) — for anime just keep genres
    var kind = kindOf(el);
    var tmdbId = null;
    var isTv = false;
    if (kind === "movie-id") { tmdbId = el.dataset.movie.slice(4); isTv = false; }
    else if (kind === "tv-id") { tmdbId = el.dataset.movie.slice(4); isTv = true; }
    if (tmdbId && window.vidnestTmdb) {
      var detailPath = (isTv ? "/tv/" : "/movie/") + tmdbId;
      var creditsPath = detailPath + (isTv ? "/aggregate_credits" : "/credits");
      // try appended credits first, fallback to separate credits
      window.vidnestTmdb(detailPath, { append_to_response: isTv ? "aggregate_credits" : "credits" }).then(function (d) {
        if (!d) return window.vidnestTmdb(creditsPath, {}).then(function (c) { return { detail: null, credits: c }; }).then(function (o) { return o; });
        var credits = d.credits || d.aggregate_credits || null;
        if (!credits) return window.vidnestTmdb(creditsPath, {}).then(function (c) { return { detail: d, credits: c }; });
        return { detail: d, credits: credits };
      }).then(function (res) {
        if (!res) return;
        var detail = res.detail;
        var credits = res.credits;
        // rating
        var rating = "";
        var srcDetail = detail || null;
        // if we fetched via append, detail is the main object, else we need to fetch detail again
        function renderCastAndRating(det, cred) {
          var parts = [];
          if (det && det.vote_average) parts.push("★ " + Number(det.vote_average).toFixed(1) + "/10" + (det.vote_count ? " (" + det.vote_count.toLocaleString() + ")" : ""));
          if (det && det.release_date) parts.push(det.release_date.slice(0,4));
          else if (det && det.first_air_date) parts.push(det.first_air_date.slice(0,4));
          if (det && det.runtime) parts.push(det.runtime + " min");
          else if (det && det.episode_run_time && det.episode_run_time[0]) parts.push(det.episode_run_time[0] + " min");
          dMeta.textContent = parts.join(" · ");
          dMeta.style.display = dMeta.textContent ? "" : "none";
          if (cred && cred.cast && cred.cast.length) {
            var cast = cred.cast.slice(0, 8).map(function (c) { return c.name || c.original_name; }).filter(Boolean).join(", ");
            dCast.innerHTML = '<b>Cast:</b> ' + cast;
          } else {
            dCast.innerHTML = "";
          }
        }
        if (detail) {
          renderCastAndRating(detail, credits);
        } else {
          // we only have credits, fetch detail separately
          window.vidnestTmdb(detailPath, {}).then(function (det) { renderCastAndRating(det, credits); });
        }
      }).catch(function () { dCast.innerHTML = ""; });
    } else if (kind === "movie-q" || kind === "tv-q") {
      // title-only native entries — search then fetch
      var tv = kind === "tv-q";
      var q = titleOf(el);
      if (q && window.vidnestTmdb) {
        window.vidnestTmdb(tv ? "/search/tv" : "/search/movie", { query: q }).then(function (r) {
          var first = r && r.results && r.results[0];
          if (!first) { dCast.innerHTML = ""; return; }
          var id = first.id;
          var p = (tv ? "/tv/" : "/movie/") + id;
          return Promise.all([
            window.vidnestTmdb(p, {}),
            window.vidnestTmdb(p + (tv ? "/aggregate_credits" : "/credits"), {})
          ]).then(function (arr) {
            var det = arr[0], cred = arr[1];
            var parts = [];
            if (det && det.vote_average) parts.push("★ " + Number(det.vote_average).toFixed(1) + "/10");
            if (det && (det.release_date || det.first_air_date)) parts.push((det.release_date || det.first_air_date).slice(0,4));
            dMeta.textContent = parts.join(" · ");
            if (cred && cred.cast && cred.cast.length) {
              var cast = cred.cast.slice(0, 8).map(function (c) { return c.name; }).filter(Boolean).join(", ");
              dCast.innerHTML = '<b>Cast:</b> ' + cast;
            } else dCast.innerHTML = "";
          });
        }).catch(function () { dCast.innerHTML = ""; });
      } else { dCast.innerHTML = ""; }
    } else {
      dCast.innerHTML = "";
    }
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

  // inject early so first hover already has white button style
  try { injectDetailCSS(); } catch (_) {}
  // Attach age badge to any card (for grid display)
  function attachAgeBadge(el) {
    if (!el || el.querySelector(".vw-age-badge")) return;
    var k = kindOf(el);
    if (!k) return;
    var id = null;
    if (k === "movie-id" || k === "tv-id") { try { id = el.dataset.movie.slice(4); } catch (_) {} }
    else if (k === "ani-id") id = el.dataset.aniListId;
    var t = titleOf(el);
    var key = el.dataset.movie || el.dataset.aniId || t;
    if (!key) return;
    var cacheKey = el.dataset.movie ? el.dataset.movie : (el.dataset.aniId ? "ANI_" + el.dataset.aniId : t);
    // check store first
    if (ageStore[cacheKey]) {
      var b = document.createElement("span");
      b.className = "vw-age-badge";
      b.textContent = ageStore[cacheKey];
      el.appendChild(b);
      return;
    }
    fetchAgeRating(k, id, t).then(function (r) {
      if (!r || el.querySelector(".vw-age-badge")) return;
      ageStore[cacheKey] = r;
      saveAgeStore();
      var badge = document.createElement("span");
      badge.className = "vw-age-badge";
      badge.textContent = r;
      el.appendChild(badge);
    });
  }
  // Grid age badges disabled per user request — don't show under add-to-watchlist circle
  // keep hover/detail age only (small + big card)
  function observeAgeGrids() { return; }
  // if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeAgeGrids);
  // else observeAgeGrids();

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
