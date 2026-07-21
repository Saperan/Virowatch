/**
 * history.js — full watch history, browsable from Settings.
 *
 * content.js's updateContinueWatching() calls window.vwHistoryAdd(entry)
 * every time an episode starts playing, so unlike the continue-watching
 * rail (one entry per title) this logs every specific episode — anime,
 * movies, TV episodes and IPTV channels alike. Stored in localStorage
 * "vw_watch_history", newest first, deduped per episode (rewatching an
 * episode just bumps it to the top), capped at 1000 rows.
 *
 * UI: a "Watch history" section injected into the #vwSettings popup opens
 * a vws-overlay modal (same shell airing.js/anilist.js use) with a search
 * box (+ ✕ clear-search), the episode list, and a two-click Clear-history
 * button. Rows resume playback via window.viroResume.
 */
(function () {
  "use strict";

  var KEY = "vw_watch_history";
  var CAP = 1000;

  function load() {
    try {
      var l = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(l) ? l : [];
    } catch (_) {
      return [];
    }
  }
  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
    } catch (_) {}
  }

  // One row per specific episode; IPTV dedupes on channel name because
  // the channel's index in the playlist can shift between sessions.
  function idOf(e) {
    return e.live
      ? "live|" + (e.title || "")
      : [e.cat, e.mov, e.season || "", e.ep || 0, e.dubbed ? 1 : 0].join("|");
  }

  window.vwHistoryAdd = function (entry) {
    if (!entry || !entry.mov) return;
    var rec = {
      cat: entry.cat,
      mov: entry.mov,
      season: entry.season || "",
      ep: entry.ep || 0,
      dubbed: !!entry.dubbed,
      title: entry.title || entry.mov,
      image: entry.image || "",
      seasonLabel: entry.seasonLabel || "",
      total: entry.total || 0,
      live: !!entry.live,
      ts: Date.now(),
    };
    var id = idOf(rec);
    var list = load().filter(function (e) { return idOf(e) !== id; });
    list.unshift(rec);
    save(list);
    syncCount();
  };

  /* ── Modal ───────────────────────────────────────────────────────── */

  var modal = null;
  var query = "";

  function css() {
    if (document.getElementById("vwHistCss")) return;
    var s = document.createElement("style");
    s.id = "vwHistCss";
    s.textContent = `
.vwhist-modal{display:flex;flex-direction:column;max-height:min(680px,86vh);}
.vwhist-search{position:relative;margin:12px 16px 4px;flex:0 0 auto;}
.vwhist-search input{width:100%;padding:9px 34px 9px 14px;border-radius:99px;
  background:var(--vw-input-bg,rgba(255,255,255,.07));
  border:1px solid var(--vw-input-border,rgba(255,255,255,.1));
  color:var(--vw-text-strong,#fff);font-size:.85rem;outline:none;}
.vwhist-search input:focus{border-color:var(--vw-input-border-focus,rgba(255,255,255,.3));}
.vwhist-clear{position:absolute;right:12px;top:50%;transform:translateY(-50%);
  display:none;background:none;border:none;color:var(--vw-faint,#888);
  font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.vwhist-clear:hover{color:var(--vw-text-strong,#fff);}
.vwhist-list{flex:1 1 auto;overflow-y:auto;padding:8px 10px 10px;}
.vwhist-row{display:flex;align-items:center;gap:11px;width:100%;text-align:left;
  padding:7px 8px;border-radius:10px;background:none;border:none;cursor:pointer;
  color:var(--vw-text,#cfcfe0);}
.vwhist-row:hover{background:var(--vw-hover,rgba(255,255,255,.06));}
.vwhist-img{width:38px;height:54px;object-fit:cover;border-radius:6px;flex:0 0 auto;
  background:rgba(255,255,255,.05);}
.vwhist-img.hide{visibility:hidden;}
.vwhist-info{min-width:0;display:flex;flex-direction:column;gap:2px;}
.vwhist-title{font-size:.86rem;color:var(--vw-text-strong,#fff);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vwhist-meta{font-size:.72rem;color:var(--vw-muted-2,#9a9ab0);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vwhist-meta .live{color:#e5566a;font-weight:600;}
.vwhist-empty{padding:26px 0;text-align:center;font-size:.82rem;
  color:var(--vw-muted-2,#9a9ab0);}
.vwhist-foot{flex:0 0 auto;display:flex;justify-content:flex-end;
  padding:10px 16px 14px;border-top:1px solid var(--vw-border,rgba(255,255,255,.08));}
.vwhist-wipe{padding:7px 16px;border-radius:99px;font-size:.78rem;cursor:pointer;
  color:var(--vw-text,#cfcfe0);background:var(--vw-chip-bg,rgba(255,255,255,.08));
  border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));}
.vwhist-wipe:hover{border-color:#e5566a;color:#e5566a;}
.vwhist-wipe.arm{background:#e5566a;border-color:#e5566a;color:#fff;font-weight:600;}`;
    document.head.appendChild(s);
  }

  function ensureModal() {
    if (modal) return;
    css();
    modal = document.createElement("div");
    modal.id = "vwHistory";
    modal.className = "vws-overlay";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="vws-modal vwhist-modal" role="dialog" aria-modal="true" aria-label="Watch history">' +
      '<div class="vws-header">' +
      '<div><div class="vws-title">🕘 Watch history</div>' +
      '<div class="vws-sub" id="vwHistSub"></div></div>' +
      '<button type="button" class="vws-close" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="vwhist-search">' +
      '<input type="text" id="vwHistSearch" placeholder="Search history…" />' +
      '<button type="button" class="vwhist-clear" id="vwHistSearchClear" aria-label="Clear search">×</button>' +
      "</div>" +
      '<div class="vwhist-list" id="vwHistList"></div>' +
      '<div class="vwhist-foot">' +
      '<button type="button" class="vwhist-wipe" id="vwHistWipe">Clear history</button>' +
      "</div></div>";
    document.body.appendChild(modal);

    modal.querySelector(".vws-close").addEventListener("click", closeModal);
    modal.addEventListener("mousedown", function (e) {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("vws-open")) closeModal();
    });

    var input = modal.querySelector("#vwHistSearch");
    var clear = modal.querySelector("#vwHistSearchClear");
    input.addEventListener("input", function () {
      query = input.value.trim().toLowerCase();
      clear.style.display = input.value ? "block" : "none";
      renderList();
    });
    clear.addEventListener("click", function () {
      input.value = "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    });

    // Clear-history is destructive — first click arms it, second wipes
    var wipe = modal.querySelector("#vwHistWipe");
    wipe.addEventListener("click", function () {
      if (!wipe.classList.contains("arm")) {
        wipe.classList.add("arm");
        wipe.textContent = "Really clear all? Click again";
        clearTimeout(wipe._t);
        wipe._t = setTimeout(function () { disarm(wipe); }, 3500);
        return;
      }
      clearTimeout(wipe._t);
      save([]);
      disarm(wipe);
      renderList();
      syncCount();
    });
  }

  function disarm(wipe) {
    wipe.classList.remove("arm");
    wipe.textContent = "Clear history";
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var time = d.toTimeString().slice(0, 5);
    if (sameDay) return "Today " + time;
    var yest = new Date(now - 864e5);
    if (d.toDateString() === yest.toDateString()) return "Yesterday " + time;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + time;
  }

  function metaOf(e) {
    var bits = [];
    if (e.seasonLabel) bits.push(e.seasonLabel);
    if (e.live) bits.push("LIVE TV");
    else if (e.total > 1) bits.push("Episode " + ((e.ep || 0) + 1));
    else bits.push("Movie");
    if (e.dubbed) bits.push("Dub");
    bits.push(fmtDate(e.ts));
    return bits;
  }

  function renderList() {
    var holder = modal.querySelector("#vwHistList");
    holder.innerHTML = "";
    var list = load().filter(function (e) {
      if (!query) return true;
      return (
        (e.title || "").toLowerCase().indexOf(query) !== -1 ||
        (e.seasonLabel || "").toLowerCase().indexOf(query) !== -1
      );
    });
    var sub = modal.querySelector("#vwHistSub");
    var total = load().length;
    sub.textContent = query
      ? list.length + " of " + total + " entries"
      : total + " entries · every episode you watched";
    if (!list.length) {
      var p = document.createElement("div");
      p.className = "vwhist-empty";
      p.textContent = query
        ? "Nothing in your history matches that."
        : "Nothing here yet — go watch something!";
      holder.appendChild(p);
      return;
    }
    list.forEach(function (e) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "vwhist-row";
      var img = document.createElement("img");
      img.className = "vwhist-img";
      img.loading = "lazy";
      img.alt = "";
      if (e.image) img.src = e.image;
      else img.classList.add("hide");
      img.onerror = function () { img.classList.add("hide"); };
      var info = document.createElement("span");
      info.className = "vwhist-info";
      var t = document.createElement("span");
      t.className = "vwhist-title";
      t.textContent = e.title || e.mov;
      var m = document.createElement("span");
      m.className = "vwhist-meta";
      metaOf(e).forEach(function (bit, i) {
        if (i) m.appendChild(document.createTextNode(" · "));
        if (bit === "LIVE TV") {
          var b = document.createElement("span");
          b.className = "live";
          b.textContent = bit;
          m.appendChild(b);
        } else m.appendChild(document.createTextNode(bit));
      });
      info.appendChild(t);
      info.appendChild(m);
      row.appendChild(img);
      row.appendChild(info);
      row.addEventListener("click", function () {
        closeModal();
        if (typeof window.viroResume === "function") {
          window.viroResume(e.cat, e.mov, e.season || null, e.ep, e.dubbed);
        }
      });
      holder.appendChild(row);
    });
  }

  function openModal() {
    ensureModal();
    query = "";
    var input = modal.querySelector("#vwHistSearch");
    input.value = "";
    modal.querySelector("#vwHistSearchClear").style.display = "none";
    disarm(modal.querySelector("#vwHistWipe"));
    renderList();
    if (window.vwSettingsClose) window.vwSettingsClose(); // one popup at a time
    modal.classList.add("vws-open");
    modal.setAttribute("aria-hidden", "false");
    input.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("vws-open");
    modal.setAttribute("aria-hidden", "true");
  }

  /* ── Settings section (injected before the Links section) ────────── */

  var countEl = null;

  function syncCount() {
    if (!countEl) return;
    var n = load().length;
    countEl.textContent = n
      ? n + " episodes logged. Click a row to resume it."
      : "Every episode you watch gets logged here.";
  }

  function injectSection() {
    var settings = document.getElementById("vwSettings");
    if (!settings || document.getElementById("vwHistOpenBtn")) return;
    var sections = settings.querySelectorAll(".vws-section");
    var linksSection = null;
    sections.forEach(function (s) {
      var l = s.querySelector(".app-sidebar-theme-label");
      if (l && /^Links$/i.test(l.textContent.trim())) linksSection = s;
    });
    var sec = document.createElement("div");
    sec.className = "vws-section";
    var label = document.createElement("span");
    label.className = "app-sidebar-theme-label";
    label.textContent = "🕘 Watch history";
    countEl = document.createElement("div");
    countEl.className = "vws-api-hint";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "vwHistOpenBtn";
    btn.className = "app-sidebar-import-btn";
    btn.textContent = "Open watch history";
    btn.addEventListener("click", openModal);
    sec.appendChild(label);
    sec.appendChild(countEl);
    sec.appendChild(btn);
    if (linksSection && linksSection.parentNode) {
      linksSection.parentNode.insertBefore(sec, linksSection);
    } else {
      var host = settings.querySelector(".vws-section");
      if (host && host.parentNode) host.parentNode.appendChild(sec);
    }
    syncCount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectSection);
  } else {
    injectSection();
  }
})();
