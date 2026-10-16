import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createVirglStandardShaderBridge, STANDARD_LIMITS} from '../../renderer/virgl-shader/standard.mjs';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const matrix=JSON.parse(await fs.readFile(path.join(output,'cases.json'))),native=(await fs.readFile(path.join(output,'native.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const modern=await createVirglStandardShaderBridge(),old=await createVirglShaderBridge();
const responses=[];
for(const [i,c] of matrix.cases.entries()){
 const bridge=c.kind>=3?old:modern,k=c.kind>=3?c.kind-3:c.kind;
 const response=k===2?bridge.translatePair({vertexText:c.a,fragmentText:c.b}):bridge.translate({stage:k===0?'vertex':'fragment',text:c.a});
 responses.push({case:i,name:c.name,result:response});
 assert.equal(response.ok,c.okay,c.name+' literal admission');
 assert.deepEqual(response,native[i].result,c.name+' exact native/Wasm result');
 if(!response.ok){if(c.code)assert.equal(response.error.code,c.code,c.name);assert.deepEqual(Object.keys(response),['ok','error']);}
 if(response.ok&&c.kind<3)for(const stage of k===2?[response.vertex,response.fragment]:[response]){
  assert.equal(stage.metadata.profile,'virgl-webgl2-standard-gles3-v1');assert.equal(stage.metadata.standardSemantics.exactAuthority,false);
  for(const key of ['constantDomains','constantExactPreconditions','preciseWordContract','powerContract','private92cbComplete'])assert.equal(Object.hasOwn(stage.metadata,key),false,c.name+' no old authority '+key);
 }
}
await fs.writeFile(path.join(output,'wasm.jsonl'),responses.map(r=>JSON.stringify(r)).join('\n')+'\n');
const a=matrix.cases[0], stage=a.kind===0?'vertex':'fragment';
const baseline=modern.translate({stage,text:a.a}),saved=JSON.stringify(baseline),rejections=[];
function reject(name,request,pair=false){const r=(pair?modern.translatePair:modern.translate)(request);assert.equal(r.ok,false,name);assert.deepEqual(Object.keys(r),['ok','error']);rejections.push({name,result:r});}
for(const request of [null,3,[],{stage,text:a.a,key:{}},{stage,text:a.a,facts:[]},{stage,text:a.a,components:[]},{stage,text:a.a,geometry:new Uint8Array(1)},{stage:'compute',text:a.a},{stage,text:3},{stage,text:'\0'}])reject('own-fields-'+rejections.length,request);
let getters=0;reject('accessors',{stage,get text(){getters++;return a.a;}});assert.equal(getters,0);
const symbol={stage,text:a.a};symbol[Symbol('authority')]=0;reject('symbol',symbol);
reject('throwing-reflection',new Proxy({}, {ownKeys(){throw new Error('reflection');}}));
reject('pair-primitive',null,true);reject('pair-authority',{vertexText:a.a,fragmentText:a.a,key:{}},true);reject('pair-text-type',{vertexText:1,fragmentText:a.a},true);
reject('pair-oversized',{vertexText:' '.repeat(STANDARD_LIMITS.textBytes+1),fragmentText:a.a},true);
reject('pair-bad-ascii',{vertexText:a.a,fragmentText:'\0'},true);
const caller={stage,text:a.a};let changed=false;
const proxied=new Proxy(caller,{getOwnPropertyDescriptor(target,key){const own=Reflect.getOwnPropertyDescriptor(target,key);if(key==='text'&&!changed){changed=true;target.text='\0';}return own;}});
assert.deepEqual(modern.translate(proxied),baseline,'descriptor primitive snapshot survives later caller mutation');reject('reuse-mutated-caller',caller);
assert.equal(JSON.stringify(baseline),saved,'results do not alias later calls');
const peer=await createVirglStandardShaderBridge();assert.deepEqual(peer.translate({stage,text:a.a}),baseline,'instance isolation');
const pressure=[];let runtime;
const constrained=await createVirglStandardShaderBridge({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)pressure.push(p);}}});
assert.equal(runtime.HEAPU8.buffer.byteLength,16777216);
const failed=constrained.translate({stage,text:a.a});assert.equal(failed.ok,false);assert.equal(failed.error.code,'allocation-failed');
const pairedFailure=constrained.translatePair({vertexText:a.a,fragmentText:a.a});assert.equal(pairedFailure.error.code,'allocation-failed');
for(const p of pressure.reverse())runtime._free(p);
assert.deepEqual(constrained.translate({stage,text:a.a}),baseline,'fixed memory exhaustion recovery');
assert.equal(runtime.HEAPU8.buffer.byteLength,16777216);
const report={status:'passed',cases:responses.length,accepted:responses.filter(r=>r.result.ok).length,rejections,fixedMemory:{bytes:16777216,pressureAllocations:pressure.length,single:failed,pair:pairedFailure,recovered:true},ownership:true,exactNativeWasm:true,standardAuthorityDistinct:true};
await fs.writeFile(path.join(output,'node.json'),JSON.stringify(report,null,2)+'\n');console.log('Standard compiler exact native/Wasm matrix and owned API/OOM recovery passed');
