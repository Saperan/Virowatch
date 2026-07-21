/**
 * anikoto-loader.js  —  Virowatch × Anikoto / MegaPlay  v3.2
 *
 * Fixes:
 * - Reliable proxy chain with retries + safe JSON parsing
 * - Hover-prefetch so clicking a card feels instant
 * - Background preloads extra pages so search has real coverage
 * - Search shows result count + "still loading" hint
 * - Deep master database search endpoint queries included
 */
(function () {
  "use strict";

  const BASE     = "https://anikotoapi.site";
  const MEGAPLAY = "https://megaplay.buzz/stream/s-3";
  const PER_PAGE = 24;
  const TIMEOUT  = 10000;

  // Your Cloudflare Worker (reliable, adds CORS). Tried first; public
  // proxies below stay as fallback. Set to "" to disable.
  const WORKER = "https://anikoto-request.vmtgaming13.workers.dev";

  // ── Proxy list ────────────────────────────────────────────────────
  const PROXIES = [
    ...(WORKER ? [{
      build: u => `${WORKER}/api?u=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    }] : []),
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

  let winProxy = null; // index of last successful proxy (cached for speed)

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
  let page       = 1;
  let totalPages = 1;
  let fetching   = false;
  let cache      = [];   // all fetched anime metadata (drives instant search)
  let searchTid  = null;

  // ── Embed URL ──────────────────────────────────────────────────────
  // MegaPlay's s-2 route serves an error page when no Referer header is sent
  // (always the case for pages opened via file://). The s-3 route wraps s-2
  // in an iframe on megaplay's own origin, so the inner request has a
  // Referer and plays everywhere.
  function embedUrl(ep, type) {
    if (ep.embed_url?.[type])
      return ep.embed_url[type].replace(/\/stream\/s-\d+\//, "/stream/s-3/");
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
    if (window.mediaData?.anime?.[`ANI_${id}`]) return; // already done
    const data = await apiFetch(`${BASE}/series/${id}`);
    if (data?.ok) {
      injectEntry(id, data.data?.anime || {}, data.data?.episodes || []);
    }
  }

  // ── Check whether an episode file really exists on MegaPlay ───────
  // Via the Worker the probe carries the real Referer, so MegaPlay answers
  // 200 (player page = file exists) or 404 (not released yet). Without the
  // Worker we fall back to a public proxy that returns the error page body.
  async function embedExists(s2Url) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      if (WORKER) {
        const r = await fetch(
          `${WORKER}/hls?u=${encodeURIComponent(s2Url)}`,
          { signal: ctrl.signal },
        );
        clearTimeout(tid);
        return r.status !== 404; // 404 = not on MegaPlay yet; else assume playable
      }
      const r = await fetch(
        `https://api.allorigins.win/raw?url=${encodeURIComponent(s2Url)}`,
        { signal: ctrl.signal },
      );
      clearTimeout(tid);
      if (!r.ok) return true; // proxy trouble — don't block playback
      const text = await r.text();
      if (/Error Code:\s*<span>404/i.test(text)) return false;
      return true;
    } catch (_) {
      return true; // unknown — assume playable
    }
  }

  // ── Load a series by id, then play it ─────────────────────────────
  // statusCb(state) optional: "loading" | "soon" | "error" | "ready".
  // Returns true if playback started. Reused by grid cards + search results.
  async function openAnikotoById(id, statusCb) {
    const key = `ANI_${id}`;
    const say = (s) => { if (statusCb) statusCb(s); };

    if (!window.mediaData?.anime?.[key]) {
      if (!statusCb) toast("Loading episodes…");
      say("loading");
      const data = await apiFetch(`${BASE}/series/${id}`);
      if (!data?.ok) { say("error"); toast("Could not load episodes — check connection"); return false; }
      injectEntry(id, data.data?.anime || {}, data.data?.episodes || []);
    }

    const vids = (window.mediaData.anime[key]?.ANI_S1?.video || []).filter(Boolean);
    if (!vids.length) { say("soon"); toast("No episodes released yet — check back after it airs"); return false; }

    // Probe the first episode so missing files show a message, not a 404 page.
    const s2Url = vids[0].replace("/stream/s-3/", "/stream/s-2/");
    if (!(await embedExists(s2Url))) {
      say("soon"); toast("Not on MegaPlay yet — episode should appear soon"); return false;
    }

    say("ready");
    window.viroPlay?.("anime", key);
    return true;
  }
  window.openAnikotoById = openAnikotoById;

  // ── Card click ────────────────────────────────────────────────────
  async function onCardClick(card) {
    const id  = card.dataset.aniId;
    if (card.dataset.done === "1") { window.viroPlay?.("anime", `ANI_${id}`); return; }

    card.classList.add("ani-loading");
    const badge = card.querySelector(".ani-badge");
    const ok = await openAnikotoById(id, (s) => {
      if (!badge) return;
      badge.textContent =
        s === "loading" ? "LOADING..." : s === "soon" ? "SOON" : "STREAM";
    });
    card.classList.remove("ani-loading");
    if (ok) card.dataset.done = "1";
  }

  // ── Card element ──────────────────────────────────────────────────
  function makeCard(item) {
    const card = document.createElement("div");
    card.className     = "movie-item ani-card";
    card.dataset.aniId = String(item.id);
    card.dataset.done  = "0";
    // AniList media id — hover-info.js reads this for the info card
    if (item.ani_id) card.dataset.aniListId = String(item.ani_id);

    const img  = document.createElement("img");
    img.src     = item.poster || "";
    img.alt     = "";
    img.loading = "lazy";

    const p = document.createElement("p");
    p.className   = "kanit-extralight";
    p.textContent = item.title || "";

    const badge = document.createElement("span");
    badge.className   = "ani-badge";
    badge.textContent = "STREAM";

    card.appendChild(img);
    card.appendChild(p);
    card.appendChild(badge);

    card.addEventListener("click",      () => onCardClick(card));
    card.addEventListener("mouseenter", () => prefetchSeries(card.dataset.aniId), { passive: true });
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

  // ── Pager UI state ────────────────────────────────────────────────
  function updatePager() {
    const prev  = document.getElementById("anikoto-prev");
    const next  = document.getElementById("anikoto-next");
    const label = document.getElementById("anikoto-page-label");
    if (prev)  prev.disabled  = fetching || page <= 1;
    if (next)  next.disabled  = fetching || page >= totalPages;
    if (label) label.textContent = fetching ? "Loading…" : `Page ${page} / ${totalPages}`;
  }

  // ── Load a single page (replaces grid content) ────────────────────
  async function loadPage(n) {
    if (fetching || n < 1 || n > totalPages) return;
    fetching = true;
    updatePager();

    const grid = document.getElementById("anikoto-grid");
    if (grid) grid.innerHTML = "";
    addSkeletons(8);

    const data = await apiFetch(`${BASE}/recent-anime?page=${n}&per_page=${PER_PAGE}`);
    clearSkeletons();
    fetching = false;

    if (!data?.ok) {
      if (grid) {
        const msg = document.createElement("p");
        msg.className   = "ani-error";
        msg.textContent = "Could not load streaming anime — check connection.";
        grid.appendChild(msg);
      }
      updatePager();
      return;
    }

    const pg   = data.pagination || {};
    page       = pg.page        || n;
    totalPages = pg.total_pages || 1;

    const items = data.data || [];
    const existingIds = new Set(cache.map(a => a.id));
    cache = cache.concat(items.filter(a => !existingIds.has(a.id)));

    if (grid) items.forEach(item => grid.appendChild(makeCard(item)));
    updatePager();

    // First page = "newest added" source for the home grid (content.js).
    if (n === 1 && items.length) {
      recentItems = items.slice();
      window.dispatchEvent(new CustomEvent("anikoto-recent"));
    }
  }

  // ── Newest-added feed for the home page ───────────────────────────
  let recentItems = [];
  window.anikotoRecent = () => recentItems.slice();

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

  // ── Catalog index for search ──────────────────────────────────────
  // The API has NO search endpoint, so we build a local index once from the
  // paginated catalog (89 pages of 100) and cache it in the browser ~24h.
  // content.js calls window.anikotoSearch(q) to fold results into the main
  // ranked search.
  const IDX_KEY = "anikotoIndex_v3"; // v3: added aniListId for AniList matching
  const IDX_TTL = 24 * 3600 * 1000;
  let catalog     = [];
  let indexReady  = false;
  let buildPromise = null;

  function buildCatalog() {
    if (!buildPromise) buildPromise = _buildCatalog();
    return buildPromise;
  }

  async function _buildCatalog() {
    try {
      const o = JSON.parse(localStorage.getItem(IDX_KEY) || "null");
      if (o && Date.now() - o.t < IDX_TTL && Array.isArray(o.d) && o.d.length) {
        catalog = o.d; indexReady = true; return;
      }
    } catch (_) {}

    const first = await apiFetch(`${BASE}/recent-anime?page=1&per_page=100`);
    if (!first?.ok) { buildPromise = null; return; } // allow a later retry
    const totalPages = first.pagination?.total_pages || 1;
    const map = new Map();
    const add = (items) => (items || []).forEach((a) => {
      if (a && a.id != null && !map.has(a.id)) {
        map.set(a.id, {
          id: a.id,
          title: a.title || "",
          alt: a.alternative || "",
          poster: a.poster || "",
          aniListId: a.ani_id ? Number(a.ani_id) : null,
        });
      }
    });
    add(first.data);

    let pageN = 2;
    async function pageWorker() {
      while (pageN <= totalPages) {
        const p = pageN++;
        const d = await apiFetch(`${BASE}/recent-anime?page=${p}&per_page=100`);
        if (d?.ok) add(d.data);
      }
    }
    await Promise.all(Array.from({ length: 5 }, pageWorker));

    catalog = [...map.values()];
    indexReady = true;
    try { localStorage.setItem(IDX_KEY, JSON.stringify({ t: Date.now(), d: catalog })); } catch (_) {}
  }

  function scoreTitle(title, q) {
    const t = (title || "").toLowerCase();
    if (!t) return 0;
    if (t === q) return 1000;
    if (t.startsWith(q)) return 600 - Math.min(200, t.length);
    if (t.includes(q)) return 400 - Math.min(200, t.length);
    let j = 0;
    for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) j++;
    return j === q.length ? 120 - Math.min(100, t.length) : 0;
  }

  // Exposed ranked search over the anikoto catalog (or browsed cache if the
  // index isn't built yet). Returns [{ id, title, poster, score }].
  window.anikotoSearch = function (query) {
    const q = (query || "").toLowerCase().trim();
    if (q.length < 2) return [];
    const src = indexReady && catalog.length ? catalog : cache;
    const res = [];
    for (const a of src) {
      const s = Math.max(scoreTitle(a.title, q), scoreTitle(a.alt || a.alternative, q));
      if (s > 0)
        res.push({
          id: a.id,
          title: a.title,
          poster: a.poster,
          score: s,
          // catalog entries have aniListId, browsed-cache items raw ani_id
          aniListId: a.aniListId || (a.ani_id ? Number(a.ani_id) : null),
        });
    }
    res.sort((x, y) => y.score - x.score);
    return res.slice(0, 60);
  };
  window.anikotoIndexReady = () => indexReady;

  // Ensure the catalog index is built (used by the AniList importer).
  window.anikotoEnsureIndex = () => buildCatalog();

  // Match an AniList media id → anikoto catalog entry (or null).
  window.anikotoFindByAniList = function (aniListId) {
    const id = Number(aniListId);
    if (!id) return null;
    return catalog.find((a) => a.aniListId === id) || null;
  };

  // Reverse lookup: anikoto id → AniList media id (builds the index first).
  window.anikotoGetAniListId = async function (anikotoId) {
    await buildCatalog();
    const e = catalog.find((a) => String(a.id) === String(anikotoId));
    return e && e.aniListId ? e.aniListId : null;
  };

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

    const grid = document.createElement("div"); grid.id = "anikoto-grid";

    const pager = document.createElement("div");
    pager.id = "anikoto-pager";

    const prev = document.createElement("button");
    prev.id          = "anikoto-prev";
    prev.type        = "button";
    prev.textContent = "‹ Prev";
    prev.disabled    = true;

    const label = document.createElement("span");
    label.id          = "anikoto-page-label";
    label.textContent = "Page 1 / 1";

    const next = document.createElement("button");
    next.id          = "anikoto-next";
    next.type        = "button";
    next.textContent = "Next ›";
    next.disabled    = true;

    prev.addEventListener("click", () => {
      loadPage(page - 1);
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    next.addEventListener("click", () => {
      loadPage(page + 1);
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);

    sec.appendChild(grid);
    sec.appendChild(pager);
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
      .ani-sep-line{flex:1;height:1px;background:var(--vw-border,rgba(255,255,255,.1));}
      .ani-sep-label{color:var(--vw-muted,rgba(255,255,255,.35));font-family:"Kanit",sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;flex-shrink:0;}
      #anikoto-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px;padding:5px 0 20px;}
      .ani-badge{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.75);color:#fff;font-family:"Kanit",sans-serif;font-size:.6rem;font-weight:500;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:6px;pointer-events:none;z-index:2;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
      .ani-card.ani-loading{opacity:.5;pointer-events:none;}
      .ani-skeleton{aspect-ratio:2/3;border-radius:12px;background:linear-gradient(90deg,var(--vw-border,rgba(255,255,255,.04)) 25%,var(--vw-hover-strong,rgba(255,255,255,.09)) 50%,var(--vw-border,rgba(255,255,255,.04)) 75%);background-size:300% 100%;animation:ani-shim 1.5s infinite linear;}
      @keyframes ani-shim{0%{background-position:300% 0}100%{background-position:-300% 0}}
      .ani-error{color:rgba(255,100,100,.75);font-family:"Kanit",sans-serif;font-size:.85rem;text-align:center;padding:24px;grid-column:1/-1;}
      #anikoto-pager{display:flex;align-items:center;justify-content:center;gap:16px;padding:6px 0 26px;}
      #anikoto-pager button{background:var(--vw-chip-bg,rgba(255,255,255,.08));border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));color:var(--vw-text,#eaeaea);font-family:"Kanit",sans-serif;font-size:.8rem;font-weight:400;letter-spacing:.04em;padding:7px 18px;border-radius:99px;cursor:pointer;transition:background .18s ease,border-color .18s ease,opacity .15s;}
      #anikoto-pager button:hover:not(:disabled){background:var(--vw-hover-strong,rgba(255,255,255,.14));border-color:var(--vw-active-border,rgba(255,255,255,.2));}
      #anikoto-pager button:disabled{opacity:.35;cursor:default;}
      #anikoto-page-label{color:var(--vw-muted,rgba(255,255,255,.5));font-family:"Kanit",sans-serif;font-size:.75rem;letter-spacing:.08em;min-width:90px;text-align:center;}
      @media(max-width:768px){#anikoto-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;}.ani-badge{font-size:.5rem;padding:1px 4px;}}
    `;
    document.head.appendChild(s);
  }

  // ── Init ──────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      injectCSS();
      if (!buildDOM()) return;
      watchVisibility();
      updateVis();
      loadPage(1);
      // Build the search index in the background (cached ~24h).
      setTimeout(buildCatalog, 2000);
    }, 300);
  });
})();