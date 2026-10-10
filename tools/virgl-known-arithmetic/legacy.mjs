#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function sealed(base){const manifest=JSON.parse(fs.readFileSync(base+'/manifest.json')),index=JSON.parse(fs.readFileSync(base+'/records.json')),archive=base+'/'+manifest.archive.path;
 assert.equal(hash(fs.readFileSync(base+'/records.json')),manifest.recordIndex.sha256);assert.equal(hash(fs.readFileSync(archive)),manifest.archive.sha256);
 return{path:base,manifest,member(name){const entry=index.records.find(r=>r.path===name);assert.ok(entry);const raw=execFileSync('tar',['-xOf',archive,name],{maxBuffer:128e6});assert.equal(raw.length,entry.bytes);assert.equal(hash(raw),entry.sha256);return{value:JSON.parse(raw),binding:entry};}};
}
const prior=sealed('evidence/virgl-fragment-discard/worker/revision-2'),power=sealed('evidence/virgl-power/worker');
const discard=prior.member('hot/native/report.json'),pn=power.member('hot/native/report.json'),held=power.member('hot/legacy.json');
const bridge=await createVirglShaderBridge(),report={schema:'virgl-known-arithmetic-legacy-v1',task:'E6-T12g6m1',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),predecessors:[{path:prior.path,manifest:prior.manifest,bindings:[discard.binding]},{path:power.path,manifest:power.manifest,bindings:[pn.binding,held.binding]}],cases:[],extensions:[]};
for(const [kind,list]of [['discard',discard.value.cases.map(c=>({...c,old:c.result}))],['power',pn.value.cases.map(c=>({...c,old:c.result}))],['held',held.value.cases]])for(const c of list){
 const result=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[c.stage],{input:c.text,maxBuffer:4e6})),extension=!c.old.ok&&result.ok;
 if(extension){assert.equal(c.old.error.code,'unsupported-feature');assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v40');assert.ok(result.glsl.includes('/* known:word */'));assert.equal(parseConstantDomain(result.metadata,c.stage).ok,true);report.extensions.push({name:kind+'/'+c.name,stage:c.stage,text:c.text,textSha256:hash(c.text),old:c.old,result});}
 else assert.deepEqual(result,c.old,c.name+' entire predecessor result');
 assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),result,c.name+' native/Wasm legacy parity');
 if(kind==='discard'){const pair=bridge.translatePair(c.stage==='fragment'?{vertexText:c.partner,fragmentText:c.text}:{vertexText:c.text,fragmentText:c.partner});assert.deepEqual(pair,c.pairResult,c.name+' complete old pair');}
 report.cases.push({name:kind+'/'+c.name,textSha256:hash(c.text),resultSha256:hash(JSON.stringify(result)),ok:result.ok,extension});
}
const extensionList=report.extensions.map(c=>({name:c.name,stage:c.stage,textSha256:c.textSha256}));
if(process.argv[3]!=='--discover')assert.deepEqual(extensionList,JSON.parse(fs.readFileSync(new URL('./extensions.json',import.meta.url))),'closed named known-producer extension inventory');
report.status='passed';fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} old results; ${report.extensions.length} explicit known-producer extensions.`);
