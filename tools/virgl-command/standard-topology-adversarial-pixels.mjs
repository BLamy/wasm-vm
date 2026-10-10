#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {repo, sha256} from './fixtures.mjs';
import {independentTopology, compareIndependent, literalAdmission} from './standard-topology-adversarial-oracle.mjs';
const root = path.resolve(process.argv[2]), out = {schema: 'standard-topology-promoted-audit-v1', status: 'running', frames: [], faults: [], pixels: 0, custody: [], lifetimes: []};
async function audit(name, fault = false) {
  const directory = path.join(root, name), rawReport = await fs.readFile(path.join(directory, 'report.json')), report = JSON.parse(rawReport), result = report.partial ?? report.browserResult.result;
  assert.equal(report.task, 'E6-T11d8'); assert.equal(report.status, fault ? 'failed' : 'passed');
  assert.deepEqual(report.browserErrors, {console: [], page: [], requests: []}); assert.equal(report.browser.headless, false);
  assert.equal(report.browser.gpu.featureStatus.webgl2 ?? report.browser.gpu.featureStatus.webgl, 'enabled');
  assert.ok(!report.browser.commandLine.some(x => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(x)));
  assert.deepEqual(report.fixedMemory, {bytes: 16777216, stageExport: 'function', pairExport: 'function'});
  const served = new Map(report.servedFiles.map(s => [s.path, s.sha256]));
  for (const s of report.sources) {
    assert.equal(sha256(await fs.readFile(path.join(repo, s.path))), s.sha256);
    if (served.has('/' + s.path)) assert.equal(served.get('/' + s.path), report.mutation?.path === s.path ? report.mutation.servedSha256 : s.sha256);
  }
  for (const key of ['browserCoverage', 'screenshot']) assert.equal(sha256(await fs.readFile(path.join(directory, report[key].path))), report[key].sha256);
  for (const s of JSON.parse(await fs.readFile(path.join(directory, report.browserCoverage.path))).scripts) assert.equal(s.sha256, served.get('/' + s.source));
  if (fault) {
    const mutation = report.mutation, original = await fs.readFile(path.join(repo, mutation.path), 'utf8'), changed = await fs.readFile(path.join(directory, 'mutation-source.mjs'));
    assert.equal(original.split(mutation.needle).length, 2); assert.equal(changed.toString(), original.replace(mutation.needle, mutation.replacement)); assert.equal(sha256(changed), mutation.servedSha256);
  }
  const blobs = new Map(result.blobs.map(b => [b.key, b]));
  async function raw(ref) {
    const b = blobs.get(ref.key); assert.ok(b); assert.equal(b.sha256, ref.sha256);
    const zipped = await fs.readFile(path.join(directory, b.path)), bytes = gunzipSync(zipped);
    assert.equal(sha256(zipped), b.gzipSha256); assert.equal(sha256(bytes), b.sha256); assert.equal(bytes.length, b.bytes); return new Uint8Array(bytes);
  }
  for (const b of result.blobs) await raw(b);
  for (const [index, frame] of result.frames.entries()) {
    const storage = new Map(); for (const input of frame.inputs) {const bytes = await raw(input.blob); assert.equal(input.layout.offset, 0); assert.equal(input.layout.rowBytes, bytes.length); storage.set(input.resource.id, bytes);}
    for (const b of frame.native.buffers) assert.deepEqual(await raw(b.blob), storage.get(b.resourceId), 'promoted GPU equals original uploaded bytes');
    const model = independentTopology(frame.history, storage), comparison = compareIndependent(await raw(frame.pixels), model, frame.width, frame.height), r = frame.history.at(-1).result, draw = r.draws.at(-1), call = frame.native.calls.at(-1);
    assert.equal(r.ok, true); assert.equal(r.gpuComplete, true); assert.equal(draw.actualMinIndex, model.min); assert.equal(draw.actualMaxIndex, model.max); assert.equal(draw.vertexWork, model.draw.count * model.effective);
    assert.deepEqual(frame.native.state, {lineWidth: 1, viewport: [0, 0, frame.width, frame.height], scissor: false, colorMask: [true, true, true, true]});
    const fences = frame.native.events.filter(e => e.name === 'fenceSync' && e.label === frame.label);
    assert.ok(fences.length >= 2);
    for (const fence of fences) {
      assert.ok(frame.native.events.some(e => e.name === 'clientWaitSync' && e.sync === fence.sync && e.turn > fence.turn && [37146, 37148].includes(e.actual)), 'real fence signal recorded');
      assert.ok(frame.native.events.some(e => e.name === 'deleteSync' && e.sync === fence.sync), 'owned fence deleted');
    }
    const mode = fault ? 3 : model.draw.mode, instanced = model.effective > 1;
    assert.equal(call.name, (model.draw.indexed ? 'drawElements' : 'drawArrays') + (instanced ? 'Instanced' : ''));
    assert.deepEqual(call.args, model.draw.indexed ? [mode, model.draw.count, {1: 5121, 2: 5123, 4: 5125}[model.index.size], model.index.offset, ...(instanced ? [model.effective] : [])] : [mode, model.draw.start, model.draw.count, ...(instanced ? [model.effective] : [])]);
    for (const f of model.fetches) {
      const a = call.attributes.find(a => a.name === 'in_' + f.attributeIndex), observed = draw.vertexFetches.find(a => a.attributeIndex === f.attributeIndex);
      for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) assert.equal(observed[key], f[key]);
      assert.ok(f.requiredEnd <= storage.get(f.resourceId).byteLength); assert.equal(a.enabled, !f.constant); assert.equal(a.divisor, f.nativeDivisor);
      if (f.constant) {assert.deepEqual(a.genericValues, f.genericValues); assert.deepEqual(observed.componentWords, f.componentWords);}
      else {assert.deepEqual([a.stride, a.offset, a.components], [f.stride, f.offset, f.components]); assert.equal(a.buffer, frame.native.buffers.find(b => b.resourceId === f.resourceId).nativeBuffer);}
    }
    const row = {recording: name, index, label: frame.label, reportSha256: sha256(rawReport), pixelSha256: frame.pixels.sha256, ids: model.ids, nativeCall: call, fetches: model.fetches, ...comparison};
    if (model.draw.mode === 2 && model.draw.count === 4) {
      row.closingEdge = {x: 3, y: 4, ...model.candidate(3, 4)}; assert.equal(row.closingEdge.strict, true); assert.equal(row.closingEdge.reason, 'line interior');
    }
    if (model.draw.mode === 6 && model.draw.count >= 4) {
      row.fanArea = {x: 4, y: 8, ...model.candidate(4, 8)}; assert.equal(row.fanArea.strict, true); assert.equal(row.fanArea.reason, 'fan interior');
      // Rectangle3..12 in ABCD order: strip triangles ABC/BCD both omit (4.5,8.5).
      assert.ok(8.5 > 4.5 && 8.5 + 4.5 < 15); row.stripOmittedRegion = true;
    }
    if (fault) {assert.equal(comparison.held, false); assert.ok(comparison.misses.some(p => p.x === 3 && p.y === 4)); assert.ok(report.browserResult.error.message.includes(frame.label + ' promoted independent topology pixel oracle')); row.actualFences = fences; out.faults.push(row);}
    else {assert.equal(comparison.held, true); out.frames.push(row); out.pixels += comparison.pixels;}
  }
  if (!fault) {
    assert.equal(result.seed, 0x25df967b); assert.equal(result.frames.length, 44); assert.equal(result.rejections.length, 24); assert.equal(result.suspensions.length, 4); assert.ok(result.predictions.every(p => p.held));
    for (const row of result.wire.records) {assert.equal(row.standard.ok, literalAdmission(row.hex)); assert.equal(row.legacy.ok, literalAdmission(row.hex, true));}
    for (const run of result.runs) {
      assert.equal(run.inspection.jobs.reads, 0); assert.equal(run.inspection.jobs.stagingBytes, 0); const live = new Map(), seen = new Set();
      for (const e of run.events) {
        if (e.name === 'fenceSync') {assert.ok(!live.has(e.sync)); live.set(e.sync, e.turn);}
        if (e.name === 'clientWaitSync') {assert.ok(live.has(e.sync) && e.turn > live.get(e.sync)); const key = e.sync + ':' + e.turn; assert.ok(!seen.has(key)); seen.add(key); assert.ok([37146, 37147, 37148].includes(e.actual));}
        if (e.name === 'deleteSync') assert.equal(live.delete(e.sync), true);
      }
      assert.equal(live.size, 0);
    }
    for (const row of result.rejections) {assert.equal(row.record.result.ok, false); assert.equal(row.draws, 0); assert.equal((row.record.result.draws ?? []).length, 0);}
    for (const row of result.suspensions) {
      const r = row.record.result; assert.equal(row.point.inspection.jobs.reads, 2); assert.equal(row.async.reads, 0); assert.equal(row.async.stagingBytes, 0); assert.equal(r.gpuComplete, true);
      if (['reuse', 'cpu-backing'].includes(row.action)) {assert.equal(r.ok, true); assert.equal(r.draws[0].vertexFetches[1].resourceGeneration, row.oldGeneration);}
      else {assert.equal(r.ok, false); assert.deepEqual(r.draws, []); assert.equal(r.error.code, row.action === 'cancel' ? 'cancelled' : 'stale-storage');}
      out.lifetimes.push({action: row.action, held: true});
    }
  }
  out.custody.push({recording: name, reportSha256: sha256(rawReport), sources: report.sources, coverageSha256: report.browserCoverage.sha256, screenshotSha256: report.screenshot.sha256});
}
await audit('hardware'); await audit('fault-mode', true);
assert.equal(out.frames.length, 44); assert.equal(out.faults.length, 1);
out.status = 'passed'; await fs.writeFile(path.join(root, 'independent-audit.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({status: out.status, frames: out.frames.length, pixels: out.pixels, faultsRejected: out.faults.length}));
