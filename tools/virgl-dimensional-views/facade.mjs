#!/usr/bin/env node
// Complete own-data contracts and historical responses, with actual D57 output.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createVirglStandardDimensionalTextureShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import * as domain from '../../renderer/virgl-command/constant-domain.mjs';
import * as decoders from '../../renderer/virgl-command/decoder.mjs';
import {cases,packet} from './fixtures.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [directory,predecessor]=process.argv.slice(2);assert.ok(directory&&predecessor);
const out=path.resolve(directory);await fs.mkdir(out,{recursive:true});
const clone=value=>JSON.parse(JSON.stringify(value));
const bytes=hex=>new Uint8Array(Buffer.from(hex,'hex'));
const masks={signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:0,unsignedColorMask:1};
const rows=[],bridge=await createVirglStandardDimensionalTextureShaderBridge();
const baseline=JSON.parse(await fs.readFile(path.join(predecessor,'baseline.json')));
const old=await import(pathToFileURL(path.join(predecessor,'historical/renderer/virgl-command/decoder.mjs')));
const parse=domain.parseStandardDimensionalTextureShaderMetadata,normalize=domain.normalizeStandardDimensionalTextureShaderResult;
const pair=(value)=>domain.normalizeStandardDimensionalTextureShaderPair(value,masks),derive=(vertex,fragment)=>domain.deriveStandardDimensionalTextureShaderInterface(vertex,fragment,masks);
function check(name,input,result,ok){rows.push({name,input,result});assert.equal(result.ok,ok,name);return result;}
for(const row of baseline.shaderRows){
 const result=bridge.translate(row.request);assert.deepEqual(result,row.response,'exact held compiler body');
 const owned=check('stage/'+row.stage+'/'+row.target+'/'+row.type+'/'+row.opcode,row.request,normalize(result,row.stage),true);
 assert.deepEqual(owned.metadata,result.metadata);assert.notEqual(owned.metadata,result.metadata);
 check('metadata/'+row.stage+'/'+row.target+'/'+row.type+'/'+row.opcode,result.metadata,parse(result.metadata,row.stage),true);
}
for(const row of [...baseline.viewRows,...baseline.positiveControls.filter(r=>r.kind==='historical-2D-view')]){
 const request=bytes(row.hex??Buffer.from(new Uint32Array(row.words).buffer).toString('hex'));
 const actual=decoders[row.decoder](request);assert.deepEqual(actual,row.response);assert.deepEqual(actual,old[row.decoder](request));
 rows.push({name:'historical/'+row.decoder,input:[...request],result:actual});
}
for(const f of cases()){
 const request={vertexText:f.vertexText,fragmentText:f.fragmentText,...masks};
 const translated=bridge.translatePairImages(request);assert.equal(translated.ok,true,f.name);
 check('pair/'+f.name,request,pair(translated),true);
 check('interface/'+f.name,{vertex:translated.vertex.metadata,fragment:translated.fragment.metadata},derive(translated.vertex.metadata,translated.fragment.metadata),true);
}
const specimen=clone(baseline.shaderRows.find(r=>r.stage==='fragment'&&r.target==='3D'&&r.type==='FLOAT').response);
const selected=cases().find(f=>f.stage==='vertex'&&f.opcode==='TXL');
const specimenPair=clone(bridge.translatePairImages({vertexText:selected.vertexText,fragmentText:selected.fragmentText,...masks}));
let traps=0;
const revoked=()=>{const r=Proxy.revocable({},{});r.revoke();return r.proxy;};
const accessor=()=>{const value=clone(specimen.metadata);Object.defineProperty(value,'samplers',{get(){traps++;return [];},enumerable:true});return value;};
const badMetadata=[
 ['null',()=>null],['array',()=>[]],['revoked',revoked],['accessor',accessor],
 ['extra',()=>({...clone(specimen.metadata),extra:1})],['missing',()=>{const m=clone(specimen.metadata);delete m.shadowUniforms;return m;}],
 ['profile',()=>({...clone(specimen.metadata),profile:'virgl-webgl2-standard-shadow-texture-gles3-v1'})],
 ['type',()=>{const m=clone(specimen.metadata);m.samplers[0].type='samplerCubeArray';return m;}],
 ['coercion',()=>{const m=clone(specimen.metadata);m.samplers[0].type={toString(){traps++;return 'sampler3D';}};return m;}],
 ['sampler-accessor',()=>{const m=clone(specimen.metadata);Object.defineProperty(m.samplers[0],'type',{get(){traps++;return 'sampler3D';},enumerable:true});return m;}],
 ['sampler-extra',()=>{const m=clone(specimen.metadata);m.samplers[0].extra=1;return m;}],
 ['sampler-revoked',()=>{const m=clone(specimen.metadata);m.samplers[0]=revoked();return m;}],
 ['sampler-hole',()=>{const m=clone(specimen.metadata);delete m.samplers[0];return m;}],
 ['sampler-array-extra',()=>{const m=clone(specimen.metadata);m.samplers.extra=1;return m;}],
 ['sampler-count',()=>{const m=clone(specimen.metadata);m.samplers=Array(17).fill(m.samplers[0]);return m;}],
 ['stage',()=>({...clone(specimen.metadata),stage:'vertex'})],
 ['index',()=>{const m=clone(specimen.metadata);m.samplers[0].index=16;return m;}],
 ['name',()=>{const m=clone(specimen.metadata);m.samplers[0].name='vssamp7';return m;}]
];
for(const [name,make]of badMetadata){
 const m=make();check('bad-metadata/'+name,{shape:name},parse(m,'fragment'),false);
 check('bad-stage-metadata/'+name,{shape:name},normalize({...specimen,metadata:m},'fragment'),false);
 check('bad-pair-metadata/'+name,{shape:name},pair({...specimenPair,fragment:{...specimenPair.fragment,metadata:m}}),false);
 check('bad-interface-metadata/'+name,{shape:name},derive(specimenPair.vertex.metadata,m),false);
}
const badBodies=[null,[],{ok:1}, {...specimen,extra:1},{...specimen,glsl:3},{...specimen,glsl:'void main(){}'}, {...specimen,glsl:'#version 300 es\n'+' '.repeat(262145)}, {ok:false,error:{code:'original-test-error',message:'original rejection'},extra:1}];
for(const [i,value]of badBodies.entries())check('bad-stage-body/'+i,value,normalize(value,'fragment'),false);
for(const [i,value]of [null,[],{ok:1},{...specimenPair,extra:1},{...specimenPair,interfaceKey:'wrong'},{...specimenPair,vertex:{...specimenPair.vertex,extra:1}},{...specimenPair,fragment:{...specimenPair.fragment,glsl:'invalid'}}].entries())check('bad-pair-body/'+i,value,pair(value),false);
for(const error of [{code:'original-test-error',message:'original rejection'},{code:7,message:'bad'}]){
 check('compiler-error',error,normalize({ok:false,error},'fragment'),false);check('pair-error',error,pair({ok:false,error}),false);
}
const owned=parse(specimen.metadata,'fragment');specimen.metadata.samplers[0].type='samplerCube';assert.equal(owned.metadata.samplers[0].type,'sampler3D');assert.ok(Object.isFrozen(owned.metadata.samplers[0]));
assert.equal(traps,0,'metadata admission never evaluates accessor or scalar coercion');
for(const target of [3,4,7])for(const [first,last,firstLayer,lastLayer]of [[0,2,0,target===4?5:0],[1,1,target===7?1:0,target===4?5:target===7?3:0]]){
 const request=packet(1,6,[51,6,67|target<<24,firstLayer|lastLayer<<16,first|last<<8,0x688]);
 const result=check('selected-view/'+target,{words:[...new Uint32Array(request.buffer)]},decoders.decodeStandardDimensionalViewSubmission(request),true);
 assert.deepEqual(result.commands[0].fields,{handle:51,resourceHandle:6,format:67,target,firstLayer,lastLayer,firstLevel:first,lastLevel:last,swizzle:[0,1,2,3]});
}
for(const [target,format,layers,levels,swizzle]of [[3,196,0,512,0x688],[3,67,1,512,0x688],[4,67,4<<16,512,0x688],[7,67,0|2048<<16,512,0x688],[7,67,2|1<<16,512,0x688],[3,67,0,3|2<<8,0x688],[3,67,0,15<<8,0x688],[3,67,0,512,6],[6,67,0,512,0x688],[5,67,0,512,0x688]]){
 const request=packet(1,6,[51,6,format|target<<24,layers,levels,swizzle]);check('bad-original-view',{target,format,layers,levels,swizzle},decoders.decodeStandardDimensionalViewSubmission(request),false);
}
// Inject an internal built-in failure to prove unexpected exceptions propagate
// intact, while adversarial guest records above stay ordinary domain refusals.
for(const [name,invoke]of [['metadata',()=>parse(specimen.metadata,'fragment')],['stage',()=>normalize(specimen,'fragment')],['pair',()=>pair(specimenPair)],['interface',()=>derive(specimenPair.vertex.metadata,specimenPair.fragment.metadata)]]){
 const original=Object.hasOwn,fault=new Error('original internal fault/'+name);
 try{Object.hasOwn=()=>{throw fault;};assert.throws(invoke,error=>error===fault);rows.push({name:'unexpected-fault/'+name,input:{fault:fault.message},result:{propagatedIdentity:true}});}finally{Object.hasOwn=original;}
}
for(const format of [5,225,18,16,20]){const request=packet(1,6,[51,6,format|2<<24,0,0,0x688]);check('qualified-2D-format/'+format,{format},decoders.decodeStandardDimensionalViewSubmission(request),true);}
const sourcePaths=['renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/decoder.mjs','tools/virgl-dimensional-views/facade.mjs'];
const sources={};for(const relative of sourcePaths){const raw=await fs.readFile(path.join(repo,relative));sources[relative]={bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};const file=path.join(out,'source',relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,raw);}
await fs.writeFile(path.join(out,'results.json'),JSON.stringify({schema:'dimensional-view-facade-v1',status:'passed',sources,rows,traps},null,2)+'\n');
console.log(JSON.stringify({status:'passed',contracts:rows.length,historicalDecoderResults:76,compilerBodies:54,traps}));
