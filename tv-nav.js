/**
 * tv-nav.js — Virowatch TV mode (remote-first spatial navigation)
 *
 * The regular (mobile/PC) UI is the default; TV mode is a pure overlay
 * that only flips <body> into .vw-tv mode (vitv.css) when real remote
 * input shows up: a TV user-agent, an arrow keypress before any pointer
 * input, or a connected gamepad. Auto-detection is session-only — the
 * old UI is back on the next load; only a manual "vw_tv" value sticks.
 *  - arrows move a highlight between cards/buttons (nearest neighbour)
 *  - Enter/OK activates the focused element, Back/Return goes up a level
 *  - the player modal keeps its own Left/Right seek + Up/Down volume
 *    (custom-player-ui.js) and only gives Up/Down to the episode sidebar
 *
 * Pure overlay: it only adds/removes a .vw-focus class, never touches the
 * DOM the app builds. State key "vw_tv": "1" force on, "0" force off,
 * absent = auto-detect (never written back by auto-detection).
 *
 * Stuck-remote safety: a key held down for ~4s with no keyup (stuck
 * button, dead remote) is treated as a lost user and resets to home.
 *
 * Also hosts the TV on-screen keyboard (#vwOsk): inputs (search, settings)
 * can't be typed on a remote, so Enter on an input opens a navigable
 * QWERTY modal instead of focusing it (vitv.css styles it).
 */
(function () {
  "use strict";

  var KEY = "vw_tv";

  /* ── Detection ─────────────────────────────────────────────────── */
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  var ua = navigator.userAgent;
  var uaSaysTv = /AndroidTV|CrKey|Web0S|Tizen|SMART-TV|GoogleTV|AppleTV|Aftb|Roku/i.test(ua);
  // Auto-detection never flips TV mode on silently: a "might be a TV"
  // signal opens the first-run popup, and the answer is persisted here.
  // Saved "1"/"0" = the stored answer; absent = nobody has chosen yet.
  var tv = saved === "1";
  var askSeen = false; // session flag: don't re-ask after an answer/dismiss
  var pointerSeen = false;

  function apply() {
    document.body.classList.toggle("vw-tv", tv);
  }

  /* ── Focusables per scope ──────────────────────────────────────── */
  // Modal scope: any vws overlay (settings/comments/social/...) or the
  // anime source popup. Player scope: episode modal — video control bar
  // buttons + sidebar. Browse scope: everything else on the page.
  var MODAL_SEL =
    "button, a[href], select, input:not([type=hidden]):not([type=file]), .vw-src-row";
  var PMENU_SEL = ".vw-player-menu-row, .vw-player-menu-option, .vw-player-back-btn";
  var PLAYER_SEL = [
    "#backToCategory", "#popOutBtn", ".dubbed-toggle",
    ".player-controls .button", "#downloadContainer .button",
    "#seasonSelector", "#epRangeSelector",
    "#episodeListContainer .episode",
    ".vw-player-icon-btn", ".vw-player-tvbtn",
    ".vw-player-seek", ".vw-player-volume",
  ].join(",");
  var BROWSE_SEL = [
    ".rail-item", "#searchInput",
    "#heroWatchBtn", "#heroWlBtn", "#newestSeeAll",
    "#newestAddedList .poster",
    ".cat-nav-btn", ".search-filter-bar button", ".search-load-more",
    ".wl-sort-toggle", ".wl-status-pill",
    "#movieList .movie-item", "#anikoto-grid .ani-card", ".vidnest-card",
    ".cw-item", ".sport", ".sports-head",
  ].join(",");

  function scope() {
    var ov = document.querySelector(".vws-overlay.vws-open");
    if (ov) return { kind: "modal", root: ov };
    var src = document.querySelector(".vw-src-open");
    if (src) return { kind: "modal", root: src };
    // ⋮ overflow menu of the custom player (quality / subtitles / seek
    // amount / downloads) — its rows are divs, not buttons, so it gets its
    // own scope selector.
    var mp = document.querySelector(".vw-player-menu-panel.open");
    if (mp) return { kind: "pmenu", root: mp };
    var ep = document.getElementById("episodeContainer");
    // Note: offsetParent is null for this element (position: fixed) — gate
    // on inline display + a real rect instead.
    if (ep && ep.style.display !== "none" && ep.getBoundingClientRect().width > 0)
      return { kind: "player", root: ep };
    return { kind: "browse", root: document };
  }

  // TV player, iframe-only case: there is no custom control bar to hold the
  // Back/Title/Dubbed buttons (the top header is hidden in TV mode), so fold
  // them into the static .player-controls pill. Native players (custom UI
  // present) instead hide that pill and use the TV buttons built into the
  // custom bar — see window.vwTvInvoke below.
  function tvPlayerMerge() {
    var ep = document.getElementById("episodeContainer");
    if (!ep || ep.style.display === "none") return;
    var header = ep.querySelector(".modal-header");
    var bar = ep.querySelector(".player-controls");
    if (!header || !bar) return;
    var back = header.querySelector("#backToCategory");
    var title = header.querySelector("#nowPlayingTitle");
    var dub = header.querySelector(".dubbed-toggle");
    var next = ep.querySelector("#nextEpisode");
    if (back) bar.insertBefore(back, bar.firstChild);
    if (title) bar.insertBefore(title, back ? back.nextSibling : bar.firstChild);
    if (dub) bar.insertBefore(dub, next);
  }

  // Remote-friendly duplicates for the custom player bar (custom-player-ui.js
  // renders the buttons; this is the action side). Clicking the page's own
  // elements keeps every existing handler working untouched.
  //
  // The site's loaders churn the player state async (vidnest/megaplay
  // failover), which can swallow a click landing mid-switch — so actions
  // retry once if the expected effect didn't happen.
  function clickRetry(b, check) {
    b.click();
    if (!check()) setTimeout(function () { if (!check()) b.click(); }, 250);
  }
  window.vwTvInvoke = function (action) {
    var b = null;
    if (action === "back") {
      b = document.getElementById("backToCategory");
      if (b) clickRetry(b, function () {
        var ep = document.getElementById("episodeContainer");
        return !ep || ep.style.display === "none";
      });
      return;
    }
    if (action === "prev" || action === "next") {
      b = document.getElementById(action === "prev" ? "prevEpisode" : "nextEpisode");
      if (b) {
        var before = document.querySelector(".episode.active")?.dataset.episodeIndex;
        clickRetry(b, function () {
          var now = document.querySelector(".episode.active")?.dataset.episodeIndex;
          return now !== before;
        });
      }
      return;
    }
    if (action === "source") {
      b = document.querySelector("#vwSrcBtn");
      if (!b) return;
      var wasOpen = !!document.querySelector(".vw-src-open");
      b.click();
      if (!wasOpen) {
        // The anchor sits in the hidden .player-controls pill — its rect is
        // empty, so openPop parked the popup at a random corner. Center it.
        var pop = document.getElementById("vwSrcPop");
        if (pop) {
          pop.style.left = "50%";
          pop.style.top = "50%";
          pop.style.bottom = "";
          pop.style.transform = "translate(-50%, -50%)";
        }
      }
      return;
    }
    if (action === "dubbed") {
      // Click the page's own Dubbed toggle — content.js owns the state and
      // falls back to the normal track when a title has no dubbed release.
      // (An early guard here blocked titles whose data lacks a .dubbed
      // array entirely, which made the button silently dead.)
      b = document.querySelector(".dubbed-toggle");
      if (b) {
        // The toggle FLIPS state each click — a retry check that only
        // expects "active" would re-click an OFF toggle back ON, so the
        // button could never be toggled back off. Check the flip instead.
        var wasActive = b.classList.contains("active");
        clickRetry(b, function () { return b.classList.contains("active") !== wasActive; });
        // mirror the active state onto the TV bar button
        var tb = document.querySelector('.vw-player-tvbtn[data-tv="dubbed"]');
        if (tb) setTimeout(function () { tb.classList.toggle("active", b.classList.contains("active")); }, 400);
      }
      return;
    }
    if (action === "episodes") {
      var ep = document.getElementById("episodeContainer");
      if (!ep) return;
      var open = document.body.classList.contains("vw-sidebar-open");
      if (open) {
        document.body.classList.remove("vw-sidebar-open");
      } else {
        document.body.classList.add("vw-sidebar-open");
        var act = ep.querySelector("#episodeListContainer .episode.active");
        if (act) setFocus(act);
        else {
          var items = focusables(scope());
          if (items.length) setFocus(items[0]);
        }
      }
    }
  };

  function visible(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(list[i]);
    }
    return out;
  }

  function focusables(sc) {
    var sel =
      sc.kind === "modal" ? MODAL_SEL :
      sc.kind === "pmenu" ? PMENU_SEL :
      sc.kind === "player" ? PLAYER_SEL : BROWSE_SEL;
    var out;
    if (sc.kind === "modal" || sc.kind === "pmenu") {
      out = visible(sc.root.querySelectorAll(sel));
    } else if (sc.kind === "player") {
      // Several custom-player roots can coexist (megaplay backup + vidnest
      // failover chains). Take the most recently attached one that still
      // has visible controls — the active player; hidden/stale roots are
      // skipped entirely.
      out = [];
      var roots = document.querySelectorAll(".vw-player-root");
      for (var ri = roots.length - 1; ri >= 0 && !out.length; ri--) {
        out = visible(roots[ri].querySelectorAll(sel));
      }
    } else {
      out = visible(document.querySelectorAll(sel));
    }
    // Player scope: the episode panel slides away when not focused — its
    // items are still in the DOM (transformed off-screen) and must not be
    // navigable targets while the panel is closed.
    if (sc.kind === "player" && !document.body.classList.contains("vw-sidebar-open")) {
      out = out.filter(function (el) { return !el.closest(".sidebar"); });
    }
    return out;
  }

  /* ── Focus movement ────────────────────────────────────────────── */
  var cur = null;
  var navScope = null; // scope kind the highlight was last anchored in

  function clearFocus() {
    if (cur) cur.classList.remove("vw-focus");
    cur = null;
  }

  function setFocus(el) {
    clearFocus();
    cur = el;
    el.classList.add("vw-focus");
    // Leaving the timeline ends scrub mode (the glowing state + hint);
    // same for the volume slider's selected state.
    if (el !== document.querySelector(".vw-player-seek")) setScrub(false);
    if (el !== document.querySelector(".vw-player-volume")) setVolSelected(false);
    // Real focus follows the highlight — except it must not linger on an
    // input the highlight moved away from (its native arrow handling would
    // then fight spatial navigation).
    if (document.activeElement && document.activeElement !== el && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    // Highlight on the rail = expand it, as if a mouse were hovering it
    // (vitv.css animates the same width/label transitions). Highlight on
    // an episode-panel item = keep the panel popped out.
    document.body.classList.toggle("vw-rail-focus", !!el.closest(".rail"));
    document.body.classList.toggle("vw-sidebar-open", !!el.closest(".sidebar"));
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_) { el.scrollIntoView(); }
    // Hover info cards follow focus the same way they follow a real
    // mouseover — same contract, zero changes to hover-info.js.
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
    // Moving the highlight inside the player wakes the auto-hidden control
    // bar (gamepad moves and scope re-anchors have no keydown to wake it).
    if (el.closest && el.closest("#episodeContainer") && window.vwPlayerWake)
      window.vwPlayerWake();
  }

  function initialFocus(sc) {
    if (sc.kind === "player") {
      // Native players get their TV buttons inside the custom bar (and the
      // static pill is hidden); iframe-only players keep the pill and get
      // the header's Back/Title/Dubbed folded into it.
      var ep = document.getElementById("episodeContainer");
      var hasCustom = !!ep.querySelector(".vw-player-root");
      document.body.classList.toggle("vw-tv-custom", hasCustom);
      if (!hasCustom) tvPlayerMerge();
      // Square episode grids (30+ episodes / IPTV channel lists) are the
      // content — land on the current entry immediately instead of the
      // play button, so the list is instantly selectable.
      var grid = ep.querySelector("#episodeListContainer.ep-block-grid");
      if (grid) {
        var act = ep.querySelector("#episodeListContainer .episode.active");
        if (act) { setFocus(act); return; }
      }
    }
    var items = focusables(sc);
    if (!items.length) return;
    var pick = null;
    if (sc.kind === "browse") {
      pick =
        items.filter(function (el) { return el.classList.contains("movie-item"); })[0] ||
        items.filter(function (el) { return el.id === "heroWatchBtn"; })[0];
    } else if (sc.kind === "player") {
      // Default to the play button (neutral — Enter won't close the player
      // or change episodes by accident). Iframe-only players have no icon
      // buttons, so they fall back to items[0] (Back in the pill).
      pick = items.filter(function (el) {
        return el.classList.contains("vw-player-icon-btn");
      })[0];
    }
    setFocus(pick || items[0]);
  }

  // Episode-panel navigation is INDEX-based, not spatial: lists can have
  // 10k+ entries (IPTV), and scanning every rect per keypress is unusably
  // slow — plus spatial re-anchoring could eject the panel. Left/Right step
  // one entry, Up/Down move by row (same column). Falls back to spatial
  // move at the list edges so the bar stays reachable.
  function episodeMove(dir) {
    var container = document.getElementById("episodeListContainer");
    var eps = container ? container.querySelectorAll(".episode") : [];
    if (!cur || !cur.classList.contains("episode") || !eps.length) return;
    var pos = -1;
    for (var i = 0; i < eps.length; i++) {
      if (eps[i] === cur) { pos = i; break; }
    }
    if (pos === -1) return;
    var target = null;
    if (dir === "left" || dir === "right") {
      target = eps[dir === "left" ? pos - 1 : pos + 1] || null;
    } else {
      var curTop = cur.offsetTop, curLeft = cur.offsetLeft;
      var best = null, bestScore = Infinity;
      for (var j = 0; j < eps.length; j++) {
        var dy = eps[j].offsetTop - curTop;
        if (dir === "up" && dy >= 0) continue;
        if (dir === "down" && dy <= 0) continue;
        var dx = Math.abs(eps[j].offsetLeft - curLeft);
        var score = Math.abs(dy) + dx * 4;
        if (score < bestScore) { bestScore = score; best = eps[j]; }
      }
      target = best;
    }
    if (target) setFocus(target);
    else move(dir);
  }

  // Nearest neighbour with a perpendicular penalty, so horizontal moves
  // stay in the row and vertical moves stay in the column.
  //
  // Horizontal moves first require roughly same-row candidates (|dy| small):
  // the full-width timeline bar's center sits right of every control, so
  // without this it intercepts every sideways move. Falls back to any-row
  // when the row ends, so grids still wrap to the next row.
  function move(dir) {
    var sc = scope();
    // Scope switched (player opened, modal opened, etc.) — the old
    // highlight sits on a page the user can no longer see. Re-anchor it
    // to the new scope before moving.
    if (sc.kind !== navScope) {
      navScope = sc.kind;
      initialFocus(sc);
      return;
    }
    var items = focusables(sc);
    if (!items.length) return;
    if (!cur || !cur.isConnected || items.indexOf(cur) === -1) {
      initialFocus(sc);
      return;
    }
    var r = cur.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var horiz = dir === "left" || dir === "right";
    var best = null, bestScore = Infinity;
    for (var pass = 0; pass < 2 && !best; pass++) {
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el === cur) continue;
        var er = el.getBoundingClientRect();
        var ex = er.left + er.width / 2, ey = er.top + er.height / 2;
        var dx = ex - cx, dy = ey - cy;
        if (dir === "left" && dx > -4) continue;
        if (dir === "right" && dx < 4) continue;
        if (dir === "up" && dy > -4) continue;
        if (dir === "down" && dy < 4) continue;
        // pass 0: same-row only for sideways moves
        if (horiz && pass === 0 && Math.abs(dy) > 24) continue;
        var score = horiz ? Math.abs(dx) + Math.abs(dy) * 4
                          : Math.abs(dy) + Math.abs(dx) * 4;
        if (score < bestScore) { bestScore = score; best = el; }
      }
    }
    if (best) { setFocus(best); return; }
    // Nothing in that direction: stepping down out of the open episode
    // panel closes it (opening it again is the Episodes button's job).
    if (sc.kind === "player" && dir === "down" &&
        document.body.classList.contains("vw-sidebar-open")) {
      document.body.classList.remove("vw-sidebar-open");
    }
  }

  function activate() {
    var sc = scope();
    // Re-anchoring is for when the highlight is stranded on a hidden page.
    // An episode in the open panel is never stranded — clicking it must
    // never be swallowed by a stale-scope re-anchor.
    if (sc.kind !== navScope &&
        !(sc.kind === "player" && cur && cur.classList.contains("episode"))) {
      navScope = sc.kind;
      initialFocus(sc);
      return;
    }
    // Mouse hovering the timeline: Enter drops the highlight onto it
    // (first OK focuses it, second OK toggles play/pause).
    if (hoverSeek && (!cur || cur !== hoverSeek)) {
      setFocus(hoverSeek);
      return;
    }
    if (cur) {
      if (cur.tagName === "INPUT") {
        var root = activeRoot();
        var video = root && root.querySelector("video");
        if (cur.type === "range") {
          if (cur.classList.contains("vw-player-seek")) {
            if (document.activeElement === cur) {
              // OK again while scrubbing: jump (marker already moved live)
              // and resume playback.
              setScrub(false);
              if (video) video.play().catch(function () {});
              cur.blur();
              return;
            }
            // First OK on the timeline = enter scrub mode: pause the
            // media and light up the bar so it's obvious what's engaged.
            setScrub(true);
            if (video) video.pause();
            cur.focus();
            return;
          }
          // volume slider: select = focus + visible glow; arrows adjust;
          // OK again exits the selected state
          if (cur.classList.contains("vw-player-volume")) {
            if (document.activeElement === cur) {
              setVolSelected(false);
              cur.blur();
              return;
            }
            setVolSelected(true);
            cur.focus();
            return;
          }
          cur.focus();
          return;
        }
        openOsk(cur);
        return;
      }
      if (cur.tagName === "SELECT") { cur.focus(); return; }
      var wasEpisode = sc.kind === "player" && cur.classList.contains("episode");
      cur.click();
      if (wasEpisode) {
        // Picked an episode — back to the main player UI, panel closed.
        document.body.classList.remove("vw-sidebar-open");
        var items = focusables(scope());
        if (items.length) setFocus(items[0]);
      }
      return;
    }
    // Nothing focused in the player — Enter acts as play/pause
    var pb = document.querySelector(".vw-player-icon-btn");
    if (pb) pb.click();
  }

  function back() {
    var sc = scope();
    if (sc.kind === "pmenu") {
      // Submenu (quality/subtitles/seek amount) → its ← row; otherwise
      // close the ⋮ menu by pressing the button that opened it.
      var subBack = sc.root.querySelector(".vw-player-back-btn");
      if (subBack) { subBack.click(); return; }
      var more = document.querySelector('.vw-player-icon-btn[title="More options"]');
      if (more) more.click();
      return;
    }
    if (sc.kind === "player") {
      setScrub(false);
      setVolSelected(false);
      document.body.classList.remove("vw-sidebar-open");
      var b = document.getElementById("backToCategory");
      if (b) { b.click(); return; }
    }
    // Every overlay (vws settings, comments, social, history, watchparty…)
    // already closes on Escape — reuse that instead of per-modal close calls.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  /* ── Stuck-remote safety ───────────────────────────────────────── */
  // A held key/button with no release (stuck remote button, jammed
  // keyboard) is indistinguishable from a user stuck somewhere — bail
  // out to home. Keyboard arm/disarm below; gamepad holds are tracked
  // in pollGamepads.
  var holdKey = null, holdAt = 0, holdLocked = false;

  function resetToHome() {
    if (holdLocked) return; // still held — wait for the release
    holdLocked = true;
    clearFocus();
    setScrub(false);
    setVolSelected(false);
    document.body.classList.remove("vw-sidebar-open", "vw-rail-focus");
    // Close any open overlay (settings/comments/OSK/…) like back() does.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Reuse the app's own Home handler (closes player, clears search,
    // stops audio, resets view state).
    var home = document.getElementById("railHomeBtn");
    if (home) home.click();
    else if (window.viroHome) window.viroHome();
    try {
      if (document.activeElement && document.activeElement !== document.body)
        document.activeElement.blur();
    } catch (_) {}
  }

  // The active player is the most recently attached visible root — same
  // rule focusables() uses.
  function activeRoot() {
    var roots = document.querySelectorAll(".vw-player-root");
    for (var i = roots.length - 1; i >= 0; i--) {
      var r = roots[i].getBoundingClientRect();
      if (r.width > 0) return roots[i];
    }
    return roots[roots.length - 1] || null;
  }

  // Seek the focused timeline by a given number of seconds (custom-player-ui's
  // "Seek amount" setting for the small steps; big jumps are 10% of the
  // video). Never bails silently: when the video has no playable duration
  // yet (embed still loading / errored), the marker still moves a fixed
  // visible amount so the scrub always answers the remote.
  function applySeek(deltaSec) {
    var seekEl = cur && cur.classList.contains("vw-player-seek")
      ? cur
      : (document.querySelector(".vw-player-seek.vw-scrubbing") ||
         document.querySelector(".vw-player-seek"));
    var root = seekEl && seekEl.closest(".vw-player-root");
    var video = root && root.querySelector("video");
    if (!seekEl || !video) return;
    var d = video.duration;
    var pct;
    if (isFinite(d) && d > 0) {
      pct = (deltaSec / d) * 100;
    } else {
      pct = Math.sign(deltaSec) * 1; // 1% per step — the ball visibly drags
    }
    seekEl.value = Math.min(100, Math.max(0, Number(seekEl.value) + pct));
    seekEl.style.setProperty("--pct", seekEl.value + "%");
    seekEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function seekByStep(dir) {
    var step = Number(localStorage.getItem("vw_player_seek_step")) || 10;
    applySeek(dir * step);
  }

  // Big position jump on the focused timeline (±10% of the video) — the
  // "get to a specific spot" gesture (LB/RB on gamepad, PgUp/PgDn on keys).
  function seekByPct(dir) {
    var root = activeRoot();
    var video = root && root.querySelector("video");
    var d = video && video.duration;
    if (isFinite(d) && d > 0) applySeek(dir * 0.1 * d);
    else applySeek(dir * 10); // no duration yet — same visible 10% jump
  }

  // Same pattern for the volume slider (±0.05 per step, like the keyboard
  // shortcuts in custom-player-ui.js).
  function volumeByStep(dir) {
    var root = activeRoot();
    var v = root && root.querySelector(".vw-player-volume");
    if (!v) return;
    v.value = Math.min(1, Math.max(0, Number(v.value) + dir * 0.05));
    v.style.setProperty("--volpct", v.value * 100 + "%");
    v.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* ── Shared nav entry (keyboard + gamepad) ─────────────────────── */
  function navKey(k) {
    var sc = scope();
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      var dir = k === "ArrowUp" ? "up" : k === "ArrowDown" ? "down" : k === "ArrowLeft" ? "left" : "right";
      // Player scope: arrows steer the control bar itself. Sideways on the
      // focused timeline scrubs it; the episode panel navigates by index.
      if (sc.kind === "player") {
        if (cur && cur.classList.contains("episode")) {
          episodeMove(dir);
          return;
        }
        if ((cur && cur.classList.contains("vw-player-seek") || hoverSeek) &&
            (dir === "left" || dir === "right")) {
          // Sideways on the (focused or mouse-hovered) timeline scrubs it
          seekByStep(dir === "left" ? -1 : 1);
        } else if (cur && cur.classList.contains("vw-player-volume")) {
          // Up/Down always adjust; Left/Right too once the slider is
          // selected (OK'd) — while merely highlighted they walk the bar.
          if (dir === "up" || dir === "down" ||
              ((dir === "left" || dir === "right") &&
               document.body.classList.contains("vw-vol-selected"))) {
            volumeByStep(dir === "up" || dir === "right" ? 1 : -1);
          } else {
            move(dir);
          }
        } else {
          move(dir);
        }
        return;
      }
      move(dir);
      return;
    }
    if (k === "PageUp" || k === "PageDown") {
      // Same ±10% timeline jump / list paging as gamepad LB/RB
      pageBy(k === "PageUp" ? "up" : "down");
      return;
    }
    if (k === "Enter") { activate(); return; }
    if (k === "Backspace" || k === "Escape") { back(); return; }
  }

  function enableTv() {
    if (tv) return;
    tv = true;
    apply();
    // Session-only on purpose: TV browsers/gamepads re-detect on every
    // load (UA / gamepad poll / first arrow), so persisting here would
    // leave a PC permanently TV-styled after one stray arrow press.
    // The first-run popup answer (vwTvSet) is what persists.
  }

  /* ── First-run "are you on a TV?" popup ────────────────────────── */
  // TV mode is a guess until the user confirms it: any "might be a TV"
  // signal (TV user-agent, first arrow keypress, connected gamepad)
  // opens this popup once per session, and the answer persists. The
  // popup itself is navigable with arrows/OK (remote) and clicks.
  var tvAsk = null;
  var askCur = null;
  var tvAskOpen = false;

  function tvAskBuild() {
    tvAsk = document.createElement("div");
    tvAsk.id = "vwTvAsk";
    tvAsk.className = "vws-overlay";
    tvAsk.setAttribute("aria-hidden", "true");
    var panel = document.createElement("div");
    panel.className = "vws-modal";
    var header = document.createElement("div");
    header.className = "vws-header";
    var t = document.createElement("span");
    t.className = "vws-title";
    t.textContent = "Are you on a TV?";
    var x = document.createElement("button");
    x.type = "button";
    x.className = "vws-close";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.addEventListener("click", closeAsk);
    header.appendChild(t);
    header.appendChild(x);
    var body = document.createElement("div");
    body.className = "vws-body vw-tv-ask-body";
    var p = document.createElement("p");
    p.className = "vw-tv-ask-text";
    p.textContent =
      "This device looks like it might be a TV or console. Pick a mode — you can change it anytime in Settings.";
    var btns = document.createElement("div");
    btns.className = "vw-tv-ask-btns";
    [["0", "PC / Mobile"], ["1", "TV / Console"]].forEach(function (pair) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = pair[0] === "1" ? "btn-primary" : "btn-ghost";
      b.dataset.tvAnswer = pair[0];
      b.textContent = pair[1];
      b.addEventListener("click", function () {
        window.vwTvSet(b.dataset.tvAnswer === "1");
      });
      btns.appendChild(b);
    });
    var hint = document.createElement("div");
    hint.className = "vw-tv-ask-hint";
    hint.textContent =
      "TV / Console: arrows move the highlight, OK selects. Hold any button for ~4 seconds to reset back to the home page if you get stuck.";
    body.appendChild(p);
    body.appendChild(btns);
    body.appendChild(hint);
    panel.appendChild(header);
    panel.appendChild(body);
    tvAsk.appendChild(panel);
    document.body.appendChild(tvAsk);
  }

  function askFocus(btn) {
    if (askCur) askCur.classList.remove("vw-focus");
    askCur = btn;
    if (btn) btn.classList.add("vw-focus");
  }

  function closeAsk() {
    if (!tvAsk) return;
    tvAsk.classList.remove("vws-open");
    tvAsk.setAttribute("aria-hidden", "true");
    tvAskOpen = false;
    askFocus(null);
  }

  // Persisted mode switch — the popup answer and the Settings toggle
  // both land here, so TV mode never gets out of sync with vw_tv.
  window.vwTvSet = function (on) {
    tv = on;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (_) {}
    apply();
    if (!on) clearFocus();
    askSeen = true;
    closeAsk();
  };

  // "Might be a TV" signal → ask instead of silently flipping the UI.
  function askTv() {
    if (tv || askSeen || saved === "0") return;
    if (!tvAsk) tvAskBuild();
    tvAskOpen = true;
    tvAsk.classList.add("vws-open");
    tvAsk.setAttribute("aria-hidden", "false");
    var btns = tvAsk.querySelectorAll("[data-tv-answer]");
    askFocus(btns[btns.length - 1]); // TV/Console — the case that got us here
    askSeen = true; // one ask per session; the answer persists via vwTvSet
  }

  /* ── On-screen keyboard (#vwOsk — navigable like any other modal) ── */
  var osk = null;
  var oskTarget = null;

  function oskKey(label, action) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "vw-osk-key";
    b.textContent = label;
    b.dataset.k = action || label;
    b.addEventListener("click", function () { oskType(b.dataset.k); });
    return b;
  }

  function oskVal(v) {
    var p = osk.querySelector(".vw-osk-preview");
    if (v === undefined) return p.textContent;
    p.textContent = v;
  }

  function oskType(k) {
    if (!oskTarget) return;
    if (k === "back") { oskVal(oskVal().slice(0, -1)); return; }
    if (k === "enter") { oskDone(); return; }
    oskVal(oskVal() + k);
  }

  function oskDone() {
    var v = oskVal();
    oskTarget.value = v;
    oskTarget.dispatchEvent(new Event("input", { bubbles: true }));
    oskClose();
  }

  function oskClose() {
    if (!osk) return;
    osk.classList.remove("vws-open");
    osk.setAttribute("aria-hidden", "true");
    oskTarget = null;
  }

  function oskBuild() {
    osk = document.createElement("div");
    osk.id = "vwOsk";
    osk.className = "vws-overlay";
    osk.setAttribute("aria-hidden", "true");
    var panel = document.createElement("div");
    panel.className = "vw-osk-panel";
    var preview = document.createElement("div");
    preview.className = "vw-osk-preview";
    panel.appendChild(preview);
    var grid = document.createElement("div");
    grid.className = "vw-osk-grid";
    // Numbers + punctuation on top (first row), then QWERTY below
    var extra = "1234567890.,?!'-&@/()";
    var numRow = document.createElement("div");
    numRow.className = "vw-osk-row";
    extra.split("").forEach(function (ch) { numRow.appendChild(oskKey(ch)); });
    grid.appendChild(numRow);
    [["QWERTYUIOP", null], ["ASDFGHJKL", "back"], ["ZXCVBNM", "space"]].forEach(function (rowDef) {
      var row = document.createElement("div");
      row.className = "vw-osk-row";
      rowDef[0].split("").forEach(function (ch) { row.appendChild(oskKey(ch)); });
      if (rowDef[1] === "back") row.appendChild(oskKey("⌫", "back"));
      if (rowDef[1] === "space") {
        row.appendChild(oskKey("Space", " "));
        row.appendChild(oskKey("Search ↵", "enter"));
      }
      grid.appendChild(row);
    });
    panel.appendChild(grid);
    var hints = document.createElement("div");
    hints.className = "vw-osk-hints";
    hints.textContent = "A select · X erase · Y space · B close · Menu enter";
    panel.appendChild(hints);
    osk.appendChild(panel);
    document.body.appendChild(osk);
  }

  function openOsk(target) {
    if (!osk) oskBuild();
    oskTarget = target;
    oskVal(target.value || "");
    osk.classList.add("vws-open");
    osk.setAttribute("aria-hidden", "false");
  }

  // Escape closes the keyboard like every other overlay
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && osk && osk.classList.contains("vws-open")) oskClose();
  });

  // Native players attach their custom control bar asynchronously (after
  // the stream loads) — track it so CSS can swap the static pill for the
  // custom-bar buttons whenever the player is open.
  var customObs = new MutationObserver(function () {
    if (!tv) return;
    var ep = document.getElementById("episodeContainer");
    document.body.classList.toggle(
      "vw-tv-custom",
      !!(ep && ep.querySelector(".vw-player-root")),
    );
    updatePlayerError();
    // Square episode grids arrive async (IPTV playlist, anikoto series) —
    // when one shows up while the player is open, select it immediately.
    if (ep && ep.style.display !== "none") {
      var grid = ep.querySelector("#episodeListContainer.ep-block-grid");
      if (grid && scope().kind === "player" &&
          (!cur || !cur.classList.contains("episode"))) {
        initialFocus(scope());
      }
    }
  });
  customObs.observe(document.body, { subtree: true, childList: true });

  /* ── Player error state ────────────────────────────────────────── */
  // When the content failed (dead <video>, PitSport's "no events" panel),
  // the TV chrome shouldn't stay fully lit and pretend to work. It dims
  // (custom bar) or hides (pill) — remote Back still exits.
  function updatePlayerError(force) {
    if (!tv) return;
    var ep = document.getElementById("episodeContainer");
    var err;
    if (force !== undefined) {
      err = !!force;
    } else {
      err = false;
      if (ep && ep.style.display !== "none") {
        var fb = ep.querySelector("#pitsportFallback");
        if (fb && fb.style.display !== "none") err = true;
        var v = ep.querySelector(".vw-player-root video");
        if (v && v.error) err = true;
      }
    }
    document.body.classList.toggle("vw-tv-player-error", err);
    if (err) tvPlayerMerge(); // Back/Title/Dubbed into the pill = escape hatch
  }
  document.addEventListener("error", function (e) {
    if (e.target && e.target.tagName === "VIDEO") updatePlayerError(true);
  }, true);
  // Loader failures (anikoto/vidnest "not available" toasts) land here too
  window.addEventListener("vw-player-error", function () {
    updatePlayerError(true);
  });
  // any successful play start (new title / episode) clears the error state
  window.addEventListener("vw-nowplaying", function () {
    updatePlayerError(false);
  });
  document.addEventListener("playing", function (e) {
    if (e.target && e.target.tagName === "VIDEO") updatePlayerError(false);
  }, true);
  document.addEventListener("canplay", function (e) {
    if (e.target && e.target.tagName === "VIDEO") updatePlayerError(false);
  }, true);
  // a fresh episode selection clears the error state
  document.addEventListener("click", function () {
    if (tv) setTimeout(updatePlayerError, 50);
  }, true);

  /* ── Scrub mode feedback ────────────────────────────────────────── */
  // Engaged state is a visible thing: the timeline lights up and an
  // on-screen hint says what the arrows/OK do — pressing A/Enter must
  // visibly do something, or remote users assume it's broken.
  function setScrub(on) {
    var seek = document.querySelector(".vw-player-seek");
    if (seek) seek.classList.toggle("vw-scrubbing", on);
    document.body.classList.toggle("vw-scrubbing", on);
  }
  // Same idea for the volume slider: selecting it glows so the "now I'm
  // adjusting this" state is visible.
  function setVolSelected(on) {
    var v = document.querySelector(".vw-player-volume");
    if (v) v.classList.toggle("vw-vol-selected", on);
    document.body.classList.toggle("vw-vol-selected", on);
  }
  (function buildScrubHint() {
    var h = document.createElement("div");
    h.id = "vwScrubHint";
    h.textContent = "◄ ► scrub · OK jump · Back exit";
    document.body.appendChild(h);
  })();

  /* ── Wiring ────────────────────────────────────────────────────── */
  // hoverSeek: the timeline the real mouse is currently resting on. The
  // highlight may be elsewhere (desktop user hovering the bar), but a
  // Left/Right press over the timeline should still scrub it.
  var hoverSeek = null;
  document.addEventListener("pointerdown", function () { pointerSeen = true; }, true);
  document.addEventListener("mousemove", function (e) {
    pointerSeen = true;
    var t = e.target && e.target.closest ? e.target.closest(".vw-player-seek") : null;
    hoverSeek = t || null;
  }, true);
  document.addEventListener("mouseout", function (e) {
    if (!e.relatedTarget || !e.relatedTarget.closest ||
        !e.relatedTarget.closest(".vw-player-seek")) hoverSeek = null;
  }, true);

  // Navigation lands us in a new scope (Enter on a card opens the player,
  // a rail button opens Settings…) — move the highlight over proactively
  // so the first thing a remote user sees is the right scope, not the page
  // they left behind. Checked after the click so the target's own handler
  // (selectMovie etc.) has had time to show the new scope.
  document.addEventListener("click", function () {
    if (!tv) return;
    setTimeout(function () {
      var k = scope().kind;
      if (k !== navScope) {
        navScope = k;
        initialFocus(scope());
      }
    }, 30);
  }, true);

  document.addEventListener("keydown", function (e) {
    // back() re-dispatches Escape; never re-enter on synthetic events
    if (!e.isTrusted) return;
    var ae = document.activeElement;
    var typing = !!ae && (
      ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" ||
      (ae.tagName === "INPUT" && ae.type !== "range")
    );

    // First-run popup open: arrows/OK/Escape drive it directly — mode
    // isn't chosen yet, so there's no spatial nav to run.
    if (tvAskOpen) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown" ||
          e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        var ab = tvAsk.querySelectorAll("[data-tv-answer]");
        askFocus(ab[askCur === ab[0] ? 1 : 0]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (askCur) askCur.click();
      } else if (e.key === "Escape") {
        closeAsk();
      }
      return;
    }

    // "Might be a TV" signals ask first instead of enabling silently.
    // Arrows are the only key here: Enter fires on ordinary keyboard use
    // (numpad, form submits) and UA matching already covers TVs whose OK
    // button sends Enter. Session-only — a stray arrow on a PC flips to
    // TV mode just for this visit; the old UI is back on reload unless
    // the popup answer (vwTvSet) persisted otherwise.
    if (!tv && !typing && !pointerSeen &&
        (e.key === "ArrowUp" || e.key === "ArrowDown" ||
         e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      askTv();
    }
    if (!tv) return;
    if (typing) {
      // Escape gets a user out of a focused input (search box) — blurring
      // hands control back to spatial navigation.
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }

    // Stuck-remote safety: arm the hold timer on the first keydown of a
    // hold; key repeats keep the original timestamp so the 4s window
    // counts from the actual press.
    if (e.isTrusted && !holdLocked && e.key !== holdKey) {
      holdKey = e.key;
      holdAt = performance.now();
    }

    var k = e.key;
    if (k === " ") {
      // custom-player-ui.js skips keys while an input is really focused —
      // keep Space as play/pause anyway by clicking the play button.
      var ae2 = document.activeElement;
      if (ae2 && ae2.tagName === "INPUT" && ae2.type === "range") {
        var pb = document.querySelector(".vw-player-icon-btn");
        if (pb) { e.preventDefault(); pb.click(); }
      }
      return;
    }
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight" ||
        k === "Enter" || k === "Backspace" || k === "Escape" ||
        k === "PageUp" || k === "PageDown") {
      e.preventDefault();
      // In the player (and its ⋮ menus), custom-player-ui.js also listens
      // for arrows (seek/volume). Spatial navigation takes over there, so
      // stop it before it double-acts on the same key.
      var k2 = scope().kind;
      if (k2 === "player" || k2 === "pmenu") e.stopImmediatePropagation();
      navKey(k);
    }
  });

  document.addEventListener("keyup", function (e) {
    if (e.isTrusted && e.key === holdKey) { holdKey = null; holdLocked = false; }
  });

  /* ── Gamepad (Xbox controller for local testing, Android TV remotes
   * on real hardware — TV remotes expose themselves as gamepads) ─── */
  var GP_DIR = { ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15 };
  // Xbox standard: A = select, B = back, Start/Menu = Enter (Microsoft's
  // gamepad-keyboard convention), LB/RB = page up/down lists
  var GP_ACT = { Enter: [0, 9], Back: 1 };
  var GP_PAGE = { up: 4, down: 5 }; // LB / RB
  var GP_TYPE = { back: 2, " ": 3 }; // Xbox X erases, Y types a space
  var gpFire = { dir: null, page: null, at: 0 };
  var gpPrev = {}; // "pad:btn" -> was pressed last poll
  var gpHold = {}; // "pad:btn" -> last repeat-fire time (held keys)
  var gpHoldAt = {}; // "pad:btn" -> held since (stuck-remote reset)

  // Jump a fixed number of focusables (lists/grids are long — holding
  // arrows across 100 episodes isn't an input model anyone wants). On the
  // focused timeline this becomes a ±10% position jump instead.
  function pageBy(dir) {
    var sc = scope();
    if (sc.kind === "player" && cur && cur.classList.contains("vw-player-seek")) {
      seekByPct(dir === "down" || dir === "right" ? 1 : -1);
      return;
    }
    if (sc.kind !== navScope) {
      navScope = sc.kind;
      initialFocus(sc);
      return;
    }
    var items = focusables(sc);
    if (!items.length) return;
    var idx = cur ? items.indexOf(cur) : -1;
    if (idx === -1) { initialFocus(sc); return; }
    var n = 10;
    var next = dir === "down" ? Math.min(items.length - 1, idx + n) : Math.max(0, idx - n);
    if (next !== idx) setFocus(items[next]);
  }

  function pollGamepads() {
    var gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < gps.length; i++) {
      var gp = gps[i];
      if (!gp || !gp.connected) continue;
      if (!tv) askTv(); // a connected pad is a "might be a TV" signal
      var b = gp.buttons;
      var x = gp.axes && gp.axes.length ? gp.axes[0] : 0;
      var y = gp.axes && gp.axes.length ? gp.axes[1] : 0;
      var dir = null;
      if (b[12] && b[12].pressed) dir = "ArrowUp";
      else if (b[13] && b[13].pressed) dir = "ArrowDown";
      else if (b[14] && b[14].pressed) dir = "ArrowLeft";
      else if (b[15] && b[15].pressed) dir = "ArrowRight";
      else if (y < -0.4) dir = "ArrowUp";
      else if (y > 0.4) dir = "ArrowDown";
      else if (x < -0.4) dir = "ArrowLeft";
      else if (x > 0.4) dir = "ArrowRight";
      var now = performance.now();
      if (dir) {
        // fire on direction change, then hold-repeat like a TV remote
        if (dir !== gpFire.dir || now - gpFire.at > 150) {
          gpFire = { dir: dir, page: null, at: now };
          navKey(dir);
        }
      } else {
        gpFire.dir = null;
      }
      var page = null;
      if (b[5] && b[5].pressed) page = "down"; // RB
      else if (b[4] && b[4].pressed) page = "up"; // LB
      if (page) {
        if (page !== gpFire.page || now - gpFire.at > 150) {
          gpFire = { dir: null, page: page, at: now };
          pageBy(page);
        }
      } else {
        gpFire.page = null;
      }
      for (var act in GP_ACT) {
        var idxs = [].concat(GP_ACT[act]); // some buttons map to several indices
        for (var j = 0; j < idxs.length; j++) {
          var idx = idxs[j];
          var pressed = !!(b[idx] && b[idx].pressed);
          var key = i + ":" + idx;
          if (pressed && !gpPrev[key]) navKey(act); // edge-trigger only
          gpPrev[key] = pressed;
        }
      }
      // OSK typing keys: X = erase (hold to repeat), Y = space. No-op
      // when the keyboard isn't open (oskType guards on oskTarget).
      for (var act in GP_TYPE) {
        var idx = GP_TYPE[act];
        var held = !!(b[idx] && b[idx].pressed);
        var key = i + ":" + idx;
        if (held) {
          var now = performance.now();
          if (!gpPrev[key] || now - (gpHold[key] || 0) > 150) {
            gpHold[key] = now;
            oskType(act);
          }
        } else {
          gpHold[key] = 0;
        }
        gpPrev[key] = held;
      }
      // Stuck-remote safety (gamepad): any button held ~4s with no release
      // = stuck → home, same as the keyboard hold above. Re-arms when no
      // button on any pad is pressed anymore.
      var anyHeld = false;
      for (var j = 0; j < b.length; j++) {
        var hk = i + ":" + j;
        if (b[j] && b[j].pressed) {
          anyHeld = true;
          if (!gpHoldAt[hk]) gpHoldAt[hk] = performance.now();
        } else {
          delete gpHoldAt[hk];
        }
      }
      if (anyHeld) {
        for (var hk2 in gpHoldAt) {
          if (performance.now() - gpHoldAt[hk2] > 4000) { resetToHome(); break; }
        }
      } else {
        holdLocked = false;
      }
    }
  }

  (function gamepadLoop() {
    pollGamepads();
    // Stuck-remote safety: any key held ~4s with no keyup = stuck → home.
    // (The loop already runs every frame for gamepads — free scheduler.)
    if (tv && holdKey && performance.now() - holdAt > 4000) resetToHome();
    requestAnimationFrame(gamepadLoop);
  })();

  if (uaSaysTv && saved === null) setTimeout(askTv, 700);
  if (tv) apply();
})();
