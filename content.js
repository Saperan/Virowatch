document.addEventListener('DOMContentLoaded', async () => {
  const RESERVED_KEYS = ['title','image','video','episodeTitles','customDownloads','dubbed','dubbedepisodetitle','dubbedcustomdownloads'];
  // Load all data into one object
  window.mediaData = { movies: window.movies||{}, shows: window.shows||{}, anime: window.anime||{}, lunora: {} };

  const linkEl = document.getElementById('themeStylesheet');
  const THEME_HREF = {
    'auto': null,
    'desktop-dark': 'virostyle.css',
    'desktop-light': 'virostyle-light.css',
    'mobile-dark': 'virostyle2.css',
    'mobile-light': 'virostyle2-light.css'
  };
  const spinner = document.getElementById('videoSpinner');

  // Global State
  let cat=null, mov=null, season=null, ep=0, dubbed=false, timer;

  function isMobileViewport() {
    const w = window.innerWidth, h = window.innerHeight;
    return w <= 768 || (w / h) <= (9 / 16);
  }
  function resolveThemeHref(key) {
    if (key === 'auto') return isMobileViewport() ? 'virostyle2.css' : 'virostyle.css';
    return THEME_HREF[key] || 'virostyle.css';
  }

  const themeSelect = document.getElementById('app-sidebar-theme-select');

  // Theme: apply by key (auto = detect layout; others = fixed layout + dark/light)
  function applyTheme(key) {
    if (!THEME_HREF.hasOwnProperty(key)) key = 'auto';
    if (linkEl) linkEl.href = resolveThemeHref(key);
    localStorage.setItem('theme', key);
    if (themeSelect) themeSelect.value = key;
  }

  const saved = localStorage.getItem('theme');
  applyTheme(saved && THEME_HREF.hasOwnProperty(saved) ? saved : 'auto');

  if (themeSelect) {
    themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
  }

  // When theme is Auto, re-apply on resize so layout follows viewport
  window.addEventListener('resize', () => {
    if (localStorage.getItem('theme') === 'auto' && linkEl) linkEl.href = resolveThemeHref('auto');
  });

  // --- Custom CSS (saved locally, inject into page, removable) ---
  const CUSTOM_CSS_KEY = 'virowatch_custom_css';
  const customListEl = document.getElementById('app-custom-css-list');
  const customFileInput = document.getElementById('app-custom-css-file');
  const importCssBtn = document.getElementById('app-import-css-btn');

  function getCustomCssList() {
    try {
      return JSON.parse(localStorage.getItem(CUSTOM_CSS_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function saveCustomCssList(list) {
    localStorage.setItem(CUSTOM_CSS_KEY, JSON.stringify(list));
  }

  function applyCustomCss(list) {
    list.forEach(item => {
      const existing = document.getElementById('custom-css-' + item.id);
      if (existing) existing.remove();
    });
    list.forEach(item => {
      if (item.type === 'inline') {
        const style = document.createElement('style');
        style.id = 'custom-css-' + item.id;
        style.textContent = item.value;
        document.head.appendChild(style);
      } else if (item.type === 'url' && item.value) {
        const link = document.createElement('link');
        link.id = 'custom-css-' + item.id;
        link.rel = 'stylesheet';
        link.href = item.value;
        document.head.appendChild(link);
      }
    });
  }

  function renderCustomCssList() {
    if (!customListEl) return;
    const list = getCustomCssList();
    customListEl.innerHTML = '';
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'app-sidebar-custom-item';
      const name = document.createElement('span');
      name.title = item.name;
      name.textContent = item.name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'app-sidebar-custom-remove';
      removeBtn.setAttribute('aria-label', 'Remove');
      removeBtn.dataset.id = item.id;
      removeBtn.addEventListener('click', () => {
        const arr = getCustomCssList().filter(i => i.id !== item.id);
        saveCustomCssList(arr);
        applyCustomCss(arr);
        const el = document.getElementById('custom-css-' + item.id);
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
    importCssBtn.addEventListener('click', () => customFileInput.click());
    customFileInput.addEventListener('change', () => {
      const file = customFileInput.files && customFileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const list = getCustomCssList();
        const id = 'custom-' + Date.now();
        list.push({ id, name: file.name || 'Custom CSS', type: 'inline', value: reader.result || '' });
        saveCustomCssList(list);
        applyCustomCss(list);
        renderCustomCssList();
      };
      reader.readAsText(file);
      customFileInput.value = '';
    });
  }

  // Save and Load State
  function saveState() {
    localStorage.setItem('lastState', JSON.stringify({ cat, mov, season, ep, dubbed }));
  }

  // Helpers
  const currentData = () => (cat && mediaData[cat] ? mediaData[cat][mov] : null);
  function activeData(){
    const data = currentData();
    if (!data) return null;
    if (season && data[season]) return data[season];
    const seasons = Object.keys(data).filter(k => !RESERVED_KEYS.includes(k) && typeof data[k]==='object');
    if (seasons.length){ season = seasons[0]; return data[season]; }
    return data;
  }

  // Elements
  const movieListWrapper = document.getElementById('movieListWrapper');
  const movieList = document.getElementById('movieList');
  const categoryContainer = document.getElementById('categoryContainer');
  const episodeContainer = document.getElementById('episodeContainer');
  const seasonSelectorContainer = document.getElementById('seasonSelectorContainer');
  const heroSection = document.getElementById('hero'); // Ensure this matches HTML ID if used

  // Render list for a specific category (Menu clicks)
  function renderList(category){
    cat = category;
    movieList.innerHTML = '';
    Object.entries(mediaData[category]||{}).forEach(([key,info]) => {
      const div = document.createElement('div');
      div.className = 'movie-item';
      div.dataset.movie = key;
      div.innerHTML = `<img src="${info.image||'https://via.placeholder.com/150'}" loading="lazy"/><p class="kanit-extralight">${info.title||key}</p>`;
      const clean = div.cloneNode(true);
      clean.addEventListener('click', () => selectMovie(key));
      movieList.appendChild(clean);
    });
    if(heroSection) heroSection.style.display = 'none';
    if(categoryContainer) categoryContainer.style.display = 'none';
    if(movieListWrapper) movieListWrapper.style.display = 'block';
    
    const clContainer = document.getElementById('changelog-container');
    if(clContainer) clContainer.style.marginTop = '20px';
  }

  // Select movie (Load Player)
  function selectMovie(key){
    mov = key; ep = 0; season = null; dubbed = false;
    saveState();
    document.querySelector('.dubbed-toggle')?.classList.remove('active');
    updateSeasonSelector(); updateEpisodeList(); updateVideo(0); updateDownloads();
    if(episodeContainer) episodeContainer.style.display = 'flex';
  }

  // Update season dropdown
  function updateSeasonSelector(){
    seasonSelectorContainer.innerHTML = '';
    const data = currentData(); if (!data) return;
    const seasons = Object.keys(data).filter(k => !RESERVED_KEYS.includes(k) && typeof data[k]==='object');
    if (!seasons.length) return;
    const select = document.createElement('select');
    select.id = 'seasonSelector';
    seasons.forEach((s,i) => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = data[s].chapter||s;
      if (i===0 && !season) season = s;
      select.appendChild(opt);
    });
    select.value = season;
    select.addEventListener('change', e => { season = e.target.value; ep = 0; saveState(); updateEpisodeList(); updateVideo(0); updateDownloads(); });
    seasonSelectorContainer.appendChild(select);
  }

  // Update episode list
  function updateEpisodeList(){
    const container = document.getElementById('episodeListContainer');
    container.innerHTML = '';
    const data = activeData(); if (!data) return;
    const titles = (dubbed && data.dubbedepisodetitle?.length)? data.dubbedepisodetitle : data.episodeTitles || [];
    (data.video||[]).forEach((_,i) => {
      const div = document.createElement('div');
      div.className = 'episode'; div.textContent = titles[i] || `Episode ${i+1}`;
      div.dataset.episodeIndex = i;
      div.addEventListener('click', () => updateVideo(i));
      container.appendChild(div);
    });
  }

  // Update video player
  function updateVideo(index){
    const data = activeData(); if (!data) return;
    const vids = (dubbed && data.dubbed?.length)? data.dubbed : data.video || [];
    if (!vids[index]) return;
    if(spinner) spinner.style.display = 'block';
    const iframe = document.getElementById('videoPlayer');
    iframe.classList.add('fade-out');
    iframe.onload = () => setTimeout(() => { if(spinner) spinner.style.display = 'none'; iframe.classList.remove('fade-out'); }, 200);
    iframe.src = vids[index];
    ep = index;
    saveState();
    highlightEpisode(index);
  }

  function highlightEpisode(i){
    document.querySelectorAll('.episode').forEach(el => el.classList.remove('active'));
    document.querySelector(`.episode[data-episode-index="${i}"]`)?.classList.add('active');
  }

  function updateDownloads(){
    const dc = document.getElementById('downloadContainer'); dc.innerHTML = '';
    const data = activeData(); if (!data) return;
    const downs = (dubbed && data.dubbedcustomdownloads?.[ep]?.length)? data.dubbedcustomdownloads[ep] : data.customDownloads?.[ep] || [];
    if (downs.length) downs.forEach(d => { const a = document.createElement('a'); a.href = d.url; a.textContent = d.name; a.className = 'button'; dc.appendChild(a); });
    else dc.innerHTML = '<p>No downloads available</p>'; 
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

  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      
      // 1. If empty, go back to Categories
      if (!q) {
         if (heroSection) heroSection.style.display = '';
         if (categoryContainer) categoryContainer.style.display = '';
         if (movieListWrapper) movieListWrapper.style.display = 'none';
         movieList.innerHTML = '';
         return;
      }

      // 2. If typing, Hide Categories & Show List Wrapper
      if (heroSection) heroSection.style.display = 'none';
      if (categoryContainer) categoryContainer.style.display = 'none';
      if (movieListWrapper) movieListWrapper.style.display = 'block';
      
      // 3. Score all items: how many query letters match in order (+ bonus for exact substring)
      movieList.innerHTML = '';
      const categoriesToCheck = ['movies', 'shows', 'anime', 'lunora'];
      const scored = [];

      categoriesToCheck.forEach(catKey => {
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

      // Sort by score descending (best matches first)
      scored.sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
          movieList.innerHTML = '<p style="text-align:center; width:100%; margin-top:20px;">No results found.</p>';
          return;
      }

      scored.forEach(({ catKey, key, info }) => {
          const div = document.createElement('div');
          div.className = 'movie-item';
          div.innerHTML = `
            <img src="${info.image||'https://via.placeholder.com/150'}" loading="lazy"/>
            <p class="kanit-extralight">${info.title||key}</p>
          `;
          div.addEventListener('click', () => {
              cat = catKey;
              selectMovie(key);
          });
          movieList.appendChild(div);
      });
    }, 300);
  });

  // Newest added: first 2 anime + first 2 shows from data
  function renderNewestAdded() {
    const listEl = document.getElementById('newestAddedList');
    if (!listEl) return;
    listEl.innerHTML = '';
    const animeFirst2 = Object.entries(mediaData.anime || {}).slice(0, 2);
    const showsFirst2 = Object.entries(mediaData.shows || {}).slice(0, 2);
    [...animeFirst2.map(([k,v]) => ({ catKey: 'anime', key: k, info: v })), ...showsFirst2.map(([k,v]) => ({ catKey: 'shows', key: k, info: v }))].forEach(({ catKey, key, info }) => {
      const div = document.createElement('div');
      div.className = 'newest-added-item';
      div.innerHTML = `<img src="${info.image || 'https://via.placeholder.com/150'}" loading="lazy" alt=""><span>${info.title || key}</span>`;
      div.addEventListener('click', () => {
        if (heroSection) heroSection.style.display = 'none';
        if (categoryContainer) categoryContainer.style.display = 'none';
        if (movieListWrapper) movieListWrapper.style.display = 'none';
        cat = catKey;
        selectMovie(key);
      });
      listEl.appendChild(div);
    });
  }
  renderNewestAdded();

  // Category Banners Click (only the category cards, not the link inside Movies)
  document.querySelectorAll('.movie-item-banner').forEach(b => {
    b.addEventListener('click', async (e) => {
      if (e.target.closest('a.category-card-link')) return;
      const c = b.dataset.category;
      if (!c) return;
      if (c === 'lunora') {
        const loader = window.lunoraLoader;
        if (!loader) { console.warn('Lunora loader not available'); return; }
        if (!loader.isLoaded()) {
          if(heroSection) heroSection.style.display = 'none';
          if(categoryContainer) categoryContainer.style.display = 'none';
          if(movieListWrapper) { movieListWrapper.style.display = 'block'; movieListWrapper.style.opacity = '0.6'; }
          movieList.innerHTML = '<div class="movie-item" style="flex:1 1 100%;text-align:center;padding:40px;min-width:100%;">Loading Lunora content...</div>';
          try {
            const data = await loader.load();
            mediaData.lunora = data;
          } catch (err) {
            movieList.innerHTML = '<div class="movie-item" style="flex:1 1 100%;text-align:center;padding:40px;color:#e74c3c;min-width:100%;">Failed to load Lunora. Check network.</div>';
            return;
          }
          if(movieListWrapper) movieListWrapper.style.opacity = '';
        }
      }
      renderList(c);
    });
  });

  // Dubbed Toggle
  const dubToggle = document.querySelector('.dubbed-toggle');
  if(dubToggle) {
      dubToggle.addEventListener('click', e => {
        e.preventDefault(); dubbed = !dubbed; saveState();
        e.target.classList.toggle('active', dubbed); updateEpisodeList(); updateVideo(ep); updateDownloads();
      }); 
  }

  // Player Buttons
  const prevBtn = document.getElementById('prevEpisode');
  if(prevBtn) prevBtn.addEventListener('click', e => { e.preventDefault(); updateVideo(ep-1); updateDownloads(); });
  
  const nextBtn = document.getElementById('nextEpisode');
  if(nextBtn) nextBtn.addEventListener('click', e => { e.preventDefault(); updateVideo(ep+1); updateDownloads(); });

  const backBtn = document.getElementById('backToCategory');
  if(backBtn) backBtn.addEventListener('click', e => { e.preventDefault(); resetView(); });

  function resetView() {
    if(episodeContainer) episodeContainer.style.display = 'none';
    if(movieListWrapper) movieListWrapper.style.display = 'none';
    if(heroSection) heroSection.style.display = '';
    if(categoryContainer) categoryContainer.style.display = '';
    localStorage.removeItem('lastState');
    // Clear search on back
    const sInput = document.getElementById('searchInput');
    if(sInput) sInput.value = '';
    const vid = document.getElementById('videoPlayer');
    if(vid) vid.src = ""; // Stop audio
  }

  // Render Changelogs
  (function renderChangelogs(){
    if (!Array.isArray(window.changelogs)) return;
    const container = document.getElementById('changelog-container');
    if(!container) return;
    window.changelogs.forEach(log => {
      const box = document.createElement('div');
      box.className = 'changelog-box';
      box.innerHTML = `<h3>${log.version}</h3><p>${log.description}</p>`;
      container.appendChild(box);
    });
  })();

  // Ensure hero/category use explicit flex on initial load (matches wider layout when returning via title)
  let last = JSON.parse(localStorage.getItem('lastState') || 'null');
  if (!last?.cat) {
    if(heroSection) heroSection.style.display = 'flex';
    if(categoryContainer) categoryContainer.style.display = 'flex';
  }
  if (last?.cat === 'lunora' && window.lunoraLoader && !window.lunoraLoader.isLoaded()) {
    try {
      const data = await window.lunoraLoader.load();
      mediaData.lunora = data;
    } catch (_) { last = null; }
  }
  if (last?.cat && mediaData[last.cat]?.[last.mov]) {
    renderList(last.cat);
    if(movieListWrapper) movieListWrapper.style.display = 'block';
    mov = last.mov;
    season = last.season;
    ep = last.ep || 0;
    dubbed = !!last.dubbed;
    document.querySelector('.dubbed-toggle')?.classList.toggle('active', dubbed);
    updateSeasonSelector();
    updateEpisodeList();
    updateVideo(ep);
    updateDownloads();
    if(episodeContainer) episodeContainer.style.display = 'flex';
  }

  // Sidebar Logic
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebarMenu = document.getElementById('sidebarMenu');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

  if(sidebarToggle && sidebarMenu && sidebarOverlay) {
      function openSidebar() {
        sidebarMenu.classList.add('active');
        sidebarOverlay.classList.add('active');
        sidebarMenu.setAttribute('aria-hidden', 'false');
      }

      function closeSidebar() {
        sidebarMenu.classList.remove('active');
        sidebarOverlay.classList.remove('active');
        sidebarMenu.setAttribute('aria-hidden', 'true');
      }

      sidebarToggle.addEventListener('click', openSidebar);
      if(sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
      sidebarOverlay.addEventListener('click', closeSidebar);

      document.addEventListener('keydown', e => {
        if(e.key === 'Escape' && sidebarMenu.classList.contains('active')) {
          closeSidebar();
        }
      });
  }
});
