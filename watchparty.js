/**
 * watchparty.js — Virowatch Watch Party (BETA)
 *
 * Rail button opens the party modal: host a public/private party or join
 * one (public list, or a 6-char code for private). Whatever the host
 * watches, everyone in the party watches too. Full timestamp sync
 * (pause/seek) works where the page can read the player: the anime Backup
 * player (forced during parties by megaplay-backup.js, unless Vidnest API is
 * already active for that episode), Vidnest's own player (movies/shows are
 * Vidnest-only, and the anime "Vidnest API" merge button — both use the same
 * #vidnestDirectPlayer element), and Rumble content (rumble-party.js swaps
 * embeds to the Rumble JS-API player). Other third-party embeds sync per
 * episode only. A small draggable overlay shows live chat without covering
 * the player, with one-click Disconnect.
 *
 * Requires an AniList login (vw_anilist) — chat/host names and avatars
 * come from the AniList profile. BETA: sync uses a public MQTT relay
 * (broker.emqx.io over WSS) — no Virowatch backend. Messages are not
 * encrypted; don't share secrets in chat. Private parties are simply
 * unlisted (join needs the code).
 *
 * Wire-up:
 *  - mqtt.js is lazy-loaded from unpkg the first time the modal opens.
 *  - Host: window "vw-cw-updated" (content.js saveState) → publish
 *    localStorage.lastState as the party state (retained).
 *  - Viewer: state message → window.viroResume(cat, mov, season, ep, dub).
 */
(function () {
  'use strict';

  var MQTT_CDN = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ];
  var NS = 'virowatch/wp/1'; // topic namespace (bump on breaking changes)
  var LIST_TTL = 3 * 60 * 1000; // public listings older than this are stale
  var HEARTBEAT = 45 * 1000; // host re-advertises the listing this often
  var CHAT_MAX = 200;
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  /* Timestamp sync (only possible on the native Backup <video> player —
     third-party embed iframes expose no time/seek API): */
  var TIME_PUB = 4000; // host publishes its clock this often
  var TIME_CHECK = 2000; // viewer compares against the host clock this often
  var AHEAD_TOL = 5; // s ahead of the host → snap back
  var BEHIND_TOL = 15; // s behind the host → catch up
  var PAUSE_SNAP = 3; // s drift allowed while the host is paused

  var client = null; // mqtt client (shared: listing + party)
  var connecting = null; // Promise while connecting
  var brokerIdx = 0;
  var party = null; // {code, role:'host'|'viewer', hostName, public, name}
  var lastAppliedSig = ''; // viewer: last state signature applied
  var applying = false;
  var pendingState = null;
  var listings = {}; // code → {code,host,avatar,title,t}
  var listingTimer = 0;
  var chatCooldown = 0;
  var hostClock = null; // viewer: last {pos,dur,paused,sig,at} from the host
  var timePubTimer = 0; // host
  var timeCheckTimer = 0; // viewer
  var pipWin = null; // Document Picture-in-Picture window holding the chat
  var fsHintShown = false;

  /* ── AniList identity (the beta gate) ─────────────────────────── */
  function getAuth() {
    try {
      var a = JSON.parse(localStorage.getItem('vw_anilist') || 'null');
      return a && a.userId ? a : null;
    } catch (_) {
      return null;
    }
  }

  /* ── Toast (same #vwl-toast as anilist.js/watchlist.js) ───────── */
  function toast(msg, isError) {
    var t = document.getElementById('vwl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'vwl-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.borderColor = isError ? 'rgba(255,80,80,.4)' : '';
    t.className = 'vwl-show';
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.className = ''; t.style.borderColor = ''; }, 3200);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function makeCode() {
    var s = '';
    for (var i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  /* ── MQTT plumbing ────────────────────────────────────────────── */
  function loadMqttLib() {
    if (window.mqtt) return Promise.resolve();
    if (loadMqttLib._p) return loadMqttLib._p;
    loadMqttLib._p = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = MQTT_CDN;
      s.onload = function () { res(); };
      s.onerror = function () { loadMqttLib._p = null; rej(new Error('mqtt lib failed')); };
      document.head.appendChild(s);
    });
    return loadMqttLib._p;
  }

  function connect() {
    if (client && client.connected) return Promise.resolve(client);
    if (connecting) return connecting;
    connecting = loadMqttLib().then(function () {
      return new Promise(function (res, rej) {
        var url = BROKERS[brokerIdx % BROKERS.length];
        var c = window.mqtt.connect(url, {
          clientId: 'vw_' + Math.random().toString(36).slice(2, 12),
          clean: true,
          keepalive: 30,
          connectTimeout: 8000,
          reconnectPeriod: 3000,
        });
        var settled = false;
        c.on('connect', function () {
          if (!settled) { settled = true; client = c; connecting = null; res(c); }
        });
        c.on('error', function () {
          if (!settled) {
            settled = true;
            connecting = null;
            c.end(true);
            brokerIdx++; // next open tries the fallback broker
            rej(new Error('relay unreachable'));
          }
        });
        c.on('message', onMessage);
      });
    }, function (e) { connecting = null; throw e; });
    return connecting;
  }

  function pub(topic, obj, retain) {
    if (!client) return;
    client.publish(topic, obj === null ? '' : JSON.stringify(obj), {
      qos: 0,
      retain: !!retain,
    });
  }

  function onMessage(topic, payload) {
    var msg = null;
    if (payload && payload.length) {
      try { msg = JSON.parse(payload.toString()); } catch (_) { return; }
    }

    // Public party listings (modal browse view)
    if (topic.indexOf(NS + '/list/') === 0) {
      var code = topic.slice((NS + '/list/').length);
      if (!msg) delete listings[code];
      else listings[code] = msg;
      renderPublicList();
      return;
    }

    if (!party) return;
    var base = NS + '/r/' + party.code;

    if (topic === base + '/state') {
      if (!msg) return;
      if (msg.end) {
        if (party.role === 'viewer') {
          toast('Watch party ended by the host');
          leaveParty(true);
        }
        return;
      }
      if (party.role !== 'viewer') return; // host ignores its own echo
      if (msg.cat && msg.mov) {
        applyState(msg);
        updateOverlayTitle(msg.title || '');
      } // else: host hasn't played anything yet — keep "waiting for the host…"
      return;
    }

    if (topic === base + '/time') {
      if (msg && party.role === 'viewer') hostClock = msg;
      return;
    }

    if (topic === base + '/chat') {
      if (!msg) return;
      if (msg.sys) {
        addChatLine(null, msg.n ? msg.n + ' ' + msg.sys : '', true);
        return;
      }
      if (typeof msg.x !== 'string') return;
      addChatLine(msg.n || '?', msg.x.slice(0, CHAT_MAX), false, msg.a || '');
    }
  }

  /* ── Viewer: follow the host ──────────────────────────────────── */
  function stateSig(s) {
    return [s.cat, s.mov, s.season || '', s.ep || 0, s.dub ? 1 : 0].join('|');
  }

  function applyState(s) {
    if (!s || !s.cat || !s.mov) return;
    var sig = stateSig(s);
    if (sig === lastAppliedSig) return;
    if (applying) { pendingState = s; return; }
    applying = true;
    lastAppliedSig = sig;
    Promise.resolve(
      typeof window.viroResume === 'function' &&
        window.viroResume(s.cat, s.mov, s.season, s.ep, !!s.dub)
    )
      .catch(function () {})
      .then(function () {
        applying = false;
        if (pendingState) {
          var next = pendingState;
          pendingState = null;
          applyState(next);
        }
      });
  }

  /* ── Host: broadcast what's playing ───────────────────────────── */
  function currentState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem('lastState') || 'null'); } catch (_) {}
    if (!s || !s.cat || !s.mov || s.mov === 'PITSORT') return null;
    var title = '';
    try {
      var cw = JSON.parse(localStorage.getItem('vw_continue') || '[]');
      if (cw[0] && cw[0].cat === s.cat && cw[0].mov === s.mov) title = cw[0].title || '';
    } catch (_) {}
    return {
      cat: s.cat, mov: s.mov, season: s.season || null,
      ep: s.ep || 0, dub: !!s.dubbed, title: title, t: Date.now(),
    };
  }

  function hostBroadcast() {
    if (!party || party.role !== 'host' || !client) return;
    var s = currentState();
    if (!s) return;
    pub(NS + '/r/' + party.code + '/state', s, true);
    updateOverlayTitle(s.title || '');
    if (party.public) advertise(s.title);
  }

  function advertise(title) {
    if (!party || party.role !== 'host' || !party.public) return;
    var a = getAuth();
    pub(NS + '/list/' + party.code, {
      code: party.code,
      host: (a && a.name) || 'host',
      avatar: (a && a.avatar) || '',
      title: title || (currentState() || {}).title || '',
      t: Date.now(),
    }, true);
  }

  window.addEventListener('vw-cw-updated', hostBroadcast);

  /* ── Timestamp sync ───────────────────────────────────────────
     Works on any player the page can read and seek:
       - the anime Backup player (#viroBackupPlayer, a native <video>) —
         megaplay-backup.js forces it while a party is on (unless Vidnest
         API is already active for the episode, see below),
       - Vidnest's player (#vidnestDirectPlayer, also a native <video>) —
         covers both Vidnest movies/shows (the only source for those) and
         the anime "Vidnest API" merge button,
       - Rumble content via rumble-party.js (Rumble JS-API player).
     Host publishes its clock; a viewer that drifts past the host gets
     snapped back (repeatedly, until the host moves on), pauses when the
     host pauses, and catches up when it falls far behind. Other embed
     iframes can't be read or seeked — those stay episode-level only. */
  // Wraps a plain <video> (viroBackupPlayer or vidnestDirectPlayer — same
  // shape, both readable/seekable native elements) into a sync target.
  function videoTarget(v) {
    return {
      getTime: function () { return v.currentTime || 0; },
      getDuration: function () { return v.duration || 0; },
      getPaused: function () { return !!v.paused; },
      seek: function (t) { try { v.currentTime = t; } catch (_) {} },
      play: function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); },
      pause: function () { try { v.pause(); } catch (_) {} },
      hookInstant: function (fn) {
        if (v._wpHooked) return;
        v._wpHooked = true;
        ['pause', 'play', 'seeked'].forEach(function (ev) {
          v.addEventListener(ev, fn);
        });
      },
    };
  }

  function syncTarget() {
    // offsetParent (not style.display on the video itself) is the correct
    // visibility check — both players are wrapped in their own positioning
    // frame (#viroBackupFrame / #vidnestFrame) whose display is what
    // actually toggles; the <video>'s own inline display stays put.
    var v = document.getElementById('viroBackupPlayer');
    if (v && v.offsetParent !== null && v.readyState >= 1) return videoTarget(v);
    // vidnestDirectPlayer covers both the anime-merge button and the
    // movies/shows direct-play flow — same element either way.
    var vn = document.getElementById('vidnestDirectPlayer');
    if (vn && vn.offsetParent !== null && vn.readyState >= 1) return videoTarget(vn);
    var r = window.vwRumbleParty;
    if (r && typeof r.target === 'function') return r.target(); // null unless live
    return null;
  }

  function hostBroadcastTime() {
    if (!party || party.role !== 'host' || !client) return;
    var t = syncTarget();
    if (!t) return;
    // pause/play/seek publish instantly instead of waiting a tick
    t.hookInstant(hostBroadcastTime);
    var s = currentState();
    pub(NS + '/r/' + party.code + '/time', {
      pos: t.getTime(),
      dur: t.getDuration(),
      paused: t.getPaused(),
      sig: s ? stateSig(s) : '',
      at: Date.now(),
    }, true);
  }

  function viewerTimeCheck() {
    if (!party || party.role !== 'viewer' || !hostClock) return;
    var t = syncTarget();
    if (!t) return;
    if (hostClock.sig && hostClock.sig !== lastAppliedSig) return; // other episode
    if (Date.now() - hostClock.at > 30000) return; // stale clock — host gone quiet

    if (hostClock.paused) {
      // Host paused: hold everyone at the host's timestamp
      if (!t.getPaused()) t.pause();
      if (Math.abs(t.getTime() - hostClock.pos) > PAUSE_SNAP) {
        t.seek(hostClock.pos);
      }
      return;
    }
    // Host playing: expected position = published pos + time since publish
    var expected = hostClock.pos + (Date.now() - hostClock.at) / 1000;
    if (hostClock.dur) expected = Math.min(expected, hostClock.dur);
    if (t.getPaused()) t.play();
    var drift = t.getTime() - expected;
    if (drift > AHEAD_TOL || drift < -BEHIND_TOL) {
      t.seek(Math.max(0, expected));
    }
  }

  /* ── Party lifecycle ──────────────────────────────────────────── */
  /* Player modules check this before picking a player (megaplay-backup.js
     forces the Backup player, rumble-party.js swaps Rumble embeds to the
     JS-API player) and re-check on the vw-party-changed event. */
  window.vwPartyActive = function () { return !!party; };
  function partyChanged() {
    window.dispatchEvent(new CustomEvent('vw-party-changed', {
      detail: { active: !!party, role: party ? party.role : null },
    }));
  }

  function hostParty(isPublic) {
    return connect().then(function () {
      party = { code: makeCode(), role: 'host', public: !!isPublic };
      client.subscribe(NS + '/r/' + party.code + '/chat');
      var s = currentState();
      pub(NS + '/r/' + party.code + '/state', s || { wait: true, t: Date.now() }, true);
      clearInterval(timePubTimer);
      timePubTimer = setInterval(hostBroadcastTime, TIME_PUB);
      if (s) updateOverlayTitle(s.title || '');
      if (party.public) {
        advertise();
        clearInterval(party._hb);
        party._hb = setInterval(advertise, HEARTBEAT);
      }
      sysChat('started the party');
      showOverlay();
      renderModal();
      partyChanged();
    });
  }

  function joinParty(code) {
    code = (code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      toast('Party codes are 6 letters/numbers', true);
      return Promise.resolve();
    }
    return connect().then(function () {
      party = { code: code, role: 'viewer' };
      lastAppliedSig = '';
      hostClock = null;
      client.subscribe(NS + '/r/' + code + '/state'); // retained → current show arrives at once
      client.subscribe(NS + '/r/' + code + '/chat');
      client.subscribe(NS + '/r/' + code + '/time'); // retained → late joiners land at the host's clock
      clearInterval(timeCheckTimer);
      timeCheckTimer = setInterval(viewerTimeCheck, TIME_CHECK);
      sysChat('joined');
      showOverlay();
      updateOverlayTitle('waiting for the host…');
      renderModal();
      partyChanged();
      toast('Joined party ' + code);
    });
  }

  function leaveParty(silent) {
    if (!party) return;
    var base = NS + '/r/' + party.code;
    if (client && client.connected) {
      if (party.role === 'host') {
        sysChat('ended the party');
        pub(base + '/state', { end: true, t: Date.now() }, true);
        pub(base + '/time', null, true); // clear the retained clock
        pub(NS + '/list/' + party.code, null, true); // clear the public listing
      } else {
        sysChat('left');
      }
      client.unsubscribe(base + '/state');
      client.unsubscribe(base + '/chat');
      client.unsubscribe(base + '/time');
    }
    clearInterval(party._hb);
    clearInterval(timePubTimer);
    clearInterval(timeCheckTimer);
    hostClock = null;
    party = null;
    lastAppliedSig = '';
    pendingState = null;
    if (pipWin) { try { pipWin.close(); } catch (_) {} }
    hideOverlay();
    renderModal();
    partyChanged();
    if (!silent) toast('Left the watch party');
  }

  function sysChat(action) {
    var a = getAuth();
    pub(NS + '/r/' + (party && party.code) + '/chat', {
      sys: action, n: (a && a.name) || 'someone', t: Date.now(),
    });
  }

  function sendChat(text) {
    text = (text || '').trim().slice(0, CHAT_MAX);
    if (!text || !party || !client) return;
    if (Date.now() < chatCooldown) return;
    chatCooldown = Date.now() + 1200;
    var a = getAuth();
    pub(NS + '/r/' + party.code + '/chat', {
      n: (a && a.name) || 'anon', a: (a && a.avatar) || '', x: text, t: Date.now(),
    });
  }

  /* ── Chat overlay (top-left, over the player, unobtrusive) ────── */
  var overlayEl = null;
  var ui = null; // {bar,label,pin,chatBox,now,msgs,input} — refs survive the PiP move

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = el('div', 'wp-overlay');
    overlayEl.id = 'wpOverlay';

    var bar = el('div', 'wp-bar');
    var dot = el('span', 'wp-dot');
    var label = el('span', 'wp-bar-label', 'Party');
    var pin = el('button', 'wp-mini-btn', '📌');
    pin.type = 'button';
    pin.title = 'Pin chat — floats above fullscreen video';
    var collapse = el('button', 'wp-mini-btn', '–');
    collapse.type = 'button';
    collapse.title = 'Collapse chat';
    var leave = el('button', 'wp-mini-btn wp-leave', '✕');
    leave.type = 'button';
    leave.title = 'Disconnect from the watch party';
    bar.appendChild(dot);
    bar.appendChild(label);
    bar.appendChild(pin);
    bar.appendChild(collapse);
    bar.appendChild(leave);

    // Everything below the bar lives in one movable box (page ↔ PiP window)
    var chatBox = el('div', 'wp-chatbox');
    var title = el('div', 'wp-now', '');
    var msgs = el('div', 'wp-msgs');
    var row = el('div', 'wp-inputrow');
    var input = el('input', 'wp-input');
    input.type = 'text';
    input.placeholder = 'Say something…';
    input.maxLength = CHAT_MAX;
    input.autocomplete = 'off';
    var send = el('button', 'wp-mini-btn', '➤');
    send.type = 'button';
    send.title = 'Send';
    row.appendChild(input);
    row.appendChild(send);
    chatBox.appendChild(title);
    chatBox.appendChild(msgs);
    chatBox.appendChild(row);

    overlayEl.appendChild(bar);
    overlayEl.appendChild(chatBox);
    document.body.appendChild(overlayEl);
    ui = { bar: bar, label: label, pin: pin, chatBox: chatBox, now: title, msgs: msgs, input: input };

    function doSend() {
      sendChat(input.value);
      input.value = '';
      input.focus();
    }
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (e) {
      e.stopPropagation(); // keep player/global hotkeys out of the chat box
      if (e.key === 'Enter') doSend();
    });
    collapse.addEventListener('click', function () {
      var min = overlayEl.classList.toggle('wp-min');
      collapse.textContent = min ? '+' : '–';
      collapse.title = min ? 'Expand chat' : 'Collapse chat';
    });
    pin.addEventListener('click', togglePin);
    leave.addEventListener('click', function () { leaveParty(); });

    makeDraggable(bar);
    try {
      var pos = JSON.parse(localStorage.getItem('vw_wp_pos') || 'null');
      if (pos) setOverlayPos(pos.x, pos.y);
    } catch (_) {}
    window.addEventListener('resize', function () {
      if (overlayEl.classList.contains('wp-on')) {
        setOverlayPos(overlayEl.offsetLeft, overlayEl.offsetTop);
      }
    });
    return overlayEl;
  }

  /* Drag by the header bar — so it can be moved off the player's back
     button (or anywhere). Position sticks across sessions. */
  function setOverlayPos(x, y) {
    var w = overlayEl.offsetWidth || 288;
    x = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - 46)); // keep the bar grabbable
    overlayEl.style.left = x + 'px';
    overlayEl.style.top = y + 'px';
  }

  function makeDraggable(bar) {
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.wp-mini-btn')) return;
      dragging = true;
      overlayEl.classList.add('wp-drag');
      ox = overlayEl.offsetLeft;
      oy = overlayEl.offsetTop;
      sx = e.clientX;
      sy = e.clientY;
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    });
    bar.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      setOverlayPos(ox + e.clientX - sx, oy + e.clientY - sy);
    });
    function stop() {
      if (!dragging) return;
      dragging = false;
      overlayEl.classList.remove('wp-drag');
      try {
        localStorage.setItem('vw_wp_pos',
          JSON.stringify({ x: overlayEl.offsetLeft, y: overlayEl.offsetTop }));
      } catch (_) {}
    }
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  }

  function showOverlay() {
    ensureOverlay();
    if (ui && party) {
      ui.label.textContent = (party.role === 'host' ? 'Hosting ' : 'Party ') + party.code;
      ui.msgs.innerHTML = '';
    }
    overlayEl.classList.add('wp-on');
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.classList.remove('wp-on');
  }

  function updateOverlayTitle(text) {
    if (ui) ui.now.textContent = text ? '▶ ' + text : '';
  }

  /* ── Pinned chat: Document Picture-in-Picture ─────────────────
     Native <video> fullscreen hides everything but the video itself, so
     an on-page overlay can't show there. A Document PiP window floats
     above fullscreen (Chrome/Edge 116+). The pin button moves the chat
     box into that window; closing it moves the chat back. */
  function togglePin() {
    if (pipWin) { try { pipWin.close(); } catch (_) {} return; }
    if (!('documentPictureInPicture' in window)) {
      toast('Pinned chat needs Chrome or Edge', true);
      return;
    }
    window.documentPictureInPicture
      .requestWindow({ width: 320, height: 340 })
      .then(function (w) {
        pipWin = w;
        w.document.title = 'Party chat';
        // Self-contained styles — cloned stylesheets don't reliably load in
        // the PiP document, and this window should look right on its own.
        var st = w.document.createElement('style');
        st.textContent =
          'body{margin:0;height:100vh;overflow:hidden;background:#0e0e11;' +
          'color:#e8e8ea;font-family:Kanit,system-ui,sans-serif}' +
          '.wp-chatbox{display:flex;flex-direction:column;height:100%;' +
          'box-sizing:border-box;padding:12px 12px 10px}' +
          '.wp-now{font-size:12px;font-weight:300;color:rgba(255,255,255,.5);' +
          'padding:0 2px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '.wp-now:empty{display:none}' +
          '.wp-msgs{flex:1;display:flex;flex-direction:column;gap:8px;' +
          'overflow-y:auto;padding:2px;scrollbar-width:thin;' +
          'scrollbar-color:rgba(255,255,255,.18) transparent}' +
          '.wp-msg{display:flex;align-items:flex-start;gap:8px;font-size:13px;' +
          'font-weight:300;color:rgba(255,255,255,.85);line-height:1.45;opacity:1!important}' +
          '.wp-msg b{font-weight:500;color:#fff}' +
          '.wp-msg.wp-sys{color:rgba(255,255,255,.38);font-style:italic}' +
          '.wp-ava{width:20px;height:20px;border-radius:50%;object-fit:cover;' +
          'flex-shrink:0;margin-top:1px}' +
          '.wp-inputrow{display:flex;gap:8px;align-items:center;padding-top:10px;' +
          'margin-top:8px;border-top:1px solid rgba(255,255,255,.09)}' +
          '.wp-input{flex:1;min-width:0;background:rgba(255,255,255,.07);' +
          'border:1px solid rgba(255,255,255,.12);border-radius:99px;' +
          'padding:7px 14px;color:#eee;font-family:inherit;font-size:13px;' +
          'font-weight:300;outline:none}' +
          '.wp-input:focus{border-color:rgba(255,255,255,.3)}' +
          '.wp-mini-btn{flex-shrink:0;width:32px;height:32px;border-radius:50%;' +
          'border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);' +
          'color:#eee;font-size:13px;cursor:pointer}' +
          '.wp-mini-btn:hover{background:rgba(255,255,255,.16)}';
        w.document.head.appendChild(st);
        // Kanit comes from Google Fonts (https) — safe to reuse in the PiP doc
        var font = document.querySelector('link[href*="fonts.googleapis"]');
        if (font) {
          var fl = w.document.createElement('link');
          fl.rel = 'stylesheet';
          fl.href = font.href;
          w.document.head.appendChild(fl);
        }
        w.document.body.appendChild(ui.chatBox);
        ui.chatBox.classList.add('wp-in-pip');
        ui.pin.classList.add('wp-pin-on');
        ui.pin.title = 'Unpin chat';
        w.addEventListener('pagehide', function () {
          ui.chatBox.classList.remove('wp-in-pip');
          if (overlayEl) overlayEl.appendChild(ui.chatBox);
          if (ui.pin) { ui.pin.classList.remove('wp-pin-on'); ui.pin.title = 'Pin chat — floats above fullscreen video'; }
          pipWin = null;
        });
      })
      .catch(function () {
        toast('Couldn’t open the pinned chat window', true);
      });
  }

  // Nudge once: chat can't render over native fullscreen unless pinned
  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement && party && !pipWin && !fsHintShown) {
      fsHintShown = true;
      toast('Chat hides in fullscreen — press 📌 on the party bar to pin it');
    }
  });

  function addChatLine(name, text, isSys, avatar) {
    var msgs = ui && ui.msgs;
    if (!msgs) return;
    var line = el('div', 'wp-msg' + (isSys ? ' wp-sys' : ''));
    if (isSys) {
      line.textContent = '· ' + text;
    } else {
      if (avatar) {
        var im = el('img', 'wp-ava');
        im.src = avatar;
        im.alt = '';
        line.appendChild(im);
      }
      line.appendChild(el('b', null, name + ' '));
      line.appendChild(document.createTextNode(text));
    }
    msgs.appendChild(line);
    // corner overlay stays tiny; the pinned PiP window can hold history
    while (msgs.children.length > (pipWin ? 60 : 6)) msgs.removeChild(msgs.firstChild);
    if (pipWin) msgs.scrollTop = msgs.scrollHeight;
    // old lines fade so the corner stays quiet (not in the pinned window)
    clearTimeout(line._fade);
    if (!pipWin) {
      line._fade = setTimeout(function () { line.classList.add('wp-old'); }, 12000);
    }
  }

  /* ── Modal (rail button) ──────────────────────────────────────── */
  var modal = null;

  function ensureModal() {
    if (modal) return modal;
    modal = el('div', 'vws-overlay wp-modal-overlay');
    modal.id = 'wpModalOverlay';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML =
      '<div class="vws-modal anl-modal" role="dialog" aria-modal="true" aria-label="Watch party">' +
        '<div class="vws-header">' +
          '<span class="anl-logo">⛬</span>' +
          '<div><div class="vws-title">Watch party <span class="wp-beta">BETA</span></div>' +
          '<div class="vws-sub">Watch together, synced to the host</div></div>' +
          '<button type="button" class="vws-close" id="wpClose" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="vws-body" id="wpBody"></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('mousedown', function (e) {
      if (e.target === modal) closeModal();
    });
    modal.querySelector('#wpClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('vws-open')) closeModal();
    });
    return modal;
  }

  function openModal() {
    ensureModal();
    renderModal();
    modal.classList.add('vws-open');
    modal.setAttribute('aria-hidden', 'false');
    if (window.vwSettingsClose) window.vwSettingsClose();
    // Browse public parties while the modal is open
    if (getAuth() && !party) {
      connect().then(function () {
        client.subscribe(NS + '/list/+');
      }).catch(function () {
        var s = document.getElementById('wpStatus');
        if (s) s.textContent = 'Relay unreachable — try again in a moment.';
      });
    }
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('vws-open');
    modal.setAttribute('aria-hidden', 'true');
    if (client && client.connected && !party) client.unsubscribe(NS + '/list/+');
  }

  function renderModal() {
    if (!modal) return;
    var body = modal.querySelector('#wpBody');
    if (!body) return;
    body.innerHTML = '';
    var a = getAuth();

    /* Gate: AniList login required (beta) */
    if (!a) {
      body.appendChild(el('div', 'anl-step',
        'Watch parties are in beta and need an AniList login — your AniList ' +
        'name and avatar are your identity in the party chat.'));
      var loginBtn = el('button', 'app-sidebar-import-btn anl-go', 'Log in with AniList');
      loginBtn.type = 'button';
      loginBtn.addEventListener('click', function () {
        closeModal();
        var b = document.getElementById('railAniListBtn');
        if (b) b.click();
      });
      body.appendChild(loginBtn);
      return;
    }

    /* In a party */
    if (party) {
      var acc = el('div', 'anilist-account');
      acc.appendChild(el('span', 'anilist-name',
        (party.role === 'host' ? 'Hosting party ' : 'In party ') + party.code));
      acc.appendChild(el('span', 'anilist-badge', party.role === 'host'
        ? (party.public ? 'Public' : 'Private') : 'Viewer'));
      body.appendChild(acc);

      if (party.role === 'host') {
        var copyBtn = el('button', 'app-sidebar-import-btn', '⧉ Copy invite code');
        copyBtn.type = 'button';
        copyBtn.addEventListener('click', function () {
          try { navigator.clipboard.writeText(party.code); toast('Code copied: ' + party.code); }
          catch (_) { toast(party.code); }
        });
        body.appendChild(copyBtn);
        body.appendChild(el('div', 'anilist-hint',
          'Just play something — everyone in the party follows what you watch, ' +
          'episode by episode.'));
      } else {
        body.appendChild(el('div', 'anilist-hint',
          'You’re following the host. When they switch shows or episodes, ' +
          'your player follows.'));
      }

      var leaveBtn = el('button', 'app-sidebar-import-btn wp-disconnect', 'Disconnect');
      leaveBtn.type = 'button';
      leaveBtn.addEventListener('click', function () { leaveParty(); });
      body.appendChild(leaveBtn);
      return;
    }

    /* Not in a party: host / join */
    var hostLabel = el('span', 'app-sidebar-theme-label', 'Host a party');
    body.appendChild(hostLabel);

    var pubRow = el('label', 'vws-toggle-row');
    var pubText = el('span', 'vws-toggle-text');
    pubText.appendChild(el('span', 'vws-toggle-title', 'List publicly'));
    pubText.appendChild(el('span', 'vws-toggle-sub',
      'Public parties show up below for everyone. Off = private, join by code only.'));
    var pubSwitch = el('input', 'vws-switch');
    pubSwitch.type = 'checkbox';
    pubRow.appendChild(pubText);
    pubRow.appendChild(pubSwitch);
    body.appendChild(pubRow);

    var hostBtn = el('button', 'app-sidebar-import-btn anl-go', '▶ Start party');
    hostBtn.type = 'button';
    hostBtn.addEventListener('click', function () {
      hostBtn.disabled = true;
      hostBtn.textContent = 'Connecting…';
      hostParty(pubSwitch.checked).catch(function () {
        hostBtn.disabled = false;
        hostBtn.textContent = '▶ Start party';
        toast('Relay unreachable — try again', true);
      });
    });
    body.appendChild(hostBtn);

    body.appendChild(el('span', 'app-sidebar-theme-label wp-gap', 'Join with a code'));
    var joinRow = el('div', 'wp-joinrow');
    var codeInput = el('input', 'anilist-token-input wp-code');
    codeInput.type = 'text';
    codeInput.placeholder = 'ABC123';
    codeInput.maxLength = 6;
    codeInput.autocomplete = 'off';
    codeInput.spellcheck = false;
    var joinBtn = el('button', 'app-sidebar-import-btn wp-joinbtn', 'Join');
    joinBtn.type = 'button';
    function doJoin() {
      joinBtn.disabled = true;
      joinParty(codeInput.value).catch(function () {
        toast('Relay unreachable — try again', true);
      }).then(function () { joinBtn.disabled = false; });
    }
    joinBtn.addEventListener('click', doJoin);
    codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    joinRow.appendChild(codeInput);
    joinRow.appendChild(joinBtn);
    body.appendChild(joinRow);

    body.appendChild(el('span', 'app-sidebar-theme-label wp-gap', 'Public parties'));
    var list = el('div', 'wp-publist');
    list.id = 'wpPubList';
    body.appendChild(list);
    var status = el('div', 'anl-status', '');
    status.id = 'wpStatus';
    body.appendChild(status);
    renderPublicList();

    body.appendChild(el('div', 'anilist-hint wp-fineprint',
      'Beta: parties run over a public relay — chat is unencrypted, so keep it casual. ' +
      'Timestamp sync (pauses, seeking back to the host) works on anime (the Backup ' +
      'player is used automatically during parties, unless Vidnest API is already ' +
      'active), Vidnest movies/shows, and Rumble videos; other third-party embeds ' +
      'only sync per episode. Press 📌 on the party bar to keep chat visible in ' +
      'fullscreen.'));
  }

  function renderPublicList() {
    var list = document.getElementById('wpPubList');
    if (!list) return;
    list.innerHTML = '';
    var now = Date.now();
    var items = Object.keys(listings)
      .map(function (k) { return listings[k]; })
      .filter(function (p) { return p && p.code && now - (p.t || 0) < LIST_TTL; })
      .sort(function (x, y) { return (y.t || 0) - (x.t || 0); });
    if (!items.length) {
      list.appendChild(el('div', 'anilist-hint', 'No public parties right now — start one!'));
      return;
    }
    items.forEach(function (p) {
      var row = el('div', 'wp-pubrow');
      if (p.avatar) {
        var im = el('img', 'wp-ava');
        im.src = p.avatar;
        im.alt = '';
        row.appendChild(im);
      }
      var txt = el('span', 'wp-pubtext');
      txt.appendChild(el('b', null, p.host || 'host'));
      txt.appendChild(el('span', 'wp-pubtitle', p.title ? ' — ' + p.title : ' — idle'));
      row.appendChild(txt);
      var btn = el('button', 'wp-mini-btn wp-pubjoin', 'Join');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        joinParty(p.code).catch(function () { toast('Relay unreachable', true); });
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  /* ── Leave cleanly on tab close (best effort) ─────────────────── */
  window.addEventListener('beforeunload', function () {
    if (party) leaveParty(true);
  });

  /* ── Rail button + init ───────────────────────────────────────── */
  function init() {
    var anlBtn = document.getElementById('railAniListBtn');
    if (!anlBtn || !anlBtn.parentNode) return;
    var btn = el('button', 'rail-item');
    btn.id = 'railPartyBtn';
    btn.type = 'button';
    btn.title = 'Watch party (beta)';
    var icon = el('span', 'icon', '⛬');
    var label = el('span', 'rail-label', 'Watch party');
    btn.appendChild(icon);
    btn.appendChild(label);
    anlBtn.parentNode.insertBefore(btn, anlBtn);
    btn.addEventListener('click', function () {
      if (modal && modal.classList.contains('vws-open')) closeModal();
      else openModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
