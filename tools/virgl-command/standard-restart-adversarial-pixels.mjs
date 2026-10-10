#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {independentRestart, compareRestartPixels, literalRestartAdmission} from './standard-restart-adversarial-oracle.mjs';
const root = path.resolve(process.argv[2]), output = path.resolve(process.argv[3] ?? path.join(root, 'fresh-physical-audit.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = {schema: 'standard-restart-fresh-physical-audit-v1', status: 'running', frames: [], faults: [],
  pixels: 0, nativeDraws: 0, normalizedBuffers: 0, literalPackets: 0};

async function audit(name, fault = false) {
  const directory = path.join(root, name), reportRaw = await fs.readFile(path.join(directory, 'report.json')),
    report = JSON.parse(reportRaw), recording = fault ? report.partial : report.browserResult.result;
  assert.equal(report.status, fault ? 'failed' : 'passed');
  const blobs = new Map(recording.blobs.map(b => [b.key, b]));
  assert.equal(blobs.size, recording.blobs.length, 'unique original/native/pixel records');
  const cached = new Map();
  async function raw(ref) {
    const blob = blobs.get(ref.key); assert.equal(blob.sha256, ref.sha256);
    if (!cached.has(ref.key)) {
      const packed = await fs.readFile(path.join(directory, blob.path)), bytes = gunzipSync(packed);
      assert.equal(sha(packed), blob.gzipSha256); assert.equal(bytes.length, blob.bytes); assert.equal(sha(bytes), blob.sha256);
      cached.set(ref.key, new Uint8Array(bytes));
    }
    return cached.get(ref.key);
  }
  for (const row of recording.wire?.records ?? []) {
    const standard = row.standard?.ok ?? recording.wire.predictions.find(p => p.prediction === 'malformed complete snapshot')?.observed;
    const legacy = row.legacy?.ok ?? recording.wire.predictions.find(p => p.prediction === 'malformed legacy snapshot')?.observed;
    assert.equal(standard, literalRestartAdmission(row.hex), 'literal standard flags ' + row.label);
    assert.equal(legacy, literalRestartAdmission(row.hex, true), 'literal legacy flags ' + row.label); result.literalPackets++;
  }
  for (const [frameIndex, frame] of recording.frames.entries()) {
    const original = new Map(), physical = new Map(), normalized = new Map();
    for (const row of frame.native.buffers) {
      const bytes = await raw(row.blob); original.set(row.resourceId, new Uint8Array(bytes.length)); physical.set(row.resourceId, bytes);
    }
    for (const input of frame.inputs) {
      const target = original.get(input.resource.id), bytes = await raw(input.blob); assert.ok(target, 'literal transfer original resource');
      assert.equal(input.layout.rowCount, 1); assert.equal(input.layout.rowBytes, bytes.length); target.set(bytes, input.layout.offset);
    }
    for (const [id, bytes] of physical) assert.deepEqual(bytes, original.get(id), 'original transfer bytes equal physical GPU source ' + id);
    const model = independentRestart(frame.history, original, frame.used ?? [0, 1, 2]), pixels = compareRestartPixels(await raw(frame.pixels), model, frame.width, frame.height);
    const outcome = frame.history.at(-1).result, draw = outcome.draws.at(-1), source = frame.native.buffers.find(b => b.resourceId === model.index.id);
    assert.equal(outcome.gpuComplete, true, 'real final GPU completion');
    assert.equal(draw.indexResourceId, model.index.id, 'original source identity');
    assert.equal(draw.indexResourceGeneration, source.generation, 'original source generation remains distinct from private EBO');
    for (const row of frame.native.normalized) {
      const bytes = await raw(row.blob); assert.equal(row.bytes, bytes.length); assert.equal(bytes.length, model.normalized.length);
      if (fault) {
        const wrong = new Uint8Array(model.ids.length * 4), v = new DataView(wrong.buffer);
        model.ids.forEach((id, n) => v.setUint32(n * 4, id, true));
        assert.deepEqual(bytes, wrong, 'actual mapping sabotage uses original marker in native GPU bytes');
      } else assert.deepEqual(bytes, model.normalized, 'independent exact original marker mapping and original vertex IDs');
      normalized.set(row.nativeBuffer, bytes);
    }
    for (const call of frame.native.calls) {
      const instanced = model.effective > 1;
      assert.equal(call.name, 'drawElements' + (instanced ? 'Instanced' : ''), 'actual native indexed entry');
      assert.deepEqual(call.args, [model.draw.mode, model.draw.count, {1: 5121, 2: 5123, 4: 5125}[model.nativeSize], model.nativeOffset, ...(instanced ? [model.effective] : [])]);
      assert.equal(model.normalize ? normalized.has(call.indexBuffer) : source.nativeBuffer === call.indexBuffer, true, 'actual original/private native binding');
      if (model.normalize) assert.notEqual(source.nativeBuffer, call.indexBuffer, 'private native binding never substitutes public original identity');
      for (const fetch of model.fetches) {
        const observed = draw.vertexFetches.find(a => a.attributeIndex === fetch.attributeIndex), attribute = call.attributes.find(a => a.name === 'in_' + fetch.attributeIndex);
        for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement'])
          assert.equal(observed[key], fetch[key], frame.label + ' original fetch ' + key);
        if (!model.valid) assert.equal(observed.fetchEmpty, true, 'explicit all-restart empty report');
        assert.equal(attribute.enabled, !fetch.constant); assert.equal(attribute.divisor, fetch.nativeDivisor);
        if (fetch.constant) {assert.deepEqual(observed.componentWords, fetch.componentWords); assert.deepEqual(attribute.genericValues, fetch.genericValues); assert.deepEqual(observed.genericValues, fetch.genericValues);}
        else {assert.deepEqual([attribute.stride, attribute.offset, attribute.components], [fetch.stride, fetch.offset, fetch.components]); assert.equal(attribute.buffer, frame.native.buffers.find(b => b.resourceId === fetch.resourceId).nativeBuffer);}
      }
    }
    assert.deepEqual([draw.actualMinIndex, draw.actualMaxIndex, draw.validIndexCount, draw.restartCount, draw.normalizedIndices,
      draw.nativeIndexSize, draw.nativeIndexOffset, draw.normalizedIndexBytes, draw.vertexWork, draw.indexOffset, draw.indexByteLength],
    [model.min, model.max, model.valid, model.restarts, model.normalize, model.nativeSize, model.nativeOffset, model.normalized.length,
      model.draw.count * model.effective, model.index.offset, model.draw.count * model.index.size]);
    const row = {label: frame.label, frameIndex, report: name + '/report.json', reportSha256: sha(reportRaw),
      originalIndexSha256: source.blob.sha256, normalized: [...normalized].map(([nativeBuffer, bytes]) => ({nativeBuffer, bytes: bytes.length, sha256: sha(bytes)})),
      actualIds: model.ids.length <= 64 ? model.ids : {count: model.ids.length, first: model.ids[0], last: model.ids.at(-1)},
      valid: model.valid, restarts: model.restarts, min: model.min, max: model.max, sourceWork: model.draw.count * model.effective,
      mode: model.draw.mode, nativeSize: model.nativeSize, nativeOffset: model.nativeOffset,
      pixels: pixels.pixels, maxError: pixels.maxError, misses: pixels.misses, held: pixels.held,
      nativeDraws: frame.native.calls.length, normalizedBuffers: normalized.size};
    if (fault) {
      assert.equal(pixels.held, false, 'real served mutation must fail fresh pixel oracle');
      assert.ok(report.browserResult.error.message.includes(frame.label + ' ') && report.browserResult.error.message.includes('pixel oracle'));
      result.faults.push(row);
    } else {
      assert.equal(pixels.held, true, frame.label + ' fresh full pixel oracle'); result.frames.push(row); result.pixels += pixels.pixels;
      result.nativeDraws += frame.native.calls.length; result.normalizedBuffers += normalized.size;
    }
  }
  for (const run of recording.runs) {
    assert.ok(['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes'].every(key => run.inspection.jobs[key] === 0), 'all owned counters released');
    const lastPoll = new Map();
    for (const event of run.events) if (event.name === 'clientWaitSync') {
      assert.ok(event.actual === 37146 || event.actual === 37147 || event.actual === 37148, 'actual native fence never failed');
      assert.ok(event.turn > (lastPoll.get(event.sync) ?? -1), 'per-fence poll happens in later distinct tasks'); lastPoll.set(event.sync, event.turn);
    }
    for (const event of run.normalizationEvents) {
      if (event.name === 'forced-createBuffer-null') {assert.equal(event.allocation, 2); continue;}
      assert.ok(event.bytes <= 262144 && event.inspection.normalizedBytes <= 262144 && event.inspection.normalizedBuffers <= 64);
      if (event.name === 'normalized-upload') assert.equal(event.inspection.normalizationScratchBytes, event.bytes, 'CPU scratch charged at actual native upload');
      if (event.name === 'normalized-delete' && !run.history.some(row => row.label.endsWith('dispose-setup'))) {
        const prefix = run.events.slice(0, event.traceEventCount), fence = prefix.filter(e => e.name === 'fenceSync').at(-1);
        assert.ok(fence, 'normalized storage released only after native fence creation');
        assert.ok(prefix.some(e => e.name === 'clientWaitSync' && e.sync === fence.sync && [37146, 37148].includes(e.actual)), 'private native EBO retained until real final completion');
      }
    }
  }
}
await audit('hardware'); await audit('fault-restart', true);
assert.equal(result.faults.length, 1); result.status = 'passed';
await fs.mkdir(path.dirname(output), {recursive: true}); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({status: result.status, frames: result.frames.length, pixels: result.pixels,
  nativeDraws: result.nativeDraws, normalizedBuffers: result.normalizedBuffers, literalPackets: result.literalPackets, fault: result.faults[0].label}));
