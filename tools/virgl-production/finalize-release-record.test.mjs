import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {finalizeReleaseRecord} from './finalize-release-record.mjs';

test('the primary failure reaches disk before cleanup, and a rejection cannot skip the remaining browser close', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-report-'));
  try {
    const file = path.join(directory, 'report.json');
    const report = {status: 'failed', error: 'original acceptance failure'};
    const save = () => writeFile(file, JSON.stringify(report));
    const closed = [];
    await finalizeReleaseRecord(report, save, [
      {name: 'context', close: async () => {
        const persisted = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(persisted.error, 'original acceptance failure');
        assert.equal(persisted.status, 'failed');
        closed.push('context');
        throw new Error('already disconnected');
      }},
      {name: 'browser', close: async () => { closed.push('browser'); }},
    ]);
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(closed, ['context', 'browser']);
    assert.equal(persisted.error, 'original acceptance failure');
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.cleanupErrors.length, 1);
    assert.equal(persisted.cleanupErrors[0].resource, 'context');
    assert.match(persisted.cleanupErrors[0].error, /already disconnected/);
    assert.ok(Number.isFinite(Date.parse(persisted.finishedAt)));
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('cleanup failure makes a previously passed record fail; clean closure retains its result', async () => {
  for (const fail of [true, false]) {
    const report = {status: 'passed'};
    let final;
    await finalizeReleaseRecord(report, async () => { final = structuredClone(report); }, [
      {name: 'browser', close: async () => { if (fail) throw new Error('close failed'); }},
    ]);
    assert.equal(final.status, fail ? 'failed' : 'passed');
    assert.equal(final.cleanupErrors?.length ?? 0, fail ? 1 : 0);
    assert.ok(Number.isFinite(Date.parse(final.finishedAt)));
  }
});
