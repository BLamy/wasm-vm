// Only AR's independently verified pair is admitted for uninstrumented AS input.
import assert from "node:assert/strict";
import { R3_IDENTITIES } from "./omarchy-input-trial.mjs";
import { INPUT_BUFFER_KERNEL } from "./omarchy-input-kernel-state.mjs";

export const INPUT_BUFFER_RESPONSE_WASM = "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916";
export const INPUT_BUFFER_PREPARED_RECORD_SHA256 = "577f33d7ecc5b29b161c436dbfcc1be11e3676ff1293bf45b71738f2954f4180";
export const INPUT_BUFFER_PREPARED_FOOT = Object.freeze({ address: "0x55558518d650", pid: 473 });
export const INPUT_BUFFER_PREPARED_IDENTITIES = Object.freeze({
  kernel: INPUT_BUFFER_KERNEL, chunkManifest: R3_IDENTITIES.chunkManifest,
  bootSnapshot: Object.freeze({ size: 205400326, sha256: "265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8" }),
  overlayDelta: Object.freeze({ size: 1285559, sha256: "1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c" }),
});

export function assertInputKernelPreparedSource(source) {
  for (const [role, expected] of Object.entries(INPUT_BUFFER_PREPARED_IDENTITIES)) {
    assert.equal(source?.[role]?.size, expected.size, `${role}: not verified AR size`);
    assert.equal(source?.[role]?.sha256, expected.sha256, `${role}: not verified AR bytes`);
  }
  assert.deepEqual(source.image, { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 });
}
