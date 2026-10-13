import assert from 'node:assert/strict';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {parseStandardStreamOutputShaderMetadata,normalizeStandardStreamOutputShaderResult,normalizeStandardStreamOutputShaderPair,deriveStandardStreamOutputShaderInterface} from '../../renderer/virgl-command/constant-domain.mjs';
import {text,entry,layout,zeroSelectors} from '../virgl-stream-output-shaders/fixtures.mjs';
const compiler=await createVirglStandardStreamOutputShaderBridge(),rows=[];
const fragment='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const request={vertexText:text(1),fragmentText:fragment,...zeroSelectors(),streamOutputWords:layout([8,0,0,0],[entry(1,0,4,0,2)]),captureBuffer:0};
const pair=compiler.translatePairStreamOutput(request);assert.equal(pair.ok,true);assert.equal(normalizeStandardStreamOutputShaderPair(pair).ok,true);
assert.equal(deriveStandardStreamOutputShaderInterface(pair.vertex.metadata,pair.fragment.metadata).ok,true);rows.push('captured generic pair input and interface');
const malformed=structuredClone(pair);malformed.interfaceKey+='bad';assert.equal(normalizeStandardStreamOutputShaderPair(malformed).ok,false);rows.push('pair interface mismatch');
const badVertex=structuredClone(pair.vertex.metadata);badVertex.streamOutput.encoding='bad';assert.equal(parseStandardStreamOutputShaderMetadata(badVertex,'vertex').ok,false);
assert.equal(deriveStandardStreamOutputShaderInterface(badVertex,pair.fragment.metadata).ok,false);rows.push('metadata and derived-interface rejection');
const failedStage=compiler.translateStreamOutput({stage:'vertex',text:'invalid shader',signedColorMask:0,unsignedColorMask:0,streamOutputWords:[0],captureBuffer:0});assert.equal(failedStage.ok,false);assert.equal(normalizeStandardStreamOutputShaderResult(failedStage,'vertex').ok,false);
const failedPair=compiler.translatePairStreamOutput({...request,vertexText:'invalid shader'});assert.equal(failedPair.ok,false);assert.equal(normalizeStandardStreamOutputShaderPair(failedPair).ok,false);rows.push('actual compiler stage and pair typed failure');
const sentinel=new Error('trusted abrupt metadata record');
for(const [name,method] of [['parse',v=>parseStandardStreamOutputShaderMetadata(v,'vertex')],['stage',v=>normalizeStandardStreamOutputShaderResult(v,'vertex')],['pair',v=>normalizeStandardStreamOutputShaderPair(v)],['interface',v=>deriveStandardStreamOutputShaderInterface(v,pair.fragment.metadata)]]){
  assert.equal(method(new Proxy({},{ownKeys(){throw sentinel;}})).ok,false);rows.push(name+' refuses unusable own properties');
}
console.log(JSON.stringify({status:'passed',rows}));
