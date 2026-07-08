/**
 * custom-player-ui.js — Virowatch custom video player chrome  v1.0
 *
 * Native-Chrome-style control bar (play/pause, seek+buffered, time, volume,
 * captions, fullscreen) plus a "⋮" overflow menu (Quality / Subtitles /
 * Seek amount / Download subtitles / Download video) and mobile double-tap
 * seek zones — ported from the approved test-custom-player-medaka.html
 * prototype, generalized so both megaplay-backup.js's Cloudflare player and
 * vidnest-loader.js's Vidnest player can attach to it instead of native
 * <video controls> + their own separate floating overlay.
 *
 * Usage: window.VWPlayerUI.attach(videoEl, playerContainerEl) returns:
 *   { setQualityOptions(options, currentValue, onChange),
 *     setSubtitleTracks(tracks),      // [{label, file}] raw metadata
 *     setDownloadHandler(fn),         // async (setStatus) => {blob,filename} | {direct:true}
 *     destroy() }
 *
 * Deliberately does NOT touch the surrounding modal chrome (header/title/
 * dubbed toggle/episode sidebar) — that's already built and working in
 * content.js/virohome.js. This module owns only the video control bar.
 *
 * Reuses the site's existing #videoSpinner (shared by every source already)
 * rather than creating its own — same convention megaplay-backup.js and
 * vidnest-loader.js already follow.
 */
(function () {
  "use strict";

  const CHECK_SVG = '<svg class="vw-player-check" viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  const SEEK_STEP_KEY = "vw_player_seek_step"; // shared across both players — it's a user preference, not per-source

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  }

  // WebVTT → SRT, needed for the subtitle-download row (same conversion
  // megaplay-backup.js exports via window.vwHlsUtils — duplicated here too
  // so this module has no load-order dependency on that file).
  function vttToSrt(vtt) {
    const lines = vtt.replace(/\r/g, "").split("\n");
    const norm = (t) => { t = t.replace(".", ","); return t.split(":").length === 2 ? "00:" + t : t; };
    const out = [];
    let idx = 1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/);
      if (!m) continue;
      const text = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "") {
        const s = lines[i].replace(/<[^>]+>/g, "");
        if (s.trim() !== "") text.push(s);
        i++;
      }
      out.push(String(idx++), `${norm(m[1])} --> ${norm(m[2])}`, text.join("\n"), "");
    }
    return out.join("\n");
  }

  function fileBase() {
    const t = document.getElementById("nowPlayingTitle");
    const ep = document.querySelector(".episode.active");
    const base = (t && t.textContent ? t.textContent : "video").trim();
    const epn = (ep && ep.textContent ? ep.textContent : "").trim();
    const name = [base, epn].filter(Boolean).join(" - ") || "video";
    return name.replace(/[\\/:*?"<>|]+/g, "_");
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function el(tag, className, html) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function attach(video, playerEl) {
    const spinner = document.getElementById("videoSpinner");

    // ── Build DOM ────────────────────────────────────────────────
    const root = el("div", "vw-player-root");

    const tapLeft = el("div", "vw-player-tap-zone left");
    const tapRight = el("div", "vw-player-tap-zone right");
    const flashLeft = el("div", "vw-player-seek-flash left",
      '<svg viewBox="0 0 24 24"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg><span></span>');
    const flashRight = el("div", "vw-player-seek-flash right",
      '<svg viewBox="0 0 24 24"><path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" transform="scale(-1,1) translate(-24,0)"/></svg><span></span>');
    const flashLeftLabel = flashLeft.querySelector("span");
    const flashRightLabel = flashRight.querySelector("span");

    const controls = el("div", "vw-player-controls");
    const seekRow = el("div", "vw-player-seek-row");
    const curTimeEl = el("span", "vw-player-time", "0:00");
    const seek = el("input", "vw-player-seek");
    seek.type = "range"; seek.min = "0"; seek.max = "100"; seek.value = "0"; seek.step = "0.1";
    const durTimeEl = el("span", "vw-player-time", "0:00");
    seekRow.append(curTimeEl, seek, durTimeEl);

    const btnRow = el("div", "vw-player-btn-row");
    const playBtn = el("button", "vw-player-icon-btn",
      '<svg class="vw-player-play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
      '<svg class="vw-player-pause-icon" viewBox="0 0 24 24" style="display:none"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>');
    playBtn.type = "button"; playBtn.title = "Play/Pause";
    const playIcon = playBtn.querySelector(".vw-player-play-icon");
    const pauseIcon = playBtn.querySelector(".vw-player-pause-icon");

    const volGroup = el("div", "vw-player-vol-group");
    const muteBtn = el("button", "vw-player-icon-btn",
      '<svg class="vw-player-vol-high-icon" viewBox="0 0 24 24"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>' +
      '<svg class="vw-player-vol-mute-icon" viewBox="0 0 24 24" style="display:none"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4l-1.88 1.88L12 7.76V4z"/></svg>');
    muteBtn.type = "button"; muteBtn.title = "Mute";
    const volHighIcon = muteBtn.querySelector(".vw-player-vol-high-icon");
    const volMuteIcon = muteBtn.querySelector(".vw-player-vol-mute-icon");
    const volume = el("input", "vw-player-volume");
    volume.type = "range"; volume.min = "0"; volume.max = "1"; volume.value = "1"; volume.step = "0.01";
    volGroup.append(muteBtn, volume);

    const spacer = el("div", "vw-player-spacer");

    const ccBtn = el("button", "vw-player-icon-btn",
      '<svg viewBox="0 0 24 24"><path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>');
    ccBtn.type = "button"; ccBtn.title = "Captions";

    const fsBtn = el("button", "vw-player-icon-btn",
      '<svg class="vw-player-fs-enter-icon" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>' +
      '<svg class="vw-player-fs-exit-icon" viewBox="0 0 24 24" style="display:none"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>');
    fsBtn.type = "button"; fsBtn.title = "Fullscreen";
    const fsEnterIcon = fsBtn.querySelector(".vw-player-fs-enter-icon");
    const fsExitIcon = fsBtn.querySelector(".vw-player-fs-exit-icon");

    const moreBtn = el("button", "vw-player-icon-btn",
      '<svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>');
    moreBtn.type = "button"; moreBtn.title = "More options";

    btnRow.append(playBtn, volGroup, spacer, ccBtn, fsBtn, moreBtn);
    controls.append(seekRow, btnRow);

    // ── Menus ──────────────────────────────────────────────────────
    function menuRow(label, valueId) {
      const row = el("div", "vw-player-menu-row");
      const valSpan = valueId ? `<span><span class="vw-player-menu-value">${valueId}</span> <span class="vw-player-menu-arrow">›</span></span>` : "";
      row.innerHTML = `<span>${label}</span>${valSpan}`;
      return row;
    }
    const menuRoot_ = el("div", "vw-player-menu-panel");
    const rowQuality = menuRow("Quality", "Auto");
    const rowSubtitles = menuRow("Subtitles", "Off");
    const rowSeekAmount = menuRow("Seek amount", "10s");
    const rowSubDownload = el("div", "vw-player-menu-row", "<span>Download subtitles</span>");
    const rowVidDownload = el("div", "vw-player-menu-row", '<span>Download video</span><span class="vw-player-menu-value"></span>');
    menuRoot_.append(rowQuality, rowSubtitles, rowSeekAmount, rowSubDownload, rowVidDownload);
    const qualityValueLabel = rowQuality.querySelector(".vw-player-menu-value");
    const subValueLabel = rowSubtitles.querySelector(".vw-player-menu-value");
    const seekValueLabel = rowSeekAmount.querySelector(".vw-player-menu-value");
    const downloadStatusLabel = rowVidDownload.querySelector(".vw-player-menu-value");

    function submenu(title) {
      const panel = el("div", "vw-player-menu-panel");
      const header = el("div", "vw-player-menu-header",
        '<span class="vw-player-back-btn"><svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></span>' +
        `<span>${title}</span>`);
      const list = el("div", "vw-player-option-list");
      panel.append(header, list);
      return { panel, list, backBtn: header.querySelector(".vw-player-back-btn") };
    }
    const quality = submenu("Quality");
    const subtitles = submenu("Subtitles");
    const seekMenu = submenu("Seek amount");

    root.append(
      tapLeft, tapRight, flashLeft, flashRight, controls,
      menuRoot_, quality.panel, subtitles.panel, seekMenu.panel,
    );
    // playerEl is a small wrapper the caller creates around just the video
    // (not the whole .player column, which also holds the Prev/Next bar
    // below it — anchoring to that would push this bottom-aligned control
    // bar down past the video into that row). root lives as video's sibling
    // inside that wrapper, so hiding the wrapper hides both together with
    // plain CSS — no visibility-sync JS needed.
    playerEl.appendChild(root);

    // ── State ────────────────────────────────────────────────────
    let seekStep = Number(localStorage.getItem(SEEK_STEP_KEY)) || 10;
    let captionTracks = [];
    let trackBlobUrls = [];
    let activeSubIndex = -1;
    let downloadHandler = null;
    let downloading = false;
    let qualityOnChange = null;

    function setSeekStep(v) {
      seekStep = v;
      localStorage.setItem(SEEK_STEP_KEY, String(v));
      seekValueLabel.textContent = v + "s";
      flashLeftLabel.textContent = v + "s";
      flashRightLabel.textContent = v + "s";
    }
    function buildSeekMenu() {
      seekMenu.list.innerHTML = "";
      [5, 10, 15].forEach((v) => {
        const row = el("div", "vw-player-menu-option" + (v === seekStep ? " selected" : ""), `<span>${v} seconds</span>${CHECK_SVG}`);
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          setSeekStep(v);
          [...seekMenu.list.children].forEach((c) => c.classList.remove("selected"));
          row.classList.add("selected");
          closeAllMenus();
        });
        seekMenu.list.appendChild(row);
      });
    }

    // ── Play/Pause ───────────────────────────────────────────────
    function togglePlay() { if (video.paused) video.play(); else video.pause(); }
    playBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });
    video.addEventListener("play", () => { playIcon.style.display = "none"; pauseIcon.style.display = ""; });
    video.addEventListener("pause", () => { playIcon.style.display = ""; pauseIcon.style.display = "none"; });

    // ── Tap zones: single tap = play/pause, double tap = seek ─────
    const DOUBLE_TAP_MS = 280;
    const tapState = { left: { count: 0, tid: null }, right: { count: 0, tid: null } };
    function flashSeek(side) {
      const f = side === "left" ? flashLeft : flashRight;
      f.classList.remove("fade");
      void f.offsetWidth;
      f.classList.add("pop");
      clearTimeout(f._fadeTid);
      f._fadeTid = setTimeout(() => { f.classList.remove("pop"); f.classList.add("fade"); }, 500);
    }
    function seekBy(delta) {
      if (delta < 0) video.currentTime = Math.max(0, video.currentTime + delta);
      else if (video.duration) video.currentTime = Math.min(video.duration, video.currentTime + delta);
    }
    function handleZoneTap(side) {
      const st = tapState[side];
      st.count++;
      if (st.count === 1) {
        st.tid = setTimeout(() => { st.count = 0; togglePlay(); }, DOUBLE_TAP_MS);
      } else {
        clearTimeout(st.tid);
        st.count = 0;
        seekBy(side === "left" ? -seekStep : seekStep);
        flashSeek(side);
        showControls();
      }
    }
    tapLeft.addEventListener("click", () => handleZoneTap("left"));
    tapRight.addEventListener("click", () => handleZoneTap("right"));

    // ── Seek bar + buffered range ──────────────────────────────────
    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;
      const pct = (video.currentTime / video.duration) * 100;
      seek.value = pct;
      seek.style.setProperty("--pct", pct + "%");
      curTimeEl.textContent = fmtTime(video.currentTime);
    });
    video.addEventListener("loadedmetadata", () => { durTimeEl.textContent = fmtTime(video.duration); });
    seek.addEventListener("input", (e) => { e.stopPropagation(); if (video.duration) video.currentTime = (seek.value / 100) * video.duration; });
    seek.addEventListener("click", (e) => e.stopPropagation());

    function updateBuffered() {
      if (!video.duration || !video.buffered.length) return;
      let end = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime + 0.5) end = Math.max(end, video.buffered.end(i));
      }
      seek.style.setProperty("--bufpct", (end / video.duration) * 100 + "%");
    }
    video.addEventListener("progress", updateBuffered);
    video.addEventListener("timeupdate", updateBuffered);

    // ── Volume ───────────────────────────────────────────────────
    function updateVolIcon() {
      const off = video.muted || video.volume === 0;
      volHighIcon.style.display = off ? "none" : "";
      volMuteIcon.style.display = off ? "" : "none";
      volume.style.setProperty("--volpct", (off ? 0 : video.volume * 100) + "%");
    }
    muteBtn.addEventListener("click", (e) => { e.stopPropagation(); video.muted = !video.muted; updateVolIcon(); });
    volume.addEventListener("input", (e) => { e.stopPropagation(); video.volume = Number(volume.value); video.muted = false; updateVolIcon(); });
    volume.addEventListener("click", (e) => e.stopPropagation());
    function setVolume(v) {
      video.volume = Math.min(1, Math.max(0, v));
      video.muted = false;
      volume.value = video.volume;
      updateVolIcon();
    }

    // ── Buffering spinner (shared #videoSpinner) ──────────────────
    function showSpinner() { if (spinner) spinner.style.display = "block"; }
    function hideSpinner() { if (spinner) spinner.style.display = "none"; }
    video.addEventListener("waiting", showSpinner);
    video.addEventListener("playing", hideSpinner);
    video.addEventListener("canplay", hideSpinner);
    video.addEventListener("seeking", showSpinner);
    video.addEventListener("seeked", () => { if (!video.paused) hideSpinner(); });

    // ── Fullscreen ───────────────────────────────────────────────
    fsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (document.fullscreenElement) document.exitFullscreen();
      else playerEl.requestFullscreen().catch(() => {});
    });
    function onFsChange() {
      const on = document.fullscreenElement === playerEl;
      fsEnterIcon.style.display = on ? "none" : "";
      fsExitIcon.style.display = on ? "" : "none";
    }
    document.addEventListener("fullscreenchange", onFsChange);

    // ── Auto-hide controls while playing + idle ───────────────────
    let idleTid;
    function showControls() {
      root.classList.remove("vw-player-controls-hidden");
      clearTimeout(idleTid);
      if (!video.paused) idleTid = setTimeout(() => { if (!anyMenuOpen()) root.classList.add("vw-player-controls-hidden"); }, 2600);
    }
    root.addEventListener("mousemove", showControls);
    root.addEventListener("mouseleave", () => { if (!video.paused && !anyMenuOpen()) root.classList.add("vw-player-controls-hidden"); });
    video.addEventListener("play", showControls);

    // ── Keyboard shortcuts ─────────────────────────────────────────
    const VOL_STEP = 0.05;
    function onKeydown(e) {
      if (root.offsetParent === null) return; // hidden (ancestor display:none) — not the active player
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      let handled = true;
      switch (e.key.toLowerCase()) {
        case " ": case "k": togglePlay(); break;
        case "f": fsBtn.click(); break;
        case "m": video.muted = !video.muted; updateVolIcon(); break;
        case "c": ccBtn.click(); break;
        case "arrowleft": video.currentTime = Math.max(0, video.currentTime - seekStep); break;
        case "arrowright": if (video.duration) video.currentTime = Math.min(video.duration, video.currentTime + seekStep); break;
        case "arrowup": setVolume(video.volume + VOL_STEP); break;
        case "arrowdown": setVolume(video.volume - VOL_STEP); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); showControls(); }
    }
    document.addEventListener("keydown", onKeydown);

    // ── ⋮ overflow menu ────────────────────────────────────────────
    function anyMenuOpen() {
      return menuRoot_.classList.contains("open") || quality.panel.classList.contains("open") ||
        subtitles.panel.classList.contains("open") || seekMenu.panel.classList.contains("open");
    }
    function closeAllMenus() {
      menuRoot_.classList.remove("open");
      quality.panel.classList.remove("open");
      subtitles.panel.classList.remove("open");
      seekMenu.panel.classList.remove("open");
    }
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (anyMenuOpen()) closeAllMenus();
      else { menuRoot_.classList.add("open"); showControls(); }
    });
    function onDocClick(e) {
      if (!root.contains(e.target)) closeAllMenus();
    }
    document.addEventListener("click", onDocClick);
    function slideTo(fromPanel, toPanel, enterClass) {
      fromPanel.classList.remove("open");
      toPanel.classList.add(enterClass, "open");
      requestAnimationFrame(() => requestAnimationFrame(() => toPanel.classList.remove(enterClass)));
    }
    rowQuality.addEventListener("click", (e) => { e.stopPropagation(); slideTo(menuRoot_, quality.panel, "enter-from-right"); });
    rowSubtitles.addEventListener("click", (e) => { e.stopPropagation(); slideTo(menuRoot_, subtitles.panel, "enter-from-right"); });
    rowSeekAmount.addEventListener("click", (e) => { e.stopPropagation(); slideTo(menuRoot_, seekMenu.panel, "enter-from-right"); });
    [quality, subtitles, seekMenu].forEach(({ panel }) => {
      panel.querySelector(".vw-player-back-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        slideTo(panel, menuRoot_, "enter-from-left");
      });
    });

    // ── Quality ──────────────────────────────────────────────────
    function setQualityOptions(options, currentValue, onChange) {
      qualityOnChange = onChange;
      quality.list.innerHTML = "";
      if (!options || !options.length) { qualityValueLabel.textContent = "—"; return; }
      const current = options.find((o) => o.value === currentValue) || options[0];
      qualityValueLabel.textContent = current.label;
      options.forEach((opt) => {
        const row = el("div", "vw-player-menu-option" + (opt.value === currentValue ? " selected" : ""), `<span>${opt.label}</span>${CHECK_SVG}`);
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          qualityValueLabel.textContent = opt.label;
          [...quality.list.children].forEach((c) => c.classList.remove("selected"));
          row.classList.add("selected");
          quality.panel.classList.remove("open");
          if (qualityOnChange) qualityOnChange(opt.value);
        });
        quality.list.appendChild(row);
      });
    }

    // ── Subtitles (blob-url workaround — file:// blocks cross-origin
    // <track> loads outright, unlike plain fetch()) ─────────────────
    function revokeTrackBlobs() {
      trackBlobUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
      trackBlobUrls = [];
    }
    function setActiveSub(index) {
      activeSubIndex = index;
      subValueLabel.textContent = index === -1 ? "Off" : (captionTracks[index].label || `Track ${index + 1}`);
      const tt = video.textTracks;
      for (let i = 0; i < tt.length; i++) tt[i].mode = i === index ? "showing" : "disabled";
      ccBtn.style.color = index === -1 ? "" : "#6cf";
    }
    function buildSubtitlesMenu() {
      subtitles.list.innerHTML = "";
      const offRow = el("div", "vw-player-menu-option" + (activeSubIndex === -1 ? " selected" : ""), `<span>Off</span>${CHECK_SVG}`);
      offRow.addEventListener("click", (e) => { e.stopPropagation(); setActiveSub(-1); refreshSubSelection(); subtitles.panel.classList.remove("open"); });
      subtitles.list.appendChild(offRow);
      captionTracks.forEach((t, i) => {
        const row = el("div", "vw-player-menu-option" + (activeSubIndex === i ? " selected" : ""), `<span>${t.label || "Track " + (i + 1)}</span>${CHECK_SVG}`);
        row.addEventListener("click", (e) => { e.stopPropagation(); setActiveSub(i); refreshSubSelection(); subtitles.panel.classList.remove("open"); });
        subtitles.list.appendChild(row);
      });
    }
    function refreshSubSelection() {
      [...subtitles.list.children].forEach((c, i) => c.classList.toggle("selected", (i === 0 && activeSubIndex === -1) || (i - 1 === activeSubIndex)));
    }
    ccBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!captionTracks.length) return;
      setActiveSub(activeSubIndex === -1 ? 0 : -1);
    });

    async function setSubtitleTracks(tracks) {
      captionTracks = (Array.isArray(tracks) ? tracks : []).filter((t) => t && t.file);
      const myTracks = captionTracks;
      video.querySelectorAll("track").forEach((t) => t.remove());
      activeSubIndex = -1;
      buildSubtitlesMenu();
      subValueLabel.textContent = "Off";
      rowSubDownload.classList.toggle("disabled", !myTracks.length);
      if (!myTracks.length) return;
      const results = await Promise.all(myTracks.map(async (t) => {
        try { return URL.createObjectURL(new Blob([await (await fetch(t.file)).text()], { type: "text/vtt" })); }
        catch (_) { return null; }
      }));
      if (captionTracks !== myTracks) return; // a newer set arrived meanwhile
      revokeTrackBlobs();
      results.forEach((blobUrl, i) => {
        if (!blobUrl) return;
        trackBlobUrls.push(blobUrl);
        const tr = document.createElement("track");
        tr.kind = "subtitles";
        tr.label = myTracks[i].label || `Track ${i + 1}`;
        tr.srclang = (myTracks[i].label || "en").slice(0, 2).toLowerCase();
        tr.src = blobUrl;
        video.appendChild(tr);
      });
      const tt = video.textTracks;
      for (let i = 0; i < tt.length; i++) tt[i].mode = "disabled"; // off by default, matches native players
    }

    rowSubDownload.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!captionTracks.length) return;
      const track = captionTracks[activeSubIndex === -1 ? 0 : activeSubIndex];
      try {
        const srt = vttToSrt(await (await fetch(track.file)).text());
        const lang = (track.label || "sub").replace(/[^\w]+/g, "") || "sub";
        triggerBlobDownload(new Blob([srt], { type: "application/x-subrip" }), `${fileBase()}.${lang}.srt`);
      } catch (_) { console.error("Subtitle download failed"); }
      closeAllMenus();
    });

    // ── Download video ─────────────────────────────────────────────
    function setDownloadHandler(fn) { downloadHandler = fn; }
    rowVidDownload.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (downloading || !downloadHandler) return;
      downloading = true;
      const setStatus = (t) => { downloadStatusLabel.textContent = t; };
      setStatus("Preparing…");
      try {
        const result = await downloadHandler(setStatus);
        if (result && result.blob) {
          triggerBlobDownload(result.blob, result.filename || (fileBase() + ".mp4"));
          setStatus("✓ Saved");
        } else {
          setStatus("↓ Started"); // e.g. a direct <a download> click — browser owns the rest
        }
      } catch (err) {
        setStatus("⚠ Failed");
        console.error("Download failed:", err);
      } finally {
        downloading = false;
        setTimeout(() => setStatus(""), 2500);
      }
    });

    // ── Init ─────────────────────────────────────────────────────
    updateVolIcon();
    buildSeekMenu();
    setSeekStep(seekStep);

    function destroy() {
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("fullscreenchange", onFsChange);
      revokeTrackBlobs();
      root.remove();
    }

    return { setQualityOptions, setSubtitleTracks, setDownloadHandler, destroy };
  }

  window.VWPlayerUI = { attach };
})();
