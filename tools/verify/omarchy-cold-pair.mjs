// Cold-pair harness policy only; these guards do not establish guest or GUI evidence.
import assert from "node:assert/strict";
import { desktopObservation } from "./omarchy-browser-session.mjs";
import { hasOmarchyDesktopLayers } from "../../web/omarchy-desktop-readiness.js";
import { validateExpectedLpEnvironment } from "./omarchy-thread-setting.mjs";
import { observeHyprlandRenderer } from "./omarchy-renderer-log.mjs";

export const COLD_STARTUP_MS = 5_400_000;
export const COLD_KERNEL_SHA256 = "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce";
export const COLD_BLANK_PATH = "/__omarchy-cold-pair-blank.html";

export function coldPairOptions({ urlArg, pair, chunks, renderer, lp, timeout = COLD_STARTUP_MS }) {
  assert.ok(urlArg === "local" || urlArg === "selftest", "cold-pair requires local or selftest");
  assert.ok(chunks, "cold-pair requires OMARCHY_CANDIDATE_CHUNKS");
  assert.ok(!pair, "cold-pair forbids OMARCHY_CANDIDATE_PAIR_DIR");
  assert.equal(renderer, "llvmpipe", "cold-pair requires llvmpipe expectation");
  assert.equal(lp, "0", "cold-pair requires OMARCHY_EXPECT_LP_NUM_THREADS=0");
  assert.equal(Number(timeout), COLD_STARTUP_MS, "cold-pair startup budget must be exactly 5400000 ms");
  return COLD_STARTUP_MS;
}

export function coldPairUrl(input) {
  const url = new URL(input);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  url.searchParams.set("noSnapshot", "1");
  url.searchParams.set("persist", "1");
  url.searchParams.set("omarchyAssetBase", url.origin);
  return url;
}

export function assertEmptyOriginStorage(state, origin) {
  assert.equal(state.origin, origin, "blank storage observation has wrong origin");
  assert.equal(state.pathname, COLD_BLANK_PATH, "storage was not observed on the blank page");
  for (const name of ["databases", "caches", "serviceWorkers", "localStorage", "sessionStorage"]) {
    assert.deepEqual(state[name], [], `cold origin has pre-existing ${name}`);
  }
  assert.equal(state.serviceWorkerController, null);
  assert.equal(state.vmPresent, false, "app ran before empty-storage observation");
  assert.equal(state.workerMessages, 0, "worker ran before empty-storage observation");
}

export function assertColdRestore({ shipped, stored }) {
  assert.equal(shipped, false, "cold-pair restored a shipped snapshot");
  assert.equal(stored?.attempted, true, "persistent stored-restore observation is missing");
  assert.equal(stored.decision, "missing", "cold-pair found a stored snapshot");
  assert.equal(stored.overlayGeneration, 0, "cold-pair initial overlay generation is not zero");
}

export function assertColdDesktop({ renderer, clients, layers, processes, confirmedInstances }) {
  assert.equal(renderer.expectedRenderer, "llvmpipe");
  assert.equal(renderer.expectedLpNumThreads, "0");
  assert.ok(Number.isSafeInteger(renderer.instance?.pid) && renderer.instance.pid > 0, "unsafe compositor PID");
  assert.match(renderer.instance.instance, /^[A-Za-z0-9_.-]+$/u);
  for (const result of [renderer.environment, renderer.threads, renderer.log]) assert.equal(result?.exit, 0);
  assert.ok(renderer.threads.stdout.trim(), "empty compositor thread list");
  validateExpectedLpEnvironment({ environment: renderer.environment.stdout, threads: renderer.threads.stdout, lpNumThreads: "0" });
  const matched = renderer.log.stdout.trim() === "" ? false
    : observeHyprlandRenderer({ log: renderer.log.stdout, threads: renderer.threads.stdout, expectedRenderer: "llvmpipe" }).positivelyMatched === true;
  assert.equal(renderer.activeRendererValidated, matched, "renderer label claim disagrees with actual log");
  assert.deepEqual(confirmedInstances, [renderer.instance], "Hyprland instance changed before capture");
  const observation = desktopObservation(clients, layers, processes);
  assert.ok(observation.mappedFoot, "cold-pair has no mapped Foot");
  assert.ok(observation.quickshellObserved && hasOmarchyDesktopLayers(layers),
    "cold-pair lacks mapped package shell layers");
  return observation;
}

export function remainingStartupMs(deadline, now = Date.now()) {
  const remaining = deadline - now;
  assert.ok(Number.isSafeInteger(remaining) && remaining > 0, "cold-pair startup deadline exceeded (UNPROVEN)");
  return remaining;
}

// Includes time spent queued behind the app's own serialized readiness RPC.
export async function withinStartupDeadline(operation, deadline) {
  const remaining = remainingStartupMs(deadline);
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cold-pair startup deadline exceeded (UNPROVEN)")), remaining); }),
    ]);
    remainingStartupMs(deadline);
    return result;
  } finally { clearTimeout(timer); }
}
