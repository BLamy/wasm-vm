// Read-only re-binding of the historical measured renderer code; no guest execution.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { sections, decodeRam, inspect, Memory, pins, pinned } from "../../../tools/verify/omarchy-wait-checkpoint.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const snap = pinned(fs.readFileSync("target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz"), pins.snapshot, "R3");
const parsed = sections(gunzipSync(snap, { maxOutputLength: 2 * 1024 ** 3 }));
const ram = decodeRam(parsed.get(2), 1024 ** 3);
const layoutBytes = pinned(fs.readFileSync("evidence/omarchy-profile/checkpoint-wait-layout/layout.json"), pins.layout, "layout");
const layout = JSON.parse(layoutBytes);
const image = pinned(fs.readFileSync("releases/kernel/6.6.63/Image"), layout.kernelFiles["arch/riscv/boot/Image"], "kernel");
const map = pinned(fs.readFileSync("releases/kernel/6.6.63/System.map"), layout.kernelFiles["System.map"], "map");
const inspection = inspect(ram, parsed.get(1), image, map.toString("utf8"), layout);
const renderer = inspection.targets.find(row => row.comm === "llvmpipe-0");
assert.equal(renderer.pid, 462);
const memory = new Memory(ram, BigInt(renderer.userAddressSpace.physicalRoot), 10);
const va = 0x7fff6c08a000n;
const page = memory.read(va, 4096, memory.root, { user: true, execute: true });
assert.equal(sha(page), "68e042889bbbe68b7fb56eb2bca604d2b79f384620da6d33a1e3b1bb6b680f9b");
assert.deepEqual(page, fs.readFileSync("target/omarchy-user-symbols/renderer-page.bin"));
const rawProfile = fs.readFileSync("evidence/omarchy-profile/renderer-opcodes-r1/profile.json");
assert.equal(sha(rawProfile), "5133c92488d51075599604a79eff7f649e5743ada8a6f60fb0bfa506672bc521");
const profile = JSON.parse(rawProfile), parcels = [];
let trailingPartialParcel = null;
for (let at = 0; at < page.length;) {
  const half = page.readUInt16LE(at), size = (half & 3) === 3 ? 4 : 2;
  if (at + size > page.length) { trailingPartialParcel = { offset: at, expectedBytes: size, availableBytes: page.length - at }; break; }
  if (size === 4) {
    const word = page.readUInt32LE(at);
    if ((word & 127) === 0x43) {
      const pc = va + BigInt(at);
      assert.equal((word >>> 25) & 3, 0, "single format");
      parcels.push({ pc: `0x${pc.toString(16)}`, word: word.toString(16).padStart(8, "0"),
        format: (word >>> 25) & 3, rm: (word >>> 12) & 7, region: `0x${(pc & ~63n).toString(16)}` });
    }
  }
  at += size;
}
assert.equal(parcels.length, 24);
const receipt = { purpose: "Static FMADD.S page bound to the historical dynamic R3 measurement; no new performance claim",
  snapshotSha256: sha(snap), ramSha256: sha(ram), layoutSha256: sha(layoutBytes),
  sourceProfileSha256: sha(rawProfile), renderer: { pid: renderer.pid, comm: renderer.comm,
    userAddressSpace: renderer.userAddressSpace },
  translation: memory.witness(va, 4, memory.root, { user: true, execute: true }),
  pageSha256: sha(page), parcels, trailingPartialParcel, profileCounts: { total: profile.total_retired, fpCompute: profile.fp_compute,
    fmaOpcode7: profile.fma_opcode7, regionDropped: profile.fp_region64_dropped },
  limitation: "Opcode histogram has no S/D split; static code and complete hot-region counts support this selected instruction, not a claimed per-PC retirement count." };
fs.writeFileSync(new URL("./saved-fmadd-encodings.json", import.meta.url), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ rendererPid: renderer.pid, pageSha256: sha(page), parcels: parcels.length,
  profileCounts: receipt.profileCounts }));
