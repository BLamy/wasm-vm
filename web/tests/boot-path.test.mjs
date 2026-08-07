// E4 restore-on-first-load — the pure JS boot-path decision + base-id derivation (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { decideBootPath, deriveBootSnapshotBaseId } from "../boot-path.js";

test("a valid user snapshot always wins", () => {
  assert.equal(
    decideBootPath({ hasUserSnapshot: true, bootSnapshotAvailable: true, bootSnapshotDecision: "resume" }),
    "user_snapshot",
  );
  // Even with no boot snapshot at all.
  assert.equal(
    decideBootPath({ hasUserSnapshot: true, bootSnapshotAvailable: false }),
    "user_snapshot",
  );
});

test("a coherent boot snapshot restores when there is no user snapshot", () => {
  assert.equal(
    decideBootPath({ hasUserSnapshot: false, bootSnapshotAvailable: true, bootSnapshotDecision: "resume" }),
    "boot_snapshot_restore",
  );
});

test("an incoherent or absent boot snapshot falls back to a cold boot", () => {
  for (const decision of ["missing", "corrupt", "foreign_build", "foreign_image", "stale", "pending", undefined]) {
    assert.equal(
      decideBootPath({ hasUserSnapshot: false, bootSnapshotAvailable: true, bootSnapshotDecision: decision }),
      "cold_boot",
      `decision=${decision}`,
    );
  }
  // No boot snapshot advertised at all → cold boot.
  assert.equal(
    decideBootPath({ hasUserSnapshot: false, bootSnapshotAvailable: false, bootSnapshotDecision: "resume" }),
    "cold_boot",
  );
});

test("base id is a deterministic 32-byte SHA-256 of the two artifact hashes", async () => {
  const k = "a".repeat(64);
  const i = "b".repeat(64);
  const id1 = await deriveBootSnapshotBaseId(k, i, webcrypto);
  const id2 = await deriveBootSnapshotBaseId(k, i, webcrypto);
  assert.equal(id1.length, 32);
  assert.deepEqual([...id1], [...id2]);
  // A different kernel hash → a different base id (the foreign_image binding).
  const id3 = await deriveBootSnapshotBaseId("c".repeat(64), i, webcrypto);
  assert.notDeepEqual([...id1], [...id3]);

  // Matches the shell derivation: SHA-256("<k>\n<i>").
  const expected = new Uint8Array(
    await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(`${k}\n${i}`)),
  );
  assert.deepEqual([...id1], [...expected]);
});
