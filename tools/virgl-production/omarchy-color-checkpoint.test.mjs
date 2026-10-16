import assert from 'node:assert/strict';
import test from 'node:test';
import {computeStandardColorTransferLayout} from '../../renderer/virgl-command/resources.mjs';

function layout(width,height,direction=2,limits={}) {
  const metadata={id:304,target:2,format:64,bind:10,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};
  const fields={resourceHandle:304,level:0,usage:0,stride:0,layerStride:0,
    box:{x:0,y:0,z:0,width,height,depth:1},dataOffset:0,direction};
  return computeStandardColorTransferLayout(metadata,fields,width*height,limits);
}
test('historical R8 native read keeps the exact 8 MiB boundary',()=>{
  const exact=layout(1024,2048);assert.equal(exact.ok,true);
  assert.equal(exact.layout.tightBytes,2*1024*1024);assert.equal(exact.layout.scratchBytes,8*1024*1024);
  const over=layout(1025,2048);assert.equal(over.ok,false);assert.equal(over.error.code,'out-of-bounds');assert.match(over.error.message,/Native color scratch/);
});
test('a selected smaller color budget bounds native expanded read bytes',()=>{
  const exact=layout(1024,64,2,{scratchBytes:256*1024});assert.equal(exact.ok,true);
  assert.equal(exact.layout.tightBytes,64*1024);assert.equal(exact.layout.scratchBytes,256*1024);
  const over=layout(1024,65,2,{scratchBytes:256*1024});assert.equal(over.ok,false);assert.equal(over.error.code,'out-of-bounds');assert.match(over.error.message,/Native color scratch/);
});
test('the selected color budget also bounds R8 upload scratch',()=>{
  const exact=layout(1024,64,1,{scratchBytes:64*1024});assert.equal(exact.ok,true);
  assert.equal(exact.layout.scratchBytes,64*1024);
  const over=layout(1024,65,1,{scratchBytes:64*1024});assert.equal(over.ok,false);assert.equal(over.error.code,'out-of-bounds');assert.match(over.error.message,/Color transfer is too large/);
});
