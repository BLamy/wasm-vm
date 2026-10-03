// Select CPU uploads explicitly. Completed reference images never initialize backing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { repo, capture, sha256, loadFixtures } from './fixtures.mjs';

export async function loadResourceFixtures() {
  const original = await loadFixtures();
  const sources = [...original.sources];
  const eventsBytes = await fs.readFile(path.join(repo, capture, 'events.jsonl'));
  assert.equal(sha256(eventsBytes), 'c6a95dbcf78f2cdd955af45fbec044cfc5fe4fbb8a4a4a93afefbad37b6856f9');
  const events = eventsBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const bySeq = new Map(events.map((event) => [event.seq, event]));
  const resources = [];
  const resourceProvenance = [];
  for (const [event, id] of [[100, 3], [111, 4], [122, 5], [133, 6], [144, 7]]) {
    const e = bySeq.get(event);
    assert.equal(e.type, 'resource_create'); assert.equal(e.phase, 'enter'); assert.equal(e.resourceId, id);
    const metadata = { id };
    for (const key of ['target', 'format', 'bind', 'width', 'height', 'depth', 'arraySize', 'lastLevel', 'nrSamples', 'flags']) {
      metadata[key] = e[key];
    }
    resources.push(metadata);
    resourceProvenance.push({ resourceId: id, event, eventsSha256: sha256(eventsBytes) });
  }
  async function snapshot(seq) {
    const e = bySeq.get(seq);
    assert.equal(e.type, 'backing_snapshot');
    assert.equal(e.blobs.length, 1);
    const b = e.blobs[0]; assert.equal(b.role, 'backing');
    let filename = `${capture}/blobs/${b.sha256}.bin`;
    let data, fileBytes;
    try { data = fileBytes = await fs.readFile(path.join(repo, filename)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      filename += '.gz'; fileBytes = await fs.readFile(path.join(repo, filename));
      data = gunzipSync(fileBytes, { maxOutputLength: b.bytes });
    }
    assert.equal(data.length, b.bytes); assert.equal(sha256(data), b.sha256);
    assert.equal(e.iovLengths.reduce((a, v) => a + v, 0), data.length);
    if (!sources.some((s) => s.path === filename)) sources.push({ path: filename, bytes: fileBytes.length,
      sha256: sha256(fileBytes), decodedBytes: data.length, decodedSha256: b.sha256 });
    return { event: seq, resourceId: e.resourceId, iovLengths: e.iovLengths, sourceSha256: b.sha256, data };
  }
  const backing = [];
  const uploadSelections = [[156, 3, 64], [157, 4, 12], [158, 5, 0], [159, 6, 0], [160, 7, 16]];
  for (const [event, resourceId, bytes] of uploadSelections) {
    const s = await snapshot(event); assert.equal(s.resourceId, resourceId);
    assert.ok(s.data.subarray(bytes).every((b) => b === 0), `unselected initial backing bytes are not zero at ${event}`);
    backing.push({ resourceId, event, iovLengths: s.iovLengths, sourceSha256: s.sourceSha256,
      ranges: bytes === 0 ? [] : [{ offset: 0, data: [...s.data.subarray(0, bytes)] }] });
  }
  const referenceOutputSnapshots = [];
  for (const [event, offset] of [[184, 64], [208, 4160], [232, 8256]]) {
    const s = await snapshot(event); assert.equal(s.resourceId, 7);
    referenceOutputSnapshots.push({ resourceId: 7, event, sourceSha256: s.sourceSha256,
      byteLength: s.data.length, offset, data: [...s.data.subarray(offset, offset + 4096)] });
  }
  return { fixtures: { commands: original.fixtures, resources, resourceProvenance, backing, referenceOutputSnapshots }, sources };
}
