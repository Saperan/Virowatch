/**
 * rumble-source.js  —  native embed catalogs as a last-chance source
 *
 * Merges the rumble-content catalogs (anime.js, shows.js, lunora-loader)
 * into the per-episode ⇄ Source picker (anime-api.js's #vwSrcBtn popup):
 * when the currently playing title also exists in the native catalog for
 * its category, a "Rumble" row appears LAST in the list. Picking it swaps
 * playback to the native entry at the same season/episode. Native streams
 * are only ever touched on selection — nothing is prefetched.
 *
 * PitSport & IPTV are their own loaders (pitsport-live.js, iptv.js) that
 * merely live inside shows.js — they are excluded entirely, and so are the
 * injected anikoto/vidnest entries (they have better sources already).
 *
 * Requires: content.js (mediaData, vw-nowplaying, viroResume) and
 * anime-api.js (vwSrcShow / vwSrcHide / vwSrcClose / vwAnimeApi.label).
 */
(function () {
  "use strict";

  var RESERVED = {
    title: 1,
    image: 1,
    video: 1,
    episodeTitles: 1,
    customDownloads: 1,
    dubbed: 1,
    dubbedepisodetitle: 1,
    dubbedcustomdownloads: 1,
  };
  var EXCLUDE_KEYS = { PITSORT: 1, IPTV: 1 };
  var ANIME_APIS = ["anikoto", "cloudflare", "vidnest", "vidwish"];

  function normTitle(t) {
    return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  // Loose fallback for titles that normalize differently across catalogs
  // ("Girls und Panzer" vs "Girls & Panzer" won't match — too short — but
  // longer ones with punctuation/word-order noise do). Min length guards
  // against short titles like "From" eating unrelated matches.
  function closeEnough(a, b) {
    return (
      a.length >= 10 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)
    );
  }

  var index = null;
  var indexHasLunora = false;

  // { normTitle: [{ cat, key, seasons: [{sk, n, len, hasDub}] }] }
  function buildIndex() {
    var idx = {};
    ["anime", "shows", "lunora"].forEach(function (cat) {
      var catData = (window.mediaData && window.mediaData[cat]) || {};
      Object.entries(catData).forEach(function (pair) {
        var key = pair[0],
          info = pair[1];
        if (!info || typeof info !== "object") return;
        if (info._hidden || EXCLUDE_KEYS[key] || /^VD/.test(key)) return;
        var nt = normTitle(info.title || key);
        if (!nt) return;
        var seasons = [];
        Object.entries(info).forEach(function (sp) {
          var sk = sp[0],
            s = sp[1];
          if (RESERVED[sk] || !s || typeof s !== "object") return;
          if (Array.isArray(s.video) && s.video.length) {
            var m = String(sk).match(/(\d+)\s*$/);
            seasons.push({
              sk: sk,
              n: m ? parseInt(m[1], 10) : 0,
              len: s.video.length,
              hasDub: Array.isArray(s.dubbed) && s.dubbed.length > 0,
            });
          }
        });
        // Flat movies (lunora "Main Movie" style) carry video at top level
        if (!seasons.length && Array.isArray(info.video) && info.video.length) {
          seasons.push({ sk: null, n: 0, len: info.video.length, hasDub: false });
        }
        if (!seasons.length) return;
        (idx[nt] = idx[nt] || []).push({
          cat: cat,
          key: key,
          title: nt,
          seasons: seasons,
        });
      });
    });
    return idx;
  }

  // Built lazily on the first play; rebuilt once the on-demand lunora
  // catalog arrives so its titles can match too.
  function ensureIndex() {
    var lunoraLoaded =
      !!(window.lunoraLoader && window.lunoraLoader.isLoaded()) ||
      (window.mediaData &&
        Object.keys(window.mediaData.lunora || {}).length > 0);
    if (!index || (lunoraLoaded && !indexHasLunora)) {
      index = buildIndex();
      indexHasLunora = lunoraLoaded;
    }
    return index;
  }

  function nativeMatches(title, cat) {
    var target = cat === "movies" ? "lunora" : cat;
    var nt = normTitle(title);
    if (!nt) return [];
    var all = ensureIndex()[nt] || [];
    var exact = all.filter(function (m) {
      return m.cat === target;
    });
    if (exact.length) return exact;
    return all.filter(function (m) {
      return m.cat === target && closeEnough(nt, m.title);
    });
  }

  // Match the dynamic season/episode to the native catalog's layout:
  // same trailing season number if there is one, else the first season.
  function bestSeason(entry, curSeason, ep) {
    var s = entry.seasons;
    if (!s.length) return null;
    var pick = null;
    if (curSeason) {
      var m = String(curSeason).match(/(\d+)\s*$/);
      if (m) pick = s.find(function (x) { return x.n === parseInt(m[1], 10); });
    }
    if (!pick) pick = s.find(function (x) { return x.n === 1; }) || s[0];
    return {
      sk: pick.sk,
      ep: Math.min(ep || 0, pick.len - 1),
      hasDub: pick.hasDub,
    };
  }

  // Switching sources = playing the native entry at the same episode;
  // content.js's viroResume handles lunora's on-demand fetch as well.
  function playRumble(entry, d) {
    var p = bestSeason(entry, d.season, d.ep);
    if (!p || typeof window.viroResume !== "function") return;
    // Tear down the direct-stream players first, or the vidnest <video>
    // (and a megaplay backup video) keeps playing under the native iframe —
    // same vwVidnestStopAll teardown every other source switch uses.
    if (window.vwVidnestStopAll) window.vwVidnestStopAll();
    if (window.vwSuspendAutoBackup) window.vwSuspendAutoBackup();
    window.viroResume(entry.cat, entry.key, p.sk, p.ep, !!(d.dubbed && p.hasDub));
  }

  function apiRows() {
    return ANIME_APIS.map(function (api) {
      return {
        label: window.vwAnimeApi ? window.vwAnimeApi.label(api) : api,
        active: !!(window.vwAnimeApi && window.vwAnimeApi.get() === api),
        onClick: function () {
          if (window.vwAnimeApi) window.vwAnimeApi.set(api);
          if (window.vwSrcClose) window.vwSrcClose();
        },
      };
    });
  }

  function currentLabel(d) {
    var key = d.mov || "";
    if (key.indexOf("ANI_") === 0 || key.indexOf("VDA_") === 0) {
      return window.vwAnimeApi
        ? window.vwAnimeApi.label(window.vwAnimeApi.get())
        : "Anikoto";
    }
    if (key.indexOf("VDT_") === 0 || key.indexOf("VDM_") === 0) return "Vidnest";
    return "Rumble";
  }

  var lastDetail = null;

  function evalNow() {
    var d = lastDetail;
    if (!d || !d.cat || !d.mov || d.mov === "PITSORT" || d.mov === "IPTV") {
      if (window.vwSrcHide) window.vwSrcHide();
      return;
    }
    var info =
      (window.mediaData &&
        window.mediaData[d.cat] &&
        window.mediaData[d.cat][d.mov]) ||
      {};
    var matches = nativeMatches(info.title || d.mov, d.cat);
    var nativeNow = matches.some(function (m) { return m.key === d.mov; });
    var rows = [];
    var key = d.mov;

    if (key.indexOf("ANI_") === 0 || key.indexOf("VDA_") === 0) {
      rows.push.apply(rows, apiRows());
    } else if (key.indexOf("VDT_") === 0 || key.indexOf("VDM_") === 0) {
      rows.push({
        label: "Vidnest",
        active: true,
        onClick: function () { if (window.vwSrcClose) window.vwSrcClose(); },
      });
    }

    // Rumble = always last, only when the native catalog has this title
    if (matches.length) {
      rows.push({
        label: "Rumble",
        active: nativeNow,
        onClick: nativeNow
          ? function () { if (window.vwSrcClose) window.vwSrcClose(); }
          : function () { playRumble(matches[0], d); },
      });
    }

    if (!rows.length) {
      if (window.vwSrcHide) window.vwSrcHide();
      return;
    }
    if (window.vwSrcShow) window.vwSrcShow(rows, currentLabel(d));
  }

  function onNowPlaying(d) {
    lastDetail = d || null;
    if (!d || !d.cat || !d.mov || d.mov === "PITSORT" || d.mov === "IPTV") {
      if (window.vwSrcHide) window.vwSrcHide();
      return;
    }
    // The lunora catalog is fetched on demand — pull it before matching
    if (d.cat === "movies" || d.cat === "lunora") {
      var lr = window.lunoraLoader;
      if (lr && !lr.isLoaded()) {
        lr.load().then(evalNow).catch(function () {
          if (window.vwSrcHide) window.vwSrcHide();
        });
        return;
      }
    }
    evalNow();
  }

  window.addEventListener("vw-nowplaying", function (e) {
    onNowPlaying(e.detail || null);
  });
  window.addEventListener("vw-anime-api-changed", function () {
    if (lastDetail) evalNow(); // refresh label/active dot when the pref changes
  });

  window.vwRumbleSource = { refresh: evalNow };
})();
