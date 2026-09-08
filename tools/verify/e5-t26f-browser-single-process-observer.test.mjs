// Execute actual wrapper control flow with explicit child/FS stubs. Not browser evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("./e5-t26f-browser-single-process-observer.mjs", import.meta.url), "utf8");
const body = source.slice(source.indexOf("const repo =")).replace("import.meta.url", '"file:///runner"');
test("wrapper resolves the real held collector without launching a browser", async () => {
  const imports = [...source.matchAll(/from "(\.\/[^"]+)"/gu)];
  assert.equal(imports.length, 1);
  assert.equal(imports[0][1], "./e5-t26f-compile-queue-observation.mjs");
  const actual = await import(imports[0][1]);
  assert.equal(typeof actual.compileQueueObservation, "function");
});

async function exercise({ env = {}, exits = [[0, null], [1, null]], existing = false,
  wrongHead = false, wrongBindingHead = false, collectorError = false, changedSource = false } = {}) {
  const writes = [], spawns = [], directories = [], observations = [];
  let tempCalls = 0, sourceReads = 0;
  const head = "a".repeat(40);
  const scope = {
    assert, path, fileURLToPath: () => "/repo/tools/verify/runner.mjs", os: { tmpdir: () => "/tmp" },
    process: { env, execPath: "/node", stdout: { write() {} } }, console: { log() {} },
    execFileSync: () => head,
    createHash: () => ({ update(bytes) { this.value = String(bytes); return this; }, digest() { return this.value; } }),
    mkdir: async (p, options) => { directories.push(p); if (existing && !options) throw new Error("EEXIST"); },
    mkdtemp: async p => { tempCalls++; return `${p}unique`; },
    readFile: async p => {
      if (p.endsWith("-checks.json") || p.endsWith("diagnostic-iteration.json"))
        return JSON.stringify({ ...(p.endsWith("-checks.json") || wrongHead ? { head: wrongHead ? "wrong" : head } : {}),
          milestones: { run: { binding: { head: wrongBindingHead ? "wrong" : head } } }, fixture: "unit-only" });
      sourceReads++; return changedSource && sourceReads > 17 ? "changed" : "source";
    },
    writeFile: async (p, bytes, options) => { assert.equal(options.flag, "wx"); writes.push({ p, bytes }); },
    spawn: (executable, args, options) => {
      spawns.push({ executable, args, options });
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      const result = exits[spawns.length - 1];
      queueMicrotask(() => { child.stdout.emit("data", "unit-only transcript\n"); child.emit("close", ...result); });
      return child;
    },
    compileQueueObservation: (raw, code) => {
      observations.push({ raw, code });
      if (collectorError) throw new Error("collector refused non-cap failure");
      return { acceptance: false, fVerified: false, elapsedMs: code === 0 ? 1900 : 4000,
        fTimingPassed: code === 0, deltas: {} };
    },
  };
  let error;
  try { await vm.runInNewContext(`(async () => { ${body} })()`, scope); } catch (e) { error = e; }
  return { writes, spawns, directories, observations, tempCalls, error };
}

test("actual wrapper creates a new seal and only the unchanged default-policy reuse", async () => {
  const r = await exercise({ env: { PATH: "/bin", E5_T26F_SINGLE_PROCESS_OUT: "/fresh", E5_T26L_CHECKPOINT: "/old",
    E5_T26F_DIAGNOSTIC_COMMAND: "fake", E5_T26F_DIAGNOSTIC_JIT: "0", E5_T26K_CHECKPOINT: "/old",
    E5_T18B_KERNEL: "wrong", CARGO_TEST: "bad", RUSTFLAGS: "bad", RUST_LOG: "trace" } });
  assert.equal(r.error, undefined); assert.equal(r.tempCalls, 1); assert.equal(r.spawns.length, 2);
  const cold = r.spawns[0].options.env, reuse = r.spawns[1].options.env;
  assert.equal(cold.E5_T26F_DIAGNOSTIC, "create"); assert.equal(cold.E5_T26F_DIAGNOSTIC_JIT, undefined);
  assert.equal(cold.E5_T26F_DIAGNOSTIC_PROFILE, "/tmp/e5-t26f-single-process-observer-unique");
  assert.equal(cold.E5_T26F_DIAGNOSTIC_PORT, "61637"); assert.equal(cold.E5_T26F_HEADED, "0");
  assert.equal(cold.E5_T26F_IMAGE, "target/e5-t26f/resident-image-single-process-observer-v1/alpine-rootfs.ext4");
  assert.equal(cold.E5_T26F_IMAGE_INFO, "target/e5-t26f/resident-image-single-process-observer-v1/desktop-info.json");
  assert.equal(cold.E5_T26F_DESKTOP_ASSET_DIR, "target/e5-t26f/chunks/resident-single-process-observer-v1");
  assert.equal(reuse.E5_T26F_DIAGNOSTIC, "reuse"); assert.equal(reuse.E5_T26F_DIAGNOSTIC_JIT, "1");
  assert.equal(reuse.E5_T26F_DIAGNOSTIC_RESIDENCY, "repack-off");
  for (const key of ["E5_T26L_CHECKPOINT", "E5_T26K_CHECKPOINT", "E5_T26F_DIAGNOSTIC_COMMAND", "E5_T18B_KERNEL", "CARGO_TEST", "RUSTFLAGS", "RUST_LOG"])
    assert.equal(reuse[key], undefined);
  assert.equal(reuse.PATH, "/bin"); assert.equal(r.observations[0].code, 1);
  assert.equal(r.writes[0].p, "/fresh/invocation.json"); // Never prepopulate the protected child directory.
  const bindings = JSON.parse(r.writes[0].bytes).sourceBindings;
  assert.equal(Object.keys(bindings).length, 17);
  for (const file of ["tools/guest/e5-t26f-resident-observer.sh", "tools/verify/e5-t26f-observer-image.mjs",
    "tools/chunk_image.py", cold.E5_T26F_IMAGE_INFO, `${cold.E5_T26F_DESKTOP_ASSET_DIR}/manifest.json`])
    assert.equal(bindings[file], "source");
  assert.equal(r.writes.filter(w => w.p.endsWith("exit.json")).length, 2);
  const final = JSON.parse(r.writes.at(-1).bytes);
  assert.equal(final.fVerified, false); assert.equal(final.fTimingPassed, false);
  assert.equal(final.record, "../fresh/reuse/failure-post-restore-interaction-checks.json");
});

test("existing attempt refuses before seal creation, writes or child launch", async () => {
  const r = await exercise({ existing: true });
  assert.match(r.error.message, /EEXIST/); assert.equal(r.tempCalls, 0);
  assert.equal(r.spawns.length, 0); assert.equal(r.writes.length, 0);
});

test("cold failure or signalled child retains transcript/exit and never launches reuse", async () => {
  for (const result of [[1, null], [null, "SIGTERM"]]) {
    const r = await exercise({ exits: [result] });
    assert.ok(r.error); assert.equal(r.spawns.length, 1); assert.equal(r.observations.length, 0);
    assert.ok(r.writes.some(w => w.p.endsWith("run.log")));
    assert.deepEqual(JSON.parse(r.writes.at(-1).bytes), { code: result[0], signal: result[1] });
  }
});

test("successful timing keeps non-acceptance and uses the success record", async () => {
  const r = await exercise({ exits: [[0, null], [0, null]] });
  assert.equal(r.error, undefined); assert.equal(r.observations[0].code, 0);
  const final = JSON.parse(r.writes.at(-1).bytes);
  assert.equal(final.fTimingPassed, true); assert.equal(final.fVerified, false); assert.equal(final.acceptance, false);
  assert.equal(r.observations[0].raw.head, undefined); // Proper F success producer has only the nested binding.
  assert.equal(final.head, "a".repeat(40));
  assert.ok(final.record.endsWith("/diagnostic-iteration.json"));
});

test("non-cap failure, wrong recorded head, or source mutation cannot emit an observation", async () => {
  for (const options of [{ collectorError: true }, { wrongHead: true }, { wrongBindingHead: true },
    { wrongBindingHead: true, exits: [[0, null], [0, null]] }, { wrongHead: true, exits: [[0, null], [0, null]] }, { changedSource: true }]) {
    const r = await exercise(options);
    assert.ok(r.error); assert.equal(r.spawns.length, 2);
    assert.ok(!r.writes.some(w => w.p.endsWith("observation.json")));
    assert.equal(r.writes.filter(w => w.p.endsWith("exit.json")).length, 2);
  }
});
