// Read-only audit of the frozen worker evidence; does not run the worker suite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const head = '779efb7dfafc55db8ee476e3626a6d5f78b18a8c';
const root = 'evidence/e5-t22e/';
const sha = b => createHash('sha256').update(b).digest('hex');
const expected = {
  'acceptance.log': '76e2a911d222a6fd84cd558830c9d9fe8a5a91740168d1bcdf29155f89318237',
  'browser/browser-proof.json': '0664a5a4929b92d61a37a2b9389ab17619548045ed4557795d431161ee4e79d0',
  'browser/demo-suite.png': 'd23dc60df6f059ea4e9dd3846bbf7d14610a8300cf3b3905789827fb5a5da1b3',
};
for (const [file, digest] of Object.entries(expected)) assert.equal(sha(readFileSync(root + file)), digest);
const proof = JSON.parse(readFileSync(root + 'browser/browser-proof.json', 'utf8'));
assert.equal(proof.head, head);
for (const [file, digest] of Object.entries(proof.digests)) {
  assert.equal(sha(execFileSync('git', ['show', `${head}:${file}`], {maxBuffer: 32 * 1024 * 1024})), digest, file);
}
assert.deepEqual(proof.metrics, ['126', '0', '126']);
assert.deepEqual(proof.errors, []);
assert.equal(proof.screenshotSha256, expected['browser/demo-suite.png']);
const checkEdid = (s, width, height) => {
  assert.equal(s.edid.length, 128);
  assert.equal(s.edid.reduce((n, b) => n + b, 0) % 256, 0);
  assert.equal(s.edid[56] | ((s.edid[58] & 240) << 4), width);
  assert.equal(s.edid[59] | ((s.edid[61] & 240) << 4), height);
  assert.equal(s.advertisedWidth, width);
  assert.equal(s.advertisedHeight, height);
  assert.equal(s.refreshHz, 60);
};
const defaultEdid = proof.results[0].samples[0].fresh.edid;
assert.deepEqual(proof.results.map(r => r.backend), ['direct', 'worker']);
for (const backend of proof.results) {
  assert.deepEqual(backend.words.slice(0, 3), [0x100082b7, 0x0602a823, 0x1002a503]);
  assert.equal(backend.samples.length, 4);
  for (const {width, height, fresh, before, after, subsequent, output} of backend.samples) {
    checkEdid(fresh, 1280, 800);
    assert.deepEqual(fresh.edid, defaultEdid);
    assert.equal(fresh.pendingEvents, 0);
    checkEdid(before, width, height);
    assert.equal(before.pendingEvents, 1);
    checkEdid(after, width, height);
    assert.deepEqual(after.edid, before.edid);
    assert.equal(after.pendingEvents, 0);
    assert.equal(after.resourceCount, 0);
    assert.equal(after.resourceBytes, 0);
    assert.equal(after.scanoutResource, null);
    checkEdid(subsequent, 1111, 777);
    assert.equal(subsequent.pendingEvents, 1);
    assert.equal(output, 'R');
    console.log(`HELD ${backend.backend} ${width}x${height}: fresh/default, 60 Hz, all 128 EDID bytes/checksum/decoded mode, zero guest state, subsequent 1111x777 event`);
  }
}
const log = readFileSync(root + 'acceptance.log', 'utf8');
assert(log.includes(`cold_clone: cloning HEAD ${head}`));
assert(log.includes('269 passed; 0 failed; 0 ignored'));
assert(log.includes('5 passed; 0 failed; 0 ignored'));
assert(log.includes('cold_clone: verify-E5-T22e PASSED from a pristine clone'));
for (const mode of ['1x1', '4095x4095', '901x701']) {
  const section = log.split(`E5-T22e reset ${mode}:\n`)[1];
  assert(section);
  const lines = section.split('\n');
  assert.equal(lines[1], 'core 0: 0x0000000080200004 (0x0602a823) mem 0x0000000010008070 0x00000000');
  assert.equal(lines[2], 'core 0: 0x0000000080200008 (0x1002a503) x10 0x0000000000000000 mem 0x0000000010008100');
  assert.equal(lines[3], 'state digest=4e280b0d92d2251e2d0afeb62ccc8b03b35de2aaf6eb6c75d21b6227d14c4d25');
  const stats = JSON.parse(lines[4].slice('stats='.length));
  stats.edid = Object.values(stats.edid);
  checkEdid(stats, ...mode.split('x').map(Number));
  assert.equal(stats.pendingEvents, 0);
  assert.equal(stats.resourceCount, 0);
  console.log(`HELD actual-Wasm trace ${mode}: retired zero MMIO store/event read, RAM digest, independently decoded GPU readback`);
}
console.log(`HELD frozen source/artifact/log/capture hashes; cold clone ${head}; 269 native, 5 Wasm, 8 browser resets, 126/0 demo, errors=[]`);
