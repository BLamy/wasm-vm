#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {getCases,SEEDS} from './cases.mjs';
import {getCombinedCases} from './combined.mjs';
import {parseConstantDomain,DISCARD_KEY,DISCARD_PROFILE} from '../../renderer/virgl-command/constant-domain.mjs';
const output=path.resolve(process.argv[2]??'target/evidence/virgl-fragment-discard/native');fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),binary='renderer/virgl-shader/build/discard-sanitize/discard-test',cases=[...getCases(),...getCombinedCases()];
const u=w=>{const b=Buffer.alloc(4);b.writeUInt32LE(w);return b;};
const fixture=Buffer.concat([Buffer.from('VDG1'),u(cases.length),...cases.flatMap(c=>{const text=Buffer.from(c.text),partner=Buffer.from(c.partner);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(+c.primary),u(text.length),u(partner.length),u(+c.pairOk),text,partner];})]);
fs.writeFileSync(path.join(output,'cases.bin'),fixture);
const run=spawnSync(binary,[],{input:fixture,env:{...process.env,LLVM_PROFILE_FILE:path.join(output,'native.profraw'),UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:128e6});
fs.writeFileSync(path.join(output,'native.log'),run.stdout??'');fs.writeFileSync(path.join(output,'native.stderr'),run.stderr??'');
assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
// TGSI token fields are checked against literal source spelling. File numbers
// are pinned by Mesa's p_shader_tokens.h, not derived from bridge metadata.
function expectedDiscard(text) {
 return text.split('\n').flatMap(line=>{
  line=line.replace(/^\d+:\s*/, '');if(line==='KILL')return[{opcode:'KILL',destinations:0,sources:0,precise:0,saturate:0}];
  const m=/^KILL_IF (-?)(\|?)(CONST|IN|TEMP|IMM)\[(\d+)\](?:\.([xyzw]{4}))?(\|?)$/.exec(line);if(!m)return[];
  assert.equal(m[2],m[6]);return[{opcode:'KILL_IF',destinations:0,sources:1,precise:0,saturate:0,file:{CONST:1,IN:2,TEMP:4,IMM:7}[m[3]],index:Number(m[4]),negate:+!!m[1],absolute:+!!m[2],swizzle:[...(m[5]??'xyzw')].map(c=>'xyzw'.indexOf(c))}];
 });
}
const records=cases.map((c,index)=>({...c,index,textSha256:hash(c.text)}));
for(const line of run.stdout.toString().trim().split('\n')){
 const m=/^(CASE|PAIR|PRIMARY) (\d+) (.*)$/.exec(line);if(!m){assert.equal(line,'STATUS passed');continue;}
 const c=records[Number(m[2])],result=JSON.parse(m[3]);
 if(m[1]==='PRIMARY'){
  assert.deepEqual(result.discardInstructions,expectedDiscard(c.text),c.name+' literal pinned instruction tokens');
  assert.ok(result.glsl.includes('discard;'),c.name+' upstream discard emitted');
  if(c.text.includes('DCL IN[0], POSITION')){
   assert.ok(result.glsl.includes('gl_FragCoord'));assert.ok(result.properties.some(p=>p.name===3&&p.value===1));assert.ok(result.properties.some(p=>p.name===4&&p.value===0));
  }
  c.primaryResult=result;continue;
 }
 if(m[1]==='PAIR'){
  assert.equal(result.ok,c.pairOk,c.name);c.pairResult=result;
  if(c.pairOk){assert.ok(result.interfaceKey.endsWith(DISCARD_KEY+Number(c.result.metadata.discardContract.alwaysDiscards)));assert.deepEqual(result.fragment.metadata,c.result.metadata);}
  else for(const key of ['vertex','fragment','metadata'])assert.equal(Object.hasOwn(result,key),false);
  continue;
 }
 assert.equal(result.ok,c.ok,c.name);c.result=result;
 if(c.ok){assert.equal(result.metadata.profile,DISCARD_PROFILE);const contract=parseConstantDomain(result.metadata,c.stage);assert.equal(contract.ok,true,c.name);assert.ok(contract.discard);if(c.always!==undefined)assert.equal(contract.discard.alwaysDiscards,c.always,c.name+' survivor liveness');c.consumerDomain=contract;}
 else for(const key of ['glsl','metadata'])assert.equal(Object.hasOwn(result,key),false);
}
for(const c of records){assert.ok(c.result&&c.pairResult);assert.equal(!!c.primaryResult,c.primary);}
const originals=['c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f','92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba'].map(id=>{
 const name=`evidence/virgl-workload-inventory/captures/es2gears/shaders/${id}.tgsi`,raw=fs.readFileSync(name);assert.equal(hash(raw),id);
 const instructions=raw.toString().split('\n').filter(line=>/^\s*\d+:\s+KILL(?:_IF)?(?: |$)/.test(line));assert.ok(instructions.length);return{path:name,sha256:id,instructions};
});
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(output,'native.profraw'),'-o',path.join(output,'native.profdata')]);
const coverage=JSON.parse(execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(output,'native.profdata')}`],{maxBuffer:128e6}));
for(const d of coverage.data){d.files=d.files.filter(f=>['bridge.c','raw_bits.c','native_tests/fragment_discard.c'].some(n=>f.filename.endsWith('/'+n)));d.functions=d.functions.filter(f=>f.filenames.some(n=>['bridge.c','raw_bits.c','native_tests/fragment_discard.c'].some(s=>n.endsWith('/'+s))));}
fs.writeFileSync(path.join(output,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');
const primaryPath='renderer/virgl-shader/build/discard-primary.json',primary=JSON.stringify(records.filter(c=>c.primary).map(c=>({name:c.name,text:c.text,primary:c.primaryResult})),null,2)+'\n';fs.writeFileSync(primaryPath,primary);
const report={schema:'virgl-fragment-discard-native-v1',task:'E6-T12g6l',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),seeds:SEEDS,cases:records,
 fixtureSha256:hash(fixture),binary:{path:binary,bytes:fs.statSync(binary).size,sha256:hash(fs.readFileSync(binary))},originals,
 primaryFile:{path:primaryPath,bytes:Buffer.byteLength(primary),sha256:hash(primary)},coverageSha256:hash(fs.readFileSync(path.join(output,'coverage.json'))),logSha256:hash(run.stdout),stderrSha256:hash(run.stderr)};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${records.length} discard native singles/pairs with literal pinned tokens, sanitizer and coverage passed.`);
