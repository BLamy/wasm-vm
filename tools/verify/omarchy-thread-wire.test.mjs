import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSerialWire, bindRendererWire, validateReadbackWire } from './omarchy-thread-wire.mjs';
import { wireFixture, timestamp } from './omarchy-thread-wire-fixture.mjs';

test('actual built RPC schema: split fences, app readiness, and last remaining-deadline timeout', () => {
  const { report, renderer } = wireFixture();
  const records = validateReadbackWire(report, renderer);
  assert.equal(records.length, 9);
  assert.equal(records.at(-1).response, null);
  bindRendererWire(renderer, records);
});
test('complete physical nonce stays provisional, wire result binds renderer', () => {
  const { report, renderer } = wireFixture({ positive: true });
  bindRendererWire(renderer, validateReadbackWire(report, renderer));
});
for (const [label, mutate, pattern] of [
  ['serial-written split nonce', r => { r.workerTraffic.unshift(...[r.keyboard.nonce.slice(0, 8), r.keyboard.nonce.slice(8)].map((s, i) =>
    ({ type: 'serial-input', bytes: [...Buffer.from(s)], sent: true, worker: 1, context: 'primary', epoch: 'final', timestamp: timestamp(-2 + i) }))); }, /nonce/],
  ['missing outgoing RPC', r => { r.workerTraffic = r.workerTraffic.filter(row => row.type !== 'serial-input'); }, /outgoing RPC/],
  ['invented result', r => { r.observations.find(row => row.exec).exec.stdout = 'fabricated'; }, /stdout differs/],
  ['wrong response fence', r => { r.workerTraffic.find(row => row.text?.includes('__WVEND_test2')).text = '__WVEND_wrong_0\n'; }, /completed wire/],
  ['wrong renderer PID', r => { r.observations.find(row => row.renderer).renderer.instance = { ...r.observations.find(row => row.renderer).renderer.instance, pid: 124 }; }, /unapproved serial/],
  ['early timeout hidden by late failure time', r => { r.serialCommands.at(-1).timeoutMs = 1; }, /coverage stopped/],
  ['unsafe unframed input', r => { r.workerTraffic.find(row => row.type === 'serial-input').bytes = [...Buffer.from('exit 75\r')]; }, /unframed/],
  ['missing timestamp', r => { delete r.workerTraffic[0].timestamp; }, /timestamp/],
  ['observer paused the guest', r => { r.workerTraffic.splice(1, 0, { type: 'worker-call', method: 'pause',
    sent: true, timestamp: timestamp(0.01), context: 'primary', epoch: 'final', worker: 1 }); }, /mutated guest/],
]) test(`reject ${label}`, () => {
  const { report } = wireFixture(); mutate(report);
  assert.throws(() => validateReadbackWire(report, report.observations.find(row => row.renderer).renderer), pattern);
});
test('reject same-instance renderer result not matching actual wire', () => {
  const { report, renderer } = wireFixture();
  const records = auditSerialWire(report, renderer);
  renderer.environment.stdout = renderer.environment.stdout.replace('=0', '=1');
  assert.throws(() => bindRendererWire(renderer, records), /environment differs/);
});
