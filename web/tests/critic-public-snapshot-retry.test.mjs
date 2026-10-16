// Independent negative-boundary checks for the actual public save wrapper.
// Controller refusals are injected only to interrogate retry/error handling;
// actual disk/RAM coherence is proved by recorded original-worker Node boots.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = main.indexOf('  async snapshotSave() {');
const end = main.indexOf('  // Run a shell command in the guest', start);
assert.ok(start >= 0 && end > start, 'extract the unchanged production public method');
const method = main.slice(start, end);

function fixture({paused = true, refusal, persistRefusal} = {}) {
  const calls = [];
  let saves = 0, persists = 0, active = !paused, queued = 0;
  const controller = {
    async isPaused() { calls.push('isPaused'); return !active; },
    async pause() { calls.push('pause'); active = false; },
    async resume() { calls.push('resume'); active = true; },
    async persist() {
      calls.push('persist');
      assert.equal(active, false, 'every durability drain stays paused');
      persists++;
      if (persistRefusal?.(persists)) throw Error('disk durability failed');
      queued = 0;
    },
    async persistStats() {
      calls.push('persistStats');
      return {pendingBlocks: queued, flushWaiting: false, writeWaiting: false};
    },
    async snapshotSave() {
      calls.push('save');
      assert.equal(active, false, 'every retry stays paused');
      assert.equal(queued, 0, 'newly admitted durable batches drain before retry');
      const error = refusal?.(++saves);
      if (error) { queued = 1; throw error; }
    },
  };
  const context = {
    linuxCtl: controller,
    performance: {now: () => 0},
    // Elide elapsed wait only. Do not replace the method under test.
    setTimeout(callback) { calls.push('yield'); queueMicrotask(callback); },
  };
  vm.runInNewContext(`globalThis.api = {${method}
    async snapshotStatus() { return {available:true, decision:'resume', generation:4}; }
  };`, context);
  return {calls, save: () => context.api.snapshotSave(), counts: () => ({saves, persists, active})};
}

test('later durability batches retry while paused and drain before each save', async () => {
  // Prediction: two quiescence refusals cause three saves, each preceded by a
  // fresh drain; an already paused caller is never resumed.
  const f = fixture({refusal: attempt => attempt <= 2
    ? Error('not_quiesced: Write in_flight=1') : null});
  const result = await f.save();
  assert.equal(result.ok, true);
  assert.equal(result.decision, 'resume');
  assert.deepEqual(f.counts(), {saves: 3, persists: 3, active: false});
  assert.equal(f.calls.filter(call => call === 'pause' || call === 'resume').length, 0);
});

test('permanent quiescence refusal terminates with its original error', async () => {
  // Prediction: the bounded wrapper makes at most twenty attempts and never
  // turns permanent core refusal into a successful checkpoint.
  const f = fixture({refusal: () => Error('not_quiesced: Write in_flight=1')});
  const result = await f.save();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_quiesced: Write in_flight=1');
  assert.deepEqual(f.counts(), {saves: 20, persists: 20, active: false});
});

test('other refusal classes are never retried and restore caller run state once', async () => {
  // Prediction: API/profile/storage refusal does not masquerade as a transient
  // quiescence failure; the paused retry loop never executes guest code.
  for (const message of ['read_only', 'not_persistent', 'context-lost',
    'not_quiesced-without-colon', 'not_quiesced']) {
    const f = fixture({paused: false, refusal: () => Error(message)});
    const result = await f.save();
    assert.equal(result.ok, false, message);
    assert.equal(result.error, message);
    assert.deepEqual(f.counts(), {saves: 1, persists: 1, active: true});
    assert.equal(f.calls.filter(call => call === 'pause').length, 1);
    assert.equal(f.calls.filter(call => call === 'resume').length, 1);
    assert.equal(f.calls.at(-1), 'resume');
  }
});

test('durability failure after a quiescence refusal stops without another save', async () => {
  // Prediction: an actual persistence error must not be swallowed by the
  // quiescence retry rule or published as a coherent RAM/disk pair.
  const f = fixture({refusal: () => Error('not_quiesced: Write in_flight=1'),
    persistRefusal: attempt => attempt === 2});
  const result = await f.save();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'disk durability failed');
  assert.deepEqual(f.counts(), {saves: 1, persists: 2, active: false});
});
