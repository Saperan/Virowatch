/**
 * Virowatch × AniList — account login + watchlist sync  v2.0
 *
 * Rail button (above Settings) opens the AniList modal:
 *  - Logged out: "Continue with AniList" opens AniList's approve page in a
 *    new tab (you log in there with your normal email/password); the code
 *    AniList shows is pasted below and login happens automatically —
 *    no Save button, and a first sync runs right away.
 *  - Logged in: avatar + name, "Sync now", "Log out".
 *  - While logged in, adding/removing anime on the watchlist is pushed to
 *    the AniList list automatically (watchlist.js calls vwAniListPush).
 *
 * SETUP (site owner, one time — makes the button one-click for everyone):
 *  1. anilist.co → Settings → Apps → Developer → "Create New Client"
 *  2. Redirect URL: https://anilist.co/api/v2/oauth/pin
 *  3. Put the client ID in CLIENT_ID below.
 */
(function () {
  'use strict';

  var CLIENT_ID = '45267'; // AniList API client "virowatch"
  var LS_KEY = 'vw_anilist';
  var API = 'https://graphql.anilist.co';
  var AUTH_URL =
    'https://anilist.co/api/v2/oauth/authorize?response_type=token&client_id=';

  var Q_VIEWER = 'query{Viewer{id name avatar{medium}}}';
  var Q_LIST =
    'query($userId:Int){MediaListCollection(userId:$userId,type:ANIME,' +
    'status_in:[CURRENT,PLANNING,PAUSED]){lists{entries{media{id ' +
    'title{romaji english}coverImage{large}}}}}}';
  var Q_ENTRY = 'query($mediaId:Int,$userId:Int){MediaList(mediaId:$mediaId,userId:$userId){id}}';
  var Q_FIND =
    'query($q:String){Page(perPage:8){media(search:$q,type:ANIME){id format ' +
    'title{romaji english}synonyms}}}';
  var M_SAVE  = 'mutation($mediaId:Int){SaveMediaListEntry(mediaId:$mediaId,status:PLANNING){id}}';
  var M_DEL   = 'mutation($id:Int){DeleteMediaListEntry(id:$id){deleted}}';

  /* ─────────────────────────────────────────────────────
     Auth state
  ───────────────────────────────────────────────────── */
  var auth = null;
  try { auth = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) {}

  function saveAuth(a) {
    auth = a;
    if (a) localStorage.setItem(LS_KEY, JSON.stringify(a));
    else localStorage.removeItem(LS_KEY);
  }

  /* ─────────────────────────────────────────────────────
     GraphQL helper
  ───────────────────────────────────────────────────── */
  function gql(query, variables) {
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (auth && auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
    return fetch(API, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query: query, variables: variables || {} }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.errors && j.errors.length) {
        throw new Error(j.errors[0].message || 'AniList error');
      }
      return j.data;
    });
  }

  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  /* ─────────────────────────────────────────────────────
     Login / logout
  ───────────────────────────────────────────────────── */
  async function loginWithToken(token) {
    token = (token || '').trim().replace(/^Bearer\s+/i, '');
    if (!token) return false;
    var prev = auth;
    auth = { token: token };
    try {
      var d = await gql(Q_VIEWER);
      var v = d && d.Viewer;
      if (!v || !v.id) throw new Error('no viewer');
      saveAuth({
        token: token,
        userId: v.id,
        name: v.name || 'AniList user',
        avatar: (v.avatar && v.avatar.medium) || '',
      });
      return true;
    } catch (_) {
      auth = prev;
      return false;
    }
  }

  function logout() {
    saveAuth(null);
    updateRail();
    renderModal();
    toast('Logged out of AniList');
  }

  /* ─────────────────────────────────────────────────────
     Live push (called by watchlist.js on add/remove)
  ───────────────────────────────────────────────────── */
  var MAP_KEY = 'vw_anilist_map'; // watchlist key → AniList media id (title matches)

  function mapGet(key) {
    try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}')[key] || null; }
    catch (_) { return null; }
  }
  function mapSet(key, id) {
    try {
      var m = JSON.parse(localStorage.getItem(MAP_KEY) || '{}');
      m[key] = id;
      localStorage.setItem(MAP_KEY, JSON.stringify(m));
    } catch (_) {}
  }

  var NOISE_WORDS = { and: 1, und: 1 }; // "Girls & Panzer" ⇔ "Girls und Panzer"
  function titleTokens(s) {
    return (s || '')
      .replace(/['’ʼ´`]/g, '') // "JoJo's" ⇔ "JoJos"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(function (w) { return w && !NOISE_WORDS[w]; });
  }

  // Prefer the series over one-off cuts: specials/music/announced go last.
  var FMT_PENALTY = { TV: 0, TV_SHORT: 2, MOVIE: 3, OVA: 4, ONA: 4, SPECIAL: 20, MUSIC: 30 };
  function fmtPenalty(f) { return FMT_PENALTY[f] != null ? FMT_PENALTY[f] : 25; }

  /* AniList's fuzzy search often ranks a sequel/OVA/special above the
     series the title actually names — re-rank the result page: exact
     title (or synonym) match first, then fewest extra words, with the
     format weighting above (so "Evangelion" lands on the TV series, not
     an anniversary special whose synonym also matches). */
  function pickMedia(list, title) {
    var want = titleTokens(title);
    if (!want.length || !list.length) return list[0] || null;
    var wantKey = want.join(' ');
    var best = null, bestScore = Infinity;
    list.forEach(function (m) {
      var names = [m.title && m.title.romaji, m.title && m.title.english]
        .concat(m.synonyms || []);
      var nameScore = Infinity;
      names.forEach(function (n) {
        var have = titleTokens(n);
        if (!have.length) return;
        var s;
        if (have.join(' ') === wantKey) {
          s = 0; // exact title/synonym match
        } else {
          var allThere = want.every(function (w) { return have.indexOf(w) !== -1; });
          if (!allThere) return;
          s = 10 + (have.length - want.length) * 2;
        }
        if (s < nameScore) nameScore = s;
      });
      if (nameScore === Infinity) return;
      var score = nameScore + fmtPenalty(m.format);
      if (score < bestScore) { bestScore = score; best = m; }
    });
    return best || list[0];
  }

  /* Native Virowatch anime carry no AniList id — find the media by title
     search, cached per watchlist key so add and remove hit the same entry. */
  async function findByTitle(item) {
    var title = ((item.title || item.key) + '').trim();
    if (!title) return null;
    if (item.key) {
      var hit = mapGet(item.key);
      if (hit) return hit;
    }
    try {
      var clean = title.replace(/["“”]/g, '');
      var d = await gql(Q_FIND, { q: clean });
      var media = (d && d.Page && d.Page.media) || [];
      if (!media.length && /[a-rt-z]s\b/i.test(clean)) {
        // AniList search returns nothing for possessives missing their
        // apostrophe ("JoJos Bizarre Adventure") — retry without the s.
        d = await gql(Q_FIND, { q: clean.replace(/([a-rt-z])s\b/gi, '$1') });
        media = (d && d.Page && d.Page.media) || [];
      }
      // Still nothing (abbreviations, extra words) — shorten from the end:
      // "Miss Kuroitsu From MDD" → "Miss Kuroitsu From" (first hit wins).
      var words = clean.split(/\s+/);
      while (!media.length && words.length > 2) {
        words.pop();
        await sleep(350); // stay friendly with AniList rate limits
        d = await gql(Q_FIND, { q: words.join(' ') });
        media = (d && d.Page && d.Page.media) || [];
      }
      var m = pickMedia(media, title);
      if (m && m.id && item.key) mapSet(item.key, m.id);
      return (m && m.id) || null;
    } catch (_) { return null; } // "Not Found" = no AniList match for the title
  }

  async function resolveAniListId(item) {
    if (!item) return null;
    var aniId = item.aniId ||
      (item.key && item.key.indexOf('ANI_') === 0 ? item.key.slice(4) : null);
    if (aniId && typeof window.anikotoGetAniListId === 'function') {
      try {
        var id = await window.anikotoGetAniListId(aniId);
        if (id) return id;
      } catch (_) {}
    }
    // Shows/movies stay local — AniList is anime-only.
    if (item.cat !== 'anime' && !aniId) return null;
    return findByTitle(item);
  }

  window.vwAniListPush = async function (op, item) {
    if (!auth || !auth.userId) return;
    var mediaId = await resolveAniListId(item);
    if (!mediaId) return;
    try {
      if (op === 'add') {
        await gql(M_SAVE, { mediaId: mediaId });
        toast('Added to AniList: ' + (item.title || ''));
      } else if (op === 'remove') {
        var d = await gql(Q_ENTRY, { mediaId: mediaId, userId: auth.userId });
        var entryId = d && d.MediaList && d.MediaList.id;
        if (entryId) {
          await gql(M_DEL, { id: entryId });
          toast('Removed from AniList: ' + (item.title || ''));
        }
      }
    } catch (e) {
      // "Not Found" on remove = wasn't on the AniList list; stay quiet.
      if (op === 'add') toast('AniList sync failed — try Sync now later', true);
    }
  };

  /* ─────────────────────────────────────────────────────
     Full two-way sync
  ───────────────────────────────────────────────────── */
  var syncing = false;

  async function syncNow() {
    if (!auth || !auth.userId || syncing) return;
    syncing = true;
    renderModal();
    try {
      toast('Syncing with AniList…');

      /* 1. Pull — AniList → local watchlist */
      var d = await gql(Q_LIST, { userId: auth.userId });
      var lists = (d && d.MediaListCollection && d.MediaListCollection.lists) || [];
      var entries = [];
      lists.forEach(function (l) {
        (l.entries || []).forEach(function (e) { if (e.media) entries.push(e.media); });
      });

      if (window.anikotoEnsureIndex) await window.anikotoEnsureIndex();
      var canMatch = typeof window.anikotoFindByAniList === 'function';

      var remoteIds = new Set();
      var toAdd = [];
      var missing = 0;
      entries.forEach(function (m) {
        remoteIds.add(Number(m.id));
        if (!canMatch) return;
        var c = window.anikotoFindByAniList(m.id);
        if (!c) { missing++; return; }
        toAdd.push({
          key: 'ANI_' + c.id,
          title: c.title || (m.title && (m.title.english || m.title.romaji)) || '',
          image: c.poster || (m.coverImage && m.coverImage.large) || '',
          cat: 'anime',
          aniId: c.id,
        });
      });
      var added = window.vwlBulkAdd ? window.vwlBulkAdd(toAdd) : 0;

      /* 2. Push — local anime entries missing on AniList (as PLANNING).
         Anikoto entries map by id; native Virowatch anime match by title. */
      var local = (typeof window.vwlGet === 'function' ? window.vwlGet() : [])
        .filter(function (i) {
          return i && (i.cat === 'anime' || i.aniId ||
            (i.key && i.key.indexOf('ANI_') === 0));
        });
      var pushed = 0;
      for (var i = 0; i < local.length; i++) {
        var mediaId = await resolveAniListId(local[i]);
        if (!mediaId || remoteIds.has(Number(mediaId))) continue;
        try {
          await gql(M_SAVE, { mediaId: mediaId });
          pushed++;
          await sleep(400); // stay well under AniList rate limits
        } catch (_) {}
      }

      toast(
        'Synced — pulled ' + added + ', pushed ' + pushed +
        (missing ? ' (' + missing + ' not on Anikoto)' : '')
      );
    } catch (_) {
      toast('AniList sync failed — check connection', true);
    } finally {
      syncing = false;
      renderModal();
    }
  }

  /* ─────────────────────────────────────────────────────
     Rail button (above Settings)
  ───────────────────────────────────────────────────── */
  function updateRail() {
    var icon = document.getElementById('railAniListIcon');
    var label = document.getElementById('railAniListLabel');
    var btn = document.getElementById('railAniListBtn');
    if (!icon || !label) return;
    if (auth && auth.userId) {
      label.textContent = auth.name;
      if (btn) btn.title = 'AniList — ' + auth.name;
      if (auth.avatar) {
        icon.innerHTML = '';
        var img = document.createElement('img');
        img.className = 'rail-avatar';
        img.src = auth.avatar;
        img.alt = '';
        icon.appendChild(img);
      } else {
        icon.textContent = '◍';
      }
    } else {
      label.textContent = 'AniList';
      icon.textContent = '◍';
      if (btn) btn.title = 'AniList account';
    }
  }

  /* ─────────────────────────────────────────────────────
     Login modal
  ───────────────────────────────────────────────────── */
  var overlay = null;
  var checking = false;

  function ensureModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'anlOverlay';
    overlay.className = 'vws-overlay anl-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="vws-modal anl-modal" role="dialog" aria-modal="true" aria-label="AniList">' +
        '<div class="vws-header">' +
          '<span class="anl-logo">◍</span>' +
          '<div><div class="vws-title">AniList</div>' +
          '<div class="vws-sub">Watchlist sync</div></div>' +
          '<button type="button" class="vws-close" id="anlClose" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="vws-body" id="anlBody"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector('#anlClose').addEventListener('click', closeModal);
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
    if (window.vwSettingsClose) window.vwSettingsClose(); // one popup at a time
  }
  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove('vws-open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  function toggleModal() {
    if (overlay && overlay.classList.contains('vws-open')) closeModal();
    else openModal();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderModal() {
    if (!overlay) return;
    var body = overlay.querySelector('#anlBody');
    if (!body) return;
    body.innerHTML = '';

    /* ── Logged in ─────────────────────────────────── */
    if (auth && auth.userId) {
      var acc = el('div', 'anilist-account');
      var av = el('img', 'anilist-avatar');
      av.alt = '';
      if (auth.avatar) av.src = auth.avatar;
      else av.style.display = 'none';
      acc.appendChild(av);
      acc.appendChild(el('span', 'anilist-name', auth.name));
      acc.appendChild(el('span', 'anilist-badge', 'Connected'));
      body.appendChild(acc);

      var syncBtn = el('button', 'app-sidebar-import-btn',
        syncing ? 'Syncing…' : '⇅ Sync now');
      syncBtn.type = 'button';
      syncBtn.disabled = syncing;
      syncBtn.addEventListener('click', syncNow);
      body.appendChild(syncBtn);

      var outBtn = el('button', 'app-sidebar-import-btn anl-logout', 'Log out');
      outBtn.type = 'button';
      outBtn.addEventListener('click', logout);
      body.appendChild(outBtn);

      body.appendChild(el('div', 'anilist-hint',
        'Anime you add or remove on the watchlist is synced to your AniList list automatically.'));
      return;
    }

    /* ── Logged out ────────────────────────────────── */
    body.appendChild(el('div', 'anl-step',
      'Log in on AniList (normal email + password) and press Authorize. ' +
      'AniList then shows a code — paste it below and you’re in.'));

    var goBtn = el('button', 'app-sidebar-import-btn anl-go', 'Continue with AniList ↗');
    goBtn.type = 'button';
    body.appendChild(goBtn);

    var hint = el('div', 'anilist-hint');
    body.appendChild(hint);

    var input = el('input', 'anilist-token-input');
    input.type = 'password';
    input.placeholder = 'Paste the code from AniList here…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    body.appendChild(input);

    var status = el('div', 'anl-status');
    body.appendChild(status);

    goBtn.addEventListener('click', function () {
      if (CLIENT_ID) {
        window.open(AUTH_URL + encodeURIComponent(CLIENT_ID), '_blank', 'noopener');
        status.textContent = 'Waiting for the code from the AniList tab…';
      } else {
        hint.innerHTML =
          'This site isn’t registered with AniList yet — open ' +
          '<a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">' +
          'AniList Developer settings</a>, create a client with redirect URL ' +
          '<code>https://anilist.co/api/v2/oauth/pin</code> and copy a token from the ' +
          'authorize page. Paste it below.';
      }
      input.focus();
    });

    /* Auto-login: as soon as a plausible token lands in the field.
       Real AniList access tokens are long JWTs starting with "eyJ" —
       anything short is usually the client ID/secret pasted by mistake. */
    async function attempt() {
      var v = input.value.trim().replace(/^Bearer\s+/i, '');
      if (!v || checking) return;
      if (!/^eyJ/.test(v) || v.length < 100) {
        if (v.length >= 20) {
          status.textContent =
            'That looks like the client ID/secret — you need the code AniList ' +
            'shows AFTER you press Authorize (it starts with "eyJ").';
        }
        return;
      }
      checking = true;
      status.textContent = 'Checking…';
      input.disabled = true;
      var ok = await loginWithToken(v);
      checking = false;
      input.disabled = false;
      if (ok) {
        updateRail();
        renderModal();
        toast('Logged in as ' + auth.name);
        syncNow(); // first sync right away — no extra clicks
      } else {
        status.textContent = 'That code didn’t work — copy it again from AniList.';
        input.value = '';
        input.focus();
      }
    }
    input.addEventListener('paste', function () { setTimeout(attempt, 50); });
    input.addEventListener('input', function () { setTimeout(attempt, 300); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
  }

  /* ─────────────────────────────────────────────────────
     Toast (shared #vwl-toast)
  ───────────────────────────────────────────────────── */
  function toast(msg, isError) {
    var t = document.getElementById('vwl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'vwl-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.borderColor = isError ? 'rgba(255,80,80,.4)' : '';
    t.className = 'vwl-show';
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.className = ''; t.style.borderColor = ''; }, 3200);
  }

  /* ─────────────────────────────────────────────────────
     Init
  ───────────────────────────────────────────────────── */
  function init() {
    var btn = document.getElementById('railAniListBtn');
    if (btn) btn.addEventListener('click', toggleModal);
    updateRail();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
