#!/usr/bin/env node
// Reconstruct every immediately preceding complete result from authenticated seals.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {getCases} from './cases.mjs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function sealed(base){const manifest=JSON.parse(fs.readFileSync(base+'/manifest.json')),index=JSON.parse(fs.readFileSync(base+'/records.json')),archive=base+'/'+manifest.archive.path;
 assert.equal(hash(fs.readFileSync(base+'/records.json')),manifest.recordIndex.sha256);assert.equal(hash(fs.readFileSync(archive)),manifest.archive.sha256);
 return{path:base,manifest,bindings:[],member(name){const entry=index.records.find(r=>r.path===name);assert.ok(entry);const raw=execFileSync('tar',['-xOf',archive,name],{maxBuffer:128e6});assert.equal(raw.length,entry.bytes);assert.equal(hash(raw),entry.sha256);this.bindings.push(entry);return JSON.parse(raw);},bytes(name){const entry=index.records.find(r=>r.path===name);assert.ok(entry);const raw=execFileSync('tar',['-xOf',archive,name],{maxBuffer:128e6});assert.equal(raw.length,entry.bytes);assert.equal(hash(raw),entry.sha256);this.bindings.push(entry);return raw;}};
}
const prior=sealed('evidence/virgl-fragment-discard/worker/revision-2'),power=sealed('evidence/virgl-power/worker'),known=sealed('evidence/virgl-known-arithmetic/worker'),supplement=sealed('evidence/virgl-known-arithmetic/worker/supplement');
const discard=prior.member('hot/native/report.json'),pn=power.member('hot/native/report.json'),held=power.member('hot/legacy.json'),kn=known.member('hot/native/report.json'),kl=known.member('hot/legacy.json'),sn=supplement.member('hot/native.json');
const baseline=[];for(const [kind,list]of [['discard',discard.cases.map(c=>({...c,old:c.result}))],['power',pn.cases.map(c=>({...c,old:c.result}))],['held',held.cases]])for(const c of list){
 const name=kind+'/'+c.name,extension=kl.extensions.find(e=>e.name===name),old=extension?.result??c.old,previous=kl.cases[baseline.length];
 assert.equal(previous.name,name);assert.equal(previous.textSha256,hash(c.text));assert.equal(previous.resultSha256,hash(JSON.stringify(old)));assert.equal(previous.ok,old.ok);baseline.push({...c,name,old,oldPair:kind==='discard'?c.pairResult:null});
}
assert.equal(baseline.length,10041);for(const [kind,list]of [['known',kn.cases],['supplement',sn.cases]])for(const c of list)baseline.push({...c,name:kind+'/'+c.name,old:c.result,oldPair:c.pairResult});
const originalDirectory=path.resolve(path.dirname(process.argv[2]),'legacy-original');fs.mkdirSync(originalDirectory,{recursive:true});
const originalNative=path.join(originalDirectory,'virgl-shader'),originalModule=path.join(originalDirectory,'virgl-shader.mjs'),originalWasm=path.join(originalDirectory,'virgl-shader.wasm');
for(const [output,member]of[[originalNative,'generated/native/virgl-shader'],[originalModule,'generated/wasm/virgl-shader.mjs'],[originalWasm,'generated/wasm/virgl-shader.wasm']])fs.writeFileSync(output,known.bytes(member));fs.chmodSync(originalNative,0o755);
const {default:createOriginal}=await import(pathToFileURL(originalModule)),original=await createOriginal({wasmBinary:fs.readFileSync(originalWasm)});
function originalPair(c){const texts=c.stage==='fragment'?[c.partner,c.text]:[c.text,c.partner],ps=[];try{for(const text of texts){const bytes=Buffer.from(text),p=original._malloc(bytes.length+1);assert.ok(p);ps.push(p);original.HEAPU8.set(bytes,p);original.HEAPU8[p+bytes.length]=0;}return JSON.parse(original.UTF8ToString(original._bridge_translate_pair(ps[0],Buffer.byteLength(texts[0]),ps[1],Buffer.byteLength(texts[1]))));}finally{for(const p of ps)original._free(p);}}
for(const c of getCases()){const old=JSON.parse(execFileSync(originalNative,[c.stage],{input:c.text,maxBuffer:4e6})),oldPair=originalPair(c);baseline.push({...c,name:'admission/'+c.name,old,oldPair,admission:true});}
const bridge=await createVirglShaderBridge(),report={schema:'virgl-known-branches-legacy-v1',task:'E6-T12g6m2',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),predecessors:[prior,power,known,supplement].map(p=>({path:p.path,manifest:p.manifest,bindings:p.bindings})),cases:[],extensions:[],oldPairs:0,originalArtifacts:[originalNative,originalModule,originalWasm].map(p=>({path:path.relative(path.dirname(process.argv[2]),p),sha256:hash(fs.readFileSync(p)),bytes:fs.statSync(p).size})),originalSourceHead:known.manifest.sourceHead};
for(const c of baseline){
 const result=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[c.stage],{input:c.text,maxBuffer:4e6})),extension=!c.old.ok&&result.ok;
 if(extension){assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v41');assert.ok(result.glsl.includes('/* proved raw UIF */'));const contract=parseConstantDomain(result.metadata,c.stage);assert.equal(contract.ok,true);assert.ok(contract.branchLiveness);report.extensions.push({name:c.name,stage:c.stage,text:c.text,textSha256:hash(c.text),old:c.old,result});}
 else assert.deepEqual(result,c.old,c.name+' entire immediately preceding result');
 const facadeExpected=value=>/[^\x09\x0a\x0d\x20-\x7e]/.test(c.text)?{ok:false,error:{code:'invalid-input',message:'TGSI must be printable ASCII without NUL bytes.'}}:value;
 assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),facadeExpected(result),c.name+' native/Wasm legacy facade');
 let pairSha256=null;if(c.oldPair){const pair=bridge.translatePair(c.stage==='fragment'?{vertexText:c.partner,fragmentText:c.text}:{vertexText:c.text,fragmentText:c.partner});report.oldPairs++;
  if(extension){assert.equal(pair.ok,c.pairOk);if(pair.ok)assert.deepEqual(pair[c.stage].metadata,result.metadata);}else assert.deepEqual(pair,facadeExpected(c.oldPair),c.name+' complete preceding pair');pairSha256=hash(JSON.stringify(pair));}
 report.cases.push({name:c.name,textSha256:hash(c.text),resultSha256:hash(JSON.stringify(result)),ok:result.ok,extension,pairSha256});
}
const extensionList=report.extensions.map(c=>({name:c.name,stage:c.stage,textSha256:c.textSha256}));
if(process.argv[3]!=='--discover')assert.deepEqual(extensionList,JSON.parse(fs.readFileSync(new URL('./extensions.json',import.meta.url))),'closed named known-branch extension inventory');
report.status='passed';fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} full preceding results, ${report.oldPairs} complete pairs; ${report.extensions.length} explicit proved-branch extensions.`);
