/**
 * vidnest-loader.js  —  Virowatch × Vidnest  v3.0
 *
 * Vidnest's own page embeds an ad/age-gate overlay baked into its iframe
 * content — cross-origin, so no parent-frame JS/CSS can touch it, and
 * sandboxing the iframe to block it makes Vidnest refuse to play at all
 * (it runs its own sandbox-detection probe, see the "Please Disable
 * Sandbox" check in their client JS). So instead: never render Vidnest's
 * page at all. Its own client JS calls a resolver at new.vidnest.fun that
 * returns the real stream URL(s) wrapped in a fake "encryption" — it's
 * actually just base64 with a substitution alphabet, the alphabet is a
 * public constant shipped in their own JS bundle, not a secret. We do the
 * same fetch + decode ourselves (CORS is wide open on new.vidnest.fun) and
 * hand the real URL straight to a <video> element. Movies/shows resolve to
 * a direct, unrestricted .mp4 (no Referer needed). Anime resolves to an
 * .m3u8 on the same cdn.mewstream.buzz CDN Anikoto's MegaPlay already
 * uses — which IS Referer-gated — so that one gets proxied through the
 * existing megaplay-worker.js Cloudflare Worker (`/hls?u=`) unchanged.
 *
 * Movies + TV Shows: Vidnest is the *only* source Virowatch has for these,
 * so it gets its own browse+search catalog here, backed by TMDB (real
 * search/trending endpoints, CORS-open, no proxy needed).
 *
 * Anime: Anikoto is already the anime source, so Vidnest is merged into
 * that flow instead of duplicating a second anime catalog — playing an
 * Anikoto title shows a "Vidnest API" button (next to megaplay-backup.js's
 * "Cloudflare API" button) that resolves the same episode via Vidnest
 * (AniList id from anikoto-loader.js's anikotoGetAniListId()) and plays it
 * through hls.js, same as the movies/shows path below.
 *
 * Movies/shows entries are injected into window.mediaData on demand (same
 * trick as anikoto-loader.js's injectEntry) with a VD-prefixed key so
 * content.js's existing player/continue-watching/watchlist code just works:
 *   VDM_<tmdbId> → mediaData.movies (this bucket is otherwise unused —
 *                   unlike "lunora" it's never wholesale-replaced, so it's
 *                   safe to inject into permanently)
 *   VDT_<tmdbId> → mediaData.shows
 * The stored "video" URL is still a vidnest.fun page URL (keeps state/
 * continue-watching serialization simple) — vidnestDirectPlayer() below
 * intercepts it before the iframe ever loads it and swaps in the resolved
 * stream instead.
 */
(function () {
  "use strict";

  const TMDB_KEY = "77d678406118b130512ab8affd953fa9";
  const TMDB = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/w342";
  const VIDNEST = "https://vidnest.fun";

  function toast(msg) {
    let t = document.getElementById("vwl-toast");
    if (!t) { t = document.createElement("div"); t.id = "vwl-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.className = "vwl-show";
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.className = ""; }, 2600);
  }

  // Same ranking formula content.js/anikoto-loader.js use, so merged search
  // results sort consistently regardless of source.
  function scoreTitle(title, q) {
    const t = (title || "").toLowerCase();
    if (!t || !q) return 0;
    if (t === q) return 1000;
    if (t.startsWith(q)) return 600 - Math.min(200, t.length);
    if (t.includes(q)) return 400 - Math.min(200, t.length);
    let j = 0;
    for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) j++;
    return j === q.length ? 120 - Math.min(100, t.length) : 0;
  }

  async function tmdbJson(path, params) {
    const qs = new URLSearchParams({ api_key: TMDB_KEY, ...(params || {}) });
    try {
      const r = await fetch(`${TMDB}${path}?${qs}`);
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }
  // hover-info.js uses this for movie/TV metadata (overview, genres, backdrop)
  window.vidnestTmdb = tmdbJson;

  // ── Vidnest's resolver (new.vidnest.fun) + fake "encryption" ──────
  // The alphabet below is copied verbatim from Vidnest's own client JS
  // (decryptCipherResponse() in one of their _next/static chunks) — it's a
  // public constant they ship to every browser, not a secret we cracked.
  // "Encrypted" data is just base64 decoded against this alphabet instead
  // of the standard one.
  const VIDNEST_ALPHABET = "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";

  function vidnestB64Decode(str, alphabet) {
    const table = {};
    for (let i = 0; i < alphabet.length; i++) table[alphabet[i]] = i;
    const bytes = [];
    for (let i = 0; i < str.length; i += 4) {
      let chunk = str.slice(i, i + 4);
      while (chunk.length < 4) chunk += "=";
      const vals = [];
      for (let j = 0; j < 4; j++) {
        const v = table[chunk[j]];
        vals.push(v !== undefined ? v : 64);
      }
      bytes.push((vals[0] << 2) | (vals[1] >> 4));
      if (vals[2] !== 64) bytes.push(((vals[1] & 15) << 4) | (vals[2] >> 2));
      if (vals[3] !== 64) bytes.push(((vals[2] & 3) << 6) | vals[3]);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  function decodeVidnestPayload(json) {
    if (!json || !json.encrypted) return json;
    if (!json.data || typeof json.data !== "string") return null;
    const decoded = vidnestB64Decode(json.data, VIDNEST_ALPHABET);
    try { return JSON.parse(decoded); } catch (_) { return decoded; }
  }

  // NOTE: a failed resolve often shows up in the console as a CORS error —
  // vidnest's error responses (502 = title not on their moviebox backend)
  // carry no Access-Control-Allow-Origin header, so the browser blames CORS.
  // Successful responses send ACAO:* (even for file://'s "null" origin,
  // verified 2026-07-09), so there is nothing to proxy around here; the
  // embed fallback in vidnestAutoPlay covers missing titles.
  async function vidnestApiFetch(path) {
    try {
      const r = await fetch(`https://new.vidnest.fun${path}`);
      if (!r.ok) return null;
      return decodeVidnestPayload(await r.json());
    } catch (_) { return null; }
  }

  const RES_ORDER = { "1080p": 4, "720p": 3, "480p": 2, "360p": 1 };
  function bestFirst(list) {
    return [...list].sort((a, b) => (RES_ORDER[b.resolution] || 0) - (RES_ORDER[a.resolution] || 0));
  }

  // Second-chance source when moviebox 502s (title not on that backend):
  // hollymoviehd decodes to {streams:[{type:'mp4'|'hls',url,language}]} —
  // its mp4 links play plain (206 without Referer/CORS, verified 2026-07-09).
  // Mapped into moviebox's {link,resolution} shape so playDirect just works.
  async function resolveHollyFallback(pathTail) {
    const data = await vidnestApiFetch(`/hollymoviehd/${pathTail}`);
    const mp4s = (data?.streams || []).filter((s) => s.type === "mp4" && s.url);
    if (!mp4s.length) return null;
    // MAIN = original audio track; dubbed variants sort after it
    mp4s.sort((a, b) => (b.language === "MAIN") - (a.language === "MAIN"));
    return mp4s.map((s) => ({
      link: s.url,
      resolution: s.language === "MAIN" ? "Auto" : s.language,
    }));
  }

  // Resolves to a direct, unrestricted .mp4 — plays in a plain <video src>.
  async function resolveVidnestMovie(tmdbId) {
    const data = await vidnestApiFetch(`/moviebox/movie/${tmdbId}`);
    const list = data && Array.isArray(data.url) ? data.url : null;
    if (list && list.length) return bestFirst(list);
    return resolveHollyFallback(`movie/${tmdbId}`);
  }
  async function resolveVidnestTv(tmdbId, season, episode) {
    const data = await vidnestApiFetch(`/moviebox/tv/${tmdbId}/${season}/${episode}`);
    const list = data && Array.isArray(data.url) ? data.url : null;
    if (list && list.length) return bestFirst(list);
    return resolveHollyFallback(`tv/${tmdbId}/${season}/${episode}`);
  }
  // Resolves to an .m3u8 on cdn.mewstream.buzz — Referer-gated, needs the
  // Cloudflare Worker proxy (same one megaplay-backup.js uses for Anikoto).
  async function resolveVidnestAnime(anilistId, episode, subOrDub) {
    const data = await vidnestApiFetch(`/hianime/anime/${anilistId}/${episode}/${subOrDub}`);
    const file = data?.sources?.[0]?.file;
    if (!file) return null;
    return { file, tracks: Array.isArray(data.tracks) ? data.tracks : [] };
  }

  // Cloudflare Worker (same one anikoto-loader/megaplay-backup use) — proxies
  // the subtitle listing so we get CORS on every status code.
  const SUB_WORKER = "https://anikoto-request.vmtgaming13.workers.dev";

  // Movies/shows subtitles come from a separate, unencrypted endpoint. It
  // sends `Access-Control-Allow-Origin: *` on a hit, but NOT on its 404
  // "no subtitles found" response — so a direct fetch throws a noisy
  // CORS/ERR_FAILED whenever an episode has no subs. Route through the Worker
  // first (it adds CORS on every status); fall back to a direct fetch only if
  // the Worker is unreachable. The .vtt files themselves (cache.vdrk.site)
  // are already CORS-open, so those load into <track> untouched.
  async function resolveVidnestSubtitles(tmdbId, season, episode) {
    const path = season != null && episode != null
      ? `/v2/tv/${tmdbId}/${season}/${episode}`
      : `/v2/movie/${tmdbId}`;
    const target = `https://sub.vdrk.site${path}`;
    const parse = (data) =>
      Array.isArray(data)
        ? data
            .filter((t) => t && t.file)
            .map((t) => ({ label: t.label || "Subtitle", file: t.file }))
        : [];

    try {
      const r = await fetch(`${SUB_WORKER}/api?u=${encodeURIComponent(target)}`);
      if (r.status === 404) return [];      // clean "no subtitles" — done
      if (r.ok) return parse(await r.json());
      // Any other status (e.g. Worker not yet redeployed → 403 host not
      // allowed) falls through to the direct attempt below.
    } catch (_) { /* Worker unreachable — try direct */ }

    try {
      const r = await fetch(target);
      if (!r.ok) return [];
      return parse(await r.json());
    } catch (_) { return []; }
  }

  // ── Bucket + embed URL helpers ────────────────────────────────────
  function bucketFor(key) {
    if (key.indexOf("VDM_") === 0) return "movies";
    if (key.indexOf("VDT_") === 0) return "shows";
    return null;
  }
  const movieEmbed = (id) => `${VIDNEST}/movie/${id}`;
  const tvEmbed = (id, s, e) => `${VIDNEST}/tv/${id}/${s}/${e}`;

  // ── Inject-on-demand (mirrors anikoto-loader.js's injectEntry) ────
  async function injectMovie(id) {
    const key = "VDM_" + id;
    window.mediaData.movies = window.mediaData.movies || {};
    if (window.mediaData.movies[key]) return key;
    const d = await tmdbJson(`/movie/${id}`, {});
    if (!d || !d.id) return null;
    window.mediaData.movies[key] = {
      title: d.title || d.original_title || key,
      image: d.poster_path ? IMG + d.poster_path : "",
      _hidden: true,
      video: [movieEmbed(id)],
      episodeTitles: ["Full Movie"],
    };
    return key;
  }

  async function injectShow(id) {
    const key = "VDT_" + id;
    window.mediaData.shows = window.mediaData.shows || {};
    if (window.mediaData.shows[key]) return key;
    const d = await tmdbJson(`/tv/${id}`, {});
    if (!d || !d.id) return null;
    const entry = {
      title: d.name || d.original_name || key,
      image: d.poster_path ? IMG + d.poster_path : "",
      _hidden: true,
    };
    const seasons = (d.seasons || []).filter((s) => s.episode_count > 0);
    if (!seasons.length) return null;
    seasons.forEach((s) => {
      const n = s.season_number;
      entry["S" + n] = {
        chapter: s.name || ("Season " + n),
        video: Array.from({ length: s.episode_count }, (_, i) => tvEmbed(id, n, i + 1)),
      };
    });
    window.mediaData.shows[key] = entry;
    return key;
  }

  // ── Unified play entrypoint — resolves + injects, then hands off ──
  // to viroPlay (content.js). Reused by browse cards, search results,
  // watchlist, and continue-watching resume. Movies/shows only — anime
  // plays through the Anikoto flow (see the merge button below).
  async function openVidnestById(key, statusCb) {
    const cat = bucketFor(key);
    if (!cat) return false;
    const say = (s) => { if (statusCb) statusCb(s); };
    if (!window.mediaData?.[cat]?.[key]) {
      say("loading");
      const id = key.slice(4);
      let ok = null;
      try {
        ok = cat === "movies" ? await injectMovie(id) : await injectShow(id);
      } catch (_) { ok = null; }
      if (!ok) { say("error"); toast("Could not load from Vidnest — check connection"); return false; }
    }
    say("ready");
    await window.viroPlay?.(cat, key);
    return true;
  }
  window.openVidnestById = openVidnestById;

  // ── IMDB id ("tt1234567") → TMDB find → play ──────────────────────
  // content.js calls this when a pasted search query looks like an IMDB
  // id. Movies and TV (incl. anime series — they live in TMDB's tv
  // bucket) resolve; returns false when TMDB knows nothing.
  window.vidnestOpenByImdb = async function (imdbId) {
    const d = await tmdbJson(`/find/${imdbId}`, { external_source: "imdb_id" });
    const movie = d?.movie_results?.[0];
    if (movie?.id) return openVidnestById("VDM_" + movie.id);
    const tv = d?.tv_results?.[0];
    if (tv?.id) return openVidnestById("VDT_" + tv.id);
    return false;
  };

  // ── Search (folded into content.js's unified search bar) ──────────
  window.vidnestSearch = async function (query) {
    const q = (query || "").trim();
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    const out = [];
    const [movRes, tvRes] = await Promise.all([
      tmdbJson("/search/movie", { query: q }),
      tmdbJson("/search/tv", { query: q }),
    ]);

    (movRes?.results || []).slice(0, 8).forEach((r) => {
      const title = r.title || r.original_title || "";
      const s = scoreTitle(title, ql);
      if (s <= 0) return;
      const key = "VDM_" + r.id;
      out.push({
        score: s, title, catKey: "movies", key,
        img: r.poster_path ? IMG + r.poster_path : "",
        open: () => openVidnestById(key),
      });
    });
    (tvRes?.results || []).slice(0, 8).forEach((r) => {
      const title = r.name || r.original_name || "";
      const s = scoreTitle(title, ql);
      if (s <= 0) return;
      const key = "VDT_" + r.id;
      out.push({
        score: s, title, catKey: "shows", key,
        img: r.poster_path ? IMG + r.poster_path : "",
        open: () => openVidnestById(key),
      });
    });
    return out;
  };

  // ── Browse sections (Movies/lunora tab + TV Shows tab) ────────────
  // Same skeleton/pager pattern as anikoto-loader.js's anime section.
  const sections = {};

  function makeSection(cfg) {
    // cfg: { id, tabCat, mediaCat, label, fetchPage(n) }
    const state = { page: 1, totalPages: 1, fetching: false };
    sections[cfg.id] = state;

    function grid() { return document.getElementById(`vidnest-${cfg.id}-grid`); }
    function pagerLabel() { return document.getElementById(`vidnest-${cfg.id}-page-label`); }
    function prevBtn() { return document.getElementById(`vidnest-${cfg.id}-prev`); }
    function nextBtn() { return document.getElementById(`vidnest-${cfg.id}-next`); }

    function updatePager() {
      const p = prevBtn(), n = nextBtn(), l = pagerLabel();
      if (p) p.disabled = state.fetching || state.page <= 1;
      if (n) n.disabled = state.fetching || state.page >= state.totalPages;
      if (l) l.textContent = state.fetching ? "Loading…" : `Page ${state.page} / ${state.totalPages}`;
    }

    function card(item) {
      const c = document.createElement("div");
      c.className = "movie-item vidnest-card";
      c.dataset.movie = item.key;
      c.dataset.cat = cfg.mediaCat;
      const img = document.createElement("img");
      img.src = item.poster || ""; img.alt = ""; img.loading = "lazy";
      const p = document.createElement("p");
      p.className = "kanit-extralight"; p.textContent = item.title || "";
      const badge = document.createElement("span");
      badge.className = "vidnest-badge"; badge.textContent = "VIDNEST";
      c.appendChild(img); c.appendChild(p); c.appendChild(badge);
      c.addEventListener("click", async () => {
        c.classList.add("vidnest-loading");
        await openVidnestById(item.key);
        c.classList.remove("vidnest-loading");
      });
      return c;
    }

    async function loadPage(n) {
      if (state.fetching || n < 1) return;
      state.fetching = true;
      updatePager();
      const g = grid();
      if (g) g.innerHTML = "";
      const items = await cfg.fetchPage(n);
      state.fetching = false;
      if (!items) {
        if (g) g.innerHTML = '<p class="vidnest-error">Could not load Vidnest catalog — check connection.</p>';
        updatePager();
        return;
      }
      state.page = n;
      state.totalPages = items.totalPages || 1;
      if (g) items.list.forEach((it) => g.appendChild(card(it)));
      updatePager();
    }

    function isVisible() { return window._vwlCurrentCat === cfg.tabCat; }
    function updateVis() {
      const show = isVisible();
      const sep = document.getElementById(`vidnest-${cfg.id}-sep`);
      const sec = document.getElementById(`vidnest-${cfg.id}-section`);
      if (sep) sep.style.display = show ? "" : "none";
      if (sec) sec.style.display = show ? "" : "none";
      if (show && state.page === 1 && !grid()?.children.length && !state.fetching) loadPage(1);
    }

    function buildDOM() {
      const wrapper = document.getElementById("movieListWrapper");
      if (!wrapper) return;
      const sep = document.createElement("div");
      sep.id = `vidnest-${cfg.id}-sep`;
      sep.className = "vidnest-sep";
      sep.style.display = "none";
      sep.innerHTML = `<div class="vidnest-sep-line"></div><span class="vidnest-sep-label">${cfg.label} · Vidnest</span><div class="vidnest-sep-line"></div>`;

      const sec = document.createElement("div");
      sec.id = `vidnest-${cfg.id}-section`;
      sec.style.display = "none";

      const g = document.createElement("div");
      g.id = `vidnest-${cfg.id}-grid`;
      g.className = "vidnest-grid";

      const pager = document.createElement("div");
      pager.className = "vidnest-pager";
      const prev = document.createElement("button");
      prev.id = `vidnest-${cfg.id}-prev`; prev.type = "button"; prev.textContent = "‹ Prev"; prev.disabled = true;
      const label = document.createElement("span");
      label.id = `vidnest-${cfg.id}-page-label`; label.textContent = "Page 1 / 1";
      const next = document.createElement("button");
      next.id = `vidnest-${cfg.id}-next`; next.type = "button"; next.textContent = "Next ›"; next.disabled = true;

      prev.addEventListener("click", () => { loadPage(state.page - 1); sec.scrollIntoView({ behavior: "smooth", block: "start" }); });
      next.addEventListener("click", () => { loadPage(state.page + 1); sec.scrollIntoView({ behavior: "smooth", block: "start" }); });

      pager.appendChild(prev); pager.appendChild(label); pager.appendChild(next);
      sec.appendChild(g); sec.appendChild(pager);
      wrapper.insertAdjacentElement("afterend", sec);
      wrapper.insertAdjacentElement("afterend", sep);
    }

    function watchVisibility() {
      const w = document.getElementById("movieListWrapper");
      const nb = document.getElementById("categoryNavBar");
      const ml = document.getElementById("movieList");
      const mo = new MutationObserver(updateVis);
      if (w) mo.observe(w, { attributes: true, attributeFilter: ["style"] });
      if (nb) mo.observe(nb, { attributes: true, subtree: true, attributeFilter: ["style", "class"] });
      if (ml) mo.observe(ml, { childList: true });
    }

    buildDOM();
    watchVisibility();
    updateVis();
  }

  function movieSection() {
    makeSection({
      id: "movies", tabCat: "lunora", mediaCat: "movies", label: "Movies",
      fetchPage: async (n) => {
        const d = await tmdbJson("/trending/movie/week", { page: n });
        if (!d) return null;
        return {
          totalPages: d.total_pages || 1,
          list: (d.results || []).map((r) => ({
            key: "VDM_" + r.id, title: r.title || r.original_title || "",
            poster: r.poster_path ? IMG + r.poster_path : "",
          })),
        };
      },
    });
  }
  function showSection() {
    makeSection({
      id: "shows", tabCat: "shows", mediaCat: "shows", label: "TV Shows",
      fetchPage: async (n) => {
        const d = await tmdbJson("/trending/tv/week", { page: n });
        if (!d) return null;
        return {
          totalPages: d.total_pages || 1,
          list: (d.results || []).map((r) => ({
            key: "VDT_" + r.id, title: r.name || r.original_name || "",
            poster: r.poster_path ? IMG + r.poster_path : "",
          })),
        };
      },
    });
  }

  // ── Shared <video> player — used by both the automatic movies/shows
  // direct-play (below) and the anime "Vidnest API" button. Independent of
  // megaplay-backup.js's own backup <video>/hls.js instance so the two
  // never fight over state. Mirrors megaplay-backup.js's feature set
  // (quality picker, download, subtitle download) using the pure helpers
  // it exports via window.vwHlsUtils instead of duplicating them.
  const vidnestPlayer = (function () {
    const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
    let video = null;
    let hls = null;
    let hlsLoading = null;
    let mode = null; // "direct" | "hls" | null
    let directSources = []; // [{link,resolution,type}] — movies/shows quality options
    let hlsMasterUrl = null; // worker-proxied master playlist — anime download
    let captionTracks = [];
    let playerUI = null; // window.VWPlayerUI.attach() result — the custom control bar

    function iframeEl() { return document.getElementById("videoPlayer"); }
    function spinnerEl() { return document.getElementById("videoSpinner"); }
    function frameEl() { return document.getElementById("vidnestFrame"); }

    function ensureVideo() {
      if (video) return video;
      const iframe = iframeEl();
      if (!iframe || !iframe.parentNode) return null;

      // A dedicated positioning wrapper around just the video — .player is a
      // flex column that also holds .player-controls (Prev/Next) below the
      // video, so anchoring the control bar's `inset:0` to .player itself
      // would stretch it down past the video into that row.
      const frame = document.createElement("div");
      frame.id = "vidnestFrame";
      frame.style.cssText = "flex:1;width:100%;min-width:0;min-height:200px;position:relative;display:none;";

      video = document.createElement("video");
      video.id = "vidnestDirectPlayer";
      video.playsInline = true;
      video.autoplay = true;
      // No crossOrigin here — the movies/shows CDN (bcdn.hakunaymatata.com)
      // sends no CORS headers at all. Plain <video src> playback doesn't
      // need CORS and works fine without it; setting crossOrigin forces the
      // browser to CORS-check the request anyway, which then fails outright
      // ("blocked by CORS policy", origin 'null'). playHls() below opts
      // back in for the anime path, which does need it (subtitle tracks,
      // and the CDN there is our own Worker, which does send CORS headers).
      video.style.cssText = "width:100%;height:100%;display:block;background:#000;border:0;";
      frame.appendChild(video);
      iframe.parentNode.insertBefore(frame, iframe.nextSibling);

      if (window.VWPlayerUI) {
        playerUI = window.VWPlayerUI.attach(video, frame);
        playerUI.setDownloadHandler(downloadVideoHandler);
      }
      return video;
    }

    function fileBase() {
      const t = document.getElementById("nowPlayingTitle");
      const ep = document.querySelector(".episode.active");
      const base = (t && t.textContent ? t.textContent : "video").trim();
      const epn = (ep && ep.textContent ? ep.textContent : "").trim();
      const name = [base, epn].filter(Boolean).join(" - ") || "video";
      return name.replace(/[\\/:*?"<>|]+/g, "_");
    }

    // Subtitle track creation (incl. the file://-blob-url workaround) and
    // the Subtitles/Download-subtitles menu rows now live in the shared
    // player UI — this just hands it the raw {label,file} metadata.
    function addTracks(tracks) {
      captionTracks = (Array.isArray(tracks) ? tracks : []).filter((t) => t && t.file);
      if (playerUI) playerUI.setSubtitleTracks(captionTracks);
    }

    // A newer resolve/episode arrived before subtitles for the previous one
    // finished fetching — addTracksIfCurrent guards that race.
    function addTracksIfCurrent(tracks, expectedMode) {
      if (mode === expectedMode) addTracks(tracks);
    }

    function loadHls() {
      if (window.Hls) return Promise.resolve(window.Hls);
      if (hlsLoading) return hlsLoading;
      hlsLoading = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = HLS_CDN;
        s.onload = () => res(window.Hls);
        s.onerror = () => rej(new Error("hls.js failed to load"));
        document.head.appendChild(s);
      });
      return hlsLoading;
    }

    function stopHls() {
      if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
    }

    function show() {
      const f = iframeEl();
      if (f) f.style.display = "none";
      ensureVideo();
      const fr = frameEl();
      if (fr) fr.style.display = ""; // root (video's sibling inside the frame) shows along with it
    }

    function hide() {
      const f = iframeEl();
      if (f) f.style.display = "";
      const fr = frameEl();
      if (fr) fr.style.display = "none";
    }

    function stop() {
      mode = null;
      directSources = [];
      hlsMasterUrl = null;
      captionTracks = [];
      if (playerUI) playerUI.setSubtitleTracks([]);
      stopHls();
      if (video) { try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {} }
      hide();
      if (spinnerEl()) spinnerEl().style.display = "none";
    }

    // ── Movies/shows: plain, unrestricted .mp4 — one file per resolution,
    // so "quality" just means swapping video.src, no ABR involved.
    let currentDirectIdx = 0;
    function applyDirectQuality(idx) {
      const src = directSources[idx];
      if (!src || !video) return;
      currentDirectIdx = idx;
      const resumeAt = video.currentTime;
      const wasPaused = video.paused;
      video.src = src.link;
      video.addEventListener("loadedmetadata", () => {
        try { video.currentTime = resumeAt; } catch (_) {}
        if (!wasPaused) video.play().catch(() => {});
      }, { once: true });
    }
    function buildDirectQualityMenu() {
      if (!playerUI) return;
      const options = directSources.map((src, i) => ({ value: String(i), label: src.resolution || `Option ${i + 1}` }));
      playerUI.setQualityOptions(options, "0", (val) => applyDirectQuality(Number(val)));
    }

    function playDirect(sources) {
      const v = ensureVideo();
      if (!v) return;
      mode = "direct";
      directSources = sources;
      currentDirectIdx = 0;
      captionTracks = [];
      v.removeAttribute("crossorigin"); // reset in case the anime path used this element last
      stopHls();
      show();
      if (spinnerEl()) spinnerEl().style.display = "block";
      v.onloadeddata = () => { if (spinnerEl()) spinnerEl().style.display = "none"; };
      v.src = sources[0].link;
      v.play().catch(() => {});
      buildDirectQualityMenu();
    }

    // Subtitles for movies/shows come from a separate endpoint and resolve
    // slightly after playback starts — added in once they arrive.
    function setDirectTracks(tracks) {
      addTracksIfCurrent(tracks, "direct");
    }

    // ── Anime: Referer-gated .m3u8 (proxied) through hls.js — real ABR
    // levels, so quality picker mirrors megaplay-backup.js's approach.
    let currentHlsQuality = "auto";
    function levelIndexForCap(cap) {
      let idx = -1, best = -1;
      hls.levels.forEach((l, i) => {
        if (l.height <= cap && l.height > best) { best = l.height; idx = i; }
      });
      if (idx === -1) {
        idx = hls.levels.reduce((m, l, i, a) => (l.height < a[m].height ? i : m), 0);
      }
      return idx;
    }
    function applyHlsQuality(val) {
      currentHlsQuality = val;
      if (!hls || !hls.levels.length) return;
      if (val === "auto") { hls.autoLevelCapping = -1; hls.currentLevel = -1; return; }
      const idx = levelIndexForCap(Number(val));
      hls.autoLevelCapping = idx;
      hls.currentLevel = idx;
    }
    function buildHlsQualityMenu() {
      if (!playerUI) return;
      currentHlsQuality = "auto";
      const options = [{ value: "auto", label: "Auto" }].concat(
        [...new Set(hls.levels.map((l) => l.height))]
          .sort((a, b) => b - a)
          .map((h) => ({ value: String(h), label: h + "p" })),
      );
      playerUI.setQualityOptions(options, "auto", applyHlsQuality);
    }

    // hianime's subtitle CDN (lostproject.club, same family as the
    // cdn.mewstream.buzz video CDN) is Referer-gated too — a direct fetch()
    // gets a 403 challenge page instead of the .vtt (confirmed: worked fine
    // proxied through the same Cloudflare Worker already used for the video
    // stream, since that's a generic Referer-adding passthrough).
    function proxyTracks(tracks) {
      return (Array.isArray(tracks) ? tracks : []).map((t) => (
        t && t.file ? { ...t, file: `${ANIKOTO_WORKER}/hls?u=${encodeURIComponent(t.file)}` } : t
      ));
    }

    async function playHls(proxiedUrl, tracks) {
      const v = ensureVideo();
      if (!v) return;
      mode = "hls";
      hlsMasterUrl = proxiedUrl;
      v.crossOrigin = "anonymous"; // needed for the subtitle tracks; our Worker sends CORS headers
      stopHls();
      show();
      if (spinnerEl()) spinnerEl().style.display = "block";
      addTracks(proxyTracks(tracks));
      const Hls = await loadHls().catch(() => null);
      if (Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, startLevel: -1 });
        hls.loadSource(proxiedUrl);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (spinnerEl()) spinnerEl().style.display = "none";
          buildHlsQualityMenu();
          v.play().catch(() => {});
        });
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = proxiedUrl;
        v.addEventListener("loadedmetadata", () => {
          if (spinnerEl()) spinnerEl().style.display = "none";
          v.play().catch(() => {});
        }, { once: true });
      }
    }

    // ── Download handler passed to the shared player UI — direct mode:
    // bcdn.hakunaymatata.com sends no CORS headers at all, so fetch()-ing it
    // for a blob download is flatly impossible (confirmed: "No
    // 'Access-Control-Allow-Origin' header"). CORS only restricts
    // script-level fetch/XHR reading a response body though, not
    // browser-level navigation — a plain <a download> click isn't a fetch,
    // so it isn't subject to CORS at all, and triggers the browser's own
    // download manager directly (returning {direct:true} tells the shared UI
    // to show "↓ Started" instead of "✓ Saved", since we can't observe
    // completion). Hls mode (anime) reuses megaplay-backup.js's exported
    // segment-reassembly helpers, unaffected by any of this.
    async function downloadVideoHandler(setStatus) {
      if (mode === "direct") {
        const src = directSources[currentDirectIdx] || directSources[0];
        if (!src) throw new Error("no source");
        setStatus("Starting…");
        const a = document.createElement("a");
        a.href = src.link;
        a.download = `${fileBase()}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return { direct: true };
      }
      if (mode === "hls") {
        const utils = window.vwHlsUtils;
        if (!utils || !hlsMasterUrl) throw new Error("no source");
        const masterText = await (await fetch(hlsMasterUrl)).text();
        const childUrl = utils.pickVariant(masterText, currentHlsQuality);
        if (!childUrl) throw new Error("no variant found");
        const segUrls = utils.segUrlsFrom(await (await fetch(childUrl)).text());
        if (!segUrls.length) throw new Error("no segments");
        const blob = await utils.assembleTs(segUrls, (done, total) => setStatus(`${Math.floor((done / total) * 100)}%`));
        return { blob, filename: `${fileBase()}.ts` };
      }
      throw new Error("nothing playing");
    }

    return { playDirect, playHls, setDirectTracks, stop };
  })();

  // ── Movies/shows: automatic direct-play. Vidnest's page must NEVER
  // actually navigate in the iframe, not even for a moment — a reactive
  // MutationObserver blanking the src *after* content.js sets it was too
  // slow on a fast/cached load: the browser had already started executing
  // Vidnest's page JS (visible as a real page flicker, their ad scripts'
  // own console errors, and a stray popup-navigation attempt that just
  // happened to get blocked by Chromium's file:// origin isolation) before
  // the observer's callback (a microtask, always at least one tick late)
  // got a chance to run. That flicker/reflow was also what made the
  // quality-picker <select> act like it got dismissed by an outside click.
  //
  // Fix: intercept the `src` PROPERTY SETTER itself on this one iframe
  // element, so a vidnest.fun URL never reaches the underlying navigation
  // at all — substituted for "about:blank" synchronously, in the exact
  // same call content.js makes (`iframe.src = url`), zero gap.
  function vidnestAutoPlay() {
    const MOVIE_RE = /^https?:\/\/(www\.)?vidnest\.fun\/movie\/(\d+)/i;
    const TV_RE = /^https?:\/\/(www\.)?vidnest\.fun\/tv\/(\d+)\/(\d+)\/(\d+)/i;
    let token = 0;
    let active = false;
    let bypassOnce = false; // lets the one deliberate fallback-to-real-embed assignment through

    function iframeEl() { return document.getElementById("videoPlayer"); }

    async function handleMatch(mMovie, mTv, originalSrc) {
      const myToken = ++token;
      active = true;
      let result = null;
      try {
        result = mMovie
          ? await resolveVidnestMovie(mMovie[2])
          : await resolveVidnestTv(mTv[2], mTv[3], mTv[4]);
      } catch (_) { result = null; }
      if (myToken !== token) return; // a newer episode/title loaded (or the user left) meanwhile
      if (!result) {
        active = false;
        toast("No direct source for this title — trying Vidnest's own player (may have other servers)");
        const f = iframeEl();
        if (f) { bypassOnce = true; f.src = originalSrc; } // deliberate: real embed, ads and all
        return;
      }
      vidnestPlayer.playDirect(result);
      // Subtitles come from a separate endpoint — don't block playback on it.
      const subArgs = mMovie ? [mMovie[2]] : [mTv[2], mTv[3], mTv[4]];
      resolveVidnestSubtitles(...subArgs).then((tracks) => {
        if (myToken === token) vidnestPlayer.setDirectTracks(tracks);
      });
    }

    function handleClear() {
      token++;
      if (active) { active = false; vidnestPlayer.stop(); }
    }

    function installInterceptor() {
      const f = iframeEl();
      if (!f) return false;
      const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
      if (!desc || !desc.set || !desc.get) return false;
      Object.defineProperty(f, "src", {
        configurable: true,
        get() { return desc.get.call(f); },
        set(value) {
          if (bypassOnce) { bypassOnce = false; desc.set.call(f, value); return; }
          const mMovie = MOVIE_RE.exec(value || "");
          const mTv = !mMovie && TV_RE.exec(value || "");
          if (mMovie || mTv) {
            desc.set.call(f, "about:blank"); // the real URL never reaches navigation
            handleMatch(mMovie, mTv, value);
            return;
          }
          desc.set.call(f, value);
          if (!value) handleClear(); // resetView()'s vid.src = ""
        },
      });
      if (f.getAttribute("src")) {
        const src = f.getAttribute("src");
        const mMovie = MOVIE_RE.exec(src);
        const mTv = !mMovie && TV_RE.exec(src);
        if (mMovie || mTv) handleMatch(mMovie, mTv, src);
      }
      return true;
    }

    // Exposed for content.js's resetView() (the "← Back" handler) — belt
    // and suspenders on top of the now-synchronous interceptor above.
    function stopAll() {
      token++;
      if (active) { active = false; vidnestPlayer.stop(); }
    }

    installInterceptor();
    return { stopAll };
  }

  // ── Anime merge: "Vidnest API" button next to megaplay-backup.js's
  // "Cloudflare API" button, shown whenever the currently-playing Anikoto
  // title also has an AniList id (needed to build the Vidnest anime URL).
  // Resolves through Vidnest same as movies/shows, then plays via the
  // shared hls.js player (proxied through the existing Cloudflare Worker,
  // since this CDN is Referer-gated) — Vidnest's iframe/ads never load.
  const ANIKOTO_WORKER = "https://anikoto-request.vmtgaming13.workers.dev";
  let vidnestAnimeActive = false;
  let currentAniListId = null;
  let currentEp = 0;
  let currentDub = false;
  // Session opt-out for the "vidnest" default-API auto-switch (anime-api.js):
  // once the user manually goes back to Anikoto, stop auto-switching until
  // they re-pick Vidnest in settings (or reload).
  let vidnestOptOut = false;
  // Invalidates an in-flight resolve when a new episode loads or the user
  // clicks again — a stale resolve must not silence/steal the new episode.
  let animeSwitchToken = 0;
  window.addEventListener("vw-anime-api-changed", (e) => {
    const api = e.detail && e.detail.api;
    if (api === "vidnest") {
      vidnestOptOut = false;
      // Picked mid-episode (source picker / Settings) — switch the playing
      // episode over now, same as the default-API auto-switch does.
      if (currentAniListId && !vidnestAnimeActive) activateVidnestAnime();
    } else if (vidnestAnimeActive) {
      // Switched away from Vidnest mid-episode. Stop our player first —
      // megaplay-backup.js's listener runs after this one and restores the
      // embed / starts the Cloudflare backup on a clean slate.
      animeSwitchToken++;
      vidnestAnimeActive = false;
      vidnestPlayer.stop();
      setAnimeSwitchLabel();
    }
  });

  // Switch the currently-playing Anikoto episode over to Vidnest. Shared by
  // the manual "◆ Vidnest API" button and the default-API auto-switch.
  async function activateVidnestAnime() {
    if (!currentAniListId || vidnestAnimeActive) return;
    const token = ++animeSwitchToken;
    const b = animeSwitchBtn();
    b.textContent = "Loading…";
    window.vwSuspendAutoBackup?.(); // don't let its auto-timer fire mid-resolve
    const result = await resolveVidnestAnime(
      currentAniListId,
      currentEp + 1,
      currentDub ? "dub" : "sub",
    );
    if (token !== animeSwitchToken) return; // a newer episode/click took over
    if (!result) {
      toast("Vidnest doesn't have this episode");
      // vwSuspendAutoBackup blanked the embed's iframe — bring it back so
      // the user isn't left staring at a silent black player.
      window.vwUseEmbed?.();
      setAnimeSwitchLabel();
      return;
    }
    window.vwSuspendAutoBackup?.(); // in case it fired during the fetch above
    vidnestAnimeActive = true;
    setAnimeSwitchLabel();
    vidnestPlayer.playHls(
      `${ANIKOTO_WORKER}/hls?u=${encodeURIComponent(result.file)}`,
      result.tracks,
    );
  }

  // Exposed for megaplay-backup.js's watch-party auto-switch — don't force
  // the Cloudflare backup player when Vidnest API is already active for this
  // episode (watchparty.js's syncTarget() reads vidnestDirectPlayer too, so
  // there's no need to yank the user off it).
  window.vwVidnestAnimeActive = function () { return vidnestAnimeActive; };

  function animeSwitchBtn() {
    let b = document.getElementById("vidnestAnimeBtn");
    if (!b) {
      b = document.createElement("a");
      b.id = "vidnestAnimeBtn";
      b.href = "#";
      b.className = "button";
      b.style.display = "none";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        if (!currentAniListId) return;
        if (vidnestAnimeActive) {
          animeSwitchToken++; // cancel any in-flight activation
          vidnestAnimeActive = false;
          vidnestOptOut = true; // stop auto-switching this session
          vidnestPlayer.stop();
          window.vwUseEmbed?.(); // restore the megaplay iframe we silenced
          setAnimeSwitchLabel();
          return;
        }
        activateVidnestAnime();
      });
      // Superseded by anime-api.js's "⇄ Source" picker — never appended to
      // the DOM. Kept detached so the label/display writes stay no-ops.
    }
    return b;
  }

  function setAnimeSwitchLabel() {
    const b = animeSwitchBtn();
    if (vidnestAnimeActive) {
      b.textContent = "⟲ Use Anikoto";
      b.title = "Switch back to the Anikoto / Cloudflare stream";
    } else {
      b.textContent = "◆ Vidnest API";
      b.title = "Try the Vidnest source for this episode";
    }
  }

  window.addEventListener("vw-nowplaying", async (e) => {
    const d = (e && e.detail) || {};
    const btn = animeSwitchBtn();
    const token = ++animeSwitchToken; // cancel any in-flight activation
    // A fresh episode/season/dub change always starts back on the normal
    // Anikoto embed — content.js's updateVideo already reset iframe.src to
    // it before this event fired, so tear down any active Vidnest playback.
    if (vidnestAnimeActive) { vidnestAnimeActive = false; vidnestPlayer.stop(); }
    if (d.cat !== "anime" || typeof d.mov !== "string" || d.mov.indexOf("ANI_") !== 0) {
      currentAniListId = null;
      btn.style.display = "none";
      return;
    }
    currentEp = d.ep || 0;
    currentDub = !!d.dubbed;
    btn.style.display = "none";

    if (typeof window.anikotoGetAniListId !== "function") return;
    const anikotoId = d.mov.slice(4);
    let id = null;
    try { id = await window.anikotoGetAniListId(anikotoId); } catch (_) { id = null; }
    if (token !== animeSwitchToken) return; // a newer episode took over
    currentAniListId = id || null;
    if (currentAniListId) {
      setAnimeSwitchLabel();
      btn.style.display = "";
      // Vidnest picked as the default anime API (anime-api.js) — switch this
      // episode over automatically, unless the user manually went back to
      // Anikoto earlier this session.
      if (!vidnestOptOut && localStorage.getItem("vw_anime_api") === "vidnest") {
        activateVidnestAnime();
      }
    }
  });

  // ── Popup "vaccine" — Vidnest's embed refuses to play when sandboxed
  // (same as MegaPlay), so it has to run unsandboxed, which means its ads
  // can still call window.open(). A one-time click-shield wasn't enough —
  // the ad doesn't only fire on the very first click, it can fire on any
  // click (pause, seek, fullscreen, anywhere on the page). So instead: for
  // as long as Vidnest is the loaded source, EVERY click anywhere fires a
  // throwaway window.open("about:blank") + immediate close() in the
  // capture phase, before the click finishes reaching its real target.
  // Browsers only let one popup through per user gesture, so if the ad's
  // own script also tries to pop on that same click, it loses the race and
  // gets blocked/blank. Nothing is prevented/stopped, so real clicks (the
  // iframe's own controls, any link on the page) still work normally.
  function vidnestShield() {
    let vidnestLive = false;

    function iframeEl() { return document.getElementById("videoPlayer"); }
    function isVidnestSrc(src) { return /^https?:\/\/(www\.)?vidnest\.fun\//i.test(src || ""); }

    function vaccinate() {
      try {
        const w = window.open("about:blank", "_blank");
        if (w) w.close();
      } catch (_) {}
    }

    document.addEventListener(
      "click",
      () => { if (vidnestLive) vaccinate(); },
      true, // capture phase — runs before the click reaches its target
    );

    function watch() {
      const f = iframeEl();
      if (!f) return;
      const obs = new MutationObserver(() => {
        vidnestLive = isVidnestSrc(f.getAttribute("src"));
      });
      obs.observe(f, { attributes: true, attributeFilter: ["src"] });
      vidnestLive = isVidnestSrc(f.getAttribute("src"));
    }

    watch();
  }

  function injectCSS() {
    if (document.getElementById("vidnest-css")) return;
    const s = document.createElement("style");
    s.id = "vidnest-css";
    s.textContent = `
      .vidnest-sep{display:flex;align-items:center;gap:12px;padding:24px 0 14px;}
      .vidnest-sep-line{flex:1;height:1px;background:var(--vw-border,rgba(255,255,255,.1));}
      .vidnest-sep-label{color:var(--vw-muted,rgba(255,255,255,.35));font-family:"Kanit",sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;flex-shrink:0;}
      .vidnest-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px;padding:5px 0 20px;}
      .vidnest-badge{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.75);color:#fff;font-family:"Kanit",sans-serif;font-size:.6rem;font-weight:500;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:6px;pointer-events:none;z-index:2;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
      .vidnest-card.vidnest-loading{opacity:.5;pointer-events:none;}
      .vidnest-error{color:rgba(255,100,100,.75);font-family:"Kanit",sans-serif;font-size:.85rem;text-align:center;padding:24px;grid-column:1/-1;}
      .vidnest-pager{display:flex;align-items:center;justify-content:center;gap:16px;padding:6px 0 26px;}
      .vidnest-pager button{background:var(--vw-chip-bg,rgba(255,255,255,.08));border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));color:var(--vw-text,#eaeaea);font-family:"Kanit",sans-serif;font-size:.8rem;padding:7px 18px;border-radius:99px;cursor:pointer;transition:background .18s ease,border-color .18s ease,opacity .15s;}
      .vidnest-pager button:hover:not(:disabled){background:var(--vw-hover-strong,rgba(255,255,255,.14));border-color:var(--vw-active-border,rgba(255,255,255,.2));}
      .vidnest-pager button:disabled{opacity:.35;cursor:default;}
      .vidnest-pager span{color:var(--vw-muted,rgba(255,255,255,.5));font-family:"Kanit",sans-serif;font-size:.75rem;letter-spacing:.08em;min-width:90px;text-align:center;}
      #vidnestAnimeBtn{cursor:pointer;}
      @media(max-width:768px){.vidnest-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;}.vidnest-badge{font-size:.5rem;padding:1px 4px;}}
    `;
    document.head.appendChild(s);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      injectCSS();
      movieSection();
      showSection();
      vidnestShield();
      // vidnestAutoPlay()'s own stopAll only knows about the movies/shows
      // auto-play flow (its "active" flag) — it stayed false whenever the
      // anime-merge button (a separate flag, vidnestAnimeActive) was what
      // actually started playback, so content.js's resetView() calling this
      // on Back didn't stop it: the anime video kept playing hidden.
      // vidnestPlayer.stop() is safe to call even when nothing is active.
      const rawStopAll = vidnestAutoPlay().stopAll;
      window.vwVidnestStopAll = function () {
        rawStopAll();
        if (vidnestAnimeActive) { vidnestAnimeActive = false; setAnimeSwitchLabel(); }
        vidnestPlayer.stop();
      };
    }, 350);
  });
})();
