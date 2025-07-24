document.addEventListener('DOMContentLoaded', () => {
  const RESERVED_KEYS = ['title','image','video','episodeTitles','customDownloads','dubbed','dubbedepisodetitle','dubbedcustomdownloads'];
  window.mediaData = { movies: window.movies||{}, shows: window.shows||{}, anime: window.anime||{} };

  const toggleImg = document.getElementById('toggleStylesheetImage');
  const linkEl = document.querySelector('link[rel="stylesheet"]');
  const themes = { A:{href:'virostyle.css',img:'https://i.ibb.co/8DpKtZWR/white-mode.png'}, B:{href:'virostyle2.css',img:'https://i.ibb.co/HfgxXX6v/black-mode.png'} };
  const spinner = document.getElementById('videoSpinner');

  let cat=null, mov=null, season=null, ep=0, dubbed=false, timer;

  // Theme Persistence
  const saved = localStorage.getItem('theme')||'A'; 
  applyTheme(saved);
  function applyTheme(key){ 
    linkEl.href=themes[key].href; 
    toggleImg.src=themes[key].img; 
    localStorage.setItem('theme', key); 
  }
  toggleImg.addEventListener('click', () => applyTheme(localStorage.getItem('theme')==='A'?'B':'A'));

  // Save and Load State
  function saveState() {
    localStorage.setItem('lastState', JSON.stringify({ cat, mov, season, ep, dubbed }));
  }

  // Helpers
  const getCategoryFromBanner = banner => ({banner1:'movies',banner2:'shows',banner3:'anime'})[banner.dataset.movie];
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

  // Render movie list
  function renderList(category){
    cat = category;
    saveState();
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
    categoryContainer.style.display = 'none';
    movieListWrapper.style.display = 'block';
    document.getElementById('changelog-container').style.marginTop = '20px';
  }

  // Select movie
  function selectMovie(key){
    mov = key; ep = 0; season = null; dubbed = false;
    saveState();
    document.querySelector('.dubbed-toggle')?.classList.remove('active');
    updateSeasonSelector(); updateEpisodeList(); updateVideo(0); updateDownloads();
    episodeContainer.style.display = 'flex';
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
    spinner.style.display = 'block';
    const iframe = document.getElementById('videoPlayer');
    iframe.classList.add('fade-out');
    iframe.onload = () => setTimeout(() => { spinner.style.display = 'none'; iframe.classList.remove('fade-out'); }, 200);
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

  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('.movie-item').forEach(item => item.style.display = item.textContent.toLowerCase().includes(q)? '':'none');
      document.querySelectorAll('.movie-item-banner').forEach(b => b.style.display = q? 'none':'block');
    }, 300);
  });

  document.querySelectorAll('.movie-item-banner').forEach(b => b.addEventListener('click', () => {
    const c = getCategoryFromBanner(b);
    if (c) renderList(c);
  }));

  document.querySelector('.dubbed-toggle').addEventListener('click', e => {
    e.preventDefault(); dubbed = !dubbed; saveState();
    e.target.classList.toggle('active', dubbed); updateEpisodeList(); updateVideo(ep); updateDownloads();
  });

  document.getElementById('prevEpisode').addEventListener('click', e => { e.preventDefault(); updateVideo(ep-1); updateDownloads(); });
  document.getElementById('nextEpisode').addEventListener('click', e => { e.preventDefault(); updateVideo(ep+1); updateDownloads(); });

  document.getElementById('backToCategory').addEventListener('click', e => { e.preventDefault(); resetView(); });
  function resetView() {
    episodeContainer.style.display = 'none';
    movieListWrapper.style.display = 'none';
    categoryContainer.style.display = 'flex';
    localStorage.removeItem('lastState');
  }

  (function renderChangelogs(){
    if (!Array.isArray(window.changelogs)) return;
    const container = document.getElementById('changelog-container');
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
    mov = last.mov;
    season = last.season;
    ep = last.ep || 0;
    dubbed = !!last.dubbed;
    document.querySelector('.dubbed-toggle')?.classList.toggle('active', dubbed);
    updateSeasonSelector();
    updateEpisodeList();
    updateVideo(ep);
    updateDownloads();
    episodeContainer.style.display = 'flex';
  }

  // Sidebar Hamburger Menu Codeconst sidebarToggle = document.getElementById('sidebarToggle');
const sidebarMenu = document.getElementById('sidebarMenu');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

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
sidebarCloseBtn.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// Optional: close sidebar on pressing Escape key
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && sidebarMenu.classList.contains('active')) {
    closeSidebar();
  }
});


});
