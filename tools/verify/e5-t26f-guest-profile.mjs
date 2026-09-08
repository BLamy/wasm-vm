// Diagnostic observer only: existing loader/profileStats APIs, unchanged served bytes.
import assert from "node:assert/strict";

export const GUEST_PROFILE_SCOPE = Object.freeze({
  pcAddressSpace: "guest-virtual", regionBytes: 64, topRegions: 10,
  retires: "interpreted-only; JIT retires excluded", sampling: "jittered approximately 1/1024",
  limitation: "cumulative bounded histogram; collisions/evictions and top-10 truncation; not whole-guest CPU time",
});

export function guestProfileRequested(env) {
  const value = env.E5_T26F_DIAGNOSTIC_GUEST_PROFILE;
  if (value === undefined) return false;
  assert.equal(value, "1", "guest profile flag must be exactly 1");
  assert.equal(env.E5_T26F_DIAGNOSTIC, "reuse", "guest profile requires diagnostic reuse only");
  for (const key of ["COMPLETE", "CPU", "LATENCY", "JIT", "RESIDENCY", "GUEST_CLOCK", "ICOUNT_DIVIDER", "COMMAND", "KEY_DELAY_MS"]) {
    assert.equal(env[`E5_T26F_DIAGNOSTIC_${key}`], undefined, "guest profile forbids command, pacing, tuning and other profiling overrides (even empty)");
  }
  return true;
}

// Self-contained for page.addInitScript. A Proxy's construct-only trap preserves the native
// prototype/statics and native call-without-new refusal; Reflect.construct preserves subclasses.
export function installGuestProfileWorker() {
  const key = "__e5t26fGuestProfileWorker";
  const previous = globalThis[key];
  if (previous) {
    if (globalThis.Worker !== previous.worker) throw Error("guest-profile Worker wrapper was replaced");
    return;
  }
  const NativeWorker = globalThis.Worker;
  if (typeof NativeWorker !== "function") throw Error("native Worker unavailable");
  const requests = [];
  const wrapped = new Proxy(NativeWorker, {
    construct(target, args, newTarget) {
      let url = null;
      if (typeof args[0] === "string" || args[0] instanceof URL) {
        try { url = new URL(args[0], globalThis.location.href); } catch { /* native handles invalid input */ }
      }
      if (!url || url.origin !== globalThis.location.origin || url.pathname !== "/linux-worker.js") {
        return Reflect.construct(target, args, newTarget);
      }
      if (requests.length >= 4) throw Error("bounded guest-profile worker request count exceeded");
      const originalUrl = url.href;
      url.searchParams.set("profile", "1");
      const worker = Reflect.construct(target, [url.href, ...args.slice(1)], newTarget);
      requests.push({ originalUrl, requestedUrl: url.href });
      return worker;
    },
  });
  globalThis.Worker = wrapped;
  Object.defineProperty(globalThis, key, { value: Object.freeze({ worker: wrapped,
    snapshot: () => ({ installed: globalThis.Worker === wrapped, requests: requests.map(value => ({ ...value })) }) }),
  configurable: false, enumerable: false, writable: false });
}

function validateProfile(profile) {
  assert.ok(profile && typeof profile === "object", "actual profileStats unavailable/null");
  for (const key of ["totalNs", "sampleCount", "walkCount", "collisions"]) {
    assert.ok(Number.isSafeInteger(profile[key]) && profile[key] >= 0, `invalid actual profile ${key}`);
  }
  assert.ok(profile.sampleCount > 0 && profile.totalNs > 0, "actual profiler has no samples/time after restore; do not assume it remained armed");
  assert.ok(Array.isArray(profile.regions) && profile.regions.length > 0 && profile.regions.length <= 10, "actual top-10 regions required");
  const seen = new Set();
  for (const region of profile.regions) {
    assert.match(region.pc, /^0x[0-9a-f]{16}$/u, "actual virtual PC required");
    assert.equal(BigInt(region.pc) % 64n, 0n, "region must be 64-byte aligned");
    assert.ok(!seen.has(region.pc), "duplicate profile region"); seen.add(region.pc);
    assert.ok(Number.isSafeInteger(region.samples) && region.samples > 0 && region.samples <= profile.sampleCount, "invalid region count");
    assert.ok(Number.isFinite(region.pct) && region.pct >= 0 && region.pct <= 100, "invalid region percentage");
  }
  assert.ok(Array.isArray(profile.subsystems) && profile.subsystems.length <= 11, "bounded subsystem report required");
  for (const sub of profile.subsystems) {
    assert.ok(typeof sub.name === "string" && sub.name.length <= 64 && Number.isSafeInteger(sub.ns) && sub.ns >= 0, "invalid subsystem report");
  }
}

export async function recordGuestProfile(page, milestones, key) {
  assert.ok(key === "guestProfileBefore" || key === "guestProfileAfter");
  const record = { acceptance: false, scope: GUEST_PROFILE_SCOPE, requestedAt: null, receivedAt: null, state: null };
  milestones[key] = record; // Raw/failed observations survive the runner's normal failure capture.
  try {
    Object.assign(record, await page.evaluate(async () => {
      const requestedAt = performance.now();
      const worker = globalThis.__e5t26fGuestProfileWorker?.snapshot() ?? null;
      const controller = globalThis.__desktopController;
      let timer, state = null, error = null;
      const available = typeof controller?.profileStats === "function";
      try {
        if (available) state = await Promise.race([controller.profileStats(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("bounded profileStats timeout")), 5_000);
        })]);
      } catch (cause) { error = String(cause?.message || cause).slice(0, 240); }
      finally { clearTimeout(timer); }
      return { requestedAt, receivedAt: performance.now(), origin: globalThis.location.origin, worker, available, state, error };
    }));
    assert.ok(Number.isFinite(milestones.postRestoreStart) && Number.isFinite(record.requestedAt) &&
      record.requestedAt >= milestones.postRestoreStart && Number.isFinite(record.receivedAt) &&
      record.receivedAt >= record.requestedAt, "invalid original restore/profile timestamps");
    assert.equal(record.worker?.installed, true, "actual Worker wrapper missing/replaced");
    assert.equal(record.worker.requests.length, 1, "one actual profiled Linux worker required");
    const request = record.worker.requests[0], original = new URL(request.originalUrl), requested = new URL(request.requestedUrl);
    assert.equal(original.origin, record.origin, "actual worker must be same-origin");
    assert.equal(original.pathname, "/linux-worker.js");
    original.searchParams.set("profile", "1");
    assert.equal(requested.href, original.href, "actual worker URL differs from profile-only selection");
    assert.equal(record.available, true, "profileStats API unavailable");
    assert.equal(record.error, null, "actual profileStats RPC failed");
    validateProfile(record.state);
    if (key === "guestProfileAfter") {
      assert.ok(Number.isFinite(milestones.postRestoreEnd) && record.requestedAt >= milestones.postRestoreEnd,
        "after profile must follow the original frozen interaction end");
      const before = milestones.guestProfileBefore;
      assert.equal(before?.checksPassed, true, "actual before profile required");
      assert.ok(record.requestedAt >= before.receivedAt, "profile endpoint timestamps regressed/overlapped");
      assert.deepEqual(record.worker, before.worker, "profile worker changed between endpoints");
      const deltas = {};
      for (const field of ["totalNs", "sampleCount", "walkCount", "collisions"]) {
        deltas[field] = record.state[field] - before.state[field];
        assert.ok(deltas[field] >= 0, `actual profile ${field} regressed/reset`);
      }
      assert.ok(deltas.sampleCount > 0 && deltas.totalNs > 0, "actual interpreted-retire profiler did not advance");
      record.deltas = deltas;
      // Top-10 membership can change and weak histogram slots can be evicted; never invent
      // zero counts for missing PCs or call these truncated cumulative lists interval profiles.
    }
    record.checksPassed = true;
    return record;
  } catch (error) {
    record.checksPassed = false;
    record.validationError = String(error?.message || error).slice(0, 240);
    throw error;
  }
}
