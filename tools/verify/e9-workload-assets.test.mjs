import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash}from'node:crypto';
import {pinnedImage,inspectMaterializedChunks,loadQualificationAssets}from'./e9-workload-assets.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('the full pinned manifest binds even an unrequested child',()=>{
 const a=Buffer.alloc(4096,1),b=Buffer.alloc(4096,2),bytes=Buffer.from(JSON.stringify({version:1,image_len:8192,chunk_size:4096,layout:'split',chunks:[digest(a),digest(b)]}));
 const image=pinnedImage(bytes,digest(bytes));assert.equal(image.chunks[1],digest(b));
 const changed=JSON.parse(bytes);changed.chunks[1]=digest(Buffer.alloc(4096,3));assert.throws(()=>pinnedImage(Buffer.from(JSON.stringify(changed)),digest(bytes)),/immutable manifest hash/);
});
test('a corrupt materialized child is refused even when the guest would not request it',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'e9-workload-cache-'));
 try{
  const wanted=Buffer.alloc(4096,1),unused=Buffer.alloc(4096,2),image={chunk_size:4096,chunks:[digest(wanted),digest(unused)]};
  await fs.writeFile(path.join(directory,digest(wanted)+'.bin'),wanted);await fs.writeFile(path.join(directory,digest(unused)+'.bin'),unused);
  assert.equal((await inspectMaterializedChunks(directory,image)).length,2);
  const bad=Buffer.from(unused);bad[4095]^=1;await fs.writeFile(path.join(directory,digest(unused)+'.bin'),bad);
  await assert.rejects(inspectMaterializedChunks(directory,image),/cached base hash/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('a cache rejection after opening the raw image closes that owned handle',async()=>{
 const cacheRoot=await fs.mkdtemp(path.join(os.tmpdir(),'e9-workload-open-'));
 const opened=[],originalOpen=fs.open;
 try{
  await fs.mkdir(path.join(cacheRoot,'software-chunks'));
  await fs.writeFile(path.join(cacheRoot,'software-chunks','invalid.bin'),Buffer.from([1]));
  fs.open=async(...args)=>{const handle=await originalOpen(...args),close=handle.close.bind(handle);
   const observed={handle,closeCalls:0};handle.close=async()=>{observed.closeCalls++;return close();};opened.push(observed);return handle;};
  await assert.rejects(loadQualificationAssets('software',{cacheRoot}),/unexpected cached base member/);
  assert.equal(opened.length,1,'post-open rejection was exercised');
  assert.equal(opened[0].closeCalls,1,'the exact opened raw image was explicitly closed once');
  await assert.rejects(opened[0].handle.stat(),'raw image handle was closed before rejection');
 }finally{
  fs.open=originalOpen;
  for(const {handle} of opened)await handle.close().catch(()=>{});
  await fs.rm(cacheRoot,{recursive:true,force:true});
 }
});
test('an image-close failure is additive to the original cache rejection',async()=>{
 const cacheRoot=await fs.mkdtemp(path.join(os.tmpdir(),'e9-workload-close-error-'));
 const opened=[],originalOpen=fs.open;
 try{
  await fs.mkdir(path.join(cacheRoot,'software-chunks'));
  await fs.writeFile(path.join(cacheRoot,'software-chunks','invalid.bin'),Buffer.from([1]));
  fs.open=async(...args)=>{const handle=await originalOpen(...args);opened.push({handle,close:handle.close.bind(handle)});
   handle.close=async()=>{throw Error('injected image close failure');};return handle;};
  await assert.rejects(loadQualificationAssets('software',{cacheRoot}),error=>{
   assert.match(error.message,/unexpected cached base member/);
   assert.match(error.assetCloseError,/injected image close failure/);
   return true;
  });
  assert.equal(opened.length,1);
 }finally{
  fs.open=originalOpen;
  for(const {close} of opened)await close().catch(()=>{});
  await fs.rm(cacheRoot,{recursive:true,force:true});
 }
});
