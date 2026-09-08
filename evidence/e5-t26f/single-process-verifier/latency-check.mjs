// Read-only, separate latency replay review; no source/profile/tree gate or collector bypass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..');
const base='evidence/e5-t26f/single-process-observer-05b82bc6';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files={},read=f=>{const b=readFileSync(path.join(repo,f));files[f]={sha256:sha(b),size:b.length};return b;};
const json=f=>JSON.parse(read(f));
const result={acceptance:false,scope:'separate latency-only replay; sampled observations, not timing cause',files};
try {
  const originalInvocation=json(base+'/invocation.json'),original=json(base+'/reuse/failure-post-restore-interaction-checks.json');
  const invocation=json(base+'/latency/invocation.json'),raw=json(base+'/latency/record/failure-post-restore-interaction-checks.json');
  const exit=json(base+'/latency/exit.json');
  assert.equal(files[base+'/reuse/failure-post-restore-interaction-checks.json'].sha256,'0881a4aa55808bd0884b5a6ef2f05af4da9601b119e188390cef94b4c667002a');
  assert.deepEqual(exit,{code:1,signal:null});
  for(const [f,pin] of Object.entries(invocation.sourceBindings)) {
    if(f===base+'/run-latency.mjs') assert.equal(sha(read(f)),pin);
    else assert.equal(pin,originalInvocation.sourceBindings[f]);
  }
  const m=raw.milestones,l=m.interactionLatency,d=m.run.diagnostic;
  assert.equal(raw.head,original.head);assert.equal(invocation.head,original.head);
  assert.deepEqual(m.run.binding,original.milestones.run.binding);
  assert.equal(m.run.profileSha256,original.milestones.run.profileSha256);
  assert.deepEqual(m.normalSnapshot,original.milestones.normalSnapshot);
  assert.deepEqual(m.residentCheckpoint,original.milestones.residentCheckpoint);
  assert.notEqual(m.run.profile,original.milestones.run.profile);
  assert.equal(d.mode,'reuse');assert.equal(d.latency,true);assert.equal(d.cpu,false);
  for(const k of ['jit','residency','command','guestClock','icountDivider'])assert.equal(d[k],null);
  assert.equal(d.complete,false);assert.equal(d.guestProfile,undefined);assert.equal(d.decodedCacheEntries,undefined);
  assert.equal(m.run.postRestoreCommand,'play');assert.equal(m.run.postRestoreKeyDelayMs,5);
  assert.equal(m.jitBefore,undefined);assert.equal(m.jitAfter,undefined);
  assert.equal(l.captureError,undefined);assert.equal(l.restoredAt,m.postRestoreStart);
  assert.equal(m.postRestoreStart,m.normalRestore.result.completedAt);
  assert.ok(l.startedAt>=l.restoredAt);assert.equal(l.deadlineAt,l.restoredAt+6000);
  assert.equal(l.baselineWriteIndex,0);assert.equal(l.stopReason,'command-wait-settled');
  assert.deepEqual(l.limits,{pcmIntervalMs:50,pcmSamples:120,schedulerIntervalMs:250,schedulerSamples:24,markerSamples:120});
  const pcm=l.pcmSamples,first=pcm.findIndex(s=>s.available && s.writeIndex!==l.baselineWriteIndex);
  assert.ok(first>0);assert.ok(pcm.slice(0,first).every(s=>s.available&&s.writeIndex===0&&!s.error));
  for(let i=0;i<pcm.length;i++){assert.equal(pcm[i].elapsedMs,pcm[i].observedAt-l.restoredAt);if(i)assert.ok(pcm[i].observedAt>=pcm[i-1].observedAt);}
  assert.equal(l.firstWrite.observedAt,pcm[first].observedAt);assert.equal(l.firstPcm.observedAt,pcm[first].observedAt);
  assert.equal(l.firstPcm.elapsedMs,l.firstPcm.observedAt-l.restoredAt);
  assert.ok(l.firstPcm.pcm.nonSilentFrames>0&&l.firstPcm.pcm.maxAbs>0);
  assert.ok(l.firstPcm.completedAt>=l.firstPcm.observedAt);
  assert.equal(l.firstMarker.markerSeen,true);assert.equal(l.firstMarker.elapsedMs,l.firstMarker.observedAt-l.restoredAt);
  assert.ok(l.firstMarker.observedAt>l.firstPcm.completedAt&&l.firstMarker.observedAt<=l.stoppedAt&&l.stoppedAt<=m.postRestoreEnd);
  assert.equal(l.markerSamples.length,120);assert.ok(l.markerCalls>l.markerSamples.length);
  assert.ok(l.markerSamples.every(s=>s.markerSeen===false));
  assert.ok(l.markerSamples.at(-1).observedAt<l.firstMarker.observedAt);
  assert.ok(l.pcmSamples.length<=l.limits.pcmSamples&&l.schedulerSamples.length<=l.limits.schedulerSamples);
  for(const s of l.schedulerSamples){assert.equal(s.status,'completed');assert.equal(s.jit.status,'completed');}
  assert.equal(raw.error.message,'post-restore interaction exceeded 2 seconds');assert.equal(raw.error.code,'ERR_ASSERTION');
  assert.equal(raw.error.name,'AssertionError');
  assert.equal(m.postRestoreAplay.accepted,true);assert.equal(m.postRestoreAplay.inputSequenceMatch,true);
  assert.equal(m.postRestoreAplay.terminalMarkerSeen,true);assert.equal(m.postRestoreAplay.redMarkerSeen,false);
  assert.ok(m.postRestorePcmAtCompletion.pcm.nonSilentFrames>0);assert.equal(m.postRestoreOutputAttached.outputAttached,true);
  assert.deepEqual(m.postRestoreInteraction.heldButtons,[]);
  assert.equal(raw.errors,undefined);
  read('evidence/e5-t26f/single-process-latency-05b82bc6.log');
  result.observations={producerHead:raw.head,iterationProfile:m.run.profile,profileSha256:m.run.profileSha256,
    start:m.postRestoreStart,end:m.postRestoreEnd,elapsedMs:m.postRestoreEnd-m.postRestoreStart,capMs:2000,fTimingPassed:false,
    samplerStartedElapsedMs:l.startedAt-l.restoredAt,pcmSampleCount:pcm.length,schedulerSampleCount:l.schedulerSamples.length,
    lastZero:pcm[first-1],firstSampledPcm:l.firstPcm,firstMarker:l.firstMarker,
    pcmToMarkerObservedMs:l.firstMarker.observedAt-l.firstPcm.observedAt,
    markerSamples:l.markerSamples.length,markerCalls:l.markerCalls,markerBufferLastElapsedMs:l.markerSamples.at(-1).elapsedMs,
    markerTotalMs:l.markerTotalMs,markerMaxMs:l.markerMaxMs,stopReason:l.stopReason,
    command:m.postRestoreAplay,completionPcm:m.postRestorePcmAtCompletion.pcm};
  assert.ok(result.observations.elapsedMs>2000);assert.ok(result.observations.lastZero.elapsedMs>2000);
  for(const [f,pin]of Object.entries(files))assert.equal(sha(readFileSync(path.join(repo,f))),pin.sha256);
  result.held=true;
}catch(error){result.failure=String(error);result.stack=error.stack;process.exitCode=1;}
writeFileSync(path.join(here,'latency-check-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({held:result.held??false,failure:result.failure??null,observations:result.observations}));
