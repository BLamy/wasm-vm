import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {createHash}from'node:crypto';
import {frozenWorkloadSchedule,scheduledTransition,verifyFrozenWorkloadOffers,verifyUartActivityLedger}from'./e9-workload-schedule.mjs';
const raw=await fs.readFile(new URL('../../docs/design/session-replay-contract.json',import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'),'646899bea0da60ba13020a2015f6214236526082a8e34952cca91481cb89dba1');
const contract=JSON.parse(raw),copy=value=>structuredClone(value);
function offers(){return frozenWorkloadSchedule(contract).map((frame,i)=>({channel:1,bytes:[...frame.bytes],transition:String(12345+500000*(i+1)),retired:String(9000+i),sequence:String(200+i),phase:'before',ordinal:2,outcome:['0',String(frame.bytes.length),String(frame.bytes.length),'0']}));}
test('original endpoints, bytes and ten appended rewrites are sealed',()=>{
 const rows=frozenWorkloadSchedule(contract);assert.equal(rows.length,100);assert.equal(rows[0].text,"printf 'E9_INPUT_%03d\\n' 1\n");assert.equal(rows[99].offset,'50000000');
 assert.deepEqual(rows.filter(row=>row.rewriteIndex!==null).map(row=>row.rewriteIndex),[1,2,3,4,5,6,7,8,9,10]);
 assert(rows[9].text.endsWith('busybox wget -qO /root/e9-session/http http://10.0.2.2:9191/e9/1; sha256sum /root/e9-session/state /root/e9-session/http\n'));
 assert.equal(scheduledTransition('12345','500000'),'512345');assert.equal(scheduledTransition('12345','50000000'),'50012345');
});
test('raw accepted source offers, not host-request counters, prove the schedule',()=>{
 const rows=offers();const setup={...rows[0],bytes:[...new TextEncoder().encode('advance\n')]};assert.deepEqual(verifyFrozenWorkloadOffers(contract,'12345',[setup,...rows]),{offers:100,rewrites:10,origin:'12345',first:'512345',last:'50012345'});
 for(const mutate of [r=>r.pop(),r=>r.push(copy(r[99])),r=>{r[0].transition='512346';},r=>{r[49].outcome[2]='0';},r=>{r[99].bytes.push(32);},r=>{r[70].sequence=r[69].sequence;}]){const changed=copy(rows);mutate(changed);assert.throws(()=>verifyFrozenWorkloadOffers(contract,'12345',changed));}
});
test('amount drift and u64 overflow refuse before any scheduling',()=>{
 const changed=copy(contract);changed.workload.schedule.input_frames=99;assert.throws(()=>frozenWorkloadSchedule(changed),/original amounts/);
 assert.throws(()=>scheduledTransition('18446744073709551615','1'),/overflow/);assert.throws(()=>scheduledTransition('01','500000'),/unsigned/);
});

test('every auxiliary UART offer must have exactly one byte-identified producer',()=>{
 const rows=offers(),extra={...rows[0],sequence:'199',bytes:[...new TextEncoder().encode('advance\n')]};rows.unshift(extra);
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const ledger=rows.map(row=>({kind:row===extra?'advance':'scheduled',channel:1,transition:row.transition,retired:row.retired,sequence:row.sequence,phase:row.phase,ordinal:row.ordinal,sha256:hash(Uint8Array.from(row.bytes)),bytes:row.bytes.length}));
 assert.equal(verifyUartActivityLedger(contract,'12345',rows,ledger,hash).total,101);
 assert.throws(()=>verifyUartActivityLedger(contract,'12345',rows,ledger.slice(1),hash),/complete UART ledger/);
 const altered=copy(ledger);altered[0].sha256='0'.repeat(64);assert.throws(()=>verifyUartActivityLedger(contract,'12345',rows,altered,hash),/byte identity/);
 const overlap=copy(ledger);overlap[0].sequence=overlap[1].sequence;assert.throws(()=>verifyUartActivityLedger(contract,'12345',rows,overlap,hash),/disjoint/);
});
