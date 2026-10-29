import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {stageGzipSnapshot, MAX_COPY_BYTES, MAX_SNAPSHOT_BYTES} from '../snapshot-stream.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = Uint8Array.from({length: 800123}, (_, i) => (i * 47 + (i >>> 9)) & 255);
const descriptor = {uncompressedSize: raw.length, uncompressedSha256: sha(raw)};
function fixture() {
  const made = [];
  const create = size => {
    const chunks = []; let length = 0;
    const buffer = {freed: false, append(bytes) { assert.ok(bytes.length <= MAX_COPY_BYTES); chunks.push(bytes.slice()); length += bytes.length; },
      byteLength: () => length, sha256: () => sha(Buffer.concat(chunks)), free() { this.freed = true; }};
    made.push(buffer); return buffer;
  };
  return {made, create};
}
test('native gzip stream preserves all bytes and transfers bounded-buffer ownership', async () => {
  const f = fixture();
  const originalBlob = globalThis.Blob, originalResponse = globalThis.Response;
  globalThis.Blob = class { constructor() { throw Error('must not duplicate compressed input in Blob'); } };
  globalThis.Response = class { constructor() { throw Error('must not materialize expanded JS response'); } };
  try {
    const result = await stageGzipSnapshot(new Uint8Array(gzipSync(raw)), descriptor, f.create);
    assert.equal(result.buffer.sha256(), descriptor.uncompressedSha256);
    assert.equal(result.stats.expandedBytes, raw.length);
    assert.ok(result.stats.maxCopyBytes > 0 && result.stats.maxCopyBytes <= MAX_COPY_BYTES);
    assert.ok(result.stats.copies > 1);
    assert.equal(f.made.length, 1);
    assert.equal(f.made[0].freed, false);
    result.buffer.free();
    assert.equal(f.made[0].freed, true);
  } finally { globalThis.Blob = originalBlob; globalThis.Response = originalResponse; }
});
test('invalid descriptors refuse before allocating', async () => {
  for (const patch of [{uncompressedSize: 0}, {uncompressedSize: 83}, {uncompressedSize: 84.5},
    {uncompressedSize: MAX_SNAPSHOT_BYTES + 1}, {uncompressedSize: undefined}, {uncompressedSha256: 'bad'}]) {
    const f = fixture();
    await assert.rejects(stageGzipSnapshot(new Uint8Array(gzipSync(raw)), {...descriptor, ...patch}, f.create));
    assert.equal(f.made.length, 0);
  }
});
test('length/digest mismatches and corrupt gzip always release staging', async () => {
  const gz = new Uint8Array(gzipSync(raw));
  const inputs = [gz.subarray(0, gz.length - 1), gz.subarray(0, 15), new Uint8Array(),
    ...[0, Math.floor(gz.length / 2), gz.length - 8, gz.length - 1].map(at => { const c = gz.slice(); c[at] ^= 0x80; return c; })];
  for (const bytes of inputs) {
    const f = fixture(); await assert.rejects(stageGzipSnapshot(bytes, descriptor, f.create));
    assert.equal(f.made.length, 1); assert.equal(f.made[0].freed, true);
  }
  for (const patch of [{uncompressedSize: raw.length - 1}, {uncompressedSize: raw.length + 1},
    {uncompressedSha256: '0'.repeat(64)}]) {
    const f = fixture(); await assert.rejects(stageGzipSnapshot(gz, {...descriptor, ...patch}, f.create));
    assert.equal(f.made[0].freed, true);
  }
});
test('reader and copy failures release the allocated buffer', async () => {
  const original = globalThis.DecompressionStream;
  globalThis.DecompressionStream = class { constructor() { return new TransformStream({transform() { throw Error('injected reader failure'); }}); } };
  try {
    const f = fixture(); await assert.rejects(stageGzipSnapshot(new Uint8Array(gzipSync(raw)), descriptor, f.create), /reader failure/);
    assert.equal(f.made[0].freed, true);
  } finally { globalThis.DecompressionStream = original; }
  const f = fixture();
  await assert.rejects(stageGzipSnapshot(new Uint8Array(gzipSync(raw)), descriptor, size => {
    const b = f.create(size); b.append = () => { throw Error('injected copy failure'); }; return b;
  }), /copy failure/);
  assert.equal(f.made[0].freed, true);
});
