// Reopen complete GPU bodies and recompute from original literal fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {dimensionalFixtures, expectedWords, textureInputs} from './fixtures.mjs';
const root = path.resolve(process.argv[2]), sha = b => createHash('sha256').update(b).digest('hex'), results = [];
for (const name of fs.readdirSync(root, {withFileTypes: true}).filter(e => e.isDirectory() && (e.name.startsWith('hardware-') || e.name === 'fault-wrong-layer')).map(e => e.name)) {
  const report = JSON.parse(fs.readFileSync(root + '/' + name + '/report.json')), a = report.acceptance;
  assert.deepEqual(report.browserErrors, {console: [], page: [], requests: []}); assert.match(a.gl.renderer, /Apple M4 Max.*Metal|Metal.*Apple M4 Max/);
  assert.equal(report.browser.launch.headless, false); assert.equal(report.browser.gpu.featureStatus[report.browser.webglFeature], 'enabled');
  const blobs = new Map();
  for (const blob of a.blobs) {
    const zipped = fs.readFileSync(root + '/' + name + '/' + blob.path); assert.equal(sha(zipped), blob.gzipSha256);
    const body = gunzipSync(zipped); assert.equal(body.length, blob.bytes); assert.equal(sha(body), blob.sha256); assert.ok(!blobs.has(blob.key)); blobs.set(blob.key, body);
  }
  const fixtures = new Map(dimensionalFixtures().map(f => [f.name, f])), frames = [];
  for (const frame of a.frames) {
    const f = fixtures.get(frame.name); assert.ok(f); assert.deepEqual(f.selectors, frame.selectors);
    const events = a.events, completion = frame.gpuComplete;
    assert.ok(completion.fenced && completion.writerEvent < completion.createdEvent && completion.createdEvent < completion.consumedEvent && completion.consumedEvent < frame.output.readEvent);
    assert.equal(events[completion.writerEvent].method, 'drawArrays'); assert.equal(events[completion.createdEvent].method, 'fenceSync'); assert.equal(events[completion.consumedEvent].method, 'clientWaitSync');
    assert.ok([37146, 37148].includes(events[completion.consumedEvent].result)); assert.equal(events[frame.output.readEvent].method, 'readPixels');
    assert.ok(events.some(e => e.id > completion.consumedEvent && e.method === 'deleteSync' && e.args[0].handle === completion.handle));
    const expected = Buffer.alloc(frame.width * frame.height * 16);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) expectedWords(f, x, y).forEach((word, lane) => expected.writeUInt32LE(word, ((y * frame.width + x) * 4 + lane) * 4));
    assert.deepEqual(blobs.get(frame.audit.expectedBytesKey), expected, 'complete independent oracle body');
    const actual = blobs.get(frame.output.bytesKey); assert.equal(actual.length, expected.length);
    const matches = actual.equals(expected), mismatches = [];
    for (let i = 0; i < expected.length; i += 4) if (actual.readUInt32LE(i) !== expected.readUInt32LE(i)) mismatches.push({word: i / 4, expected: expected.readUInt32LE(i), actual: actual.readUInt32LE(i)});
    assert.equal(matches, name !== 'fault-wrong-layer'); assert.equal(frame.audit.held, matches); assert.ok(frame.cleaned);
    for (const level of textureInputs(f)) {
      const original = frame.levels.find(l => l.level === level.level); assert.deepEqual(blobs.get(original.originalBytesKey), Buffer.from(level.bytes), 'original full texture input');
      for (const [face, id] of original.uploadEvents.entries()) {
        const event = events[id], body = blobs.get(event.args.at(-1).key); assert.equal(event.method, f.target === 'CUBE' ? 'texSubImage2D' : 'texSubImage3D');
        const plane = level.width * level.height * 16;
        if (name !== 'fault-wrong-layer') assert.deepEqual(body, Buffer.from(f.target === 'CUBE' ? level.bytes.slice(face * plane, (face + 1) * plane) : level.bytes));
        else { const corrupted = level.bytes.slice(); corrupted.set(level.bytes.subarray((level.layers - 1) * plane), 0); corrupted.set(level.bytes.subarray(0, plane), (level.layers - 1) * plane); assert.deepEqual(body, Buffer.from(corrupted)); }
      }
    }
    assert.ok(events.filter(e => e.id >= frame.firstEvent && e.id <= frame.lastEvent && e.method === 'getError').every(e => e.result === 0));
    frames.push({name: f.name, checkedBytes: expected.length, expectedSha256: sha(expected), actualSha256: sha(actual), matches, mismatches, fence: completion});
  }
  assert.equal(frames.length, name === 'fault-wrong-layer' ? 1 : dimensionalFixtures().length);
  if (name !== 'fault-wrong-layer') assert.equal(new Set(frames.map(f => f.name)).size, dimensionalFixtures().length);
  results.push({name, seed: a.seed, status: name === 'fault-wrong-layer' ? 'refuted' : 'passed', completeBodies: blobs.size, frames});
}
assert.ok(results.some(r => r.status === 'refuted') && results.some(r => r.status === 'passed'));
fs.writeFileSync(root + '/physical-audit.json', JSON.stringify({status: 'passed', results}, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({name: r.name, frames: r.frames.length, completeBodies: r.completeBodies, status: r.status}))));
