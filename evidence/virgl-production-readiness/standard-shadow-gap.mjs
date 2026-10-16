// Original shadow compiler/sampler readiness at the independently verified D47 head.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglStandardInstanceBaseShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {decodeStandardStencilSubmission} from '../../renderer/virgl-command/decoder.mjs';
const frozen=process.argv[2];
assert.match(frozen??'',/^[0-9a-f]{40}$/);
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,frozen);
const selected=await createVirglStandardInstanceBaseShaderBridge();
const records=[];
const make=(stage,target,declaration='2D',opcode='TEX')=>{
 const lines=[stage==='vertex'?'VERT':'FRAG'];
 if(stage==='vertex')lines.push('DCL IN[0]','DCL OUT[0], POSITION');
 else lines.push('DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR');
 lines.push('DCL SAMP[0]',`DCL SVIEW[0], ${declaration}, FLOAT`);
 const operands=opcode==='TXD'?'IN[0], IN[0], IN[0]':'IN[0]';
 lines.push(`0: ${opcode} OUT[0], ${operands}, SAMP[0], ${target}`,'1: END');
 return lines.join('\n')+'\n';
};
for(const stage of ['vertex','fragment']){
 const control={stage,text:make(stage,'2D')};const result=selected.translate(control);
 assert.equal(result.ok,true);records.push({kind:'positive-ordinary-2D-control',request:control,result});
 for(const declaration of ['2D','SHADOW2D'])for(const opcode of ['TEX','TXL','TXD','TXB','TXQ','TXP']){
  if(stage==='vertex'&&opcode==='TXB')continue;
  const request={stage,text:make(stage,'SHADOW2D',declaration,opcode)},result=selected.translate(request);
  assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');
  records.push({kind:'original-shadow-refusal',declaration,opcode,request,result});
 }
}
// Original sampler-state packet: object7, nine payload words, real mode/function fields.
const samplerRecords=[];
for(const compareMode of [0,1])for(let compareFunction=0;compareFunction<8;++compareFunction){
 const words=[(9<<16)|(7<<8)|1,77,2|(2<<3)|(2<<6)|(2<<11)|(compareMode<<15)|(compareFunction<<16),0,0,0,0,0,0,0];
 const bytes=new Uint8Array(40),view=new DataView(bytes.buffer);words.forEach((word,i)=>view.setUint32(i*4,word,true));
 const result=decodeStandardStencilSubmission(bytes);
 assert.equal(result.ok,compareMode===0);
 if(compareMode)assert.equal(result.error.code,'unsupported-feature');
 samplerRecords.push({compareMode,compareFunction,words,bytes:Array.from(bytes),result});
}
const paths=['evidence/virgl-production-readiness/standard-shadow-gap.mjs','renderer/virgl-shader/standard.mjs','renderer/virgl-shader/standard_guard.c','renderer/virgl-shader/standard_guard.h','renderer/virgl-shader/standard_emit.c','renderer/virgl-shader/bridge.c','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','renderer/virgl-shader/vendor/src/virgl_protocol.h','renderer/virgl-shader/vendor/src/vrend/vrend_shader.c','renderer/virgl-command/decoder.mjs','tools/virgl-floating-depth-consumer/primary/vrend_renderer.c','tools/virgl-instance-base/primary/glsl-es-3.00.6.pdf'];
const pins=paths.map(path=>{const raw=fs.readFileSync(path);return {path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
const record={schema:'original-shadow-compiler-sampler-gap-v1',sourceHead:head,records,samplerRecords,pins,nativeDrawExecuted:false,guestExecution:false,productionAuthority:false};
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({head,compilerRefusals:records.filter(r=>r.kind==='original-shadow-refusal').length,ordinaryControls:2,samplerRefusals:8,nativeDrawExecuted:false}));
