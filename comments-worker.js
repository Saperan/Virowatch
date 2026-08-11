/**
 * Virowatch comments — Cloudflare Worker + D1
 *
 * SETUP (one time, Cloudflare dashboard):
 *  1. Workers & Pages → Create → Worker, name it e.g. "vw-comments",
 *     paste this file as the code.
 *  2. Storage & Databases → D1 → Create database, name "vw-comments".
 *  3. Worker → Settings → Bindings → Add → D1 database:
 *     variable name DB, database vw-comments.
 *  4. Put the worker's URL into WORKER in comments.js.
 *
 * Auth: the client sends its AniList access token as
 * "Authorization: Bearer <token>". The worker verifies it against
 * AniList's GraphQL Viewer query (cached ~10 min per isolate), so the
 * commenter's id/name/avatar can't be spoofed.
 *
 * API (all JSON, CORS *):
 *   GET  /comments?key=<episodeKey>      → { ok, comments:[...] }
 *        (with Authorization: also fills myVote per comment)
 *   POST /comments  { key, text, parent? }        auth required
 *   POST /vote      { id, dir: 1 | -1 | 0 }       auth required
 *   POST /delete    { id }                        author or admin
 *   POST /report    { id, reason? }               auth required (flag a comment)
 *   GET  /admin/reports                           admin: open reports
 *   POST /admin/report/resolve { reportId }       admin: dismiss a report
 */

// AniList user ids allowed to delete anyone's comment, browse the global
// feed (/admin/comments) and ban/unban users (site owner/mods).
// Extra mods can also come from the Worker env var MODS (comma-separated
// AniList IDs) — shared with the social worker so one list mods both. Admin
// power still additionally requires the ADMIN_KEY secret (see adminOk).
const ADMIN_IDS = [8107729]; // Saperan

// combined mod id set: the hardcoded ADMIN_IDS plus env.MODS
function modIdSet(env) {
  const extra = String((env && env.MODS) || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  return new Set([...ADMIN_IDS, ...extra]);
}
function isModId(id, env) {
  return modIdSet(env).has(Number(id));
}

const MAX_LEN = 1000;      // max comment length
const RATE_N = 5;          // max comments per RATE_WIN per user
const RATE_WIN = 60_000;   // ms

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS comments (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         ckey TEXT NOT NULL,
         parent INTEGER,
         user_id INTEGER NOT NULL,
         user_name TEXT NOT NULL,
         user_avatar TEXT,
         text TEXT NOT NULL,
         ts INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_comments_ckey ON comments(ckey)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS votes (
         comment_id INTEGER NOT NULL,
         user_id INTEGER NOT NULL,
         dir INTEGER NOT NULL,
         PRIMARY KEY (comment_id, user_id)
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS banned (
         user_id INTEGER PRIMARY KEY,
         user_name TEXT,
         by_id INTEGER,
         ts INTEGER
       )`,
    ),
    // user reports of comments; status open|resolved. Admins review these.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS reports (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         comment_id INTEGER NOT NULL,
         reporter_id INTEGER NOT NULL,
         reporter_name TEXT,
         reason TEXT,
         ts INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'open'
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, ts)`),
  ]);
  schemaReady = true;
}

// token → { user, exp } — survives per-isolate, cheap re-verify otherwise
const tokenCache = new Map();
let verifyFail = ""; // why the last verifyToken returned null (for 401 bodies)

// Fallback identity when AniList blocks the worker's check (their firewall
// 403s Cloudflare Workers): AniList access tokens are JWTs whose payload
// carries the user id (sub) and the OAuth app they belong to (aud). We
// require aud = the Virowatch AniList app. This is NOT cryptographic proof
// (we can't check the signature without AniList's key) — admin powers are
// therefore additionally gated on ADMIN_KEY below.
const OUR_CLIENT_ID = "45267";

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(atob(b64));
    if (String(p.aud) !== OUR_CLIENT_ID) return null;
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    const id = Number(p.sub) || 0;
    return id || null;
  } catch (_) {
    return null;
  }
}

async function verifyToken(req, body) {
  verifyFail = "no Authorization header";
  const h = req.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  if (!m) return null;
  const token = m[1];

  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;

  // AniList sits behind Cloudflare — send a UA or the request can get
  // bot-filtered. verifyFail carries the reason up for a useful 401 body.
  let r;
  try {
    r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Referer: "https://anilist.co/",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ query: "query{Viewer{id name avatar{medium}}}" }),
    });
  } catch (e) {
    r = null; // unreachable — fall through to the JWT fallback below
  }

  if (r && r.ok) {
    const d = await r.json().catch(() => null);
    const v = d && d.data && d.data.Viewer;
    if (!v || !v.id) {
      verifyFail = "token not accepted by AniList";
      return null;
    }
    const user = {
      id: v.id,
      name: v.name || "AniList user",
      avatar: (v.avatar && v.avatar.medium) || "",
      verified: true,
    };
    tokenCache.set(token, { user, exp: Date.now() + 10 * 60_000 });
    if (tokenCache.size > 500) tokenCache.clear(); // crude memory cap
    return user;
  }

  // AniList answered 401-ish = the token itself is bad; only fall back when
  // AniList blocked/failed the check (403 / 5xx / unreachable).
  if (r && (r.status === 400 || r.status === 401)) {
    verifyFail = "token rejected by AniList (HTTP " + r.status + ")";
    return null;
  }

  const id = decodeJwt(token);
  if (!id) {
    verifyFail = "anilist check blocked and token not decodable";
    return null;
  }
  const user = {
    id,
    // display name/avatar can't be fetched — client supplies them on POSTs
    name: String((body && body.name) || "AniList user").slice(0, 60),
    avatar: String((body && body.avatar) || "").slice(0, 300),
    verified: false,
  };
  return user;
}

// Admin = id on the list AND the right ADMIN_KEY header. The key exists
// because fallback identity above is client-claimed — without it, anyone
// could claim an admin's id and moderate. Set it once in the dashboard:
// worker → Settings → Variables and secrets → add secret ADMIN_KEY.
function adminOk(req, env, user) {
  return !!(
    user &&
    isModId(user.id, env) &&
    env.ADMIN_KEY &&
    req.headers.get("X-Admin-Key") === env.ADMIN_KEY
  );
}

async function listComments(db, key, user) {
  const rows = await db
    .prepare(
      `SELECT c.id, c.parent, c.user_id, c.user_name, c.user_avatar, c.text, c.ts,
              COALESCE(SUM(CASE WHEN v.dir = 1  THEN 1 END), 0) AS likes,
              COALESCE(SUM(CASE WHEN v.dir = -1 THEN 1 END), 0) AS dislikes
         FROM comments c
         LEFT JOIN votes v ON v.comment_id = c.id
        WHERE c.ckey = ?1
        GROUP BY c.id
        ORDER BY c.ts ASC`,
    )
    .bind(key)
    .all();

  const mine = new Map();
  if (user) {
    const mv = await db
      .prepare(
        `SELECT comment_id, dir FROM votes
          WHERE user_id = ?1
            AND comment_id IN (SELECT id FROM comments WHERE ckey = ?2)`,
      )
      .bind(user.id, key)
      .all();
    for (const r of mv.results) mine.set(r.comment_id, r.dir);
  }

  return rows.results.map((c) => ({
    id: c.id,
    parent: c.parent || null,
    user: { id: c.user_id, name: c.user_name, avatar: c.user_avatar || "" },
    text: c.text,
    ts: c.ts,
    likes: c.likes,
    dislikes: c.dislikes,
    myVote: mine.get(c.id) || 0,
    mine: !!(user && user.id === c.user_id),
  }));
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const db = env.DB;
    if (!db) return json({ ok: false, error: "D1 binding DB missing" }, 500);
    await ensureSchema(db);

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (req.method === "GET" && path === "/comments") {
        const key = (url.searchParams.get("key") || "").slice(0, 300);
        if (!key) return json({ ok: false, error: "key required" }, 400);
        const user = await verifyToken(req); // optional — fills myVote/mine
        const admin = adminOk(req, env, user);
        let reportsOpen = 0;
        if (admin) {
          const rc = await db
            .prepare(`SELECT COUNT(*) AS n FROM reports WHERE status = 'open'`)
            .first();
          reportsOpen = (rc && rc.n) || 0;
        }
        return json({
          ok: true,
          admin,
          // id is on the admin list but no/wrong key yet — client prompts for it
          adminEligible: !!(user && isModId(user.id, env) && !admin),
          reportsOpen,
          comments: await listComments(db, key, user),
        });
      }

      // ── Moderation: global feed of everything posted, newest first ──
      if (req.method === "GET" && path === "/admin/comments") {
        const user = await verifyToken(req);
        if (!adminOk(req, env, user))
          return json({ ok: false, error: "admins only" }, 403);
        const before = Number(url.searchParams.get("before")) || Date.now() + 1;
        const rows = await db
          .prepare(
            `SELECT id, ckey, parent, user_id, user_name, user_avatar, text, ts
               FROM comments WHERE ts < ?1 ORDER BY ts DESC LIMIT 100`,
          )
          .bind(before)
          .all();
        const bans = await db
          .prepare(`SELECT user_id, user_name, ts FROM banned ORDER BY ts DESC`)
          .all();
        return json({ ok: true, comments: rows.results, banned: bans.results });
      }

      // ── Moderation: open reports, newest first (comment may be deleted) ──
      if (req.method === "GET" && path === "/admin/reports") {
        const user = await verifyToken(req);
        if (!adminOk(req, env, user))
          return json({ ok: false, error: "admins only" }, 403);
        const rows = await db
          .prepare(
            `SELECT r.id AS report_id, r.reason, r.ts AS report_ts,
                    r.reporter_id, r.reporter_name,
                    c.id AS id, c.ckey, c.parent, c.user_id, c.user_name,
                    c.user_avatar, c.text, c.ts
               FROM reports r LEFT JOIN comments c ON c.id = r.comment_id
              WHERE r.status = 'open'
              ORDER BY r.ts DESC LIMIT 200`,
          )
          .all();
        return json({ ok: true, reports: rows.results });
      }

      if (req.method !== "POST") return json({ ok: false, error: "not found" }, 404);
      const body = await req.json().catch(() => ({}));
      const user = await verifyToken(req, body);
      if (!user)
        return json({ ok: false, error: "AniList login required — " + verifyFail }, 401);
      const isAdmin = adminOk(req, env, user);

      // ── Moderation: ban / unban ──
      if (path === "/admin/ban" || path === "/admin/unban") {
        if (!isAdmin) return json({ ok: false, error: "admins only" }, 403);
        const uid = Number(body.userId) || 0;
        if (!uid) return json({ ok: false, error: "userId required" }, 400);
        if (isModId(uid, env))
          return json({ ok: false, error: "can't ban a mod" }, 400);
        if (path === "/admin/ban") {
          await db
            .prepare(
              `INSERT INTO banned (user_id, user_name, by_id, ts)
               VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT (user_id) DO UPDATE SET user_name = ?2, by_id = ?3, ts = ?4`,
            )
            .bind(uid, String(body.name || ""), user.id, Date.now())
            .run();
        } else {
          await db.prepare(`DELETE FROM banned WHERE user_id = ?1`).bind(uid).run();
        }
        return json({ ok: true });
      }

      // ── Moderation: dismiss a report ──
      if (path === "/admin/report/resolve") {
        if (!isAdmin) return json({ ok: false, error: "admins only" }, 403);
        const rid = Number(body.reportId) || 0;
        if (!rid) return json({ ok: false, error: "reportId required" }, 400);
        await db.prepare(`UPDATE reports SET status = 'resolved' WHERE id = ?1`).bind(rid).run();
        return json({ ok: true });
      }

      // Banned users can still read, but not post/vote/delete/report.
      const ban = await db
        .prepare(`SELECT user_id FROM banned WHERE user_id = ?1`)
        .bind(user.id)
        .first();
      if (ban) return json({ ok: false, error: "you are banned from commenting" }, 403);

      // ── Report a comment ──
      if (path === "/report") {
        const id = Number(body.id) || 0;
        if (!id) return json({ ok: false, error: "id required" }, 400);
        const c = await db.prepare(`SELECT id FROM comments WHERE id = ?1`).bind(id).first();
        if (!c) return json({ ok: false, error: "no such comment" }, 404);
        const dup = await db
          .prepare(`SELECT 1 FROM reports WHERE comment_id = ?1 AND reporter_id = ?2 AND status = 'open'`)
          .bind(id, user.id)
          .first();
        if (dup) return json({ ok: true, already: true });
        await db
          .prepare(
            `INSERT INTO reports (comment_id, reporter_id, reporter_name, reason, ts, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'open')`,
          )
          .bind(id, user.id, String(user.name || "").slice(0, 60), String(body.reason || "").slice(0, 300), Date.now())
          .run();
        return json({ ok: true });
      }

      if (path === "/comments") {
        const key = String(body.key || "").slice(0, 300);
        const text = String(body.text || "").trim();
        const parent = Number(body.parent) || null;
        if (!key || !text) return json({ ok: false, error: "key and text required" }, 400);
        if (text.length > MAX_LEN)
          return json({ ok: false, error: `max ${MAX_LEN} characters` }, 400);

        const recent = await db
          .prepare(`SELECT COUNT(*) AS n FROM comments WHERE user_id = ?1 AND ts > ?2`)
          .bind(user.id, Date.now() - RATE_WIN)
          .first();
        if (recent.n >= RATE_N)
          return json({ ok: false, error: "slow down — too many comments" }, 429);

        if (parent) {
          // replies can nest (reply-to-reply), but must stay on the same episode
          const p = await db
            .prepare(`SELECT id, ckey FROM comments WHERE id = ?1`)
            .bind(parent)
            .first();
          if (!p || p.ckey !== key)
            return json({ ok: false, error: "bad parent" }, 400);
        }

        await db
          .prepare(
            `INSERT INTO comments (ckey, parent, user_id, user_name, user_avatar, text, ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .bind(key, parent, user.id, user.name, user.avatar, text, Date.now())
          .run();
        return json({ ok: true, comments: await listComments(db, key, user) });
      }

      if (path === "/vote") {
        const id = Number(body.id) || 0;
        const dir = Number(body.dir);
        if (!id || ![-1, 0, 1].includes(dir))
          return json({ ok: false, error: "bad vote" }, 400);
        const c = await db
          .prepare(`SELECT ckey FROM comments WHERE id = ?1`)
          .bind(id)
          .first();
        if (!c) return json({ ok: false, error: "no such comment" }, 404);
        if (dir === 0) {
          await db
            .prepare(`DELETE FROM votes WHERE comment_id = ?1 AND user_id = ?2`)
            .bind(id, user.id)
            .run();
        } else {
          await db
            .prepare(
              `INSERT INTO votes (comment_id, user_id, dir) VALUES (?1, ?2, ?3)
               ON CONFLICT (comment_id, user_id) DO UPDATE SET dir = ?3`,
            )
            .bind(id, user.id, dir)
            .run();
        }
        return json({ ok: true, comments: await listComments(db, c.ckey, user) });
      }

      if (path === "/delete") {
        const id = Number(body.id) || 0;
        const c = await db
          .prepare(`SELECT user_id, ckey FROM comments WHERE id = ?1`)
          .bind(id)
          .first();
        if (!c) return json({ ok: false, error: "no such comment" }, 404);
        if (c.user_id !== user.id && !isAdmin)
          return json({ ok: false, error: "not yours" }, 403);
        // close any reports on this comment or its replies (walk while the
        // rows still exist — the delete batch below removes them)
        await db
          .prepare(
            `WITH RECURSIVE tree(id) AS (
               SELECT id FROM comments WHERE id = ?1
               UNION ALL
               SELECT c.id FROM comments c JOIN tree t ON c.parent = t.id
             )
             UPDATE reports SET status = 'resolved' WHERE comment_id IN (SELECT id FROM tree)`,
          )
          .bind(id)
          .run();
        // whole subtree (replies nest arbitrarily deep) — votes first, since
        // the second statement removes the rows the recursive walk needs
        await db.batch([
          db
            .prepare(
              `WITH RECURSIVE tree(id) AS (
                 SELECT id FROM comments WHERE id = ?1
                 UNION ALL
                 SELECT c.id FROM comments c JOIN tree t ON c.parent = t.id
               )
               DELETE FROM votes WHERE comment_id IN (SELECT id FROM tree)`,
            )
            .bind(id),
          db
            .prepare(
              `WITH RECURSIVE tree(id) AS (
                 SELECT id FROM comments WHERE id = ?1
                 UNION ALL
                 SELECT c.id FROM comments c JOIN tree t ON c.parent = t.id
               )
               DELETE FROM comments WHERE id IN (SELECT id FROM tree)`,
            )
            .bind(id),
        ]);
        return json({ ok: true, comments: await listComments(db, c.ckey, user) });
      }

      return json({ ok: false, error: "not found" }, 404);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500);
    }
  },
};
