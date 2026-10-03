#!/usr/bin/env node
import assert from 'node:assert/strict';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS } from '../renderer/virgl-shader/tests/components.mjs';
const options=browserOptions(['--sabotage']);
assert.ok(options.sabotage===undefined||['dp3-lane','rcp-source','rsq-operation','numeric-negate'].includes(options.sabotage),'known --sabotage');
await runVirglBrowser({options,task:'E6-T12e6',boundary:'checked scalar dot and reciprocal float operations inside owned raw-u32 shaders; direct host-input hardware proof; guest wire unchanged',
  reportFields:{currentGuest3dAdvertisement:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true},
  modulePath:'/renderer/virgl-shader/tests/dot-reciprocals.mjs',windowReportKey:'__virglDotReciprocalsReport',browserArguments:{sabotage:options.sabotage??null},
  servedFiles:ORIGINAL_INPUTS.map(value=>value.path),pinnedFiles:ORIGINAL_INPUTS,
  coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/dot-reciprocals.mjs'],
  html:browserDocument({title:'E6-T12e6 scalar shader proof',heading:'Dot and reciprocal operations',description:'Actual GPU texture and exact dyadic arithmetic · 488 captured words checked with exact or rational bounds · ordinary float and raw consumers · guest graphics negotiation remains off'}),
  validate(result){assert.equal(result.corpus.length,19);assert.equal(result.corpus.filter(value=>value.result.ok).length,12);assert.equal(result.anchors.length,98);assert.equal(result.pairs.length,37);assert.equal(result.rejectionPairs.length,4);assert.equal(result.vertexProbes.length,11);assert.equal(result.fragmentProbes.length,12);assert.equal(result.crossConsumerProbes.length,11);assert.equal(result.textureDraws.length,6);assert.equal(result.pairDraws.length,34);assert.equal(result.checkedWords,488);assert.equal(result.checkedTexturePixels,6144);assert.equal(result.orientation.captures.length,2);assert.equal(result.reciprocalVertexProbes.length,6);assert.equal(result.reciprocalFragmentProbes.length,8);assert.equal(result.reciprocalCrossProbes.length,8);assert.equal(result.observationProbes.length,6);
    assert.equal(result.recovery.singleConversions,result.cases.length*4);assert.equal(result.recovery.pairConversions,result.cases.length*2);assert.equal(result.memory.initialBytes,16777216);assert.equal(result.memory.finalBytes,16777216);assert.equal(result.memory.bufferIdentityStable,true);assert.equal(result.stress.iterations,32);assert.equal(result.guestConstantTransportUnchanged,true);assert.equal(result.hostUniformInjectionOnly,true);assert.equal(result.objects.live,0);assert.deepEqual(result.objects.created,result.objects.deleted);assert.deepEqual(result.omissions,[]);assert.equal(result.sabotage,null);},
  successMessage:result=>`E6-T12e6: ${result.cases.length} authored cases; 12/19 unchanged originals; 488 exact or bounded words; 6,144 sampled pixels; 34 mixed backend draws; fixed 16 MiB stress passed.`,
});
