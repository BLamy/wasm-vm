import test from 'node:test';
import assert from 'node:assert/strict';
import {packCheckpointDma as pack,unpackCheckpointDma as unpack,CHECKPOINT_DMA_MAX_BYTES} from '../../renderer/virgl-command/checkpoint-dma.mjs';
test('repeated real-size 1280x800 RGBA splash words compress without changing any bytes',()=>{
  const bytes=new Uint8Array(1280*800*4),words=new DataView(bytes.buffer);
  for(let i=0;i<bytes.length;i+=4)words.setUint32(i,0xff000000,true);
  for(let row=1;row<30;row++)for(let col=1;col<400;col++)words.setUint32((row*1280+col)*4,0xffabcdef,true);
  const packed=pack(bytes);assert.equal(packed.encoding,'u32-runs-v1');assert.ok(packed.bytes.length<2000);
  assert.deepEqual(unpack(packed),bytes);bytes.fill(99);assert.notDeepEqual(unpack(packed),bytes);
  assert.ok(packed.bytes.length*2000<512*1024*1024,'two thousand original splash uploads remain under the unchanged journal budget');
});
test('arbitrary original DMA and raw legacy entries remain exact owned bytes',()=>{
  for(const length of [0,1,255,256,257,1024,65536]){
    const bytes=Uint8Array.from({length},(_,i)=>(i*73+i%29)&255),expected=bytes.slice(),packed=pack(bytes);bytes.fill(99);
    assert.deepEqual(unpack(packed),expected);const loaded=unpack(packed);loaded.fill(97);assert.deepEqual(unpack(packed),expected);
  }
  const literal=new Uint8Array(256);for(let i=0;i<64;i++)new DataView(literal.buffer).setUint32(i*4,i,true);
  assert.ok(pack(literal) instanceof Uint8Array);assert.deepEqual(unpack(literal),literal);
});
test('mixed literals, terminal runs and varied word values round trip at packet boundaries',()=>{
  for(let seed=1;seed<=32;seed++){
    const source=new Uint8Array(8192),view=new DataView(source.buffer);let x=seed;
    for(let i=0;i<source.length/4;i++){x=(Math.imul(x,1664525)+1013904223)>>>0;view.setUint32(i*4,(i%71<52)?seed:x,true);}
    assert.deepEqual(unpack(pack(source)),source);
  }
});
test('malformed packed extents never inflate beyond a single original transfer budget',()=>{
  const base={encoding:'u32-runs-v1',length:256,bytes:Uint8Array.of(64,0,0,128,0x34,0x12,0,0)};assert.equal(unpack(base).length,256);
  for(const change of [{length:CHECKPOINT_DMA_MAX_BYTES+4},{length:255},{length:0},{encoding:'unknown'},
    {bytes:Uint8Array.of(0,0,0,128,0,0,0,0)}, {bytes:Uint8Array.of(65,0,0,128,0,0,0,0)},
    {bytes:Uint8Array.of(63,0,0,128,0,0,0,0)}, {bytes:Uint8Array.of(64,0,0,0,0,0,0,0)},
    {bytes:new Uint8Array(12)}, {bytes:new Uint8Array(256)}])assert.throws(()=>unpack({...base,...change}));
});
