/**
 * streambroadcast-live.js  —  Virowatch StreamBroadcast Integration
 *
 * Fetches the StreamBroadcast homepage, extracts:
 * • The "Scheduled" events (with countdown timers)
 * • The "Soon" events (Live Now or starting in ≤ 1 hour)
 *
 * X-Frame-Options Bypass: Aggressively follows internal links and scans 
 * JS variables/Base64 to find the 3rd-party player URL.
 */

(function () {
  'use strict';

  const BASE    = 'https://streambroadcast.net';
  const TIMEOUT = 7000;

  window._sbLoaded  = false;
  window._sbLoading = false;

  // ── Updated proxy system with build + parse functions ─────────────
  // Reordered to avoid 400 Bad Request from codetabs
  const CUSTOM_PROXY_URL = ""; // e.g. "https://my-proxy.workers.dev/?url="

  const PROXY_BUILDERS = [
    // 0. Custom proxy (highest priority if set)
    ...(CUSTOM_PROXY_URL ? [{
      build: u => `${CUSTOM_PROXY_URL}${encodeURIComponent(u)}`,
      parse: r => r.text(),
    }] : []),
    // 1. allorigins get — returns { contents: "..." } JSON wrapper
    {
      build: u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
      parse: async r => {
        const j = await r.json();
        return j.contents || '';
      },
    },
    // 2. whateverorigin — returns { contents: "..." } JSON wrapper
    {
      build: u => `https://www.whateverorigin.org/get?url=${encodeURIComponent(u)}`,
      parse: async r => {
        const j = await r.json();
        return j.contents || '';
      },
    },
    // 3. allorigins raw — returns raw content
    {
      build: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      parse: r => r.text(),
    },
    // 4. corsproxy.io — returns raw content
    {
      build: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      parse: r => r.text(),
    },
    // 5. codetabs — returns 400 when overloaded, moved to last
    {
      build: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      parse: r => r.text(),
    },
    // 6. thingproxy — last resort
    {
      build: u => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
      parse: r => r.text(),
    },
  ];

  let successfulProxy = null;

  // ── RESTORED: makeFallbackUrl function ────────────────────────────
  function makeFallbackUrl(watchUrl) {
    return `data:text/html;charset=utf-8,${encodeURIComponent(`
      <html><body style="background:#111;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;text-align:center;">
        <div>
          <h3 style="margin-bottom:10px;">Embed Restricted by Host</h3>
          <p style="margin-bottom:20px;color:#aaa;font-size:14px;">The streaming host blocks direct embedding.</p>
          <a href="${watchUrl}" target="_blank" style="background:#007bff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px;">▶ Watch on StreamBroadcast</a>
        </div>
      </body></html>
    `)}`;
  }

  async function fetchHTML(url) {
    // REMOVED: Direct fetch attempt. 
    // StreamBroadcast blocks direct CORS requests, and attempting it 
    // generates unavoidable console errors. Go straight to proxies.

    // Build ordered proxy list (try successful proxy first)
    const proxiesToTry = successfulProxy !== null
      ? [successfulProxy, ...PROXY_BUILDERS.filter((_, i) => i !== successfulProxy)]
      : PROXY_BUILDERS.map((_, i) => i);

    for (const idx of proxiesToTry) {
      const proxy = PROXY_BUILDERS[idx];
      const proxyUrl = proxy.build(url);
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 8000);
        const r    = await fetch(proxyUrl, { signal: ctrl.signal });
        clearTimeout(tid);
        if (r.ok) {
          const text = await proxy.parse(r);
          if (text && text.length > 0) {
            successfulProxy = idx;
            return text;
          }
        }
      } catch (err) {
        console.warn(`StreamBroadcast: Proxy ${idx} failed:`, err.message || err);
      }
    }
    console.error(`StreamBroadcast: All proxies exhausted for ${url}`);
    return null;
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function parseTimeToMs(timeStr) {
    if (!timeStr) return 0;
    const now = new Date();
    const isoDate = new Date(timeStr);
    if (!isNaN(isoDate.getTime())) return isoDate.getTime();

    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(ET|CT|MT|PT|GMT|UTC|EST|CST|MST|PST)?/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const ampm = match[3] ? match[3].toUpperCase() : null;
      const tz = match[4] ? match[4].toUpperCase() : null;

      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      now.setHours(hours, minutes, 0, 0);

      const tzOffsets = { 'ET': -4, 'EST': -5, 'CT': -5, 'CST': -6, 'MT': -6, 'MST': -7, 'PT': -7, 'PST': -8, 'GMT': 0, 'UTC': 0 };
      if (tzOffsets[tz] !== undefined) {
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        return utcTime + (tzOffsets[tz] * 3600000);
      }
      return now.getTime();
    }
    return 0;
  }

  function extractSBEvents(doc) {
    const events = [];
    const cards = doc.querySelectorAll('a[href*="/events/"], a[href*="/stream/"], .event-card, .stream-item, .card');
    const uniqueHrefs = new Set();

    cards.forEach(card => {
      const link = card.tagName === 'A' ? card : card.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || uniqueHrefs.has(href)) return;
      
      if (href.includes('/events/') || href.includes('/stream/') || href.includes('/watch/')) {
        uniqueHrefs.add(href);

        let title = '';
        const titleEl = link.querySelector('h2, h3, h4, .title, .card-title, [class*="font-bold"]');
        if (titleEl) title = titleEl.textContent.trim();
        else title = link.textContent.trim().substring(0, 60);
        title = title.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');

        let timeStr = '';
        const timeEl = link.querySelector('time, .time, .date, [class*="time"], [class*="date"], [class*="schedule"]');
        if (timeEl) timeStr = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
        if (!timeStr) {
          const regexMatch = link.textContent.match(/(\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\s*(ET|CT|MT|PT|GMT|UTC)?)|(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2})/i);
          if (regexMatch) timeStr = regexMatch[0];
        }

        const eventTimeMs = parseTimeToMs(timeStr);
        const timeDiff = eventTimeMs - Date.now();
        let category = 'scheduled';
        if (timeDiff <= 0 && timeDiff > -10800000) category = 'soon';
        else if (timeDiff > 0 && timeDiff <= 3600000) category = 'soon';

        events.push({
          url: BASE + (href.startsWith('/') ? href : '/' + href),
          title: title || 'Live Stream',
          timeStr: timeStr,
          eventTimeMs: eventTimeMs,
          category: category
        });
      }
    });

    if (events.length === 0) {
      const allLinks = Array.from(doc.querySelectorAll('a'));
      for (const a of allLinks) {
        const href = a.getAttribute('href');
        if (!href || uniqueHrefs.has(href)) continue;
        if (href.includes('/events/') || href.includes('/stream/') || href.includes('/watch/')) {
          uniqueHrefs.add(href);
          const text = a.textContent.replace(/\s+/g, ' ').trim();
          if (text.length > 3 && text.length < 120) {
            events.push({
              url: BASE + (href.startsWith('/') ? href : '/' + href),
              title: text,
              timeStr: '',
              eventTimeMs: 0,
              category: 'scheduled' 
            });
          }
        }
      }
    }
    return events;
  }

  function resolveUrl(src) {
    if (!src) return null;
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('/')) return BASE + src;
    if (/^https?:\/\//.test(src)) return src;
    return null;
  }

  // ─────────────────────────────────────────────────────────────────
  // AGGRESSIVE 2-LEVEL EMBED EXTRACTOR
  // Sports sites hide embeds in JS, Base64, or on secondary pages.
  // This function follows links and rips apart JS to find the player.
  // ─────────────────────────────────────────────────────────────────
  async function extractEmbedUrl(watchUrl) {
    const html = await fetchHTML(watchUrl);
    if (!html) return makeFallbackUrl(watchUrl);

    // Helper to scan raw HTML text for hidden URLs
    const scanRawHTML = (rawHtml) => {
      // 1. Check for Base64 encoded URLs
      const b64Match = rawHtml.match(/atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/);
      if (b64Match) {
        try {
          const decoded = atob(b64Match[1]);
          if (decoded.startsWith('http') && !decoded.includes('streambroadcast.net')) return decoded;
        } catch (e) {}
      }

      // 2. Check for Iframes generated by JS (e.g., document.write('<iframe...>'))
      const jsIframeRe = /<iframe[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
      const jsIframeMatch = jsIframeRe.exec(rawHtml);
      if (jsIframeMatch) {
        const src = resolveUrl(jsIframeMatch[1]);
        if (src && !src.startsWith('blob:') && !src.includes('streambroadcast.net')) return src;
      }

      // 3. Common JS patterns and sports stream domains
      const jsPatterns = [
        /["']((https?:)?\/\/[^"'\s]+(?:streamta|streameast|weakspell|methstreams|crackstreams|buffstreams|cricfree|sportsurge|cdn\.sportsplay|streamplay|vizzy|vixlo|wizzle|embed|player|stream|live|watch)[^"'\s]*?)["']/gi,
        /source\s*[:=]\s*["']((https?:)?\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/gi,
        /file\s*[:=]\s*["']((https?:)?\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/gi,
        /window\.location\s*=\s*["']((https?:)?\/\/[^"']+)["']/gi
      ];

      for (const re of jsPatterns) {
        re.lastIndex = 0;
        const m = re.exec(rawHtml);
        if (m) {
          let url = m[1];
          if (url.startsWith('//')) url = 'https:' + url;
          if (url.startsWith('http') && !url.includes('streambroadcast.net')) return url;
        }
      }
      return null;
    };

    // --- Level 1 Scan: The initial event page ---
    const level1Result = scanRawHTML(html);
    if (level1Result) return level1Result;

    const doc = parseHTML(html);

    // Check standard DOM Iframes
    for (const iframe of doc.querySelectorAll('iframe')) {
      const rawSrc = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
      const src = resolveUrl(rawSrc);
      if (src && !src.startsWith('blob:') && !src.includes('streambroadcast.net')) return src;
    }

    // Check Video Sources
    for (const source of doc.querySelectorAll('video source')) {
      const rawSrc = source.getAttribute('src');
      const src = resolveUrl(rawSrc);
      if (src && !src.includes('streambroadcast.net')) return src;
    }

    // --- Level 2 Scan: Follow internal links to the actual player page ---
    // Sports sites often have an intermediate page that links to the actual embed.
    const internalLinks = doc.querySelectorAll('a[href*="/watch/"], a[href*="/stream/"], a[href*="/embed/"], a[href*="/play/"]');
    for (const link of internalLinks) {
      const href = link.getAttribute('href');
      if (href) {
        try {
          const nextUrl = new URL(href, watchUrl).href;
          // Only fetch if it's an internal link we haven't visited
          if (nextUrl !== watchUrl && nextUrl.includes('streambroadcast.net')) {
            const nextHtml = await fetchHTML(nextUrl);
            if (nextHtml) {
              const level2Result = scanRawHTML(nextHtml);
              if (level2Result) return level2Result;

              const nextDoc = parseHTML(nextHtml);
              for (const iframe of nextDoc.querySelectorAll('iframe')) {
                const rawSrc = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
                const src = resolveUrl(rawSrc);
                if (src && !src.startsWith('blob:') && !src.includes('streambroadcast.net')) return src;
              }
            }
          }
        } catch (e) {}
      }
    }

    // If all aggressive scans fail, return the safe fallback UI
    return makeFallbackUrl(watchUrl);
  }

  function probeIframe(url) {
    if (window._vwProbeIframe) return window._vwProbeIframe(url, TIMEOUT);
    return new Promise(resolve => {
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position: 'fixed', top: '-9999px', left: '-9999px',
        width: '1px', height: '1px', opacity: '0',
        pointerEvents: 'none', border: 'none',
      });
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      let done = false;
      const finish = ok => {
        if (done) return; done = true; clearTimeout(timer);
        try { document.body.removeChild(iframe); } catch (_) {} resolve(ok);
      };
      const timer = setTimeout(() => finish(false), TIMEOUT);
      iframe.onload  = () => finish(true);
      iframe.onerror = () => finish(false);
      iframe.src = url; document.body.appendChild(iframe);
    });
  }

  function showFallback(reason) {
    if (!window.shows) window.shows = {};
    const _existing = window.shows.SBLIVE || {};
    
    window.shows.SBLIVE = {
      title : _existing.title || 'StreamBroadcast',
      image : _existing.image || 'https://streambroadcast.net/favicon.ico',
      SBFallback: {
        chapter       : '⚠️ Proxy unavailable',
        video         : [makeFallbackUrl(BASE)],
        episodeTitles : [`Open StreamBroadcast (${reason})`],
      },
    };
    if (window.mediaData?.shows) window.mediaData.shows.SBLIVE = window.shows.SBLIVE;
    window._sbLoaded  = true; window._sbLoading = false;
    window.dispatchEvent(new CustomEvent('sbReady', { detail: window.shows.SBLIVE }));
  }

  async function buildStreamBroadcastData() {
    if (window._sbLoading) return;
    window._sbLoading = true;

    const html = await fetchHTML(BASE);
    if (!html) { showFallback('all CORS proxies blocked'); return; }

    const doc = parseHTML(html);
    const rawEvents = extractSBEvents(doc);
    
    if (!rawEvents.length) { showFallback('no events found or DOM changed'); return; }

    rawEvents.sort((a, b) => a.eventTimeMs - b.eventTimeMs);

    const resolved = await Promise.all(rawEvents.map(async ev => ({ ...ev, embedUrl: await extractEmbedUrl(ev.url) })));
    Promise.allSettled(resolved.map(ev => probeIframe(ev.embedUrl)));

    if (!window.shows) window.shows = {};
    const _existing = window.shows.SBLIVE || {};
    window.shows.SBLIVE = {
      title : _existing.title || 'StreamBroadcast',
      image : _existing.image || 'https://streambroadcast.net/favicon.ico',
    };

    const soonEvents = resolved.filter(e => e.category === 'soon');
    const scheduledEvents = resolved.filter(e => e.category === 'scheduled');

    if (soonEvents.length) {
      window.shows.SBLIVE.SBSoon = {
        chapter       : '🔴 Soon / Live Now',
        video         : soonEvents.map(e => e.embedUrl),
        episodeTitles : soonEvents.map(e => `🔴 ${e.title}`),
      };
    }
    if (scheduledEvents.length) {
      window.shows.SBLIVE.SBScheduled = {
        chapter       : '📅 Scheduled',
        video         : scheduledEvents.map(e => e.embedUrl),
        episodeTitles : scheduledEvents.map(e => `📅 ${e.title} (${e.timeStr || 'TBD'})`),
      };
    }

    if (window.mediaData?.shows) window.mediaData.shows.SBLIVE = window.shows.SBLIVE;
    window._sbLoaded  = true; window._sbLoading = false;
    window.dispatchEvent(new CustomEvent('sbReady', { detail: window.shows.SBLIVE }));
  }

  window.reloadStreamBroadcast = buildStreamBroadcastData;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildStreamBroadcastData);
  else buildStreamBroadcastData();
})();