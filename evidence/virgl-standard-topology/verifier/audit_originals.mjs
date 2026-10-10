import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {independentTopology, compareIndependent, literalAdmission, literalPackets} from '../../../tools/virgl-command/standard-topology-adversarial-oracle.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, 'unpacked');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const out = {schema: 'standard-topology-independent-original-audit-v1', status: 'running', frames: [], faults: [], wire: [], rejects: [], lifetimes: [], pixels: 0};
for (const prefix of ['hot', 'cold']) {
  for (const name of ['wire', 'hardware']) {
    const raw = await fs.readFile(path.join(root, prefix, name, 'report.json')), report = JSON.parse(raw);
    const wire = report.wire ?? report.browserResult.result.wire;
    for (const [index, row] of wire.records.entries()) {
      for (const legacy of [false, true]) {
        const expected = literalAdmission(row.hex, legacy), actual = row[legacy ? 'legacy' : 'standard'];
        assert.equal(actual.ok, expected, row.label);
        if (!expected) assert.equal(actual.commands, undefined, 'rejection has no decoded prefix');
      }
      out.wire.push({prefix, source: name, index, label: row.label, held: true, reportSha256: sha(raw)});
    }
  }
  for (const [name, fault] of [['hardware', false], ['fault-mode', true]]) {
    const directory = path.join(root, prefix, name), rawReport = await fs.readFile(path.join(directory, 'report.json')), report = JSON.parse(rawReport);
    const result = fault ? report.partial : report.browserResult.result, blobs = new Map(result.blobs.map(b => [b.key, b]));
    const load = async ref => {
      const b = blobs.get(ref.key); assert.ok(b); assert.equal(b.sha256, ref.sha256);
      const packed = await fs.readFile(path.join(directory, b.path)); assert.equal(sha(packed), b.gzipSha256);
      const raw = gunzipSync(packed); assert.equal(sha(raw), b.sha256); assert.equal(raw.length, b.bytes); return new Uint8Array(raw);
    };
    const inputs = async (history, exchanges) => {
      const storage = new Map();
      for (const record of history) for (const packet of literalPackets(record.hex)) if (packet.op === 43) {
        const w = packet.words;
        assert.equal(w[8], exchanges.findLast(e => e.label === record.label && e.resource.id === w[0]).blob.bytes, 'literal complete original upload size');
      }
      for (const e of exchanges) {
        const bytes = await load(e.blob); assert.equal(e.layout.offset, 0); assert.equal(e.layout.rowCount, 1); assert.equal(e.layout.rowBytes, bytes.length);
        storage.set(e.resource.id, bytes);
      }
      return storage;
    };
    for (const [index, frame] of result.frames.entries()) {
      const storage = await inputs(frame.history, frame.inputs);
      for (const b of frame.native.buffers) assert.deepEqual(await load(b.blob), storage.get(b.resourceId), 'GPU equals original input resource ' + b.resourceId);
      const m = independentTopology(frame.history, storage), pixels = await load(frame.pixels), audit = compareIndependent(pixels, m, frame.width, frame.height);
      const r = frame.history.at(-1).result, draw = r.draws.at(-1), call = frame.native.calls.at(-1);
      assert.equal(r.gpuComplete, true); assert.equal(r.ok, true);
      assert.equal(draw.actualMinIndex, m.min); assert.equal(draw.actualMaxIndex, m.max); assert.equal(draw.vertexWork, m.draw.count * m.effective);
      const mode = fault ? 3 : m.draw.mode, instanced = m.effective > 1;
      assert.equal(call.name, (m.draw.indexed ? 'drawElements' : 'drawArrays') + (instanced ? 'Instanced' : ''));
      assert.deepEqual(call.args, m.draw.indexed ? [mode, m.draw.count, {1: 5121, 2: 5123, 4: 5125}[m.index.size], m.index.offset, ...(instanced ? [m.effective] : [])] : [mode, m.draw.start, m.draw.count, ...(instanced ? [m.effective] : [])]);
      for (const f of m.fetches) {
        const a = call.attributes.find(a => a.name === 'in_' + f.attributeIndex), observed = draw.vertexFetches.find(f2 => f2.attributeIndex === f.attributeIndex);
        for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) assert.equal(observed[key], f[key]);
        assert.ok(f.requiredEnd <= storage.get(f.resourceId).byteLength); assert.equal(a.enabled, !f.constant); assert.equal(a.divisor, f.nativeDivisor);
        if (f.constant) {assert.deepEqual(observed.componentWords, f.componentWords); assert.deepEqual(observed.genericValues, f.genericValues); assert.deepEqual(a.genericValues, f.genericValues);}
        else {assert.deepEqual([a.stride, a.offset, a.components], [f.stride, f.offset, f.components]); assert.equal(a.buffer, frame.native.buffers.find(b => b.resourceId === f.resourceId).nativeBuffer);}
      }
      const line = rawReport.toString().slice(0, rawReport.toString().indexOf('"label": "' + frame.label + '"')).split('\n').length;
      const row = {prefix, name, index, label: frame.label, reportLine: line, reportSha256: sha(rawReport), pixelsSha256: frame.pixels.sha256,
        mode: m.draw.mode, call: call.name, ids: m.ids, effectiveInstances: m.effective, fetches: m.fetches,
        ...audit, loopClosingProbe: m.draw.mode === 2 && m.draw.count === 4 ? {x: 2, y: 3, ...m.candidate(2, 3)} : null,
        fanProbe: m.draw.mode === 6 && m.draw.count >= 4 ? {x: 3, y: 10, ...m.candidate(3, 10)} : null};
      if (fault) {
        assert.equal(audit.held, false); assert.ok(audit.misses.some(p => p.x === 2 && p.y === 3 && p.reason === 'line interior'));
        assert.ok(report.browserResult.error.message.includes(frame.label + ' independent topology pixel oracle'));
        out.faults.push(row);
      } else {assert.equal(audit.held, true, frame.label); out.frames.push(row); out.pixels += audit.pixels;}
    }
    if (fault) continue;
    for (const row of result.rejections) {
      const run = result.runs.find(run => run.history.at(-1).label === row.label), r = row.record.result;
      assert.equal(r.ok, false); assert.deepEqual(run.calls, []); assert.deepEqual(r.draws, []);
      const history = run.history, storage = await inputs(history, run.exchanges), packet = literalPackets(history.at(-1).hex).findLast(p => p.op === 8), w = packet.words;
      let reason;
      if (row.label.startsWith('work-')) {assert.equal(w[1] * Math.max(1, w[4]), 8); assert.equal(run.inspection.drawLimits.indicesPerSubmission, 7); reason = 'limit-exceeded';}
      else if (row.label.startsWith('short-index-')) {
        const binding = literalPackets(history.at(-1).hex).find(p => p.op === 11).words;
        assert.equal(binding[2] + w[1] * binding[1], storage.get(binding[0]).byteLength + 1); reason = 'out-of-bounds';
      } else {
        const m = independentTopology(history, storage, {skipPixels: true}), f = m.fetches[0];
        assert.equal(f.requiredEnd, storage.get(f.resourceId).byteLength + 1); assert.equal(m.draw.count, 5); reason = 'out-of-bounds';
      }
      assert.equal(r.error.code, reason);
      assert.equal(run.inspection.jobs.reads, 0); assert.equal(run.inspection.jobs.stagingBytes, 0);
      out.rejects.push({prefix, label: row.label, reason, held: true});
    }
    for (const row of result.suspensions) {
      const r = row.record.result, run = result.runs.find(run => run.history.at(-1).label === row.record.label);
      assert.equal(row.point.inspection.jobs.status, 'waiting-attributes'); assert.equal(row.point.inspection.jobs.reads, 2);
      assert.equal(r.gpuComplete, true); assert.equal(row.async.reads, 0); assert.equal(row.async.stagingBytes, 0);
      const fences = run.events.filter(e => e.name === 'fenceSync').map(e => e.sync), deleted = run.events.filter(e => e.name === 'deleteSync').map(e => e.sync);
      assert.deepEqual([...fences].sort(), [...deleted].sort(), 'every owned fence drained and deleted');
      for (const e of run.events.filter(e => e.name === 'clientWaitSync')) {const fence = run.events.find(f => f.name === 'fenceSync' && f.sync === e.sync); assert.ok(e.turn > fence.turn);}
      if (row.action === 'reuse') {assert.equal(r.ok, true); assert.ok(row.newGeneration > row.oldGeneration); assert.equal(r.draws[0].vertexFetches[1].resourceGeneration, row.oldGeneration);}
      else {assert.equal(r.ok, false); assert.deepEqual(run.calls, []); assert.deepEqual(r.draws, []); assert.equal(r.error.code, row.action === 'cancel' ? 'cancelled' : 'stale-storage');}
      out.lifetimes.push({prefix, action: row.action, held: true, fenceCount: fences.length});
    }
    for (const run of result.runs) {assert.equal(run.inspection.jobs.reads, 0); assert.equal(run.inspection.jobs.stagingBytes, 0);}
    const d6 = JSON.parse(await fs.readFile(path.join(root, prefix, 'retained-standard-draw/receipt.json')));
    assert.equal(d6.frames, 37); assert.equal(d6.checkedPhysicalPixels, 10296); assert.equal(d6.status, 'passed');
    const d7 = JSON.parse(await fs.readFile(path.join(root, prefix, 'retained-constant/physical-audit.json')));
    assert.equal(d7.frames.length, 31); assert.equal(d7.pixels, 12500); assert.equal(d7.status, 'passed');
  }
}
assert.equal(out.frames.length, 174); assert.equal(out.pixels, 100352); assert.equal(out.wire.length, 316); assert.equal(out.rejects.length, 24); assert.equal(out.lifetimes.length, 6); assert.equal(out.faults.length, 2);
out.status = 'passed'; await fs.writeFile(path.join(here, 'original-audit.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({status: out.status, frames: out.frames.length, pixels: out.pixels, wire: out.wire.length, rejects: out.rejects.length, lifetimes: out.lifetimes.length, rejectedFaults: out.faults.length}));
