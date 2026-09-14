// Fixed T03k experiment policy. These guards never create guest input or readiness.
import assert from "node:assert/strict";

export const INPUT_TRIAL_STARTUP_MS = 300000;
export const INPUT_TRIAL_TYPING_MS = 60000;
export const INPUT_TRIAL_READBACK_MS = 120000;
export const INPUT_TRIAL_CAPTURE_MS = 20000;
export const INPUT_TRIAL_CLEANUP_MS = 30000;
export const R3_IDENTITIES = Object.freeze({
  kernel: { size: 24208896, sha256: "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce" },
  bootSnapshot: { size: 205050833, sha256: "2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5" },
  overlayDelta: { size: 1209196, sha256: "1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da" },
  chunkManifest: { size: 1097812, sha256: "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44" },
});

export function inputTrialOptions({ urlArg, pair, chunks, arm, renderer, lp, timeout }) {
  assert.equal(urlArg, "local", "input-trial requires local (never production)");
  assert.ok(pair && chunks, "input-trial requires the pinned R3 pair and chunks");
  assert.ok(["control", "candidate"].includes(arm), "input-trial requires explicit control or candidate arm");
  assert.ok(!renderer && lp === null, "input-trial carries R3 renderer evidence; no new renderer probes");
  assert.equal(timeout, undefined, "input-trial startup deadline is fixed; no timeout override");
  return { arm, recycling: arm === "candidate", startupMs: INPUT_TRIAL_STARTUP_MS,
    typingMs: INPUT_TRIAL_TYPING_MS, readbackMs: INPUT_TRIAL_READBACK_MS,
    captureMs: INPUT_TRIAL_CAPTURE_MS, cleanupMs: INPUT_TRIAL_CLEANUP_MS };
}

export function inputTrialUrl(input, options) {
  const url = new URL(input);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["desktop", "guest"]);
  url.searchParams.set("omarchyDivider", "64");
  url.searchParams.set("jit", "1");
  url.searchParams.set("jitColdCounterRecycling", options.recycling ? "1" : "0");
  return url;
}

export function assertInputTrialSource(source) {
  for (const [role, identity] of Object.entries(R3_IDENTITIES)) {
    assert.equal(source?.[role]?.size, identity.size, `${role}: not pinned R3 size`);
    assert.equal(source?.[role]?.sha256, identity.sha256, `${role}: not pinned R3 bytes`);
  }
  assert.deepEqual(source.image, { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 });
}

export function assertInputTrialRuntime(state, options) {
  const jit = state.jit;
  assert.equal(jit?.hasExecutor, true);
  assert.equal(jit.admissionProbe, false, "input-trial must not enable the observer in either arm");
  assert.equal(jit.coldCounterRecycling?.enabled, options.recycling, "actual recycling selection disagrees");
  assert.equal(jit.coldCounterRecycling.threshold, 512);
  assert.equal(jit.coldCounterRecycling.capacity, 65536);
  for (const key of ["epochs", "discardedCounters"]) {
    assert.match(jit.coldCounterRecycling[key], /^(0|[1-9][0-9]*)$/u);
    assert.ok(BigInt(jit.coldCounterRecycling[key]) <= 0xffffffffffffffffn);
  }
  assert.equal(jit.decodedCacheEntries, 4096);
  assert.equal(jit.jitResidencyPolicy, "repack-off");
  assert.equal(jit.jitResidencyCap, 24);
  assert.equal(jit.entryCost?.timingEnabled, false);
  assert.equal(state.clock?.mode, "icount");
  assert.equal(state.clock?.clockDiv, 64);
}

export function remainingTrialMs(deadline, now = Date.now(), label = "input-trial") {
  const remaining = deadline - now;
  assert.ok(Number.isSafeInteger(remaining) && remaining > 0, `${label}: deadline exceeded (UNPROVEN)`);
  return remaining;
}

// Queue time counts. Closing the owned browser on failure cancels pending work;
// a late response cannot turn a timed-out proof into a success.
export async function withinTrialDeadline(operation, deadline, label) {
  const remaining = remainingTrialMs(deadline, Date.now(), label);
  let timer;
  try {
    const result = await Promise.race([Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded (UNPROVEN)`)), remaining); })]);
    remainingTrialMs(deadline, Date.now(), label);
    return result;
  } finally { clearTimeout(timer); }
}
