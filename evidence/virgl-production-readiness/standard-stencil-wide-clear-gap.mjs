import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sourceHead='5a0d9fc9655f1e0956154763bda420aec721865a',sha=raw=>createHash('sha256').update(raw).digest('hex');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim(),executionHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'original-stencil-wide-clear-'));
const sources=[],names=execFileSync('git',['ls-tree','-r','--name-only',sourceHead,'renderer/virgl-command'],{encoding:'utf8'}).trim().split('\n').filter(n=>n.endsWith('.mjs')&&!n.includes('/tests/'));
try{
 for(const name of names){const raw=execFileSync('git',['show',sourceHead+':'+name],{cwd:root});const dest=path.join(scratch,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,raw);sources.push({path:name,bytes:raw.length,sha256:sha(raw),base64:raw.toString('base64')});}
 const {decodeStandardPackedDepthImageSubmission:decode}=await import(pathToFileURL(path.join(scratch,'renderer/virgl-command/decoder.mjs'))),rows=[];
 for(const value of [256,0x123456a5,0x80000001,0xffffffff]){
  const bytes=Buffer.alloc(36);[0x00080007,4,0x3e800000,0x3f000000,0x3f400000,0x3f800000,0,0x3fe00000,value].forEach((v,i)=>bytes.writeUInt32LE(v,i*4));const result=decode(bytes);assert.equal(result.ok,false);assert.equal(result.error.code,'invalid-value');rows.push({stencil:value,hex:bytes.toString('hex'),result});
 }
 const result={schema:'original-stencil-wide-clear-gap-v1',sourceHead,executionHead,authority:'unchanged-predecessor-original-wire-refusals',nativeExecuted:false,guestExecution:false,productionNegotiation:false,sources,rows};await fs.writeFile(process.argv[2]??new URL('./standard-stencil-wide-clear-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({sourceHead,executionHead,refusals:rows.length,wholeSourceBodies:sources.length}));
}finally{await fs.rm(scratch,{recursive:true,force:true});}
