#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const output=path.resolve(process.argv[2]??'target/evidence/virgl-compiler-bounds/retained');fs.mkdirSync(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),worker='evidence/virgl-gears-shaders/worker/',archive=worker+'recording.tar.gz';
assert.equal(sha(fs.readFileSync(archive)),'9941036d869021078ce41f67e219b568c24a5b00294598dba4b6873c67b3af6e');
const index=JSON.parse(fs.readFileSync(worker+'records.json')),entry=index.records.find(r=>r.path==='generated/virgl-shader');assert.ok(entry);
const oldBytes=execFileSync('tar',['-xOzf',archive,entry.path],{maxBuffer:2e6});assert.equal(oldBytes.length,entry.bytes);assert.equal(sha(oldBytes),entry.sha256);
const oldBinary=path.join(output,'parent-native');fs.writeFileSync(oldBinary,oldBytes,{mode:0o755});fs.chmodSync(oldBinary,0o755);
const bridge=await createVirglShaderBridge(),original=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/original-corpus.json')),gears=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/gears-originals.json')),migration=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/captured-grammar-migrations.json')).migrations;
const entries=[...original.originals,...gears.originals,...gears.retainedPartners],seen=new Set(),records=[],historical=[];
for(const e of entries){if(seen.has(e.sha256))continue;seen.add(e.sha256);const raw=fs.readFileSync(e.path);assert.equal(sha(raw),e.sha256);const text=raw.toString(),old=JSON.parse(execFileSync(oldBinary,[e.stage],{input:raw,maxBuffer:4e6})),native=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[e.stage],{input:raw,maxBuffer:4e6})),wasm=bridge.translate({stage:e.stage,text});assert.deepEqual(wasm,native);
 if(e.sha256.startsWith('92cb866a')){assert.equal(old.error.code,'input-too-large');assert.deepEqual(native.error,e.rejection);assert.equal(native.ok,false);}
 else assert.deepEqual(native,old,'unchanged complete original source/metadata '+e.sha256);
 if(e.metadata)assert.deepEqual(native.metadata,e.metadata);
 records.push({sha256:e.sha256,path:e.path,bytes:raw.length,stage:e.stage,old,native,wasm});
}
for(const e of JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/captured-invalid.json'))){const text=e.text,old=JSON.parse(execFileSync(oldBinary,[e.stage],{input:text,maxBuffer:4e6})),native=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[e.stage],{input:text,maxBuffer:4e6})),wasm=bridge.translate({stage:e.stage,text});assert.deepEqual(native,wasm);const admitted=migration.find(m=>m.name===e.name);assert.equal(native.ok,!!admitted,e.name);if(admitted){assert.equal(sha(text),admitted.inputSha256);assert.deepEqual(native.metadata,admitted.metadata);}
 const changed=JSON.stringify(old)!==JSON.stringify(native);
 if(changed&&e.name!=='oversized-temp-range')assert.equal(native.ok,false,'capacity migration cannot grant another grammar admission');
 historical.push({...e,inputSha256:sha(text),old,native,changed});
}
assert.equal(records.length,25);assert.equal(historical.filter(e=>e.native.ok).length,5);assert.deepEqual(historical.filter(e=>!e.old.ok&&e.native.ok).map(e=>e.name),['oversized-temp-range']);
const report={schema:'virgl-compiler-bounds-retained-v1',status:'passed',task:'E6-T12g6b',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),parent:'60aebb0e1a4639ff4d9468067879e9789e6a5a23',oldBinary:{bytes:oldBytes.length,sha256:sha(oldBytes),archiveSha256:sha(fs.readFileSync(archive)),member:entry.path},originals:records,historical,changedRejections:historical.filter(e=>e.changed&&!e.native.ok).map(e=>({name:e.name,before:e.old.error,after:e.native.error}))};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('25 literal original bodies retain23 admissions and unchanged emitted GLSL/metadata; two complete larger programs remain rejected. One historical declaration admission is explicit.');
