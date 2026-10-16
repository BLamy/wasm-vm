import * as contract from '../constant-domain.mjs';
import {checks} from './standard-instanced-draws.mjs';
const keys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask','signedColorMask','unsignedColorMask'];
const zero=()=>Object.fromEntries(keys.map(key=>[key,0]));
const clone=value=>JSON.parse(JSON.stringify(value));
const frozen=value=>!value||typeof value!=='object'||Object.isFrozen(value)&&Object.values(value).every(frozen);
export function originalCall(module,c){
 const pointers=[];
 try{
  for(const text of [c.a,c.b]){
   const bytes=new TextEncoder().encode(text),p=module._malloc(bytes.length+1);
   if(!p)throw Error('actual compiler input allocation');pointers.push(p);module.HEAPU8.set(bytes,p);module.HEAPU8[p+bytes.length]=0;
  }
  const [a,b]=pointers,m=keys.map(key=>c.selectors[key]);let p;
  if(c.kind<2)p=module._bridge_translate_standard_texture(c.kind,a,c.a.length);
  else if(c.kind<5)p=module._bridge_translate_standard_texture_pair(c.kind===3?0:a,c.a.length,c.kind===4?0:b,c.b.length,...m.slice(0,5));
  else if(c.kind===5)p=module._bridge_translate_standard_texture(0,0,c.a.length);
  else if(c.kind===6)p=module._bridge_translate_standard_texture(-1,a,c.a.length);
  else if(c.kind<9)p=module._bridge_translate_standard(c.kind-7,a,c.a.length);
  else if(c.kind===9)p=module._bridge_translate_standard_pair(a,c.a.length,b,c.b.length);
  else if(c.kind===10)p=module._bridge_translate_standard_pair_typed(a,c.a.length,b,c.b.length,...m.slice(0,2));
  else if(c.kind===11)p=module._bridge_translate_standard_pair_vertex_formats(a,c.a.length,b,c.b.length,...m.slice(0,4));
  else if(c.kind<14)p=module._bridge_translate_standard_uniform(c.kind-12,a,c.a.length);
  else if(c.kind===14)p=module._bridge_translate_standard_uniform_pair(a,c.a.length,b,c.b.length,...m.slice(0,5));
  else if(c.kind<17)p=module._bridge_translate_standard_integer_image(c.kind-15,a,c.a.length,m[5],m[6]);
  else if(c.kind<20)p=module._bridge_translate_standard_integer_image_pair(c.kind===18?0:a,c.a.length,c.kind===19?0:b,c.b.length,...m);
  else p=module._bridge_translate_standard_integer_image(c.kind===21?-1:0,c.kind===20?0:a,c.a.length,m[5],m[6]);
  return JSON.parse(module.UTF8ToString(p));
 }finally{pointers.reverse().forEach(p=>module._free(p));}
}
// Predict COLOR0..3 admission from original public declarations and host
// selectors, not from the normalizer under test or emitted GLSL.
function admitted(text,selectors){
 const declarations=[...text.matchAll(/^DCL OUT\[\d+(?:\.[xyzw]+)?\], COLOR(?:\[(\d+)\])?\s*$/gm)];
 return selectors.signedColorMask<=15&&selectors.unsignedColorMask<=15&&
  !(selectors.signedColorMask&selectors.unsignedColorMask)&&declarations.length>=1&&declarations.length<=4&&declarations.every(d=>Number(d[1]??0)<4);
}
function originals(c,body,stage,counters){
 const text=stage==='vertex'?c.a:[17,18,19].includes(c.kind)?c.b:c.a;
 const types=new Map();
 for(const entry of text.matchAll(/^DCL SVIEW\[(\d+)(?:\.\.(\d+))?\], 2D, (FLOAT|SINT|UINT)/gm))
  for(let index=+entry[1];index<=+(entry[2]??entry[1]);index++)types.set(index,{FLOAT:'sampler2D',SINT:'isampler2D',UINT:'usampler2D'}[entry[3]]);
 for(const sampler of body.metadata.samplers)counters.same(sampler.type,types.get(sampler.index),c.name+' original sampler '+sampler.index);
 if(stage==='fragment')for(const output of body.metadata.outputs)counters.same(output.type,
  c.selectors.signedColorMask&(1<<output.semanticIndex)?'ivec4':c.selectors.unsignedColorMask&(1<<output.semanticIndex)?'uvec4':'vec4',c.name+' host color type');
}
export function runContractAcceptance(data,module,{oldContract=null}={}){
 const c=checks(),records=[],historical=[];
 c.same(data.cases.length,data.native.length,'complete sealed original compiler records');
 for(const [index,input]of data.cases.entries()){
  const actual=originalCall(module,input);
  c.same(JSON.stringify(actual),JSON.stringify(data.native[index].result),input.name+' full actual C/Wasm response');
  if(input.kind<15){
   const paired=[2,9,10,11,14].includes(input.kind),stage=[0,7,12].includes(input.kind)?'vertex':'fragment';
   const method=input.kind<7?'Texture':input.kind<12?'':'Uniform';
   const name=paired?'normalizeStandard'+method+'ShaderPair':'normalizeStandard'+method+'ShaderResult';
   const selectors=Object.fromEntries(keys.slice(0,5).map(key=>[key,input.selectors[key]]));
   const args=paired?[actual,...(method?[selectors]:[])]:[actual,stage];
   const current=contract[name](...args);
   if(oldContract)c.same(JSON.stringify(current),JSON.stringify(oldContract[name](...args)),input.name+' historical normalized response bytes');
   historical.push({case:index,name:input.name,method:name,current,...(oldContract?{original:oldContract[name](...args)}:{})});
   continue;
  }
  const paired=[17,18,19].includes(input.kind),stage=input.kind===16?'fragment':'vertex',
   colors={signedColorMask:input.selectors.signedColorMask,unsignedColorMask:input.selectors.unsignedColorMask};
  const normalized=paired?contract.normalizeStandardMultipleColorShaderPair(actual,input.selectors):
   contract.normalizeStandardMultipleColorShaderResult(actual,stage,colors);
  const expected=actual.ok&&(paired?admitted(input.b,input.selectors):stage==='vertex'?
   !(colors.signedColorMask|colors.unsignedColorMask):admitted(input.a,input.selectors));
  c.same(normalized.ok,Boolean(expected),input.name+' original consumer admission');
  c.same(frozen(normalized),true,input.name+' recursive owned freezing');
  const row={case:index,name:input.name,expected,normalized};
  if(expected){
   if(paired){
    row.interface=contract.deriveStandardMultipleColorShaderInterface(actual.vertex.metadata,actual.fragment.metadata,input.selectors);
    c.ok(row.interface,input.name+' checked original pair interface');
    originals(input,normalized.vertex,'vertex',c);originals(input,normalized.fragment,'fragment',c);
    c.same(contract.normalizeStandardTextureShaderPair(actual).ok,false,'historical pair stays closed');
   }else{
    row.metadata=contract.parseStandardMultipleColorShaderMetadata(actual.metadata,stage,colors);c.ok(row.metadata,input.name+' owned metadata');
    originals(input,normalized,stage,c);c.same(contract.normalizeStandardTextureShaderResult(actual,stage).ok,false,'historical stage stays closed');
   }
  }
  records.push(row);
 }
 c.same(module.HEAPU8.byteLength,16777216,'carried actual fixed compiler memory');
 const baseline=data.cases.findIndex(input=>input.name.startsWith('hardware/')&&input.b.includes('CONSTANT')&&
  input.selectors.unsignedColorMask===1&&input.selectors.signedColorMask===0),
  input={...data.cases[baseline],name:'owned-flat-query-boundary',
   b:'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[5], COLOR\nDCL TEMP[0]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, UINT\nIMM[0] INT32 {0,0,0,0}\n0: TXQ TEMP[0].w, IMM[0], SAMP[0], 2D\n1: MOV OUT[5], IN[0]\n2: END\n'},
  pair=originalCall(module,input),selectors={...input.selectors},
  stage=pair.fragment,colors={signedColorMask:0,unsignedColorMask:1},attacks=[];let getters=0;
 const calls={
  metadata:(value,host=colors)=>contract.parseStandardMultipleColorShaderMetadata(value,'fragment',host),
  result:(value,host=colors)=>contract.normalizeStandardMultipleColorShaderResult(value,'fragment',host),
  pair:(value,host=selectors)=>contract.normalizeStandardMultipleColorShaderPair(value,host),
  interface:(value,host=selectors)=>contract.deriveStandardMultipleColorShaderInterface(value.vertex.metadata,value.fragment.metadata,host),
 };
 const bases={metadata:stage.metadata,result:{ok:true,...stage},pair,interface:pair};
 const reject=(method,label,value,host)=>{const answer=calls[method](value,host);c.same(answer.ok,false,'refuse '+method+'/'+label);
  c.same(frozen(answer),true,'owned refusal');attacks.push({method,label,answer});};
 for(const method of Object.keys(calls)){
  const base=bases[method],saved=JSON.stringify(calls[method](base));c.ok(calls[method](base),'owned '+method+' baseline');
  for(const [label,host]of [['negative',-1],['string','1'],['NaN',NaN],['fraction',.5],['infinite',Infinity],['boxed',new Number(1)],['extent',16]]){
   const wanted=method==='metadata'||method==='result'?colors:selectors;
   reject(method,'host-'+label,base,{...wanted,unsignedColorMask:host});
  }
  const wanted=method==='metadata'||method==='result'?colors:selectors;
  for(const host of [Object.create(wanted),{...wanted,guestKey:true},{...wanted,signedColorMask:1,unsignedColorMask:1},
   new Proxy({}, {ownKeys(){throw Error('ownkeys');}})])reject(method,'host-reflection',base,host);
  for(const key of Object.keys(wanted)){
   const host={...wanted};Object.defineProperty(host,key,{get(){getters++;return wanted[key];},enumerable:true});reject(method,'host-accessor-'+key,base,host);
  }
  if(method!=='interface'){
   for(const value of [null,[],5,Object.create(base),{...base,guestKey:1},new Proxy(base,{ownKeys(){throw Error('reflection');}})])reject(method,'strict-record',value);
   for(const key of Object.keys(base)){const value={...base};Object.defineProperty(value,key,{get(){getters++;return base[key];},enumerable:true});reject(method,'record-accessor-'+key,value);}
  }
  const owned=clone(base),answer=calls[method](owned);c.ok(answer,'owned snapshot '+method);
  const metadata=method==='metadata'?owned:method==='result'?owned.metadata:owned.fragment.metadata;
  metadata.samplers[0].type='borrowed';metadata.colorOutputMasks.unsignedMask=0;
  c.same(JSON.stringify(answer),saved,'caller mutation cannot alter '+method);
  const intrinsic=Object.values,defect=Error('trusted unexpected implementation defect');let observed;
  try{Object.values=()=>{throw defect;};calls[method](base);}catch(error){observed=error;}finally{Object.values=intrinsic;}
  c.same(observed===defect,true,'unexpected defects propagate from '+method);
 }
 const mutate=(label,fn)=>{const value=clone(pair);fn(value);reject('pair',label,value);};
 for(const type of ['samplerCube','ivec4',null,7,new String('usampler2D')])mutate('sampler-type',value=>{value.fragment.metadata.samplers[0].type=type;});
 mutate('sampler-duplicate',value=>{value.fragment.metadata.samplers.push({...value.fragment.metadata.samplers[0]});});
 mutate('sampler-inherited',value=>{value.fragment.metadata.samplers[0]=Object.create(value.fragment.metadata.samplers[0]);});
 mutate('output-sign',value=>{value.fragment.metadata.outputs[0].type='ivec4';});
 mutate('output-semantic',value=>{value.fragment.metadata.outputs[0].semanticIndex=1;});
 mutate('output-register',value=>{value.fragment.metadata.outputs[0].index=32;});
 mutate('output-extra',value=>{value.fragment.metadata.outputs.push({...value.fragment.metadata.outputs[0],index:2});});
 mutate('pair-key',value=>{value.interfaceKey+='borrowed';});
 mutate('unpromoted-flat',value=>{const generic=value.vertex.metadata.outputs.find(output=>output.semantic==='GENERIC');generic.interpolation='smooth';generic.type='vec4';});
 mutate('vertex-colors',value=>{value.vertex.metadata.colorOutputMasks.unsignedMask=1;});
 mutate('wrong-color-mask',value=>{value.fragment.metadata.colorOutputMasks.unsignedMask=0;});
 mutate('unknown-profile',value=>{value.fragment.metadata.profile=contract.STANDARD_TEXTURE_SHADER_PROFILE;});
 mutate('unknown-metadata',value=>{value.fragment.metadata.guestKey=1;});
 mutate('metadata-array-hole',value=>{delete value.fragment.metadata.samplers[0];});
 mutate('sampler-array-extent',value=>{value.fragment.metadata.samplers=Array(17).fill(value.fragment.metadata.samplers[0]);});
 mutate('array-extra',value=>{value.fragment.metadata.samplers.guest=1;});
 mutate('array-getter',value=>{Object.defineProperty(value.fragment.metadata.samplers,0,{get(){getters++;return null;},enumerable:true});});
 mutate('color-getter',value=>{Object.defineProperty(value.fragment.metadata.colorOutputMasks,'unsignedMask',{get(){getters++;return 1;},enumerable:true});});
 for(const method of ['result','pair']){
  const error={ok:false,error:{code:'translation-error',message:'original error'}};
  c.same(calls[method](error).error,error.error,'complete owned compiler refusal');
  for(const value of [{ok:0},{ok:true},{ok:false,error:{code:'',message:''}},{ok:false,error:{code:'x'.repeat(129),message:''}},
   {ok:false,error:{code:'x',message:'x'.repeat(4097)}},{ok:false,error:{code:'x',message:'x',guest:true}},
   {ok:false,error:{code:'x',message:'x'},glsl:'partial'},{...bases[method],glsl:'injected-extra'}])reject(method,'malformed-response',value);
 }
 reject('result','bad-version',{ok:true,...stage,glsl:'void main(){}'});
 reject('pair','large-source',{...pair,vertex:{...pair.vertex,glsl:'#version 300 es\n'+' '.repeat(262144)}});
 reject('metadata','vertex-host-colors',pair.vertex.metadata);
 c.same(contract.parseStandardMultipleColorShaderMetadata(pair.vertex.metadata,'vertex',colors).ok,false,'single vertex host color selection refuses');
 c.same(contract.normalizeStandardMultipleColorShaderResult({ok:true,...pair.vertex},'vertex',colors).ok,false,'single vertex result host color selection refuses');
 const fourSelectors={...zero(),signedColorMask:8,unsignedColorMask:5},fourInput={...input,name:'four-original-output-ownership',selectors:fourSelectors,
  a:'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n',
  b:'FRAG\nDCL OUT[5], COLOR[0]\nDCL OUT[13], COLOR[1]\nDCL OUT[7], COLOR[2]\nDCL OUT[1], COLOR[3]\nIMM[0] UINT32 {1,2,3,4}\n0: MOV OUT[5], IMM[0]\n1: MOV OUT[13], IMM[0]\n2: MOV OUT[7], IMM[0]\n3: MOV OUT[1], IMM[0]\n4: END\n'},
  four=originalCall(module,fourInput);
 c.ok(contract.normalizeStandardMultipleColorShaderPair(four,fourSelectors),'actual original four-output ownership baseline');
 const multipleAttack=(label,fn)=>{const value=clone(four);fn(value.fragment.metadata);reject('pair','multiple-'+label,value,fourSelectors);};
 multipleAttack('empty',m=>{m.outputs=[];});
 multipleAttack('count5',m=>{m.outputs.push({...m.outputs[0],index:30,semanticIndex:0});});
 multipleAttack('register-order',m=>{m.outputs.reverse();});
 multipleAttack('register-duplicate',m=>{m.outputs[1].index=m.outputs[0].index;});
 multipleAttack('semantic-duplicate',m=>{m.outputs[1].semanticIndex=m.outputs[0].semanticIndex;});
 multipleAttack('semantic4',m=>{m.outputs[0].semanticIndex=4;});
 multipleAttack('name',m=>{m.outputs[0].name='fsout_c0';});
 multipleAttack('type',m=>{m.outputs[0].type='vec4';});
 multipleAttack('broadcast-many',m=>{m.broadcastColor0=true;});
 multipleAttack('broadcast-string',m=>{m.broadcastColor0='true';});
 multipleAttack('output-getter',m=>{Object.defineProperty(m.outputs[0],'name',{get(){getters++;return 'fsout_c3';},enumerable:true});});
 multipleAttack('output-inherited',m=>{m.outputs[0]=Object.create(m.outputs[0]);});
 multipleAttack('output-key',m=>{m.outputs[0].guestKey=true;});
 const broadcastInput={...fourInput,name:'original-broadcast-ownership',b:'FRAG\nDCL OUT[5], COLOR\nPROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\nIMM[0] UINT32 {1,2,3,4}\n0: MOV OUT[5], IMM[0]\n1: END\n'},
  broadcast=originalCall(module,broadcastInput);
 c.ok(contract.normalizeStandardMultipleColorShaderPair(broadcast,fourSelectors),'actual original broadcast ownership baseline');
 for(const [label,change]of [['nonzero-semantic',m=>{m.outputs[0].semanticIndex=1;}],['missing-property',m=>{delete m.broadcastColor0;}],
  ['without-broadcast',m=>{m.broadcastColor0=false;}],['empty',m=>{m.outputs=[];}]]){
  const value=clone(broadcast);change(value.fragment.metadata);reject('pair','broadcast-'+label,value,fourSelectors);
 }
 const sparseSelectors={...zero(),unsignedColorMask:2},sparseInput={...fourInput,name:'original-sparse-selector-membership',selectors:sparseSelectors,
  b:'FRAG\nDCL OUT[13], COLOR[1]\nIMM[0] UINT32 {1,2,3,4}\n0: MOV OUT[13], IMM[0]\n1: END\n'},sparse=originalCall(module,sparseInput);
 c.ok(contract.normalizeStandardMultipleColorShaderPair(sparse,sparseSelectors),'actual sparse membership baseline');
 reject('pair','host-mask-for-unemitted-hole',sparse,{...sparseSelectors,unsignedColorMask:3});
 c.same(getters,0,'hostile records never invoke getters');
 return{status:'passed',cases:data.cases.length,selectedRecords:records.length,accepted:records.filter(row=>row.expected).length,
  records,historical,attacks,attackInput:input,attackCompiler:pair,multipleAttackInputs:[fourInput,broadcastInput,sparseInput],
  multipleAttackCompilers:[four,broadcast,sparse],getters,ownedSnapshots:true,predictions:c.rows};
}
