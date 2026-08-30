/**
 * recommendations.js — Recommended engine for Virowatch home
 *
 * Default: mix of all 3 types (anime/movies/TV) and all genres.
 * When user has watchlist/history, weight by type counts and tags:
 *   watchlist ×2, history ×1, history not in watchlist = possible dislike (tag weight -0.5)
 * Type distribution based on watchlist: only movies → only movies, etc.
 * Tags: most common → primary pool, plus 2-3 random with 1-2 counts for variety.
 * Infinite scroll: loads more when near bottom. Refresh icon next to Recommended.
 */
(function () {
  "use strict";

  var TMDB_KEY = "77d678406118b130512ab8affd953fa9";
  var IMG_W342 = "https://image.tmdb.org/t/p/w342";
  var PAGE_SIZE = 12;
  var loaded = 0;
  var busy = false;
  var currentRecs = [];
  var REC_CACHE_KEY = "vw_recs_cache_v1";
  var REC_CACHE_TTL = 6 * 3600 * 1000; // 6h, refresh only on demand
  var PROFILE_KEY = "vw_profile_v1";
  var PROFILE_TTL = 24 * 3600 * 1000;

  function getWatchlist() {
    try { var l = JSON.parse(localStorage.getItem("vwl_watchlist") || "[]"); return Array.isArray(l) ? l : []; } catch (_) { return []; }
  }
  function getHistory() {
    try { var l = JSON.parse(localStorage.getItem("vw_watch_history") || "[]"); return Array.isArray(l) ? l : []; } catch (_) { return []; }
  }
  function getContinue() {
    try { var l = JSON.parse(localStorage.getItem("vw_continue") || "[]"); return Array.isArray(l) ? l : []; } catch (_) { return []; }
  }

  // genre cache from hover-info and mediaData
  function getGenresForKey(key, cat, title) {
    try {
      var store = JSON.parse(localStorage.getItem("vw_ani_meta_v1") || "{}");
      var d = store && store.d;
      if (d) {
        // try exact key, then title lower
        var hit = d[key] || d["q:" + (title||"").toLowerCase()];
        if (hit && hit.ge && hit.ge.length) return hit.ge;
      }
    } catch (_) {}
    // fallback from mediaData if available
    try {
      var md = window.mediaData && window.mediaData[cat] && window.mediaData[cat][key];
      if (md && md.genres) return md.genres;
    } catch (_) {}
    return [];
  }

  function getProfile() {
    try {
      var p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      if (p && p.t && Date.now() - p.t < PROFILE_TTL && p.d) return p.d;
    } catch (_) {}
    return null;
  }
  function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ t: Date.now(), d: p })); } catch (_) {}
  }
  function buildProfile() {
    var cached = getProfile();
    // use cached profile if watchlist hasn't changed (fast)
    var wl = getWatchlist();
    var hist = getHistory();
    var cont = getContinue();
    var wlSig = wl.length + ":" + wl.map(function(x){return x.key;}).join(",").slice(0,200);
    if (cached && cached._sig === wlSig) return cached;
    // merge history + continue for tag analysis, but watchlist weighted higher
    var typeCount = { anime: 0, movies: 0, shows: 0 };
    var tagFreq = {};
    var seenKeys = new Set();
    var ageSum = 0, ageN = 0;

    function addItem(it, weight, isWatchlist) {
      var cat = it.cat;
      var key = it.key || it.mov;
      if (!key) return;
      if (seenKeys.has(key) && !isWatchlist) return; // avoid double count history that is also in watchlist
      if (isWatchlist) seenKeys.add(key);
      var type = null;
      if (cat === "anime" || (key && key.indexOf("ANI_") === 0)) type = "anime";
      else if (cat === "movies" || cat === "lunora" || (key && key.indexOf("VDM_") === 0)) type = "movies";
      else if (cat === "shows" || (key && key.indexOf("VDT_") === 0)) type = "shows";
      if (!type) return;
      typeCount[type] = (typeCount[type] || 0) + weight;
      // average age from watchlist only
      if (isWatchlist) {
        var ageStr = it.age || (window.vwAgeStore && window.vwAgeStore[key]) || "";
        var n = (function(s){
          if (!s) return null;
          var t = String(s).trim().toUpperCase();
          if (t[0]==="+") { var v=parseInt(t.slice(1),10); return isNaN(v)?null:v; }
          if (t==="G"||t==="TV-G"||t==="TV-Y"||t==="TV-Y7") return 0;
          if (t==="PG"||t==="TV-PG") return 7;
          if (t==="PG-13"||t==="TV-14") return 13;
          if (t==="R"||t==="TV-MA") return 16;
          if (t==="18+") return 18;
          return null;
        })(ageStr);
        if (n != null) { ageSum += n; ageN++; }
      }
      var genres = getGenresForKey(key, cat, it.title);
      // if no cached genres, try title-based fallback (will be fetched lazily)
      if (!genres.length && it.title) {
        // use title words as pseudo-tags for now
        it.title.split(/\s+/).slice(0,2).forEach(function(w){ 
          var k = w.toLowerCase().replace(/[^a-z0-9]/g,"");
          if(k.length>3) genres.push(k);
        });
      }
      genres.forEach(function(g){
        var k = g.toLowerCase();
        tagFreq[k] = (tagFreq[k] || 0) + weight;
      });
      // also count bare title words for variety
      if (isWatchlist && it.title) {
        var words = it.title.toLowerCase().split(/\s+/).filter(function(w){return w.length>4;});
        words.slice(0,2).forEach(function(w){
          var k2 = w.replace(/[^a-z0-9]/g,"");
          if(k2) tagFreq[k2] = (tagFreq[k2]||0) + weight*0.3;
        });
      }
    }

    // watchlist matters a lot more — ×5, history only for tags, not type
    wl.forEach(function(it){ addItem(it, 5, true); });
    var wlKeys = new Set(wl.map(function(it){return it.key || it.mov;}));
    hist.forEach(function(it){
      var key = it.mov || it.key;
      var isInWl = key && wlKeys.has(key);
      if (!isInWl) {
        var cat2 = it.cat;
        var genres2 = getGenresForKey(key, cat2, it.title);
        genres2.forEach(function(g){
          var k = g.toLowerCase();
          tagFreq[k] = (tagFreq[k] || 0) - 0.5;
        });
      }
    });
    cont.forEach(function(it){ addItem(it, 1, false); });

    // determine type distribution
    var totalType = typeCount.anime + typeCount.movies + typeCount.shows;
    var typeWeights = null;
    if (totalType === 0) {
      typeWeights = { anime: 0.33, movies: 0.33, shows: 0.34 };
    } else {
      typeWeights = {
        anime: typeCount.anime / totalType,
        movies: typeCount.movies / totalType,
        shows: typeCount.shows / totalType,
      };
      // if only one type has counts, boost it to 1, others 0
      // e.g., only movies → only movies
    }

    // sort tags by freq
    var sortedTags = Object.entries(tagFreq).sort(function(a,b){return b[1]-a[1];});
    // filter out negative or zero
    sortedTags = sortedTags.filter(function(e){return e[1] > 0;});
    var topTags = sortedTags.slice(0, 5).map(function(e){return e[0];});
    var rareTags = sortedTags.filter(function(e){return e[1] >=1 && e[1] < 2.5;}).slice(0, 8).map(function(e){return e[0];});
    // if no tags (empty watchlist/history), use all genres
    if (!topTags.length) {
      topTags = ["action","adventure","comedy","drama","fantasy","sci-fi"];
      rareTags = ["horror","mystery","romance","thriller"];
    }

    var avgAge = ageN ? Math.round(ageSum / ageN) : null;
    var profile = { typeWeights: typeWeights, topTags: topTags, rareTags: rareTags, tagFreq: tagFreq, avgAge: avgAge, _sig: wlSig };
    saveProfile(profile);
    return profile;
  }

  function pickTypeByWeight(weights) {
    var r = Math.random();
    if (r < weights.anime) return "anime";
    if (r < weights.anime + weights.movies) return "movies";
    return "shows";
  }

  function tmdbFetch(path, params) {
    if (window.vidnestTmdb) return window.vidnestTmdb(path, params);
    var qs = new URLSearchParams(Object.assign({ api_key: TMDB_KEY }, params || {}));
    return fetch("https://api.themoviedb.org/3" + path + "?" + qs).then(function(r){ return r.json(); }).catch(function(){ return null; });
  }

  async function fetchAnimeByTag(tag, page) {
    var gTag = tag ? tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase() : tag;
    if (gTag && gTag.toLowerCase() === "sci-fi") gTag = "Sci-Fi";
    if (gTag && gTag.toLowerCase() === "science fiction") gTag = "Sci-Fi";
    // try with genre first, then without
    var queries = [
      "query($p:Int,$g:String){Page(page:$p,perPage:12){media(type:ANIME,sort:POPULARITY_DESC,genre:$g){id title{romaji english} coverImage{large} bannerImage}}}",
      "query($p:Int){Page(page:$p,perPage:12){media(type:ANIME,sort:POPULARITY_DESC){id title{romaji english} coverImage{large} bannerImage}}}"
    ];
    for (var qi=0; qi<queries.length; qi++) {
      try {
        var q = queries[qi];
        var vars = qi===0 ? { p: page || 1, g: gTag } : { p: page || 1 };
        // skip first query if tag is generic like action/adventure that may be too broad and cause 400 for some tags
        var j = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: q, variables: vars }),
        }).then(function(r){ if (!r.ok) throw new Error("http "+r.status); return r.json();});
        if (j.errors) throw new Error(j.errors[0].message);
        var media = j && j.data && j.data.Page && j.data.Page.media;
        if (media && media.length) return media.map(function(m){
          return { id: m.id, title: (m.title && (m.title.english || m.title.romaji)) || "", image: (m.coverImage && m.coverImage.large) || m.bannerImage || "", banner: m.bannerImage || "", ani_id: m.id };
        });
      } catch (e) {
        // 400 on genre → try next query
        if (qi===0) continue;
      }
    }
    return [];
  }

  async function fetchTmdbByTag(kind, tag, page) {
    var genreMap = {
      "action": 28, "adventure": 12, "comedy": 35, "crime": 80, "drama": 18, "fantasy": 14, "horror": 27, "mystery": 9648, "romance": 10749, "sci-fi": 878, "thriller": 53, "science fiction": 878
    };
    var gid = genreMap[tag.toLowerCase()];
    var path = kind === "movies" ? "/discover/movie" : "/discover/tv";
    var params = { sort_by: "popularity.desc", "vote_count.gte": 80, page: String(page || 1) };
    if (gid) params.with_genres = String(gid);
    var d = await tmdbFetch(path, params);
    var results = d && d.results;
    if (!results || !results.length) {
      d = await tmdbFetch(path, { sort_by: "popularity.desc", page: String(page || 1) });
      results = d && d.results;
    }
    results = results || [];
    return results.slice(0, 12).map(function(r){
      return { id: r.id, title: r.title || r.name || "", image: r.poster_path ? IMG_W342 + r.poster_path : "", backdrop: r.backdrop_path ? "https://image.tmdb.org/t/p/w780" + r.backdrop_path : "", banner: r.backdrop_path ? "https://image.tmdb.org/t/p/w780" + r.backdrop_path : "" };
    });
  }

  function renderCard(item, target) {
    var div = document.createElement("div");
    div.className = "poster";
    if (item.ani_id) {
      div.dataset.aniId = String(item.ani_id);
      div.dataset.aniListId = String(item.ani_id);
    } else {
      div.dataset.movie = item.key;
    }
    div.dataset.cat = item.catKey || (item.key && item.key.indexOf("VDM_")===0 ? "movies" : item.key.indexOf("VDT_")===0 ? "shows" : "anime");
    var img = document.createElement("img");
    img.src = item.image || "https://via.placeholder.com/150";
    img.loading = "lazy";
    img.alt = "";
    img.onerror = function(){
      // Brave image proxy 502 — fallback to direct Anilist or placeholder
      var src = this.src || "";
      if (src.indexOf("imgs.search.brave.com") !== -1 || src.indexOf("brave.com") !== -1) {
        // try direct Anilist URL if available, else placeholder
        var direct = item.image && item.image.indexOf("anilist.co") !== -1 ? item.image : "";
        if (direct && direct !== src) { this.src = direct; return; }
      }
      if (this.src.indexOf("via.placeholder.com") === -1) {
        this.src = "https://via.placeholder.com/150?text=No+Image";
      }
    };
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.catKey === "movies" ? "MOVIE" : item.catKey === "shows" ? "TV" : "ANIME";
    var title = document.createElement("span");
    title.className = "title";
    title.textContent = item.title || item.key;
    div.appendChild(img);
    div.appendChild(badge);
    div.appendChild(title);
    if (window.vwlAttachButton) window.vwlAttachButton(div);
    div.addEventListener("click", function(){
      if (item.ani_id && window.openAnikotoById) {
        // item.ani_id is the AniList id — openAnikotoById wants the ANIKOTO id.
        var openAnime = function(anikotoId){
          if (anikotoId) window.openAnikotoById(anikotoId).catch(function(){});
        };
        var resolve = function(){
          var c = (window.anikotoFindByAniList && window.anikotoFindByAniList(item.ani_id)) || null;
          if (c) { openAnime(c.id); return; }
          var t = item.title || "";
          if (t && window.anikotoSearch) {
            var res = window.anikotoSearch(t);
            if (res && res.length) { openAnime(res[0].id); return; }
          }
          openAnime(item.ani_id);
        };
        if (window.anikotoEnsureIndex) window.anikotoEnsureIndex().then(resolve).catch(resolve);
        else resolve();
      }
      else if (item.key && item.key.indexOf("ANI_") === 0 && window.openAnikotoById) {
        // anikoto-catalog pool item: key is the anikoto id directly
        window.openAnikotoById(item.key.slice(4)).catch(function(){});
      }
      else if (item.key && (item.key.indexOf("VDM_")===0 || item.key.indexOf("VDT_")===0) && window.openVidnestById) window.openVidnestById(item.key);
      else if (window.viroPlay) window.viroPlay(div.dataset.cat, item.key);
    });
    // hover should update hero banner/title like newest added does — also ensure banner fetched
    var heroTid = null;
    div.addEventListener("mouseenter", function(){
      heroTid = setTimeout(function(){
        var heroArt = document.getElementById("heroArt");
        var heroTitle = document.getElementById("heroTitle");
        var heroTags = document.getElementById("heroTags");
        if (heroArt) {
          var banner = item.banner || item.backdrop || null;
          if (!banner) {
            try {
              var bc = JSON.parse(localStorage.getItem("vw_banner_cache_v2")||"{}");
              var k = item.ani_id ? "id:"+item.ani_id : null;
              if (k && bc.d && bc.d[k]) banner = bc.d[k];
              else if (item.key) {
                var k2 = item.key.indexOf("VDM_")===0 ? "tmdb:movie:"+item.key.slice(4) : item.key.indexOf("VDT_")===0 ? "tmdb:tv:"+item.key.slice(4) : null;
                if (k2 && bc.d && bc.d[k2]) banner = bc.d[k2];
              }
            } catch(_){}
          }
          // if still no banner, try to fetch quickly and update when ready
          if (!banner && item.ani_id && window.vwGetAgeRating) {
            // trigger prefetch for banner via hover-info cache
            try {
              var k3 = "id:"+item.ani_id;
              var store = JSON.parse(localStorage.getItem("vw_ani_meta_v1")||"{}");
              if (store.d && store.d[k3] && store.d[k3].ba) banner = store.d[k3].ba;
            } catch(_){}
          }
          heroArt.style.backgroundImage = banner ? 'url("'+banner+'")' : (item.image ? 'url("'+item.image+'")' : "");
          // if no banner yet, fetch it in background and update hero when ready
          if (!banner && item.ani_id) {
            fetch("https://graphql.anilist.co", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ query: "query($id:Int){Media(id:$id,type:ANIME){bannerImage coverImage{extraLarge}}}", variables: { id: Number(item.ani_id) } }),
            }).then(function(r){return r.json();}).then(function(j){
              var m = j && j.data && j.data.Media;
              var b = m && (m.bannerImage || (m.coverImage && m.coverImage.extraLarge));
              if (b) {
                heroArt.style.backgroundImage = 'url("'+b+'")';
                try {
                  var bc2 = JSON.parse(localStorage.getItem("vw_banner_cache_v2")||"{}");
                  if (!bc2.d) bc2.d = {};
                  bc2.d["id:"+item.ani_id] = b;
                  localStorage.setItem("vw_banner_cache_v2", JSON.stringify({ t: Date.now(), d: bc2.d }));
                } catch(_){}
              }
            }).catch(function(){});
          } else if (!banner && item.key && (item.key.indexOf("VDM_")===0 || item.key.indexOf("VDT_")===0) && window.vidnestTmdb) {
            var isTv = item.key.indexOf("VDT_")===0;
            var id = item.key.slice(4);
            window.vidnestTmdb((isTv?"/tv/":"/movie/")+id, {}).then(function(d){
              var p = d && (d.backdrop_path ? "https://image.tmdb.org/t/p/w780"+d.backdrop_path : d.poster_path ? "https://image.tmdb.org/t/p/w780"+d.poster_path : "");
              if (p) {
                heroArt.style.backgroundImage = 'url("'+p+'")';
                try {
                  var bc3 = JSON.parse(localStorage.getItem("vw_banner_cache_v2")||"{}");
                  if (!bc3.d) bc3.d = {};
                  bc3.d[(isTv?"tmdb:tv:":"tmdb:movie:")+id] = p;
                  localStorage.setItem("vw_banner_cache_v2", JSON.stringify({ t: Date.now(), d: bc3.d }));
                } catch(_){}
              }
            }).catch(function(){});
          }
        }
        if (heroTitle) heroTitle.textContent = item.title || "";
        if (heroTags) {
          heroTags.innerHTML = "";
          var tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = item.catKey === "movies" ? "Movie" : item.catKey === "shows" ? "TV Show" : "Anime";
          heroTags.appendChild(tag);
          if (item.tag) {
            var tg = document.createElement("span");
            tg.className = "tag";
            tg.textContent = item.tag;
            heroTags.appendChild(tg);
          }
        }
      }, 140);
    });
    div.addEventListener("mouseleave", function(){ clearTimeout(heroTid); });
    target.appendChild(div);
  }

  function saveRecCache(items) {
    try { localStorage.setItem(REC_CACHE_KEY, JSON.stringify({ t: Date.now(), d: items })); } catch (_) {}
  }
  function loadRecCache() {
    try {
      var o = JSON.parse(localStorage.getItem(REC_CACHE_KEY) || "null");
      if (o && o.d && Array.isArray(o.d) && o.d.length && Date.now() - o.t < REC_CACHE_TTL) return o.d;
    } catch (_) {}
    return null;
  }

  var POOL_KEY = "vw_recs_pool_v1";
  var POOL_TTL = 6 * 3600 * 1000;

  // Session-only set of every title/key already suggested this page load
  // (across ↻ refreshes and infinite-scroll loads) so nothing repeats.
  // Lives in memory only — a full website reload resets it, making previously
  // suggested titles eligible again.
  var seenEverKeys = new Set();
  var seenEverTitles = new Set();

  function getPool() {
    try {
      var o = JSON.parse(localStorage.getItem(POOL_KEY) || "null");
      if (o && o.t && Date.now() - o.t < POOL_TTL && o.p) {
        // invalidate empty pools (e.g. leftover from an earlier 429/build)
        var total = (o.p.anime||[]).length + (o.p.movies||[]).length + (o.p.shows||[]).length;
        if (total > 0) return o.p;
        localStorage.removeItem(POOL_KEY);
      }
    } catch (_) {}
    return null;
  }
  function savePool(p) {
    try { localStorage.setItem(POOL_KEY, JSON.stringify({ t: Date.now(), p: p })); } catch (_) {}
  }
  function dedupeItems(items) {
    var seenK = new Set(), seenT = new Set();
    return (items||[]).filter(function(it){
      var k = it.key, tl = (it.title||"").toLowerCase().trim();
      if (k && seenK.has(k)) return false;
      if (tl && seenT.has(tl)) return false;
      if (k) seenK.add(k);
      if (tl) seenT.add(tl);
      return true;
    });
  }

  // Build a deep pool per type. Anime draws from the already-loaded anikoto
  // catalog (playable, instant, ZERO network) — AniList is only touched if the
  // catalog is empty, and then only 1 page to avoid 429 rate-limits.
  // Movies/TV fetch 1 TMDB page each. Cached 6h, reshuffled from memory on
  // every refresh.
  async function ensurePool() {
    var pool = getPool();
    if (pool) return pool;
    var out = { anime: [], movies: [], shows: [] };
    var jobs = ["anime","movies","shows"].map(function(t){
      if (t !== "anime") {
        return fetchTmdbByTag(t, "", 1).then(function(raw){
          out[t] = dedupeItems((raw||[]).map(function(a){
            return { catKey:t, key:(t==="movies"?"VDM_":"VDT_")+a.id, title:a.title, image:a.image, banner:a.backdrop || a.banner || "", tag:"" };
          }));
        }).catch(function(){ out[t] = []; });
      }
      // anime: anikoto catalog (already in memory) — no network
      var items = [];
      try {
        var cat = (window.anikotoRecent && window.anikotoRecent()) || [];
        cat.forEach(function(a){
          if (a && a.id != null)
            items.push({ catKey:"anime", key:"ANI_"+a.id, ani_id:a.ani_id ? Number(a.ani_id) : null, title:a.title||"", image:a.poster||a.background_image||"", banner:"", tag:"" });
        });
      } catch(_){}
      if (items.length >= 12) {
        out.anime = dedupeItems(items);
        return Promise.resolve();
      }
      // catalog too small — top up with ONE AniList page (avoid 429)
      return fetchAnimeByTag("", 1).then(function(raw){
        (raw||[]).forEach(function(a){
          items.push({ catKey:"anime", key:"ANI_"+a.id, ani_id:a.id, title:a.title, image:a.image, banner:a.banner||a.bannerImage||"", tag:"" });
        });
        out.anime = dedupeItems(items);
      }).catch(function(){ out.anime = dedupeItems(items); });
    });
    await Promise.all(jobs);
    savePool(out);
    return out;
  }

  async function loadRecommendations(count, isInitial, force) {
    if (busy) return;
    busy = true;
    var grid = document.getElementById("recommendedList");
    if (!grid) { busy = false; return; }
    var profile = buildProfile();
    var need = count || PAGE_SIZE;
    var totalNeed = need;

    var pool = null;
    if (!force) pool = getPool();
    var poolFresh = !!pool;
    if (!pool) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:20px;opacity:.5;">Loading recommendations…</p>';
      // freeze current grid in place (keep last recs visible) while pool builds
      pool = await ensurePool();
    }

    // weighted type split
    var w = profile.typeWeights;
    var counts = { anime: Math.round(w.anime * totalNeed), movies: Math.round(w.movies * totalNeed), shows: Math.round(w.shows * totalNeed) };
    var sum = counts.anime + counts.movies + counts.shows;
    while (sum < totalNeed) { if (w.anime >= w.movies && w.anime >= w.shows) counts.anime++; else if (w.movies >= w.shows) counts.movies++; else counts.shows++; sum++; }
    while (sum > totalNeed) { if (counts.anime >= counts.movies && counts.anime >= counts.shows && counts.anime>0) counts.anime--; else if (counts.movies >= counts.shows && counts.movies>0) counts.movies--; else if (counts.shows>0) counts.shows--; sum--; }
    var typeOrder = [];
    ["anime","movies","shows"].forEach(function(t){ for(var i=0;i<counts[t];i++) typeOrder.push(t); });
    for (var i=typeOrder.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var tmp=typeOrder[i]; typeOrder[i]=typeOrder[j]; typeOrder[j]=tmp; }

    var wl = getWatchlist();
    var wlSet = new Set(wl.map(function(x){ return x.key; }));
    var wlTitles = new Set(wl.map(function(x){ return (x.title||"").toLowerCase().trim(); }).filter(Boolean));
    var seenRecKeys = new Set(currentRecs.map(function(x){ return x.key; }));
    var seenRecTitles = new Set(currentRecs.map(function(x){ return (x.title||"").toLowerCase().trim(); }).filter(Boolean));
    var avg = profile.avgAge;

    function pickFromPool(pool, want) {
      var picked = [];
      var poolCopy = pool.slice();
      for (var w2=0; w2<want && poolCopy.length; w2++) {
        var filtered = poolCopy.filter(function(it){
          if (wlSet.has(it.key)) return false;
          if (wlTitles.has((it.title||"").toLowerCase().trim())) return false;
          if (seenRecKeys.has(it.key)) return false;
          if (seenRecTitles.has((it.title||"").toLowerCase().trim())) return false;
          if (seenEverKeys.has(it.key)) return false;
          if (seenEverTitles.has((it.title||"").toLowerCase().trim())) return false;
          if (avg != null && window.vwAgeStore) {
            var aStr = window.vwAgeStore[it.key] || "";
            if (!aStr) return true;
            var n2 = (function(s){
              if (!s) return 13;
              var t = String(s).trim().toUpperCase();
              if (t[0]==="+") { var v=parseInt(t.slice(1),10); return isNaN(v)?13:v; }
              if (t==="G"||t==="TV-G") return 0;
              if (t==="PG"||t==="TV-PG") return 7;
              if (t==="PG-13"||t==="TV-14") return 13;
              if (t==="R"||t==="TV-MA") return 16;
              if (t==="18+") return 18;
              return 13;
            })(aStr);
            return Math.abs(n2 - avg) <= 6;
          }
          return true;
        });
        var usePool = filtered;
        // strict: never fall back to already-seen items — return fewer instead
        if (!usePool.length) break;
        var pi = Math.floor(Math.random()*usePool.length);
        var pickOne = usePool[pi];
        picked.push(pickOne);
        seenRecKeys.add(pickOne.key);
        seenRecTitles.add((pickOne.title||"").toLowerCase().trim());
        var idx = poolCopy.indexOf(pickOne);
        if (idx!==-1) poolCopy.splice(idx,1);
      }
      return picked;
    }

    // Pick per-type from the pool — instant, no network
    var allPicked = [];
    typeOrder.forEach(function(t){
      var picks = pickFromPool(pool[t] || [], 1);
      allPicked = allPicked.concat(picks);
    });
    // top up from pooled leftovers if types underfilled
    var needExtra = totalNeed - allPicked.length;
    if (needExtra > 0) {
      var allPooled = [].concat(pool.anime||[], pool.movies||[], pool.shows||[]);
      var extra = pickFromPool(allPooled, needExtra);
      allPicked = allPicked.concat(extra);
    }
    // pool exhausted (everything already seen) — refetch a fresh pool once and re-pick
    if (allPicked.length < totalNeed) {
      try { localStorage.removeItem(POOL_KEY); } catch(_){}
      var fresh = await ensurePool();
      var missing = totalNeed - allPicked.length;
      var freshPicks = pickFromPool([].concat(fresh.anime||[], fresh.movies||[], fresh.shows||[]), missing);
      allPicked = allPicked.concat(freshPicks);
    }
    // still short and pool truly consumed by the persistent seen-set — reset it
    // once so recommendations show instead of "Not enough data"
    if (allPicked.length < totalNeed) {
      seenEverKeys.clear(); seenEverTitles.clear();
      var resetMissing = totalNeed - allPicked.length;
      var resetPicks = pickFromPool([].concat(pool.anime||[], pool.movies||[], pool.shows||[]), resetMissing);
      allPicked = allPicked.concat(resetPicks);
    }

    // hard dedupe by key AND title before render — guards against pool duplicates
    var finalKeys = new Set();
    var finalTitles = new Set();
    var unique = [];
    allPicked.forEach(function(it){
      var k = it && it.key;
      var tl = it && it.title ? it.title.toLowerCase().trim() : "";
      if (k && finalKeys.has(k)) return;
      if (tl && finalTitles.has(tl)) return;
      if (k) finalKeys.add(k);
      if (tl) finalTitles.add(tl);
      unique.push(it);
    });

    // replace grid content
    if (isInitial || force) {
      grid.innerHTML = "";
      currentRecs = [];
      seenRecKeys.clear(); seenRecTitles.clear();
    }
    unique.forEach(function(it){
      renderCard(it, grid); currentRecs.push(it);
      if (it.key) seenEverKeys.add(it.key);
      if (it.title) seenEverTitles.add(it.title.toLowerCase().trim());
    });
    if (currentRecs.length) saveRecCache(currentRecs);
    if (isInitial && !currentRecs.length) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:40px 0;opacity:.45;">Not enough data yet — add some movies/shows/anime to your watchlist and watch a few things, then refresh.</p>';
    }
    loaded = currentRecs.length;
    busy = false;
    // background: refresh pool so next refresh has fresh candidates (non-blocking)
    if (poolFresh && isInitial) {
      setTimeout(function(){ try { localStorage.removeItem(POOL_KEY); ensurePool(); } catch(_){} }, 3000);
    }
  }

  function setupInfiniteScroll() {
    var grid = document.getElementById("recommendedList");
    if (!grid) return;
    // smooth horizontal scroll on wheel when hovered
    grid.addEventListener("wheel", function(e){
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (grid.scrollWidth <= grid.clientWidth) return;
      var rect = grid.getBoundingClientRect();
      var isHover = e.clientY >= rect.top && e.clientY <= rect.bottom && e.clientX >= rect.left && e.clientX <= rect.right;
      if (!isHover) return;
      e.preventDefault();
      grid.scrollBy({ left: e.deltaY * 2, behavior: "smooth" });
    }, { passive: false });
    var newest = document.getElementById("newestAddedList");
    if (newest) {
      newest.addEventListener("wheel", function(e){
        if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
        if (newest.scrollWidth <= newest.clientWidth) return;
        var rect2 = newest.getBoundingClientRect();
        var isHover2 = e.clientY >= rect2.top && e.clientY <= rect2.bottom && e.clientX >= rect2.left && e.clientX <= rect2.right;
        if (!isHover2) return;
        e.preventDefault();
        newest.scrollBy({ left: e.deltaY * 2, behavior: "smooth" });
      }, { passive: false });
    }
    var sentinel = document.createElement("div");
    sentinel.id = "recSentinel";
    sentinel.style.height = "1px";
    // spinner as last poster slot — 000000000000I1 : 12 content (0) then cutoff I then spinner (1) with its own free space
    var spinner = document.createElement("div");
    spinner.id = "recSpinner";
    spinner.className = "poster rec-spinner";
    spinner.style.cssText = "display:flex;flex:0 0 148px;width:148px;aspect-ratio:2/3;border-radius:10px;background:transparent;border:1px dashed rgba(255,255,255,.14);align-items:center;justify-content:center;scroll-snap-align:start;flex-shrink:0;";
    spinner.innerHTML = '<div class="spinner" style="display:none;width:28px;height:28px;border:3px solid rgba(255,255,255,.15);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;"></div>';
    grid.appendChild(spinner);
    var innerSpinner = spinner.querySelector(".spinner");
    // sentinel after grid for vertical fallback
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting && !busy) {
          var slider = document.getElementById("homeSlider");
          if (slider && slider.getAttribute("data-active") !== "recommended") return;
          innerSpinner.style.display = "block";
          loadRecommendations(10, false).then(function(){ innerSpinner.style.display = "none"; });
        }
      });
    }, { rootMargin: "200px" });
    obs.observe(spinner);
    obs.observe(sentinel);
    window.addEventListener("scroll", function(){
      if (busy) return;
      var slider = document.getElementById("homeSlider");
      if (!slider || slider.getAttribute("data-active") !== "recommended") return;
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
        innerSpinner.style.display = "block";
        loadRecommendations(10, false).then(function(){ innerSpinner.style.display = "none"; });
      }
    }, { passive: true });
  }

  function setupRefresh() {
    // primary refresh — inside Recommended tab button itself (always visible)
    var toggle = document.getElementById("homeToggle");
    if (toggle) {
      var recTab = toggle.querySelector('[data-tab="recommended"]');
      if (recTab && !recTab.querySelector("#recRefreshToggle")) {
        var toggleRefresh = document.createElement("button");
        toggleRefresh.id = "recRefreshToggle";
        toggleRefresh.type = "button";
        toggleRefresh.textContent = "↻";
        toggleRefresh.title = "Refresh recommendations";
        toggleRefresh.style.cssText = "margin-left:8px;width:22px;height:22px;border-radius:50%;background:transparent;border:none;color:rgba(255,255,255,.38);font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;opacity:.6;";
        toggleRefresh.onmouseenter = function(){ this.style.color="rgba(255,255,255,.75)"; this.style.opacity="1"; };
        toggleRefresh.onmouseleave = function(){ this.style.color="rgba(255,255,255,.38)"; this.style.opacity=".6"; };
        recTab.appendChild(toggleRefresh);
        toggleRefresh.addEventListener("click", function(e){
          e.stopPropagation();
          var slider = document.getElementById("homeSlider");
          if (slider) slider.setAttribute("data-active","recommended");
          document.querySelectorAll("#homeToggle .home-tab").forEach(function(b){ b.classList.toggle("active", b.getAttribute("data-tab")==="recommended"); });
          // instant: show cached recs immediately, then fetch fresh in background
          var grid = document.getElementById("recommendedList");
          var cached = loadRecCache();
          if (grid && cached && cached.length && !currentRecs.length) {
            grid.innerHTML = "";
            cached.slice(0, PAGE_SIZE).forEach(function(it){ renderCard(it, grid); });
            currentRecs = cached.slice();
          }
          loadRecommendations(PAGE_SIZE, true, true);
        });
      }
    }
    // also keep a small refresh in the panel header if it exists (fallback)
    var head = document.querySelector('[data-panel="recommended"] .section-head');
    if (head && !head.querySelector("#recRefresh")) {
      var btn = document.createElement("button");
      btn.id = "recRefresh";
      btn.type = "button";
      btn.title = "Refresh recommendations";
      btn.textContent = "↻";
      btn.style.cssText = "margin-left:10px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#fff;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;";
      btn.addEventListener("click", function(){ loadRecommendations(PAGE_SIZE, true, true); });
      var h2 = head.querySelector("h2");
      if (h2) { h2.appendChild(document.createTextNode(" ")); h2.appendChild(btn); }
      else head.appendChild(btn);
    }
  }

  function init() {
    var grid = document.getElementById("recommendedList");
    if (!grid) return;
    setupRefresh();
    setupInfiniteScroll();
    // no pool fetch at page init — wait until the Recommended tab actually opens
    // reload when watchlist/history changes — also invalidate profile cache
    window.addEventListener("vwl-updated", function(){ try{localStorage.removeItem(PROFILE_KEY);}catch(_){} try{localStorage.removeItem(REC_CACHE_KEY);}catch(_){} loaded=0; currentRecs=[]; });
    window.addEventListener("vw-cw-updated", function(){ try{localStorage.removeItem(PROFILE_KEY);}catch(_){} loaded=0; });
    // when tab becomes active, load (deferred so AniList isn't hammered on init)
    var slider = document.getElementById("homeSlider");
    if (slider) {
      new MutationObserver(function(){
        if (slider.getAttribute("data-active") === "recommended" && loaded === 0) loadRecommendations(PAGE_SIZE,true);
      }).observe(slider, { attributes:true, attributeFilter:["data-active"] });
    }
    // if Recommended already active at load, load now
    if (slider && slider.getAttribute("data-active") === "recommended") loadRecommendations(PAGE_SIZE, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
