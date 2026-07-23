/**
 * social.js — friends + DMs + timestamp "clips"  v1
 *
 * Backed by social-worker.js (Cloudflare Worker + D1) — WORKER below.
 * Identity is the AniList login (localStorage vw_anilist), same token the
 * comments feature uses; the worker verifies it.
 *
 * What it adds:
 *  - "👥 Friends" rail button (above AniList) → a vws-overlay modal with
 *    Chats / Friends / Requests / Add People tabs and a DM conversation pane.
 *  - Friend requests to any AniList account (search by username, or add the
 *    person whose profile a clip/comment came from).
 *  - Direct messages: text, GIFs (Giphy search or pasted URL), and "clips" —
 *    a card pinned to an episode + timestamp ("check out 5:25"). Clicking a
 *    clip card opens that episode and seeks straight to the moment.
 *  - "🎬 Send clip" button in the player controls that captures the current
 *    episode + playhead and lets you fire it to a friend with a note.
 *  - Exposes window.vwPlayEpisodeAt(key, t) / window.vwSeekTo(t) — reused by
 *    comments.js for its clickable timestamp chips.
 *
 * Load after content.js / anilist.js (needs viroResume + the AniList login):
 *   <script src="social.js?v=1"></script>
 */
(function () {
  "use strict";

  var WORKER = "https://vw-social.uxlibrary.workers.dev";
  var GIPHY_KEY = "9f7K5hb1Q9Dpz7TvxOwHglQAsyIVyTi9"; // Virowatch Giphy app key
  var GIF_FAVS_KEY = "vw_gif_favs";
  var POLL_OPEN_MS = 3000;   // conversation poll while the chat is open
  var POLL_IDLE_MS = 25000;  // background inbox poll for the unread badge

  /* ── state ──────────────────────────────────────────────────────── */
  var me = null;             // { id, name, avatar }
  var data = { friends: [], incoming: [], outgoing: [] };
  var threadList = [];       // 1:1 inbox summaries
  var groupList = [];        // group chats I'm in (from /groups)
  var active = null;         // open conversation: a friend user, or a group ({_group:true})
  var messages = [];
  var tab = "chats";         // chats | friends | requests | add
  var lastMsgJson = "";
  var convTimer = null;
  var idleTimer = null;
  var pendingClip = null;    // clip staged by "🎬 Send clip", awaiting a target
  var replyingTo = null;     // message being replied to (composer reply bar)

  function authUser() {
    try { return JSON.parse(localStorage.getItem("vw_anilist") || "null"); }
    catch (_) { return null; }
  }
  function loggedIn() {
    var a = authUser();
    return !!(a && a.token && a.userId);
  }

  function headers(withJson) {
    var h = withJson ? { "Content-Type": "application/json" } : {};
    var a = authUser();
    if (a && a.token) h["Authorization"] = "Bearer " + a.token;
    // ride our own identity along so the worker's JWT-fallback path (AniList
    // 403s Cloudflare workers) caches us with the real name/avatar, not the
    // "AniList user" placeholder — works on GET too, unlike a request body.
    if (a && a.name) h["X-VW-Name"] = encodeURIComponent(a.name);
    if (a && a.avatar) h["X-VW-Avatar"] = encodeURIComponent(a.avatar);
    return h;
  }

  function api(path, body) {
    var opts = body
      ? { method: "POST", headers: headers(true), body: JSON.stringify(body) }
      : { headers: headers(false) };
    return fetch(WORKER + path, opts).then(function (r) { return r.json(); });
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  /* ── Twemoji (Discord-style emoji images) ───────────────────────── */
  var TWEMOJI_BASE = "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/";
  // matches emoji (pictographic + ZWJ sequences, skin tones, keycaps, VS16)
  // matches emoji (pictographic + ZWJ sequences, skin tones, keycaps, flags)
  var EMOJI_RE = /(\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic})*)|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]️?⃣/gu;
  function twCodePoint(str) {
    var pts = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      pts.push(c.toString(16));
      if (c > 0xffff) i++; // surrogate pair consumed two units
    }
    return pts.join("-");
  }
  function twFile(emoji) {
    // twemoji strips U+FE0F except inside ZWJ sequences (keeps them there)
    var s = emoji.indexOf("‍") < 0 ? emoji.replace(/️/g, "") : emoji;
    return twCodePoint(s);
  }
  function twImg(emoji) {
    return '<img class="vwsoc-tw" draggable="false" alt="' + esc(emoji) +
      '" src="' + TWEMOJI_BASE + twFile(emoji) + '.png" ' +
      "onerror=\"this.replaceWith(document.createTextNode(this.alt))\">";
  }
  // replace emoji in an HTML string with twemoji <img>, skipping inside tags
  function twemojify(html) {
    return String(html).replace(/(<[^>]+>)|([^<]+)/g, function (_, tag, text) {
      if (tag) return tag;
      return text.replace(EMOJI_RE, function (e) { return twImg(e); });
    });
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = h ? (m < 10 ? "0" + m : m) : m;
    return (h ? h + ":" : "") + mm + ":" + (s < 10 ? "0" + s : s);
  }

  function timeAgo(ts) {
    var s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    var d = Math.floor(h / 24);
    if (d < 30) return d + "d";
    return Math.floor(d / 30) + "mo";
  }

  /* ── playback bridge: open an episode key and seek to a timestamp ── */
  // key = "cat|mov|season|ep|dub" (window.vwCurrentEpisodeKey format).
  function findNativeVideo() {
    var ids = ["viroBackupPlayer", "vidnestDirectPlayer"];
    for (var i = 0; i < ids.length; i++) {
      var v = document.getElementById(ids[i]);
      if (v && v.offsetParent !== null) return v;
    }
    return null;
  }

  window.vwSeekTo = function (t, tries) {
    t = Number(t) || 0;
    if (t <= 0) return;
    tries = tries == null ? 80 : tries; // ~20s at 250ms
    var v = findNativeVideo();
    if (v && v.readyState >= 1 && (!v.duration || t < v.duration + 2)) {
      try { v.currentTime = t; if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } } catch (_) {}
      return;
    }
    if (tries <= 0) {
      toast("Loaded — jump to " + fmtClock(t) + " manually (this source can't auto-seek).");
      return;
    }
    setTimeout(function () { window.vwSeekTo(t, tries - 1); }, 250);
  };

  window.vwPlayEpisodeAt = function (key, t) {
    if (typeof window.viroResume !== "function") return false;
    var p = String(key || "").split("|"); // cat|mov|season|ep|dub
    if (p.length < 2) return false;
    var cat = p[0], mov = p[1], season = p[2] || null, ep = Number(p[3]) || 0;
    var dub = p[4] === "1";
    // already on this exact episode? just seek.
    var cur = typeof window.vwCurrentEpisodeKey === "function"
      ? window.vwCurrentEpisodeKey() : null;
    var sameEp = cur && cur.split("|").slice(0, 4).join("|") === p.slice(0, 4).join("|");
    Promise.resolve(sameEp ? true : window.viroResume(cat, mov, season, ep, dub))
      .then(function (ok) {
        if (ok !== false && t > 0) setTimeout(function () { window.vwSeekTo(t); }, sameEp ? 0 : 600);
        else if (ok === false) toast("That episode isn't available on your current source.");
      })
      .catch(function () { toast("Couldn't open that clip."); });
    return true;
  };

  // Build a shareable ?play=… URL (for copy-link) from an episode key + t.
  window.vwClipLink = function (key, t) {
    var p = String(key || "").split("|");
    var cat = p[0], mov = p[1], season = p[2] || "", ep = (Number(p[3]) || 0) + 1;
    var dub = p[4] === "1";
    var qs = "";
    if (cat === "movies") qs = "play=" + encodeURIComponent(mov);
    else if (cat === "shows") qs = "play=" + encodeURIComponent(mov) + "&sk=" + encodeURIComponent(season || "S1") + "&ep=" + ep;
    else if (cat === "anime") qs = "play=" + encodeURIComponent(mov) + "&ep=" + ep;
    else return location.origin + location.pathname;
    if (dub) qs += "&dub=1";
    if (t > 0) qs += "&t=" + Math.floor(t);
    return location.origin + location.pathname + "?" + qs;
  };

  /* ── current-episode snapshot for staging a clip ────────────────── */
  function currentClip() {
    var key = typeof window.vwCurrentEpisodeKey === "function"
      ? window.vwCurrentEpisodeKey() : null;
    if (!key) return null;
    var p = key.split("|"); // cat|mov|season|ep|dub
    var v = findNativeVideo();
    var t = v && v.currentTime ? Math.floor(v.currentTime) : 0;
    var titleEl = document.getElementById("nowPlayingTitle");
    var title = (titleEl && titleEl.textContent.trim()) || "";
    var epEl = document.querySelector(".episode.active");
    var epLabel = (epEl && epEl.textContent.trim()) || "";
    var thumb = "";
    // The player has no poster element, so pull the show's poster + title from
    // the continue-watching cache (same cat|mov). This is what makes the clip
    // card actually show WHICH show/episode it's from.
    try {
      var cw = JSON.parse(localStorage.getItem("vw_continue") || "[]");
      for (var i = 0; i < cw.length; i++) {
        if (cw[i] && cw[i].cat === p[0] && cw[i].mov === p[1]) {
          if (!title) title = cw[i].title || "";
          thumb = cw[i].image || "";
          if (!epLabel) {
            var n = (Number(p[3]) || 0) + 1;
            epLabel = (cw[i].seasonLabel ? cw[i].seasonLabel + " · " : "") + "Episode " + n;
          }
          break;
        }
      }
    } catch (_) {}
    if (!epLabel) epLabel = "Episode " + ((Number(p[3]) || 0) + 1);
    if (!title) title = "Shared clip";
    return { key: key, t: t, title: title, epLabel: epLabel, thumb: thumb };
  }

  /* ── toast (shared #vwl-toast pill) ─────────────────────────────── */
  function toast(msg, isError) {
    var t = document.getElementById("vwl-toast");
    if (!t) { t = document.createElement("div"); t.id = "vwl-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.borderColor = isError ? "rgba(255,80,80,.4)" : "";
    t.className = "vwl-show";
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.className = ""; t.style.borderColor = ""; }, 3200);
  }

  /* ── styles ─────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById("vwSocialCss")) return;
    var s = document.createElement("style");
    s.id = "vwSocialCss";
    s.textContent = `
.vwsoc-modal{display:flex;flex-direction:column;width:min(860px,95vw);
  height:min(680px,88vh);}
.vwsoc-wrap{flex:1 1 auto;display:flex;min-height:0;}
.vwsoc-side{width:290px;flex:0 0 auto;display:flex;flex-direction:column;
  border-right:1px solid var(--vw-border,rgba(255,255,255,.08));min-height:0;}
.vwsoc-tabs{display:flex;gap:4px;padding:10px 12px 8px;flex-wrap:wrap;}
.vwsoc-tab{padding:5px 11px;border-radius:99px;font-size:.74rem;cursor:pointer;
  color:var(--vw-muted-2,#9a9ab0);background:var(--vw-chip-bg,rgba(255,255,255,.06));
  border:1px solid transparent;transition:all .16s ease;position:relative;}
.vwsoc-tab:hover{color:var(--vw-text-strong,#fff);}
.vwsoc-tab.on{color:var(--vw-text-strong,#fff);font-weight:600;
  border-color:var(--vw-chip-border,rgba(255,255,255,.22));
  background:var(--vw-hover-strong,rgba(255,255,255,.1));}
.vwsoc-dot{position:absolute;top:2px;right:2px;min-width:15px;height:15px;
  padding:0 3px;border-radius:99px;background:#e5566a;color:#fff;font-size:.6rem;
  font-weight:700;display:flex;align-items:center;justify-content:center;}
.vwsoc-list{flex:1 1 auto;overflow-y:auto;padding:4px 8px 10px;
  scrollbar-width:thin;scrollbar-color:var(--vw-border-strong,rgba(255,255,255,.15)) transparent;}
.vwsoc-list::-webkit-scrollbar{width:4px;}
.vwsoc-list::-webkit-scrollbar-thumb{background:var(--vw-border-strong,rgba(255,255,255,.15));border-radius:2px;}
.vwsoc-row{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:12px;
  cursor:pointer;transition:background .14s ease;}
.vwsoc-row:hover{background:var(--vw-hover,rgba(255,255,255,.05));}
.vwsoc-row.on{background:var(--vw-hover-strong,rgba(255,255,255,.1));}
.vwsoc-av{width:38px;height:38px;border-radius:50%;flex:0 0 auto;object-fit:cover;
  background:rgba(255,255,255,.08);}
.vwsoc-rmain{flex:1;min-width:0;}
.vwsoc-rname{font-size:.85rem;color:var(--vw-text-strong,#fff);font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vwsoc-rsub{font-size:.74rem;color:var(--vw-muted-2,#9a9ab0);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}
.vwsoc-rbadge{min-width:17px;height:17px;padding:0 5px;border-radius:99px;
  background:#e5566a;color:#fff;font-size:.66rem;font-weight:700;display:flex;
  align-items:center;justify-content:center;flex:0 0 auto;}
.vwsoc-mini{padding:4px 9px;border-radius:99px;font-size:.72rem;cursor:pointer;
  color:var(--vw-text,#cfcfe0);background:var(--vw-chip-bg,rgba(255,255,255,.08));
  border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));transition:all .14s ease;}
.vwsoc-mini:hover{color:var(--vw-text-strong,#fff);background:var(--vw-hover-strong,rgba(255,255,255,.12));}
.vwsoc-mini.danger:hover{color:#e5566a;border-color:rgba(229,86,106,.4);}
.vwsoc-mini.go{background:#3d5afe;color:#fff;border-color:transparent;}
.vwsoc-mini.go:hover{background:#4d68ff;color:#fff;}
.vwsoc-acts{display:flex;gap:6px;flex:0 0 auto;}
.vwsoc-search{width:100%;padding:9px 13px;border-radius:12px;font:inherit;font-size:.84rem;
  background:var(--vw-input-bg,rgba(255,255,255,.07));
  border:1px solid var(--vw-input-border,rgba(255,255,255,.1));
  color:var(--vw-text-strong,#fff);outline:none;margin:2px 2px 8px;box-sizing:border-box;width:calc(100% - 4px);}
.vwsoc-search:focus{border-color:var(--vw-input-border-focus,rgba(255,255,255,.32));}
.vwsoc-empty{font-size:.8rem;color:var(--vw-muted-2,#9a9ab0);padding:18px 12px;text-align:center;line-height:1.5;}
.vwsoc-conv{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;}
.vwsoc-conv-head{display:flex;align-items:center;gap:10px;padding:12px 16px;
  border-bottom:1px solid var(--vw-border,rgba(255,255,255,.08));}
.vwsoc-conv-head .vwsoc-av{width:32px;height:32px;}
.vwsoc-conv-titles{flex:1;min-width:0;}
.vwsoc-conv-name{font-size:.9rem;font-weight:600;color:var(--vw-text-strong,#fff);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vwsoc-conv-sub{font-size:.72rem;color:var(--vw-muted-2,#9a9ab0);}
.vwsoc-groupav{display:inline-flex;align-items:center;justify-content:center;overflow:hidden;
  color:var(--vw-muted-2,#9a9ab0);}
.vwsoc-groupav img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
.vwsoc-groupav svg{width:60%;height:60%;}
.vwsoc-grouprow .vwsoc-av{border-radius:9px;}
.vwsoc-newgroup{width:calc(100% - 4px);margin:2px 2px 8px;padding:9px 12px;border-radius:12px;
  font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;color:var(--vw-text-strong,#fff);
  background:var(--vw-hover,rgba(255,255,255,.06));border:1px dashed var(--vw-chip-border,rgba(255,255,255,.22));
  transition:all .14s ease;}
.vwsoc-newgroup:hover{background:var(--vw-hover-strong,rgba(255,255,255,.1));border-style:solid;}
.vwsoc-sender{display:flex;align-items:center;gap:6px;margin:5px 0 -3px;font-size:.72rem;
  color:var(--vw-muted-2,#9a9ab0);font-weight:600;align-self:flex-start;}
.vwsoc-sender img{width:18px;height:18px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.08);}
.vwsoc-gcbody{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;padding:12px 16px;overflow-y:auto;min-height:0;}
.vwsoc-gchint{font-size:.78rem;color:var(--vw-muted-2,#9a9ab0);}
.vwsoc-gclist{display:flex;flex-direction:column;gap:2px;}
.vwsoc-gcrow{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:10px;cursor:pointer;
  transition:background .14s ease;}
.vwsoc-gcrow:hover{background:var(--vw-hover,rgba(255,255,255,.05));}
.vwsoc-gcrow .vwsoc-av{width:32px;height:32px;}
.vwsoc-gcrow input{accent-color:#3d5afe;width:16px;height:16px;flex:0 0 auto;}
.vwsoc-msgs{flex:1 1 auto;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px;
  scrollbar-width:thin;scrollbar-color:var(--vw-border-strong,rgba(255,255,255,.15)) transparent;}
.vwsoc-msgs::-webkit-scrollbar{width:4px;}
.vwsoc-msgs::-webkit-scrollbar-thumb{background:var(--vw-border-strong,rgba(255,255,255,.15));border-radius:2px;}
.vwsoc-bub{max-width:74%;padding:8px 13px;border-radius:16px;font-size:.85rem;line-height:1.45;
  word-break:break-word;white-space:pre-wrap;align-self:flex-start;
  background:rgba(128,128,128,.18);color:var(--vw-text,#cfcfe0);}
.vwsoc-bub.mine{align-self:flex-end;background:#3d5afe;color:#fff;}
.vwsoc-bub a{color:inherit;text-decoration:underline;}
.vwsoc-h1,.vwsoc-h2,.vwsoc-h3{font-weight:700;margin:3px 0;line-height:1.25;}
.vwsoc-h1{font-size:1.35rem;}
.vwsoc-h2{font-size:1.15rem;}
.vwsoc-h3{font-size:1rem;}
.vwsoc-bub s{opacity:.85;}
.vwsoc-quote{border-left:3px solid var(--vw-chip-border,rgba(255,255,255,.35));
  padding:1px 0 1px 9px;margin:2px 0;opacity:.9;}
.vwsoc-code{font-family:ui-monospace,Consolas,monospace;font-size:.82em;
  background:rgba(0,0,0,.28);padding:1px 5px;border-radius:5px;}
.vwsoc-bub.mine .vwsoc-code,.vwsoc-bub.mine .vwsoc-pre{background:rgba(0,0,0,.3);}
.vwsoc-pre{font-family:ui-monospace,Consolas,monospace;font-size:.82em;
  background:rgba(0,0,0,.28);padding:8px 11px;border-radius:9px;margin:4px 0;
  white-space:pre-wrap;word-break:break-word;overflow-x:auto;}
.vwsoc-spoiler{background:rgba(10,10,14,.92);color:transparent;border-radius:4px;
  cursor:pointer;padding:0 2px;transition:color .1s ease,background .1s ease;}
.vwsoc-spoiler.on{background:rgba(255,255,255,.14);color:inherit;}
.vwsoc-bub img.gif{max-width:220px;border-radius:12px;display:block;}
.vwsoc-time{font-size:.64rem;opacity:.6;margin-top:3px;}
.vwsoc-clip{width:290px;max-width:82%;flex:0 0 auto;align-self:flex-start;box-sizing:border-box;
  border-radius:16px;overflow:hidden;cursor:pointer;
  background:var(--vw-chip-bg,rgba(255,255,255,.08));border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));
  transition:border-color .16s ease,transform .16s ease;}
.vwsoc-clip.mine{align-self:flex-end;}
.vwsoc-clip:hover{border-color:var(--vw-input-border-focus,rgba(255,255,255,.4));transform:translateY(-1px);}
.vwsoc-clip-thumb{position:relative;width:100%;aspect-ratio:16/9;background:#000 center/cover;}
.vwsoc-clip-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:2rem;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.6);}
.vwsoc-clip-t{position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,.75);color:#fff;
  font-size:.7rem;font-weight:600;padding:2px 7px;border-radius:8px;}
.vwsoc-clip-meta{padding:8px 12px;}
.vwsoc-clip-title{font-size:.82rem;font-weight:600;color:var(--vw-text-strong,#fff);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vwsoc-clip-ep{font-size:.72rem;color:var(--vw-muted-2,#9a9ab0);}
.vwsoc-clip-note{padding:0 12px 9px;font-size:.82rem;color:var(--vw-text,#cfcfe0);white-space:pre-wrap;word-break:break-word;}
.vwsoc-compose{display:flex;gap:8px;align-items:flex-end;padding:10px 14px;
  border-top:1px solid var(--vw-border,rgba(255,255,255,.08));}
.vwsoc-compose textarea{flex:1;min-height:38px;max-height:120px;resize:none;padding:9px 13px;
  border-radius:16px;font:inherit;font-size:.85rem;background:var(--vw-input-bg,rgba(255,255,255,.07));
  border:1px solid var(--vw-input-border,rgba(255,255,255,.1));color:var(--vw-text-strong,#fff);outline:none;}
.vwsoc-compose textarea:focus{border-color:var(--vw-input-border-focus,rgba(255,255,255,.32));}
.vwsoc-ibtn{flex:0 0 auto;width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:1.05rem;
  display:flex;align-items:center;justify-content:center;color:var(--vw-text,#cfcfe0);
  background:var(--vw-chip-bg,rgba(255,255,255,.08));border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));
  transition:all .14s ease;}
.vwsoc-ibtn:hover{color:var(--vw-text-strong,#fff);background:var(--vw-hover-strong,rgba(255,255,255,.12));}
.vwsoc-staged{margin:0 14px 8px;padding:8px 10px;border-radius:12px;display:flex;gap:10px;align-items:center;
  background:var(--vw-hover,rgba(255,255,255,.06));border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));}
.vwsoc-staged img{width:54px;height:32px;object-fit:cover;border-radius:6px;background:#000;flex:0 0 auto;}
.vwsoc-staged-main{flex:1;min-width:0;font-size:.76rem;color:var(--vw-text,#cfcfe0);}
.vwsoc-staged-main b{color:var(--vw-text-strong,#fff);}
.vwsoc-gifpop{position:absolute;bottom:64px;left:14px;right:14px;max-height:340px;background:var(--vw-panel,#1a1a24);
  border:1px solid var(--vw-chip-border,rgba(255,255,255,.18));border-radius:14px;padding:10px;z-index:5;
  display:flex;flex-direction:column;gap:8px;box-shadow:0 12px 40px rgba(0,0,0,.5);}
.vwsoc-giftabs{display:flex;gap:6px;align-items:center;}
.vwsoc-gifgrid{overflow-y:auto;overflow-x:hidden;column-count:2;column-gap:6px;
  scrollbar-width:thin;scrollbar-color:var(--vw-border-strong,rgba(255,255,255,.15)) transparent;}
.vwsoc-gifgrid::-webkit-scrollbar{width:5px;}
.vwsoc-gifgrid::-webkit-scrollbar-thumb{background:var(--vw-border-strong,rgba(255,255,255,.15));border-radius:3px;}
.vwsoc-gifgrid .vwsoc-empty{column-span:all;}
.vwsoc-giftile{position:relative;break-inside:avoid;margin:0 0 6px;border-radius:8px;overflow:hidden;
  background:rgba(255,255,255,.05);cursor:pointer;display:block;}
.vwsoc-giftile img{width:100%;height:auto;display:block;cursor:pointer;}
.vwsoc-giftile:hover{outline:2px solid var(--vw-input-border-focus,rgba(255,255,255,.5));outline-offset:-2px;}
.vwsoc-fav{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;cursor:pointer;
  border:none;background:rgba(0,0,0,.55);color:rgba(255,255,255,.55);font-size:.8rem;line-height:1;
  display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .12s,color .12s;}
.vwsoc-giftile:hover .vwsoc-fav{opacity:1;}
.vwsoc-fav.on{opacity:1;color:#ffcf3d;}
.vwsoc-emojipop{position:absolute;bottom:64px;left:14px;width:320px;max-width:calc(100% - 28px);
  max-height:230px;overflow-y:auto;background:var(--vw-panel,#1a1a24);
  border:1px solid var(--vw-chip-border,rgba(255,255,255,.18));border-radius:14px;padding:8px;z-index:6;
  display:grid;grid-template-columns:repeat(8,1fr);gap:2px;box-shadow:0 12px 40px rgba(0,0,0,.5);}
.vwsoc-emoji{background:none;border:none;cursor:pointer;line-height:0;padding:5px;
  border-radius:8px;transition:background .12s;display:flex;align-items:center;justify-content:center;}
.vwsoc-emoji img{width:26px;height:26px;}
.vwsoc-emoji:hover{background:var(--vw-hover-strong,rgba(255,255,255,.12));}
.vwsoc-tw{width:1.35em;height:1.35em;vertical-align:-0.28em;margin:0 .02em;}
.vwsoc-emoji-only .vwsoc-tw{width:2em;height:2em;}
/* ⋯ message menu button */
.vwsoc-canmenu{position:relative;}
.vwsoc-msgmenu{position:absolute;top:2px;right:4px;width:22px;height:22px;border-radius:6px;border:none;
  cursor:pointer;background:var(--vw-panel,rgba(20,20,26,.92));color:var(--vw-text,#cfcfe0);
  font-size:1rem;line-height:1;display:flex;align-items:center;justify-content:center;z-index:3;
  opacity:0;transition:opacity .12s,background .12s;box-shadow:0 1px 5px rgba(0,0,0,.4);}
.vwsoc-canmenu:hover .vwsoc-msgmenu{opacity:1;}
.vwsoc-msgmenu:hover{background:var(--vw-hover-strong,rgba(255,255,255,.16));color:var(--vw-text-strong,#fff);}
.vwsoc-clip .vwsoc-msgmenu{top:6px;right:6px;}
.vwsoc-ctx{position:fixed;min-width:140px;background:var(--vw-panel,#1a1a24);border-radius:10px;z-index:100000;
  border:1px solid var(--vw-chip-border,rgba(255,255,255,.16));box-shadow:0 10px 34px rgba(0,0,0,.5);
  padding:5px;display:flex;flex-direction:column;gap:2px;}
.vwsoc-ctx-item{background:none;border:none;text-align:left;padding:8px 11px;border-radius:7px;cursor:pointer;
  font:inherit;font-size:.84rem;color:var(--vw-text,#cfcfe0);transition:background .12s,color .12s;}
.vwsoc-ctx-item:hover{background:var(--vw-hover-strong,rgba(255,255,255,.1));color:var(--vw-text-strong,#fff);}
.vwsoc-ctx-item.danger:hover{color:#e5566a;}
/* reply reference above a message */
.vwsoc-replyref{align-self:flex-start;max-width:74%;font-size:.74rem;color:var(--vw-muted-2,#9a9ab0);
  padding:2px 4px 0 12px;margin-bottom:-4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  border-left:2px solid var(--vw-chip-border,rgba(255,255,255,.25));border-radius:2px;}
.vwsoc-replyref.mine{align-self:flex-end;}
.vwsoc-replyref-n{color:var(--vw-text-strong,#fff);font-weight:600;}
.vwsoc-replyref .vwsoc-tw{width:1em;height:1em;vertical-align:-0.15em;}
/* composer reply bar */
.vwsoc-replybar{display:flex;align-items:center;gap:8px;margin:0 14px 6px;padding:7px 8px 7px 12px;
  border-radius:10px;background:var(--vw-hover,rgba(255,255,255,.06));
  border-left:3px solid #3d5afe;}
.vwsoc-replybar-txt{flex:1;min-width:0;font-size:.78rem;color:var(--vw-muted-2,#9a9ab0);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vwsoc-replybar-txt b{color:var(--vw-text-strong,#fff);}
.vwsoc-replybar .vwsoc-tw{width:1em;height:1em;vertical-align:-0.15em;}
.vwsoc-conv-empty{flex:1;display:flex;align-items:center;justify-content:center;
  color:var(--vw-muted-2,#9a9ab0);font-size:.85rem;text-align:center;padding:24px;line-height:1.6;}
@media (max-width:720px){.vwsoc-side{width:100%;}.vwsoc-modal.show-conv .vwsoc-side{display:none;}
  .vwsoc-modal:not(.show-conv) .vwsoc-conv{display:none;}}
`;
    document.head.appendChild(s);
  }

  /* ── rail button + unread badge ─────────────────────────────────── */
  function railBtn() {
    var b = document.getElementById("railSocialBtn");
    if (b) return b;
    var anchor = document.getElementById("railAniListBtn");
    if (!anchor) return null;
    b = document.createElement("button");
    b.id = "railSocialBtn";
    b.className = "rail-item";
    b.type = "button";
    b.title = "Friends & messages";
    b.innerHTML =
      '<span class="icon" id="railSocialIcon">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" width="16" height="16" ' +
      'style="vertical-align:middle;"><circle cx="9" cy="8" r="3.1"/>' +
      '<path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>' +
      '<path d="M16 5.3a2.9 2.9 0 0 1 0 5.4"/>' +
      '<path d="M17.6 14.1c2.3.4 3.9 2.3 3.9 4.9"/></svg></span>' +
      '<span class="rail-label">Friends</span>' +
      '<span id="railSocialBadge" class="vwsoc-rbadge" style="display:none;margin-left:auto;"></span>';
    anchor.parentNode.insertBefore(b, anchor);
    b.addEventListener("click", openModal);
    return b;
  }

  function totalUnread() {
    var n = 0;
    threadList.forEach(function (t) { n += t.unread || 0; });
    groupList.forEach(function (g) { n += g.unread || 0; });
    return n;
  }
  function pendingReqs() { return data.incoming.length; }

  function updateBadge() {
    var badge = document.getElementById("railSocialBadge");
    if (!badge) return;
    var n = totalUnread() + pendingReqs();
    badge.textContent = n > 99 ? "99+" : n;
    badge.style.display = n ? "" : "none";
  }

  /* ── modal shell ────────────────────────────────────────────────── */
  var modal = null;

  function ensureModal() {
    if (modal) return;
    css();
    modal = document.createElement("div");
    modal.id = "vwSocial";
    modal.className = "vws-overlay";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="vws-modal vwsoc-modal" role="dialog" aria-modal="true" aria-label="Friends and messages">' +
      '<div class="vws-header">' +
      '<div><div class="vws-title">👥 Friends</div>' +
      '<div class="vws-sub" id="vwsocSub">Chat and share clips with other AniList users</div></div>' +
      '<button type="button" class="vws-close" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="vwsoc-wrap">' +
      '<div class="vwsoc-side">' +
      '<div class="vwsoc-tabs" id="vwsocTabs"></div>' +
      '<div class="vwsoc-list" id="vwsocSideList"></div>' +
      "</div>" +
      '<div class="vwsoc-conv" id="vwsocConv"></div>' +
      "</div></div>";
    document.body.appendChild(modal);
    modal.querySelector(".vws-close").addEventListener("click", closeModal);
    modal.addEventListener("mousedown", function (e) {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("vws-open")) closeModal();
    });
  }

  function modalOpen() { return !!(modal && modal.classList.contains("vws-open")); }

  function openModal() {
    if (window.vwSettingsClose) window.vwSettingsClose();
    if (!loggedIn()) {
      toast("Log in with AniList (◍ button) to use friends & messages.", true);
      return;
    }
    ensureModal();
    modal.classList.add("vws-open");
    modal.setAttribute("aria-hidden", "false");
    refreshAll();
    startConvPoll();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("vws-open");
    modal.setAttribute("aria-hidden", "true");
    stopConvPoll();
  }

  /* ── data refresh ───────────────────────────────────────────────── */
  function refreshAll() {
    if (!loggedIn()) return;
    api("/me").then(function (d) { if (d && d.ok) me = d.user; }).catch(function () {});
    Promise.all([
      api("/friends").catch(function () { return null; }),
      api("/threads").catch(function () { return null; }),
      api("/groups").catch(function () { return null; }),
    ]).then(function (res) {
      if (res[0] && res[0].ok) data = { friends: res[0].friends, incoming: res[0].incoming, outgoing: res[0].outgoing };
      if (res[1] && res[1].ok) threadList = res[1].threads;
      if (res[2] && res[2].ok) groupList = res[2].groups;
      updateBadge();
      if (modalOpen()) { renderTabs(); renderSide(); }
    });
  }

  /* ── tabs + side list ───────────────────────────────────────────── */
  function renderTabs() {
    var wrap = modal.querySelector("#vwsocTabs");
    wrap.innerHTML = "";
    var defs = [
      ["chats", "Chats"],
      ["friends", "Friends"],
      ["requests", "Requests"],
      ["add", "Add People"],
    ];
    defs.forEach(function (d) {
      var b = document.createElement("button");
      b.className = "vwsoc-tab" + (tab === d[0] ? " on" : "");
      b.textContent = d[1];
      if (d[0] === "requests" && data.incoming.length) {
        var dot = document.createElement("span");
        dot.className = "vwsoc-dot";
        dot.textContent = data.incoming.length;
        b.appendChild(dot);
      }
      b.addEventListener("click", function () { tab = d[0]; renderTabs(); renderSide(); });
      wrap.appendChild(b);
    });
  }

  function row(user, subtext, actions, unread) {
    var el = document.createElement("div");
    el.className = "vwsoc-row" + (active && active.id === user.id ? " on" : "");
    el.innerHTML =
      '<img class="vwsoc-av" src="' + esc(user.avatar) + '" alt="">' +
      '<div class="vwsoc-rmain"><div class="vwsoc-rname">' + esc(user.name) + "</div>" +
      '<div class="vwsoc-rsub">' + esc(subtext || "") + "</div></div>";
    if (unread) {
      var bd = document.createElement("span");
      bd.className = "vwsoc-rbadge";
      bd.textContent = unread > 99 ? "99+" : unread;
      el.appendChild(bd);
    }
    if (actions && actions.length) {
      var acts = document.createElement("div");
      acts.className = "vwsoc-acts";
      actions.forEach(function (a) {
        var btn = document.createElement("button");
        btn.className = "vwsoc-mini" + (a.cls ? " " + a.cls : "");
        btn.textContent = a.label;
        btn.addEventListener("click", function (e) { e.stopPropagation(); a.onClick(); });
        acts.appendChild(btn);
      });
      el.appendChild(acts);
    }
    return el;
  }

  function renderSide() {
    var list = modal.querySelector("#vwsocSideList");
    list.innerHTML = "";

    if (tab === "add") return renderAdd(list);

    if (tab === "requests") {
      if (!data.incoming.length && !data.outgoing.length) {
        list.innerHTML = '<div class="vwsoc-empty">No pending requests.<br>Add people from the “Add People” tab.</div>';
        return;
      }
      if (data.incoming.length) {
        list.appendChild(sectionLabel("Incoming"));
        data.incoming.forEach(function (u) {
          list.appendChild(row(u, "wants to be friends", [
            { label: "Accept", cls: "go", onClick: function () { respond(u.id, true); } },
            { label: "Decline", cls: "danger", onClick: function () { respond(u.id, false); } },
          ]));
        });
      }
      if (data.outgoing.length) {
        list.appendChild(sectionLabel("Sent"));
        data.outgoing.forEach(function (u) {
          list.appendChild(row(u, "request pending", [
            { label: "Cancel", cls: "danger", onClick: function () { removeFriend(u.id); } },
          ]));
        });
      }
      return;
    }

    if (tab === "friends") {
      var mk = document.createElement("button");
      mk.className = "vwsoc-newgroup";
      mk.textContent = "＋ New group chat";
      mk.addEventListener("click", openGroupCreate);
      list.appendChild(mk);
      if (!data.friends.length) {
        list.appendChild(htmlEl('<div class="vwsoc-empty">No friends yet.<br>Add people by AniList username in “Add People”.</div>'));
        return;
      }
      data.friends.forEach(function (u) {
        var el = row(u, "Friend", [
          { label: "Message", cls: "go", onClick: function () { openDm(u); } },
          { label: "Remove", cls: "danger", onClick: function () { if (confirm("Remove " + u.name + "?")) removeFriend(u.id); } },
        ]);
        el.addEventListener("click", function () { openDm(u); });
        list.appendChild(el);
      });
      return;
    }

    // chats — DMs and groups merged, newest first
    var items = [];
    threadList.forEach(function (t) { items.push({ group: false, target: t.user, lastTs: t.lastTs, last: t.last, unread: t.unread }); });
    groupList.forEach(function (g) { items.push({ group: true, target: g, lastTs: g.lastTs, last: g.last, unread: g.unread }); });
    items.sort(function (a, b) { return b.lastTs - a.lastTs; });

    if (!items.length) {
      list.innerHTML = '<div class="vwsoc-empty">No conversations yet.<br>Open a friend and say hi 👋 — or make a group in the Friends tab.</div>';
      return;
    }
    items.forEach(function (it) {
      var preview = previewText(it.last);
      if (it.group) {
        var sub = it.target.members.length + " members" + (preview ? " · " + preview : "");
        var el = row({ name: it.target.name, avatar: groupAvatarUrl(it.target) }, sub, null, it.unread);
        el.classList.add("vwsoc-grouprow");
        el.addEventListener("click", function () { openGroup(it.target); });
        list.appendChild(el);
      } else {
        var el2 = row(it.target, timeAgo(it.lastTs) + (preview ? " · " + preview : ""), null, it.unread);
        el2.addEventListener("click", function () { openDm(it.target); });
        list.appendChild(el2);
      }
    });
  }

  function htmlEl(h) { var d = document.createElement("div"); d.innerHTML = h; return d.firstChild; }

  function previewText(last) {
    if (!last) return "";
    if (last.kind === "clip") return "🎬 clip";
    if (last.kind === "gif") return "🖼 GIF";
    var who = last.from === (me && me.id) ? "You: " : (last.from_name ? last.from_name + ": " : "");
    return who + (last.text || "");
  }

  function groupAvatarUrl(g) {
    var m = (g.members || []).filter(function (u) { return u.id !== (me && me.id) && u.avatar; });
    return (m[0] && m[0].avatar) || (g.members && g.members[0] && g.members[0].avatar) || "";
  }

  function sectionLabel(txt) {
    var d = document.createElement("div");
    d.className = "vwsoc-clip-ep";
    d.style.cssText = "padding:8px 10px 3px;text-transform:uppercase;letter-spacing:.4px;font-weight:600;";
    d.textContent = txt;
    return d;
  }

  /* ── Add People (search AniList users) ──────────────────────────── */
  var addTimer = null;
  function renderAdd(list) {
    var input = document.createElement("input");
    input.className = "vwsoc-search";
    input.placeholder = "Search AniList username…";
    input.autocomplete = "off";
    list.appendChild(input);
    var results = document.createElement("div");
    list.appendChild(results);
    results.innerHTML = '<div class="vwsoc-empty">Type at least 2 letters.<br>People appear here once they’ve opened Friends on Virowatch, or search AniList directly.</div>';

    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(addTimer);
      if (q.length < 2) {
        results.innerHTML = '<div class="vwsoc-empty">Type at least 2 letters.</div>';
        return;
      }
      addTimer = setTimeout(function () { searchUsers(q, results); }, 320);
    });
    setTimeout(function () { input.focus(); }, 0);
  }

  // Search our own user cache first; fall back to AniList's public user search.
  function searchUsers(q, results) {
    results.innerHTML = '<div class="vwsoc-empty">Searching…</div>';
    api("/users?q=" + encodeURIComponent(q)).then(function (d) {
      var found = (d && d.ok && d.users) || [];
      var seen = {};
      found.forEach(function (u) { seen[u.id] = true; });
      renderUserResults(found, results, q);
      // supplement with AniList's directory so you can add people who haven't
      // opened Virowatch's friends panel yet
      anilistUserSearch(q).then(function (extra) {
        var merged = found.concat(extra.filter(function (u) { return !seen[u.id]; }));
        renderUserResults(merged, results, q);
      }).catch(function () {});
    }).catch(function () {
      anilistUserSearch(q).then(function (extra) { renderUserResults(extra, results, q); })
        .catch(function () { results.innerHTML = '<div class="vwsoc-empty">Search failed.</div>'; });
    });
  }

  function anilistUserSearch(q) {
    return fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query($q:String){Page(perPage:12){users(search:$q){id name avatar{medium}}}}",
        variables: { q: q },
      }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      var u = (j && j.data && j.data.Page && j.data.Page.users) || [];
      return u.map(function (x) { return { id: x.id, name: x.name, avatar: (x.avatar && x.avatar.medium) || "" }; });
    });
  }

  function relationOf(id) {
    if (me && id === me.id) return "self";
    if (data.friends.some(function (u) { return u.id === id; })) return "friend";
    if (data.outgoing.some(function (u) { return u.id === id; })) return "sent";
    if (data.incoming.some(function (u) { return u.id === id; })) return "incoming";
    return "none";
  }

  function renderUserResults(users, results, q) {
    results.innerHTML = "";
    if (!users.length) {
      results.innerHTML = '<div class="vwsoc-empty">No users found for “' + esc(q) + '”.</div>';
      return;
    }
    users.forEach(function (u) {
      var rel = relationOf(u.id);
      var actions = [];
      if (rel === "self") actions = [];
      else if (rel === "friend") actions = [{ label: "Message", cls: "go", onClick: function () { openConversation(u); } }];
      else if (rel === "sent") actions = [{ label: "Requested", onClick: function () {} }];
      else if (rel === "incoming") actions = [{ label: "Accept", cls: "go", onClick: function () { respond(u.id, true); } }];
      else actions = [{ label: "Add", cls: "go", onClick: function () { sendRequest(u); } }];
      results.appendChild(row(u, rel === "self" ? "That's you" : "AniList user", actions));
    });
  }

  /* ── friend mutations ───────────────────────────────────────────── */
  function sendRequest(u) {
    api("/friend/request", { toId: u.id, toName: u.name, toAvatar: u.avatar })
      .then(function (d) {
        if (d && d.ok) {
          toast(d.accepted ? "You're now friends with " + u.name : "Request sent to " + u.name);
          refreshAll();
        } else toast((d && d.error) || "Request failed", true);
      }).catch(function () { toast("Request failed", true); });
  }
  function respond(fromId, accept) {
    api("/friend/respond", { fromId: fromId, accept: accept })
      .then(function () { refreshAll(); }).catch(function () {});
  }
  function removeFriend(otherId) {
    api("/friend/remove", { otherId: otherId })
      .then(function () {
        if (active && active.id === otherId) { active = null; renderConv(); }
        refreshAll();
      }).catch(function () {});
  }

  /* ── conversation pane ──────────────────────────────────────────── */
  function openConversation(user) { openDm(user); } // back-compat alias

  function openDm(user) { setActive(user); }
  function openGroup(group) {
    // clone so we can flag it without mutating the list entry
    setActive({ _group: true, id: group.id, name: group.name, ownerId: group.ownerId, members: group.members || [] });
  }
  function setActive(a) {
    active = a;
    tab = "chats";
    messages = [];
    lastMsgJson = "";
    replyingTo = null;
    if (modal) modal.querySelector(".vwsoc-modal").classList.add("show-conv");
    renderTabs();
    renderSide();
    renderConv();
    loadMessages();
  }

  function loadMessages() {
    if (!active) return;
    var id = active.id, grp = !!active._group;
    var path = grp ? "/group/messages?groupId=" + id : "/messages?with=" + id;
    api(path).then(function (d) {
      if (!active || active.id !== id || !!active._group !== grp) return;
      if (d && d.ok) {
        var js = JSON.stringify(d.messages);
        if (js !== lastMsgJson) {
          messages = d.messages;
          lastMsgJson = js;
          renderMessages();
        }
        refreshThreadsQuiet(); // fetch marked read — refresh badge/list
      }
    }).catch(function () {});
  }

  function refreshThreadsQuiet() {
    Promise.all([
      api("/threads").catch(function () { return null; }),
      api("/groups").catch(function () { return null; }),
    ]).then(function (res) {
      if (res[0] && res[0].ok) threadList = res[0].threads;
      if (res[1] && res[1].ok) groupList = res[1].groups;
      updateBadge();
      if (tab === "chats" && modalOpen()) renderSide();
    });
  }

  function renderConv() {
    var pane = modal.querySelector("#vwsocConv");
    if (!active) {
      if (modal) modal.querySelector(".vwsoc-modal").classList.remove("show-conv");
      pane.innerHTML = '<div class="vwsoc-conv-empty">Pick a conversation, or add a friend to start chatting.<br><br>Watching something? Hit <b>🎬 Send clip</b> under the player to share the exact moment.</div>';
      return;
    }
    var grp = !!active._group;
    var headAvatar = grp
      ? '<span class="vwsoc-av vwsoc-groupav">' + groupAvatarInner(active) + "</span>"
      : '<img class="vwsoc-av" src="' + esc(active.avatar) + '" alt="">';
    var headSub = grp ? '<div class="vwsoc-conv-sub">' + active.members.length + " members</div>" : "";
    var headActs = grp
      ? '<button class="vwsoc-mini" id="vwsocGroupAdd">＋ Add</button>' +
        (active.ownerId === (me && me.id) ? '<button class="vwsoc-mini" id="vwsocGroupRename">Rename</button>' : "") +
        '<button class="vwsoc-mini danger" id="vwsocGroupLeave">Leave</button>'
      : '<button class="vwsoc-mini danger" id="vwsocUnfriend">Remove</button>';

    pane.innerHTML =
      '<div class="vwsoc-conv-head">' +
      '<button class="vwsoc-mini" id="vwsocBack" style="display:none;">‹</button>' +
      headAvatar +
      '<div class="vwsoc-conv-titles"><div class="vwsoc-conv-name">' + esc(active.name) + "</div>" + headSub + "</div>" +
      '<div class="vwsoc-acts">' + headActs + "</div>" +
      "</div>" +
      '<div class="vwsoc-msgs" id="vwsocMsgs"></div>' +
      '<div id="vwsocStaged"></div>' +
      '<div class="vwsoc-replybar" id="vwsocReplyBar" style="display:none;"></div>' +
      '<div class="vwsoc-compose" style="position:relative;">' +
      '<button class="vwsoc-ibtn" id="vwsocGif" title="Send a GIF">🖼</button>' +
      '<button class="vwsoc-ibtn" id="vwsocEmoji" title="Emoji">😊</button>' +
      '<textarea id="vwsocText" placeholder="Message ' + esc(active.name) + '…" rows="1"></textarea>' +
      '<button class="vwsoc-ibtn" id="vwsocSend" title="Send">➤</button>' +
      '<div id="vwsocGifPop"></div>' +
      '<div id="vwsocEmojiPop"></div>' +
      "</div>";

    var back = pane.querySelector("#vwsocBack");
    if (window.innerWidth <= 720) { back.style.display = ""; }
    back.addEventListener("click", function () { active = null; modal.querySelector(".vwsoc-modal").classList.remove("show-conv"); renderConv(); });
    if (grp) {
      pane.querySelector("#vwsocGroupAdd").addEventListener("click", openGroupAdd);
      pane.querySelector("#vwsocGroupLeave").addEventListener("click", leaveGroup);
      var rn = pane.querySelector("#vwsocGroupRename");
      if (rn) rn.addEventListener("click", renameGroup);
    } else {
      pane.querySelector("#vwsocUnfriend").addEventListener("click", function () {
        if (confirm("Remove " + active.name + "?")) removeFriend(active.id);
      });
    }

    var ta = pane.querySelector("#vwsocText");
    ta.addEventListener("input", function () { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); }
    });
    pane.querySelector("#vwsocSend").addEventListener("click", sendText);
    pane.querySelector("#vwsocGif").addEventListener("click", toggleGifPop);
    pane.querySelector("#vwsocEmoji").addEventListener("click", toggleEmojiPop);

    renderStaged();
    renderReplyBar();
    renderMessages();
  }

  function renderMessages() {
    if (!modal) return;
    var box = modal.querySelector("#vwsocMsgs");
    if (!box) return;
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = "";
    if (!messages.length) {
      box.innerHTML = '<div class="vwsoc-conv-empty" style="flex:1;">No messages yet — say hi.</div>';
      return;
    }
    var grp = !!(active && active._group);
    messages.forEach(function (m, i) {
      // in a group, tag received messages with the sender (once per run)
      var showSender = grp && !m.mine &&
        (i === 0 || messages[i - 1].from !== m.from || messages[i - 1].mine);
      if (showSender) {
        var hdr = document.createElement("div");
        hdr.className = "vwsoc-sender";
        hdr.innerHTML = '<img src="' + esc(m.fromAvatar) + '" alt=""><span>' + esc(m.fromName || "AniList user") + "</span>";
        box.appendChild(hdr);
      }
      // "replying to …" reference line above the bubble
      if (m.replyTo) {
        var rr = document.createElement("div");
        rr.className = "vwsoc-replyref" + (m.mine ? " mine" : "");
        rr.innerHTML = '<span class="vwsoc-replyref-n">' + esc(m.replyTo.fromName || "AniList user") + "</span> " +
          twemojify(esc(replySnippet(m.replyTo)));
        box.appendChild(rr);
      }
      var el = (m.kind === "clip" && m.clip) ? clipCard(m)
             : (m.kind === "gif" && m.gif) ? gifBubble(m)
             : textBubble(m);
      addMenu(el, m);
      box.appendChild(el);
    });
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function replySnippet(r) {
    if (!r) return "";
    if (r.kind === "clip") return "🎬 clip";
    if (r.kind === "gif") return "🖼 GIF";
    var t = (r.text || "").replace(/\s+/g, " ").trim();
    return t.length > 60 ? t.slice(0, 60) + "…" : t;
  }

  // your own messages anywhere; a group owner can delete anyone's
  function canDelete(m) {
    if (m.mine) return true;
    return !!(active && active._group && active.ownerId === (me && me.id));
  }

  // ⋯ button on every message → Reply / Delete menu (Discord-style)
  function addMenu(el, m) {
    el.classList.add("vwsoc-canmenu");
    var b = document.createElement("button");
    b.className = "vwsoc-msgmenu";
    b.type = "button";
    b.innerHTML = "&#8942;"; // vertical ellipsis
    b.title = "More";
    b.addEventListener("click", function (e) { e.stopPropagation(); openMsgMenu(b, m); });
    el.appendChild(b);
  }

  function closeMsgMenu() {
    var m = document.getElementById("vwsocCtx");
    if (m) m.remove();
    document.removeEventListener("mousedown", outsideMenu, true);
  }
  function outsideMenu(e) {
    var m = document.getElementById("vwsocCtx");
    if (m && !m.contains(e.target)) closeMsgMenu();
  }
  function openMsgMenu(anchor, m) {
    closeMsgMenu();
    var menu = document.createElement("div");
    menu.className = "vwsoc-ctx";
    menu.id = "vwsocCtx";
    var rep = document.createElement("button");
    rep.className = "vwsoc-ctx-item";
    rep.innerHTML = "↩ Reply";
    rep.addEventListener("click", function () { closeMsgMenu(); startReply(m); });
    menu.appendChild(rep);
    if (canDelete(m)) {
      var del = document.createElement("button");
      del.className = "vwsoc-ctx-item danger";
      del.innerHTML = "🗑 Delete";
      del.addEventListener("click", function () { closeMsgMenu(); deleteMessage(m); });
      menu.appendChild(del);
    }
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    var w = 150;
    menu.style.top = (r.bottom + 4) + "px";
    menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
    setTimeout(function () { document.addEventListener("mousedown", outsideMenu, true); }, 0);
  }

  /* ── reply ──────────────────────────────────────────────────────── */
  function startReply(m) {
    replyingTo = m;
    renderReplyBar();
    var ta = modal.querySelector("#vwsocText");
    if (ta) ta.focus();
  }
  function cancelReply() { replyingTo = null; renderReplyBar(); }
  function renderReplyBar() {
    if (!modal) return;
    var bar = modal.querySelector("#vwsocReplyBar");
    if (!bar) return;
    if (!replyingTo) { bar.innerHTML = ""; bar.style.display = "none"; return; }
    var who = replyingTo.mine ? "yourself"
      : (replyingTo.fromName || (active && !active._group ? active.name : "them"));
    bar.style.display = "";
    bar.innerHTML =
      '<div class="vwsoc-replybar-txt">↩ Replying to <b>' + esc(who) + "</b> · " +
      twemojify(esc(replySnippet(replyingTo))) + "</div>" +
      '<button class="vwsoc-mini" id="vwsocReplyX" type="button">✕</button>';
    bar.querySelector("#vwsocReplyX").addEventListener("click", cancelReply);
  }

  function deleteMessage(m) {
    messages = messages.filter(function (x) { return x !== m && (!m.id || x.id !== m.id); });
    lastMsgJson = "";
    renderMessages();
    if (!m.id) return; // optimistic message that never reached the server
    var path = (active && active._group) ? "/group/message/delete" : "/message/delete";
    api(path, { id: m.id })
      .then(function (d) { if (d && !d.ok) toast(d.error || "Delete failed", true); loadMessages(); refreshThreadsQuiet(); })
      .catch(function () { toast("Delete failed", true); });
  }

  // Inline formatting on an already-escaped string: bold/italic/underline/
  // strike/spoiler + bare links. Order matters (***→**→*).
  function mdInline(s) {
    s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="vwsoc-spoiler">$1</span>');
    s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^\s*][\s\S]*?)\*/g, "<em>$1</em>");
    s = s.replace(/__([\s\S]+?)__/g, "<u>$1</u>");
    s = s.replace(/~~([\s\S]+?)~~/g, "<s>$1</s>");
    s = s.replace(/(^|[\s(])_([^\s_][\s\S]*?)_(?=$|[\s).,!?])/g, "$1<em>$2</em>");
    s = s.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>";
    });
    return s;
  }

  // Discord-ish markdown → HTML. Escapes first; pulls code out so formatting
  // can't run inside it; then handles #/##/### headers, > quotes, and inline.
  function renderMd(text) {
    var html = esc(text);
    var slots = [];
    var L = String.fromCharCode(17), R = String.fromCharCode(18);
    html = html.replace(/```([\s\S]+?)```/g, function (_, code) {
      slots.push('<pre class="vwsoc-pre">' + code.replace(/^\n/, "") + "</pre>");
      return L + (slots.length - 1) + R;
    });
    html = html.replace(/`([^`\n]+?)`/g, function (_, code) {
      slots.push('<code class="vwsoc-code">' + code + "</code>");
      return L + (slots.length - 1) + R;
    });

    var lines = html.split("\n");
    var out = [];
    var prevInline = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var h = /^(#{1,3})\s+(.*)$/.exec(ln);
      if (h) { out.push('<div class="vwsoc-h' + h[1].length + '">' + mdInline(h[2]) + "</div>"); prevInline = false; continue; }
      var q = /^&gt;\s+(.*)$/.exec(ln); // ">" was escaped to &gt;
      if (q) { out.push('<div class="vwsoc-quote">' + mdInline(q[1]) + "</div>"); prevInline = false; continue; }
      out.push((prevInline ? "<br>" : "") + mdInline(ln));
      prevInline = true;
    }
    html = out.join("");
    for (var j = 0; j < slots.length; j++) html = html.split(L + j + R).join(slots[j]);
    return twemojify(html);
  }

  // spoilers reveal on click — wire up after innerHTML is set
  function wireBubble(el) {
    el.querySelectorAll(".vwsoc-spoiler").forEach(function (sp) {
      sp.addEventListener("click", function () { sp.classList.add("on"); });
    });
  }

  function textBubble(m) {
    var el = document.createElement("div");
    el.className = "vwsoc-bub" + (m.mine ? " mine" : "");
    el.innerHTML = renderMd(m.text) + '<div class="vwsoc-time">' + timeAgo(m.ts) + " ago</div>";
    wireBubble(el);
    return el;
  }

  function gifBubble(m) {
    var el = document.createElement("div");
    el.className = "vwsoc-bub" + (m.mine ? " mine" : "");
    el.innerHTML = '<img class="gif" src="' + esc(m.gif) + '" alt="gif">' +
      '<div class="vwsoc-time">' + timeAgo(m.ts) + " ago</div>";
    return el;
  }

  function clipCard(m) {
    var c = m.clip;
    var el = document.createElement("div");
    el.className = "vwsoc-clip" + (m.mine ? " mine" : "");
    var thumbStyle = c.thumb ? ' style="background-image:url(' + JSON.stringify(c.thumb) + ')"' : "";
    el.innerHTML =
      '<div class="vwsoc-clip-thumb"' + thumbStyle + ">" +
      '<div class="vwsoc-clip-play">▶</div>' +
      '<div class="vwsoc-clip-t">' + fmtClock(c.t) + "</div></div>" +
      '<div class="vwsoc-clip-meta">' +
      '<div class="vwsoc-clip-title">' + esc(c.title || "Clip") + "</div>" +
      '<div class="vwsoc-clip-ep">' + esc(c.epLabel || "") + " · tap to jump to " + fmtClock(c.t) + "</div></div>" +
      (m.text ? '<div class="vwsoc-clip-note">' + twemojify(esc(m.text)) + "</div>" : "");
    el.addEventListener("click", function () {
      closeModal();
      window.vwPlayEpisodeAt(c.key, c.t);
    });
    return el;
  }

  /* ── sending (routes to /message or /group/message) ─────────────── */
  function sendTo(extra) {
    var path = active._group ? "/group/message" : "/message";
    var body = { kind: extra.kind, text: extra.text, clip: extra.clip, gifUrl: extra.gifUrl };
    if (active._group) body.groupId = active.id; else body.toId = active.id;
    if (replyingTo && replyingTo.id) body.replyTo = replyingTo.id;
    return api(path, body);
  }

  // snapshot the current reply target for optimistic display
  function replySnapshot() {
    if (!replyingTo) return null;
    var name = replyingTo.mine ? (me && me.name)
      : (replyingTo.fromName || (active && !active._group ? active.name : ""));
    return { id: replyingTo.id, from: replyingTo.from, fromName: name, kind: replyingTo.kind, text: replyingTo.text };
  }
  function clearReply() { replyingTo = null; renderReplyBar(); }

  function sendText() {
    if (!active) return;
    var ta = modal.querySelector("#vwsocText");
    var text = ta.value.trim();
    if (pendingClip) return sendClip(text);
    if (!text) return;
    ta.value = ""; ta.style.height = "auto";
    optimistic({ kind: "text", text: text, replyTo: replySnapshot() });
    sendTo({ kind: "text", text: text })
      .then(function (d) { if (d && !d.ok) toast(d.error || "Send failed", true); loadMessages(); })
      .catch(function () { toast("Send failed", true); });
    clearReply();
  }

  function sendClip(note) {
    var c = pendingClip;
    pendingClip = null;
    var ta = modal.querySelector("#vwsocText");
    if (ta) { ta.value = ""; ta.style.height = "auto"; }
    renderStaged();
    optimistic({ kind: "clip", clip: c, text: note || "", replyTo: replySnapshot() });
    sendTo({ kind: "clip", text: note || "", clip: c })
      .then(function (d) { if (d && !d.ok) toast(d.error || "Send failed", true); loadMessages(); })
      .catch(function () { toast("Send failed", true); });
    clearReply();
  }

  function sendGif(url) {
    if (!active) return;
    optimistic({ kind: "gif", gif: url, replyTo: replySnapshot() });
    sendTo({ kind: "gif", gifUrl: url })
      .then(function (d) { if (d && !d.ok) toast(d.error || "Send failed", true); loadMessages(); })
      .catch(function () { toast("Send failed", true); });
    clearReply();
  }

  // show it instantly, reconcile on next poll
  function optimistic(m) {
    m.from = me && me.id;
    m.mine = true;
    m.ts = Date.now();
    if (active && active._group) { m.fromName = me && me.name; m.fromAvatar = me && me.avatar; }
    messages.push(m);
    lastMsgJson = ""; // force a re-render on next real fetch
    renderMessages();
  }

  /* ── staged clip (from "🎬 Send clip") ──────────────────────────── */
  function stageCurrentEpisode() {
    var c = currentClip();
    if (!c) { toast("Start playing an episode first.", true); return; }
    pendingClip = c;
    renderStaged();
    var ta = modal.querySelector("#vwsocText");
    if (ta) { ta.placeholder = "Add a note (optional) — “check out " + fmtClock(c.t) + "”"; ta.focus(); }
  }

  function renderStaged() {
    if (!modal) return;
    var wrap = modal.querySelector("#vwsocStaged");
    if (!wrap) return;
    if (!pendingClip) { wrap.innerHTML = ""; return; }
    var c = pendingClip;
    wrap.innerHTML =
      '<div class="vwsoc-staged">' +
      '<img src="' + esc(c.thumb) + '" alt="">' +
      '<div class="vwsoc-staged-main">🎬 <b>' + esc(c.title || "This episode") + "</b> " +
      esc(c.epLabel) + " @ " + fmtClock(c.t) + "</div>" +
      '<button class="vwsoc-mini danger" id="vwsocUnstage">✕</button></div>';
    wrap.querySelector("#vwsocUnstage").addEventListener("click", function () {
      pendingClip = null;
      renderStaged();
      var ta = modal.querySelector("#vwsocText");
      if (ta && active) ta.placeholder = "Message " + active.name + "…";
    });
  }

  /* ── group chats ────────────────────────────────────────────────── */
  function groupAvatarInner(g) {
    var others = (g.members || []).filter(function (u) { return u.id !== (me && me.id); });
    var a = (others[0] && others[0].avatar) || (g.members && g.members[0] && g.members[0].avatar) || "";
    return a ? '<img src="' + esc(a) + '" alt="">'
             : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.1"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5.3a2.9 2.9 0 0 1 0 5.4"/><path d="M17.6 14.1c2.3.4 3.9 2.3 3.9 4.9"/></svg>';
  }

  // Create-group form in the conversation pane (name + pick friends)
  function openGroupCreate() {
    if (!data.friends.length) { toast("Add some friends first.", true); return; }
    active = null;
    tab = "friends";
    if (modal) modal.querySelector(".vwsoc-modal").classList.add("show-conv");
    renderTabs(); renderSide();
    var pane = modal.querySelector("#vwsocConv");
    pane.innerHTML =
      '<div class="vwsoc-conv-head">' +
      '<button class="vwsoc-mini" id="vwsocGcBack">‹ Back</button>' +
      '<div class="vwsoc-conv-titles"><div class="vwsoc-conv-name">New group chat</div></div>' +
      "</div>" +
      '<div class="vwsoc-gcbody">' +
      '<input class="vwsoc-search" id="vwsocGcName" placeholder="Group name (optional)" maxlength="80" style="margin:0 0 4px;">' +
      '<div class="vwsoc-gchint">Pick friends to add:</div>' +
      '<div class="vwsoc-gclist" id="vwsocGcList"></div>' +
      '<button class="vwsoc-mini go" id="vwsocGcCreate" style="align-self:flex-end;">Create group</button>' +
      "</div>";
    var listEl = pane.querySelector("#vwsocGcList");
    var chosen = {};
    data.friends.forEach(function (u) {
      var r = document.createElement("label");
      r.className = "vwsoc-gcrow";
      r.innerHTML =
        '<input type="checkbox"><img class="vwsoc-av" src="' + esc(u.avatar) + '" alt="">' +
        '<span class="vwsoc-rname">' + esc(u.name) + "</span>";
      var cb = r.querySelector("input");
      cb.addEventListener("change", function () { if (cb.checked) chosen[u.id] = u; else delete chosen[u.id]; });
      listEl.appendChild(r);
    });
    pane.querySelector("#vwsocGcBack").addEventListener("click", function () { renderConv(); });
    pane.querySelector("#vwsocGcCreate").addEventListener("click", function () {
      var ids = Object.keys(chosen).map(Number);
      if (!ids.length) { toast("Pick at least one friend.", true); return; }
      var name = pane.querySelector("#vwsocGcName").value.trim() ||
        ([me && me.name].concat(ids.map(function (i) { return chosen[i].name; })).filter(Boolean).slice(0, 3).join(", "));
      api("/group/create", { name: name, memberIds: ids }).then(function (d) {
        if (d && d.ok) { toast("Group created."); refreshAll(); openGroup(d.group); }
        else toast((d && d.error) || "Couldn't create group", true);
      }).catch(function () { toast("Couldn't create group", true); });
    });
  }

  function openGroupAdd() {
    var g = active;
    var candidates = data.friends.filter(function (f) {
      return !g.members.some(function (m) { return m.id === f.id; });
    });
    if (!candidates.length) { toast("All your friends are already in this group."); return; }
    showPickPanel("Add to " + g.name, candidates, function (u, close) {
      api("/group/add", { groupId: g.id, userId: u.id, name: u.name, avatar: u.avatar }).then(function (d) {
        if (d && d.ok) {
          active.members = d.members;
          toast(u.name + " added.");
          renderConv(); loadMessages(); refreshThreadsQuiet();
          close();
        } else toast((d && d.error) || "Add failed", true);
      }).catch(function () { toast("Add failed", true); });
    });
  }

  function renameGroup() {
    var name = prompt("Rename group:", active.name);
    if (name == null) return;
    name = name.trim();
    if (!name) return;
    api("/group/rename", { groupId: active.id, name: name }).then(function (d) {
      if (d && d.ok) { active.name = name; renderConv(); refreshThreadsQuiet(); }
      else toast((d && d.error) || "Rename failed", true);
    }).catch(function () {});
  }

  function leaveGroup() {
    if (!confirm("Leave " + active.name + "?")) return;
    var gid = active.id;
    api("/group/leave", { groupId: gid }).then(function () {
      active = null;
      groupList = groupList.filter(function (g) { return g.id !== gid; });
      if (modal) modal.querySelector(".vwsoc-modal").classList.remove("show-conv");
      renderConv(); renderSide();
      refreshAll();
    }).catch(function () {});
  }

  // Generic small member-picker overlay (used by "＋ Add" in a group)
  function showPickPanel(title, users, onPick) {
    var ov = document.createElement("div");
    ov.className = "vws-overlay vws-open vwsoc-pick";
    ov.innerHTML =
      '<div class="vws-modal" style="width:min(420px,92vw);max-height:70vh;display:flex;flex-direction:column;">' +
      '<div class="vws-header"><div class="vws-title" style="font-size:1rem;">' + esc(title) + "</div>" +
      '<button type="button" class="vws-close">×</button></div>' +
      '<div class="vwsoc-list" id="vwsocPickList" style="padding:8px 10px 12px;"></div></div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); }
    ov.querySelector(".vws-close").addEventListener("click", close);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    var list = ov.querySelector("#vwsocPickList");
    users.forEach(function (u) {
      var el = row(u, "Friend", [{ label: "Add", cls: "go", onClick: function () { onPick(u, close); } }]);
      list.appendChild(el);
    });
  }

  /* ── GIF favorites (local — ★ a GIF to keep it) ─────────────────── */
  function gifFavs() {
    try { return JSON.parse(localStorage.getItem(GIF_FAVS_KEY) || "[]"); }
    catch (_) { return []; }
  }
  function setGifFavs(a) { localStorage.setItem(GIF_FAVS_KEY, JSON.stringify(a.slice(0, 400))); }
  function isFav(u) { return gifFavs().indexOf(u) !== -1; }
  function toggleFav(u) {
    var a = gifFavs();
    var i = a.indexOf(u);
    if (i === -1) a.unshift(u); else a.splice(i, 1);
    setGifFavs(a);
  }

  /* ── emoji picker (insert into the message) ─────────────────────── */
  var EMOJIS = ("😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 😉 😍 🥰 😘 😎 🤩 🤔 🤨 😐 😶 " +
    "🙄 😴 🥱 😔 😢 😭 😤 😡 🤬 😱 😳 🥺 🤯 😏 🤗 🤝 🙏 👍 👎 👏 " +
    "🙌 💪 🤙 ✌️ 🤞 👋 👀 🧠 🔥 ✨ ⭐ 🎉 🎊 💯 ❤️ 🧡 💛 💚 💙 💜 " +
    "🖤 🤍 💔 💀 🤡 👻 🎬 🍿 🎮 ⚡ 🏆 😬").split(" ");
  var emojiOpen = false;
  function toggleEmojiPop() {
    var pop = modal.querySelector("#vwsocEmojiPop");
    if (!pop) return;
    if (gifOpen) toggleGifPop(); // one popup at a time
    emojiOpen = !emojiOpen;
    if (!emojiOpen) { pop.innerHTML = ""; pop.className = ""; return; }
    pop.className = "vwsoc-emojipop";
    pop.innerHTML = "";
    EMOJIS.forEach(function (e) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "vwsoc-emoji";
      b.innerHTML = twImg(e); // Discord-style twemoji image
      b.addEventListener("click", function () { insertEmoji(e); });
      pop.appendChild(b);
    });
  }
  function insertEmoji(e) {
    var ta = modal.querySelector("#vwsocText");
    if (!ta) return;
    var s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    var en = ta.selectionEnd != null ? ta.selectionEnd : s;
    ta.value = ta.value.slice(0, s) + e + ta.value.slice(en);
    ta.focus();
    var pos = s + e.length;
    try { ta.setSelectionRange(pos, pos); } catch (_) {}
    ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px";
  }

  /* ── GIF picker (Giphy search + paste + Favorites) ──────────────── */
  var gifOpen = false;
  var gifView = "trending"; // trending | favs
  function toggleGifPop() {
    var pop = modal.querySelector("#vwsocGifPop");
    if (!pop) return;
    gifOpen = !gifOpen;
    if (!gifOpen) { pop.innerHTML = ""; pop.className = ""; return; }
    pop.className = "vwsoc-gifpop";
    pop.innerHTML =
      '<div class="vwsoc-giftabs">' +
      '<button class="vwsoc-tab" data-v="trending">Trending</button>' +
      '<button class="vwsoc-tab" data-v="favs">★ Favorites</button>' +
      "</div>" +
      '<input class="vwsoc-search" id="vwsocGifSearch" placeholder="Search GIFs, or paste a GIF URL…" style="margin:0;">' +
      '<div class="vwsoc-gifgrid" id="vwsocGifGrid"></div>';
    var inp = pop.querySelector("#vwsocGifSearch");
    var grid = pop.querySelector("#vwsocGifGrid");
    pop.querySelectorAll(".vwsoc-giftabs .vwsoc-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        gifView = b.dataset.v;
        markGifTabs(pop);
        inp.style.display = gifView === "favs" ? "none" : "";
        if (gifView === "favs") renderFavs(grid); else loadTrending(grid);
      });
    });
    markGifTabs(pop);
    loadTrending(grid);
    var t = null;
    inp.addEventListener("input", function () {
      var q = inp.value.trim();
      if (/^https?:\/\/\S+\.(gif|webp|png|jpe?g)/i.test(q)) return; // wait for Enter
      clearTimeout(t);
      t = setTimeout(function () {
        gifView = "trending"; markGifTabs(pop);
        q ? searchGifs(q, grid) : loadTrending(grid);
      }, 300);
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var q = inp.value.trim();
        if (/^https?:\/\//i.test(q)) { toggleGifPop(); sendGif(q); }
      }
    });
    setTimeout(function () { inp.focus(); }, 0);
  }

  function markGifTabs(pop) {
    pop.querySelectorAll(".vwsoc-giftabs .vwsoc-tab").forEach(function (b) {
      b.classList.toggle("on", b.dataset.v === gifView);
    });
  }

  // one masonry tile: the GIF (natural aspect) + a ★ favorite toggle overlay.
  // ratio ("w / h") reserves the slot before the image loads so the column
  // doesn't jump; favorites have no known size and just flow at natural height.
  function gifTile(url, thumb, ratio) {
    var tile = document.createElement("div");
    tile.className = "vwsoc-giftile";
    if (ratio) tile.style.aspectRatio = ratio;
    var img = document.createElement("img");
    img.src = thumb || url; img.loading = "lazy"; img.alt = "";
    img.addEventListener("click", function () { toggleGifPop(); sendGif(url); });
    var star = document.createElement("button");
    star.className = "vwsoc-fav" + (isFav(url) ? " on" : "");
    star.textContent = "★";
    star.title = "Favorite";
    star.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleFav(url);
      star.classList.toggle("on", isFav(url));
      if (gifView === "favs") renderFavs(star.closest(".vwsoc-gifgrid"));
    });
    tile.appendChild(img);
    tile.appendChild(star);
    return tile;
  }

  function loadTrending(grid) {
    grid.innerHTML = '<div class="vwsoc-empty" style="grid-column:1/-1;">Loading…</div>';
    fetch("https://api.giphy.com/v1/gifs/trending?api_key=" + GIPHY_KEY + "&limit=18&rating=pg-13")
      .then(function (r) { return r.json(); }).then(function (j) { renderGifs(j, grid); })
      .catch(function () { grid.innerHTML = '<div class="vwsoc-empty" style="grid-column:1/-1;">Can’t load GIFs — paste a GIF URL instead.</div>'; });
  }
  function searchGifs(q, grid) {
    grid.innerHTML = '<div class="vwsoc-empty" style="grid-column:1/-1;">Searching…</div>';
    fetch("https://api.giphy.com/v1/gifs/search?api_key=" + GIPHY_KEY + "&limit=18&rating=pg-13&q=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); }).then(function (j) { renderGifs(j, grid); })
      .catch(function () { grid.innerHTML = '<div class="vwsoc-empty" style="grid-column:1/-1;">Search failed.</div>'; });
  }
  function renderGifs(j, grid) {
    var items = (j && j.data) || [];
    grid.innerHTML = "";
    if (!items.length) { grid.innerHTML = '<div class="vwsoc-empty" style="grid-column:1/-1;">No GIFs.</div>'; return; }
    items.forEach(function (g) {
      var im = g.images || {};
      var url = im.fixed_height && im.fixed_height.url;
      // display the wider fixed_width still so the masonry shows the real GIF
      var thumb = (im.fixed_width && im.fixed_width.url) || url;
      var w = im.fixed_width && Number(im.fixed_width.width);
      var h = im.fixed_width && Number(im.fixed_width.height);
      if (url) grid.appendChild(gifTile(url, thumb, w && h ? w + " / " + h : null));
    });
  }
  function renderFavs(grid) {
    var favs = gifFavs();
    grid.innerHTML = "";
    if (!favs.length) {
      grid.innerHTML = '<div class="vwsoc-empty">No favorites yet — tap ★ on any GIF to save it here.</div>';
      return;
    }
    favs.forEach(function (u) { grid.appendChild(gifTile(u, u, null)); });
  }

  /* ── polling ────────────────────────────────────────────────────── */
  function startConvPoll() {
    stopConvPoll();
    convTimer = setInterval(function () {
      if (!modalOpen()) { stopConvPoll(); return; }
      if (active) loadMessages();
      else refreshThreadsQuiet();
    }, POLL_OPEN_MS);
  }
  function stopConvPoll() { if (convTimer) { clearInterval(convTimer); convTimer = null; } }

  function startIdlePoll() {
    stopIdlePoll();
    idleTimer = setInterval(function () {
      if (modalOpen() || !loggedIn()) return;
      api("/threads").then(function (d) {
        if (d && d.ok) { threadList = d.threads; updateBadge(); }
      }).catch(function () {});
      api("/groups").then(function (d) {
        if (d && d.ok) { groupList = d.groups; updateBadge(); }
      }).catch(function () {});
      api("/friends").then(function (d) {
        if (d && d.ok) { data = { friends: d.friends, incoming: d.incoming, outgoing: d.outgoing }; }
        updateBadge();
      }).catch(function () {});
    }, POLL_IDLE_MS);
  }
  function stopIdlePoll() { if (idleTimer) { clearInterval(idleTimer); idleTimer = null; } }

  /* ── "🎬 Send clip" button in the player controls ───────────────── */
  function clipBtn() {
    var b = document.getElementById("vwSendClipBtn");
    if (b) return b;
    var controls = document.querySelector(".player-controls");
    if (!controls) return null;
    b = document.createElement("a");
    b.id = "vwSendClipBtn";
    b.href = "#";
    b.className = "button";
    b.textContent = "🎬 Send clip";
    b.title = "Share this exact moment with a friend";
    b.style.display = "none";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      if (!loggedIn()) { toast("Log in with AniList to share clips.", true); return; }
      var c = currentClip();
      if (!c) { toast("Play an episode first.", true); return; }
      pendingClip = c;
      openModal();
      // land the user on the friends list so they can pick a target fast
      setTimeout(function () {
        if (data.friends.length === 1) openConversation(data.friends[0]);
        else { tab = active ? "chats" : "friends"; renderTabs(); renderSide(); if (active) renderStaged(); }
        if (!active) toast("Pick a friend to send this clip to.");
      }, 300);
    });
    var next = document.getElementById("nextEpisode");
    controls.insertBefore(b, next ? next.nextSibling : null);
    return b;
  }

  function onEpisode() {
    var key = typeof window.vwCurrentEpisodeKey === "function" ? window.vwCurrentEpisodeKey() : null;
    var b = clipBtn();
    if (b) b.style.display = key ? "" : "none";
  }

  /* ── init ───────────────────────────────────────────────────────── */
  function init() {
    railBtn();
    onEpisode();
    if (loggedIn()) { refreshAll(); }
    startIdlePoll();
  }

  window.addEventListener("vw-cw-updated", onEpisode);
  window.addEventListener("storage", function (e) {
    if (e.key === "vw_anilist") { me = null; if (loggedIn()) refreshAll(); else { data = { friends: [], incoming: [], outgoing: [] }; threadList = []; groupList = []; updateBadge(); } }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(init, 600); });
  } else {
    setTimeout(init, 600);
  }
})();
