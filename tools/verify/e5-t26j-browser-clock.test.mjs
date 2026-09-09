// Synthetic edits of an existing record exercise collector admission, never create browser evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ORDER, childEnvironment, requireEmptyOutput, settingsFor, validateCold, validateIteration } from "./e5-t26j-browser-clock.mjs";

const frozen = JSON.parse(readFileSync(new URL(
  "../../evidence/e5-t26f/completion/guest-release-8c892667/diagnostic-completion-timing.json", import.meta.url)));
const coldFrozen = JSON.parse(readFileSync(new URL(
  "../../evidence/e5-t26f/completion/paced-receipt-checkpoint-8986/diagnostic-checkpoint.json", import.meta.url)));
const head = frozen.head;
const retained = "/private/tmp/e5-t26j-test-seal";
const browser = { name: "chromium", version: "fixture-browser", headless: true };
const state = (divider, mtime) => ({ mode: "icount", clockDiv: divider, mtime, timebaseHz: 10_000_000 });

function fixture(divider = 10, elapsed = 2_500) {
  const record = structuredClone(frozen), m = record.milestones;
  const baseline = { head, retained, binding: m.run.binding, normalSnapshot: m.normalSnapshot,
    profileSha256: m.run.profileSha256, checkpointFile: `${retained}/normal-checkpoint.json`,
    createdAt: m.run.checkpointCreatedAt, browser };
  Object.assign(m.run, { creatorHead: head, checkpointFile: baseline.checkpointFile, profile: `${retained}/iteration-one/profile` });
  Object.assign(m.run.diagnostic, { directory: retained, complete: false, icountDivider: divider });
  m.icountDividerErrors = { browser: [], http: [] };
  const selection = { requested: divider, before: state(10, "100"), after: state(divider, "100") };
  const jit = { hasExecutor: true, jitResidencyPolicy: "repack-off", jitResidencyCap: 24,
    jitRegionChaining: true, jitDynamicChaining: true, guestRetired: 10, retiredViaJit: 5 };
  m.postRestoreEnd = m.postRestoreStart + elapsed;
  m.postRestorePcmAtCompletion.observedAt = m.postRestoreEnd - 10;
  m.postRestoreOutputAttached.observedAt = m.postRestoreEnd - 5;
  m.icountDividerBefore = { requestedAt: m.postRestoreStart + 10, receivedAt: m.postRestoreStart + 20,
    state: state(divider, "110"), jit, selection };
  m.icountDividerAfter = { requestedAt: m.postRestoreEnd + 10, receivedAt: m.postRestoreEnd + 20,
    state: state(divider, "210"), jit: { ...jit, guestRetired: 30, retiredViaJit: 15 }, selection: structuredClone(selection) };
  delete m.deferredInteractionCap;
  if (elapsed <= 2_000) Object.assign(record, { schema: "wasm-vm.e5-t26f.diagnostic-iteration.v1", acceptance: false,
    errors: { browser: [], http: [] }, browser });
  return { record, m, baseline, code: elapsed <= 2_000 ? 0 : 1,
    validate() { return validateIteration(record, this.code, divider, baseline); } };
}

test("environment is headless, fresh-seal only, and removes every inherited F experiment", () => {
  const env = childEnvironment({ PATH: "/fixture", E5_T26F_HEADED: "1", E5_T26F_DIAGNOSTIC: "reuse",
    E5_T26F_DIAGNOSTIC_COMMAND: "play", E5_T26F_DIAGNOSTIC_JIT: "0", E5_T26F_DIAGNOSTIC_CPU: "1",
    E5_T26F_DIAGNOSTIC_GUEST_CLOCK: "wall", E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "25" }, head, retained);
  assert.equal(env.PATH, "/fixture");
  assert.equal(env.E5_T26F_REQUIRE_HEAD, head);
  assert.equal(env.E5_T26F_DIAGNOSTIC_PROFILE, retained);
  assert.equal(env.E5_T26F_DIAGNOSTIC_PORT, "61630");
  for (const key of ["HEADED", "DIAGNOSTIC", "DIAGNOSTIC_COMMAND", "DIAGNOSTIC_JIT", "DIAGNOSTIC_CPU",
    "DIAGNOSTIC_GUEST_CLOCK", "DIAGNOSTIC_KEY_DELAY_MS"]) assert.equal(env[`E5_T26F_${key}`], undefined);
  for (const value of ["", retained]) assert.throws(() => childEnvironment({ E5_T26J_CHECKPOINT: value }, head, retained), /NEW cold seal/);
  for (const port of ["0", "1023", "65536", " 61630", "61630\n", 61630]) {
    assert.throws(() => childEnvironment({ E5_T26J_PORT: port }, head, retained), /port/);
  }
  assert.throws(() => childEnvironment({ E5_T26J_REQUIRE_HEAD: "0".repeat(40) }, head, retained), /HEAD/);
});

test("the only four replay settings are ABBA 10/1/1/10 with the same five-ms physical command policy", () => {
  assert.deepEqual(ORDER, [10, 1, 1, 10]);
  assert.ok(Object.isFrozen(ORDER));
  for (let index = 0; index < 4; index += 1) assert.deepEqual(settingsFor(index), {
    E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: String(ORDER[index]), E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5",
  });
  for (const index of [-1, 4, 0.5, "0", NaN]) assert.throws(() => settingsFor(index));
});

test("output refuses existing evidence and symlinks without modifying it; new and empty directories work", async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "e5-t26j-output-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await requireEmptyOutput(path.join(scratch, "new"));
  await requireEmptyOutput(path.join(scratch, "new"));
  await writeFile(path.join(scratch, "new", "held.json"), "retained");
  await assert.rejects(requireEmptyOutput(path.join(scratch, "new")), /refusing nonempty/);
  assert.equal(await readFile(path.join(scratch, "new", "held.json"), "utf8"), "retained");
  await mkdir(path.join(scratch, "empty"));
  await symlink(path.join(scratch, "empty"), path.join(scratch, "link"));
  await assert.rejects(requireEmptyOutput(path.join(scratch, "link")), /real directory/);
});

test("cold admission requires completed initial real playback, paused publication and an exact new head/binding", () => {
  const make = () => {
    const record = structuredClone(coldFrozen), m = record.milestones;
    m.run.diagnostic.icountDivider = null;
    const seal = { schema: "wasm-vm.e5-t26f.diagnostic-profile.v1", browser, normalSnapshot: m.normalSnapshot,
      profileSha256: m.run.profileSha256, createdAt: "fixture-creation" };
    const env = { E5_T26F_DIAGNOSTIC_PORT: String(m.run.diagnostic.port), E5_T26F_DIAGNOSTIC_PROFILE: m.run.diagnostic.directory };
    return { record, seal, env, head: m.run.currentHead };
  };
  const f = make();
  assert.equal(validateCold(f.record, f.seal, f.head, f.env).profileSha256, f.seal.profileSha256);
  for (const corrupt of [
    f => { f.record.milestones.initialAplay.terminalMarkerSeen = false; },
    f => { f.record.milestones.initialAudio.after.nonSilentFrames = 0; },
    f => { f.record.milestones.normalSnapshotPause.isPaused = false; },
    f => { f.record.milestones.run.creatorHead = "0".repeat(40); },
    f => { f.record.milestones.run.binding.runtimeSha256 = "unbound"; },
    f => { f.seal.browser = { ...browser, headless: false }; },
  ]) { const bad = make(); corrupt(bad); assert.throws(() => validateCold(bad.record, bad.seal, bad.head, bad.env)); }
});

test("both arms retain actual endpoint states, independent deltas and original measured failure", () => {
  for (const divider of [10, 1]) {
    const f = fixture(divider), row = f.validate();
    assert.equal(row.divider, divider);
    assert.deepEqual(row.deltas, { guestRetired: 20, retiredViaJit: 10 });
    assert.equal(row.guestDeltaTicks, "100");
    assert.equal(row.workerBefore, f.m.icountDividerBefore);
    assert.equal(row.interactionMs, 2_500);
    assert.equal(row.fTimingPassed, false);
    assert.equal(row.fVerified, false);
  }
});

test("the exact two-second boundary and child exit must agree; only exact cap failures are admitted", () => {
  assert.equal(fixture(10, 2_000).validate().fTimingPassed, true);
  assert.equal(fixture(10, 2_000.001).validate().fTimingPassed, false);
  for (const code of [2, -1, null, "1", NaN]) { const f = fixture(); f.code = code; assert.throws(() => f.validate()); }
  for (const error of [{}, { name: "Error", code: "ERR_ASSERTION", message: "post-restore interaction exceeded 2 seconds" },
    ...["cursor missing", "post-restore interaction exceeded 2 seconds ", "post-restore aplay wrote no guest PCM"]
      .map(message => ({ name: "AssertionError", code: "ERR_ASSERTION", message }))]) {
    const f = fixture(); f.record.error = error; assert.throws(() => f.validate());
  }
  for (const elapsed of [1_999, 2_500]) { const f = fixture(10, elapsed); f.code = 1 - f.code; assert.throws(() => f.validate()); }
});

test("command, instrumentation, JIT policy, actual input, attachment and silent PCM cannot be waived", () => {
  for (const corrupt of [
    m => { m.run.postRestoreCommand = "play"; }, m => { m.run.postRestoreKeyDelayMs = 0; },
    ...["cpu", "latency", "complete"].map(key => m => { m.run.diagnostic[key] = true; }),
    ...["jit", "residency", "guestClock", "command"].map(key => m => { m.run.diagnostic[key] = ""; }),
    m => { m.icountDividerBefore.jit.hasExecutor = false; },
    m => { m.icountDividerBefore.jit.jitRegionChaining = false; },
    m => { m.icountDividerAfter.jit.jitDynamicChaining = false; },
    m => { m.icountDividerBefore.jit.jitResidencyPolicy = "cap-256"; },
    m => { m.icountDividerAfter.jit.jitResidencyCap = 256; },
    m => { m.postRestoreAplay.inputSequenceMatch = false; }, m => { m.postRestoreAplay.keyboardFrames = 19; },
    m => { m.postRestoreAplay.terminalMarkerSeen = false; }, m => { m.postRestoreAplay.visualDiffPixels = 1999; },
    m => { m.postRestoreCursor.rendered = null; }, m => { m.postRestoreCursor.frame.coordinates.x += 2; },
    m => { m.postRestorePcmAtCompletion.pcm.nonSilentFrames = 0; },
    m => { m.postRestoreOutputAttached.outputAttached = false; },
    m => { m.icountDividerErrors.http.push({ status: 500 }); }, m => { delete m.icountDividerErrors; },
  ]) { const f = fixture(); corrupt(f.m); assert.throws(() => f.validate()); }
});

test("missing/invalid state, receipt, u64, counters and regression refuse in both endpoint observations", () => {
  for (const endpoint of ["icountDividerBefore", "icountDividerAfter"]) {
    for (const corrupt of [s => { s.state.mode = "wall"; }, s => { s.state.clockDiv = 1; },
      s => { s.state.timebaseHz = 1; }, s => { s.state.mtime = "18446744073709551616"; },
      s => { s.state.mtime = "-1"; }, s => { s.selection = null; },
      s => { s.selection.before.clockDiv = 1; }, s => { s.selection.after.mtime = "101"; },
      ...["guestRetired", "retiredViaJit"].flatMap(key => [undefined, "1", 0.5, -1, NaN, Infinity, 2 ** 53]
        .map(value => s => { s.jit[key] = value; })),
    ]) { const f = fixture(); corrupt(f.m[endpoint]); assert.throws(() => f.validate()); }
  }
  for (const key of ["guestRetired", "retiredViaJit"]) {
    const f = fixture(); f.m.icountDividerAfter.jit[key] = f.m.icountDividerBefore.jit[key]; assert.throws(() => f.validate());
  }
  const f = fixture(); f.m.icountDividerAfter.state.mtime = "110"; assert.throws(() => f.validate());
});

test("RPCs and PCM observations cannot reset T0 or escape their actual original-clock endpoints", () => {
  for (const corrupt of [
    m => { m.postRestoreStart += 1; }, m => { m.postRestoreEnd = NaN; },
    m => { m.icountDividerBefore.requestedAt = m.postRestoreStart - 1; },
    m => { m.icountDividerBefore.receivedAt = m.postRestoreEnd + 1; },
    m => { m.icountDividerAfter.requestedAt = m.postRestoreEnd - 1; },
    m => { m.icountDividerAfter.receivedAt = NaN; },
    m => { m.postRestorePcmAtCompletion.observedAt = m.postRestoreEnd + 1; },
    m => { m.postRestoreOutputAttached.observedAt = m.postRestoreEnd + 1; },
  ]) { const f = fixture(); corrupt(f.m); assert.throws(() => f.validate()); }
});

test("all runtime/image/seal bindings and stored selection agree, but iteration directories must differ", () => {
  for (const corrupt of [
    m => { m.run.binding = { ...m.run.binding, runtimeSha256: "0".repeat(64) }; },
    m => { m.run.binding = { ...m.run.binding, imageSha256: "0".repeat(64) }; },
    m => { m.run.profileSha256 = "0".repeat(64); }, m => { m.run.creatorHead = "0".repeat(40); },
    m => { m.normalSnapshot = { ...m.normalSnapshot, sha256: "0".repeat(64) }; },
    m => { m.run.profile = `${retained}/checkpoint-profile`; },
    m => { m.run.profile = `${retained}/../elsewhere/profile`; },
  ]) { const f = fixture(); corrupt(f.m); assert.throws(() => f.validate()); }
  const first = fixture(), row = first.validate(), next = fixture(1);
  assert.throws(() => validateIteration(next.record, 1, 1, next.baseline, [row]), /profile was reused/);
  next.m.run.profile = `${retained}/iteration-two/profile`;
  assert.equal(validateIteration(next.record, 1, 1, next.baseline, [row]).divider, 1);
  for (const sample of [next.m.icountDividerBefore, next.m.icountDividerAfter]) {
    sample.selection.before.mtime = sample.selection.after.mtime = "101";
  }
  assert.throws(() => validateIteration(next.record, 1, 1, next.baseline, [row]), /stored clock changed/);
});

test("collector keeps output refusal outside failure writes and preserves every child transcript before admission", () => {
  const source = readFileSync(new URL("./e5-t26j-browser-clock.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("await requireEmptyOutput(out)") < source.indexOf('const retained = await mkdtemp'));
  assert.match(source, /finally \{ await writeFile\(path\.join\(directory, "run.log"\), log, \{ flag: "wx" \}\); \}/);
  assert.match(source, /for \(const \[index, divider\] of ORDER.entries\(\)\)/);
  assert.match(source, /if \(process.argv\[1\] && path.resolve\(process.argv\[1\]\) === fileURLToPath\(import.meta.url\)\) await collect\(\);/);
});
