/**
 * popout-player.js — pop the active player out into a floating, always-on-top
 * window so playback continues while browsing the rest of the site.
 *
 * Real <video> sources (Vidnest / the anime-api backup player) hand this
 * straight to the browser's native Picture-in-Picture — an OS-level floating
 * window on both Windows and Android already: always on top, freely
 * resizable, no custom window code needed. Iframe-embed sources
 * (Anikoto/Megaplay/Lunora) don't expose a <video> we control, so those fall
 * back to Document Picture-in-Picture (Chrome/Edge desktop only — Android
 * has no Document PiP yet) with a fresh iframe on the same src, since moving
 * the live #videoPlayer node into another document would break every other
 * script that looks it up via document.getElementById.
 *
 * Exposes window.viroPopOut() so any caller (the header button here,
 * deeplink.js's "Now playing" toast, etc.) triggers the same pop-out.
 */
(function () {
  "use strict";

  // Shared #vwl-toast pill (same one anilist.js/watchlist.js/vidnest-loader.js
  // target) — injected here too since load order isn't guaranteed either way.
  function toast(msg) {
    var t = document.getElementById("vwl-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "vwl-toast";
      document.body.appendChild(t);
    }
    if (!document.getElementById("vwl-styles")) {
      var s = document.createElement("style");
      s.id = "vwl-styles";
      s.textContent =
        '#vwl-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(8px);background:rgba(20,20,20,.92);color:rgba(255,255,255,.93);padding:7px 18px;border-radius:18px;font-size:.82rem;font-family:"Kanit",sans-serif;opacity:0;pointer-events:none;z-index:99999;white-space:nowrap;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);transition:opacity .22s,transform .22s;}' +
        '#vwl-toast.vwl-show{opacity:1;transform:translateX(-50%) translateY(0);}';
      document.head.appendChild(s);
    }
    t.textContent = msg;
    t.className = "vwl-show";
    clearTimeout(t._tid);
    t._tid = setTimeout(function () {
      t.className = "";
    }, 3200);
  }

  function activePlayerVideo() {
    var vids = document.querySelectorAll(".player video");
    for (var i = 0; i < vids.length; i++) {
      if (vids[i].offsetParent !== null && !vids[i].paused) return vids[i];
    }
    for (var j = 0; j < vids.length; j++) {
      if (vids[j].offsetParent !== null) return vids[j];
    }
    return null;
  }

  function popOut() {
    var video = activePlayerVideo();
    if (video) {
      if (!video.requestPictureInPicture) {
        toast("Pop-out isn't supported in this browser.");
        return;
      }
      if (document.pictureInPictureElement === video) {
        document.exitPictureInPicture().catch(function () {});
        return;
      }
      video
        .requestPictureInPicture()
        .then(function () {
          toast("Floating on top — browse away, it'll keep playing.");
        })
        .catch(function () {
          toast("Give the video a second to start, then try pop-out again.");
        });
      return;
    }

    var iframe = document.getElementById("videoPlayer");
    var src = iframe && iframe.style.display !== "none" && iframe.src;
    if (!src) {
      toast("Nothing is playing yet.");
      return;
    }
    if (!("documentPictureInPicture" in window)) {
      toast("Pop-out needs Chrome or Edge for this source.");
      return;
    }
    window.documentPictureInPicture
      .requestWindow({ width: 480, height: 270 })
      .then(function (w) {
        var titleEl = document.getElementById("nowPlayingTitle");
        w.document.title = (titleEl && titleEl.textContent) || "Virowatch";
        var st = w.document.createElement("style");
        st.textContent =
          "html,body{margin:0;height:100%;background:#000}" +
          "iframe{width:100%;height:100%;border:0;display:block}";
        w.document.head.appendChild(st);
        var f = w.document.createElement("iframe");
        f.src = src;
        f.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
        f.allowFullscreen = true;
        w.document.body.appendChild(f);
        toast("Floating window opened — same episode, from the start.");
      })
      .catch(function () {
        toast("Couldn't open the pop-out window.");
      });
  }

  window.viroPopOut = popOut;

  function init() {
    var btn = document.getElementById("popOutBtn");
    if (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        popOut();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
