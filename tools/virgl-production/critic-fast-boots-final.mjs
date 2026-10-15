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
  assert.ok(['wall','paced-icount'].includes(beforePause.mode),'actual host-paced interaction mode');
  for(const clock of [beforePause,afterPause,resumed,progressed]) {
    assert.equal(clock.mode,beforePause.mode);assert.equal(clock.timebaseHz,10000000);
    assert.equal(typeof clock.mtime,'string');assert.match(clock.mtime,/^[0-9]+$/);
  }
  assert.equal(afterPause.mtime,beforePause.mtime,'explicit pause freezes actual time');
  assert.ok(BigInt(resumed.mtime)>=BigInt(afterPause.mtime),'resume never moves time backward');
  assert.ok(BigInt(progressed.mtime)>=BigInt(resumed.mtime),'progress never moves time backward');
  const elapsedMillis=progressReceived-resumeSent;
  assert.ok(Number.isFinite(elapsedMillis)&&elapsedMillis>0&&elapsedMillis<pauseMillis,
    'measured observation is shorter than the excluded pause');
  const actualTicks=BigInt(progressed.mtime)-BigInt(afterPause.mtime);
  let retirementTicks=0n;
  if(beforePause.mode==='paced-icount') {
    const retired=probe.retired;
    for(const point of ['beforePause','afterPause','resumed','progressed']) {
      assert.ok(Number.isSafeInteger(retired?.[point])&&retired[point]>=0,'exact actual retirement count');
    }
    assert.equal(retired.afterPause,retired.beforePause,'pause freezes retirement count');
    assert.ok(retired.resumed>=retired.afterPause&&retired.progressed>=retired.resumed,'retirement count never moves backward');
    for(const clock of [beforePause,afterPause,resumed,progressed]) {
      assert.ok(Number.isSafeInteger(clock.clockDiv)&&clock.clockDiv>=1&&clock.clockDiv<=1024,'actual ICount divider');
      assert.equal(clock.clockDiv,beforePause.clockDiv,'interaction preserves the divider');
    }
    const delta=BigInt(retired.progressed)-BigInt(retired.afterPause),divisor=BigInt(beforePause.clockDiv);
    retirementTicks=(delta+divisor-1n)/divisor;
  }
  const maximumTicks=BigInt(Math.ceil(elapsedMillis*10000))+retirementTicks+10000n;
  assert.ok(actualTicks>0n,'actual resumed clock progresses');
  assert.ok(actualTicks<=maximumTicks,'actual resumed clock excludes the paused host interval');
  return {actualTicks:actualTicks.toString(),maximumTicks:maximumTicks.toString(),retirementTicks:retirementTicks.toString(),elapsedMillis};
}
