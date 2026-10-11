import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {compilerCases} from './cases.mjs';
import {selectorKeys} from './fixtures.mjs';
import {checkOriginalTextureTokens,enumValues} from '../virgl-standard-texture/tokens.mjs';
import {direct as oldDirect} from '../virgl-standard-texture/abi.mjs';
const [mode,directory]=process.argv.slice(2),dir=path.resolve(directory),root=path.resolve(import.meta.dirname,'../../renderer/virgl-shader');
fs.mkdirSync(dir,{recursive:true});
export function direct(module,c){
 if(c.kind<15)return oldDirect(module,c);
 const pointers=[];
 try{
  for(const text of [c.a,c.b]){const p=module._malloc(text.length+1);assert.ok(p);module.HEAPU8.set(Buffer.from(text),p);module.HEAPU8[p+text.length]=0;pointers.push(p);}
  const [a,b]=pointers,m=selectorKeys.map(k=>c.selectors[k]);let output;
  if(c.kind<17)output=module._bridge_translate_standard_integer_image(c.kind-15,a,c.a.length,m[5],m[6]);
  else if(c.kind<20)output=module._bridge_translate_standard_integer_image_pair(c.kind===18?0:a,c.a.length,c.kind===19?0:b,c.b.length,...m);
  else output=module._bridge_translate_standard_integer_image(c.kind===21?-1:0,c.kind===20?0:a,c.a.length,m[5],m[6]);
  return module.UTF8ToString(output);
 }finally{pointers.reverse().forEach(p=>module._free(p));}
}
if(mode==='cases'){
 const cases=compilerCases(),word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},parts=[word(cases.length)];
 for(const c of cases){const a=Buffer.from(c.a),b=Buffer.from(c.b);parts.push(word(c.kind),...selectorKeys.map(k=>word(c.selectors[k])),word(a.length),a,word(b.length),b);}
 fs.writeFileSync(dir+'/cases.bin',Buffer.concat(parts));fs.writeFileSync(dir+'/cases.json',JSON.stringify({cases},null,2)+'\n');
 console.log(JSON.stringify({cases:cases.length,positive:cases.filter(c=>c.okay).length,negative:cases.filter(c=>!c.okay).length}));
}else if(mode==='audit'){
 const {cases}=JSON.parse(fs.readFileSync(dir+'/cases.json')),native=fs.readFileSync(dir+'/native.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.equal(native.length,cases.length);
 const {default:createModule}=await import(pathToFileURL(root+'/build/wasm/virgl-shader.mjs')),raw=await createModule();
 const {createVirglStandardIntegerImageShaderBridge,createVirglStandardTextureShaderBridge,createVirglStandardShaderBridge,createVirglStandardUniformShaderBridge}=await import(pathToFileURL(root+'/standard.mjs'));
 const bridge=await createVirglStandardIntegerImageShaderBridge();
 const header=fs.readFileSync(root+'/vendor/src/gallium/include/pipe/p_shader_tokens.h','utf8'),types=enumValues(header,'tgsi_return_type'),targets=enumValues(header,'tgsi_texture_type');
 const observed=[];let accepted=0,textures=0,views=0;
 for(const [index,c]of cases.entries()){
  const result=JSON.parse(direct(raw,c));assert.deepEqual(result,native[index].result,c.name+' native/sanitized/Wasm response');assert.equal(result.ok,c.okay,c.name+' admission');
  if(!result.ok){assert.equal(result.error.code,c.code,c.name);assert.deepEqual(Object.keys(result),['ok','error']);}
  else{
   accepted++;const paired=[2,9,10,11,14,17].includes(c.kind),stages=paired?['vertex','fragment']:[c.kind===0||c.kind===7||c.kind===12||c.kind===15?'vertex':'fragment'];
   for(const [i,stage]of stages.entries()){
    const body=paired?result[stage]:result,text=i?c.b:c.a,record=native[index].originalTokens[i];
    textures+=checkOriginalTextureTokens(text,record,header).length;
    const wanted=[...text.matchAll(/^DCL SVIEW\[(\d+)(?:\.\.(\d+))?\], 2D, ([A-Z]+)(?:, [A-Z]+)*$/gm)].map(m=>({first:+m[1],last:+(m[2]??m[1]),target:targets.TGSI_TEXTURE_2D,returnTypes:Array(4).fill(types['TGSI_RETURN_TYPE_'+m[3]])}));
    assert.deepEqual(record.samplerViews,wanted,c.name+' original four parser return fields');views+=wanted.length;
    if(c.kind>=15){
     assert.equal(body.metadata.profile,'virgl-webgl2-standard-integer-image-gles3-v1');
     assert.deepEqual(body.metadata.colorOutputMasks,{signedMask:stage==='fragment'?c.selectors.signedColorMask:0,unsignedMask:stage==='fragment'?c.selectors.unsignedColorMask:0});
     const declarations=new Map();for(const m of text.matchAll(/^DCL SVIEW\[(\d+)(?:\.\.(\d+))?\], 2D, (FLOAT|SINT|UINT)/gm))for(let j=+m[1];j<=+(m[2]??m[1]);j++)declarations.set(j,m[3]);
     const used=[...new Set([...text.matchAll(/^\d+: (?:TEX|TXL|TXF|TXD|TXB|TXQ)(?:_SAT)?(?:_PRECISE)? .* SAMP\[(\d+)\], 2D$/gm)].map(m=>+m[1]))].sort((a,b)=>a-b);
     assert.deepEqual(body.metadata.samplers,used.map(index=>({index,name:(stage==='vertex'?'vs':'fs')+'samp'+index,type:{FLOAT:'sampler2D',SINT:'isampler2D',UINT:'usampler2D'}[declarations.get(index)]})),c.name+' owned original sampler types');
     for(const output of body.metadata.outputs.filter(o=>o.semantic==='COLOR')){
      const bit=1<<output.semanticIndex,type=c.selectors.signedColorMask&bit?'ivec4':c.selectors.unsignedColorMask&bit?'uvec4':'vec4';assert.equal(output.type,type,c.name+' COLOR semantic type');assert.ok(body.glsl.includes(`layout(location=${output.semanticIndex}) out ${type} fsout_c${output.semanticIndex};`));
     }
    }
   }
  }
  if(c.kind===15||c.kind===16){const facade=bridge.translateImages({stage:c.kind===15?'vertex':'fragment',text:c.a,signedColorMask:c.selectors.signedColorMask,unsignedColorMask:c.selectors.unsignedColorMask});assert.equal(facade.ok,result.ok,c.name);if(result.ok)assert.deepEqual(facade,result);else assert.equal(facade.error.code,result.error.code);}
  if(c.kind===17){const facade=bridge.translatePairImages({vertexText:c.a,fragmentText:c.b,...c.selectors});assert.equal(facade.ok,result.ok,c.name);if(result.ok)assert.deepEqual(facade,result);else assert.equal(facade.error.code,result.error.code);}
  observed.push({name:c.name,result});
 }
 const auth=JSON.parse(fs.readFileSync(dir+'/predecessor/authentication.json'));assert.equal(auth.status,'passed');
 const {default:createOld}=await import(pathToFileURL(dir+'/predecessor/virgl-shader.mjs')),old=await createOld(),historical=[];
 for(const c of cases.filter(c=>c.kind<15)){const before=oldDirect(old,c),after=oldDirect(raw,c);assert.equal(after,before,c.name+' entire historical response bytes');historical.push({name:c.name,originalResponse:before,currentResponse:after});}
 fs.writeFileSync(dir+'/historical-abi.jsonl',historical.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const selectedFloat=[];for(const c of cases.filter(c=>c.name.endsWith('/selected')&&c.okay)){
  const current=JSON.parse(direct(raw,c)),prior=JSON.parse(oldDirect(old,{...c,kind:c.kind===15?0:1}));assert.equal(current.glsl,prior.glsl,c.name+' selected FLOAT native source unchanged');selectedFloat.push({name:c.name,original:prior,current});
 }
 fs.writeFileSync(dir+'/selected-float.json',JSON.stringify({status:'passed',records:selectedFloat},null,2)+'\n');
 const good=cases.find(c=>c.name.startsWith('hardware/')&&c.a.includes('SVIEW')&&c.b.includes('CONSTANT')),request={vertexText:good.a,fragmentText:good.b,...good.selectors},baseline=bridge.translatePairImages(request),saved=JSON.stringify(baseline),rejections=[];assert.equal(baseline.ok,true);
 const reject=(method,label,value)=>{const result=bridge[method](value);assert.equal(result.ok,false,label);assert.deepEqual(Object.keys(result),['ok','error']);rejections.push({method,label,result});};
 for(const value of [null,[],4,Object.create(request),{...request,key:{}},{...request,vertexText:new String(good.a)},{...request,fragmentText:'\0'},{...request,vertexText:' '.repeat(49153)}])reject('translatePairImages','strict-'+rejections.length,value);
 for(const key of selectorKeys)for(const value of ['1',null,NaN,Infinity,-1,.5,65536,new Number(1)])reject('translatePairImages',key+'-'+String(value),{...request,[key]:value});
 for(const key of ['signedColorMask','unsignedColorMask'])for(const value of [16,0xffffffff])reject('translatePairImages',key+'-extent',{...request,[key]:value});
 for(const value of [4,0xffffffff])reject('translatePairImages','buffer-zero-extent',{...request,bufferZeroMask:value});
 let getters=0;for(const key of Object.keys(request)){const value={...request};Object.defineProperty(value,key,{get(){getters++;return request[key];},enumerable:true});reject('translatePairImages','accessor-'+key,value);}assert.equal(getters,0);
 reject('translatePairImages','symbol',{...request,[Symbol('guest-key')]:0});reject('translatePairImages','ownkeys-trap',new Proxy({}, {ownKeys(){throw Error('trap');}}));reject('translatePairImages','descriptor-trap',new Proxy(request,{getOwnPropertyDescriptor(){throw Error('trap');}}));
 const caller={...request};let mutated=false;const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,key){const own=Reflect.getOwnPropertyDescriptor(t,key);if(key==='unsignedColorMask'&&!mutated){mutated=true;t.vertexText='\0';t.unsignedColorMask=16;}return own;}});assert.deepEqual(bridge.translatePairImages(proxy),baseline);reject('translatePairImages','later-mutation',caller);assert.equal(JSON.stringify(baseline),saved);
 const stage={stage:'fragment',text:good.b,signedColorMask:0,unsignedColorMask:1},stageBase=bridge.translateImages(stage);assert.equal(stageBase.ok,true);
 for(const value of [null,[],Object.create(stage),{...stage,guestKey:{}},{...stage,text:new String(good.b)},{...stage,text:'\0'},{...stage,text:' '.repeat(49153)},{...stage,stage:'compute'},{...stage,stage:'vertex',signedColorMask:1},{...stage,signedColorMask:1,unsignedColorMask:1}])reject('translateImages','stage-'+rejections.length,value);
 for(const key of ['signedColorMask','unsignedColorMask'])for(const value of ['1',null,NaN,Infinity,-1,.5,16,new Number(1)])reject('translateImages',key+'-strict',{...stage,[key]:value});
 for(const key of Object.keys(stage)){const value={...stage};Object.defineProperty(value,key,{get(){getters++;return stage[key];},enumerable:true});reject('translateImages','stage-accessor-'+key,value);}assert.equal(getters,0);
 reject('translateImages','stage-ownkeys-trap',new Proxy({}, {ownKeys(){throw Error('trap');}}));reject('translateImages','stage-descriptor-trap',new Proxy(stage,{getOwnPropertyDescriptor(){throw Error('trap');}}));
 for(const factory of [createVirglStandardShaderBridge,createVirglStandardUniformShaderBridge,createVirglStandardTextureShaderBridge]){const prior=await factory();assert.equal(Object.hasOwn(prior,'translateImages'),false);assert.equal(Object.hasOwn(prior,'translatePairImages'),false);assert.equal(prior.translate({stage:'vertex',text:'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n'}).ok,true);}
 const peer=await createVirglStandardIntegerImageShaderBridge();assert.deepEqual(peer.translatePairImages(request),baseline);
 const zeroColors={...request,signedColorMask:0,unsignedColorMask:0},uniformRequest={...zeroColors};delete uniformRequest.signedColorMask;delete uniformRequest.unsignedColorMask;
 assert.deepEqual(bridge.translatePairUniforms(uniformRequest),bridge.translatePairImages(zeroColors));
 for(const method of ['translatePair','translatePairTyped','translatePairVertexFormats']){const keys=method==='translatePair'?[]:method==='translatePairTyped'?selectorKeys.slice(0,2):selectorKeys.slice(0,4),value={vertexText:good.a,fragmentText:good.b,...Object.fromEntries(keys.map(k=>[k,0]))};assert.deepEqual(bridge[method](value),bridge.translatePairImages({...zeroColors,bufferZeroMask:0}));}
 assert.deepEqual(bridge.translate({stage:'fragment',text:good.b}),bridge.translateImages({...stage,signedColorMask:0,unsignedColorMask:0}));
 assert.deepEqual(bridge.translate({stage:'vertex',text:good.a}),bridge.translateImages({stage:'vertex',text:good.a,signedColorMask:0,unsignedColorMask:0}));
 let runtime;const pressure=[],constrained=await createVirglStandardIntegerImageShaderBridge({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)pressure.push(p);}}});
 const failed=constrained.translatePairImages(request);assert.equal(failed.error.code,'allocation-failed');assert.deepEqual(Object.keys(failed),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);
 runtime._free(pressure.shift());const scratchFailure=constrained.translatePairImages(request);assert.equal(scratchFailure.ok,false);assert.equal(scratchFailure.error.code,'translation-error');assert.equal(scratchFailure.error.message,'Checked upstream TGSI parsing failed.');pressure.reverse().forEach(p=>runtime._free(p));assert.deepEqual(constrained.translatePairImages(request),baseline);assert.equal(runtime.HEAPU8.byteLength,16777216);
 assert.equal(raw.HEAPU8.byteLength,16777216);assert.equal(old.HEAPU8.byteLength,16777216);
 fs.writeFileSync(dir+'/facade.json',JSON.stringify({status:'passed',rejections,getters,ownedSnapshots:true,peerIsolation:true,pressure:{result:failed,scratchFailure,bytes:16777216,recovered:true},historical:{cases:historical.length,allResponseBytesIdentical:true,predecessor:auth.predecessor}},null,2)+'\n');
 fs.writeFileSync(dir+'/wasm.jsonl',observed.map(r=>JSON.stringify(r)).join('\n')+'\n');
 fs.writeFileSync(dir+'/audit.json',JSON.stringify({status:'passed',cases:cases.length,accepted,rejected:cases.length-accepted,originalTextureInstructions:textures,samplerDeclarations:views,exactNativeWasm:true,fixedMemoryBytes:raw.HEAPU8.byteLength,productionNegotiation:false,guestExecution:false},null,2)+'\n');
 const retained=path.resolve(dir,'../retained-texture/native');fs.mkdirSync(retained,{recursive:true});
 const oldCases=cases.filter(c=>c.name.startsWith('old/')).map(c=>({...c,name:c.name.slice(4),selectors:Object.fromEntries(selectorKeys.slice(0,5).map(k=>[k,c.selectors[k]]))}));
 fs.writeFileSync(retained+'/cases.json',JSON.stringify({cases:oldCases},null,2)+'\n');fs.writeFileSync(retained+'/native.jsonl',native.filter((_,i)=>cases[i].name.startsWith('old/')).map(r=>JSON.stringify(r)).join('\n')+'\n');
 console.log(JSON.stringify({cases:cases.length,accepted,rejected:cases.length-accepted,originalTextureInstructions:textures,samplerDeclarations:views,historical:historical.length}));
}else throw Error('cases or audit required');
