/**
 * pitsport-live.js  —  Virowatch PitSport Live Integration
 *
 * PitSport's site is now a client-rendered Next.js app, so the event
 * listings and embed links don't exist in the raw HTML anymore — only
 * after the page hydrates in a real browser. Scraping it is no longer
 * viable. Instead this calls PitSport's own public JSON API directly,
 * which is CORS-open (Access-Control-Allow-Origin: *), so no proxy is
 * needed at all.
 */

(function () {
  'use strict';

  const API        = 'https://api.pitsport.live/v1';
  const WATCH_BASE = 'https://pitsport.xyz/watch';
  const TIMEOUT    = 7000;

  window._pitsportLoaded  = false;
  window._pitsportLoading = false;

  // ─────────────────────────────────────────────────────────────────
  // 1.  Fetch helper
  // ─────────────────────────────────────────────────────────────────

  async function fetchJSON(url) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const r    = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2.  Turn the categorized API response into a flat event list
  // ─────────────────────────────────────────────────────────────────

  function flattenStreams(data) {
    if (!data || !Array.isArray(data.categories)) return [];
    const events = [];
    for (const cat of data.categories) {
      for (const s of cat.streams || []) {
        const id = (s.uri || '').replace('/watch/', '');
        if (!id) continue;
        events.push({
          id,
          title     : cat.category ? `${cat.category} - ${s.title}` : s.title,
          watchUrl  : `${WATCH_BASE}/${id}`,
          timestamp : s.timestamp || 0,
        });
      }
    }
    return events;
  }

  // ─────────────────────────────────────────────────────────────────
  // 3.  Embed resolution — per-stream API returns the real embed iframe
  // ─────────────────────────────────────────────────────────────────

  async function resolveEmbedUrl(ev) {
    const data = await fetchJSON(`${API}/stream/${ev.id}`);
    const iframe = data?.content?.[0]?.iframe;
    return iframe || ev.watchUrl;
  }

  function probeIframe(url) {
    return new Promise(resolve => {
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position: 'fixed', top: '-9999px', left: '-9999px',
        width: '1px', height: '1px', opacity: '0',
        pointerEvents: 'none', border: 'none',
      });

      // Prevent the background stream verifier from opening popups while testing
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { document.body.removeChild(iframe); } catch (_) {}
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), TIMEOUT);
      iframe.onload  = () => finish(true);
      iframe.onerror = () => finish(false);
      iframe.src = url;
      document.body.appendChild(iframe);
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.  Main loader & Fallback
  // ─────────────────────────────────────────────────────────────────

  function showFallback(reason) {
    if (!window.shows) window.shows = {};

    window.shows.PITSORT = {
      title : 'PitSport Live',
      image : 'https://pitsport.xyz/favicon.ico',
      PSFallback: {
        chapter       : '⚠️ PitSport unavailable',
        video         : ['https://pitsport.xyz/live-now'],
        episodeTitles : [`Open PitSport Live (${reason})`],
      },
    };

    if (window.mediaData?.shows) {
      window.mediaData.shows.PITSORT = window.shows.PITSORT;
    }

    window._pitsportLoaded  = true;
    window._pitsportLoading = false;
    window.dispatchEvent(new CustomEvent('pitsportReady', { detail: window.shows.PITSORT }));
  }

  async function buildPitSportData() {
    if (window._pitsportLoading) return;
    window._pitsportLoading = true;

    const [live, day] = await Promise.all([
      fetchJSON(`${API}/streams/live`),
      fetchJSON(`${API}/streams/24h`),
    ]);

    if (!live && !day) {
      showFallback('PitSport API unreachable');
      return;
    }

    const liveNowRaw = flattenStreams(live).slice(0, 20);
    const liveIds    = new Set(liveNowRaw.map(e => e.id));

    // "Upcoming" = 24h list minus anything already shown as live now
    const upcomingRaw = flattenStreams(day)
      .filter(e => !liveIds.has(e.id))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 20);

    if (!liveNowRaw.length && !upcomingRaw.length) {
      showFallback('no live or upcoming events');
      return;
    }

    const [liveNowFinal, upcomingFinal] = await Promise.all([
      Promise.all(liveNowRaw.map(async ev => ({ ...ev, embedUrl: await resolveEmbedUrl(ev) }))),
      Promise.all(upcomingRaw.map(async ev => ({ ...ev, embedUrl: await resolveEmbedUrl(ev) }))),
    ]);

    Promise.allSettled([...liveNowFinal, ...upcomingFinal].map(ev => probeIframe(ev.embedUrl)));

    if (!window.shows) window.shows = {};

    window.shows.PITSORT = {
      title : 'PitSport Live',
      image : 'https://pitsport.xyz/favicon.ico',
    };

    if (liveNowFinal.length) {
      window.shows.PITSORT.PSLiveNow = {
        chapter       : '🔴 Live Now',
        video         : liveNowFinal.map(e => e.embedUrl),
        episodeTitles : liveNowFinal.map(e => e.title),
      };
    }

    if (upcomingFinal.length) {
      window.shows.PITSORT.PSUpcoming = {
        chapter       : '📅 Upcoming Live',
        video         : upcomingFinal.map(e => e.embedUrl),
        episodeTitles : upcomingFinal.map(e => e.title),
      };
    }

    if (window.mediaData?.shows) {
      window.mediaData.shows.PITSORT = window.shows.PITSORT;
    }

    window._pitsportLoaded  = true;
    window._pitsportLoading = false;

    window.dispatchEvent(new CustomEvent('pitsportReady', { detail: window.shows.PITSORT }));
  }

  window.reloadPitSport = buildPitSportData;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPitSportData);
  } else {
    buildPitSportData();
  }

})();
