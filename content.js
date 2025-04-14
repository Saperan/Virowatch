document.addEventListener("DOMContentLoaded", () => {
  const toggleImage = document.getElementById('toggleStylesheetImage');
  const stylesheetLink = document.querySelector('link[rel="stylesheet"]');
  const stylesheetA = "virostyle.css";
  const stylesheetB = "virostyle2.css";
  const themeImageA = "theme1.png";
  const themeImageB = "theme2.png";

  toggleImage.addEventListener("click", () => {
    if (stylesheetLink.getAttribute("href") === stylesheetA) {
      stylesheetLink.setAttribute("href", stylesheetB);
      toggleImage.setAttribute("src", themeImageB);
    } else {
      stylesheetLink.setAttribute("href", stylesheetA);
      toggleImage.setAttribute("src", themeImageA);
    }
  });

  // Changelogs (ensure changelogs is defined)
  const container = document.getElementById('changelog-container');
  if (typeof changelogs !== "undefined" && Array.isArray(changelogs)) {
    changelogs.forEach(log => {
      const box = document.createElement('div');
      box.className = 'changelog-box';
      box.innerHTML = `<h3>${log.version}</h3><p>${log.description}</p>`;
      container.appendChild(box);
    });
  }

  const categoryContainer = document.getElementById('categoryContainer');
  const movieListWrapper = document.getElementById('movieListWrapper');
  const movieList = document.getElementById('movieList');
  const videoPlayer = document.getElementById('videoPlayer');
  const searchInput = document.getElementById('searchInput');
  const episodeContainer = document.getElementById('episodeContainer');
  // Sidebar now contains two containers: one for the season dropdown and one for episodes.
  const seasonSelectorContainer = document.getElementById('seasonSelectorContainer');
  const episodeListContainer = document.getElementById('episodeListContainer');
  const nextEpisodeButton = document.getElementById('nextEpisode');
  const prevEpisodeButton = document.getElementById('prevEpisode');
  const downloadContainer = document.getElementById('downloadContainer');
  const banners = document.querySelectorAll('.movie-item-banner');
  const dubbedButton = document.querySelector('.dubbed-toggle'); 
  let debounceTimer;
  
  let currentMovie = null;
  let currentEpisode = 0;
  let currentCategory = null; // "movies", "shows", or "anime"
  let currentDubbed = false; 
  let currentSeason = null; // holds the key for the selected season

  // Helper: Get the base movie data from the current category.
  function getCurrentMovieData() {
    if (!currentCategory) return null;
    return window[currentCategory][currentMovie] || null;
  }

  // Returns the active media data (season-specific if available)
  function getActiveMediaData() {
    const movieData = getCurrentMovieData();
    if (!movieData) return null;
    // If a season is selected and exists in the movieData, return that season’s data.
    if (currentSeason && movieData[currentSeason]) {
      return movieData[currentSeason];
    }
    // Otherwise, if season keys exist, default to the first season.
    const seasonKeys = Object.keys(movieData).filter(key =>
      !['title', 'image', 'video', 'episodeTitles', 'customDownloads', 'dubbed', 'dubbedepisodetitle', 'dubbedcustomdownloads'].includes(key)
    );
    if (seasonKeys.length > 0) {
      currentSeason = seasonKeys[0];
      return movieData[currentSeason];
    }
    // Else assume the movieData itself is the media data.
    return movieData;
  }

  // Build/update the season dropdown in the sidebar.
  function updateSeasonSelector() {
    if (!seasonSelectorContainer) return;
    seasonSelectorContainer.innerHTML = '';
    const movieData = getCurrentMovieData();
    if (!movieData) return;

    // Filter keys that are season objects.
    const seasonKeys = Object.keys(movieData).filter(key =>
      !['title', 'image', 'video', 'episodeTitles', 'customDownloads', 'dubbed', 'dubbedepisodetitle', 'dubbedcustomdownloads'].includes(key)
      && typeof movieData[key] === "object"
    );

    if (seasonKeys.length > 0) {
      const select = document.createElement('select');
      select.id = 'seasonSelector';

      // Create an option for each season.
      seasonKeys.forEach((key, index) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = movieData[key].chapter || key;
        // Automatically select the first season.
        if (index === 0) {
          option.selected = true;
          currentSeason = key;
        }
        select.appendChild(option);
      });

      select.addEventListener('change', (e) => {
        currentSeason = e.target.value;
        currentEpisode = 0;
        updateEpisodeSidebar();
        updateVideoPlayer(0);
        updateDownloadButton();
      });

      seasonSelectorContainer.appendChild(select);
    }
  }

  // Render the movie list based on the selected category.
  function renderMovieList(category) {
    currentCategory = category;
    movieList.innerHTML = ''; 
    const data = window[category]; 
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        const movieItem = document.createElement('div');
        movieItem.classList.add('movie-item');
        movieItem.dataset.movie = key;
    
        const img = document.createElement('img');
        img.src = data[key].image || 'https://via.placeholder.com/150?text=' + key;
        img.alt = data[key].title || key;
        movieItem.appendChild(img);
    
        const p = document.createElement('p');
        p.classList.add('kanit-extralight');
        p.textContent = data[key].title || key;
        movieItem.appendChild(p);
    
        movieItem.addEventListener('click', () => {
          currentMovie = key;
          currentEpisode = 0;
          currentSeason = null; // reset season on new movie selection
          currentDubbed = false;
          if (dubbedButton) {
              dubbedButton.classList.remove('active');
          }
          // Update season selector if multiple seasons exist.
          updateSeasonSelector();
          // Update episodes and video using the active media data.
          updateEpisodeSidebar();
          updateVideoPlayer(0);
          updateDownloadButton();
          episodeContainer.style.display = 'flex';
        });
    
        movieList.appendChild(movieItem);
      }
    }
  }

  // Category banner event listeners.
  banners.forEach(banner => {
    banner.addEventListener('click', (e) => {
      if (e.target.closest('.movie-item') && banner.contains(e.target.closest('.movie-item'))) {
        return;
      }
      let category;
      if (banner.dataset.movie === 'banner1') {
        category = 'movies';
      } else if (banner.dataset.movie === 'banner2') {
        category = 'shows';
      } else if (banner.dataset.movie === 'banner3') {
        category = 'anime';
      }
      if (category) {
        container.style.display = 'none';
        categoryContainer.style.display = 'none';
        movieListWrapper.style.display = 'block';
        renderMovieList(category);
      }
    });

    const nestedItems = banner.querySelectorAll('.movie-item');
    nestedItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        let category;
        if (banner.dataset.movie === 'banner1') {
          category = 'movies';
        } else if (banner.dataset.movie === 'banner2') {
          category = 'shows';
        } else if (banner.dataset.movie === 'banner3') {
          category = 'anime';
        }
        if (category) {
          currentCategory = category;
          currentMovie = item.dataset.movie;
          currentEpisode = 0;
          currentSeason = null;
          currentDubbed = false;
          if (dubbedButton) {
              dubbedButton.classList.remove('active');
          }
          container.style.display = 'none';
          categoryContainer.style.display = 'none';
          movieListWrapper.style.display = 'block';
          updateSeasonSelector();
          updateEpisodeSidebar();
          updateVideoPlayer(0);
          updateDownloadButton();
          episodeContainer.style.display = 'flex';
        }
      });
    });
  });

  // Update the video player to the given episode index using the active media data.
  function updateVideoPlayer(index) {
    const mediaData = getActiveMediaData();
    if (mediaData) {
      let videoArray = mediaData.video;
      if (currentDubbed && mediaData.dubbed && mediaData.dubbed.length > 0) {
        videoArray = mediaData.dubbed;
      }
      if (videoArray && videoArray[index]) {
        videoPlayer.src = videoArray[index];
        currentEpisode = index;
        updateActiveEpisodeUI(index);
      }
    }
  }

  // Update which episode is active in the episode list container.
  function updateActiveEpisodeUI(index) {
    document.querySelectorAll('.episode').forEach(ep => ep.classList.remove('active'));
    const episodes = document.querySelectorAll('.episode');
    if (episodes[index]) episodes[index].classList.add('active');
  }

  // Update the download links for the current episode.
  function updateDownloadButton() {
    downloadContainer.innerHTML = '';
    const mediaData = getActiveMediaData();
    if (!mediaData) return;
    let downloadsArray = mediaData.customDownloads;
    if (currentDubbed && mediaData.dubbedcustomdownloads && mediaData.dubbedcustomdownloads.length > 0) {
      downloadsArray = mediaData.dubbedcustomdownloads;
    }
    const episodeDownloads = downloadsArray[currentEpisode] || [];
    if (episodeDownloads.length > 0) {
      episodeDownloads.forEach(download => {
        const downloadButton = document.createElement('a');
        downloadButton.href = download.url;
        downloadButton.textContent = download.name;
        downloadButton.classList.add('button');
        downloadContainer.appendChild(downloadButton);
      });
    } else {
      const noDownloadsMessage = document.createElement('p');
      noDownloadsMessage.textContent = 'No downloads available for this episode';
      downloadContainer.appendChild(noDownloadsMessage);
    }
  }

  // Update the episode list inside the sidebar using the active media data.
  function updateEpisodeSidebar() {
    episodeListContainer.innerHTML = '';
    const mediaData = getActiveMediaData();
    if (!mediaData) return;
    let episodeTitles = mediaData.episodeTitles;
    if (currentDubbed && mediaData.dubbedepisodetitle && mediaData.dubbedepisodetitle.length > 0) {
      episodeTitles = mediaData.dubbedepisodetitle;
    }
    let videoArray = mediaData.video;
    if (currentDubbed && mediaData.dubbed && mediaData.dubbed.length > 0) {
      videoArray = mediaData.dubbed;
    }
    videoArray.forEach((videoUrl, index) => {
      const episodeDiv = document.createElement('div');
      episodeDiv.textContent = episodeTitles[index] || `Episode ${index + 1}`;
      episodeDiv.classList.add('episode');
      episodeDiv.dataset.episodeIndex = index;
      episodeDiv.addEventListener('click', () => updateVideoPlayer(index));
      episodeListContainer.appendChild(episodeDiv);
    });
  }

  nextEpisodeButton.addEventListener('click', () => {
    const mediaData = getActiveMediaData();
    if (mediaData) {
      let videoArray = mediaData.video;
      if (currentDubbed && mediaData.dubbed && mediaData.dubbed.length > 0) {
        videoArray = mediaData.dubbed;
      }
      if (currentEpisode < videoArray.length - 1) {
        updateVideoPlayer(currentEpisode + 1);
        updateDownloadButton();
      }
    }
  });

  prevEpisodeButton.addEventListener('click', () => {
    if (currentEpisode > 0) {
      updateVideoPlayer(currentEpisode - 1);
      updateDownloadButton();
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = searchInput.value.toLowerCase();
      document.querySelectorAll('.movie-item').forEach(item => {
        const title = item.querySelector('p').textContent.toLowerCase();
        item.style.display = title.includes(query) ? '' : 'none';
      });
      banners.forEach(banner => {
        banner.style.display = query ? 'none' : 'block';
      });
    }, 300);
  });

  // Revised backToCategory event handler with extra logging and safety checks.
  const backToCategoryButton = document.getElementById('backToCategory');
  if (backToCategoryButton) {
    backToCategoryButton.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Back to Category button pressed.');
  
      if (videoPlayer) {
        // Check if the videoPlayer is an iframe (embedded content)
        if (videoPlayer.tagName.toLowerCase() === 'iframe') {
          console.log('Video player is an iframe. Clearing src to stop playback.');
          videoPlayer.src = '';  // Clear the source to stop the embed
        } else {
          try {
            console.log('Stopping video playback.');
            videoPlayer.pause();
            videoPlayer.currentTime = 0; // Reset playback to the beginning
            videoPlayer.removeAttribute('src'); // Remove the current video source
            videoPlayer.load(); // Reset the video element
            console.log('Video has been reset.');
          } catch (error) {
            console.error('Error while resetting video:', error);
          }
        }
      } else {
        console.warn('Video player element not found.');
      }
  
      // Navigate back to category view.
      movieList.innerHTML = '';
      movieListWrapper.style.display = 'none';
      categoryContainer.style.display = 'flex';
      episodeContainer.style.display = 'none';
      container.style.display = 'block';
      console.log('Navigation back to category complete.');
    });
  } else {
    console.error('Back to Category button not found.');
  }
  

  if (dubbedButton) {
    dubbedButton.addEventListener('click', (e) => {
      e.preventDefault();
      currentDubbed = !currentDubbed;
      dubbedButton.classList.toggle('active', currentDubbed);
      updateEpisodeSidebar();
      updateVideoPlayer(currentEpisode);
      updateDownloadButton();
    });
  }
});
