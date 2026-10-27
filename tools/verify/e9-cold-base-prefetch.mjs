#!/usr/bin/env node
// Materialize the original Omarchy image before an offline cold continuation.
// Every object is checked against the frozen manifest by e9-workload-assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadQualificationAssets,R2,sha} from './e9-workload-assets.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const output=path.resolve(process.env.E9_OUT??path.join(root,'target/evidence/e9-t22o-base-prefetch'));
const cache=path.join(root,'target/e9-workload-base-cache/desktop-chunks');
const workers=16;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output,{recursive:true});
const report={task:'E9-T22o',scope:'Pre-materialize frozen original base-image bytes; no guest run',
  status:'running',started:new Date().toISOString(),origin:R2,cache,workers,
  manifestSha256:'8a793846f109a08242688fa32d531f230d7a3e2a7bdb3c694dbfc1abb70367a8',
  completed:0,downloaded:0,initialCache:0,errors:[]};
let progressSave=Promise.resolve();
const save=()=>{const bytes=JSON.stringify(report,null,2)+'\n';
  progressSave=progressSave.then(()=>fs.writeFile(path.join(output,'progress.json'),bytes));
  return progressSave;};
let assets;
try{
  assets=await loadQualificationAssets('desktop');
  assert.equal(sha(assets.imageBytes),report.manifestSha256);
  assert.equal(assets.image.image_len,12884901888);
  assert.equal(assets.image.chunk_size,262144);
  const ids=[...new Set(assets.image.chunks)].sort();
  assert.equal(ids.length,34687);
  const present=new Set(assets.receipt.initialMaterializedCache.map(row=>row.sha256));
  report.uniqueChunks=ids.length;report.initialCache=present.size;
  report.totalBytes=String(ids.length*assets.image.chunk_size);
  await save();
  let index=0,failed=null;
  const run=async()=>{
    while(!failed){
      const at=index++;if(at>=ids.length)return;
      const id=ids[at];
      try{
        const bytes=await assets.readChunk(id);
        assert.equal(bytes.length,262144);assert.equal(hash(bytes),id);
        report.completed++;if(!present.has(id))report.downloaded++;
        if(report.completed%128===0){await save();console.log(JSON.stringify({completed:report.completed,
          total:ids.length,downloaded:report.downloaded}));}
      }catch(error){failed=error;report.errors.push({sha256:id,error:String(error.stack??error)});}
    }
  };
  await Promise.all(Array.from({length:workers},run));
  if(failed)throw failed;
  const rows=await assets.inspectCache();
  assert.equal(rows.length,ids.length);
  assert.deepEqual(rows.map(row=>row.sha256).sort(),ids);
  const provenance=new Map(assets.receipt.chunks.map(row=>[row.sha256,row.source]));
  const indexBytes=Buffer.from(JSON.stringify(rows.map(row=>({sha256:row.sha256,
    bytes:row.bytes,source:provenance.get(row.sha256)})))+'\n');
  await fs.writeFile(path.join(output,'index.json'),indexBytes);
  report.indexSha256=hash(indexBytes);report.indexBytes=indexBytes.length;
  report.status='authenticated-complete';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{await assets?.close();report.finished=new Date().toISOString();await save();
  console.log(JSON.stringify({status:report.status,completed:report.completed,
    uniqueChunks:report.uniqueChunks,failure:report.failure}));}
