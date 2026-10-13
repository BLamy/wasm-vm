// Reopen complete GPU bodies and recompute from original literal fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {comparisonFixtures, expectedWords, textureInputs, inputBytes, maskValues, addValues} from './fixtures.mjs';
const root = path.resolve(process.argv[2]), sha = b => createHash('sha256').update(b).digest('hex'), results = [];
for (const name of fs.readdirSync(root, {withFileTypes: true}).filter(e => e.isDirectory() && (e.name.startsWith('hardware-') || e.name === 'fault-wrong-layer')).map(e => e.name)) {
  const report = JSON.parse(fs.readFileSync(root + '/' + name + '/report.json')), a = report.acceptance;
  assert.deepEqual(report.browserErrors, {console: [], page: [], requests: []}); assert.match(a.gl.renderer, /Apple M4 Max.*Metal|Metal.*Apple M4 Max/);
  assert.equal(report.browser.launch.headless, false);assert.equal(a.guestExecution,false);assert.equal(a.productionNegotiation,false); assert.equal(report.browser.gpu.featureStatus[report.browser.webglFeature], 'enabled');
  const blobs = new Map();
  for (const blob of a.blobs) {
    const zipped = fs.readFileSync(root + '/' + name + '/' + blob.path); assert.equal(sha(zipped), blob.gzipSha256);
    const body = gunzipSync(zipped); assert.equal(body.length, blob.bytes); assert.equal(sha(body), blob.sha256); assert.ok(!blobs.has(blob.key)); blobs.set(blob.key, body);
  }
  const fixtures = new Map(comparisonFixtures().map(f => [f.name, f])), frames = [];
  for (const frame of a.frames) {
    const originalFixture = fixtures.get(frame.name); assert.ok(originalFixture); const f={...originalFixture,seed:a.seed}; assert.deepEqual(f.selectors, frame.selectors);
    const events = a.events, completion = frame.gpuComplete;
    assert.ok(completion.fenced && completion.writerEvent < completion.createdEvent && completion.createdEvent < completion.consumedEvent && completion.consumedEvent < frame.output.readEvent);
    const literalInputs=inputBytes(f),region=events.filter(e=>e.id>=frame.firstEvent&&e.id<=frame.lastEvent);
    for(const key of ['positions','coordinates','dx','dy'])assert.deepEqual(blobs.get(frame.originalInputs[key]),Buffer.from(literalInputs[key]),'complete original '+key+' bytes');
    for(const attribute of frame.attributes.filter(a=>a.location>=0)){
      const pointer=region.find(e=>['vertexAttribPointer','vertexAttribIPointer'].includes(e.method)&&e.args[0]===attribute.location);assert.ok(pointer);
      const upload=region.findLast(e=>e.id<pointer.id&&e.method==='bufferData'&&e.args[0]===34962);assert.ok(upload);
      const key=['positions','coordinates','dx','dy'][attribute.index];assert.deepEqual(blobs.get(upload.args[1].key),Buffer.from(literalInputs[key]),'actual source upload '+key);
      assert.equal(pointer.method,(f.selectors.unsignedMask&(1<<attribute.index))?'vertexAttribIPointer':'vertexAttribPointer');
      assert.equal(pointer.args[2],pointer.method==='vertexAttribIPointer'?5125:5126);
    }
    for(const control of frame.uniforms){
      if(control.semantic==='SHADOW_MASK'||control.semantic==='SHADOW_ADD'){
        assert.deepEqual(control.initial,[0,0,0,0]);assert.equal(control.type,35666);assert.deepEqual(control.value,control.semantic==='SHADOW_MASK'?maskValues:addValues);
        const values=Buffer.from(new Float32Array(control.value).buffer);assert.ok(region.some(e=>e.method==='uniform4fv'&&blobs.get(e.args[1].key)?.equals(values)));
      }else if(control.semantic==='TEXTURE_LEVELS'){assert.equal(control.type,5124);assert.equal(control.initial,0);assert.equal(control.value,3-(f.baseLevel??0));}
      else {assert.equal(control.type,f.ordinary?(f.target==='CUBE'?35680:36289):(f.target==='CUBE'?36293:36292));assert.equal(control.value,8);}
    }
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
        const plane = level.width * level.height * 4;
        if (name !== 'fault-wrong-layer') assert.deepEqual(body, Buffer.from(f.target === 'CUBE' ? level.bytes.slice(face * plane, (face + 1) * plane) : level.bytes));
        else { const corrupted = level.bytes.slice(); corrupted.set(level.bytes.subarray((level.layers - 1) * plane), 0); corrupted.set(level.bytes.subarray(0, plane), (level.layers - 1) * plane); assert.deepEqual(body, Buffer.from(corrupted)); }
      }
    }
    assert.ok(events.filter(e => e.id >= frame.firstEvent && e.id <= frame.lastEvent && e.method === 'getError').every(e => e.result === 0));
    frames.push({name: f.name, checkedBytes: expected.length, expectedSha256: sha(expected), actualSha256: sha(actual), matches, mismatches, fence: completion});
  }
  assert.equal(frames.length, name === 'fault-wrong-layer' ? 1 : comparisonFixtures().length);
  if (name !== 'fault-wrong-layer') assert.equal(new Set(frames.map(f => f.name)).size, comparisonFixtures().length);
  results.push({name, seed: a.seed, status: name === 'fault-wrong-layer' ? 'refuted' : 'passed', completeBodies: blobs.size, frames});
}
assert.ok(results.some(r => r.status === 'refuted') && results.some(r => r.status === 'passed'));
fs.writeFileSync(root + '/physical-audit.json', JSON.stringify({status: 'passed', results}, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({name: r.name, frames: r.frames.length, completeBodies: r.completeBodies, status: r.status}))));
