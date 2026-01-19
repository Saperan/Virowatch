document.addEventListener('DOMContentLoaded', () => {
  const RESERVED_KEYS = ['title','image','video','episodeTitles','customDownloads','dubbed','dubbedepisodetitle','dubbedcustomdownloads'];
  // Load all data into one object
  window.mediaData = { movies: window.movies||{}, shows: window.shows||{}, anime: window.anime||{} };

  const toggleImg = document.getElementById('toggleStylesheetImage');
  const linkEl = document.querySelector('link[rel="stylesheet"]');
  const themes = { A:{href:'virostyle.css',img:'https://i.ibb.co/5gbKJT79/pc.png'}, B:{href:'virostyle2.css',img:'https://i.ibb.co/5Wskk3Cj/phone.png'} };
  const spinner = document.getElementById('videoSpinner');

  // Global State
  let cat=null, mov=null, season=null, ep=0, dubbed=false, timer;

  // Theme Persistence
  const saved = localStorage.getItem('theme')||'A'; 
  applyTheme(saved);
  function applyTheme(key){ 
    linkEl.href=themes[key].href; 
    toggleImg.src=themes[key].img; 
    localStorage.setItem('theme', key); 
  }
  if(toggleImg) {
      toggleImg.addEventListener('click', () => applyTheme(localStorage.getItem('theme')==='A'?'B':'A'));
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
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      
      // 1. If empty, go back to Categories
      if (!q) {
         if (heroSection) heroSection.style.display = 'flex';
         if (categoryContainer) categoryContainer.style.display = 'flex';
         if (movieListWrapper) movieListWrapper.style.display = 'none';
         movieList.innerHTML = '';
         return;
      }

      // 2. If typing, Hide Categories & Show List Wrapper
      if (heroSection) heroSection.style.display = 'none';
      if (categoryContainer) categoryContainer.style.display = 'none';
      if (movieListWrapper) movieListWrapper.style.display = 'block';
      
      // 3. Clear List and Search ALL Data (Movies + Shows + Anime)
      movieList.innerHTML = '';
      let foundAny = false;
      const categoriesToCheck = ['movies', 'shows', 'anime'];

      categoriesToCheck.forEach(catKey => {
          const catData = mediaData[catKey];
          if(!catData) return;

          Object.entries(catData).forEach(([key, info]) => {
              const title = (info.title || key).toLowerCase();
              if (title.includes(q)) {
                  foundAny = true;
                  const div = document.createElement('div');
                  div.className = 'movie-item';
                  div.innerHTML = `
                    <img src="${info.image||'https://via.placeholder.com/150'}" loading="lazy"/>
                    <p class="kanit-extralight">${info.title||key}</p>
                  `;
                  
                  // CRITICAL: Set the category context on click
                  div.addEventListener('click', () => {
                      cat = catKey; // Set global 'cat' so player knows where to look
                      selectMovie(key);
                  });
                  movieList.appendChild(div);
              }
          });
      });

      if (!foundAny) {
          movieList.innerHTML = '<p style="text-align:center; width:100%; margin-top:20px;">No results found.</p>';
      }

    }, 300);
  });

  // Category Banners Click
  document.querySelectorAll('.movie-item-banner').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.category; 
    if (c) renderList(c);
  }));

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
    if(categoryContainer) categoryContainer.style.display = 'flex';
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

  // Restore State
  const last = JSON.parse(localStorage.getItem('lastState') || 'null');
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
