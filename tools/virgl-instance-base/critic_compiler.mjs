import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as factories from '../../renderer/virgl-shader/standard.mjs';
const root=path.resolve(import.meta.dirname,'../..'),output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const held=path.join(root,'target/evidence/virgl-instance-base-critic/worker-reopened/hot');
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const name of ['virgl-shader.mjs','virgl-shader.wasm'])assert.equal(hash(fs.readFileSync(root+'/renderer/virgl-shader/build/wasm/'+name)),hash(fs.readFileSync(root+'/target/evidence/virgl-instance-base-critic/worker-reopened/hot-generated/renderer/virgl-shader/build/wasm/'+name)));
const {default:make}=await import('../../renderer/virgl-shader/build/wasm/virgl-shader.mjs');
const {default:makeOld}=await import(pathToFileURL(root+'/target/evidence/virgl-instance-base-critic/actual-old/virgl-shader.mjs'));
const raw=await make(),old=await makeOld();
const keys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask','signedColorMask','unsignedColorMask'];
function direct(module,c){
 const ptr=[];
 try{
  for(const text of [c.a,c.b]){const p=module._malloc(text.length+1);assert.ok(p);ptr.push(p);module.HEAPU8.set(Buffer.from(text),p);module.HEAPU8[p+text.length]=0;}
  const [a,b]=ptr,s=keys.map(k=>c.selectors[k]),stage=(entry,n,zero=false)=>module[entry](n,zero?0:a,c.a.length),pair=(entry,m,an=a,bn=b)=>module[entry](an,c.a.length,bn,c.b.length,...m);let p;
  switch(c.kind){
   case 0:case 1:p=stage('_bridge_translate_standard_texture',c.kind);break;
   case 2:case 3:case 4:p=pair('_bridge_translate_standard_texture_pair',s.slice(0,5),c.kind===3?0:a,c.kind===4?0:b);break;
   case 5:case 6:p=stage('_bridge_translate_standard_texture',c.kind===6?-1:0,c.kind===5);break;
   case 7:case 8:p=stage('_bridge_translate_standard',c.kind-7);break;
   case 9:p=pair('_bridge_translate_standard_pair',[]);break;
   case 10:p=pair('_bridge_translate_standard_pair_typed',s.slice(0,2));break;
   case 11:p=pair('_bridge_translate_standard_pair_vertex_formats',s.slice(0,4));break;
   case 12:case 13:p=stage('_bridge_translate_standard_uniform',c.kind-12);break;
   case 14:p=pair('_bridge_translate_standard_uniform_pair',s.slice(0,5));break;
   case 15:case 16:case 20:case 21:case 22:case 23:case 27:case 28:{const selected=c.kind>=22,k=selected?c.kind-7:c.kind;p=module[selected?'_bridge_translate_standard_instance_base':'_bridge_translate_standard_integer_image'](k===21?-1:k===20?0:k-15,k===20?0:a,c.a.length,s[5],s[6]);break;}
   case 17:case 18:case 19:case 24:case 25:case 26:{const selected=c.kind>=24,k=selected?c.kind-7:c.kind;p=pair(selected?'_bridge_translate_standard_instance_base_pair':'_bridge_translate_standard_integer_image_pair',s,k===18?0:a,k===19?0:b);break;}
   default:throw Error('unknown actual ABI case '+c.kind);
  }
  return module.UTF8ToString(p);
 }finally{for(const p of ptr.reverse())module._free(p);}
}
const cases=JSON.parse(fs.readFileSync(held+'/native/cases.json')).cases,nativeLines=fs.readFileSync(held+'/native/native.jsonl','utf8').trim().split('\n'),decoder=new TextDecoder();
const observations=[];
for(const [i,c]of cases.entries()){
 const actual=direct(raw,c),prefix='{"case":'+i+',"result":';assert.ok(nativeLines[i].startsWith(prefix));
 const suffix=nativeLines[i].indexOf(',"originalTokens":',prefix.length);assert.equal(actual,nativeLines[i].slice(prefix.length,suffix),'whole native/Wasm response bytes '+c.name);
 const historical=c.kind<22?direct(old,c):null;if(historical!==null)assert.equal(actual,historical,'actual predecessor response bytes '+c.name);
 observations.push({case:i,name:c.name,response:actual,historicalResponse:historical});
}
fs.writeFileSync(output+'/responses.jsonl',observations.map(r=>JSON.stringify(r)).join('\n')+'\n');
const vertex='VERT\nDCL IN[0]\nDCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], SV[0]\n2: MOV OUT[1].y, SV[1].xxxx\n3: END\n';
const fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const all={stage:'vertex',text:vertex,vertexText:vertex,fragmentText:fragment,...Object.fromEntries(keys.map(k=>[k,0]))};
const methods={translate:['stage','text'],translateImages:['stage','text',...keys.slice(5)],translatePair:['vertexText','fragmentText'],translatePairTyped:['vertexText','fragmentText',...keys.slice(0,2)],translatePairVertexFormats:['vertexText','fragmentText',...keys.slice(0,4)],translatePairUniforms:['vertexText','fragmentText',...keys.slice(0,5)],translatePairImages:['vertexText','fragmentText',...keys]};
const modules=[],bridges=[];for(let i=0;i<3;i++)bridges.push(await factories.createVirglStandardInstanceBaseShaderBridge({onRuntimeInitialized(){modules.push(this);}}));
assert.equal(modules.length,3);for(const m of [raw,old,...modules])assert.equal(m.HEAPU8.byteLength,16777216);assert.equal(new Set([raw,old,...modules].map(m=>m.HEAPU8.buffer)).size,5);
const records=[];let getters=0;
function refuse(bridge,method,label,request){const r=bridge[method](request);assert.equal(r.ok,false,label);assert.deepEqual(Object.keys(r),['ok','error']);records.push({method,label,result:r});}
for(const [method,names]of Object.entries(methods)){
 const input=Object.fromEntries(names.map(k=>[k,all[k]])),baseline=bridges[0][method](input),saved=JSON.stringify(baseline);assert.equal(baseline.ok,true,method);
 for(const key of names){const request={...input};Object.defineProperty(request,key,{get(){getters++;throw Error('must not invoke getter');},enumerable:true});refuse(bridges[0],method,'getter/'+key,request);}
 for(const request of [null,[],Object.create(input),{...input,instanceBase:1},{...input,wv_instance_base:1},{...input,[Symbol('offset')]:1},new Proxy(input,{ownKeys(){throw Error('ownKeys');}}),new Proxy(input,{getOwnPropertyDescriptor(){throw Error('descriptor');}})])refuse(bridges[0],method,'strict/'+records.length,request);
 const mutable={...input};let mutation=false;const later=names.at(-1),textKey=names.includes('text')?'text':'vertexText';
 const proxy=new Proxy(mutable,{getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(k===later){mutation=true;t[textKey]='\0';}return d;}});
 assert.deepEqual(bridges[0][method](proxy),baseline,method+' all data captured before later mutation');assert.ok(mutation);refuse(bridges[0],method,'subsequent-mutation',mutable);assert.equal(JSON.stringify(baseline),saved);
 for(const bridge of bridges)assert.deepEqual(bridge[method](input),baseline);
}
assert.equal(getters,0);
const schedules=[];
for(const initial of [0x32a913f7,0x96d1c02b,0xd009c68f]){
 let seed=initial>>>0;const calls=[];
 for(let i=0;i<48;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const peer=seed%3,method=Object.keys(methods)[(seed>>>8)%7],names=methods[method],input=Object.fromEntries(names.map(k=>[k,all[k]])),r=bridges[peer][method](input);assert.equal(r.ok,true);calls.push({peer,method,response:r});}
 schedules.push({seed:initial,calls});
}
const pressure=[];for(const size of [65536,1024,1]){let p;while((p=modules[1]._malloc(size)))pressure.push(p);}
const input=Object.fromEntries(methods.translatePairImages.map(k=>[k,all[k]])),before=bridges[0].translatePairImages(input),failure=bridges[1].translatePairImages(input);assert.equal(failure.ok,false);assert.equal(failure.error.code,'allocation-failed');assert.deepEqual(bridges[0].translatePairImages(input),before);assert.deepEqual(bridges[2].translatePairImages(input),before);
for(const p of pressure.reverse())modules[1]._free(p);assert.deepEqual(bridges[1].translatePairImages(input),before);assert.equal(modules[1].HEAPU8.byteLength,16777216);
const result={status:'passed',cases:observations.length,historical:observations.filter(r=>r.historicalResponse!==null).length,strictRefusals:records,getters,schedules,distinctFixedMemories:5,pressure:{allocations:pressure.length,failure,recovered:bridges[1].translatePairImages(input)}};
fs.writeFileSync(output+'/strict-and-memory.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'passed',cases:result.cases,historical:result.historical,strictRefusals:records.length,getters,distinctFixedMemories:5,schedules:schedules.length}));
