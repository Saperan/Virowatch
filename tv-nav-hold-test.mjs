/**
 * Hold-reset check for tv-nav.js — verifies the stuck-remote logic:
 * holding any key ~4s (no keyup) resets to home, releasing early does not,
 * and a post-reset hold can't re-fire until the stuck key is released.
 *
 *   node tv-nav-hold-test.mjs
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

let clock = 0;
const rafQueue = [];
const listeners = {};

const cls = () => ({
  _s: new Set(),
  add(c) { this._s.add(c); },
  remove(c) { this._s.delete(c); },
  toggle(c, on) {
    if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
    else on ? this._s.add(c) : this._s.delete(c);
    return this._s.has(c);
  },
  contains(c) { return this._s.has(c); },
});

const body = {
  classList: cls(),
  appendChild() {},
};

let homeClicks = 0;
const el = () => ({
  classList: cls(),
  dataset: {},
  style: {},
  tagName: "BUTTON",
  setAttribute() {},
  appendChild() {},
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  click() { if (this.id === "railHomeBtn") homeClicks++; },
  getBoundingClientRect() { return { width: 10, height: 10, left: 0, top: 0 }; },
});

globalThis.window = globalThis;
globalThis.addEventListener = (type, cb) => (listeners[type] = listeners[type] || []).push(cb);
globalThis.removeEventListener = (type, cb) => {
  if (listeners[type]) listeners[type] = listeners[type].filter((l) => l !== cb);
};
globalThis.dispatchEvent = (e) => (listeners[e.type] || []).forEach((cb) => cb(e));
globalThis.document = {
  body,
  activeElement: body,
  addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
  removeEventListener(type, cb) {
    if (listeners[type]) listeners[type] = listeners[type].filter((l) => l !== cb);
  },
  dispatchEvent(e) { (listeners[e.type] || []).forEach((cb) => cb(e)); },
  createElement: () => el(),
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById(id) { const e = el(); e.id = id; return e; },
};
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Windows NT 10.0)" },
  configurable: true,
});
// Stored preference "1" = TV/Console already chosen — skips the first-run
// popup (askTv), so the hold logic runs as pure TV-mode behavior.
globalThis.localStorage = { getItem: () => "1", setItem() {}, removeItem() {} };
globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = (cb) => rafQueue.push(cb);
globalThis.MutationObserver = class { observe() {} };
globalThis.MouseEvent = class { constructor(type, o) { this.type = type; Object.assign(this, o); } };
globalThis.KeyboardEvent = class {
  constructor(type, o) { this.type = type; Object.assign(this, o); this.isTrusted = false; }
};
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; Object.assign(this, o); } };

eval(readFileSync(new URL("./tv-nav.js", import.meta.url), "utf8"));

const pump = () => rafQueue.splice(0).forEach((cb) => cb());
const key = (type, k) =>
  (listeners[type] || []).forEach((cb) =>
    cb({ key: k, isTrusted: true, preventDefault() {}, stopImmediatePropagation() {} }));

// 1. first arrow keypress enables TV mode; then hold a random key
key("keydown", "ArrowUp");
key("keydown", "g");
clock = 4600;
pump();
assert.equal(homeClicks, 1, "hold 4.6s should reset to home");

// 2. keep holding (key repeats) — must NOT re-fire while still held
pump();
assert.equal(homeClicks, 1, "no re-fire while the key is still held");

// 3. release, hold again briefly — must NOT reset
key("keyup", "g");
key("keydown", "g");
clock = 6600; // held 2000ms
pump();
assert.equal(homeClicks, 1, "short hold (2s) must not reset");

// 4. keep holding past 4s — resets again
clock = 8700; // held 4100ms
pump();
assert.equal(homeClicks, 2, "second full hold should reset again");

// 5. keyup outside TV-mode check: another full hold still works
key("keyup", "g");
key("keydown", "h");
clock = 12800;
pump();
assert.equal(homeClicks, 3, "a different key hold resets too");

// 6. gamepad button held ~4s resets too (Android TV remotes are gamepads)
let padButtons = Array.from({ length: 17 }, () => ({ pressed: false }));
Object.defineProperty(globalThis.navigator, "getGamepads", {
  value: () => [{ connected: true, id: "test", buttons: padButtons, axes: [] }],
  configurable: true,
});
key("keyup", "h");
padButtons[0].pressed = true; // hold A
clock = 17000;
pump(); // poll registers the press
clock = 21100; // held 4100ms
pump();
assert.equal(homeClicks, 4, "gamepad button held 4s resets too");

// 7. still held → no re-fire; release → re-arms
pump();
assert.equal(homeClicks, 4, "no re-fire while the gamepad button is still held");
padButtons[0].pressed = false;
clock = 21500;
pump(); // release seen
assert.equal(homeClicks, 4, "no reset after release");
padButtons[0].pressed = true;
clock = 22000;
pump(); // new press registered
clock = 26200; // held 4200ms
pump();
assert.equal(homeClicks, 5, "a fresh gamepad hold resets again");
padButtons[0].pressed = false;

console.log("ok — hold-reset wiring verified");
process.exit(0);
