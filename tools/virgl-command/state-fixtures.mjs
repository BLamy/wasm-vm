// Original command/backing corpus plus dependency-selected public cleanup events.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { repo, capture, sha256 } from './fixtures.mjs';
import { loadResourceFixtures } from './resource-fixtures.mjs';

export async function loadStateFixtures() {
  const loaded = await loadResourceFixtures();
  const bytes = await fs.readFile(path.join(repo, capture, 'events.jsonl'));
  assert.equal(sha256(bytes), 'c6a95dbcf78f2cdd955af45fbec044cfc5fe4fbb8a4a4a93afefbad37b6856f9');
  const events = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const selected = [238, 240, 242, 251, 253, 255, 257, 259, 261, 263, 265, 267, 269, 271, 273, 275];
  const lifecycle = selected.map((seq) => {
    const e = events.find((event) => event.seq === seq);
    assert.equal(e.phase, 'enter');
    assert.ok(['ctx_detach_resource', 'resource_detach_iov', 'resource_unref', 'context_destroy'].includes(e.type));
    const returned = events.find((event) => event.callSeq === seq && event.phase === 'return');
    assert.equal(returned.result, 0);
    return { event: seq, type: e.type, ...(e.resourceId === undefined ? {} : { resourceId: e.resourceId }),
      ...(e.ctxId === undefined ? {} : { contextId: e.ctxId }), eventsSha256: sha256(bytes) };
  });
  return { fixtures: { ...loaded.fixtures, lifecycle }, sources: loaded.sources };
}
