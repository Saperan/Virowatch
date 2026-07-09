/**
 * airing.js — "Airing soon" strip on the home view (#airingStrip)
 *
 * AniList public airing schedule (no login needed): shows episodes that
 * just aired (NEW badge) and the next ones about to air, with times in
 * the visitor's local timezone. Auto-scrolls horizontally like a ticker;
 * manual scroll/touch pauses it. Clicking an item opens the show via the
 * anikoto catalog when it's mapped, otherwise its AniList page.
 *
 * Data is cached in localStorage ("vw_airing", 10 min TTL) to stay well
 * under AniList's rate limit; badge times refresh in place every minute.
 */
(function () {
  "use strict";

  var API = "https://graphql.anilist.co";
  var LS_KEY = "vw_airing_v2"; // v2: items grew img + desc for the modal
  var CACHE_TTL = 10 * 60 * 1000; // refetch after 10 min
  var MAX_ITEMS = 10; // strip shows this many; modal shows everything
  var MODAL_MAX = 30;
  var LOOKBACK = 90 * 60; // include episodes aired in the last 90 min ("NEW")
  var MIN_POPULARITY = 3000; // drop titles nobody tracks
  var SPEED = 24; // marquee px per second

  var QUERY =
    "query($from:Int){Page(perPage:50){airingSchedules(airingAt_greater:$from,sort:TIME){" +
    "airingAt episode media{id isAdult popularity format description " +
    "coverImage{large} title{english romaji}}}}}";

  var items = []; // [{id,title,ep,airingAt,img,desc}]
  var stripItems = []; // first MAX_ITEMS of the above (marquee source)
  var strip, viewport, track;
  var marquee = { raf: 0, paused: false, resumeTimer: 0, last: 0 };
  var reducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Data ─────────────────────────────────────────────────────── */
  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (c && c.t && Array.isArray(c.items)) return c;
    } catch (_) {}
    return null;
  }

  function fetchSchedule() {
    var from = Math.floor(Date.now() / 1000) - LOOKBACK;
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { from: from } }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("AniList " + r.status);
        return r.json();
      })
      .then(function (j) {
        var raw =
          (j.data && j.data.Page && j.data.Page.airingSchedules) || [];
        var list = raw
          .filter(function (s) {
            var m = s.media;
            return (
              m &&
              !m.isAdult &&
              m.format !== "MUSIC" &&
              (m.popularity || 0) >= MIN_POPULARITY
            );
          })
          .slice(0, MODAL_MAX)
          .map(function (s) {
            return {
              id: s.media.id,
              title: s.media.title.english || s.media.title.romaji,
              ep: s.episode,
              airingAt: s.airingAt,
              img: (s.media.coverImage && s.media.coverImage.large) || "",
              desc: cleanDesc(s.media.description),
            };
          });
        try {
          localStorage.setItem(
            LS_KEY,
            JSON.stringify({ t: Date.now(), items: list }),
          );
        } catch (_) {}
        return list;
      });
  }

  // AniList descriptions arrive as loose HTML — flatten to one line of
  // plain text (strip tags, then a <textarea> decodes the entities safely)
  function cleanDesc(raw) {
    var txt = (raw || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/\(Source:[^)]*\)\s*$/i, "");
    var ta = document.createElement("textarea");
    ta.innerHTML = txt;
    return ta.value.replace(/\s+/g, " ").trim();
  }

  /* ── Local-time labels ────────────────────────────────────────── */
  function fmtWhen(ts) {
    var diff = ts * 1000 - Date.now();
    if (diff <= 0) return "NEW";
    if (diff < 3600e3) return "in " + Math.max(1, Math.round(diff / 60000)) + "m";
    var d = new Date(ts * 1000);
    var now = new Date();
    var time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time;
    var tom = new Date(now);
    tom.setDate(now.getDate() + 1);
    if (d.toDateString() === tom.toDateString()) return "tmrw " + time;
    return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
  }

  // Absolute local date for the modal rows ("Thu, Jul 10, 9:30 PM")
  function fmtDate(ts) {
    return new Date(ts * 1000).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function refreshBadges() {
    // strip + modal rows both tag their badges with data-at
    document.querySelectorAll(".sbadge[data-at]").forEach(function (b) {
      var label = fmtWhen(Number(b.dataset.at));
      if (b.textContent !== label) {
        b.textContent = label;
        b.className = "sbadge " + (label === "NEW" ? "new" : "time");
      }
    });
  }

  /* ── Click-through ────────────────────────────────────────────── */
  function openItem(aniListId) {
    function tryCatalog() {
      var hit =
        typeof window.anikotoFindByAniList === "function" &&
        window.anikotoFindByAniList(aniListId);
      if (hit && typeof window.openAnikotoById === "function") {
        window.openAnikotoById(hit.id);
        return true;
      }
      return false;
    }
    if (tryCatalog()) return;
    if (typeof window.anikotoEnsureIndex === "function") {
      window.anikotoEnsureIndex().then(function () {
        if (!tryCatalog()) {
          window.open("https://anilist.co/anime/" + aniListId, "_blank", "noopener");
        }
      });
    } else {
      window.open("https://anilist.co/anime/" + aniListId, "_blank", "noopener");
    }
  }

  /* ── Full-schedule modal (click the "Airing soon" header) ─────── */
  var modal = null;

  function ensureModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.id = "vwAiring";
    modal.className = "vws-overlay"; // reuse the Settings modal shell look
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="vws-modal vwair-modal" role="dialog" aria-modal="true" aria-label="Airing soon">' +
      '<div class="vws-header"><span class="live-dot"></span>' +
      '<div><div class="vws-title">Airing soon</div>' +
      '<div class="vws-sub">AniList schedule · your local time</div></div>' +
      '<button type="button" class="vws-close" aria-label="Close">×</button>' +
      '</div><div class="vwair-list"></div></div>';
    document.body.appendChild(modal);
    modal.querySelector(".vws-close").addEventListener("click", closeModal);
    modal.addEventListener("mousedown", function (e) {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("vws-open"))
        closeModal();
    });
  }

  function renderModalList() {
    var list = modal.querySelector(".vwair-list");
    list.innerHTML = "";
    items.forEach(function (it) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "vwair-row";

      var img = document.createElement("img");
      img.className = "vwair-img";
      img.loading = "lazy";
      img.alt = "";
      if (it.img) img.src = it.img;

      var info = document.createElement("span");
      info.className = "vwair-info";
      var t = document.createElement("span");
      t.className = "vwair-title";
      t.textContent = it.title;
      var meta = document.createElement("span");
      meta.className = "vwair-meta";
      var label = fmtWhen(it.airingAt);
      var badge = document.createElement("b");
      badge.className = "sbadge " + (label === "NEW" ? "new" : "time");
      badge.textContent = label;
      badge.dataset.at = String(it.airingAt);
      meta.appendChild(badge);
      meta.appendChild(
        document.createTextNode("EP " + it.ep + " · " + fmtDate(it.airingAt)),
      );
      var d = document.createElement("span");
      d.className = "vwair-desc";
      d.textContent = it.desc || "No description on AniList yet.";
      info.appendChild(t);
      info.appendChild(meta);
      info.appendChild(d);

      row.appendChild(img);
      row.appendChild(info);
      row.addEventListener("click", function () {
        closeModal();
        openItem(it.id); // plays via anikoto when mapped, AniList page otherwise
      });
      list.appendChild(row);
    });
  }

  function openModal() {
    ensureModal();
    renderModalList();
    if (window.vwSettingsClose) window.vwSettingsClose(); // one popup at a time
    modal.classList.add("vws-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("vws-open");
    modal.setAttribute("aria-hidden", "true");
  }

  /* ── Render ───────────────────────────────────────────────────── */
  function buildItem(it) {
    var el = document.createElement("div");
    el.className = "sport";
    var badge = document.createElement("span");
    var label = fmtWhen(it.airingAt);
    badge.className = "sbadge " + (label === "NEW" ? "new" : "time");
    badge.textContent = label;
    badge.dataset.at = String(it.airingAt);
    badge.title = new Date(it.airingAt * 1000).toLocaleString();
    var st = document.createElement("span");
    st.className = "st";
    st.textContent = it.title;
    var ep = document.createElement("span");
    ep.className = "ep";
    ep.textContent = "EP " + it.ep;
    el.appendChild(badge);
    el.appendChild(st);
    el.appendChild(ep);
    el.addEventListener("click", function () {
      openItem(it.id);
    });
    return el;
  }

  function render() {
    if (!strip) return;
    stopMarquee();
    if (!items.length) {
      strip.style.display = "none";
      return;
    }
    strip.innerHTML = "";

    var head = document.createElement("div");
    head.className = "sports-head air-head";
    head.innerHTML =
      '<span class="live-dot"></span><b>Airing soon</b><span class="air-all">all →</span>';
    head.title = "See the full airing schedule";
    head.addEventListener("click", openModal);
    strip.appendChild(head);

    viewport = document.createElement("div");
    viewport.className = "air-viewport";
    track = document.createElement("div");
    track.className = "air-track";
    stripItems = items.slice(0, MAX_ITEMS);
    stripItems.forEach(function (it) {
      track.appendChild(buildItem(it));
    });
    viewport.appendChild(track);
    strip.appendChild(viewport);
    strip.style.display = "flex";

    // Hovering + mouse wheel scrolls the strip horizontally (vertical wheel
    // deltas count too — most mice have no horizontal wheel). Scrollbar is
    // hidden in CSS; touch devices swipe natively.
    viewport.addEventListener(
      "wheel",
      function (e) {
        var d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!d || track.scrollWidth <= viewport.clientWidth) return;
        e.preventDefault(); // keep the page from scrolling vertically
        viewport.scrollLeft += d;
      },
      { passive: false },
    );

    startMarquee();
  }

  /* ── Marquee (auto side-scroll, pause on interaction) ─────────── */
  function stopMarquee() {
    if (marquee.raf) cancelAnimationFrame(marquee.raf);
    clearTimeout(marquee.resumeTimer);
    marquee.raf = 0;
  }

  function startMarquee() {
    if (reducedMotion || !viewport || !track) return;
    // Only loop when the row actually overflows
    if (track.scrollWidth <= viewport.clientWidth + 4) return;

    // Duplicate the items once for a seamless wrap-around
    Array.prototype.slice.call(track.children).forEach(function (n, i) {
      var c = n.cloneNode(true); // cloneNode drops listeners — re-attach
      c.addEventListener("click", function () {
        openItem(stripItems[i].id);
      });
      track.appendChild(c);
    });
    viewport.classList.add("scrolling");

    var pause = function () {
      marquee.paused = true;
      clearTimeout(marquee.resumeTimer);
    };
    var resumeSoon = function () {
      clearTimeout(marquee.resumeTimer);
      marquee.resumeTimer = setTimeout(function () {
        marquee.paused = false;
        marquee.last = 0;
      }, 2500);
    };
    viewport.addEventListener("pointerenter", pause);
    viewport.addEventListener("pointerleave", resumeSoon);
    viewport.addEventListener("touchstart", pause, { passive: true });
    viewport.addEventListener("touchend", resumeSoon);
    viewport.addEventListener("wheel", pause, { passive: true });

    // Exact loop length = where the first clone starts (gap-safe, unlike scrollWidth/2)
    var half =
      track.children[stripItems.length].offsetLeft -
      track.children[0].offsetLeft;
    if (half <= 0) half = track.scrollWidth / 2;

    // Manual scrolling (wheel/swipe) wraps around too, not just the ticker
    viewport.addEventListener("scroll", function () {
      if (viewport.scrollLeft >= half) viewport.scrollLeft -= half;
    });
    var step = function (ts) {
      if (!marquee.paused && strip.style.display !== "none") {
        if (marquee.last) {
          viewport.scrollLeft += (SPEED * (ts - marquee.last)) / 1000;
          if (viewport.scrollLeft >= half) viewport.scrollLeft -= half;
        }
        marquee.last = ts;
      } else {
        marquee.last = 0;
      }
      marquee.raf = requestAnimationFrame(step);
    };
    marquee.raf = requestAnimationFrame(step);
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  function load(force) {
    var cache = readCache();
    var nextUp = cache && cache.items.filter(function (it) {
      return it.airingAt * 1000 > Date.now() - LOOKBACK * 1000;
    });
    if (!force && cache && Date.now() - cache.t < CACHE_TTL && nextUp.length) {
      items = nextUp;
      render();
      return;
    }
    fetchSchedule()
      .then(function (list) {
        items = list;
        render();
      })
      .catch(function () {
        // network/rate-limit hiccup: fall back to stale cache if usable
        if (nextUp && nextUp.length) {
          items = nextUp;
          render();
        } else if (strip) {
          strip.style.display = "none";
        }
      });
  }

  function init() {
    strip = document.getElementById("airingStrip");
    if (!strip) return;
    load(false);
    setInterval(refreshBadges, 60 * 1000);
    setInterval(function () {
      load(true);
    }, CACHE_TTL);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
