// Factory/control-flow tests only. Mock page callbacks are not guest or timing evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { SOURCE_PINS, SEAL, validateQuietEnvironment, replaceUnique, extractUnique,
  deriveQuietProbe, generateQuietProbe } from "./e5-t26f-single-process-quiet-probe.mjs";

const repo = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sources = Object.fromEntries(Object.keys(SOURCE_PINS).map(relative => [relative, readFileSync(path.join(repo, relative))]));
const proper = sources["tools/verify/e5-t26f-browser-roundtrip.mjs"].toString();
const held = sources["tools/verify/e5-t26f-quiet-text-probe.mjs"].toString();
const generated = deriveQuietProbe(sources).source;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.parse(JSON.stringify(value));
const env = () => ({ E5_T26F_FIXTURE: "resident-observer-v1", E5_T26F_DIAGNOSTIC: "reuse",
  E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/unit-only-sealed-profile", E5_T26F_DIAGNOSTIC_PORT: "61637",
  E5_T26F_OUT: "/private/tmp/unit-only-quiet-evidence" });

test("factory pins actual current/held sources and refuses every source drift", () => {
  const before = Object.fromEntries(Object.entries(sources).map(([key, bytes]) => [key, Buffer.from(bytes)]));
  const a = deriveQuietProbe(sources), b = deriveQuietProbe(sources);
  assert.deepEqual(a, b); assert.equal(a.acceptance, false); assert.equal(a.fVerified, false);
  assert.equal(a.changes.length, 17);
  assert.deepEqual(sources, before);
  for (const key of Object.keys(SOURCE_PINS)) {
    assert.equal(sha256(sources[key]), SOURCE_PINS[key]);
    assert.throws(() => deriveQuietProbe({ ...sources, [key]: Buffer.concat([sources[key], Buffer.from("\n")]) }), /pinned source drift/);
  }
});

test("replacement and extraction require unique ordered anchors, including literal replacement text", () => {
  assert.equal(replaceUnique("a HERE b", "HERE", "$&$`$'"), "a $&$`$' b");
  for (const value of ["absent", "HERE HERE"]) assert.throws(() => replaceUnique(value, "HERE", "next"));
  for (const value of ["START missing", "END START", "START START END", "START END END"]) {
    assert.throws(() => extractUnique(value, "START", "END"));
  }
  assert.equal(extractUnique("prefix START middle END suffix", "START", "END"), "START middle ");
});

test("reuse observer only; all tuning/profiling/command/pacing flags refuse even when empty", () => {
  assert.deepEqual(validateQuietEnvironment(env()), { acceptance: false, fVerified: false, mode: "single-process-quiet-screen" });
  for (const key of ["CPU", "LATENCY", "JIT", "RESIDENCY", "GUEST_PROFILE", "GUEST_CLOCK", "ICOUNT_DIVIDER",
    "DECODED_CACHE_ENTRIES", "COMMAND", "COMPLETE", "KEY_DELAY_MS", "UNKNOWN_FUTURE_KNOB"]) {
    for (const value of ["", "0", "1", "play", undefined]) {
      assert.throws(() => validateQuietEnvironment({ ...env(), [`E5_T26F_DIAGNOSTIC_${key}`]: value }), /refuses diagnostic override/);
    }
  }
  for (const value of [undefined, null, "", "create", "REUSE"]) {
    assert.throws(() => validateQuietEnvironment({ ...env(), E5_T26F_DIAGNOSTIC: value }));
  }
  for (const value of [undefined, "", "resident-aplay-v1", "resident-observer-v2"]) {
    assert.throws(() => validateQuietEnvironment({ ...env(), E5_T26F_FIXTURE: value }));
  }
  for (const key of ["E5_T26F_DIAGNOSTIC_PROFILE", "E5_T26F_OUT"]) {
    for (const value of [undefined, "", "/", "relative", "/private/tmp/../tmp/path"]) {
      assert.throws(() => validateQuietEnvironment({ ...env(), [key]: value }));
    }
  }
  for (const value of [undefined, "", "061637", "1023", "65536", 61637, "61637 "]) {
    assert.throws(() => validateQuietEnvironment({ ...env(), E5_T26F_DIAGNOSTIC_PORT: value }));
  }
});

test("actual generated options have no instrumentation or acceptance route", () => {
  const options = extractUnique(generated, "function diagnosticOptions(", "function validateQuietEnvironment(");
  const guard = extractUnique(generated, "function validateQuietEnvironment(", "const quietSourcePins =");
  for (const input of [env(), { ...env(), E5_T26F_DIAGNOSTIC_CPU: "" }]) {
    const context = vm.createContext({ assert, path, process: { env: input },
      guestProfileRequested: () => assert.fail("no guest profiling"), decodedCacheRequested: () => assert.fail("no cache tuning") });
    const run = () => vm.runInContext(options + guard + "diagnosticOptions(process.env)", context);
    if (Object.hasOwn(input, "E5_T26F_DIAGNOSTIC_CPU")) assert.throws(run);
    else {
      const d = json(run());
      for (const key of ["cpu", "latency", "complete"]) assert.equal(d[key], false);
      for (const key of ["command", "guestClock", "jit", "residency", "icountDivider"]) assert.equal(d[key], null);
      assert.equal(d.guestProfile, undefined); assert.equal(d.decodedCacheEntries, undefined);
      assert.equal(d.mode, "reuse"); assert.equal(d.keyDelayMs, 0);
    }
  }
  assert.ok(generated.indexOf("validateQuietEnvironment(process.env);") < generated.indexOf("await requireEmptyCompletionOutput(out)"));
});

test("derived driver retains current source/image guards, copy-only profile, one-shot hydration and identity code", () => {
  for (const [start, end] of [
    ["const fixtureInputs =", "const { stdout: headOutput }"],
    ["async function prepareDiagnostic(", "async function installCheckpointSession("],
    ["async function installCheckpointSession(", "async function readBrowserIdentity("],
    ["async function readBrowserIdentity(", "async function requireEmptyCompletionOutput("],
    ["async function auditRestoreCoherence(", "async function reloadWithAutoRestore("],
  ]) assert.equal(extractUnique(generated, start, end), extractUnique(proper, start, end));
  assert.equal(generated.split("await installCheckpointSession(page, diagnosticCheckpoint, base)").length, 2);
  assert.match(generated, /launchPersistentContext\(retained\.profile,/u);
  assert.doesNotMatch(generated, /launchPersistentContext\(retained\.seed/u);
  const record = JSON.parse(readFileSync(path.join(repo, "evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.json")));
  assert.equal(SEAL.creatorHead, record.milestones.run.creatorHead);
  assert.equal(SEAL.profileSha256, record.milestones.run.profileSha256);
  assert.equal(SEAL.snapshotSha256, record.milestones.normalSnapshot.sha256);
  assert.equal(SEAL.runtimeSha256, record.milestones.run.binding.runtimeSha256);
  assert.equal(SEAL.imageSha256, record.milestones.run.binding.imageSha256);
  const helper = readFileSync(path.join(repo, "tools/guest/e5-t26f-resident-observer.sh"));
  assert.equal(sha256(helper), record.milestones.run.fixture.helperSha256);
  const c = readFileSync(path.join(repo, record.milestones.run.fixture.observer.sourcePath));
  assert.equal(sha256(c), record.milestones.run.fixture.observer.sourceSha256);
  assert.match(helper.toString(), /e5_observe && \[ "\$e5_seen" = "\$e5_expected" \]/u);
  assert.match(helper.toString(), /if wait "\$e5_pid"; then/u);
});

test("held raster/physical helper is transplanted byte-exact; current T0, cap, gesture and PCM checks remain", () => {
  for (const [start, end] of [
    ["const reviewedTextFile =", "const jsonReplacer ="],
    ["async function typeQuietTextCommand()", "async function waitForDesktopReady("],
  ]) assert.equal(extractUnique(generated, start, end), extractUnique(held, start, end));
  assert.equal(extractUnique(generated, "function readTopmostDragTitlebar()", "function observedDragTranslation("),
    extractUnique(proper, "function readTopmostDragTitlebar()", "function observedDragTranslation("));
  assert.equal(extractUnique(generated, "  const postPcmAtCompletion =", "  let deferredInteractionCap =").split("  try {")[0],
    extractUnique(proper, "  const postPcmAtCompletion =", "  let deferredInteractionCap =").split("  try {")[0]);
  assert.equal(extractUnique(generated, "  const postRestoreEnd =", "  try {\n    assert.ok(postRestoreInteraction.pointerFrames"),
    extractUnique(proper, "  const postRestoreEnd =", "  try {\n    assert.ok(postRestoreInteraction.pointerFrames"));
  assert.equal(extractUnique(generated, "function remainingInteractionMs(", "function guestPoint("),
    extractUnique(proper, "function remainingInteractionMs(", "function guestPoint("));
  for (const literal of [
    "const postRestoreStart = firstRestore.completedAt;", "milestones.postRestoreStart = postRestoreStart;",
    'assert.ok(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds");',
    'await typePhysicalText("play", 5);', 'await page.keyboard.press("Enter",{delay:5});',
    'await page.waitForTimeout(350);', 'assert.equal(postRestoreCommand, "play");',
    'assert.equal(postRestoreKeyDelayMs, 5);',
  ]) assert.equal(generated.split(literal).length, 2, literal);
  assert.doesNotMatch(generated, /postAudioCommand\.visualDiffPixels >= 2_000/u);
  assert.match(generated, /firstCommand\.visualDiffPixels >= 2_000/u); // No initial fixture relaxation.
  assert.match(generated, /postAudioCommand\.baselineMatches,\[\]/u);
  assert.match(generated, /quietTextFocus = \{ rawFocus:milestones\.quietText\.observed\.focus/u);
});

async function setupFixture({ paused = true, soundFailure = false } = {}) {
  const calls = [], oldSnapshot = { sha256: SEAL.snapshotSha256, preFrontBufferCrc: "9c53f290" };
  const nextSnapshot = { sha256: "unitOnly-derived", preFrontBufferCrc: "12345678", byteLength: 2, machineResume: { paused: true } };
  let pointerFrames = 0, isPaused = false;
  const window = { __desktopCursor: { focusGuestPoint: () => ({ x: 650, y: 60 }), renderedCursor: point => point },
    __desktopController: { pause: () => { calls.push("pause"); isPaused = paused; }, isPaused: () => isPaused },
    __desktopTerminal: { state: () => ({ pointerFrames }), presentation: () => ({ successfulPresents: 5 }),
      storedDesktopSnapshot: () => ({ bytes: [1, 2] }), saveDesktopSnapshot: options => {
        assert.equal(options.persist, true); assert.equal(isPaused, true); calls.push("save"); return nextSnapshot;
      } } };
  const context = vm.createContext({ assert, path, window, performance: { now: () => 999 },
    milestones: {}, normalSnapshot: oldSnapshot, restoreUrl: "unitOnly-url", out: "/unitOnly", postRestoreStart: 77,
    desktopBox: async () => ({}), guestPoint: (_box, x, y) => ({ x, y }),
    page: { evaluate: async (fn, arg) => fn(arg), mouse: {
      click: async () => { calls.push("setup-click"); }, move: async () => { pointerFrames++; calls.push("cursor-move"); } },
      waitForFunction: async (fn, arg) => { assert.ok(fn(arg)); calls.push("cursor-ack"); },
      waitForTimeout: async ms => { assert.equal(ms, 2000); calls.push("setup-settle"); },
      screenshot: async () => { calls.push("screenshot"); } },
    reloadWithAutoRestore: async (_url, label, initial) => {
      calls.push(`reload:${label}:${initial}`);
      if (initial) return { snapshotSha256: oldSnapshot.sha256, observation: { firstPresent: { crc32: oldSnapshot.preFrontBufferCrc } } };
      assert.equal(isPaused, true); assert.equal(context.normalSnapshot, nextSnapshot);
      return { unitOnly: true };
    },
    typeCommand: async (command, marker, timeout, delay) => {
      assert.equal(command, "e5_print_observation(){ :; };printf '\\033[42mquiet-probe-ready\\033[0m\\n'");
      assert.deepEqual([marker, timeout, delay], ["quiet-probe-ready", 120_000, 100]);
      calls.push("physical-setup"); return { accepted: true, inputSequenceMatch: true, redMarkerSeen: false };
    },
    auditRestoreCoherence: async () => { calls.push("baseline-authentication"); },
    parsePreparedSound: (bytes, digest) => {
      assert.deepEqual([...bytes], [1, 2]); assert.equal(digest, nextSnapshot.sha256); calls.push("prepared-sound-audit");
      if (soundFailure) throw new Error("unitOnly: nonzero queued PCM"); return { unitOnly: true };
    },
    auditFrozenSnapshot: async snapshot => { assert.equal(snapshot, nextSnapshot); assert.equal(isPaused, true); calls.push("frozen-audit"); },
    mkdir: async () => {},
  });
  const code = extractUnique(generated, "  const baselineRestore =", "  milestones.normalRestore = { result: firstRestore,");
  let error;
  try { await vm.runInContext(`(async () => { ${code} })()`, context); } catch (caught) { error = caught; }
  assert.equal(context.postRestoreStart, 77, "setup must not assign the original timed boundary");
  return { calls, error, milestones: context.milestones };
}

test("actual setup orders authenticated restore, only printer suppression, cursor/settle, frozen audit and nonhydrating reload", async () => {
  const f = await setupFixture(); assert.equal(f.error, undefined);
  assert.deepEqual(f.calls, ["reload:baseline-before-quiet:true", "baseline-authentication", "setup-click", "physical-setup",
    "cursor-move", "cursor-ack", "setup-settle", "pause", "save", "prepared-sound-audit", "frozen-audit", "screenshot", "reload:quiet-probe:false"]);
  assert.equal(f.milestones.quietProbe.acceptance, false);
  for (const options of [{ paused: false }, { soundFailure: true }]) {
    const failed = await setupFixture(options); assert.ok(failed.error);
    assert.ok(!failed.calls.includes("reload:quiet-probe:false"));
  }
});

test("actual generated module syntax and absolute imports are valid without executing browser code", () => {
  const checked = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: generated, encoding: "utf8", timeout: 10_000 });
  assert.equal(checked.error, undefined); assert.equal(checked.status, 0, checked.stderr);
  assert.doesNotMatch(generated, /from "\.\.?\//u);
  assert.ok(generated.includes(`const repo = ${JSON.stringify(repo)};`));
  for (const match of generated.matchAll(/from "(file:[^"]+)"/gu)) {
    assert.ok(fileURLToPath(match[1]).startsWith(repo + path.sep));
    assert.ok(readFileSync(fileURLToPath(match[1])).length > 0);
  }
});

test("factory retains source/pins/invocation in a new owned directory and refuses overwrites or symlinks", async t => {
  const empty = mkdtempSync(path.join(repo, "target/e5-t26f/single-process-quiet-test-"));
  const output = empty + "-generated", link = empty + "-link";
  t.after(() => { for (const target of [link, output, empty]) rmSync(target, { recursive: true, force: true }); });
  const metadata = await generateQuietProbe(output, env());
  const bytes = readFileSync(path.join(output, "probe.mjs")), recordBytes = readFileSync(path.join(output, "factory.json"));
  assert.equal(bytes.toString(), generated); assert.equal(sha256(bytes), metadata.generatedSourceSha256);
  assert.deepEqual(JSON.parse(recordBytes), metadata);
  assert.equal(metadata.acceptance, false); assert.equal(metadata.fVerified, false);
  assert.deepEqual(metadata.sourcePins, SOURCE_PINS); assert.deepEqual(metadata.seal, SEAL);
  assert.deepEqual(metadata.invocation.argv, [process.execPath, path.join(output, "probe.mjs")]);
  assert.deepEqual(metadata.invocation.env, env());
  for (const existing of [empty, output]) await assert.rejects(generateQuietProbe(existing, env()), /EEXIST/u);
  symlinkSync(empty, link); await assert.rejects(generateQuietProbe(link, env()), /EEXIST/u);
  await assert.rejects(generateQuietProbe(path.join(repo, "tools/verify/no-write"), env()), /task-owned/u);
  assert.deepEqual(readFileSync(path.join(output, "probe.mjs")), bytes);
  assert.deepEqual(readFileSync(path.join(output, "factory.json")), recordBytes);
});
