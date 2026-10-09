#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {COMPILER_CASES,runCompilerAcceptance} from '../../renderer/virgl-command/tests/vertex-constants.mjs';
import {createVirglShaderBridge,LIMITS} from '../../renderer/virgl-shader/index.mjs';
import createModule from '../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const integer=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const text=s=>{const b=Buffer.from(s??'');return Buffer.concat([integer(b.length),b]);};
const input=Buffer.concat([integer(COMPILER_CASES.length),...COMPILER_CASES.flatMap(c=>[integer(c.kind),text(c.text),text(c.fragment)])]);
const file=path.join(output,'cases.bin');fs.writeFileSync(file,input);fs.writeFileSync(path.join(output,'cases.json'),JSON.stringify(COMPILER_CASES,null,2)+'\n');
const bridge=await createVirglShaderBridge(),wasm=runCompilerAcceptance(bridge),native=[];
for(const mode of ['native','sanitize','scratch-sanitize']){
  const binary=`renderer/virgl-shader/build/vertex-constant-${mode}/vertex-constant-test`;
  const profile=path.join(output,mode+'.profraw');
  const raw=execFileSync(binary,[file],{env:{...process.env,LLVM_PROFILE_FILE:profile,UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(output,mode+'.jsonl'),raw);const rows=raw.toString().trim().split('\n').map(JSON.parse);assert.equal(rows.length,COMPILER_CASES.length);
  for(const[i,row]of rows.entries()){const c=COMPILER_CASES[i];assert.equal(row.case,i);assert.equal(row.result.ok,mode==='scratch-sanitize'?false:c.ok,c.name);
    if(mode==='scratch-sanitize'&&c.ok)assert.equal(row.result.error.code,'translation-error');
    else if(c.kind!==3)assert.deepEqual(row.result,wasm.results[i].result,c.name+' complete native/Wasm parity');else assert.equal(row.result.error.code,'invalid-input');}
  native.push({mode,binary,binarySha256:sha(fs.readFileSync(binary)),profile:mode!=='native'?mode+'.profraw':null,results:rows});
}
// Exercise the real delivered fixed-memory module under allocator exhaustion.
const module=await createModule();assert.equal(module.HEAPU8.byteLength,16777216);
const witness=Buffer.from(COMPILER_CASES[0].text),at=module._malloc(witness.length+1);assert.ok(at);module.HEAPU8.set(witness,at);module.HEAPU8[at+witness.length]=0;
const translate=()=>JSON.parse(module.UTF8ToString(module._bridge_translate(0,at,witness.length)));
const before=translate();assert.equal(before.ok,true);const blocks=[];for(const size of[1048576,65536,4096,128])for(;;){const p=module._malloc(size);if(!p)break;blocks.push(p);}
const exhausted=translate();assert.equal(exhausted.ok,false);assert.equal(Object.hasOwn(exhausted,'glsl'),false);assert.equal(module.HEAPU8.byteLength,16777216);
for(const p of blocks)module._free(p);assert.deepEqual(translate(),before);module._free(at);
const report={schema:1,task:'E6-T11d1',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),casesSha256:sha(input),compilerLimits:LIMITS,native,wasm,
  memory:{bytes:module.HEAPU8.byteLength,allocations:blocks.length,exhausted,recovered:true},privateRegisters:46,privateExactWords:184};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${COMPILER_CASES.length} native, sanitized and actual Wasm constant cases passed; fixed-memory exhaustion recovered`);
