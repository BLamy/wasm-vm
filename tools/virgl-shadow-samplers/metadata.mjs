import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createVirglStandardShadowTextureShaderBridge as create,createVirglStandardInstanceBaseShaderBridge as oldCreate} from '../../renderer/virgl-shader/standard.mjs';
import {parseStandardShadowTextureShaderMetadata as parse,normalizeStandardShadowTextureShaderResult as stage,
 normalizeStandardShadowTextureShaderPair as pair,deriveStandardShadowTextureShaderInterface as derive,
 normalizeStandardInstanceBaseShaderResult as oldStage} from '../../renderer/virgl-command/constant-domain.mjs';
import {decodeStandardShadowSamplerSubmission as decode,decodeStandardStencilSubmission as oldDecode} from '../../renderer/virgl-command/decoder.mjs';
import {pairTexts,zeroSelectors,originalSamplerWords,shadowText} from '../virgl-shadow-shaders/fixtures.mjs';
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const bridge=await create(),oldBridge=await oldCreate(),rows=[],clone=value=>JSON.parse(JSON.stringify(value));
const frozen=value=>{if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);Object.values(value).forEach(frozen);}};
function check(name,original,result,ok){assert.equal(result.ok,ok,name);frozen(result);rows.push({name,original,result});}
let vertex,fragment,paired;
for(const owner of ['vertex','fragment'])for(const slot of [0,7,15])for(const opcode of ['TEX','TXL','TXD','TXP','TXQ',...(owner==='fragment'?['TXB']:[])]){
 const text=shadowText(owner,{slot,opcode}),r=bridge.translate({stage:owner,text});assert.equal(r.ok,true);
 check(owner+'/'+slot+'/'+opcode+'/stage',r,stage(r,owner),true);check(owner+'/'+slot+'/'+opcode+'/parse',r.metadata,parse(r.metadata,owner),true);
 const request={...pairTexts(owner,{slot,opcode}),...zeroSelectors()},p=bridge.translatePairImages(request);
 check(owner+'/'+slot+'/'+opcode+'/pair',p,pair(p),true);check(owner+'/'+slot+'/'+opcode+'/interface',p,derive(p.vertex.metadata,p.fragment.metadata),true);
 if(owner==='fragment'&&slot===7&&opcode==='TEX'){paired=p;vertex={ok:true,...p.vertex};fragment={ok:true,...p.fragment};}
}
for(const owner of ['vertex','fragment']){
 const r=bridge.translate({stage:owner,text:shadowText(owner,{unused:true})});
 check(owner+'/unused',r,stage(r,owner),true);assert.deepEqual(r.metadata.shadowUniforms,[]);
}
for(const [name,edit] of [
 ['missing controls',m=>delete m.shadowUniforms],['odd controls',m=>m.shadowUniforms.pop()],
 ['duplicate pair',m=>m.shadowUniforms.push(...clone(m.shadowUniforms))],['unsorted pair',m=>{const p=clone(m.shadowUniforms);p.forEach(v=>{v.index=0;v.name=v.name.replace('7','0');});m.samplers.unshift({index:0,name:'fssamp0',type:'sampler2DShadow'});m.shadowUniforms.push(...p);}],
 ['slot',m=>m.shadowUniforms[0].index=16],['different add slot',m=>m.shadowUniforms[1].index=0],
 ['name',m=>m.shadowUniforms[0].name='vsshadmask7'],['add name',m=>m.shadowUniforms[1].name='fsshadadd0'],
 ['mask type',m=>m.shadowUniforms[0].type='uvec4'],['add type',m=>m.shadowUniforms[1].type='float'],
 ['mask semantic',m=>m.shadowUniforms[0].semantic='SHADOW_ADD'],['add semantic',m=>m.shadowUniforms[1].semantic='SHADOW_MASK'],
 ['extra authority',m=>m.shadowUniforms[0].value=[1,1,1,1]],['regular sampler control',m=>m.samplers[0].type='sampler2D'],
 ['no sampler',m=>m.samplers=[]],['bad sampler',m=>m.samplers[0].type='samplerCubeShadow'],
 ['stage',m=>m.stage='vertex'],['profile',m=>m.profile+='x'],['extra metadata',m=>m.compareFunction=7],
 ['inherited mask index',m=>{const x=m.shadowUniforms[0];delete x.index;Object.setPrototypeOf(x,{index:7});}],
 ['array property',m=>m.shadowUniforms.guest=true],['sparse array',m=>delete m.shadowUniforms[0]]]){
 const r=clone(fragment);edit(r.metadata);check('refusal '+name,r,stage(r,'fragment'),false);check('parse refusal '+name,r.metadata,parse(r.metadata,'fragment'),false);
}
// No controls is valid for query-only declarations. Missing active controls are
// rejected at native reflection, where actual execution provides authority.
const omitted=clone(fragment);omitted.metadata.shadowUniforms=[];check('native reflection owns omitted-active check',omitted,stage(omitted,'fragment'),true);
for(const [name,edit] of [['key',p=>p.interfaceKey+='x'],['glsl',p=>p.vertex.glsl='#version 100'],['extra',p=>p.guest=true],['mask',p=>p.fragment.metadata.shadowUniforms[1].name='guest']]){
 const p=clone(paired);edit(p);check('pair refusal '+name,p,pair(p),false);
}
const generic=bridge.translatePairImages({...pairTexts('fragment'),...zeroSelectors()});
const wrongPromotion=clone(generic);wrongPromotion.vertex.metadata.outputs.find(x=>x.semantic==='GENERIC').interpolation='smooth';
check('pair promotion refusal',wrongPromotion,pair(wrongPromotion),false);
for(const owner of ['vertex','fragment']){
 const text=owner==='vertex'?'VERT\nDCL OUT[0], POSITION\n0: END\n':'FRAG\nDCL OUT[0], COLOR\n0: END\n';
 const r=oldBridge.translate({stage:owner,text});check('historical stage '+owner,r,oldStage(r,owner),true);check('profile closed '+owner,r,stage(r,owner),false);
 const n=bridge.translate({stage:owner,text});check('old parser closed '+owner,n,oldStage(n,owner),false);
}
for(const glsl of [null,'#version 100','x'.repeat(262145)]){const r=clone(fragment);r.glsl=glsl;check('bad glsl '+String(glsl).length,r,stage(r,'fragment'),false);}
for(const v of [null,[],{}, {ok:0},{ok:true,...fragment,extra:1}]){check('bad stage '+rows.length,v,stage(v,'fragment'),false);check('bad pair '+rows.length,v,pair(v),false);}
for(const [name,r,invoke] of [['stage',fragment,v=>stage(v,'fragment')],['parse',fragment.metadata,v=>parse(v,'fragment')],['pair',paired,pair],['derive',vertex.metadata,v=>derive(v,fragment.metadata)]]){
 let traps=0;check('throwing proxy '+name,'ownKeys trap',invoke(new Proxy({}, {ownKeys(){traps++;throw Error('trap');}})),false);assert.equal(traps,1);
 const old=Object.freeze;try{Object.freeze=()=>{throw Error('freeze fault');};assert.throws(()=>invoke(r),{message:'freeze fault'});}finally{Object.freeze=old;}rows.push({name:'intrinsic fault '+name,propagates:true});
}
let getters=0;const getter=clone(fragment);Object.defineProperty(getter.metadata.shadowUniforms[0],'index',{get(){getters++;throw Error('accessor');},enumerable:true});
check('getter without invocation','shadow index accessor',stage(getter,'fragment'),false);assert.equal(getters,0);
for(const invoke of [()=>stage({ok:false,error:{code:'unsupported-feature',message:'native refusal'}},'fragment'),()=>pair({ok:false,error:{code:'unsupported-feature',message:'native refusal'}})])check('compiler error',null,invoke(),false);
check('interface refusal',null,derive({},{},zeroSelectors()),false);
for(const compareMode of [0,1])for(let compareFunction=0;compareFunction<8;compareFunction++){
 const words=originalSamplerWords({filter:'nearest',compareFunction});words[2]=(words[2]&~(1<<15))|(compareMode<<15);
 const bytes=new Uint8Array(new Uint32Array(words).buffer),result=decode(bytes),prior=oldDecode(bytes);
 check('original sampler '+compareMode+'/'+compareFunction,{words},result,true);check('historical sampler '+compareMode+'/'+compareFunction,{words},prior,compareMode===0);
 assert.equal(result.commands[0].fields.compareMode,compareMode);assert.equal(result.commands[0].fields.compareFunction,compareFunction);
 if(!compareMode)assert.deepEqual(result.commands,prior.commands);
}
for(const bits of [1<<10,1<<14,3<<11,1<<20,1]){
 const words=originalSamplerWords({filter:'nearest',compareFunction:3});words[2]|=bits;
 check('original reserved/unsupported '+bits,{words},decode(new Uint8Array(new Uint32Array(words).buffer)),false);
}
const mutable=clone(fragment),owned=stage(mutable,'fragment');mutable.metadata.shadowUniforms[0].index=0;assert.equal(owned.metadata.shadowUniforms[0].index,7);
await fs.writeFile(path.join(output,'metadata.json'),JSON.stringify({status:'passed',rows,getters,guestExecution:false},null,2)+'\n');
console.log(JSON.stringify({metadataRows:rows.length,getters}));
