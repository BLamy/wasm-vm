#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {getCases,SEEDS} from './cases.mjs';
const output=path.resolve(process.argv[2]??'target/evidence/virgl-hex-literals/native');fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),binary='renderer/virgl-shader/build/hex-literals-sanitize/hex-literals-test',cases=getCases();
const u=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
const input=Buffer.concat([Buffer.from('VHL1'),u(cases.length),...cases.flatMap(c=>{const text=Buffer.from(c.text);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(+(c.immediates!==null)),u(text.length),text];})]);
fs.writeFileSync(path.join(output,'cases.bin'),input);
const run=spawnSync(binary,[],{input,env:{...process.env,LLVM_PROFILE_FILE:path.join(output,'native.profraw'),UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:32e6});
fs.writeFileSync(path.join(output,'native.log'),run.stdout??'');fs.writeFileSync(path.join(output,'native.stderr'),run.stderr??'');
assert.equal(run.status,0,`native sanitizer failed: ${run.stderr}`);assert.equal(run.signal,null);
const records=[],primary=new Map();
for(const line of run.stdout.toString().trim().split('\n')){
  const match=/^(CASE|PRIMARY) (\d+) (.*)$/.exec(line);
  if(!match){assert.equal(line,'STATUS passed');continue;}
  const index=Number(match[2]),result=JSON.parse(match[3]),c=cases[index];
  if(match[1]==='PRIMARY'){assert.deepEqual(result.immediates,c.immediates,'pinned TGSI binary words '+c.name);primary.set(index,result);continue;}
  assert.equal(result.ok,c.ok,c.name);if(!result.ok)assert.ok(!Object.hasOwn(result,'glsl'));
  let equivalent=null;
  if(c.equivalent){equivalent=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[c.stage],{input:c.equivalent,maxBuffer:4e6}));
    if(c.equivalentMode==='exact')assert.deepEqual(result,equivalent,'prior UINT32 grammar and domains '+c.name);
    else{assert.equal(result.ok,equivalent.ok);assert.deepEqual(result.metadata,equivalent.metadata,'legacy metadata '+c.name);}}
  records.push({...c,index,textSha256:hash(c.text),result,equivalentResult:equivalent});
}
assert.equal(records.length,cases.length);assert.equal(primary.size,cases.filter(c=>c.immediates).length);
for(const c of records)if(primary.has(c.index))c.primary=primary.get(c.index);
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(output,'native.profraw'),'-o',path.join(output,'native.profdata')]);
const coverage=JSON.parse(execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(output,'native.profdata')}`],{maxBuffer:128e6}));
for(const data of coverage.data){data.files=data.files.filter(f=>['bridge.c','native_tests/hex_literals.c'].some(n=>f.filename.endsWith('/'+n)));data.functions=data.functions.filter(f=>f.filenames.some(n=>n.endsWith('/bridge.c')||n.endsWith('/native_tests/hex_literals.c')));}
fs.writeFileSync(path.join(output,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');
const report={schema:'virgl-hex-literals-native-v1',task:'E6-T12g6c',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),seeds:SEEDS,
  fixtureSha256:hash(input),binary:{path:binary,bytes:fs.statSync(binary).size,sha256:hash(fs.readFileSync(binary))},cases:records,primaryComparisons:primary.size,
  coverageSha256:hash(fs.readFileSync(path.join(output,'coverage.json'))),logSha256:hash(run.stdout),stderrSha256:hash(run.stderr)};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${records.length} native literal cases; ${primary.size} pinned parser comparisons, ASan/UBSan and repeat/recovery passed.`);
