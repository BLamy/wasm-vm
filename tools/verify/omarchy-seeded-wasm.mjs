#!/usr/bin/env node
// Real wasm boundary tests with a tiny synthetic guest fixture. Not graphical-desktop proof.
import assert from "node:assert/strict";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ serviceWorkers: "block" });
  await page.goto("http://127.0.0.1:8000/?noAutoBoot=1");
  const result = await page.evaluate(async () => {
    const { default: init, WasmLinux } = await import("/pkg/wasm_vm_wasm.js");
    await init();
    const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hash = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));
    const chunkHash = await hash(new Uint8Array(4096));
    const manifest = JSON.stringify({ version: 1, image_len: 8192, chunk_size: 4096, layout: "split", chunks: [chunkHash, chunkHash] });
    const base = await hash(new TextEncoder().encode(manifest));
    const delta = new Uint8Array(61 + 8 + 4096), view = new DataView(delta.buffer);
    delta.set(new TextEncoder().encode("WVOD1")); view.setUint32(5, 4096, true);
    view.setBigUint64(9, 8192n, true); delta.set(Uint8Array.from(base.match(/../g), (b) => parseInt(b, 16)), 17);
    view.setBigUint64(49, 23n, true); view.setUint32(57, 1, true); view.setBigUint64(61, 0n, true); delta.fill(0x55, 69);
    const before = (await indexedDB.databases()).map((db) => db.name).sort();
    const create = (seed) => WasmLinux.newChunkedDiskSeeded(16, new Uint8Array([0x6f, 0, 0, 0]), manifest,
      "http://127.0.0.1:8000/unused-fixture/", 1, new Uint32Array(), "console=ttyS0", () => {}, false, seed);
    const machine = create(delta);
    const generation = machine.overlayGeneration();
    const saved = machine.saveSnapshot();
    const coherence = machine.restoreDecisionCode(saved, generation);
    const stale = machine.restoreDecisionCode(saved, generation + 1);
    const persisted = await machine.persistPending();
    const stored = await machine.readStoredSnapshot();
    let persistError = null;
    try { await machine.persistSnapshot(); } catch (error) { persistError = String(error); }
    machine.loadSnapshotBlob(saved);
    const restoredGeneration = machine.overlayGeneration();
    machine.free();
    const failures = [];
    for (const mutate of [
      (seed) => { seed[17] ^= 1; },
      (seed) => new DataView(seed.buffer).setBigUint64(9, 12288n, true),
      (seed) => new DataView(seed.buffer).setBigUint64(61, 2n, true),
    ]) {
      const bad = delta.slice(); mutate(bad);
      try { const invalid = create(bad); invalid.free(); failures.push(null); }
      catch (error) { failures.push(String(error)); }
    }
    return { generation, restoredGeneration, coherence, stale, persisted, stored, persistError, failures,
      snapshotBytes: saved.length, before, after: (await indexedDB.databases()).map((db) => db.name).sort() };
  });
  assert.equal(result.generation, 23); assert.equal(result.restoredGeneration, 23);
  assert.equal(result.coherence, "resume"); assert.notEqual(result.stale, "resume");
  assert.equal(result.persisted, 0); assert.equal(result.stored, null);
  assert.match(result.persistError, /not_persistent/);
  assert.ok(result.failures.every(Boolean)); assert.deepEqual(result.before, result.after);
  console.log(`OMARCHY_SEEDED_WASM_PASS ${JSON.stringify(result)}`);
} finally { await browser.close(); }
