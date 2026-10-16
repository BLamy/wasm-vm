// Promoted by the fresh E6-T11d61 critic: independent sampler/query slot custody.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../standard.mjs';

const vertexText = `VERT
DCL IN[0]
DCL IN[1]
DCL IN[2]
DCL OUT[0], POSITION
DCL OUT[1], GENERIC[0]
DCL OUT[2], GENERIC[1]
0: MOV OUT[0], IN[0]
1: MOV OUT[1], IN[1]
2: MOV OUT[2], IN[2]
3: END
`;
function fragmentText(queryAfter, bias) {
  const query = 'TXQ TEMP[1].yw, IMM[0], SAMP[15], SHADOW2D_ARRAY';
  const sample = 'TEX TEMP[0], IN[1], SAMP[15], 2D_ARRAY';
  const instructions = [
    ...(queryAfter ? [sample, query] : [query, sample]),
    `TXB2_SAT_PRECISE TEMP[0].xz, IN[1], ${bias}, SAMP[7], SHADOWCUBE`,
    'TXQ TEMP[2].xzw, IMM[0], SAMP[7], CUBE',
    'MOV OUT[0], TEMP[0]', 'END',
  ];
  return `FRAG
DCL IN[1], GENERIC[0], CONSTANT
DCL IN[2], GENERIC[1], CONSTANT
DCL OUT[0], COLOR
DCL TEMP[0..2]
DCL SAMP[7]
DCL SVIEW[7], CUBE, FLOAT
DCL SAMP[15]
DCL SVIEW[15], 2D_ARRAY, FLOAT
IMM[0] INT32 {2,0,0,0}
` + instructions.map((line, index) => `${index}: ${line}\n`).join('');
}
const selectors = {
  signedMask: 0, unsignedMask: 0, packedSignedMask: 0, packedNormalizedMask: 0,
  bufferZeroMask: 0, signedColorMask: 0, unsignedColorMask: 1,
};
let firstRuntime, peerRuntime;
const bridge = await createVirglStandardDimensionalShadowTextureShaderBridge({
  onRuntimeInitialized() { firstRuntime = this; },
});
const peer = await createVirglStandardDimensionalShadowTextureShaderBridge({
  onRuntimeInitialized() { peerRuntime = this; },
});
assert.notEqual(firstRuntime.HEAPU8.buffer, peerRuntime.HEAPU8.buffer);
assert.equal(firstRuntime.HEAPU8.byteLength, 16777216);
assert.equal(peerRuntime.HEAPU8.byteLength, 16777216);
const records = [];
for (const after of [false, true]) {
  for (const bias of ['-|IN[2].wzyx|', 'IN[2].yyyy', '-|IN[2].xxxx|']) {
    const text = fragmentText(after, bias);
    const request = {vertexText, fragmentText: text, ...selectors};
    const result = bridge.translatePairImages(request);
    assert.equal(result.ok, true);
    assert.deepEqual(peer.translatePairImages(request), result);
    assert.deepEqual(bridge.translateImages({stage: 'fragment', text,
      signedColorMask: 0, unsignedColorMask: 1}), {ok: true, ...result.fragment});
    assert.deepEqual(result.fragment.metadata.samplers, [
      {index: 7, name: 'fssamp7', type: 'samplerCubeShadow'},
      {index: 15, name: 'fssamp15', type: 'sampler2DArray'},
    ]);
    assert.deepEqual(result.fragment.metadata.shadowUniforms, [
      {index: 7, name: 'fsshadmask7', type: 'vec4', semantic: 'SHADOW_MASK'},
      {index: 7, name: 'fsshadadd7', type: 'vec4', semantic: 'SHADOW_ADD'},
    ]);
    assert.deepEqual(result.fragment.metadata.textureQueries, [
      {index: 7, name: 'fssamplevels7', type: 'int', semantic: 'TEXTURE_LEVELS'},
      {index: 15, name: 'fssamplevels15', type: 'int', semantic: 'TEXTURE_LEVELS'},
    ]);
    records.push({request, result});
    for (const bad of [
      text.replace('DCL SVIEW[15], 2D_ARRAY', 'DCL SVIEW[15], SHADOW2D_ARRAY'),
      text.replace('SAMP[7], SHADOWCUBE', 'SAMP[7], SHADOW2D_ARRAY'),
      text.replace('CUBE, FLOAT', 'CUBE, UINT'),
      text.replace('TXB2_SAT_PRECISE', 'TXL2_SAT_PRECISE'),
    ]) {
      const request = {vertexText, fragmentText: bad, ...selectors};
      const result = bridge.translatePairImages(request);
      assert.equal(result.ok, false);
      assert.deepEqual(Object.keys(result), ['ok', 'error']);
      assert.equal(result.error.code, 'unsupported-feature');
      records.push({request, result});
    }
  }
}
assert.equal(records.length, 30);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({
  status: 'passed', admitted: 6, refused: 24, records,
}, null, 2) + '\n');
console.log('Cross-slot dimensional comparison contract: 6 admitted, 24 complete refusals.');
