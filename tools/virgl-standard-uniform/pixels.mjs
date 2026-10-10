#!/usr/bin/env node
// Offline full hardware records, independently reconstructed original words and pixels.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {hardwareFixtures} from './hardware-fixtures.mjs';
const directory=path.resolve(process.argv[2]),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),fixtures=hardwareFixtures(),frames=[],faults=[];
async function audit(name,fault=false) {
  const root=path.join(directory,name),report=JSON.parse(await fs.readFile(path.join(root,'report.json'))),acceptance=report.acceptance;
  assert.equal(report.status,fault?'failed':'passed');assert.equal(acceptance.guestExecution,false);assert.equal(acceptance.productionNegotiation,false);
  const blobs=new Map();for(const item of acceptance.blobs) {const packed=await fs.readFile(path.join(root,item.path));assert.equal(sha(packed),item.gzipSha256);
    const raw=gunzipSync(packed);assert.equal(raw.length,item.bytes);assert.equal(sha(raw),item.sha256);blobs.set(item.key,raw);}
  const checked=[];
  for(const frame of acceptance.frames) {
    const fixture=fixtures.find(item=>item.name===frame.name);assert.ok(fixture);assert.equal(frame.gpuComplete.submitted,true);assert.equal(frame.gpuComplete.fenced,true);
    assert.ok([37146,37148].includes(frame.gpuComplete.status));assert.equal(frame.cleaned,true);assert.equal(frame.calls.length,1);assert.equal(frame.calls[0].name,'drawArrays');
    assert.equal(frame.calls[0].count,fixture.vertices);assert.equal(frame.width,fixture.width);assert.equal(frame.height,fixture.height);
    const bytes=blobs.get(frame.pixels);assert.equal(bytes.length,fixture.width*fixture.height*16);const mismatches=[];let checkedWords=0;
    for(let y=0;y<fixture.height;++y)for(let x=0;x<fixture.width;++x) {const expected=fixture.expected(x,y);
      for(let lane=0;lane<4;++lane) {const actual=bytes.readFloatLE(((y*fixture.width+x)*4+lane)*4);++checkedWords;
        if(actual!==expected[lane]&&mismatches.length<8)mismatches.push({x,y,lane,expected:expected[lane],actual});}}
    assert.equal(mismatches.length===0,!fault);assert.equal(frame.audit.held,!fault);assert.equal(frame.audit.checkedWords,checkedWords);assert.deepEqual(frame.audit.mismatches,mismatches);
    const system=blobs.get(frame.systemStorage),expectedSystem=Buffer.alloc(656);expectedSystem.writeFloatLE(1,640);assert.deepEqual(system,expectedSystem);
    assert.equal(frame.systemBlocks[0].binding,0);assert.equal(frame.systemBlocks[0].size,656);
    assert.equal(frame.attributes.length,fixture.attributes.length);for(const attribute of frame.attributes) {
      const input=fixture.attributes.find(value=>value.index===attribute.index),original=Buffer.from(input.data.buffer,input.data.byteOffset,input.data.byteLength);
      assert.deepEqual(blobs.get(attribute.original),original);assert.deepEqual(blobs.get(attribute.actual),original);
      assert.equal(attribute.integer,['signed','unsigned'].includes(input.type));assert.equal(attribute.normalized,false);
      assert.equal(attribute.type,{float:5126,signed:5124,unsigned:5125,packed:33640}[input.type]);assert.equal(attribute.stride,input.type==='packed'?4:0);assert.equal(attribute.offset,0);
    }
    assert.equal(frame.banks.length,fixture.banks.length);const native=[];
    for(const bank of frame.banks) {
      const input=fixture.banks.find(value=>value.stage===bank.stage&&value.slot===bank.slot),original=Buffer.from(input.words.buffer,input.words.byteOffset,input.words.byteLength);
      assert.deepEqual(blobs.get(bank.original),original);assert.equal(bank.count,input.count);
      if(bank.inline) {assert.equal(bank.slot,0);assert.equal(bank.type,36296);assert.deepEqual(blobs.get(bank.actual),original);}
      else {
        const storage=blobs.get(bank.actualStorage);assert.equal(storage.length,bank.nativeStorageBytes);
        if(!fault)assert.deepEqual(storage.subarray(bank.actualOffset,bank.actualOffset+original.length),original);
        if(bank.binding!==null) {assert.equal(bank.size,original.length);assert.equal(bank.member.offset,0);assert.equal(bank.member.stride,16);assert.equal(bank.member.type,36296);
          assert.equal(bank.member.size,input.count);assert.equal(bank.member.blockIndex,bank.index);assert.equal(bank.reflectedBinding,bank.binding);
          assert.equal(bank.nativeStart,bank.actualOffset);assert.equal(bank.nativeSize,original.length);assert.equal(bank.nativeObjectMatches,true);}
        native.push({stage:bank.stage,slot:bank.slot,bytes:original.length,binding:bank.binding,start:bank.actualOffset,
          member:bank.member??null,originalSha256:sha(original),gpuStorageSha256:sha(storage),eliminated:bank.eliminatedDeclaration??false,variantMissing:bank.variantMissingBlock??false});
      }
    }
    if(fixture.kind==='all-banks'&&!fault)assert.equal(frame.activeBlocks,25+((fixture.selectors.bufferZeroMask&1)?1:0)+((fixture.selectors.bufferZeroMask&2)?1:0));
    checked.push({name:frame.name,checkedPixels:fixture.width*fixture.height,checkedWords,rawPixelsSha256:sha(bytes),native,mismatches});
  }
  if(fault) {assert.equal(checked.length,1);assert.ok(report.failure.message.includes('independent original uniform pixels after completed GPU fence'));
    faults.push({mode:name.slice(6),fenced:true,...checked[0]});}
  else {assert.equal(checked.length,125);frames.push(...checked);}
}
await audit('hardware');for(const fault of ['block-word','range-offset','slot-zero-variant'])await audit('fault-'+fault,true);
const pixels=frames.reduce((sum,frame)=>sum+frame.checkedPixels,0),words=frames.reduce((sum,frame)=>sum+frame.checkedWords,0);
await fs.writeFile(path.join(directory,'physical-audit.json'),JSON.stringify({status:'passed',frames,pixels,checkedWords:words,nativeDraws:125,
  everyBankWordRead:true,allBanksSimultaneouslyActive:true,fullOriginalStorage:true,faults,guestExecution:false,productionNegotiation:false},null,2)+'\n');
console.log('Audited '+pixels+' complete original uniform pixels and all three completed GPU faults.');
