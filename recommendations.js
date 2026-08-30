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
    // AniList genres are Title Case — profile tags are lowercased, capitalize for query
    var gTag = tag ? tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase() : tag;
    // handle sci-fi special case
    if (gTag && gTag.toLowerCase() === "sci-fi") gTag = "Sci-Fi";
    var query = "query($p:Int,$g:String){Page(page:$p,perPage:12){media(type:ANIME,sort:POPULARITY_DESC,genre:$g){id title{romaji english} coverImage{large} bannerImage}}}";
    try {
      var j = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: query, variables: { p: page || 1, g: gTag } }),
      }).then(function(r){return r.json();});
      if (j.errors) throw new Error(j.errors[0].message);
      var media = j && j.data && j.data.Page && j.data.Page.media;
      if (media && media.length) return media.map(function(m){
        return { id: m.id, title: (m.title && (m.title.english || m.title.romaji)) || "", image: (m.coverImage && m.coverImage.large) || m.bannerImage || "", banner: m.bannerImage || "", ani_id: m.id };
      });
    } catch (_) {}
    // fallback without genre if tag invalid
    try {
      var q2 = "query($p:Int){Page(page:$p,perPage:12){media(type:ANIME,sort:POPULARITY_DESC){id title{romaji english} coverImage{large} bannerImage}}}";
      var j2 = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: q2, variables: { p: page || 1 } }),
      }).then(function(r){return r.json();});
      var media2 = j2 && j2.data && j2.data.Page && j2.data.Page.media;
      if (media2 && media2.length) return media2.map(function(m){
        return { id: m.id, title: (m.title && (m.title.english || m.title.romaji)) || "", image: (m.coverImage && m.coverImage.large) || m.bannerImage || "", banner: m.bannerImage || "", ani_id: m.id };
      });
    } catch (_) {}
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
      if (item.ani_id && window.openAnikotoById) window.openAnikotoById(item.ani_id);
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

  async function loadRecommendations(count, isInitial) {
    if (busy) return;
    busy = true;
    var grid = document.getElementById("recommendedList");
    if (!grid) { busy = false; return; }
    if (isInitial) {
      var cached = loadRecCache();
      if (cached && cached.length) {
        grid.innerHTML = "";
        cached.slice(0, PAGE_SIZE).forEach(function(it){ renderCard(it, grid); });
        currentRecs = cached.slice();
        loaded = cached.length;
        busy = false;
        // still refresh in background after 2s if stale
        if (Date.now() - JSON.parse(localStorage.getItem(REC_CACHE_KEY)||"{}").t > 30*60*1000) {
          setTimeout(function(){ if (!busy) loadRecommendations(0,false); }, 2000);
        }
        return;
      }
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:20px;opacity:.5;">Loading recommendations…</p>'; currentRecs = [];
    }
    var profile = buildProfile();
    var need = count || PAGE_SIZE;
    var newItems = [];
    // decide type distribution
    var types = [];
    var totalNeed = need;
    // build a pool of tags: 70% topTags, 30% rare/random
    var allTags = profile.topTags.slice();
    // add some rare tags for variety
    if (profile.rareTags.length) {
      // inject 2-3 rare
      for (var i=0;i<Math.min(3, profile.rareTags.length);i++) {
        if (Math.random() < 0.5) allTags.push(profile.rareTags[i]);
      }
    }
    // if still no tags, use default
    if (!allTags.length) allTags = ["action","adventure","comedy","drama"];

    // deterministic type split for watchlist-heavy case: allocate counts, not per-iteration random
    var typeOrder = [];
    if (totalNeed > 0) {
      var w = profile.typeWeights;
      var counts = { anime: Math.round(w.anime * totalNeed), movies: Math.round(w.movies * totalNeed), shows: Math.round(w.shows * totalNeed) };
      var sum = counts.anime + counts.movies + counts.shows;
      // adjust rounding
      while (sum < totalNeed) { if (w.anime >= w.movies && w.anime >= w.shows) counts.anime++; else if (w.movies >= w.shows) counts.movies++; else counts.shows++; sum++; }
      while (sum > totalNeed) { if (counts.anime >= counts.movies && counts.anime >= counts.shows && counts.anime>0) counts.anime--; else if (counts.movies >= counts.shows && counts.movies>0) counts.movies--; else if (counts.shows>0) counts.shows--; sum--; }
      ["anime","movies","shows"].forEach(function(t){ for(var i=0;i<counts[t];i++) typeOrder.push(t); });
      // shuffle to avoid blocks, but keep weighted
      for (var i=typeOrder.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var tmp=typeOrder[i]; typeOrder[i]=typeOrder[j]; typeOrder[j]=tmp; }
    }
    var wl = getWatchlist();
    var wlSet = new Set(wl.map(function(x){ return x.key; }));
    var wlTitles = new Set(wl.map(function(x){ return (x.title||"").toLowerCase().trim(); }).filter(Boolean));
    var seenRecKeys = new Set(currentRecs.map(function(x){ return x.key; }));
    var seenRecTitles = new Set(currentRecs.map(function(x){ return (x.title||"").toLowerCase().trim(); }).filter(Boolean));
    // Batched parallel for speed: one fetch per type, not 12 separate
    var counts = { anime:0, movies:0, shows:0 };
    typeOrder.forEach(function(t){ counts[t] = (counts[t]||0)+1; });
    var batchTasks = [];
    ["anime","movies","shows"].forEach(function(t){
      if (!counts[t]) return;
      // pick 1-2 tags to cover variety, fetch once per type — request more than needed for dedupe
      var tagPool = [];
      if (profile.topTags.length) tagPool = profile.topTags.slice(0,3);
      if (profile.rareTags.length && Math.random()<0.4) tagPool.push(profile.rareTags[Math.floor(Math.random()*profile.rareTags.length)]);
      var tag = tagPool.length ? tagPool[Math.floor(Math.random()*tagPool.length)] : allTags[Math.floor(Math.random()*allTags.length)];
      var page = 1 + Math.floor(Math.random()*2);
      if (t==="anime") {
        batchTasks.push(fetchAnimeByTag(tag, page).then(function(items){
          return { type:t, items: (items||[]).map(function(a){ return { catKey:"anime", key:"ANI_"+a.id, ani_id:a.id, title:a.title, image:a.image, banner:a.bannerImage || "", tag:tag }; }) };
        }));
      } else {
        batchTasks.push(fetchTmdbByTag(t, tag, page).then(function(items){
          return { type:t, items: (items||[]).map(function(m){ return { catKey:t, key:(t==="movies"?"VDM_":"VDT_")+m.id, title:m.title, image:m.image, banner:m.backdrop || "", tag:tag }; }) };
        }));
      }
    });
    var batches = await Promise.all(batchTasks);
    var poolByType = {};
    batches.forEach(function(b){ if(b) poolByType[b.type]=b.items; });
    // now pick from pools without extra network
    for (var n=0; n<totalNeed; n++) {
      var type = typeOrder[n] || pickTypeByWeight(profile.typeWeights);
      var pool = poolByType[type] || [];
      if (!pool.length) {
        // fallback: try any pool
        var allPooled = [].concat(poolByType.anime||[], poolByType.movies||[], poolByType.shows||[]);
        pool = allPooled;
      }
      if (!pool.length) continue;
      // filter by watchlist/title/avgAge
      var avg = profile.avgAge;
      var filtered = pool.filter(function(it){
        if (wlSet.has(it.key)) return false;
        if (wlTitles.has((it.title||"").toLowerCase().trim())) return false;
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
      var usePool = filtered.length ? filtered : pool.filter(function(it){ return !wlSet.has(it.key) && !wlTitles.has((it.title||"").toLowerCase().trim()); });
      if (!usePool.length) usePool = pool;
      if (!usePool.length) continue;
      var pickOne = usePool[Math.floor(Math.random()*usePool.length)];
      var exists = grid.querySelector('[data-movie="'+pickOne.key+'"]') || grid.querySelector('[data-ani-id="'+(pickOne.ani_id||"")+'"]') || wlSet.has(pickOne.key) || wlTitles.has((pickOne.title||"").toLowerCase().trim()) || seenRecKeys.has(pickOne.key) || seenRecTitles.has((pickOne.title||"").toLowerCase().trim());
      if (!exists) {
        newItems.push(pickOne);
        seenRecKeys.add(pickOne.key);
        seenRecTitles.add((pickOne.title||"").toLowerCase().trim());
        // remove from pool to avoid duplicate picks
        var idx = pool.indexOf(pickOne);
        if (idx!==-1) pool.splice(idx,1);
      } else {
        // try another from same pool not seen
        var alt = usePool.filter(function(x){ return !wlSet.has(x.key) && !wlTitles.has((x.title||"").toLowerCase().trim()) && !seenRecKeys.has(x.key) && !seenRecTitles.has((x.title||"").toLowerCase().trim()); });
        if (alt.length) {
          var altPick = alt[Math.floor(Math.random()*alt.length)];
          newItems.push(altPick);
          seenRecKeys.add(altPick.key);
          seenRecTitles.add((altPick.title||"").toLowerCase().trim());
          var idx2 = pool.indexOf(altPick);
          if (idx2!==-1) pool.splice(idx2,1);
        }
      }
    }

    if (isInitial) grid.innerHTML = "";
    newItems.forEach(function(it){ renderCard(it, grid); currentRecs.push(it); });
    if (currentRecs.length) saveRecCache(currentRecs);
    if (!newItems.length && isInitial) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:40px 0;opacity:.45;">Not enough data yet — add some movies/shows/anime to your watchlist and watch a few things, then refresh.</p>';
    }
    loaded += newItems.length;
    busy = false;
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
          try { localStorage.removeItem(REC_CACHE_KEY); } catch(_){}
          loaded=0;
          currentRecs=[];
          loadRecommendations(PAGE_SIZE,true);
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
      btn.addEventListener("click", function(){ try{localStorage.removeItem(REC_CACHE_KEY);}catch(_){} loaded = 0; currentRecs=[]; loadRecommendations(PAGE_SIZE, true); });
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
    // initial load
    loadRecommendations(PAGE_SIZE, true);
    // reload when watchlist/history changes — also invalidate profile cache
    window.addEventListener("vwl-updated", function(){ try{localStorage.removeItem(PROFILE_KEY);}catch(_){} try{localStorage.removeItem(REC_CACHE_KEY);}catch(_){} loaded=0; currentRecs=[]; loadRecommendations(PAGE_SIZE,true); });
    window.addEventListener("vw-cw-updated", function(){ try{localStorage.removeItem(PROFILE_KEY);}catch(_){} loaded=0; });
    // when tab becomes active, ensure loaded
    var slider = document.getElementById("homeSlider");
    if (slider) {
      new MutationObserver(function(){
        if (slider.getAttribute("data-active") === "recommended" && loaded === 0) loadRecommendations(PAGE_SIZE,true);
      }).observe(slider, { attributes:true, attributeFilter:["data-active"] });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
