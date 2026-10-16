#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createVirglStandardShadowTextureShaderBridge as create} from '../../../renderer/virgl-shader/standard.mjs';
import {normalizeStandardShadowTextureShaderResult as normalize,parseStandardShadowTextureShaderMetadata as parse} from '../../../renderer/virgl-command/constant-domain.mjs';
import {decodeStandardShadowSamplerSubmission as decode,decodeStandardStencilSubmission as historical} from '../../../renderer/virgl-command/decoder.mjs';
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});const bridge=await create(),rows=[],clone=v=>JSON.parse(JSON.stringify(v));
const freeze=v=>{if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);for(const x of Object.values(v))freeze(x);}};
for(const stage of ['vertex','fragment']){
 const text=(stage==='vertex'?'VERT\nDCL OUT[0], POSITION\n':'FRAG\nDCL OUT[0], COLOR\n')+'DCL SAMP[13]\nDCL SVIEW[13], 2D, FLOAT\nDCL SAMP[1]\nDCL SVIEW[1], 2D, FLOAT\nDCL TEMP[0..1]\nIMM[0] FLT32 {0.25,0.75,0.5,2}\n0: TXP TEMP[0], IMM[0], SAMP[13], SHADOW2D\n1: TEX TEMP[1], IMM[0], SAMP[1], SHADOW2D\n2: XOR OUT[0], TEMP[0], TEMP[1]\n3: END\n';
 const response=bridge.translate({stage,text});assert.equal(response.ok,true);const checked=normalize(response,stage);assert.equal(checked.ok,true);freeze(checked);
 const prefix=stage==='vertex'?'vs':'fs';assert.deepEqual(checked.metadata.shadowUniforms.map(u=>[u.index,u.name,u.semantic]),[[1,prefix+'shadmask1','SHADOW_MASK'],[1,prefix+'shadadd1','SHADOW_ADD'],[13,prefix+'shadmask13','SHADOW_MASK'],[13,prefix+'shadadd13','SHADOW_ADD']]);
 rows.push({name:stage+'/two-sparse-slots-original',request:{stage,text},response,checked});
 for(const [name,edit]of [
  ['cross-stage-authority',m=>m.shadowUniforms.forEach(u=>u.name=(stage==='vertex'?'fs':'vs')+u.name.slice(2))],
  ['non-adjacent-pairs',m=>{[m.shadowUniforms[1],m.shadowUniforms[2]]=[m.shadowUniforms[2],m.shadowUniforms[1]];}],
  ['same-slot-duplicate',m=>m.shadowUniforms.push(...clone(m.shadowUniforms.slice(0,2)))],
  ['undeclared-slot-authority',m=>m.shadowUniforms.slice(2).forEach(u=>{u.index=15;u.name=u.name.replace('13','15');})],
  ['ordinary-type-authority',m=>m.samplers.find(s=>s.index===13).type='sampler2D'],
  ['mask-add-reversed',m=>m.shadowUniforms.slice(2).reverse().forEach((u,i)=>m.shadowUniforms[i+2]=u)],
  ['hidden-value-authority',m=>Object.defineProperty(m.shadowUniforms[0],'value',{value:[1,0,1,0]})],
  ['symbol-authority',m=>m.shadowUniforms[0][Symbol('guest')]=7]
 ]){const r=clone(response);edit(r.metadata);const result=normalize(r,stage);assert.equal(result.ok,false,name);freeze(result);rows.push({name:stage+'/'+name,response:r,result});}
 let getters=0;const r=clone(response);Object.defineProperty(r.metadata.shadowUniforms[2],'name',{get(){getters++;return prefix+'shadmask13';},enumerable:true});const result=normalize(r,stage);assert.equal(result.ok,false);assert.equal(getters,0);rows.push({name:stage+'/uninvoked-accessor',getters,result});
 const mutable=clone(response),owned=normalize(mutable,stage);mutable.metadata.shadowUniforms[0].semantic='SHADOW_ADD';mutable.metadata.samplers[0].index=0;assert.equal(owned.metadata.shadowUniforms[0].semantic,'SHADOW_MASK');assert.equal(owned.metadata.samplers[0].index,1);rows.push({name:stage+'/owned-deep-custody',owned});
 const q=text.replace(/0: TXP[^\n]*\n1: TEX[^\n]*\n2: XOR[^\n]*\n3: END\n/,'0: TXQ OUT[0], IMM[1], SAMP[13], SHADOW2D\n1: END\n').replace('0: TXQ','IMM[1] INT32 {0,0,0,0}\n0: TXQ');const qr=bridge.translate({stage,text:q});assert.equal(qr.ok,true);assert.deepEqual(qr.metadata.shadowUniforms,[]);assert.equal(parse(qr.metadata,stage).ok,true);rows.push({name:stage+'/query-declarations-no-authority',response:qr});
}
for(const mode of [0,1])for(let fn=0;fn<8;fn++)for(const wrap of [0,2,4]){
 const words=[1|7<<8|9<<16,88,wrap|wrap<<3|wrap<<6|1<<9|1<<11|1<<13|mode<<15|fn<<16,0,0xc0000000,0x40800000,0,0,0,0],raw=new Uint8Array(new Uint32Array(words).buffer),r=decode(raw),old=historical(raw);assert.equal(r.ok,true);assert.equal(r.commands[0].fields.compareMode,mode);assert.equal(r.commands[0].fields.compareFunction,fn);assert.equal(old.ok,mode===0);if(!mode)assert.deepEqual(r.commands,old.commands);rows.push({name:'original-function-mode-wrap/'+mode+'/'+fn+'/'+wrap,words,result:r,historical:old});
}
await fs.writeFile(path.join(output,'metadata.json'),JSON.stringify({status:'passed',rows,rowsCount:rows.length,guestExecution:false,productionNegotiation:false},null,2)+'\n');console.log(JSON.stringify({status:'passed',rows:rows.length}));
