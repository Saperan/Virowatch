/**
 * megaplay-backup.js  —  Virowatch anime backup player
 *
 * When an Anikoto / MegaPlay episode is loaded into #videoPlayer (the iframe),
 * this module:
 *   - shows a "Backup ▶" button under the player,
 *   - after AUTO_DELAY ms auto-switches to a VPN-free backup stream,
 *   - resolves that stream through the Cloudflare Worker and plays it with
 *     hls.js inside a <video> element (no iframe, no VPN).
 *
 * Once the user manually picks the backup, it stays sticky for the session,
 * so later episodes go straight to the backup player.
 *
 * Non-invasive: nothing in content.js / anikoto-loader.js changes. This just
 * observes the iframe's src attribute.
 */
(function () {
  "use strict";

  // ── CONFIG ── worker chain, tried top-to-bottom ──
  // Each worker: { url, quality }.  quality = height cap (number) or "auto".
  // On a 429 / failure / mid-stream error the player falls over to the next.
  // NOTE: Cloudflare's 100k req/day is PER ACCOUNT — to actually get a
  // separate budget, put the 2nd worker on a DIFFERENT Cloudflare account.
  const WORKERS = [
    { url: "https://anikoto-request.vmtgaming13.workers.dev", quality: 720 },
    { url: "https://ux-anikoto.uxlibrary.workers.dev",        quality: "auto" },
  ]
    .filter((w) => w.url)
    .map((w) => ({ ...w, url: w.url.replace(/\/+$/, "") }));

  const HLS_CDN    = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
  const DL_CONC    = 6;      // parallel segment fetches while downloading
  const AUTO_DELAY = 4000;   // ms before auto-fallback kicks in
  // MegaPlay embed: .../stream/s-3/<id>/<sub|dub>
  const MEGA_RE    = /megaplay\.buzz\/stream\/s-\d+\/(\d+)\/(sub|dub)/i;

  let mode          = "embed"; // "embed" | "backup"
  let preferBackup  = false;   // sticky once user chooses backup
  let disableAuto   = false;   // set when user picks "Use embed" (VPN users)
  let autoTid       = null;
  let hls           = null;
  let selfSetting   = false;    // guard our own iframe.src writes
  let lastEmbedSrc  = "";       // megaplay url to restore when leaving backup
  let current       = null;     // { id, type }
  let hlsLoading    = null;     // promise
  let workerIdx     = 0;        // active worker in WORKERS
  let playToken     = 0;        // invalidates stale async work on new load
  let userQuality   = null;     // null = use worker default; else "auto" or height
  let activeWorkerQuality = 720; // quality of the worker currently playing
  let captionTracks = [];        // subtitle tracks for the current episode

  // ── Load hls.js on demand ─────────────────────────────────────────
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = HLS_CDN;
      s.onload  = () => res(window.Hls);
      s.onerror = () => rej(new Error("hls.js failed to load"));
      document.head.appendChild(s);
    });
    return hlsLoading;
  }

  // ── DOM refs ──────────────────────────────────────────────────────
  function iframe()  { return document.getElementById("videoPlayer"); }
  function spinner() { return document.getElementById("videoSpinner"); }

  function backupVideo() {
    let v = document.getElementById("viroBackupPlayer");
    if (!v) {
      v = document.createElement("video");
      v.id = "viroBackupPlayer";
      v.controls = true;
      v.playsInline = true;
      v.autoplay = true;
      v.crossOrigin = "anonymous"; // required for cross-origin <track> subtitles
      // Kill the native ⋮ "Download" (it saves the useless "hls" MSE blob).
      v.setAttribute("controlsList", "nodownload");
      v.style.cssText =
        "flex:1;width:100%;min-height:200px;background:#000;border:0;display:none;";
      const f = iframe();
      if (f && f.parentNode) f.parentNode.insertBefore(v, f.nextSibling);
    }
    return v;
  }

  // Overlay on top of the video holding the quality picker + download.
  function overlay() {
    let o = document.getElementById("viroOverlay");
    if (!o) {
      o = document.createElement("div");
      o.id = "viroOverlay";
      o.style.display = "none";
      const player = document.querySelector(".player");
      if (player) player.appendChild(o);
    }
    return o;
  }
  function hideOverlay() {
    const o = document.getElementById("viroOverlay");
    if (o) o.style.display = "none";
  }

  function button() {
    let b = document.getElementById("viroBackupBtn");
    if (!b) {
      b = document.createElement("a");
      b.id = "viroBackupBtn";
      b.href = "#";
      b.className = "button";
      b.style.display = "none";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        if (mode === "backup") useEmbed();
        else { preferBackup = true; playBackup("manual"); }
      });
      const controls = document.querySelector(".player-controls");
      const nextBtn  = document.getElementById("nextEpisode");
      if (controls) controls.insertBefore(b, nextBtn ? nextBtn.nextSibling : null);
    }
    return b;
  }

  // ── Quality dropdown (backup mode only) ───────────────────────────
  function qualitySelect() {
    let s = document.getElementById("viroQualityMenu");
    if (!s) {
      s = document.createElement("select");
      s.id = "viroQualityMenu";
      s.className = "button";
      s.style.display = "none";
      s.title = "Video quality";
      s.addEventListener("change", () => {
        userQuality = s.value === "auto" ? "auto" : Number(s.value);
        applyQuality();
      });
      overlay().appendChild(s);
    }
    return s;
  }

  function levelIndexForCap(cap) {
    let idx = -1, best = -1;
    hls.levels.forEach((l, i) => {
      if (l.height <= cap && l.height > best) { best = l.height; idx = i; }
    });
    if (idx === -1) {
      idx = hls.levels.reduce((m, l, i, a) => (l.height < a[m].height ? i : m), 0);
    }
    return idx;
  }

  function applyQuality() {
    if (!hls || !hls.levels || !hls.levels.length) return;
    const cap = userQuality != null ? userQuality : activeWorkerQuality;
    if (cap === "auto") { hls.autoLevelCapping = -1; hls.currentLevel = -1; return; }
    const idx = levelIndexForCap(Number(cap));
    hls.autoLevelCapping = idx;
    hls.currentLevel = idx; // pin to the chosen rendition
  }

  function buildQualityMenu() {
    const s = qualitySelect();
    s.innerHTML = "";
    const add = (v, t) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = t; s.appendChild(o);
    };
    add("auto", "Auto");
    [...new Set(hls.levels.map((l) => l.height))]
      .sort((a, b) => b - a)
      .forEach((h) => add(String(h), h + "p"));
    const cur = userQuality != null ? String(userQuality) : String(activeWorkerQuality);
    s.value = [...s.options].some((o) => o.value === cur) ? cur : "auto";
    s.style.display = "";
    downloadBtn().style.display = "";
    buildSubControl(); // add/refresh the Sub download button/dropdown
    overlay().style.display = "flex"; // reveal picker + download over the video
  }

  // ── Download button (backup mode only) — remux HLS → .mp4 ─────────
  let downloading = false;

  function downloadBtn() {
    let b = document.getElementById("viroDownloadBtn");
    if (!b) {
      b = document.createElement("a");
      b.id = "viroDownloadBtn";
      b.href = "#";
      b.className = "button";
      b.style.display = "none";
      b.textContent = "⭳ Download";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        if (!downloading) startDownload(b);
      });
      overlay().appendChild(b);
    }
    return b;
  }

  // Pick the child playlist URL (worker-proxied) matching a height cap.
  function pickVariant(masterText, cap) {
    const lines = masterText.split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        const res = /RESOLUTION=\d+x(\d+)/.exec(lines[i]);
        const url = (lines[i + 1] || "").trim();
        if (url && !url.startsWith("#")) {
          variants.push({ height: res ? Number(res[1]) : 0, url });
        }
      }
    }
    if (!variants.length) return null;
    if (cap === "auto") {
      return variants.reduce((m, v) => (v.height > m.height ? v : m)).url;
    }
    const c = Number(cap);
    const under = variants.filter((v) => v.height <= c);
    const pick = under.length
      ? under.reduce((m, v) => (v.height > m.height ? v : m))
      : variants.reduce((m, v) => (v.height < m.height ? v : m));
    return pick.url;
  }

  function segUrlsFrom(childText) {
    return childText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }

  function fileBase() {
    const t = document.getElementById("nowPlayingTitle");
    const ep = document.querySelector(".episode.active");
    const base = (t && t.textContent ? t.textContent : "anime").trim();
    const epn = (ep && ep.textContent ? ep.textContent : "").trim();
    const name = [base, epn].filter(Boolean).join(" - ") || "episode";
    return name.replace(/[\\/:*?"<>|]+/g, "_");
  }
  function fileName() { return fileBase() + ".ts"; }

  // WebVTT → SRT so VLC and friends accept the sidecar file.
  function vttToSrt(vtt) {
    const lines = vtt.replace(/\r/g, "").split("\n");
    const norm = (t) => {
      t = t.replace(".", ",");
      return t.split(":").length === 2 ? "00:" + t : t; // MM:SS,mmm → HH:MM:SS,mmm
    };
    const out = [];
    let idx = 1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(
        /((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/,
      );
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

  async function downloadSub(track) {
    try {
      toast("Downloading subtitles…");
      const srt = vttToSrt(await (await fetch(track.file)).text());
      if (!srt.trim()) { toast("Subtitle file was empty"); return; }
      const lang = (track.label || "sub").replace(/[^\w]+/g, "") || "sub";
      const url = URL.createObjectURL(
        new Blob([srt], { type: "application/x-subrip" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBase()}.${lang}.srt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (_) {
      toast("Subtitle download failed");
    }
  }

  // Build the "Sub" control: a button for one track, a dropdown for many.
  function buildSubControl() {
    const old = document.getElementById("viroSubDl");
    if (old) old.remove();
    const subs = captionTracks;
    if (!subs.length) return;

    let el;
    if (subs.length === 1) {
      el = document.createElement("a");
      el.href = "#";
      el.textContent = "⤓ Sub";
      el.title = "Download subtitles (.srt)";
      el.addEventListener("click", (e) => { e.preventDefault(); downloadSub(subs[0]); });
    } else {
      el = document.createElement("select");
      el.title = "Download subtitles (.srt)";
      const ph = document.createElement("option");
      ph.value = ""; ph.textContent = "⤓ Sub";
      el.appendChild(ph);
      subs.forEach((t, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = t.label || `Sub ${i + 1}`;
        el.appendChild(o);
      });
      el.addEventListener("change", () => {
        const i = Number(el.value);
        if (el.value !== "" && subs[i]) downloadSub(subs[i]);
        el.selectedIndex = 0; // reset back to the "Sub" label
      });
    }
    el.id = "viroSubDl";
    el.className = "button";
    overlay().appendChild(el);
  }

  async function startDownload(btn) {
    if (!current || !WORKERS.length) return;
    downloading = true;
    const label = btn.textContent;
    const setLbl = (t) => { btn.textContent = t; };
    setLbl("Preparing…");
    const w = WORKERS[workerIdx] || WORKERS[0];
    const cap = userQuality != null ? userQuality : activeWorkerQuality;
    try {
      // 1. resolve → master playlist (worker-proxied)
      const rr = await fetch(
        `${w.url}/resolve?id=${encodeURIComponent(current.id)}&type=${current.type}`,
      );
      const data = await rr.json();
      if (!data || !data.ok || !data.file) throw new Error("resolve failed");
      const masterText = await (await fetch(data.file)).text();

      // 2. pick quality variant → its segment list
      const childUrl = pickVariant(masterText, cap);
      if (!childUrl) throw new Error("no variant found");
      const segUrls = segUrlsFrom(await (await fetch(childUrl)).text());
      if (!segUrls.length) throw new Error("no segments");

      // 3. fetch all segments (concurrent) + concatenate untouched
      const blob = await assembleTs(segUrls, (done, total) =>
        setLbl(`Downloading ${Math.floor((done / total) * 100)}%`),
      );

      // 4. trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setLbl("✓ Saved");
      setTimeout(() => setLbl(label), 2500);
    } catch (err) {
      setLbl("⚠ Failed");
      toast("Download failed — " + (err.message || "error"));
      setTimeout(() => setLbl(label), 2500);
    } finally {
      downloading = false;
    }
  }

  // Concatenate the raw HLS segments untouched → one .ts file. No remux, so
  // the original audio+video stay perfectly in sync with correct timing.
  async function assembleTs(segUrls, onProgress) {
    const total = segUrls.length;
    const buffers = new Array(total); // kept in order for a correct Blob
    let nextFetch = 0, done = 0;

    async function pool() {
      while (true) {
        const i = nextFetch++;
        if (i >= total) return;
        const r = await fetch(segUrls[i]);
        buffers[i] = await r.arrayBuffer();
        done++;
        onProgress(done, total);
      }
    }

    await Promise.all(Array.from({ length: DL_CONC }, pool));
    return new Blob(buffers, { type: "video/mp2t" });
  }

  function setButtonLabel() {
    const b = button();
    if (mode === "backup") {
      b.textContent = "⟲ Use embed";
      b.title = "Switch back to the original MegaPlay embed";
    } else {
      b.textContent = "⚡ Backup (no VPN)";
      b.title = "Play through the VPN-free backup stream";
    }
  }

  function toast(msg) {
    let t = document.getElementById("vwl-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "vwl-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "vwl-show";
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.className = ""; }, 2600);
  }

  // ── Mode switches ─────────────────────────────────────────────────
  function stopHls() {
    if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
    const v = backupVideo();
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch (_) {}
  }

  function showEmbed() {
    const v = backupVideo();
    v.style.display = "none";
    hideOverlay();
    const f = iframe();
    if (f) f.style.display = "";
  }
  function showBackup() {
    const f = iframe();
    if (f) f.style.display = "none";
    backupVideo().style.display = "";
  }

  function useEmbed() {
    preferBackup = false;
    disableAuto = true; // user prefers the embed — stop auto-switching
    mode = "embed";
    clearTimeout(autoTid);
    playToken++; // cancel any in-flight resolve / failover
    stopHls();
    showEmbed();
    // Restore the megaplay embed we blanked when entering backup.
    const f = iframe();
    if (f && lastEmbedSrc && f.src !== lastEmbedSrc) {
      selfSetting = true;
      f.src = lastEmbedSrc;
      setTimeout(() => { selfSetting = false; }, 0);
    }
    setButtonLabel();
  }

  let resumeTime = 0; // playback position carried across a worker failover

  async function playBackup(reason) {
    if (!current) return;
    clearTimeout(autoTid);
    mode = "backup";
    setButtonLabel();

    // Kill the iframe so MegaPlay audio / error page doesn't linger.
    const f = iframe();
    if (f) {
      selfSetting = true;
      f.src = "about:blank";
      setTimeout(() => { selfSetting = false; }, 0);
    }
    showBackup();
    if (spinner()) spinner().style.display = "block";
    if (reason === "auto") toast("No VPN? Loading backup stream…");

    if (!WORKERS.length) {
      if (spinner()) spinner().style.display = "none";
      toast("No backup worker configured");
      return;
    }

    workerIdx  = 0;      // fresh episode always starts on the primary worker
    resumeTime = 0;
    const token = ++playToken; // any new load invalidates in-flight failovers
    loadFromWorker(token);
  }

  // Try the current worker; on failure move to the next in the chain.
  async function loadFromWorker(token) {
    if (token !== playToken) return;
    const w = WORKERS[workerIdx];
    const { id, type } = current;
    try {
      const r = await fetch(
        `${w.url}/resolve?id=${encodeURIComponent(id)}&type=${type}`,
      );
      if (token !== playToken) return;
      if (r.status === 429) throw new Error("worker out of requests (429)");
      const data = await r.json();
      if (!data || !data.ok || !data.file) {
        throw new Error((data && data.error) || "resolve failed");
      }
      captionTracks = (Array.isArray(data.tracks) ? data.tracks : []).filter(
        (t) => t && t.file && /captions|subtitle/i.test(t.kind || "captions"),
      );
      await startPlayback(data.file, w.quality, token);
      addSubtitles(data.tracks);
    } catch (err) {
      failover(token, err.message || "error");
    }
  }

  function failover(token, why) {
    if (token !== playToken) return;
    // Remember where we were so the next worker resumes, not restarts.
    const v = backupVideo();
    if (v.currentTime > 1) resumeTime = v.currentTime;
    stopHls();
    if (workerIdx < WORKERS.length - 1) {
      workerIdx++;
      const q = WORKERS[workerIdx].quality;
      toast(`Server busy — switching to backup ${q === "auto" ? "" : q + "p "}server`);
      loadFromWorker(token);
    } else {
      if (spinner()) spinner().style.display = "none";
      toast("All backup servers unavailable — " + why);
    }
  }

  // Attach subtitle/caption tracks (already proxied by the Worker).
  function addSubtitles(tracks) {
    const v = backupVideo();
    v.querySelectorAll("track").forEach((t) => t.remove());
    if (!Array.isArray(tracks)) return;
    const subs = tracks.filter(
      (t) => t && t.file && /captions|subtitle/i.test(t.kind || "captions"),
    );
    subs.forEach((t, i) => {
      const tr = document.createElement("track");
      tr.kind = "subtitles";
      tr.label = t.label || `Track ${i + 1}`;
      tr.srclang = (t.label || "en").slice(0, 2).toLowerCase();
      tr.src = t.file;
      if (t.default || i === 0) tr.default = true;
      v.appendChild(tr);
    });
    // Force-enable the default track (some browsers leave it "disabled").
    setTimeout(() => {
      const tt = v.textTracks;
      for (let i = 0; i < tt.length; i++) {
        tt[i].mode = i === 0 ? "showing" : "disabled";
      }
    }, 300);
  }

  async function startPlayback(fileUrl, quality, token) {
    activeWorkerQuality = quality;
    const v = backupVideo();
    const done = () => { if (spinner()) spinner().style.display = "none"; };
    const resume = () => {
      if (resumeTime > 1) { try { v.currentTime = resumeTime; } catch (_) {} }
    };

    // Prefer hls.js wherever it works (gives quality control + the overlay).
    // Only fall back to native HLS (Safari / iOS) when hls.js can't run.
    const Hls = await loadHls();
    if (token !== playToken) return;

    if ((!Hls || !Hls.isSupported()) &&
        v.canPlayType("application/vnd.apple.mpegurl")) {
      stopHls();
      v.src = fileUrl;
      v.addEventListener(
        "loadedmetadata",
        () => { done(); resume(); },
        { once: true },
      );
      v.play().catch(() => {});
      return;
    }

    stopHls();
    if (Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        capLevelToPlayerSize: false,     // don't downgrade to the small player box
        startLevel: -1,
        abrEwmaDefaultEstimate: 8000000, // assume 8 Mbps so it starts high, not 360p
        // Buffer far ahead so single-rendition 1080p (no lower fallback) keeps
        // enough segments queued to ride out bandwidth dips without stalling.
        maxBufferLength: 90,             // sec of forward buffer (default 30)
        maxMaxBufferLength: 1200,        // hard ceiling (default 600)
        maxBufferSize: 200 * 1000 * 1000,// 200 MB (default 60 MB)
        backBufferLength: 30,            // keep 30s behind for seeks, drop rest
        fragLoadingMaxRetry: 6,          // retry a stalled segment instead of dying
        fragLoadingMaxRetryTimeout: 8000,
      });
      hls.loadSource(fileUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        buildQualityMenu(); // populate + show the Auto/720p/360p picker
        applyQuality();     // apply user choice (or the worker default)
        done();
        resume();
        v.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        // A fatal network error mid-stream = this worker died → fail over.
        if (d && d.fatal) failover(token, "playback error");
      });
    } else {
      v.src = fileUrl; // last resort
      v.addEventListener(
        "loadedmetadata",
        () => { done(); resume(); },
        { once: true },
      );
    }
  }

  function partyOn() {
    return typeof window.vwPartyActive === "function" && window.vwPartyActive();
  }

  // Party started mid-episode → move the current embed to the Backup player.
  window.addEventListener("vw-party-changed", (e) => {
    if (e.detail && e.detail.active && current && mode === "embed") {
      toast("Watch party — using the Backup player so time sync works");
      playBackup("party");
    }
  });

  // Player closed / switched to a non-megaplay provider — stop backup.
  function teardown() {
    clearTimeout(autoTid);
    playToken++; // cancel any in-flight resolve / failover
    stopHls();
    mode = "embed";
    current = null;
    showEmbed();
    const b = button();
    b.style.display = "none";
  }

  // ── React to a new episode loading in the iframe ──────────────────
  function onEmbedSrc(src) {
    const m = MEGA_RE.exec(src || "");
    if (!m) {
      // Empty src (modal closed) or a non-megaplay provider (other categories)
      // — stop the backup and hand control back to the iframe.
      teardown();
      return;
    }
    current = { id: m[1], type: m[2].toLowerCase() };
    lastEmbedSrc = src;

    const b = button();
    b.style.display = "";
    clearTimeout(autoTid);

    if (preferBackup || partyOn()) {
      // Watch party: always go straight to the Backup player — it's the
      // only anime player both sides can read/seek, so time sync works.
      playBackup(preferBackup ? "sticky" : "party");
    } else {
      mode = "embed";
      showEmbed();
      setButtonLabel();
      if (!disableAuto) {
        autoTid = setTimeout(() => {
          if (mode === "embed") playBackup("auto");
        }, AUTO_DELAY);
      }
    }
  }

  function watch() {
    const f = iframe();
    if (!f) return;
    const obs = new MutationObserver(() => {
      if (selfSetting) return;
      onEmbedSrc(f.getAttribute("src"));
    });
    obs.observe(f, { attributes: true, attributeFilter: ["src"] });
    if (f.getAttribute("src")) onEmbedSrc(f.getAttribute("src"));
  }

  function injectCSS() {
    if (document.getElementById("viro-backup-css")) return;
    const s = document.createElement("style");
    s.id = "viro-backup-css";
    s.textContent = `
      #viroBackupBtn{cursor:pointer;}
      #viroOverlay{position:absolute;top:10px;right:10px;z-index:6;
        display:flex;gap:8px;align-items:center;}
      /* Controls carry .button so each theme styles them like the rest of
         the player bar — only size is trimmed to fit over the video. */
      #viroOverlay .button{font-size:.85rem;padding:7px 14px;line-height:1.2;
        white-space:nowrap;text-decoration:none;}
      #viroOverlay select.button{appearance:none;-webkit-appearance:none;
        text-align:center;}
      @media(max-width:768px){#viroOverlay{top:6px;right:6px;gap:6px;}
        #viroOverlay .button{font-size:.75rem;padding:6px 10px;}}
    `;
    document.head.appendChild(s);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (!WORKERS.length) {
        console.warn("[megaplay-backup] no workers configured in WORKERS.");
      }
      injectCSS();
      watch();
    }, 400);
  });
})();
