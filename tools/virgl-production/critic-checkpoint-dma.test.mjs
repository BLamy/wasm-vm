import test from 'node:test';
import assert from 'node:assert/strict';
import {packCheckpointDma as pack,unpackCheckpointDma as unpack,CHECKPOINT_DMA_MAX_BYTES as MAX} from '../../renderer/virgl-command/checkpoint-dma.mjs';
import {encodeCheckpointData,decodeCheckpointData} from '../../renderer/virgl-command/checkpoint-codec.mjs';

function words(...values){const bytes=new Uint8Array(values.length*4),v=new DataView(bytes.buffer);values.forEach((n,i)=>v.setUint32(i*4,n,true));return bytes;}
function packet(bytes,length=256){return {encoding:'u32-runs-v1',length,bytes};}

test('independent literal plus run packets decode exact little-endian bytes from an unaligned view',()=>{
  const bytes=words(3,0x78563412,0xffeeddcc,0x01020304,0x8000003d,0x89abcdef);
  const storage=new Uint8Array(bytes.length+3);storage.set(bytes,1);
  const expected=new Uint8Array(256);expected.set(Uint8Array.of(0x12,0x34,0x56,0x78,0xcc,0xdd,0xee,0xff,4,3,2,1));
  for(let i=12;i<256;i+=4)expected.set([0xef,0xcd,0xab,0x89],i);
  const encoded=packet(storage.subarray(1,1+bytes.length));
  assert.deepEqual(unpack(encoded),expected);
  assert.deepEqual(unpack(decodeCheckpointData(encodeCheckpointData(encoded))),expected);
  const decoded=unpack(encoded);decoded.fill(0);assert.deepEqual(unpack(encoded),expected);
});

test('all proper packed prefixes and late malformed packets refuse without partial return',()=>{
  const complete=words(3,0x78563412,0xffeeddcc,0x01020304,0x8000003d,0x89abcdef);
  for(let end=0;end<complete.length;end++)assert.throws(()=>unpack(packet(complete.subarray(0,end))),undefined,'prefix '+end);
  for(const bytes of [
    words(0,0),words(0x80000000,0),words(0x80000041,0),words(0xffffffff,0),
    words(0x8000003f,0),words(64,0),words(0x80000040),
    new Uint8Array([...complete,...words(1,5)]),new Uint8Array([...complete,...words(0)]),
  ])assert.throws(()=>unpack(packet(bytes)));
});

test('input and output ownership survives raw legacy bytes, source views and odd byte tails',()=>{
  for(const length of [0,1,3,255,256,257,511,512,4099]){
    const backing=new Uint8Array(length+3).fill(0xc3),source=backing.subarray(1,1+length);
    for(let i=0;i<length;i++)source[i]=(Math.imul(i,73)+(i%31)*11)&255;
    const expected=source.slice(),stored=pack(source);source.fill(0);
    assert.deepEqual(unpack(stored),expected,'length '+length);
    const copy=unpack(stored);copy.fill(0x55);assert.deepEqual(unpack(stored),expected);
    const legacy=unpack(expected);expected.fill(0x66);assert.notDeepEqual(legacy,expected.length?expected:new Uint8Array([1]));
    if(length%4!==0||length<256)assert.ok(stored instanceof Uint8Array);
  }
});

test('unaligned source with mixed literals and short runs agrees with an independent deterministic corpus',()=>{
  for(let seed=1;seed<=97;seed++){
    let x=seed;const count=64+seed*7,backing=new Uint8Array(count*4+5),source=backing.subarray(3,3+count*4),v=new DataView(source.buffer,source.byteOffset,source.byteLength);
    let remaining=0,word=0;
    for(let i=0;i<count;i++){
      if(remaining===0){x=(Math.imul(x,1103515245)+12345)>>>0;word=x;remaining=(x>>>25)%23+1;}
      v.setUint32(i*4,word,true);remaining--;
    }
    const expected=source.slice(),stored=pack(source);source.fill(7);assert.deepEqual(unpack(stored),expected,'seed '+seed);
  }
});

test('exact per-transfer ceiling is accepted and ceiling plus one refuses before decoding',()=>{
  assert.equal(MAX,33554432);
  const exact=unpack(packet(words(0x80800000,0x01020304),MAX));
  assert.equal(exact.length,MAX);assert.deepEqual([...exact.subarray(0,4)],[4,3,2,1]);assert.deepEqual([...exact.subarray(-4)],[4,3,2,1]);
  assert.throws(()=>unpack(packet(words(0x80800001,0),MAX+4)),/invalid packed transfer/);
  assert.throws(()=>unpack(new Uint8Array(MAX+1)),/raw transfer budget/);
  assert.throws(()=>pack(new Uint8Array(MAX+1)),/input exceeds transfer budget/);
});

test('malformed length and foreign byte storage cannot be mistaken for original DMA',()=>{
  for(const length of [-1,0,255,257,NaN,Infinity,2**32,MAX+4,'256',256.5])assert.throws(()=>unpack(packet(words(0x80000040,0),length)));
  for(const bytes of [new DataView(new ArrayBuffer(8)),new Uint16Array(4),new ArrayBuffer(8),{length:8},null])assert.throws(()=>unpack(packet(bytes)));
  for(const value of [null,{},new ArrayBuffer(256),new DataView(new ArrayBuffer(256)),new Uint16Array(128)]){assert.throws(()=>pack(value));assert.throws(()=>unpack(value));}
  if(typeof SharedArrayBuffer==='function'){
    const shared=new Uint8Array(new SharedArrayBuffer(256));assert.throws(()=>pack(shared));assert.throws(()=>unpack(shared));
  }
});
