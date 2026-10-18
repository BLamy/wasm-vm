import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initSync,WasmMachine} from '../../web/dist/pkg/wasm_vm_wasm.js';
import {eventClockElf} from '../../web/dist/event-clock-probe.js';
const wasm=fs.readFileSync(new URL('../../web/dist/pkg/wasm_vm_wasm_bg.wasm',import.meta.url));
initSync({module:wasm});const sha=b=>createHash('sha256').update(b).digest('hex');
const fresh=()=>{const m=new WasmMachine(8);m.loadElf(eventClockElf());m.startEventClock(1,3);return m;};
const flags=fresh();for(let i=0;i<256;i++)flags.stageEventPending('0',true);
const queued=flags.saveEventCheckpoint();assert.throws(()=>flags.stageEventPending('0',false),/QueueFull/);assert.deepEqual(flags.saveEventCheckpoint(),queued);
flags.deliverEventBoundary();const at=flags.eventPosition();assert.equal(at.sequence,'256');assert.equal(at.ordinal,256);assert.equal(at.transition,'0');
assert.throws(()=>flags.stageEventPending('0',false),/QueueFull/);assert.deepEqual(flags.eventPosition(),at);
assert.throws(()=>flags.saveEventCheckpoint(),/BadComponentState/);
const receipts=flags.takeEventDeliveries();assert.equal(receipts.length,256);
for(const [i,d]of receipts.entries()){assert.equal(d.sequence,String(i+1));assert.equal(d.ordinal,i+1);assert.equal(d.ticket,String(i));assert.equal(d.bytes[0],1);}
flags.stageEventPending('0',false);flags.deliverEventBoundary();assert.equal(flags.takeEventDeliveries()[0].sequence,'257');flags.free();
const memory=fresh();
for(let i=1;i<=4;i++){const payload=new Uint8Array(1<<20).fill(i);memory.stageEventWrite('0','2147500032',payload);payload.fill(255);}
const full=memory.saveEventCheckpoint();assert.throws(()=>memory.stageEventWrite('0','2147500032',new Uint8Array([9])),/QueueFull/);assert.deepEqual(memory.saveEventCheckpoint(),full);
memory.deliverEventBoundary();const position=memory.eventPosition();assert.equal(position.sequence,'4');
assert.throws(()=>memory.stageEventWrite('0','2147500032',new Uint8Array([9])),/QueueFull/);assert.deepEqual(memory.eventPosition(),position);
const payloads=memory.takeEventDeliveries();assert.equal(payloads.length,4);
for(const [i,d]of payloads.entries()){assert.equal(d.bytes.length,1<<20);assert.ok(d.bytes.every(v=>v===i+1));}
memory.stageEventWrite('0','2147500032',new Uint8Array([9]));memory.deliverEventBoundary();assert.equal(memory.takeEventDeliveries()[0].sequence,'5');
const initial=memory.saveEventCheckpoint();
assert.throws(()=>memory.stageEventWrite('0','2147500032',new Uint8Array((1<<20)+1)),/PayloadTooLarge/);assert.deepEqual(memory.saveEventCheckpoint(),initial);
assert.throws(()=>memory.stageEventWrite('0','2155872255',new Uint8Array([1,2])),/InvalidAddress/);assert.deepEqual(memory.saveEventCheckpoint(),initial);
const result={status:'passed',wasm_sha256:sha(wasm),queued_flags_sha256:sha(queued),full_owned_bytes_sha256:sha(full),terminal_memory_position:memory.eventPosition(),count_capacity:256,owned_bytes_capacity:4<<20};
fs.writeFileSync(new URL('wasm-mailbox-bounds.json',import.meta.url),JSON.stringify(result,null,2)+'\n');memory.free();console.log('Mailbox count/owned-byte/outbox limits and transactional refusals passed.');
