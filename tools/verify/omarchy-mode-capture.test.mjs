// Execute the recorder's actual export body with explicit synthetic storage.
// These tiny fixtures prove harness ordering/rejection, never a guest checkpoint.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createGzip, gunzipSync } from "node:zlib";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";

async function captureFixture({ wrongSeed = false, decision = "resume", initiallyPaused = true } = {}) {
  const source = await fs.readFile(new URL("./omarchy-desktop-live.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function capturePair("), end = source.indexOf("async function runLive()", start);
  assert.ok(start > 0 && end > start);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-capture-fixture-"));
  const base = "a".repeat(64), generation = 7, trace = [], opened = [], report = {};
  const candidate = { source: { bootSnapshot: { sha256: "synthetic-snapshot" }, overlayDelta: { sha256: "synthetic-delta" } } };
  const seed = createHash("sha256").update("synthetic-snapshot:synthetic-delta").digest("hex");
  const exactName = `wvov-${base}-seed-${seed}`;
  const snapshot = Buffer.alloc(1048577);
  snapshot.write("WVMRESU1"); snapshot.writeUInt32LE(1, 8); snapshot.write("0.0.1", 12);
  Buffer.from(base, "hex").copy(snapshot, 44); snapshot.writeBigUInt64LE(BigInt(generation), 76);
  const blocks = new Map([[3, Buffer.alloc(4096, 3)], [9, Buffer.alloc(4096, 9)]]);
  const request = result => { const r = { result }; queueMicrotask(() => r.onsuccess()); return r; };
  const db = { objectStoreNames: { contains: name => name === "blocks" },
    close() { trace.push("db-close"); },
    transaction(name) {
      assert.equal(name, "blocks");
      return { objectStore(store) {
        assert.equal(store, "blocks");
        return { getAllKeys: () => request([...blocks.keys()]), get: key => request(blocks.get(key)) };
      } };
    } };
  const window = {
    __linux: { pause: () => trace.push("pause"), isPaused: () => initiallyPaused,
      resume: () => { throw Error("strict capture must never resume"); } },
    __persist: () => trace.push("persist"),
    __persistStats: () => { trace.push("drained"); return { pendingBlocks: 0, flushWaiting: false, writeWaiting: false }; },
    __snapshotSave: () => { trace.push("save"); return true; },
    __snapshotExport: () => { trace.push("export"); return snapshot; },
    __snapshotGeneration: () => generation,
    __snapshotDecision: () => decision,
    __linuxCtl: { overlaySeedIdentity: () => wrongSeed ? "f".repeat(64) : seed },
  };
  const context = vm.createContext({ window, btoa: s => Buffer.from(s, "binary").toString("base64"),
    indexedDB: { databases: async () => [{ name: `wvsn-${base}` }, { name: `wvov-${base}` },
      { name: `wvov-${base}-seed-${"b".repeat(64)}` }, { name: exactName }],
      open: name => { opened.push(name); return request(db); } } });
  const page = { evaluate(fn, argument) { context.argument = argument; return vm.runInContext(`(${fn})(argument)`, context); } };
  const hashFile = async filename => { const bytes = await fs.readFile(filename); return {
    size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; };
  const bindings = { coldPair: false, modePair: true, out: directory, page, report, assert, setTimeout,
    createGzip, createWriteStream, once, path, Buffer, createHash, candidate, hashFile, console: { log() {} },
    baseBinding: base, pairDirectory: directory };
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  let error;
  try { await new AsyncFunction(...Object.keys(bindings), `${source.slice(start, end)}\nreturn capturePair(baseBinding, pairDirectory);`)(...Object.values(bindings)); }
  catch (caught) { error = caught; }
  return { directory, base, generation, snapshot, blocks, exactName, trace, opened, report, error };
}

test("actual warm capture exports every exact-seed block while paused and binds both headers", async () => {
  const f = await captureFixture();
  try {
    assert.equal(f.error, undefined);
    assert.deepEqual(f.trace, ["pause", "persist", "drained", "drained", "save", "export", "db-close"]);
    assert.deepEqual(f.opened, [f.exactName]);
    assert.equal(f.report.pair.paused, true); assert.equal(f.report.pair.restoreDecision, "resume");
    assert.deepEqual(gunzipSync(await fs.readFile(f.report.pair.snapshot.filename)), f.snapshot);
    const delta = gunzipSync(await fs.readFile(f.report.pair.delta.filename));
    assert.equal(delta.length, 61+2*4104); assert.equal(delta.subarray(0,5).toString(), "WVOD1");
    assert.equal(delta.subarray(17,49).toString("hex"), f.base);
    assert.equal(delta.readBigUInt64LE(49), BigInt(f.generation)); assert.equal(delta.readUInt32LE(57), 2);
    for (const [i, [index, bytes]] of [...f.blocks].entries()) {
      assert.equal(delta.readBigUInt64LE(61+i*4104), BigInt(index));
      assert.deepEqual(delta.subarray(69+i*4104,69+i*4104+4096), bytes);
    }
  } finally { await fs.rm(f.directory, { recursive: true, force: true }); }
});

test("actual warm capture rejects a running guest, foreign overlay seed and stale restore decision", async () => {
  for (const [options, expected] of [[{initiallyPaused:false}, /false !== true/],
    [{wrongSeed:true}, /wrong warm overlay namespace/], [{decision:"stale"}, /not coherent/]]) {
    const f = await captureFixture(options);
    try {
      assert.match(String(f.error), expected);
      if (options.initiallyPaused === false) assert.deepEqual(f.trace, ["pause"]);
      if (options.wrongSeed) { assert.deepEqual(f.opened, []); assert.equal(f.report.pair, undefined); }
      if (options.decision) assert.equal(f.report.pair.restoreDecision, "stale");
    } finally { await fs.rm(f.directory, { recursive: true, force: true }); }
  }
});
