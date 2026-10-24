#!/usr/bin/env node
// Revisit the exact failed E9-T22c checkpoint from its exported physical store.
// The exported prefix is diagnostic input, not a substitute for a full C run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const args = process.argv.slice(2);
assert.equal(args.length, 4);
assert.equal(args[0], '--directory');
assert.equal(args[2], '--output');
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
const {inventoryWitnessGraph} = await import('../../web/session-witness-graph.js');
const savedBytes = fs.readFileSync(path.join(desktop, 'saved/storage.json'));
const saved = JSON.parse(savedBytes), objects = new Map(saved.stores.objects.map(row => [row.key, row.value]));
const chunk = hash => fs.readFileSync(path.join(desktop, 'saved/chunks', hash + '.bin'));
const object = hash => Buffer.concat(objects.get(hash).parts.map(part => chunk(part.sha256)));
const missingObject = hash => Object.assign(new Error('MissingObject: ' + hash), {code: 'MissingObject'});
const source = {
  async *stream(ref) {
    const value = objects.get(ref.sha256);
    if (!value) throw missingObject(ref.sha256);
    for (const part of value.parts) yield new Uint8Array(chunk(part.sha256));
  },
  async objectReference(hash) {
    const value = objects.get(hash);
    if (!value) throw missingObject(hash);
    return {sha256: hash, length: String(value.length)};
  },
};
const refused = async (label, work, code) => {
  let error;
  try {await work();} catch (caught) {error = caught;}
  assert(error, label + ' accepted');
  if (code) assert.equal(error.code, code, `${label}: ${error.message}`);
  return {name: error.name, code: error.code ?? null, message: error.message};
};
const committedBytes = new Uint8Array(saved.stores.sessions[0].value.manifest);
const committed = JSON.parse(Buffer.from(committedBytes));
assert.equal(saved.stores.sessions[0].value.revision, '262');
assert.equal(committed.end.transition, '6400000000');
assert.equal(committed.checkpoints.at(-1).id, 'cold-126');
const graph = await inventoryWitnessGraph(source, committedBytes, {scope: 'local'});
const logical = committedBytes.length + graph.refs.reduce((sum, ref) => sum + Number(ref.length), 0);
assert.equal(logical, 4_281_733_856);
const witnessHash = '5cdab15a95d60f5af1f322fc980768efe500b7fc5eb543b29a6d0ae1b6a13730';
const machineHash = '92e988b616e3cf1426f11ae8f60f1c9fad3ee76500dc899164fa69a49ad23202';
const rendererHash = '98e025c6b753b003315617c042c3c17c0955d200dd86ab812b5ebbcbdb288b74';
const position = {transition: '6400000000', phase: 'before', ordinal: 1, sequence: '1054', retired: '6399545078'};
const page = JSON.parse(object(witnessHash));
const old = JSON.parse(Buffer.from(committed.extensions[1].bytes));
const next = {version: 2, count: old.count + 1, pages: old.pages + 1,
  tail: {sha256: witnessHash, length: String(objects.get(witnessHash).length)},
  first: old.first, last: page.rows[0], finished: false};
const candidate = structuredClone(committed);
candidate.end = position;
candidate.checkpoints.push({id: 'cold-127', position, next_sequence: '1055',
  machine: {sha256: machineHash, length: String(objects.get(machineHash).length)},
  disk_root: candidate.checkpoints.at(-1).disk_root,
  gpu: {sha256: rendererHash, length: String(objects.get(rendererHash).length)}});
candidate.extensions = [candidate.extensions[0], {kind: 'e9-exact-witness-pages-v2',
  required: true, bytes: [...Buffer.from(JSON.stringify(next))]}];
const candidateBytes = new TextEncoder().encode(JSON.stringify(candidate));
fs.writeFileSync(path.join(output, 'cold-127-candidate.json'), candidateBytes);
const admitted = await inventoryWitnessGraph(source, candidateBytes, {scope: 'local'});
const candidateLogical = candidateBytes.length + admitted.refs.reduce((sum, ref) => sum + Number(ref.length), 0);
assert.equal(admitted.refs.length, 1172);
assert.equal(candidateLogical, 4_311_983_484);
const reachableChunks = new Map();
for (const ref of admitted.refs) {
  const value = objects.get(ref.sha256);
  assert(value, 'candidate object missing ' + ref.sha256);
  for (const part of value.parts) {
    const previous = reachableChunks.get(part.sha256);
    assert(!previous || previous === Number(part.length), 'conflicting physical chunk length');
    reachableChunks.set(part.sha256, Number(part.length));
  }
}
let reachablePhysicalChunkBytes = 0;
for (const [hash, length] of reachableChunks) {
  const bytes = chunk(hash);
  assert.equal(bytes.length, length);
  assert.equal(sha(bytes), hash);
  reachablePhysicalChunkBytes += length;
}
const limit = saved.stores.metadata.find(row => row.key === 'limits').value.maxBytes;
assert(reachablePhysicalChunkBytes <= limit, 'candidate physical closure exceeds configured retention');
const archive = await refused('portable archive inventory',
  () => inventoryWitnessGraph(source, candidateBytes), 'BundleBound');
const oversized = structuredClone(candidate);
for (const [index, point] of oversized.checkpoints.entries())
  point.machine = {sha256: index.toString(16).padStart(64, '0'), length: '671088640'};
const nativeDirectBound = await refused('native direct-payload cap',
  () => inventoryWitnessGraph(source, new TextEncoder().encode(JSON.stringify(oversized)), {scope: 'local'}));
assert.match(nativeDirectBound.message, /TooLarge\("session payload"\)/);
const controller = new AbortController(); let cancelChunks = 0;
const cancellingSource = {...source, async *stream(ref) {
  for await (const part of source.stream(ref)) {if (++cancelChunks === 12) controller.abort(); yield part;}
}};
const cancelled = await refused('midwalk cancellation',
  () => inventoryWitnessGraph(cancellingSource, candidateBytes, {scope: 'local', signal: controller.signal}), 'BundleCancelled');
assert(cancelChunks >= 12 && cancelChunks < reachableChunks.size);
const mutation = structuredClone(candidate);
mutation.checkpoints[0].gpu.length = String(Number(mutation.checkpoints[0].gpu.length) - 1);
const badLength = await refused('conflicting original GPU length',
  () => inventoryWitnessGraph(source, new TextEncoder().encode(JSON.stringify(mutation)), {scope: 'local'}));
const missing = objects.get(witnessHash);
objects.delete(witnessHash);
const missingWitness = await refused('missing required witness page',
  () => inventoryWitnessGraph(source, candidateBytes, {scope: 'local'}), 'MissingObject');
objects.set(witnessHash, missing);
assert.match(badLength.message, /LengthMismatch|length/i);
assert.match(missingWitness.message, /MissingObject/);
const report = {task: 'E9-T22k', scope: 'Exact failed-prefix policy reproduction; not full C qualification',
  sourceSha256: sha(fs.readFileSync(new URL(import.meta.url))), savedSha256: sha(savedBytes),
  committed: {revision: '262', logicalBytes: logical, references: graph.refs.length},
  candidate: {position, manifestSha256: sha(candidateBytes), logicalBytes: candidateLogical, references: admitted.refs.length,
    reachablePhysicalChunkBytes, reachableChunks: reachableChunks.size, retentionBytes: limit,
    storedPhysicalChunkBytes: saved.stores.chunks.reduce((sum, row) => sum + Number(row.bytes), 0)},
  archive, nativeDirectBound, cancelled, cancelChunks, badLength, missingWitness, status: 'passed'};
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({status: report.status, candidate: report.candidate, archive}));
