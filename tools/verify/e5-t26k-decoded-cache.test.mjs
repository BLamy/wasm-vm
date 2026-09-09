import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { decodedCacheRequested, DECODED_COUNTERS, validateDecodedCacheSample,
  decodedCacheDeltas, recordDecodedCache, collectDecodedCacheRecord } from "./e5-t26k-decoded-cache.mjs";
import { residentFixtureRequested } from "./e5-t26f-resident-proof.mjs";
import { guestProfileRequested } from "./e5-t26f-guest-profile.mjs";

const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a); assert.ok(a >= 0 && b > a);
  return text.slice(a, b);
}
const baseEnv = { E5_T26F_FIXTURE: "resident-aplay-v1", E5_T26F_DIAGNOSTIC: "reuse",
  E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/unit-capacity", E5_T26F_DIAGNOSTIC_PORT: "61632" };
function select(env, runner = source) {
  return vm.runInNewContext(between(runner, "function diagnosticOptions", "const DIAGNOSTIC_OWNER") +
    "\n({diagnostic,residentFixture,postRestoreCommand,postRestoreKeyDelayMs})",
  { assert, path, process: { env }, decodedCacheRequested, residentFixtureRequested, guestProfileRequested });
}

test("exact resident reuse capacity selection reaches actual runner query with unchanged play/5ms", () => {
  assert.equal(decodedCacheRequested({}), undefined);
  for (const entries of [4096, 16384]) {
    const env = Object.freeze({ ...baseEnv, E5_T26F_DIAGNOSTIC_DECODED_CACHE_ENTRIES: String(entries) });
    assert.equal(decodedCacheRequested(env), entries); assert.equal(residentFixtureRequested(env), true);
    const chosen = select(env); assert.equal(chosen.diagnostic.decodedCacheEntries, entries);
    assert.equal(chosen.postRestoreCommand, "play"); assert.equal(chosen.postRestoreKeyDelayMs, 5);
    const urls = vm.runInNewContext(between(source, "  const query = new URLSearchParams({", "  let normalSnapshot =") +
      "\n({coldUrl,restoreUrl})", { URLSearchParams, diagnostic: chosen.diagnostic,
      base: "http://127.0.0.1:61632", imageSha256: "a".repeat(64), manifestSha256: "b".repeat(64) });
    for (const value of Object.values(urls)) {
      const q = new URL(value).searchParams;
      assert.equal(q.get("decodedCacheEntries"), String(entries)); assert.equal(q.get("jit"), "1");
      for (const key of ["jitResidency", "guestClock", "icountDivider"]) assert.equal(q.has(key), false);
    }
  }
  for (const mode of [undefined, "create", "reuse"]) {
    const chosen = select({ ...baseEnv, E5_T26F_DIAGNOSTIC: mode,
      ...(mode === undefined ? { E5_T26F_DIAGNOSTIC_PROFILE: undefined, E5_T26F_DIAGNOSTIC_PORT: undefined } : {}) });
    assert.equal(chosen.diagnostic?.decodedCacheEntries, undefined); assert.equal(chosen.postRestoreKeyDelayMs, 5);
  }
});

test("capacity comparison rejects malformed inputs, nonresident/cold/COMPLETE and every other tuning flag", () => {
  for (const value of ["", "04096", "4096 ", "4e3", "8192", "16384\n", 4096, null, false, ["4096"]]) {
    assert.throws(() => decodedCacheRequested({ ...baseEnv, E5_T26F_DIAGNOSTIC_DECODED_CACHE_ENTRIES: value }));
  }
  const env = { ...baseEnv, E5_T26F_DIAGNOSTIC_DECODED_CACHE_ENTRIES: "4096" };
  for (const mode of [undefined, "", "create"]) assert.throws(() => select({ ...env, E5_T26F_DIAGNOSTIC: mode }));
  assert.throws(() => select({ ...env, E5_T26F_FIXTURE: undefined }));
  for (const key of ["COMPLETE", "CPU", "LATENCY", "GUEST_PROFILE", "GUEST_CLOCK", "ICOUNT_DIVIDER", "COMMAND", "KEY_DELAY_MS", "JIT", "RESIDENCY"]) {
    for (const value of ["", "1", "repack-off", null]) {
      assert.throws(() => select({ ...env, [`E5_T26F_DIAGNOSTIC_${key}`]: value }));
      assert.throws(() => residentFixtureRequested({ ...env, [`E5_T26F_DIAGNOSTIC_${key}`]: value }));
    }
  }
  const quiet = readFileSync(new URL("./e5-t26f-quiet-text-probe.mjs", import.meta.url), "utf8");
  assert.throws(() => select(env, quiet), error => error.code === "ERR_ASSERTION");
});

function endpoint(entries, n = 0) {
  return { requestedAt: n ? 4001 : 1100, receivedAt: n ? 4030 : 1120,
    jit: { decodedCacheEntries: entries, hasExecutor: true, jitResidencyPolicy: "repack-off", jitResidencyCap: 24,
      jitRegionChaining: true, jitDynamicChaining: true, entryCost: { timingEnabled: false },
      ...Object.fromEntries(DECODED_COUNTERS.map(key => [key, 100 + n])) },
    clock: { mode: "icount", clockDiv: 10, timebaseHz: 10_000_000, mtime: String(123456 + n) } };
}

test("actual capacity, JIT and clock are mandatory; endpoint deltas are monotone and correctly bounded", () => {
  const before = endpoint(4096), after = endpoint(4096, 20);
  assert.deepEqual(decodedCacheDeltas(before, after, 4096, 1000, 4000), Object.fromEntries(DECODED_COUNTERS.map(k => [k, 20])));
  for (const [key, value] of [["decodedCacheEntries", 16384], ["hasExecutor", false], ["jitResidencyPolicy", "cap-256"],
    ["jitResidencyCap", 256], ["jitRegionChaining", false], ["jitDynamicChaining", false]]) {
    const bad = structuredClone(before); bad.jit[key] = value; assert.throws(() => validateDecodedCacheSample(bad, 4096));
  }
  for (const key of DECODED_COUNTERS) for (const value of [undefined, "1", -1, .5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(before); bad.jit[key] = value; assert.throws(() => validateDecodedCacheSample(bad, 4096));
  }
  for (const [key, value] of [["mode", "wall"], ["clockDiv", 1], ["mtime", "18446744073709551616"], ["mtime", "-1"], ["mtime", "01"]]) {
    const bad = structuredClone(before); bad.clock[key] = value; assert.throws(() => validateDecodedCacheSample(bad, 4096));
  }
  const timed = structuredClone(before); timed.jit.entryCost.timingEnabled = true; assert.throws(() => validateDecodedCacheSample(timed, 4096));
  for (const key of DECODED_COUNTERS) {
    const bad = structuredClone(after); bad.jit[key] = 99; assert.throws(() => decodedCacheDeltas(before, bad, 4096, 1000, 4000));
  }
  for (const key of ["guestRetired", "retiredViaJit"]) {
    const bad = structuredClone(after); bad.jit[key] = before.jit[key]; assert.throws(() => decodedCacheDeltas(before, bad, 4096, 1000, 4000));
  }
  for (const badEnd of [5000, Infinity, 999]) assert.throws(() => decodedCacheDeltas(before, after, 4096, 1000, badEnd));
});

test("read-only observer preserves a received raw failure and charges the real interval unchanged", async () => {
  const milestones = { postRestoreStart: 1000, postRestoreEnd: 4000 };
  const page = { evaluate: async () => endpoint(4096) };
  await recordDecodedCache(page, milestones, "decodedCacheBefore", 4096);
  page.evaluate = async () => endpoint(4096, 20);
  await recordDecodedCache(page, milestones, "decodedCacheAfter", 4096);
  assert.equal(milestones.decodedCacheDeltas.blockBuilds, 20);
  page.evaluate = async () => endpoint(16384, 20);
  await assert.rejects(recordDecodedCache(page, milestones, "decodedCacheAfter", 4096));
  assert.equal(milestones.decodedCacheAfter.jit.decodedCacheEntries, 16384); assert.equal(milestones.decodedCacheError.key, "decodedCacheAfter");
  assert.equal(milestones.postRestoreStart, 1000); assert.equal(milestones.postRestoreEnd, 4000);
  assert.ok(source.indexOf('await recordDecodedCache(page, milestones, "decodedCacheBefore"') > source.indexOf("milestones.postRestoreStart = postRestoreStart"));
  assert.ok(source.indexOf('await recordDecodedCache(page, milestones, "decodedCacheAfter"') > source.indexOf("milestones.postRestoreEnd = postRestoreEnd"));
  assert.match(source, /assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\)/u);
});

test("observer executes the real page callback with sequential actual controller RPCs", async () => {
  const calls = [], sample = endpoint(4096);
  const controller = {
    async jitStats() { calls.push("jit"); return sample.jit; },
    async guestClockState() { calls.push("clock"); return sample.clock; },
  };
  let now = 1100;
  const page = { evaluate: fn => vm.runInNewContext(`(${fn.toString()})()`, {
    window: { __desktopController: controller }, performance: { now: () => now++ },
  }) };
  const m = {};
  await recordDecodedCache(page, m, "decodedCacheBefore", 4096);
  assert.deepEqual(calls, ["jit", "clock"]);
  assert.equal(m.decodedCacheBefore.requestedAt, 1100);
  assert.equal(m.decodedCacheBefore.receivedAt, 1101);
  delete controller.guestClockState;
  await assert.rejects(recordDecodedCache(page, {}, "decodedCacheBefore", 4096), /unavailable/);
  assert.deepEqual(calls, ["jit", "clock"], "missing method fails before either RPC");
});

// Constructed collector inputs only. No new capacity was measured in this old real record.
function collectorFixture() {
  const r = JSON.parse(readFileSync(new URL("../../evidence/e5-t26f/resident-residency-replay-45bff942/1-repack-off/failure-post-restore-interaction-checks.json", import.meta.url)));
  const m = r.milestones; r.unitOnly = true;
  m.run.diagnostic.decodedCacheEntries = 4096; m.run.diagnostic.jit = null; m.run.diagnostic.residency = null;
  m.decodedCacheBefore = endpoint(4096); m.decodedCacheBefore.requestedAt = m.postRestoreStart + 1;
  m.decodedCacheBefore.receivedAt = m.postRestoreStart + 2;
  m.decodedCacheAfter = endpoint(4096, 20); m.decodedCacheAfter.requestedAt = m.postRestoreEnd + 1;
  m.decodedCacheAfter.receivedAt = m.postRestoreEnd + 2;
  m.decodedCacheDeltas = decodedCacheDeltas(m.decodedCacheBefore, m.decodedCacheAfter, 4096, m.postRestoreStart, m.postRestoreEnd);
  m.decodedCacheErrors = { browser: [], http: [] }; return r;
}

test("collector rejects non-cap failure, wrong policy/input/CRC/audio/error and retains original timing failure", () => {
  assert.equal(collectDecodedCacheRecord(collectorFixture(), 1, 4096).fTimingPassed, false);
  for (const code of [0, 2, null, "1"]) assert.throws(() => collectDecodedCacheRecord(collectorFixture(), code, 4096));
  for (const mutate of [r => { r.error.message = "cursor missing"; }, r => { r.milestones.run.acceptance = true; },
    r => { r.milestones.run.postRestoreCommand = "fake"; }, r => { r.milestones.postRestoreAplay.keyboardFrames = 0; },
    r => { r.milestones.postRestoreAplay.accepted = false; }, r => { r.milestones.postRestoreAplay.redMarkerSeen = true; },
    r => { r.milestones.normalRestore.result.observation.firstPresent.crc32 = "00000000"; },
    r => { r.milestones.postRestoreAudioAfter.guestAttached = false; },
    r => { r.milestones.decodedCacheErrors.browser.push("boom"); },
    r => { r.milestones.decodedCacheDeltas.blockBuilds++; }]) {
    const bad = collectorFixture(); mutate(bad); assert.throws(() => collectDecodedCacheRecord(bad, 1, 4096));
  }
});
