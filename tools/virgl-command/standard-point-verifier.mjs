#!/usr/bin/env node
// Independently replay sealed original point uploads/native state/full pixels.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { independentPointModel, independentPointPixels } from './standard-point-adversarial-oracle.mjs';
const root = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const critic = process.argv[4] === 'critic';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const out = { schema: 'standard-point-critic-replay-v1', status: 'running', reports: [], frames: [], faults: [], nativeBytes: 0, physicalPixels: 0 };
const entries = critic ? [['', 'novel'], ['', 'fault-size-selection'], ['', 'fault-coord-y']] : ['hot', 'cold'].flatMap(label => ['hardware', 'fault-size-selection', 'fault-coord-y'].map(name => [label, name]));
for (const [label, name] of entries) {
  const directory = path.join(root, label, name), report = JSON.parse(await fs.readFile(path.join(directory, 'report.json'))), fault = name.startsWith('fault-');
  const result = fault ? report.partial : report.browserResult.result, blobs = new Map(result.blobs.map(b => [b.key, b]));
  assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] }); assert.equal(report.browser.headless, false);
  assert.match(result.gpu, /Metal Renderer: Apple M4 Max/); assert.equal(report.status, fault ? 'failed' : 'passed');
  async function raw(ref) { const b = blobs.get(ref.key); assert.equal(b.sha256, ref.sha256); const packed = await fs.readFile(path.join(directory, b.path)); assert.equal(sha(packed), b.gzipSha256); const bytes = gunzipSync(packed); assert.equal(bytes.length, b.bytes); assert.equal(sha(bytes), b.sha256); return new Uint8Array(bytes); }
  for (const frame of result.frames) {
    const originals = new Map(), physical = new Map();
    for (const row of frame.native.buffers) { const bytes = await raw(row.blob); originals.set(row.resourceId, new Uint8Array(bytes.length)); physical.set(row.resourceId, bytes); }
    for (const row of frame.inputs) { assert.equal(row.direction, 'upload'); assert.equal(row.layout.rowCount, 1); const bytes = await raw(row.blob); assert.equal(bytes.length, row.layout.rowBytes); originals.get(row.resource.id).set(bytes, row.layout.offset); }
    for (const [id, bytes] of originals) { assert.deepEqual(bytes, physical.get(id), 'critic original/native storage ' + frame.label + ':' + id); out.nativeBytes += bytes.length; }
    const model = independentPointModel(frame.history, originals, frame.range), pixels = await raw(frame.pixels), audit = independentPointPixels(pixels, model, frame.width, frame.height), draw = frame.history.at(-1).result.draws.at(-1);
    assert.equal(frame.history.at(-1).result.gpuComplete, true); assert.deepEqual(frame.range, result.range);
    for (const row of frame.native.normalized) assert.deepEqual(await raw(row.blob), model.nativeBytes);
    const instanced = model.effective > 1;
    assert.ok(frame.native.calls.length > 0);
    for (const call of frame.native.calls) {
      assert.equal(call.name, (model.draw.indexed ? 'drawElements' : 'drawArrays') + (instanced ? 'Instanced' : ''));
      assert.deepEqual(call.args, model.draw.indexed ? [0, model.draw.count, { 1: 5121, 2: 5123, 4: 5125 }[model.nativeSize], model.nativeOffset, ...(instanced ? [model.effective] : [])] : [0, model.draw.start, model.draw.count, ...(instanced ? [model.effective] : [])]);
      if (model.draw.indexed) assert.equal(call.indexBuffer, model.normalized ? frame.native.normalized[0].nativeBuffer : frame.native.buffers.find(n => n.resourceId === model.state.index.id).nativeBuffer);
      for (const expected of model.fetches) {
        const actual = draw.vertexFetches.find(n => n.attributeIndex === expected.attributeIndex), attr = call.attributes.find(n => n.name === 'in_' + expected.attributeIndex);
        for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) assert.equal(actual[key], expected[key], frame.label + ':' + key);
        assert.equal(attr.enabled, !expected.constant); assert.equal(attr.divisor, expected.nativeDivisor);
        if (expected.constant) { assert.deepEqual(actual.genericValues, expected.genericValues); assert.deepEqual(actual.componentWords, expected.componentWords); assert.deepEqual(attr.genericValues, expected.genericValues); }
        else { assert.deepEqual([attr.stride, attr.offset, attr.components], [expected.stride, expected.offset, expected.components]); assert.equal(attr.buffer, frame.native.buffers.find(n => n.resourceId === expected.resourceId).nativeBuffer); }
      }
    }
    assert.deepEqual([draw.actualMinIndex, draw.actualMaxIndex, draw.validIndexCount, draw.restartCount, draw.vertexWork, draw.normalizedIndices, draw.nativeIndexSize, draw.nativeIndexOffset], [model.min, model.max, model.valid, model.restarts, model.draw.count * model.effective, model.normalized, model.nativeSize, model.nativeOffset]);
    assert.equal(frame.native.state.length, frame.native.calls.length);
    for (const state of frame.native.state) { assert.deepEqual(state.pointSize, name === 'fault-size-selection' ? [1, 0] : model.pointUniform); if (state.pointCoordY !== null) assert.equal(state.pointCoordY, name === 'fault-coord-y' ? -model.winsysY : model.winsysY); }
    if (frame.label === 'per-vertex-input-0') { assert.deepEqual(model.ids, [7, 9, 12]); assert.equal(audit.covered, 45); assert.deepEqual(model.pixel(2, 3), [119, 223, 32, 128]); assert.deepEqual(model.pixel(3, 4), [119, 96, 159, 128]); }
    if (frame.label.startsWith('near-center-reject') || frame.label.startsWith('far-center-reject')) assert.equal(audit.covered, 0);
    if (frame.label.startsWith('XY-center-outside')) assert.equal(audit.covered, frame.width * frame.height);
    const row = { source: label + '/' + name + '/report.json', frame: frame.label, width: frame.width, height: frame.height, pointSizes: model.points.map(p => [p.originalSize, p.size]), pointUniform: model.pointUniform, winsysY: model.winsysY, ids: model.ids, draws: frame.native.calls.length, normalizedBytes: model.nativeBytes.length, audit, pixelSha256: sha(pixels) };
    if (fault) { assert.equal(audit.held, false); assert.ok(report.browserResult.error.message.includes(critic ? 'critic original point pixels' : 'independent strict point-square pixels')); out.faults.push(row); }
    else { assert.equal(audit.held, true, frame.label); out.frames.push(row); out.physicalPixels += audit.pixels; }
  }
  if (!fault) {
    for (const run of result.runs) {
      for (const key of ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']) assert.equal(run.inspection.jobs[key], 0);
      const syncs = new Map();
      for (const e of run.events) {
        if (e.name === 'fenceSync') { assert.ok(!syncs.has(e.sync)); syncs.set(e.sync, { turn: e.turn, polls: 0 }); }
        if (e.name === 'clientWaitSync') { const s = syncs.get(e.sync); assert.ok(s && e.turn > s.turn && e.turn !== s.lastPoll); s.lastPoll = e.turn; s.polls++; if ([37146, 37148].includes(e.delivered)) s.ready = true; }
        if (e.name === 'deleteSync') { assert.ok(syncs.has(e.sync)); syncs.delete(e.sync); }
      }
      assert.equal(syncs.size, 0);
    }
    for (const row of result.suspensions ?? []) { assert.equal(row.point.inspection.jobs.reads, row.phase === 'waiting-index' ? 1 : 2); const value = row.record.result; assert.equal(value.gpuComplete, true); if (row.action === 'reuse') { assert.equal(value.ok, true); assert.equal(value.draws[0].indexResourceGeneration, row.oldGeneration); assert.ok(row.newGeneration > row.oldGeneration); } else { assert.equal(value.error.code, row.action === 'cancel' ? 'cancelled' : 'stale-storage'); assert.equal(value.draws.length, 0); } }
    for (const row of result.rejections) assert.equal(row.record.result.draws.length, 0);
    const a = result.frames.filter(n => (critic ? /^critic-A-/ : /^restore-A-/).test(n.label)); assert.equal(a.length, 2); assert.equal(a[0].pixels.sha256, a[1].pixels.sha256);
  }
  out.reports.push({ source: label + '/' + name + '/report.json', sha256: sha(await fs.readFile(path.join(directory, 'report.json'))), status: report.status, frames: result.frames.length });
}
assert.equal(out.frames.length, critic ? 14 : 256); assert.equal(out.faults.length, critic ? 2 : 4); if (!critic) assert.equal(out.physicalPixels, 76800); out.status = 'passed';
await fs.writeFile(output, JSON.stringify(out, null, 2) + '\n'); console.log(JSON.stringify({ status: out.status, frames: out.frames.length, faults: out.faults.length, pixels: out.physicalPixels, nativeBytes: out.nativeBytes }));
