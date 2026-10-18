import fs from 'node:fs';
import assert from 'node:assert/strict';
import {initSync,WasmMachine} from '../../web/dist/pkg/wasm_vm_wasm.js';
import {eventClockElf} from '../../web/dist/event-clock-probe.js';
initSync({module:fs.readFileSync(new URL('../../web/dist/pkg/wasm_vm_wasm_bg.wasm',import.meta.url))});
const rows=[];
for(const seed of [3,11,37,127,2047,65539])for(const blocked of [false,true]){
 const divider=1+seed%11,deadline=100+seed%1300,program=eventClockElf(true),v=new DataView(program.buffer);
 v.setUint32(0x1000+7*4,(deadline<<20)|(29<<7)|0x13,true);
 const fresh=jit=>{const m=new WasmMachine(1);m.loadElf(program);m.startEventClock(1,divider);if(jit)m.enableJit(1);return m;};
 const scalar=fresh(false),jit=fresh(true),restored=fresh(true);
 let random=seed;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return 1+random%257;};
 const runTo=(m,t)=>{while(BigInt(m.eventPosition().transition)<BigInt(t))assert.equal(m.runEventUntil(String(t),next()).kind,'max');};
 for(const m of [scalar,jit]){
  runTo(m,10);assert.equal(m.eventPosition().retired,'10');assert.equal(m.eventPosition().mtime,String(Math.floor(10/divider)));
  m.stageEventPending('10',!blocked);m.stageEventWrite('10','2147500032',new Uint8Array([seed&255]));m.stageEventPending('10',blocked);
 }
 assert.deepEqual(scalar.saveEventCheckpoint(),jit.saveEventCheckpoint());
 restored.restoreEventCheckpoint(jit.saveEventCheckpoint());
 for(const m of [scalar,jit,restored]){
  runTo(m,11);const p=m.eventPosition();assert.equal(p.transition,'11');
  assert.equal(p.retired,blocked?'11':'10');assert.equal(p.mtime,String(blocked?Math.floor(11/divider):deadline));
  assert.equal(m.registers()[0],blocked?0x8000002cn:0x80000028n);
 }
 const delivered=scalar.takeEventDeliveries();assert.deepEqual(delivered,jit.takeEventDeliveries());assert.deepEqual(delivered,restored.takeEventDeliveries());
 assert.deepEqual(delivered.map(r=>[r.transition,r.ordinal,r.sequence]),[['10',1,'1'],['10',2,'2'],['10',3,'3']]);
 assert.deepEqual(scalar.saveEventCheckpoint(),jit.saveEventCheckpoint());assert.deepEqual(scalar.saveEventCheckpoint(),restored.saveEventCheckpoint());
 if(!blocked){for(const m of [scalar,jit,restored]){runTo(m,12);assert.equal(m.eventPosition().retired,'10');assert.equal(m.registers()[0],0x80002000n);}assert.deepEqual(scalar.saveEventCheckpoint(),jit.saveEventCheckpoint());assert.deepEqual(scalar.saveEventCheckpoint(),restored.saveEventCheckpoint());}
 rows.push({seed,blocked,divider,deadline,position:jit.eventPosition()});for(const m of [scalar,jit,restored])m.free();
}
fs.writeFileSync(new URL('wasm-wfi-attack.json',import.meta.url),JSON.stringify({status:'passed',cases:rows},null,2)+'\n');
console.log('Independent varied-divider/deadline/WFI/callback-order attacks passed:',rows.length);
