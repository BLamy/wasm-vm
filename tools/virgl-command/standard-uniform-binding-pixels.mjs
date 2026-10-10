#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {originalDraw,floatWord} from './standard-uniform-binding-oracle.mjs';
const root=path.resolve(process.argv[2]),out={schema:'original-uniform-binding-audit-v1',status:'running',frames:[],faults:[],pixels:0,nativeDraws:0,guestBlocks:0,gpuBytes:0};
async function audit(name,fault=false){
 const directory=path.join(root,name),report=JSON.parse(await fs.readFile(path.join(directory,'report.json'))),result=fault?report.partial:report.browserResult.result,blobs=new Map(result.blobs.map(row=>[row.key,row])),decoded=new Map();
 async function raw(ref){if(decoded.has(ref.key))return decoded.get(ref.key);const row=blobs.get(ref.key);assert.equal(row.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,row.path));assert.equal(sha256(packed),row.gzipSha256);const data=gunzipSync(packed);assert.equal(data.length,row.bytes);assert.equal(sha256(data),row.sha256);decoded.set(ref.key,data);return data;}
 for(const frame of result.frames){
  const uploads=new Map();for(const row of frame.created)uploads.set(row.generation,Buffer.alloc(row.metadata.width*(row.metadata.target===0?1:row.metadata.height*4)));
  for(const row of frame.inputs){const bytes=await raw(row.blob),target=uploads.get(row.resource.generation);assert.ok(target);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,bytes.length);target.set(bytes,row.layout.offset);}
  const model=originalDraw(frame,uploads),draw=frame.dump.draws.at(-1),program=frame.dump.programs.at(-1);assert.ok(draw&&program);assert.equal(frame.history.at(-1).result.gpuComplete,true);
  assert.deepEqual(frame.expected,model.expected,'pre-compiler full original pixel prediction');
  if(!(fault&&report.fault==='slot-zero-variant'))assert.equal(draw.command.bufferZeroMask,model.zeroMask,'original bound variant bits');
  assert.ok(frame.native.length);let wordDifferences=0,rangeDifferences=0;
  for(const native of frame.native){assert.deepEqual(native.args,model.fields[3]?[4,3,5123,0]:[4,0,3]);assert.equal(native.name,model.fields[3]?'drawElements':'drawArrays');
  assert.equal(native.shaders.find(row=>row.stage===35633).glsl,program.vertexESSL300);assert.equal(native.shaders.find(row=>row.stage===35632).glsl,program.fragmentESSL300);
  const system=native.blocks.find(row=>row.name==='VirglBlock');assert.ok(system);assert.deepEqual([system.binding,system.bytes,system.vertex,system.fragment],[0,656,true,false]);
  const expectedSystem=Buffer.alloc(656);expectedSystem.writeUInt32LE(floatWord(1),640);assert.deepEqual(await raw(system.storage),expectedSystem,'complete original owned system bytes');
  assert.equal(system.members.length,6);assert.deepEqual(system.members.map(row=>[row.name,row.type,row.count,row.offset,row.stride]),[['clipp[0]',35666,8,0,16],['stipple_pattern[0]',5125,32,128,16],['winsys_adjust_y',5126,1,640,0],['alpha_ref_val',5126,1,644,0],['clip_plane_enabled',35670,1,648,0],['drawid_base',5124,1,652,0]]);
  for(const block of native.blocks.filter(row=>row!==system)){
   const m=block.name.match(/^Virgl(VS|FS)Const(\d+)$/);assert.ok(m);const stage=m[1]==='VS'?0:1,slot=+m[2],declaration=model.declared[stage].find(row=>row.slot===slot),bank=model.banks[stage].get(slot);assert.ok(declaration);assert.equal(block.binding,1+stage*13+slot);assert.equal(block.bytes,declaration.count*16);
   const used=new RegExp('(?:^|,) CONST\\['+slot+'\\]\\[','m').test(model.shaders[stage]);assert.equal(block[stage?'vertex':'fragment'],false);assert.equal(block[stage?'fragment':'vertex'],used);
   assert.equal(block.members.length,1);assert.deepEqual(block.members.map(row=>[row.name,row.type,row.count,row.offset,row.stride,row.blockIndex]),[[(stage?'fs':'vs')+'const'+slot+'[0]',36296,declaration.count,0,16,block.index]]);
   const observed=await raw(block.storage);
   if(bank){assert.deepEqual([block.resourceId,block.generation,block.length],[bank.id,bank.generation,bank.length]);if(block.start!==bank.offset)rangeDifferences++;const expected=uploads.get(bank.generation);if(!observed.equals(expected))wordDifferences++;}
   else{assert.equal(used,false);assert.equal(block.resourceId,null);assert.equal(block.start,0);assert.equal(block.length,block.bytes);assert.equal(observed.length,16384);assert.ok(observed.every(value=>value===0));}
   if(!fault){out.guestBlocks++;out.gpuBytes+=observed.length;}
  }
  for(const attribute of native.attributes){
   const index=+attribute.name.split('_')[1],element=model.elements[index],buffer=model.buffers[element.buffer],actual=draw.command.vertexFetches.find(row=>row.attributeIndex===index);assert.ok(element&&buffer&&actual);assert.equal(attribute.enabled,buffer.stride!==0);
   if(attribute.enabled){assert.deepEqual([attribute.resourceId,attribute.generation,attribute.stride,attribute.offset],[buffer.id,buffer.generation,buffer.stride,buffer.offset+element.offset]);assert.deepEqual(await raw(attribute.storage),uploads.get(buffer.generation));}
   assert.equal(attribute.shaderType,element.format===200?35669:element.format===196?36296:35666);assert.equal(attribute.integer,[196,200].includes(element.format)&&attribute.enabled);
  }
  }
  if(!fault){assert.equal(wordDifferences,0,'all original uploaded words equal GPU storage');assert.equal(rangeDifferences,0,'original byte range equals actual native range');}
  const pixels=await raw(frame.pixels),misses=[];assert.equal(pixels.length,frame.width*frame.height*4);for(let at=0;at<pixels.length;at++)if(pixels[at]!==model.expected[at%4]){if(misses.length<16)misses.push({at,expected:model.expected[at%4],observed:pixels[at]});}
  const row={label:frame.label,expected:model.expected,pixels:pixels.length/4,held:misses.length===0,misses,wordDifferences,rangeDifferences};
  if(fault){assert.equal(row.held,false);assert.ok(report.browserResult.error.message.includes('independent original uniform pixels after completed fence'));out.faults.push(row);if(report.fault==='block-word')assert.ok(wordDifferences>0);if(report.fault==='range-offset')assert.ok(rangeDifferences>0);}
  else{assert.equal(row.held,true);out.frames.push(row);out.pixels+=row.pixels;out.nativeDraws+=frame.native.length;}
 }
}
await audit('hardware');for(const fault of ['block-word','range-offset','slot-zero-variant'])await audit('fault-'+fault,true);
assert.equal(out.faults.length,3);out.status='passed';await fs.writeFile(path.join(root,'physical-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({frames:out.frames.length,pixels:out.pixels,guestBlocks:out.guestBlocks,status:out.status}));
