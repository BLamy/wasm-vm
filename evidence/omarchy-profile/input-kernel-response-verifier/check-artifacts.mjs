// Independent byte checks; expected pair identities come from verified AR's log.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const repo = process.cwd();
const files = [
  ['target/omarchy-input-kernel-r3/Image', 24208896, '3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d'],
  ['target/omarchy-input-kernel-prepared-pair-r1/omarchy-ready.snap.gz', 205400326, '265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8'],
  ['target/omarchy-input-kernel-prepared-pair-r1/omarchy-overlay-delta.bin.gz', 1285559, '1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c'],
  ['target/omarchy-profile-chunks-sdr-r3-256k/manifest.json', 1097812, '5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44'],
  ['web/dist/pkg/wasm_vm_wasm_bg.wasm', null, '36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916'],
  ['evidence/omarchy-profile/input-kernel-pair-r1/browser/run.json', null, '577f33d7ecc5b29b161c436dbfcc1be11e3676ff1293bf45b71738f2954f4180'],
];
const results = [];
for (const [file, bytes, sha256] of files) {
  const data = await fs.readFile(path.join(repo, file));
  const actual = { file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  if (bytes !== null) assert.equal(actual.bytes, bytes, file);
  assert.equal(actual.sha256, sha256, file);
  results.push(actual);
}
console.log(JSON.stringify({ purpose: 'independent AS source bytes check; no responsiveness claim', passed: true, files: results }, null, 2));
