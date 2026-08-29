import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOverlayResetSeedIdentity } from "../overlay-reset-target.js";

test("reset accepts only a successfully resolved active namespace", async () => {
  const seed = "a".repeat(64);
  assert.equal(
    await resolveOverlayResetSeedIdentity({ overlaySeedIdentity: async () => seed }),
    seed,
  );
  assert.equal(
    await resolveOverlayResetSeedIdentity({ overlaySeedIdentity: async () => null }),
    null,
  );
});

test("reset fails closed instead of falling back to the legacy user database", async () => {
  await assert.rejects(resolveOverlayResetSeedIdentity({}), /identity is unavailable/);
  await assert.rejects(
    resolveOverlayResetSeedIdentity({ overlaySeedIdentity: async () => { throw new Error("worker failed"); } }),
    /worker failed/,
  );
  await assert.rejects(
    resolveOverlayResetSeedIdentity({ overlaySeedIdentity: async () => "bad" }),
    /identity is invalid/,
  );
});
