import fs from 'node:fs';
import assert from 'node:assert/strict';
import {initSync,WasmMachine} from '../../web/dist/pkg/wasm_vm_wasm.js';
import {eventClockElf} from '../../web/dist/event-clock-probe.js';
initSync({module:fs.readFileSync(new URL('../../web/dist/pkg/wasm_vm_wasm_bg.wasm',import.meta.url))});
const words=[0x00108093,0xb0202173,0x00118193,0xff5ff06f],program=eventClockElf();
const view=new DataView(program.buffer);for(const [i,word] of words.entries())view.setUint32(0x1000+4*i,word,true);
const scalar=new WasmMachine(1),jit=new WasmMachine(1);
for(const m of [scalar,jit])m.loadElf(program);scalar.setTrace(true);jit.enableJit(1);
for(const m of [scalar,jit])assert.equal(m.run(384).kind,'max');
assert.ok(jit.jitStats().executedBlocks>0);
for(const m of [scalar,jit])m.startEventClock(1,3);
const before=jit.jitStats().executedBlocks,rows=[];
for(const stop of [2,6,13,37,129]){
 for(const [m,quantum] of [[scalar,1],[jit,47]]){
  while(Number(m.eventPosition().transition)<stop)assert.equal(m.runEventUntil(String(stop),quantum).kind,'max');
  const regs=m.registers(),total=384+stop;
  assert.equal(regs[2],BigInt(Math.floor((total+3)/4)));
  assert.equal(regs[3],BigInt(385+4*Math.floor((stop-2)/4)));
  assert.equal(regs[4],BigInt(Math.floor((total+1)/4)));
  assert.equal(m.eventPosition().transition,String(stop));assert.equal(m.eventPosition().retired,String(stop));
 }
 assert.deepEqual(scalar.saveEventCheckpoint(),jit.saveEventCheckpoint());
 rows.push({stop,position:jit.eventPosition(),x2:String(jit.registers()[3]),jit:jit.jitStats()});
}
assert.ok(jit.jitStats().executedBlocks>before);
fs.writeFileSync(new URL('wasm-observe-attack.json',import.meta.url),JSON.stringify({status:'passed',before,cases:rows},null,2)+'\n');
console.log('Precompiled observable-block exact counter fallback passed:',rows.length,'stops');scalar.free();jit.free();
