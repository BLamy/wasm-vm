// Original D61 compiler responses are the authority; inputs remain caller-owned.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createVirglStandardDimensionalShadowTextureShaderBridge as create,
 createVirglStandardDimensionalTextureShaderBridge as previous} from '../../renderer/virgl-shader/standard.mjs';
import {parseStandardDimensionalShadowTextureShaderMetadata as parse,
 normalizeStandardDimensionalShadowTextureShaderResult as stage,
 normalizeStandardDimensionalShadowTextureShaderPair as pair,
 deriveStandardDimensionalShadowTextureShaderInterface as derive,
 normalizeStandardDimensionalTextureShaderResult as oldStage,
 normalizeStandardDimensionalTextureShaderPair as oldPair} from '../../renderer/virgl-command/constant-domain.mjs';
import {comparisonFixtures,comparisonText,pairTexts,zeroSelectors} from '../virgl-dimensional-shadow-shaders/fixtures.mjs';
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const bridge=await create(),oldBridge=await previous(),rows=[],clone=v=>JSON.parse(JSON.stringify(v));
const selectors={...zeroSelectors(),unsignedColorMask:1};
const checkedPair=value=>pair(value,selectors);
const frozen=v=>{if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);Object.values(v).forEach(frozen);}};
function check(name,input,result,okay){assert.equal(result.ok,okay,name);frozen(result);rows.push({name,input,result});}
let vertex,fragment,paired;
for(const f of comparisonFixtures()){
 const owner=f.stage,text=owner==='vertex'?f.vertexText:f.fragmentText,request={stage:owner,text};
 const raw=bridge.translate(request);assert.equal(raw.ok,true,f.name);
 check(f.name+'/stage',{request,response:raw},stage(raw,owner),true);
 check(f.name+'/parse',raw.metadata,parse(raw.metadata,owner),true);
 check(f.name+'/historical-stage-closed',raw,oldStage(raw,owner),false);
 const pairRequest={vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors},p=bridge.translatePairImages(pairRequest);
 assert.equal(p.ok,true,f.name);
 check(f.name+'/pair',{request:pairRequest,response:p},pair(p,f.selectors),true);
 check(f.name+'/interface',p,derive(p.vertex.metadata,p.fragment.metadata,f.selectors),true);
 check(f.name+'/historical-pair-closed',p,oldPair(p,f.selectors),false);
 if(owner==='fragment'&&f.target==='CUBE'&&f.opcode==='TEX'&&f.slot===7&&!f.explicit&&!f.label){paired=p;vertex={ok:true,...p.vertex};fragment=raw;}
}
assert.ok(paired);
for(const [name,edit] of [
 ['missing controls',m=>delete m.shadowUniforms],['odd controls',m=>m.shadowUniforms.pop()],
 ['duplicate controls',m=>m.shadowUniforms.push(...clone(m.shadowUniforms))],
 ['unsorted controls',m=>{const c=clone(m.shadowUniforms);c.forEach(v=>{v.index=0;v.name=v.name.replace('7','0');});m.samplers.unshift({index:0,name:'fssamp0',type:'samplerCubeShadow'});m.shadowUniforms.push(...c);}],
 ['slot overflow',m=>m.shadowUniforms[0].index=16],['different add slot',m=>m.shadowUniforms[1].index=0],
 ['mask stage',m=>m.shadowUniforms[0].name='vsshadmask7'],['add name',m=>m.shadowUniforms[1].name='fsshadadd0'],
 ['mask type',m=>m.shadowUniforms[0].type='uvec4'],['add type',m=>m.shadowUniforms[1].type='float'],
 ['mask semantic',m=>m.shadowUniforms[0].semantic='SHADOW_ADD'],['add semantic',m=>m.shadowUniforms[1].semantic='SHADOW_MASK'],
 ['guest mask authority',m=>m.shadowUniforms[0].value=[1,1,1,1]],['ordinary controls',m=>m.samplers[0].type='samplerCube'],
 ['missing sampler',m=>m.samplers=[]],['volume comparison',m=>m.samplers[0].type='sampler3DShadow'],
 ['sampler stage',m=>m.samplers[0].name='vssamp7'],['stage',m=>m.stage='vertex'],['profile',m=>m.profile+='x'],
 ['historical profile',m=>m.profile='virgl-webgl2-standard-dimensional-texture-gles3-v1'],
 ['extra metadata',m=>m.compareFunction=7],['extra sampler authority',m=>m.samplers[0].target=4],
 ['inherited index',m=>{const c=m.shadowUniforms[0];delete c.index;Object.setPrototypeOf(c,{index:7});}],
 ['array authority',m=>m.shadowUniforms.guest=true],['sparse array',m=>delete m.shadowUniforms[0]]
]){
 const r=clone(fragment);edit(r.metadata);check('stage refusal/'+name,r,stage(r,'fragment'),false);check('parse refusal/'+name,r.metadata,parse(r.metadata,'fragment'),false);
}
// Query-only comparison declarations have no result controls. Native reflection
// remains the authority when active GLSL has omitted its metadata controls.
const omitted=clone(fragment);omitted.metadata.shadowUniforms=[];check('reflection owns active-control omission',omitted,stage(omitted,'fragment'),true);
for(const [name,edit] of [['key',p=>p.interfaceKey+='x'],['glsl',p=>p.vertex.glsl='#version 100'],['extra',p=>p.guest=true],
 ['control name',p=>p.fragment.metadata.shadowUniforms[1].name='guest'],
 ['generic promotion',p=>p.vertex.metadata.outputs.find(v=>v.semantic==='GENERIC').interpolation='smooth']]){
 const p=clone(paired);edit(p);check('pair refusal/'+name,p,checkedPair(p),false);
}
for(const owner of ['vertex','fragment']){
 const text=owner==='vertex'?'VERT\nDCL OUT[0], POSITION\n0: END\n':'FRAG\nDCL OUT[0], COLOR\n0: END\n';
 const r=oldBridge.translate({stage:owner,text});check('historical result/'+owner,r,oldStage(r,owner),true);check('new profile closed/'+owner,r,stage(r,owner),false);
 const n=bridge.translate({stage:owner,text});check('old profile closed/'+owner,n,oldStage(n,owner),false);
}
for(const glsl of [null,'#version 100','x'.repeat(262145)]){const r=clone(fragment);r.glsl=glsl;check('GLSL refusal/'+String(glsl).length,r,stage(r,'fragment'),false);}
for(const v of [null,[],{}, {ok:0},{...fragment,extra:1}]){check('bad stage/'+rows.length,v,stage(v,'fragment'),false);check('bad pair/'+rows.length,v,pair(v),false);}
for(const [name,r,invoke] of [['stage',fragment,v=>stage(v,'fragment')],['parse',fragment.metadata,v=>parse(v,'fragment')],['pair',paired,checkedPair],['derive',vertex.metadata,v=>derive(v,paired.fragment.metadata,selectors)]]){
 let traps=0;check('throwing proxy/'+name,'ownKeys trap',invoke(new Proxy({}, {ownKeys(){traps++;throw Error('trap');}})),false);assert.equal(traps,1);
 const freeze=Object.freeze;try{Object.freeze=()=>{throw Error('freeze fault');};assert.throws(()=>invoke(r),{message:'freeze fault'});}finally{Object.freeze=freeze;}rows.push({name:'intrinsic fault/'+name,propagates:true});
}
let getters=0;const getter=clone(fragment);Object.defineProperty(getter.metadata.shadowUniforms[0],'index',{get(){getters++;throw Error('accessor');},enumerable:true});
check('getter refused without invocation','shadow index accessor',stage(getter,'fragment'),false);assert.equal(getters,0);
for(const invoke of [()=>stage({ok:false,error:{code:'unsupported-feature',message:'original refusal'}},'fragment'),()=>pair({ok:false,error:{code:'unsupported-feature',message:'original refusal'}})])check('compiler refusal',null,invoke(),false);
check('interface refusal',null,derive({},{},zeroSelectors()),false);
const mutable=clone(fragment),owned=stage(mutable,'fragment');mutable.metadata.shadowUniforms[0].index=0;assert.equal(owned.metadata.shadowUniforms[0].index,7);
rows.push({name:'owned immutable metadata',original:mutable,result:owned});
await fs.writeFile(path.join(output,'metadata.json'),JSON.stringify({status:'passed',rows,getters,actualLinuxGuest:false,productionAuthority:false},null,2)+'\n');
console.log(JSON.stringify({metadataRows:rows.length,getters}));
