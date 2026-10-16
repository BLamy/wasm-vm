#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge,LIMITS} from '../../renderer/virgl-shader/index.mjs';
import createModule from '../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
import {decodeSubmission,LIMITS as WIRE} from '../../renderer/virgl-command/decoder.mjs';
import {ENVELOPE,getCases} from './cases.mjs';
const nativeFile=process.argv[2],output=path.resolve(process.argv[3]??'target/evidence/virgl-compiler-bounds/wasm');assert.ok(nativeFile);
fs.mkdirSync(output,{recursive:true});const hash=b=>createHash('sha256').update(b).digest('hex'),native=JSON.parse(fs.readFileSync(nativeFile));
assert.equal(native.status,'passed');assert.deepEqual(LIMITS,ENVELOPE);assert.equal(WIRE.shaderTextBytes,LIMITS.textBytes);assert.equal(WIRE.shaderTokens,LIMITS.tokens);
const bridge=await createVirglShaderBridge(),records=[],pairs=[],wire=[];
function packet(stage,text,tokens=8192){const bytes=Buffer.from(text),total=Math.ceil((bytes.length+1)/4),buffer=Buffer.alloc(24+total*4);buffer.writeUInt32LE(((total+5)<<16)|(4<<8)|1,0);buffer.writeUInt32LE(1,4);buffer.writeUInt32LE(stage==='vertex'?0:1,8);buffer.writeUInt32LE(bytes.length+1,12);buffer.writeUInt32LE(tokens,16);bytes.copy(buffer,24);return buffer;}
for(const c of native.cases){const result=bridge.translate({stage:c.stage,text:c.text});assert.deepEqual(result,c.result,c.name);const bytes=packet(c.stage,c.text),decoded=decodeSubmission(bytes);assert.equal(decoded.ok,c.text.length<=49152,`wire capacity ${c.name}`);if(decoded.ok){assert.equal(decoded.commands[0].fields.text,c.text);const translated=bridge.translate({stage:c.stage,text:decoded.commands[0].fields.text});assert.deepEqual(translated,c.result);}
  records.push({index:c.index,name:c.name,textSha256:c.textSha256,result});wire.push({name:c.name,packetBytes:bytes.length,packetSha256:hash(bytes),result:decoded});}
for(const p of native.pairs){const v=native.cases[p.vertex],f=native.cases[p.fragment],result=bridge.translatePair({vertexText:v.text,fragmentText:f.text});assert.deepEqual(result,p.result,p.name);pairs.push({name:p.name,vertex:p.vertex,fragment:p.fragment,result});}
const small=getCases().find(c=>c.name==='high-vertex');
for(const tokens of [0,8192,8193]){const bytes=packet(small.stage,small.text,tokens),result=decodeSubmission(bytes);assert.equal(result.ok,tokens===8192);wire.push({name:`token-${tokens}`,packetBytes:bytes.length,packetSha256:hash(bytes),result});}
const malformed=packet(small.stage,small.text);malformed[malformed.length-1]=1;const padding=decodeSubmission(malformed);assert.equal(padding.ok,false);wire.push({name:'nonzero-terminal-padding',packetSha256:hash(malformed),result:padding});
// Exhaust a separate fixed-memory instance, keeping the input owned before
// exhaustion. The public C entry must reject malloc failures and then recover.
const module=await createModule();assert.equal(module.HEAPU8.byteLength,16777216);
const input=module._malloc(small.text.length+1);assert.ok(input);module.HEAPU8.set(Buffer.from(small.text),input);module.HEAPU8[input+small.text.length]=0;
const baseline=JSON.parse(module.UTF8ToString(module._bridge_translate(0,input,small.text.length))),blocks=[];
for(const size of [1048576,65536,4096,128]){for(;;){const ptr=module._malloc(size);if(!ptr)break;blocks.push(ptr);}}
const exhausted=JSON.parse(module.UTF8ToString(module._bridge_translate(0,input,small.text.length)));assert.equal(exhausted.ok,false);assert.equal(Object.hasOwn(exhausted,'glsl'),false);assert.equal(module.HEAPU8.byteLength,16777216);
for(const ptr of blocks)module._free(ptr);assert.deepEqual(JSON.parse(module.UTF8ToString(module._bridge_translate(0,input,small.text.length))),baseline);module._free(input);
const report={schema:'virgl-compiler-bounds-wasm-v1',status:'passed',task:'E6-T12g6b',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:hash(fs.readFileSync(nativeFile)),envelope:LIMITS,wireEnvelope:WIRE,cases:records,pairs,wire,fixedMemory:{bytes:module.HEAPU8.byteLength,stackBytes:262144,allocations:blocks.length,exhausted,recovered:true}};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${records.length} wasm cases and ${pairs.length} pairs match native; wire and fixed-memory failure/recovery pass.`);
