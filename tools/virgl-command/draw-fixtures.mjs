// Dependency-selected original scene, retaining chronological public initialization.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { repo, capture, sha256 } from './fixtures.mjs';
import { loadStateFixtures } from './state-fixtures.mjs';

export async function loadDrawFixtures() {
  const loaded = await loadStateFixtures();
  const eventBytes = await fs.readFile(path.join(repo, capture, 'events.jsonl'));
  const eventsSha256 = sha256(eventBytes);
  assert.equal(eventsSha256, 'c6a95dbcf78f2cdd955af45fbec044cfc5fe4fbb8a4a4a93afefbad37b6856f9');
  const events = eventBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const bySeq = new Map(events.map((entry) => [entry.seq, entry]));
  const initialization = [];
  const selected = [96, 100, 104, 107, 111, 115, 118, 122, 126, 129, 133, 137, 140, 144, 148, 151];
  for (const seq of selected) {
    const e = bySeq.get(seq);
    assert.equal(e.phase, 'enter'); assert.equal(e.parentCallSeq, 0);
    assert.equal(events.find((entry) => entry.callSeq === seq && entry.phase === 'return').result, 0);
    const action = { event: seq, type: e.type, eventsSha256,
      ...(e.ctxId === undefined ? {} : { contextId: e.ctxId }),
      ...(e.resourceId === undefined ? {} : { resourceId: e.resourceId }) };
    if (e.type === 'context_create') assert.equal(e.ctxId, 2);
    else if (e.type === 'resource_create') {
      action.metadata = loaded.fixtures.resources.find((resource) => resource.id === e.resourceId);
      assert.ok(action.metadata);
      assert.equal(loaded.fixtures.resourceProvenance.find((p) => p.resourceId === e.resourceId).event, seq);
    } else if (e.type === 'ctx_attach_resource') assert.equal(e.ctxId, 2);
    else {
      assert.equal(e.type, 'resource_attach_iov');
      const snapshot = bySeq.get(seq + 1);
      assert.equal(snapshot.type, 'backing_snapshot'); assert.equal(snapshot.reason, 'attach');
      assert.equal(snapshot.resourceId, e.resourceId); assert.equal(snapshot.blobs.length, 1);
      assert.equal(snapshot.iovLengths.length, e.iovCount);
      const blob = snapshot.blobs[0]; assert.equal(blob.role, 'backing');
      let filename = `${capture}/blobs/${blob.sha256}.bin`, encoded, decoded;
      try { decoded = encoded = await fs.readFile(path.join(repo, filename)); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        filename += '.gz'; encoded = await fs.readFile(path.join(repo, filename));
        decoded = gunzipSync(encoded, { maxOutputLength: blob.bytes });
      }
      assert.equal(decoded.length, blob.bytes); assert.equal(sha256(decoded), blob.sha256);
      assert.ok(decoded.every((byte) => byte === 0), `original attachment ${seq} was not zero`);
      assert.equal(snapshot.iovLengths.reduce((sum, size) => sum + size, 0), decoded.length);
      assert.deepEqual(snapshot.iovLengths, loaded.fixtures.backing.find((b) => b.resourceId === e.resourceId).iovLengths);
      if (!loaded.sources.some((source) => source.path === filename)) loaded.sources.push({ path: filename,
        bytes: encoded.length, sha256: sha256(encoded), decodedBytes: decoded.length, decodedSha256: blob.sha256 });
      action.iovLengths = snapshot.iovLengths;
      action.snapshotEvent = snapshot.seq; action.snapshotSha256 = blob.sha256;
    }
    initialization.push(action);
  }
  return { fixtures: { ...loaded.fixtures, initialization,
    selection: { contextId: 2, resourceIds: [3, 4, 5, 6, 7],
      initializationEvents: selected, initialCpuSnapshots: [156, 157, 158, 159, 160],
      submissionEvents: [161, 173, 185, 197, 209, 221, 233, 249],
      excluded: ['Independent boot scanout context1/resources1–2 and their public transfers',
        'Nested context_create_with_flags97 is part of public context_create96, not a second creation',
        'Fence/poll and display transport events: this is synchronous renderer replay, not virtio transport',
        'Later CPU snapshots are reference output only; none initialize guest backing'] } }, sources: loaded.sources };
}
