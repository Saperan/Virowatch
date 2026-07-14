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
 *   - the one-time first-run popup shown while the key is still unset.
 *     Dismissing it without picking saves "anikoto" so it never nags again.
 */
(function () {
  "use strict";

  const KEY = "vw_anime_api";
  const VALID = ["anikoto", "cloudflare", "vidnest"];

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
      "per-episode with the buttons under the player.";
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
