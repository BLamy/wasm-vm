import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import createModule from '../../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
import {createVirglShaderBridge} from '../../../renderer/virgl-shader/index.mjs';
const out='evidence/virgl-vertex-constant/verifier';
const sha=b=>createHash('sha256').update(b).digest('hex');
const archived=fs.readFileSync(out+'/unpacked/hot-generated/renderer/virgl-shader/build/wasm/virgl-shader.wasm');
assert.equal(sha(fs.readFileSync('renderer/virgl-shader/build/wasm/virgl-shader.wasm')),sha(archived));
const bridge=await createVirglShaderBridge(),records=[];
for(const seed of[0x42f043a9,0x5ee9f861,0xa5694623]) {
  let x=seed;const rand=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
  const instructions=['MOV OUT[0], IN[0]',...Array.from({length:512},(_,i)=>`MOV TEMP[${i}], CONST[127]`),
    ...Array.from({length:255},()=>`MAD OUT[1], TEMP[${rand()%512}], CONST[96], CONST[63]`)];
  assert.equal(instructions.length,768);
  const text=['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',
    'DCL TEMP[0..511]','DCL CONST[0..127]',...instructions.map((s,i)=>`${i}: ${s}`),'768: END',''].join('\n');
  assert.ok(Buffer.byteLength(text)<49152);
  const healthy=bridge.translate({stage:'vertex',text});assert.equal(healthy.ok,true,healthy.error?.message);
  assert.equal(healthy.metadata.profile,'virgl-webgl2-straight-line-v6');assert.equal(healthy.metadata.uniforms[0].count,128);
  const native=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',['vertex'],{input:text,maxBuffer:4e6}));assert.deepEqual(healthy,native);
  const atLimit=text+'\n'.repeat(49152-Buffer.byteLength(text));assert.deepEqual(bridge.translate({stage:'vertex',text:atLimit}),healthy);
  const over=bridge.translate({stage:'vertex',text:atLimit+'\n'});assert.equal(over.ok,false);assert.equal(over.error.code,'input-too-large');assert.equal(Object.hasOwn(over,'glsl'),false);
  records.push({seed,text,bytes:Buffer.byteLength(text),textSha256:sha(text),instructions:768,temporaries:512,constants:128,native,wasm:healthy,atLimitSha256:sha(atLimit),over});
}
const module=await createModule(),raw=Buffer.from(records[0].text),at=module._malloc(raw.length+1);assert.ok(at);
const integer=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const fixture=Buffer.concat([integer(records.length),...records.flatMap(r=>{const b=Buffer.from(r.text);return[integer(0),integer(b.length),b,integer(0)];})]);
const fixturePath=out+'/maximal-cases.bin',binary=out+'/unpacked/hot-generated/renderer/virgl-shader/build/vertex-constant-sanitize/vertex-constant-test';
fs.writeFileSync(fixturePath,fixture);fs.chmodSync(binary,0o755);
const sanitizedRaw=execFileSync(binary,[fixturePath],{env:{...process.env,LLVM_PROFILE_FILE:out+'/maximal-sanitize.profraw',ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'},maxBuffer:4e6});
fs.writeFileSync(out+'/maximal-sanitize.jsonl',sanitizedRaw);
const sanitized=sanitizedRaw.toString().trim().split('\n').map(JSON.parse);
for(const[i,row]of sanitized.entries()){assert.equal(row.case,i);assert.deepEqual(row.result,records[i].wasm);}
module.HEAPU8.set(raw,at);module.HEAPU8[at+raw.length]=0;
const translate=()=>JSON.parse(module.UTF8ToString(module._bridge_translate(0,at,raw.length)));
const before=translate();assert.equal(before.ok,true);const pressure=[];
for(let schedule=0;schedule<9;schedule++) {
  const blocks=[];
  for(const size of schedule%3===0?[524288,8192,128]:schedule%3===1?[1048576,4096,64]:[262144,2048,32])
    for(;;){const p=module._malloc(size);if(!p)break;blocks.push(p);}
  const failure=translate();assert.equal(failure.ok,false);assert.equal(failure.error.code,'translation-error');
  assert.match(failure.error.message,/TGSI scratch allocation/);assert.equal(Object.hasOwn(failure,'glsl'),false);
  assert.equal(module.HEAPU8.byteLength,16777216);
  for(const p of schedule%2?blocks.reverse():blocks)module._free(p);
  assert.deepEqual(translate(),before);pressure.push({schedule,blocks:blocks.length,failure,byteIdenticalRecovery:true});
}
module._free(at);
const report={task:'E6-T11d1',status:'passed',sourceHead:'92c98c7361cad2518200bfa99765ed5895ef4f95',records,pressure,sanitizedBinarySha256:sha(fs.readFileSync(binary)),sanitizedFixtureSha256:sha(fixture),sanitizedResponsesSha256:sha(sanitizedRaw),memoryBytes:module.HEAPU8.byteLength,deliveredWasmSha256:sha(archived)};
fs.writeFileSync(out+'/wasm-pressure.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,maximalSeedCases:records.length,failRecoverSchedules:pressure.length,memoryBytes:report.memoryBytes}));
