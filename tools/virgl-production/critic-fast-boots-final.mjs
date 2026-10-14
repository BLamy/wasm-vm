// Preserve and judge the actual original worker after stock desktop interaction.
import assert from 'node:assert/strict';

export function assertPublicDesktopFinal(state) {
  assert.deepEqual(state.workerErrors, [], 'post-input worker errors');
  assert.deepEqual(state.pageErrors, [], 'post-input browser errors');
  assert.equal(typeof state.serial, 'string', 'retain original serial output');
  assert.doesNotMatch(state.serial, /\*ERROR\*\s+response\s+0x[0-9a-f]+/i,
    'original DRM transport refusals cannot be hidden by renderer counters');
  const gpu = state.gpu;
  assert.equal(gpu?.qualified, true, 'post-input GPU remains qualified');
  assert.equal(gpu.lost, false, 'post-input context remains live');
  assert.equal(gpu.poisoned, false, 'post-input renderer remains usable');
  assert.equal(gpu.disposed, false, 'post-input renderer retains its owners');
  assert.equal(gpu.lastFailure, null, 'post-input renderer failure');
  assert.equal(gpu.counters.failed, 0, 'post-input failed original jobs');
  assert.equal(gpu.counters.cancelled, 0, 'post-input cancelled original jobs');
  assert.ok(gpu.counters.completed > 0 && gpu.counters.draws > 0,
    'post-input real guest graphics have completed');
  assert.equal(gpu.counters.begun - gpu.counters.completed, gpu.pending ? 1 : 0,
    'active rendering owns at most its original single pending request');
}

export function assertInteractivePauseProbe(probe) {
  const {beforePause,afterPause,resumed,progressed,pauseMillis,resumeSent,progressReceived}=probe;
  for(const clock of [beforePause,afterPause,resumed,progressed]) {
    assert.equal(clock.mode,'wall');assert.equal(clock.timebaseHz,10000000);
    assert.equal(typeof clock.mtime,'string');assert.match(clock.mtime,/^[0-9]+$/);
  }
  assert.equal(afterPause.mtime,beforePause.mtime,'explicit pause freezes actual time');
  assert.ok(BigInt(resumed.mtime)>=BigInt(afterPause.mtime),'resume never moves time backward');
  assert.ok(BigInt(progressed.mtime)>=BigInt(resumed.mtime),'progress never moves time backward');
  const elapsedMillis=progressReceived-resumeSent;
  assert.ok(Number.isFinite(elapsedMillis)&&elapsedMillis>0&&elapsedMillis<pauseMillis,
    'measured observation is shorter than the excluded pause');
  const actualTicks=BigInt(progressed.mtime)-BigInt(afterPause.mtime);
  const maximumTicks=BigInt(Math.ceil(elapsedMillis*10000))+10000n;
  assert.ok(actualTicks>0n,'actual resumed wall clock progresses');
  assert.ok(actualTicks<=maximumTicks,'actual resumed clock excludes the paused host interval');
  return {actualTicks:actualTicks.toString(),maximumTicks:maximumTicks.toString(),elapsedMillis};
}
