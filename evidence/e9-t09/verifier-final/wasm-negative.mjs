import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initSync,WasmMachine} from '../../web/dist/pkg/wasm_vm_wasm.js';
import {eventClockElf} from '../../web/dist/event-clock-probe.js';
const out=new URL('./',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
initSync({module:fs.readFileSync(new URL('../../web/dist/pkg/wasm_vm_wasm_bg.wasm',import.meta.url))});
const m=new WasmMachine(1);m.loadElf(eventClockElf());m.startEventClock(1,3);m.run(2);
m.stageEventWrite('5','2147500032',new Uint8Array([11]));m.stageEventWrite('5','2147500033',new Uint8Array([22]));
const original=m.saveEventCheckpoint();
function section(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let at=84;at<bytes.length;){const n=v.getUint32(at+4,true);if(v.getUint32(at,true)===18)return{at,p:at+8,n};at+=8+n;}throw Error('no clock');}
const s=section(original),refusals=[];
const cases=[
 ['retired beyond transition',(v,p)=>v.setBigUint64(p+20,3n,true)],
 ['ordinal wider than u32',(v,p)=>v.setBigUint64(p+28,4294967296n,true)],
 ['ordinal beyond delivered sequence',(v,p)=>v.setBigUint64(p+28,1n,true)],
 ['sequence beyond admitted tickets',(v,p)=>v.setBigUint64(p+36,3n,true)],
 ['past queued target',(v,p)=>v.setBigUint64(p+58,1n,true)],
 ['out of order targets',(v,p)=>v.setBigUint64(p+58,6n,true)],
 ['duplicate ticket',(v,p)=>v.setBigUint64(p+96,0n,true)],
 ['unknown effect kind',(v,p)=>v.setUint8(p+74,2)],
 ['outside-RAM destination',(v,p)=>v.setBigUint64(p+75,2147483647n,true)],
 ['invalid idle boolean',(v,p)=>v.setUint8(p+52,2)],
 ['invalid pending boolean',(v,p)=>v.setUint8(p+53,2)],
 ['overlarge payload',(v,p)=>v.setUint32(p+83,1048577,true)],
 ['overlarge event count',(v,p)=>v.setUint32(p+54,257,true)],
];
for(const [name,edit] of cases){const bytes=original.slice();edit(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),s.p);assert.throws(()=>m.restoreEventCheckpoint(bytes),/BadComponentState/);assert.deepEqual(m.saveEventCheckpoint(),original,name+' mutation');refusals.push(name);}
const duplicate=new Uint8Array(original.length+s.n+8);duplicate.set(original);duplicate.set(original.subarray(s.at,s.p+s.n),original.length);assert.throws(()=>m.restoreEventCheckpoint(duplicate),/BadComponentState/);assert.deepEqual(m.saveEventCheckpoint(),original);refusals.push('duplicate clock section');
const absent=new Uint8Array(original.length-s.n-8);absent.set(original.subarray(0,s.at));absent.set(original.subarray(s.p+s.n),s.at);assert.throws(()=>m.restoreEventCheckpoint(absent),/BadComponentState/);assert.deepEqual(m.saveEventCheckpoint(),original);refusals.push('missing clock section');
m.free();
const inactive=new WasmMachine(1);inactive.loadElf(eventClockElf());
for(const [name,fn] of [
 ['position',()=>inactive.eventPosition()],['deliver',()=>inactive.deliverEventBoundary()],['drain',()=>inactive.takeEventDeliveries()],['save',()=>inactive.saveEventCheckpoint()],['restore',()=>inactive.restoreEventCheckpoint(original)],['run',()=>inactive.runEventUntil('3',1)],['stage',()=>inactive.stageEventPending('0',true)]
]){assert.throws(fn,/Inactive/);refusals.push('inactive '+name);}
inactive.startEventClock(1,3);const empty=inactive.saveEventCheckpoint(),clock=section(empty);
const last=empty.slice(),view=new DataView(last.buffer,last.byteOffset,last.byteLength);view.setBigUint64(clock.p+12,18446744073709551615n,true);
inactive.restoreEventCheckpoint(last);assert.throws(()=>inactive.step(1),/TransitionExhausted/);assert.deepEqual(inactive.saveEventCheckpoint(),last);refusals.push('step exhaustion');
inactive.free();
fs.writeFileSync(new URL('wasm-negative.json',out),JSON.stringify({status:'passed',refusals,original_sha256:hash(original),wasm_sha256:hash(fs.readFileSync(new URL('../../web/dist/pkg/wasm_vm_wasm_bg.wasm',import.meta.url)))},null,2)+'\n');
console.log('Wasm negative admission and no-mutation checks passed:',refusals.length);
