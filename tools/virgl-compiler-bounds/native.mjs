#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {getCases,getPairs,compactSource,SEEDS,ENVELOPE} from './cases.mjs';
const output=path.resolve(process.argv[2]??'target/evidence/virgl-compiler-bounds/native');
fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),binary='renderer/virgl-shader/build/compiler-bounds-sanitize/compiler-bounds-test';
const cases=getCases();
for(const seed of SEEDS){let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(let n=0;n<128;n++){
    const stage=next()&1?'vertex':'fragment',depth=next()%17;let text=compactSource(stage,{depth}),ok=(n%2===0);
    if(ok)text+='\n'.repeat(next()%1000);
    else text=text.replace('TEMP[0..511]',`TEMP[0..${512+next()%100}]`);
    cases.push({name:`stress-${seed}-${n}`,stage,text,ok,kind:'stress',codes:[]});
  }
}
const originalManifests=['renderer/virgl-shader/tests/original-corpus.json','renderer/virgl-shader/tests/gears-originals.json'];
const retained=new Set();
for(const filename of originalManifests){const m=JSON.parse(fs.readFileSync(filename));for(const e of [...m.originals,...(m.retainedPartners??[])]){if(retained.has(e.sha256))continue;retained.add(e.sha256);const text=fs.readFileSync(e.path,'utf8');cases.push({name:'original-'+e.sha256,stage:e.stage,text,ok:e.admitted??true,kind:'retained-original',codes:e.rejection?[e.rejection.code]:[],metadata:e.metadata??null});}}
const migrations=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/captured-grammar-migrations.json')).migrations;
for(const e of JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/captured-invalid.json'))){const m=migrations.find(m=>m.name===e.name);cases.push({...e,name:'historical-'+e.name,ok:!!m,kind:'retained-grammar',codes:[],metadata:m?.metadata??null});}
const pairs=getPairs(cases.slice(0,getCases().length)),u=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
const input=Buffer.concat([Buffer.from('VGB2'),u(cases.length),...cases.flatMap(c=>{const text=Buffer.from(c.text);assert.ok(text.length<=49153);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(text.length),text];}),u(pairs.length),...pairs.flatMap(p=>[u(p.vertex),u(p.fragment),u(+p.ok)])]);
fs.writeFileSync(path.join(output,'cases.bin'),input);
const env={...process.env,LLVM_PROFILE_FILE:path.join(output,'native.profraw'),UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'};
const run=spawnSync(binary,[],{input,env,maxBuffer:128e6});
fs.writeFileSync(path.join(output,'native.log'),run.stdout??'');fs.writeFileSync(path.join(output,'native.stderr'),run.stderr??'');
assert.equal(run.status,0,`native sanitizer case failed: ${run.stderr?.toString()}`);assert.equal(run.signal,null);
const records=[],pairRecords=[],faults=[];let layout,writers;
for(const line of run.stdout.toString().trim().split('\n')){
  if(line.startsWith('CASE ')){const match=/^CASE (\d+) (.*)$/.exec(line),index=Number(match[1]),result=JSON.parse(match[2]);assert.equal(result.ok,cases[index].ok,cases[index].name);if(!result.ok&&cases[index].codes.length)assert.ok(cases[index].codes.includes(result.error.code),cases[index].name);if(cases[index].metadata)assert.deepEqual(result.metadata,cases[index].metadata,cases[index].name);records.push({...cases[index],index,textSha256:hash(cases[index].text),result});}
  else if(line.startsWith('PAIR ')){const match=/^PAIR (\d+) (.*)$/.exec(line),index=Number(match[1]),result=JSON.parse(match[2]);assert.equal(result.ok,pairs[index].ok,pairs[index].name);pairRecords.push({...pairs[index],index,result});}
  else if(/^(PAIR)?FAULT /.test(line)){const match=/^(PAIR)?FAULT (\d+) (\d+) (\d+) (.*)$/.exec(line),result=JSON.parse(match[5]);assert.equal(result.ok,false);assert.equal(Object.hasOwn(result,'glsl'),false);assert.equal(Object.hasOwn(result,'vertex'),false);faults.push({pair:!!match[1],index:Number(match[2]),site:Number(match[3]),requestedBytes:Number(match[4]),result});}
  else if(line.startsWith('LAYOUT '))layout=JSON.parse(line.slice(7));
  else if(line.startsWith('WRITERS '))writers=JSON.parse(line.slice(8));
  else assert.equal(line,'STATUS passed');
}
assert.equal(records.length,cases.length);assert.equal(pairRecords.length,pairs.length);
assert.deepEqual(layout,{ir:111744,profile:32440,flow:433092,frame:27068,raster:207884,conversion:33584,pairConversions:67168,singleResponse:1589248,pairResponse:3179520,rasterQueue:1024,laneBits:16,pcBits:16});
assert.deepEqual(writers,{glslLimit:262144,singleWorstEscapedBytes:1572866,pairWorstEscapedBytes:3145732,shortCapacity:128,status:'passed'});
for(const bytes of [111744,433092,207884,262145])assert.ok(faults.some(f=>f.requestedBytes===bytes),`actual arena allocation failure ${bytes}`);
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(output,'native.profraw'),'-o',path.join(output,'native.profdata')]);
const coverage=JSON.parse(execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(output,'native.profdata')}`],{maxBuffer:128e6}));
const ownedFiles=['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/native_tests/compiler_bounds.c'];
for(const data of coverage.data){data.files=data.files.filter(f=>ownedFiles.some(name=>f.filename.endsWith(name)));data.functions=data.functions.filter(f=>f.filenames.some(filename=>ownedFiles.some(name=>filename.endsWith(name))));}
fs.writeFileSync(path.join(output,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');
const report={schema:'virgl-compiler-bounds-native-v1',status:'passed',task:'E6-T12g6b',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),envelope:ENVELOPE,seeds:SEEDS,fixtureSha256:hash(input),binary:{path:binary,bytes:fs.statSync(binary).size,sha256:hash(fs.readFileSync(binary))},layout,writers,cases:records,pairs:pairRecords,allocationFaults:faults,coverageSha256:hash(fs.readFileSync(path.join(output,'coverage.json'))),logSha256:hash(run.stdout),stderrSha256:hash(run.stderr)};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${records.length} native cases, ${pairRecords.length} pairs, ${faults.length} allocation faults passed under ASan/UBSan.`);
