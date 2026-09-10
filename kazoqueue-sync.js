/**
 * Virowatch × KazoQueue — Google-login watchlist sync  v1.0
 *
 * No Firebase console access needed. Login happens on KazoQueue's own
 * (authorized) origin: this opens sync-handoff.html in a popup, KazoQueue
 * posts back a Firebase refresh token, and everything after that is plain
 * Firestore REST (origin-free) with the same users/{uid} doc KazoQueue uses.
 *
 * Mapping is TMDB-id based, so movies/TV match exactly:
 *   KQ { tmdbId, mediaType: movie } ⇔ VW { key: VDM_<id>, cat: movies }
 *   KQ { tmdbId, mediaType: tv }    ⇔ VW { key: VDT_<id>, cat: shows }
 * Anime (incl. AniList entries) + native titles resolve through Vidnest's
 * TMDB search and push as TV/movies; ids are cached in vw_kq_tmdb.
 * Statuses: Watching/Completed map over; On Hold/Dropped fold to planning
 * locally but are preserved on push (kqStatus) so nothing gets clobbered.
 * KQ startDate/endDate ride on the watchlist startedAt/completedAt stamps.
 *
 * Friend deploys: KazoQueue-main/sync-handoff.html next to index.html.
 */
(function () {
  'use strict';

  var KQ_ORIGIN = 'https://kazoqueue.kazoqueue.workers.dev';
  var HANDOFF = KQ_ORIGIN + '/sync-handoff.html';
  var API_KEY = 'AIzaSyCa5DyvRsLOb-YULV5jb3DZnp_gGhCtH9A';
  var PROJECT = 'kazoqueue21';
  var LS_KEY = 'vw_kqsync';

  var sess = null; // { refreshToken, uid, name }
  try { sess = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) {}
  var idToken = null;
  var lastRemote = null; // last seen KQ watchlist array (merge base for pushes)
  var syncing = false;
  var pushTid = null;

  function saveSess(s) {
    sess = s;
    idToken = null;
    if (s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {} }
    else { try { localStorage.removeItem(LS_KEY); } catch (_) {} }
  }

  /* ── Token (securetoken REST — no origin check) ── */
  async function token(force) {
    if (idToken && !force) return idToken;
    if (!sess || !sess.refreshToken) throw new Error('not logged in');
    var r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.refreshToken),
    });
    if (!r.ok) {
      if (r.status === 400) { saveSess(null); updateRail(); renderModal(); throw new Error('Login expired — connect again'); }
      throw new Error('token refresh failed');
    }
    var j = await r.json();
    sess.refreshToken = j.refresh_token || sess.refreshToken; // rotation
    try { localStorage.setItem(LS_KEY, JSON.stringify(sess)); } catch (_) {}
    idToken = j.id_token;
    return idToken;
  }

  /* ── Firestore REST (typed values) ── */
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'object') {
      var f = {};
      for (var k in v) f[k] = enc(v[k]);
      return { mapValue: { fields: f } };
    }
    return { stringValue: String(v) };
  }
  function dec(v) {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (((v.arrayValue || {}).values) || []).map(dec);
    if ('mapValue' in v) {
      var o = {}, f = ((v.mapValue || {}).fields) || {};
      for (var k in f) o[k] = dec(f[k]);
      return o;
    }
    return null;
  }

  var FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  async function fsReq(method, path, body, retry) {
    var t = await token(false);
    var r = await fetch(FS + path + (path.indexOf('?') === -1 ? '?' : '&') + 'key=' + API_KEY, {
      method: method,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && !retry) { await token(true); return fsReq(method, path, body, true); }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('sync failed (' + r.status + ')');
    return r.json();
  }
  async function fsLoad() {
    var d = await fsReq('GET', '/users/' + encodeURIComponent(sess.uid));
    if (!d || !d.fields || !d.fields.watchlist) return [];
    var w = dec(d.fields.watchlist);
    return Array.isArray(w) ? w : [];
  }
  async function fsSave(list) {
    await fsReq('PATCH', '/users/' + encodeURIComponent(sess.uid) +
      '?updateMask.fieldPaths=watchlist&updateMask.fieldPaths=updatedAt', {
      fields: { watchlist: enc(list), updatedAt: enc(Date.now()) },
    });
  }

  /* ── Mapping ── */
  var KQ_TO_VW = { Watching: 'watching', Completed: 'watched' };
  var VW_TO_KQ = { watching: 'Watching', watched: 'Completed' };

  function tmdbOf(it) {
    if (!it || !it.key) return null;
    var m = /^(VDM_|VDT_)(\d+)$/.exec(it.key);
    if (!m) return null;
    return { id: +m[2], mediaType: m[1] === 'VDM_' ? 'movie' : 'tv' };
  }

  // TMDB id cache for non-VD items (anime, native titles): watchlist key → {id, mediaType}
  var TMDB_CACHE_KEY = 'vw_kq_tmdb';
  function tmdbCacheGet(key) {
    try { return JSON.parse(localStorage.getItem(TMDB_CACHE_KEY) || '{}')[key] || null; }
    catch (_) { return null; }
  }
  function tmdbCacheSet(key, t) {
    try {
      var m = JSON.parse(localStorage.getItem(TMDB_CACHE_KEY) || '{}');
      m[key] = t;
      localStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(m));
    } catch (_) {}
  }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  // Every watchlist item → TMDB {id, mediaType}, anime included (AniList
  // entries sync here too — KQ gets them as TV). VD keys are direct;
  // everything else resolves via Vidnest's TMDB search, then cached.
  async function resolveTmdb(it) {
    var direct = tmdbOf(it);
    if (direct) return direct;
    if (!it || !it.key || !it.title) return null;
    var hit = tmdbCacheGet(it.key);
    if (hit) return hit;
    if (typeof window.vidnestSearch !== 'function') return null;
    try {
      var res = await window.vidnestSearch(it.title);
      var pool = res || [];
      if (it.cat === 'anime') pool = pool.filter(function (r) { return r.key.indexOf('VDT_') === 0; });
      else if (it.cat === 'movies') pool = pool.filter(function (r) { return r.key.indexOf('VDM_') === 0; });
      else if (it.cat === 'shows') pool = pool.filter(function (r) { return r.key.indexOf('VDT_') === 0; });
      pool.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      if (!pool.length) return null;
      var m = /^(VDM_|VDT_)(\d+)$/.exec(pool[0].key);
      if (!m) return null;
      var t = { id: +m[2], mediaType: m[1] === 'VDM_' ? 'movie' : 'tv' };
      tmdbCacheSet(it.key, t);
      return t;
    } catch (_) { return null; }
  }

  // All pushable local items with their TMDB ids (searches run sequential +
  // polite; cached after the first sync).
  async function localPushable() {
    var list = typeof window.vwlGet === 'function' ? window.vwlGet() : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = await resolveTmdb(list[i]);
      if (t) out.push({ item: list[i], t: t });
      if (!tmdbOf(list[i])) await sleep(250);
    }
    return out;
  }
  function kqToVw(k) {
    if (!k || !k.tmdbId) return null;
    var isMovie = k.mediaType !== 'tv';
    var ur = parseFloat(k.userRating);
    return {
      key: (isMovie ? 'VDM_' : 'VDT_') + k.tmdbId,
      title: k.title || ('TMDB ' + k.tmdbId),
      image: k.img || '',
      cat: isMovie ? 'movies' : 'shows',
      status: KQ_TO_VW[k.status] || 'planning',
      kqStatus: k.status || 'Plan to Watch',
      startedAt: k.startDate || undefined,
      completedAt: k.endDate || undefined,
      rating: ur > 0 ? Math.min(5, Math.round(ur) / 2) : undefined, // KQ 1–10 → VW stars
      updatedAt: k.updatedAt || 0,
    };
  }
  function vwToKq(it, t) {
    if (!it || !t) return null;
    var st = VW_TO_KQ[it.status] ||
      ((it.status === 'planning' && (it.kqStatus === 'On Hold' || it.kqStatus === 'Dropped')) ? it.kqStatus : 'Plan to Watch');
    return {
      id: t.id + '-' + t.mediaType,
      tmdbId: t.id,
      mediaType: t.mediaType,
      title: it.title || ('TMDB ' + t.id),
      img: it.image || '',
      backdrop: '',
      meta: '',
      rating: 'N/A',
      tag: t.mediaType === 'tv' ? 'SERIES' : 'FILM',
      desc: '',
      genreIds: [],
      status: st,
      userRating: it.rating ? String(Math.round(it.rating * 2)) : '0', // VW stars → KQ 1–10
      rewatches: '0',
      startDate: it.startedAt || '',
      endDate: it.completedAt || '',
      updatedAt: Date.now(),
    };
  }

  function mergeKQ(remote, local) {
    var byId = new Map();
    (remote || []).forEach(function (i) { if (i && i.id) byId.set(i.id, i); });
    (local || []).forEach(function (i) {
      if (!i || !i.id) return;
      var e = byId.get(i.id);
      if (!e || (i.updatedAt || 0) >= (e.updatedAt || 0)) byId.set(i.id, i);
    });
    return Array.from(byId.values());
  }

  /* ── Sync ── */
  async function syncNow() {
    if (!sess || syncing) return;
    syncing = true;
    renderModal();
    try {
      toast('Syncing with KazoQueue…');
      var remote = await fsLoad();
      lastRemote = remote;

      // Pull: remote → local (bulk ops don't echo back)
      var toAdd = [], statusByKey = {}, datesByKey = {}, ratingsByKey = {};
      remote.forEach(function (k) {
        var v = kqToVw(k);
        if (!v) return;
        toAdd.push(v);
        statusByKey[v.key] = v.status;
        if (v.startedAt || v.completedAt) {
          datesByKey[v.key] = {};
          if (v.startedAt) datesByKey[v.key].startedAt = v.startedAt;
          if (v.completedAt) datesByKey[v.key].completedAt = v.completedAt;
        }
        if (v.rating) ratingsByKey[v.key] = v.rating;
      });
      var added = window.vwlBulkAdd ? window.vwlBulkAdd(toAdd) : 0;
      if (window.vwlBulkSetStatus) window.vwlBulkSetStatus(statusByKey);
      if (window.vwlBulkSetDates) window.vwlBulkSetDates(datesByKey);
      if (window.vwlBulkSetRatings) window.vwlBulkSetRatings(ratingsByKey);

      // Push: local-only / local-newer items win, then write once
      var pushable = await localPushable();
      var localKq = pushable.map(function (p) { return vwToKq(p.item, p.t); }).filter(Boolean);
      var merged = mergeKQ(remote, localKq);
      var pushed = 0;
      var remoteById = {};
      remote.forEach(function (k) { if (k && k.id) remoteById[k.id] = k; });
      localKq.forEach(function (k) {
        var e = remoteById[k.id];
        if (!e || (k.updatedAt || 0) >= (e.updatedAt || 0)) pushed++;
      });
      if (merged.length !== remote.length || pushed) {
        await fsSave(merged);
        lastRemote = merged;
      }
      try { localStorage.setItem('vw_kq_last_sync', String(Date.now())); } catch (_) {}
      toast('Synced — pulled ' + added + ', pushed ' + pushed);
    } catch (e) {
      toast((e && e.message) || 'KazoQueue sync failed', true);
    } finally {
      syncing = false;
      renderModal();
    }
  }
  window.vwKqSyncNow = syncNow;

  // Live push: every local watchlist mutation re-merges + writes (debounced).
  // vwl-updated also fires for pull-applies — the syncing flag eats the echo.
  window.addEventListener('vwl-updated', function () {
    if (!sess || syncing) return;
    clearTimeout(pushTid);
    pushTid = setTimeout(async function () {
      try {
        var remote = lastRemote || await fsLoad();
        var pushable = await localPushable();
        var merged = mergeKQ(remote, pushable.map(function (p) { return vwToKq(p.item, p.t); }).filter(Boolean));
        await fsSave(merged);
        lastRemote = merged;
      } catch (_) {}
    }, 2000);
  });

  /* ── Bridge login (popup on KQ origin) ── */
  var popTid = null;
  function login() {
    var req = Math.random().toString(36).slice(2) + Date.now().toString(36);
    var to = location.origin === 'null' ? '' : location.origin;
    var pop = window.open(HANDOFF + '?to=' + encodeURIComponent(to) + '&req=' + encodeURIComponent(req),
      'kqsync', 'width=480,height=600,noopener=no');
    if (!pop) { setStatus('Popup blocked — allow popups and try again.'); return; }
    setStatus('Waiting for KazoQueue login…');
    var done = false;
    function onMsg(e) {
      if (e.origin !== KQ_ORIGIN) return;
      var d = e.data || {};
      if (!d || d.type !== 'kazoqueue-sync-token' || d.req !== req || !d.refreshToken) return;
      done = true;
      window.removeEventListener('message', onMsg);
      clearTimeout(popTid);
      try { pop.close(); } catch (_) {}
      saveSess({ refreshToken: d.refreshToken, uid: d.uid, name: d.name || 'KazoQueue user' });
      updateRail();
      renderModal();
      toast('Connected as ' + sess.name);
      syncNow().catch(function () {});
    }
    window.addEventListener('message', onMsg);
    clearTimeout(popTid);
    popTid = setTimeout(function () {
      if (done) return;
      window.removeEventListener('message', onMsg);
      setStatus('No response — the handoff page may not be deployed yet (sync-handoff.html).');
    }, 90000);
  }

  function logout() {
    saveSess(null);
    lastRemote = null;
    updateRail();
    renderModal();
    toast('Disconnected from KazoQueue');
  }

  /* ── Rail + modal (same shell as anilist.js) ── */
  var overlay = null;
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setStatus(t) {
    var s = overlay && overlay.querySelector('#kqStatus');
    if (s) s.textContent = t;
  }
  function updateRail() {
    var label = document.getElementById('railKqLabel');
    var btn = document.getElementById('railKqBtn');
    if (!label) return;
    label.textContent = sess && sess.name ? sess.name : 'KazoQueue';
    if (btn) btn.title = sess && sess.name ? 'KazoQueue — ' + sess.name : 'KazoQueue sync';
  }
  function ensureModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'kqOverlay';
    overlay.className = 'vws-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="vws-modal" role="dialog" aria-modal="true" aria-label="KazoQueue">' +
        '<div class="vws-header">' +
          '<span class="anl-logo">▤</span>' +
          '<div><div class="vws-title">KazoQueue</div>' +
          '<div class="vws-sub">Watchlist sync</div></div>' +
          '<button type="button" class="vws-close" id="kqClose" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="vws-body" id="kqBody"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeModal(); });
    overlay.querySelector('#kqClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('vws-open')) closeModal();
    });
    return overlay;
  }
  function openModal() {
    ensureModal();
    renderModal();
    overlay.classList.add('vws-open');
    overlay.setAttribute('aria-hidden', 'false');
    if (window.vwSettingsClose) window.vwSettingsClose();
  }
  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove('vws-open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  function renderModal() {
    if (!overlay) return;
    var body = overlay.querySelector('#kqBody');
    if (!body) return;
    body.innerHTML = '';
    if (sess && sess.uid) {
      body.appendChild(el('div', 'anilist-hint', 'Connected as ' + (sess.name || 'KazoQueue user') + '. Movies and shows sync both ways.'));
      var syncBtn = el('button', 'app-sidebar-import-btn', syncing ? 'Syncing…' : '⇅ Sync now');
      syncBtn.type = 'button';
      syncBtn.disabled = syncing;
      syncBtn.addEventListener('click', syncNow);
      body.appendChild(syncBtn);
      var outBtn = el('button', 'app-sidebar-import-btn anl-logout', 'Log out');
      outBtn.type = 'button';
      outBtn.addEventListener('click', logout);
      body.appendChild(outBtn);
    } else {
      body.appendChild(el('div', 'anilist-hint',
        'Log in with the same Google account you use on KazoQueue. A KazoQueue popup handles the login — Virowatch only keeps a sync token.'));
      var goBtn = el('button', 'app-sidebar-import-btn', 'Continue with KazoQueue ↗');
      goBtn.type = 'button';
      goBtn.addEventListener('click', login);
      body.appendChild(goBtn);
    }
    body.appendChild(el('div', 'anl-status', ''));
    var st = body.lastChild;
    st.id = 'kqStatus';
  }

  function toast(msg, isError) {
    var t = document.getElementById('vwl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'vwl-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.borderColor = isError ? 'rgba(255,80,80,.4)' : '';
    t.className = 'vwl-show';
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.className = ''; t.style.borderColor = ''; }, 3200);
  }

  function init() {
    var btn = document.getElementById('railKqBtn');
    if (btn) btn.addEventListener('click', function () {
      if (overlay && overlay.classList.contains('vws-open')) closeModal();
      else openModal();
    });
    updateRail();
    if (sess && sess.uid) {
      var last = parseInt(localStorage.getItem('vw_kq_last_sync') || '0', 10);
      if (Date.now() - last > 30 * 60 * 1000) {
        setTimeout(function () { syncNow().catch(function () {}); }, 2500);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
