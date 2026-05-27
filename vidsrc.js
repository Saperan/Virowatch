(function () {
  "use strict";

  const BASE_URL = "https://vidsrc.me/movies/latest/page-";
  const TIMEOUT  = 10000;

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
      build: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      parse: r => r.json(),
    },
  ];

  let winProxy = null;

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

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
  let bgLoading  = false;
  let cache      = [];
  let iObs       = null;
  let searchTid  = null;

  // ── Poster Lazy-loading Observer ──────────────────────────────────
  const posterObserver = new IntersectionObserver((entries) => {
    entries.forEach(async entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        posterObserver.unobserve(img);
        const card = img.closest('.vidsrc-card');
        const imdbId = card?.dataset.vsrcId;
        if (!imdbId || img.dataset.loaded) return;
        
        try {
          const data = await apiFetch(`https://v3.sg.media-imdb.com/suggestion/x/${imdbId}.json`);
          const match = data?.d?.find(i => i.id === imdbId);
          if (match && match.i && match.i.imageUrl) {
            img.src = match.i.imageUrl;
            img.dataset.loaded = "true";
            const cachedItem = cache.find(c => c.imdb_id === imdbId);
            if (cachedItem) cachedItem.poster = match.i.imageUrl;
          }
        } catch(err) {}
      }
    });
  }, { rootMargin: "300px" });

  // ── Inject series into window.mediaData.lunora ─────────────────────
  function injectEntry(id, title, embedUrl) {
    window.mediaData             = window.mediaData || {};
    window.mediaData.lunora      = window.mediaData.lunora || {};
    window.mediaData.lunora[`VIDSRC_${id}`] = {
      title   : title,
      image   : `https://via.placeholder.com/300x450/111111/ffffff?text=${encodeURIComponent(title)}`,
      _hidden : true,
      VIDSRC_S1: {
        chapter       : "Movie",
        video         : [embedUrl],
        episodeTitles : [title],
      }
    };
  }

  // ── Hover-prefetch (mocked since we don't have secondary API) ──────
  async function prefetchSeries(item) {
    if (window.mediaData?.lunora?.[`VIDSRC_${item.imdb_id}`]) return;
    injectEntry(item.imdb_id, item.title, item.embed_url);
  }

  // ── Card click ────────────────────────────────────────────────────
  async function onCardClick(card, item) {
    const key = `VIDSRC_${item.imdb_id}`;
    if (!window.mediaData?.lunora?.[key]) {
      injectEntry(item.imdb_id, item.title, item.embed_url);
    }
    window.viroPlay?.("lunora", key);
  }

  // ── Card element ──────────────────────────────────────────────────
  function makeCard(item) {
    const card = document.createElement("div");
    card.className       = "movie-item vidsrc-card";
    card.dataset.vsrcId  = String(item.imdb_id);

    const img  = document.createElement("img");
    if (item.poster) {
      img.src = item.poster;
      img.dataset.loaded = "true";
    } else {
      img.src = `https://via.placeholder.com/300x450/111111/ffffff?text=${encodeURIComponent(item.title)}`;
      posterObserver.observe(img);
    }
    img.alt     = "";
    img.loading = "lazy";

    const p = document.createElement("p");
    p.className   = "kanit-extralight";
    p.textContent = item.title || "";

    const badge = document.createElement("span");
    badge.className   = "vidsrc-badge";
    badge.textContent = item.quality || "HD";

    card.appendChild(img);
    card.appendChild(p);
    card.appendChild(badge);

    card.addEventListener("click",      () => onCardClick(card, item));
    card.addEventListener("mouseenter", () => prefetchSeries(item), { passive: true });
    return card;
  }

  // ── Skeletons ─────────────────────────────────────────────────────
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

  // ── Load page (visible grid) ──────────────────────────────────────
  async function loadPage(n) {
    if (fetching) return;
    fetching = true;
    addSkeletons(8);

    const data = await apiFetch(`${BASE_URL}${n}.json`);
    clearSkeletons();
    fetching = false;

    if (!data || !data.result) {
      if (n === 1) {
        const grid = document.getElementById("vidsrc-grid");
        if (grid) {
          const msg = document.createElement("p");
          msg.className   = "vidsrc-error";
          msg.textContent = "Could not load streaming movies — check connection.";
          grid.appendChild(msg);
        }
      }
      return;
    }

    page       = n;
    totalPages = data.pages || 1;

    const items = data.result || [];
    cache = cache.concat(items);

    const grid = document.getElementById("vidsrc-grid");
    if (grid) items.forEach(item => grid.appendChild(makeCard(item)));

    armObserver();

    if (n === 1 && !bgLoading) bgPreload();
  }

  // ── Background preload (for search) ──────────────────────────────
  async function bgPreload() {
    bgLoading = true;
    let p = 2;
    while (p <= totalPages && p < 100) { // Limit to 100 pages to avoid overwhelming
      const batch = [];
      for (let i = 0; i < 4 && p <= totalPages && p < 100; i++, p++) {
        batch.push(apiFetch(`${BASE_URL}${p}.json`));
      }
      const results = await Promise.all(batch);
      for (const data of results) {
        if (!data || !data.result) continue;
        const items = data.result || [];
        const existingIds = new Set(cache.map(a => a.imdb_id));
        const fresh = items.filter(a => !existingIds.has(a.imdb_id));
        cache = cache.concat(fresh);
        if (data.pages) totalPages = data.pages;
      }
      await sleep(300);
    }
    bgLoading = false;
  }

  // ── Infinite scroll ───────────────────────────────────────────────
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

  // ── Show / hide VidSrc section ────────────────────────────────────
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

  // ── Search ────────────────────────────────────────────────────────
  function cleanSearchCards() {
    document.getElementById("movieList")
      ?.querySelectorAll(".vidsrc-card, .vidsrc-search-sep")
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

  async function doSearch(q) {
    cleanSearchCards();
    if (!q || q.length < 2) return;

    const ml = document.getElementById("movieList");
    if (!ml) return;

    function insertMixed(card) {
      const nativeCards = Array.from(ml.children).filter(c => !c.classList.contains('ani-card') && !c.classList.contains('vidsrc-card') && !c.className.includes('search-sep'));
      const mixedCards = Array.from(ml.children).filter(c => c.classList.contains('ani-card') || c.classList.contains('vidsrc-card'));
      const targetIndex = Math.min(mixedCards.length * 2, nativeCards.length + mixedCards.length);
      ml.insertBefore(card, ml.children[targetIndex] || null);
    }

    const localHits = cache.filter(a => fuzzyMatch(a.title, q));
    
    if (localHits.length > 0) {
      localHits.slice(0, 8).forEach(a => {
        if (!ml.querySelector(`[data-vsrc-id="${a.imdb_id}"]`)) {
          insertMixed(makeCard(a));
        }
      });
    }

    try {
      const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json`;
      const data = await apiFetch(imdbUrl);

      if (data && data.d) {
        const imdbHits = data.d.filter(item => item.qid === "movie" || item.qid === "tvSeries" || item.qid === "tvMiniSeries");
        imdbHits.slice(0, 12).forEach(item => {
          if (!ml.querySelector(`[data-vsrc-id="${item.id}"]`)) {
            const isMovie = item.qid === "movie";
            const pseudoItem = {
              imdb_id: item.id,
              title: item.l + (item.y ? ` (${item.y})` : ""),
              poster: item.i?.imageUrl || "",
              embed_url: isMovie ? `https://vidsrc.me/embed/movie?imdb=${item.id}` : `https://vidsrc.me/embed/tv?imdb=${item.id}`,
              quality: isMovie ? "MOVIE" : "SHOW"
            };
            insertMixed(makeCard(pseudoItem));
          }
        });
      }
    } catch (err) {}
  }

  function hookSearch() {
    const input = document.getElementById("searchInput");
    if (!input) return;
    input.addEventListener("input", async (e) => {
      if (window._vwlCurrentCat === "lunora" || window._vwlCurrentCat === "anime" || window._vwlCurrentCat === "shows" || !window._vwlCurrentCat) {
        clearTimeout(searchTid);
        const q = e.target.value.trim();
        
        if (/^tt\d{5,}$/.test(q)) {
          const imdbId = q;
          input.value = "";
          input.dispatchEvent(new Event("input"));
          input.blur();
          
          let title = "IMDB Stream";
          let embed = `https://vidsrc.me/embed/movie?imdb=${imdbId}`;
          
          try {
            const data = await apiFetch(`https://v3.sg.media-imdb.com/suggestion/x/${imdbId}.json`);
            const item = data?.d?.find(i => i.id === imdbId);
            if (item) {
              title = item.l + (item.y ? ` (${item.y})` : "");
              if (item.qid !== "movie") embed = `https://vidsrc.me/embed/tv?imdb=${imdbId}`;
            }
          } catch(err) {}

          injectEntry(imdbId, title, embed);
          window.viroPlay?.("lunora", `VIDSRC_${imdbId}`);
          return;
        }

        searchTid = setTimeout(() => {
          if (q.length < 2) {
            cleanSearchCards();
          } else {
            doSearch(q);
          }
        }, 360);
      }
    });
  }

  // ── Build DOM ─────────────────────────────────────────────────────
  function buildDOM() {
    const wrapper = document.getElementById("movieListWrapper");
    if (!wrapper) return false;

    const sep = document.createElement("div");
    sep.id            = "vidsrc-sep";
    sep.style.display = "none";
    sep.innerHTML     = '<div class="vidsrc-sep-line"></div><span class="vidsrc-sep-label">Streaming Movies · VidSrc</span><div class="vidsrc-sep-line"></div>';

    const sec = document.createElement("div");
    sec.id            = "vidsrc-section";
    sec.style.display = "none";

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

  // ── CSS ───────────────────────────────────────────────────────────
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
      .vidsrc-badge{position:absolute;top:6px;left:6px;background:rgba(239,68,68,.88);color:#fff;font-family:"Kanit",sans-serif;font-size:.55rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 6px;border-radius:3px;pointer-events:none;z-index:2;backdrop-filter:blur(4px);}
      .vidsrc-card{position:relative;cursor:pointer;overflow:hidden;border-radius:12px;transition:transform 0.2s,box-shadow 0.2s;}
      .vidsrc-card:hover{transform:translateY(-4px);box-shadow:0 8px 16px rgba(0,0,0,0.5);}
      .vidsrc-card img{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:12px;}
      .vidsrc-card p{position:absolute;bottom:0;left:0;right:0;margin:0;padding:30px 10px 10px;background:linear-gradient(transparent,rgba(0,0,0,0.9));color:#fff;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .vidsrc-card.vidsrc-loading{opacity:.5;pointer-events:none;}
      .vidsrc-skeleton{aspect-ratio:2/3;border-radius:12px;background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 75%);background-size:300% 100%;animation:vidsrc-shim 1.5s infinite linear;}
      @keyframes vidsrc-shim{0%{background-position:300% 0}100%{background-position:-300% 0}}
      .vidsrc-error{color:rgba(255,100,100,.75);font-family:"Kanit",sans-serif;font-size:.85rem;text-align:center;padding:24px;grid-column:1/-1;}
      @media(max-width:768px){#vidsrc-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;}.vidsrc-badge{font-size:.5rem;padding:1px 4px;} .vidsrc-card p{font-size:0.75rem;}}
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
      hookSearch();
      loadPage(1);
    }, 400);
  });
})();
