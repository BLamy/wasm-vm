import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { RESIDENT_KIND, RESIDENT_BASE_SHA, RESIDENT_GUEST_PATH, residentFixtureRequested,
  assertResidentImage, parsePreparedSound, assertFreshLockedPcm } from "./e5-t26f-resident-proof.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
const json = value => JSON.parse(JSON.stringify(value));
const resident = { E5_T26F_FIXTURE: RESIDENT_KIND };

test("resident fixture is exact opt-in; every tuning and command override refuses", () => {
  assert.equal(residentFixtureRequested({}), false);
  assert.equal(residentFixtureRequested(resident), true);
  for (const value of ["", "resident", "resident-aplay-v1 ", true, 1, null, [RESIDENT_KIND]]) {
    assert.throws(() => residentFixtureRequested({ E5_T26F_FIXTURE: value }));
  }
  for (const key of ["KEY_DELAY_MS", "JIT", "RESIDENCY", "GUEST_CLOCK", "ICOUNT_DIVIDER"]) {
    for (const value of ["", "0", "1", "100", undefined]) {
      const env = { ...resident, [`E5_T26F_DIAGNOSTIC_${key}`]: value };
      if (value === undefined) assert.equal(residentFixtureRequested(env), true);
      else assert.throws(() => residentFixtureRequested(env), /fixed command\/pacing/);
    }
  }
});

test("resident phase timing presets use fixed 100-ms physical edges only for the two admitted reuse commands", () => {
  const select = env => vm.runInNewContext(between("function diagnosticOptions", "const DIAGNOSTIC_OWNER") +
    "\n({postRestoreCommand,postRestoreKeyDelayMs})", { assert, path, process: { env }, residentFixtureRequested });
  for (const command of ["times;e5_observe;times;play", "times;e5_print_observation post;times;play", "play", "true", "", "time play"]) {
    for (const mode of [undefined, "create", "reuse"]) {
      const env = { ...resident, E5_T26F_DIAGNOSTIC: mode, E5_T26F_DIAGNOSTIC_COMMAND: command,
        E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/resident-unit", E5_T26F_DIAGNOSTIC_PORT: "48123" };
      if (mode === "reuse" && ["times;e5_observe;times;play", "times;e5_print_observation post;times;play"].includes(command)) {
        assert.equal(residentFixtureRequested(env), true);
        assert.deepEqual(json(select(env)), { postRestoreCommand: command, postRestoreKeyDelayMs: 100 });
      } else {
        assert.throws(() => residentFixtureRequested(env), /exact diagnostic reuse/);
        assert.throws(() => select(env));
      }
      assert.throws(() => residentFixtureRequested({ ...env, E5_T26F_DIAGNOSTIC_COMPLETE: "1" }), /exact diagnostic reuse/);
      assert.throws(() => select({ ...env, E5_T26F_DIAGNOSTIC_COMPLETE: "1" }));
    }
  }
});

test("read-only resident profiling is exact reuse-only and can never enter cold, normal acceptance or COMPLETE", () => {
  for (const key of ["CPU", "LATENCY"]) {
    for (const mode of [undefined, "create", "reuse"]) for (const value of ["", "0", "1", true, 1, "1 "]) {
      const env = { ...resident, E5_T26F_DIAGNOSTIC: mode, [`E5_T26F_DIAGNOSTIC_${key}`]: value };
      if (mode === "reuse" && value === "1") assert.equal(residentFixtureRequested(env), true);
      else assert.throws(() => residentFixtureRequested(env), /diagnostic reuse only/);
      assert.throws(() => residentFixtureRequested({ ...env, E5_T26F_DIAGNOSTIC_COMPLETE: "1" }), /diagnostic reuse only/);
    }
  }
});

test("actual runner keeps normal, cold, reuse and COMPLETE resident play at 5-ms edges", () => {
  const select = env => vm.runInNewContext(between("function diagnosticOptions", "const DIAGNOSTIC_OWNER") +
    "\n({diagnostic, residentFixture, postRestoreCommand, postRestoreKeyDelayMs})", { assert, path, process: { env }, residentFixtureRequested });
  for (const mode of [undefined, "create", "reuse", "complete"]) {
    const env = mode ? { E5_T26F_DIAGNOSTIC: mode === "complete" ? "reuse" : mode, E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/resident-unit",
      E5_T26F_DIAGNOSTIC_PORT: "48123" } : {};
    if (mode === "complete") env.E5_T26F_DIAGNOSTIC_COMPLETE = "1";
    const legacy = select(env), current = select({ ...env, ...resident });
    assert.equal(legacy.postRestoreCommand, "sh /tmp/a");
    assert.equal(legacy.postRestoreKeyDelayMs, 0);
    assert.equal(current.postRestoreCommand, "play");
    assert.equal(current.postRestoreKeyDelayMs, 5);
    assert.deepEqual(json(current.diagnostic), json(legacy.diagnostic));
  }
});

test("the same command text without resident opt-in does not override existing diagnostic pacing", () => {
  const select = env => vm.runInNewContext(between("function diagnosticOptions", "const DIAGNOSTIC_OWNER") +
    "\n({postRestoreCommand,postRestoreKeyDelayMs})", { assert, path, process: { env }, residentFixtureRequested });
  for (const command of ["times;e5_observe;times;play", "times;e5_print_observation post;times;play"]) {
    for (const delay of [undefined, "5", "25"]) {
      const env = { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/resident-unit",
        E5_T26F_DIAGNOSTIC_PORT: "48123", E5_T26F_DIAGNOSTIC_COMMAND: command };
      if (delay !== undefined) env.E5_T26F_DIAGNOSTIC_KEY_DELAY_MS = delay;
      assert.deepEqual(json(select(env)), { postRestoreCommand: command, postRestoreKeyDelayMs: Number(delay ?? 0) });
    }
  }
});

test("resident image binding checks frozen helper, original base and actual install path", () => {
  const helper = "a".repeat(64);
  const fixture = { kind: RESIDENT_KIND, helperSha256: helper, baseSha256: RESIDENT_BASE_SHA, guestPath: RESIDENT_GUEST_PATH };
  assert.deepEqual(assertResidentImage({ fixture }, helper), fixture);
  assert.throws(() => assertResidentImage({}, helper));
  for (const key of Object.keys(fixture)) {
    assert.throws(() => assertResidentImage({ fixture: { ...fixture, [key]: "wrong" } }, helper));
  }
  assert.throws(() => assertResidentImage({ fixture }, "not-a-digest"));
});

// Independent minimal fixture follows the documented Rust byte layout; no
// serializer from the implementation under test supplies these golden offsets.
function soundPayload() {
  const bytes = Buffer.alloc(184);
  bytes.write("WVSND001"); bytes.writeUInt16LE(1, 8);
  bytes.writeBigUInt64LE(1n << 7n, 16);
  bytes[48] = 2; bytes[49] = 1;
  bytes.writeUInt32LE(0x101, 52); bytes.writeUInt32LE(3840, 60); bytes.writeUInt32LE(1920, 64);
  bytes[72] = 2; bytes[73] = 5; bytes[74] = 7;
  return bytes;
}
function envelope(sections = [{ tag: 3, payload: soundPayload() }]) {
  const header = Buffer.alloc(28); header.write("WVMDESK1"); header.writeUInt16LE(1, 8);
  header.writeBigUInt64LE(123n, 12); header.writeUInt32LE(sections.length, 20);
  const body = Buffer.concat(sections.map(({ tag, payload }) => {
    const section = Buffer.alloc(40); section.writeUInt16LE(tag); section.writeUInt16LE(1, 2);
    section.writeUInt32LE(payload.length, 4); Buffer.from(hash(payload), "hex").copy(section, 8);
    return Buffer.concat([section, payload]);
  }));
  header.writeUInt32LE(body.length, 24);
  const whole = Buffer.concat([header, body]);
  return Buffer.concat([whole, Buffer.from(hash(whole), "hex")]);
}
const parse = bytes => parsePreparedSound(bytes, hash(bytes));

test("actual envelope authenticates prepared stereo parameters and empty TX metadata", () => {
  const bytes = envelope(), result = parse(bytes);
  assert.equal(result.envelopeSha256, hash(bytes));
  assert.equal(result.soundSha256, hash(soundPayload()));
  assert.deepEqual([result.state, result.bufferBytes, result.periodBytes, result.pendingTransfers, result.pendingBytes], [2, 3840, 1920, 0, 0]);
  assert.deepEqual(parsePreparedSound([...bytes], hash(bytes)), result);
});

test("fully rehashed sound-state and queue mutations fail, so valid hashes cannot stand in for empty prepared playback", () => {
  const mutations = [[48, 3, 1], [49, 0, 1], [52, 0x100, 4], [56, 1, 4], [60, 4096, 4],
    [64, 960, 4], [72, 1, 1], [73, 4, 1], [74, 6, 1], [104, 1, 4], [108, 4, 4],
    [120, 1, 1], [124, 1, 1], [178, 1, 1], [180, 1, 1]];
  for (const [offset, value, width] of mutations) {
    const payload = soundPayload(); payload.writeUIntLE(value, offset, width);
    assert.throws(() => parse(envelope([{ tag: 3, payload }])), assert.AssertionError, `offset ${offset}`);
  }
});

test("capture XRUN and unrelated kicks are retained without claiming they contain playback PCM", () => {
  const payload = Buffer.concat([soundPayload(), Buffer.alloc(8)]);
  payload.writeUInt32LE(1, 164); payload.writeUInt32LE(0x111, 184); payload.writeUInt32LE(1, 188);
  payload[12] = 1;
  payload[176] = 1; payload[177] = 1; payload[179] = 1;
  const result = parse(envelope([{ tag: 3, payload }]));
  assert.equal(result.eventCount, 1); assert.deepEqual(result.kicked, [1, 1, 0, 1]);
  assert.deepEqual(result.events, [{ code: 0x111, stream: 1 }]);
  payload[12] = 0;
  assert.throws(() => parse(envelope([{ tag: 3, payload }])), /capture event requires enabled/);
});

test("queued playback XRUN refuses even with rehashed envelope, no scheduled XRUN and only event kick", () => {
  const payload = Buffer.concat([soundPayload(), Buffer.alloc(8)]);
  payload.writeUInt32LE(1, 164); payload.writeUInt32LE(0x111, 184); payload[177] = 1;
  assert.throws(() => parse(envelope([{ tag: 3, payload }])), /queued playback XRUN/);
  for (const [code, stream] of [[0x1100, 1], [0x110, 0], [0x111, 2]]) {
    payload.writeUInt32LE(code, 184); payload.writeUInt32LE(stream, 188);
    assert.throws(() => parse(envelope([{ tag: 3, payload }])), /unsupported sound snapshot event/);
  }
});

test("digest, format, missing/duplicate sections, bounds and malformed sound event lengths refuse", () => {
  const valid = envelope();
  assert.throws(() => parsePreparedSound(valid, "0".repeat(64)), /evidence digest/);
  for (const index of [0, 8, 10, 24, 28, 30, 32, 36, 68, valid.length - 1]) {
    const bytes = Buffer.from(valid); bytes[index] ^= 1;
    assert.throws(() => parse(bytes), assert.AssertionError);
  }
  for (const bytes of [Buffer.alloc(0), valid.subarray(0, 59), valid.subarray(0, -1),
    envelope([]), envelope([{ tag: 1, payload: Buffer.alloc(0) }]),
    envelope([{ tag: 3, payload: soundPayload() }, { tag: 3, payload: soundPayload() }]),
    envelope([{ tag: 5, payload: soundPayload() }]), envelope([{ tag: 3, payload: Buffer.alloc(183) }])]) {
    assert.throws(() => parse(bytes), assert.AssertionError);
  }
  for (const offset of [0, 8, 10, 164]) {
    const payload = soundPayload(); payload[offset] ^= 1;
    assert.throws(() => parse(envelope([{ tag: 3, payload }])), assert.AssertionError);
  }
});

function fresh(at = 1001) {
  return { observedAt: at, policy: "locked", context: "suspended",
    pcm: { available: true, writeIndex: 0, readIndex: 0, fillFrames: 0, nonSilentFrames: 0, maxAbs: 0 } };
}
test("fresh host ring requires actual zero indices, silence and suspended locked context", () => {
  const sample = fresh(); assert.equal(assertFreshLockedPcm(sample), sample);
  for (const key of ["writeIndex", "readIndex", "fillFrames", "nonSilentFrames", "maxAbs"]) {
    for (const value of [1, -1, undefined, NaN]) {
      assert.throws(() => assertFreshLockedPcm({ ...sample, pcm: { ...sample.pcm, [key]: value } }));
    }
  }
  for (const change of [{ observedAt: NaN }, { observedAt: -1 }, { policy: "unlocked" }, { context: "running" }, { pcm: null }]) {
    assert.throws(() => assertFreshLockedPcm({ ...sample, ...change }));
  }
});

test("resident pre-gesture checks execute inside original T0, twice before real down/up and refuse early PCM", async () => {
  const block = between("  if (residentFixture) {\n    assert.equal(firstRestore.report.soundXrunEvents", "  await page.waitForFunction(\n    (minimum)");
  async function run({ samples = [fresh(1100), fresh(1450)], xruns = 0 } = {}) {
    const events = [], milestones = {};
    const sandbox = { assert, assertFreshLockedPcm, residentFixture: true, firstRestore: { report: { soundXrunEvents: xruns } },
      postRestoreStart: 1000, milestones, focusClient: { x: 1, y: 2 },
      page: { evaluate: async fn => {
        if (fn.toString().includes("observedAt")) { events.push("observe"); return samples.shift(); }
        events.push("policy"); return "locked";
      }, mouse: { move: async () => events.push("move"), down: async () => events.push("down"), up: async () => events.push("up") },
      waitForTimeout: async ms => { assert.equal(ms, 350); events.push("delay"); } } };
    let error;
    try { await vm.runInNewContext(`(async () => {${block}})()`, sandbox); } catch (caught) { error = caught; }
    return { events, milestones, error };
  }
  const good = await run(); assert.equal(good.error, undefined);
  assert.deepEqual(good.events, ["observe", "move", "delay", "policy", "observe", "down", "up"]);
  assert.equal(good.milestones.residentBeforeGesture.length, 2);
  for (const options of [{ xruns: 1 }, { samples: [fresh(999), fresh(1450)] },
    { samples: [fresh(1100), fresh(1100)] }, { samples: [fresh(1100), { ...fresh(1450), pcm: { ...fresh().pcm, writeIndex: 480 } }] }]) {
    const result = await run(options); assert.ok(result.error);
    assert.equal(result.events.includes("down"), false);
  }
});

test("resident mode uses the protected output guard even without diagnostic completion", async () => {
  const helper = between("async function requireEmptyCompletionOutput", "assert.ok(Number.isSafeInteger(timeoutMs)");
  const call = source.match(/^if \(diagnostic\?\.complete \|\| residentFixture\) await requireEmptyCompletionOutput\(out\);$/m)[0];
  for (const entries of [[], ["existing.json"]]) {
    const sandbox = { assert, diagnostic: null, residentFixture: true, out: "/virtual/resident", mkdir: async () => {}, readdir: async () => entries };
    const run = () => vm.runInNewContext(`${helper}\n(async()=>{${call}})()`, sandbox);
    if (entries.length) await assert.rejects(run(), /refuses nonempty/); else await run();
  }
});

test("actual preparation requires physical command acceptance and fresh green without red before snapshot", async () => {
  const block = between('  if (residentFixture) {\n    phaseProgress("resident:prepare-real-player")', '\n\n  phaseProgress("cursor:initial-render")');
  const fixtureBinding = { helperSha256: "a".repeat(64) };
  const valid = { accepted: true, inputSequenceMatch: true, terminalMarkerSeen: true, redMarkerSeen: false };
  for (const change of [{}, { accepted: false }, { inputSequenceMatch: false }, { terminalMarkerSeen: false }, { redMarkerSeen: true }]) {
    const milestones = {}, phases = [], prepared = { ...valid, ...change };
    const sandbox = { assert, residentFixture: true, fixtureBinding, milestones, RESIDENT_GUEST_PATH,
      phaseProgress: (...args) => phases.push(args), typeCommand: async (command, marker) => {
        assert.equal(command, `. ${RESIDENT_GUEST_PATH} && e5_prepare`);
        assert.equal(marker, "e5t26f-prepared"); return prepared;
      } };
    const run = () => vm.runInNewContext(`(async()=>{${block}})()`, sandbox);
    if (Object.keys(change).length) {
      await assert.rejects(run()); assert.equal(milestones.residentCheckpoint, undefined);
      assert.equal(phases.some(([, phase]) => phase === "done"), false);
    } else {
      await run(); assert.equal(milestones.residentCheckpoint.prepared, prepared);
      assert.equal(milestones.residentCheckpoint.fixture, fixtureBinding);
    }
  }
});

test("reuse authenticates exact saved sound bytes and retained screenshot, not a worker's prepared summary", async () => {
  const block = between('    if (residentFixture) {\n      const proof = diagnosticCheckpoint.resident;', '\n  } else {\n  phaseProgress("browser:initial-load")');
  const bytes = envelope(), normalSnapshot = { sha256: hash(bytes) }, fixtureBinding = { kind: RESIDENT_KIND };
  const makeProof = () => ({ fixture: fixtureBinding, prepared: { command: `. ${RESIDENT_GUEST_PATH} && e5_prepare`,
    accepted: true, inputSequenceMatch: true, terminalMarkerSeen: true, redMarkerSeen: false },
    sound: parse(bytes), screenshot: { file: "evidence/resident/prepared.png", sha256: "c".repeat(64) } });
  const attacks = [() => {}, p => { p.fixture = {}; }, p => { p.prepared.command = "true"; },
    p => { p.prepared.accepted = false; }, p => { p.prepared.inputSequenceMatch = false; },
    p => { p.prepared.terminalMarkerSeen = false; }, p => { p.prepared.redMarkerSeen = true; },
    p => { p.sound.pendingTransfers = 1; }, p => { p.screenshot.file = "../outside.png"; },
    p => { p.screenshot.sha256 = "d".repeat(64); }];
  for (const [index, attack] of attacks.entries()) {
    const proof = makeProof(); attack(proof);
    const milestones = {}, sandbox = { assert, Buffer, path, residentFixture: true, normalSnapshot, fixtureBinding,
      RESIDENT_GUEST_PATH, parsePreparedSound, repo: "/repo", milestones,
      diagnosticCheckpoint: { resident: proof, session: { value: JSON.stringify({ bytes: bytes.toString("base64") }) } },
      lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }), sha256File: async () => "c".repeat(64) };
    const run = () => vm.runInNewContext(`(async()=>{${block}})()`, sandbox);
    if (index === 0) { await run(); assert.equal(milestones.residentCheckpoint, proof); }
    else { await assert.rejects(run()); assert.equal(milestones.residentCheckpoint, undefined); }
  }
});
