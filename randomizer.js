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
    { label: "Comedy", ani: "Comedy", mv: 35, tv: 35 },
    { label: "Crime", mv: 80, tv: 80 },
    { label: "Drama", ani: "Drama", mv: 18, tv: 18 },
    { label: "Fantasy", ani: "Fantasy", mv: 14, tv: 10765 },
    { label: "Horror", ani: "Horror", mv: 27 },
    { label: "Mystery", ani: "Mystery", mv: 9648, tv: 9648 },
    { label: "Romance", ani: "Romance", mv: 10749 },
    { label: "Sci-Fi", ani: "Sci-Fi", mv: 878, tv: 10765 },
    { label: "Thriller", ani: "Thriller", mv: 53 },
    { label: "Isekai", aniTag: "Isekai" },
    { label: "Mecha", ani: "Mecha" },
    { label: "Psychological", ani: "Psychological" },
    { label: "Slice of Life", ani: "Slice of Life" },
    { label: "Sports", ani: "Sports" },
    { label: "Supernatural", ani: "Supernatural" },
  ];

  // content.js's genre/tag search reads this so every chip here is also
  // typeable in the search bar (incl. tag-based ones like Isekai)
  window.vwRandGenres = GENRES;

  var TYPES = [
    ["all", "All"],
    ["anime", "Anime"],
    ["movies", "Movies"],
    ["shows", "TV shows"],
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

  var state = { type: "all", genre: "Any", ageMin: 0, ageMax: 16, busy: false };
  try {
    var sMin = parseInt(localStorage.getItem(AGE_MIN_KEY), 10);
    var sMax = parseInt(localStorage.getItem(AGE_MAX_KEY), 10);
    if (sMin >= 0 && sMin <= 18) state.ageMin = sMin;
    if (sMax >= 0 && sMax <= 18) state.ageMax = sMax;
    if (state.ageMin > state.ageMax) state.ageMin = state.ageMax;
  } catch (_) {}

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
    // Shuffle-order walk until one maps to a playable anikoto entry
    var order = media.slice().sort(function () { return Math.random() - 0.5; });
    for (var i = 0; i < order.length; i++) {
      var c = window.anikotoFindByAniList(order[i].id);
      if (c) {
        window.openAnikotoById && window.openAnikotoById(c.id);
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
    if (kind === "movies" && (age.certLte || age.certGte)) {
      params.certification_country = "US";
      if (age.certLte) params["certification.lte"] = age.certLte;
      if (age.certGte) params["certification.gte"] = age.certGte;
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

  async function randomize() {
    var g = GENRES.find(function (x) { return x.label === state.genre; }) || GENRES[0];
    var type = state.type;
    if (type === "all") {
      var pool = ["anime", "movies", "shows"].filter(function (t) {
        return genreSupports(g, t);
      });
      type = pick(pool.length ? pool : ["anime"]);
    }
    if (type === "anime") return randomAnime(g.ani || null, g.aniTag || null);
    if (type === "movies") return randomTmdb("movies", g.mv != null ? g.mv : null);
    return randomTmdb("shows", g.tv != null ? g.tv : null);
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
          // Selected genre may not exist for the new type — reset if so
          var g = GENRES.find(function (x) { return x.label === state.genre; });
          if (g && !genreSupports(g, state.type)) state.genre = "Any";
          renderPanel();
        },
      ),
    );

    var h2 = document.createElement("div");
    h2.className = "rand-label";
    h2.textContent = "Genre";
    panel.appendChild(h2);
    panel.appendChild(
      chipRow(
        GENRES.filter(function (g) { return genreSupports(g, state.type); }),
        function (g) { return g.label === state.genre; },
        function (g) {
          state.genre = g.label;
          renderPanel();
        },
      ),
    );

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
        panel.classList.remove("open");
        renderPanel();
      } else {
        renderPanel();
        var err = document.createElement("div");
        err.className = "rand-error";
        err.textContent = "Nothing found — try again or loosen the filter.";
        panel.appendChild(err);
      }
    });
    panel.appendChild(go);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUi);
  } else {
    buildUi();
  }
})();
