/**
 * anikoto-loader.js  —  Virowatch × Anikoto / MegaPlay  v4.0
 *
 * Fixes & Enhancements:
 * - Reliable proxy chain with retries + safe JSON parsing
 * - Hover-prefetch so clicking a card feels instant
 * - Background preloads extra pages so search has real coverage
 * - Search shows result count + "still loading" hint
 * - Deep master database search endpoint queries included
 * - Persistent localStorage cache for instant cross-session fuzzy search
 * - Aggressive data minimization to respect storage quotas (~10k+ series capability)
 * - Supercharged aggressive background crawling (10 pages concurrently, 50ms sleep)
 * - Live Search Result Injection (Populates active search screen dynamically as bg works)
 * - FIX: Global Search Activation (Anime results now search instantly without needing to click the Anime tab first)
 * - v4.0 FIX: Automated Service Worker Caching (Option 1) + Smarter Cache Lifetime Verification (Option 2)
 */
(function () {
  "use strict";

  const BASE      = "https://anikotoapi.site";
  const MEGAPLAY  = "https://megaplay.buzz/stream/s-2";
  const PER_PAGE  = 24;
  const TIMEOUT   = 10000;
  const BG_PAGES  = 6; 
  const CACHE_KEY = "anikoto_cache";
  // Key that stores ONLY the lightweight title index for instant search
  const TITLE_INDEX_KEY = "anikoto_title_index";

  // ── Proxy list ────────────────────────────────────────────────────
  // UPDATED: allorigins.win is currently broken (CORS headers missing).
  // Reordered to try codetabs first, added whateverorigin.org as alternative.
  // Set CUSTOM_PROXY_URL to your own Cloudflare Worker for maximum reliability.
  const CUSTOM_PROXY_URL = ""; // e.g. "https://my-proxy.workers.dev/?url="

  const PROXIES = [
    // 0. Custom proxy (user-configured, highest priority if set)
    ...(CUSTOM_PROXY_URL ? [{
      build: u => `${CUSTOM_PROXY_URL}${encodeURIComponent(u)}`,
      parse: r => r.json(),
    }] : []),
    // 1. codetabs — most reliable, returns raw content directly
    {
      build: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
    // 2. corsproxy.io — returns raw content directly
    {
      build: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
    // 3. whateverorigin — allorigins alternative, returns { contents: "..." }
    {
      build: u => `https://www.whateverorigin.org/get?url=${encodeURIComponent(u)}`,
      parse: async r => {
        const j = await r.json();
        const raw = j.contents;
        if (!raw) throw new Error("no contents");
        return typeof raw === "string" ? JSON.parse(raw) : raw;
      },
    },
    // 4. allorigins raw — intermittently working
    {
      build: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
    // 5. allorigins get — intermittently working
    {
      build: u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
      parse: async r => {
        const j = await r.json();
        const raw = j.contents;
        if (!raw) throw new Error("no contents");
        return typeof raw === "string" ? JSON.parse(raw) : raw;
      },
    },
    // 6. thingproxy — last resort
    {
      build: u => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
  ];

  let winProxy = null; 

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

  // ── Core fetch with proxy chain + retry ───────────────────────────
  async function apiFetch(url, retries = 3) {
    const order = winProxy !== null
      ? [winProxy, ...PROXIES.map((_, i) => i).filter(i => i !== winProxy)]
      : PROXIES.map((_, i) => i);

    for (let attempt = 0; attempt < retries; attempt++) {
      for (const idx of order) {
        const proxy = PROXIES[idx];
        try {
          const ctrl = new AbortController();
          const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
          const r    = await fetch(proxy.build(url), { signal: ctrl.signal });
          clearTimeout(tid);
          if (!r.ok) {
            console.warn(`Anikoto: Proxy ${idx} returned HTTP ${r.status} for ${url}`);
            continue;
          }
          const data = await proxy.parse(r);
          if (data) {
            winProxy = idx;
            return data;
          }
        } catch (err) {
          // CORS errors, network errors, abort errors — all caught here
          console.warn(`Anikoto: Proxy ${idx} failed:`, err.message || err);
        }
      }
      if (attempt < retries - 1) {
        console.log(`Anikoto: Retry ${attempt + 2}/${retries} for ${url}`);
        await sleep(1500 * (attempt + 1));
      }
    }
    console.error(`Anikoto: All proxies exhausted for ${url}`);
    return null;
  }

  // ── State ──────────────────────────────────────────────────────────
  let page               = 0;
  let totalPages         = 1;
  let fetching           = false;
  let bgLoading          = false;
  let cache              = [];   
  let iObs               = null;
  let searchTid          = null;
  let currentSearchQuery = "";   
  let cacheTimestamp     = Date.now();
  let cacheIsComplete    = false;

  // ── Title index — lightweight id→title map for instant search ────
  // This is saved separately so it survives cache purges and loads
  // instantly without needing the full poster/image data.
  let titleIndex = {}; // { "12345": "Naruto", ... }

  function loadTitleIndex() {
    try {
      const raw = localStorage.getItem(TITLE_INDEX_KEY);
      if (raw) titleIndex = JSON.parse(raw);
    } catch (_) {}
  }

  function saveTitleIndex() {
    try {
      localStorage.setItem(TITLE_INDEX_KEY, JSON.stringify(titleIndex));
    } catch (_) {}
  }

  function mergeTitlesToIndex(items) {
    let changed = false;
    items.forEach(item => {
      const id = String(item.id);
      if (id && item.title && !titleIndex[id]) {
        titleIndex[id] = item.title;
        changed = true;
      }
    });
    if (changed) saveTitleIndex();
  }

  // ── Persistent Cache Management ────────────────────────────────────
  function loadCache() {
    try {
      const stored = localStorage.getItem(CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Look for our smart object layout (v4.0)
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
          cache           = parsed.items;
          cacheTimestamp  = parsed.updatedAt || Date.now();
          cacheIsComplete = parsed.isComplete || false;
          totalPages      = parsed.totalPages || 1;
        } else if (Array.isArray(parsed)) {
          // Backward compatibility with legacy direct-array format (v3.5)
          cache           = parsed;
          cacheTimestamp  = 0; // Force immediate update lifecycle check
          cacheIsComplete = false;
        }
      }
    } catch (e) {
      console.warn("Anikoto: Unable to parse local storage cache.", e);
    }

    // Load the standalone title index (faster than walking all cache items)
    loadTitleIndex();

    // Back-fill title index from existing cache items in case index was cleared
    if (cache.length > 0 && Object.keys(titleIndex).length < cache.length) {
      cache.forEach(item => {
        if (item.id && item.title) titleIndex[String(item.id)] = item.title;
      });
      saveTitleIndex();
    }
  }

  function saveToCache(items, isFullyComplete = false) {
    if (!Array.isArray(items)) return;

    const existingIds = new Set(cache.map(a => String(a.id)));
    let hasNewData = false;
    let newlyAdded = [];

    items.forEach(item => {
      const idStr = String(item.id);
      if (!existingIds.has(idStr)) {
        const cacheObj = {
          id: item.id,
          title: item.title || "",
          poster: item.poster || item.image || ""
        };
        cache.push(cacheObj);
        newlyAdded.push(cacheObj);
        existingIds.add(idStr);
        hasNewData = true;
      }
    });

    // Always sync titles into the lightweight index (even if cache already had item)
    mergeTitlesToIndex(items);

    if (isFullyComplete) {
      cacheIsComplete = true;
    }

    if (hasNewData || isFullyComplete) {
      try {
        const backupObj = {
          updatedAt: cacheTimestamp,
          isComplete: cacheIsComplete,
          totalPages: totalPages,
          items: cache
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(backupObj));
      } catch (e) {
        console.error("Anikoto: Local storage quota exceeded or unavailable.", e);
      }

      if (newlyAdded.length > 0) {
        injectLiveResults(newlyAdded);

if (isAnimeView()) {
          const grid = document.getElementById("anikoto-grid");
          if (grid) {
            newlyAdded.forEach(item => {
              if (!grid.querySelector(`[data-ani-id="${item.id}"]`)) {
                // Fix: Append directly to the grid. The sentinel is a sibling, 
                // so this safely keeps the cards above the sentinel layer.
                grid.appendChild(makeCard(item));
              }
            });
          }
        }
      }
    }
  }

  // ── Embed URL ──────────────────────────────────────────────────────
  function embedUrl(ep, type) {
    if (ep.embed_url?.[type]) return ep.embed_url[type];
    if (ep.episode_embed_id) return `${MEGAPLAY}/${ep.episode_embed_id}/${type}`;
    return "";
  }

  // ── Inject series into window.mediaData.anime ─────────────────────
  function injectEntry(id, anime, episodes) {
    const hasDub = episodes.some(ep => embedUrl(ep, "dub"));
    const season = {
      chapter       : "Episodes",
      video         : episodes.map(ep => embedUrl(ep, "sub")),
      episodeTitles : episodes.map((ep, i) => ep.title || `Episode ${ep.number || i + 1}`),
    };
    if (hasDub) season.dubbed = episodes.map(ep => embedUrl(ep, "dub"));

    window.mediaData             = window.mediaData || {};
    window.mediaData.anime       = window.mediaData.anime || {};
    window.mediaData.anime[`ANI_${id}`] = {
      title   : anime.title || `ANI_${id}`,
      image   : anime.poster || anime.background_image || "",
      _hidden : true,
      ANI_S1  : season,
    };
  }

  // ── Hover-prefetch so clicking feels instant ──────────────────────
  async function prefetchSeries(id) {
    if (window.mediaData?.anime?.[`ANI_${id}`]) return; 
    const data = await apiFetch(`${BASE}/series/${id}`);
    if (data?.ok) {
      injectEntry(id, data.data?.anime || {}, data.data?.episodes || []);
    }
  }

  // ── Card click ────────────────────────────────────────────────────
  async function onCardClick(card) {
    const id  = card.dataset.aniId;
    const key = `ANI_${id}`;

    window._vwPriority = true;

    if (card.dataset.done === "1" || window.mediaData?.anime?.[key]) {
      card.dataset.done = "1";
      window.viroPlay?.("anime", key, true); 
      window._vwPriority = false;
      return;
    }

    card.classList.add("ani-loading");
    const badge = card.querySelector(".ani-badge");
    if (badge) badge.textContent = "LOADING...";

    const data = await apiFetch(`${BASE}/series/${id}`);

    if (!data?.ok) {
      card.classList.remove("ani-loading");
      if (badge) badge.textContent = "STREAM";
      toast("Could not load episodes — check connection");
      window._vwPriority = false;
      return;
    }

    injectEntry(id, data.data?.anime || {}, data.data?.episodes || []);
    card.dataset.done = "1";
    card.classList.remove("ani-loading");
    if (badge) badge.textContent = "STREAM";
    
    window.viroPlay?.("anime", key, true);
    window._vwPriority = false;
  }

  // ── Card element ──────────────────────────────────────────────────
  function makeCard(item) {
    const card = document.createElement("div");
    card.className     = "movie-item ani-card";
    card.dataset.aniId = String(item.id);
    card.dataset.movie = `ANI_${item.id}`;
    card.dataset.done  = "0";

    const img   = document.createElement("img");
    const _aniSrc = item.poster || item.image || "";
    img.src     = _aniSrc;
    img.alt     = "";
    img.loading = "lazy";

    const p = document.createElement("p");
    p.className   = "kanit-extralight";
    p.textContent = item.title || "";

    const badge = document.createElement("span");
    badge.className   = "ani-badge";
    badge.textContent = "Anikoto";

    card.appendChild(img);
    card.appendChild(p);
    card.appendChild(badge);

    card.addEventListener("click", () => onCardClick(card));
    
    // Keep only data prefetch on hover, remove image lag logic
    card.addEventListener("mouseenter", () => {
      prefetchSeries(card.dataset.aniId);
    }, { passive: true });
    
    window._vwlAttachButton?.(card);
    return card;
  }

  // ── Skeletons ─────────────────────────────────────────────────────
  function addSkeletons(n) {
    const grid = document.getElementById("anikoto-grid");
    if (!grid) return;
    for (let i = 0; i < n; i++) {
      const sk = document.createElement("div");
      sk.className = "ani-skeleton";
      grid.appendChild(sk);
    }
  }
  function clearSkeletons() {
    document.getElementById("anikoto-grid")
      ?.querySelectorAll(".ani-skeleton")
      .forEach(sk => sk.remove());
  }

  // ── Render cached items to the grid immediately ───────────────────
  function renderCacheToGrid() {
    if (!cache.length) return;
    const grid = document.getElementById("anikoto-grid");
    if (!grid) return;
    cache.forEach(item => {
      if (!grid.querySelector(`[data-ani-id="${item.id}"]`)) {
        grid.appendChild(makeCard(item));
      }
    });
    armObserver();
  }

  // ── Load page (visible grid) ──────────────────────────────────────
  async function loadPage(n) {
    if (fetching) return;
    fetching = true;

    // Show the progress bar during initial fetch if index isn't fully built
    if (n === 1 && !cacheIsComplete) {
      const idxCount = Object.keys(titleIndex).length;
      const label = idxCount > 0
        ? `Anikoto · ${idxCount.toLocaleString()} titles ready · refreshing…`
        : "Anikoto · connecting…";
      updateProgress(0, 2, label);
    }

    addSkeletons(8);

    const data = await apiFetch(`${BASE}/recent-anime?page=${n}&per_page=${PER_PAGE}`);
    clearSkeletons();
    fetching = false;

    if (!data?.ok) {
      if (n === 1) {
        const grid = document.getElementById("anikoto-grid");
        if (grid) {
          const msg = document.createElement("p");
          msg.className   = "ani-error";
          msg.textContent = "Could not load streaming anime — check connection.";
          grid.appendChild(msg);
        }
      }
      return;
    }

    const pg   = data.pagination || {};
    page       = pg.page        || n;
    totalPages = pg.total_pages || 1;

    const items = data.data || [];
    saveToCache(items);

    const grid = document.getElementById("anikoto-grid");
    if (grid) {
      items.forEach(item => {
        if (!grid.querySelector(`[data-ani-id="${item.id}"]`)) {
          grid.appendChild(makeCard(item));
        }
      });
    }

    armObserver();

    // Verification wrapper for smart loading interval
    if (n === 1 && !bgLoading) {
      const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 Hours in ms
      const isCacheFresh = cacheIsComplete && (Date.now() - cacheTimestamp < CACHE_MAX_AGE);
      
      if (!isCacheFresh) {
        bgPreload();
      } else {
        // Cache is fresh — hide any progress bar that was shown during connect
        hideProgress();
        console.log(`Anikoto: Cache is fresh (${Math.round((Date.now() - cacheTimestamp) / 60000)}m old) and fully built. Bypassing background crawler.`);
      }
    }
  }

  // ── Aggressive Background Preload ─────────────────────────────────
  async function bgPreload() {
    bgLoading = true;
    let p = 2;
    cacheTimestamp = Date.now();
    cacheIsComplete = false;

    // Show the progress bar immediately
    updateProgress(1, totalPages || 2, null);

    while (p <= totalPages) {
      while (window._vwPriority) await sleep(300);

      const batch = [];
      for (let i = 0; i < 10 && p <= totalPages; i++, p++) {
        batch.push(apiFetch(`${BASE}/recent-anime?page=${p}&per_page=${PER_PAGE}`));
      }
      const results = await Promise.all(batch);
      for (const data of results) {
        if (!data?.ok) continue;
        const items = data.data || [];
        saveToCache(items); 
        if (data.pagination?.total_pages) totalPages = data.pagination.total_pages;
      }

      // Update progress bar after each batch
      updateProgress(p - 1, totalPages, null);

      await sleep(50); 
    }
    bgLoading = false;
    saveToCache([], true); // Final save to confirm complete indexing state
    hideProgress();
    console.log(`Anikoto: Full database cached! Total items: ${cache.length}, Titles indexed: ${Object.keys(titleIndex).length}`);
  }

  // ── Infinite scroll ───────────────────────────────────────────────
  function armObserver() {
    const sentinel = document.getElementById("anikoto-sentinel");
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

  // ── Show / hide Anikoto section ───────────────────────────────────
  function isAnimeView() {
    const w  = document.getElementById("movieListWrapper");
    const nb = document.getElementById("categoryNavBar");
    return (
      w && nb &&
      w.style.display  !== "none" &&
      nb.style.display !== "none" &&
      window._vwlCurrentCat === "anime"
    );
  }
  function updateVis() {
    const show = isAnimeView();
    const sep  = document.getElementById("anikoto-sep");
    const sec  = document.getElementById("anikoto-section");
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

  // ── Search ────────────────────────────────────────────────────────
  function cleanSearchCards() {
    document.getElementById("movieList")
      ?.querySelectorAll(".ani-card, .ani-search-sep")
      .forEach(el => el.remove());
  }

// ── Search fuzzy matcher (used by the in-grid search box, which shows ALL hits) ──
function fuzzyMatch(title, query) {
    const t = (title || "").toLowerCase();
    const q = query.toLowerCase();
    if (t.includes(q)) return true;

    const normT = t.replace(/[^a-z0-9]/g, "");
    const normQ = q.replace(/[^a-z0-9]/g, "");

    return normQ.length > 0 && normT.includes(normQ);
}

// ── Title-match scoring (used by deepPageSearch to pick the BEST hit, not the first) ──
// This is what fixes the "MHA: Memories" / "MHA Season 2" / "MHA Season 3" all beating
// real Season 1 to the punch when the user clicks an Anilist "My Hero Academia" card.
//
// Tier table (higher = better):
//   1000  exact match after normalization                       "my hero academia" == "My Hero Academia"
//    900  exact match ignoring season / subtitle / year suffix  "My Hero Academia: Memories" -> base "my hero academia" == q
//         (but only when query is the bare base title — see below)
//    700  title starts with query at a word boundary            "my hero academia season 2" starts with "my hero academia"
//    500  query appears as a whole word anywhere in title       "my hero academia" is a whole word in "watch my hero academia online"
//    300  plain substring (case-insensitive, normalized)        "my hero acad" inside "my hero academia"
//    200  alphanumeric-only substring (preserves old fuzzyMatch "bokunohero" inside "bokunoheroacademia"
//         fallback behavior for tight queries)
// At every non-exact tier, shorter titles beat longer titles at the same tier — so
// "My Hero Academia" (len 18) beats "My Hero Academia: Memories" (len 28) at tier 700
// when the query is "My Hero Academia".
function normalizeTitle(s) {
    return (s || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")   // strip accents
        .replace(/[^a-z0-9\s]/g, " ")      // punctuation -> space
        .replace(/\s+/g, " ")
        .trim();
}

// Reduce "My Hero Academia Season 2" / "My Hero Academia: Memories" / "My Hero Academia (2016)"
// to their base form "my hero academia" so we can tell when a title IS the base series
// vs a spinoff/special/season of it.
function stripSeasonNoise(s) {
    return normalizeTitle(s)
        .replace(/\s*season\s*\d+.*$/, "")
        .replace(/\s*part\s*\d+.*$/, "")
        .replace(/\s*cour\s*\d+.*$/, "")
        .replace(/\s*\d{4}$/, "")          // trailing 4-digit year
        .replace(/\s*$/, "");
}

function scoreTitleMatch(title, query) {
    const t = normalizeTitle(title);
    const q = normalizeTitle(query);
    if (!q || !t) return 0;

    // Tier 1: exact match
    if (t === q) return 1000;

    // Tier 2: title's "base" (no season/subtitle/year suffix) exactly equals query.
    // This is what lets real Season 1 ("My Hero Academia") win over
    // "My Hero Academia: Memories" when the user searches "My Hero Academia":
    //   "my hero academia: memories" -> stripSeasonNoise -> "my hero academia"
    //   BUT the title is longer than the base, so we score it 900, not 1000.
    // And "My Hero Academia" (the real S1) hits tier 1 (1000) and beats it.
    const base = stripSeasonNoise(title);
    if (base === q && t !== q) return 900;

    // Tier 3: title starts with query, on a word boundary
    if (t === q || t.startsWith(q + " ")) {
        return 700 - Math.max(0, t.length - q.length);
    }

    // Tier 4: query appears as a whole word anywhere
    const re = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(t)) {
        return 500 - Math.max(0, t.length - q.length);
    }

    // Tier 5: plain substring (case-insensitive, normalized)
    if (t.includes(q)) {
        return 300 - Math.max(0, t.length - q.length);
    }

    // Tier 6: alphanumeric-only substring (preserves old fuzzyMatch fallback)
    const nt = t.replace(/[^a-z0-9]/g, "");
    const nq = q.replace(/[^a-z0-9]/g, "");
    if (nq.length > 0 && nt.includes(nq)) {
        return 200 - Math.max(0, nt.length - nq.length);
    }

    return 0;
}

function pickBestCandidate(query, candidates) {
    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
        const score = scoreTitleMatch(c.title || "", query);
        if (score > bestScore) {
            bestScore = score;
            best = c;
            // Tier 1 (exact) is unbeatable — bail early.
            if (bestScore >= 1000) return { best, bestScore };
        }
    }
    return { best, bestScore };
}

// ── FIX: there is no `/series?search=` endpoint on the real Anikoto API ──
// (only `/recent-anime` for listings and `/series/{id}` for one show — see
// https://anikotoapi.site/ docs). Every call to `${BASE}/series?search=...`
// was hitting a route that doesn't exist, so it failed on every proxy,
// burning through all retries (up to ~18 requests with backoff) before
// giving up — which is why Anilist → Anikoto resolution looked broken or
// just very slow. This walks the real `/recent-anime` listing a few pages
// deep looking for a fuzzy title match, on top of what's already cached.
//
// SCORING FIX (the bug you reported): the old version used `.find()` which
// returns the FIRST candidate whose title contains the query as a substring.
// For "My Hero Academia" that meant whichever of {S1, S2, S3, Memories, ...}
// happened to be crawled first won, with no preference for the real Season 1.
// Now we score every candidate seen and return the single best one, short-
// circuiting only on a true exact (tier-1000) match.
let deepSearchInFlight = null; // dedupe concurrent calls for the same run
async function deepPageSearch(query, maxPages = 8) {
    const q = (query || "").trim();
    if (!q) return null;

    // ── Stage 1: pool candidates from cache + title index ──────────────
    // Score each, short-circuit on a true exact match.
    const localPool = cache
        .map(a => ({ id: a.id, title: a.title, poster: a.poster || "" }));

    // Add index entries that aren't already in the cache pool
    const localIds = new Set(localPool.map(c => String(c.id)));
    Object.entries(titleIndex).forEach(([id, title]) => {
        if (!localIds.has(id)) {
            localPool.push({ id: Number(id), title, poster: "" });
        }
    });

    let { best, bestScore } = pickBestCandidate(q, localPool);
    if (bestScore >= 1000) return best;

    // ── Stage 2: page forward through /recent-anime ────────────────────
    // Track running best across all pages; only short-circuit on a true
    // exact match. This is what lets us discover a better match on page 5
    // than the first fuzzy hit on page 1.
    let p = Math.max(1, page);
    for (let i = 0; i < maxPages && p <= totalPages; i++, p++) {
        let data;
        try {
            data = await apiFetch(`${BASE}/recent-anime?page=${p}&per_page=${PER_PAGE}`);
        } catch (_) {
            break;
        }
        if (!data?.ok) break;

        const items = data.data || [];
        saveToCache(items);
        if (data.pagination?.total_pages) totalPages = data.pagination.total_pages;

        const { best: pageBest, bestScore: pageScore } = pickBestCandidate(q, items);
        if (pageScore > bestScore) {
            bestScore = pageScore;
            best = pageBest;
            if (bestScore >= 1000) return best;
        }
    }

    // Return the best non-exact match found, if anything scored above 0.
    // (Threshold of >0 matches the old fuzzyMatch acceptance bar — we never
    // return a worse result than the old "first hit" code would have.)
    return bestScore > 0 ? best : null;
}

  let currentSearchId = 0; 

  // ── Live Result Injection ──────────────────────────────────────────
  function injectLiveResults(newItems) {
    if (!currentSearchQuery || currentSearchQuery.length < 2) return;

    const ml = document.getElementById("movieList");
    if (!ml) return;

    const liveHits = newItems.filter(a => fuzzyMatch(a.title, currentSearchQuery));
    if (liveHits.length === 0) return;

    let addedCount = 0;
    liveHits.forEach(a => {
      if (!ml.querySelector(`[data-ani-id="${a.id}"]`)) {
        const separator = ml.querySelector(".ani-search-sep");
        if (separator) {
          ml.insertBefore(makeCard(a), separator);
        } else {
          ml.appendChild(makeCard(a));
        }
        addedCount++;
      }
    });

    if (addedCount > 0) {
      const indicator = Array.from(ml.querySelectorAll('.ani-search-sep')).find(el => el.textContent.includes("matches") || el.textContent.includes("Searching"));
      if (indicator && indicator.textContent.includes("Searching")) {
        indicator.textContent = `✨ Background worker matched ${addedCount} more titles live...`;
        indicator.style.color = "rgba(99,102,241, 0.9)";
      }
    }
  }

  async function doSearch(q) {
    cleanSearchCards();
    if (!q || q.length < 2) return;

    const ml = document.getElementById("movieList");
    if (!ml) return;

    const mySearchId = ++currentSearchId;

    function insertMixed(card) {
      const nativeCards = Array.from(ml.children).filter(c => !c.classList.contains('ani-card') && !c.classList.contains('ani-search-sep'));
      const aniCards = Array.from(ml.children).filter(c => c.classList.contains('ani-card'));
      const targetIndex = Math.min(aniCards.length * 2, nativeCards.length + aniCards.length);
      ml.insertBefore(card, ml.children[targetIndex] || null);
    }

    // 1) Search the full cache (has poster images)
    const localHits = cache.filter(a => fuzzyMatch(a.title, q));
    const shownIds = new Set();

    if (localHits.length > 0) {
      localHits.forEach(a => {
        const idStr = String(a.id);
        if (!ml.querySelector(`[data-ani-id="${idStr}"]`)) {
          insertMixed(makeCard(a));
          shownIds.add(idStr);
        }
      });
    }

    // 2) Also search the lightweight title index for titles not yet in cache
    //    This gives instant results even before the full cache has built.
    const indexHits = Object.entries(titleIndex)
      .filter(([id, title]) => !shownIds.has(id) && fuzzyMatch(title, q));
    indexHits.forEach(([id, title]) => {
      if (!ml.querySelector(`[data-ani-id="${id}"]`)) {
        // Synthesise a minimal item — poster will lazy-load on hover/click
        insertMixed(makeCard({ id: Number(id), title, poster: "" }));
        shownIds.add(id);
      }
    });

    // 3) Not found locally yet — page forward through the real
    //    /recent-anime listing looking for more matches. There is no
    //    server-side search endpoint on the Anikoto API (only
    //    /recent-anime and /series/{id}), so this is the only way to
    //    extend search coverage beyond what's already cached.
    if (shownIds.size === 0) {
      const sep = document.createElement("div");
      sep.className = "ani-search-sep";
      sep.style.cssText = "grid-column: 1/-1; text-align: center; color: rgba(255,255,255,0.4); font-size: 0.85rem; padding: 12px 10px; font-family: 'Kanit', sans-serif;";
      sep.textContent = "🔍 Checking more pages of the database...";
      ml.appendChild(sep);

      let p = Math.max(1, page);
      let foundAny = false;
      for (let i = 0; i < 8 && p <= totalPages; i++, p++) {
        if (mySearchId !== currentSearchId) { sep.remove(); return; }

        let data;
        try {
          data = await apiFetch(`${BASE}/recent-anime?page=${p}&per_page=${PER_PAGE}`);
        } catch (_) {
          break;
        }
        if (!data?.ok) break;

        const items = data.data || [];
        saveToCache(items);
        if (data.pagination?.total_pages) totalPages = data.pagination.total_pages;

        const hits = items.filter(a => fuzzyMatch(a.title, q) && !shownIds.has(String(a.id)));
        hits.forEach(a => {
          insertMixed(makeCard(a));
          shownIds.add(String(a.id));
          foundAny = true;
        });
        if (foundAny) break; // stop as soon as we find something on this page
      }

      sep.remove();
      if (shownIds.size === 0) {
        const noResults = document.createElement("div");
        noResults.className = "ani-search-sep";
        noResults.style.cssText = "grid-column: 1/-1; text-align: center; color: rgba(255,255,255,0.3); font-size: 0.9rem; padding: 20px;";
        noResults.textContent = `No matches found for "${q}" yet — it may not be cached. Try the Anime tab to let more of the database load.`;
        ml.appendChild(noResults);
      }
    }
  }


  // ── Hook Search Event Listener ─────────────────────────────────────
  function hookSearch() {
    const input = document.getElementById("searchInput");
    if (!input) return;
    input.addEventListener("input", (e) => {
      clearTimeout(searchTid);
      const q = e.target.value.trim();
      currentSearchQuery = q; 

      searchTid = setTimeout(() => {
        // ── FIX: Only show anikoto results for queries ≥ 3 chars.
        // Prevents virowatch anime content from flooding search when
        // the user is typing short queries unrelated to anime.
        if (q.length < 3) {
          cleanSearchCards();
        } else {
          doSearch(q);
        }
      }, 350);
    });
  }

  // ── Toast ─────────────────────────────────────────────────────────
  function toast(msg) {
    let t = document.getElementById("vwl-toast");
    if (!t) { t = document.createElement("div"); t.id = "vwl-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.className = "vwl-show";
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.className = ""; }, 2600);
  }

  // ── Fetch Progress Bar ────────────────────────────────────────────
  // A slim bar anchored to the bottom-center of the screen that shows
  // Anikoto background-fetch progress. Disappears when done.
  let _progressBar = null;
  let _progressLabel = null;
  let _progressFill = null;
  let _progressHideTimer = null;

  function ensureProgressBar() {
    if (_progressBar) return;

    const bar = document.createElement("div");
    bar.id = "ani-progress-bar";
    bar.innerHTML = `
      <span id="ani-progress-label">Anikoto · indexing…</span>
      <div id="ani-progress-track">
        <div id="ani-progress-fill"></div>
      </div>
    `;
    document.body.appendChild(bar);
    _progressBar   = bar;
    _progressFill  = document.getElementById("ani-progress-fill");
    _progressLabel = document.getElementById("ani-progress-label");

    // Inject bar CSS once
    if (!document.getElementById("ani-progress-css")) {
      const s = document.createElement("style");
      s.id = "ani-progress-css";
      s.textContent = `
        #ani-progress-bar {
          position: fixed;
          bottom: 24px;
          left: 80px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          z-index: 100;
          pointer-events: none;
          opacity: 1;
          transition: opacity 0.5s ease;
          background: rgba(14, 14, 14, 0.82);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 10px 14px;
          width: 188px;
        }
        #ani-progress-bar.ani-progress-hidden {
          opacity: 0;
        }
        #ani-progress-label {
          font-family: "Kanit", sans-serif;
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.35);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #ani-progress-track {
          width: 100%;
          height: 2px;
          background: rgba(255, 255, 255, 0.07);
          border-radius: 999px;
          overflow: hidden;
        }
        #ani-progress-fill {
          height: 100%;
          width: 0%;
          background: rgba(255, 255, 255, 0.4);
          border-radius: 999px;
          transition: width 0.4s ease;
        }
        @media (max-width: 480px) {
          #ani-progress-bar { left: 70px; width: 160px; bottom: 20px; }
        }
      `;
      document.head.appendChild(s);
    }
  }

  function updateProgress(pagesLoaded, pagesTotal, label) {
    ensureProgressBar();
    clearTimeout(_progressHideTimer);
    _progressBar.classList.remove("ani-progress-hidden");

    const pct = pagesTotal > 0 ? Math.min(100, Math.round((pagesLoaded / pagesTotal) * 100)) : 0;
    _progressFill.style.width = pct + "%";

    const count = Object.keys(titleIndex).length;
    _progressLabel.textContent = label
      || `Anikoto · ${count.toLocaleString()} titles · ${pct}%`;
  }

  function hideProgress() {
    if (!_progressBar) return;
    const count = Object.keys(titleIndex).length;
    _progressLabel.textContent = `Anikoto · ${count.toLocaleString()} titles indexed ✓`;
    _progressFill.style.width = "100%";
    _progressHideTimer = setTimeout(() => {
      _progressBar.classList.add("ani-progress-hidden");
    }, 2200);
  }

  // ── Build DOM ─────────────────────────────────────────────────────
  function buildDOM() {
    const wrapper = document.getElementById("movieListWrapper");
    if (!wrapper) return false;

    const sep = document.createElement("div");
    sep.id            = "anikoto-sep";
    sep.style.display = "none";
    sep.innerHTML     = '<div class="ani-sep-line"></div><span class="ani-sep-label">Streaming Anime · Anikoto / MegaPlay</span><div class="ani-sep-line"></div>';

    const sec = document.createElement("div");
    sec.id            = "anikoto-section";
    sec.style.display = "none";

    const grid     = document.createElement("div"); grid.id = "anikoto-grid";
    const sentinel = document.createElement("div");
    sentinel.id            = "anikoto-sentinel";
    sentinel.style.cssText = "height:2px;width:100%;pointer-events:none;";

    sec.appendChild(grid);
    sec.appendChild(sentinel);
    wrapper.insertAdjacentElement("afterend", sec);
    wrapper.insertAdjacentElement("afterend", sep);
    return true;
  }

  // ── CSS ───────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById("ani-css")) return;
    const s = document.createElement("style");
    s.id = "ani-css";
    s.textContent = `
      #anikoto-sep,.ani-search-sep{display:flex;align-items:center;gap:12px;padding:24px 0 14px;}
      .ani-search-sep{grid-column:1/-1;padding:12px 0 8px;}
      .ani-sep-line{flex:1;height:1px;background:rgba(255,255,255,.1);}
      .ani-sep-label{color:rgba(255,255,255,.35);font-family:"Kanit",sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;flex-shrink:0;}
      #anikoto-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px;padding:5px 0 20px;}
      .ani-badge{position:absolute;top:6px;right:6px;background:rgba(99,102,241,.88);color:#fff;font-family:"Kanit",sans-serif;font-size:.55rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 6px;border-radius:3px;pointer-events:none;z-index:2;backdrop-filter:blur(4px);}
      .ani-card.ani-loading{opacity:.5;pointer-events:none;}
      .ani-skeleton{aspect-ratio:2/3;border-radius:12px;background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 75%);background-size:300% 100%;animation:ani-shim 1.5s infinite linear;}
      @keyframes ani-shim{0%{background-position:300% 0}100%{background-position:-300% 0}}
      .ani-error{color:rgba(255,100,100,.75);font-family:"Kanit",sans-serif;font-size:.85rem;text-align:center;padding:24px;grid-column:1/-1;}
      
      /* TRUE PERFORMANCE MODE */
      /* content-visibility tells the browser to skip rendering cards 
         until they are scrolled into view. This eliminates scroll lag. */
      .perf-mode .ani-card {
        content-visibility: auto;
        contain-intrinsic-size: 135px 260px;
      }
      
      @media(max-width:768px){#anikoto-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;}.ani-badge{font-size:.5rem;padding:1px 4px;}}
    `;
    document.head.appendChild(s);
  }

  // ── Expose search-by-title for genre search integration ──────────
  // Called by content.js when a user clicks an Anilist genre card.
  // Searches the Anikoto API, fetches episodes, and injects into mediaData.
  //
  // FIX: this used to call `${BASE}/series?search=...`, which is not a real
  // endpoint on the Anikoto API (it only has /recent-anime and
  // /series/{id} — see https://anikotoapi.site/). That call failed on every
  // proxy every time, burning through ~18 requests with backoff before
  // giving up, which is why clicking an Anilist genre result usually just
  // showed "Not found" (or took forever first). Now it checks what's
  // already cached/indexed, and if that's not enough, pages forward
  // through the real /recent-anime listing via deepPageSearch().
  window._anikotoSearchByTitle = async function(title) {
    try {
      const bestMatch = await deepPageSearch(title, 8);
      if (!bestMatch) return null;

      const seriesData = await apiFetch(`${BASE}/series/${bestMatch.id}`);
      if (!seriesData?.ok) return null;

      injectEntry(bestMatch.id, seriesData.data?.anime || {}, seriesData.data?.episodes || []);
      return `ANI_${bestMatch.id}`;
    } catch (e) {
      console.error("Anikoto search-by-title failed:", e);
      return null;
    }
  };

  // ── Init ──────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    loadCache(); 

    // Automated Service Worker registration hook (Option 1 Implementation)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js")
        .then(reg => console.log("Anikoto Service Worker registered successfully with scope:", reg.scope))
        .catch(err => console.error("Anikoto Service Worker registration failed:", err));
    }

    setTimeout(() => {
      injectCSS();
      if (!buildDOM()) return;
      watchVisibility();
      updateVis();
      hookSearch();
      renderCacheToGrid(); 
      loadPage(1);         
    }, 300);
  });
})();
