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
  var seekT = parseInt(p.get("t") || "0", 10); // clip deep link → seek here
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
  }

  function toast(msg) {
    ensureToastStyles();
    var t = document.getElementById("vwl-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "vwl-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "vwl-show";
    clearTimeout(t._tid);
    t._tid = setTimeout(function () {
      t.className = "";
    }, 3200);
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
          // Small delay so the iframe/video src is actually set before any
          // pop-out can be triggered — viroResume() resolves as soon as
          // it *starts* loading the source, not once it's playable.
          setTimeout(function () {
            toast(seekT > 0 ? "Jumping to the shared moment…" : "Now playing.");
          }, 500);
          // clip deep link (?t=) → seek once a readable native player exists
          if (seekT > 0 && typeof window.vwSeekTo === "function") {
            setTimeout(function () { window.vwSeekTo(seekT); }, 900);
          }
        }
        return ok;
      })
      .catch(function () {
        toast("Couldn't open that title.");
      });
  }

  // KazoQueue/TMDB deep links point at the Vidnest/IMDB TV version of an
  // anime ("?play=VDT_12971&sk=S1" = Dragon Ball Z), which gets hidden from
  // search because its Vidnest stream isn't guaranteed to work. When the
  // title is also in the anikoto catalog, prefer that (MegaPlay) version and
  // let the ⇄ Source picker switch back to Vidnest/IMDB — otherwise the link
  // "works" but loads a broken player.
  function resumeTvPrefersAnime(play, seasonKey, epIdx) {
    var tmdbId = play.slice(4);
    var seasonNum = parseInt(String(seasonKey || "S1").replace(/[^0-9]/g, ""), 10) || 1;
    var tryAnime = function () {
      if (typeof window.vidnestTmdb !== "function" ||
          typeof window.anikotoTvToAnime !== "function") {
        return Promise.resolve(null);
      }
      return window.vidnestTmdb("/tv/" + tmdbId, {})
        .then(function (d) {
          if (!d || !d.name) return null;
          return window.anikotoTvToAnime(tmdbId, seasonNum, epIdx + 1, d.name);
        })
        .catch(function () { return null; });
    };
    return tryAnime().then(function (hit) {
      if (hit) {
        return resume("anime", "ANI_" + hit.id, "ANI_S1", hit.epIndex).then(
          function (ok) {
            // Anime source failed to open (no episodes yet / MegaPlay down) —
            // fall back to the Vidnest/IMDB version so the link still plays.
            return ok || resume("shows", play, seasonKey || "S1", epIdx);
          },
        );
      }
      return resume("shows", play, seasonKey || "S1", epIdx);
    });
  }

  waitFor(
    function () {
      return typeof window.viroResume === "function";
    },
    function () {
      if (play) {
        if (play.indexOf("VDM_") === 0) return resume("movies", play);
        if (play.indexOf("VDT_") === 0) return resumeTvPrefersAnime(play, sk || "S1", epIdx);
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
