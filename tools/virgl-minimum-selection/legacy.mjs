#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
const path='renderer/virgl-shader/tests/precise-word-cases.json',bytes=fs.readFileSync(path),fixture=JSON.parse(bytes),bridge=await createVirglShaderBridge();
const migrationPath='renderer/virgl-shader/tests/precise-arithmetic-cases.json',migrationBytes=fs.readFileSync(migrationPath),migrations=JSON.parse(migrationBytes).migrationCandidates;
const report={schema:'virgl-minimum-legacy-v1',task:'E6-T12g6g1',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),fixtureSha256:createHash('sha256').update(bytes).digest('hex'),migrationSha256:createHash('sha256').update(migrationBytes).digest('hex'),cases:[]};
const native=(stage,text)=>JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[stage],{input:text,maxBuffer:4e6}));
for(const c of fixture.cases){
 const migration=migrations.find(m=>m.name==='precise::'+c.name),wanted=migration?true:c.ok,expected=migration?.expected??c.expected;if(migration)assert.equal(createHash('sha256').update(c.text).digest('hex'),migration.inputSha256);
 const old=native(c.stage,c.text);assert.equal(old.ok,wanted,c.name);assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),old,c.name+' legacy parity');
 if(wanted){for(const [key,value]of Object.entries(expected))assert.deepEqual(key==='constantCount'?(old.metadata.uniforms[0]?.count??0):old.metadata[key],value,c.name+' legacy policy '+key);assert.equal(parseConstantDomain(old.metadata,c.stage).ok,true);}
 const declaration=/DCL CONST\[(\d+)/.exec(c.text),input=/DCL IN\[(\d+)/.exec(c.text),immediate=/IMM\[(\d+)\]/.exec(c.text);
 const source=declaration?`CONST[${declaration[1]}]`:input?`IN[${input[1]}]`:immediate?`IMM[${immediate[1]}]`:'IMM[0]';
 let text=c.text.replace(/^(VERT|FRAG)\n/,`$1\nDCL TEMP[509]\n${declaration||input||immediate?'':'IMM[0] UINT32 {0,0,0,0}\n'}`);
 text=text.replace(/(?:\d+:\s*)?END\s*$/,`MIN_PRECISE TEMP[509], ${source}, ${source}\nEND\n`);
 const added=native(c.stage,text);assert.equal(added.ok,wanted,c.name+' adjacent local minimum');assert.deepEqual(bridge.translate({stage:c.stage,text}),added,c.name+' adjacent parity');
 if(wanted){const restored=structuredClone(added.metadata);assert.equal(restored.profile,'virgl-webgl2-raw-bits-v32');restored.profile=restored.minimumBaseProfile;delete restored.minimumBaseProfile;delete restored.minimumWordContract;const baseline=old.metadata.profile==='virgl-webgl2-straight-line-v5'?{...old.metadata,profile:'virgl-webgl2-raw-bits-v1'}:old.metadata;assert.deepEqual(restored,baseline,c.name+' complete legacy contracts unchanged');assert.equal(parseConstantDomain(added.metadata,c.stage).ok,true);}
 else for(const key of ['metadata','glsl'])assert.equal(Object.hasOwn(added,key),false,c.name+' closed legacy rejection');
 report.cases.push({name:c.name,stage:c.stage,baseTransition:old.ok&&old.metadata.profile==='virgl-webgl2-straight-line-v5'?'straight-line-v5-to-owned-raw-v1':null,ok:wanted,migration:migration??null,text:c.text,old,minimumText:text,added});
}
report.status='passed';fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} original precision cases retain exact native/Wasm and complete adjacent minimum base contracts.`);
