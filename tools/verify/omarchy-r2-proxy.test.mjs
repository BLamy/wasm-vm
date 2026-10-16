import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkedPayload,createBindingUploader,MAX_MANIFEST_BYTES} from '../publish-omarchy-chunks-proxy.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');

test('changed staged bytes, unexpected keys and oversized bodies fail before authentication',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'omarchy-proxy-boundary-'));
  try{
    const file=path.join(dir,'staged.bin'),literal=Buffer.from([0,17,255,42]);await writeFile(file,literal);
    let opened=0;
    const adapter=createBindingUploader({getProxy:async()=>{opened++;throw Error('must not authenticate');}});
    const key='chunked-omarchy/chunks/'+hash(literal)+'.bin';
    await writeFile(file,Buffer.from([0,17,254,42]));
    await assert.rejects(adapter.upload({bucket:'wasm-vm',key,sourcePath:file}),/staged bytes/);
    await assert.rejects(adapter.upload({bucket:'wasm-vm',key:'other/'+hash(literal),sourcePath:file}),/only immutable/);
    await assert.rejects(adapter.upload({bucket:'other',key,sourcePath:file}),/bucket is fixed/);
    await writeFile(file,Buffer.alloc(MAX_MANIFEST_BYTES+1,7));
    await assert.rejects(checkedPayload('chunked-omarchy/manifest-'+hash(Buffer.from('x'))+'.json',file),/bounded upload/);
    await adapter.dispose();assert.equal(opened,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('concurrent uploads share one owner; a stalled put times out and the owner is disposed once',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'omarchy-proxy-lifecycle-'));
  try{
    const file=path.join(dir,'staged.bin'),b=Buffer.from([1,2,3,4]);await writeFile(file,b);
    const key='chunked-omarchy/chunks/'+hash(b)+'.bin';let opened=0,closed=0,puts=0;
    const adapter=createBindingUploader({putTimeoutMs:10,getProxy:async()=>{
      opened++;return{env:{ASSETS:{put(){puts++;return new Promise(()=>{});}}},dispose:async()=>{closed++;}};
    }});
    const results=await Promise.allSettled([1,2,3,4].map(()=>adapter.upload({bucket:'wasm-vm',key,sourcePath:file})));
    assert.equal(results.filter(r=>r.status==='rejected'&&/timed out/.test(r.reason.message)).length,4);
    await adapter.dispose();await adapter.dispose();assert.equal(opened,1);assert.equal(puts,4);assert.equal(closed,1);
    await assert.rejects(adapter.upload({bucket:'wasm-vm',key,sourcePath:file}),/uploader is open/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('a started owner is cleaned up when binding qualification fails',async()=>{
  let disposed=0;
  const dir=await mkdtemp(path.join(os.tmpdir(),'omarchy-proxy-qualification-'));
  try{
    const file=path.join(dir,'staged.bin'),b=Buffer.from([9]);await writeFile(file,b);
    const adapter=createBindingUploader({getProxy:async()=>({env:{},dispose:async()=>{disposed++;}})});
    await assert.rejects(adapter.upload({bucket:'wasm-vm',key:'chunked-omarchy/chunks/'+hash(b)+'.bin',sourcePath:file}),/actual R2 binding/);
    await adapter.dispose();assert.equal(disposed,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
