/**
 * megaplay-worker.js  —  Cloudflare Worker
 *
 * Backup stream resolver + HLS proxy for Virowatch anime (Anikoto / MegaPlay).
 *
 * Problem it solves:
 *   MegaPlay's video CDN (cdn.mewstream.buzz + orbitra.click) is
 *   Referer-gated AND geo-blocked, so the embed only plays behind a VPN.
 *   This Worker runs on Cloudflare's edge, sends the required
 *   `Referer: https://megaplay.buzz/` header, and proxies the whole HLS
 *   playlist + segments back to the browser — no VPN needed.
 *
 * It also resolves Vidnest's movie/TV backends (see /vd below) — those have
 * to be resolved *server-side*: their CDNs are Referer-gated and some bake
 * the requesting IP into the signed URL, so a URL resolved in the browser
 * and fetched by the Worker (or vice versa) gets a 403. Resolve + fetch
 * both happen here, so the IP matches.
 *
 * Endpoints:
 *   GET /resolve?id=<embedId>&type=sub|dub
 *        -> { ok:true, file:"<worker>/hls?u=<encoded master.m3u8>" }
 *        feed `file` straight into hls.js.
 *   GET /hls?u=<encoded url>[&r=<referer>]
 *        -> proxied playlist (URLs rewritten) or raw segment bytes.
 *   GET /vd?type=movie|tv&id=<tmdbId>[&s=&e=][&src=<backend>]
 *        -> { ok:true, source, kind:"hls"|"mp4", file, tracks, sources }
 *
 * Deploy: paste as your Worker's module entry (or `wrangler deploy`).
 */

const MEGA = "https://megaplay.buzz";
const REF  = "https://megaplay.buzz/";
const UA   =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, { headers: CORS });

    try {
      if (url.pathname === "/resolve") return await resolve(url);
      if (url.pathname === "/hls")     return await proxyHls(url, request);
      if (url.pathname === "/api")     return await proxyApi(url);
      if (url.pathname === "/vd")      return await vdResolve(url);
      return json({
        ok: true,
        usage:
          "/resolve?id=<embedId>&type=sub|dub  |  /hls?u=<encoded>[&r=<referer>]  |  " +
          "/api?u=<encoded anikotoapi url>  |  " +
          "/vd?type=movie|tv&id=<tmdbId>[&s=&e=][&src=<backend>]",
      });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 500);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// ── /resolve ────────────────────────────────────────────────────────
async function resolve(url) {
  const id   = url.searchParams.get("id");
  const type =
    (url.searchParams.get("type") || "sub").toLowerCase() === "dub"
      ? "dub"
      : "sub";
  if (!id) return json({ ok: false, error: "missing id" }, 400);

  // 1. Load the player page, scrape the internal data-id.
  const pageRes = await fetch(`${MEGA}/stream/s-2/${id}/${type}`, {
    headers: { "User-Agent": UA, "Referer": `${MEGA}/stream/s-3/${id}/${type}` },
  });
  const html = await pageRes.text();
  const m = html.match(/data-id="(\d+)"/);
  if (!m)
    return json(
      { ok: false, error: "episode not on MegaPlay yet (no data-id)" },
      404,
    );
  const dataId = m[1];

  // 2. Ask MegaPlay for the sources (plain m3u8, not encrypted).
  const srcRes = await fetch(`${MEGA}/stream/getSources?id=${dataId}`, {
    headers: {
      "User-Agent": UA,
      "Referer": `${MEGA}/stream/s-2/${id}/${type}`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const data = await srcRes.json();
  const file = data && data.sources && data.sources.file;
  if (!file) return json({ ok: false, error: "no source file returned" }, 404);

  const proxyBase = `${url.origin}/hls?u=`;

  // Tracks (subtitles) also sit behind the referer gate — proxy them too.
  const tracks = Array.isArray(data.tracks)
    ? data.tracks.map((t) => ({
        ...t,
        file: t && t.file ? proxyBase + encodeURIComponent(t.file) : t.file,
      }))
    : [];

  return json({
    ok: true,
    file: proxyBase + encodeURIComponent(file),
    tracks,
    intro: data.intro || null,
    outro: data.outro || null,
  });
}

// ── /api ── generic CORS passthrough for the Anikoto API ────────────
// Allowlisted so the Worker can't be used as an open proxy:
//   anikotoapi.site — the Anikoto catalog API
//   vdrk.site       — Vidnest movie/TV subtitle listing (sub.vdrk.site),
//                     which omits CORS on its 404 "no subtitles" response.
async function proxyApi(url) {
  const target = url.searchParams.get("u");
  if (!target) return json({ ok: false, error: "missing u" }, 400);
  let host;
  try { host = new URL(target).hostname; }
  catch { return json({ ok: false, error: "bad url" }, 400); }
  if (!/(^|\.)(anikotoapi\.site|vdrk\.site)$/i.test(host))
    return json({ ok: false, error: "host not allowed" }, 403);

  const up = await fetch(target, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  const body = await up.text();
  const h = new Headers(CORS);
  h.set("content-type", up.headers.get("content-type") || "application/json");
  h.set("cache-control", "public, max-age=60");
  return new Response(body, { status: up.status, headers: h });
}

// ── /vd ── Vidnest movie/TV backends, resolved server-side ──────────
// Vidnest's own site fans a title out over ~11 backends. Three of them are
// usable from the browser directly (hollymoviehd, videasy, moviebox — see
// vidnest-loader.js); the ones below are not, because their CDNs demand a
// Referer the browser can't set and/or sign the URL against the resolving
// client's IP. Resolving AND proxying here keeps both consistent.
//
// Order = success rate measured across a sample of movies + TV episodes;
// vidxyz and allmovies between them covered every title tried. The other
// backends Vidnest lists are all dropped, each for a reason that no amount
// of proxying fixes: klikxxi 403s, nextgencloudfabric's CDN is down (522),
// vidlink + moviebox sit on the dead hakunaymatata CDN, moviesapi's
// playlists parse but its segments 400 ("fail to get template"), and vidzee
// only ever serves Matroska, which browsers can't demux.
const VD_API = "https://new.vidnest.fun";
const VD_ALPHABET =
  "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";

// Same fake "encryption" the browser side decodes — base64 against a
// substitution alphabet Vidnest ships in its own client bundle.
function vdDecode(str) {
  const table = {};
  for (let i = 0; i < VD_ALPHABET.length; i++) table[VD_ALPHABET[i]] = i;
  const bytes = [];
  for (let i = 0; i < str.length; i += 4) {
    let chunk = str.slice(i, i + 4);
    while (chunk.length < 4) chunk += "=";
    const v = [];
    for (let j = 0; j < 4; j++) {
      const x = table[chunk[j]];
      v.push(x !== undefined ? x : 64);
    }
    bytes.push((v[0] << 2) | (v[1] >> 4));
    if (v[2] !== 64) bytes.push(((v[1] & 15) << 4) | (v[2] >> 2));
    if (v[3] !== 64) bytes.push(((v[2] & 3) << 6) | v[3]);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

async function vdApi(path) {
  try {
    const r = await fetch(`${VD_API}/${path}`, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.encrypted) return j;
    return JSON.parse(vdDecode(j.data));
  } catch {
    return null;
  }
}

// bcdn/cacdn.hakunaymatata.com blocks datacenter IPs and serves H.265 —
// unplayable through a Worker or in a browser. Never hand those out.
const VD_DEAD = /(^|\.)hakunaymatata\.com$/i;
function vdDead(u) {
  try { return VD_DEAD.test(new URL(u).hostname); } catch { return true; }
}

// Each backend maps its own response shape onto
// { file, referer, kind:"hls"|"mp4", tracks:[{label,file}] }.
// `path`+`pick` = a Vidnest backend (one call, one decode); `resolve` = a
// provider with its own multi-step flow.
const VD_BACKENDS = [
  { id: "beta",  name: "Beta",  path: "vidxyz",    pick: pickStreams },
  // videasy answers with a bare {url}. It's CORS-open so it could be played
  // without this proxy, but its segments sit on the same flaky tiktok CDN as
  // moviesapi and 400 on a good share of titles — it only stays in the list
  // because the segment probe below catches that before the player does.
  { id: "catflix", name: "Catflix", path: "videasy",
    pick: (d) =>
      d && typeof d.url === "string" && !vdDead(d.url)
        ? { file: d.url, referer: null, kind: "hls", tracks: [] }
        : null },
  { id: "xps", name: "2Embed", resolve: resolveXpass },
  // Last: allmovies is the one that quietly went dead in 2026-07 and it still
  // hands out links more often than it hands out working ones.
  { id: "lamda", name: "Lamda", path: "allmovies", pick: pickStreams },
];

// ── 2Embed ──────────────────────────────────────────────────────────
// 2embed.cc is a *wrapper*, not a source: its three servers are `vnest`
// (Vidnest — already resolved directly above, ad-free), `vcr`
// (vidcore.net) and `xps`, which is the only one of the three that adds
// anything. Its chain, all keyed by plain TMDB id:
//   /e/movie/<id> | /e/tv/<id>/<season>/<ep>  -> HTML carrying var data={…}
//   -> data.playlist (a relative playlist.json) -> sources[0].file (.m3u8)
// The CDN (*.1x2.space) echoes an Access-Control-Allow-Origin of
// play.xpass.top only, so the browser can't fetch it — it goes through
// /hls with that Referer like the rest. Subtitles come from a separate,
// generous listing (7-55 languages per title).
const XPS = "https://play.xpass.top";
const XPS_SUB = "https://sub.1x2.space";

async function resolveXpass(tail) {
  const page = await fetch(`${XPS}/e/${tail}`, {
    headers: { "User-Agent": UA, Referer: "https://streamsrcs.2embed.cc/" },
  });
  if (!page.ok) return null;
  // The embed page inlines a jwplayer config; the playlist path is all we want.
  const m = (await page.text()).match(/"playlist":"([^"]+)"/);
  if (!m) return null;

  const listRes = await fetch(new URL(m[1], XPS).toString(), {
    headers: { "User-Agent": UA, Referer: `${XPS}/e/${tail}` },
  });
  if (!listRes.ok) return null;
  const list = await listRes.json().catch(() => null);
  const file = list?.playlist?.[0]?.sources?.[0]?.file;
  if (!file || vdDead(file)) return null;

  return { file, referer: `${XPS}/`, kind: "hls", tracks: await xpassSubs(tail) };
}

async function xpassSubs(tail) {
  try {
    const r = await fetch(`${XPS_SUB}/api/${tail}`, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const subs = await r.json();
    return (Array.isArray(subs) ? subs : [])
      .filter((s) => s && s.url)
      .map((s) => ({
        label: s.label || s.language || "Subtitle",
        file: new URL(s.url, XPS_SUB).toString(),
      }));
  } catch {
    return [];
  }
}

function pickStreams(data) {
  const list = (data && Array.isArray(data.streams) ? data.streams : []).filter(
    (s) => s && s.url && !vdDead(s.url),
  );
  if (!list.length) return null;
  const s = list[0];
  return {
    file: s.url,
    referer: (s.headers && s.headers.Referer) || null,
    kind: s.type === "mp4" ? "mp4" : "hls",
    tracks: (Array.isArray(data.subtitles) ? data.subtitles : [])
      .filter((t) => t && t.url)
      .map((t) => ({ label: t.lang || "Subtitle", file: t.url })),
  };
}

// A backend answering 200 with JSON still routinely hands back a link its
// CDN then 404s/403s, so every candidate is verified before it's offered to
// the player — that check is the whole point of resolving here.
//
// The check has to walk all the way down to a real segment: several
// backends serve a perfectly valid master playlist whose segments then 400
// ("fail to get template"), which in the player looks like a black screen
// with no error at all. Master -> variant -> first segment, ~3 requests.
async function vdPlayable(pick) {
  const grab = (u, extra) =>
    fetch(u, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        ...(pick.referer ? { Referer: pick.referer } : {}),
        ...extra,
      },
    });
  try {
    const r = await grab(pick.file);
    if (!r.ok) { if (r.body) await r.body.cancel(); return false; }
    if (pick.kind !== "hls") { if (r.body) await r.body.cancel(); return true; }

    let text = await r.text();
    let base = pick.file;
    // Master playlists point at variant playlists; follow one level down.
    let line = firstUrlLine(text);
    if (!line) return false;
    if (!/#EXTINF/i.test(text)) {
      const variant = absolutize(line, base);
      const vr = await grab(variant);
      if (!vr.ok) return false;
      text = await vr.text();
      base = variant;
      line = firstUrlLine(text);
      if (!line) return false;
    }
    const seg = await grab(absolutize(line, base), { Range: "bytes=0-1" });
    if (seg.body) await seg.body.cancel();
    return seg.ok || seg.status === 206;
  } catch {
    return false;
  }
}

function firstUrlLine(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
}

async function vdResolve(url) {
  const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
  const id = url.searchParams.get("id");
  const s = url.searchParams.get("s");
  const e = url.searchParams.get("e");
  const only = url.searchParams.get("src");
  if (!id) return json({ ok: false, error: "missing id" }, 400);

  const tail =
    type === "tv"
      ? `${type}/${id}/${s || 1}/${e || 1}`
      : `${type}/${id}`;
  const list = only ? VD_BACKENDS.filter((b) => b.id === only) : VD_BACKENDS;
  const catalog = VD_BACKENDS.map((b) => ({ id: b.id, name: b.name }));

  for (const b of list) {
    let pick = null;
    try {
      if (b.resolve) {
        pick = await b.resolve(tail);
      } else {
        const data = await vdApi(`${b.path}/${tail}`);
        pick = data && b.pick(data);
      }
    } catch { pick = null; } // one broken provider must not sink the chain
    if (!pick || !(await vdPlayable(pick))) continue;

    const proxy = (u) =>
      `${url.origin}/hls?u=${encodeURIComponent(u)}` +
      (pick.referer ? `&r=${encodeURIComponent(pick.referer)}` : "");
    return json({
      ok: true,
      source: b.id,
      name: b.name,
      kind: pick.kind,
      file: proxy(pick.file),
      tracks: pick.tracks.map((t) => ({ label: t.label, file: proxy(t.file) })),
      sources: catalog,
    });
  }
  return json({ ok: false, error: "no playable source", sources: catalog }, 404);
}

// ── /hls ────────────────────────────────────────────────────────────
const M3U8_RE = /\.m3u8(\?|$)/i;

async function proxyHls(url, request) {
  const target = url.searchParams.get("u");
  if (!target)
    return new Response("missing u", { status: 400, headers: CORS });
  // `r` overrides the MegaPlay default — each /vd backend's CDN wants its own.
  const referer = url.searchParams.get("r") || REF;
  // Seeking an mp4 backend means the browser sends Range — forward it, or
  // <video> can only ever play from 0.
  const range = request && request.headers.get("range");

  const upstream = await fetch(target, {
    headers: {
      "User-Agent": UA,
      "Referer": referer,
      "Accept": "*/*",
      ...(range ? { Range: range } : {}),
    },
  });
  if (!upstream.ok && upstream.status !== 206)
    return new Response("upstream " + upstream.status, {
      status: upstream.status,
      headers: CORS,
    });

  const ct     = upstream.headers.get("content-type") || "";
  const isM3u8 = M3U8_RE.test(target) || ct.includes("mpegurl");

  if (!isM3u8) {
    // Segment / key / subtitle — stream raw bytes straight through.
    // Force text/vtt for subtitles or the browser <track> ignores them.
    const isVtt = /\.vtt(\?|$)/i.test(target);
    const h = new Headers(CORS);
    h.set(
      "content-type",
      isVtt ? "text/vtt; charset=utf-8" : ct || "application/octet-stream",
    );
    h.set("cache-control", "public, max-age=3600");
    h.set("accept-ranges", "bytes");
    ["content-range", "content-length"].forEach((k) => {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    });
    return new Response(upstream.body, { status: upstream.status, headers: h });
  }

  // Playlist — rewrite every URL to route back through this Worker.
  const text      = await upstream.text();
  const proxyBase = `${url.origin}/hls?u=`;
  // Child playlists/segments need the same Referer as their master.
  const refSuffix =
    referer === REF ? "" : `&r=${encodeURIComponent(referer)}`;
  const h = new Headers(CORS);
  h.set("content-type", "application/vnd.apple.mpegurl");
  return new Response(rewritePlaylist(text, target, proxyBase, refSuffix), {
    status: 200,
    headers: h,
  });
}

function rewritePlaylist(text, baseUrl, proxyBase, refSuffix = "") {
  const wrap = (u) => proxyBase + encodeURIComponent(absolutize(u, baseUrl)) + refSuffix;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        // Rewrite URI="..." inside EXT-X-KEY / EXT-X-MEDIA directives.
        return line.replace(/URI="([^"]+)"/g, (_w, uri) => `URI="${wrap(uri)}"`);
      }
      // Bare URL line: child playlist or segment.
      return wrap(t);
    })
    .join("\n");
}

function absolutize(u, baseUrl) {
  try {
    return new URL(u, baseUrl).toString();
  } catch {
    return u;
  }
}
