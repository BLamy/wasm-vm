import fs from 'node:fs/promises';
import path from 'node:path';
import {cases} from './cases.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const action=process.argv[2],out=path.resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});
if(action==='cases'){
 const rows=cases(),buffers=[],number=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;},string=s=>{const b=Buffer.from(s);return Buffer.concat([number(b.length),b]);};
 buffers.push(number(rows.length));for(const r of rows)buffers.push(number(r.kind),number(r.capture),number(r.words.length),number(r.nullWords?1:0),...Object.values(r.selectors).map(number),string(r.a),string(r.b),...r.words.map(number));
 await fs.writeFile(path.join(out,'cases.bin'),Buffer.concat(buffers));await fs.writeFile(path.join(out,'cases.json'),JSON.stringify(rows,null,2)+'\n');console.log('Original layout compiler cases:',rows.length);
}else if(action==='audit'){
 const rows=JSON.parse(await fs.readFile(path.join(out,'cases.json'),'utf8'));
 const native=(await fs.readFile(path.join(out,'native.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(native.length,rows.length);
 const {default:createModule}=await import('../../renderer/virgl-shader/build/wasm/virgl-shader.mjs');const module=await createModule(),observed=[],failures=[];
 const allocate=b=>{const p=module._malloc(b.length);assert.ok(p);module.HEAPU8.set(b,p);return p;};
 for(const [i,r] of rows.entries()){
  const pointers=[];
  try{
   const a=Buffer.from(r.a),b=Buffer.from(r.b),ap=allocate(Buffer.concat([a,Buffer.from([0])])),bp=allocate(Buffer.concat([b,Buffer.from([0])]));pointers.push(ap,bp);
   let lp=0;if(!r.nullWords&&r.words.length){const bytes=Buffer.alloc(r.words.length*4);r.words.forEach((w,j)=>bytes.writeUInt32LE(w>>>0,j*4));lp=allocate(bytes);pointers.push(lp);}
   const selectors=Object.values(r.selectors),result=r.kind===2?module._bridge_translate_standard_stream_output_pair(ap,a.length,bp,b.length,...selectors,lp,r.words.length,r.capture):module._bridge_translate_standard_stream_output(r.kind,ap,a.length,selectors[5],selectors[6],lp,r.words.length,r.capture);
   const actual=JSON.parse(module.UTF8ToString(result));assert.deepEqual(actual,native[i].response,'native/Wasm '+r.name);observed.push({index:i,response:actual});
   if(actual.ok!==r.okay||!actual.ok&&actual.error.code!==r.code)failures.push({name:r.name,predicted:{okay:r.okay,code:r.code},actual});
  }finally{for(const p of pointers.reverse())module._free(p);}
 }
 await fs.writeFile(path.join(out,'wasm.jsonl'),observed.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const report={status:failures.length?'failed':'passed',cases:rows.length,exactNativeWasm:true,fixedMemoryBytes:module.HEAPU8.byteLength,failures,requestSha256:createHash('sha256').update(await fs.readFile(path.join(out,'cases.bin'))).digest('hex')};await fs.writeFile(path.join(out,'audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.deepEqual(failures,[]);
}else if(action==='facade'){
 const {createVirglStandardStreamOutputShaderBridge}=await import('../../renderer/virgl-shader/standard.mjs');let runtime;const bridge=await createVirglStandardStreamOutputShaderBridge({onRuntimeInitialized(){runtime=this;}});
 const rows=JSON.parse(await fs.readFile(path.join(out,'cases.json'),'utf8')),native=(await fs.readFile(path.join(out,'native.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),observed=[];
 for(const [i,r]of rows.entries()){
  if(r.nullWords||!r.words.length)continue;
  const request=r.kind===2?{vertexText:r.a,fragmentText:r.b,...r.selectors,streamOutputWords:r.words,captureBuffer:r.capture}:{stage:r.kind===0?'vertex':r.kind===1?'fragment':'invalid',text:r.a,signedColorMask:r.selectors.signedColorMask,unsignedColorMask:r.selectors.unsignedColorMask,streamOutputWords:r.words,captureBuffer:r.capture};
  const response=r.kind===2?bridge.translatePairStreamOutput(request):bridge.translateStreamOutput(request);
  assert.equal(response.ok,native[i].response.ok,r.name);
  if(response.ok)assert.deepEqual(response,native[i].response,r.name);else assert.equal(response.error.code,native[i].response.error.code,r.name);
  observed.push({index:i,name:r.name,request,response});
 }
 const source='VERT\nDCL OUT[0], POSITION\nIMM[0] FLT32 {0.0,0.0,0.0,1.0}\n0: MOV OUT[0], IMM[0]\n1: END\n';
 const base={stage:'vertex',text:source,signedColorMask:0,unsignedColorMask:0,streamOutputWords:[1,4,0,0,0,4<<10,0],captureBuffer:0},reflection=[];
 const rejected=(name,value)=>{const response=bridge.translateStreamOutput(value);assert.equal(response.ok,false,name);reflection.push({name,response});};
 rejected('missing',{});rejected('unknown',{...base,unknown:0});rejected('symbol',{...base,[Symbol('extra')]:0});
 rejected('accessor',Object.defineProperty({...base},'text',{get(){throw Error('getter must not run');}}));
 rejected('throwing-reflection',new Proxy(base,{ownKeys(){throw Error('reflection exception');}}));
 for(const value of [null,{},new Uint32Array(base.streamOutputWords),[],[0,NaN],[0,-1],[0,0x100000000],[0,1n]])rejected('layout-type-'+reflection.length,{...base,streamOutputWords:value});
 const sparse=Array(2);sparse[0]=0;rejected('sparse',{...base,streamOutputWords:sparse});
 const getter=[0];Object.defineProperty(getter,'0',{get(){throw Error('element getter must not run');}});rejected('element-accessor',{...base,streamOutputWords:getter});
 const extra=[0];extra.extra=0;rejected('array-extra',{...base,streamOutputWords:extra});
 const words=base.streamOutputWords.slice(),seen=new Map();const changing=new Proxy(words,{getOwnPropertyDescriptor(target,key){if(key==='0'){const n=(seen.get(key)??0)+1;seen.set(key,n);return {...Reflect.getOwnPropertyDescriptor(target,key),value:n===1?1:0xffffffff};}return Reflect.getOwnPropertyDescriptor(target,key);}});
 const owned=bridge.translateStreamOutput({...base,streamOutputWords:changing});assert.equal(owned.ok,true);assert.equal(seen.get('0'),1);assert.deepEqual(owned.metadata.streamOutput.outputs,[{registerIndex:0,startComponent:0,numComponents:4,outputBuffer:0,destinationOffset:0,stream:0}]);
 const saved=JSON.stringify(owned);words.fill(0xffffffff);assert.equal(JSON.stringify(owned),saved);
 const pair={vertexText:source,fragmentText:rows[0].b,...rows[0].selectors,streamOutputWords:base.streamOutputWords,captureBuffer:0};
 const reject=(method,name,value)=>{const response=bridge[method](value);assert.equal(response.ok,false,name);reflection.push({method,name,response});};
 for(const method of ['translateStreamOutput','translatePairStreamOutput']){
  const valid=method==='translateStreamOutput'?base:pair;
  for(const value of [null,[],Object.create(valid),{...valid,unknown:0},new Proxy(valid,{getOwnPropertyDescriptor(){throw Error('descriptor exception');}})])reject(method,'request-'+reflection.length,value);
  for(const key of Object.keys(valid))reject(method,'accessor-'+key,Object.defineProperty({...valid},key,{get(){throw Error('getter must not run');}}));
  for(const captureBuffer of [-1,.5,4,NaN,'0'])reject(method,'capture-buffer',{...valid,captureBuffer});
  for(const key of Object.keys(valid).filter(k=>k.endsWith('Mask')))for(const value of [-1,.5,NaN,'0',65536])reject(method,key,{...valid,[key]:value});
  for(const key of method==='translateStreamOutput'?['text']:['vertexText','fragmentText'])for(const value of [null,new String(source),'\0',' '.repeat(49153)])reject(method,key,{...valid,[key]:value});
  for(const value of [new Proxy([0],{ownKeys(){throw Error('array keys');}}),new Proxy([0],{getOwnPropertyDescriptor(t,k){if(k==='length')return {value:0,writable:true,enumerable:false,configurable:false};return Reflect.getOwnPropertyDescriptor(t,k);}}),Array(262).fill(0)])reject(method,'layout-reflection',{...valid,streamOutputWords:value});
 }
 reject('translateStreamOutput','vertex-colors',{...base,signedColorMask:1});reject('translateStreamOutput','overlap-colors',{...base,stage:'fragment',signedColorMask:1,unsignedColorMask:1});
 for(const patch of [{signedMask:1,unsignedMask:1},{signedMask:1,packedSignedMask:1},{packedNormalizedMask:1},{bufferZeroMask:4},{signedColorMask:1,unsignedColorMask:1}])reject('translatePairStreamOutput','overlap-masks',{...pair,...patch});
 // Ordinary selected methods all route through the C zero-output variant.
 const zero=bridge.translatePairStreamOutput({...pair,streamOutputWords:[0]});assert.equal(zero.ok,true);
 for(const [method,keys]of [['translatePair',[]],['translatePairTyped',['signedMask','unsignedMask']],['translatePairVertexFormats',['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask']],['translatePairUniforms',['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask']],['translatePairImages',Object.keys(rows[0].selectors)]])assert.deepEqual(bridge[method]({vertexText:source,fragmentText:pair.fragmentText,...Object.fromEntries(keys.map(k=>[k,0]))}),zero);
 for(const [stage,text]of [['vertex',source],['fragment',pair.fragmentText]])assert.deepEqual(bridge.translate({stage,text}),bridge.translateStreamOutput({...base,stage,text,streamOutputWords:[0]}));
 // Genuine fixed-memory exhaustion, with every outstanding allocation released.
 const pressure=[];for(const size of [65536,1024,1]){let pointer;while((pointer=runtime._malloc(size))!==0)pressure.push(pointer);}
 const failed=bridge.translateStreamOutput(base);assert.equal(failed.error.code,'allocation-failed');
 for(let i=0;i<3;i++)runtime._free(pressure.pop());const inputFailure=bridge.translateStreamOutput(base);assert.equal(inputFailure.ok,false);
 for(const pointer of pressure.reverse())runtime._free(pointer);assert.deepEqual(bridge.translateStreamOutput(base),owned);
 const peer=await createVirglStandardStreamOutputShaderBridge();assert.deepEqual(peer.translateStreamOutput(base),owned);assert.equal(runtime.HEAPU8.byteLength,16777216);
 for(const entry of ['_bridge_translate_standard_stream_output','_bridge_translate_standard_stream_output_pair'])await assert.rejects(createVirglStandardStreamOutputShaderBridge({onRuntimeInitialized(){delete this[entry];}}),/missing its C entries/);
 const factories=await import('../../renderer/virgl-shader/standard.mjs'),legacy=[];
 for(const name of ['createVirglStandardIntegerImageShaderBridge','createVirglStandardInstanceBaseShaderBridge','createVirglStandardShadowTextureShaderBridge','createVirglStandardDimensionalTextureShaderBridge','createVirglStandardDimensionalShadowTextureShaderBridge']){const old=await factories[name](),stage=old.translateImages({stage:'vertex',text:source,signedColorMask:0,unsignedColorMask:0}),pairResponse=old.translatePairImages({vertexText:source,fragmentText:pair.fragmentText,...rows[0].selectors});assert.equal(stage.ok,true);assert.equal(pairResponse.ok,true);legacy.push({name,stage,pair:pairResponse});}
 const results={status:'passed',cases:observed.length,reflectionCases:reflection.length,snapshotReads:seen.get('0'),observed,reflection,owned,pressure:{failed,inputFailure,allocations:pressure.length+3,recovered:true},fixedMemoryBytes:runtime.HEAPU8.byteLength,legacy};await fs.writeFile(path.join(out,'facade.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({status:'passed',cases:observed.length,reflectionCases:reflection.length,ownedSnapshot:true}));
}else if(action==='historical'){
 const {direct}=await import('../virgl-dimensional-shadow-shaders/abi.mjs');
 const {default:createModule}=await import('../../renderer/virgl-shader/build/wasm/virgl-shader.mjs');
 const {default:createOld}=await import(path.join(out,'baseline/renderer/virgl-shader/build/wasm/virgl-shader.mjs'));
 const current=await createModule(),old=await createOld(),rows=JSON.parse(await fs.readFile(path.join(out,'historical/cases.json'),'utf8')).cases;
 const lines=(await fs.readFile(path.join(out,'historical/current-native.jsonl'),'utf8')).trim().split('\n');assert.equal(lines.length,rows.length);const records=[];
 for(const [i,r]of rows.entries()){const after=direct(current,r),before=direct(old,r);assert.equal(after,before,r.name+' historical response bytes');assert.deepEqual(JSON.parse(after),JSON.parse(lines[i]).result,r.name+' historical native/Wasm');records.push({index:i,name:r.name,before,after});}
 await fs.writeFile(path.join(out,'historical/wasm.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');await fs.writeFile(path.join(out,'historical/audit.json'),JSON.stringify({status:'passed',cases:rows.length,allResponseBytesIdentical:true,fixedMemoryBytes:[current.HEAPU8.byteLength,old.HEAPU8.byteLength]},null,2)+'\n');console.log('Historical native/Wasm complete responses unchanged:',rows.length);
}else throw Error('Unknown action '+action);
