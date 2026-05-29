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

    if (mov === "PITSORT") {
      iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation allow-forms",
      );
    } else {
      iframe.removeAttribute("sandbox");
    }

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

  function matchesSubsequence(title, query) {
    if (!query.length) return true;
    let j = 0;
    for (let i = 0; i < title.length && j < query.length; i++) {
      if (title[i] === query[j]) j++;
    }
    return j === query.length;
  }

  function subsequenceMatchCount(title, query) {
    if (!query.length) return 0;
    let j = 0;
    for (let i = 0; i < title.length && j < query.length; i++) {
      if (title[i] === query[j]) j++;
    }
    return j;
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

  document.getElementById("searchInput").addEventListener("input", (e) => {
    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.style.display = e.target.value ? "block" : "none";
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();

      if (!q) {
        if (heroSection) heroSection.style.display = "";
        if (categoryContainer) categoryContainer.style.display = "";
        if (movieListWrapper) movieListWrapper.style.display = "none";
        const navBar = document.getElementById("categoryNavBar");
        if (navBar) navBar.style.display = "none";
        movieList.innerHTML = "";
        return;
      }

      if (heroSection) heroSection.style.display = "none";
      if (categoryContainer) categoryContainer.style.display = "none";
      if (movieListWrapper) movieListWrapper.style.display = "block";

      movieList.innerHTML = "";
      const categoriesToCheck = ["movies", "shows", "anime", "lunora"];
      const scored = [];

      categoriesToCheck.forEach((catKey) => {
        const catData = mediaData[catKey];
        if (!catData) return;
        Object.entries(catData).forEach(([key, info]) => {
          const title = (info.title || key).toLowerCase();
          const count = subsequenceMatchCount(title, q);
          if (count === 0) return;
          const exactBonus = title.includes(q) ? 0.5 : 0;
          scored.push({ catKey, key, info, score: count + exactBonus });
        });
      });

      scored.sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        movieList.innerHTML =
          '<p style="text-align:center; width:100%; margin-top:20px;">No results found.</p>';
        return;
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
        movieList.appendChild(div);
      });
    }, 150);
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
    if (vid) vid.src = ""; 
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
