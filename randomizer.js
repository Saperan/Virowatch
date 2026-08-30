/**
 * randomizer.js — "surprise me" dice button in the search pill.
 *
 * A 🎲 button sits in the right corner of the search field. Clicking it
 * opens a small panel where the user picks a type (All / Anime / Movies /
 * TV shows) and optionally a genre, then hits Randomize:
 *   - Anime  → random pick from AniList's popular list (optionally by
 *              genre), mapped to a playable anikoto entry
 *              (anikotoFindByAniList) and opened via openAnikotoById.
 *   - Movies → TMDB /discover/movie (window.vidnestTmdb), opened via
 *              openVidnestById("VDM_<id>").
 *   - TV     → TMDB /discover/tv, opened via openVidnestById("VDT_<id>").
 *   - All    → rolls one of the types that supports the chosen genre.
 *
 * Both catalogs are popularity-sorted with a random page + random row so
 * picks stay watchable instead of dredging the long tail.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var rand = function (n) { return Math.floor(Math.random() * n); };
  var pick = function (arr) { return arr[rand(arr.length)]; };

  /* ── Genre table ─────────────────────────────────────────────────
     ani: AniList genre string · mv/tv: TMDB genre ids (null = that
     type has no equivalent, so the type is skipped for this genre) */
  var GENRES = [
    { label: "Any" },
    { label: "Action", ani: "Action", mv: 28, tv: 10759 },
    { label: "Adventure", ani: "Adventure", mv: 12, tv: 10759 },
    { label: "Animation", ani: "Action", mv: 16, tv: 16 },
    { label: "Comedy", ani: "Comedy", mv: 35, tv: 35 },
    { label: "Crime", mv: 80, tv: 80 },
    { label: "Documentary", mv: 99, tv: 99 },
    { label: "Drama", ani: "Drama", mv: 18, tv: 18 },
    { label: "Family", mv: 10751, tv: 10751 },
    { label: "Fantasy", ani: "Fantasy", mv: 14, tv: 10765 },
    { label: "History", mv: 36, tv: 10768 },
    { label: "Horror", ani: "Horror", mv: 27, tv: 27 },
    { label: "Music", ani: "Music", mv: 10402, tv: 10402 },
    { label: "Mystery", ani: "Mystery", mv: 9648, tv: 9648 },
    { label: "Romance", ani: "Romance", mv: 10749, tv: 10749 },
    { label: "Sci-Fi", ani: "Sci-Fi", mv: 878, tv: 10765 },
    { label: "Thriller", ani: "Thriller", mv: 53, tv: 53 },
    { label: "War", mv: 10752, tv: 10768 },
    { label: "Western", mv: 37, tv: 37 },
    { label: "Kids", tv: 10762 },
    { label: "News", tv: 10763 },
    { label: "Reality", tv: 10764 },
    { label: "Soap", tv: 10766 },
    { label: "Talk", tv: 10767 },
    { label: "Isekai", aniTag: "Isekai" },
    { label: "Mecha", ani: "Mecha" },
    { label: "Psychological", ani: "Psychological" },
    { label: "Slice of Life", ani: "Slice of Life" },
    { label: "Sports", ani: "Sports" },
    { label: "Supernatural", ani: "Supernatural" },
    { label: "Historical", ani: "Historical" },
    { label: "Military", ani: "Military" },
    { label: "Parody", ani: "Parody" },
    { label: "Samurai", ani: "Samurai" },
    { label: "School", ani: "School" },
    { label: "Space", ani: "Space" },
    { label: "Super Power", ani: "Super Power" },
    { label: "Vampire", ani: "Vampire" },
    { label: "Harem", ani: "Harem" },
    { label: "Josei", ani: "Josei" },
    { label: "Seinen", ani: "Seinen" },
    { label: "Shoujo", ani: "Shoujo" },
    { label: "Shounen", ani: "Shounen" },
    { label: "Ecchi", ani: "Ecchi" },
    { label: "Hentai", ani: "Hentai" },
    { label: "Adult", ani: "Hentai", mv: null, tv: null },
    { label: "Yaoi", aniTag: "Yaoi" },
    { label: "Yuri", aniTag: "Yuri" },
  ];

  // content.js's genre/tag search reads this so every chip here is also
  // typeable in the search bar (incl. tag-based ones like Isekai)
  window.vwRandGenres = GENRES;

  var TYPES = [
    ["all", "All"],
    ["anime", "Anime"],
    ["movies", "Movies"],
    ["shows", "TV shows"],
    ["watchlist", "Watchlist"],
  ];

  /* ── Age range (dual slider, 0–18) ───────────────────────────────
     Mapped to what the sources can filter on:
       max → ceiling: <13 = PG (+ no Ecchi anime), <16 = PG-13,
             <18 = R, 18 = adult/NSFW allowed
       min → floor:   ≥7 = PG+, ≥13 = PG-13+, ≥16 = R+ (TMDB movies
             only — discover/tv has no certification filter), 18 =
             NSFW only (AniList isAdult:true) */
  var AGE_MIN_KEY = "vw_rand_age_min";
  var AGE_MAX_KEY = "vw_rand_age_max";

  var state = { type: "all", genres: ["Any"], ageMin: 0, ageMax: 16, busy: false, genreExpanded: false };
  // migration from old single genre
  try {
    var oldG = localStorage.getItem("vw_rand_genre");
    if (oldG && state.genres[0] === "Any") {
      try { var og = JSON.parse(oldG); if (typeof og === "string" && og !== "Any") state.genres = [og]; } catch (_) { if (oldG !== "Any") state.genres = [oldG]; }
    }
    var sg = localStorage.getItem("vw_rand_genres");
    if (sg) {
      try { var arr = JSON.parse(sg); if (Array.isArray(arr) && arr.length) state.genres = arr; } catch (_) {}
    }
    var ge = localStorage.getItem("vw_rand_genre_expanded");
    if (ge === "1") state.genreExpanded = true;
  } catch (_) {}
  try {
    var sMin = parseInt(localStorage.getItem(AGE_MIN_KEY), 10);
    var sMax = parseInt(localStorage.getItem(AGE_MAX_KEY), 10);
    if (sMin >= 0 && sMin <= 18) state.ageMin = sMin;
    if (sMax >= 0 && sMax <= 18) state.ageMax = sMax;
    if (state.ageMin > state.ageMax) state.ageMin = state.ageMax;
  } catch (_) {}
  function saveGenres() { try { localStorage.setItem("vw_rand_genres", JSON.stringify(state.genres)); localStorage.setItem("vw_rand_genre", JSON.stringify(state.genres[0]||"Any")); localStorage.setItem("vw_rand_genre_expanded", state.genreExpanded ? "1" : "0"); } catch (_) {} }
  // keep .genre for backwards compat where needed
  Object.defineProperty(state, "genre", {
    get: function () { return state.genres[0] || "Any"; },
    set: function (v) { state.genres = v === "Any" ? ["Any"] : [v]; saveGenres(); }
  });

  function ageFilters() {
    var lo = state.ageMin, hi = state.ageMax;
    return {
      adultOnly: lo >= 18,
      adultOk: hi >= 18,
      certLte: hi >= 18 ? null : hi >= 16 ? "R" : hi >= 13 ? "PG-13" : "PG",
      certGte: lo >= 16 ? "R" : lo >= 13 ? "PG-13" : lo >= 7 ? "PG" : null,
      noEcchi: hi < 13,
    };
  }

  function ageLabel() {
    var lo = state.ageMin, hi = state.ageMax;
    if (lo >= 18) return "18+ · NSFW only";
    if (hi >= 18) return lo + "–18 · NSFW incl.";
    return lo + "–" + hi + " yrs";
  }

  function genreSupports(g, type) {
    if (g.label === "Any") return true;
    if (type === "anime") return !!g.ani || !!g.aniTag;
    if (type === "movies") return g.mv != null;
    if (type === "shows") return g.tv != null;
    return !!g.ani || !!g.aniTag || g.mv != null || g.tv != null; // "all"
  }

  /* ── Random pickers ──────────────────────────────────────────────── */

  async function randomAnime(genre, tag) {
    var age = ageFilters();
    // Popular window only (top ~1000) so the anikoto match rate stays high;
    // adult pool is far smaller, so stay near the top of it
    var page = 1 + rand(age.adultOnly ? 3 : genre || tag ? 6 : 20);
    var j = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        // Isekai etc. are AniList "tags", not genres — same filter slot
        query:
          "query($p:Int,$g:String,$t:String,$a:Boolean,$gx:[String]){Page(page:$p,perPage:50){media(type:ANIME,format_in:[TV,MOVIE,ONA,OVA],sort:POPULARITY_DESC,genre:$g,tag:$t,isAdult:$a,genre_not_in:$gx){id}}}",
        variables: {
          p: page,
          g: genre || undefined,
          t: tag || undefined,
          // undefined = both SFW and NSFW when the range reaches 18
          a: age.adultOnly ? true : age.adultOk ? undefined : false,
          gx: age.noEcchi ? ["Ecchi"] : undefined,
        },
      }),
    }).then(function (r) { return r.json(); });
    var media = (j && j.data && j.data.Page && j.data.Page.media) || [];
    if (!media.length) return false;
    if (window.anikotoEnsureIndex) await window.anikotoEnsureIndex();
    if (typeof window.anikotoFindByAniList !== "function") return false;
    // Age filter for anime using stored +13/+16 etc. — filter the shuffled pool
    var lo = state.ageMin, hi = state.ageMax;
    function animePassesAge(anilistId) {
      if (lo === 0 && hi === 18) return true;
      var key = "ani:" + anilistId;
      var stored = null;
      try { var s = JSON.parse(localStorage.getItem("vw_age_store_v1")||"{}"); stored = s[key] || s["ANI_"+anilistId]; } catch(_){}
      // also check vwAgeCache
      if (!stored && window.vwAgeCache) {
        stored = window.vwAgeCache["ani:" + anilistId] || window.vwAgeCache["id:" + anilistId];
      }
      var n = ageToNumber(stored || "PG-13");
      if (lo >= 18) return n >= 18;
      if (hi < 18 && n >= 18) return false;
      return n >= lo && n <= hi + 5;
    }
    var order = media.slice().sort(function () { return Math.random() - 0.5; });
    for (var i = 0; i < order.length; i++) {
      if (!animePassesAge(order[i].id)) continue;
      var c = window.anikotoFindByAniList(order[i].id);
      if (c) {
        window.openAnikotoById && window.openAnikotoById(c.id);
        return true;
      }
    }
    // fallback: try without age filter if strict filter found nothing
    for (var j2 = 0; j2 < order.length; j2++) {
      var c2 = window.anikotoFindByAniList(order[j2].id);
      if (c2) {
        window.openAnikotoById && window.openAnikotoById(c2.id);
        return true;
      }
    }
    return false;
  }

  async function randomTmdb(kind, genreId) {
    if (!window.vidnestTmdb || !window.openVidnestById) return false;
    var age = ageFilters();
    var path = kind === "movies" ? "/discover/movie" : "/discover/tv";
    var params = {
      sort_by: "popularity.desc",
      "vote_count.gte": kind === "movies" ? 200 : 100,
      include_adult: age.adultOk ? "true" : "false",
    };
    if ((kind === "movies" || kind === "shows") && (age.certLte || age.certGte)) {
      if (kind === "movies") {
        params.certification_country = "US";
        if (age.certLte) params["certification.lte"] = age.certLte;
        if (age.certGte) params["certification.gte"] = age.certGte;
      } else {
        // TV uses content_ratings — filter after fetch since discover/tv has no cert param
        // we still pass with_content_ratings for US to narrow, then client-filter
        if (age.adultOnly) params.with_content_ratings = "TV-MA";
        else if (!age.adultOk) params.with_content_ratings = "TV-Y7,TV-PG,TV-14,TV-G";
        else if (age.certLte === "PG") params.with_content_ratings = "TV-Y7,TV-PG,TV-G";
        else if (age.certLte === "PG-13") params.with_content_ratings = "TV-14,TV-PG,TV-Y7,TV-G";
      }
    }
    if (genreId != null) params.with_genres = String(genreId);
    params.page = String(1 + rand(25));
    var d = await window.vidnestTmdb(path, params);
    var results = (d && d.results) || [];
    if (!results.length && Number(params.page) > 1) {
      // Genre pool smaller than 25 pages — clamp to what actually exists
      params.page = String(1 + rand(Math.max(1, Math.min(d && d.total_pages || 1, 25))));
      d = await window.vidnestTmdb(path, params);
      results = (d && d.results) || [];
    }
    if (!results.length) return false;
    var r = pick(results);
    var key = (kind === "movies" ? "VDM_" : "VDT_") + r.id;
    return window.openVidnestById(key);
  }

  function ageToNumber(ageStr) {
    if (!ageStr) return 13;
    var s = String(ageStr).trim().toUpperCase();
    if (s[0] === "+") { var n = parseInt(s.slice(1), 10); return isNaN(n) ? 13 : n; }
    if (s === "G" || s === "TV-G" || s === "TV-Y" || s === "TV-Y7") return 0;
    if (s === "PG" || s === "TV-PG") return 7;
    if (s === "PG-13" || s === "TV-14") return 13;
    if (s === "R" || s === "TV-MA" || s === "NC-17") return 16;
    if (s === "18+" || s === "NC-17" || s === "X") return 18;
    return 13;
  }
  function watchlistPassesAge(item, lo, hi) {
    var ageStr = item.age || (window.vwAgeStore && window.vwAgeStore[item.key]) || "";
    var n = ageToNumber(ageStr);
    // if no age stored, treat as 13 (PG-13) so it passes most filters, but respect adultOnly
    if (!ageStr) n = 13;
    if (lo >= 18) return n >= 18;
    if (hi < 18 && n >= 18) return false;
    return n >= lo && n <= hi + 5; // +5 slack for PG vs PG-13 boundary
  }

  async function randomWatchlist(genres) {
    var list = typeof window.vwlGet === "function" ? window.vwlGet() : [];
    if (!list.length) return false;
    var ageLo = state.ageMin, ageHi = state.ageMax;
    // ensure age for watchlist items that lack it (backfill)
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it.age && window.vwEnsureAge) {
        try { await window.vwEnsureAge(it.key, it.aniId ? "ani-id" : it.key.indexOf("VDM_")===0 ? "movie-id" : it.key.indexOf("VDT_")===0 ? "tv-id" : it.cat==="anime"?"ani-q":it.cat==="movies"?"movie-q":"tv-q", it.aniId || (it.key.indexOf("ANI_")===0? it.key.slice(4): it.key.indexOf("VDM_")===0? it.key.slice(4): it.key.indexOf("VDT_")===0? it.key.slice(4):null), it.title); } catch(_){}
      }
    }
    // multi-genre: genres is array of selected labels, Any means no filter
    var sel = Array.isArray(genres) ? genres : (genres && genres.label ? [genres.label] : ["Any"]);
    var isAny = sel.length === 1 && sel[0] === "Any";
    // filter by genre (any of the selected must match) and age
    var pool = list.filter(function (it) {
      if (!isAny) {
        var t = (it.title || "").toLowerCase();
        var hit = sel.some(function (lbl) { return t.indexOf(lbl.toLowerCase()) !== -1; });
        if (!hit) {
          // also check stored genres if available via hover cache
          var k = it.key;
          var meta = null;
          try { var store = JSON.parse(localStorage.getItem("vw_ani_meta_v1")||"{}"); meta = store.d && store.d[k]; } catch(_){}
          // fallback: allow if no genre info
        }
      }
      return watchlistPassesAge(it, ageLo, ageHi);
    });
    if (!pool.length) pool = list.filter(function (it) { return watchlistPassesAge(it, ageLo, ageHi); });
    if (!pool.length) return false;
    var chosen = pick(pool);
    if (chosen.aniId || (chosen.key && chosen.key.indexOf("ANI_")===0)) {
      var aniId = chosen.aniId || Number(chosen.key.slice(4));
      if (window.openAnikotoById) return window.openAnikotoById(aniId);
    }
    if (chosen.key && (chosen.key.indexOf("VDM_")===0 || chosen.key.indexOf("VDT_")===0) && window.openVidnestById) {
      return window.openVidnestById(chosen.key);
    }
    if (window.viroPlay) return window.viroPlay(chosen.cat, chosen.key);
    return false;
  }

  async function randomize() {
    // multi-genre: state.genres may be ["Action","Comedy"] or ["Any"]
    var selected = state.genres && state.genres.length ? state.genres : ["Any"];
    var isAny = selected.length === 1 && selected[0] === "Any";
    var primary = isAny ? GENRES[0] : GENRES.find(function (x) { return x.label === selected[0]; }) || GENRES[0];
    // for multi, collect all genre ids/tags
    var mvIds = [], tvIds = [], aniGenres = [], aniTags = [];
    if (!isAny) {
      selected.forEach(function (lbl) {
        var gg = GENRES.find(function (x) { return x.label === lbl; });
        if (!gg) return;
        if (gg.mv != null) mvIds.push(gg.mv);
        if (gg.tv != null) tvIds.push(gg.tv);
        if (gg.ani) aniGenres.push(gg.ani);
        if (gg.aniTag) aniTags.push(gg.aniTag);
      });
    }
    var type = state.type;
    if (type === "watchlist") return randomWatchlist(selected);
    if (type === "all") {
      var pool = ["anime", "movies", "shows"].filter(function (t) {
        // for All with multi, check if at least one selected genre is supported
        if (isAny) return true;
        return selected.some(function (lbl) {
          var gg = GENRES.find(function (x) { return x.label === lbl; });
          return gg && genreSupports(gg, t);
        });
      });
      var wl = typeof window.vwlGet === "function" ? window.vwlGet() : [];
      if (wl.length && isAny) pool.push("watchlist");
      type = pick(pool.length ? pool : ["anime"]);
      if (type === "watchlist") return randomWatchlist(selected);
    }
    if (type === "anime") {
      return randomAnime(aniGenres[0] || null, aniTags[0] || null);
    }
    if (type === "movies") return randomTmdb("movies", mvIds.length ? mvIds.join(",") : null);
    return randomTmdb("shows", tvIds.length ? tvIds.join(",") : null);
  }

  /* ── UI ──────────────────────────────────────────────────────────── */

  var panel = null;

  function buildUi() {
    var field = document.querySelector(".search-field");
    if (!field || $("randBtn")) return;

    var btn = document.createElement("button");
    btn.id = "randBtn";
    btn.type = "button";
    btn.className = "search-rand-btn";
    btn.title = "Random pick";
    btn.setAttribute("aria-label", "Random pick");
    btn.textContent = "🎲";
    field.appendChild(btn);

    panel = document.createElement("div");
    panel.id = "randPanel";
    panel.className = "rand-panel";
    field.appendChild(panel);
    renderPanel();

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      panel.classList.toggle("open");
    });
    document.addEventListener("mousedown", function (e) {
      if (!panel.classList.contains("open")) return;
      if (panel.contains(e.target) || e.target === btn) return;
      panel.classList.remove("open");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") panel.classList.remove("open");
    });
  }

  function chipRow(items, isActive, onPick) {
    var row = document.createElement("div");
    row.className = "rand-chips";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      if (isActive(it)) b.classList.add("active");
      b.addEventListener("click", function () { onPick(it); });
      row.appendChild(b);
    });
    return row;
  }

  function renderPanel() {
    panel.innerHTML = "";

    var h1 = document.createElement("div");
    h1.className = "rand-label";
    h1.textContent = "Type";
    panel.appendChild(h1);
    panel.appendChild(
      chipRow(
        TYPES.map(function (t) { return { label: t[1], val: t[0] }; }),
        function (it) { return it.val === state.type; },
        function (it) {
          state.type = it.val;
          // filter selected genres to those supported by new type
          var kept = state.genres.filter(function (lbl) {
            if (lbl === "Any") return true;
            var gg = GENRES.find(function (x) { return x.label === lbl; });
            return gg && genreSupports(gg, state.type);
          });
          if (!kept.length) kept = ["Any"];
          // if Any + others, keep only others
          if (kept.length > 1 && kept.indexOf("Any") !== -1) kept = kept.filter(function (x) { return x !== "Any"; });
          state.genres = kept;
          saveGenres();
          renderPanel();
          if (playerPanel) renderPlayerPanel();
        },
      ),
    );

    var h2 = document.createElement("div");
    h2.className = "rand-label";
    h2.textContent = "Genre (up to 3)";
    panel.appendChild(h2);
    var matureLabels = ["Ecchi","Hentai","Adult","Yaoi","Yuri"];
    var allForType = GENRES.filter(function (g) { return genreSupports(g, state.type); });
    if (state.ageMax < 18) allForType = allForType.filter(function(g){ return matureLabels.indexOf(g.label) === -1; });
    var toShow = state.genreExpanded ? allForType : allForType.slice(0, 8);
    panel.appendChild(
      chipRow(
        toShow,
        function (g) { return state.genres.indexOf(g.label) !== -1; },
        function (g) {
          if (g.label === "Any") {
            state.genres = ["Any"];
          } else {
            var idx = state.genres.indexOf(g.label);
            if (idx !== -1) {
              state.genres.splice(idx, 1);
              if (!state.genres.length) state.genres = ["Any"];
            } else {
              var anyIdx = state.genres.indexOf("Any");
              if (anyIdx !== -1) state.genres.splice(anyIdx, 1);
              state.genres.push(g.label);
            }
          }
          saveGenres();
          renderPanel();
          if (playerPanel) renderPlayerPanel();
        },
      ),
    );
    if (allForType.length > 8) {
      var moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "rand-more-btn";
      moreBtn.textContent = state.genreExpanded ? "Show less ▲" : "Show " + (allForType.length - 8) + " more ▼";
      moreBtn.style.cssText = "margin-top:8px;padding:6px 12px;border-radius:99px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-size:.75rem;cursor:pointer;";
      moreBtn.addEventListener("click", function(){ state.genreExpanded = !state.genreExpanded; saveGenres(); renderPanel(); if (playerPanel) renderPlayerPanel(); });
      panel.appendChild(moreBtn);
    }
    if (state.genres.length > 3) {
      var warn = document.createElement("div");
      warn.className = "rand-warn";
      warn.textContent = "⚠ More than 3 genres — pool gets small, may find nothing. Try fewer.";
      warn.style.cssText = "margin:6px 0 0;padding:7px 10px;border-radius:8px;background:rgba(255,180,0,.14);border:1px solid rgba(255,180,0,.28);color:#ffcc66;font-size:.75rem;line-height:1.3;";
      panel.appendChild(warn);
    }

    var h3 = document.createElement("div");
    h3.className = "rand-label rand-age-head";
    var h3t = document.createElement("span");
    h3t.textContent = "Age range";
    var ageVal = document.createElement("span");
    ageVal.className = "rand-age-val";
    h3.appendChild(h3t);
    h3.appendChild(ageVal);
    panel.appendChild(h3);

    var ageRow = document.createElement("div");
    ageRow.className = "rand-age";
    var track = document.createElement("div");
    track.className = "rand-age-track";
    var fill = document.createElement("div");
    fill.className = "rand-age-fill";
    var lo = document.createElement("input");
    var hi = document.createElement("input");
    [lo, hi].forEach(function (s) {
      s.type = "range";
      s.min = "0";
      s.max = "18";
      s.step = "1";
    });
    lo.value = String(state.ageMin);
    hi.value = String(state.ageMax);
    lo.setAttribute("aria-label", "Minimum age");
    hi.setAttribute("aria-label", "Maximum age");
    ageRow.appendChild(track);
    ageRow.appendChild(fill);
    ageRow.appendChild(lo);
    ageRow.appendChild(hi);
    panel.appendChild(ageRow);

    function syncAge() {
      fill.style.left = (state.ageMin / 18) * 100 + "%";
      fill.style.right = (1 - state.ageMax / 18) * 100 + "%";
      // Overlapped thumbs: only the top input is grabbable, so put the
      // one that can still move on top (left half → hi drags right,
      // right half → lo drags left). Apart, hi's default stacking is fine.
      var hiOnTop = state.ageMin !== state.ageMax || state.ageMax < 9;
      hi.style.zIndex = hiOnTop ? "2" : "1";
      lo.style.zIndex = hiOnTop ? "1" : "2";
      ageVal.textContent = ageLabel();
      ageVal.classList.toggle("nsfw", state.ageMax >= 18);
      try {
        localStorage.setItem(AGE_MIN_KEY, String(state.ageMin));
        localStorage.setItem(AGE_MAX_KEY, String(state.ageMax));
      } catch (_) {}
    }
    lo.addEventListener("input", function () {
      state.ageMin = Math.min(parseInt(lo.value, 10) || 0, state.ageMax);
      lo.value = String(state.ageMin);
      syncAge();
    });
    hi.addEventListener("input", function () {
      state.ageMax = Math.max(parseInt(hi.value, 10) || 0, state.ageMin);
      hi.value = String(state.ageMax);
      syncAge();
    });
    syncAge();

    var go = document.createElement("button");
    go.type = "button";
    go.className = "rand-go";
    var die = document.createElement("span");
    die.className = "rand-die";
    die.textContent = "🎲";
    if (state.busy) die.classList.add("rolling");
    go.appendChild(die);
    go.appendChild(document.createTextNode(state.busy ? " Rolling…" : " Randomize"));
    go.disabled = state.busy;
    go.addEventListener("click", async function () {
      if (state.busy) return;
      state.busy = true;
      var pillDie = $("randBtn");
      if (pillDie) pillDie.classList.add("rolling");
      renderPanel();
      // Cycle pip faces while airborne — reads as a real tumbling die
      var FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
      var faceTimer = setInterval(function () {
        var f = FACES[rand(FACES.length)];
        var d = panel.querySelector(".rand-die");
        if (d) d.textContent = f;
        if (pillDie) pillDie.textContent = f;
      }, 90);
      var ok = false;
      try { ok = await randomize(); } catch (_) { ok = false; }
      state.busy = false;
      clearInterval(faceTimer);
      if (pillDie) {
        pillDie.classList.remove("rolling");
        pillDie.textContent = "🎲";
      }
      if (ok) {
        // keep menu open for immediate re-roll — was closing, now stays
        renderPanel();
        var okMsg = document.createElement("div");
        okMsg.className = "rand-ok";
        okMsg.textContent = "✓ Playing — roll again if you want";
        okMsg.style.cssText = "margin-top:10px;padding:8px 12px;border-radius:8px;background:rgba(80,200,120,.15);border:1px solid rgba(80,200,120,.3);color:#8f8;font-size:.78rem;text-align:center;";
        panel.appendChild(okMsg);
        // also keep player panel in sync
        if (playerPanel) { playerPanel.classList.add("open"); renderPlayerPanel(); }
      } else {
        renderPanel();
        var err = document.createElement("div");
        err.className = "rand-error";
        err.textContent = "Nothing found — try again or loosen the filter.";
        panel.appendChild(err);
        if (playerPanel) {
          playerPanel.classList.add("open");
          renderPlayerPanel();
          var perr = document.createElement("div");
          perr.className = "rand-error";
          perr.textContent = "Nothing found — try again or loosen the filter.";
          playerPanel.appendChild(perr);
        }
      }
    });
    panel.appendChild(go);
  }

  // ── Player header button (next to Pop out) ───────────────────────
  var playerPanel = null;
  var playerBtn = null;
  function buildPlayerUi() {
    var actions = document.querySelector(".modal-header-actions");
    if (!actions || document.getElementById("randPlayerBtn")) return;
    playerBtn = document.createElement("a");
    playerBtn.id = "randPlayerBtn";
    playerBtn.href = "#";
    playerBtn.className = "button";
    playerBtn.title = "Random pick";
    playerBtn.textContent = "🎲 Random";
    playerBtn.style.marginLeft = "6px";
    actions.insertBefore(playerBtn, actions.firstChild);

    playerPanel = document.createElement("div");
    playerPanel.id = "randPlayerPanel";
    playerPanel.className = "rand-panel";
    // position under player header — must be above episodeContainer (z-index 200)
    playerPanel.style.position = "fixed";
    playerPanel.style.right = "12px";
    playerPanel.style.left = "auto";
    playerPanel.style.top = "52px";
    playerPanel.style.zIndex = "1000";
    document.body.appendChild(playerPanel);
    renderPlayerPanel();

    playerBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      playerPanel.classList.toggle("open");
      // keep search panel closed
      if (panel) panel.classList.remove("open");
    });
    document.addEventListener("mousedown", function (e) {
      if (!playerPanel.classList.contains("open")) return;
      if (playerPanel.contains(e.target) || e.target === playerBtn) return;
      playerPanel.classList.remove("open");
    });
  }
  function renderPlayerPanel() {
    if (!playerPanel) return;
    // share same state, just re-render same controls into playerPanel
    // clone the search panel's content for now — keep them in sync
    // easiest: render into main panel then copy HTML and re-wire
    // instead, just call a shared builder that fills any panel
    // for now duplicate renderPanel logic into playerPanel
    playerPanel.innerHTML = "";
    // reuse the same render logic but target playerPanel
    // we temporarily swap global panel, render, then restore
    var savedPanel = panel;
    panel = playerPanel;
    // we need to avoid infinite recursion, so inline a minimal version
    // Instead, just trigger a sync: copy search panel's innerHTML and re-attach events by re-rendering
    // Simpler: just call renderPanel which will fill the currently swapped panel
    // To avoid complexity, just mirror the search panel's state by reusing renderPanel's code path
    // We'll just call renderPanelFor with target
    panel = savedPanel;
    // Build player panel content directly (duplicate of renderPanel but for playerPanel)
    var tmpPanel = playerPanel;
    // Build header
    var h1 = document.createElement("div");
    h1.className = "rand-label";
    h1.textContent = "Type";
    tmpPanel.appendChild(h1);
    tmpPanel.appendChild(
      chipRow(
        TYPES.map(function (t) { return { label: t[1], val: t[0] }; }),
        function (it) { return it.val === state.type; },
        function (it) {
          state.type = it.val;
          var kept2 = state.genres.filter(function (lbl) {
            if (lbl === "Any") return true;
            var gg = GENRES.find(function (x) { return x.label === lbl; });
            return gg && genreSupports(gg, state.type);
          });
          if (!kept2.length) kept2 = ["Any"];
          if (kept2.length > 1 && kept2.indexOf("Any") !== -1) kept2 = kept2.filter(function (x) { return x !== "Any"; });
          state.genres = kept2;
          saveGenres();
          renderPanel();
          renderPlayerPanel();
        },
      ),
    );
    var h2 = document.createElement("div");
    h2.className = "rand-label";
    h2.textContent = "Genre";
    tmpPanel.appendChild(h2);
    var matureLabels2 = ["Ecchi","Hentai","Adult","Yaoi","Yuri"];
    var allForType2 = GENRES.filter(function (g) { return genreSupports(g, state.type); });
    if (state.ageMax < 18) allForType2 = allForType2.filter(function(g){ return matureLabels2.indexOf(g.label) === -1; });
    var toShow2 = state.genreExpanded ? allForType2 : allForType2.slice(0, 8);
    tmpPanel.appendChild(
      chipRow(
        toShow2,
        function (g) { return state.genres.indexOf(g.label) !== -1; },
        function (g) {
          if (g.label === "Any") {
            state.genres = ["Any"];
          } else {
            var idx2 = state.genres.indexOf(g.label);
            if (idx2 !== -1) {
              state.genres.splice(idx2, 1);
              if (!state.genres.length) state.genres = ["Any"];
            } else {
              var anyIdx2 = state.genres.indexOf("Any");
              if (anyIdx2 !== -1) state.genres.splice(anyIdx2, 1);
              state.genres.push(g.label);
            }
          }
          saveGenres();
          renderPanel();
          renderPlayerPanel();
        },
      ),
    );
    if (allForType2.length > 8) {
      var moreBtn2 = document.createElement("button");
      moreBtn2.type = "button";
      moreBtn2.className = "rand-more-btn";
      moreBtn2.textContent = state.genreExpanded ? "Show less ▲" : "Show " + (allForType2.length - 8) + " more ▼";
      moreBtn2.style.cssText = "margin-top:8px;padding:6px 12px;border-radius:99px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-size:.75rem;cursor:pointer;";
      moreBtn2.addEventListener("click", function(){ state.genreExpanded = !state.genreExpanded; saveGenres(); renderPanel(); renderPlayerPanel(); });
      tmpPanel.appendChild(moreBtn2);
    }
    if (state.genres.length > 3) {
      var warn2 = document.createElement("div");
      warn2.className = "rand-warn";
      warn2.textContent = "⚠ More than 3 genres — pool gets small, may find nothing. Try fewer.";
      warn2.style.cssText = "margin:6px 0 0;padding:7px 10px;border-radius:8px;background:rgba(255,180,0,.14);border:1px solid rgba(255,180,0,.28);color:#ffcc66;font-size:.75rem;line-height:1.3;";
      tmpPanel.appendChild(warn2);
    }
    var h3 = document.createElement("div");
    h3.className = "rand-label rand-age-head";
    var h3t = document.createElement("span");
    h3t.textContent = "Age range";
    var ageVal = document.createElement("span");
    ageVal.className = "rand-age-val";
    ageVal.textContent = ageLabel();
    ageVal.classList.toggle("nsfw", state.ageMax >= 18);
    h3.appendChild(h3t);
    h3.appendChild(ageVal);
    tmpPanel.appendChild(h3);
    var ageRow = document.createElement("div");
    ageRow.className = "rand-age";
    var track = document.createElement("div");
    track.className = "rand-age-track";
    var fill = document.createElement("div");
    fill.className = "rand-age-fill";
    fill.style.left = (state.ageMin / 18) * 100 + "%";
    fill.style.right = (1 - state.ageMax / 18) * 100 + "%";
    var lo = document.createElement("input");
    var hi = document.createElement("input");
    [lo, hi].forEach(function (s) { s.type = "range"; s.min = "0"; s.max = "18"; s.step = "1"; });
    lo.value = String(state.ageMin);
    hi.value = String(state.ageMax);
    ageRow.appendChild(track);
    ageRow.appendChild(fill);
    ageRow.appendChild(lo);
    ageRow.appendChild(hi);
    tmpPanel.appendChild(ageRow);
    lo.addEventListener("input", function () {
      state.ageMin = Math.min(parseInt(lo.value, 10) || 0, state.ageMax);
      lo.value = String(state.ageMin);
      fill.style.left = (state.ageMin / 18) * 100 + "%";
      ageVal.textContent = ageLabel();
      try { localStorage.setItem(AGE_MIN_KEY, String(state.ageMin)); } catch (_) {}
    });
    hi.addEventListener("input", function () {
      state.ageMax = Math.max(parseInt(hi.value, 10) || 0, state.ageMin);
      hi.value = String(state.ageMax);
      fill.style.right = (1 - state.ageMax / 18) * 100 + "%";
      ageVal.textContent = ageLabel();
      try { localStorage.setItem(AGE_MAX_KEY, String(state.ageMax)); } catch (_) {}
    });
    var go = document.createElement("button");
    go.type = "button";
    go.className = "rand-go";
    var die = document.createElement("span");
    die.className = "rand-die";
    die.textContent = state.busy ? "🎲" : "🎲";
    if (state.busy) die.classList.add("rolling");
    go.appendChild(die);
    go.appendChild(document.createTextNode(state.busy ? " Rolling…" : " Randomize"));
    go.disabled = state.busy;
    go.addEventListener("click", async function () {
      if (state.busy) return;
      state.busy = true;
      renderPanel();
      renderPlayerPanel();
      var FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
      var faceTimer = setInterval(function () {
        var f = FACES[rand(FACES.length)];
        var d = tmpPanel.querySelector(".rand-die");
        if (d) d.textContent = f;
      }, 90);
      var ok = false;
      try { ok = await randomize(); } catch (_) { ok = false; }
      state.busy = false;
      clearInterval(faceTimer);
      renderPanel();
      renderPlayerPanel();
      if (ok) {
        var okMsg = document.createElement("div");
        okMsg.className = "rand-ok";
        okMsg.textContent = "✓ Playing — roll again";
        okMsg.style.cssText = "margin-top:10px;padding:8px 12px;border-radius:8px;background:rgba(80,200,120,.15);border:1px solid rgba(80,200,120,.3);color:#8f8;font-size:.78rem;text-align:center;";
        tmpPanel.appendChild(okMsg);
      } else {
        var err = document.createElement("div");
        err.className = "rand-error";
        err.textContent = "Nothing found — try again or loosen the filter.";
        tmpPanel.appendChild(err);
      }
    });
    tmpPanel.appendChild(go);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { buildUi(); buildPlayerUi(); });
  } else {
    buildUi();
    buildPlayerUi();
  }
  // player header is inside episodeContainer which is hidden at first — watch for it
  new MutationObserver(function () { buildPlayerUi(); }).observe(document.body, { childList: true, subtree: true });
})();
