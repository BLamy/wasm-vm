#!/usr/bin/env node
// Re-execute the independently verified predecessor binary, authenticated by its
// committed seal. Compare whole results rather than inventing refreshed goldens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {getCases as fractionCases} from '../virgl-precise-fraction/cases.mjs';
import {getCombinedCases as fractionCombined} from '../virgl-precise-fraction/combined.mjs';
import {getCases as saturationCases} from '../virgl-saturation/cases.mjs';
import {getCombinedCases as saturationCombined} from '../virgl-saturation/combined.mjs';
import {getCapturedCases as saturationCaptures} from '../virgl-saturation/captures.mjs';
import {getCases as exponentCases} from '../virgl-exponent-logarithm/cases.mjs';
import {getCombinedCases as exponentCombined} from '../virgl-exponent-logarithm/combined.mjs';
import {getCapturedCases as exponentCaptures} from '../virgl-exponent-logarithm/captures.mjs';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
import {getCases as sineCases} from '../virgl-sine/cases.mjs';
import {getCombinedCases as sineCombined} from '../virgl-sine/combined.mjs';
import {getCapturedCases as sineCaptures} from '../virgl-sine/captures.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),sealPath='evidence/virgl-sine/worker/manifest.json',indexPath='evidence/virgl-sine/worker/records.json';
const seal=JSON.parse(fs.readFileSync(sealPath)),index=JSON.parse(fs.readFileSync(indexPath)),archive=path.join(path.dirname(sealPath),seal.archive.path);
assert.equal(hash(fs.readFileSync(indexPath)),seal.recordIndex.sha256);assert.equal(hash(fs.readFileSync(archive)),seal.archive.sha256);
const member='generated/native/virgl-shader',entry=index.records.find(r=>r.path===member),binaryBytes=execFileSync('tar',['-xOf',archive,member],{maxBuffer:4e6});assert.equal(hash(binaryBytes),entry.sha256);assert.equal(binaryBytes.length,entry.bytes);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'virgl-power-legacy-')),binary=path.join(temporary,'parent');fs.writeFileSync(binary,binaryBytes,{mode:0o700});

const bridge=await createVirglShaderBridge(),native=(stage,text,program='renderer/virgl-shader/build/native/virgl-shader')=>JSON.parse(execFileSync(program,[stage],{input:text,maxBuffer:4e6}));
const report={schema:'virgl-power-legacy-v1',task:'E6-T12g6j2',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),parent:{sealPath,indexPath,sourceHead:seal.sourceHead,archive,archiveSha256:seal.archive.sha256,binarySha256:entry.sha256},fixtures:[],cases:[],extensions:[]};
try{
 for(const basename of ['component-float-cases','precise-arithmetic-cases','selected-lanes-cases','precise-word-cases','prior-fraction-cases','prior-saturation-cases','prior-exponent-cases','prior-sine-cases']){
  const fixturePath=basename==='prior-sine-cases'?'tools/virgl-sine/cases.mjs':basename==='prior-exponent-cases'?'tools/virgl-exponent-logarithm/cases.mjs':basename==='prior-saturation-cases'?'tools/virgl-saturation/cases.mjs':basename==='prior-fraction-cases'?'tools/virgl-precise-fraction/cases.mjs':`renderer/virgl-shader/tests/${basename}.json`,bytes=fs.readFileSync(fixturePath),fixture=basename==='prior-sine-cases'?[...sineCases(),...sineCombined(),...sineCaptures()]:basename==='prior-exponent-cases'?[...exponentCases(),...exponentCombined(),...exponentCaptures()]:basename==='prior-saturation-cases'?[...saturationCases(),...saturationCombined(),...saturationCaptures()]:basename==='prior-fraction-cases'?[...fractionCases(),...fractionCombined()]:JSON.parse(bytes),cases=Array.isArray(fixture)?fixture:fixture.cases;report.fixtures.push({path:fixturePath,bytes:bytes.length,sha256:hash(bytes),cases:cases.length});
  for(const c of cases){
   const parent=native(c.stage,c.text,binary),old=native(c.stage,c.text);assert.deepEqual(old,parent,c.name+' complete predecessor result');assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),old,c.name+' legacy parity');
   const matches=[...c.text.matchAll(/^(?:\d+:\s*)?IMM\[(\d+)\].*$/gm)],next=matches.length?Math.max(...matches.map(m=>Number(m[1])))+1:0;
   const declared=new Set();for(const m of c.text.matchAll(/DCL TEMP\[(\d+)(?:\.\.(\d+))?\]/g))for(let i=Number(m[1]);i<=Math.min(511,Number(m[2]??m[1]));i++)declared.add(i);let temporary=511;while(declared.has(temporary))temporary--;assert.ok(temporary>=0);
   let text=c.text.replace(/^(VERT|FRAG)\n/,`$1\nDCL TEMP[${temporary}]\n`);
   if(matches.length){const last=matches.at(-1)[0];text=text.replace(last,last+`\nIMM[${next}] UINT32 {1065353216,1065353216,1065353216,1065353216}`);}
   else{text=text.replace(/^(VERT|FRAG)\n/,'$1\nIMM[0] UINT32 {1065353216,1065353216,1065353216,1065353216}\n');}
   text=text.replace(/(?:\d+:\s*)?END\s*$/,`POW TEMP[${temporary}], IMM[${next}], IMM[${next}]\nEND\n`);
   const added=native(c.stage,text);assert.equal(added.ok,old.ok,c.name+' adjacent exact identity power');assert.deepEqual(bridge.translate({stage:c.stage,text}),added,c.name+' adjacent parity');
   if(old.ok){
    const restored=structuredClone(added.metadata);assert.equal(restored.profile,'virgl-webgl2-raw-bits-v37');restored.profile=restored.powerBaseProfile;delete restored.powerBaseProfile;delete restored.powerContract;
    const baseline=old.metadata.profile==='virgl-webgl2-straight-line-v5'?{...old.metadata,profile:'virgl-webgl2-raw-bits-v1'}:old.metadata;assert.deepEqual(restored,baseline,c.name+' complete inherited obligations');assert.equal(parseConstantDomain(added.metadata,c.stage).ok,true);
   }else for(const key of ['metadata','glsl'])assert.equal(Object.hasOwn(added,key),false,c.name+' closed rejection');
   report.cases.push({name:basename+'/'+c.name,stage:c.stage,text:c.text,ok:old.ok,parent,old,powerText:text,added,baseTransition:parent.ok&&parent.metadata.profile==='virgl-webgl2-straight-line-v5'?'straight-line-v5-to-owned-raw-v1':null});
  }
 }
 const readMember=(base,name)=>{const sp=base+'/manifest.json',ip=base+'/records.json',sm=JSON.parse(fs.readFileSync(sp)),si=JSON.parse(fs.readFileSync(ip)),ar=base+'/'+sm.archive.path;
  assert.equal(hash(fs.readFileSync(ip)),sm.recordIndex.sha256);assert.equal(hash(fs.readFileSync(ar)),sm.archive.sha256);
  const entry=si.records.find(r=>r.path===name),raw=execFileSync('tar',['-xOf',ar,name],{maxBuffer:100e6});assert.equal(hash(raw),entry.sha256);
  return {value:JSON.parse(raw),binding:{sealPath:sp,indexPath:ip,archive:ar,archiveSha256:sm.archive.sha256,member:entry}};};
 report.extensionFixtures=[];
 for(const base of ['evidence/virgl-exponent-logarithm/worker','evidence/virgl-sine/worker']){
  const old=readMember(base,'hot/native/report.json');report.extensionFixtures.push(old.binding);
  for(const c of old.value.cases.filter(c=>c.name.endsWith('-unsupported-POW'))){
   const parent=native(c.stage,c.text,binary),current=native(c.stage,c.text);assert.deepEqual(parent,c.result);assert.equal(parent.ok,false);assert.equal(current.ok,true);assert.ok(parseConstantDomain(current.metadata,c.stage).power);assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),current);
   report.extensions.push({name:c.name,stage:c.stage,text:c.text,parent,current,fixture:old.binding,transition:'declared-new-bounded-POW-admission'});
  }
 }
 assert.equal(report.extensions.length,3);
 const held=readMember('evidence/virgl-sine/worker','hot/legacy.json');report.heldExtensionFixture=held.binding;report.heldExtensions=[];
 for(const c of held.value.extensions){const parent=native(c.stage,c.text,binary),current=native(c.stage,c.text);assert.deepEqual(parent,c.current);assert.deepEqual(current,parent);assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),current);report.heldExtensions.push({name:c.name,stage:c.stage,text:c.text,parent,current});}
 assert.equal(report.heldExtensions.length,2);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
report.status='passed';fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} original FRC, precise ADD/MUL, precision and selected-away cases retain complete predecessor results and adjacent power obligations.`);
