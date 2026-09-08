import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { guestProfileRequested, installGuestProfileWorker, recordGuestProfile, GUEST_PROFILE_SCOPE } from "./e5-t26f-guest-profile.mjs";
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
    page: { evaluate: callback => vm.runInContext(`(${callback.toString()})()`, context) } };
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
function endpointFixture() {
  const r = realm();
  new r.context.Worker("/linux-worker.js", { type: "module" });
  r.state = profile();
  r.context.__desktopController = { profileStats: async () => { r.advance(25); return r.state; } };
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
      r.page.evaluate = async callback => ({ ...await evaluate(callback), origin: "https://wrong-origin.test" });
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
