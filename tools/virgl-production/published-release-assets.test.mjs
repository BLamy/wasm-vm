import assert from 'node:assert/strict';
import test from 'node:test';
import {indexPublishedReleaseAssets} from './published-release-assets.mjs';

const base = 'https://wasm-vm.pages.dev/';
const digest = '8'.repeat(64);
const descriptor = (artifacts, name = 'artifacts-omarchy.json') =>
  ({name, bytes: Buffer.from(JSON.stringify({artifacts}))});
const small = {url: 'releases/boot-snapshot/delta.bin.gz', size: 1337997, sha256: digest};

test('a Pages-staged delta keeps its compressed pin; R2 and ordinary source files are excluded', () => {
  const pins = indexPublishedReleaseAssets([descriptor({
    delta: small,
    ram: {url: 'releases/boot-snapshot/ram.snap.gz', size: 210695930, sha256: '9'.repeat(64)},
    source: {url: 'main.js', size: 12, sha256: digest},
  })], base);
  assert.deepEqual([...pins.keys()], [base + small.url]);
  assert.deepEqual(pins.get(base + small.url),
    {descriptor: 'artifacts-omarchy.json', role: 'delta', size: 1337997, sha256: digest});
  assert.equal(pins.get(base + small.url + '?unlisted=1'), undefined);
});

test('conflicting pins from different manifests are refused', () => {
  for (const changed of [{sha256: 'a'.repeat(64)}, {size: 1337998}]) {
    assert.throws(() => indexPublishedReleaseAssets([
      descriptor({delta: small}),
      descriptor({delta: {...small, ...changed}}, 'artifacts-alpine.json'),
    ], base), /conflicting release/);
  }
});

test('a small release must have a valid digest and positive integral size', () => {
  for (const changed of [{sha256: 'bad'}, {size: 0}, {size: 1.5}]) {
    assert.throws(() => indexPublishedReleaseAssets([descriptor({delta: {...small, ...changed}})], base));
  }
});
