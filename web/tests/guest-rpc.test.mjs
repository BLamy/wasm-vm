// E3.5-T05e — deterministic node unit tests for the fenced guest⇄UI RPC parser (no browser).
// Run: node --test web/tests/guest-rpc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createFencedRpc,
  endMarkerRegex,
  formatRpcCommand,
  stripConsole,
} from "../guest-rpc.js";

test("formatRpcCommand fences the command with a unique END printf + CR", () => {
  assert.equal(
    formatRpcCommand("wvrun ps", "abc1"),
    "wvrun ps; printf '\\n__WVEND_abc1_%s\\n' \"$?\"\r",
  );
});

test("stripConsole removes ANSI escapes and CR", () => {
  assert.equal(stripConsole("a\x1b[0mb\x1b[1;32mc\r\n"), "abc\n");
});

test("basic RPC: echo + stdout + marker → {stdout, exit}", () => {
  const rid = "r1";
  const p = createFencedRpc(rid);
  // The guest echoes the command line first, then stdout, then the END marker with $?.
  assert.equal(p.feed(`echo hi; printf ...\nhi\n`), null);
  const r = p.feed(`__WVEND_${rid}_0\n`);
  assert.deepEqual(r, { stdout: "hi\n", exit: 0 });
  assert.equal(p.settled, true);
});

test("non-zero exit is surfaced, not swallowed", () => {
  const rid = "r2";
  const p = createFencedRpc(rid);
  const r = p.feed(`false; printf...\n__WVEND_${rid}_1\n`);
  assert.equal(r.exit, 1);
});

test("marker split across feeds still matches (byte-stream robust)", () => {
  const rid = "r3";
  const p = createFencedRpc(rid);
  assert.equal(p.feed(`cmd\nout\n__WVEND_${rid}`), null); // marker start, no digit yet
  const r = p.feed(`_7\n`);
  assert.deepEqual(r, { stdout: "out\n", exit: 7 });
});

test("marker-spoof: a DIFFERENT rid's marker printed as output does not settle this RPC", () => {
  const rid = "mine";
  const p = createFencedRpc(rid);
  // The command prints a fake marker for another id — must be ignored.
  assert.equal(p.feed(`cmd\n__WVEND_other_0\nstill running\n`), null);
  assert.equal(p.settled, false);
  const r = p.feed(`__WVEND_${rid}_0\n`);
  assert.equal(r.exit, 0);
  assert.equal(r.stdout, "__WVEND_other_0\nstill running\n");
});

test("the echoed printf format (%s, no digit) can never satisfy the marker", () => {
  const rid = "r4";
  const re = endMarkerRegex(rid);
  assert.equal(re.test(`__WVEND_${rid}_%s`), false, "%s is not a digit run");
  assert.equal(re.test(`__WVEND_${rid}_`), false, "no digit at all");
  assert.equal(re.test(`__WVEND_${rid}_12`), true);
});

test("a large burst before the marker does not lose the END (not line-count bounded)", () => {
  const rid = "r5";
  const p = createFencedRpc(rid);
  // 100k lines of output fed in chunks, then the marker.
  p.feed("echo-line\n"); // the echoed command line (stripped from stdout)
  let res = null;
  for (let i = 0; i < 1000; i++) res = p.feed("x".repeat(100) + "\n"); // 1000 × 101 bytes of output
  assert.equal(res, null, "no premature settle across a large burst");
  const r = p.feed(`__WVEND_${rid}_0\n`);
  assert.equal(r.exit, 0);
  assert.equal(r.stdout.length, 1000 * 101, "every output byte preserved, echo line stripped");
});

test("rid with regex-special characters is escaped (no accidental wildcard match)", () => {
  const rid = "a.b+c"; // dots/plus would be wildcards if unescaped
  const p = createFencedRpc(rid);
  assert.equal(p.feed(`cmd\n__WVEND_aXbYc_0\n`), null, "unescaped wildcards must NOT match");
  const r = p.feed(`__WVEND_a.b+c_3\n`);
  assert.equal(r.exit, 3);
});

test("ANSI-wrapped marker still parses (strip happens before match)", () => {
  const rid = "r6";
  const p = createFencedRpc(rid);
  const r = p.feed(`cmd\r\nout\r\n\x1b[0m__WVEND_${rid}_0\x1b[0m\r\n`);
  assert.deepEqual(r, { stdout: "out\n", exit: 0 });
});
