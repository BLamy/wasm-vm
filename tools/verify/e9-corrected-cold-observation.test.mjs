import test from 'node:test';
import assert from 'node:assert/strict';
import{createCorrectedColdObservation,recordCorrectedColdBatch,finishCorrectedColdObservation,
  CORRECTED_COLD_LOG_MAX_BYTES}from'./e9-corrected-cold-observation.mjs';
const at=(transition,sequence='0')=>({transition:String(transition),retired:String(transition),sequence,
  phase:'before',ordinal:0});
// Independent literal request identity from E9-T22s's actual guest failure.
const request=transition=>({type:1,sector:'24928880',bytes:1179648,guestWrittenBytes:0,
  status:0,head:7,eventPosition:at(transition),statusDmaWritten:true,usedRingCommitted:true});
const artifact={file:'block-log-0.json',bytes:300,sha256:'a'.repeat(64)};
const witness=transition=>({...at(transition),digest:'b'.repeat(64),ramDigest:'c'.repeat(64),
  state:{file:'corrected-block.state',bytes:100,sha256:'d'.repeat(64)}});
const observed=(transition,change={})=>{
  const observation=createCorrectedColdObservation(at(0));
  recordCorrectedColdBatch(observation,[{...request(transition),...change}],at(transition+1),artifact);
  observation.witness=witness(transition+1);return observation;
};
for(const transition of [8_000_000_123,16_500_000_321])test('fresh request accepted at '+transition,()=>{
  const observation=observed(transition);
  assert.equal(finishCorrectedColdObservation(observation,at(transition+2),null).matching[0]
    .eventPosition.transition,String(transition));
  assert.equal(observation.requests,1);
});
test('logging cannot start from a historical checkpoint',()=>{
  assert.throws(()=>createCorrectedColdObservation(at(14_350_000_000)),/before the fresh guest executes/);
});
for(const change of [{type:0},{sector:'24928881'},{bytes:1048320}])
  test('wrong request identity is insufficient: '+JSON.stringify(change),()=>{
    const observation=observed(12_000_000_000,change);
    assert.throws(()=>finishCorrectedColdObservation(observation,at(12_000_000_002),null),/not observed exactly once/);
  });
for(const change of [{status:1},{statusDmaWritten:false},{usedRingCommitted:false}])
  test('backend success alone cannot prove guest completion: '+JSON.stringify(change),()=>{
    assert.throws(()=>observed(12_000_000_000,change),/did not complete S_OK/);
  });
test('duplicate successful requests are rejected',()=>{
  const observation=observed(12_000_000_000);
  assert.throws(()=>recordCorrectedColdBatch(observation,[request(12_000_000_002)],
    at(12_000_000_003),{...artifact,file:'block-log-1.json'}),/more than once/);
});
test('an unrelated guest block failure refutes completion',()=>{
  const observation=observed(12_000_000_000);
  assert.throws(()=>finishCorrectedColdObservation(observation,at(12_000_000_002),'failure'),/block I\/O error/);
});
test('out-of-interval event and missing state witness are rejected',()=>{
  const observation=createCorrectedColdObservation(at(0));
  assert.throws(()=>recordCorrectedColdBatch(observation,[request(100)],at(99),artifact),/outside/);
  recordCorrectedColdBatch(observation,[request(100)],at(101),artifact);
  assert.throws(()=>finishCorrectedColdObservation(observation,at(102),null),/guest and RAM witness/);
});
test('diagnostic retention is finite and missing parts are rejected',()=>{
  const observation=observed(100);observation.logBytes=CORRECTED_COLD_LOG_MAX_BYTES;
  assert.throws(()=>recordCorrectedColdBatch(observation,[{...request(102),type:0}],at(103),
    {...artifact,file:'block-log-1.json'}),/128 MiB/);
  observation.logBytes=300;observation.parts=[];
  assert.throws(()=>finishCorrectedColdObservation(observation,at(102),null),/part count/);
});
test('retained diagnostic parts cannot be skipped or reordered',()=>{
  const observation=createCorrectedColdObservation(at(0));
  assert.throws(()=>recordCorrectedColdBatch(observation,[request(100)],at(101),
    {...artifact,file:'block-log-1.json'}),/batch order/);
});
