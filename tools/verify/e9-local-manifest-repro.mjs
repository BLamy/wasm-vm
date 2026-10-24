#!/usr/bin/env node
// Reconstruct the exact rejected cold-257 publication from the retained C run.
// This is a metadata-boundary proof, not full workload qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const args = process.argv.slice(2);
assert.deepEqual(args.filter((_, index) => index % 2 === 0), ['--directory', '--output']);
const desktop = path.resolve(args[1]), output = path.resolve(args[3]);
fs.mkdirSync(output);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input));
  if (url.protocol === 'file:') return new Response(fs.readFileSync(url), {
    headers: {'Content-Type': url.pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'},
  });
  return nativeFetch(input, init);
};
const metadata = await import('../../web/session-pkg/wasm_vm_session.js');
await metadata.default();
const {inventoryWitnessGraph} = await import('../../web/session-witness-graph.js');
const savedBytes = fs.readFileSync(path.join(desktop, 'saved/storage.json'));
const saved = JSON.parse(savedBytes), objects = new Map(saved.stores.objects.map(row => [row.key, row.value]));
const sourceReportBytes = fs.readFileSync(path.join(desktop, 'report.json'));
const sourceReport = JSON.parse(sourceReportBytes);
assert.equal(sourceReport.status, 'failed');
assert.equal(sourceReport.head, 'bcc6bc1c4a8eb7d6cb82a1ffc1653b2827d63a60');
assert.match(sourceReport.result.error, /TooLarge\("session payload"\)/);
const chunk = hash => fs.readFileSync(path.join(desktop, 'saved/chunks', hash + '.bin'));
const object = hash => {
  const descriptor = objects.get(hash);
  assert(descriptor, `missing object ${hash}`);
  const bytes = Buffer.concat(descriptor.parts.map(part => chunk(part.sha256)));
  assert.equal(bytes.length, Number(descriptor.length));
  assert.equal(sha(bytes), hash);
  return bytes;
};
const source = {
  async *stream(ref) {
    const descriptor = objects.get(ref.sha256);
    assert(descriptor, `missing object ${ref.sha256}`);
    assert.equal(String(descriptor.length), ref.length);
    for (const part of descriptor.parts) yield new Uint8Array(chunk(part.sha256));
  },
  async objectReference(hash) {
    const descriptor = objects.get(hash);
    assert(descriptor, `missing object ${hash}`);
    return {sha256: hash, length: String(descriptor.length)};
  },
};
const committedBytes = Uint8Array.from(saved.stores.sessions[0].value.manifest);
const committed = JSON.parse(Buffer.from(committedBytes));
assert.equal(saved.stores.sessions[0].value.revision, '495');
assert.equal(committed.end.transition, '12850000000');
assert.equal(committed.checkpoints.at(-1).id, 'cold-256');
const components = manifest => ({
  events: manifest.events.reduce((sum, row) => sum + Number(row.content.length), 0),
  machines: manifest.checkpoints.reduce((sum, point) => sum + Number(point.machine.length), 0),
  gpu: manifest.checkpoints.reduce((sum, point) => sum + Number(point.gpu?.length ?? 0), 0),
});
const directBytes = manifest => Object.values(components(manifest)).reduce((sum, value) => sum + value, 0);
assert.equal(directBytes(committed), 4_291_892_438);
const failedPosition = sourceReport.result.failurePosition;
const position = Object.fromEntries(['transition', 'phase', 'ordinal', 'sequence', 'retired']
  .map(key => [key, failedPosition[key]]));
const prefix = descriptor => {
  const fd = fs.openSync(path.join(desktop, 'saved/chunks', descriptor.parts[0].sha256 + '.bin'), 'r');
  try {const bytes = Buffer.alloc(8); fs.readSync(fd, bytes, 0, 8, 0); return bytes.toString();}
  finally {fs.closeSync(fd);}
};
const keyframes = [...objects.entries()].filter(([, value]) =>
  Number(value.length) <= 1048576 && prefix(value) === 'WVKEYF01');
const candidates = keyframes.filter(([hash]) => {
  const value = JSON.parse(object(hash).subarray(8));
  if (value.parent.sha256 !== committed.checkpoints.at(-1).machine.sha256) return false;
  const frameBytes = object(value.frame.sha256);
  assert.equal(frameBytes.subarray(0, 8).toString(), 'WVGPUD01');
  const view = new DataView(frameBytes.buffer, frameBytes.byteOffset, frameBytes.byteLength);
  const frameMeta = JSON.parse(frameBytes.subarray(32, 32 + view.getUint32(12, true)));
  return Object.keys(position).every(key => frameMeta.position[key] === position[key]);
});
assert.equal(candidates.length, 1, 'unique staged keyframe for the failed C position');
const machineHash = candidates[0][0];
const descriptorBytes = object(machineHash), descriptor = JSON.parse(descriptorBytes.subarray(8));
assert.equal(descriptorBytes.subarray(0, 8).toString(), 'WVKEYF01');
assert.equal(descriptor.parent.sha256, committed.checkpoints.at(-1).machine.sha256);
const frame = object(descriptor.frame.sha256);
assert.equal(frame.subarray(0, 8).toString(), 'WVGPUD01');
const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
const meta = JSON.parse(frame.subarray(32, 32 + view.getUint32(12, true)));
assert.deepEqual(meta.position, {transition: '12900000000', phase: 'before', ordinal: 0,
  sequence: '1913', retired: '12899290970'});
const rendererHash = meta.rendererSha256;
assert.equal(meta.position.transition, sourceReport.result.failurePosition.transition);
assert.equal(objects.get(rendererHash).length, '4641650');
const old = JSON.parse(Buffer.from(committed.extensions[1].bytes));
const witnessPages = [...objects.entries()].filter(([, value]) =>
  Number(value.length) <= 1048576 && prefix(value).startsWith('{')).flatMap(([hash]) => {
    let page;
    try {page = JSON.parse(object(hash));} catch {return [];}
    return page?.previous?.sha256 === old.tail.sha256 && page.rows?.length === 1
      && Object.keys(position).every(key => page.rows[0][key] === position[key]) ? [[hash, page]] : [];
  });
assert.equal(witnessPages.length, 1, 'unique staged witness page for the failed C position');
const [witnessHash, page] = witnessPages[0];
assert.equal(page.rows.length, 1);
assert.deepEqual(Object.fromEntries(Object.keys(position).map(key => [key, page.rows[0][key]])), position);
assert.equal(Buffer.from(page.rows[0].digest).toString('hex'), meta.stateSha256);
assert.equal(page.before, old.count);
assert.equal(page.previous.sha256, old.tail.sha256);
const next = {version: 2, count: old.count + 1, pages: old.pages + 1,
  tail: {sha256: witnessHash, length: String(objects.get(witnessHash).length)},
  first: old.first, last: page.rows[0], finished: false};
const candidate = structuredClone(committed);
candidate.end = position;
candidate.checkpoints.push({id: 'cold-257', position, next_sequence: '1914',
  machine: {sha256: machineHash, length: String(descriptorBytes.length)},
  disk_root: candidate.checkpoints.at(-1).disk_root,
  gpu: {sha256: rendererHash, length: String(objects.get(rendererHash).length)}});
candidate.extensions = [candidate.extensions[0], {kind: 'e9-exact-witness-pages-v2',
  required: true, bytes: [...Buffer.from(JSON.stringify(next))]}];
const candidateBytes = metadata.sessionValidateLocalManifest(new TextEncoder().encode(JSON.stringify(candidate)));
fs.writeFileSync(path.join(output, 'cold-257-candidate.json'), candidateBytes);
assert.equal(directBytes(candidate), 4_296_534_553);
assert.deepEqual(metadata.sessionValidateLocalManifest(candidateBytes), candidateBytes);
assert.throws(() => metadata.sessionValidateManifest(candidateBytes), /TooLarge\("session payload"\)/);
metadata.sessionCheckLocalAppend(committedBytes, candidateBytes);
assert.throws(() => metadata.sessionCheckAppend(committedBytes, candidateBytes), /TooLarge\("session payload"\)/);
const graph = await inventoryWitnessGraph(source, candidateBytes, {scope: 'local', previous: committed});
assert.equal(graph.manifest.checkpoints.at(-1).id, 'cold-257');
const logicalBytes = candidateBytes.length + graph.refs.reduce((sum, ref) => sum + Number(ref.length), 0);
const {SessionGpuJournal} = await import('../../web/session-gpu-journal.js');
const {decodeKeyframeDescriptor} = await import('../../web/session-keyframes.js');
const {decodeGpuExactFrame} = await import('../../web/session-gpu-replay-format.js');
const staged = decodeKeyframeDescriptor(descriptorBytes);
const frameRecord = decodeGpuExactFrame(object(staged.frame.sha256));
const rendererBytes = object(rendererHash);
const ramChunks = staged.chunks.map(ref => object(ref.sha256));
const inflated = structuredClone(committed);
const localLimit = 64 * 1024 ** 3;
const nextDirectBytes = directBytes(candidate) - directBytes(committed);
let needed = localLimit - nextDirectBytes + 1 - directBytes(inflated);
for (const point of inflated.checkpoints.slice(0, -1)) {
  const current = Number(point.machine.length), increment = Math.min(needed, 4 * 1024 ** 3 - current);
  point.machine.length = String(current + increment);
  needed -= increment;
  if (needed === 0) break;
}
assert.equal(needed, 0);
assert.equal(directBytes(inflated), localLimit - nextDirectBytes + 1);
metadata.sessionValidateLocalManifest(new TextEncoder().encode(JSON.stringify(inflated)));
const acknowledgements = [];
let captured = 0, attemptedPublication = 0;
const hexBytes = hash => Uint8Array.from(hash.match(/../g), pair => Number.parseInt(pair, 16));
const machine = {
  inputPosition: () => frameRecord.meta.position,
  exactGpuSessionEpoch: () => frameRecord.meta.rendererEpoch,
  captureExactGpuKeyframe: () => {captured++;
    return {...frameRecord.meta.position, native: frameRecord.native,
      pending: frameRecord.pending, output: frameRecord.output,
      digest: hexBytes(frameRecord.meta.stateSha256), ramDigest: hexBytes(frameRecord.meta.ramSha256)};},
  pendingSoftwareRamPages: () => staged.dirtyPages,
  nextSoftwareRamDeltaChunk: cursor => cursor < ramChunks.length
    ? {next: cursor + 1, bytes: new Uint8Array(ramChunks[cursor])} : null,
  finishSoftwareRamEpoch: committed => acknowledgements.push(committed),
};
const renderer = {saveCheckpoint: async () => ({bytes: new Uint8Array(rendererBytes),
  sha256: rendererHash, epoch: frameRecord.meta.rendererEpoch})};
const syntheticWriter = {put: async () => {}, publish: async () => {attemptedPublication++;}};
const journal = new SessionGpuJournal(source, syntheticWriter, inflated, {});
await assert.rejects(journal.captureKeyframe(machine, renderer, 'local-overcap-rollback'),
  /TooLarge\("session payload"\)/);
assert.equal(captured, 1);
assert.equal(attemptedPublication, 0);
assert.deepEqual(acknowledgements, [false]);
const malformed = structuredClone(candidate);
malformed.checkpoints[0].id = 'rewritten-initial';
const malformedBytes = metadata.sessionValidateLocalManifest(new TextEncoder().encode(JSON.stringify(malformed)));
assert.throws(() => metadata.sessionCheckLocalAppend(committedBytes, malformedBytes));
const missingDescriptor = objects.get(witnessHash);
objects.delete(witnessHash);
try {
  await assert.rejects(inventoryWitnessGraph(source, candidateBytes, {scope: 'local', previous: committed}),
    /missing object/);
} finally {objects.set(witnessHash, missingDescriptor);}
const corruptSource = {
  ...source,
  async *stream(ref) {
    if (ref.sha256 === witnessHash) {
      const changed = object(witnessHash).slice();
      changed[0] ^= 1;
      yield new Uint8Array(changed);
    } else yield* source.stream(ref);
  },
};
await assert.rejects(inventoryWitnessGraph(corruptSource, candidateBytes,
  {scope: 'local', previous: committed}));
let archiveError;
try {await inventoryWitnessGraph(source, candidateBytes);}
catch (error) {archiveError = error;}
assert.equal(archiveError?.code, 'BundleBound');
const retention = saved.stores.metadata.find(row => row.key === 'limits').value.maxBytes;
const physical = saved.stores.chunks.reduce((sum, row) => sum + Number(row.bytes), 0);
assert(physical <= retention);
const report = {task: 'E9-T22l', scope: 'Exact cold-257 local metadata boundary; not C completion',
  sourceSha256: sha(fs.readFileSync(new URL(import.meta.url))), savedSha256: sha(savedBytes),
  failedReportSha256: sha(sourceReportBytes), discovered: {machineHash, rendererHash, witnessHash,
    keyframesScanned: keyframes.length, witnessPagesScanned: witnessPages.length},
  committed: {revision: '495', directBytes: directBytes(committed), components: components(committed),
    checkpoints: committed.checkpoints.length, events: committed.events.length},
  candidate: {position, manifestSha256: sha(candidateBytes), directBytes: directBytes(candidate),
    components: components(candidate),
    logicalBytes, references: graph.refs.length, physicalBytes: physical, retentionBytes: retention},
  attacks: {malformedAppend: 'rejected', missingWitnessObject: 'rejected',
    corruptWitnessObject: 'rejected', failedEpoch: {localLimit, nextDirectBytes,
      validPrefixDirectBytes: directBytes(inflated), captured, attemptedPublication,
      acknowledgements}},
  portableError: {code: archiveError.code, message: archiveError.message}, status: 'passed'};
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({status: report.status, candidate: report.candidate, portableError: report.portableError}));
