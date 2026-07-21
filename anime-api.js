/**
 * anime-api.js — default anime source preference
 *
 * One localStorage key, `vw_anime_api`:
 *   "anikoto"    — raw MegaPlay embed (the original default)
 *   "cloudflare" — Cloudflare Worker backup player (megaplay-backup.js
 *                  reads this and sets preferBackup from the start)
 *   "vidnest"    — Vidnest source (vidnest-loader.js auto-activates its
 *                  anime-merge switch when an episode starts)
 *
 * This module owns:
 *   - window.vwAnimeApi.get()/set(v) + the "vw-anime-api-changed" event
 *     other modules listen to,
 *   - the #vwApiList radio cards in the Settings popup,
 *   - the "⇄ Source: X" button under the player + its compact picker popup
 *     (shown for anime via megaplay-backup.js's "vw-anime-embed" event),
 *   - the one-time first-run popup shown while the key is still unset.
 *     Dismissing it without picking saves "anikoto" so it never nags again.
 */
(function () {
  "use strict";

  const KEY = "vw_anime_api";
  const VALID = ["anikoto", "cloudflare", "vidnest", "vidwish"];

  function get() {
    const v = localStorage.getItem(KEY);
    return VALID.includes(v) ? v : "anikoto";
  }

  function set(v) {
    if (!VALID.includes(v)) return;
    try { localStorage.setItem(KEY, v); } catch (_) {}
    syncSettingsUI();
    window.dispatchEvent(
      new CustomEvent("vw-anime-api-changed", { detail: { api: v } }),
    );
  }

  window.vwAnimeApi = { get, set };

  // ── Settings popup radio cards ─────────────────────────────────────
  function syncSettingsUI() {
    const cur = get();
    document
      .querySelectorAll("#vwApiList .vws-api-opt")
      .forEach((b) =>
        b.classList.toggle("vws-api-active", b.dataset.api === cur),
      );
  }

  function wireSettings() {
    const list = document.getElementById("vwApiList");
    if (!list) return;
    list.addEventListener("click", (e) => {
      const btn = e.target.closest(".vws-api-opt");
      if (btn && btn.dataset.api) set(btn.dataset.api);
    });
    syncSettingsUI();
  }

  // ── Player source-picker button ────────────────────────────────────
  // "⇄ Source: X" under the player (anime only — shown/hidden by
  // megaplay-backup.js's "vw-anime-embed" event). Opens a compact popup of
  // the same OPTIONS as Settings; picking one calls set(), and the players
  // live-apply it to the episode that's already open.
  const SHORT = {
    anikoto: "Anikoto",
    cloudflare: "Cloudflare",
    vidnest: "Vidnest",
    vidwish: "Vidwish",
  };

  function srcCSS() {
    if (document.getElementById("vwSrcCss")) return;
    const s = document.createElement("style");
    s.id = "vwSrcCss";
    s.textContent = `
#vwSrcBtn{cursor:pointer;}
#vwSrcPop{position:fixed;z-index:10050;display:none;min-width:190px;padding:6px;
  background:var(--vw-panel,#14141c);border:1px solid var(--vw-border-strong,#2b2b3a);
  border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.55);}
#vwSrcPop.vw-src-open{display:block;transform-origin:bottom left;
  animation:vwSrcPopIn .18s cubic-bezier(.2,.9,.3,1.15);}
@keyframes vwSrcPopIn{from{opacity:0;transform:translateY(7px) scale(.94);}
  to{opacity:1;transform:none;}}
.vw-src-open .vw-src-row{animation:vwSrcRowIn .22s ease backwards;}
.vw-src-open .vw-src-row:nth-child(2){animation-delay:.04s;}
.vw-src-open .vw-src-row:nth-child(3){animation-delay:.08s;}
.vw-src-open .vw-src-row:nth-child(4){animation-delay:.12s;}
@keyframes vwSrcRowIn{from{opacity:0;transform:translateX(-6px);}
  to{opacity:1;transform:none;}}
.vw-src-row{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:7px;
  cursor:pointer;color:var(--vw-text,#cfcfe0);font-size:13px;white-space:nowrap;user-select:none;}
.vw-src-row:hover{background:var(--vw-hover-strong,rgba(255,255,255,.1));color:var(--vw-text-strong,#fff);}
.vw-src-dot{width:8px;height:8px;border-radius:50%;border:1px solid var(--vw-border,#5a5a70);flex:0 0 auto;}
.vw-src-row.vw-src-active{color:var(--vw-text-strong,#fff);font-weight:600;}
.vw-src-row.vw-src-active .vw-src-dot{background:var(--vw-accent-bg,#e5e7eb);border-color:var(--vw-accent-bg,#e5e7eb);}`;
    document.head.appendChild(s);
  }

  let popOutside = null; // active outside-click/Escape closers

  function srcPop() {
    let p = document.getElementById("vwSrcPop");
    if (!p) {
      p = document.createElement("div");
      p.id = "vwSrcPop";
      OPTIONS.forEach((o) => {
        const row = document.createElement("div");
        row.className = "vw-src-row";
        row.dataset.api = o.api;
        row.title = o.desc;
        const dot = document.createElement("span");
        dot.className = "vw-src-dot";
        const name = document.createElement("span");
        name.textContent = SHORT[o.api] || o.name;
        row.appendChild(dot);
        row.appendChild(name);
        row.addEventListener("click", () => { set(o.api); closePop(); });
        p.appendChild(row);
      });
      document.body.appendChild(p);
    }
    return p;
  }

  function syncPop() {
    const cur = get();
    const p = document.getElementById("vwSrcPop");
    if (!p) return;
    p.querySelectorAll(".vw-src-row").forEach((r) =>
      r.classList.toggle("vw-src-active", r.dataset.api === cur),
    );
  }

  function closePop() {
    const p = document.getElementById("vwSrcPop");
    if (p) p.classList.remove("vw-src-open");
    if (popOutside) {
      document.removeEventListener("mousedown", popOutside.click, true);
      document.removeEventListener("keydown", popOutside.key);
      popOutside = null;
    }
  }

  function openPop(anchor) {
    const p = srcPop();
    syncPop();
    p.classList.add("vw-src-open");
    // Anchor above the button, clamped to the viewport.
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - p.offsetWidth - 8)) + "px";
    p.style.bottom = (window.innerHeight - r.top + 8) + "px";
    popOutside = {
      click: (e) => {
        if (!p.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePop();
      },
      key: (e) => { if (e.key === "Escape") closePop(); },
    };
    document.addEventListener("mousedown", popOutside.click, true);
    document.addEventListener("keydown", popOutside.key);
  }

  function srcBtn() {
    let b = document.getElementById("vwSrcBtn");
    if (!b) {
      srcCSS();
      b = document.createElement("a");
      b.id = "vwSrcBtn";
      b.href = "#";
      b.className = "button";
      b.style.display = "none";
      b.title = "Anime source — click to switch for this episode (and as default)";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        const p = srcPop();
        if (p.classList.contains("vw-src-open")) closePop();
        else openPop(b);
      });
      const controls = document.querySelector(".player-controls");
      const nextBtn = document.getElementById("nextEpisode");
      if (controls) controls.insertBefore(b, nextBtn ? nextBtn.nextSibling : null);
    }
    return b;
  }

  function setSrcLabel() {
    srcBtn().textContent = "⇄ Source: " + SHORT[get()];
  }

  window.addEventListener("vw-anime-embed", (e) => {
    const b = srcBtn();
    if (e.detail && e.detail.active) {
      setSrcLabel();
      b.style.display = "";
    } else {
      b.style.display = "none";
      closePop();
    }
  });
  window.addEventListener("vw-anime-api-changed", () => {
    setSrcLabel();
    syncPop();
  });

  // ── First-run popup ────────────────────────────────────────────────
  const OPTIONS = [
    {
      api: "anikoto",
      name: "Anikoto API",
      desc: "Fastest, though isn't available for all regions/IPs.",
    },
    {
      api: "cloudflare",
      name: "Cloudflare API",
      desc: "Most reliable, though can be slow sometimes and stop working if overused.",
    },
    {
      api: "vidnest",
      name: "Vidnest API",
      desc: "Fast and somewhat reliable, though doesn't have the same library as Anikoto/Cloudflare.",
    },
    {
      api: "vidwish",
      name: "Anikoto — Vidwish mirror",
      desc: "Same library as Anikoto, served through the Vidwish mirror. Use this if Anikoto won't load on your connection (error 232011).",
    },
  ];

  function firstRunPopup() {
    if (localStorage.getItem(KEY)) return; // already chose (or was defaulted)

    const overlay = document.createElement("div");
    overlay.id = "vwApiFirstRun";
    overlay.className = "vws-overlay";

    const modal = document.createElement("div");
    modal.className = "vws-modal vws-api-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Choose your anime API");

    const header = document.createElement("div");
    header.className = "vws-header";
    header.innerHTML =
      '<img src="https://i.ibb.co/FkdMbG4N/virowatch-new-icon-tihngy-cropped.png" alt="" class="vws-logo">' +
      '<div><div class="vws-title">Choose your anime API</div>' +
      '<div class="vws-sub">Virowatch</div></div>';

    const body = document.createElement("div");
    body.className = "vws-body";

    const hint = document.createElement("div");
    hint.className = "vws-api-hint";
    hint.textContent =
      "Pick which source anime episodes load with by default. " +
      "You can change this anytime in Settings, and still switch " +
      "per-episode with the ⇄ Source button under the player.";
    body.appendChild(hint);

    const list = document.createElement("div");
    list.className = "vws-api-list";
    OPTIONS.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vws-api-opt";
      b.dataset.api = o.api;

      const radio = document.createElement("span");
      radio.className = "vws-api-radio";

      const text = document.createElement("span");
      text.className = "vws-api-text";
      const name = document.createElement("span");
      name.className = "vws-api-name";
      name.textContent = o.name;
      const desc = document.createElement("span");
      desc.className = "vws-api-desc";
      desc.textContent = o.desc;
      text.appendChild(name);
      text.appendChild(desc);

      b.appendChild(radio);
      b.appendChild(text);
      b.addEventListener("click", () => choose(o.api));
      list.appendChild(b);
    });
    body.appendChild(list);

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "vws-api-skip";
    skip.textContent = "Skip — use Anikoto (default)";
    skip.addEventListener("click", () => choose("anikoto"));
    body.appendChild(skip);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() {
      overlay.classList.remove("vws-open");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => overlay.remove(), 300); // let the fade finish
    }
    function choose(api) {
      set(api);
      close();
    }
    function onKey(e) {
      if (e.key === "Escape") choose("anikoto");
    }
    // Backdrop click = same as skip: default + never nag again.
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) choose("anikoto");
    });
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => overlay.classList.add("vws-open"));
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireSettings();
    firstRunPopup();
  });
})();
