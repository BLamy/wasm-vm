// E3-T22b — deterministic node unit tests for paste framing (no browser).
// Run: node --test web/tests/paste.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BRACKET_END,
  BRACKET_START,
  framePaste,
  normalizeNewlines,
  stripEndMarkers,
} from "../paste.js";

test("newlines: CRLF, LF, and CR all normalize to a single CR", () => {
  assert.equal(normalizeNewlines("a\r\nb\nc\rd"), "a\rb\rc\rd");
  assert.equal(normalizeNewlines("no newlines"), "no newlines");
  // No doubling: a CRLF must become ONE CR, not two.
  assert.equal(normalizeNewlines("x\r\ny"), "x\ry");
});

test("bracketed mode wraps exactly once, with normalized newlines inside", () => {
  const out = framePaste("line1\nline2", { bracketed: true });
  assert.equal(out, `${BRACKET_START}line1\rline2${BRACKET_END}`);
  // Exactly one start and one end marker.
  assert.equal(out.split(BRACKET_START).length - 1, 1);
  assert.equal(out.split(BRACKET_END).length - 1, 1);
});

test("mode 2004 unset: no bracket markers added (documented fallback)", () => {
  const out = framePaste("hello\nworld", { bracketed: false });
  assert.equal(out, "hello\rworld");
  assert.ok(!out.includes(BRACKET_START) && !out.includes(BRACKET_END));
});

test("PASTE-INJECTION: an embedded end-marker is neutralized (no early termination)", () => {
  // The classic attack: pasted content carries ESC[201~ then a command, hoping to close the bracket
  // early so the tail executes as typed.
  const hostile = `safe${BRACKET_END}rm -rf /\n`;
  const out = framePaste(hostile, { bracketed: true });
  // Exactly ONE end marker — the one WE appended — and it is the very last thing.
  assert.equal(out.split(BRACKET_END).length - 1, 1, "only our own end marker survives");
  assert.ok(out.endsWith(BRACKET_END), "our end marker is last");
  // The dangerous command is still present as inert data, inside the bracket, newline normalized.
  assert.ok(out.includes("rm -rf /\r"), "the tail stays inert data inside the bracket");
});

test("multiple embedded end-markers are all stripped", () => {
  const s = `a${BRACKET_END}b${BRACKET_END}c`;
  assert.equal(stripEndMarkers(s), "abc");
  const out = framePaste(s, { bracketed: true });
  assert.equal(out, `${BRACKET_START}abc${BRACKET_END}`);
});

test("multi-megabyte paste frames byte-identically (no loss/corruption)", () => {
  const body = "x".repeat(2 * 1024 * 1024) + "\n" + "y".repeat(1024);
  const out = framePaste(body, { bracketed: true });
  // Stripping our wrapper recovers exactly the normalized input.
  assert.ok(out.startsWith(BRACKET_START) && out.endsWith(BRACKET_END));
  const inner = out.slice(BRACKET_START.length, out.length - BRACKET_END.length);
  assert.equal(inner, normalizeNewlines(body));
  assert.equal(inner.length, body.length); // one \n -> one \r, so length is preserved
});

test("empty paste is handled (bracketed → empty bracket, unbracketed → empty)", () => {
  assert.equal(framePaste("", { bracketed: true }), `${BRACKET_START}${BRACKET_END}`);
  assert.equal(framePaste("", { bracketed: false }), "");
});

test("framePaste tolerates non-string input", () => {
  assert.equal(framePaste(42, { bracketed: false }), "42");
});
