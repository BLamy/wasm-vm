import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { deriveOverlaySeedIdentity } from "../overlay-seed-identity.js";

test("warm release identity binds both RAM snapshot and disk delta", async () => {
  const bootA = "a".repeat(64);
  const bootB = "b".repeat(64);
  const deltaA = "c".repeat(64);
  const deltaB = "d".repeat(64);

  const releaseA = await deriveOverlaySeedIdentity(bootA, deltaA, webcrypto);
  assert.match(releaseA, /^[0-9a-f]{64}$/);
  assert.equal(releaseA, await deriveOverlaySeedIdentity(bootA, deltaA, webcrypto));
  assert.notEqual(
    releaseA,
    await deriveOverlaySeedIdentity(bootB, deltaA, webcrypto),
    "a RAM-only snapshot update rotates the namespace and writer lock",
  );
  assert.notEqual(
    releaseA,
    await deriveOverlaySeedIdentity(bootA, deltaB, webcrypto),
    "a disk-delta update rotates the namespace and writer lock",
  );
});

test("warm release identity rejects non-canonical artifact digests", async () => {
  for (const invalid of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
    await assert.rejects(
      deriveOverlaySeedIdentity(invalid, "b".repeat(64), webcrypto),
      /lowercase SHA-256/,
    );
  }
});
