/**
 * iptv.js  —  Virowatch IPTV Live TV integration (iptv-org)
 *
 * Adds a "Live TV (IPTV)" tile to the TV Shows category, backed by the
 * public iptv-org playlist (https://iptv-org.github.io/iptv/index.m3u,
 * ~10k channels). The playlist is fetched lazily the first time the tile
 * is opened (it's a few MB), parsed, and grouped by category — each
 * category becomes a "season" in the season dropdown, each channel an
 * "episode".
 *
 * Raw HLS (.m3u8) URLs can't play inside the #videoPlayer iframe, so this
 * uses the same trick as megaplay-backup.js: episode "video" URLs are
 * sentinel fragments (about:blank#vwiptv-N). A MutationObserver on the
 * iframe's src spots the sentinel, hides the iframe, and plays the real
 * stream with hls.js in its own <video> element.
 *
 * Reality check on iptv-org streams: many are geo-blocked, offline, or
 * lack CORS headers (hls.js needs CORS to fetch segments) — those fail
 * with a toast instead of playing. On an https origin, http:// streams
 * are also blocked as mixed content, so they're filtered out up front.
 */

(function () {
  'use strict';

  const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';
  const HLS_CDN      = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
  const IPTV_LOGO    = 'https://avatars.githubusercontent.com/u/52102436?s=256'; // iptv-org GitHub avatar
  const SENTINEL_RE  = /^about:blank#vwiptv-(\d+)$/;

  window._iptvLoaded  = false;
  window._iptvLoading = false;

  // ── Static tile so it shows up in the TV Shows grid immediately ────
  // (Must load after shows.js — it overwrites window.shows wholesale.)
  // The grid renders in key-insertion order, so rebuild window.shows with
  // IPTV first and PitSport right after it — the two live tiles lead the
  // TV Shows list. Runs at parse time, before content.js's DOMContentLoaded
  // handler snapshots window.shows into mediaData.
  (function () {
    const old = window.shows || {};
    const next = {};
    next.IPTV = {
      title: 'IP TV',
      image: 'https://imgs.search.brave.com/h6_hdC-UmlRWKdmCkRfSUJZOOEHjFgZgyw9NWrDeESo/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90NC5m/dGNkbi5uZXQvanBn/LzA0LzEzLzcyLzI1/LzM2MF9GXzQxMzcy/MjUzN19SSkRscGZi/aWZ2Uk5iaTZvc1NU/bFB5RUJwekVUVEpi/ay5qcGc',
      // Chapters (categories) are injected at runtime by reloadIptv().
    };
    if (old.PITSORT) next.PITSORT = old.PITSORT;
    Object.keys(old).forEach((k) => {
      if (k !== 'IPTV' && k !== 'PITSORT') next[k] = old[k];
    });
    window.shows = next;
    if (window.mediaData) window.mediaData.shows = window.shows;
  })();

  // ── Playlist fetch + parse ──────────────────────────────────────────

  let allChannels = [];          // flat list; sentinel index points into this
  const chapterChannels = {};    // chapter key -> [channel indices]

  function parseM3U(text) {
    const channels = [];
    const lines = text.split(/\r?\n/);
    let meta = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const attrs = {};
        line.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
        // Channel name = text after the closing quote of the last attribute
        let name = '';
        const m = /",(.*)$/.exec(line);
        if (m) name = m[1].trim();
        else {
          const i = line.indexOf(',');
          name = i >= 0 ? line.slice(i + 1).trim() : '';
        }
        meta = {
          name : name || 'Unknown channel',
          group: (attrs['group-title'] || '').split(';')[0].trim(),
          logo : attrs['tvg-logo'] || '',
        };
      } else if (!line.startsWith('#')) {
        if (meta && /^https?:\/\//i.test(line)) {
          channels.push({ name: meta.name, group: meta.group, logo: meta.logo, url: line });
        }
        meta = null;
      }
    }
    return channels;
  }

  function buildChapters(channels) {
    const groups = new Map();
    channels.forEach((ch, i) => {
      ch.idx = i;
      const g = ch.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(ch);
    });

    // Alphabetical, catch-all buckets last
    const names = [...groups.keys()].sort((a, b) => {
      const junkA = /^(Other|Undefined)$/i.test(a), junkB = /^(Other|Undefined)$/i.test(b);
      if (junkA !== junkB) return junkA ? 1 : -1;
      return a.localeCompare(b);
    });

    const show = window.shows.IPTV;
    // Drop stale chapters from a previous load
    Object.keys(show).forEach((k) => {
      if (k !== 'title' && k !== 'image') delete show[k];
    });

    Object.keys(chapterChannels).forEach((k) => delete chapterChannels[k]);
    names.forEach((g, gi) => {
      const list = groups.get(g);
      // Name-based key so continue-watching entries survive playlist churn
      // (index-based keys would point at a different category next week)
      let key = 'IPTVG_' + g.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24);
      if (show[key]) key += '_' + gi;
      chapterChannels[key] = list.map((c) => c.idx);
      show[key] = {
        chapter      : `${g} (${list.length})`,
        video        : list.map((c) => 'about:blank#vwiptv-' + c.idx),
        episodeTitles: list.map((c) => c.name),
      };
    });
  }

  // ── Language metadata (index.language.m3u — same channels grouped by
  // language) fetched in the background after the main list, drives the
  // language filter dropdown ──────────────────────────────────────────

  const LANG_URL = 'https://iptv-org.github.io/iptv/index.language.m3u';
  let langLoaded  = false;
  let langLoading = false;
  let selectedLang = '';
  try { selectedLang = localStorage.getItem('vw_iptv_lang') || ''; } catch (_) {}

  async function loadLanguages() {
    if (langLoaded || langLoading) return;
    langLoading = true;
    try {
      const r = await fetch(LANG_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const byUrl = new Map();
      parseM3U(await r.text()).forEach((c) => {
        if (!c.group || /^Undefined$/i.test(c.group)) return;
        if (!byUrl.has(c.url)) byUrl.set(c.url, []);
        byUrl.get(c.url).push(c.group);
      });
      allChannels.forEach((ch) => {
        const langs = byUrl.get(ch.url);
        if (langs) ch.langs = langs;
      });
      langLoaded = true;
      populateLangSelect();
      scheduleApplyHidden();
    } catch (_) {
      // No language data — the dropdown just stays on "All languages"
    } finally {
      langLoading = false;
    }
  }

  function populateLangSelect() {
    const sel = document.getElementById('vwIptvLangSel');
    if (!sel) return;
    sel.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = langLoaded ? '🌐 All languages' : '🌐 All languages (loading…)';
    sel.appendChild(all);
    if (langLoaded) {
      const counts = new Map();
      allChannels.forEach((ch) => {
        (ch.langs || []).forEach((l) => counts.set(l, (counts.get(l) || 0) + 1));
      });
      [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([lang, n]) => {
          const o = document.createElement('option');
          o.value = lang;
          o.textContent = `${lang} (${n})`;
          sel.appendChild(o);
        });
      sel.value = selectedLang;
      if (sel.value !== selectedLang) { selectedLang = ''; sel.value = ''; }
    }
  }

  // ── Channel health probes — hide dead channels from the list ───────
  //
  // A channel is playable in the browser only if its manifest URL answers
  // a CORS fetch with 2xx (hls.js needs exactly that to load segments), so
  // a headers-only GET probe doubles as the playability test. Channels of
  // the currently viewed category are probed in the background and hidden
  // as failures come in. Results are cached in localStorage for 12h.

  const PROBE_TIMEOUT = 8000;
  const PROBE_CONC    = 5;
  const CACHE_KEY     = 'vw_iptv_probe_v1';
  const CACHE_TTL     = 12 * 3600 * 1000;
  const CACHE_MAX     = 8000;

  let probeCache = {};
  try { probeCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (_) {}

  let saveTimer = null;
  function saveCacheSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const keys = Object.keys(probeCache);
        if (keys.length > CACHE_MAX) {
          keys.sort((a, b) => probeCache[a].ts - probeCache[b].ts)
              .slice(0, keys.length - CACHE_MAX)
              .forEach((k) => delete probeCache[k]);
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(probeCache));
      } catch (_) {}
    }, 2000);
  }

  async function probeUrl(url) {
    const c = probeCache[url];
    if (c && Date.now() - c.ts < CACHE_TTL) return c.ok;
    let ok = false;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
      const r    = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      ok = r.ok;
      try { ctrl.abort(); } catch (_) {} // headers are enough — don't pull the body
    } catch (_) { ok = false; }
    probeCache[url] = { ok, ts: Date.now() };
    saveCacheSoon();
    return ok;
  }

  const probeQueue = [];
  let probesActive = 0;

  function pumpProbes() {
    while (probesActive < PROBE_CONC && probeQueue.length) {
      const idx = probeQueue.shift();
      const ch  = allChannels[idx];
      if (!ch || ch.probed) continue;
      ch.probed = true;
      probesActive++;
      probeUrl(ch.url)
        .then((ok) => { if (!ok) { ch.dead = true; scheduleApplyHidden(); } })
        .finally(() => { probesActive--; pumpProbes(); });
    }
  }

  function enqueueChapter(key) {
    const list = chapterChannels[key];
    if (!list) return;
    // Current chapter jumps the queue
    for (let i = list.length - 1; i >= 0; i--) {
      const ch = allChannels[list[i]];
      if (ch && !ch.probed && !ch.queued) { ch.queued = true; probeQueue.unshift(list[i]); }
    }
    pumpProbes();
  }

  function currentChapterKey() {
    const sel = document.getElementById('seasonSelector');
    if (sel && /^IPTVG/.test(sel.value)) return sel.value;
    const keys = Object.keys(chapterChannels);
    return keys.length ? keys[0] : null;
  }

  let applyTimer = null;
  function scheduleApplyHidden() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyHidden, 150);
  }

  function applyHidden() {
    if (!iptvActive) return;
    const key = currentChapterKey();
    if (!key || !window.shows.IPTV[key]) return;
    const vids = window.shows.IPTV[key].video || [];
    const lang = langLoaded ? selectedLang : '';
    document
      .querySelectorAll('#episodeListContainer .episode[data-episode-index]')
      .forEach((div) => {
        const m = SENTINEL_RE.exec(vids[Number(div.dataset.episodeIndex)] || '');
        if (!m) return;
        const ch = allChannels[Number(m[1])];
        if (!ch) return;
        const langMiss = lang && !(ch.langs || []).includes(lang);
        div.style.display = ch.dead || langMiss ? 'none' : '';
      });
  }

  async function buildIptvData() {
    if (window._iptvLoading || window._iptvLoaded) return;
    window._iptvLoading = true;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 30000);
      const r    = await fetch(PLAYLIST_URL, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let channels = parseM3U(await r.text());

      // https page can't fetch http:// segments (mixed content) — drop them
      if (location.protocol === 'https:') {
        channels = channels.filter((c) => c.url.startsWith('https://'));
      }
      if (!channels.length) throw new Error('no playable channels');

      allChannels = channels;
      buildChapters(channels);
      if (window.mediaData?.shows) window.mediaData.shows.IPTV = window.shows.IPTV;
      window._iptvLoaded = true;
      loadLanguages(); // background — fills in the language filter when done
    } catch (e) {
      toast('IPTV playlist failed to load — ' + (e && e.message ? e.message : 'network error'));
    } finally {
      window._iptvLoading = false;
      window.dispatchEvent(new CustomEvent('iptvReady', { detail: window.shows.IPTV }));
    }
  }

  window.reloadIptv = buildIptvData;

  // ── hls.js on demand (same CDN as megaplay-backup.js — cached) ─────

  let hlsLoading = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = HLS_CDN;
      s.onload  = () => res(window.Hls);
      s.onerror = () => rej(new Error('hls.js failed to load'));
      document.head.appendChild(s);
    });
    return hlsLoading;
  }

  // ── Player: own <video> beside the iframe ───────────────────────────

  let hls = null;
  let playToken = 0;
  let iptvActive = false; // an IPTV sentinel is currently loaded in the iframe
  let playerUI = null;    // window.VWPlayerUI.attach() result
  let currentIdx = -1;    // flat index of the channel now playing

  function iframe()  { return document.getElementById('videoPlayer'); }
  function spinner() { return document.getElementById('videoSpinner'); }
  function frameEl() { return document.getElementById('vwIptvFrame'); }

  function tvVideo() {
    let v = document.getElementById('vwIptvPlayer');
    if (!v) {
      const frame = document.createElement('div');
      frame.id = 'vwIptvFrame';
      frame.style.cssText =
        'flex:1;width:100%;min-width:0;min-height:200px;position:relative;display:none;';
      v = document.createElement('video');
      v.id = 'vwIptvPlayer';
      v.playsInline = true;
      v.autoplay = true;
      v.style.cssText = 'width:100%;height:100%;display:block;background:#000;border:0;';
      frame.appendChild(v);
      const f = iframe();
      if (f && f.parentNode) f.parentNode.insertBefore(frame, f.nextSibling);
      if (window.VWPlayerUI) {
        playerUI = window.VWPlayerUI.attach(v, frame); // same control bar as the Backup/Vidnest players
      } else {
        v.controls = true; // fallback: native controls
      }
    }
    return v;
  }

  function stopHls() {
    if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
    const v = document.getElementById('vwIptvPlayer');
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {} }
  }

  function showTv() {
    tvVideo();
    const f = iframe();
    if (f) f.style.display = 'none';
    const fr = frameEl();
    if (fr) fr.style.display = '';
    // megaplay-backup / vidnest teardown may re-show the iframe right after
    // our sentinel lands in it — re-assert once the dust settles.
    setTimeout(() => {
      const f2 = iframe();
      if (f2 && frameEl() && frameEl().style.display !== 'none') f2.style.display = 'none';
    }, 50);
  }

  function hideTv() {
    stopHls();
    playToken++;
    currentIdx = -1;
    const fr = frameEl();
    if (fr) fr.style.display = 'none';
    const f = iframe();
    if (f) f.style.display = '';
  }

  // ── Watchlist: the currently playing channel as a watchlist item ───
  // Key encodes the stream URL (base64url) so the channel can be found
  // again next session even after playlist reshuffles.

  function chKey(ch) {
    return (
      'IPTVCH_' +
      btoa(unescape(encodeURIComponent(ch.url)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    );
  }

  function keyUrl(key) {
    try {
      let b = String(key).slice(7).replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return decodeURIComponent(escape(atob(b)));
    } catch (_) { return null; }
  }

  function updateWlBtn() {
    const btn = document.getElementById('vwIptvWlBtn');
    if (!btn) return;
    const ch = allChannels[currentIdx];
    if (!ch || !window.vwlHas) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    const inList = window.vwlHas(chKey(ch));
    btn.textContent = inList ? '✓ In watchlist' : '+ Watchlist channel';
    btn.title = (inList ? 'Remove "' : 'Add "') + ch.name + (inList ? '" from the watchlist' : '" to the watchlist');
    btn.classList.toggle('vw-iptv-wl-on', inList);
  }

  // ── Controls row (language filter + watchlist button) injected under
  // the category dropdown; content.js wipes that container on every
  // modal open, so the episode-list observer re-injects it ───────────

  function injectControls() {
    const cont = document.getElementById('seasonSelectorContainer');
    if (!cont) return;
    if (document.getElementById('vwIptvCtlRow')) { updateWlBtn(); return; }

    const row = document.createElement('div');
    row.id = 'vwIptvCtlRow';

    const sel = document.createElement('select');
    sel.id = 'vwIptvLangSel';
    sel.title = 'Filter channels by language';
    sel.addEventListener('change', () => {
      selectedLang = sel.value;
      try { localStorage.setItem('vw_iptv_lang', selectedLang); } catch (_) {}
      scheduleApplyHidden();
    });

    const btn = document.createElement('button');
    btn.id = 'vwIptvWlBtn';
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const ch = allChannels[currentIdx];
      if (!ch || !window.vwlToggle) return;
      window.vwlToggle({
        key  : chKey(ch),
        title: ch.name,
        image: ch.logo || IPTV_LOGO,
        cat  : 'shows',
      });
      updateWlBtn();
    });

    row.appendChild(sel);
    row.appendChild(btn);
    cont.appendChild(row);
    populateLangSelect();
    if (!langLoaded) loadLanguages();
    updateWlBtn();
  }

  async function playChannel(idx) {
    const ch = allChannels[idx];
    if (!ch) return;
    const token = ++playToken;
    stopHls();
    showTv();
    const v = tvVideo();
    currentIdx = idx;
    updateWlBtn();
    if (playerUI) {
      // Fresh channel — clear the previous channel's menus
      playerUI.setQualityOptions([{ value: 'auto', label: 'Auto' }], 'auto', () => {});
      playerUI.setSubtitleOptions?.([], -1, null);
    }
    if (spinner()) spinner().style.display = 'block';
    const done = () => { if (spinner()) spinner().style.display = 'none'; };
    let started = false; // playback got going at least once this attempt
    v.addEventListener('playing', () => { if (token === playToken) started = true; }, { once: true });
    const fail = (why) => {
      done();
      toast(`"${ch.name}" won't play — ${why}`);
      // Failing before ever playing = channel is dead, hide it. A fatal
      // error mid-watch is more likely a network blip — leave it listed.
      if (!started) {
        ch.dead = true;
        probeCache[ch.url] = { ok: false, ts: Date.now() };
        saveCacheSoon();
        scheduleApplyHidden();
      }
    };

    // Direct files play natively; everything else goes through hls.js
    if (/\.(mp4|webm|mp3|aac)(\?|$)/i.test(ch.url)) {
      v.src = ch.url;
      v.addEventListener('loadedmetadata', done, { once: true });
      v.addEventListener('error', () => fail('offline or blocked'), { once: true });
      v.play().catch(() => {});
      return;
    }

    let Hls = null;
    try { Hls = await loadHls(); } catch (_) {}
    if (token !== playToken) return;

    if (Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        subtitleDisplay: false, // off until picked in the CC menu
        // Live TV: modest buffers, quick startup
        maxBufferLength: 30,
        backBufferLength: 10,
        manifestLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 4,
      });
      hls.loadSource(ch.url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (token !== playToken) return;
        done();
        v.play().catch(() => {});
        // Quality menu from real ABR levels (same approach as megaplay-backup)
        if (playerUI && hls.levels?.length) {
          const heights = [...new Set(hls.levels.map((l) => l.height).filter(Boolean))]
            .sort((a, b) => b - a);
          const opts = [{ value: 'auto', label: 'Auto' }]
            .concat(heights.map((h) => ({ value: String(h), label: h + 'p' })));
          playerUI.setQualityOptions(opts, 'auto', (val) => {
            if (!hls || !hls.levels) return;
            if (val === 'auto') { hls.autoLevelCapping = -1; hls.currentLevel = -1; return; }
            let idx = -1, best = -1;
            hls.levels.forEach((l, i) => {
              if (l.height <= Number(val) && l.height > best) { best = l.height; idx = i; }
            });
            if (idx === -1) idx = 0;
            hls.autoLevelCapping = idx;
            hls.currentLevel = idx;
          });
        }
      });
      // Subtitles live inside the HLS stream — surface them in the player's
      // CC menu; picking one delegates to hls.js which loads + renders it.
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, d) => {
        if (token !== playToken) return;
        const tracks = d?.subtitleTracks || [];
        if (!tracks.length) return;
        if (playerUI?.setSubtitleOptions) {
          playerUI.setSubtitleOptions(
            tracks.map((t, i) => ({ label: t.name || t.lang || 'Track ' + (i + 1) })),
            hls.subtitleTrack >= 0 ? hls.subtitleTrack : -1,
            (sIdx) => {
              if (!hls) return;
              hls.subtitleDisplay = sIdx !== -1;
              hls.subtitleTrack = sIdx;
            },
          );
        } else {
          toast('Subtitles available — use the CC button in the player controls');
        }
      });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (token !== playToken || !d || !d.fatal) return;
        stopHls();
        fail('offline, geo-blocked, or missing CORS headers');
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = ch.url;
      v.addEventListener('loadedmetadata', done, { once: true });
      v.addEventListener('error', () => fail('offline or blocked'), { once: true });
      v.play().catch(() => {});
    } else {
      fail('no HLS support in this browser');
    }
  }

  // ── React to sentinel URLs landing in the iframe ────────────────────

  function onEmbedSrc(src) {
    const m = SENTINEL_RE.exec(src || '');
    if (!m) {
      // Modal closed or a different provider took over
      iptvActive = false;
      // Stop background probing off-screen; unflag so reopening re-enqueues
      probeQueue.forEach((i) => { const c = allChannels[i]; if (c) c.queued = false; });
      probeQueue.length = 0;
      if (frameEl() && frameEl().style.display !== 'none') hideTv();
      else { stopHls(); playToken++; }
      return;
    }
    iptvActive = true;
    injectControls();
    scheduleApplyHidden();
    const key = currentChapterKey();
    if (key) enqueueChapter(key);
    playChannel(Number(m[1]));
  }

  function watch() {
    const f = iframe();
    if (!f) return;
    const obs = new MutationObserver(() => onEmbedSrc(f.getAttribute('src')));
    obs.observe(f, { attributes: true, attributeFilter: ['src'] });
    if (f.getAttribute('src')) onEmbedSrc(f.getAttribute('src'));

    // Episode list re-renders on season change — re-apply hides and probe
    // the newly shown category.
    const list = document.getElementById('episodeListContainer');
    if (list) {
      const lobs = new MutationObserver(() => {
        if (!iptvActive) return;
        injectControls();
        scheduleApplyHidden();
        const key = currentChapterKey();
        if (key) enqueueChapter(key);
      });
      lobs.observe(list, { childList: true });
    }
  }

  // ── Public seams ────────────────────────────────────────────────────

  // content.js continue-watching: resolve a sentinel URL to channel info
  window.vwIptvChannelInfo = function (sentinel) {
    const m = SENTINEL_RE.exec(sentinel || '');
    if (!m) return null;
    const ch = allChannels[Number(m[1])];
    return ch ? { name: ch.name, logo: ch.logo, group: ch.group } : null;
  };

  // virohome.js watchlist view: open a saved IPTVCH_ item, loading the
  // playlist first if this session hasn't yet
  window.openIptvChannel = async function (key) {
    const url = keyUrl(key);
    if (!url) return false;
    if (!window._iptvLoaded) {
      toast('Loading channel list…');
      await new Promise((res) => {
        window.addEventListener('iptvReady', res, { once: true });
        buildIptvData();
      });
    }
    if (!window._iptvLoaded) return false;
    const ch = allChannels.find((c) => c.url === url);
    if (!ch) { toast('Channel is no longer in the IPTV playlist'); return false; }
    for (const k of Object.keys(chapterChannels)) {
      const pos = chapterChannels[k].indexOf(ch.idx);
      if (pos !== -1 && typeof window.viroResume === 'function') {
        return window.viroResume('shows', 'IPTV', k, pos);
      }
    }
    return false;
  };

  // ── Tiny toast ──────────────────────────────────────────────────────

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('vwIptvToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'vwIptvToast';
      t.style.cssText =
        'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
        'background:#111;color:#eee;padding:10px 18px;border-radius:8px;' +
        'font-family:"Kanit",sans-serif;font-size:.9rem;z-index:99999;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.5);opacity:0;transition:opacity .25s;' +
        'pointer-events:none;max-width:80vw;text-align:center;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 4000);
  }

  function injectCSS() {
    if (document.getElementById('vw-iptv-css')) return;
    const s = document.createElement('style');
    s.id = 'vw-iptv-css';
    s.textContent =
      '#vwIptvCtlRow{display:flex;gap:8px;margin-bottom:10px;}' +
      '#vwIptvLangSel,#vwIptvWlBtn{background:#1a1a1a;color:#eaeaea;border:none;' +
      'border-radius:10px;padding:10px 14px;font-size:.95rem;cursor:pointer;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.5);font-weight:300;font-family:inherit;' +
      'transition:background-color .3s ease;}' +
      '#vwIptvLangSel{flex:1;min-width:0;}' +
      '#vwIptvWlBtn{white-space:nowrap;}' +
      '#vwIptvWlBtn.vw-iptv-wl-on{color:#7ee787;}' +
      '#vwIptvLangSel:hover,#vwIptvLangSel:focus,#vwIptvWlBtn:hover{background:#333;outline:none;}';
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectCSS();
    // After megaplay-backup / vidnest register their observers, so our
    // show/hide of the iframe runs last on sentinel loads.
    setTimeout(watch, 600);
  });
})();
