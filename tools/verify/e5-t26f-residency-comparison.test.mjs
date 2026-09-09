// Read the actual frozen browser record and execute only the orchestrator's pure assertions.
// Never import the whole orchestrator: its top level spawns browser runs and writes evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertResidentImage, assertFreshLockedPcm, residentFixtureRequested } from "./e5-t26f-resident-proof.mjs";

const source = readFileSync(new URL("./e5-t26f-residency-comparison.mjs", import.meta.url), "utf8");
const recorded = JSON.parse(readFileSync(new URL(
  "../../evidence/e5-t26f/residency/1-repack-off/failure-post-restore-interaction-checks.json", import.meta.url), "utf8"));

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing orchestration boundary: ${startMarker}`);
  return source.slice(start, end);
}

const counterScript = new vm.Script(`(() => {
  ${extract("  const deltas = {};", "  assert.equal(m.postRestoreStart,")}
  return deltas;
})()`);
const admissionScript = new vm.Script(`(() => {
  ${extract("  if (child.code !== 0) {", "  assert.equal(m.run.acceptance,")}
  return true;
})()`);

function samples() {
  return structuredClone({ before: recorded.milestones.jitBefore, after: recorded.milestones.jitAfter });
}

function counterDeltas(input = samples()) {
  return { ...counterScript.runInNewContext({ assert, ...input }, { timeout: 100 }) };
}

// Independent arithmetic from the frozen record, not generated from the extracted loop.
const expected = {
  guestRetired: 46_479_799,
  retiredViaJit: 16_829_172,
  "entryCost.hostEntries": 1_154_427,
  directChainEntries: 2_967_618,
  blockEntryHits: 5_110_768,
  blockBuilds: 658_331,
  jitCacheInstalls: 476,
  jitCacheRetranslations: 128,
  jitCacheEvictions: 84,
  decodedBlocksDiscarded: 0,
  decodedCacheFlushes: 0,
};

function setCounter(sample, key, value) {
  if (key === "entryCost.hostEntries") sample.state.entryCost.hostEntries = value;
  else sample.state[key] = value;
}

test("actual frozen browser counters produce exact within-run deltas, including nested host entries", () => {
  assert.equal(recorded.head, "de9c9feae6e20dd906145fb5fab3913666b18f8a");
  assert.equal(recorded.milestones.jitBefore.state.entryCost.hostEntries, 159_470);
  assert.equal(recorded.milestones.jitAfter.state.entryCost.hostEntries, 1_313_897);
  assert.equal(Object.hasOwn(recorded.milestones.jitBefore.state, "hostEntries"), false);
  assert.equal(Object.hasOwn(recorded.milestones.jitAfter.state, "hostEntries"), false);
  assert.deepEqual(counterDeltas(), expected);
});

test("nested host entries are authoritative and missing nested data cannot fall back to fabricated flat values", () => {
  const valid = samples();
  for (const sample of [valid.before, valid.after]) {
    for (const key of ["hostEntries", "entryCost.hostEntries"]) {
      Object.defineProperty(sample.state, key, { get() { throw Error("fabricated flat counter read"); } });
    }
  }
  assert.deepEqual(counterDeltas(valid), expected);
  for (const endpoint of ["before", "after"]) for (const missing of ["member", "parent"]) {
    const input = samples();
    for (const [index, sample] of [input.before, input.after].entries()) {
      sample.state.hostEntries = 10 + index;
      sample.state["entryCost.hostEntries"] = 10 + index;
    }
    if (missing === "parent") delete input[endpoint].state.entryCost;
    else delete input[endpoint].state.entryCost.hostEntries;
    assert.throws(() => counterDeltas(input), /entryCost.hostEntries/);
  }
});

test("every counter rejects missing, nonnumeric, fractional, negative or unsafe endpoint values", () => {
  for (const key of Object.keys(expected)) for (const endpoint of ["before", "after"]) {
    for (const value of [undefined, null, "1", false, {}, 1n, NaN, Infinity, -Infinity, 0.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const input = samples();
      setCounter(input[endpoint], key, value);
      assert.throws(() => counterDeltas(input), (error) => error.code === "ERR_ASSERTION" && error.message.includes(key),
        `${endpoint}.${key} must reject ${String(value)}`);
    }
  }
});

test("every counter rejects decreasing safe nonnegative values", () => {
  for (const key of Object.keys(expected)) {
    const input = samples();
    setCounter(input.before, key, 17);
    setCounter(input.after, key, 16);
    assert.throws(() => counterDeltas(input), (error) => error.message.includes(`${key} regressed`));
  }
});

test("zero deltas are valid except guestRetired and retiredViaJit, which must each advance", () => {
  const input = samples();
  for (const key of Object.keys(expected)) {
    setCounter(input.before, key, 0);
    setCounter(input.after, key, key === "guestRetired" || key === "retiredViaJit" ? 1 : 0);
  }
  const deltas = counterDeltas(input);
  assert.deepEqual(deltas, Object.fromEntries(Object.keys(expected).map(key =>
    [key, key === "guestRetired" || key === "retiredViaJit" ? 1 : 0])));
  for (const key of ["guestRetired", "retiredViaJit"]) {
    const stale = samples();
    setCounter(stale.after, key, stale.before.state[key]);
    assert.throws(() => counterDeltas(stale), (error) => error.code === "ERR_ASSERTION");
  }
});

test("child-failure admission allows only exit 1 with the exact F timing-cap message", () => {
  const admit = (code, record) => admissionScript.runInNewContext({ assert, child: { code }, record }, { timeout: 100 });
  assert.equal(admit(1, recorded), true);
  // Exit 0 skips this failure-only block; downstream functional assertions still apply.
  assert.equal(admit(0, {}), true);
  for (const code of [2, -1, null, undefined, "1", "0", NaN]) {
    assert.throws(() => admit(code, recorded), (error) => error.code === "ERR_ASSERTION");
  }
  const exact = "post-restore interaction exceeded 2 seconds";
  for (const record of [{}, { error: null }, { error: {} },
    ...["", "cursor missing", "post-restore aplay wrote no guest PCM", exact + " ", "prefix " + exact,
      exact.replace("2", "3")].map(message => ({ error: { message } }))]) {
    assert.throws(() => admit(1, record), /a different failure is not a completed residency comparison/);
  }
});

const residentRecorded = JSON.parse(readFileSync(new URL(
  "../../evidence/e5-t26f/resident-jit-cost-73e7e4d9/failure-post-restore-interaction-checks.json", import.meta.url), "utf8"));
const optionsSource = extract("function residencyOptions(", "\nconst repo =");
function optionHelpers(extra = {}) {
  return vm.runInNewContext(`${optionsSource}\n({residencyOptions, childEnvironment, armSettings, residentPreflight})`,
    { assert, path, createHash, assertResidentImage, ...extra }, { timeout: 100 });
}
const residentInput = { E5_T26F_RESIDENCY_FIXTURE: "resident-aplay-v1", E5_T26F_RESIDENCY_CHECKPOINT: "/private/tmp/unit-only-resident",
  E5_T26F_RESIDENCY_IMAGE: "target/unit-only/image.ext4", E5_T26F_RESIDENCY_IMAGE_INFO: "target/unit-only/info.json",
  E5_T26F_RESIDENCY_ASSET_DIR: "target/unit-only/assets", E5_T26F_RESIDENCY_PORT: "61631" };
const json = value => JSON.parse(JSON.stringify(value));
// Execute the extracted pure functions in this realm so strict equality against the
// legacy literal {browser: [], http: []} keeps its real (non-VM) prototype semantics.
const collectorScript = new Function("assert", "assertFreshLockedPcm", "record", "code", "policy", "residentExpected",
  `${extract("function collectResidencyRecord(", "\nconst results =")}\nreturn collectResidencyRecord(record, {code}, policy, residentExpected);`);
const bindingsScript = new vm.Script(`${extract("function assertSameBindings(", "\nconst results =")}\nassertSameBindings(first, next)`);
const residentExpected = { fixture: residentRecorded.milestones.run.fixture,
  imageSha256: residentRecorded.milestones.run.binding.imageSha256,
  manifestSha256: residentRecorded.milestones.run.binding.manifestSha256,
  origin: residentRecorded.milestones.run.binding.origin,
  checkpoint: residentRecorded.milestones.run.diagnostic.directory };

// UNIT-ONLY POLICY FIXTURES, NOT BROWSER EVIDENCE: the retained run was profiled and
// did not select residency. Reuse its actual counters/functional observations, replacing
// only diagnostic selection and endpoint policy/cap to exercise the pure collector.
function unitResidentRecord(policy = "repack-off") {
  const record = structuredClone(residentRecorded), m = record.milestones;
  record.unitOnly = "constructed residency-policy fixture; not an actual ABBA arm";
  m.jitBefore = m.guestProfileBefore.jit; m.jitAfter = m.guestProfileAfter.jit;
  delete m.guestProfileBefore; delete m.guestProfileAfter;
  delete m.run.diagnostic.guestProfile;
  m.run.diagnostic.jit = "1"; m.run.diagnostic.residency = policy;
  for (const sample of [m.jitBefore, m.jitAfter]) {
    sample.state.jitResidencyPolicy = policy;
    sample.state.jitResidencyCap = policy === "repack-off" ? 24 : 256;
  }
  return record;
}
function collect(record = unitResidentRecord(), policy = "repack-off", code = 1, expected = residentExpected) {
  return collectorScript(assert, assertFreshLockedPcm, record, code, policy, expected);
}

test("resident options are exact opt-in and require all explicit checkpoint/image/info/asset/port inputs", () => {
  const { residencyOptions } = optionHelpers();
  assert.equal(residencyOptions({}).fixture, undefined);
  assert.equal(residencyOptions(residentInput).fixture, "resident-aplay-v1");
  for (const value of ["", "resident-aplay-v1 ", "RESIDENT-APLAY-V1", "resident-aplay-v2", 1, null, false, []]) {
    assert.throws(() => residencyOptions({ ...residentInput, E5_T26F_RESIDENCY_FIXTURE: value }), /unknown residency fixture/);
  }
  for (const field of ["CHECKPOINT", "IMAGE", "IMAGE_INFO", "ASSET_DIR", "PORT"]) {
    for (const value of [undefined, "", " ", null, 1]) {
      assert.throws(() => residencyOptions({ ...residentInput, [`E5_T26F_RESIDENCY_${field}`]: value }), /requires explicit/);
    }
  }
  for (const value of ["relative", "/", "/private/tmp/../tmp/fixture", "/private/tmp/fixture/"]) {
    assert.throws(() => residencyOptions({ ...residentInput, E5_T26F_RESIDENCY_CHECKPOINT: value }), /absolute normalized/);
  }
  for (const value of ["0", "1023", "65536", "061631", "61631.0", "1e4", "99999999999999999999999"]) {
    assert.throws(() => residencyOptions({ ...residentInput, E5_T26F_RESIDENCY_PORT: value }), /valid explicit port/);
  }
});

test("actual child environment scrubs all inherited task/compiler flags; resident arms carry only exact policy controls", () => {
  const { residencyOptions, childEnvironment, armSettings } = optionHelpers();
  const dirty = { ...residentInput, PATH: "/unit/bin", KEEP: "yes", RUSTFLAGS: "bad", RUST_LOG: "trace",
    CARGO_TARGET_DIR: "/bad", CARGO_PROFILE_RELEASE_LTO: "fat", CARGO_UNRECOGNIZED: "bad",
    E5_T26F_OUT: "/bad", E5_T26F_FIXTURE: "bad", E5_T26F_REQUIRE_HEAD: "bad", E5_T26F_HEADED: "0",
    E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "", E5_T26F_DIAGNOSTIC_GUEST_CLOCK: "wall",
    E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: "1", E5_T26F_DIAGNOSTIC_COMMAND: "bad",
    E5_T26F_DIAGNOSTIC_COMPLETE: "1", E5_T26F_DIAGNOSTIC_CPU: "1", E5_T26F_DIAGNOSTIC_LATENCY: "1",
    E5_T26F_DIAGNOSTIC_GUEST_PROFILE: "1", E5_T26F_DIAGNOSTIC_RESIDENCY: "cap-1024", E5_T26F_UNKNOWN: "bad" };
  const options = residencyOptions(dirty), common = childEnvironment(dirty, options, "unit-head", options.checkpoint);
  assert.deepEqual(json(common), { PATH: "/unit/bin", KEEP: "yes", E5_T26F_REQUIRE_HEAD: "unit-head", E5_T26F_HEADED: "0",
    E5_T26F_DIAGNOSTIC_PROFILE: options.checkpoint, E5_T26F_DIAGNOSTIC_PORT: "61631",
    E5_T26F_IMAGE: residentInput.E5_T26F_RESIDENCY_IMAGE, E5_T26F_IMAGE_INFO: residentInput.E5_T26F_RESIDENCY_IMAGE_INFO,
    E5_T26F_DESKTOP_ASSET_DIR: residentInput.E5_T26F_RESIDENCY_ASSET_DIR, E5_T26F_FIXTURE: "resident-aplay-v1" });
  for (const policy of ["repack-off", "cap-256"]) {
    const settings = armSettings(policy, options.fixture);
    assert.deepEqual(json(settings), { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_JIT: "1", E5_T26F_DIAGNOSTIC_RESIDENCY: policy });
    const child = { ...common, ...settings };
    assert.equal(residentFixtureRequested(child), true, "Tesla's actual resident admission accepts this exact child");
    for (const key of ["KEY_DELAY_MS", "GUEST_CLOCK", "ICOUNT_DIVIDER", "COMMAND", "COMPLETE", "CPU", "LATENCY", "GUEST_PROFILE"]) {
      assert.equal(child[`E5_T26F_DIAGNOSTIC_${key}`], undefined);
    }
  }
  assert.throws(() => armSettings("cap-1024", options.fixture));
});

test("resident children preserve sealed headless mode despite inherited HEADED; legacy stays headed", () => {
  const { residencyOptions, childEnvironment, armSettings } = optionHelpers();
  for (const inherited of [undefined, "", "0", "1"]) {
    const input = { ...residentInput, E5_T26F_HEADED: inherited }, options = residencyOptions(input);
    const common = childEnvironment(input, options, "unit-head", options.checkpoint);
    for (const policy of ["repack-off", "cap-256"]) {
      assert.equal({ ...common, ...armSettings(policy, options.fixture) }.E5_T26F_HEADED, "0");
    }
    const legacy = childEnvironment({ E5_T26F_HEADED: inherited }, residencyOptions({}), "unit-head", "/unit/checkpoint");
    assert.equal(legacy.E5_T26F_HEADED, "1");
  }
});

test("omission preserves legacy paths, optional checkpoint creation and explicit legacy ICount/5-ms arm settings", () => {
  const { residencyOptions, childEnvironment, armSettings } = optionHelpers(), options = residencyOptions({});
  assert.deepEqual(json(options), { port: "61629", image: "target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4",
    imageInfo: "target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json", assetDir: "target/e5-t26f/chunks/desktop-aplay-noresize" });
  assert.equal(Object.hasOwn(childEnvironment({}, options, "unit-head", "/unit/checkpoint"), "E5_T26F_FIXTURE"), false);
  assert.deepEqual(json(armSettings("repack-off", options.fixture)), { E5_T26F_DIAGNOSTIC: "reuse",
    E5_T26F_DIAGNOSTIC_JIT: "1", E5_T26F_DIAGNOSTIC_RESIDENCY: "repack-off",
    E5_T26F_DIAGNOSTIC_GUEST_CLOCK: "icount", E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5" });
  assert.deepEqual(json(collect(structuredClone(recorded), "repack-off", 1, null)).deltas, expected);
  for (const key of ["guestClockBefore", "guestClockAfter", "guestClockErrors"]) {
    const wrong = structuredClone(recorded); delete wrong.milestones[key];
    assert.throws(() => collect(wrong, "repack-off", 1, null), "legacy clock evidence remains mandatory");
  }
});

test("actual resident preflight refuses missing/symlink checkpoint and incorrect explicit fixture metadata before any arm", async () => {
  const repo = "/unit/repo", options = optionHelpers().residencyOptions(residentInput);
  const helper = readFileSync(new URL("../guest/e5-t26f-resident-aplay.sh", import.meta.url));
  const imageInfo = { fixture: residentRecorded.milestones.run.fixture,
    image: { sha256: residentExpected.imageSha256, size: 1073741824 } };
  let failure = null;
  const helpers = optionHelpers({
    lstat: async file => {
      if (failure === "missing" && file === options.checkpoint) throw Object.assign(Error("missing checkpoint"), { code: "ENOENT" });
      const directory = file === options.checkpoint || file === path.resolve(repo, options.assetDir);
      return { isDirectory: () => directory, isFile: () => !directory,
        isSymbolicLink: () => failure === "symlink" && file === options.checkpoint, size: 1073741824 };
    },
    readFile: async file => file.endsWith("resident-aplay.sh") ? helper : file.endsWith("info.json")
      ? JSON.stringify(imageInfo) : Buffer.from("unit-only manifest bytes"),
  });
  const valid = await helpers.residentPreflight(options, repo);
  assert.deepEqual(valid.fixture, residentExpected.fixture); assert.equal(valid.origin, "http://127.0.0.1:61631");
  assert.equal(valid.checkpoint, options.checkpoint);
  for (const scenario of ["missing", "symlink"]) { failure = scenario; await assert.rejects(helpers.residentPreflight(options, repo)); }
  failure = null;
  for (const field of ["kind", "helperSha256", "baseSha256", "guestPath"]) {
    const original = imageInfo.fixture[field]; imageInfo.fixture[field] = "incorrect";
    await assert.rejects(helpers.residentPreflight(options, repo)); imageInfo.fixture[field] = original;
  }
  imageInfo.image.size--;
  await assert.rejects(helpers.residentPreflight(options, repo), /size differs/);
  assert.equal(await helpers.residentPreflight({ fixture: undefined }, repo), null);
});

test("unit-only resident policy fixtures execute actual collector with exact retained deltas and no invented clock receipts", () => {
  assert.equal(residentRecorded.head, "73e7e4d9a9cdcf8df1b463fced753267759c0367");
  for (const policy of ["repack-off", "cap-256"]) {
    const record = unitResidentRecord(policy), result = collect(record, policy);
    assert.match(record.unitOnly, /not an actual ABBA arm/);
    assert.equal(result.interactionMs, 4943.945000052452);
    assert.equal(result.fTimingPassed, false); assert.equal(result.fVerified, false);
    assert.equal(result.deltas.guestRetired, 54_474_955); assert.equal(result.deltas.retiredViaJit, 21_224_304);
    assert.equal(result.deltas["entryCost.hostEntries"], 1_562_290); assert.equal(result.deltas.blockBuilds, 774_152);
    assert.equal(result.clockObservation, "not-recorded; no override requested");
    assert.equal(record.milestones.guestClockBefore, undefined); assert.equal(record.milestones.guestClockAfter, undefined);
    assert.equal(result.workerAfter.state.jitResidencyCap, policy === "repack-off" ? 24 : 256);
  }
  assert.throws(() => collect(residentRecorded), "the profiled real source is not itself an admitted ABBA arm");
});

test("resident collector rejects wrong fixture, policy, command, pacing and every conflicting diagnostic override", () => {
  const mutations = [
    m => { delete m.run.fixture; }, m => { m.run.fixture.kind = "wrong"; },
    m => { delete m.run.binding.fixture; }, m => { m.residentCheckpoint.fixture.helperSha256 = "0".repeat(64); },
    m => { m.run.postRestoreCommand = "sh /tmp/a"; }, m => { m.postRestoreAplay.command = "times;play;times"; },
    m => { m.run.postRestoreKeyDelayMs = 0; }, m => { m.run.postRestoreKeyDelayMs = 100; },
    m => { m.run.diagnostic.mode = "create"; }, m => { m.run.acceptance = true; },
    m => { m.run.diagnostic.jit = "0"; }, m => { m.run.diagnostic.residency = "cap-1024"; },
    m => { m.run.diagnostic.directory = "/different/checkpoint"; },
  ];
  for (const [field, value] of [["command", ""], ["keyDelayMs", 5], ["guestClock", "icount"], ["guestClock", ""],
    ["icountDivider", 10], ["complete", true], ["complete", ""], ["guestProfile", true], ["guestProfile", ""],
    ["cpu", true], ["latency", true]]) mutations.push(m => { m.run.diagnostic[field] = value; });
  for (const endpoint of ["jitBefore", "jitAfter"]) {
    for (const [field, value] of [["hasExecutor", false], ["jitResidencyPolicy", "cap-256"], ["jitResidencyCap", 256]]) {
      mutations.push(m => { m[endpoint].state[field] = value; });
    }
  }
  for (const mutate of mutations) {
    const record = unitResidentRecord(); mutate(record.milestones);
    assert.throws(() => collect(record));
  }
});

test("resident collector requires actual fresh physical input, current green, restored CRC/no boot and fresh positive PCM", () => {
  const mutations = [m => { m.postRestoreAplay.accepted = false; }, m => { m.postRestoreAplay.keyboardFrames = 8; },
    m => { m.postRestoreAplay.domEvents = 8; }, m => { m.postRestoreAplay.inputSequenceMatch = false; },
    m => { m.postRestoreAplay.terminalMarkerSeen = false; }, m => { m.postRestoreAplay.redMarkerSeen = true; },
    m => { m.postRestoreAplay.visualDiffPixels = 1999; }, m => { m.postRestoreAplay.visualChange = false; },
    m => { m.postRestoreAplay.afterFrame = m.postRestoreAplay.beforeFrame; },
    m => { m.normalRestore.result.observation.firstPresent.crc32 = "00000000"; },
    m => { m.normalRestore.result.bootStates.push({ state: "booting" }); }, m => { m.normalRestore.result.bootStates = []; },
    m => { m.normalRestore.result.resume.restored = false; }, m => { m.normalRestore.result.snapshotSha256 = "0".repeat(64); },
    m => { m.normalRestore.displayChecksPassed = false; }, m => { m.normalSnapshot.machineResume.persisted = false; },
    m => { m.residentCheckpoint.sound.pendingTransfers = 1; }, m => { m.residentCheckpoint.sound.state = 3; },
    m => { m.residentCheckpoint.sound.kicked[2] = 1; }, m => { m.residentCheckpoint.prepared.accepted = false; },
    m => { m.residentBeforeGesture.pop(); }, m => { m.residentBeforeGesture[0].pcm.writeIndex = 1; },
    m => { m.residentBeforeGesture[1].policy = "unlocked"; }, m => { m.residentBeforeGesture[1].observedAt = m.residentBeforeGesture[0].observedAt; },
    m => { m.postRestoreAudioAfter.guestAttached = false; }, m => { m.postRestoreAudioAfter.pcm = { ...m.postRestoreAudioAfter.pcm, nonSilentFrames: 0 }; },
    m => { m.postRestorePcmAtCompletion.observedAt = m.postRestoreEnd + 1; }];
  for (const field of ["writtenFrames", "inspectedFrames", "nonSilentFrames", "maxAbs"]) {
    for (const value of [0, -1, NaN, Infinity, "1"]) mutations.push(m => {
      m.postRestoreAudioAfter.pcm[field] = value; m.postRestorePcmAtCompletion.pcm[field] = value;
    });
  }
  for (const mutate of mutations) {
    const record = unitResidentRecord(); mutate(record.milestones); assert.throws(() => collect(record));
  }
});

test("resident counters, original endpoint ordering and any existing clock observations fail closed", () => {
  for (const endpoint of ["jitBefore", "jitAfter"]) {
    for (const field of Object.keys(expected)) for (const value of [undefined, -1, NaN, "1", Number.MAX_SAFE_INTEGER + 1]) {
      const record = unitResidentRecord(); setCounter(record.milestones[endpoint], field, value);
      assert.throws(() => collect(record));
    }
    for (const field of ["requestedAt", "receivedAt"]) {
      const record = unitResidentRecord(); record.milestones[endpoint][field] = Infinity;
      assert.throws(() => collect(record));
    }
  }
  const wrong = unitResidentRecord(); wrong.milestones.jitAfter.requestedAt = wrong.milestones.postRestoreEnd - 1;
  assert.throws(() => collect(wrong), /ordering/);
  const stale = unitResidentRecord(); stale.milestones.jitAfter.state.guestRetired = stale.milestones.jitBefore.state.guestRetired;
  assert.throws(() => collect(stale));
  for (const field of ["guestClockBefore", "guestClockAfter"]) {
    for (const state of [{ mode: "wall", clockDiv: 10, timebaseHz: 10000000 }, { mode: "icount", clockDiv: 1, timebaseHz: 10000000 }, null]) {
      const record = unitResidentRecord(); record.milestones[field] = { state }; assert.throws(() => collect(record));
    }
    const record = unitResidentRecord(); record.milestones[field] = { state: { mode: "icount", clockDiv: 10, timebaseHz: 10000000 } };
    assert.equal(collect(record).clockObservation, "recorded-icount");
  }
});

test("all four unit-only ABBA arms must preserve actual fixture, source/profile/snapshot/config bindings", () => {
  const policies = ["repack-off", "cap-256", "cap-256", "repack-off"];
  const results = policies.map(policy => collect(unitResidentRecord(policy), policy));
  for (const next of results) bindingsScript.runInNewContext({ assert, first: results[0], next });
  for (const field of ["runtimeSha256", "kernelSha256", "imageSha256", "manifestSha256", "origin", "head"]) {
    const next = json(results[3]); next.binding[field] = "changed";
    assert.throws(() => bindingsScript.runInNewContext({ assert, first: results[0], next }), /comparison changed/);
  }
  for (const field of ["profileSha256", "snapshotSha256", "residentCheckpoint"]) {
    const next = json(results[3]); delete next[field];
    assert.throws(() => bindingsScript.runInNewContext({ assert, first: results[0], next }), /comparison changed/);
  }
  for (const field of ["imageSha256", "manifestSha256", "origin"]) {
    const record = unitResidentRecord(); record.milestones.run.binding[field] = "wrong";
    assert.throws(() => collect(record), /configured/);
  }
});

test("resident arms cannot turn a non-cap failure into data or accept successful exit with failed original timing", () => {
  for (const code of [2, -1, null, "1", 0]) assert.throws(() => collect(unitResidentRecord(), "repack-off", code));
  for (const [field, value] of [["message", "cursor missing"], ["name", "Error"], ["code", "OTHER"]]) {
    const record = unitResidentRecord(); record.error[field] = value; assert.throws(() => collect(record));
  }
  const record = unitResidentRecord(); record.milestones.postRestoreEnd = record.milestones.postRestoreStart + 1999;
  // Keep functional observations within this unit-only shortened interval to hit cap consistency.
  record.milestones.postRestorePcmAtCompletion.observedAt = record.milestones.postRestoreEnd - 1;
  assert.throws(() => collect(record), /over-cap interval/);
  delete record.error;
  const result = collect(record, "repack-off", 0);
  assert.equal(result.fTimingPassed, true); assert.equal(result.fVerified, false);
});

test("actual orchestration preserves ABBA, guards cold creation, and refuses existing arm output before spawn", async () => {
  assert.match(source, /\["repack-off", "cap-256", "cap-256", "repack-off"\]\.entries\(\)/);
  assert.match(source, /if \(!options\.fixture && !options\.checkpoint\) \{/);
  assert.ok(source.indexOf("await residentPreflight(options, repo)") < source.indexOf("await mkdtemp("));
  assert.match(source, /await run\(`\$\{index \+ 1\}-\$\{policy\}`, armSettings\(policy, options\.fixture\)\)/);
  assert.match(source, /assertSameBindings\(results\[0\], results\.at\(-1\)\)/);
  assert.match(source, /path\.join\(out, "comparison.json"\)[\s\S]*flag: "wx"/);
  const run = vm.runInNewContext(`${extract("async function run(", "\nif (!options.fixture")}\nrun`, {
    path, out: "/unit/out", mkdir: async () => { throw Object.assign(Error("exists"), { code: "EEXIST" }); },
    spawn: () => assert.fail("must not launch a browser when arm output exists"),
  });
  await assert.rejects(run("1-repack-off", {}), { code: "EEXIST" });
});
