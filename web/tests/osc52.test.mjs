// E3-T22a — deterministic node unit tests for the OSC 52 copy handler (no browser, no clipboard API).
// Run: node --test web/tests/osc52.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_ENCODED_BYTES,
  createOsc52Handler,
  parseOsc52,
} from "../osc52.js";

const b64 = (s) => Buffer.from(s, "utf-8").toString("base64");

test("parseOsc52 decodes a c;<base64> copy to its text", () => {
  const p = parseOsc52(`c;${b64("hi")}`);
  assert.equal(p.kind, "copy");
  assert.equal(p.selection, "c");
  assert.equal(p.text, "hi");
});

test("parseOsc52 round-trips UTF-8 (multibyte) payloads", () => {
  const s = "héllo — 世界 🌍";
  const p = parseOsc52(`c;${b64(s)}`);
  assert.equal(p.kind, "copy");
  assert.equal(p.text, s);
});

test("parseOsc52 classifies the ? query form", () => {
  const p = parseOsc52("c;?");
  assert.equal(p.kind, "query");
  assert.equal(p.selection, "c");
});

test("parseOsc52 rejects malformed base64 without throwing", () => {
  const p = parseOsc52("c;not*base*64!");
  assert.equal(p.kind, "invalid");
  assert.equal(p.reason, "bad-base64");
});

test("parseOsc52 enforces the size cap BEFORE decoding", () => {
  const huge = "A".repeat(DEFAULT_MAX_ENCODED_BYTES + 1);
  const p = parseOsc52(`c;${huge}`);
  assert.equal(p.kind, "invalid");
  assert.equal(p.reason, "too-large");
});

test("parseOsc52 a 10 MB payload hits the cap promptly (no giant decode)", () => {
  const p = parseOsc52(`c;${"A".repeat(10 * 1024 * 1024)}`);
  assert.equal(p.kind, "invalid");
  assert.equal(p.reason, "too-large");
});

test("parseOsc52 rejects a selection field with embedded separators", () => {
  assert.equal(parseOsc52("c d;?").kind, "invalid");
  assert.equal(parseOsc52(";?").kind, "query"); // empty selection = spec default, still valid
});

test("parseOsc52 with no separator is invalid", () => {
  assert.equal(parseOsc52("garbage").kind, "invalid");
  assert.equal(parseOsc52(123).kind, "invalid");
});

test("handler writes the clipboard once on a valid copy", async () => {
  const writes = [];
  const copied = [];
  const handle = createOsc52Handler({
    writeClipboard: (t) => (writes.push(t), Promise.resolve()),
    onCopied: (t) => copied.push(t),
  });
  assert.equal(handle(`c;${b64("clip me")}`), true);
  await tick();
  assert.deepEqual(writes, ["clip me"]);
  assert.deepEqual(copied, ["clip me"]);
});

test("handler routes a rejected write to onCopyBlocked (never a silent drop)", async () => {
  const blocked = [];
  const handle = createOsc52Handler({
    writeClipboard: () => Promise.reject(new Error("NotAllowedError")),
    onCopyBlocked: (t) => blocked.push(t),
  });
  handle(`c;${b64("denied text")}`);
  await tick();
  assert.deepEqual(blocked, ["denied text"], "blocked payload is preserved for the confirm affordance");
});

test("handler does NOT read the clipboard for a query while allowRead is off", async () => {
  let reads = 0;
  let responded = null;
  const handle = createOsc52Handler({
    writeClipboard: () => Promise.resolve(),
    readClipboard: () => (reads++, Promise.resolve("secret")),
    respond: (s) => (responded = s),
    allowRead: false,
  });
  assert.equal(handle("c;?"), true);
  await tick();
  assert.equal(reads, 0, "read must not happen while the toggle is off");
  assert.equal(responded, null, "no answer written back to the guest");
});

test("handler answers a query only when allowRead is on", async () => {
  let responded = null;
  const handle = createOsc52Handler({
    writeClipboard: () => Promise.resolve(),
    readClipboard: () => Promise.resolve("host clip"),
    respond: (s) => (responded = s),
    allowRead: true,
  });
  handle("c;?");
  await tick();
  assert.equal(responded, `c;${b64("host clip")}`, "the read answer is base64 of the host clipboard");
});

test("handler honors a LIVE allowRead thunk (toggle flipped after construction)", async () => {
  let allow = false;
  let reads = 0;
  const handle = createOsc52Handler({
    writeClipboard: () => Promise.resolve(),
    readClipboard: () => (reads++, Promise.resolve("x")),
    respond: () => {},
    allowRead: () => allow, // evaluated per invocation
  });
  handle("c;?");
  await tick();
  assert.equal(reads, 0, "off before the toggle");
  allow = true;
  handle("c;?");
  await tick();
  assert.equal(reads, 1, "on after the live toggle flips");
});

test("handler consumes invalid payloads (returns true, no clipboard call)", async () => {
  let writes = 0;
  const handle = createOsc52Handler({ writeClipboard: () => (writes++, Promise.resolve()) });
  assert.equal(handle("c;***"), true);
  await tick();
  assert.equal(writes, 0);
});

test("createOsc52Handler requires a writeClipboard function", () => {
  assert.throws(() => createOsc52Handler({}), TypeError);
});

// Let queued microtasks (the handler's background clipboard work) settle.
function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
