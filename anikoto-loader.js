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

  const BASE     = "https://anikotoapi.site";
  const MEGAPLAY = "https://megaplay.buzz/stream/s-2";
  const PER_PAGE = 24;
  const TIMEOUT  = 10000;
  const BG_PAGES = 6; 
  const CACHE_KEY = "anikoto_cache";

  // ── Proxy list ────────────────────────────────────────────────────
  const PROXIES = [
    {
      build: u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
      parse: async r => {
        const j = await r.json();
        const raw = j.contents;
        if (!raw) throw new Error("no contents");
        return typeof raw === "string" ? JSON.parse(raw) : raw;
      },
    },
    {
      build: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
    {
      build: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
    {
      build: u => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
    {
      build: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
  ];

  let winProxy = null; 

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

  // ── Core fetch with proxy chain + retry ───────────────────────────
  async function apiFetch(url, retries = 2) {
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
          if (!r.ok) continue;
          const data = await proxy.parse(r);
          if (data) { winProxy = idx; return data; }
        } catch (_) {}
      }
      if (attempt < retries - 1) await sleep(1200 * (attempt + 1));
    }
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
    img.src     = item.poster || item.image || ""; 
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

    card.addEventListener("click",      () => onCardClick(card));
    card.addEventListener("mouseenter", () => prefetchSeries(card.dataset.aniId), { passive: true });
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
      await sleep(50); 
    }
    bgLoading = false;
    saveToCache([], true); // Final save to confirm complete indexing state
    console.log(`Anikoto: Full database cached! Total items: ${cache.length}`);
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

  function fuzzyMatch(title, query) {
    const t = (title || "").toLowerCase();
    const q = query.toLowerCase();
    if (t.includes(q)) return true; 

    const normT = t.replace(/[^a-z0-9]/g, "");
    const normQ = q.replace(/[^a-z0-9]/g, "");
    
    return normQ.length > 0 && normT.includes(normQ);
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

    const localHits = cache.filter(a => fuzzyMatch(a.title, q));
    
    if (localHits.length > 0) {
      localHits.forEach(a => {
        if (!ml.querySelector(`[data-ani-id="${a.id}"]`)) {
          insertMixed(makeCard(a));
        }
      });
    }

    const sep = document.createElement("div");
    sep.className = "ani-search-sep";
    sep.style.cssText = "grid-column: 1/-1; text-align: center; color: rgba(255,255,255,0.4); font-size: 0.85rem; padding: 12px 10px; font-family: 'Kanit', sans-serif;";
    sep.textContent = "🔍 Searching full database...";
    ml.appendChild(sep);

    try {
      const res = await apiFetch(`${BASE}/series?search=${encodeURIComponent(q)}`);
      
      if (mySearchId !== currentSearchId) return;

      sep.remove();

      if (res?.ok && Array.isArray(res.data)) {
        const remoteHits = res.data;
        
        saveToCache(remoteHits);

        const newHits = remoteHits.filter(item => !localHits.some(local => String(local.id) === String(item.id)));

        if (localHits.length === 0 && newHits.length === 0) {
          const noResults = document.createElement("div");
          noResults.className = "ani-search-sep";
          noResults.style.cssText = "grid-column: 1/-1; text-align: center; color: rgba(255,255,255,0.3); font-size: 0.9rem; padding: 20px;";
          noResults.textContent = `No matches found for "${q}"`;
          ml.appendChild(noResults);
          return;
        }

        newHits.slice(0, 12).forEach(a => {
          insertMixed(makeCard(a));
        });

        const totalCount = localHits.length + newHits.length;
        const countIndicator = document.createElement("div");
        countIndicator.className = "ani-search-sep";
        countIndicator.style.cssText = "grid-column: 1/-1; text-align: center; color: rgba(255,255,255,0.2); font-size: 0.75rem; padding: 8px 0;";
        countIndicator.textContent = `Found ${totalCount} total database matches`;
        ml.appendChild(countIndicator);
      } else {
        if (localHits.length === 0) {
          sep.textContent = "No matches found in full database.";
        }
      }
    } catch (err) {
      if (mySearchId === currentSearchId) {
        sep.textContent = "Error connecting to full database search.";
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
        if (q.length < 2) {
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
      @media(max-width:768px){#anikoto-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;}.ani-badge{font-size:.5rem;padding:1px 4px;}}
    `;
    document.head.appendChild(s);
  }

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
