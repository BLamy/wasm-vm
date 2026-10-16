#!/usr/bin/env node
// Reopen actual GPU records. No worker predictions/audit are oracle inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { independentModel, independentPixels } from './standard-assembly-adversarial-oracle.mjs';
const [input, output, kind = 'worker'] = process.argv.slice(2);
assert.ok(input && output && ['worker', 'critic', 'fault'].includes(kind));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(input), result = { schema: 'standard-assembly-critic-audit-v1', status: 'running', kind, frames: [], faults: [], runs: [], ownership: [], rejections: [], suspensions: [], pixels: 0, nativeDraws: 0, privateBuffers: 0 };

async function audit(name, fault = false) {
  const directory = path.join(root, name), rawReport = await fs.readFile(path.join(directory, 'report.json')), report = JSON.parse(rawReport);
  const physical = fault ? report.partial : report.browserResult.result, refs = new Map(physical.blobs.map(row => [row.key, row]));
  assert.equal(report.status, fault ? 'failed' : 'passed');
  const raw = async ref => {
    const indexed = refs.get(ref.key); assert.ok(indexed); assert.equal(indexed.sha256, ref.sha256); assert.equal(indexed.bytes, ref.bytes);
    const packed = await fs.readFile(path.join(directory, indexed.path)); assert.equal(sha(packed), indexed.gzipSha256);
    const bytes = gunzipSync(packed); assert.equal(bytes.length, indexed.bytes); assert.equal(sha(bytes), indexed.sha256); return new Uint8Array(bytes);
  };
  for (const [frameIndex, frame] of physical.frames.entries()) {
    const uploaded = new Map(), original = new Map(), normalized = new Map();
    for (const row of frame.native.buffers) { const bytes = await raw(row.blob); original.set(row.resourceId, bytes); uploaded.set(row.resourceId, new Uint8Array(bytes.length)); }
    for (const row of frame.inputs) {
      const dest = uploaded.get(row.resource.id), bytes = await raw(row.blob); assert.ok(dest);
      assert.equal(row.layout.rowCount, 1); assert.equal(row.layout.rowBytes, bytes.length); dest.set(bytes, row.layout.offset);
    }
    for (const [id, bytes] of original) assert.deepEqual(bytes, uploaded.get(id), 'literal uploads match physical original buffer ' + id);
    const model = independentModel(frame.history, uploaded), job = frame.history.at(-1).result;
    assert.equal(job.gpuComplete, true); const draw = job.draws.at(-1);
    assert.deepEqual([draw.count, draw.mode, draw.indexed, draw.start, draw.instanceCount, draw.effectiveInstances], [model.draw.count, model.draw.mode, model.draw.indexed, model.draw.start, model.draw.instances, model.effective]);
    assert.deepEqual([draw.actualMinIndex, draw.actualMaxIndex, draw.validIndexCount, draw.restartCount, draw.vertexWork, draw.primitiveRestart, draw.restartIndex], [model.min, model.max, model.valid, model.restarts, model.draw.count * model.effective, model.draw.enabled, model.draw.marker]);
    assert.deepEqual([draw.primitiveAssembly, draw.assembled, draw.nativeMode, draw.nativeCount, draw.nativeIndexed, draw.nativeIndexSize, draw.nativeIndexOffset, draw.normalizedIndexBytes, draw.nativeVertexWork],
      ['lists', model.assembled, model.nativeMode, model.nativeCount, model.nativeIndexed, model.nativeSize, model.nativeOffset, model.nativeBytes.length, model.nativeCount * model.effective]);
    assert.ok(draw.nativeVertexWork <= 3 * draw.vertexWork);
    let expectedBytes = model.nativeBytes;
    if (fault && report.mutation.mode === 'list-order') {
      expectedBytes = model.nativeBytes.slice(); const view = new DataView(expectedBytes.buffer); let at = 0;
      for (const segment of model.segments) { if (segment.length < 2) continue; for (let i = 1; i < segment.length; i++) { view.setUint32(at, segment[i], true); view.setUint32(at + 4, segment[i - 1], true); at += 8; } at += 8; }
    }
    for (const row of frame.native.normalized) { const bytes = await raw(row.blob); assert.equal(bytes.length, row.bytes); assert.deepEqual(bytes, expectedBytes, 'independent actual native list bytes'); normalized.set(row.nativeBuffer, bytes); }
    for (const call of frame.native.calls) {
      const instanced = model.effective > 1;
      assert.equal(call.name, (model.nativeIndexed ? 'drawElements' : 'drawArrays') + (instanced ? 'Instanced' : ''));
      assert.deepEqual(call.args, model.nativeIndexed ? [model.nativeMode, model.nativeCount, { 1: 5121, 2: 5123, 4: 5125 }[model.nativeSize], model.nativeOffset, ...(instanced ? [model.effective] : [])] : [model.nativeMode, model.draw.start, model.nativeCount, ...(instanced ? [model.effective] : [])]);
      if (model.normalized) assert.ok(normalized.has(call.indexBuffer));
      else assert.equal(call.indexBuffer, model.draw.indexed ? frame.native.buffers.find(row => row.resourceId === model.state.index.id).nativeBuffer : null);
      for (const fetch of model.fetches) {
        const observed = draw.vertexFetches.find(row => row.attributeIndex === fetch.attributeIndex), attribute = call.attributes.find(row => row.name === 'in_' + fetch.attributeIndex);
        for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) assert.equal(observed[key], fetch[key], frame.label + ': ' + key);
        assert.equal(attribute.enabled, !fetch.constant); assert.equal(attribute.divisor, fetch.nativeDivisor);
        if (fetch.constant) { assert.deepEqual(observed.componentWords, fetch.componentWords); assert.deepEqual(attribute.genericValues, fetch.genericValues); }
        else { assert.deepEqual([attribute.stride, attribute.offset, attribute.components], [fetch.stride, fetch.offset, fetch.components]); assert.equal(attribute.buffer, frame.native.buffers.find(row => row.resourceId === fetch.resourceId).nativeBuffer); }
      }
    }
    assert.deepEqual(frame.native.state.map(s => s.convention), Array(frame.native.calls.length).fill(fault && report.mutation.mode === 'provoking' ? 0x8e4d : 0x8e4e));
    const pixels = await raw(frame.pixels), check = independentPixels(pixels, model, frame.width, frame.height);
    assert.equal(check.held, !fault, frame.label + ': critic full pixels');
    const row = { label: frame.label, report: name + '/report.json', frameIndex, reportSha256: sha(rawReport), originalIds: model.ids.length <= 64 ? model.ids : { count: model.ids.length, min: model.min, max: model.max },
      nativeCount: model.nativeCount, nativeBytes: model.nativeBytes.length, nativeBytesSha256: sha(model.nativeBytes), nativeMode: model.nativeMode, sourceWork: model.draw.count * model.effective, nativeWork: model.nativeCount * model.effective,
      actualPrivateBuffers: normalized.size, draws: frame.native.calls.length, pixelBlobSha256: sha(pixels), ...check };
    if (fault) {
      assert.equal(frame.native.calls[0].name, 'drawElementsInstanced'); assert.ok(report.browserResult.error.message.includes('independent assembly pixel oracle'));
      // Fault reports stop before the worker's done(r) publishes run.events.
      // Authenticate concrete actual-fence call/ready-return coverage rather
      // than relying only on the printed gpuComplete result.
      const state = await fs.readFile(path.join(directory, 'mutation-source.mjs'), 'utf8');
      const coverageRaw = await fs.readFile(path.join(directory, report.browserCoverage.path)); assert.equal(sha(coverageRaw), report.browserCoverage.sha256);
      const script = JSON.parse(coverageRaw).scripts.find(s => s.source === 'renderer/virgl-command/state.mjs'); assert.equal(script.sha256, sha(state)); assert.equal(script.sha256, report.mutation.servedSha256);
      row.nativeFenceCoverage = ['job.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);', 'const status = gl.clientWaitSync(job.sync, 0, 0);', 'job.completedSerial = job.fenceSerial; return finishJob(job, true);'].map(operation => {
        const offset = state.indexOf(operation); assert.ok(offset >= 0); assert.equal(state.indexOf(operation, offset + 1), -1);
        const spans = script.coverage.functions.flatMap(fn => fn.ranges).filter(r => r.startOffset <= offset && offset < r.endOffset);
        const count = spans.sort((a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset))[0].count; assert.ok(count > 0, 'actual final fence call/poll/ready return executes');
        return { source: 'mutation-source.mjs', sourceSha256: script.sha256, line: state.slice(0, offset).split('\n').length, offset, count, operation };
      });
      assert.deepEqual(check.misses[0], { x: 3, y: 2, expected: [[115, 56, 51, 128]], observed: [99, 56, 51, 128], error: 16 });
      row.actualNativeBytesSha256 = sha(expectedBytes); row.convention = frame.native.state[0].convention; result.faults.push(row);
    } else { result.frames.push(row); result.pixels += check.pixels; result.nativeDraws += row.draws; result.privateBuffers += normalized.size; }
  }
  if (!fault) auditLifetimes(physical, name);
}

function auditLifetimes(physical, prefix) {
  const zeroKeys = ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes'];
  for (const [runIndex, run] of physical.runs.entries()) {
    for (const key of zeroKeys) assert.equal(run.inspection.jobs[key], 0);
    const allocations = new Map(), deletions = new Set();
    for (const [eventIndex, event] of run.normalizationEvents.entries()) {
      if (event.name === 'forced-createBuffer-null') { assert.equal(event.allocation, 2); continue; }
      assert.ok(event.bytes <= 786432 && event.inspection.normalizedBytes <= 786432 && event.inspection.normalizedBuffers <= 64);
      if (event.name === 'normalized-upload') {
        assert.equal(event.inspection.normalizationScratchBytes, event.bytes); assert.ok(!allocations.has(event.nativeBuffer)); allocations.set(event.nativeBuffer, event.bytes);
        const liveBytes = [...allocations].filter(([id]) => !deletions.has(id)).reduce((sum, [, bytes]) => sum + bytes, 0);
        assert.equal(event.inspection.normalizedBytes, liveBytes);
      } else {
        assert.equal(event.name, 'normalized-delete'); assert.ok(allocations.has(event.nativeBuffer)); assert.equal(event.inspection.normalizationScratchBytes, 0); assert.ok(!deletions.has(event.nativeBuffer));
        const before = run.events.slice(0, event.traceEventCount), disposal = !['finishing', 'cancelling', 'retiring'].includes(event.inspection.status);
        if (!disposal) {
          const finalFence = before.findLast(row => row.name === 'fenceSync');
          assert.ok(finalFence, 'real final fence before storage deletion');
          const polls = before.filter(row => row.name === 'clientWaitSync' && row.sync === finalFence.sync);
          assert.ok(polls.some(row => [37146, 37148].includes(row.delivered)), 'completion/drain physically precedes native deletion');
          assert.ok(polls.every(row => row.turn > finalFence.turn));
          assert.equal(event.inspection.reads, 0, 'all pending read fences drained before private native retirement');
        } else assert.equal(run.inspection.disposed, true, 'only explicit disposal may retire private storage before final fence');
        deletions.add(event.nativeBuffer);
      }
      result.ownership.push({ report: prefix + '/report.json', runIndex, eventIndex, nativeBuffer: event.nativeBuffer, event: event.name, bytes: event.bytes, phase: event.inspection.status, traceEventCount: event.traceEventCount, held: true });
    }
    assert.equal(allocations.size, deletions.size);
    result.runs.push({ report: prefix + '/report.json', runIndex, privateAllocated: allocations.size, privateDeleted: deletions.size, released: true });
  }
  if (physical.rejections) for (const row of physical.rejections) {
    assert.equal(row.record.result.ok, false); assert.equal(row.record.result.gpuComplete, true);
    const expected = row.label.startsWith('short-') ? ['out-of-bounds', 0] : ({ 'work-35': ['limit-exceeded', 0], 'scratch-minus-one': ['limit-exceeded', 63], 'scratch-draw-65': ['limit-exceeded', 64], 'read-minus-one': ['limit-exceeded', 0], 'nonrestart-u32-max': ['unsupported-draw', 0] })[row.label];
    assert.ok(expected); assert.deepEqual([row.record.result.error.code, row.record.result.draws.length], expected, 'specific original-source/native-bound rejection');
    result.rejections.push({ label: row.label, code: row.record.result.error.code, draws: row.record.result.draws.length });
  }
  if (physical.suspensions) for (const row of physical.suspensions) {
    assert.equal(row.point.inspection.jobs.reads, 2); assert.equal(row.record.result.gpuComplete, true);
    assert.equal(row.point.inspection.jobs.status, 'waiting-attributes');
    if (row.action === 'collected-index') assert.ok(row.point.events.some(e => e.name === 'getBufferSubData' && e.bytes === 18 && e.hex === '330043006d0097001100370055007f00b300'), 'literal original indices were physically collected before concurrent mutation');
    if (row.action === 'reuse') { assert.equal(row.record.result.ok, true); assert.ok(row.newGeneration > row.oldGeneration); assert.equal(row.record.result.draws[0].indexResourceGeneration, row.oldGeneration); }
    else { assert.equal(row.record.result.error.code, row.action === 'cancel' ? 'cancelled' : 'stale-storage'); assert.equal(row.record.result.draws.length, 0); }
    result.suspensions.push({ action: row.action, retainedReads: 2, originalGeneration: row.oldGeneration, newGeneration: row.newGeneration, held: true });
  }
  for (const row of physical.ownership ?? []) {
    for (const peak of row.peaks ?? row.yields ?? []) { assert.equal(peak.normalizationScratchBytes, 0); assert.ok(peak.normalizedBytes <= 786432 && peak.normalizedBuffers <= 64); }
    if (row.label === 'scratch-exact-one') assert.equal(Math.max(...row.peaks.map(p => p.normalizedBytes)), 786408);
    if (row.label === 'scratch-exact-64') assert.deepEqual([Math.max(...row.peaks.map(p => p.normalizedBytes)), Math.max(...row.peaks.map(p => p.normalizedBuffers))], [784896, 64]);
    if (row.label === 'owned-dispose') { assert.equal(row.before.inspection.normalizedBuffers, 1); for (const key of zeroKeys) assert.equal(row.after.jobs[key], 0); }
    if (row.label.startsWith('owned-cancel')) { assert.equal(row.point.inspection.normalizedBuffers, 1); assert.equal(row.record.result.error.code, 'cancelled'); assert.equal(row.record.result.draws.length, 1); }
    if (row.label.startsWith('native-')) { assert.equal(row.record.result.error.code, 'backend-error'); assert.equal(row.record.result.gpuComplete, true); assert.equal(row.record.result.draws.length, 1); }
  }
  const gates = physical.runs.flatMap(run => run.selection ?? []);
  if (gates.length) {
    assert.deepEqual(gates.map(row => [row.label, row.result.error.code]), [['unknown', 'invalid-input'], ['missing-extension', 'unsupported-host'], ['wrong-extension', 'unsupported-host'], ['legacy', 'invalid-input']]);
    assert.ok(physical.runs.filter(run => run.selection?.length).every(run => run.calls.length === 0), 'rejected factory gates never draw');
    assert.equal(physical.rejections.length, 8); assert.equal(physical.suspensions.length, 4); assert.equal(physical.ownership.length, 11);
  }
}

try {
  if (kind === 'worker') { await audit('hardware'); await audit('fault-list-order', true); await audit('fault-provoking', true); assert.equal(result.frames.length, 304); assert.equal(result.pixels, 177664); assert.equal(result.nativeDraws, 492); assert.equal(result.privateBuffers, 417); }
  else if (kind === 'critic') { await audit(''); assert.equal(result.frames.length, 8); }
  else await audit('', true);
  result.status = 'passed';
} catch (error) { result.status = 'failed'; result.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, frames: result.frames.length, pixels: result.pixels, nativeDraws: result.nativeDraws, privateBuffers: result.privateBuffers, faults: result.faults.length, failure: result.failure }));
