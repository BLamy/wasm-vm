// E3-T22c — deterministic test of the osc52-copy guest helper (no boot). Execs it under /bin/sh with
// fixed stdin and asserts the exact OSC 52 byte sequence a browser terminal (E3-T22a) will decode.
// Run: node --test tools/rootfs/osc52-copy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HELPER = join(dirname(fileURLToPath(import.meta.url)), "osc52-copy");
// Return raw output BYTES (Buffer) for a Buffer/string stdin — no lossy text re-encoding.
const run = (input) =>
  execFileSync("/bin/sh", [HELPER], { input: Buffer.from(input) }); // no `encoding` → Buffer out

const PREFIX = Buffer.from("\x1b]52;c;");
const BEL = 0x07;

function payloadB64(outBuf) {
  assert.ok(outBuf.subarray(0, PREFIX.length).equals(PREFIX), "OSC 52 copy prefix");
  assert.equal(outBuf[outBuf.length - 1], BEL, "BEL terminator");
  return outBuf.subarray(PREFIX.length, outBuf.length - 1).toString("ascii");
}

test("emits ESC]52;c;<base64>BEL for the piped stdin", () => {
  // base64("hi") === "aGk="; the sequence is ESC ] 5 2 ; c ; a G k = BEL.
  assert.ok(run("hi").equals(Buffer.from("\x1b]52;c;aGk=\x07", "latin1")));
});

test("round-trips arbitrary UTF-8 bytes through base64 (decode recovers the input)", () => {
  const payload = "the quick brown fox\njumped — 世界";
  const b64 = payloadB64(run(payload));
  assert.equal(Buffer.from(b64, "base64").toString("utf-8"), payload);
});

test("the base64 payload has NO embedded newlines (single-line OSC, tr -d strips them)", () => {
  // A large input makes `base64` wrap at 76 cols by default; the helper must strip those newlines so
  // the OSC sequence is one line (an embedded newline would terminate the sequence early).
  const big = "x".repeat(4096);
  const b64 = payloadB64(run(big));
  assert.ok(!b64.includes("\n"), "no newline in the base64 payload");
  assert.equal(Buffer.from(b64, "base64").toString("utf-8"), big);
});

test("empty stdin yields an empty-payload OSC 52 (a clipboard clear)", () => {
  assert.ok(run("").equals(Buffer.from("\x1b]52;c;\x07", "latin1")));
});
