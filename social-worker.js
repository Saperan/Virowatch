/**
 * Virowatch social — friends + direct messages (Cloudflare Worker + D1)
 *
 * SETUP (one time, Cloudflare dashboard):
 *  1. Workers & Pages → Create → Worker, name it e.g. "vw-social",
 *     paste this file as the code.
 *  2. Storage & Databases → D1 → Create database, name "vw-social".
 *  3. Worker → Settings → Bindings → Add → D1 database:
 *     variable name DB, database vw-social.
 *  4. Put the worker's URL into WORKER in social.js.
 *
 * Auth mirrors comments-worker.js: the client sends its AniList access token
 * as "Authorization: Bearer <token>". The worker verifies it against AniList's
 * Viewer query (cached ~10 min per isolate); if AniList blocks the worker
 * (their firewall 403s Cloudflare) it falls back to the token's JWT payload,
 * requiring aud = the Virowatch app. Identity there is client-claimed for
 * display name/avatar, same trade-off as comments.
 *
 * API (all JSON, CORS *; every route needs Authorization):
 *   GET  /me                       → { ok, user }                upsert + whoami
 *   GET  /users?q=<name>           → { ok, users:[...] }         search cache
 *   GET  /friends                  → { ok, friends, incoming, outgoing }
 *   POST /friend/request { toId, toName, toAvatar }
 *   POST /friend/respond { fromId, accept:bool }
 *   POST /friend/remove  { otherId }
 *   GET  /threads                  → { ok, threads:[...] }       inbox + unread
 *   GET  /messages?with=<id>&after=<ts>  → { ok, messages:[...] }
 *   POST /message { toId, kind, text?, clip?, gifUrl? }
 *   POST /read    { withId }
 *   POST /report  { id, group?, reason? }        flag a message for mods
 *   GET  /mod/reports                            (mod) open reports, secret
 *   GET  /mod/thread?a=&b=                        (mod) read a DM, no read-mark
 *   GET  /mod/group?groupId=                      (mod) read a group, no read-mark
 *   POST /mod/delete { id, group? }              (mod) delete any message
 *   POST /mod/ban    { userId, ban:bool }        (mod) ban / unban a user
 *   POST /mod/report/resolve { reportId }        (mod) dismiss a report
 *
 * Moderators: set a Worker env var MODS = comma-separated AniList user IDs
 * (or edit MODS_FALLBACK below). Banned users can read but can't send,
 * friend-request, or report until unbanned.
 */

const MAX_TEXT = 2000;
const RATE_N = 20;         // max messages per RATE_WIN per user
const RATE_WIN = 60_000;   // ms
const OUR_CLIENT_ID = "45267";
// Moderator AniList user IDs. Prefer setting a `MODS` env var / Worker variable
// (comma-separated IDs) so you don't have to redeploy; this constant is the
// fallback. Add your own AniList ID here to become a mod.
const MODS_FALLBACK = "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-VW-Name, X-VW-Avatar",
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
      `CREATE TABLE IF NOT EXISTS users (
         id INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         avatar TEXT,
         updated INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)`),
    // one row per relationship. req_id asked rec_id; status pending|accepted.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS friends (
         req_id INTEGER NOT NULL,
         rec_id INTEGER NOT NULL,
         status TEXT NOT NULL,
         ts INTEGER NOT NULL,
         PRIMARY KEY (req_id, rec_id)
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         from_id INTEGER NOT NULL,
         to_id INTEGER NOT NULL,
         kind TEXT NOT NULL,
         text TEXT,
         clip TEXT,
         gif TEXT,
         ts INTEGER NOT NULL,
         read INTEGER NOT NULL DEFAULT 0
       )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(from_id, to_id, ts)`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(to_id, read)`),
    // ── group chats ──
    db.prepare(
      `CREATE TABLE IF NOT EXISTS groups (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         name TEXT NOT NULL,
         owner_id INTEGER NOT NULL,
         ts INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS group_members (
         group_id INTEGER NOT NULL,
         user_id INTEGER NOT NULL,
         last_read INTEGER NOT NULL DEFAULT 0,
         joined INTEGER NOT NULL,
         PRIMARY KEY (group_id, user_id)
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_gm_user ON group_members(user_id)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS group_messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         group_id INTEGER NOT NULL,
         from_id INTEGER NOT NULL,
         kind TEXT NOT NULL,
         text TEXT,
         clip TEXT,
         gif TEXT,
         ts INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_gmsg ON group_messages(group_id, ts)`),
    // ── moderation ──
    // one row per user report of a message; is_group tells which table msg_id
    // points at. status open|resolved. Mods read these secretly.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS reports (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         msg_id INTEGER NOT NULL,
         is_group INTEGER NOT NULL DEFAULT 0,
         reporter_id INTEGER NOT NULL,
         reason TEXT,
         ts INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'open'
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, ts)`),
    // banned users — blocked from sending/friending until unbanned by a mod.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS banned (
         user_id INTEGER PRIMARY KEY,
         by_id INTEGER,
         ts INTEGER NOT NULL,
         reason TEXT
       )`,
    ),
  ]);
  // migrations for DBs created before a column existed (no-op if present)
  for (const stmt of [
    "ALTER TABLE messages ADD COLUMN reply_to INTEGER",
    "ALTER TABLE group_messages ADD COLUMN reply_to INTEGER",
  ]) {
    try { await db.prepare(stmt).run(); } catch (_) {}
  }
  schemaReady = true;
}

/* ── auth (same shape as comments-worker.js) ─────────────────────── */
const tokenCache = new Map();
let verifyFail = "";

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(atob(b64));
    if (String(p.aud) !== OUR_CLIENT_ID) return null;
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return Number(p.sub) || null;
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
  } catch (_) {
    r = null;
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
    };
    tokenCache.set(token, { user, exp: Date.now() + 10 * 60_000 });
    if (tokenCache.size > 500) tokenCache.clear();
    return user;
  }

  if (r && (r.status === 400 || r.status === 401)) {
    verifyFail = "token rejected by AniList (HTTP " + r.status + ")";
    return null;
  }

  const id = decodeJwt(token);
  if (!id) {
    verifyFail = "anilist check blocked and token not decodable";
    return null;
  }
  // AniList blocked the check — display name/avatar are client-claimed. The
  // client sends its own identity on EVERY request via X-VW-Name/Avatar
  // headers (works for GET too, where there's no body), so a friend cached
  // through this path still shows their real name instead of "AniList user".
  let hName = "";
  let hAvatar = "";
  try { hName = decodeURIComponent(req.headers.get("X-VW-Name") || ""); } catch (_) {}
  try { hAvatar = decodeURIComponent(req.headers.get("X-VW-Avatar") || ""); } catch (_) {}
  return {
    id,
    name: String(hName || (body && body.name) || "AniList user").slice(0, 60),
    avatar: String(hAvatar || (body && body.avatar) || "").slice(0, 300),
  };
}

async function upsertUser(db, u) {
  if (!u || !u.id) return;
  await db
    .prepare(
      `INSERT INTO users (id, name, avatar, updated) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (id) DO UPDATE SET name = ?2, avatar = ?3, updated = ?4`,
    )
    .bind(u.id, u.name || "AniList user", u.avatar || "", Date.now())
    .run();
}

function modIds(env) {
  const raw = (env && env.MODS) || MODS_FALLBACK;
  return new Set(
    String(raw)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(Boolean),
  );
}

async function isBanned(db, id) {
  const r = await db.prepare(`SELECT 1 FROM banned WHERE user_id = ?1`).bind(id).first();
  return !!r;
}

// are `a` and `b` accepted friends?
async function areFriends(db, a, b) {
  const row = await db
    .prepare(
      `SELECT 1 FROM friends WHERE status = 'accepted'
         AND ((req_id = ?1 AND rec_id = ?2) OR (req_id = ?2 AND rec_id = ?1))`,
    )
    .bind(a, b)
    .first();
  return !!row;
}

async function userById(db, id) {
  const r = await db
    .prepare(`SELECT id, name, avatar FROM users WHERE id = ?1`)
    .bind(id)
    .first();
  return r || { id, name: "AniList user", avatar: "" };
}

/* ── friend lists ────────────────────────────────────────────────── */
async function friendPayload(db, me) {
  const rows = await db
    .prepare(
      `SELECT req_id, rec_id, status, ts FROM friends
        WHERE req_id = ?1 OR rec_id = ?1`,
    )
    .bind(me)
    .all();

  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const f of rows.results) {
    const otherId = f.req_id === me ? f.rec_id : f.req_id;
    const other = await userById(db, otherId);
    if (f.status === "accepted") friends.push({ ...other, ts: f.ts });
    else if (f.rec_id === me) incoming.push({ ...other, ts: f.ts });
    else outgoing.push({ ...other, ts: f.ts });
  }
  return { friends, incoming, outgoing };
}

/* ── conversation summaries (inbox) ──────────────────────────────── */
async function threads(db, me) {
  // last message per counterparty + unread count from them
  const rows = await db
    .prepare(
      `SELECT
         CASE WHEN from_id = ?1 THEN to_id ELSE from_id END AS other,
         MAX(ts) AS last_ts
       FROM messages
       WHERE from_id = ?1 OR to_id = ?1
       GROUP BY other
       ORDER BY last_ts DESC`,
    )
    .bind(me)
    .all();

  const out = [];
  for (const r of rows.results) {
    const other = await userById(db, r.other);
    const last = await db
      .prepare(
        `SELECT kind, text, from_id FROM messages
          WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)
          ORDER BY ts DESC LIMIT 1`,
      )
      .bind(me, r.other)
      .first();
    const unread = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
          WHERE from_id = ?1 AND to_id = ?2 AND read = 0`,
      )
      .bind(r.other, me)
      .first();
    out.push({
      user: other,
      lastTs: r.last_ts,
      last: last || null,
      unread: (unread && unread.n) || 0,
    });
  }
  return out;
}

function clean(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}

// Validate/normalize a message body into { kind, text, clip, gif } or { error }.
// Shared by 1:1 and group sends.
function parseMsg(body) {
  const kind = ["text", "clip", "gif"].includes(body.kind) ? body.kind : "text";
  let text = clean(body.text, MAX_TEXT).trim();
  let clip = null;
  let gif = "";
  if (kind === "clip") {
    const c = body.clip || {};
    if (!c.key) return { error: "clip.key required" };
    clip = JSON.stringify({
      key: clean(c.key, 200),
      t: Math.max(0, Number(c.t) || 0),
      end: c.end != null ? Math.max(0, Number(c.end) || 0) : null,
      title: clean(c.title, 160),
      epLabel: clean(c.epLabel, 80),
      thumb: clean(c.thumb, 400),
    });
  } else if (kind === "gif") {
    gif = clean(body.gifUrl, 500);
    if (!/^https?:\/\//i.test(gif)) return { error: "bad gif url" };
  } else if (!text) {
    return { error: "empty message" };
  }
  return { kind, text: text || null, clip, gif: gif || null };
}

// Attach a small { id, from, fromName, kind, text } snippet for each message
// that replies to another. `table` is "messages" or "group_messages".
async function attachReplies(db, msgs, table) {
  const ids = [...new Set(msgs.filter((m) => m.reply_to).map((m) => m.reply_to))];
  if (!ids.length) return;
  const q =
    `SELECT p.id, p.from_id, p.kind, p.text, u.name AS from_name
       FROM ${table} p LEFT JOIN users u ON u.id = p.from_id
      WHERE p.id IN (${ids.map(() => "?").join(",")})`;
  const rows = await db.prepare(q).bind(...ids).all();
  const map = {};
  for (const r of rows.results) {
    map[r.id] = { id: r.id, from: r.from_id, fromName: r.from_name || "AniList user", kind: r.kind, text: r.text || "" };
  }
  for (const m of msgs) {
    if (m.reply_to && map[m.reply_to]) m.replyTo = map[m.reply_to];
    delete m.reply_to;
  }
}

async function isMember(db, groupId, userId) {
  const r = await db
    .prepare(`SELECT 1 FROM group_members WHERE group_id = ?1 AND user_id = ?2`)
    .bind(groupId, userId)
    .first();
  return !!r;
}

async function groupMembers(db, groupId) {
  const rows = await db
    .prepare(
      `SELECT u.id, u.name, u.avatar FROM group_members gm
         LEFT JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ?1`,
    )
    .bind(groupId)
    .all();
  return rows.results.map((m) => ({
    id: m.id,
    name: m.name || "AniList user",
    avatar: m.avatar || "",
  }));
}

// All groups `me` belongs to, with members + last message + unread count.
async function groupPayload(db, me) {
  const mine = await db
    .prepare(
      `SELECT g.id, g.name, g.owner_id, gm.last_read
         FROM group_members gm JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = ?1`,
    )
    .bind(me)
    .all();

  const out = [];
  for (const g of mine.results) {
    const members = await groupMembers(db, g.id);
    const last = await db
      .prepare(
        `SELECT gmsg.kind, gmsg.text, gmsg.from_id, gmsg.ts, u.name AS from_name
           FROM group_messages gmsg LEFT JOIN users u ON u.id = gmsg.from_id
          WHERE gmsg.group_id = ?1 ORDER BY gmsg.ts DESC LIMIT 1`,
      )
      .bind(g.id)
      .first();
    const unread = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM group_messages
          WHERE group_id = ?1 AND from_id != ?2 AND ts > ?3`,
      )
      .bind(g.id, me, g.last_read || 0)
      .first();
    out.push({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      members,
      lastTs: (last && last.ts) || g.id, // fall back so brand-new groups sort
      last: last || null,
      unread: (unread && unread.n) || 0,
    });
  }
  out.sort((a, b) => b.lastTs - a.lastTs);
  return out;
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
      const body =
        req.method === "POST" ? await req.json().catch(() => ({})) : null;
      const me = await verifyToken(req, body);
      if (!me)
        return json(
          { ok: false, error: "AniList login required — " + verifyFail },
          401,
        );
      await upsertUser(db, me);

      const mods = modIds(env);
      const mod = mods.has(me.id);

      // banned users can read but not send/friend/report (mods are exempt)
      if (req.method === "POST" && !mod) {
        const BAN_BLOCK = new Set([
          "/message", "/group/message", "/friend/request",
          "/group/create", "/group/add", "/report",
        ]);
        if (BAN_BLOCK.has(path) && (await isBanned(db, me.id)))
          return json({ ok: false, error: "Your account is banned." }, 403);
      }

      /* ── whoami ── */
      if (req.method === "GET" && path === "/me") {
        return json({ ok: true, user: { id: me.id, name: me.name, avatar: me.avatar }, isMod: mod });
      }

      /* ── search cached users by name ── */
      if (req.method === "GET" && path === "/users") {
        const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
        if (q.length < 2) return json({ ok: true, users: [] });
        const rows = await db
          .prepare(
            `SELECT id, name, avatar FROM users
              WHERE id != ?1 AND name LIKE ?2 COLLATE NOCASE
              ORDER BY name LIMIT 20`,
          )
          .bind(me.id, "%" + q + "%")
          .all();
        return json({ ok: true, users: rows.results });
      }

      /* ── friend lists ── */
      if (req.method === "GET" && path === "/friends") {
        return json({ ok: true, ...(await friendPayload(db, me.id)) });
      }

      /* ── inbox thread list ── */
      if (req.method === "GET" && path === "/threads") {
        return json({ ok: true, threads: await threads(db, me.id) });
      }

      /* ── messages with one friend ── */
      if (req.method === "GET" && path === "/messages") {
        const other = Number(url.searchParams.get("with")) || 0;
        if (!other) return json({ ok: false, error: "with required" }, 400);
        const after = Number(url.searchParams.get("after")) || 0;
        const rows = await db
          .prepare(
            `SELECT id, from_id, to_id, kind, text, clip, gif, ts, read, reply_to
               FROM messages
              WHERE ((from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1))
                AND ts > ?3
              ORDER BY ts ASC LIMIT 400`,
          )
          .bind(me.id, other, after)
          .all();
        // mark their messages to me as read on fetch
        await db
          .prepare(
            `UPDATE messages SET read = 1 WHERE from_id = ?1 AND to_id = ?2 AND read = 0`,
          )
          .bind(other, me.id)
          .run();
        const messages = rows.results.map((m) => ({
          id: m.id,
          from: m.from_id,
          to: m.to_id,
          kind: m.kind,
          text: m.text || "",
          clip: m.clip ? JSON.parse(m.clip) : null,
          gif: m.gif || "",
          ts: m.ts,
          mine: m.from_id === me.id,
          reply_to: m.reply_to || null,
        }));
        await attachReplies(db, messages, "messages");
        return json({ ok: true, messages });
      }

      /* ── group list (inbox) ── */
      if (req.method === "GET" && path === "/groups") {
        return json({ ok: true, groups: await groupPayload(db, me.id) });
      }

      /* ── messages in a group ── */
      if (req.method === "GET" && path === "/group/messages") {
        const gid = Number(url.searchParams.get("groupId")) || 0;
        if (!gid) return json({ ok: false, error: "groupId required" }, 400);
        if (!(await isMember(db, gid, me.id)))
          return json({ ok: false, error: "not a member" }, 403);
        const after = Number(url.searchParams.get("after")) || 0;
        const rows = await db
          .prepare(
            `SELECT gmsg.id, gmsg.from_id, gmsg.kind, gmsg.text, gmsg.clip, gmsg.gif, gmsg.ts, gmsg.reply_to,
                    u.name AS from_name, u.avatar AS from_avatar
               FROM group_messages gmsg LEFT JOIN users u ON u.id = gmsg.from_id
              WHERE gmsg.group_id = ?1 AND gmsg.ts > ?2
              ORDER BY gmsg.ts ASC LIMIT 400`,
          )
          .bind(gid, after)
          .all();
        // fetching = read up to now
        await db
          .prepare(`UPDATE group_members SET last_read = ?3 WHERE group_id = ?1 AND user_id = ?2`)
          .bind(gid, me.id, Date.now())
          .run();
        const messages = rows.results.map((m) => ({
          id: m.id,
          from: m.from_id,
          fromName: m.from_name || "AniList user",
          fromAvatar: m.from_avatar || "",
          kind: m.kind,
          text: m.text || "",
          clip: m.clip ? JSON.parse(m.clip) : null,
          gif: m.gif || "",
          ts: m.ts,
          mine: m.from_id === me.id,
          reply_to: m.reply_to || null,
        }));
        await attachReplies(db, messages, "group_messages");
        return json({ ok: true, messages });
      }

      /* ── mod: open reports (secret) ── */
      if (req.method === "GET" && path === "/mod/reports") {
        if (!mod) return json({ ok: false, error: "forbidden" }, 403);
        const rows = await db
          .prepare(`SELECT * FROM reports WHERE status = 'open' ORDER BY ts DESC LIMIT 200`)
          .all();
        const out = [];
        for (const r of rows.results) {
          const tbl = r.is_group ? "group_messages" : "messages";
          const m = await db.prepare(`SELECT * FROM ${tbl} WHERE id = ?1`).bind(r.msg_id).first();
          const reporter = await userById(db, r.reporter_id);
          let msg = null, context = null, banned = false;
          if (m) {
            const author = await userById(db, m.from_id);
            banned = await isBanned(db, m.from_id);
            if (r.is_group) {
              const g = await db.prepare(`SELECT id, name FROM groups WHERE id = ?1`).bind(m.group_id).first();
              context = { group: true, groupId: m.group_id, name: g ? g.name : "group chat" };
            } else {
              context = { group: false, a: m.from_id, b: m.to_id };
            }
            msg = {
              id: m.id, from: m.from_id, fromName: author.name, fromAvatar: author.avatar,
              kind: m.kind, text: m.text || "", clip: m.clip ? JSON.parse(m.clip) : null,
              gif: m.gif || "", ts: m.ts,
            };
          }
          out.push({
            reportId: r.id, reason: r.reason || "", ts: r.ts, isGroup: !!r.is_group,
            reporter: { id: reporter.id, name: reporter.name }, banned, msg, context,
          });
        }
        return json({ ok: true, reports: out });
      }

      /* ── mod: list currently banned users ── */
      if (req.method === "GET" && path === "/mod/banned") {
        if (!mod) return json({ ok: false, error: "forbidden" }, 403);
        const rows = await db
          .prepare(
            `SELECT b.user_id, b.ts, b.reason, u.name, u.avatar
               FROM banned b LEFT JOIN users u ON u.id = b.user_id
              ORDER BY b.ts DESC LIMIT 200`,
          )
          .all();
        return json({
          ok: true,
          banned: rows.results.map((r) => ({
            id: r.user_id, name: r.name || ("User " + r.user_id),
            avatar: r.avatar || "", ts: r.ts, reason: r.reason || "",
          })),
        });
      }

      /* ── mod: read a 1:1 conversation without marking it read ── */
      if (req.method === "GET" && path === "/mod/thread") {
        if (!mod) return json({ ok: false, error: "forbidden" }, 403);
        const a = Number(url.searchParams.get("a")) || 0;
        const b = Number(url.searchParams.get("b")) || 0;
        if (!a || !b) return json({ ok: false, error: "a + b required" }, 400);
        const rows = await db
          .prepare(
            `SELECT m.id, m.from_id, m.to_id, m.kind, m.text, m.clip, m.gif, m.ts, m.reply_to,
                    u.name AS from_name, u.avatar AS from_avatar
               FROM messages m LEFT JOIN users u ON u.id = m.from_id
              WHERE (m.from_id = ?1 AND m.to_id = ?2) OR (m.from_id = ?2 AND m.to_id = ?1)
              ORDER BY m.ts ASC LIMIT 500`,
          )
          .bind(a, b)
          .all();
        const ua = await userById(db, a), ub = await userById(db, b);
        const messages = rows.results.map((m) => ({
          id: m.id, from: m.from_id, fromName: m.from_name || "AniList user",
          fromAvatar: m.from_avatar || "", kind: m.kind, text: m.text || "",
          clip: m.clip ? JSON.parse(m.clip) : null, gif: m.gif || "", ts: m.ts,
          mine: false, reply_to: m.reply_to || null,
        }));
        await attachReplies(db, messages, "messages");
        return json({
          ok: true, group: false, messages,
          parties: [
            { id: ua.id, name: ua.name, avatar: ua.avatar, banned: await isBanned(db, ua.id) },
            { id: ub.id, name: ub.name, avatar: ub.avatar, banned: await isBanned(db, ub.id) },
          ],
        });
      }

      /* ── mod: read a group conversation without touching last_read ── */
      if (req.method === "GET" && path === "/mod/group") {
        if (!mod) return json({ ok: false, error: "forbidden" }, 403);
        const gid = Number(url.searchParams.get("groupId")) || 0;
        if (!gid) return json({ ok: false, error: "groupId required" }, 400);
        const rows = await db
          .prepare(
            `SELECT gmsg.id, gmsg.from_id, gmsg.kind, gmsg.text, gmsg.clip, gmsg.gif, gmsg.ts, gmsg.reply_to,
                    u.name AS from_name, u.avatar AS from_avatar
               FROM group_messages gmsg LEFT JOIN users u ON u.id = gmsg.from_id
              WHERE gmsg.group_id = ?1 ORDER BY gmsg.ts ASC LIMIT 500`,
          )
          .bind(gid)
          .all();
        const g = await db.prepare(`SELECT id, name FROM groups WHERE id = ?1`).bind(gid).first();
        const messages = rows.results.map((m) => ({
          id: m.id, from: m.from_id, fromName: m.from_name || "AniList user",
          fromAvatar: m.from_avatar || "", kind: m.kind, text: m.text || "",
          clip: m.clip ? JSON.parse(m.clip) : null, gif: m.gif || "", ts: m.ts,
          mine: false, reply_to: m.reply_to || null,
        }));
        await attachReplies(db, messages, "group_messages");
        return json({ ok: true, group: true, groupName: g ? g.name : "group chat", messages, members: await groupMembers(db, gid) });
      }

      if (req.method !== "POST")
        return json({ ok: false, error: "not found" }, 404);

      /* ── send a friend request ── */
      if (path === "/friend/request") {
        const toId = Number(body.toId) || 0;
        if (!toId || toId === me.id)
          return json({ ok: false, error: "bad target" }, 400);
        // cache the target so lists can show name/avatar before they log in
        if (body.toName)
          await upsertUser(db, {
            id: toId,
            name: clean(body.toName, 60),
            avatar: clean(body.toAvatar, 300),
          });

        // already friends?
        if (await areFriends(db, me.id, toId))
          return json({ ok: true, already: "friends" });

        // they already asked me → accept instead of a duplicate request
        const reverse = await db
          .prepare(
            `SELECT status FROM friends WHERE req_id = ?1 AND rec_id = ?2`,
          )
          .bind(toId, me.id)
          .first();
        if (reverse) {
          await db
            .prepare(
              `UPDATE friends SET status = 'accepted', ts = ?3
                 WHERE req_id = ?1 AND rec_id = ?2`,
            )
            .bind(toId, me.id, Date.now())
            .run();
          return json({ ok: true, accepted: true });
        }

        await db
          .prepare(
            `INSERT INTO friends (req_id, rec_id, status, ts)
             VALUES (?1, ?2, 'pending', ?3)
             ON CONFLICT (req_id, rec_id) DO NOTHING`,
          )
          .bind(me.id, toId, Date.now())
          .run();
        return json({ ok: true });
      }

      /* ── accept / decline an incoming request ── */
      if (path === "/friend/respond") {
        const fromId = Number(body.fromId) || 0;
        if (!fromId) return json({ ok: false, error: "fromId required" }, 400);
        const row = await db
          .prepare(
            `SELECT status FROM friends WHERE req_id = ?1 AND rec_id = ?2`,
          )
          .bind(fromId, me.id)
          .first();
        if (!row) return json({ ok: false, error: "no such request" }, 404);
        if (body.accept) {
          await db
            .prepare(
              `UPDATE friends SET status = 'accepted', ts = ?3
                 WHERE req_id = ?1 AND rec_id = ?2`,
            )
            .bind(fromId, me.id, Date.now())
            .run();
        } else {
          await db
            .prepare(`DELETE FROM friends WHERE req_id = ?1 AND rec_id = ?2`)
            .bind(fromId, me.id)
            .run();
        }
        return json({ ok: true });
      }

      /* ── remove a friend / cancel a request (either direction) ── */
      if (path === "/friend/remove") {
        const other = Number(body.otherId) || 0;
        if (!other) return json({ ok: false, error: "otherId required" }, 400);
        await db
          .prepare(
            `DELETE FROM friends
              WHERE (req_id = ?1 AND rec_id = ?2) OR (req_id = ?2 AND rec_id = ?1)`,
          )
          .bind(me.id, other)
          .run();
        return json({ ok: true });
      }

      /* ── mark a thread read ── */
      if (path === "/read") {
        const other = Number(body.withId) || 0;
        if (!other) return json({ ok: false, error: "withId required" }, 400);
        await db
          .prepare(
            `UPDATE messages SET read = 1 WHERE from_id = ?1 AND to_id = ?2 AND read = 0`,
          )
          .bind(other, me.id)
          .run();
        return json({ ok: true });
      }

      /* ── send a message ── */
      if (path === "/message") {
        const toId = Number(body.toId) || 0;
        if (!toId) return json({ ok: false, error: "toId required" }, 400);
        if (!(await areFriends(db, me.id, toId)))
          return json({ ok: false, error: "not friends" }, 403);

        const m = parseMsg(body);
        if (m.error) return json({ ok: false, error: m.error }, 400);

        const recent = await db
          .prepare(
            `SELECT COUNT(*) AS n FROM messages WHERE from_id = ?1 AND ts > ?2`,
          )
          .bind(me.id, Date.now() - RATE_WIN)
          .first();
        if (recent.n >= RATE_N)
          return json({ ok: false, error: "slow down — too many messages" }, 429);

        const replyTo = Number(body.replyTo) || null;
        const ts = Date.now();
        const res = await db
          .prepare(
            `INSERT INTO messages (from_id, to_id, kind, text, clip, gif, ts, read, reply_to)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)`,
          )
          .bind(me.id, toId, m.kind, m.text, m.clip, m.gif, ts, replyTo)
          .run();
        return json({
          ok: true,
          message: {
            id: res.meta && res.meta.last_row_id,
            from: me.id,
            to: toId,
            kind: m.kind,
            text: m.text || "",
            clip: m.clip ? JSON.parse(m.clip) : null,
            gif: m.gif || "",
            ts,
            mine: true,
          },
        });
      }

      /* ── delete a 1:1 message (author only) ── */
      if (path === "/message/delete") {
        const id = Number(body.id) || 0;
        if (!id) return json({ ok: false, error: "id required" }, 400);
        const m = await db.prepare(`SELECT from_id FROM messages WHERE id = ?1`).bind(id).first();
        if (!m) return json({ ok: true }); // already gone
        if (m.from_id !== me.id) return json({ ok: false, error: "not yours" }, 403);
        await db.prepare(`DELETE FROM messages WHERE id = ?1`).bind(id).run();
        return json({ ok: true });
      }

      /* ── create a group chat ── */
      if (path === "/group/create") {
        const name = clean(body.name, 80).trim() || "Group chat";
        let ids = Array.isArray(body.memberIds) ? body.memberIds.map(Number).filter(Boolean) : [];
        ids = [...new Set(ids)].filter((id) => id !== me.id);
        // every invited member must be a friend of the creator
        for (const id of ids) {
          if (!(await areFriends(db, me.id, id)))
            return json({ ok: false, error: "can only add friends to a group" }, 403);
        }
        if (!ids.length) return json({ ok: false, error: "add at least one friend" }, 400);

        const now = Date.now();
        const g = await db
          .prepare(`INSERT INTO groups (name, owner_id, ts) VALUES (?1, ?2, ?3)`)
          .bind(name, me.id, now)
          .run();
        const gid = g.meta.last_row_id;
        const members = [me.id, ...ids];
        for (const uid of members) {
          await db
            .prepare(
              `INSERT INTO group_members (group_id, user_id, last_read, joined)
               VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING`,
            )
            .bind(gid, uid, uid === me.id ? now : 0, now)
            .run();
        }
        return json({ ok: true, group: { id: gid, name, ownerId: me.id, members: await groupMembers(db, gid) } });
      }

      /* ── send a message to a group ── */
      if (path === "/group/message") {
        const gid = Number(body.groupId) || 0;
        if (!gid) return json({ ok: false, error: "groupId required" }, 400);
        if (!(await isMember(db, gid, me.id)))
          return json({ ok: false, error: "not a member" }, 403);

        const m = parseMsg(body);
        if (m.error) return json({ ok: false, error: m.error }, 400);

        const recent = await db
          .prepare(`SELECT COUNT(*) AS n FROM group_messages WHERE from_id = ?1 AND ts > ?2`)
          .bind(me.id, Date.now() - RATE_WIN)
          .first();
        if (recent.n >= RATE_N)
          return json({ ok: false, error: "slow down — too many messages" }, 429);

        const replyTo = Number(body.replyTo) || null;
        const ts = Date.now();
        const res = await db
          .prepare(
            `INSERT INTO group_messages (group_id, from_id, kind, text, clip, gif, ts, reply_to)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          )
          .bind(gid, me.id, m.kind, m.text, m.clip, m.gif, ts, replyTo)
          .run();
        await db
          .prepare(`UPDATE group_members SET last_read = ?3 WHERE group_id = ?1 AND user_id = ?2`)
          .bind(gid, me.id, ts)
          .run();
        return json({
          ok: true,
          message: {
            id: res.meta && res.meta.last_row_id,
            from: me.id, fromName: me.name, fromAvatar: me.avatar,
            kind: m.kind, text: m.text || "",
            clip: m.clip ? JSON.parse(m.clip) : null, gif: m.gif || "",
            ts, mine: true,
          },
        });
      }

      /* ── delete a group message (author, or the group owner) ── */
      if (path === "/group/message/delete") {
        const id = Number(body.id) || 0;
        if (!id) return json({ ok: false, error: "id required" }, 400);
        const m = await db
          .prepare(`SELECT group_id, from_id FROM group_messages WHERE id = ?1`)
          .bind(id)
          .first();
        if (!m) return json({ ok: true });
        if (!(await isMember(db, m.group_id, me.id)))
          return json({ ok: false, error: "not a member" }, 403);
        const g = await db.prepare(`SELECT owner_id FROM groups WHERE id = ?1`).bind(m.group_id).first();
        const isOwner = g && g.owner_id === me.id;
        if (m.from_id !== me.id && !isOwner)
          return json({ ok: false, error: "not allowed" }, 403);
        await db.prepare(`DELETE FROM group_messages WHERE id = ?1`).bind(id).run();
        return json({ ok: true });
      }

      /* ── mark a group read ── */
      if (path === "/group/read") {
        const gid = Number(body.groupId) || 0;
        if (!gid) return json({ ok: false, error: "groupId required" }, 400);
        await db
          .prepare(`UPDATE group_members SET last_read = ?3 WHERE group_id = ?1 AND user_id = ?2`)
          .bind(gid, me.id, Date.now())
          .run();
        return json({ ok: true });
      }

      /* ── add a friend to a group (any member can) ── */
      if (path === "/group/add") {
        const gid = Number(body.groupId) || 0;
        const uid = Number(body.userId) || 0;
        if (!gid || !uid) return json({ ok: false, error: "groupId + userId required" }, 400);
        if (!(await isMember(db, gid, me.id)))
          return json({ ok: false, error: "not a member" }, 403);
        if (!(await areFriends(db, me.id, uid)))
          return json({ ok: false, error: "can only add your friends" }, 403);
        if (body.name)
          await upsertUser(db, { id: uid, name: clean(body.name, 60), avatar: clean(body.avatar, 300) });
        await db
          .prepare(
            `INSERT INTO group_members (group_id, user_id, last_read, joined)
             VALUES (?1, ?2, 0, ?3) ON CONFLICT DO NOTHING`,
          )
          .bind(gid, uid, Date.now())
          .run();
        return json({ ok: true, members: await groupMembers(db, gid) });
      }

      /* ── rename a group (owner only) ── */
      if (path === "/group/rename") {
        const gid = Number(body.groupId) || 0;
        const name = clean(body.name, 80).trim();
        if (!gid || !name) return json({ ok: false, error: "groupId + name required" }, 400);
        const g = await db.prepare(`SELECT owner_id FROM groups WHERE id = ?1`).bind(gid).first();
        if (!g) return json({ ok: false, error: "no such group" }, 404);
        if (g.owner_id !== me.id) return json({ ok: false, error: "owner only" }, 403);
        await db.prepare(`UPDATE groups SET name = ?2 WHERE id = ?1`).bind(gid, name).run();
        return json({ ok: true });
      }

      /* ── leave a group; last one out (or owner leaving empty) deletes it ── */
      if (path === "/group/leave") {
        const gid = Number(body.groupId) || 0;
        if (!gid) return json({ ok: false, error: "groupId required" }, 400);
        await db
          .prepare(`DELETE FROM group_members WHERE group_id = ?1 AND user_id = ?2`)
          .bind(gid, me.id)
          .run();
        const rest = await groupMembers(db, gid);
        if (!rest.length) {
          await db.prepare(`DELETE FROM group_messages WHERE group_id = ?1`).bind(gid).run();
          await db.prepare(`DELETE FROM groups WHERE id = ?1`).bind(gid).run();
        } else {
          // if the owner left, hand ownership to the earliest remaining member
          const g = await db.prepare(`SELECT owner_id FROM groups WHERE id = ?1`).bind(gid).first();
          if (g && g.owner_id === me.id) {
            await db.prepare(`UPDATE groups SET owner_id = ?2 WHERE id = ?1`).bind(gid, rest[0].id).run();
          }
        }
        return json({ ok: true });
      }

      /* ── report a message (any user) ── */
      if (path === "/report") {
        const id = Number(body.id) || 0;
        const isGroup = body.group ? 1 : 0;
        if (!id) return json({ ok: false, error: "id required" }, 400);
        const tbl = isGroup ? "group_messages" : "messages";
        const m = await db.prepare(`SELECT id FROM ${tbl} WHERE id = ?1`).bind(id).first();
        if (!m) return json({ ok: false, error: "message no longer exists" }, 404);
        const dup = await db
          .prepare(`SELECT 1 FROM reports WHERE msg_id = ?1 AND is_group = ?2 AND reporter_id = ?3 AND status = 'open'`)
          .bind(id, isGroup, me.id)
          .first();
        if (dup) return json({ ok: true, already: true });
        await db
          .prepare(`INSERT INTO reports (msg_id, is_group, reporter_id, reason, ts, status) VALUES (?1, ?2, ?3, ?4, ?5, 'open')`)
          .bind(id, isGroup, me.id, clean(body.reason, 300), Date.now())
          .run();
        return json({ ok: true });
      }

      /* ── mod: delete any message (secret) ── */
      if (path === "/mod/delete") {
        if (!mod) return json({ ok: false, error: "forbidden" }, 403);
        const id = Number(body.id) || 0;
        const isGroup = body.group ? 1 : 0;
        if (!id) return json({ ok: false, error: "id required" }, 400);
        const tbl = isGroup ? "group_messages" : "messages";
        await db.prepare(`DELETE FROM ${tbl} WHERE id = ?1`).bind(id).run();
        await db.prepare(`UPDATE reports SET status = 'resolved' WHERE msg_id = ?1 AND is_group = ?2`).bind(id, isGroup).run();
        return json({ ok: true });
      }

      /* ── mod: ban / unban a user ── */
      if (path === "/mod/ban") {
        if (!mod) return json({ ok: false, error: "forbidden" }, 403);
        const uid = Number(body.userId) || 0;
        if (!uid) return json({ ok: false, error: "userId required" }, 400);
        if (mods.has(uid)) return json({ ok: false, error: "can't ban a mod" }, 400);
        if (body.ban) {
          await db
            .prepare(`INSERT INTO banned (user_id, by_id, ts, reason) VALUES (?1, ?2, ?3, ?4)
                      ON CONFLICT(user_id) DO UPDATE SET by_id = ?2, ts = ?3, reason = ?4`)
            .bind(uid, me.id, Date.now(), clean(body.reason, 200))
            .run();
        } else {
          await db.prepare(`DELETE FROM banned WHERE user_id = ?1`).bind(uid).run();
        }
        return json({ ok: true, banned: !!body.ban });
      }

      /* ── mod: dismiss a report ── */
      if (path === "/mod/report/resolve") {
        if (!mod) return json({ ok: false, error: "forbidden" }, 403);
        const rid = Number(body.reportId) || 0;
        if (!rid) return json({ ok: false, error: "reportId required" }, 400);
        await db.prepare(`UPDATE reports SET status = 'resolved' WHERE id = ?1`).bind(rid).run();
        return json({ ok: true });
      }

      return json({ ok: false, error: "not found" }, 404);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500);
    }
  },
};
