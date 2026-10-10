#!/usr/bin/env node
// Independent literal four-mask attacks against actual native and Wasm compilers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import createModule from '../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
import {createVirglStandardShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const declarations=Array.from({length:16},(_,i)=>'DCL IN['+i+']').join('\n'),
 vertex='VERT\n'+declarations+'\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[15]\n2: END\n',
 fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n',
 masks=[[0,0,65535,21845],[0,0,32769,32768],[1,32768,32766,2],[4369,8738,52428,17476],[0,0,65535,65535],[0,0,0,0],
  [1,1,0,0],[1,0,1,0],[0,32768,32768,32768],[0,0,32768,1],[0,0,1,65535],[0,0,65536,0]],
 cases=masks.map((m,i)=>({kind:0,masks:m,vertex,fragment,okay:i<6}));
cases.push({kind:0,masks:[0,0,4,0],vertex:vertex.replace(declarations,'DCL IN[0]\nDCL IN[15]'),fragment,okay:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
await fs.writeFile(path.join(output,'predictions.json'),JSON.stringify({cases},null,2)+'\n');
const chunks=[word(cases.length)];for(const c of cases){const a=Buffer.from(c.vertex),b=Buffer.from(c.fragment);chunks.push(word(c.kind),...c.masks.map(word),word(a.length),a,word(b.length),b);}
const binary=path.resolve('renderer/virgl-shader/build/standard-packed-native/standard-packed-test'),packet=Buffer.concat(chunks),casePath=path.join(output,'cases.bin');await fs.writeFile(casePath,packet);
const nativeBytes=execFileSync(binary,[casePath]),native=nativeBytes.toString().trim().split('\n').map(JSON.parse);await fs.writeFile(path.join(output,'native.jsonl'),nativeBytes);
const raw=await createModule(),bridge=await createVirglStandardShaderBridge(),keys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask'],records=[];
assert.equal(raw.HEAPU8.byteLength,16777216);
for(const [i,c]of cases.entries()){
 const pointers=[];let actual;
 try{for(const text of [c.vertex,c.fragment]){const p=raw._malloc(text.length+1);assert.ok(p);pointers.push(p);raw.HEAPU8.set(Buffer.from(text+'\0'),p);}
  actual=JSON.parse(raw.UTF8ToString(raw._bridge_translate_standard_pair_vertex_formats(pointers[0],c.vertex.length,pointers[1],c.fragment.length,...c.masks)));
 }finally{pointers.reverse().forEach(p=>raw._free(p));}
 assert.deepEqual(actual,native[i].result);assert.equal(actual.ok,c.okay,'literal compatibility/declaration boundary');
 const request={vertexText:c.vertex,fragmentText:c.fragment,...Object.fromEntries(keys.map((k,n)=>[k,c.masks[n]]))},facade=bridge.translatePairVertexFormats(request);
 if(c.okay)assert.deepEqual(facade,actual);else {assert.equal(facade.ok,false);assert.equal(facade.error.code,actual.error.code);assert.deepEqual(Object.keys(facade),['ok','error']);}
 if(!c.okay){assert.deepEqual(Object.keys(actual),['ok','error']);assert.equal(actual.error.code,'invalid-input');}
 else{
  assert.equal(actual.vertex.metadata.attributes.length,16);
  for(let slot=0;slot<16;slot++){
   const typed=c.masks[0]&2**slot?'ivec4':c.masks[1]&2**slot?'uvec4':'vec4';assert.equal(actual.vertex.metadata.attributes.find(a=>a.index===slot).type,typed);
   const helper=actual.vertex.glsl.match(new RegExp('vec4 wv_pack_'+slot+'\\(vec4 v\\) \\{([\\s\\S]*?)\\n\\}'));
   assert.equal(Boolean(helper),Boolean(c.masks[2]&2**slot));
   if(helper){assert.ok(helper[1].includes('vec4(512.0,512.0,512.0,2.0)'));assert.ok(helper[1].includes('vec4(1024.0,1024.0,1024.0,4.0)'));assert.equal(helper[1].includes('return max(s / vec4(511.0,511.0,511.0,1.0), vec4(-1.0));'),Boolean(c.masks[3]&2**slot));}
  }
  assert.ok(!actual.fragment.glsl.includes('wv_pack_'));
 }
 records.push({case:i,masks:c.masks,okay:c.okay,result:actual});
}
const good={vertexText:vertex,fragmentText:fragment,signedMask:0,unsignedMask:0,packedSignedMask:65535,packedNormalizedMask:21845},baseline=bridge.translatePairVertexFormats(good),mutations=[];
for(const key of Object.keys(good)){
 const caller={...good};let trapped=false;
 const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,k){const descriptor=Reflect.getOwnPropertyDescriptor(t,k);if(k==='packedNormalizedMask'&&!trapped){trapped=true;t[key]=typeof t[key]==='string'?'\0':65536;}return descriptor;}});
 assert.deepEqual(bridge.translatePairVertexFormats(proxy),baseline,'every own primitive field is owned before call');assert.equal(trapped,true);assert.equal(bridge.translatePairVertexFormats(caller).ok,false);mutations.push(key);
}
const stage=bridge.translate({stage:'vertex',text:vertex}),ordinary=bridge.translatePair({vertexText:vertex,fragmentText:fragment}),typed=bridge.translatePairTyped({vertexText:vertex,fragmentText:fragment,signedMask:0,unsignedMask:0});
for(const r of [stage,ordinary.vertex,typed.vertex]){const source=r.glsl??r.vertex?.glsl;assert.ok(source&&!source.includes('wv_pack_'));}
assert.equal(bridge.translatePair(good).ok,false);assert.equal(bridge.translatePairTyped(good).ok,false);assert.ok(Object.isFrozen(bridge));
const report={schema:'standard-packed-critic-compiler-v1',status:'passed',cases:cases.length,ownedMutationFields:mutations,exactNativeWasm:true,fixedMemoryBytes:raw.HEAPU8.byteLength,
 binarySha256:sha(await fs.readFile(binary)),wasmSha256:sha(await fs.readFile('renderer/virgl-shader/build/wasm/virgl-shader.wasm')),caseSha256:sha(packet),records};
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases,ownedMutationFields:mutations.length}));
