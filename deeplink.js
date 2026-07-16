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

  // Minimal self-contained toast (the loaders' own toast() helpers are private).
  function toast(msg) {
    var t = document.getElementById("vw-deeplink-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "vw-deeplink-toast";
      t.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
        "background:rgba(20,20,28,.95);color:#eaeaea;font:14px/1.4 system-ui,sans-serif;" +
        "padding:10px 16px;border-radius:10px;z-index:99999;max-width:80vw;text-align:center;" +
        "box-shadow:0 6px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .2s;";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(function () {
      t.style.opacity = "1";
    });
    clearTimeout(t._tid);
    t._tid = setTimeout(function () {
      t.style.opacity = "0";
    }, 3200);
  }

  // Drop the params so a refresh / back-navigation doesn't replay the open.
  function clean() {
    try {
      history.replaceState(null, "", location.pathname + location.hash);
    } catch (_) {}
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
        if (ok) clean();
        else toast("That title isn't available on this source.");
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
