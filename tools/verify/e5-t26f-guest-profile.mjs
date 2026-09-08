// Diagnostic observer only: existing loader/profileStats APIs, unchanged served bytes.
import assert from "node:assert/strict";

export const GUEST_PROFILE_SCOPE = Object.freeze({
  pcAddressSpace: "guest-virtual", regionBytes: 64, topRegions: 10,
  retires: "interpreted-only; JIT retires excluded", sampling: "jittered approximately 1/1024",
  limitation: "cumulative bounded histogram; collisions/evictions and top-10 truncation; not whole-guest CPU time",
});

// Exact scalar surface of crates/wasm/src/lib.rs::jit_stats_object. Only cumulative
// counters have interval deltas: live gauges may shrink, ratios are not counters,
// and high-water marks/generation ordinals must not be called interval work.
export const GUEST_JIT_SCOPE = Object.freeze({
  counters: Object.freeze(["executedBlocks", "retiredViaJit", "directChainEntries", "directChainLinks",
    "dynamicLinkAttempts", "dynamicLinkHits", "dynamicLinkRefusals", "dynamicLinkRetargets", "dynamicLinkInstalls",
    "guestRetired", "jitEngineCalls", "chainLinksMade", "chainLinksCut", "chainDispatchEntries", "chainLinksFollowed",
    "jitSubmittedMembers", "jitCompilePauseNs", "jitCompilePauseSamples", "jitCacheInstalls", "jitCacheRetranslations",
    "jitCacheEvictions", "decodedBlocksDiscarded", "decodedCacheFlushes", "blockEntryHits", "blockBuilds"]),
  gauges: Object.freeze(["compiledBlocks", "dynamicLinkLiveEntries", "jitCacheBatches", "jitCacheCodeBytes"]),
  highWater: Object.freeze(["chainMaxDepth", "jitCompilePauseMaxNs"]),
  generations: Object.freeze(["discoveryGeneration"]),
  ratios: Object.freeze(["jitRetiredShare", "jitLogicalBlocksPerEngineCall"]),
  configuration: Object.freeze(["hasExecutor", "jitRegionChaining", "jitDynamicChaining", "jitResidencyPolicy", "jitResidencyCap"]),
  entryCostCounters: Object.freeze(["timerReads", "hostEntries", "stateCopyCalls", "stateCopyBytes", "stateCopyNs",
    "engineEntryNs", "indirectTableDispatches", "authorityChecks", "memorySplitExits", "deviceBoundaries", "deviceBoundaryNs"]),
  entryCostConfiguration: Object.freeze(["timingEnabled"]),
  limitation: "two sequential endpoint RPCs, not an atomic profile/JIT sample; no per-PC compiled membership or TLB hit/miss counters",
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

function validateJit(jit, profileReceivedAt) {
  assert.ok(Number.isFinite(jit?.requestedAt) && jit.requestedAt >= profileReceivedAt &&
    Number.isFinite(jit.receivedAt) && jit.receivedAt >= jit.requestedAt, "invalid actual jitStats timestamps");
  assert.equal(jit.available, true, "jitStats API unavailable");
  assert.equal(jit.timedOut, false, "actual jitStats RPC timed out");
  assert.equal(jit.error, null, "actual jitStats RPC failed");
  assert.equal(jit.invalidFields.length, 0, `invalid actual jitStats scalar fields: ${jit.invalidFields.join(", ")}`);
  const state = jit.state;
  assert.ok(state && state.entryCost, "actual jitStats unavailable/null");
  const integer = (value, field) => assert.ok(Number.isSafeInteger(value) && value >= 0, `invalid actual jitStats ${field}`);
  for (const field of [...GUEST_JIT_SCOPE.counters, ...GUEST_JIT_SCOPE.gauges, ...GUEST_JIT_SCOPE.highWater,
    ...GUEST_JIT_SCOPE.generations, "jitResidencyCap"]) integer(state[field], field);
  for (const field of GUEST_JIT_SCOPE.entryCostCounters) integer(state.entryCost[field], `entryCost.${field}`);
  for (const field of ["hasExecutor", "jitRegionChaining", "jitDynamicChaining"]) {
    assert.equal(typeof state[field], "boolean", `invalid actual jitStats ${field}`);
  }
  assert.equal(typeof state.entryCost.timingEnabled, "boolean", "invalid actual jitStats entryCost.timingEnabled");
  assert.ok(["disabled", "repack-off", "cap-256", "cap-1024", "custom"].includes(state.jitResidencyPolicy), "invalid actual jitStats jitResidencyPolicy");
  for (const field of GUEST_JIT_SCOPE.ratios) {
    assert.ok(Number.isFinite(state[field]) && state[field] >= 0 && state[field] <=
      (field === "jitRetiredShare" ? 1 : Number.MAX_SAFE_INTEGER), `invalid actual jitStats ${field}`);
  }
  // Relationships are the exported formulas, not performance thresholds.
  assert.equal(state.jitEngineCalls, state.executedBlocks, "actual jitStats engine-call alias disagrees");
  assert.ok(state.retiredViaJit <= state.guestRetired, "actual JIT retirement exceeds guest retirement");
  assert.equal(state.jitRetiredShare, state.guestRetired === 0 ? 0 : state.retiredViaJit / state.guestRetired,
    "actual jitStats retired-share formula disagrees");
  assert.equal(state.jitLogicalBlocksPerEngineCall, !state.hasExecutor || state.executedBlocks === 0 ? 0 :
    state.directChainEntries === 0 ? 1 : state.directChainEntries / state.executedBlocks,
  "actual jitStats logical-block formula disagrees");
}

function jitDeltas(before, after) {
  const deltas = { entryCost: {} };
  for (const field of [...GUEST_JIT_SCOPE.counters, ...GUEST_JIT_SCOPE.highWater, ...GUEST_JIT_SCOPE.generations]) {
    assert.ok(after[field] >= before[field], `actual jitStats ${field} regressed/reset`);
  }
  for (const field of GUEST_JIT_SCOPE.counters) deltas[field] = after[field] - before[field];
  for (const field of GUEST_JIT_SCOPE.entryCostCounters) {
    assert.ok(after.entryCost[field] >= before.entryCost[field], `actual jitStats entryCost.${field} regressed/reset`);
    deltas.entryCost[field] = after.entryCost[field] - before.entryCost[field];
  }
  for (const field of GUEST_JIT_SCOPE.configuration) {
    assert.equal(after[field], before[field], `actual jitStats configuration ${field} changed`);
  }
  assert.equal(after.entryCost.timingEnabled, before.entryCost.timingEnabled, "actual jitStats entryCost timing configuration changed");
  assert.ok(deltas.guestRetired > 0, "actual jitStats guest retirement did not advance");
  assert.ok(deltas.retiredViaJit <= deltas.guestRetired, "actual interval JIT retirement exceeds guest retirement");
  // Zero JIT progress is useful evidence of absent coverage, not a reason to hide the read.
  return deltas;
}

export async function recordGuestProfile(page, milestones, key) {
  assert.ok(key === "guestProfileBefore" || key === "guestProfileAfter");
  const record = { acceptance: false, scope: GUEST_PROFILE_SCOPE, requestedAt: null, receivedAt: null, state: null };
  milestones[key] = record; // Raw/failed observations survive the runner's normal failure capture.
  try {
    Object.assign(record, await page.evaluate(async fields => {
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
      const receivedAt = performance.now(); // Preserve the original profile RPC's interval/state.
      const jit = { requestedAt: performance.now(), receivedAt: null, available: typeof controller?.jitStats === "function",
        timeoutMs: 5_000, timedOut: false, state: null, error: null, invalidFields: [] };
      // Project only named own data properties before crossing Playwright's serialization
      // boundary. Never traverse extras, invoke accessors, or return deep/cyclic objects.
      const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
      const own = (value, field) => object(value) ? Object.getOwnPropertyDescriptor(value, field) : undefined;
      const copy = (value, names, prefix = "") => Object.fromEntries(names.map(field => {
        const descriptor = own(value, field), scalar = descriptor?.value;
        if (!descriptor || !("value" in descriptor) || !((typeof scalar === "number" && Number.isFinite(scalar)) ||
          typeof scalar === "boolean" || (typeof scalar === "string" && scalar.length <= 32))) {
          jit.invalidFields.push(`${prefix}${field}`);
          return [field, null];
        }
        return [field, scalar];
      }));
      try {
        if (jit.available) {
          const raw = await Promise.race([controller.jitStats(), new Promise((_, reject) => {
            timer = setTimeout(() => { jit.timedOut = true; reject(Error("bounded jitStats timeout")); }, jit.timeoutMs);
          })]);
          jit.state = copy(raw, [...fields.counters, ...fields.gauges, ...fields.highWater, ...fields.generations,
            ...fields.ratios, ...fields.configuration]);
          jit.state.entryCost = copy(own(raw, "entryCost")?.value,
            [...fields.entryCostCounters, ...fields.entryCostConfiguration], "entryCost.");
        }
      } catch (cause) { jit.error = String(cause?.message || cause).slice(0, 240); }
      finally { clearTimeout(timer); jit.receivedAt = performance.now(); }
      return { requestedAt, receivedAt, origin: globalThis.location.origin, worker, available, state, error, jit };
    }, GUEST_JIT_SCOPE));
    record.jit.scope = GUEST_JIT_SCOPE;
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
    validateJit(record.jit, record.receivedAt);
    if (key === "guestProfileAfter") {
      assert.ok(Number.isFinite(milestones.postRestoreEnd) && record.requestedAt >= milestones.postRestoreEnd,
        "after profile must follow the original frozen interaction end");
      const before = milestones.guestProfileBefore;
      assert.equal(before?.checksPassed, true, "actual before profile required");
      assert.ok(record.requestedAt >= before.receivedAt, "profile endpoint timestamps regressed/overlapped");
      assert.ok(record.requestedAt >= before.jit.receivedAt, "JIT/profile endpoint timestamps regressed/overlapped");
      assert.deepEqual(record.worker, before.worker, "profile worker changed between endpoints");
      const deltas = {};
      for (const field of ["totalNs", "sampleCount", "walkCount", "collisions"]) {
        deltas[field] = record.state[field] - before.state[field];
        assert.ok(deltas[field] >= 0, `actual profile ${field} regressed/reset`);
      }
      assert.ok(deltas.sampleCount > 0 && deltas.totalNs > 0, "actual interpreted-retire profiler did not advance");
      record.deltas = deltas;
      record.jit.deltas = jitDeltas(before.jit.state, record.jit.state);
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
