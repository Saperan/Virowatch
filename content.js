// ═══════════════════════════════════════════════════════════════════════════
// VIROWATCH UNIVERSAL AD & POPUP BLOCKER
// Runs immediately (before DOMContentLoaded) so it intercepts everything.
//
// Whitelist: discord.com and discord.gg popups are always allowed through.
// Everything else — ad tabs, interstitials, redirect popups — is blocked.
// ═══════════════════════════════════════════════════════════════════════════
(function installUniversalBlocker() {
  'use strict';

  // ── 1. Popup whitelist ────────────────────────────────────────────────────
  // Only origins in this list may open a new window via window.open().
  // Discord links (join links, invites, app pages) are the sole exception.
  const POPUP_WHITELIST = [
    'discord.com',
    'discord.gg',
    'discordapp.com',
  ];

  function isWhitelisted(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const hostname = new URL(url, location.href).hostname.replace(/^www\./, '');
      return POPUP_WHITELIST.some(w => hostname === w || hostname.endsWith('.' + w));
    } catch (_) {
      // Relative URLs, 'about:blank', etc. — block by default
      return false;
    }
  }

  // ── 2. Override window.open ───────────────────────────────────────────────
  // Returns a fake-but-convincing window object instead of null so callers
  // (ad scripts on the parent page) don't detect that blocking occurred.
  // NOTE: for cross-origin iframes (vidsrc.fyi) the browser's sandbox
  // attribute is what blocks popups — this override covers the parent page only.
  function makeFakeWindow() {
    var f = {
      closed: false, name: '', opener: null,
      innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0,
      screenX: 0, screenY: 0, scrollX: 0, scrollY: 0, devicePixelRatio: 1,
      location: {
        href: 'about:blank', origin: 'null', protocol: 'about:',
        host: '', hostname: '', port: '', pathname: 'blank', search: '', hash: '',
        assign: function () {}, replace: function () {}, reload: function () {},
        toString: function () { return 'about:blank'; },
      },
      history: { length: 0, back: function () {}, forward: function () {}, go: function () {} },
      document: {
        title: '', readyState: 'complete',
        write: function () {}, writeln: function () {},
        getElementById: function () { return null; },
        querySelector: function () { return null; },
        querySelectorAll: function () { return []; },
        createElement: function () { return {}; },
        addEventListener: function () {}, removeEventListener: function () {},
      },
      screen:    { width: 0, height: 0, availWidth: 0, availHeight: 0 },
      navigator: { userAgent: navigator.userAgent },
      focus:    function () {},
      blur:     function () {},
      close:    function () { f.closed = true; },
      stop:     function () {},
      print:    function () {},
      alert:    function () {},
      confirm:  function () { return false; },
      prompt:   function () { return null; },
      postMessage:         function () {},
      addEventListener:    function () {},
      removeEventListener: function () {},
      dispatchEvent:       function () { return false; },
      getComputedStyle:    function () { return {}; },
      matchMedia:          function () { return { matches: false, addListener: function () {}, removeEventListener: function () {} }; },
      // Fake window.open so chained calls also silently succeed
      open:   function () { return makeFakeWindow(); },
      setInterval:           function () { return 0; },
      setTimeout:            function () { return 0; },
      clearInterval:         function () {},
      clearTimeout:          function () {},
      requestAnimationFrame: function () { return 0; },
      cancelAnimationFrame:  function () {},
      resizeTo: function () {}, resizeBy: function () {},
      moveTo:   function () {}, moveBy:   function () {},
      scrollTo: function () {}, scrollBy: function () {},
    };
    f.self = f; f.window = f; f.top = f; f.parent = f; f.frames = f;
    return f;
  }

  const _nativeOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    if (isWhitelisted(url)) {
      return _nativeOpen(url, target, features);
    }
    console.info('[VW Blocker] window.open blocked:', url);
    return makeFakeWindow(); // non-null → callers think the popup opened
  };

  // ── 3. Block beforeunload / unload hijacking ──────────────────────────────
  // Some ad scripts attach beforeunload to force a redirect or dialog.
  const _nativeAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if ((type === 'beforeunload' || type === 'unload') && this === window) {
      console.info('[VW Blocker] beforeunload/unload listener suppressed.');
      return;
    }
    return _nativeAddEventListener.call(this, type, listener, options);
  };

  // ── 4. Neutralise document.write (used by many ad loaders) ───────────────
  const _nativeWrite = document.write.bind(document);
  document.write = function (...args) {
    // Only permit calls that come during the initial synchronous parse
    // (readyState === 'loading'). Ad scripts call this later.
    if (document.readyState === 'loading') {
      return _nativeWrite(...args);
    }
    console.info('[VW Blocker] document.write blocked after page load.');
  };

  // ── 5. Block known ad-network domains via fetch / XHR ────────────────────
  const AD_HOSTNAMES = [
    'doubleclick.net',
    'googlesyndication.com',
    'googletagservices.com',
    'adnxs.com',
    'taboola.com',
    'outbrain.com',
    'popads.net',
    'popcash.net',
    'propellerads.com',
    'trafficjunky.net',
    'juicyads.com',
    'exoclick.com',
    'adsterra.com',
    'hilltopads.net',
    'traffichunt.com',
    'adskeeper.co.uk',
    'mgid.com',
    'revcontent.com',
    'bidvertiser.com',
    'clickadu.com',
    'adcash.com',
    'zedo.com',
    'undertone.com',
    // Ad networks observed in vsembed.ru / vidsrc embed players
    'b7510.com',        // iclick ad network — ERR_CERT_AUTHORITY_INVALID
    'cloudnestra.com',  // dead CDN injected by embed players
    'vsembed.ru',       // broken embed player — injects b7510 ads, sbx.html 404s, CORB in Chromium
  ];

  function isAdUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const hostname = new URL(url, location.href).hostname.replace(/^www\./, '');
      return AD_HOSTNAMES.some(ad => hostname === ad || hostname.endsWith('.' + ad));
    } catch (_) { return false; }
  }

  // Patch fetch
  const _nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    if (isAdUrl(url)) {
      console.info('[VW Blocker] fetch blocked:', url);
      return Promise.reject(new Error('Blocked by VW Ad Blocker'));
    }
    return _nativeFetch.call(this, input, init);
  };

  // Patch XMLHttpRequest
  const _nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isAdUrl(url)) {
      console.info('[VW Blocker] XHR blocked:', url);
      // Mark it so send() does nothing
      this._vwBlocked = true;
    }
    return _nativeXhrOpen.call(this, method, url, ...rest);
  };
  const _nativeXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._vwBlocked) return;
    return _nativeXhrSend.apply(this, args);
  };

  // ── 6. MutationObserver — block ad iframes & popunder scripts injected
  //       dynamically by third-party embed players (anikoto, pitsport, etc.)
  // ─────────────────────────────────────────────────────────────────────────
  const AD_IFRAME_PATTERNS = [
    /popads/i,
    /popcash/i,
    /propellerads/i,
    /exoclick/i,
    /adsterra/i,
    /trafficjunky/i,
    /juicyads/i,
    /hilltopads/i,
    /traffichunt/i,
    /adskeeper/i,
    /bidvertiser/i,
    /clickadu/i,
    /adcash/i,
    /doubleclick\.net/i,
    /googlesyndication/i,
    /\bad(s|vert|frame|server|network)\b/i,
    /b7510\.com/i,       // iclick ad network seen in vsembed players
    /cloudnestra\.com/i, // dead CDN injected by embed players
    /vsembed\.ru/i,      // broken embed player — sbx.html 404, CORB, b7510 ad injection
  ];

  function looksLikeAdIframe(el) {
    if (el.tagName !== 'IFRAME' && el.tagName !== 'SCRIPT') return false;
    const src = el.src || el.getAttribute('src') || '';
    // Whitelisted embed domains — never remove these
    const EMBED_SAFE = [
      'rumble.com', 'megaplay.buzz', 'anikotoapi.site', 'pitsport.live',
      'streambroadcast.net', // Added StreamBroadcast to safe list
      'vidsrc.', 'vidsrc.fyi', 'pushmdz.', 'voe.sx', 'dood.', 'filemoon.', 'streamed.',
      'streameast.', 'weakspell.', 'sportsurge.', 'discord.com', 'discord.gg',
      'allorigins.win', 'codetabs.com', 'api.codetabs.com',
      'cors.sh', 'corsproxy.org', 'crossorigin.me',
      'workers.dev', // vw-proxy.js — our Cloudflare Worker, serves the vidsrc.fyi embed
    ];
    if (EMBED_SAFE.some(safe => src.includes(safe))) return false;
    if (isAdUrl(src)) return true;
    if (AD_IFRAME_PATTERNS.some(re => re.test(src))) return true;
    // Zero-size or off-screen iframes not from safe sources
    if (el.tagName === 'IFRAME') {
      const w = parseInt(el.width || el.style.width || '999', 10);
      const h = parseInt(el.height || el.style.height || '999', 10);
      if ((w <= 1 || h <= 1) && src && !EMBED_SAFE.some(s => src.includes(s))) return true;
    }
    return false;
  }

  const domObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Check the node itself
        if (looksLikeAdIframe(node)) {
          console.info('[VW Blocker] Removed injected ad element:', node.src || node.tagName);
          node.remove();
          continue;
        }
        // Check descendants
        node.querySelectorAll && node.querySelectorAll('iframe, script').forEach(el => {
          if (looksLikeAdIframe(el)) {
            console.info('[VW Blocker] Removed nested ad element:', el.src || el.tagName);
            el.remove();
          }
        });
      }
    }
  });

  // Start observing as early as possible
  function startObserver() {
    domObserver.observe(document.documentElement || document.body || document, {
      childList: true,
      subtree: true,
    });
  }

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  // ── 7. Shared probe-iframe sandbox utility ────────────────────────────────
  // Both pitsport-live.js and anikoto-loader.js create hidden probe iframes
  // to verify embed URLs. This central helper enforces the anti-popup sandbox
  // on every probe, normalising behaviour across all loaders.
  window._vwProbeIframe = function probeIframe(url, timeoutMs) {
    timeoutMs = timeoutMs || 7000;
    return new Promise(resolve => {
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position: 'fixed', top: '-9999px', left: '-9999px',
        width: '1px', height: '1px', opacity: '0',
        pointerEvents: 'none', border: 'none',
      });
      // Anti-popup sandbox: scripts and same-origin allowed for probe,
      // but allow-popups is intentionally omitted.
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { document.body.removeChild(iframe); } catch (_) {}
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      iframe.onload  = () => finish(true);
      iframe.onerror = () => finish(false);
      iframe.src = url;
      document.body.appendChild(iframe);
    });
  };

  console.info('[VW Blocker] Universal ad & popup blocker installed. Discord whitelisted.');
})();

// ═══════════════════════════════════════════════════════════════════════════
// END OF UNIVERSAL BLOCKER
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  // Inject CSS for Virowatch and Lunora badges
  const vwStyles = document.createElement("style");
  vwStyles.textContent = `
    .movie-item { position: relative; }
    .vw-category-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      color: #fff;
      font-family: "Kanit", sans-serif;
      font-size: .55rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
      padding: 2px 6px;
      border-radius: 3px;
      pointer-events: none;
      z-index: 2;
      backdrop-filter: blur(4px);
    }
    @media (max-width: 768px) {
      .vw-category-badge { font-size: .5rem; padding: 1px 4px; }
    }
  `;
  document.head.appendChild(vwStyles);

  const RESERVED_KEYS = [
    "title",
    "image",
    "video",
    "episodeTitles",
    "customDownloads",
    "dubbed",
    "dubbedepisodetitle",
    "dubbedcustomdownloads",
  ];
  // Load all data into one object
  window.mediaData = {
    movies: window.movies || {},
    shows: window.shows || {},
    anime: window.anime || {},
    lunora: {},
  };

  const linkEl = document.getElementById("themeStylesheet");
  const THEME_HREF = {
    auto: null,
    "desktop-dark": "virostyle.css",
    "desktop-light": "virostyle-light.css",
    "mobile-dark": "virostyle2.css",
    "mobile-light": "virostyle2-light.css",
  };
  const spinner = document.getElementById("videoSpinner");

  // Global State
  let cat = null,
    mov = null,
    season = null,
    ep = 0,
    dubbed = false,
    timer;

  function isMobileViewport() {
    const w = window.innerWidth,
      h = window.innerHeight;
    return w <= 768 || w / h <= 9 / 16;
  }
  function resolveThemeHref(key) {
    if (key === "auto")
      return isMobileViewport() ? "virostyle2.css" : "virostyle.css";

    if (THEME_HREF[key]) return THEME_HREF[key];
    return key;
  }

  const themeSelect = document.getElementById("app-sidebar-theme-select");

  function applyTheme(key) {
    if (linkEl) linkEl.href = resolveThemeHref(key);
    localStorage.setItem("theme", key);

    if (themeSelect) {
      let exists = Array.from(themeSelect.options).some(
        (opt) => opt.value === key,
      );

      if (!exists && key !== "auto" && !THEME_HREF[key]) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent =
          key.split("/").pop().replace(".css", "") + " (Custom)";
        themeSelect.appendChild(opt);
      }
      themeSelect.value = key;
    }
  }

  const saved = localStorage.getItem("theme");
  applyTheme(saved ? saved : "auto");

  if (themeSelect) {
    themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
  }

  window.addEventListener("resize", () => {
    if (localStorage.getItem("theme") === "auto" && linkEl)
      linkEl.href = resolveThemeHref("auto");
  });

  const CUSTOM_CSS_KEY = "virowatch_custom_css";
  const customListEl = document.getElementById("app-custom-css-list");
  const customFileInput = document.getElementById("app-custom-css-file");
  const importCssBtn = document.getElementById("app-import-css-btn");

  function getCustomCssList() {
    try {
      return JSON.parse(localStorage.getItem(CUSTOM_CSS_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function saveCustomCssList(list) {
    localStorage.setItem(CUSTOM_CSS_KEY, JSON.stringify(list));
  }

  function applyCustomCss(list) {
    list.forEach((item) => {
      const existing = document.getElementById("custom-css-" + item.id);
      if (existing) existing.remove();
    });
    list.forEach((item) => {
      if (item.type === "inline") {
        const style = document.createElement("style");
        style.id = "custom-css-" + item.id;
        style.textContent = item.value;
        document.head.appendChild(style);
      } else if (item.type === "url" && item.value) {
        const link = document.createElement("link");
        link.id = "custom-css-" + item.id;
        link.rel = "stylesheet";
        link.href = item.value;
        document.head.appendChild(link);
      }
    });
  }

  function renderCustomCssList() {
    if (!customListEl) return;
    const list = getCustomCssList();
    customListEl.innerHTML = "";
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "app-sidebar-custom-item";
      const name = document.createElement("span");
      name.title = item.name;
      name.textContent = item.name;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "app-sidebar-custom-remove";
      removeBtn.setAttribute("aria-label", "Remove");
      removeBtn.dataset.id = item.id;
      removeBtn.addEventListener("click", () => {
        const arr = getCustomCssList().filter((i) => i.id !== item.id);
        saveCustomCssList(arr);
        applyCustomCss(arr);
        const el = document.getElementById("custom-css-" + item.id);
        if (el) el.remove();
        renderCustomCssList();
      });
      row.appendChild(name);
      row.appendChild(removeBtn);
      customListEl.appendChild(row);
    });
  }

  applyCustomCss(getCustomCssList());
  renderCustomCssList();

  if (importCssBtn && customFileInput) {
    importCssBtn.addEventListener("click", () => customFileInput.click());
    customFileInput.addEventListener("change", () => {
      const file = customFileInput.files && customFileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const list = getCustomCssList();
        const id = "custom-" + Date.now();
        list.push({
          id,
          name: file.name || "Custom CSS",
          type: "inline",
          value: reader.result || "",
        });
        saveCustomCssList(list);
        applyCustomCss(list);
        renderCustomCssList();
      };
      reader.readAsText(file);
      customFileInput.value = "";
    });
  }

  function saveState() {
    localStorage.setItem(
      "lastState",
      JSON.stringify({ cat, mov, season, ep, dubbed }),
    );
  }

  const currentData = () =>
    cat && mediaData[cat] ? mediaData[cat][mov] : null;
  function activeData() {
    const data = currentData();
    if (!data) return null;
    if (season && data[season]) return data[season];
    const seasons = Object.keys(data).filter(
      (k) => !RESERVED_KEYS.includes(k) && typeof data[k] === "object",
    );
    if (seasons.length) {
      season = seasons[0];
      return data[season];
    }
    return data;
  }

  const movieListWrapper = document.getElementById("movieListWrapper");
  const movieList = document.getElementById("movieList");
  const categoryContainer = document.getElementById("categoryContainer");
  const episodeContainer = document.getElementById("episodeContainer");
  const seasonSelectorContainer = document.getElementById(
    "seasonSelectorContainer",
  );
  const heroSection = document.getElementById("hero");

  function renderList(category) {
    cat = category;
    window._vwlCurrentCat = category;
    movieList.innerHTML = "";
    Object.entries(mediaData[category] || {}).forEach(([key, info]) => {
      if (info && info._hidden) return;
      
      // Determine badge text and color
      let badgeText = "";
      let badgeBg = "";
      if (category === "shows" || category === "anime") {
          badgeText = "Virowatch";
          badgeBg = "#444444"; // Virowatch Custom Dark
      } else if (category === "lunora") {
          badgeText = "Lunora";
          badgeBg = "#cd4ec4"; // Lunora Custom Color
      }

      const div = document.createElement("div");
      div.className = "movie-item";
      div.dataset.movie = key;
      
      let badgeHtml = badgeText ? `<span class="vw-category-badge" style="background: ${badgeBg};">${badgeText}</span>` : "";
      
      div.innerHTML = `
        <img src="${info.image || "https://via.placeholder.com/150"}" loading="lazy"/>
        <p class="kanit-extralight">${info.title || key}</p>
        ${badgeHtml}
      `;
      
      const clean = div.cloneNode(true);
      clean.addEventListener("click", () => selectMovie(key));
      movieList.appendChild(clean);
    });
    
    if (heroSection) heroSection.style.display = "none";
    if (categoryContainer) categoryContainer.style.display = "none";
    if (movieListWrapper) movieListWrapper.style.display = "block";

    const navBar = document.getElementById("categoryNavBar");
    if (navBar) {
      navBar.style.display = "flex";
      navBar.querySelectorAll(".cat-nav-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cat === category);
      });
    }

    const clContainer = document.getElementById("changelog-container");
    if (clContainer) clContainer.style.marginTop = "20px";
  }

  function updateWatermarksAndBadges() {
    document.querySelectorAll(".watermark, .badge, .stream-indicator").forEach(el => {
      let txt = el.textContent.trim();
      if (txt.toLowerCase() === "1080p") el.textContent = "Vidsrc";
      if (txt.toLowerCase() === "stream") el.textContent = "Anikoto";
    });

    let existingVirowatch = document.getElementById("virowatch-anime-shows-watermark");
    if (existingVirowatch) existingVirowatch.remove();

    if ((cat === "anime" || cat === "shows") && episodeContainer) {
      const vwBadge = document.createElement("div");
      vwBadge.id = "virowatch-anime-shows-watermark";
      vwBadge.textContent = "Virowatch";
      vwBadge.style.cssText = `
        position: absolute;
        top: 15px;
        left: 15px;
        color: rgba(128, 128, 128, 0.7);
        font-family: 'Kanit', sans-serif;
        font-size: 14px;
        font-weight: bold;
        pointer-events: none;
        z-index: 10;
        background: rgba(0, 0, 0, 0.4);
        padding: 4px 8px;
        border-radius: 4px;
      `;
      const playerWrapper = document.getElementById("videoPlayer")?.parentElement;
      if (playerWrapper) {
        playerWrapper.style.position = "relative";
        playerWrapper.appendChild(vwBadge);
      }
    }
  }

  function selectMovie(key) {
    mov = key;
    ep = 0;
    season = null;
    dubbed = false;
    saveState();
    document.querySelector(".dubbed-toggle")?.classList.remove("active");
    const npt = document.getElementById("nowPlayingTitle");
    if (npt) npt.textContent = mediaData[cat]?.[key]?.title || key;

    // PitSport Loading Logic
    if (key === "PITSORT" && cat === "shows") {
      const pitData = window.mediaData?.shows?.PITSORT;
      const hasVideos =
        pitData &&
        Object.keys(pitData).some(
          (k) =>
            !RESERVED_KEYS.includes(k) &&
            typeof pitData[k] === "object" &&
            pitData[k].video?.length,
        );

      if (!hasVideos) {
        if (episodeContainer) {
          episodeContainer.style.display = "flex";
          document.body.classList.add("modal-open");
        }
        const listEl = document.getElementById("episodeListContainer");
        if (listEl)
          listEl.innerHTML =
            '<div class="episode" style="opacity:0.6;cursor:default;">⏳ Loading live events…</div>';
        seasonSelectorContainer.innerHTML = "";

        if (!window._pitsportLoaded) {
          if (
            !window._pitsportLoading &&
            typeof window.reloadPitSport === "function"
          ) {
            window.reloadPitSport();
          }
        }
        return;
      }
    }

    // StreamBroadcast Loading Logic
    if (key === "SBLIVE" && cat === "shows") {
      const sbData = window.mediaData?.shows?.SBLIVE;
      const hasVideos =
        sbData &&
        Object.keys(sbData).some(
          (k) =>
            !RESERVED_KEYS.includes(k) &&
            typeof sbData[k] === "object" &&
            sbData[k].video?.length,
        );

      if (!hasVideos) {
        if (episodeContainer) {
          episodeContainer.style.display = "flex";
          document.body.classList.add("modal-open");
        }
        const listEl = document.getElementById("episodeListContainer");
        if (listEl)
          listEl.innerHTML =
            '<div class="episode" style="opacity:0.6;cursor:default;">⏳ Loading scheduled streams…</div>';
        seasonSelectorContainer.innerHTML = "";

        if (!window._sbLoaded) {
          if (
            !window._sbLoading &&
            typeof window.reloadStreamBroadcast === "function"
          ) {
            window.reloadStreamBroadcast();
          }
        }
        return;
      }
    }
    
    updateSeasonSelector();
    updateEpisodeList();
    
    if (episodeContainer) {
      episodeContainer.style.display = "flex";
      document.body.classList.add("modal-open");
      document.body.classList.remove("app-sidebar-open");
    }

    setTimeout(() => {
      updateVideo(0);
      updateDownloads();
      updateWatermarksAndBadges();
    }, 50);
  }

  // PitSport Ready Handler
  window.addEventListener("pitsportReady", () => {
    if (cat === "shows" && mov === "PITSORT") {
      ep = 0;
      season = null;
      updateSeasonSelector();
      updateEpisodeList();
      updateVideo(0);
      updateDownloads();
      updateWatermarksAndBadges();
    }
  });

  // StreamBroadcast Ready Handler
  window.addEventListener("sbReady", () => {
    if (cat === "shows" && mov === "SBLIVE") {
      ep = 0;
      season = null;
      updateSeasonSelector();
      updateEpisodeList();
      updateVideo(0);
      updateDownloads();
      updateWatermarksAndBadges();
    }
  });

  function updateSeasonSelector() {
    seasonSelectorContainer.innerHTML = "";
    const data = activeData();
    if (!data) return;
    const currentEntry = currentData();
    const seasons = Object.keys(currentEntry).filter(
      (k) => !RESERVED_KEYS.includes(k) && typeof currentEntry[k] === "object",
    );
    if (!seasons.length) return;
    const select = document.createElement("select");
    select.id = "seasonSelector";
    seasons.forEach((s, i) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = currentEntry[s].chapter || s;
      if (i === 0 && !season) season = s;
      select.appendChild(opt);
    });
    select.value = season;
    select.addEventListener("change", (e) => {
      season = e.target.value;
      ep = 0;
      saveState();
      updateEpisodeList();
      updateVideo(0);
      updateDownloads();
      updateWatermarksAndBadges();
    });
    seasonSelectorContainer.appendChild(select);
  }

  function updateEpisodeList() {
    const container = document.getElementById("episodeListContainer");
    container.innerHTML = "";
    const data = activeData();
    if (!data) return;
    const titles =
      dubbed && data.dubbedepisodetitle?.length
        ? data.dubbedepisodetitle
        : data.episodeTitles || [];
    (data.video || []).forEach((_, i) => {
      const div = document.createElement("div");
      div.className = "episode";
      div.textContent = titles[i] || `Episode ${i + 1}`;
      div.dataset.episodeIndex = i;
      div.addEventListener("click", () => {
        updateVideo(i);
        updateWatermarksAndBadges();
      });
      container.appendChild(div);
    });
  }

  function updateVideo(index) {
    const data = activeData();
    if (!data) return;
    const vids = dubbed && data.dubbed?.length ? data.dubbed : data.video || [];
    if (!vids[index]) return;
    if (spinner) spinner.style.display = "block";
    const iframe = document.getElementById("videoPlayer");

    // No sandbox — popup blocking is handled by the Cloudflare Worker proxy
    // (vw-proxy.js), which injects the fake window.open script server-side
    // before any vidsrc.fyi ad code runs. Sandboxing without allow-same-origin
    // forces a null origin in Chromium (SecurityError); with allow-same-origin
    // but without allow-popups the player detects blocked popups and refuses
    // to serve content. The worker approach avoids both problems entirely.
    iframe.removeAttribute("sandbox");

    iframe.allowFullscreen = true;
    iframe.setAttribute("allow", "fullscreen; autoplay; picture-in-picture; encrypted-media");

    const targetSrc = vids[index];

    // ── FIX: Clear to about:blank first so same-URL reloads work ──
    // This fixes the "spam episode 1" issue where the iframe wouldn't
    // reload because the browser saw the same src and skipped navigation.
    iframe.src = "about:blank";
    iframe.onload = null;

    setTimeout(() => {
      iframe.classList.add("fade-out");

      let loaded = false;

      // Fallback: if onload never fires (embed down, CORS error, etc.),
      // remove fade-out after 8 seconds so the UI doesn't get stuck.
      const fallbackTimer = setTimeout(() => {
        if (!loaded) {
          if (spinner) spinner.style.display = "none";
          iframe.classList.remove("fade-out");
        }
      }, 8000);

      iframe.onload = () => {
        loaded = true;
        clearTimeout(fallbackTimer);
        setTimeout(() => {
          if (spinner) spinner.style.display = "none";
          iframe.classList.remove("fade-out");
        }, 300);
      };

      iframe.src = targetSrc;
    }, 80);

    ep = index;
    saveState();
    highlightEpisode(index);
  }

  function highlightEpisode(i) {
    document
      .querySelectorAll(".episode")
      .forEach((el) => el.classList.remove("active"));
    document
      .querySelector(`.episode[data-episode-index="${i}"]`)
      ?.classList.add("active");
  }

  function updateDownloads() {
    const dc = document.getElementById("downloadContainer");
    dc.innerHTML = "";
    const data = activeData();
    if (!data) return;
    const downs =
      dubbed && data.dubbedcustomdownloads?.[ep]?.length
        ? data.dubbedcustomdownloads[ep]
        : data.customDownloads?.[ep] || [];
    if (downs.length)
      downs.forEach((d) => {
        const a = document.createElement("a");
        a.href = d.url;
        a.textContent = d.name;
        a.className = "button";
        dc.appendChild(a);
      });
    else dc.innerHTML = "";
  }

  // ── Local catalog title matching ──────────────────────────────────
  // NOTE: this used to be a pure subsequence matcher ("does every letter of
  // the query appear in order somewhere in the title?"). That meant a query
  // like "Romance" would match almost anything, because the letters r-o-m-
  // a-n-c-e show up *somewhere, in order* in lots of unrelated titles. That
  // produced the "random scrambled Virowatch content" results. Local catalog
  // search should only ever match real substrings/words of the title — actual
  // genre discovery (e.g. "Romance") is handled separately by searchByGenre()
  // against TMDB/Anilist, which actually know what genre a title belongs to.
  function normalizeForSearch(str) {
    return (str || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^a-z0-9\s]/g, " ")     // punctuation -> space
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesSubsequence(title, query) {
    if (!query.length) return true;
    return normalizeForSearch(title).includes(normalizeForSearch(query));
  }

  // Returns a relevance score (0 = no match) for a local catalog match.
  // Whole-title match > starts-with > whole-word match > plain substring.
  function localMatchScore(title, query) {
    const t = normalizeForSearch(title);
    const q = normalizeForSearch(query);
    if (!q) return 0;
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    const wordBoundary = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    if (wordBoundary.test(t)) return 60;
    if (t.includes(q)) return 40;
    return 0;
  }

  const searchClearBtn = document.getElementById("searchClear");
  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", () => {
      const sInput = document.getElementById("searchInput");
      if (sInput) {
        sInput.value = "";
        sInput.dispatchEvent(new Event("input"));
        sInput.focus();
      }
    });
  }

  // ── Genre keyword mapping for cross-category search ──────────────
  const TMDB_KEY = window.ENV?.TMDB_API_KEY || "77d678406118b130512ab8affd953fa9";
  const WORKER_BASE = window.ENV?.VW_PROXY_URL || "https://virowatcher.vmtgaming13.workers.dev";
  const TMDB_IMG = "https://image.tmdb.org/t/p/w300";

  const GENRE_MAP = {
    'action':            { tmdb_movie: 28,    tmdb_tv: 10759, anilist: 'Action' },
    'adventure':         { tmdb_movie: 12,    tmdb_tv: 10759, anilist: 'Adventure' },
    'comedy':            { tmdb_movie: 35,    tmdb_tv: 35,    anilist: 'Comedy' },
    'drama':             { tmdb_movie: 18,    tmdb_tv: 18,    anilist: 'Drama' },
    'fantasy':           { tmdb_movie: 14,    tmdb_tv: 10765, anilist: 'Fantasy' },
    'horror':            { tmdb_movie: 27,                     anilist: 'Horror' },
    'mystery':           { tmdb_movie: 9648,  tmdb_tv: 9648,  anilist: 'Mystery' },
    'romance':           { tmdb_movie: 10749,                  anilist: 'Romance' },
    'sci-fi':            { tmdb_movie: 878,   tmdb_tv: 10765, anilist: 'Sci-Fi' },
    'science fiction':   { tmdb_movie: 878,   tmdb_tv: 10765, anilist: 'Sci-Fi' },
    'thriller':          { tmdb_movie: 53,                     anilist: 'Thriller' },
    'mecha':             {                                      anilist: 'Mecha' },
    'slice of life':     {                                      anilist: 'Slice of Life' },
    'supernatural':      {                                      anilist: 'Supernatural' },
    'psychological':     {                                      anilist: 'Psychological' },
    'sports':            {                                      anilist: 'Sports' },
    'music':             { tmdb_movie: 10402,                  anilist: 'Music' },
    'crime':             { tmdb_movie: 80,    tmdb_tv: 80 },
    'war':               { tmdb_movie: 10752, tmdb_tv: 10768 },
    'western':           { tmdb_movie: 37,    tmdb_tv: 37 },
    'animation':         { tmdb_movie: 16,    tmdb_tv: 16 },
    'documentary':       { tmdb_movie: 99,    tmdb_tv: 99 },
    'family':            { tmdb_movie: 10751, tmdb_tv: 10751 },
  };

  function matchGenre(query) {
    const q = query.toLowerCase().trim();
    if (GENRE_MAP[q]) return { keyword: q, ...GENRE_MAP[q] };
    // Try multi-word keywords first (e.g. "science fiction", "slice of life")
    // so they win over a shorter keyword that might also appear in the query.
    const keywordsByLength = Object.entries(GENRE_MAP).sort(
      (a, b) => b[0].length - a[0].length
    );
    for (const [keyword, ids] of keywordsByLength) {
      const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(q)) return { keyword, ...ids };
    }
    return null;
  }

  async function fetchTmdbGenre(genreId, type) {
    if (!genreId) return [];
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(
        `https://api.themoviedb.org/3/discover/${type}?api_key=${TMDB_KEY}&with_genres=${genreId}&sort_by=popularity.desc&page=1`,
        { signal: ctrl.signal }
      );
      clearTimeout(tid);
      const data = await res.json();
      return data?.results || [];
    } catch { return []; }
  }

  async function fetchAnilistGenre(genre) {
    if (!genre) return [];
    const query = `query { Page(page: 1, perPage: 15) { media(genre: "${genre}", sort: POPULARITY_DESC) { id title { romaji english } coverImage { large } } } }`;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      const data = await res.json();
      return data?.data?.Page?.media || [];
    } catch { return []; }
  }

  // ── Genre tagging for local shows.js / anime.js catalog content ──────
  // Looks up each Virowatch title's real genres (TMDB for shows, Anilist
  // for anime) the first time it's needed, then caches the result in
  // localStorage so it's a one-time network cost per title, not a repeat
  // hit on every search. Tagged titles can then surface directly in genre
  // search results (e.g. searching "romance" can show your own Virowatch
  // titles, not just TMDB/Anilist proxy results) ahead of everything else,
  // since they're already playable on the site.
  const GENRE_TAG_CACHE_KEY = "vw_genre_tags_v1";
  let genreTagCache = {};
  try {
    genreTagCache = JSON.parse(localStorage.getItem(GENRE_TAG_CACHE_KEY) || "{}");
  } catch { genreTagCache = {}; }

  function saveGenreTagCache() {
    try { localStorage.setItem(GENRE_TAG_CACHE_KEY, JSON.stringify(genreTagCache)); } catch {}
  }

  function genreTagCacheKey(catKey, key) {
    return `${catKey}:${key}`;
  }

  // Reverse lookup: TMDB genre id -> our keyword(s), Anilist genre name -> our keyword(s)
  const TMDB_TV_ID_TO_KEYWORD = {};
  const ANILIST_NAME_TO_KEYWORD = {};
  Object.entries(GENRE_MAP).forEach(([keyword, ids]) => {
    if (ids.tmdb_tv) {
      (TMDB_TV_ID_TO_KEYWORD[ids.tmdb_tv] ||= []).push(keyword);
    }
    if (ids.anilist) {
      (ANILIST_NAME_TO_KEYWORD[ids.anilist] ||= []).push(keyword);
    }
  });

  async function tmdbSearchTvGenres(title) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}`,
        { signal: ctrl.signal }
      );
      clearTimeout(tid);
      const data = await res.json();
      const best = data?.results?.[0];
      if (!best?.genre_ids) return [];
      const keywords = new Set();
      best.genre_ids.forEach(id => {
        (TMDB_TV_ID_TO_KEYWORD[id] || []).forEach(k => keywords.add(k));
      });
      return [...keywords];
    } catch { return []; }
  }

  async function anilistSearchGenres(title) {
    const query = `query ($search: String) { Media(search: $search, type: ANIME) { genres } }`;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { search: title } }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      const data = await res.json();
      const genres = data?.data?.Media?.genres || [];
      const keywords = new Set();
      genres.forEach(g => {
        (ANILIST_NAME_TO_KEYWORD[g] || []).forEach(k => keywords.add(k));
      });
      return [...keywords];
    } catch { return []; }
  }

  // Resolves (and caches) the genre keywords for one local catalog entry.
  // Returns an array of keywords, e.g. ["romance", "drama"]. Empty array
  // means "looked it up, no genre keywords matched" (still cached, so we
  // don't keep re-querying for titles with no mapped genre).
  async function tagLocalEntry(catKey, key, info) {
    const cacheKey = genreTagCacheKey(catKey, key);
    const cached = genreTagCache[cacheKey];
    if (cached) return cached.genres;

    const title = info.title || key;
    let genres = [];
    if (catKey === "shows") {
      genres = await tmdbSearchTvGenres(title);
    } else if (catKey === "anime") {
      genres = await anilistSearchGenres(title);
    }

    genreTagCache[cacheKey] = { genres, ts: Date.now() };
    saveGenreTagCache();
    return genres;
  }

  // Tags every shows/anime entry against one specific genre keyword,
  // resolving lazily and only as needed for the active search. Returns
  // the list of { catKey, key, info } that match. Capped + sequential-ish
  // (small concurrency) so a search doesn't fire 70+ requests at once.
  async function findLocalMatchesForGenre(genreKeyword) {
    const candidates = [];
    ["shows", "anime"].forEach(catKey => {
      const catData = mediaData[catKey];
      if (!catData) return;
      Object.entries(catData).forEach(([key, info]) => {
        if (info && info._hidden) return;
        candidates.push({ catKey, key, info });
      });
    });

    const CONCURRENCY = 5;
    const matches = [];
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(c => tagLocalEntry(c.catKey, c.key, c.info))
      );
      batch.forEach((c, idx) => {
        if (results[idx].includes(genreKeyword)) matches.push(c);
      });
    }
    return matches;
  }

  function makeGenreCard(title, image, badgeText, badgeBg, onClick, key) {
    const div = document.createElement("div");
    div.className = "movie-item";
    // ── FIX: dataset.movie must be set BEFORE _vwlAttachButton runs ──
    // attachButton() in watchlist.js bails out immediately if
    // mi.dataset.movie is falsy, so setting this after the card was
    // already passed through _vwlAttachButton (as a separate step by the
    // caller) meant the "+" button silently never got added. Accepting the
    // key here and setting it first fixes that for every genre-search card
    // that already has a resolvable Virowatch/Lunora key.
    if (key) div.dataset.movie = key;
    div.innerHTML = `
      <img src="${image || 'https://via.placeholder.com/150'}" loading="lazy"/>
      <p class="kanit-extralight">${title}</p>
      <span class="vw-category-badge" style="background: ${badgeBg};">${badgeText}</span>
    `;
    div.addEventListener("click", onClick);
    window._vwlAttachButton?.(div);
    return div;
  }

  function showToastMsg(msg) {
    let t = document.getElementById('vwl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'vwl-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'vwl-show';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.className = ''; }, 2600);
  }

  async function searchByGenre(query, genreInfo) {
    const ml = document.getElementById("movieList");
    if (!ml) return;

    // Add separator
    const sep = document.createElement("div");
    sep.className = "ani-search-sep";
    sep.style.cssText = "grid-column: 1/-1; text-align: center; color: rgba(255,255,255,0.4); font-size: 0.85rem; padding: 12px 10px; font-family: 'Kanit', sans-serif;";
    sep.textContent = `🎭 Loading "${genreInfo.keyword}" genre results...`;
    ml.appendChild(sep);

    const [movies, tvShows, anime, localMatches] = await Promise.all([
      fetchTmdbGenre(genreInfo.tmdb_movie, 'movie'),
      fetchTmdbGenre(genreInfo.tmdb_tv, 'tv'),
      fetchAnilistGenre(genreInfo.anilist),
      findLocalMatchesForGenre(genreInfo.keyword)
    ]);

    sep.remove();

    // ── Virowatch catalog matches → shown FIRST, since they're already ──
    // playable directly on the site (no extra resolution/lookup needed).
    if (localMatches.length > 0) {
      const localSep = document.createElement("div");
      localSep.className = "ani-search-sep";
      localSep.style.cssText = "grid-column: 1/-1; display: flex; align-items: center; gap: 12px; padding: 4px 0 8px;";
      localSep.innerHTML = `<div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div><span style="color:rgba(255,255,255,.7);font-family:'Kanit',sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;">${genreInfo.keyword} · Virowatch</span><div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div>`;
      ml.appendChild(localSep);

      localMatches.forEach(({ catKey, key, info }) => {
        const card = makeGenreCard(
          info.title || key,
          info.image,
          "Virowatch",
          "#444444",
          () => { cat = catKey; selectMovie(key); },
          key
        );
        ml.appendChild(card);
      });
    }

    // ── TMDB Movies → inject into lunora and display ──
    if (movies.length > 0) {
      const movieSep = document.createElement("div");
      movieSep.className = "ani-search-sep";
      movieSep.style.cssText = "grid-column: 1/-1; display: flex; align-items: center; gap: 12px; padding: 16px 0 8px;";
      movieSep.innerHTML = `<div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div><span style="color:rgba(205,78,196,.6);font-family:'Kanit',sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;">${genreInfo.keyword} Movies · TMDB</span><div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div>`;
      ml.appendChild(movieSep);

      movies.slice(0, 12).forEach(m => {
        const key = `VIDSRC_${m.id}`;
        const title = m.title || "Unknown";
        const poster = m.poster_path ? `${TMDB_IMG}${m.poster_path}` : null;

        // Inject into mediaData.lunora so it's playable
        if (!window.mediaData.lunora[key]) {
          window.mediaData.lunora[key] = {
            title: title + (m.release_date ? ` (${m.release_date.slice(0,4)})` : ""),
            image: poster || "",
            _hidden: true,
            VIDSRC_S1: {
              chapter: "Movie",
              video: [`${WORKER_BASE}/embed/movie/${m.id}`],
              episodeTitles: [title]
            }
          };
        }

        const card = makeGenreCard(
          title + (m.release_date ? ` (${m.release_date.slice(0,4)})` : ""),
          poster,
          "Lunora",
          "#cd4ec4",
          () => { cat = "lunora"; selectMovie(key); },
          key
        );
        ml.appendChild(card);
      });
    }

    // ── TMDB TV Shows → inject into shows and display ──
    if (tvShows && tvShows.length > 0) {
      const tvSep = document.createElement("div");
      tvSep.className = "ani-search-sep";
      tvSep.style.cssText = "grid-column: 1/-1; display: flex; align-items: center; gap: 12px; padding: 16px 0 8px;";
      tvSep.innerHTML = `<div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div><span style="color:rgba(100,100,100,.6);font-family:'Kanit',sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;">${genreInfo.keyword} TV Shows · TMDB</span><div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div>`;
      ml.appendChild(tvSep);

      tvShows.slice(0, 12).forEach(s => {
        const key = `VIDSRC_TV_${s.id}`;
        const title = s.name || "Unknown";
        const poster = s.poster_path ? `${TMDB_IMG}${s.poster_path}` : null;

        if (!window.mediaData.shows[key]) {
          window.mediaData.shows[key] = {
            title: title + (s.first_air_date ? ` (${s.first_air_date.slice(0,4)})` : ""),
            image: poster || "",
            _hidden: true,
            VIDSRC_S1: {
              chapter: "Season 1",
              video: [`${WORKER_BASE}/embed/tv/${s.id}/1/1`],
              episodeTitles: ["Episode 1"]
            }
          };
        }

        const card = makeGenreCard(
          title + (s.first_air_date ? ` (${s.first_air_date.slice(0,4)})` : ""),
          poster,
          "Virowatch",
          "#444444",
          () => { cat = "shows"; selectMovie(key); },
          key
        );
        ml.appendChild(card);
      });
    }

    // ── Anilist Anime → search anikoto cache/API and display ──
    if (anime && anime.length > 0) {
      const aniSep = document.createElement("div");
      aniSep.className = "ani-search-sep";
      aniSep.style.cssText = "grid-column: 1/-1; display: flex; align-items: center; gap: 12px; padding: 16px 0 8px;";
      aniSep.innerHTML = `<div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div><span style="color:rgba(99,102,241,.6);font-family:'Kanit',sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;">${genreInfo.keyword} Anime · Anilist</span><div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div>`;
      ml.appendChild(aniSep);

      anime.slice(0, 12).forEach(a => {
        const title = a.title?.english || a.title?.romaji || "Unknown";
        const poster = a.coverImage?.large || "";

        // No key yet — this card isn't in mediaData until the user clicks
        // through and we resolve it against the Anikoto database below.
        const card = makeGenreCard(
          title,
          poster,
          "Anilist",
          "rgba(99,102,241,0.88)",
          async () => {
            // Try to find in anikoto database
            if (window._anikotoSearchByTitle) {
              showToastMsg(`Searching for "${title}"...`);
              const aniKey = await window._anikotoSearchByTitle(title);
              if (aniKey) {
                cat = "anime";
                selectMovie(aniKey);
              } else {
                showToastMsg("Not found in streaming database");
              }
            } else {
              showToastMsg("Anime search not ready yet");
            }
          }
        );

        // ── FIX: "+" button for Anilist cards ──
        // These cards have no Virowatch key yet (it's only known after the
        // user clicks through), so the normal _vwlAttachButton always
        // bailed out silently (no dataset.movie => no button). Use a
        // deferred button instead: clicking "+" resolves the real
        // ANI_<id> key first via _anikotoSearchByTitle, then adds it.
        if (window._vwlAttachDeferredButton) {
          window._vwlAttachDeferredButton(card, async () => {
            if (!window._anikotoSearchByTitle) return null;
            const aniKey = await window._anikotoSearchByTitle(title);
            if (!aniKey) return null;
            return { key: aniKey, title, image: poster, cat: "anime" };
          });
        }

        ml.appendChild(card);
      });
    }
  }

  // ── Search input handler (REPLACES the existing one) ─────────────
  document.getElementById("searchInput").addEventListener("input", (e) => {
    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.style.display = e.target.value ? "block" : "none";
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = e.target.value.trim().toLowerCase();

      if (!q) {
        if (heroSection) heroSection.style.display = "";
        if (categoryContainer) categoryContainer.style.display = "";
        if (movieListWrapper) movieListWrapper.style.display = "none";
        const navBar = document.getElementById("categoryNavBar");
        if (navBar) navBar.style.display = "none";
        movieList.innerHTML = "";
        // Explicitly clean up webstreamr & anikoto search cards
        document.getElementById("movieList")
          ?.querySelectorAll(".vidsrc-card, .ani-card, .vidsrc-search-sep, .ani-search-sep")
          .forEach(el => el.remove());
        return;
      }

      if (heroSection) heroSection.style.display = "none";
      if (categoryContainer) categoryContainer.style.display = "none";
      if (movieListWrapper) movieListWrapper.style.display = "block";

      movieList.innerHTML = "";

      // ── Check for genre keyword search (e.g. "Romance", "sci-fi") ──
      // This no longer depends on query length — a word-boundary match in
      // matchGenre() already prevents false positives on longer phrases.
      const genreInfo = matchGenre(q);
      const isGenreSearch = !!genreInfo;

      // ── Local catalog search: real substring/word matching only ──
      // (no more "scrambled" results from subsequence matching — see
      // localMatchScore() above for why that was happening)
      const categoriesToCheck = ["movies", "shows", "anime", "lunora"];
      const scored = [];

      categoriesToCheck.forEach((catKey) => {
        const catData = mediaData[catKey];
        if (!catData) return;
        Object.entries(catData).forEach(([key, info]) => {
          if (info && info._hidden) return;
          const title = info.title || key;
          const score = localMatchScore(title, q);
          if (score === 0) return;
          scored.push({ catKey, key, info, score });
        });
      });

      scored.sort((a, b) => b.score - a.score);

      if (scored.length === 0 && !isGenreSearch) {
        movieList.innerHTML =
          '<p style="text-align:center; width:100%; margin-top:20px;">No results found.</p>';
      }

      // If this is also a genre search, label the local title matches so
      // it's clear they matched the title text rather than the genre itself.
      if (scored.length && isGenreSearch) {
        const titleSep = document.createElement("div");
        titleSep.className = "ani-search-sep";
        titleSep.style.cssText = "grid-column: 1/-1; display: flex; align-items: center; gap: 12px; padding: 4px 0 8px;";
        titleSep.innerHTML = `<div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div><span style="color:rgba(255,255,255,.5);font-family:'Kanit',sans-serif;font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;">Matching "${q}" by title</span><div style="flex:1;height:1px;background:rgba(255,255,255,.1);"></div>`;
        movieList.appendChild(titleSep);
      }

      scored.forEach(({ catKey, key, info }) => {
        let badgeText = "";
        let badgeBg = "";
        if (catKey === "shows" || catKey === "anime") {
            badgeText = "Virowatch";
            badgeBg = "#444444";
        } else if (catKey === "lunora") {
            badgeText = "Lunora";
            badgeBg = "#cd4ec4";
        }

        const div = document.createElement("div");
        div.className = "movie-item";
        div.dataset.movie = key;
        
        let badgeHtml = badgeText ? `<span class="vw-category-badge" style="background: ${badgeBg};">${badgeText}</span>` : "";
        
        div.innerHTML = `
            <img src="${info.image || "https://via.placeholder.com/150"}" loading="lazy"/>
            <p class="kanit-extralight">${info.title || key}</p>
            ${badgeHtml}
          `;
        div.addEventListener("click", () => {
          cat = catKey;
          selectMovie(key);
        });
        // ── FIX: Attach watchlist button to search result cards ──
        // (dataset.movie is already set above, before this runs)
        window._vwlAttachButton?.(div);
        movieList.appendChild(div);
      });

      // ── Genre search: fetch from TMDB + Anilist ──

      if (isGenreSearch) {
        await searchByGenre(q, genreInfo);
      }
    }, 200);
  });

function renderNewestAdded() {
    const listEl = document.getElementById("newestAddedList");
    if (!listEl) return;
    listEl.innerHTML = "";
    
    const animeFirst3 = Object.entries(mediaData.anime || {})
      .filter(([, v]) => !v._hidden)
      .slice(0, 3);
    const showsFirst3 = Object.entries(mediaData.shows || {}).slice(0, 3);
    
    [
      ...animeFirst3.map(([k, v]) => ({ catKey: "anime", key: k, info: v })),
      ...showsFirst3.map(([k, v]) => ({ catKey: "shows", key: k, info: v })),
    ].forEach(({ catKey, key, info }) => {
      
      const div = document.createElement("div");
      div.className = "newest-added-item";
      // Removed position: relative as it is no longer needed for badges
      div.dataset.cat = catKey;
      
      div.innerHTML = `
        <img src="${info.image || "https://via.placeholder.com/150"}" loading="lazy" alt="">
        <span>${info.title || key}</span>
      `;
      
      div.addEventListener("click", () => {
        if (heroSection) heroSection.style.display = "none";
        if (categoryContainer) categoryContainer.style.display = "none";
        if (movieListWrapper) movieListWrapper.style.display = "none";
        cat = catKey;
        selectMovie(key);
      });
      
      listEl.appendChild(div);
    });
  }

  renderNewestAdded();

  document.querySelectorAll(".cat-nav-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const c = btn.dataset.cat;
      if (!c) return;
      window._vwlCurrentCat = c;
      if (c === "lunora") {
        const loader = window.lunoraLoader;
        if (!loader) return;
        if (!loader.isLoaded()) {
          if (heroSection) heroSection.style.display = "none";
          if (movieListWrapper) movieListWrapper.style.display = "block";
          movieList.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;opacity:0.6;">Loading Movies…</div>';
          try {
            const data = await loader.load();
            mediaData.lunora = data;
          } catch (err) {
            movieList.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#e74c3c;">Failed to load Lunora. Check network.</div>';
            return;
          }
        }
      }
      renderList(c);
    });
  });

  document.querySelectorAll(".movie-item-banner").forEach((b) => {
    b.addEventListener("click", async (e) => {
      if (e.target.closest("a.category-card-link")) return;
      const c = b.dataset.category;
      if (!c) return;
      if (c === "lunora") {
        const loader = window.lunoraLoader;
        if (!loader) return;
        if (!loader.isLoaded()) {
          if (heroSection) heroSection.style.display = "none";
          if (categoryContainer) categoryContainer.style.display = "none";
          if (movieListWrapper) {
            movieListWrapper.style.display = "block";
            movieListWrapper.style.opacity = "0.6";
          }
          movieList.innerHTML = '<div class="movie-item" style="flex:1 1 100%;text-align:center;padding:40px;min-width:100%;">Loading Lunora content...</div>';
          try {
            const data = await loader.load();
            mediaData.lunora = data;
          } catch (err) {
            movieList.innerHTML = '<div class="movie-item" style="flex:1 1 100%;text-align:center;padding:40px;color:#e74c3c;min-width:100%;">Failed to load Lunora. Check network.</div>';
            return;
          }
          if (movieListWrapper) movieListWrapper.style.opacity = "";
        }
      }
      renderList(c);
    });
  });

  const dubToggle = document.querySelector(".dubbed-toggle");
  if (dubToggle) {
    dubToggle.addEventListener("click", (e) => {
      e.preventDefault();
      dubbed = !dubbed;
      saveState();
      e.target.classList.toggle("active", dubbed);
      updateEpisodeList();
      updateVideo(ep);
      updateDownloads();
      updateWatermarksAndBadges();
    });
  }

  const prevBtn = document.getElementById("prevEpisode");
  if (prevBtn)
    prevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      updateVideo(ep - 1);
      updateDownloads();
      updateWatermarksAndBadges();
    });

  const nextBtn = document.getElementById("nextEpisode");
  if (nextBtn)
    nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      updateVideo(ep + 1);
      updateDownloads();
      updateWatermarksAndBadges();
    });

  const backBtn = document.getElementById("backToCategory");
  if (backBtn)
    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      resetView();
    });

  function resetView() {
    if (episodeContainer) episodeContainer.style.display = "none";
    document.body.classList.remove("modal-open");
    if (movieListWrapper) movieListWrapper.style.display = "none";
    if (heroSection) heroSection.style.display = "";
    if (categoryContainer) categoryContainer.style.display = "";
    localStorage.removeItem("lastState");
    const sInput = document.getElementById("searchInput");
    if (sInput) sInput.value = "";
    const vid = document.getElementById("videoPlayer");
    if (vid) { vid.removeAttribute("sandbox"); vid.src = "about:blank"; }
    const navBar = document.getElementById("categoryNavBar");
    if (navBar) navBar.style.display = "none";
    const npt = document.getElementById("nowPlayingTitle");
    if (npt) npt.textContent = "";
    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.style.display = "none";
    
    let existingVirowatch = document.getElementById("virowatch-anime-shows-watermark");
    if (existingVirowatch) existingVirowatch.remove();
  }

  (function renderChangelogs() {
    if (!Array.isArray(window.changelogs)) return;
    const container = document.getElementById("changelog-container");
    if (!container) return;
    window.changelogs.forEach((log) => {
      const box = document.createElement("div");
      box.className = "changelog-box";
      box.innerHTML = `<h3>${log.version}</h3><p>${log.description}</p>`;
      container.appendChild(box);
    });
  })();

  let last = JSON.parse(localStorage.getItem("lastState") || "null");
  if (!last?.cat) {
    if (heroSection) heroSection.style.display = "flex";
    if (categoryContainer) categoryContainer.style.display = "flex";
  }
  if (
    last?.cat === "lunora" &&
    window.lunoraLoader &&
    !window.lunoraLoader.isLoaded()
  ) {
    try {
      const data = await window.lunoraLoader.load();
      mediaData.lunora = data;
    } catch (_) {
      last = null;
    }
  }
  if (last?.cat && mediaData[last.cat]?.[last.mov]) {
    renderList(last.cat);
    if (movieListWrapper) movieListWrapper.style.display = "block";
    mov = last.mov;
    season = last.season;
    ep = last.ep || 0;
    dubbed = !!last.dubbed;
    document
      .querySelector(".dubbed-toggle")
      ?.classList.toggle("active", dubbed);
    updateSeasonSelector();
    updateEpisodeList();
    
    if (episodeContainer) {
      episodeContainer.style.display = "flex";
      document.body.classList.add("modal-open");
    }
    
    setTimeout(() => {
      updateVideo(ep);
      updateDownloads();
      updateWatermarksAndBadges();
    }, 50);

    const npt = document.getElementById("nowPlayingTitle");
    if (npt)
      npt.textContent = mediaData[last.cat]?.[last.mov]?.title || last.mov;
  }

  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebarMenu = document.getElementById("sidebarMenu");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");

  if (sidebarToggle && sidebarMenu && sidebarOverlay) {
    function openSidebar() {
      sidebarMenu.classList.add("active");
      sidebarOverlay.classList.add("active");
      sidebarMenu.setAttribute("aria-hidden", "false");
    }

    function closeSidebar() {
      sidebarMenu.classList.remove("active");
      sidebarOverlay.classList.remove("active");
      sidebarMenu.setAttribute("aria-hidden", "true");
    }

    sidebarToggle.addEventListener("click", openSidebar);
    if (sidebarCloseBtn)
      sidebarCloseBtn.addEventListener("click", closeSidebar);
    sidebarOverlay.addEventListener("click", closeSidebar);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sidebarMenu.classList.contains("active")) {
        closeSidebar();
      }
    });
  }

  // ── THE FIX: Added silent parameter to load the player invisibly ──
  window.viroPlay = async function (catKey, key, silent = false) {
    if (
      catKey === "lunora" &&
      window.lunoraLoader &&
      !window.lunoraLoader.isLoaded()
    ) {
      try {
        const data = await window.lunoraLoader.load();
        mediaData.lunora = data;
      } catch (_) {
        return false;
      }
    }
    if (!mediaData[catKey] || !mediaData[catKey][key]) return false;
    
    // Set the internal category state silently
    cat = catKey;
    window._vwlCurrentCat = catKey;
    
    if (!silent) {
       renderList(catKey);
    }
    
    selectMovie(key);
    return true;
  };

});
