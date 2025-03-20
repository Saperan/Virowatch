document.addEventListener("DOMContentLoaded", () => {
  const toggleImage = document.getElementById('toggleStylesheetImage');
  // Select the primary stylesheet link element
  const stylesheetLink = document.querySelector('link[rel="stylesheet"]');
  // Define the two CSS files
  const stylesheetA = "virostyle.css";
  const stylesheetB = "virostyle2.css";
  // Define the two images for each theme
  const themeImageA = "theme1.png"; // Image for stylesheetA
  const themeImageB = "theme2.png"; // Image for stylesheetB

  toggleImage.addEventListener("click", () => {
    if (stylesheetLink.getAttribute("href") === stylesheetA) {
      // Switch to alternative CSS and image
      stylesheetLink.setAttribute("href", stylesheetB);
      toggleImage.setAttribute("src", themeImageB);
    } else {
      // Switch back to original CSS and image
      stylesheetLink.setAttribute("href", stylesheetA);
      toggleImage.setAttribute("src", themeImageA);
    }
  });

  // For changelogs to work and stuff
  const container = document.getElementById('changelog-container');
  // Append changelog items – these will be visible initially (start screen)
  changelogs.forEach(log => {
    const box = document.createElement('div');
    box.className = 'changelog-box';
    box.innerHTML = `<h3>${log.version}</h3><p>${log.description}</p>`;
    container.appendChild(box);
  });

  // Define UI containers
  const categoryContainer = document.getElementById('categoryContainer');
  const movieListWrapper = document.getElementById('movieListWrapper');
  const movieList = document.getElementById('movieList');
  const videoPlayer = document.getElementById('videoPlayer');
  const searchInput = document.getElementById('searchInput');
  const episodeContainer = document.getElementById('episodeContainer');
  const episodeSidebar = document.getElementById('episodeSidebar');
  const nextEpisodeButton = document.getElementById('nextEpisode');
  const prevEpisodeButton = document.getElementById('prevEpisode');
  const downloadContainer = document.getElementById('downloadContainer');
  const banners = document.querySelectorAll('.movie-item-banner'); // Category selectors
  // Updated: using querySelector for the class "dubbed-toggle"
  const dubbedButton = document.querySelector('.dubbed-toggle'); 
  let debounceTimer;
  
  let currentMovie = null;
  let currentEpisode = 0;
  let currentCategory = null; // "movies", "shows", or "anime"
  let currentDubbed = false; // false = original; true = dubbed mode

  // Helper: Get media data for current movie from the current category
  function getCurrentMediaData() {
    if (!currentCategory) return null;
    return window[currentCategory][currentMovie] || null;
  }

  // Render the movie list based on the selected category from your JS objects
  function renderMovieList(category) {
      currentCategory = category;
      movieList.innerHTML = ''; // Clear the list
    
      const data = window[category]; // e.g., window.movies, window.shows, window.anime
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          const movieItem = document.createElement('div');
          movieItem.classList.add('movie-item');
          movieItem.dataset.movie = key;
    
          // Use the provided image; if not available, fall back to a placeholder.
          const img = document.createElement('img');
          img.src = data[key].image || 'https://via.placeholder.com/150?text=' + key;
          img.alt = data[key].title || key;
          movieItem.appendChild(img);
    
          // Use the provided title; if not available, fall back to the key.
          const p = document.createElement('p');
          p.classList.add('kanit-extralight');
          p.textContent = data[key].title || key;
          movieItem.appendChild(p);
    
          movieItem.addEventListener('click', () => {
            currentMovie = key;
            currentEpisode = 0;
            // Reset dubbed mode when a new movie is selected
            currentDubbed = false;
            if (dubbedButton) {
                dubbedButton.classList.remove('active');
            }
            const mediaData = getCurrentMediaData();
            if (mediaData) {
              updateEpisodeSidebar();
              updateVideoPlayer(0);
              updateDownloadButton();
            }
            episodeContainer.style.display = 'flex';
          });
    
          movieList.appendChild(movieItem);
        }
      }
    }

  // Category banner event listeners:
  banners.forEach(banner => {
    // Banner click for category selection
    banner.addEventListener('click', (e) => {
      // If a nested movie-item was clicked, skip banner's own click handler.
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
        // When selecting a category, hide the changelog container along with the category view.
        container.style.display = 'none';
        categoryContainer.style.display = 'none';
        movieListWrapper.style.display = 'block';
        renderMovieList(category);
      }
    });

    // Attach event listeners to any nested movie-item inside the banner
    const nestedItems = banner.querySelectorAll('.movie-item');
    nestedItems.forEach(item => {
      item.addEventListener('click', (e) => {
        // Prevent the banner's click event from firing
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
          // Reset dubbed mode when a new movie is selected
          currentDubbed = false;
          if (dubbedButton) {
              dubbedButton.classList.remove('active');
          }
          // When selecting a category, hide the changelog container.
          container.style.display = 'none';
          categoryContainer.style.display = 'none';
          movieListWrapper.style.display = 'block';
          if (getCurrentMediaData()) {
            updateEpisodeSidebar();
            updateVideoPlayer(0);
            updateDownloadButton();
          }
          episodeContainer.style.display = 'flex';
        }
      });
    });
  });

  // --- Functions for updating the player, episodes, and downloads ---

  // Update the video player to the given episode index
  function updateVideoPlayer(index) {
    const mediaData = getCurrentMediaData();
    if (mediaData) {
      // Choose video array based on dubbed mode (fallback to original if dubbed is not available)
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

  // Update which episode is active in the sidebar
  function updateActiveEpisodeUI(index) {
    document.querySelectorAll('.episode').forEach(ep => ep.classList.remove('active'));
    const episodes = document.querySelectorAll('.episode');
    if (episodes[index]) episodes[index].classList.add('active');
  }

  // Update the download links for the current episode
  function updateDownloadButton() {
    downloadContainer.innerHTML = '';
    const mediaData = getCurrentMediaData();
    if (!mediaData) return;
    // Choose downloads array based on dubbed mode (fallback to original if dubbed is not available)
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

  // Update the episode sidebar (list of episodes)
  function updateEpisodeSidebar() {
    episodeSidebar.innerHTML = '';
    const mediaData = getCurrentMediaData();
    if (!mediaData) return;
    // Choose episode titles based on dubbed mode (fallback to original if dubbed is not available)
    let episodeTitles = mediaData.episodeTitles;
    if (currentDubbed && mediaData.dubbedepisodetitle && mediaData.dubbedepisodetitle.length > 0) {
      episodeTitles = mediaData.dubbedepisodetitle;
    }
    // Use the same video array (dubbed or original) for determining the number of episodes
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
      episodeSidebar.appendChild(episodeDiv);
    });
  }

  // Next and previous episode functionality
  nextEpisodeButton.addEventListener('click', () => {
    const mediaData = getCurrentMediaData();
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

  // Handle search filtering for movie items in the list
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = searchInput.value.toLowerCase();
      document.querySelectorAll('.movie-item').forEach(item => {
        const title = item.querySelector('p').textContent.toLowerCase();
        item.style.display = title.includes(query) ? '' : 'none';
      });
      // Optionally, hide category banners while searching
      banners.forEach(banner => {
        banner.style.display = query ? 'none' : 'block';
      });
    }, 300);
  });

  // Handle back to category button: return to the category selection view
  document.getElementById('backToCategory').addEventListener('click', (e) => {
    e.preventDefault();
    movieList.innerHTML = '';
    movieListWrapper.style.display = 'none';
    categoryContainer.style.display = 'flex';
    episodeContainer.style.display = 'none';
    // Show the changelogs again when returning to the start screen.
    container.style.display = 'block';
  });

  // Toggle dubbed mode if the button exists
  if (dubbedButton) {
    dubbedButton.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent default anchor behavior
      // Toggle the dubbed mode flag
      currentDubbed = !currentDubbed;
      // Update button appearance if needed (e.g., adding an "active" class)
      dubbedButton.classList.toggle('active', currentDubbed);
      // Update the player, sidebar, and downloads to reflect the new mode
      updateEpisodeSidebar();
      updateVideoPlayer(currentEpisode);
      updateDownloadButton();
    });
  }

  // (Optional) Preload one category on page load:
  // renderMovieList('movies');

  // Back to menu: navigate to the external URL
 // document.getElementById('backToMenu').addEventListener('click', e => {
 //   e.preventDefault();
 //   window.location.href = 'https://virowatch.tiiny.site'; // Replace with your desired URL
 // });

});
