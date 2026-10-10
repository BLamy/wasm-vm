#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),base='evidence/virgl-power/worker',seal=JSON.parse(fs.readFileSync(base+'/manifest.json')),index=JSON.parse(fs.readFileSync(base+'/records.json')),archive=base+'/'+seal.archive.path;
assert.equal(hash(fs.readFileSync(base+'/records.json')),seal.recordIndex.sha256);assert.equal(hash(fs.readFileSync(archive)),seal.archive.sha256);
const member=name=>{const entry=index.records.find(r=>r.path===name);assert.ok(entry,name);const raw=execFileSync('tar',['-xOf',archive,name],{maxBuffer:128e6});assert.equal(raw.length,entry.bytes);assert.equal(hash(raw),entry.sha256);return{value:JSON.parse(raw),binding:entry};};
const native=member('hot/native/report.json'),held=member('hot/legacy.json'),bridge=await createVirglShaderBridge();
const report={schema:'virgl-fragment-coordinate-legacy-v1',task:'E6-T12g6k',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHead:seal.sourceHead,archiveSha256:seal.archive.sha256,bindings:[native.binding,held.binding],cases:[]};
for(const [kind,cases]of [['power',native.value.cases.map(c=>({...c,expected:c.result}))],['held',held.value.cases.map(c=>({...c,expected:c.old}))]])for(const c of cases){
 const result=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[c.stage],{input:c.text,maxBuffer:4e6}));assert.deepEqual(result,c.expected,c.name+' complete authenticated predecessor result');assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),result,c.name+' existing native/Wasm parity');if(result.ok)assert.equal(parseConstantDomain(result.metadata,c.stage).ok,true,c.name+' existing policy');
 report.cases.push({name:kind+'/'+c.name,stage:c.stage,textSha256:hash(c.text),resultSha256:hash(JSON.stringify(result)),ok:result.ok});
}
report.status='passed';fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} authenticated original compiler results and metadata policies remain unchanged.`);
