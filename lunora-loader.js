/**
 * Lunora Loader - Fetches and converts Lunora content.js format to Virowatch format
 * Source: https://github.com/lunoramovies/lunora
 */
(function() {
  const LUNORA_URL = 'https://raw.githubusercontent.com/lunoramovies/lunora/3d5eaed7151737355b10ecc20df4d46843aefca3/javascript/content.js';

  function extractMoviesObject(text) {
    const marker = 'const movies = ';
    const idx = text.indexOf(marker);
    if (idx === -1) return null;
    const start = idx + marker.length;
    let depth = 0;
    let inStr = false;
    let strChar = '';
    let i = start;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === strChar) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strChar = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; if (depth === 0) break; }
    }
    const objStr = text.substring(start, i + 1);
    try {
      return new Function('return ' + objStr)();
    } catch (e) {
      console.warn('Lunora: parse error', e);
      return null;
    }
  }

  function lunoraToVirowatch(lunoraMovies) {
    const result = {};
    for (const [key, data] of Object.entries(lunoraMovies)) {
      if (!data || typeof data !== 'object') continue;
      const title = data.title || key;
      const image = data.poster || data.image || 'https://via.placeholder.com/150';
      const downloads = [];
      for (let i = 1; i <= 8; i++) {
        const d = data['download' + i];
        if (d && typeof d === 'string') downloads.push(d);
      }
      if (data.download && typeof data.download === 'string') downloads.unshift(data.download);

      if (data.type === 'show' && data.episodes && typeof data.episodes === 'object') {
        const bySeason = {};
        for (const [epKey, url] of Object.entries(data.episodes)) {
          const m = epKey.match(/Season\s*(\d+)\s+Episode\s*(\d+)/i) || epKey.match(/Episode\s*(\d+)/i);
          if (m) {
            const sn = m[1] ? 'Season ' + m[1] : 'Season 1';
            const en = m[2] || m[1];
            if (!bySeason[sn]) bySeason[sn] = { videos: [], titles: [] };
            bySeason[sn].videos.push(url);
            bySeason[sn].titles.push('Episode ' + en);
          }
        }
        const seasonKeys = Object.keys(bySeason).sort((a, b) => {
          const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
          const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
          return na - nb;
        });
        const item = { title, image };
        for (const sk of seasonKeys) {
          const s = bySeason[sk];
          const seasonNum = parseInt(sk.replace(/\D/g, ''), 10) || 1;
          const dl = data['download' + seasonNum] || data.download;
          const seasonData = {
            chapter: sk,
            video: s.videos,
            episodeTitles: s.titles
          };
          if (dl && typeof dl === 'string') {
            seasonData.customDownloads = s.videos.map(() => [{ url: dl, name: 'Download' }]);
          }
          item[sk] = seasonData;
        }
        result[key] = item;
      } else {
        const mainUrl = data['Main Movie'] || data.video;
        if (mainUrl) {
          result[key] = {
            title,
            image,
            video: Array.isArray(mainUrl) ? mainUrl : [mainUrl],
            episodeTitles: ['Movie'],
            customDownloads: downloads.length ? [[...downloads.map(u => ({ url: u, name: 'Download' }))]] : undefined
          };
        }
      }
    }
    return result;
  }

  window.lunoraLoader = {
    _loaded: null,
    _loading: null,

    load: function() {
      if (this._loaded) return Promise.resolve(this._loaded);
      if (this._loading) return this._loading;
      this._loading = fetch(LUNORA_URL)
        .then(r => r.text())
        .then(text => {
          const movies = extractMoviesObject(text);
          if (!movies) throw new Error('Could not parse Lunora content');
          this._loaded = lunoraToVirowatch(movies);
          return this._loaded;
        })
        .catch(err => {
          this._loading = null;
          console.warn('Lunora fetch failed:', err);
          throw err;
        });
      return this._loading;
    },

    isLoaded: function() {
      return !!this._loaded;
    }
  };
})();
