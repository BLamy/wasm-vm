#!/usr/bin/env node
// Public actual C/Wasm calls. Literal masks are independent of renderer tables.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createVirglStandardShaderBridge,STANDARD_LIMITS} from '../../renderer/virgl-shader/standard.mjs';
import {normalizeStandardShaderTypedPair} from '../../renderer/virgl-command/constant-domain.mjs';
import createModule from '../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
const [mode,name]=process.argv.slice(2),output=path.resolve(name);await fs.mkdir(output,{recursive:true});
const fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const vertex=(index,extra=false)=>'VERT\nDCL IN[0]\n'+(index?'DCL IN['+index+']\n':'')+(extra?'DCL IN[2]\n':'')+'DCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN['+index+']\n2: END\n';
const keys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask'];
if(mode==='cases'){
 const cases=[],add=(name,masks,a=vertex(1),kind=0,okay=true,code=null,b=fragment)=>cases.push({name,kind,...Object.fromEntries(keys.map((k,i)=>[k,masks[i]])),a,b,okay,code});
 for(let i=0;i<16;i++)for(const normalized of [false,true])add('packed-slot-'+i+'-'+normalized,[0,0,2**i,normalized?2**i:0],vertex(i));
 add('signed-and-packed',[2,0,4,4],vertex(1,true));add('unsigned-and-packed',[0,2,4,0],vertex(1,true));
 add('two-packed-scaled',[0,0,6,0],vertex(1,true));add('two-packed-normalized',[0,0,6,6],vertex(1,true));
 add('mixed-packed-normalization',[0,0,6,2],vertex(1,true));add('mixed-packed-normalization-opposite',[0,0,6,4],vertex(1,true));
 add('old-float-pair',[2,2,65536,65536],vertex(1),1);add('old-typed-pair',[2,0,2,2],vertex(1),4);add('new-float',[0,0,0,0]);
 for(const m of [[2,2,0,0],[2,0,2,0],[0,2,2,2],[0,0,0,2],[0,0,2,4],[0,0,4,0],[0,0,32768,32768],
  [65536,0,0,0],[0,65536,0,0],[0,0,65536,0],[0,0,0,65536],[0,0,0xffffffff,0],[0,0,2,0xffffffff]])add('invalid-mask-'+m.join('-'),m,vertex(1),0,false,'invalid-input');
 add('null-vertex',[0,0,2,0],vertex(1),2,false,'invalid-input');add('null-fragment',[0,0,2,2],vertex(1),3,false,'invalid-input');
 add('bad-vertex',[0,0,2,0],'\0',0,false,'invalid-input');add('oversized-vertex',[0,0,2,2],' '.repeat(STANDARD_LIMITS.textBytes+1),0,false,'input-too-large');
 add('bad-fragment',[0,0,2,0],vertex(1),0,false,'invalid-input','\0');
 const word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},parts=[word(cases.length)];
 for(const c of cases){const a=Buffer.from(c.a),b=Buffer.from(c.b);parts.push(word(c.kind),...keys.map(k=>word(c[k])),word(a.length),a,word(b.length),b);}
 await fs.writeFile(path.join(output,'cases.bin'),Buffer.concat(parts));await fs.writeFile(path.join(output,'cases.json'),JSON.stringify({cases},null,2)+'\n');
}else if(mode==='audit'){
 const {cases}=JSON.parse(await fs.readFile(path.join(output,'cases.json'))),native=(await fs.readFile(path.join(output,'native.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(native.length,cases.length);const bridge=await createVirglStandardShaderBridge(),raw=await createModule(),responses=[];
 function direct(c){const p=[];try{for(const text of [c.a,c.b]){const address=raw._malloc(text.length+1);assert.ok(address);p.push(address);raw.HEAPU8.set(Buffer.from(text),address);raw.HEAPU8[address+text.length]=0;}
  const address=c.kind===1?raw._bridge_translate_standard_pair(p[0],c.a.length,p[1],c.b.length):
   c.kind===4?raw._bridge_translate_standard_pair_typed(p[0],c.a.length,p[1],c.b.length,c.signedMask,c.unsignedMask):
   raw._bridge_translate_standard_pair_vertex_formats(c.kind===2?0:p[0],c.a.length,c.kind===3?0:p[1],c.b.length,...keys.map(k=>c[k]));
  return JSON.parse(raw.UTF8ToString(address));
 }finally{p.reverse().forEach(address=>raw._free(address));}}
 for(const [i,c]of cases.entries()){
  const r=direct(c);assert.deepEqual(r,native[i].result,c.name+' actual native/Wasm');assert.equal(r.ok,c.okay,c.name+' literal admission');
  if(!r.ok){assert.equal(r.error.code,c.code,c.name);assert.deepEqual(Object.keys(r),['ok','error']);}
  else{
   const masks={signedMask:c.kind===1?0:c.signedMask,unsignedMask:c.kind===1?0:c.unsignedMask},packed=c.kind===1||c.kind===4?0:c.packedSignedMask;
   for(const a of r.vertex.metadata.attributes){const type=masks.signedMask&2**a.index?'ivec4':masks.unsignedMask&2**a.index?'uvec4':'vec4';assert.equal(a.type,type);assert.ok(r.vertex.glsl.includes('in '+type+' in_'+a.index+';'));
    assert.equal(r.vertex.glsl.includes('vec4 wv_pack_'+a.index+'(vec4 v)'),Boolean(packed&2**a.index),'only selected original packed slots');
   }
   assert.equal(normalizeStandardShaderTypedPair(r,masks).ok,true);assert.ok(!r.fragment.glsl.includes('wv_pack_'),'vertex-only specialization');
  }
  if(c.kind===0||c.kind===1||c.kind===4){const request={vertexText:c.a,fragmentText:c.b},r2=c.kind===1?bridge.translatePair(request):c.kind===4?bridge.translatePairTyped({...request,signedMask:c.signedMask,unsignedMask:c.unsignedMask}):bridge.translatePairVertexFormats({...request,...Object.fromEntries(keys.map(k=>[k,c[k]]))});
   if(r.ok)assert.deepEqual(r2,r,'actual owned format facade');else {assert.equal(r2.ok,false);assert.equal(r2.error.code,r.error.code);}}
  responses.push({case:i,name:c.name,result:r});
 }
 await fs.writeFile(path.join(output,'wasm.jsonl'),responses.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const good={vertexText:vertex(1),fragmentText:fragment,signedMask:0,unsignedMask:0,packedSignedMask:2,packedNormalizedMask:2},baseline=bridge.translatePairVertexFormats(good),saved=JSON.stringify(baseline),rejections=[];
 const reject=(label,request)=>{const r=bridge.translatePairVertexFormats(request);assert.equal(r.ok,false,label);assert.deepEqual(Object.keys(r),['ok','error']);rejections.push({label,result:r});};
 for(const request of [null,[],4,Object.create(good),{...good,key:{}},{...good,vertexText:new String(good.vertexText)},{...good,vertexText:'\0'},{...good,fragmentText:' '.repeat(STANDARD_LIMITS.textBytes+1)},
  {vertexText:good.vertexText,fragmentText:good.fragmentText,signedMask:0,unsignedMask:0},{...good,signedMask:2},{...good,unsignedMask:2},{...good,packedNormalizedMask:4}])reject('strict-'+rejections.length,request);
 for(const key of keys)for(const value of ['2',null,NaN,Infinity,-1,.5,65536,new Number(2)])reject(key+'-'+String(value),{...good,[key]:value});
 let getters=0;for(const key of ['vertexText','fragmentText',...keys]){const accessor={...good};Object.defineProperty(accessor,key,{get(){getters++;return good[key];},enumerable:true});reject('accessor-'+key,accessor);}assert.equal(getters,0);
 reject('symbol',{...good,[Symbol('guest-key')]:0});reject('throwing-own-keys',new Proxy({}, {ownKeys(){throw Error('trap');}}));reject('throwing-descriptor',new Proxy(good,{getOwnPropertyDescriptor(){throw Error('trap');}}));
 const caller={...good};let changed=false;const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,key){const own=Reflect.getOwnPropertyDescriptor(t,key);if(key==='packedNormalizedMask'&&!changed){changed=true;t.vertexText='\0';t.packedSignedMask=0;}return own;}});
 assert.deepEqual(bridge.translatePairVertexFormats(proxy),baseline,'snapshot owned primitive fields');reject('later-mutated-request',caller);assert.equal(JSON.stringify(baseline),saved);
 assert.equal(bridge.translatePairTyped(good).ok,false,'new masks never widen old strict facade');assert.equal(bridge.translatePair(good).ok,false);
 const peer=await createVirglStandardShaderBridge();assert.deepEqual(peer.translatePairVertexFormats(good),baseline,'peer memory isolation');
 let runtime;const pressure=[],constrained=await createVirglStandardShaderBridge({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)pressure.push(p);}}});
 const failed=constrained.translatePairVertexFormats(good);assert.equal(failed.error.code,'allocation-failed');assert.deepEqual(Object.keys(failed),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);pressure.reverse().forEach(p=>runtime._free(p));assert.deepEqual(constrained.translatePairVertexFormats(good),baseline);assert.equal(runtime.HEAPU8.byteLength,16777216);
 const report={status:'passed',cases:cases.length,exactNativeWasm:true,ownedFacade:true,rejections,getters,peerIsolation:true,pressure:{allocations:pressure.length,result:failed,bytes:16777216,recovered:true}};
 await fs.writeFile(path.join(output,'node.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:cases.length,rejections:rejections.length,peerIsolation:true,fixedMemoryRecovery:true}));
}else throw Error('cases or audit mode required');
