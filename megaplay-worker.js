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
 * Endpoints:
 *   GET /resolve?id=<embedId>&type=sub|dub
 *        -> { ok:true, file:"<worker>/hls?u=<encoded master.m3u8>" }
 *        feed `file` straight into hls.js.
 *   GET /hls?u=<encoded url>
 *        -> proxied playlist (URLs rewritten) or raw segment bytes.
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
      if (url.pathname === "/hls")     return await proxyHls(url);
      if (url.pathname === "/api")     return await proxyApi(url);
      return json({
        ok: true,
        usage:
          "/resolve?id=<embedId>&type=sub|dub  |  /hls?u=<encoded>  |  " +
          "/api?u=<encoded anikotoapi url>",
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

// ── /hls ────────────────────────────────────────────────────────────
const M3U8_RE = /\.m3u8(\?|$)/i;

async function proxyHls(url) {
  const target = url.searchParams.get("u");
  if (!target)
    return new Response("missing u", { status: 400, headers: CORS });

  const upstream = await fetch(target, {
    headers: { "User-Agent": UA, "Referer": REF, "Accept": "*/*" },
  });
  if (!upstream.ok)
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
    return new Response(upstream.body, { status: 200, headers: h });
  }

  // Playlist — rewrite every URL to route back through this Worker.
  const text      = await upstream.text();
  const proxyBase = `${url.origin}/hls?u=`;
  const h = new Headers(CORS);
  h.set("content-type", "application/vnd.apple.mpegurl");
  return new Response(rewritePlaylist(text, target, proxyBase), {
    status: 200,
    headers: h,
  });
}

function rewritePlaylist(text, baseUrl, proxyBase) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        // Rewrite URI="..." inside EXT-X-KEY / EXT-X-MEDIA directives.
        return line.replace(/URI="([^"]+)"/g, (_w, uri) => {
          const abs = absolutize(uri, baseUrl);
          return `URI="${proxyBase}${encodeURIComponent(abs)}"`;
        });
      }
      // Bare URL line: child playlist or segment.
      return proxyBase + encodeURIComponent(absolutize(t, baseUrl));
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
