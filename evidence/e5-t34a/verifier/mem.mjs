import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const pkg = "/Users/blamy/Documents/Codex/wasm-vm/web/dist/pkg";
const wasmBytes = readFileSync(pkg + "/wasm_vm_wasm_bg.wasm");
const { initSync, WasmLinux } = await import(pathToFileURL(pkg + "/wasm_vm_wasm.js"));
const exp = initSync({ module: wasmBytes });
const mem = () => exp.memory.buffer.byteLength;
const kernel = new Uint8Array([0x73, 0x00, 0x50, 0x10, 0x6f, 0x00, 0x00, 0x00]);
const CHUNK = 131072, LEN = 256 * 1024 * 1024 + 4096; // 256 MiB + short tail chunk
const image = new Uint8Array(LEN); for (let i = 0; i < LEN; i += 4093) image[i] = (i >> 12) & 0xff;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const chunks = []; for (let o = 0; o < LEN; o += CHUNK) chunks.push(sha(image.subarray(o, o + CHUNK)));
const last = chunks.length - 1;
const manifest = JSON.stringify({ version: 1, image_len: LEN, chunk_size: CHUNK, layout: "split", chunks });
const m = WasmLinux.newChunkedDisk(8, kernel, manifest, "http://unreachable.invalid/", 0, Uint32Array.from([0, 1, last]), "", () => {}, false);
const m0 = mem(); m.setLocalImage(image); const m1 = mem();
await m.fetchPending(); const m2 = mem(); const s = m.fetchStats();
console.log(JSON.stringify({ imageBytes: LEN, before: m0, afterSet: m1, afterServe: m2, growSet: m1 - m0, growServe: m2 - m1, localHits: s.localHits, localBytes: s.localBytes, fetches: s.fetches, error: s.error }));
// Novel corruption: corrupt ONLY the short LAST chunk, keep the rest intact.
const bad = image.slice(); bad[LEN - 1] ^= 0xff;
const m3 = WasmLinux.newChunkedDisk(8, kernel, manifest, "http://unreachable.invalid/", 0, Uint32Array.from([last]), "", () => {}, false);
m3.setLocalImage(bad); await m3.fetchPending(); await m3.fetchPending();
const t = m3.fetchStats();
console.log(JSON.stringify({ lastChunkCorrupt: { localHits: t.localHits, fetches: t.fetches, bytes: t.bytes, resident: t.cache.residentBytes, error: t.error } }));
