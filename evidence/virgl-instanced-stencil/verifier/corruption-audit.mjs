#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {model,compare} from '../../../tools/virgl-instanced-stencil/oracle.mjs';
const root=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const results=[];
for(const prefix of ['hot','cold'])for(const fault of ['order','base','phase']){
 const folder=path.join(root,prefix,'fault-'+fault),reportRaw=await fs.readFile(path.join(folder,'report.json')),report=JSON.parse(reportRaw),e=report.partial??report.browserResult.result;
 assert.equal(report.status,'failed');assert.equal(report.browserResult.status,'failed');assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(e.runs.length,1);
 const blobs=new Map();for(const b of e.blobs){const zipped=await fs.readFile(path.join(folder,b.path)),raw=gunzipSync(zipped);assert.equal(sha(raw),b.sha256);assert.equal(sha(zipped),b.gzipSha256);assert.equal(raw.length,b.bytes);blobs.set(b.key,raw);}
 const body=ref=>{const raw=blobs.get(ref.key);assert.ok(raw);assert.equal(sha(raw),ref.sha256);return raw;};
 let row=e.runs[0],runDigest=null;if(row.path){const raw=await fs.readFile(path.join(folder,row.path));assert.equal(sha(raw),row.sha256);runDigest=sha(raw);row=JSON.parse(raw);}
 const buffers=new Map(row.buffers.map(b=>[b.id,body(b.input)])),frame=row.frames[0];assert.ok(frame);
 const original=model(row.history.slice(0,frame.historyIndex+1),buffers,{format:row.format,width:row.width,height:row.height,input:body(row.planes.find(p=>p.level===row.level).input)});
 const differences=compare(original,body(frame.color),body(frame.depth),row.width,row.height,row.format);assert.ok(differences.length);
 const before=row.corruption.before,after=row.corruption.after,sync=row.fenceObjects.find(s=>s.id===after.sync);assert.ok(sync);assert.notEqual(before.sync,after.sync);assert.ok(sync.createdSequence>before.sequence);assert.ok(after.sequence>sync.createdSequence);
 const writers=row.events.filter(v=>v.sequence>before.sequence&&v.sequence<sync.createdSequence&&['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(v.name)&&v.label==='instanced-draw');assert.equal(writers.length,40);assert.ok(sync.createdSequence>writers.at(-1).sequence);assert.ok(sync.polls.some(v=>v.sequence===after.sequence&&[37146,37148].includes(v.actual)&&[37146,37148].includes(v.delivered)));
 if(fault==='order'){
  const source=await fs.readFile(path.join(folder,'source',report.mutation.path)),served=await fs.readFile(path.join(folder,'served',report.mutation.path));assert.equal(sha(source),report.mutation.original.sha256);assert.equal(sha(served),report.mutation.delivered.sha256);assert.notEqual(sha(source),sha(served));
  assert.equal(report.servedFiles.find(v=>v.path==='/'+report.mutation.path).sha256,sha(served));
  assert.match(served.toString(),/for \(let i = 0; i < nativeCount; i \+= 3\) for \(let instance = 0; instance < instances; instance\+\+\)/);
  const expected=Array.from({length:40},(_,i)=>Math.floor(i/2)%5);assert.deepEqual(row.instanceStates.filter(v=>v.label==='instanced-draw').map(v=>v.before.base),expected);
 }else{
  const controls=row.instanceControls.filter(v=>v.kind==='actual-wrong-'+(fault==='base'?'uint-base':'divisor-phase'));assert.ok(controls.length);
  assert.ok(controls.every(v=>v.original!==v.delivered));
  if(fault==='base')assert.ok(row.instanceStates.filter(v=>v.label==='instanced-draw').every(v=>v.before.base===0));
  else assert.ok(row.instanceStates.filter(v=>v.label==='instanced-draw').every(v=>v.before.attributes.find(v=>v.name==='in_1').offset===8));
 }
 results.push({prefix,fault,reportSha256:sha(reportRaw),runSha256:runDigest,frame: {colorSha256:frame.color.sha256,depthSha256:frame.depth.sha256},writers:{first:writers[0].sequence,last:writers.at(-1).sequence,count:writers.length},before,completed:{sync:sync.id,createdSequence:sync.createdSequence,...after},differences});
}
await fs.writeFile(output,JSON.stringify({schema:'fresh-instanced-stencil-completed-corruption-v1',status:'passed',eachControlPhysicallyRefuted:true,results},null,2)+'\n');console.log(JSON.stringify({status:'passed',completedControls:results.length,differences:results.map(v=>({prefix:v.prefix,fault:v.fault,first:v.differences[0]}))}));
