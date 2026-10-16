import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {textureCompilerCases,selectorKeys} from './cases.mjs';
import {checkOriginalTextureTokens} from './tokens.mjs';
import {oldAbiAudit} from './abi.mjs';
import {normalizeStandardUniformShaderResult,normalizeStandardUniformShaderPair,normalizeStandardShaderResult,normalizeStandardShaderPair} from '../../renderer/virgl-command/constant-domain.mjs';
const [mode,directory]=process.argv.slice(2),dir=path.resolve(directory),root=path.resolve(import.meta.dirname,'../../renderer/virgl-shader');
fs.mkdirSync(dir,{recursive:true});
if(mode==='cases') {
 const readiness=JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname,'../../evidence/virgl-production-readiness/standard-texture-operation-gap.json')));
 const cases=textureCompilerCases(readiness),word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},parts=[word(cases.length)];
 for(const c of cases){const a=Buffer.from(c.a),b=Buffer.from(c.b);parts.push(word(c.kind),...selectorKeys.map(k=>word(c.selectors[k])),word(a.length),a,word(b.length),b);}
 fs.writeFileSync(dir+'/cases.bin',Buffer.concat(parts));fs.writeFileSync(dir+'/cases.json',JSON.stringify({cases},null,2)+'\n');
 console.log(JSON.stringify({cases:cases.length,positive:cases.filter(c=>c.okay).length,negative:cases.filter(c=>!c.okay).length}));
} else if(mode==='audit') {
const {cases}=JSON.parse(fs.readFileSync(dir+'/cases.json'));const native=fs.readFileSync(dir+'/native.jsonl','utf8').trim().split('\n').map(JSON.parse);
assert.equal(native.length,cases.length);
const {default:createModule}=await import(pathToFileURL(root+'/build/wasm/virgl-shader.mjs'));const raw=await createModule();
const {createVirglStandardTextureShaderBridge,createVirglStandardShaderBridge,createVirglStandardUniformShaderBridge}=await import(pathToFileURL(root+'/standard.mjs'));const bridge=await createVirglStandardTextureShaderBridge();
const tokenHeader=fs.readFileSync(root+'/vendor/src/gallium/include/pipe/p_shader_tokens.h','utf8');
const keys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask'];let accepted=0,textures=0,queries=0;const observed=[];
for(const [index,c] of cases.entries()){
 const pointers=[];let result;
 try{
  for(const text of [c.a,c.b]){const p=raw._malloc(Buffer.byteLength(text)+1);assert.ok(p);raw.HEAPU8.set(Buffer.from(text),p);raw.HEAPU8[p+Buffer.byteLength(text)]=0;pointers.push(p);}
  const [a,b]=pointers,m=keys.map(k=>c.selectors[k]);let output;
  if(c.kind<2)output=raw._bridge_translate_standard_texture(c.kind,a,c.a.length);
  else if(c.kind<5)output=raw._bridge_translate_standard_texture_pair(c.kind===3?0:a,c.a.length,c.kind===4?0:b,c.b.length,...m);
  else if(c.kind===5)output=raw._bridge_translate_standard_texture(0,0,c.a.length);
  else if(c.kind===6)output=raw._bridge_translate_standard_texture(-1,a,c.a.length);
  else if(c.kind<9)output=raw._bridge_translate_standard(c.kind-7,a,c.a.length);
  else if(c.kind===9)output=raw._bridge_translate_standard_pair(a,c.a.length,b,c.b.length);
  else if(c.kind===10)output=raw._bridge_translate_standard_pair_typed(a,c.a.length,b,c.b.length,...m.slice(0,2));
  else if(c.kind===11)output=raw._bridge_translate_standard_pair_vertex_formats(a,c.a.length,b,c.b.length,...m.slice(0,4));
  else if(c.kind<14)output=raw._bridge_translate_standard_uniform(c.kind-12,a,c.a.length);
  else output=raw._bridge_translate_standard_uniform_pair(a,c.a.length,b,c.b.length,...m);
  result=JSON.parse(raw.UTF8ToString(output));
 }finally{pointers.reverse().forEach(p=>raw._free(p));}
 assert.deepEqual(result,native[index].result,c.name+' exact C/Wasm');
 assert.equal(result.ok,c.okay,c.name+' admitted/refused');
 if(!result.ok){assert.equal(result.error.code,c.code,c.name);assert.deepEqual(Object.keys(result),['ok','error']);}
 else {
  accepted++;
  const pair=[2,9,10,11,14].includes(c.kind);const stages=pair?['vertex','fragment']:[c.kind===0||c.kind===7||c.kind===12?'vertex':'fragment'];
  for(const [bodyIndex,stage]of stages.entries()){
   const body=pair?result[stage]:result,text=bodyIndex?c.b:c.a;
   if(c.kind<7){
    assert.equal(body.metadata.profile,'virgl-webgl2-standard-texture-gles3-v1');
    assert.equal(normalizeStandardUniformShaderResult({ok:true,glsl:body.glsl,metadata:body.metadata},stage).ok,false);assert.equal(normalizeStandardShaderResult({ok:true,glsl:body.glsl,metadata:body.metadata},stage).ok,false);
    const expected=[...new Set([...text.matchAll(/^\d+: TXQ TEMP\[0\](?:\.([xyzw]+))?,.* SAMP\[(\d+)\], 2D$/gm)].filter(m=>!m[1]||m[1].includes('w')).map(m=>+m[2]))].sort((a,b)=>a-b).map(index=>({index,name:(stage==='vertex'?'vs':'fs')+'samplevels'+index,type:'int',semantic:'TEXTURE_LEVELS'}));
    assert.deepEqual(body.metadata.textureQueries,expected,c.name+' query lanes/original sampler');queries+=expected.length;
   }
   const ops=checkOriginalTextureTokens(text,native[index].originalTokens[bodyIndex],tokenHeader);textures+=ops.length;
  }
 }
 if(c.kind<2){const facade=bridge.translate({stage:c.kind?'fragment':'vertex',text:c.a});assert.equal(facade.ok,result.ok,c.name);if(result.ok)assert.deepEqual(facade,result,c.name+' owned facade');else assert.equal(facade.error.code,result.error.code,c.name);}
 if(c.kind===2){const facade=bridge.translatePairUniforms({vertexText:c.a,fragmentText:c.b,...c.selectors});if(result.ok)assert.deepEqual(facade,result,c.name+' owned paired facade');else {assert.equal(facade.ok,false);assert.equal(facade.error.code,result.error.code,c.name+' paired refusal');}}
 observed.push({name:c.name,result});
}
const historical=await createVirglStandardShaderBridge(),oldUniform=await createVirglStandardUniformShaderBridge();
const zeroSelectors=Object.fromEntries(selectorKeys.map(key=>[key,0]));
  const good=cases.find(c=>c.name==='retained-uniform-grammar/four-formats-zero-3'),request={vertexText:good.a,fragmentText:good.b,...good.selectors},baseline=bridge.translatePairUniforms(request),saved=JSON.stringify(baseline),rejections=[];
  const reject=(label,value)=>{const r=bridge.translatePairUniforms(value);assert.equal(r.ok,false,label);assert.deepEqual(Object.keys(r),['ok','error']);rejections.push({label,result:r});};
  for(const value of [null,[],4,Object.create(request),{...request,key:{}},{...request,vertexText:new String(good.a)},
    {...request,vertexText:'\0'},{...request,fragmentText:' '.repeat(49153)}])reject('strict-'+rejections.length,value);
  for(const key of selectorKeys)for(const value of ['2',null,NaN,Infinity,-1,.5,65536,new Number(2)])reject(key+'-'+String(value),{...request,[key]:value});
  for(const mask of [4,0xffffffff])reject('buffer-zero-'+mask,{...request,bufferZeroMask:mask});
  let getters=0;for(const key of Object.keys(request)) {const value={...request};Object.defineProperty(value,key,{get(){getters++;return request[key];},enumerable:true});reject('accessor-'+key,value);}assert.equal(getters,0);
  reject('symbol',{...request,[Symbol('guest-key')]:0});reject('own-keys-throws',new Proxy({}, {ownKeys(){throw Error('trap');}}));
  reject('descriptor-throws',new Proxy(request,{getOwnPropertyDescriptor(){throw Error('trap');}}));
  const caller={...request};let changed=false;const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,key){const own=Reflect.getOwnPropertyDescriptor(t,key);if(key==='bufferZeroMask'&&!changed){changed=true;t.vertexText='\0';t.bufferZeroMask=4;}return own;}});
  assert.deepEqual(bridge.translatePairUniforms(proxy),baseline);reject('later-mutation',caller);assert.equal(JSON.stringify(baseline),saved);
  assert.equal(Object.hasOwn(historical,'translatePairUniforms'),false);
  for(const method of ['translatePair','translatePairTyped','translatePairVertexFormats'])assert.equal(historical[method](request).ok,false);
  const defaultRequest={vertexText:good.a,fragmentText:good.b},formatRequest={...defaultRequest,...Object.fromEntries(selectorKeys.slice(0,4).map(k=>[k,good.selectors[k]]))};
  assert.deepEqual(bridge.translatePair(defaultRequest),bridge.translatePairUniforms({...defaultRequest,...zeroSelectors}));
  assert.deepEqual(bridge.translatePairTyped({...defaultRequest,signedMask:2,unsignedMask:4}),bridge.translatePairUniforms({...defaultRequest,...zeroSelectors,signedMask:2,unsignedMask:4}));
  assert.deepEqual(bridge.translatePairVertexFormats(formatRequest),bridge.translatePairUniforms({...formatRequest,bufferZeroMask:0}));
  const peer=await createVirglStandardTextureShaderBridge();assert.deepEqual(peer.translatePairUniforms(request),baseline);
const all=cases.find(c=>c.name==='retained-uniform-grammar/all-banks-zero-3');
  let runtime;const pressure=[],constrained=await createVirglStandardTextureShaderBridge({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)pressure.push(p);}}});
  const failed=constrained.translatePairUniforms(request);assert.equal(failed.error.code,'allocation-failed');assert.deepEqual(Object.keys(failed),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);
  runtime._free(pressure.shift());const scratchFailure=constrained.translatePairUniforms({vertexText:all.a,fragmentText:all.b,...all.selectors});
  assert.equal(scratchFailure.ok,false);assert.equal(scratchFailure.error.code,'translation-error');assert.equal(scratchFailure.error.message,'Checked upstream TGSI parsing failed.');
  assert.deepEqual(Object.keys(scratchFailure),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);
  pressure.reverse().forEach(p=>runtime._free(p));assert.deepEqual(constrained.translatePairUniforms(request),baseline);assert.equal(runtime.HEAPU8.byteLength,16777216);
const retained=await oldAbiAudit(dir,cases,raw);
fs.writeFileSync(dir+'/facade.json',JSON.stringify({status:'passed',rejections,getters,ownedSnapshots:true,peerIsolation:true,pressure:{allocations:pressure.length+1,result:failed,scratchFailure,bytes:16777216,recovered:true},historical:retained},null,2)+'\n');
assert.equal(raw.HEAPU8.byteLength,16777216);
fs.writeFileSync(dir+'/wasm.jsonl',observed.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(dir+'/audit.json',JSON.stringify({status:"passed",productionNegotiation:false,cases:cases.length,accepted,rejected:cases.length-accepted,originalTextureInstructions:textures,queryBindings:queries,exactNativeWasm:true,fixedMemoryBytes:raw.HEAPU8.byteLength,nativeGpu:false},null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,accepted,rejected:cases.length-accepted,originalTextureInstructions:textures,queryBindings:queries,fixedMemoryBytes:raw.HEAPU8.byteLength}));
} else throw Error('cases or audit mode required');
