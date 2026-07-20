/**
 * deeplink.js — auto-open a title from a URL the Discord bot builds.
 *
 * The bot's "▶ Watch in Virowatch" buttons link here with query params:
 *   ?play=VDM_<tmdbId>                       → a movie
 *   ?play=VDT_<tmdbId>&sk=S<season>&ep=<n>   → a TV episode (n = TMDB episode
 *                                              number within that TMDB season)
 *   ?play=ANI_<anikotoId>&ep=<n>             → an anime episode
 *   ?anilist=<mediaId>&ep=<n>                → anime by AniList id (resolved to
 *                                              the Anikoto catalog entry here)
 *   &dub=1                                   → start on the dub
 *
 * It waits for content.js's window.viroResume() to exist, then calls it — the
 * same entrypoint the watchlist / continue-watching rails use, so injection of
 * Vidnest/Anikoto titles and starting at a specific episode are already handled.
 *
 * Load it last, after content.js / vidnest-loader.js / anikoto-loader.js:
 *   <script src="deeplink.js" defer></script>
 */
(function () {
  "use strict";

  var p = new URLSearchParams(location.search);
  var play = p.get("play"); // VDM_/VDT_/ANI_
  var anilist = p.get("anilist"); // AniList media id (anime)
  var sk = p.get("sk"); // season key for shows, e.g. "S1"
  var epNum = parseInt(p.get("ep") || "1", 10);
  var dub = p.get("dub") === "1";
  if (!play && !anilist) return;

  var epIdx = Math.max(0, (isNaN(epNum) ? 1 : epNum) - 1); // video[] is 0-based

  // Toast — shares the site-wide #vwl-toast pill (same one anilist.js/
  // watchlist.js/vidnest-loader.js/etc. all target) instead of a one-off
  // style, so this popup actually matches the rest of the design. deeplink.js
  // loads `defer`, which can run before watchlist.js's DOMContentLoaded
  // handler injects that shared CSS, so the base rule is duplicated here
  // under the same #vwl-styles id — injectCSS() calls from either file are
  // idempotent (first one wins, second one no-ops).
  function ensureToastStyles() {
    if (!document.getElementById("vwl-styles")) {
      var base = document.createElement("style");
      base.id = "vwl-styles";
      base.textContent =
        '#vwl-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(8px);background:rgba(20,20,20,.92);color:rgba(255,255,255,.93);padding:7px 18px;border-radius:18px;font-size:.82rem;font-family:"Kanit",sans-serif;opacity:0;pointer-events:none;z-index:99999;white-space:nowrap;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);transition:opacity .22s,transform .22s;}' +
        '#vwl-toast.vwl-show{opacity:1;transform:translateX(-50%) translateY(0);}';
      document.head.appendChild(base);
    }
    if (!document.getElementById("vw-deeplink-styles")) {
      var s = document.createElement("style");
      s.id = "vw-deeplink-styles";
      s.textContent =
        // action variant: wider, clickable, room for the pop-out button
        '#vwl-toast.vw-dl-action{pointer-events:auto;white-space:normal;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 18px;}' +
        '.vw-dl-btn{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16);color:#fff;font-family:"Kanit",sans-serif;font-size:.78rem;font-weight:500;padding:6px 12px;border-radius:14px;cursor:pointer;transition:background .18s,border-color .18s;}' +
        '.vw-dl-btn:hover{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.3);}' +
        '.vw-dl-btn:active{transform:scale(.96);}' +
        '.vw-dl-btn svg{width:12px;height:12px;flex-shrink:0;}';
      document.head.appendChild(s);
    }
  }

  var POPOUT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="14" rx="2"/><rect x="12" y="9.5" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>';

  // opts: { action: { label, onClick }, duration }
  function toast(msg, opts) {
    ensureToastStyles();
    var t = document.getElementById("vwl-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "vwl-toast";
      document.body.appendChild(t);
    }
    t.innerHTML = "";
    var span = document.createElement("span");
    span.textContent = msg;
    t.appendChild(span);
    var hasAction = !!(opts && opts.action);
    if (hasAction) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vw-dl-btn";
      btn.innerHTML = POPOUT_ICON + "<span>" + opts.action.label + "</span>";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        opts.action.onClick();
      });
      t.appendChild(btn);
    }
    t.className = "vwl-show" + (hasAction ? " vw-dl-action" : "");
    clearTimeout(t._tid);
    t._tid = setTimeout(
      function () {
        t.className = "";
      },
      (opts && opts.duration) || (hasAction ? 8000 : 3200),
    );
  }

  // Actual pop-out (native video PiP / Document PiP for iframe embeds) now
  // lives in popout-player.js, shared with the always-visible ⧉ Pop out
  // button next to the Dubbed toggle — this just calls it.
  function popOutPlayer() {
    if (typeof window.viroPopOut === "function") window.viroPopOut();
  }

  function waitFor(cond, cb, tries) {
    tries = tries == null ? 160 : tries; // ~40s at 250ms
    if (cond()) return cb();
    if (tries <= 0) {
      toast("Virowatch didn't finish loading — try the link again.");
      return;
    }
    setTimeout(function () {
      waitFor(cond, cb, tries - 1);
    }, 250);
  }

  function resume(cat, key, seasonKey, index) {
    return Promise.resolve(window.viroResume(cat, key, seasonKey, index, dub))
      .then(function (ok) {
        // content.js's saveState() now keeps the address bar synced to
        // whatever is playing, so nothing to clean up here on success —
        // the ?play=... URL stays live and shareable/refreshable.
        if (!ok) {
          toast("That title isn't available on this source.");
        } else {
          // Small delay so the iframe/video src is actually set before the
          // pop-out button can be clicked — viroResume() resolves as soon as
          // it *starts* loading the source, not once it's playable.
          setTimeout(function () {
            toast("Now playing.", {
              action: { label: "Pop out", onClick: popOutPlayer },
            });
          }, 500);
        }
        return ok;
      })
      .catch(function () {
        toast("Couldn't open that title.");
      });
  }

  waitFor(
    function () {
      return typeof window.viroResume === "function";
    },
    function () {
      if (play) {
        if (play.indexOf("VDM_") === 0) return resume("movies", play);
        if (play.indexOf("VDT_") === 0) return resume("shows", play, sk || "S1", epIdx);
        if (play.indexOf("ANI_") === 0) return resume("anime", play, "ANI_S1", epIdx);
        return;
      }
      // anime by AniList id → resolve to the Anikoto catalog entry, then play.
      var go = function () {
        var entry =
          typeof window.anikotoFindByAniList === "function"
            ? window.anikotoFindByAniList(anilist)
            : null;
        if (!entry) {
          toast("Not on the anime source yet — check back after it airs.");
          return;
        }
        resume("anime", "ANI_" + entry.id, "ANI_S1", epIdx);
      };
      if (typeof window.anikotoEnsureIndex === "function") {
        toast("Finding episode…");
        window.anikotoEnsureIndex().then(go).catch(go);
      } else {
        go();
      }
    },
  );
})();
