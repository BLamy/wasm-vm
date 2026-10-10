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
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),sealPath='evidence/virgl-minimum-selection/worker/manifest.json',indexPath='evidence/virgl-minimum-selection/worker/records.json';
const seal=JSON.parse(fs.readFileSync(sealPath)),index=JSON.parse(fs.readFileSync(indexPath)),archive=path.join(path.dirname(sealPath),seal.archive.path);
assert.equal(hash(fs.readFileSync(indexPath)),seal.recordIndex.sha256);assert.equal(hash(fs.readFileSync(archive)),seal.archive.sha256);
const member='generated/native/virgl-shader',entry=index.records.find(r=>r.path===member),binaryBytes=execFileSync('tar',['-xOf',archive,member],{maxBuffer:4e6});assert.equal(hash(binaryBytes),entry.sha256);assert.equal(binaryBytes.length,entry.bytes);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'virgl-fraction-legacy-')),binary=path.join(temporary,'parent');fs.writeFileSync(binary,binaryBytes,{mode:0o700});
const migrationPath='tools/virgl-precise-fraction/legacy-migrations.json',migrationBytes=fs.readFileSync(migrationPath),migrations=JSON.parse(migrationBytes);
const bridge=await createVirglShaderBridge(),native=(stage,text,program='renderer/virgl-shader/build/native/virgl-shader')=>JSON.parse(execFileSync(program,[stage],{input:text,maxBuffer:4e6}));
const report={schema:'virgl-fraction-legacy-v1',task:'E6-T12g6g2',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),parent:{sealPath,indexPath,sourceHead:seal.sourceHead,archive,archiveSha256:seal.archive.sha256,binarySha256:entry.sha256},migration:{path:migrationPath,sha256:hash(migrationBytes)},fixtures:[],cases:[]};
try{
 for(const basename of ['component-float-cases','precise-arithmetic-cases','selected-lanes-cases','precise-word-cases']){
  const fixturePath=`renderer/virgl-shader/tests/${basename}.json`,bytes=fs.readFileSync(fixturePath),fixture=JSON.parse(bytes),cases=Array.isArray(fixture)?fixture:fixture.cases;report.fixtures.push({path:fixturePath,bytes:bytes.length,sha256:hash(bytes),cases:cases.length});
  for(const c of cases){
   const parent=native(c.stage,c.text,binary),old=native(c.stage,c.text);const migration=migrations.find(m=>m.name===basename+'/'+c.name);
   if(migration){assert.equal(hash(c.text),migration.inputSha256);assert.equal(parent.ok,migration.beforeOK);assert.equal(old.ok,migration.ok);assert.equal(old.metadata.profile,migration.profile);assert.equal(old.metadata.fractionBaseProfile,migration.base);}
   else assert.deepEqual(old,parent,c.name+' complete predecessor result');assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),old,c.name+' legacy parity');
   const declaration=/DCL CONST\[(\d+)/.exec(c.text),input=/DCL IN\[(\d+)/.exec(c.text),immediate=/IMM\[(\d+)\]/.exec(c.text),source=declaration?`CONST[${declaration[1]}]`:input?`IN[${input[1]}]`:immediate?`IMM[${immediate[1]}]`:'IMM[0]';
   let text=c.text.replace(/^(VERT|FRAG)\n/,`$1\nDCL TEMP[509]\n${declaration||input||immediate?'':'IMM[0] UINT32 {0,0,0,0}\n'}`);
   text=text.replace(/(?:\d+:\s*)?END\s*$/,`FRC_PRECISE TEMP[509], ${source}\nEND\n`);
   const added=native(c.stage,text);assert.equal(added.ok,old.ok,c.name+' adjacent instruction-local fraction');assert.deepEqual(bridge.translate({stage:c.stage,text}),added,c.name+' adjacent parity');
   if(old.ok){if(migration)assert.deepEqual(added.metadata,old.metadata,c.name+' same instruction-local fractional policy');
    const restored=structuredClone(added.metadata);assert.equal(restored.profile,'virgl-webgl2-raw-bits-v33');restored.profile=restored.fractionBaseProfile;delete restored.fractionBaseProfile;delete restored.fractionWordContract;
    const baseline=old.metadata.profile==='virgl-webgl2-straight-line-v5'?{...old.metadata,profile:'virgl-webgl2-raw-bits-v1'}:old.metadata;if(!migration)assert.deepEqual(restored,baseline,c.name+' complete inherited obligations');assert.equal(parseConstantDomain(added.metadata,c.stage).ok,true);
   }else for(const key of ['metadata','glsl'])assert.equal(Object.hasOwn(added,key),false,c.name+' closed rejection');
   report.cases.push({name:basename+'/'+c.name,stage:c.stage,text:c.text,ok:old.ok,migration:migration??null,parent,old,fractionText:text,added,baseTransition:parent.ok&&parent.metadata.profile==='virgl-webgl2-straight-line-v5'?'straight-line-v5-to-owned-raw-v1':null});
  }
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
report.status='passed';fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} original FRC, precise ADD/MUL, precision and selected-away cases retain complete predecessor results and adjacent fraction obligations.`);
