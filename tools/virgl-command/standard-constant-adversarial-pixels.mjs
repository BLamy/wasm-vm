#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { repo, sha256 } from './fixtures.mjs';
import { criticModel, criticPixels } from './standard-constant-adversarial-oracle.mjs';
const root = path.resolve(process.argv[2]), out = { schema: 'D7-promoted-physical-audit-v1', status: 'running', frames: [], faults: [], pixels: 0, custody: [], pending: [] };
async function audit(name, fault = false, routing = false) {
  const directory = path.join(root, name), rawReport = await fs.readFile(path.join(directory, 'report.json')), report = JSON.parse(rawReport), r = report.partial ?? report.browserResult.result;
  assert.equal(report.task, 'E6-T11d7'); assert.equal(report.status, fault ? 'failed' : 'passed');
  assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] }); assert.equal(report.browser.headless, false);
  assert.equal(report.browser.gpu.featureStatus.webgl2 ?? report.browser.gpu.featureStatus.webgl, 'enabled');
  assert.ok(!report.browser.commandLine.some(a => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(a)));
  assert.deepEqual(report.fixedMemory, { bytes: 16777216, stageExport: 'function', pairExport: 'function' });
  const served = new Map(report.servedFiles.map(s => [s.path, s.sha256])), blobs = new Map(r.blobs.map(b => [b.key, b]));
  for (const s of report.sources) {
    const current = await fs.readFile(path.join(repo, s.path)); assert.equal(sha256(current), s.sha256, 'critic source custody ' + s.path);
    if (s.path === 'renderer/virgl-command/state.mjs') assert.equal(sha256(execFileSync('git', ['show', '39a9d14b7052c60ca11416bdba4e6eb78a38b1dd:' + s.path], { cwd: repo })), s.sha256, 'runtime unchanged from exact-head cold proof');
    if (served.has('/' + s.path)) assert.equal(served.get('/' + s.path), report.mutation?.path === s.path ? report.mutation.servedSha256 : s.sha256);
  }
  for (const key of ['browserCoverage', 'screenshot']) assert.equal(sha256(await fs.readFile(path.join(directory, report[key].path))), report[key].sha256);
  const coverage = JSON.parse(await fs.readFile(path.join(directory, report.browserCoverage.path)));
  for (const s of coverage.scripts) assert.equal(s.sha256, served.get('/' + s.source));
  if (fault) {
    const m = report.mutation, original = await fs.readFile(path.join(repo, m.path), 'utf8'), changed = await fs.readFile(path.join(directory, 'mutation-source.mjs'));
    assert.equal(original.split(m.needle).length, 2); assert.equal(sha256(changed), m.servedSha256); assert.equal(changed.toString(), original.replace(m.needle, m.replacement));
  }
  async function raw(ref) {
    const b = blobs.get(ref.key); assert.equal(b.sha256, ref.sha256); const zipped = await fs.readFile(path.join(directory, b.path)), data = gunzipSync(zipped);
    assert.equal(sha256(zipped), b.gzipSha256); assert.equal(sha256(data), b.sha256); assert.equal(data.length, b.bytes); return new Uint8Array(data);
  }
  for (const b of r.blobs) await raw(b);
  for (let fi = 0; fi < r.frames.length; fi++) {
    const frame = r.frames[fi], native = new Map(), originals = new Map();
    for (const b of frame.native.buffers) { const data = await raw(b.blob); native.set(b.resourceId, data); originals.set(b.resourceId, new Uint8Array(data.length)); }
    for (const input of frame.inputs) { const l = input.layout, data = await raw(input.blob); assert.equal(l.rowCount, 1); assert.equal(l.rowBytes, data.length); originals.get(input.resource.id).set(data, l.offset); }
    for (const [id, b] of originals) assert.deepEqual(b, native.get(id), 'literal uploads equal retained physical GPU bytes');
    const model = criticModel(frame.history, originals, frame.used), pixels = await raw(frame.pixels), audit = criticPixels(pixels, model, frame.width, frame.height), result = frame.history.at(-1).result, draw = result.draws.at(-1), call = frame.native.calls.at(-1);
    assert.equal(result.ok, true); assert.equal(result.gpuComplete, true); assert.equal(call.name, 'drawElementsInstanced');
    assert.deepEqual(call.args, [5, 4, 5125, model.index.offset, model.draw.instances]);
    assert.equal(draw.actualMinIndex, Math.min(...model.ids)); assert.equal(draw.actualMaxIndex, Math.max(...model.ids));
    if (!fault) for (const f of model.fetches) {
      const observed = draw.vertexFetches.find(a => a.attributeIndex === f.attributeIndex), a = call.attributes.find(a => a.name === 'in_' + f.attributeIndex);
      for (const k of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) assert.equal(observed[k], f[k]);
      assert.equal(a.enabled, !f.constant); assert.equal(a.divisor, f.nativeDivisor);
      if (f.constant) { assert.deepEqual(a.genericValues, f.genericValues); assert.deepEqual(observed.componentWords, f.componentWords); assert.deepEqual(observed.genericValues, f.genericValues); }
      else assert.deepEqual([a.stride, a.offset, a.components], [f.stride, f.offset, f.components]);
    }
    if (!fault && !routing) {
      const run = r.runs.find(x => x.history.some(h => h.label === frame.label)), events = run.events.filter(e => e.label === frame.label), copies = events.filter(e => e.name === 'copyBufferSubData');
      const expected = model.fetches.filter(f => f.constant).map(f => ({ resource: f.resourceId, offset: f.offset, bytes: f.components * 4 }));
      expected.push({ resource: model.index.resource, offset: model.index.offset, bytes: model.draw.count * model.index.size });
      assert.equal(copies.length, 5); const payloads = [];
      for (let i = 0; i < expected.length; i++) {
        const e = expected[i], b = frame.native.buffers.find(b => b.resourceId === e.resource); assert.deepEqual(copies[i].args, [36662, 36663, e.offset, 0, e.bytes]); assert.equal(copies[i].source, b.nativeBuffer);
        payloads.push(Buffer.from(originals.get(e.resource).subarray(e.offset, e.offset + e.bytes)).toString('hex'));
      }
      assert.deepEqual(events.filter(e => e.name === 'getBufferSubData').map(e => e.hex).sort(), payloads.sort(), 'actual staged GPU bytes are original input slices');
    }
    const row = { label: frame.label, report: name + '/report.json', reportDigest: sha256(rawReport), pointer: '/' + (fault ? 'partial' : 'browserResult/result') + '/frames/' + fi, pixelDigest: frame.pixels.sha256,
      ids: model.ids, fetches: model.fetches, ...audit };
    if (fault) { assert.equal(audit.held, false); assert.ok(report.browserResult.error.message.includes(frame.label + ' promoted independent pixel oracle')); out.faults.push(row); }
    else { assert.equal(audit.held, true); out.frames.push(row); out.pixels += audit.pixels; }
  }
  if (!fault && !routing) {
    assert.equal(r.seed, 0xa17c9e53); assert.equal(r.frames.length, 6); assert.equal(r.rejections.length, 3);
    assert.ok(r.predictions.every(p => p.held));
    for (const run of r.runs) {
      assert.equal(run.inspection.jobs.reads, 0); assert.equal(run.inspection.jobs.stagingBytes, 0); const live = new Map(), seen = new Set();
      for (const e of run.events) {
        if (e.name === 'fenceSync') { assert.ok(!live.has(e.sync)); live.set(e.sync, e.turn); }
        if (e.name === 'clientWaitSync') { assert.ok(live.has(e.sync) && e.turn > live.get(e.sync)); const key = e.sync + ':' + e.turn; assert.ok(!seen.has(key)); seen.add(key); assert.ok([37146, 37147, 37148].includes(e.actual)); }
        if (e.name === 'deleteSync') assert.equal(live.delete(e.sync), true);
      }
      assert.equal(live.size, 0);
    }
    for (const x of r.rejections) { assert.equal(x.record.result.ok, false); assert.deepEqual(x.record.result.draws, []); assert.equal(x.draws, 0); assert.equal(x.events.filter(e => e.name === 'copyBufferSubData').length, x.label === 'critic-partial-allocation' ? 1 : 0); }
    for (let i = 0; i < r.suspensions.length; i++) {
      const x = r.suspensions[i], outcome = x.record.result; assert.equal(x.point.inspection.jobs.reads, 5); assert.equal(x.point.inspection.jobs.stagingBytes, 56); assert.equal(x.async.reads, 0); assert.equal(x.async.stagingBytes, 0);
      if (['reuse', 'cpu-backing'].includes(x.action)) { assert.equal(outcome.ok, true); assert.equal(outcome.draws[0].vertexFetches[0].resourceGeneration, x.oldGeneration); }
      else { assert.equal(outcome.ok, false); assert.deepEqual(outcome.draws, []); assert.equal(outcome.gpuComplete, x.action !== 'store-dispose'); }
      if (x.action === 'collected-distinct') {
        assert.equal(x.point.collected.length, 1); assert.equal(outcome.error.code, 'stale-storage'); const a = x.changedSnapshot, before = await raw(a.original), changed = await raw(a.changed), actual = await raw(a.actual);
        assert.notDeepEqual(before, changed); assert.deepEqual(changed, actual); assert.equal(a.resourceId, 3); assert.deepEqual(a.otherPendingResources, [5, 6, 7, 22]);
        const copies = x.point.events.filter(e => e.name === 'copyBufferSubData' && e.label === x.record.label); assert.equal(copies.length, 5); assert.equal(new Set(copies.map(c => c.source)).size, 5, 'collected and remaining sources are distinct native GPU buffers');
        assert.equal(x.point.collected[0].hex, Buffer.from(before.subarray(copies[0].args[2], copies[0].args[2] + copies[0].args[4])).toString('hex'));
        out.pending.push({ action: x.action, pointer: '/browserResult/result/suspensions/' + i, reportDigest: sha256(rawReport), originalDigest: a.original.sha256, actualUploadedDigest: a.actual.sha256, distinctNativeSources: copies.map(c => c.source), retainedReadsAtPoint: 5, outcome: 'stale-storage', gpuComplete: true });
      }
    }
    assert.equal(r.suspensions.length, 6); assert.equal(r.invalidations.length, 1); const inv = r.invalidations[0]; assert.equal(inv.before.jobs.reads, 5); assert.equal(inv.after.reads, 0); assert.equal(inv.after.stagingBytes, 0); assert.equal(inv.nativeDraws, 0);
  }
  out.custody.push({ recording: name, reportDigest: sha256(rawReport), sources: report.sources, coverageDigest: report.browserCoverage.sha256, screenshotDigest: report.screenshot.sha256 });
}
await audit('hardware'); await audit('fault-generic', true); await audit('default-routing', false, true);
assert.equal(out.frames.length, 9); assert.equal(out.faults.length, 1); assert.equal(out.pixels, 5700);
out.status = 'HELD'; await fs.writeFile(path.join(root, 'independent-audit.json'), JSON.stringify(out, null, 2) + '\n');
console.log('HELD: critic 6 novel/3 retained routing frames, 5700 full pixels, distinct collected-source attack, all ownership paths and completed native sabotage');
