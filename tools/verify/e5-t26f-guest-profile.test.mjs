import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { guestProfileRequested, installGuestProfileWorker, recordGuestProfile, GUEST_PROFILE_SCOPE, GUEST_JIT_SCOPE } from "./e5-t26f-guest-profile.mjs";
import { residentFixtureRequested } from "./e5-t26f-resident-proof.mjs";

const env = { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_GUEST_PROFILE: "1",
  E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/guest-profile-test", E5_T26F_DIAGNOSTIC_PORT: "48123" };
const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");
const selection = source.slice(source.indexOf("function diagnosticOptions"), source.indexOf("const DIAGNOSTIC_OWNER"));
const select = input => vm.runInNewContext(`${selection}\n({diagnostic,postRestoreCommand,postRestoreKeyDelayMs})`,
  { assert, path, process: { env: input }, guestProfileRequested, residentFixtureRequested });
const json = value => JSON.parse(JSON.stringify(value));

test("exact 1 reuse-only guest profiling; every empty/type/case/cold/acceptance/mixed flag refuses", () => {
  assert.equal(guestProfileRequested({}), false);
  assert.equal(guestProfileRequested(env), true);
  for (const value of ["", "0", "true", "1 ", " 1", 1, true, null, ["1"]]) {
    assert.throws(() => guestProfileRequested({ ...env, E5_T26F_DIAGNOSTIC_GUEST_PROFILE: value }));
    assert.throws(() => select({ ...env, E5_T26F_DIAGNOSTIC_GUEST_PROFILE: value }));
  }
  for (const mode of [undefined, "", "create", "REUSE"]) assert.throws(() => guestProfileRequested({ ...env, E5_T26F_DIAGNOSTIC: mode }));
  for (const key of ["COMPLETE", "CPU", "LATENCY", "JIT", "RESIDENCY", "GUEST_CLOCK", "ICOUNT_DIVIDER", "COMMAND", "KEY_DELAY_MS"]) {
    for (const value of ["", "0", "1", "5"]) {
      assert.throws(() => select({ ...env, [`E5_T26F_DIAGNOSTIC_${key}`]: value }));
      assert.throws(() => residentFixtureRequested({ ...env, E5_T26F_FIXTURE: "resident-aplay-v1", [`E5_T26F_DIAGNOSTIC_${key}`]: value }));
    }
  }
});

test("omission keeps default metadata/command; resident diagnostic remains physically typed play at 5 ms", () => {
  assert.equal(select({}).diagnostic, null);
  const ordinary = select({ ...env, E5_T26F_DIAGNOSTIC_GUEST_PROFILE: undefined });
  assert.equal(Object.hasOwn(ordinary.diagnostic, "guestProfile"), false);
  assert.equal(ordinary.postRestoreCommand, "sh /tmp/a");
  assert.equal(ordinary.postRestoreKeyDelayMs, 0);
  const resident = select({ ...env, E5_T26F_FIXTURE: "resident-aplay-v1" });
  assert.equal(resident.diagnostic.guestProfile, true);
  assert.equal(resident.postRestoreCommand, "play");
  assert.equal(resident.postRestoreKeyDelayMs, 5);
  assert.match(GUEST_PROFILE_SCOPE.retires, /interpreted-only; JIT retires excluded/);
  assert.equal(GUEST_PROFILE_SCOPE.pcAddressSpace, "guest-virtual");
});

function realm() {
  const calls = [], timers = new Map();
  let now = 1200, nextTimer = 0;
  class NativeWorker {
    static sentinel = { unchanged: true };
    constructor(...args) { calls.push({ args, newTarget: new.target }); this.args = args; }
    postMessage() { return "native"; }
  }
  const context = vm.createContext({ URL, Worker: NativeWorker,
    location: new URL("http://fixture.test:48123/desktop-cursor.html?autoRestore=1"),
    performance: { now: () => now },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id) });
  const install = () => vm.runInContext(`(${installGuestProfileWorker.toString()})()`, context);
  install();
  return { context, NativeWorker, calls, timers, install, advance: ms => { now += ms; },
    page: { evaluate: (callback, argument) => vm.runInContext(`(${callback.toString()})`, context)(argument) } };
}

test("Worker wrapper preserves prototype, statics, subclasses, options identity, and native no-new refusal", () => {
  const r = realm(), Wrapped = r.context.Worker, options = { type: "module", credentials: "same-origin", name: "linux" };
  assert.equal(Wrapped.prototype, r.NativeWorker.prototype);
  assert.equal(Object.getPrototypeOf(Wrapped), Object.getPrototypeOf(r.NativeWorker));
  assert.equal(Wrapped.sentinel, r.NativeWorker.sentinel);
  const worker = new Wrapped("/linux-worker.js?keep=1&profile=0#hash", options);
  assert.equal(r.calls[0].args[0], "http://fixture.test:48123/linux-worker.js?keep=1&profile=1#hash");
  assert.equal(r.calls[0].args[1], options);
  assert.ok(worker instanceof Wrapped && worker instanceof r.NativeWorker);
  assert.equal(worker.postMessage(), "native");
  class Child extends Wrapped {}
  assert.ok(new Child("/linux-worker.js") instanceof Child);
  assert.equal(r.calls[1].newTarget, Child);
  assert.throws(() => Wrapped("/linux-worker.js"), /without 'new'/);
  assert.equal(r.calls.length, 2, "no-new must not silently construct");
  r.install();
  assert.equal(r.context.Worker, Wrapped, "install must not wrap twice");
  assert.equal(r.context.__e5t26fGuestProfileWorker.snapshot().requests.length, 2);
});

test("only the same-origin exact worker path is selected; other constructors preserve original arguments", () => {
  const r = realm(), options = { name: "unchanged" };
  const values = ["https://elsewhere.test/linux-worker.js", "http://fixture.test:48124/linux-worker.js",
    "/nested/linux-worker.js", "/linux-worker.js.other", "/linux-worker.js/", "/other.js?profile=1",
    "blob:http://fixture.test:48123/id", "data:text/javascript,0", { toString: () => "/other.js" }];
  for (const value of values) {
    new r.context.Worker(value, options, "extra");
    assert.equal(r.calls.at(-1).args[0], value);
    assert.equal(r.calls.at(-1).args[1], options);
    assert.equal(r.calls.at(-1).args[2], "extra");
  }
  new r.context.Worker(new URL("http://fixture.test:48123/linux-worker.js?x=1&x=2"), options);
  assert.equal(r.calls.at(-1).args[0], "http://fixture.test:48123/linux-worker.js?x=1&x=2&profile=1");
  const report = r.context.__e5t26fGuestProfileWorker.snapshot();
  assert.equal(report.requests.length, 1);
  report.requests[0].requestedUrl = "tampered copy";
  assert.notEqual(r.context.__e5t26fGuestProfileWorker.snapshot().requests[0].requestedUrl, "tampered copy");
  r.context.Worker = r.NativeWorker;
  assert.throws(r.install, /replaced/);
});

const profile = () => ({ totalNs: 1000, sampleCount: 100, walkCount: 3, collisions: 2,
  regions: [{ pc: "0xffffffff80200000", samples: 20, pct: 20 }], subsystems: [{ name: "mmu_walk", ns: 10 }],
  jitPause: { count: 2 } });
// Independent complete API fixture; the source-surface test below detects newly exported
// fields that would otherwise be silently omitted by both collector and fixture.
const jitStats = (step = 0) => ({
  hasExecutor: true, compiledBlocks: 32, executedBlocks: 10 + step, retiredViaJit: 400 + 60 * step,
  directChainEntries: 20 + step, directChainLinks: 10 + step,
  dynamicLinkAttempts: 10 + step, dynamicLinkHits: 10 + step, dynamicLinkRefusals: 10 + step,
  dynamicLinkRetargets: 10 + step, dynamicLinkLiveEntries: 4, dynamicLinkInstalls: 10 + step,
  entryCost: { timingEnabled: false, timerReads: 0, hostEntries: 10 + step, stateCopyCalls: 10 + step,
    stateCopyBytes: 2560 + 256 * step, stateCopyNs: 0, engineEntryNs: 0, indirectTableDispatches: 10 + step,
    authorityChecks: 10 + step, memorySplitExits: 10 + step, deviceBoundaries: 10 + step, deviceBoundaryNs: 0 },
  jitRegionChaining: true, jitDynamicChaining: false, guestRetired: 1000 + 100 * step,
  jitEngineCalls: 10 + step, jitLogicalBlocksPerEngineCall: (20 + step) / (10 + step),
  jitRetiredShare: (400 + 60 * step) / (1000 + 100 * step), chainLinksMade: 10 + step, chainLinksCut: 10 + step,
  chainDispatchEntries: 10 + step, chainMaxDepth: 8, chainLinksFollowed: 10 + step,
  jitResidencyPolicy: "repack-off", jitResidencyCap: 24, jitSubmittedMembers: 10 + step,
  jitCompilePauseNs: 1000 + 100 * step, jitCompilePauseMaxNs: 200, jitCompilePauseSamples: 10 + step,
  jitCacheInstalls: 10 + step, jitCacheRetranslations: 10 + step, jitCacheEvictions: 10 + step,
  jitCacheBatches: 24, jitCacheCodeBytes: 32000, decodedBlocksDiscarded: 10 + step, decodedCacheFlushes: 10 + step,
  discoveryGeneration: 3, blockEntryHits: 10 + step, blockBuilds: 10 + step,
});
function endpointFixture() {
  const r = realm();
  new r.context.Worker("/linux-worker.js", { type: "module" });
  r.state = profile();
  r.jitCalls = 0;
  r.context.__desktopController = { profileStats: async () => { r.advance(25); return r.state; },
    jitStats: async () => { const step = r.jitCalls++; return Object.hasOwn(r, "jitState") ? r.jitState : jitStats(step); } };
  r.milestones = { postRestoreStart: 1000 };
  return r;
}

test("actual reads retain cumulative regions/timestamps and positive deltas without resetting original T0/end", async () => {
  const r = endpointFixture();
  await recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
  assert.equal(r.milestones.guestProfileBefore.requestedAt, 1200);
  assert.equal(r.milestones.guestProfileBefore.receivedAt, 1225);
  assert.equal(r.milestones.guestProfileBefore.acceptance, false);
  assert.deepEqual(r.milestones.guestProfileBefore.state, profile());
  assert.equal(r.timers.size, 0);
  r.advance(2000); r.milestones.postRestoreEnd = 3225;
  r.state = { ...profile(), totalNs: 2000, sampleCount: 150,
    regions: [{ pc: "0xffffffff80200100", samples: 25, pct: 100 / 6 }] };
  await recordGuestProfile(r.page, r.milestones, "guestProfileAfter");
  assert.deepEqual(r.milestones.guestProfileAfter.deltas, { totalNs: 1000, sampleCount: 50, walkCount: 0, collisions: 0 });
  assert.equal(r.milestones.postRestoreStart, 1000);
  assert.equal(r.milestones.postRestoreEnd, 3225);
  assert.equal(r.milestones.guestProfileAfter.state.regions[0].pc, "0xffffffff80200100", "changed top-10 membership is not fabricated as zero");
  assert.equal(r.timers.size, 0);
});

test("null, missing, zero-after-restore and malformed actual profiles fail with raw state retained", async () => {
  for (const state of [null, { ...profile(), sampleCount: 0 }, { ...profile(), totalNs: NaN },
    { ...profile(), walkCount: -1 }, { ...profile(), collisions: 0.5 }, { ...profile(), totalNs: Number.MAX_SAFE_INTEGER + 1 },
    { ...profile(), regions: [] }, { ...profile(), regions: Array(11).fill(profile().regions[0]) },
    { ...profile(), regions: [{ pc: "0xffffffff80200001", samples: 1, pct: 1 }] }]) {
    const r = endpointFixture(); r.state = state;
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileBefore"));
    assert.equal(r.milestones.guestProfileBefore.state, state);
    assert.equal(r.milestones.guestProfileBefore.checksPassed, false);
    assert.equal(r.timers.size, 0);
  }
  const r = endpointFixture(); delete r.context.__desktopController.profileStats;
  await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileBefore"), /unavailable/);
  assert.equal(r.milestones.guestProfileBefore.available, false);
  assert.equal(r.milestones.guestProfileBefore.state, null);
});

test("counter resets/no progress and wrong endpoint clocks refuse without discarding previous evidence", async () => {
  for (const field of ["sampleCount", "totalNs", "walkCount", "collisions", "no-progress", "clock"]) {
    const r = endpointFixture();
    await recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
    r.state = { ...profile(), sampleCount: 200, totalNs: 2000 };
    if (field === "no-progress") r.state.sampleCount = 100;
    else if (field !== "clock") r.state[field] = profile()[field] - 1;
    r.milestones.postRestoreEnd = field === "clock" ? 9999 : 1225;
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileAfter"));
    assert.equal(r.milestones.guestProfileBefore.checksPassed, true);
    assert.equal(r.milestones.guestProfileAfter.checksPassed, false);
    assert.equal(r.milestones.guestProfileAfter.state, r.state);
  }
});

test("RPC errors and bounded timeout clean timers, retain failure, and ignore late completion", async () => {
  const r = endpointFixture();
  r.context.__desktopController.profileStats = async () => { throw Error("unavailable after restore"); };
  await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileBefore"), /RPC failed/);
  assert.match(r.milestones.guestProfileBefore.error, /unavailable after restore/);
  assert.equal(r.timers.size, 0);
  let resolve;
  r.context.__desktopController.profileStats = () => new Promise(done => { resolve = done; });
  const pending = recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
  const timer = [...r.timers.values()][0]; assert.equal(timer.ms, 5000);
  r.advance(5000); timer.fn();
  await assert.rejects(pending, /RPC failed/);
  const saved = json(r.milestones.guestProfileBefore);
  assert.equal(r.timers.size, 0);
  resolve(profile()); await Promise.resolve();
  assert.deepEqual(json(r.milestones.guestProfileBefore), saved);
});

test("worker replacement/duplicate workers and forged origin are refused with actual observations retained", async () => {
  for (const scenario of ["replaced", "duplicate", "origin"]) {
    const r = endpointFixture();
    if (scenario === "replaced") r.context.Worker = r.NativeWorker;
    if (scenario === "duplicate") new r.context.Worker("/linux-worker.js");
    if (scenario === "origin") {
      const evaluate = r.page.evaluate;
      r.page.evaluate = async (callback, argument) => ({ ...await evaluate(callback, argument), origin: "https://wrong-origin.test" });
    }
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileBefore"));
    assert.equal(r.milestones.guestProfileBefore.checksPassed, false);
    assert.deepEqual(r.milestones.guestProfileBefore.state, profile());
  }
  const r = realm();
  for (let i = 0; i < 4; i++) new r.context.Worker("/linux-worker.js");
  assert.throws(() => new r.context.Worker("/linux-worker.js"), /bounded/);
  assert.equal(r.calls.length, 4);
});

test("runner guards both RPCs and init script, preserves input/PCM/end/cap ordering and unchanged default query", () => {
  const wrapper = source.indexOf("if (diagnostic?.guestProfile) await page.addInitScript(installGuestProfileWorker);");
  assert.ok(wrapper > source.indexOf("page = await context.newPage();") && wrapper < source.indexOf("if (diagnosticCheckpoint) await installCheckpointSession"));
  const t0 = source.indexOf("milestones.postRestoreStart = postRestoreStart;");
  const before = source.indexOf('if (diagnostic?.guestProfile) await recordGuestProfile(page, milestones, "guestProfileBefore");');
  const typing = source.indexOf("const postAudioCommand = await typeCommand(");
  const pcm = source.indexOf("const postPcmAtCompletion =");
  const end = source.indexOf("milestones.postRestoreEnd = postRestoreEnd;");
  const after = source.indexOf('if (diagnostic?.guestProfile) await recordGuestProfile(page, milestones, "guestProfileAfter");');
  const cap = source.indexOf('assert.ok(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds");');
  assert.ok(t0 < before && before < typing && typing < pcm && pcm < end && end < after && after < cap);
  assert.match(source.slice(before, typing), /await page\.waitForTimeout\(350\)/);
  assert.doesNotMatch(source.slice(source.indexOf("const query = new URLSearchParams"), source.indexOf("const coldUrl =")), /profile/i);
  assert.equal(source.match(/milestones.postRestoreStart = postRestoreStart;/g).length, 1);
});

const jitTopFields = [...GUEST_JIT_SCOPE.counters, ...GUEST_JIT_SCOPE.gauges, ...GUEST_JIT_SCOPE.highWater,
  ...GUEST_JIT_SCOPE.generations, ...GUEST_JIT_SCOPE.ratios, ...GUEST_JIT_SCOPE.configuration];
const jitEntryFields = [...GUEST_JIT_SCOPE.entryCostCounters, ...GUEST_JIT_SCOPE.entryCostConfiguration];
const jitIntegerFields = [...GUEST_JIT_SCOPE.counters, ...GUEST_JIT_SCOPE.gauges, ...GUEST_JIT_SCOPE.highWater,
  ...GUEST_JIT_SCOPE.generations, "jitResidencyCap"];
const allJitFields = [...jitTopFields, ...jitEntryFields.map(field => `entryCost.${field}`)];
function fieldTarget(state, field) {
  return field.startsWith("entryCost.") ? [state.entryCost, field.slice(10)] : [state, field];
}
function changeField(state, field, value) {
  const [object, name] = fieldTarget(state, field); object[name] = value;
}
function nextEndpoint(r) {
  r.advance(100);
  r.milestones.postRestoreEnd = r.milestones.guestProfileBefore.jit.receivedAt + 100;
  r.state = { ...profile(), totalNs: 2000, sampleCount: 150 };
  r.jitState = jitStats(1);
}
function exportedRatios(state) {
  state.jitEngineCalls = state.executedBlocks;
  state.jitRetiredShare = state.guestRetired === 0 ? 0 : state.retiredViaJit / state.guestRetired;
  state.jitLogicalBlocksPerEngineCall = !state.hasExecutor || state.executedBlocks === 0 ? 0 :
    state.directChainEntries === 0 ? 1 : state.directChainEntries / state.executedBlocks;
}

test("bounded JIT schema covers every actual exported scalar exactly once, including entryCost", () => {
  const rust = readFileSync(new URL("../../crates/wasm/src/lib.rs", import.meta.url), "utf8");
  const block = rust.slice(rust.indexOf("fn jit_stats_object("), rust.indexOf("\n}\n", rust.indexOf("fn jit_stats_object(")));
  const actual = [...new Set([...block.matchAll(/\bset\(\s*"([^"]+)"/g)].map(match => match[1]))].sort();
  const actualEntry = [...block.matchAll(/\bset_entry_cost\(\s*"([^"]+)"/g)].map(match => match[1]);
  assert.match(block, /JsValue::from_str\("timingEnabled"\)/);
  assert.deepEqual([...jitTopFields, "entryCost"].sort(), actual);
  assert.deepEqual([...jitEntryFields].sort(), [...actualEntry, "timingEnabled"].sort());
  assert.equal(new Set(jitTopFields).size, jitTopFields.length);
  assert.equal(new Set(jitEntryFields).size, jitEntryFields.length);
  assert.deepEqual(Object.keys(jitStats()).sort(), actual);
  assert.deepEqual(Object.keys(jitStats().entryCost).sort(), [...jitEntryFields].sort());
});

test("two actual JIT calls retain full copied scalars and nested deltas, without moving profile/T0/end", async () => {
  const r = endpointFixture(), calls = [];
  r.jitState = jitStats();
  r.context.__desktopController.profileStats = async () => { calls.push("profile"); r.advance(25); return r.state; };
  r.context.__desktopController.jitStats = async () => { calls.push("jit"); r.advance(7); return r.jitState; };
  await recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
  const before = r.milestones.guestProfileBefore;
  assert.equal(before.state, r.state, "profile result is returned unchanged");
  assert.deepEqual(json(before.jit.state), jitStats());
  assert.deepEqual([before.requestedAt, before.receivedAt, before.jit.requestedAt, before.jit.receivedAt], [1200, 1225, 1225, 1232]);
  assert.equal(before.jit.timeoutMs, 5000); assert.equal(before.jit.timedOut, false);
  assert.equal(before.jit.scope, GUEST_JIT_SCOPE);
  r.jitState.entryCost.stateCopyBytes = 99; r.jitState.compiledBlocks = 1;
  assert.equal(before.jit.state.entryCost.stateCopyBytes, 2560, "retained read cannot follow subsequent mutation");
  nextEndpoint(r);
  for (const field of GUEST_JIT_SCOPE.gauges) r.jitState[field] = 0; // Eviction is not counter reset.
  await recordGuestProfile(r.page, r.milestones, "guestProfileAfter");
  const after = r.milestones.guestProfileAfter;
  assert.deepEqual(calls, ["profile", "jit", "profile", "jit"], "no intermediate JIT samples");
  assert.deepEqual([after.requestedAt, after.receivedAt, after.jit.requestedAt, after.jit.receivedAt], [1332, 1357, 1357, 1364]);
  assert.equal(r.milestones.postRestoreStart, 1000); assert.equal(r.milestones.postRestoreEnd, 1332);
  for (const field of GUEST_JIT_SCOPE.counters) assert.equal(after.jit.deltas[field], jitStats(1)[field] - jitStats()[field]);
  for (const field of GUEST_JIT_SCOPE.entryCostCounters) {
    assert.equal(after.jit.deltas.entryCost[field], jitStats(1).entryCost[field] - jitStats().entryCost[field]);
  }
  assert.deepEqual(Object.keys(after.jit.deltas).sort(), [...GUEST_JIT_SCOPE.counters, "entryCost"].sort());
  assert.deepEqual(Object.keys(after.jit.deltas.entryCost).sort(), [...GUEST_JIT_SCOPE.entryCostCounters].sort());
  assert.equal(after.jit.deltas.guestRetired, 100); assert.equal(after.jit.deltas.retiredViaJit, 60);
  assert.equal(r.timers.size, 0);
});

test("every JIT field is required; every integer field rejects negative, fractional, unsafe and non-numeric values", async () => {
  for (const field of allJitFields) {
    const r = endpointFixture(); r.jitState = jitStats();
    const [object, name] = fieldTarget(r.jitState, field); delete object[name];
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileBefore"), /invalid actual jitStats/);
    assert.ok(r.milestones.guestProfileBefore.jit.invalidFields.includes(field));
    assert.equal(r.milestones.guestProfileBefore.state, r.state);
    assert.equal(r.milestones.guestProfileBefore.checksPassed, false);
  }
  for (const field of [...jitIntegerFields, ...GUEST_JIT_SCOPE.entryCostCounters.map(name => `entryCost.${name}`)]) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", true, null, {}, [], 1n]) {
      const r = endpointFixture(); r.jitState = jitStats(); changeField(r.jitState, field, value);
      await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileBefore"), /invalid actual jitStats/);
      assert.equal(r.milestones.guestProfileBefore.checksPassed, false);
      assert.equal(r.timers.size, 0);
      assert.doesNotThrow(() => JSON.stringify(r.milestones), "unsafe values must not leak through browser serialization");
    }
  }
});

test("JIT booleans, policy labels, ratios and exported relationships validate strictly", async () => {
  const cases = [];
  for (const field of ["hasExecutor", "jitRegionChaining", "jitDynamicChaining", "entryCost.timingEnabled"]) {
    for (const value of [0, 1, "true", null]) cases.push([field, value]);
  }
  for (const value of ["", "CAP-256", "cap-512", "cap-256 ", "x".repeat(33), 24, null]) cases.push(["jitResidencyPolicy", value]);
  for (const field of GUEST_JIT_SCOPE.ratios) {
    for (const value of [-0.1, Infinity, NaN, "0", Number.MAX_SAFE_INTEGER + 1]) cases.push([field, value]);
  }
  cases.push(["jitRetiredShare", 1.01], ["jitRetiredShare", 0.1], ["jitLogicalBlocksPerEngineCall", 1.1], ["jitEngineCalls", 11], ["retiredViaJit", 1001]);
  for (const [field, value] of cases) {
    const r = endpointFixture(); r.jitState = jitStats(); changeField(r.jitState, field, value);
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileBefore"));
    assert.equal(r.milestones.guestProfileBefore.checksPassed, false);
  }
  for (const [policy, cap] of [["disabled", 0], ["repack-off", 24], ["cap-256", 256], ["cap-1024", 1024], ["custom", 32]]) {
    const r = endpointFixture(); r.jitState = { ...jitStats(), jitResidencyPolicy: policy, jitResidencyCap: cap };
    await recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
    assert.equal(r.milestones.guestProfileBefore.jit.state.jitResidencyPolicy, policy);
  }
});

test("unknown deep/cyclic extras are not visited; known object/accessor/prototype substitutes refuse safely", async () => {
  const r = endpointFixture(); r.jitState = jitStats();
  const cyclic = {}; cyclic.self = cyclic;
  r.jitState.extra = cyclic; r.jitState.entryCost.extra = cyclic;
  Object.defineProperty(r.jitState, "ignoredGetter", { get() { throw Error("must not visit extras"); } });
  await recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
  assert.deepEqual(json(r.milestones.guestProfileBefore.jit.state), jitStats());
  assert.ok(JSON.stringify(r.milestones).length < 15000, "fixed-size projection stays bounded");
  for (const field of ["guestRetired", "entryCost.stateCopyBytes", "entryCost"]) {
    const f = endpointFixture(); f.jitState = jitStats();
    const [object, name] = fieldTarget(f.jitState, field);
    Object.defineProperty(object, name, { get() { assert.fail("known getters must not run"); } });
    await assert.rejects(recordGuestProfile(f.page, f.milestones, "guestProfileBefore"), /invalid actual jitStats/);
  }
  for (const raw of [null, [], cyclic, Object.create(jitStats()), { ...jitStats(), entryCost: cyclic }]) {
    const f = endpointFixture(); f.jitState = raw;
    await assert.rejects(recordGuestProfile(f.page, f.milestones, "guestProfileBefore"), /invalid actual jitStats/);
    assert.doesNotThrow(() => JSON.stringify(f.milestones));
  }
});

test("every cumulative JIT and entryCost counter detects reset; high-water/generation regression also refuses", async () => {
  const fields = [...GUEST_JIT_SCOPE.counters, ...GUEST_JIT_SCOPE.highWater, ...GUEST_JIT_SCOPE.generations,
    ...GUEST_JIT_SCOPE.entryCostCounters.map(field => `entryCost.${field}`)];
  for (const field of fields) {
    const r = endpointFixture(); r.jitState = jitStats();
    if (field.startsWith("entryCost.")) changeField(r.jitState, field, 10);
    await recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
    const before = r.milestones.guestProfileBefore.jit.state;
    nextEndpoint(r);
    const [object, name] = fieldTarget(before, field);
    changeField(r.jitState, field, object[name] - 1);
    // Keep exported formulas valid so refusal really exercises interval reset detection.
    if (field === "jitEngineCalls") r.jitState.executedBlocks = r.jitState.jitEngineCalls;
    if (field === "guestRetired") r.jitState.retiredViaJit = before.retiredViaJit;
    exportedRatios(r.jitState);
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileAfter"), /regressed\/reset/);
    assert.equal(r.milestones.guestProfileBefore.checksPassed, true);
    assert.equal(r.milestones.guestProfileAfter.checksPassed, false);
    assert.deepEqual(json(r.milestones.guestProfileAfter.jit.state), r.jitState);
  }
});

test("JIT interval requires guest progress and stable configuration, but zero JIT progress remains observable", async () => {
  for (const field of ["no-progress", ...GUEST_JIT_SCOPE.configuration, "entryCost.timingEnabled", "interval-overcount"]) {
    const r = endpointFixture(); await recordGuestProfile(r.page, r.milestones, "guestProfileBefore"); nextEndpoint(r);
    if (field === "no-progress") r.jitState = jitStats();
    else if (field === "interval-overcount") r.jitState.retiredViaJit = 501;
    else {
      const [object, name] = fieldTarget(r.jitState, field);
      object[name] = typeof object[name] === "boolean" ? !object[name] : field === "jitResidencyPolicy" ? "custom" : 32;
    }
    exportedRatios(r.jitState);
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileAfter"), /did not advance|configuration|interval JIT retirement/);
  }
  const r = endpointFixture(); await recordGuestProfile(r.page, r.milestones, "guestProfileBefore"); nextEndpoint(r);
  r.jitState = { ...jitStats(), guestRetired: 1100 }; exportedRatios(r.jitState);
  await recordGuestProfile(r.page, r.milestones, "guestProfileAfter");
  assert.equal(r.milestones.guestProfileAfter.jit.deltas.retiredViaJit, 0);
  assert.equal(r.milestones.guestProfileAfter.jit.deltas.executedBlocks, 0);
  assert.equal(r.milestones.guestProfileAfter.jit.deltas.guestRetired, 100);
});

test("JIT missing API, RPC error and bounded timeout retain profile and timestamped failure; late result is ignored", async () => {
  for (const scenario of ["missing", "throw", "timeout"]) {
    const r = endpointFixture(); let resolve;
    if (scenario === "missing") delete r.context.__desktopController.jitStats;
    if (scenario === "throw") r.context.__desktopController.jitStats = () => { throw Error("x".repeat(1000)); };
    if (scenario === "timeout") r.context.__desktopController.jitStats = () => new Promise(done => { resolve = done; });
    const pending = recordGuestProfile(r.page, r.milestones, "guestProfileBefore");
    if (scenario === "timeout") {
      for (let n = 0; n < 12 && !resolve; n++) await Promise.resolve();
      assert.equal(typeof resolve, "function");
      const timer = [...r.timers.values()][0]; assert.equal(r.timers.size, 1); assert.equal(timer.ms, 5000);
      r.advance(5000); timer.fn();
    }
    await assert.rejects(pending, /jitStats/);
    const before = r.milestones.guestProfileBefore, saved = json(before);
    assert.equal(before.state, r.state); assert.equal(before.error, null); assert.equal(before.receivedAt, 1225);
    assert.equal(before.checksPassed, false); assert.equal(before.jit.requestedAt, 1225);
    assert.equal(before.jit.receivedAt, scenario === "timeout" ? 6225 : 1225);
    assert.equal(before.jit.available, scenario !== "missing");
    assert.equal(before.jit.timedOut, scenario === "timeout");
    assert.equal(before.jit.state, null); assert.equal(r.timers.size, 0);
    if (scenario === "throw") assert.equal(before.jit.error.length, 240);
    if (resolve) { resolve(jitStats()); await Promise.resolve(); assert.deepEqual(json(before), saved); }
  }
});

test("JIT request/receive regression and overlap refuse without replacing original endpoint boundaries", async () => {
  for (const scenario of ["request", "receive", "overlap"]) {
    const r = endpointFixture();
    await recordGuestProfile(r.page, r.milestones, "guestProfileBefore"); nextEndpoint(r);
    const evaluate = r.page.evaluate;
    r.page.evaluate = async (callback, argument) => {
      const result = await evaluate(callback, argument);
      if (scenario === "request") result.jit.requestedAt = result.receivedAt - 1;
      if (scenario === "receive") result.jit.receivedAt = result.jit.requestedAt - 1;
      if (scenario === "overlap") r.milestones.guestProfileBefore.jit.receivedAt = result.requestedAt + 1;
      return result;
    };
    const end = r.milestones.postRestoreEnd;
    await assert.rejects(recordGuestProfile(r.page, r.milestones, "guestProfileAfter"), /timestamps/);
    assert.equal(r.milestones.postRestoreStart, 1000); assert.equal(r.milestones.postRestoreEnd, end);
    assert.equal(r.milestones.guestProfileAfter.checksPassed, false);
  }
});
