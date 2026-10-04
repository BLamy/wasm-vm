#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
import {getCases,SEEDS,helperWords} from './cases.mjs';
import {getCombinedCases} from './combined.mjs';
const output=path.resolve(process.argv[2]??'target/evidence/virgl-precise-fraction/native');fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),binary='renderer/virgl-shader/build/precise-fraction-sanitize/precise-fraction-test',cases=[...getCases(),...getCombinedCases()];
const u=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
const input=Buffer.concat([Buffer.from('VFR1'),u(helperWords().length),...helperWords().flatMap(p=>[u(p.word),u(p.expected)]),u(cases.length),...cases.flatMap(c=>{const text=Buffer.from(c.text);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(+c.primary),u(text.length),text];})]);
fs.writeFileSync(path.join(output,'cases.bin'),input);
const run=spawnSync(binary,[],{input,env:{...process.env,LLVM_PROFILE_FILE:path.join(output,'native.profraw'),UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:32e6});
fs.writeFileSync(path.join(output,'native.log'),run.stdout??'');fs.writeFileSync(path.join(output,'native.stderr'),run.stderr??'');
assert.equal(run.status,0,`native sanitizer failed: ${run.stderr}`);assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
const records=[],words=[],primary=new Map();
for(const line of run.stdout.toString().trim().split('\n')){
  if(line.startsWith('WORD ')){const [,index,word,expected,actual]=line.split(' ').map(Number);assert.equal(actual,expected);words.push({index,word,expected,actual});continue;}
  const match=/^(CASE|PRIMARY) (\d+) (.*)$/.exec(line);
  if(!match){assert.equal(line,'STATUS passed');continue;}
  const index=Number(match[2]),result=JSON.parse(match[3]),c=cases[index];
  if(match[1]==='PRIMARY'){
    assert.ok(result.fractionInstructions.length);for(const op of result.fractionInstructions){assert.equal(op.sourceType,4);assert.equal(op.destinationType,4);assert.ok(c.text.includes(op.opcode+' '));}
    assert.ok(result.glsl.includes('#version 300 es'));primary.set(index,result);continue;
  }
  assert.equal(result.ok,c.ok,c.name);if(!result.ok)for(const key of ['glsl','metadata'])assert.ok(!Object.hasOwn(result,key));
  const domain=c.ok?parseConstantDomain(result.metadata,c.stage):null;
  if(c.ok){assert.equal(domain.ok,true,c.name+' existing consumer metadata');assert.equal(!!domain.fraction,c.fraction!==false,c.name+' exact fraction policy presence');if(c.name==='fraction-copied-bank-output')assert.deepEqual(result.metadata.constantRasterDomains[0].components,[{register:45,mask:14}]);}
  records.push({...c,index,textSha256:hash(c.text),result,consumerDomain:domain});
}
assert.deepEqual(words,helperWords().map((p,index)=>({...p,index,actual:p.expected})));assert.equal(records.length,cases.length);assert.equal(primary.size,cases.filter(c=>c.primary).length);
for(const c of records)if(primary.has(c.index))c.primaryResult=primary.get(c.index);
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(output,'native.profraw'),'-o',path.join(output,'native.profdata')]);
const coverage=JSON.parse(execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(output,'native.profdata')}`],{maxBuffer:128e6}));
for(const data of coverage.data){data.files=data.files.filter(f=>['bridge.c','raw_bits.c','raw_fraction.h','native_tests/precise_fraction.c'].some(n=>f.filename.endsWith('/'+n)));data.functions=data.functions.filter(f=>f.filenames.some(n=>['bridge.c','raw_bits.c','raw_fraction.h','native_tests/precise_fraction.c'].some(f=>n.endsWith('/'+f))));}
fs.writeFileSync(path.join(output,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');
const primaryFile='renderer/virgl-shader/build/precise-fraction-primary.json';
const primaryBytes=JSON.stringify(records.filter(c=>c.primary).map(c=>({name:c.name,stage:c.stage,text:c.text,primary:c.primaryResult})),null,2)+'\n';
fs.writeFileSync(primaryFile,primaryBytes);
const report={schema:'virgl-precise-fraction-native-v1',task:'E6-T12g6g2',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),seeds:SEEDS,
  fixtureSha256:hash(input),binary:{path:binary,bytes:fs.statSync(binary).size,sha256:hash(fs.readFileSync(binary))},cases:records,helperWords:words,primaryComparisons:primary.size,
  primaryFile:{path:primaryFile,bytes:Buffer.byteLength(primaryBytes),sha256:hash(primaryBytes)},
  coverageSha256:hash(fs.readFileSync(path.join(output,'coverage.json'))),logSha256:hash(run.stdout),stderrSha256:hash(run.stderr)};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${records.length} precise fraction native cases; ${primary.size} pinned parser/converter witnesses, ${words.length} exact helper words, ASan/UBSan and repeat/recovery passed.`);
