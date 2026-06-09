/**
 * webstreamr.js  —  Virowatch × TMDB + vidsrc.fyi  v1.0
 *
 * Drop-in replacement for vidsrc.js.
 *
 * Catalog : TMDB "popular movies" (free public API, HTTPS, no proxy needed)
 * Streams : vidsrc.fyi embed iframes (no API key, no server, HTTPS, iframe-safe)
 * Player  : feeds embed URL into window.viroPlay("lunora", key) exactly as before
 *
 * ── You only need one thing ──────────────────────────────────────────
 *   TMDB_KEY  →  free key from https://www.themoviedb.org/settings/api
 *   (vidsrc.fyi needs no key at all)
 * ────────────────────────────────────────────────────────────────────
 */
(function () {
  "use strict";

  // Use key from env.js if available, otherwise fall back to built-in
  const TMDB_KEY  = window.ENV?.TMDB_API_KEY || "77d678406118b130512ab8affd953fa9";

  const TMDB_BASE = "https://api.themoviedb.org/3";
  const TMDB_IMG  = "https://image.tmdb.org/t/p/w300";
  const TIMEOUT   = 12000;

  // ── Embed URL builder ──────────────────────────────────────────────
  // vidsrc.fyi accepts either an IMDb tt-id or a TMDB numeric id.
  // We prefer IMDb when available; fall back to TMDB id if not.
  function embedUrl(item) {
    const id = item.imdb_id || item.tmdb_id;
    const subsOff = window._vwSubsOff || localStorage.getItem("vw_subs_off") === "1";
    const suffix = subsOff ? "?ds_lang=none" : "";
    return `https://vidsrc.fyi/embed/movie/${id}${suffix}`;
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

  async function apiFetch(url) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      clearTimeout(tid);
      return null;
    }
  }

  // ── State ──────────────────────────────────────────────────────────
  let page       = 0;
  let totalPages = 500;   // TMDB caps popular at 500 pages
  let fetching   = false;
  let bgLoading  = false;
  let cache      = [];
  let iObs       = null;
  let searchTid  = null;

  // ── TMDB result → internal shape ───────────────────────────────────
  function normaliseTmdb(m) {
    return {
      tmdb_id  : m.id,
      imdb_id  : m.imdb_id || null,   // null until enriched
      title    : m.title || m.name || "Unknown",
      poster   : m.poster_path ? `${TMDB_IMG}${m.poster_path}` : null,
      year     : m.release_date ? m.release_date.slice(0, 4) : "",
    };
  }

  // ── IMDb ID enrichment ─────────────────────────────────────────────
  // TMDB popular lists omit imdb_id. We fetch it lazily per-item so the
  // grid renders instantly and imdb_ids fill in as the user hovers/scrolls.
  const enrichQueue  = [];
  let   enrichActive = 0;
  const ENRICH_CONC  = 4;

  function processEnrichQueue() {
    while (enrichActive < ENRICH_CONC && enrichQueue.length > 0) {
      const { item, onDone } = enrichQueue.shift();
      enrichActive++;
      apiFetch(`${TMDB_BASE}/movie/${item.tmdb_id}?api_key=${TMDB_KEY}`)
        .then(detail => {
          if (detail?.imdb_id) {
            item.imdb_id = detail.imdb_id;
            const card = document.querySelector(`[data-tmdb-id="${item.tmdb_id}"]`);
            if (card) card.dataset.imdbId = detail.imdb_id;
          }
          onDone?.(item);
        })
        .catch(() => onDone?.(item))
        .finally(() => { enrichActive--; processEnrichQueue(); });
    }
  }

  function enrich(item, onDone) {
    if (item.imdb_id) { onDone?.(item); return; }
    enrichQueue.push({ item, onDone });
    processEnrichQueue();
  }

  // ── Poster lazy-loading ────────────────────────────────────────────
  const posterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      posterObserver.unobserve(img);
      const src = img.dataset.lazySrc;
      if (src) { img.src = src; img.removeAttribute("data-lazy-src"); }
    });
  }, { rootMargin: "400px" });

  // ── Inject into window.mediaData.lunora ───────────────────────────
  function injectEntry(item) {
    const key   = `VIDSRC_${item.imdb_id || item.tmdb_id}`;
    const title = item.title + (item.year ? ` (${item.year})` : "");
    window.mediaData             = window.mediaData || {};
    window.mediaData.lunora      = window.mediaData.lunora || {};
    window.mediaData.lunora[key] = {
      title   : title,
      image   : item.poster || "data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
      _hidden : true,
      VIDSRC_S1: {
        chapter       : "Movie",
        video         : [embedUrl(item)],
        episodeTitles : [title],
      }
    };
    return key;
  }

  // ── Card click ─────────────────────────────────────────────────────
  async function onCardClick(card, item) {
    if (card.dataset.clicking === "1") return;
    card.dataset.clicking = "1";
    card.classList.add("vidsrc-loading");

    // Ensure imdb_id is resolved before building the embed URL
    if (!item.imdb_id) {
      await new Promise(resolve => enrich(item, resolve));
    }

    const key = injectEntry(item);
    await window.viroPlay?.("lunora", key);

    setTimeout(() => {
      card.dataset.clicking = "0";
      card.classList.remove("vidsrc-loading");
    }, 800);
  }

  // ── Hover → pre-enrich so click is instant ─────────────────────────
  function onCardHover(item) {
    if (!item.imdb_id) enrich(item);
  }

  // ── Card element ───────────────────────────────────────────────────
  function makeCard(item) {
    const card = document.createElement("div");
    card.className      = "movie-item vidsrc-card";
    card.dataset.tmdbId = String(item.tmdb_id);
    card.dataset.imdbId = item.imdb_id || "";
    card.dataset.movie  = `VIDSRC_${item.imdb_id || item.tmdb_id}`;

    const img = document.createElement("img");
    if (item.poster) {
      img.src             = "data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
      img.dataset.lazySrc = item.poster;
      posterObserver.observe(img);
    } else {
      img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
    }
    img.alt     = "";
    img.loading = "lazy";

    const p = document.createElement("p");
    p.className   = "kanit-extralight";
    p.textContent = item.title || "";

    const badge = document.createElement("span");
    badge.className        = "ani-badge vw-category-badge webstreamr-badge";
    badge.style.background = "rgba(30, 140, 80, 0.92)";
    badge.textContent      = "Web";

    card.appendChild(img);
    card.appendChild(p);
    card.appendChild(badge);

    card.addEventListener("click",      () => onCardClick(card, item));
    card.addEventListener("mouseenter", () => onCardHover(item), { passive: true });
    window._vwlAttachButton?.(card);
    return card;
  }

  // ── Skeletons ──────────────────────────────────────────────────────
  function addSkeletons(n) {
    const grid = document.getElementById("vidsrc-grid");
    if (!grid) return;
    for (let i = 0; i < n; i++) {
      const sk = document.createElement("div");
      sk.className = "vidsrc-skeleton";
      grid.appendChild(sk);
    }
  }
  function clearSkeletons() {
    document.getElementById("vidsrc-grid")
      ?.querySelectorAll(".vidsrc-skeleton")
      .forEach(sk => sk.remove());
  }

  // ── Fetch one TMDB popular page ────────────────────────────────────
  async function fetchTmdbPage(n) {
    return apiFetch(
      `${TMDB_BASE}/movie/popular?api_key=${TMDB_KEY}&language=en-US&page=${n}`
    );
  }

  // ── Load page (visible grid) ───────────────────────────────────────
  async function loadPage(n) {
    if (fetching) return;
    fetching = true;
    addSkeletons(8);

    const data = await fetchTmdbPage(n);
    clearSkeletons();
    fetching = false;

    if (!data || !Array.isArray(data.results) || data.results.length === 0) {
      if (n === 1) {
        const grid = document.getElementById("vidsrc-grid");
        if (grid) {
          const msg = document.createElement("p");
          msg.className   = "vidsrc-error";
          msg.textContent = "Could not load movies — check your TMDB API key or connection.";
          grid.appendChild(msg);
        }
      }
      return;
    }

    page       = n;
    totalPages = Math.min(data.total_pages || 500, 500);

    const items = data.results.map(normaliseTmdb);
    const existingIds = new Set(cache.map(c => c.tmdb_id));
    cache = cache.concat(items.filter(m => !existingIds.has(m.tmdb_id)));

    const grid = document.getElementById("vidsrc-grid");
    if (grid) items.forEach(item => grid.appendChild(makeCard(item)));

    // Kick off background enrichment for visible cards
    items.forEach(item => enrich(item));

    armObserver();
    if (n === 1 && !bgLoading) bgPreload();
  }

  // ── Background preload (for search) ───────────────────────────────
  async function bgPreload() {
    bgLoading = true;
    let p = page + 1;
    while (p <= totalPages && p <= 100) {
      while (window._vwPriority) await sleep(300);
      const results = await Promise.all(
        [0, 1, 2].map(i => (p + i <= totalPages && p + i <= 100) ? fetchTmdbPage(p + i) : null)
      );
      p += 3;
      for (const data of results) {
        if (!data || !Array.isArray(data.results)) continue;
        const items       = data.results.map(normaliseTmdb);
        const existingIds = new Set(cache.map(c => c.tmdb_id));
        cache = cache.concat(items.filter(m => !existingIds.has(m.tmdb_id)));
        if (data.total_pages) totalPages = Math.min(data.total_pages, 500);
      }
      await sleep(1500);
    }
    bgLoading = false;
  }

  // ── Infinite scroll ────────────────────────────────────────────────
  function armObserver() {
    const sentinel = document.getElementById("vidsrc-sentinel");
    if (!sentinel || page >= totalPages) { iObs?.disconnect(); iObs = null; return; }
    iObs?.disconnect();
    if (!window.IntersectionObserver) { setTimeout(() => loadPage(page + 1), 2000); return; }
    iObs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !fetching) {
        iObs.disconnect(); iObs = null;
        loadPage(page + 1);
      }
    }, { rootMargin: "400px" });
    iObs.observe(sentinel);
  }

  // ── Section visibility ─────────────────────────────────────────────
  function isMoviesView() {
    const w  = document.getElementById("movieListWrapper");
    const nb = document.getElementById("categoryNavBar");
    return (
      w && nb &&
      w.style.display  !== "none" &&
      nb.style.display !== "none" &&
      window._vwlCurrentCat === "lunora"
    );
  }
  function updateVis() {
    const show = isMoviesView();
    const sep  = document.getElementById("vidsrc-sep");
    const sec  = document.getElementById("vidsrc-section");
    if (sep) sep.style.display = show ? "" : "none";
    if (sec) sec.style.display = show ? "" : "none";
  }
  function watchVisibility() {
    const w  = document.getElementById("movieListWrapper");
    const nb = document.getElementById("categoryNavBar");
    const ml = document.getElementById("movieList");
    const mo = new MutationObserver(updateVis);
    if (w)  mo.observe(w,  { attributes: true, attributeFilter: ["style"] });
    if (nb) mo.observe(nb, { attributes: true, subtree: true, attributeFilter: ["style", "class"] });
    if (ml) mo.observe(ml, { childList: true });
  }

  // ── Search ─────────────────────────────────────────────────────────
  function cleanSearchCards() {
    document.getElementById("movieList")
      ?.querySelectorAll(".vidsrc-card, .vidsrc-search-sep")
      .forEach(el => el.remove());
  }

  function fuzzyMatch(item, query) {
    const t  = (item.title || "").toLowerCase();
    const q  = query.toLowerCase();
    if (t.includes(q)) return true;
    const nt = t.replace(/[^a-z0-9]/g, "");
    const nq = q.replace(/[^a-z0-9]/g, "");
    return nq.length > 0 && nt.includes(nq);
  }

  async function tmdbSearch(q) {
    const data = await apiFetch(
      `${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&language=en-US&query=${encodeURIComponent(q)}&page=1`
    );
    return (data?.results || []).map(normaliseTmdb);
  }

  async function doSearch(q) {
    cleanSearchCards();
    if (!q || q.length < 2) return;

    const ml = document.getElementById("movieList");
    if (!ml) return;

    function insertMixed(card) {
      const allCards    = Array.from(ml.children);
      const nativeCards = allCards.filter(c => !c.classList.contains("vidsrc-card") && !c.className.includes("search-sep"));
      const mixedCards  = allCards.filter(c => c.classList.contains("vidsrc-card"));
      ml.insertBefore(card, ml.children[Math.min(mixedCards.length * 2, nativeCards.length + mixedCards.length)] || null);
    }

    // Instant local results from cache
    cache.filter(m => fuzzyMatch(m, q)).slice(0, 8).forEach(m => {
      if (!ml.querySelector(`[data-tmdb-id="${m.tmdb_id}"]`)) insertMixed(makeCard(m));
    });

    // Live TMDB search results
    try {
      const remoteHits = await tmdbSearch(q);
      remoteHits.slice(0, 12).forEach(m => {
        if (!ml.querySelector(`[data-tmdb-id="${m.tmdb_id}"]`)) {
          if (!cache.find(c => c.tmdb_id === m.tmdb_id)) cache.push(m);
          insertMixed(makeCard(m));
          enrich(m);
        }
      });
    } catch (_) {}
  }

  function hookSearch() {
    const input = document.getElementById("searchInput");
    if (!input) return;
    input.addEventListener("input", (e) => {
      // Show web results during any search, regardless of current category

      clearTimeout(searchTid);
      const q = e.target.value.trim();

      // Direct IMDb ID paste — play immediately
      if (/^tt\d{5,}$/.test(q)) {
        const imdbId = q;
        input.value = "";
        input.dispatchEvent(new Event("input"));
        input.blur();
        (async () => {
          // Fetch title/poster from TMDB find endpoint
          const found  = await apiFetch(
            `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
          );
          const r      = found?.movie_results?.[0];
          const item   = r
            ? { ...normaliseTmdb(r), imdb_id: imdbId }
            : { tmdb_id: imdbId, imdb_id: imdbId, title: "Movie", poster: null, year: "" };
          const key = injectEntry(item);
          window.viroPlay?.("lunora", key);
        })();
        return;
      }

      searchTid = setTimeout(() => {
        if (q.length < 2) cleanSearchCards();
        else doSearch(q);
      }, 360);
    });
  }

  // ── Build DOM ──────────────────────────────────────────────────────
  function buildDOM() {
    const wrapper = document.getElementById("movieListWrapper");
    if (!wrapper) return false;

    const sep = document.createElement("div");
    sep.id            = "vidsrc-sep";
    sep.style.display = "none";
    sep.innerHTML     = '<div class="vidsrc-sep-line"></div><span class="vidsrc-sep-label">🌐 Web Streams</span><div class="vidsrc-sep-line"></div>';

    const sec      = document.createElement("div"); sec.id = "vidsrc-section"; sec.style.display = "none";
    const grid     = document.createElement("div"); grid.id = "vidsrc-grid";
    const sentinel = document.createElement("div");
    sentinel.id            = "vidsrc-sentinel";
    sentinel.style.cssText = "height:2px;width:100%;pointer-events:none;";

    sec.appendChild(grid);
    sec.appendChild(sentinel);
    wrapper.insertAdjacentElement("afterend", sec);
    wrapper.insertAdjacentElement("afterend", sep);
    return true;
  }

  // ── CSS ────────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById("vidsrc-css")) return;
    const s = document.createElement("style");
    s.id = "vidsrc-css";
    s.textContent = `
      #vidsrc-sep,.vidsrc-search-sep{display:flex;align-items:center;gap:12px;padding:24px 0 14px;}
      .vidsrc-search-sep{grid-column:1/-1;padding:12px 0 8px;}
      .vidsrc-sep-line{flex:1;height:1px;background:rgba(255,255,255,.1);}
      .vidsrc-sep-label{color:rgba(255,255,255,.35);font-family:"Kanit",sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;flex-shrink:0;}
      #vidsrc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px;padding:5px 0 20px;}
      .vidsrc-badge,.vidsrc-card .ani-badge{position:absolute;top:6px;right:6px;color:#fff;font-family:"Kanit",sans-serif;font-size:.55rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 6px;border-radius:3px;pointer-events:none;z-index:2;backdrop-filter:blur(4px);}
      .webstreamr-badge{background:rgba(30,140,80,0.92) !important;}
      .vidsrc-card{position:relative;cursor:pointer;overflow:hidden;border-radius:12px;transition:transform 0.2s,box-shadow 0.2s;user-select:none;}
      .vidsrc-card:hover{transform:translateY(-4px);box-shadow:0 8px 16px rgba(0,0,0,0.5);}
      .vidsrc-card:active{transform:translateY(-2px);}
      .vidsrc-card img{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:12px;display:block;}
      .vidsrc-card p{position:absolute;bottom:0;left:0;right:0;margin:0;padding:30px 10px 10px;background:linear-gradient(transparent,rgba(0,0,0,0.9));color:#fff;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .vidsrc-card.vidsrc-loading{opacity:.55;pointer-events:none;cursor:wait;}
      .vidsrc-skeleton{aspect-ratio:2/3;border-radius:12px;background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 75%);background-size:300% 100%;animation:vidsrc-shim 1.5s infinite linear;}
      @keyframes vidsrc-shim{0%{background-position:300% 0}100%{background-position:-300% 0}}
      .vidsrc-error{color:rgba(255,100,100,.75);font-family:"Kanit",sans-serif;font-size:.85rem;text-align:center;padding:24px;grid-column:1/-1;}
      @media(max-width:768px){#vidsrc-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;}.vidsrc-badge,.vidsrc-card .ani-badge{font-size:.5rem;padding:1px 4px;}.vidsrc-card p{font-size:0.75rem;}}
    `;
    document.head.appendChild(s);
  }

  // ── Init ───────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    // CSS must be injected synchronously here, before any setTimeout,
    // so Chromium's CSSOM picks it up in the same microtask flush as
    // DOMContentLoaded. Delaying it (even 400 ms) causes Chromium to
    // silently drop the stylesheet when document.write is patched by
    // the VW ad blocker and the parser is no longer in 'loading' state.
    injectCSS();

    setTimeout(() => {
      if (!buildDOM()) return;
      watchVisibility();
      updateVis();
      hookSearch();
      loadPage(1);
    }, 400);
  });
})();
