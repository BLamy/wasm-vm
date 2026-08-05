// E3-T19a — deterministic tests for the Tailscale persist/restore validation boundary (no live
// tailnet, no browser). `normalizeSnapshot` is what every reload runs before restoring identity, so
// it is the enforcement point for the security-critical invariants: persisted state is ONLY the Go
// IPN's hex-encoded key material, and anything else (a tampered entry, an oversized blob, an array,
// or a stray non-hex secret like an auth key) is REJECTED rather than restored.
// Run: node --test web/tests/tailscale-state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSnapshot } from "../tailscale-runtime.js";

const hex = (n) => "a".repeat(n); // n hex chars (even n → valid)

test("a valid hex key-material snapshot passes through unchanged", () => {
  const s = { "profile-default": hex(64), machinekey: "0f1e2d3c" };
  assert.deepEqual(normalizeSnapshot(s), s);
});

test("null / undefined normalize to an empty state (a fresh, un-provisioned profile)", () => {
  assert.deepEqual(normalizeSnapshot(null), {});
  assert.deepEqual(normalizeSnapshot(undefined), {});
});

test("non-object saved state is rejected (string / number / boolean)", () => {
  for (const bad of ["tskey-auth-abc123", 42, true]) {
    assert.throws(() => normalizeSnapshot(bad), /not an object/);
  }
});

test("an array is rejected (must be a keyed object, not a list)", () => {
  assert.throws(() => normalizeSnapshot([hex(8), hex(8)]), /not an object/);
});

test("SECURITY: a non-hex value is rejected — a stray auth key can never be restored", () => {
  // Auth keys look like `tskey-auth-…` — NOT hex, so even if one were smuggled into the saved state
  // it is refused on restore (belt-and-suspenders atop the runtime deleting the key from config/DOM).
  assert.throws(() => normalizeSnapshot({ k: "tskey-auth-k123CONTROL" }), /malformed/);
  assert.throws(() => normalizeSnapshot({ k: "not-hex-zz" }), /malformed/);
});

test("odd-length hex is rejected (key material is whole bytes)", () => {
  assert.throws(() => normalizeSnapshot({ k: "abc" }), /malformed/);
});

test("an oversized value (> 1 MiB) is rejected (no unbounded restore)", () => {
  assert.throws(() => normalizeSnapshot({ k: hex(1024 * 1024 + 2) }), /malformed/);
  assert.doesNotThrow(() => normalizeSnapshot({ k: hex(1024 * 1024) })); // exactly at the cap is fine
});

test("an over-long key (> 256 chars) is rejected", () => {
  assert.throws(() => normalizeSnapshot({ ["k".repeat(257)]: hex(8) }), /malformed/);
});

test("an empty-string key is rejected", () => {
  assert.throws(() => normalizeSnapshot({ "": hex(8) }), /malformed/);
});

test("a non-string value (number / object / null) is rejected", () => {
  assert.throws(() => normalizeSnapshot({ k: 123 }), /malformed/);
  assert.throws(() => normalizeSnapshot({ k: { nested: "1" } }), /malformed/);
  assert.throws(() => normalizeSnapshot({ k: null }), /malformed/);
});

test("uppercase hex is accepted (case-insensitive), mixed case too", () => {
  assert.doesNotThrow(() => normalizeSnapshot({ k: "ABCDEF01", j: "aB12Cd34" }));
});
