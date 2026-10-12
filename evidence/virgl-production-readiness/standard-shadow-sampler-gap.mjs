// Reproduce the consumer gap at the independently verified shadow compiler head.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglStandardShadowTextureShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {parseStandardInstanceBaseShaderMetadata} from '../../renderer/virgl-command/constant-domain.mjs';
import {decodeStandardStencilSubmission} from '../../renderer/virgl-command/decoder.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.argv[2]);
const bridge=await createVirglStandardShadowTextureShaderBridge(), shaders=[],samplers=[];
for(const stage of ['vertex','fragment']){
 const text=(stage==='vertex'?'VERT\nDCL OUT[0], POSITION\n':'FRAG\nDCL OUT[0], COLOR\n')+
  'DCL SAMP[7]\nDCL SVIEW[7], 2D, FLOAT\nIMM[0] FLT32 {0.5,0.5,0.5,1.0}\n0: TEX OUT[0], IMM[0], SAMP[7], SHADOW2D\n1: END\n';
 const request={stage,text},result=bridge.translate(request),consumer=parseStandardInstanceBaseShaderMetadata(result.metadata,stage);
 assert.equal(result.ok,true);assert.equal(consumer.ok,false);assert.equal(consumer.error.code,'shader-domain-error');
 shaders.push({request,result,consumer});
}
for(const compareMode of [0,1])for(let compareFunction=0;compareFunction<8;compareFunction++){
 const words=[(9<<16)|(7<<8)|1,77,2|(2<<3)|(2<<6)|(2<<11)|(compareMode<<15)|(compareFunction<<16),0,0,0,0,0,0,0],bytes=new Uint8Array(40),view=new DataView(bytes.buffer);
 words.forEach((word,i)=>view.setUint32(i*4,word,true));const result=decodeStandardStencilSubmission(bytes);
 assert.equal(result.ok,compareMode===0);if(compareMode)assert.equal(result.error.code,'unsupported-feature');
 samplers.push({compareMode,compareFunction,words,bytes:[...bytes],result});
}
const paths=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/state.mjs','renderer/virgl-shader/standard.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','evidence/virgl-shadow-shaders/worker/manifest.json','evidence/virgl-shadow-shaders/verifier/manifest.json'];
const pins=paths.map(path=>{const raw=fs.readFileSync(path);return{path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
const record={schema:'original-shadow-sampler-gap-v1',sourceHead:head,shaders,samplers,pins,nativeDrawExecuted:false,guestExecution:false,productionAuthority:false};
fs.writeFileSync(process.argv[3],JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({head,compilerAdmissions:2,consumerRefusals:2,samplerRefusals:8,ordinaryControls:8,nativeDrawExecuted:false}));
