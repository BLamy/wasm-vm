import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {compilerCases} from './cases.mjs';
import {direct} from './abi.mjs';
import {comparisonText,pairTexts,profile} from './fixtures.mjs';
import {selectorKeys,vertexText,fragmentText,zeroSelectors} from '../virgl-instance-base/fixtures.mjs';
import {checkOriginalTextureTokens,enumValues} from './tokens.mjs';
const [mode,directory]=process.argv.slice(2),dir=path.resolve(directory),root=path.resolve(import.meta.dirname,'../../renderer/virgl-shader'),hash=b=>createHash('sha256').update(b).digest('hex');
fs.mkdirSync(dir,{recursive:true});
if(mode==='cases'){
 const cases=compilerCases(),word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},parts=[word(cases.length)];
 for(const c of cases){const a=Buffer.from(c.a),b=Buffer.from(c.b);parts.push(word(c.kind),...selectorKeys.map(k=>word(c.selectors[k])),word(a.length),a,word(b.length),b);}
 fs.writeFileSync(dir+'/cases.bin',Buffer.concat(parts));fs.writeFileSync(dir+'/cases.json',JSON.stringify({cases},null,2)+'\n');
 console.log(JSON.stringify({cases:cases.length,positive:cases.filter(c=>c.okay).length,negative:cases.filter(c=>!c.okay).length}));
}else if(mode==='gpu-inputs'){
 const {cases}=JSON.parse(fs.readFileSync(dir+'/cases.json')),rows=fs.readFileSync(dir+'/native.jsonl','utf8').trim().split('\n'),mapping=[];
 assert.equal(cases.length,rows.length);
 for(const [name,predicate,nested] of [['hardware-inputs',c=>c.name.startsWith('hardware/'),true],['signature-inputs',c=>c.name.startsWith('signature/'),false]]){
  const selected=cases.map((c,i)=>({c,i})).filter(({c})=>predicate(c)),destination=dir+'/'+name+(nested?'/native':'');fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(destination+'/cases.json',JSON.stringify({cases:selected.map(({c,i})=>({...c,originalMatrixIndex:i}))},null,2)+'\n');
  fs.writeFileSync(destination+'/native.jsonl',selected.map(({i})=>rows[i]).join('\n')+'\n');
  mapping.push({name,cases:selected.length,originalMatrixIndices:selected.map(({i})=>i),nativeSha256:hash(fs.readFileSync(destination+'/native.jsonl'))});
 }
 assert.deepEqual(mapping.map(m=>m.cases),[182,576]);fs.writeFileSync(dir+'/gpu-input-mapping.json',JSON.stringify({status:'passed',mapping},null,2)+'\n');
}else if(mode==='audit'){
 const {cases}=JSON.parse(fs.readFileSync(dir+'/cases.json')),nativeLines=fs.readFileSync(dir+'/native.jsonl','utf8').trim().split('\n'),native=nativeLines.map(JSON.parse);assert.equal(native.length,cases.length);
 const auth=JSON.parse(fs.readFileSync(dir+'/predecessor/authentication.json'));assert.equal(auth.status,'passed');assert.equal(auth.reopenedMembers,38);
 const {default:createModule}=await import(pathToFileURL(root+'/build/wasm/virgl-shader.mjs')),{default:createOld}=await import(pathToFileURL(dir+'/predecessor/virgl-shader.mjs')),raw=await createModule(),old=await createOld();
 const factories=await import(pathToFileURL(root+'/standard.mjs')),factory=factories.createVirglStandardDimensionalShadowTextureShaderBridge,bridge=await factory();
 const header=fs.readFileSync(root+'/vendor/src/gallium/include/pipe/p_shader_tokens.h','utf8'),semantics=enumValues(header,'tgsi_semantic');
 const observed=[],historical=[],systems=[];
 let accepted=0,selected=0,textures=0;
 for(const [index,c]of cases.entries()){
  const response=direct(raw,c),result=JSON.parse(response);assert.deepEqual(result,native[index].result,c.name+' complete native/sanitized/Wasm response');assert.equal(response,nativeLines[index].slice(nativeLines[index].indexOf(',"result":')+10,nativeLines[index].lastIndexOf(',"originalTokens":')),c.name+' complete native/Wasm response bytes');assert.equal(result.ok,c.okay,c.name+' admission '+JSON.stringify(result.error));
  if(c.kind<43){const before=direct(old,c);assert.equal(response,before,c.name+' entire historical response bytes');historical.push({name:c.name,originalResponse:before,currentResponse:response});}
  if(!result.ok){assert.equal(result.error.code,c.code,c.name);assert.deepEqual(Object.keys(result),['ok','error']);}
  else{
   accepted++;const paired=[2,9,10,11,14,17,24,31,38,45].includes(c.kind),stages=paired?['vertex','fragment']:[c.kind===0||c.kind===7||c.kind===12||c.kind===15||c.kind===22||c.kind===29||c.kind===36||c.kind===43?'vertex':'fragment'];
   for(const [i,stage]of stages.entries()){
    const body=paired?result[stage]:result,text=i?c.b:c.a,record=native[index].originalTokens[i];
    assert.ok(record.rawWords.length>=3&&record.rawWords.length<=8192);assert.equal((record.rawWords[0]&255)+(record.rawWords[0]>>>8),record.rawWords.length,'complete original token word length');
    textures+=checkOriginalTextureTokens(text,record,header).length;
    const targets = enumValues(header, 'tgsi_texture_type'), returnTypes = enumValues(header, 'tgsi_return_type');
    const declarations = [...text.matchAll(/^DCL SVIEW\[(\d+)(?:\.\.(\d+))?\], (2D|SHADOW2D|3D|CUBE|2D_ARRAY|SHADOWCUBE|SHADOW2D_ARRAY), (FLOAT|SINT|UINT)(?:, (?:FLOAT|SINT|UINT))*$/gm)].map(m => ({first:+m[1],last:+(m[2]??m[1]),target:targets['TGSI_TEXTURE_'+m[3]],returnTypes:Array(4).fill(returnTypes['TGSI_RETURN_TYPE_'+m[4]])}));
    assert.deepEqual(record.samplerViews, declarations, c.name+' original dimensional declaration words');
    if(c.kind>=43) for(const sampler of body.metadata.samplers) {
      const declaration=declarations.find(d=>sampler.index>=d.first&&sampler.index<=d.last);assert.ok(declaration);
      const perSlot=record.textureInstructions.filter(t=>t.sources.at(-1).index===sampler.index),op=enumValues(header,'tgsi_opcode');
      const shadowTargets=[targets.TGSI_TEXTURE_SHADOW2D,targets.TGSI_TEXTURE_SHADOWCUBE,targets.TGSI_TEXTURE_SHADOW2D_ARRAY],isShadow=t=>shadowTargets.includes(t.target);
      const shadowView=shadowTargets.includes(declaration.target),shadowSample=perSlot.some(t=>isShadow(t)&&t.opcode!==op.TGSI_OPCODE_TXQ),ordinarySample=perSlot.some(t=>!isShadow(t)&&t.opcode!==op.TGSI_OPCODE_TXQ);
      const shadowQuery=perSlot.some(t=>isShadow(t)&&t.opcode===op.TGSI_OPCODE_TXQ),comparison=shadowView||shadowSample||(shadowQuery&&!ordinarySample);
      if(comparison){const dimensions={ [targets.TGSI_TEXTURE_2D]:'2D', [targets.TGSI_TEXTURE_SHADOW2D]:'2D', [targets.TGSI_TEXTURE_CUBE]:'Cube', [targets.TGSI_TEXTURE_SHADOWCUBE]:'Cube', [targets.TGSI_TEXTURE_2D_ARRAY]:'2DArray', [targets.TGSI_TEXTURE_SHADOW2D_ARRAY]:'2DArray'};assert.equal(sampler.type,'sampler'+dimensions[declaration.target]+'Shadow',c.name+' independently selected comparison dimension');}
      else {
        const targetNames={ [targets.TGSI_TEXTURE_2D]:'2D', [targets.TGSI_TEXTURE_3D]:'3D', [targets.TGSI_TEXTURE_CUBE]:'Cube', [targets.TGSI_TEXTURE_2D_ARRAY]:'2DArray' };
        const prefix=declaration.returnTypes[0]===returnTypes.TGSI_RETURN_TYPE_SINT?'i':declaration.returnTypes[0]===returnTypes.TGSI_RETURN_TYPE_UINT?'u':'';
        assert.equal(sampler.type,prefix+'sampler'+targetNames[declaration.target],c.name+' native dimensional sampler type');
      }
    }
    const expected=[...text.matchAll(/^DCL SV\[(\d+)\], (VERTEXID|INSTANCEID|PCOORD)(?:\[0\])?$/gm)].map(m=>({first:+m[1],last:+m[1],semantic:semantics['TGSI_SEMANTIC_'+m[2]],semanticIndex:0,mask:15}));
    assert.deepEqual(record.systemDeclarations,expected,c.name+' original parser system declarations');
    if(c.kind>=43){
     selected++;assert.equal(body.metadata.profile,profile);assert.equal(body.metadata.stage,stage);
     const targets=enumValues(header,'tgsi_texture_type'),opcodes=enumValues(header,'tgsi_opcode'),slots=[...new Set(record.textureInstructions.filter(t=>[targets.TGSI_TEXTURE_SHADOW2D,targets.TGSI_TEXTURE_SHADOWCUBE,targets.TGSI_TEXTURE_SHADOW2D_ARRAY].includes(t.target)&&t.opcode!==opcodes.TGSI_OPCODE_TXQ).map(t=>t.sources.at(-1).index))].sort((a,b)=>a-b);
     const prefix=stage==='vertex'?'vs':'fs',controls=slots.flatMap(index=>[{index,name:prefix+'shadmask'+index,type:'vec4',semantic:'SHADOW_MASK'},{index,name:prefix+'shadadd'+index,type:'vec4',semantic:'SHADOW_ADD'}]);
     assert.deepEqual(body.metadata.shadowUniforms,controls,c.name+' original stage/slot controls');
     for(const control of controls)assert.ok(body.glsl.includes('uniform highp vec4 '+control.name+';'));
     const queries=[...new Set(record.textureInstructions.filter(t=>t.opcode===opcodes.TGSI_OPCODE_TXQ&&(t.writeMask&8)).map(t=>t.sources.at(-1).index))].sort((a,b)=>a-b);
     assert.deepEqual(body.metadata.textureQueries,queries.map(index=>({index,name:prefix+'samplevels'+index,type:'int',semantic:'TEXTURE_LEVELS'})),c.name+' independent original query-level masks');


     const hasInstance=stage==='vertex'&&expected.some(d=>d.semantic===semantics.TGSI_SEMANTIC_INSTANCEID);
     assert.deepEqual(body.metadata.instanceUniforms,hasInstance?[{name:'wv_instance_base',type:'uint',semantic:'INSTANCE_BASE',default:0}]:[],c.name+' separately owned uniform');
     assert.equal(body.glsl.includes('uniform highp uint wv_instance_base;'),hasInstance,c.name+' native declaration');
     assert.deepEqual(body.metadata.colorOutputMasks,{signedMask:stage==='fragment'?c.selectors.signedColorMask:0,unsignedMask:stage==='fragment'?c.selectors.unsignedColorMask:0});
     for(const source of record.systemSources){const decl=record.systemDeclarations.find(d=>source.index>=d.first&&source.index<=d.last);assert.ok(decl);if(decl.semantic===semantics.TGSI_SEMANTIC_INSTANCEID)assert.ok(body.glsl.includes('uvec4(uint(gl_InstanceID) + wv_instance_base)'));if(decl.semantic===semantics.TGSI_SEMANTIC_VERTEXID)assert.ok(body.glsl.includes('uvec4(uint(gl_VertexID))'));}
     if(record.systemDeclarations.length)systems.push({case:index,name:c.name,stage,originalTokens:record,glsl:body.glsl,metadata:body.metadata,rawTokenSha256:hash(Buffer.from(new Uint32Array(record.rawWords).buffer))});
    }else if(c.kind<22) assert.equal(Object.hasOwn(body.metadata,'instanceUniforms'),false,'historical metadata unchanged');
   }
  }
  if(c.kind===43||c.kind===44){const facade=bridge.translateImages({stage:c.kind===22||c.kind===29||c.kind===36||c.kind===43?'vertex':'fragment',text:c.a,signedColorMask:c.selectors.signedColorMask,unsignedColorMask:c.selectors.unsignedColorMask});assert.equal(facade.ok,result.ok,c.name);if(result.ok)assert.deepEqual(facade,result);else assert.equal(facade.error.code,result.error.code);}
  if(c.kind===45){const facade=bridge.translatePairImages({vertexText:c.a,fragmentText:c.b,...c.selectors});assert.equal(facade.ok,result.ok,c.name);if(result.ok)assert.deepEqual(facade,result);else assert.equal(facade.error.code,result.error.code);}
  observed.push({name:c.name,response,result});
 }
 fs.writeFileSync(dir+'/historical-abi.jsonl',historical.map(r=>JSON.stringify(r)).join('\n')+'\n');
 fs.writeFileSync(dir+'/system-tokens.json',JSON.stringify({status:'passed',records:systems},null,2)+'\n');
 const request={...pairTexts('fragment',{target:'CUBE',opcode:'TXB2',slot:7}),...zeroSelectors(),unsignedMask:4,unsignedColorMask:1},baseline=bridge.translatePairImages(request),saved=JSON.stringify(baseline),rejections=[];assert.equal(baseline.ok,true);
 const reject=(method,label,value)=>{const result=bridge[method](value);assert.equal(result.ok,false,label);assert.deepEqual(Object.keys(result),['ok','error']);rejections.push({method,label,result});};
 for(const value of [null,[],4,Object.create(request),{...request,instanceBase:17},{...request,wv_instance_base:17},{...request,key:{}},{...request,vertexText:new String(request.vertexText)},{...request,fragmentText:'\0'},{...request,vertexText:' '.repeat(49153)}])reject('translatePairImages','strict-'+rejections.length,value);
 for(const key of selectorKeys)for(const value of ['1',null,NaN,Infinity,-1,.5,65536,new Number(1)])reject('translatePairImages',key+'-'+String(value),{...request,[key]:value});
 for(const key of ['signedColorMask','unsignedColorMask'])for(const value of [16,0xffffffff])reject('translatePairImages',key+'-extent',{...request,[key]:value});
 for(const value of [4,0xffffffff])reject('translatePairImages','buffer-zero-extent',{...request,bufferZeroMask:value});
 let getters=0;for(const key of Object.keys(request)){const value={...request};Object.defineProperty(value,key,{get(){getters++;return request[key];},enumerable:true});reject('translatePairImages','accessor-'+key,value);}assert.equal(getters,0);
 reject('translatePairImages','symbol',{...request,[Symbol('guest-key')]:0});reject('translatePairImages','ownkeys-trap',new Proxy({}, {ownKeys(){throw Error('trap');}}));reject('translatePairImages','descriptor-trap',new Proxy(request,{getOwnPropertyDescriptor(){throw Error('trap');}}));
 const caller={...request};let mutated=false;const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,key){const own=Reflect.getOwnPropertyDescriptor(t,key);if(key==='unsignedColorMask'&&!mutated){mutated=true;t.vertexText='\0';t.unsignedColorMask=16;}return own;}});assert.deepEqual(bridge.translatePairImages(proxy),baseline);reject('translatePairImages','later-mutation',caller);assert.equal(JSON.stringify(baseline),saved);
 const stage={stage:'fragment',text:comparisonText('fragment',{target:'2D_ARRAY'}),signedColorMask:0,unsignedColorMask:1};assert.equal(bridge.translateImages(stage).ok,true);
 for(const value of [null,[],Object.create(stage),{...stage,instanceBase:17},{...stage,text:new String(stage.text)},{...stage,text:'\0'},{...stage,text:' '.repeat(49153)},{...stage,stage:'compute'},{...stage,stage:'vertex',signedColorMask:1},{...stage,signedColorMask:1,unsignedColorMask:1}])reject('translateImages','stage-'+rejections.length,value);
 for(const key of ['signedColorMask','unsignedColorMask'])for(const value of ['1',null,NaN,Infinity,-1,.5,16,new Number(1)])reject('translateImages',key+'-strict',{...stage,[key]:value});
 for(const key of Object.keys(stage)){const value={...stage};Object.defineProperty(value,key,{get(){getters++;return stage[key];},enumerable:true});reject('translateImages','stage-accessor-'+key,value);}assert.equal(getters,0);
 reject('translateImages','stage-ownkeys-trap',new Proxy({}, {ownKeys(){throw Error('trap');}}));reject('translateImages','stage-descriptor-trap',new Proxy(stage,{getOwnPropertyDescriptor(){throw Error('trap');}}));
 let peerRuntime;const peer=await factory({onRuntimeInitialized(){peerRuntime=this;}});assert.deepEqual(peer.translatePairImages(request),baseline);assert.deepEqual(bridge.translatePairImages(request),baseline);assert.notEqual(peerRuntime.HEAPU8.buffer,raw.HEAPU8.buffer);assert.notEqual(peerRuntime.HEAPU8.buffer,old.HEAPU8.buffer);assert.equal(peerRuntime.HEAPU8.byteLength,16777216);
 const legacy=[];
 for(const [name,stageKind,pairKind]of [['createVirglStandardShaderBridge',7,9],['createVirglStandardUniformShaderBridge',12,14],['createVirglStandardTextureShaderBridge',0,2],['createVirglStandardIntegerImageShaderBridge',15,17],['createVirglStandardInstanceBaseShaderBridge',22,24],['createVirglStandardShadowTextureShaderBridge',29,31],['createVirglStandardDimensionalTextureShaderBridge',36,38]]){
  const prior=await factories[name](),a=vertexText(),b=fragmentText,selectors=zeroSelectors();
  const originalStage=JSON.parse(direct(old,{kind:stageKind,a,b:'',selectors})),originalPair=JSON.parse(direct(old,{kind:pairKind,a,b,selectors}));
  assert.deepEqual(prior.translate({stage:'vertex',text:a}),originalStage);assert.deepEqual(prior.translatePair({vertexText:a,fragmentText:b}),originalPair);
  for(const method of ['translatePairTyped','translatePairVertexFormats','translatePairUniforms','translatePairImages'])if(prior[method]){
   const keys=method==='translatePairTyped'?selectorKeys.slice(0,2):method==='translatePairVertexFormats'?selectorKeys.slice(0,4):method==='translatePairUniforms'?selectorKeys.slice(0,5):selectorKeys;
   assert.deepEqual(prior[method]({vertexText:a,fragmentText:b,...Object.fromEntries(keys.map(k=>[k,0]))}),originalPair);
  }
  if(prior.translateImages)assert.deepEqual(prior.translateImages({stage:'vertex',text:a,signedColorMask:0,unsignedColorMask:0}),originalStage);
  legacy.push({factory:name,stage:originalStage,pair:originalPair});
 }
 fs.writeFileSync(dir+'/historical-factories.json',JSON.stringify({status:'passed',records:legacy},null,2)+'\n');
 const zeroColors={...request,signedColorMask:0,unsignedColorMask:0},uniformRequest={...zeroColors};delete uniformRequest.signedColorMask;delete uniformRequest.unsignedColorMask;
 assert.deepEqual(bridge.translatePairUniforms(uniformRequest),bridge.translatePairImages(zeroColors));
 for(const method of ['translatePair','translatePairTyped','translatePairVertexFormats']){const keys=method==='translatePair'?[]:method==='translatePairTyped'?selectorKeys.slice(0,2):selectorKeys.slice(0,4),value={vertexText:request.vertexText,fragmentText:request.fragmentText,...Object.fromEntries(keys.map(k=>[k,0]))};assert.deepEqual(bridge[method](value),bridge.translatePairImages({...zeroColors,signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0}));}
 for(const [stage,text]of [['vertex',request.vertexText],['fragment',request.fragmentText]])assert.deepEqual(bridge.translate({stage,text}),bridge.translateImages({stage,text,signedColorMask:0,unsignedColorMask:0}));
 // Every request method rejects a host-offset field and snapshots only own data.
 for(const method of ['translate','translatePair','translatePairTyped','translatePairVertexFormats','translatePairUniforms']){
  const names=method==='translate'?['stage','text']:method==='translatePair'?['vertexText','fragmentText']:method==='translatePairTyped'?['vertexText','fragmentText',...selectorKeys.slice(0,2)]:method==='translatePairVertexFormats'?['vertexText','fragmentText',...selectorKeys.slice(0,4)]:['vertexText','fragmentText',...selectorKeys.slice(0,5)];
  const values={stage:'vertex',text:request.vertexText,...request},input=Object.fromEntries(names.map(k=>[k,values[k]]));assert.equal(bridge[method](input).ok,true);
  for(const value of [null,[],Object.create(input),{...input,instanceBase:1}])reject(method,'strict-'+method,value);
  for(const key of names){const value={...input};Object.defineProperty(value,key,{get(){getters++;return values[key];},enumerable:true});reject(method,'getter-'+key,value);}assert.equal(getters,0);
  reject(method,'ownkeys-trap',new Proxy({}, {ownKeys(){throw Error('trap');}}));reject(method,'descriptor-trap',new Proxy(input,{getOwnPropertyDescriptor(){throw Error('trap');}}));
  if(method==='translate')reject(method,'bad-stage',{...input,stage:'compute'});
  for(const key of names.filter(k=>k.endsWith('Mask')))for(const value of [-1,.5,65536,'1',null])reject(method,'bad-'+key,{...input,[key]:value});
  reject(method,'nonprimitive-text',{...input,[method==='translate'?'text':'vertexText']:new String(request.vertexText)});
  reject(method,'oversized',{...input,[method==='translate'?'text':'fragmentText']:' '.repeat(49153)});
  reject(method,'nonascii',{...input,[method==='translate'?'text':'vertexText']:'\0'});
 }
 let runtime;const pressure=[],constrained=await factory({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)pressure.push(p);}}});
 const failed=constrained.translatePairImages(request);assert.equal(failed.error.code,'allocation-failed');assert.deepEqual(Object.keys(failed),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);
 runtime._free(pressure.shift());const scratchFailure=constrained.translatePairImages(request);assert.equal(scratchFailure.ok,false);assert.equal(scratchFailure.error.code,'translation-error');assert.equal(scratchFailure.error.message,'Checked upstream TGSI parsing failed.');pressure.reverse().forEach(p=>runtime._free(p));assert.deepEqual(constrained.translatePairImages(request),baseline);
 for(const module of [raw,old,runtime])assert.equal(module.HEAPU8.byteLength,16777216);assert.notEqual(raw.HEAPU8.buffer,old.HEAPU8.buffer);assert.notEqual(raw.HEAPU8.buffer,runtime.HEAPU8.buffer);
 fs.writeFileSync(dir+'/facade.json',JSON.stringify({status:'passed',rejections,getters,ownedSnapshots:true,peerIsolation:true,pressure:{result:failed,scratchFailure,bytes:16777216,recovered:true},historical:{cases:historical.length,allResponseBytesIdentical:true,predecessor:auth.predecessor}},null,2)+'\n');
 fs.writeFileSync(dir+'/wasm.jsonl',observed.map(r=>JSON.stringify(r)).join('\n')+'\n');
 fs.writeFileSync(dir+'/audit.json',JSON.stringify({status:'passed',cases:cases.length,accepted,rejected:cases.length-accepted,selectedStages:selected,originalSystemStages:systems.length,originalTextureInstructions:textures,exactNativeWasm:true,historicalResponses:historical.length,fixedMemoryBytes:raw.HEAPU8.byteLength,productionNegotiation:false,guestExecution:false},null,2)+'\n');
 console.log(JSON.stringify({cases:cases.length,accepted,rejected:cases.length-accepted,selectedStages:selected,systems:systems.length,textures,historical:historical.length}));
}else throw Error('cases or audit required');
