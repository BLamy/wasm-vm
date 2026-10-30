import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createSessionEvidenceArchive} from './e9-gpu-session-evidence.mjs';

// Exercise the recorder's actual HTTP/file boundary. This does not stand in for
// the separate browser/store/real-desktop object-retention proof.
test('archive finalizes exact sequential bytes and refuses corruption, offsets and oversized refs',async()=>{
 for(const mode of ['valid','corrupt','offset','bound']){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'e9-archive-'));
  const archive=await createSessionEvidenceArchive(directory,'test-head');let base;
  const server=createServer(async(req,res)=>{if(!await archive.handle(req,res,{},new URL(req.url,base).pathname))res.writeHead(404).end();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  const bytes=Buffer.from('immutable actual recorder bytes'),ref={sha256:createHash('sha256').update(bytes).digest('hex'),length:String(bytes.length)};
  const post=async(route,body)=>fetch(base+archive.prefix+'/'+route,{method:'POST',headers:{Origin:base},body});
  const page={url:()=>base+'/page',async evaluate(){
   const indexed=await post('index',JSON.stringify([{...ref,...(mode==='bound'?{length:String(2**31+1)}:{})}]));
   if(mode==='bound'){assert.equal(indexed.status,400);throw Error('bounded ref refused');}
   assert.equal(indexed.status,200);
   const supplied=mode==='corrupt'?Buffer.alloc(bytes.length,0):bytes;
   const response=await post('blob/'+ref.sha256+'/'+(mode==='offset'?1:0),supplied);
   if(mode!=='valid'){assert.equal(response.status,400);throw Error('invalid recorder input refused');}
   assert.equal(response.status,200);assert.equal((await response.json()).offset,bytes.length);
   return {expectedObjectCount:1,expectedBytes:bytes.length};
  }};
  try{
   if(mode==='valid'){
    const result=await archive.capture(page,{});assert.equal(result.status,'complete');
    assert.deepEqual(await fs.readFile(path.join(directory,'retained-session-objects','objects',ref.sha256+'.bin')),bytes);
   }else{
    await assert.rejects(archive.capture(page,{}),/refused/);
    assert.equal((await fs.readdir(path.join(directory,'retained-session-objects','objects'))).some(n=>n.endsWith('.bin')),false);
   }
  }finally{await archive.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});}
 }
});
