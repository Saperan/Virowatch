/**
 * vd-selftest.mjs — smoke test for megaplay-worker.js's /vd movie+TV resolver.
 *
 *   node vd-selftest.mjs
 *
 * Hits the real Vidnest backends (no mocks — the whole point is catching the
 * day one of them changes CDN or starts serving links that 404, which is how
 * the movie/TV library quietly emptied out before). Exits non-zero on failure.
 */
import assert from "node:assert";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Worker is a plain .js module file; give node an .mjs to import.
const tmp = join(tmpdir(), `vw-worker-${process.pid}.mjs`);
writeFileSync(tmp, readFileSync(new URL("./megaplay-worker.js", import.meta.url)));
const worker = (await import("file://" + tmp)).default;
rmSync(tmp, { force: true });

const call = async (qs) =>
  (await worker.fetch(new Request(`https://vw.test/vd?${qs}`))).json();

const CASES = [
  ["a movie", "type=movie&id=550"],                 // Fight Club
  ["a TV episode", "type=tv&id=1396&s=1&e=1"],      // Breaking Bad S1E1
  ["a title only the fallbacks carry", "type=tv&id=94605&s=1&e=1"], // Arcane
];

let failed = 0;
for (const [label, qs] of CASES) {
  const r = await call(qs);
  try {
    assert.ok(r.ok, `${label}: no playable source`);
    assert.match(r.file, /\/hls\?u=/, `${label}: file is not proxied`);
    // The resolver promises a *verified* stream, so the link must really serve.
    const played = await worker.fetch(new Request(r.file));
    assert.ok(played.ok, `${label}: proxied stream returned ${played.status}`);
    console.log(`ok   ${label} — ${r.source}, ${r.tracks.length} subtitle track(s)`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${e.message}`);
  }
}

// A source that doesn't carry the title must say so, not hand back a dead link.
const forced = await call("type=movie&id=550&src=catflix");
if (forced.ok) {
  const r = await worker.fetch(new Request(forced.file));
  if (!r.ok) { failed++; console.error("FAIL forced source returned an unplayable link"); }
  else console.log("ok   forced source (catflix) verified");
} else {
  console.log("ok   forced source rejected cleanly:", forced.error);
}

process.exit(failed ? 1 : 0);
