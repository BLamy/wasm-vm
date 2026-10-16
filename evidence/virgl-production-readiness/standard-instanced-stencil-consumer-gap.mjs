// Exact predecessor metadata readiness. No native or guest draw is asserted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglStandardInstanceBaseShaderBridge,createVirglStandardIntegerImageShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {normalizeStandardMultipleColorShaderResult,normalizeStandardMultipleColorShaderPair} from '../../renderer/virgl-command/constant-domain.mjs';
import {vertex,fragment} from '../../tools/virgl-ordered-stencil/fixtures.mjs';
const frozen='a19b49441e932e64446f756cefe0c18e6b5b71b3';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,frozen,'record only the exact verified predecessor');
const selected=await createVirglStandardInstanceBaseShaderBridge(),historical=await createVirglStandardIntegerImageShaderBridge();
const vertexText=vertex(.25),fragmentText=fragment(false);
const selectors={signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:0,unsignedColorMask:0};
const requests=[{kind:'vertex',request:{stage:'vertex',text:vertexText,signedColorMask:0,unsignedColorMask:0}},
 {kind:'fragment',request:{stage:'fragment',text:fragmentText,signedColorMask:0,unsignedColorMask:0}},
 {kind:'pair',request:{vertexText,fragmentText,...selectors}}];
const records=requests.map(({kind,request})=>{
 const actual=kind==='pair'?selected.translatePairImages(request):selected.translateImages(request),
  old=kind==='pair'?historical.translatePairImages(request):historical.translateImages(request),
  check=result=>kind==='pair'?normalizeStandardMultipleColorShaderPair(result,selectors):normalizeStandardMultipleColorShaderResult(result,kind),
  selectedConsumer=check(actual),heldConsumer=check(old);
 assert.equal(actual.ok,true);assert.equal(old.ok,true);assert.equal(selectedConsumer.ok,false);assert.equal(heldConsumer.ok,true);
 assert.equal(selectedConsumer.error.code,kind==='pair'?'shader-link-error':'shader-domain-error');
 return {kind,request,actual,old,selectedConsumer,heldConsumer};
});
assert.deepEqual(records[0].actual.metadata.instanceUniforms,[{name:'wv_instance_base',type:'uint',semantic:'INSTANCE_BASE',default:0}]);
const paths=['renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs',
 'renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs',
 'renderer/virgl-shader/standard.mjs','renderer/virgl-shader/bridge.c',
 'renderer/virgl-shader/standard_guard.h','renderer/virgl-shader/standard_emit.c',
 'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
 'tools/virgl-ordered-stencil/fixtures.mjs',
 'evidence/virgl-production-readiness/standard-instanced-stencil-consumer-gap.mjs'];
const pins=paths.map(path=>{const raw=fs.readFileSync(path);return {path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
const record={schema:'original-instanced-stencil-consumer-gap-v1',sourceHead:head,records,pins,
 selectedCompilerQualified:true,currentConsumerRefusals:3,historicalConsumerAdmissions:3,
 nativeDrawExecuted:false,guestExecution:false,productionAuthority:false};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({sourceHead:head,currentConsumerRefusals:3,historicalConsumerAdmissions:3,nativeDrawExecuted:false}));
