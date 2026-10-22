import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {encodeBundleHeader, bundlePrefix, indexSessionBundle, BUNDLE_MAX_HEADER_BYTES} from '../../web/session-bundle-format.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const body = new TextEncoder().encode('an immutable manifest fixture');
const ref = {sha256: sha(body), length: String(body.length)};
const header = () => ({version: 1, encoding: 'raw', portability: 'wasm-vm-installed-build-v1',
  runtime: {wasm: 'a'.repeat(64), gpu: null}, manifest: {...ref}, objects: [{...ref}], uncompressedBytes: ref.length});
const rawArchive = (value, payload = body) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return new Blob([bundlePrefix(bytes), bytes, payload]);
};

test('an archive owns its bytes and indexed bounds independently of caller views and exposed metadata', async () => {
  const value = header(), bytes = encodeBundleHeader(value), caller = body.slice();
  const file = new Blob([bundlePrefix(bytes), bytes, caller]); caller.fill(0);
  const archive = await indexSessionBundle(file); archive.header.objects[0].length = '999';
  const found = await archive.objectReference(ref.sha256); assert.deepEqual(found, ref);
  const parts = []; for await (const part of archive.stream(ref)) parts.push(part);
  assert.deepEqual(Buffer.concat(parts), Buffer.from(body));
  await assert.rejects(async () => {for await (const _ of archive.stream({...ref, length: '999'})) {}}, /conflicting/);
});

test('untrusted framing rejects truncation, trailing data and huge headers without reading a body', async () => {
  const bytes = encodeBundleHeader(header()), file = rawArchive(header());
  await assert.rejects(indexSessionBundle(file.slice(0, file.size - 1)), /truncated/);
  await assert.rejects(indexSessionBundle(new Blob([file, Uint8Array.of(0)])), /truncated/);
  const prefix = bundlePrefix(bytes); new DataView(prefix.buffer).setUint32(12, BUNDLE_MAX_HEADER_BYTES + 1, true);
  await assert.rejects(indexSessionBundle(new Blob([prefix, bytes, body])), /header size/);
  const version = bundlePrefix(bytes); new DataView(version.buffer).setUint32(8, 2, true);
  await assert.rejects(indexSessionBundle(new Blob([version, bytes, body])), /version/);
});

test('archives reject duplicate/path entries, compression bombs and unsupported versions', async () => {
  const cases = [
    value => { value.objects.push({...ref}); value.uncompressedBytes = String(body.length * 2); },
    value => { value.objects[0].path = '../../outside'; },
    value => { value.encoding = 'gzip'; value.uncompressedBytes = '18446744073709551615'; },
    value => { value.objects[0].length = '4294967297'; value.uncompressedBytes = '4294967297'; },
    value => { value.version = 2; },
    value => { value.required = ['unknown-future-feature']; },
  ];
  for (const mutate of cases) { const value = header(); mutate(value); await assert.rejects(indexSessionBundle(rawArchive(value))); }
  await assert.rejects(indexSessionBundle(new Blob([Uint8Array.of(80, 75, 3, 4), new Uint8Array(64)])), /magic/);
});

test('duplicate JSON keys cannot silently replace the declared runtime identity', async () => {
  const text = JSON.stringify(header()).replace('"version":1', '"version":1,"version":1');
  const bytes = new TextEncoder().encode(text);
  await assert.rejects(indexSessionBundle(new Blob([bundlePrefix(bytes), bytes, body])), /canonical/);
});
