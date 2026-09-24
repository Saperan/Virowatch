/**
 * pitsport-live.js  —  Virowatch PitSport Live Integration
 *
 * PitSport's site is a client-rendered SvelteKit app, so the event
 * listings and embed links don't exist in the raw HTML anymore — only
 * after the page hydrates in a real browser. Scraping it is no longer
 * viable. Instead this calls PitSport's own public JSON API directly,
 * which is CORS-open, so no proxy is needed at all.
 */

(function () {
  'use strict';

  // API base is read from the live site's inline SvelteKit env
  // (__sveltekit_*.env.PUBLIC_API_BASE_URL). Currently:
  const API        = 'https://pitsport.st/api/v1';
  const SITE       = 'https://pitsport.st';
  const TIMEOUT    = 7000;
  // pitsport.st/favicon is unreliable — use the same logo as shows.js
  const PITSPORT_LOGO =
    'https://styles.redditmedia.com/t5_gimzou/styles/profileIcon_xcbdmlpt1vgg1.png?frame=1&auto=webp&crop=256%3A256%2Csmart&s=a81a6627212a1de0d75a0e4381aa963812a1da5c';

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
  // 2.  Turn the /live-now response into a flat event list
  // ─────────────────────────────────────────────────────────────────

  function flattenPrograms(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(s => s && s.programId)
      .map(s => ({
        id        : s.programId,
        title     : s.footer ? `${s.footer} - ${s.titleText}` : (s.titleText || String(s.programId)),
        watchUrl  : `${SITE}${s.playHref || `/programs/${s.programId}/play`}`,
        timestamp : s.sessionStart || 0,
      }));
  }

  // ─────────────────────────────────────────────────────────────────
  // 3.  Embed resolution — /programs/{id}/play returns the real embed
  // ─────────────────────────────────────────────────────────────────

  async function resolveEmbedUrl(ev) {
    const data = await fetchJSON(`${API}/programs/${ev.id}/play`);
    const d = data?.data || data;
    // ponytail: first allowed video wins, per-feed picker if users ask
    const vids = Array.isArray(d?.videos) ? d.videos.filter(v => v.allowed !== false && v.embedUrl) : [];
    return d?.video?.embedUrl || vids[0]?.embedUrl || ev.watchUrl;
  }

  function probeIframe(url) {
    return new Promise(resolve => {
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position: 'fixed', top: '-9999px', left: '-9999px',
        width: '1px', height: '1px', opacity: '0',
        pointerEvents: 'none', border: 'none',
      });

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
      image : PITSPORT_LOGO,
      PSFallback: {
        chapter       : '⚠️ PitSport unavailable',
        video         : ['https://pitsport.st/live-now'],
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

    const res = await fetchJSON(`${API}/live-now`);
    const payload = res?.data || res;

    if (!payload || (!payload.live && !payload.upcoming)) {
      showFallback('PitSport API unreachable');
      return;
    }

    const liveNowRaw = flattenPrograms(payload.live).slice(0, 20);
    const liveIds    = new Set(liveNowRaw.map(e => e.id));

    // "Upcoming" = upcoming list minus anything already shown as live now
    const upcomingRaw = flattenPrograms(payload.upcoming)
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
      image : PITSPORT_LOGO,
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

  // Lazy by default: the API calls only fire when PitSport is opened
  // (content.js calls window.reloadPitSport from selectMovie). Loading at
  // startup is opt-in via the settings toggle (localStorage vw_pitsport_auto).
  function autoLoadEnabled() {
    try { return localStorage.getItem('vw_pitsport_auto') === '1'; } catch (_) { return false; }
  }

  if (autoLoadEnabled()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildPitSportData);
    } else {
      buildPitSportData();
    }
  }

})();
