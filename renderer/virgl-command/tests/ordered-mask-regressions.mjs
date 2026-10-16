// Literal grammar and consumed-component authority through the actual Wasm API.
// Optional argv[2] supplies an isolated compiler artifact for sabotage checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';
const bridge=await createVirglShaderBridge(process.argv[2]?{wasmBinary:fs.readFileSync(process.argv[2])}:{});
const lanes='xyzw',masks=Array.from({length:15},(_,i)=>[...lanes].filter((_,j)=>(i+1)&(1<<j)).join(''));
let calls=0,accepted=0;
function check(stage,text,wanted,name){
 const result=bridge.translate({stage,text});calls++;
 assert.equal(result.ok,wanted,name);
 if(wanted)accepted++;
 else{assert.deepEqual(Object.keys(result).sort(),['error','ok']);assert.equal(typeof result.error.code,'string');assert.equal(typeof result.error.message,'string');}
}
function shader(stage,mask,swizzle,{partial=false,authority=null}={}){
 const header=stage==='vertex'?'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n':'FRAG\nDCL OUT[0], COLOR\n';
 let declarations='';
 if(authority)declarations=stage==='vertex'?'DCL OUT[1].'+authority+', GENERIC[0]\n':'DCL IN[0].'+authority+', GENERIC[0], PERSPECTIVE\n';
 const prefix=header+declarations+'DCL TEMP[0..1]\nIMM[0] UINT32 {11,22,33,44}\nIMM[1] FLT32 {0,0,0,1}\nMOV TEMP[0]'+(partial?'.x':'')+', IMM[0].xxxx\n';
 let operation='MOV_PRECISE TEMP[1].'+mask+', TEMP[0].'+swizzle+'\n';
 if(authority)operation=stage==='vertex'?'MOV OUT[1].'+authority+', IMM[1]\nMOV_PRECISE OUT[1].'+mask+', IMM[1].xxxx\n':'MOV_PRECISE TEMP[1].'+mask+', IN[0].xyzw\n';
 return prefix+operation+'MOV OUT[0], '+(stage==='vertex'?'IN[0]':'IMM[1]')+'\nEND\n';
}
function strings(length,prefix=''){
 if(!length)return[prefix];return[...lanes].flatMap(c=>strings(length-1,prefix+c));
}
for(const stage of ['vertex','fragment']){
 // Exhaustive near-boundary strings include duplicates, reversals and overflow.
 for(let length=0;length<=5;length++)for(const mask of strings(length)){
  const valid=mask.length>0&&mask.length<=4&&new Set(mask).size===mask.length&&[...mask].every((c,i)=>i===0||lanes.indexOf(mask[i-1])<lanes.indexOf(c));
  check(stage,shader(stage,mask,'wzyx'),valid,'mask '+stage+'/'+(mask||'empty'));
 }
 // Selectors on unused destination lanes cannot demand undefined source lanes.
 for(const mask of masks)for(const swizzle of strings(4)){
  const valid=[...mask].every(c=>swizzle[lanes.indexOf(c)]==='x');
  check(stage,shader(stage,mask,swizzle,{partial:true}),valid,'consumed '+stage+'/'+mask+'/'+swizzle);
 }
 for(const authority of ['xy','xyz'])for(const mask of masks)
  check(stage,shader(stage,mask,'xyzw',{authority}),[...mask].every(c=>authority.includes(c)),'authority '+stage+'/'+authority+'/'+mask);
}
assert.equal(calls,10470);assert.equal(accepted,788);
console.log(`${calls} ordered-mask grammar/authority regressions: ${accepted} admitted, ${calls-accepted} rejected`);
