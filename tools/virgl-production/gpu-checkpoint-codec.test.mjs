import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeCheckpointData as encode,decodeCheckpointData as decode,equalCheckpointBytes} from '../../renderer/virgl-command/checkpoint-codec.mjs';

test('original command and DMA data are owned immutable values',()=>{
  const commands=Uint8Array.of(0x43,0,13,0),dma=Uint8Array.of(0,128,255);
  const bytes=encode({op:'beginJob',commands,input:dma,epoch:'0000000000000002',fence:'0020000000000071',fields:[true,false,null,-0,1.25]});
  commands.fill(9);dma.fill(7);const restored=decode(bytes);
  assert.deepEqual([...restored.commands],[0x43,0,13,0]);assert.deepEqual([...restored.input],[0,128,255]);
  assert.equal(restored.fence,'0020000000000071');assert(Object.is(restored.fields[3],-0));assert.equal(restored.fields[4],1.25);
  assert(equalCheckpointBytes(bytes,encode(restored)));
});
test('all truncated prefixes and trailing bytes refuse',()=>{
  const bytes=encode({command:Uint8Array.of(3,7,11),args:['0000000000000001',17,true]});
  for(let n=0;n<bytes.length;n++)assert.throws(()=>decode(bytes.subarray(0,n)));
  const extra=new Uint8Array(bytes.length+1);extra.set(bytes);assert.throws(()=>decode(extra));
});
test('hostile counts, tags, text and recursion have bounded refusals',()=>{
  for(const bytes of [Uint8Array.of(255),Uint8Array.of(6,255,255,255,255),Uint8Array.of(7,255,255,255,255),Uint8Array.of(4,1,0,0,0,255)])assert.throws(()=>decode(bytes));
  const cycle={};cycle.value=cycle;assert.throws(()=>encode(cycle));
  const hole=Array(3);assert.throws(()=>encode(hole));
});
test('native objects, accessors and shared storage are never data',()=>{
  let calls=0;const getter={get secret(){calls++;return 1;}};
  for(const value of [getter,new Map(),new Uint32Array(4),new Uint8Array(new SharedArrayBuffer(4)),()=>0])assert.throws(()=>encode(value));
  assert.equal(calls,0);
});
test('record keys cannot mutate host prototypes',()=>{
  const value=Object.create(null);value.__proto__={polluted:true};value.constructor='data';
  const restored=decode(encode(value));assert.equal(Object.getPrototypeOf(restored),null);
  assert.equal(restored.__proto__.polluted,true);assert.equal({}.polluted,undefined);assert.equal(restored.constructor,'data');
});
