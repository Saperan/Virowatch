/**
 * rumble-party.js — Rumble ⇄ Watch Party bridge
 *
 * Plain Rumble embed iframes give the page no play/pause/seek API, so
 * watch parties could only sync Rumble content per episode. While a party
 * is active this module swaps a Rumble embed for the same video played
 * through Rumble's official JS API (embedJS) — visually the same player,
 * but scriptable, so watchparty.js can read the clock, pause and seek.
 *
 * Outside a party nothing changes: the plain iframe embed stays.
 *
 * Non-invasive like megaplay-backup.js: observes #videoPlayer's src and
 * listens for the vw-party-changed event from watchparty.js. Exposes
 * window.vwRumbleParty.target() — the adapter watchparty.js polls
 * (getTime / getDuration / getPaused / seek / play / pause / hookInstant).
 * Every Rumble api call is guarded: if embedJS is blocked or its API
 * surface changes, the plain iframe comes back and playback still works
 * (episode-level sync only).
 */
(function () {
  "use strict";

  var VID_RE = /rumble\.com\/embed\/([a-z0-9]+)/i;
  var PUB_RE = /[?&]pub=([a-z0-9]+)/i;
  var LIB_TIMEOUT = 8000; // ms before giving up on embedJS → restore the iframe

  var current = null;   // { video, pub, src } while the JS-API player is live
  var api = null;       // Rumble player api object for the current video
  var apiToken = 0;     // invalidates api callbacks from an older load
  var paused = true;    // event-tracked fallbacks in case getters are missing
  var lastTime = 0;
  var instantFn = null; // watchparty's "publish the clock now" hook (host)
  var selfSetting = false; // guard our own #videoPlayer src writes
  var libTid = null;

  function iframe() { return document.getElementById("videoPlayer"); }

  function partyOn() {
    return typeof window.vwPartyActive === "function" && window.vwPartyActive();
  }

  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }

  function toast(msg) {
    var t = document.getElementById("vwl-toast");
    if (!t) { t = document.createElement("div"); t.id = "vwl-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "vwl-show";
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.className = ""; }, 2600);
  }

  // ── Mount that replaces the iframe while the JS player is live ────
  function mount() {
    var m = document.getElementById("viroRumbleMount");
    if (!m) {
      m = document.createElement("div");
      m.id = "viroRumbleMount";
      // Same box the iframe filled, so the player layout doesn't move.
      m.style.cssText =
        "flex:1;width:100%;min-height:200px;background:#000;border:0;" +
        "display:none;position:relative;";
      var f = iframe();
      if (f && f.parentNode) f.parentNode.insertBefore(m, f.nextSibling);
    }
    return m;
  }

  function injectCSS() {
    if (document.getElementById("viro-rumble-css")) return;
    var s = document.createElement("style");
    s.id = "viro-rumble-css";
    s.textContent =
      "#viroRumbleMount iframe,#viroRumbleMount>div{position:absolute;" +
      "inset:0;width:100%!important;height:100%!important;border:0;}";
    document.head.appendChild(s);
  }

  function show() {
    if (!current) return;
    var f = iframe();
    if (f) f.style.display = "none";
    mount().style.display = "";
  }

  // ── Rumble embedJS (official bootstrap — queues calls until loaded) ─
  function ensureLib(pub, video) {
    if (window.Rumble) return;
    (function (r, u, m, b) {
      r._Rumble = b;
      if (r[b]) return;
      r[b] = function () {
        (r[b]._ = r[b]._ || []).push(arguments);
        if (r[b]._.length === 1) {
          var l = u.createElement(m);
          var e = u.getElementsByTagName(m)[0];
          l.async = 1;
          l.src = "https://rumble.com/embedJS/u" + pub + "." + video +
            "/?url=" + encodeURIComponent(location.href) +
            "&args=" + encodeURIComponent(JSON.stringify([].slice.apply(arguments)));
          e.parentNode.insertBefore(l, e);
        }
      };
    })(window, document, "script", "Rumble");
  }

  function trackTime(e) {
    if (typeof e === "number") lastTime = e;
    else if (e && typeof e.time === "number") lastTime = e.time;
    else if (e && typeof e.currentTime === "number") lastTime = e.currentTime;
  }

  function hookApi(a) {
    if (typeof a.on !== "function") return;
    var ping = function () {
      if (instantFn) { try { instantFn(); } catch (_) {} }
    };
    [
      ["play", function () { paused = false; ping(); }],
      ["pause", function () { paused = true; ping(); }],
      ["seek", ping],
      ["seeked", ping],
      ["videoEnd", function () { paused = true; }],
      ["timeupdate", trackTime],
      ["timeUpdate", trackTime],
    ].forEach(function (h) {
      try { a.on(h[0], h[1]); } catch (_) {} // unknown event names are fine
    });
  }

  function playViaApi() {
    var m = mount();
    m.innerHTML = "";
    var inner = document.createElement("div");
    inner.id = "viroRumbleP" + Date.now().toString(36);
    m.appendChild(inner);
    api = null;
    paused = true;
    lastTime = 0;
    var token = ++apiToken;

    ensureLib(current.pub, current.video);
    try {
      window.Rumble("play", {
        video: current.video,
        div: inner.id,
        api: function (a) {
          if (token !== apiToken || !a) return;
          clearTimeout(libTid);
          api = a;
          hookApi(a);
        },
      });
    } catch (_) { restore(true); return; }

    // embedJS blocked / down → give the plain iframe back so playback works
    clearTimeout(libTid);
    libTid = setTimeout(function () {
      if (token === apiToken && !api) restore(true);
    }, LIB_TIMEOUT);
  }

  // ── Convert / restore ─────────────────────────────────────────────
  function convert(src) {
    var vm = VID_RE.exec(src || "");
    if (!vm) return;
    var pm = PUB_RE.exec(src);
    current = { video: vm[1].toLowerCase(), pub: pm ? pm[1] : "4", src: src };

    var f = iframe();
    if (f) {
      selfSetting = true;
      f.src = "about:blank"; // stop the plain embed's audio
      setTimeout(function () { selfSetting = false; }, 0);
    }
    show();
    playViaApi();
    // megaplay-backup's observer reacts to the about:blank write by
    // un-hiding the iframe (its teardown) — re-assert after it ran.
    setTimeout(show, 60);
  }

  function restore(reloadEmbed) {
    clearTimeout(libTid);
    apiToken++; // cancel in-flight api callbacks / lib timeout
    api = null;
    instantFn = null;
    var m = document.getElementById("viroRumbleMount");
    if (m) { m.innerHTML = ""; m.style.display = "none"; }
    var f = iframe();
    // Only un-hide the iframe when we bring the Rumble embed back ourselves
    // (party ended). On provider switches content.js/megaplay-backup own the
    // iframe's visibility — megaplay hides it for the Backup player in the
    // same mutation batch that lands here, and it must stay hidden.
    if (f && reloadEmbed && current && current.src) {
      f.style.display = "";
      selfSetting = true;
      f.src = current.src;
      setTimeout(function () { selfSetting = false; }, 0);
    }
    current = null;
  }

  // ── Adapter for watchparty.js ─────────────────────────────────────
  window.vwRumbleParty = {
    target: function () {
      if (!api || !current) return null;
      return {
        getTime: function () {
          try {
            if (typeof api.getCurrentTime === "function") return num(api.getCurrentTime());
          } catch (_) {}
          return lastTime;
        },
        getDuration: function () {
          try {
            if (typeof api.getDuration === "function") return num(api.getDuration());
          } catch (_) {}
          return 0;
        },
        getPaused: function () {
          try {
            if (typeof api.getPaused === "function") return !!api.getPaused();
          } catch (_) {}
          return paused;
        },
        seek: function (t) {
          try {
            if (typeof api.setCurrentTime === "function") api.setCurrentTime(num(t));
          } catch (_) {}
        },
        play: function () {
          try { if (typeof api.play === "function") api.play(); } catch (_) {}
        },
        pause: function () {
          try { if (typeof api.pause === "function") api.pause(); } catch (_) {}
        },
        hookInstant: function (fn) { instantFn = fn; },
      };
    },
    // debugging aid — inspect the live Rumble api from the console
    _debug: function () {
      return { api: api, current: current, paused: paused, lastTime: lastTime };
    },
  };

  // ── React to episode loads + party start/stop ─────────────────────
  function onSrc(src) {
    if (!VID_RE.test(src || "") || !partyOn()) {
      // Left Rumble content (or no party) — clean up if we were live.
      if (current) restore(false);
      return;
    }
    if (current && current.src === src && api) return; // already on this video
    convert(src);
  }

  window.addEventListener("vw-party-changed", function (e) {
    var active = e && e.detail && e.detail.active;
    if (active) {
      var f = iframe();
      var src = f && f.getAttribute("src");
      if (src && VID_RE.test(src)) {
        toast("Watch party — Rumble player now syncs play/pause");
        convert(src);
      }
    } else if (current) {
      restore(true); // party over — back to the plain embed, same video
    }
  });

  function watch() {
    var f = iframe();
    if (!f) return;
    new MutationObserver(function () {
      if (selfSetting) return;
      onSrc(f.getAttribute("src"));
    }).observe(f, { attributes: true, attributeFilter: ["src"] });
    if (f.getAttribute("src")) onSrc(f.getAttribute("src"));
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      injectCSS();
      watch();
    }, 400);
  });
})();
