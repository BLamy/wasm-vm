#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createVirglStandardShaderBridge,STANDARD_LIMITS} from '../../renderer/virgl-shader/standard.mjs';
import {normalizeStandardShaderPair,normalizeStandardShaderTypedPair} from '../../renderer/virgl-command/constant-domain.mjs';
import createModule from '../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
const [mode,name]=process.argv.slice(2),output=path.resolve(name);await fs.mkdir(output,{recursive:true});
const fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const vertex=(index,extra=false)=>'VERT\nDCL IN[0]\n'+(index?'DCL IN['+index+']\n':'')+(extra?'DCL IN[2]\n':'')+'DCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN['+index+']\n2: END\n';
if(mode==='cases'){
 const cases=[];const add=(name,signedMask,unsignedMask,a=vertex(1),kind=0,okay=true,code=null,b=fragment)=>cases.push({name,kind,signedMask,unsignedMask,a,b,okay,code});
 for(let index=0;index<16;index++)for(const signed of [true,false])add('slot-'+index+'-'+signed,signed?2**index:0,signed?0:2**index,vertex(index));
 add('mixed',2,4,vertex(1,true));add('mixed-opposite',4,2,vertex(1,true));add('float',0,0);add('old-pair',2,2,vertex(1),1);
 for(const [s,u]of [[2,2],[65536,0],[0,65536],[0xffffffff,0],[0,0xffffffff],[4,0],[0,32768]])add('invalid-mask-'+s+'-'+u,s,u,vertex(1),0,false,'invalid-input');
 add('null-vertex',2,0,vertex(1),2,false,'invalid-input');add('null-fragment',0,2,vertex(1),3,false,'invalid-input');
 add('bad-vertex',2,0,'\0',0,false,'invalid-input');add('oversized-vertex',0,2,' '.repeat(STANDARD_LIMITS.textBytes+1),0,false,'input-too-large');
 add('bad-fragment',2,0,vertex(1),0,false,'invalid-input','\0');
 const w=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},parts=[w(cases.length)];
 for(const c of cases){const a=Buffer.from(c.a),b=Buffer.from(c.b);parts.push(w(c.kind),w(c.signedMask),w(c.unsignedMask),w(a.length),a,w(b.length),b);}
 await fs.writeFile(path.join(output,'cases.bin'),Buffer.concat(parts));await fs.writeFile(path.join(output,'cases.json'),JSON.stringify({cases},null,2)+'\n');
}else if(mode==='audit'){
 const {cases}=JSON.parse(await fs.readFile(path.join(output,'cases.json'))),native=(await fs.readFile(path.join(output,'native.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(native.length,cases.length);const bridge=await createVirglStandardShaderBridge(),raw=await createModule(),responses=[];
 function direct(c){const pointers=[];try{for(const text of [c.a,c.b]){const p=raw._malloc(text.length+1);assert.ok(p);pointers.push(p);raw.HEAPU8.set(Buffer.from(text),p);raw.HEAPU8[p+text.length]=0;}
  return JSON.parse(raw.UTF8ToString(c.kind===1?raw._bridge_translate_standard_pair(pointers[0],c.a.length,pointers[1],c.b.length):raw._bridge_translate_standard_pair_typed(c.kind===2?0:pointers[0],c.a.length,c.kind===3?0:pointers[1],c.b.length,c.signedMask,c.unsignedMask)));
 }finally{pointers.reverse().forEach(p=>raw._free(p));}}
 for(const [i,c]of cases.entries()){
  const r=direct(c);assert.deepEqual(r,native[i].result,c.name+' actual native/Wasm');assert.equal(r.ok,c.okay,c.name+' literal admission');
  if(!r.ok){assert.equal(r.error.code,c.code,c.name);assert.deepEqual(Object.keys(r),['ok','error']);}
  else{
   const masks={signedMask:c.kind===1?0:c.signedMask,unsignedMask:c.kind===1?0:c.unsignedMask};
   for(const a of r.vertex.metadata.attributes){const expected=masks.signedMask&2**a.index?'ivec4':masks.unsignedMask&2**a.index?'uvec4':'vec4';assert.equal(a.type,expected,'literal typed metadata');assert.ok(r.vertex.glsl.includes('in '+expected+' in_'+a.index+';'),'actual C typed declaration');}
   assert.equal(normalizeStandardShaderTypedPair(r,masks).ok,true);assert.equal(normalizeStandardShaderPair(r).ok,(masks.signedMask|masks.unsignedMask)===0);
   assert.equal(r.fragment.glsl,native[i].result.fragment.glsl);
  }
  if(c.kind<2){const r2=c.kind===1?bridge.translatePair({vertexText:c.a,fragmentText:c.b}):bridge.translatePairTyped({vertexText:c.a,fragmentText:c.b,signedMask:c.signedMask,unsignedMask:c.unsignedMask});
   if(r.ok)assert.deepEqual(r2,r,'actual owned typed facade');else {assert.equal(r2.ok,false);assert.equal(r2.error.code,r.error.code,'owned facade rejection');}}
  responses.push({case:i,name:c.name,result:r});
 }
 await fs.writeFile(path.join(output,'wasm.jsonl'),responses.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const good={vertexText:vertex(1),fragmentText:fragment,signedMask:2,unsignedMask:0},baseline=bridge.translatePairTyped(good),saved=JSON.stringify(baseline),rejections=[];
 const reject=(label,request)=>{const r=bridge.translatePairTyped(request);assert.equal(r.ok,false,label);assert.deepEqual(Object.keys(r),['ok','error']);rejections.push({label,result:r});};
 for(const request of [null,[],4,Object.create(good),{...good,key:{}},{...good,signedMask:'2'},{...good,unsignedMask:null},{...good,signedMask:NaN},{...good,signedMask:Infinity},{...good,signedMask:-1},{...good,unsignedMask:.5},{...good,signedMask:65536},{...good,unsignedMask:2},{...good,vertexText:new String(good.vertexText)},{...good,vertexText:'\0'},{...good,fragmentText:' '.repeat(STANDARD_LIMITS.textBytes+1)}])reject('strict-'+rejections.length,request);
 let getters=0;reject('accessor',{...good,get signedMask(){getters++;return 2;}});assert.equal(getters,0);
 const symbol={...good,[Symbol('guest-key')]:0};reject('symbol',symbol);reject('throwing-own-keys',new Proxy({}, {ownKeys(){throw Error('trap');}}));reject('throwing-descriptor',new Proxy(good,{getOwnPropertyDescriptor(){throw Error('trap');}}));
 const caller={...good};let changed=false;const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,key){const own=Reflect.getOwnPropertyDescriptor(t,key);if(key==='unsignedMask'&&!changed){changed=true;t.vertexText='\0';t.signedMask=0;}return own;}});
 assert.deepEqual(bridge.translatePairTyped(proxy),baseline,'snapshot owned primitive fields');reject('later-mutated-request',caller);assert.equal(JSON.stringify(baseline),saved);
 const peer=await createVirglStandardShaderBridge();assert.deepEqual(peer.translatePairTyped(good),baseline,'peer memory isolation');
 let runtime;const pressure=[],constrained=await createVirglStandardShaderBridge({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)pressure.push(p);}}});
 const failed=constrained.translatePairTyped(good);assert.equal(failed.error.code,'allocation-failed');assert.deepEqual(Object.keys(failed),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);pressure.reverse().forEach(p=>runtime._free(p));assert.deepEqual(constrained.translatePairTyped(good),baseline,'fixed memory recovery');assert.equal(runtime.HEAPU8.byteLength,16777216);
 const malformed=structuredClone(baseline);malformed.vertex.metadata.attributes[1].type='uvec4';assert.equal(normalizeStandardShaderTypedPair(malformed,{signedMask:2,unsignedMask:0}).ok,false);
 for(const mask of [null,{signedMask:2,unsignedMask:2},{signedMask:2,unsignedMask:0,key:1},{signedMask:65536,unsignedMask:0},{signedMask:4,unsignedMask:0}])assert.equal(normalizeStandardShaderTypedPair(baseline,mask).ok,false);
 const report={status:'passed',cases:cases.length,exactNativeWasm:true,ownedFacade:true,rejections,getters,peerIsolation:true,pressure:{allocations:pressure.length,result:failed,bytes:16777216,recovered:true}};
 await fs.writeFile(path.join(output,'node.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}else throw Error('cases or audit mode required');
