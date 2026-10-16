#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {getCases,SEEDS,HEADER} from './cases.mjs';
import {getCombinedCases} from './combined.mjs';
import {parseConstantDomain,COORDINATE_KEY} from '../../renderer/virgl-command/constant-domain.mjs';
const output=path.resolve(process.argv[2]??'target/evidence/virgl-fragment-coordinates/native');fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),binary='renderer/virgl-shader/build/coordinate-sanitize/coordinate-test',cases=[...getCases(),...getCombinedCases()];
const u=w=>{const b=Buffer.alloc(4);b.writeUInt32LE(w);return b;};
const fixture=Buffer.concat([Buffer.from('VCG1'),u(cases.length),...cases.flatMap(c=>{const text=Buffer.from(c.text),partner=Buffer.from(c.partner);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(+c.primary),u(text.length),u(partner.length),u(+c.pairOk),text,partner];})]);
fs.writeFileSync(path.join(output,'cases.bin'),fixture);
const run=spawnSync(binary,[],{input:fixture,env:{...process.env,LLVM_PROFILE_FILE:path.join(output,'native.profraw'),UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:64e6});
fs.writeFileSync(path.join(output,'native.log'),run.stdout??'');fs.writeFileSync(path.join(output,'native.stderr'),run.stderr??'');
assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
const records=cases.map((c,index)=>({...c,index,textSha256:hash(c.text)}));
for(const line of run.stdout.toString().trim().split('\n')){
 const m=/^(CASE|PAIR|PRIMARY) (\d+) (.*)$/.exec(line);if(!m){assert.equal(line,'STATUS passed');continue;}
 const c=records[Number(m[2])],result=JSON.parse(m[3]);
 if(m[1]==='PRIMARY'){
  assert.deepEqual(result.declarations.find(d=>d.semantic===0),{index:0,last:0,semantic:0,semanticIndex:0,mask:15,interpolation:1});
  assert.equal(result.lowerLeftKey,1);assert.equal(result.hasNoperspective,0);assert.equal(result.hasSampleInput,0);
  assert.ok(result.properties.some(p=>p.name===3&&p.value===1),'pinned LOWER_LEFT property');
  assert.ok(result.properties.some(p=>p.name===4&&p.value===0),'pinned HALF_INTEGER property');
  assert.equal(result.interstageCount,c.text.includes('GENERIC')?1:0);assert.ok(result.glsl.includes('gl_FragCoord'));
  c.primaryResult=result;continue;
 }
 if(m[1]==='PAIR'){
  assert.equal(result.ok,c.pairOk,c.name);c.pairResult=result;
  if(c.pairOk){assert.ok(result.interfaceKey.endsWith(COORDINATE_KEY));assert.deepEqual(result.fragment.metadata,c.result.metadata);}
  else for(const key of ['vertex','fragment','metadata'])assert.equal(Object.hasOwn(result,key),false);
  continue;
 }
 assert.equal(result.ok,c.ok,c.name);c.result=result;
 if(c.ok){const contract=parseConstantDomain(result.metadata,c.stage);assert.equal(contract.ok,true,c.name);assert.ok(contract.coordinates);c.consumerDomain=contract;}
 else for(const key of ['glsl','metadata'])assert.equal(Object.hasOwn(result,key),false);
}
for(const c of records){assert.ok(c.result&&c.pairResult);assert.equal(!!c.primaryResult,c.primary);}
const original='evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi';
const raw=fs.readFileSync(original);assert.equal(hash(raw),path.basename(original,'.tgsi'));const lines=raw.toString().split('\n');
for(const line of HEADER)assert.ok(lines.includes(line),'literal original header '+line);
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(output,'native.profraw'),'-o',path.join(output,'native.profdata')]);
const coverage=JSON.parse(execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(output,'native.profdata')}`],{maxBuffer:128e6}));
for(const d of coverage.data){d.files=d.files.filter(f=>['bridge.c','raw_bits.c','native_tests/fragment_coordinates.c'].some(n=>f.filename.endsWith('/'+n)));d.functions=d.functions.filter(f=>f.filenames.some(n=>['bridge.c','raw_bits.c','native_tests/fragment_coordinates.c'].some(s=>n.endsWith('/'+s))));}
fs.writeFileSync(path.join(output,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');
const primaryPath='renderer/virgl-shader/build/coordinate-primary.json',primary=JSON.stringify(records.filter(c=>c.primary).map(c=>({name:c.name,text:c.text,primary:c.primaryResult})),null,2)+'\n';fs.writeFileSync(primaryPath,primary);
const report={schema:'virgl-fragment-coordinate-native-v1',task:'E6-T12g6k',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),seeds:SEEDS,cases:records,
 fixtureSha256:hash(fixture),binary:{path:binary,bytes:fs.statSync(binary).size,sha256:hash(fs.readFileSync(binary))},original:{path:original,sha256:hash(raw),header:HEADER},
 primaryFile:{path:primaryPath,bytes:Buffer.byteLength(primary),sha256:hash(primary)},coverageSha256:hash(fs.readFileSync(path.join(output,'coverage.json'))),logSha256:hash(run.stdout),stderrSha256:hash(run.stderr)};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${records.length} coordinate native singles/pairs with original pinned tokens, sanitizer and coverage passed.`);
