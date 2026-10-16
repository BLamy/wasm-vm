#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {getCases,cpuPairs,SEEDS} from './cases.mjs';
import {parseConstantDomain,KNOWN_ARITHMETIC_PROFILE} from '../../renderer/virgl-command/constant-domain.mjs';
const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),binary='renderer/virgl-shader/build/known-arithmetic-sanitize/known-test',cases=getCases(),words=SEEDS.flatMap(cpuPairs);
const u=w=>{const b=Buffer.alloc(4);b.writeUInt32LE(w);return b;};
const fixture=Buffer.concat([Buffer.from('VKA1'),u(words.length),...words.flatMap(w=>[u(w.op==='MUL'?1:0),u(w.a),u(w.b),u(w.expected)]),u(cases.length),...cases.flatMap(c=>{
 const text=Buffer.from(c.text),partner=Buffer.from(c.partner);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(text.length),u(partner.length),u(+c.pairOk),text,partner];})]);
fs.writeFileSync(path.join(output,'cases.bin'),fixture);fs.writeFileSync(path.join(output,'predictions.json'),JSON.stringify({words,cases},null,2)+'\n');
const run=spawnSync(binary,[],{input:fixture,env:{...process.env,LLVM_PROFILE_FILE:path.join(output,'native.profraw'),UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:128e6});
fs.writeFileSync(path.join(output,'native.log'),run.stdout??'');fs.writeFileSync(path.join(output,'native.stderr'),run.stderr??'');
assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
const records=cases.map((c,index)=>({...c,index,textSha256:hash(c.text)}));let wordCount=0,layout;
for(const line of run.stdout.toString().trim().split('\n')){
 const m=/^(CASE|PAIR) (\d+) (.*)$/.exec(line);
 if(m){const c=records[Number(m[2])],result=JSON.parse(m[3]);assert.equal(result.ok,m[1]==='CASE'?c.ok:c.pairOk,c.name);
  if(m[1]==='PAIR'){c.pairResult=result;if(result.ok)assert.deepEqual(result[c.stage].metadata,c.result.metadata);}
  else{c.result=result;if(c.ok){assert.equal(result.metadata.profile,KNOWN_ARITHMETIC_PROFILE,c.name);const contract=parseConstantDomain(result.metadata,c.stage);assert.equal(contract.ok,true,c.name);assert.ok(contract.knownArithmetic);c.consumerDomain=contract;
    assert.ok(result.glsl.includes('/* known:word */')&&result.glsl.includes('/* known:shadow */'));}
   else for(const key of ['glsl','metadata'])assert.equal(Object.hasOwn(result,key),false);}
 }else if(line.startsWith('WORD ')){const [,i,w]=line.split(' ');assert.equal(Number(i),wordCount);assert.equal(Number(w),words[wordCount++].expected);}
 else if(line.startsWith('LAYOUT ')){layout=line.split(' ').slice(1).map(Number);assert.deepEqual(layout.slice(0,2),[111744,112]);}
 else assert.equal(line,'STATUS passed');
}
assert.equal(wordCount,words.length);for(const c of records)assert.ok(c.result&&c.pairResult);
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(output,'native.profraw'),'-o',path.join(output,'native.profdata')]);
const coverage=JSON.parse(execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(output,'native.profdata')}`],{maxBuffer:128e6}));
for(const d of coverage.data){d.files=d.files.filter(f=>['bridge.c','raw_bits.c','raw_known_arithmetic.h','native_tests/known_arithmetic.c'].some(n=>f.filename.endsWith('/'+n)));d.functions=d.functions.filter(f=>f.filenames.some(n=>['bridge.c','raw_bits.c','raw_known_arithmetic.h','native_tests/known_arithmetic.c'].some(s=>n.endsWith('/'+s))));}
fs.writeFileSync(path.join(output,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');
const originals=['c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f','92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba'].map(id=>{
 const name=`evidence/virgl-workload-inventory/captures/es2gears/shaders/${id}.tgsi`,raw=fs.readFileSync(name);assert.equal(hash(raw),id);
 const result=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',['fragment'],{input:raw,maxBuffer:4e6}));assert.equal(result.ok,false,'full original remains gated');return{path:name,sha256:id,bytes:raw.length,result};});
const report={schema:'virgl-known-arithmetic-native-v1',task:'E6-T12g6m1',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),seeds:SEEDS,cases:records,arithmeticPredictions:words.length,hostRoundingModes:4,layout,fixtureSha256:hash(fixture),binary:{path:binary,bytes:fs.statSync(binary).size,sha256:hash(fs.readFileSync(binary))},originals,coverageSha256:hash(fs.readFileSync(path.join(output,'coverage.json'))),logSha256:hash(run.stdout),stderrSha256:hash(run.stderr)};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${words.length} integer folds in four rounding modes; ${records.length} native singles/pairs passed.`);
