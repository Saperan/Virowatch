/**
 * comments.js — per-episode comments (AniList accounts)  v3
 *
 * Backed by comments-worker.js (Cloudflare Worker + D1) — WORKER below.
 * Identity: worker verifies the AniList token when AniList allows it, else
 * falls back to the token's JWT payload; mod powers additionally need the
 * ADMIN_KEY secret (localStorage vw_mod_key, prompted in the popup).
 *
 * UI: "💬 Community" button in .player-controls opens a vws-overlay popup.
 *  - Live thread: polls every 2.5s while open, re-rendering only when the
 *    data actually changed; open drafts/focus survive re-renders.
 *  - Replies nest arbitrarily deep (Reddit-style), with per-comment
 *    "Hide/Show replies" collapse and thread guide-lines.
 *  - Sort: Newest / Oldest / Top (top-level only; replies stay oldest-first).
 *  - Votes bump instantly (worker returns the fresh thread on every POST).
 */
(function () {
  "use strict";

  var WORKER = "https://vw-comments.uxlibrary.workers.dev";
  var POLL_MS = 2500;
  var MAX_INDENT = 4; // visual indent cap — deeper replies stop shifting right

  var currentKey = null;
  var comments = [];
  var replyTo = null;        // comment id an open reply box belongs to
  var loading = false;
  var isAdmin = false;       // set from the worker's GET response
  var adminEligible = false; // id on ADMIN_IDS but mod key not entered yet
  var sortMode = localStorage.getItem("vw_cmt_sort") || "new"; // new|old|top
  var collapsed = {};        // comment id → true (hidden replies), per session
  var lastJson = "";         // change detection for the poll loop
  var pollTimer = null;

  function authUser() {
    try { return JSON.parse(localStorage.getItem("vw_anilist") || "null"); }
    catch (_) { return null; }
  }

  function headers(withJson) {
    var h = withJson ? { "Content-Type": "application/json" } : {};
    var a = authUser();
    if (a && a.token) h["Authorization"] = "Bearer " + a.token;
    var mk = localStorage.getItem("vw_mod_key");
    if (mk) h["X-Admin-Key"] = mk;
    return h;
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function timeAgo(ts) {
    var s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.floor(h / 24);
    if (d < 30) return d + "d ago";
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + "mo ago";
    return Math.floor(mo / 12) + "y ago";
  }

  /* ── styles ─────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById("vwCmtCss")) return;
    var s = document.createElement("style");
    s.id = "vwCmtCss";
    s.textContent = `
.vwcmt-modal{display:flex;flex-direction:column;max-height:min(740px,88vh);
  width:min(660px,94vw);}
.vwcmt-body{flex:1 1 auto;overflow-y:auto;padding:12px 18px 16px;
  scrollbar-width:thin;}
@keyframes vwcmtIn{from{opacity:0;transform:translateY(6px);}
  to{opacity:1;transform:none;}}
.vwcmt-anim{animation:vwcmtIn .22s ease both;}
.vwcmt-toolbar{display:flex;align-items:center;justify-content:space-between;
  gap:10px;margin-bottom:12px;flex-wrap:wrap;}
.vwcmt-sorts{display:flex;gap:6px;}
.vwcmt-sort{padding:5px 13px;border-radius:99px;font-size:.75rem;cursor:pointer;
  color:var(--vw-muted-2,#9a9ab0);background:var(--vw-chip-bg,rgba(255,255,255,.06));
  border:1px solid transparent;transition:all .16s ease;}
.vwcmt-sort:hover{color:var(--vw-text-strong,#fff);}
.vwcmt-sort.on{color:var(--vw-text-strong,#fff);font-weight:600;
  border-color:var(--vw-chip-border,rgba(255,255,255,.22));
  background:var(--vw-hover-strong,rgba(255,255,255,.1));}
.vwcmt-login{font-size:.82rem;color:var(--vw-muted-2,#9a9ab0);
  padding:10px 12px;border-radius:12px;margin-bottom:12px;
  background:var(--vw-chip-bg,rgba(255,255,255,.05));
  border:1px solid var(--vw-border,rgba(255,255,255,.08));}
.vwcmt-compose{display:flex;gap:10px;align-items:flex-start;margin:2px 0 14px;}
.vwcmt-compose img{width:34px;height:34px;border-radius:50%;flex:0 0 auto;
  background:rgba(255,255,255,.06);object-fit:cover;}
.vwcmt-box{flex:1;display:flex;flex-direction:column;gap:6px;}
.vwcmt-box textarea{width:100%;min-height:40px;max-height:160px;resize:vertical;
  padding:9px 13px;border-radius:14px;font:inherit;font-size:.85rem;
  background:var(--vw-input-bg,rgba(255,255,255,.07));
  border:1px solid var(--vw-input-border,rgba(255,255,255,.1));
  color:var(--vw-text-strong,#fff);outline:none;
  transition:border-color .16s ease;}
.vwcmt-box textarea:focus{border-color:var(--vw-input-border-focus,rgba(255,255,255,.32));}
.vwcmt-actions{display:flex;gap:8px;justify-content:flex-end;}
.vwcmt-btn{padding:6px 15px;border-radius:99px;font-size:.78rem;cursor:pointer;
  color:var(--vw-text,#cfcfe0);background:var(--vw-chip-bg,rgba(255,255,255,.08));
  border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));
  transition:all .16s ease;}
.vwcmt-btn:hover{color:var(--vw-text-strong,#fff);
  border-color:var(--vw-input-border-focus,rgba(255,255,255,.32));
  background:var(--vw-hover-strong,rgba(255,255,255,.1));}
.vwcmt-btn[disabled]{opacity:.5;cursor:default;}
.vwcmt-node{position:relative;}
.vwcmt-node.thread{border-left:2px solid var(--vw-border,rgba(255,255,255,.08));
  padding-left:14px;margin-left:16px;transition:border-color .16s ease;}
.vwcmt-node.thread:hover{border-left-color:var(--vw-chip-border,rgba(255,255,255,.2));}
.vwcmt-item{display:flex;gap:10px;padding:8px 0;}
.vwcmt-item img{width:32px;height:32px;border-radius:50%;flex:0 0 auto;
  background:rgba(255,255,255,.06);object-fit:cover;}
.vwcmt-main{flex:1;min-width:0;}
.vwcmt-meta{font-size:.75rem;color:var(--vw-muted-2,#9a9ab0);margin-bottom:2px;}
.vwcmt-meta b{color:var(--vw-text-strong,#fff);font-weight:600;margin-right:6px;}
.vwcmt-text{font-size:.85rem;color:var(--vw-text,#cfcfe0);line-height:1.45;
  white-space:pre-wrap;word-break:break-word;}
.vwcmt-bar{display:flex;gap:13px;margin-top:5px;font-size:.75rem;align-items:center;}
.vwcmt-act{background:none;border:none;padding:2px 0;cursor:pointer;
  color:var(--vw-muted-2,#9a9ab0);font-size:.75rem;
  transition:color .14s ease,transform .14s ease;}
.vwcmt-act:hover{color:var(--vw-text-strong,#fff);}
.vwcmt-act:active{transform:scale(.92);}
.vwcmt-act.on{color:var(--vw-accent-bg,#e5e7eb);font-weight:600;}
.vwcmt-act.del:hover{color:#e5566a;}
.vwcmt-fold{background:none;border:none;padding:2px 0;cursor:pointer;
  font-size:.73rem;color:var(--vw-faint,#888);transition:color .14s ease;}
.vwcmt-fold:hover{color:var(--vw-text-strong,#fff);}
.vwcmt-empty{font-size:.82rem;color:var(--vw-muted-2,#9a9ab0);padding:14px 0;
  text-align:center;}
.vwcmt-mod-modal{display:flex;flex-direction:column;max-height:min(680px,86vh);
  width:min(720px,94vw);}
.vwcmt-mod-list{flex:1 1 auto;overflow-y:auto;padding:8px 14px 12px;}
.vwcmt-mod-sect{font-size:.78rem;font-weight:600;color:var(--vw-muted-2,#9a9ab0);
  text-transform:uppercase;letter-spacing:.4px;margin:10px 0 6px;}
.vwcmt-mod-row{display:flex;gap:10px;align-items:flex-start;padding:8px 6px;
  border-radius:10px;transition:background .14s ease;}
.vwcmt-mod-row:hover{background:var(--vw-hover,rgba(255,255,255,.05));}
.vwcmt-mod-row img{width:30px;height:30px;border-radius:50%;flex:0 0 auto;
  background:rgba(255,255,255,.06);object-fit:cover;}
.vwcmt-mod-main{flex:1;min-width:0;}
.vwcmt-mod-meta{font-size:.73rem;color:var(--vw-muted-2,#9a9ab0);}
.vwcmt-mod-meta b{color:var(--vw-text-strong,#fff);margin-right:6px;}
.vwcmt-mod-ep{font-size:.7rem;color:var(--vw-faint,#888);}
.vwcmt-mod-text{font-size:.82rem;color:var(--vw-text,#cfcfe0);
  white-space:pre-wrap;word-break:break-word;}
.vwcmt-mod-acts{display:flex;gap:10px;flex:0 0 auto;}
@media (max-width:700px){.vwcmt-node.thread{margin-left:6px;padding-left:10px;}}`;
    document.head.appendChild(s);
  }

  /* ── API ────────────────────────────────────────────────────────── */
  function api(path, body) {
    var opts = body
      ? { method: "POST", headers: headers(true), body: JSON.stringify(body) }
      : { headers: headers(false) };
    return fetch(WORKER + path, opts).then(function (r) { return r.json(); });
  }

  function takeThread(d) {
    comments = d && d.ok ? d.comments : [];
    isAdmin = !!(d && d.admin);
    adminEligible = !!(d && d.adminEligible);
    lastJson = JSON.stringify(comments);
  }

  function refresh(silent) {
    if (!currentKey) return;
    var key = currentKey;
    if (!silent) { loading = true; renderThread(); }
    api("/comments?key=" + encodeURIComponent(key))
      .then(function (d) {
        if (key !== currentKey) return; // episode changed mid-flight
        var was = lastJson;
        takeThread(d);
        loading = false;
        if (!silent || was !== lastJson) renderThread();
      })
      .catch(function () {
        if (key !== currentKey || silent) return;
        loading = false;
        comments = [];
        renderThread();
      });
  }

  // POST endpoints return the fresh thread — reuse it instead of refetching
  function apply(d) {
    if (d && d.ok && Array.isArray(d.comments)) {
      comments = d.comments;
      lastJson = JSON.stringify(comments);
      renderThread();
    } else if (d && d.error) {
      alert(d.error);
    }
  }

  /* ── Community popup shell ──────────────────────────────────────── */
  var modal = null;

  function ensureModal() {
    if (modal) return;
    css();
    modal = document.createElement("div");
    modal.id = "vwCommunity";
    modal.className = "vws-overlay";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="vws-modal vwcmt-modal" role="dialog" aria-modal="true" aria-label="Community comments">' +
      '<div class="vws-header">' +
      '<div><div class="vws-title">💬 Community</div>' +
      '<div class="vws-sub" id="vwCmtSub"></div></div>' +
      '<button type="button" class="vws-close" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="vwcmt-body" id="vwCmtBody"></div></div>';
    document.body.appendChild(modal);
    modal.querySelector(".vws-close").addEventListener("click", closeModal);
    modal.addEventListener("mousedown", function (e) {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("vws-open")) closeModal();
    });
  }

  function modalOpen() {
    return !!(modal && modal.classList.contains("vws-open"));
  }

  function closeModal() {
    modal.classList.remove("vws-open");
    modal.setAttribute("aria-hidden", "true");
    stopPoll();
  }

  function openModal() {
    if (!currentKey) return;
    ensureModal();
    modal.classList.add("vws-open");
    modal.setAttribute("aria-hidden", "false");
    setSub();
    refresh();      // always fetch fresh on open
    startPoll();    // then keep it live while the popup stays open
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (!modalOpen() || !currentKey) { stopPoll(); return; }
      refresh(true); // silent — only re-renders when the thread changed
    }, POLL_MS);
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function setSub() {
    if (!modal) return;
    var t = document.getElementById("nowPlayingTitle");
    var ep = document.querySelector(".episode.active");
    var label = [
      t && t.textContent ? t.textContent.trim() : "",
      ep && ep.textContent ? ep.textContent.trim() : "",
    ].filter(Boolean).join(" · ");
    modal.querySelector("#vwCmtSub").textContent = label || "Talk about this episode";
  }

  /* ── Community button (player controls, next to ⇄ Source) ───────── */
  function communityBtn() {
    var b = document.getElementById("vwCommunityBtn");
    if (!b) {
      css();
      b = document.createElement("a");
      b.id = "vwCommunityBtn";
      b.href = "#";
      b.className = "button";
      b.style.display = "none";
      b.textContent = "💬 Community";
      b.title = "Comments from other viewers on this episode";
      b.addEventListener("click", function (e) {
        e.preventDefault();
        openModal();
      });
      var controls = document.querySelector(".player-controls");
      if (controls) {
        // right of the ⇄ Source button when it exists, else after Next →
        var src = document.getElementById("vwSrcBtn");
        var next = document.getElementById("nextEpisode");
        var anchor = src || next;
        controls.insertBefore(b, anchor ? anchor.nextSibling : null);
      }
    }
    return b;
  }

  /* ── draft preservation across re-renders ───────────────────────── */
  // The 2.5s poll re-renders the thread; without this, anything typed in an
  // open textarea would vanish. Key: "root" or the parent comment id.
  function collectDrafts() {
    var drafts = {};
    if (!modal) return drafts;
    modal.querySelectorAll("textarea[data-draft-key]").forEach(function (ta) {
      if (ta.value || document.activeElement === ta) {
        drafts[ta.dataset.draftKey] = {
          value: ta.value,
          focus: document.activeElement === ta,
          selStart: ta.selectionStart,
          selEnd: ta.selectionEnd,
        };
      }
    });
    return drafts;
  }

  function restoreDraft(ta, drafts) {
    var d = drafts[ta.dataset.draftKey];
    if (!d) return;
    ta.value = d.value;
    if (d.focus) {
      ta.focus();
      try { ta.setSelectionRange(d.selStart, d.selEnd); } catch (_) {}
    }
  }

  /* ── thread rendering (inside the popup) ────────────────────────── */
  function composer(placeholder, parent, drafts) {
    var wrap = document.createElement("div");
    wrap.className = "vwcmt-compose";
    var a = authUser();
    var img = document.createElement("img");
    img.src = (a && a.avatar) || "";
    img.alt = "";
    var box = document.createElement("div");
    box.className = "vwcmt-box";
    var ta = document.createElement("textarea");
    ta.maxLength = 1000;
    ta.placeholder = placeholder;
    ta.dataset.draftKey = parent ? String(parent) : "root";
    var actions = document.createElement("div");
    actions.className = "vwcmt-actions";
    var send = document.createElement("button");
    send.className = "vwcmt-btn";
    send.textContent = parent ? "Reply" : "Comment";
    send.addEventListener("click", function () {
      var text = ta.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true;
      var me = authUser() || {};
      // name/avatar ride along for the worker's JWT-fallback identity path
      api("/comments", {
        key: currentKey,
        text: text,
        parent: parent || null,
        name: me.name || "",
        avatar: me.avatar || "",
      })
        .then(function (d) { replyTo = null; apply(d); })
        .catch(function () { send.disabled = false; });
    });
    actions.appendChild(send);
    box.appendChild(ta);
    box.appendChild(actions);
    wrap.appendChild(img);
    wrap.appendChild(box);
    if (drafts) restoreDraft(ta, drafts);
    else if (parent) setTimeout(function () { ta.focus(); }, 0);
    return wrap;
  }

  function item(c) {
    var el = document.createElement("div");
    el.className = "vwcmt-item";
    el.innerHTML =
      '<img src="' + esc(c.user.avatar) + '" alt="">' +
      '<div class="vwcmt-main">' +
      '<div class="vwcmt-meta"><b>' + esc(c.user.name) + "</b>" + timeAgo(c.ts) + "</div>" +
      '<div class="vwcmt-text">' + esc(c.text) + "</div>" +
      '<div class="vwcmt-bar"></div>' +
      "</div>";

    var bar = el.querySelector(".vwcmt-bar");
    var loggedIn = !!authUser();

    function voteBtn(dir, glyph, count, on) {
      var b = document.createElement("button");
      b.className = "vwcmt-act" + (on ? " on" : "");
      b.textContent = glyph + (count ? " " + count : "");
      b.title = loggedIn ? "" : "Log in with AniList to vote";
      b.addEventListener("click", function () {
        if (!loggedIn) return;
        api("/vote", { id: c.id, dir: on ? 0 : dir }).then(apply).catch(function () {});
      });
      return b;
    }
    bar.appendChild(voteBtn(1, "👍", c.likes, c.myVote === 1));
    bar.appendChild(voteBtn(-1, "👎", c.dislikes, c.myVote === -1));

    if (loggedIn) {
      var rep = document.createElement("button");
      rep.className = "vwcmt-act";
      rep.textContent = "Reply";
      rep.addEventListener("click", function () {
        replyTo = replyTo === c.id ? null : c.id;
        renderThread();
      });
      bar.appendChild(rep);
    }
    if (c.mine || isAdmin) {
      var del = document.createElement("button");
      del.className = "vwcmt-act del";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        api("/delete", { id: c.id }).then(apply).catch(function () {});
      });
      bar.appendChild(del);
    }
    if (isAdmin && !c.mine) {
      var ban = document.createElement("button");
      ban.className = "vwcmt-act del";
      ban.textContent = "Ban";
      ban.addEventListener("click", function () {
        if (!confirm("Ban " + c.user.name + " from commenting?")) return;
        api("/admin/ban", { userId: c.user.id, name: c.user.name })
          .then(function () { refresh(); })
          .catch(function () {});
      });
      bar.appendChild(ban);
    }
    return el;
  }

  function countReplies(childMap, id) {
    var kids = childMap[id] || [];
    var n = kids.length;
    kids.forEach(function (k) { n += countReplies(childMap, k.id); });
    return n;
  }

  // One comment + its (collapsible) subtree, Reddit-style.
  function renderNode(c, childMap, depth, drafts, animate) {
    var node = document.createElement("div");
    node.className = "vwcmt-node" + (depth > 0 && depth <= MAX_INDENT ? " thread" : depth > 0 ? " thread flat" : "");
    if (animate) node.classList.add("vwcmt-anim");

    node.appendChild(item(c));
    if (replyTo === c.id) node.appendChild(composer("Write a reply…", c.id, drafts));

    var kids = (childMap[c.id] || []).slice()
      .sort(function (a, b) { return a.ts - b.ts; }); // replies oldest-first
    if (kids.length) {
      var total = countReplies(childMap, c.id);
      var fold = document.createElement("button");
      fold.className = "vwcmt-fold";
      var hidden = !!collapsed[c.id];
      fold.textContent = hidden
        ? "▸ Show " + total + (total === 1 ? " reply" : " replies")
        : "▾ Hide replies";
      fold.addEventListener("click", function () {
        collapsed[c.id] = !collapsed[c.id];
        renderThread();
      });
      node.appendChild(fold);
      if (!hidden) {
        var deeper = depth + 1;
        kids.forEach(function (k) {
          node.appendChild(renderNode(k, childMap, deeper, drafts, false));
        });
      }
    }
    return node;
  }

  function sortTop(list) {
    var l = list.slice();
    if (sortMode === "old") l.sort(function (a, b) { return a.ts - b.ts; });
    else if (sortMode === "top") {
      l.sort(function (a, b) {
        return (b.likes - b.dislikes) - (a.likes - a.dislikes) || b.ts - a.ts;
      });
    } else l.sort(function (a, b) { return b.ts - a.ts; });
    return l;
  }

  function renderThread() {
    if (!modal) return;
    var r = modal.querySelector("#vwCmtBody");
    var drafts = collectDrafts();
    var scrollY = r.scrollTop;
    r.innerHTML = "";
    if (!currentKey) return;

    // toolbar: sort chips + (admin) moderation
    var bar = document.createElement("div");
    bar.className = "vwcmt-toolbar";
    var sorts = document.createElement("div");
    sorts.className = "vwcmt-sorts";
    [["new", "Newest"], ["old", "Oldest"], ["top", "Top"]].forEach(function (p) {
      var b = document.createElement("button");
      b.className = "vwcmt-sort" + (sortMode === p[0] ? " on" : "");
      b.textContent = p[1];
      b.addEventListener("click", function () {
        if (sortMode === p[0]) return;
        sortMode = p[0];
        localStorage.setItem("vw_cmt_sort", sortMode);
        renderThread();
      });
      sorts.appendChild(b);
    });
    bar.appendChild(sorts);
    if (isAdmin || adminEligible) {
      var mod = document.createElement("button");
      mod.className = "vwcmt-btn";
      mod.textContent = isAdmin ? "🛡 Moderation" : "🛡 Enter mod key";
      mod.addEventListener("click", isAdmin ? openMod : function () {
        var k = prompt("Moderation key (ADMIN_KEY set on the worker):");
        if (!k) return;
        localStorage.setItem("vw_mod_key", k.trim());
        refresh(); // wrong key → worker keeps adminEligible, button stays
      });
      bar.appendChild(mod);
    }
    r.appendChild(bar);

    if (authUser()) {
      r.appendChild(composer("Share your thoughts on this episode…", null, drafts));
    } else {
      var l = document.createElement("div");
      l.className = "vwcmt-login";
      l.textContent = "Log in with AniList (◍ button in the sidebar) to comment and vote.";
      r.appendChild(l);
    }

    var childMap = {};
    comments.forEach(function (c) {
      if (c.parent) (childMap[c.parent] = childMap[c.parent] || []).push(c);
    });
    var top = sortTop(comments.filter(function (c) { return !c.parent; }));

    if (loading && !comments.length) {
      var ld = document.createElement("div");
      ld.className = "vwcmt-empty";
      ld.textContent = "Loading comments…";
      r.appendChild(ld);
      return;
    }
    if (!top.length) {
      var e = document.createElement("div");
      e.className = "vwcmt-empty";
      e.textContent = "No comments yet — be the first.";
      r.appendChild(e);
      return;
    }

    top.forEach(function (c) {
      r.appendChild(renderNode(c, childMap, 0, drafts, true));
    });
    r.scrollTop = scrollY; // don't yank the reader around on poll re-renders
  }

  /* ── Moderation panel (admins: global feed + bans) ──────────────── */
  var modModal = null;

  function modKeyLabel(ckey) {
    var p = String(ckey || "").split("|"); // cat|mov|season|ep
    var ep = Number(p[3]) || 0;
    return (p[1] || ckey) + (ep ? " — ep " + (ep + 1) : "");
  }

  function ensureModModal() {
    if (modModal) return;
    modModal = document.createElement("div");
    modModal.className = "vws-overlay";
    modModal.setAttribute("aria-hidden", "true");
    modModal.innerHTML =
      '<div class="vws-modal vwcmt-mod-modal" role="dialog" aria-modal="true" aria-label="Comment moderation">' +
      '<div class="vws-header">' +
      '<div><div class="vws-title">🛡 Comment moderation</div>' +
      '<div class="vws-sub" id="vwCmtModSub"></div></div>' +
      '<button type="button" class="vws-close" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="vwcmt-mod-list" id="vwCmtModList"></div></div>';
    document.body.appendChild(modModal);
    modModal.querySelector(".vws-close").addEventListener("click", closeMod);
    modModal.addEventListener("mousedown", function (e) {
      if (e.target === modModal) closeMod();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modModal.classList.contains("vws-open")) closeMod();
    });
  }

  function closeMod() {
    modModal.classList.remove("vws-open");
    modModal.setAttribute("aria-hidden", "true");
  }

  function openMod() {
    ensureModModal();
    modModal.classList.add("vws-open");
    modModal.setAttribute("aria-hidden", "false");
    loadModFeed();
  }

  function loadModFeed() {
    var list = modModal.querySelector("#vwCmtModList");
    list.innerHTML = '<div class="vwcmt-empty">Loading…</div>';
    api("/admin/comments").then(function (d) {
      if (!d || !d.ok) {
        list.innerHTML = '<div class="vwcmt-empty">' + esc((d && d.error) || "failed") + "</div>";
        return;
      }
      modModal.querySelector("#vwCmtModSub").textContent =
        d.comments.length + " recent comments · " + d.banned.length + " banned";
      list.innerHTML = "";

      if (d.banned.length) {
        var bh = document.createElement("div");
        bh.className = "vwcmt-mod-sect";
        bh.textContent = "Banned users";
        list.appendChild(bh);
        d.banned.forEach(function (b) {
          var row = document.createElement("div");
          row.className = "vwcmt-mod-row";
          row.innerHTML =
            '<div class="vwcmt-mod-main"><div class="vwcmt-mod-meta"><b>' +
            esc(b.user_name || b.user_id) + "</b>banned " + timeAgo(b.ts) + "</div></div>";
          var acts = document.createElement("div");
          acts.className = "vwcmt-mod-acts";
          var un = document.createElement("button");
          un.className = "vwcmt-act";
          un.textContent = "Unban";
          un.addEventListener("click", function () {
            api("/admin/unban", { userId: b.user_id })
              .then(loadModFeed).catch(function () {});
          });
          acts.appendChild(un);
          row.appendChild(acts);
          list.appendChild(row);
        });
      }

      var ch = document.createElement("div");
      ch.className = "vwcmt-mod-sect";
      ch.textContent = "All comments (newest first)";
      list.appendChild(ch);
      if (!d.comments.length) {
        var e = document.createElement("div");
        e.className = "vwcmt-empty";
        e.textContent = "Nothing posted yet.";
        list.appendChild(e);
      }
      d.comments.forEach(function (c) {
        var row = document.createElement("div");
        row.className = "vwcmt-mod-row";
        row.innerHTML =
          '<img src="' + esc(c.user_avatar) + '" alt="">' +
          '<div class="vwcmt-mod-main">' +
          '<div class="vwcmt-mod-meta"><b>' + esc(c.user_name) + "</b>" +
          timeAgo(c.ts) + (c.parent ? " · reply" : "") + "</div>" +
          '<div class="vwcmt-mod-ep">' + esc(modKeyLabel(c.ckey)) + "</div>" +
          '<div class="vwcmt-mod-text">' + esc(c.text) + "</div></div>";
        var acts = document.createElement("div");
        acts.className = "vwcmt-mod-acts";
        var del = document.createElement("button");
        del.className = "vwcmt-act del";
        del.textContent = "Delete";
        del.addEventListener("click", function () {
          api("/delete", { id: c.id }).then(loadModFeed).catch(function () {});
        });
        acts.appendChild(del);
        var a = authUser();
        if (!a || a.userId !== c.user_id) {
          var ban = document.createElement("button");
          ban.className = "vwcmt-act del";
          ban.textContent = "Ban";
          ban.addEventListener("click", function () {
            if (!confirm("Ban " + c.user_name + " from commenting?")) return;
            api("/admin/ban", { userId: c.user_id, name: c.user_name })
              .then(loadModFeed).catch(function () {});
          });
          acts.appendChild(ban);
        }
        row.appendChild(acts);
        list.appendChild(row);
      });
    }).catch(function () {
      list.innerHTML = '<div class="vwcmt-empty">Failed to load.</div>';
    });
  }

  /* ── episode tracking ───────────────────────────────────────────── */
  function episodeKey() {
    if (typeof window.vwCurrentEpisodeKey !== "function") return null;
    var k = window.vwCurrentEpisodeKey();
    if (!k) return null;
    return k.split("|").slice(0, 4).join("|"); // drop the dub flag — shared thread
  }

  function onEpisode() {
    var k = episodeKey();
    var btn = communityBtn();
    btn.style.display = k ? "" : "none";
    if (k === currentKey) return;
    currentKey = k;
    comments = [];
    replyTo = null;
    collapsed = {};
    lastJson = "";
    if (modalOpen()) {
      if (k) { setSub(); refresh(); }
      else closeModal();
    }
  }

  window.addEventListener("vw-cw-updated", onEpisode);
  // login/logout via the AniList modal in another tab → refresh composer state
  window.addEventListener("storage", function (e) {
    if (e.key === "vw_anilist" && modalOpen()) refresh();
  });

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(onEpisode, 500); // deep link may already have an episode open
  });
})();
