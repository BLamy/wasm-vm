import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createWranglerProcessProxy} from './omarchy-r2-owner.mjs';
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

test('startup deadline and explicit close dispose a late-created owner exactly once',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'omarchy-proxy-late-'));let release,disposed=0;
  try{
    const file=path.join(dir,'staged.bin'),b=Buffer.from([31]);await writeFile(file,b);
    const adapter=createBindingUploader({startupTimeoutMs:10,getProxy:()=>new Promise(resolve=>{release=resolve;})});
    await assert.rejects(adapter.upload({bucket:'wasm-vm',key:'chunked-omarchy/chunks/'+hash(b)+'.bin',sourcePath:file}),/startup timed out/);
    await adapter.dispose();
    release({env:{ASSETS:{put(){throw Error('late owner cannot upload');}}},dispose:async()=>{disposed++;}});
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(disposed,1);await adapter.dispose();assert.equal(disposed,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('a stalled owned Wrangler startup kills its complete private process group',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'omarchy-proxy-group-'));
  try{
    const worker=path.join(dir,'worker.mjs'),pids=path.join(dir,'pids.json');
    await writeFile(worker,"import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);\n");
    const start=performance.now();
    await assert.rejects(createWranglerProcessProxy({workerPath:worker,modulePath:pids,configPath:dir,startupTimeoutMs:400}),/startup timed out/);
    assert.ok(performance.now()-start<2500,'startup returns after bounded forced cleanup');
    const owned=JSON.parse(await readFile(pids));assert.equal(owned.length,2);
    await new Promise(resolve=>setTimeout(resolve,100));
    for(const pid of owned){
      let state='';try{state=execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
      assert.ok(!state||state.startsWith('Z'),'owned process is gone or reaped zombie: '+pid+' '+state);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
