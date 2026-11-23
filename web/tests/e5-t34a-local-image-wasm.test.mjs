// E5-T34a: the wasm glue of the whole-image prefill (`setLocalImage` + `fetchPending` serving from
// it) exercised against the BUILT browser module. Runs the real WasmLinux chunked machine with a
// tiny manifest; the boot profile drives fetchPending's prefetch path through `fetch_one`, so every
// chunk it touches goes through the local slice + verify + insert. Node has no Window/Worker global:
// any fall-through to the network would fail (and retry forever), so `fetches` must stay 0.
//   node --test tests/e5-t34a-local-image-wasm.test.mjs      (WASM_PKG_DIR overrides web/dist/pkg)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = resolve(repo, process.env.WASM_PKG_DIR || "web/dist/pkg");
const wasmBytes = readFileSync(resolve(pkg, "wasm_vm_wasm_bg.wasm"));
console.info("LOCAL_IMAGE_WASM_SHA256=" + createHash("sha256").update(wasmBytes).digest("hex"));
const { initSync, WasmLinux } = await import(pathToFileURL(resolve(pkg, "wasm_vm_wasm.js")));
initSync({ module: wasmBytes });

const kernel = new Uint8Array([0x73, 0x00, 0x50, 0x10, 0x6f, 0x00, 0x00, 0x00]);
const CHUNK = 4096;
const image = new Uint8Array(CHUNK * 2 + 1024).map((_, i) => (i * 13 + 5) & 0xff); // short tail
const sha = (b) => createHash("sha256").update(b).digest("hex");
const chunks = [];
for (let off = 0; off < image.length; off += CHUNK) chunks.push(sha(image.subarray(off, off + CHUNK)));
const manifest = JSON.stringify({ version: 1, image_len: image.length, chunk_size: CHUNK, layout: "split", chunks });

const machine = () => WasmLinux.newChunkedDisk(8, kernel, manifest, "http://unreachable.invalid/", 0,
  Uint32Array.from([0, 1, 2]), "", () => {}, false);

test("size mismatch is refused and leaves no local source", { timeout: 10_000 }, () => {
  const m = machine();
  assert.throws(() => m.setLocalImage(new Uint8Array(image.length - 1)), /9215 bytes, manifest image_len is 9216/);
  assert.throws(() => m.setLocalImage(new Uint8Array(image.length + 1)), /image_len is 9216/);
  assert.equal(m.fetchStats().localImage, false);
});

test("local hit: every chunk served from the JS buffer, verified, no network", { timeout: 10_000 }, async () => {
  const m = machine();
  m.setLocalImage(image);
  await m.fetchPending();
  const s = m.fetchStats();
  assert.equal(s.localImage, true);
  assert.equal(s.localHits, 3);
  assert.equal(s.localBytes, image.length, "the short tail chunk is sliced to its exact extent");
  assert.equal(s.fetches, 0, "no network fetch");
  assert.equal(s.bytes, 0);
  assert.equal(s.error, null);
  assert.equal(s.cache.residentBytes, image.length);
});

test("hash mismatch: the corrupt chunk is never cached and never re-fetched from the network", { timeout: 10_000 }, async () => {
  const m = machine();
  const bad = image.slice();
  bad[CHUNK + 7] ^= 0x01; // chunk 1
  m.setLocalImage(bad);
  await m.fetchPending();
  await m.fetchPending(); // the profile retries chunk 1 — locally again, still refused
  const s = m.fetchStats();
  assert.equal(s.localHits, 2, "chunks 0 and 2 only");
  assert.equal(s.localBytes, CHUNK + 1024);
  assert.equal(s.fetches, 0, "a corrupt local image never falls back to the network");
  assert.equal(s.cache.residentBytes, CHUNK + 1024, "chunk 1's bad bytes were never inserted");
});
