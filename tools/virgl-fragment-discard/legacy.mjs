#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,DISCARD_KEY} from '../../renderer/virgl-command/constant-domain.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function sealed(base){
 const manifest=JSON.parse(fs.readFileSync(base+'/manifest.json')),index=JSON.parse(fs.readFileSync(base+'/records.json')),archive=base+'/'+manifest.archive.path;
 assert.equal(hash(fs.readFileSync(base+'/records.json')),manifest.recordIndex.sha256);assert.equal(hash(fs.readFileSync(archive)),manifest.archive.sha256);
 return{manifest,archive,member(name){const entry=index.records.find(r=>r.path===name);assert.ok(entry,name);const raw=execFileSync('tar',['-xOf',archive,name],{maxBuffer:128e6});assert.equal(raw.length,entry.bytes);assert.equal(hash(raw),entry.sha256);return{value:JSON.parse(raw),binding:entry};}};
}
const power=sealed('evidence/virgl-power/worker'),coordinates=sealed('evidence/virgl-fragment-coordinates/worker');
const native=power.member('hot/native/report.json'),held=power.member('hot/legacy.json'),prior=coordinates.member('hot/native/report.json'),bridge=await createVirglShaderBridge();
const report={schema:'virgl-fragment-discard-legacy-v1',task:'E6-T12g6l',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 predecessors:[{path:'evidence/virgl-power/worker',sourceHead:power.manifest.sourceHead,archiveSha256:power.manifest.archive.sha256,bindings:[native.binding,held.binding]},
  {path:'evidence/virgl-fragment-coordinates/worker',sourceHead:coordinates.manifest.sourceHead,archiveSha256:coordinates.manifest.archive.sha256,bindings:[prior.binding]}],cases:[],extensions:[]};
for(const [kind,cases]of [['power',native.value.cases.map(c=>({...c,expected:c.result}))],['held',held.value.cases.map(c=>({...c,expected:c.old}))],['coordinates',prior.value.cases.map(c=>({...c,expected:c.result}))]])for(const c of cases){
 const result=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[c.stage],{input:c.text,maxBuffer:4e6}));
 const extension=kind==='coordinates'&&['kill','kill-if'].includes(c.name);
 if(extension){
  assert.equal(c.expected.ok,false);assert.equal(c.expected.error.code,'unsupported-feature');assert.equal(result.ok,true,c.name+' explicit new discard admission');
  assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v39');assert.equal(result.metadata.discardBaseProfile,'virgl-webgl2-raw-bits-v38');
  assert.equal(result.metadata.discardContract.alwaysDiscards,c.name==='kill');report.extensions.push({name:c.name,stage:c.stage,text:c.text,old:c.expected,result});
 }else assert.deepEqual(result,c.expected,c.name+' complete authenticated predecessor result');
 assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),result,c.name+' existing native/Wasm parity');if(result.ok)assert.equal(parseConstantDomain(result.metadata,c.stage).ok,true,c.name+' existing policy');
 if(kind==='coordinates'){
  const pair=bridge.translatePair(c.stage==='fragment'?{vertexText:c.partner,fragmentText:c.text}:{vertexText:c.text,fragmentText:c.partner});
  if(extension){assert.equal(pair.ok,true);assert.ok(pair.interfaceKey.endsWith(DISCARD_KEY+Number(result.metadata.discardContract.alwaysDiscards)));report.extensions.at(-1).pair=pair;}
  else assert.deepEqual(pair,c.pairResult,c.name+' whole predecessor pair');
 }
 report.cases.push({name:kind+'/'+c.name,stage:c.stage,textSha256:hash(c.text),resultSha256:hash(JSON.stringify(result)),ok:result.ok,extension});
}
assert.equal(report.cases.length,8349);assert.equal(report.extensions.length,2);report.status='passed';fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(`${report.cases.length-2} authenticated predecessor results unchanged; two archived discard rejections are explicit new admissions.`);
