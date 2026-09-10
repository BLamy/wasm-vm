// Focused no-network coverage for the freshDesktop warm-boot contract. Execute the actual
// startLinuxBoot source with deterministic loader/WASM stubs so fail-closed behavior is tested
// without rebuilding pkg/, serving assets, opening IndexedDB, or booting Linux.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
const startAt = loader.indexOf("export async function startLinuxBoot(");
const endAt = loader.indexOf("\nexport function resolveSlirpProvider", startAt);
assert.ok(startAt >= 0 && endAt > startAt, "actual startLinuxBoot source boundary missing");
const startSource = loader
  .slice(startAt, endAt)
  .replace("export async function startLinuxBoot(", "async function startLinuxBoot(");

function warmManifest() {
  return {
    artifacts: {
      kernel: { url: "kernel", sha256: "kernel-ok" },
      bootSnapshot: { url: "snapshot", sha256: "snapshot-ok" },
      overlayDelta: { url: "delta", sha256: "delta-ok" },
    },
  };
}

async function runFresh({
  manifest = warmManifest(),
  deltaDigest = "delta-ok",
  snapshotDigest = "snapshot-ok",
  snapshotFailure = null,
  decision = "stale",
  freshDesktop = true,
  persist = false,
} = {}) {
  const calls = [];
  const states = [];
  const errors = [];
  let networkAttempts = 0;
  let rejected = false;
  const machine = {
    overlayGeneration: () => 23,
    restoreDecisionCode: () => decision,
    loadSnapshotBlob: () => calls.push("loadSnapshotBlob"),
  };
  const WasmLinux = {
    newChunkedDiskSeeded: (...args) => {
      calls.push(["newChunkedDiskSeeded", args]);
      return machine;
    },
    newChunkedDiskPersistent: (...args) => {
      calls.push(["newChunkedDiskPersistent", args]);
      throw new Error("persistent-factory-sentinel");
    },
  };
  const sandbox = {
    WasmLinux,
    applyDecodedCacheEntries: () => {},
    createGuestClockLifecycle: () => ({ resume() {}, dividerSelection() {}, state() {} }),
    createTaskQuiescence: () => ({ isActive: () => false }),
    decideBootPath: () => "boot_snapshot",
    deriveBootSnapshotBaseId: async () => "unused-base",
    deriveOverlaySeedIdentity: async () => "unused-seed",
    overlayDbName: () => "test-overlay",
    fetch: () => {
      networkAttempts += 1;
      throw new Error("unexpected network access");
    },
    fetchAsset: async (url) => {
      calls.push(["fetchAsset", url]);
      return '{"version":1}';
    },
    fetchJsonAsset: async (url) => {
      calls.push(["fetchJsonAsset", url]);
      return manifest;
    },
    fetchWithProgress: async (url) => {
      calls.push(["fetchWithProgress", url]);
      if (url === "kernel") return Uint8Array.of(1);
      if (url === "delta") return Uint8Array.of(2);
      if (url === "snapshot") {
        if (snapshotFailure) throw new Error(snapshotFailure);
        return Uint8Array.of(3);
      }
      throw new Error(`unexpected asset: ${url}`);
    },
    gunzip: async (bytes) => Uint8Array.of(bytes[0] + 10),
    init: async () => calls.push("init"),
    onState: (state) => states.push(state),
    onError: (error) => errors.push(error?.message || String(error)),
    resolveSlirpProvider: () => ({
      provider: "offline",
      relayUrl: "",
      relayToken: "",
      workerUrl: "",
      workerConfig: {},
    }),
    setSlirpDohEndpoint: () => {},
    setSlirpDhcpLeaseSeconds: () => {},
    setSlirpMtu: () => {},
    setSlirpNet: () => {},
    setSlirpRelay: () => {},
    setSlirpRelayToken: () => {},
    setSlirpTailscaleWorker: () => {},
    sha256hex: async (bytes) => {
      if (bytes[0] === 1) return "kernel-ok";
      if (bytes[0] === 2) return deltaDigest;
      if (bytes[0] === 3) return snapshotDigest;
      return "unexpected-digest";
    },
    validateDecodedCacheEntries: () => {},
    validateGuestClock: () => {},
    validateICountDivider: () => {},
    URLSearchParams,
    location: { search: "" },
    navigator: {
      locks: undefined,
      storage: { estimate: async () => ({}), persist: async () => true },
    },
    console: { warn: (...args) => calls.push(["warn", ...args]) },
    performance: { now: () => 0 },
    setTimeout: () => {},
  };
  const startLinuxBoot = vm.runInNewContext(`(${startSource})`, sandbox);
  try {
    await startLinuxBoot({
      bootProfileUrl: null,
      freshDesktop,
      imageManifestUrl: "image-manifest",
      manifestUrl: "manifest",
      mode: "chunked",
      persist,
      onError: sandbox.onError,
      onState: sandbox.onState,
    });
  } catch (error) {
    rejected = true;
    errors.push(error?.message || String(error));
  }
  return { calls, errors, networkAttempts, rejected, states };
}

test("freshDesktop rejects a missing RAM/delta pair instead of cold-falling back", async () => {
  for (const missing of ["bootSnapshot", "overlayDelta"]) {
    const manifest = warmManifest();
    delete manifest.artifacts[missing];
    const result = await runFresh({ manifest });

    assert.equal(result.rejected, true, missing);
    assert.equal(result.networkAttempts, 0, missing);
    assert.deepEqual(result.states, ["error"], missing);
    assert.equal(
      result.calls.some((call) => Array.isArray(call) && call[0] === "newChunkedDiskSeeded"),
      false,
      missing,
    );
    assert.match(result.errors.at(-1), /Omarchy desktop snapshot is not published/, missing);
    assert.equal(result.states.includes("booting"), false, missing);
  }
});

test("freshDesktop rejects an overlay-delta integrity mismatch instead of cold-falling back", async () => {
  const result = await runFresh({ deltaDigest: "wrong-delta-digest" });

  assert.equal(result.rejected, true);
  assert.equal(result.networkAttempts, 0);
  assert.deepEqual(result.states, ["fetching", "instantiating", "restoring", "error"]);
  assert.equal(result.calls.some((call) => Array.isArray(call) && call[0] === "newChunkedDiskSeeded"), false);
  assert.match(result.errors.at(-1), /desktop overlay delta integrity check failed/);
  assert.equal(result.states.includes("booting"), false);
});

test("freshDesktop rejects a RAM snapshot coherence mismatch instead of cold-falling back", async () => {
  const result = await runFresh({ decision: "stale" });

  assert.equal(result.rejected, true);
  assert.equal(result.networkAttempts, 0);
  assert.deepEqual(result.states, ["fetching", "instantiating", "restoring", "restoring", "error"]);
  assert.equal(result.calls.some((call) => Array.isArray(call) && call[0] === "newChunkedDiskSeeded"), true);
  assert.equal(result.calls.includes("loadSnapshotBlob"), false);
  assert.match(result.errors.at(-1), /Omarchy desktop snapshot is not coherent: stale/);
  assert.equal(result.states.includes("booting"), false);
});

test("freshDesktop rejects RAM snapshot fetch and integrity failures instead of cold-falling back", async () => {
  for (const options of [
    { snapshotFailure: "snapshot transport failed", pattern: /snapshot transport failed/ },
    { snapshotDigest: "wrong-snapshot-digest", pattern: /boot snapshot integrity/ },
  ]) {
    const result = await runFresh(options);

    assert.equal(result.rejected, true, options.pattern);
    assert.equal(result.networkAttempts, 0, options.pattern);
    assert.deepEqual(result.states, ["fetching", "instantiating", "restoring", "restoring", "error"]);
    assert.equal(
      result.calls.some((call) => Array.isArray(call) && call[0] === "newChunkedDiskSeeded"),
      true,
    );
    assert.equal(result.calls.includes("loadSnapshotBlob"), false);
    assert.match(result.errors.at(-1), options.pattern);
    assert.equal(result.states.includes("booting"), false);
  }
});

test("freshDesktop rejects persistent mode before any asset fetch", async () => {
  const result = await runFresh({ persist: true });

  assert.equal(result.rejected, true);
  assert.equal(result.networkAttempts, 0);
  assert.deepEqual(result.states, ["error"]);
  assert.equal(
    result.calls.some((call) => Array.isArray(call) && call[0] === "fetchJsonAsset"),
    false,
  );
  assert.equal(
    result.calls.some((call) => Array.isArray(call) && call[0] === "newChunkedDiskSeeded"),
    false,
  );
  assert.match(result.errors.at(-1), /fresh desktop requires an ephemeral chunked warm boot/);
});

test("persistent caller reaches the persistent constructor branch (runtime sentinel)", async () => {
  const result = await runFresh({ freshDesktop: false, persist: true });

  assert.equal(result.rejected, true);
  assert.equal(result.networkAttempts, 0);
  assert.equal(
    result.calls.some((call) => Array.isArray(call) && call[0] === "newChunkedDiskPersistent"),
    true,
  );
  assert.equal(
    result.calls.some((call) => Array.isArray(call) && call[0] === "newChunkedDiskSeeded"),
    false,
  );
  assert.match(result.errors.at(-1), /persistent-factory-sentinel/);
  assert.equal(result.states.includes("booting"), false);
});
