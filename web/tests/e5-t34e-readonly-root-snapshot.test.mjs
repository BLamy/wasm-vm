// E5-T34e: the JS half of the read-only-root warm snapshot binding (web/readonly-root-snapshot.js)
// and the shipped Replay desktop manifest. A mismatch on any bound field must refuse the snapshot
// (the loader then cold-boots); the wasm coherence guard covers build/base/topology. node --test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readOnlyRootSnapshotMismatch } from "../readonly-root-snapshot.js";

const manifest = JSON.parse(readFileSync(new URL("../artifacts-replay-desktop.json", import.meta.url), "utf8"));
const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const bootargs = /const REPLAY_DESKTOP_BOOTARGS =\s*"([^"]+)"/u.exec(main)[1];
const entry = manifest.artifacts.bootSnapshot;
// Exactly what bootReplayDesktop() hands the loader.
const expected = {
  imageSha256: manifest.artifacts.wholeImage.uncompressedSha256,
  kernelSha256: manifest.artifacts.kernel.sha256,
  ramMib: 1024, bootargs, guestClock: "icount", icountDivider: 64,
};

test("the shipped Replay desktop snapshot is admitted for the shipped boot", () => {
  assert.equal(readOnlyRootSnapshotMismatch(entry, expected), null);
  assert.equal(entry.identity.readOnlyRoot, true);
  assert.equal(manifest.artifacts.overlayDelta, undefined, "a read-only root ships no disk delta");
});

test("every bound field refuses a mismatch", () => {
  const cases = [
    [{ imageSha256: "0".repeat(64) }, "image"],
    [{ kernelSha256: "1".repeat(64) }, "kernel"],
    [{ ramMib: 2048 }, "ram"],
    [{ bootargs: `${bootargs} rw` }, "bootargs"],
    [{ guestClock: "realtime" }, "clock"],
    [{ icountDivider: 32 }, "clock_divider"],
  ];
  for (const [change, reason] of cases) {
    assert.equal(readOnlyRootSnapshotMismatch(entry, { ...expected, ...change }), reason);
  }
});

test("malformed or non-read-only entries are refused", () => {
  const id = entry.identity;
  assert.equal(readOnlyRootSnapshotMismatch(undefined, expected), "missing");
  assert.equal(readOnlyRootSnapshotMismatch({ ...entry, url: "" }, expected), "no_url");
  assert.equal(readOnlyRootSnapshotMismatch({ ...entry, sha256: "x" }, expected), "no_digest");
  assert.equal(readOnlyRootSnapshotMismatch({ ...entry, uncompressedSize: 0 }, expected), "no_size");
  assert.equal(readOnlyRootSnapshotMismatch({ ...entry, identity: undefined }, expected), "no_identity");
  assert.equal(readOnlyRootSnapshotMismatch({ ...entry, identity: { ...id, readOnlyRoot: false } }, expected), "not_read_only_root");
  assert.equal(readOnlyRootSnapshotMismatch({ ...entry, identity: { ...id, deviceLayout: "native" } }, expected), "device_layout");
});
