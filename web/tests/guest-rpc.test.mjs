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

test("formatRpcCommand fences the command with nonce BEGIN/END printf lines + CR", () => {
  assert.equal(
    formatRpcCommand("wvrun ps", "abc1"),
    "printf '\\n__WVBEGIN_abc1\\n'; wvrun ps; printf '\\n__WVEND_abc1_%s\\n' \"$?\"\r",
  );
});

test("BEGIN remains full-line anchored when echo is disabled and the prompt has no trailing newline", () => {
  const rid = "noecho";
  const command = formatRpcCommand("echo JSON", rid);
  assert.match(command, /^printf '\\n__WVBEGIN_noecho\\n'/);
  assert.equal(
    createFencedRpc(rid).feed(`delayed-prompt__WVBEGIN_${rid}\nJSON\n\n__WVEND_${rid}_0\n`),
    null,
    "a marker-looking suffix without its explicit leading newline must not be synthesized",
  );

  const result = createFencedRpc(rid).feed(`delayed-prompt\n__WVBEGIN_${rid}\nJSON\n\n__WVEND_${rid}_0\n`);
  assert.deepEqual(result, { stdout: "JSON\n\n", exit: 0 });
});

test("stripConsole removes ANSI escapes and CR", () => {
  assert.equal(stripConsole("a\x1b[0mb\x1b[1;32mc\r\n"), "abc\n");
});

test("recorded Omarchy prompt/echo and OSC metadata cannot contaminate JSON at every byte split", () => {
  const rid = "omarchy";
  const command = formatRpcCommand("hyprctl -j layers", rid).replace(/\r$/, "");
  const input = "\x1b]3008;start=demo;\x07"
    + `[omarchy@omarchy-demo ~]$ ${command}\r\n`
    + "\x1b]3008;command=hyprctl;\x1b\\"
    + "\n__WVBEGIN_omarchy\n"
    + "\x1bPquery-response\x1b\\{\"layers\":[]}\r\n"
    + "\x1b]3008;end=demo\x07\n__WVEND_omarchy_0\n";
  const bytes = new TextEncoder().encode(input);
  for (let split = 1; split < bytes.length; split++) {
    const rpc = createFencedRpc(rid);
    assert.equal(
      rpc.feed(bytes.slice(0, split)),
      null,
      `must wait for actual complete fence at byte split ${split}`,
    );
    const result = rpc.feed(bytes.slice(split));
    assert.equal(result.exit, 0);
    assert.deepEqual(JSON.parse(result.stdout), { layers: [] });
    assert.equal(result.stdout.includes("omarchy@omarchy-demo"), false);
    assert.equal(result.stdout.includes("hyprctl -j layers"), false);
  }
});

test("basic RPC: echo + stdout + marker → {stdout, exit}", () => {
  const rid = "r1";
  const p = createFencedRpc(rid);
  // The shell prompt and command echo precede BEGIN; only the bytes between the nonce fences count.
  assert.equal(p.feed(`[omarchy]$ echo hi; printf ...\n\n__WVBEGIN_${rid}\nhi\n`), null);
  const r = p.feed(`\n__WVEND_${rid}_0\n`);
  assert.deepEqual(r, { stdout: "hi\n\n", exit: 0 });
  assert.equal(p.settled, true);
});

test("non-zero exit is surfaced, not swallowed", () => {
  const rid = "r2";
  const p = createFencedRpc(rid);
  const r = p.feed(`false; printf...\n__WVBEGIN_${rid}\n\n__WVEND_${rid}_1\n`);
  assert.equal(r.exit, 1);
});

test("marker split across feeds still matches (byte-stream robust)", () => {
  const rid = "r3";
  const p = createFencedRpc(rid);
  assert.equal(p.feed(`cmd\n__WVBEGIN_${rid}\nout\n__WVEND_${rid}`), null); // marker start, no digit yet
  const r = p.feed(`_7\n`);
  assert.deepEqual(r, { stdout: "out\n", exit: 7 });
});

test("multi-digit exit marker split between digits stays pending", () => {
  const rid = "r3multi";
  const p = createFencedRpc(rid);
  assert.equal(p.feed(`cmd\n__WVBEGIN_${rid}\n__WVEND_${rid}_1`), null);
  const r = p.feed("7\n");
  assert.deepEqual(r, { stdout: "", exit: 17 });
});

test("marker-spoof: a DIFFERENT rid's marker printed as output does not settle this RPC", () => {
  const rid = "mine";
  const p = createFencedRpc(rid);
  // The command prints fake BEGIN/END markers for another id — both must be ignored.
  assert.equal(p.feed(`cmd\n__WVBEGIN_${rid}\n__WVBEGIN_other\n__WVEND_other_0\nstill running\n`), null);
  assert.equal(p.settled, false);
  const r = p.feed(`__WVEND_${rid}_0\n`);
  assert.equal(r.exit, 0);
  assert.equal(r.stdout, "__WVBEGIN_other\n__WVEND_other_0\nstill running\n");
});

test("the echoed printf format (%s, no digit) can never satisfy the marker", () => {
  const rid = "r4";
  const re = endMarkerRegex(rid);
  assert.equal(re.test(`__WVEND_${rid}_%s`), false, "%s is not a digit run");
  assert.equal(re.test(`__WVEND_${rid}_`), false, "no digit at all");
  assert.equal(re.test(`x__WVEND_${rid}_12\n`), false, "an embedded marker must not match");
  assert.equal(re.test(`__WVEND_${rid}_12`), false, "a partial marker record must not match");
  assert.equal(re.test(`__WVEND_${rid}_12\n`), true);
});

test("a large burst before the marker does not lose the END (not line-count bounded)", () => {
  const rid = "r5";
  const p = createFencedRpc(rid);
  // Exactly 100k lines of output fed in chunks, then the marker.
  p.feed(`echo-line\n__WVBEGIN_${rid}\n`);
  let res = null;
  for (let i = 0; i < 100; i++) res = p.feed("x\n".repeat(1000));
  assert.equal(res, null, "no premature settle across a large burst");
  const r = p.feed(`\n__WVEND_${rid}_0\n`);
  assert.equal(r.exit, 0);
  assert.equal(r.stdout.length, 100_000 * 2 + 1, "every output byte preserved, only fence separator added");
});

test("rid with regex-special characters is escaped (no accidental wildcard match)", () => {
  const rid = "a.b+c"; // dots/plus would be wildcards if unescaped
  const p = createFencedRpc(rid);
  assert.equal(p.feed(`cmd\n__WVBEGIN_${rid}\n__WVEND_aXbYc_0\n`), null, "unescaped wildcards must NOT match");
  const r = p.feed(`__WVEND_a.b+c_3\n`);
  assert.equal(r.exit, 3);
});

test("ANSI-wrapped marker still parses (strip happens before match)", () => {
  const rid = "r6";
  const p = createFencedRpc(rid);
  const r = p.feed(`cmd\r\n__WVBEGIN_${rid}\r\nout\r\n\x1b[0m__WVEND_${rid}_0\x1b[0m\r\n`);
  assert.deepEqual(r, { stdout: "out\n", exit: 0 });
});

test("BEGIN and END remain byte-stream robust through every split boundary", () => {
  const rid = "bytes";
  const command = formatRpcCommand("printf 'A\\nB\\n'", rid).replace(/\r$/, "");
  const input = `prompt$ ${command}\n`
    + `\n__WVBEGIN_${rid}\nA\nB\n\n__WVEND_${rid}_0\n`;
  const bytes = new TextEncoder().encode(input);
  const rpc = createFencedRpc(rid);
  let result = null;
  for (let i = 0; i < bytes.length; i++) {
    result = rpc.feed(bytes.slice(i, i + 1));
    if (i < bytes.length - 1) assert.equal(result, null, `must remain pending at byte ${i}`);
  }
  assert.deepEqual(result, { stdout: "A\nB\n\n", exit: 0 });
});
