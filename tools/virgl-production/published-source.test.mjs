import assert from 'node:assert/strict';
import test from 'node:test';
import {expectedPublishedSource} from './published-source.mjs';

test('Pages manifests have literal immutable release URLs without waiving image identity or metadata', () => {
  const original = Buffer.from(JSON.stringify({note: 'keep this', artifacts: {
    kernel: {url: 'releases/kernel/k/Image', sha256: 'a'.repeat(64), size: 24},
    gpuCheckpoint: {url: 'releases/boot-snapshot/ready.wvgpair', sha256: 'b'.repeat(64), size: 26214401},
    small: {url: 'releases/boot-snapshot/small.gz', sha256: 'c'.repeat(64), size: 26214400},
  }, profile: 'releases/chunked-omarchy/profile.json'}));
  const expected = JSON.parse(expectedPublishedSource('artifacts-omarchy-virgl.json', original));
  assert.equal(expected.artifacts.kernel.url, 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/' + 'a'.repeat(64) + '/releases/kernel/k/Image');
  assert.equal(expected.artifacts.gpuCheckpoint.url, 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/' + 'b'.repeat(64) + '/releases/boot-snapshot/ready.wvgpair');
  assert.equal(expected.artifacts.small.url, 'releases/boot-snapshot/small.gz');
  assert.equal(expected.profile, 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/chunked-omarchy/profile.json');
  expected.artifacts.kernel.url = 'releases/kernel/k/Image';
  expected.artifacts.gpuCheckpoint.url = 'releases/boot-snapshot/ready.wvgpair';
  expected.profile = 'releases/chunked-omarchy/profile.json';
  assert.deepEqual(expected, JSON.parse(original), 'all hashes, sizes, roles and unrelated fields remain exact');
});

test('code, unrelated JSON and already public declarations remain byte exact', () => {
  for (const [name, body] of [['main.js', 'draw();\n'], ['tasks.json', '{"x":1}'],
    ['artifacts.json', '{"artifacts":{"kernel":{"url":"https://example.invalid/k","size":1,"sha256":"a"}}}']]) {
    const original = Buffer.from(body); assert.equal(expectedPublishedSource(name, original), original);
  }
});
