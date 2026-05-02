/**
 * pitsport-live.js  —  Virowatch PitSport Live Integration
 *
 * Fetches the PitSport live-now page, extracts:
 * • The current "Live Now" events
 * • The "Upcoming Live" events
 *
 * Tries a direct fetch then several public CORS proxies in sequence.
 * Caches the working proxy to speed up subsequent requests.
 */

(function () {
  'use strict';

  const BASE    = 'https://pitsport.xyz';
  const TIMEOUT = 7000;

  window._pitsportLoaded  = false;
  window._pitsportLoading = false;

  const PROXY_BUILDERS = [
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    u => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
  ];
  
  let successfulProxy = null;

  // ─────────────────────────────────────────────────────────────────
  // 1.  Fetch helpers — Proxy caching for parallel speed
  // ─────────────────────────────────────────────────────────────────

  async function fetchHTML(url) {
    try {
      const r = await fetch(url, { mode: 'cors' });
      if (r.ok) return r.text();
    } catch (_) {}

    // Prioritize the proxy that successfully worked last time
    const proxiesToTry = successfulProxy 
      ? [successfulProxy, ...PROXY_BUILDERS.filter(p => p !== successfulProxy)]
      : PROXY_BUILDERS;

    for (const build of proxiesToTry) {
      const proxyUrl = build(url);
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 8000);
        const r    = await fetch(proxyUrl, { signal: ctrl.signal });
        clearTimeout(tid);
        if (r.ok) {
          successfulProxy = build; // Cache for subsequent parallel requests
          return r.text();
        }
      } catch (err) {}
    }
    return null;
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // ─────────────────────────────────────────────────────────────────
  // 2.  DOM Extraction using linear positioning 
  // ─────────────────────────────────────────────────────────────────

  function extractEvents(doc, headingId, max) {
    const events = [];
    const targetHeading = doc.getElementById(headingId);
    if (!targetHeading) return events;

    const otherHeadingId = headingId === 'livenow' ? 'upcoming' : 'livenow';
    const otherHeading = doc.getElementById(otherHeadingId);

    const allLinks = Array.from(doc.querySelectorAll('a[href*="/watch/"]'));
    const validLinks = allLinks.filter(a => {
      // Must be physically after the target heading in the document
      if (!(targetHeading.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        return false;
      }
      // If we are "livenow", must be before "upcoming" to avoid bleeding sections
      if (headingId === 'livenow' && otherHeading) {
        if (!(otherHeading.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING)) {
          return false;
        }
      }
      return true;
    });

    const uniqueHrefs = new Set();
    for (const a of validLinks) {
      if (events.length >= max) break;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/watch/')) continue;
      
      if (uniqueHrefs.has(href)) continue; // Prevent duplicates
      uniqueHrefs.add(href);

      events.push({ url: BASE + href, title: extractTitle(a) });
    }
    return events;
  }

  function extractTitle(aEl) {
    const candidates = [
      aEl.querySelector('[class*="font-bold"]'),
      aEl.querySelector('h2'),
      aEl.querySelector('h3'),
      aEl.querySelector('[class*="text-xl"]'),
      aEl.querySelector('[class*="text-lg"]'),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const t = el.textContent.trim();
      if (t && t.length > 3 && !/^\d$/.test(t)) return t.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
    }
    let best = '';
    aEl.querySelectorAll('*').forEach(el => {
      const t = Array.from(el.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.nodeValue.trim())
          .join(' ');
      if (t.length > best.length && t.length < 120 && !/^\d{1,2}\s+\w+/.test(t)) best = t;
    });
    return best || 'Live Event';
  }

  // ─────────────────────────────────────────────────────────────────
  // 3.  Embed extraction
  // ─────────────────────────────────────────────────────────────────

  async function extractEmbedUrl(watchUrl) {
    const html = await fetchHTML(watchUrl);
    if (!html) return watchUrl;

    const doc = parseHTML(html);

    for (const iframe of doc.querySelectorAll('iframe')) {
      const src = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
      if (!src.startsWith('blob:') && /^https?:\/\//.test(src)) return src;
    }

    const patterns = [
      /["'](https?:\/\/[^"'\s]+\/(?:embed|player|stream|live|watch)[^"'\s]*?)["']/gi,
      /["'](https?:\/\/(?:pushmdz|vidsrc|embedme|voe\.sx|dood\.la|filemoon|streamed|streameast|weakspell|sportsurge)[^"'\s]*?)["']/gi,
      /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/gi,
    ];
    for (const script of doc.querySelectorAll('script')) {
      const text = script.textContent || '';
      for (const re of patterns) {
        re.lastIndex = 0;
        const m = re.exec(text);
        if (m) return m[1];
      }
    }

    return watchUrl;
  }

function probeIframe(url) {
    return new Promise(resolve => {
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position: 'fixed', top: '-9999px', left: '-9999px',
        width: '1px', height: '1px', opacity: '0',
        pointerEvents: 'none', border: 'none',
      });
      
      // --- NEW ANTI-POPUP LOGIC ---
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
        chapter       : '⚠️ Proxy unavailable',
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

    const html = await fetchHTML(`${BASE}/live-now`);
    if (!html) {
      showFallback('all CORS proxies blocked');
      return;
    }

    const doc = parseHTML(html);
    
    // INCREASING THE LIMITS HERE
    const liveNowRaw  = extractEvents(doc, 'livenow',  20); 
    const upcomingRaw = extractEvents(doc, 'upcoming', 20);
    
    const allRaw      = [...liveNowRaw, ...upcomingRaw];

    if (!allRaw.length) {
      showFallback('no events found or DOM changed');
      return;
    }

    const resolved = await Promise.all(
      allRaw.map(async ev => ({
        ...ev,
        embedUrl: await extractEmbedUrl(ev.url),
      }))
    );

    Promise.allSettled(resolved.map(ev => probeIframe(ev.embedUrl)));

    if (!window.shows) window.shows = {};

    window.shows.PITSORT = {
      title : 'PitSport Live',
      image : 'https://pitsport.xyz/favicon.ico',
    };

    const liveNowFinal  = resolved.slice(0, liveNowRaw.length);
    const upcomingFinal = resolved.slice(liveNowRaw.length);

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
