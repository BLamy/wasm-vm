#!/usr/bin/env node
// Original packet, TGSI and upload bytes are the authority. No runtime imports.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { model, compare } from './oracle.mjs';
import { literalState } from '../virgl-command/standard-draw-oracle.mjs';

const directory = path.resolve(process.argv[2]), control = process.argv.includes('--control');
const rawReport = await fs.readFile(path.join(directory, 'report.json')), env = JSON.parse(rawReport);
const evidence = env.browserResult.result ?? env.partial, hash = raw => createHash('sha256').update(raw).digest('hex');
assert.deepEqual(env.browserErrors, { console: [], page: [], requests: [] });
assert.equal(evidence.guestExecution, false); assert.equal(evidence.productionNegotiation, false);
assert.equal(env.status, control ? 'failed' : 'passed');
const bodies = new Map(), counts = { runs: 0, frames: 0, pixels: 0, nativePasses: 0, normalizedBytes: 0 };
for (const ref of evidence.blobs) {
  assert.equal(bodies.has(ref.key), false);
  const zipped = await fs.readFile(path.join(directory, ref.path)), raw = gunzipSync(zipped);
  assert.equal(hash(zipped), ref.gzipSha256); assert.equal(hash(raw), ref.sha256); assert.equal(raw.length, ref.bytes);
  bodies.set(ref.key, { ref, raw });
}
const load = ref => {
  const body = bodies.get(ref.key); assert.ok(body); assert.equal(body.ref.sha256, ref.sha256); assert.equal(body.ref.bytes, ref.bytes);
  return body.raw;
};
const failures = [], citations = [], operations = [7680, 0, 7681, 7682, 7683, 34055, 34056, 5386];
const face = (f, r) => ({ STENCIL_FUNC: 512 + f.func, STENCIL_REF: r, STENCIL_VALUE_MASK: f.value,
  STENCIL_WRITEMASK: f.write, STENCIL_FAIL: operations[f.fail], STENCIL_PASS_DEPTH_FAIL: operations[f.zfail], STENCIL_PASS_DEPTH_PASS: operations[f.zpass] });
for (const ref of evidence.runs) {
  let row = ref;
  if (ref.path) { const raw = await fs.readFile(path.join(directory, ref.path)); assert.equal(hash(raw), ref.sha256); assert.equal(raw.length, ref.bytes); row = JSON.parse(raw); }
  counts.runs++;
  const buffers = new Map(row.buffers.map(b => [b.id, load(b.input)]));
  if (row.reflection) {
    assert.equal(row.execution.result.ok, row.reflection === 'budget-3');
    if (row.reflection !== 'budget-3') assert.equal(row.execution.result.error.code, 'shader-reflection-error');
    assert.equal(row.execution.result.gpuComplete, true); assert.equal(row.draws.length, 0);
    assert.equal(row.factoryProbe.error.code, 'invalid-input');
    assert.ok(row.instanceControls.length > 0);
    for (const query of row.instanceControls) {
      assert.equal(query.kind, 'tightened-native-reflection-query');
      if (query.name === 'getActiveUniforms') assert.deepEqual(query.actual, [row.reflection === 'type' ? 5125 : 1]);
      if (query.name === 'getUniform') assert.equal(query.actual, 0);
      if (query.name === 'getParameter') assert.ok(query.actual >= 3);
    }
    continue;
  }
  const originalInput = load(row.planes.find(p => p.level === row.level).input);
  const source = load(row.sourceBacking), reconstructed = Buffer.alloc(source.length, 0xb3);
  for (const plane of row.planes) {
    const raw = load(plane.input), bpp = row.format === 126 ? 8 : 4;
    assert.equal(raw.length, plane.width * plane.height * bpp);
    for (let y = 0; y < plane.height; y++) raw.copy(reconstructed, plane.offset + y * plane.stride, y * plane.width * bpp, (y + 1) * plane.width * bpp);
  }
  assert.deepEqual(source, reconstructed);
  const calls = row.draws.filter(d => d.label === 'instanced-draw'), states = row.orderedStates.filter(s => s.label === 'instanced-draw' && s.name.startsWith('draw'));
  const instances = row.instanceStates.filter(s => s.label === 'instanced-draw');
  assert.equal(calls.length, states.length); assert.equal(calls.length, instances.length);
  counts.nativePasses += calls.length;
  const literal = literalState(row.history), phase = row.failurePhase;
  if (phase) {
    const code = ['historical', 'native-selection'].includes(phase) ? 'unsupported-stencil' : phase.startsWith('short-') ? 'out-of-bounds' :
      phase === 'empty' ? 'unsupported-draw' : phase === 'work-budget' ? 'limit-exceeded' : 'backend-error';
    assert.equal(row.execution.result.ok, false); assert.equal(row.execution.result.error.code, code); assert.equal(row.execution.result.gpuComplete, true);
    assert.equal(calls.length, phase === 'draw' ? 10 : ['uint', 'pointer'].includes(phase) ? 8 : ['allocation', 'upload'].includes(phase) ? 40 : 0);
    assert.equal(row.execution.result.draws.length, ['allocation', 'upload'].includes(phase) ? 1 : 0);
    if (!['allocation', 'upload', 'draw', 'uint', 'pointer'].includes(phase)) assert.equal(row.orderedIndices.length, 0);
    if (phase === 'short-index') assert.equal(literal.index.offset + literal.draw.count * literal.index.size, buffers.get(literal.index.id).length + 1);
    if (['short-vertex', 'short-instance'].includes(phase)) {
      const e = literal.activeElements[phase === 'short-vertex' ? 0 : 1], b = literal.buffers[e.buffer], raw = buffers.get(literal.index.id), v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const ids = Array.from({ length: literal.draw.count }, (_, i) => literal.index.size === 1 ? v.getUint8(literal.index.offset + i) : literal.index.size === 2 ? v.getUint16(literal.index.offset + i * 2, true) : v.getUint32(literal.index.offset + i * 4, true)).filter(id => !literal.draw.primitiveRestart || id !== literal.draw.restartIndex);
      const last = e.divisor ? Math.floor((literal.effective - 1) / e.divisor) : Math.max(...ids);
      assert.equal(b.offset + e.sourceOffset + last * b.stride + 16, buffers.get(b.id).length + 1);
    }
    assert.equal(row.instanceControls.length + row.orderedControls.length, ['allocation', 'upload', 'draw', 'uint', 'pointer'].includes(phase) ? 1 : 0);
  } else if (row.limits) {
    assert.equal(row.limits.count, literal.draw.count); assert.equal(row.limits.instances, literal.effective);
    assert.equal(row.execution.result.ok, literal.draw.count * literal.effective <= row.limits.originalLimit);
    if (!row.execution.result.ok) { assert.equal(row.execution.result.error.code, 'limit-exceeded'); assert.equal(calls.length, 0); assert.equal(row.frames.length, 0); }
  } else if (!control) assert.equal(row.execution.result.ok, true);
  for (const frame of row.frames) {
    const original = model(row.history.slice(0, frame.historyIndex + 1), buffers, { format: row.format, width: row.width, height: row.height,
      input: originalInput, clearWords: [0xbe800000, 0x3e000000, 0x3f400000, 0x3f000000], prefixPasses: frame.prefixPasses });
    const differences = compare(original, load(frame.color), load(frame.depth), row.width, row.height, row.format);
    counts.frames++; counts.pixels += row.width * row.height;
    if (control) { if (differences.length) failures.push({ name: row.name, differences }); }
    else assert.deepEqual(differences, [], row.name);
    const split = original.lowering === 'triangles', assembled = split || [2, 6].includes(original.draw.mode), indexed = original.draw.indexed || assembled;
    const nativeMode = split ? 4 : assembled ? original.draw.mode === 2 ? 1 : 4 : original.draw.mode;
    if (!phase && !control) assert.equal(calls.length, split ? original.primitives.length * 2 * original.effective : 1);
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i], state = states[i], instance = split ? Math.floor(i / (original.primitives.length * 2)) : 0;
      if (control) continue;
      const expected = split ? [4, 3, 5125, (Math.floor(i / 2) % original.primitives.length) * 12] : indexed ?
        [nativeMode, original.nativeIds.length, 5125, 0, ...(original.effective > 1 ? [original.effective] : [])] :
        [nativeMode, original.draw.start, original.draw.count, ...(original.effective > 1 ? [original.effective] : [])];
      if (phase === 'draw' && i === 9) expected[0] = 0xffffffff;
      assert.deepEqual(call.args, expected); assert.equal(state.after.eventSequence, call.sequence);
      const metadata = row.requests.findLast(r => r.method === 'pair' && r.result.ok).result.vertex.metadata;
      const activeInstance = metadata.systemValues.some(s => s.semantic === 'INSTANCEID') && original.shaders.get(0).includes('10: I2F TEMP[0].y, SV[0].xxxx');
      assert.equal(instances[i].before.base, activeInstance ? instance : null);
      const side = split ? i % 2 : original.lowering === 'front' ? 0 : null;
      assert.deepEqual(state.before.native.stencil.faces, side === null ? original.faces.map((f, j) => face(f, original.effectiveRefs[j])) : [0, 1].map(() => face(original.faces[side], original.effectiveRefs[side])));
      assert.equal(state.before.native.provoking, 0x8e4e); assert.equal(state.before.native.cullFace, split && side ? 1028 : 1029);
      assert.equal(state.before.native.cull, split || (original.raster >>> 8 & 3) === 2);
      for (let slot = 0; slot < original.activeElements.length; slot++) auditInput(row, state.before.vertexInputs, original, buffers, slot, instance);
      const pair = row.requests.findLast(p => p.method === 'pair' && p.result.ok && p.request.vertexText === original.shaders.get(0) && p.request.fragmentText === original.shaders.get(1));
      assert.ok(pair); for (const shader of call.shaders) assert.equal(shader.glsl, pair.result[shader.type === 35633 ? 'vertex' : 'fragment'].glsl);
    }
    for (const entry of row.orderedIndices.filter(p => p.label === 'instanced-draw')) {
      const wanted = Buffer.alloc(original.nativeIds.length * 4); original.nativeIds.forEach((id, i) => wanted.writeUInt32LE(id, 4 * i));
      assert.deepEqual(load(entry.input), wanted);
      assert.deepEqual(load(entry.gpu), phase === 'upload' && entry === row.orderedIndices.at(-1) ? Buffer.alloc(0) : wanted);
      assert.equal(entry.deleted, true); counts.normalizedBytes += wanted.length;
      if (calls.length) assert.ok(entry.retirement.completion.sequence > calls.at(-1).sequence);
    }
    if (!control) {
      assert.equal(row.restored.instance.base, original.shaders.get(0).includes('10: I2F TEMP[0].y, SV[0].xxxx') ? 0 : null);
      assert.equal(row.restored.cullFace, 1029); assert.equal(row.restored.cull, (original.raster >>> 8 & 3) === 2);
      assert.deepEqual(row.restored.stencil.faces, original.faces.map((f, i) => face(f, original.effectiveRefs[i])));
    }
  }
  for (const yieldPoint of row.yields ?? []) {
    assert.equal(yieldPoint.renderer.normalizationScratchBytes, 0); assert.ok(yieldPoint.renderer.normalizedBuffers <= 64);
    assert.ok(yieldPoint.renderer.normalizedBytes <= 65536 * 12);
    if (yieldPoint.renderer.draws > 0 || phase && calls.length > 0) {
      if (yieldPoint.native.instance.base !== null) assert.equal(yieldPoint.native.instance.base, 0);
      for (const a of yieldPoint.native.instance.attributes) if (a.enabled && a.divisor > 0) assert.equal(a.offset, a.name === 'in_1' ? 8 : 12);
    }
  }
  if (row.boundary) {
    const b = row.boundary, k = b.kind, completed = ['stale-index', 'collected-index'].includes(k) ? 0 : 1;
    if (['reuse-instance', 'poison-instance', 'shader-reuse', 'context-destroy'].includes(k)) {
      const calls = row.draws.filter(d => d.label === 'instanced-boundary-' + k);
      assert.equal(calls.length, k === 'context-destroy' ? 0 : 8 * literal.effective);
      assert.equal(b.point.renderer.jobs.status, 'waiting-attributes'); assert.equal(b.point.native.instance.base, 0);
      if (k === 'context-destroy') { assert.equal(b.execution.result.error.code, 'missing-context'); assert.equal(b.execution.result.gpuComplete, true); }
      else assert.equal(b.execution.result.ok, true);
      if (b.busy) assert.equal(b.busy.result.error.code, 'busy');
      if (b.recreated) { assert.equal(b.recreated.result.ok, true); assert.ok(b.programAfter[0].generation > b.programBefore[0].generation); }
      if (b.replacement) { assert.ok(b.replacement.generation > b.originalGeneration); assert.deepEqual(load(b.replacement.input), load(b.replacement.after));
        const fetch = b.execution.result.draws[0].vertexFetches.find(v => v.resourceId === 4); assert.equal(fetch.resourceGeneration, b.originalGeneration); }
      if (b.poison) assert.deepEqual(load(b.poison), load(b.poisonAfter));
      const original = model(row.history.slice(0, b.frame.historyIndex + 1), buffers, { format: row.format, width: row.width, height: row.height,
        input: originalInput, clearWords: [0xbe800000, 0x3e000000, 0x3f400000, 0x3f000000] });
      assert.deepEqual(compare(original, load(b.frame.color), load(b.frame.depth), row.width, row.height, row.format), []);
      counts.frames++; counts.pixels += row.width * row.height;
      continue;
    }
    const boundaryCalls = row.draws.filter(d => d.label === 'ordered-boundary-' + k);
    assert.equal(boundaryCalls.length, completed * 8 * literal.effective);
    assert.equal(b.point.renderer.jobs.normalizationScratchBytes, 0);
    if (b.point.native.instance.base !== null) assert.equal(b.point.native.instance.base, 0);
    const code = k.startsWith('cancel-') ? 'cancelled' : ['stale-index', 'collected-index'].includes(k) ? 'stale-storage' : ['owner-first', 'renderer-first'].includes(k) ? 'disposed' : null;
    assert.equal(b.execution.result.ok, !code); if (code) assert.equal(b.execution.result.error.code, code);
    if (b.frame) {
      const original = model(row.history.slice(0, b.frame.historyIndex + 1), buffers, { format: row.format, width: row.width, height: row.height,
        input: load(b.input), clearWords: [0xbe800000, 0x3e000000, 0x3f400000, 0x3f000000] });
      assert.deepEqual(compare(original, load(b.frame.color), load(b.frame.depth), row.width, row.height, row.format), []);
      counts.frames++; counts.pixels += row.width * row.height;
    }
    if (b.replacement) { assert.ok(b.replacement.generation > b.oldGeneration); assert.equal(b.execution.result.draws[0].indexResourceGeneration, b.oldGeneration); assert.deepEqual(load(b.replacement.input), load(b.replacement.after)); }
  }
  if (control) {
    const { before, after } = row.corruption; assert.ok(after.sequence > before.sequence); assert.notEqual(before.sync, after.sync);
    const sync = row.fenceObjects.find(s => s.id === after.sync); assert.ok(sync);
    const writers = row.events.filter(e => e.sequence > before.sequence && e.sequence < sync.createdSequence && e.name.startsWith('draw'));
    assert.ok(writers.length); assert.ok(sync.polls.some(p => p.sequence === after.sequence && [37146, 37148].includes(p.actual) && [37146, 37148].includes(p.delivered)));
    citations.push({ before, after, writers, controls: row.instanceControls });
  }
}
if (control) assert.ok(failures.length, 'completed physical corruption must fail the unchanged original-byte oracle');
const audit = { schema: 'original-instanced-stencil-inverse-v1', status: control ? 'refuted' : 'passed', reportSha256: hash(rawReport), counts,
  oracleImportsProductCode: false, differences: failures, citations };
await fs.writeFile(path.join(directory, control ? 'control-audit.json' : 'values-audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ status: audit.status, counts, differences: failures.length }));

function auditInput(row, inputs, original, buffers, slot, instance) {
  const e = original.activeElements[slot], b = original.buffers[e.buffer], a = inputs.find(a => a.name === 'in_' + slot);
  assert.ok(a); assert.equal(a.enabled, b.stride !== 0); assert.equal(a.divisor, b.stride === 0 ? 0 : Math.min(e.divisor, 65536));
  if (b.stride === 0) return; // Constant words are independently consumed by the full physical oracle.
  assert.equal(a.components, 4); assert.equal(a.stride, b.stride);
  const split = original.lowering === 'triangles';
  assert.equal(a.offset, b.offset + e.sourceOffset + (split && e.divisor ? Math.floor(instance / e.divisor) * b.stride : 0));
  const packed = [8, 123, 172, 173].includes(e.format), integer = [196, 200].includes(e.format);
  assert.equal(a.type, packed ? 33640 : e.format === 196 ? 5125 : e.format === 200 ? 5124 : 5126);
  assert.equal(a.normalized, e.format === 8);
  const native = row.instanceStates.find(s => s.label === 'instanced-draw' && s.before.base === instance)?.before.attributes.find(a => a.name === 'in_' + slot);
  if (native) assert.equal(native.integer, integer);
  const body = row.vertexInputBodies.find(p => p.buffer === a.buffer); assert.ok(body); assert.deepEqual(load(body.bytes), buffers.get(b.id));
  assert.equal(row.allocations.find(a => a.metadata.id === b.id).buffer, a.buffer);
}
