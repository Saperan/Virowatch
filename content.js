document.addEventListener("DOMContentLoaded", async () => {
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

    // If it's a built-in key (e.g. 'desktop-dark'), use the map.
    // Otherwise, if it's a path like 'extra_css/style.css', use it directly.
    if (THEME_HREF[key]) return THEME_HREF[key];
    return key;
  }

  const themeSelect = document.getElementById("app-sidebar-theme-select");

  // Theme: apply by key or custom file path
  function applyTheme(key) {
    if (linkEl) linkEl.href = resolveThemeHref(key);
    // Home UI (virohome.css) picks light/dark tokens from this attribute
    document.documentElement.setAttribute(
      "data-vw-theme",
      resolveThemeHref(key) || "",
    );
    localStorage.setItem("theme", key);

    if (themeSelect) {
      // Check if the option already exists in the dropdown
      let exists = Array.from(themeSelect.options).some(
        (opt) => opt.value === key,
      );

      // If it's a custom style and NOT in the dropdown yet, add it so it shows up
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

  // When theme is Auto, re-apply on resize so layout follows viewport
  window.addEventListener("resize", () => {
    if (localStorage.getItem("theme") === "auto" && linkEl) {
      linkEl.href = resolveThemeHref("auto");
      document.documentElement.setAttribute("data-vw-theme", linkEl.href);
    }
  });

  // --- Custom CSS (saved locally, inject into page, removable) ---
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

  // Save and Load State
  function saveState() {
    localStorage.setItem(
      "lastState",
      JSON.stringify({ cat, mov, season, ep, dubbed }),
    );
    updateContinueWatching();
    // Lets other modules (vidnest-loader.js) know what's actually playing
    // without reaching into this closure's private state.
    window.dispatchEvent(
      new CustomEvent("vw-nowplaying", { detail: { cat, mov, season, ep, dubbed } }),
    );
  }

  // Continue watching list (drives the rail section in virohome.js)
  const CW_KEY = "vw_continue";
  function updateContinueWatching() {
    if (!cat || !mov || mov === "PITSORT") return; // live sports aren't resumable
    const info = mediaData[cat]?.[mov];
    if (!info) return;
    const data = activeData();
    const total = (
      dubbed && data?.dubbed?.length ? data.dubbed : data?.video || []
    ).length;
    const sData = season ? info[season] : null;
    const entry = {
      cat,
      mov,
      season,
      ep,
      dubbed,
      title: info.title || mov,
      image: info.image || "",
      total,
      seasonLabel:
        (sData && sData.chapter) ||
        (season && season.indexOf("ANI_") !== 0 ? season : ""),
      t: Date.now(),
    };
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(CW_KEY) || "[]");
    } catch (_) {}
    list = list.filter((i) => !(i.cat === cat && i.mov === mov));
    list.unshift(entry);
    localStorage.setItem(CW_KEY, JSON.stringify(list.slice(0, 4)));
    window.dispatchEvent(new CustomEvent("vw-cw-updated"));
  }

  // Helpers
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

  // Elements
  const movieListWrapper = document.getElementById("movieListWrapper");
  const movieList = document.getElementById("movieList");
  const categoryContainer = document.getElementById("categoryContainer");
  const episodeContainer = document.getElementById("episodeContainer");
  const seasonSelectorContainer = document.getElementById(
    "seasonSelectorContainer",
  );
  const heroSection = document.getElementById("hero"); // Ensure this matches HTML ID if used

  // Render list for a specific category (Menu clicks)
  function renderList(category) {
    cat = category;
    window._vwlCurrentCat = category;
    movieList.innerHTML = "";
    Object.entries(mediaData[category] || {}).forEach(([key, info]) => {
      if (info && info._hidden) return; // skip Anikoto entries injected by anikoto-loader
      const div = document.createElement("div");
      div.className = "movie-item";
      div.dataset.movie = key;
      div.innerHTML = `<img src="${info.image || "https://via.placeholder.com/150"}" loading="lazy"/><p class="kanit-extralight">${info.title || key}</p>`;
      const clean = div.cloneNode(true);
      clean.addEventListener("click", () => selectMovie(key));
      movieList.appendChild(clean);
    });
    if (heroSection) heroSection.style.display = "none";
    if (categoryContainer) categoryContainer.style.display = "none";
    if (movieListWrapper) movieListWrapper.style.display = "block";

    // Show category nav bar with active state
    const navBar = document.getElementById("categoryNavBar");
    if (navBar) {
      navBar.style.display = "flex";
      navBar.querySelectorAll(".cat-nav-btn").forEach((btn) => {
        // Vidnest movies live in the "movies" bucket (kept separate from
        // "lunora" so a Lunora reload can't wipe injected entries), but
        // visually belong on the same Movies tab.
        btn.classList.toggle(
          "active",
          btn.dataset.cat === category ||
            (category === "movies" && btn.dataset.cat === "lunora"),
        );
      });
    }
    if (window.setRailActive) window.setRailActive(category);

    const clContainer = document.getElementById("changelog-container");
    if (clContainer) clContainer.style.marginTop = "20px";
  }

  // Select movie (Load Player) — optionally start at a season/episode
  function selectMovie(key, startSeason, startEp) {
    mov = key;
    ep = 0;
    season =
      startSeason && mediaData[cat]?.[key]?.[startSeason] ? startSeason : null;
    dubbed = false;
    saveState();
    document.querySelector(".dubbed-toggle")?.classList.remove("active");
    // Update now-playing title
    const npt = document.getElementById("nowPlayingTitle");
    if (npt) npt.textContent = mediaData[cat]?.[key]?.title || key;

    // ── PitSport: data arrives async, handle loading state ───────
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
        // Show the player area immediately with a loading indicator
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
          // Kick off the fetch if it hasn't started yet
          if (
            !window._pitsportLoading &&
            typeof window.reloadPitSport === "function"
          ) {
            window.reloadPitSport();
          }
        }
        // The pitsportReady listener below will finish rendering once data arrives
        return;
      }
    }
    // ── Normal path ───────────────────────────────────────────────
    updateSeasonSelector();
    updateEpisodeList();
    const startIndex =
      Number.isInteger(startEp) &&
      startEp > 0 &&
      (activeData()?.video || [])[startEp]
        ? startEp
        : 0;
    updateVideo(startIndex);
    updateDownloads();
    if (episodeContainer) {
      episodeContainer.style.display = "flex";
      document.body.classList.add("modal-open");
      if (window.vwSettingsClose) window.vwSettingsClose(); // close settings popup if open
    }
  }

  // When PitSport finishes loading, refresh the player if it's currently open
  window.addEventListener("pitsportReady", () => {
    if (cat === "shows" && mov === "PITSORT") {
      ep = 0;
      season = null;
      updateSeasonSelector();
      updateEpisodeList();
      updateVideo(0);
      updateDownloads();
    }
  });

  // Update season dropdown
  function updateSeasonSelector() {
    seasonSelectorContainer.innerHTML = "";
    const data = currentData();
    if (!data) return;
    const seasons = Object.keys(data).filter(
      (k) => !RESERVED_KEYS.includes(k) && typeof data[k] === "object",
    );
    if (!seasons.length) return;
    const select = document.createElement("select");
    select.id = "seasonSelector";
    seasons.forEach((s, i) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = data[s].chapter || s;
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
    });
    seasonSelectorContainer.appendChild(select);
  }

  // Update episode list
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
      div.addEventListener("click", () => updateVideo(i));
      container.appendChild(div);
    });
  }

  // Update video player
  function updateVideo(index) {
    const data = activeData();
    if (!data) return;
    const vids = dubbed && data.dubbed?.length ? data.dubbed : data.video || [];
    if (!vids[index]) return;
    if (spinner) spinner.style.display = "block";
    const iframe = document.getElementById("videoPlayer");

    // pitsport.xyz sends X-Frame-Options: sameorigin, so its own pages (the
    // "no events" fallback + /watch pages) can't be framed. Framing them just
    // shows a blank box + console error. Detect that and show a manual
    // open-in-new-tab panel instead of trying to embed it.
    if (/^https?:\/\/(www\.)?pitsport\.xyz\//i.test(vids[index])) {
      showPitsportFallback(vids[index]);
      ep = index;
      saveState();
      highlightEpisode(index);
      return;
    }
    clearPitsportFallback();

    // PitSport's sports embeds spawn popup/redirect tabs. Sandbox them WITHOUT
    // allow-popups / allow-top-navigation so those windows can't open, while
    // still allowing scripts + same-origin so the player runs. Every other
    // provider (MegaPlay, Vidnest) detects a sandbox and refuses to play, so
    // they stay unsandboxed — Vidnest's own popup/redirect ads are instead
    // mitigated by vidnest-loader.js's click-shield overlay.
    if (cat === "shows" && mov === "PITSORT") {
      iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-forms allow-presentation",
      );
    } else {
      iframe.removeAttribute("sandbox");
    }
    iframe.removeAttribute("referrerpolicy");

    iframe.classList.add("fade-out");
    iframe.onload = () =>
      setTimeout(() => {
        if (spinner) spinner.style.display = "none";
        iframe.classList.remove("fade-out");
      }, 200);
    iframe.src = vids[index];
    ep = index;
    saveState();
    highlightEpisode(index);
  }

  // Show a "can't embed — open externally" panel over the player. Used when
  // PitSport has no live events (fallback) or hands back a pitsport.xyz page.
  function showPitsportFallback(url) {
    const iframe = document.getElementById("videoPlayer");
    if (iframe) { iframe.src = "about:blank"; iframe.style.display = "none"; }
    if (spinner) spinner.style.display = "none";
    const player = document.querySelector(".player");
    if (!player) return;
    let box = document.getElementById("pitsportFallback");
    if (!box) {
      box = document.createElement("div");
      box.id = "pitsportFallback";
      box.style.cssText =
        "position:absolute;inset:0;display:flex;flex-direction:column;" +
        "align-items:center;justify-content:center;gap:14px;text-align:center;" +
        "background:#0d0d10;color:#eee;padding:24px;z-index:5;" +
        'font-family:"Kanit",sans-serif;';
      player.insertBefore(box, player.firstChild);
    }
    box.innerHTML =
      '<div style="font-size:1.1rem;font-weight:600;">No live PitSport event right now</div>' +
      '<div style="opacity:.7;max-width:420px;font-size:.9rem;">' +
      "PitSport can't be embedded here, so it opens in a new tab. " +
      "Check back when an event is live.</div>";
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "button";
    a.textContent = "↗ Open PitSport Live";
    box.appendChild(a);
    box.style.display = "flex";
  }

  function clearPitsportFallback() {
    const box = document.getElementById("pitsportFallback");
    if (box) box.style.display = "none";
    const iframe = document.getElementById("videoPlayer");
    if (iframe) iframe.style.display = "";
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
    else dc.innerHTML = ""; // nothing to show when no downloads
  }

  // ==========================================
  //  UPDATED SEARCH LOGIC (Mixes all content)
  // ==========================================
  // Subsequence match: query letters appear in title in order (not necessarily consecutive)
  function matchesSubsequence(title, query) {
    if (!query.length) return true;
    let j = 0;
    for (let i = 0; i < title.length && j < query.length; i++) {
      if (title[i] === query[j]) j++;
    }
    return j === query.length;
  }

  // How many query letters appear in title in order (0..query.length). Used to rank "closest" matches.
  function subsequenceMatchCount(title, query) {
    if (!query.length) return 0;
    let j = 0;
    for (let i = 0; i < title.length && j < query.length; i++) {
      if (title[i] === query[j]) j++;
    }
    return j;
  }

  // Search clear button
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

  document.getElementById("searchInput").addEventListener("input", (e) => {
    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.style.display = e.target.value ? "block" : "none";
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = e.target.value.trim().toLowerCase();

      // 1. If empty, go back to Categories
      if (!q) {
        if (heroSection) heroSection.style.display = "";
        if (categoryContainer) categoryContainer.style.display = "";
        if (movieListWrapper) movieListWrapper.style.display = "none";
        const navBar = document.getElementById("categoryNavBar");
        if (navBar) navBar.style.display = "none";
        movieList.innerHTML = "";
        return;
      }

      // 2. If typing, Hide Categories & Show List Wrapper
      if (heroSection) heroSection.style.display = "none";
      if (categoryContainer) categoryContainer.style.display = "none";
      if (movieListWrapper) movieListWrapper.style.display = "block";

      // 3. Unified ranked search: native catalog + Anikoto index.
      //    Best matches first, showing the top 10 with a "Load more" button.
      movieList.innerHTML = "";
      const categoriesToCheck = ["movies", "shows", "anime", "lunora"];
      const scored = [];

      const scoreTitle = (title) => {
        const t = (title || "").toLowerCase();
        if (!t) return 0;
        if (t === q) return 1000;
        if (t.startsWith(q)) return 600 - Math.min(200, t.length);
        if (t.includes(q)) return 400 - Math.min(200, t.length);
        let j = 0;
        for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) j++;
        return j === q.length ? 120 - Math.min(100, t.length) : 0;
      };

      categoriesToCheck.forEach((catKey) => {
        const catData = mediaData[catKey];
        if (!catData) return;
        Object.entries(catData).forEach(([key, info]) => {
          if (info._hidden) return; // skip hidden/anikoto-injected dupes
          const s = scoreTitle(info.title || key);
          if (s <= 0) return;
          scored.push({
            score: s,
            img: info.image,
            title: info.title || key,
            key: key,
            catKey: catKey,
            open: () => { cat = catKey; selectMovie(key); },
          });
        });
      });

      // Fold in Anikoto results (full catalog once its index is built).
      if (window.anikotoSearch) {
        window.anikotoSearch(q).forEach((a) => {
          scored.push({
            score: a.score,
            img: a.poster,
            title: a.title,
            aniId: a.id,
            open: () => window.openAnikotoById?.(a.id),
          });
        });
      }

      // Fold in Vidnest results (TMDB movies/shows + AniList anime) — a
      // real search API on each, so this is a live network round trip
      // rather than a prebuilt index like Anikoto's.
      if (window.vidnestSearch) {
        try {
          (await window.vidnestSearch(q)).forEach((v) => scored.push(v));
        } catch (_) {}
      }

      scored.sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        movieList.innerHTML =
          '<p style="text-align:center; width:100%; margin-top:20px;">No results found.</p>';
        return;
      }

      let shown = 0;
      const PAGE = 10;
      const renderChunk = () => {
        movieList.querySelector(".search-load-more")?.remove();
        scored.slice(shown, shown + PAGE).forEach((item) => {
          const div = document.createElement("div");
          div.className = "movie-item";
          if (item.aniId != null) div.dataset.aniId = String(item.aniId);
          else { div.dataset.movie = item.key; div.dataset.cat = item.catKey; }
          div.innerHTML =
            `<img src="${item.img || "https://via.placeholder.com/150"}" loading="lazy"/>` +
            `<p class="kanit-extralight">${item.title}</p>`;
          div.addEventListener("click", item.open);
          movieList.appendChild(div);
        });
        shown += Math.min(PAGE, scored.length - shown);
        if (shown < scored.length) {
          const btn = document.createElement("button");
          btn.className = "search-load-more";
          btn.textContent = `Load more (${scored.length - shown})`;
          btn.style.cssText =
            "grid-column:1/-1;margin:16px auto;padding:9px 22px;border-radius:99px;" +
            "background:var(--vw-chip-bg,rgba(255,255,255,.08));" +
            "border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));" +
            "color:var(--vw-text,#eaeaea);font-size:.85rem;cursor:pointer;" +
            "transition:background .18s ease,border-color .18s ease;";
          btn.addEventListener("click", renderChunk);
          movieList.appendChild(btn);
        }
      };
      renderChunk();
    }, 300);
  });

  // Newest added: hero (featured = #1) + poster grid — first 6 streaming
  // anime from Anikoto, then the native Virowatch anime + shows.
  function renderNewestAdded() {
    const listEl = document.getElementById("newestAddedList");
    if (!listEl) return;
    listEl.innerHTML = "";
    const aniRecent = (
      typeof window.anikotoRecent === "function" ? window.anikotoRecent() : []
    )
      .slice(0, 6)
      .map((a) => ({
        catKey: "anime",
        key: "ANI_" + a.id,
        aniId: a.id,
        info: { title: a.title || "", image: a.poster || "" },
      }));
    const animeFirst = Object.entries(mediaData.anime || {})
      .filter(([, v]) => !v._hidden)
      .slice(0, 4);
    const showsFirst = Object.entries(mediaData.shows || {})
      .filter(([k]) => k !== "PITSORT")
      .slice(0, 4);
    const items = [
      ...aniRecent,
      ...animeFirst.map(([k, v]) => ({ catKey: "anime", key: k, info: v })),
      ...showsFirst.map(([k, v]) => ({ catKey: "shows", key: k, info: v })),
    ];

    const playItem = (item) => {
      if (item.aniId) {
        // Anikoto title — fetch + inject episodes, then viroPlay takes over
        window.openAnikotoById?.(item.aniId);
        return;
      }
      if (heroSection) heroSection.style.display = "none";
      if (categoryContainer) categoryContainer.style.display = "none";
      if (movieListWrapper) movieListWrapper.style.display = "none";
      cat = item.catKey;
      selectMovie(item.key);
    };

    // ── Hero = newest added #1, then follows the last hovered poster ──
    const featured = items[0];
    const heroArt = document.getElementById("heroArt");
    const heroTitle = document.getElementById("heroTitle");
    const heroTags = document.getElementById("heroTags");
    const heroWatch = document.getElementById("heroWatchBtn");
    const heroWl = document.getElementById("heroWlBtn");

    const setHero = (item) => {
      if (!item || !heroArt || !heroTitle) return;
      const { catKey, key, info } = item;
      heroArt.style.backgroundImage = info.image
        ? `url("${info.image}")`
        : "";
      heroTitle.textContent = info.title || key;
      if (heroTags) {
        heroTags.innerHTML = "";
        const labels = [catKey === "anime" ? "Anime" : "TV Show"];
        if (item === featured) labels.push("New");
        labels.forEach((label) => {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = label;
          heroTags.appendChild(tag);
        });
      }
      if (heroWatch) heroWatch.onclick = () => playItem(item);
      if (heroWl) {
        heroWl.dataset.key = key;
        const syncWl = () => {
          heroWl.textContent = window.vwlHas?.(key)
            ? "✓ In watchlist"
            : "+ Watchlist";
        };
        syncWl();
        heroWl.onclick = () => {
          const payload = {
            key,
            title: info.title || key,
            image: info.image || "",
            cat: catKey,
          };
          if (item.aniId) payload.aniId = Number(item.aniId);
          window.vwlToggle?.(payload);
          syncWl();
        };
      }
    };
    if (featured) setHero(featured);

    // ── Poster grid ──
    items.forEach((item, idx) => {
      const { catKey, key, info } = item;
      const div = document.createElement("div");
      div.className = "poster";
      if (item.aniId) {
        div.dataset.aniId = String(item.aniId); // watchlist button reads this
      } else {
        div.dataset.cat = catKey;
        div.dataset.movie = key;
      }

      const img = document.createElement("img");
      img.src = info.image || "https://via.placeholder.com/150";
      img.loading = "lazy";
      img.alt = "";

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent =
        idx === 0 ? "NEW" : catKey === "anime" ? "ANIME" : "TV";

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = info.title || key;

      div.appendChild(img);
      div.appendChild(badge);
      div.appendChild(title);
      // Same +/✓ button as the movie grid (watchlist.js owns look + state).
      window.vwlAttachButton?.(div);
      div.addEventListener("click", () => playItem(item));
      // Hero follows the last hovered poster (140ms intent so sweeping
      // across the row doesn't strobe the banner)
      let heroTid;
      div.addEventListener("mouseenter", () => {
        heroTid = setTimeout(() => setHero(item), 140);
      });
      div.addEventListener("mouseleave", () => clearTimeout(heroTid));
      listEl.appendChild(div);
    });
  }
  renderNewestAdded();
  // Re-render once the Anikoto first page arrives (it loads async)
  window.addEventListener("anikoto-recent", renderNewestAdded);

  // Category Nav Bar + rail button clicks
  document.querySelectorAll(".cat-nav-btn, .rail-item[data-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const c = btn.dataset.cat;
      if (!c) return;
      window._vwlCurrentCat = c;
      if (c === "lunora") {
        const loader = window.lunoraLoader;
        if (!loader) {
          console.warn("Lunora loader not available");
          return;
        }
        if (!loader.isLoaded()) {
          if (heroSection) heroSection.style.display = "none";
          if (movieListWrapper) movieListWrapper.style.display = "block";
          movieList.innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:40px;opacity:0.6;">Loading Movies…</div>';
          try {
            const data = await loader.load();
            mediaData.lunora = data;
          } catch (err) {
            movieList.innerHTML =
              '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#e74c3c;">Failed to load Lunora. Check network.</div>';
            return;
          }
        }
      }
      renderList(c);
    });
  });

  // Category Banners Click (only the category cards, not the link inside Movies)
  document.querySelectorAll(".movie-item-banner").forEach((b) => {
    b.addEventListener("click", async (e) => {
      if (e.target.closest("a.category-card-link")) return;
      const c = b.dataset.category;
      if (!c) return;
      if (c === "lunora") {
        const loader = window.lunoraLoader;
        if (!loader) {
          console.warn("Lunora loader not available");
          return;
        }
        if (!loader.isLoaded()) {
          if (heroSection) heroSection.style.display = "none";
          if (categoryContainer) categoryContainer.style.display = "none";
          if (movieListWrapper) {
            movieListWrapper.style.display = "block";
            movieListWrapper.style.opacity = "0.6";
          }
          movieList.innerHTML =
            '<div class="movie-item" style="flex:1 1 100%;text-align:center;padding:40px;min-width:100%;">Loading Lunora content...</div>';
          try {
            const data = await loader.load();
            mediaData.lunora = data;
          } catch (err) {
            movieList.innerHTML =
              '<div class="movie-item" style="flex:1 1 100%;text-align:center;padding:40px;color:#e74c3c;min-width:100%;">Failed to load Lunora. Check network.</div>';
            return;
          }
          if (movieListWrapper) movieListWrapper.style.opacity = "";
        }
      }
      renderList(c);
    });
  });

  // Dubbed Toggle
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
    });
  }

  // Player Buttons
  const prevBtn = document.getElementById("prevEpisode");
  if (prevBtn)
    prevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      updateVideo(ep - 1);
      updateDownloads();
    });

  const nextBtn = document.getElementById("nextEpisode");
  if (nextBtn)
    nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      updateVideo(ep + 1);
      updateDownloads();
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
    // Vidnest's browse-grid sections (vidnest-loader.js) key their own
    // visibility off this — never reset here before, so anything that plays
    // through the same cat value the grid checks (shows) stayed visible on
    // the home page after Back.
    window._vwlCurrentCat = "home";
    // Clear search on back
    const sInput = document.getElementById("searchInput");
    if (sInput) sInput.value = "";
    const vid = document.getElementById("videoPlayer");
    // removeAttribute, not vid.src = "" — an empty string src resolves to the
    // current document's own URL, which on file:// pages makes Chromium log
    // "Unsafe attempt to load URL ... from frame with URL ..." (it blocks the
    // load, so nothing actually breaks, but removeAttribute avoids the noise
    // and skips the pointless resolve+block cycle entirely).
    if (vid) vid.removeAttribute("src"); // Stop audio
    // Force-stop any active Vidnest direct-play video synchronously — don't
    // rely solely on it reacting to the src clear above (that path lost a
    // race on a slower connection and left the video visible).
    if (window.vwVidnestStopAll) window.vwVidnestStopAll();
    // Hide category nav bar and clear now-playing
    const navBar = document.getElementById("categoryNavBar");
    if (navBar) navBar.style.display = "none";
    const npt = document.getElementById("nowPlayingTitle");
    if (npt) npt.textContent = "";
    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.style.display = "none";
    if (window.setRailActive) window.setRailActive("home");
  }

  // Render Changelogs
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

  // Ensure hero/category use explicit flex on initial load (matches wider layout when returning via title)
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
    updateVideo(ep);
    updateDownloads();
    if (episodeContainer) {
      episodeContainer.style.display = "flex";
      document.body.classList.add("modal-open");
    }
    // Restore now-playing title
    const npt = document.getElementById("nowPlayingTitle");
    if (npt)
      npt.textContent = mediaData[last.cat]?.[last.mov]?.title || last.mov;
  }

  // Sidebar Logic
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

  // Expose for watchlist (and any external module) to load content directly
  window.viroPlay = async function (catKey, key) {
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
    cat = catKey;
    renderList(catKey);
    selectMovie(key);
    return true;
  };

  // Resume a title at a specific season/episode (rail Continue watching +
  // the live-sports strip use this).
  window.viroResume = async function (catKey, key, seasonKey, epIndex, dub) {
    if (
      catKey === "anime" &&
      typeof key === "string" &&
      key.indexOf("ANI_") === 0 &&
      !mediaData.anime?.[key]
    ) {
      // Anikoto entry not injected yet — fetch it (this also starts playback)
      if (typeof window.openAnikotoById !== "function") return false;
      const ok = await window.openAnikotoById(key.slice(4));
      if (!ok) return false;
    } else if (
      typeof key === "string" &&
      /^VD[MTA]_/.test(key) &&
      !mediaData[catKey]?.[key]
    ) {
      if (typeof window.openVidnestById !== "function") return false;
      const ok = await window.openVidnestById(key);
      if (!ok) return false;
    } else {
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
      cat = catKey;
      renderList(catKey);
    }
    cat = catKey;
    selectMovie(key, seasonKey, epIndex);
    if (dub) {
      dubbed = true;
      document.querySelector(".dubbed-toggle")?.classList.add("active");
      updateEpisodeList();
      updateVideo(ep);
      updateDownloads();
      saveState();
    }
    return true;
  };

  // Rail "Home" / brand clicks land here (virohome.js)
  window.viroHome = resetView;
});
