#!/usr/bin/env node
import assert from 'node:assert/strict';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS } from '../renderer/virgl-shader/tests/components.mjs';
const options=browserOptions(['--sabotage']);
assert.ok(options.sabotage===undefined||['lrp-order','frc-floor','div-operands','numeric-negate'].includes(options.sabotage),'known --sabotage');
await runVirglBrowser({options,task:'E6-T12e5',boundary:'checked component float operations inside owned raw-u32 shaders; direct host-input hardware proof; guest wire unchanged',
  reportFields:{currentGuest3dAdvertisement:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true},
  modulePath:'/renderer/virgl-shader/tests/component-floats.mjs',windowReportKey:'__virglComponentFloatsReport',browserArguments:{sabotage:options.sabotage??null},
  servedFiles:ORIGINAL_INPUTS.map(value=>value.path),pinnedFiles:ORIGINAL_INPUTS,
  coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/component-floats.mjs'],
  html:browserDocument({title:'E6-T12e5 component shader proof',heading:'Component shader operations',description:'Actual GPU texture and exact dyadic arithmetic · 448 captured words checked with exact or rational bounds · ordinary float and raw consumers · guest graphics negotiation remains off'}),
  validate(result){assert.equal(result.corpus.length,19);assert.equal(result.corpus.filter(value=>value.result.ok).length,12);assert.equal(result.anchors.length,77);assert.equal(result.pairs.length,33);assert.equal(result.rejectionPairs.length,4);assert.equal(result.vertexProbes.length,10);assert.equal(result.fragmentProbes.length,12);assert.equal(result.crossConsumerProbes.length,11);assert.equal(result.textureDraws.length,4);assert.equal(result.pairDraws.length,30);assert.equal(result.checkedWords,448);assert.equal(result.checkedTexturePixels,4096);assert.equal(result.orientation.captures.length,2);assert.equal(result.divisionVertexProbes.length,2);assert.equal(result.divisionFragmentProbes.length,2);assert.equal(result.divisionCrossProbes.length,2);assert.equal(result.observationProbes.length,8);
    assert.equal(result.recovery.singleConversions,result.cases.length*4);assert.equal(result.recovery.pairConversions,result.cases.length*2);assert.equal(result.memory.initialBytes,16777216);assert.equal(result.memory.finalBytes,16777216);assert.equal(result.memory.bufferIdentityStable,true);assert.equal(result.stress.iterations,32);assert.equal(result.guestConstantTransportUnchanged,true);assert.equal(result.hostUniformInjectionOnly,true);assert.equal(result.objects.live,0);assert.deepEqual(result.objects.created,result.objects.deleted);assert.deepEqual(result.omissions,[]);assert.equal(result.sabotage,null);},
  successMessage:result=>`E6-T12e5: ${result.cases.length} authored cases; 12/19 unchanged originals; 448 exact or bounded words; 4,096 sampled pixels; 30 mixed backend draws; fixed 16 MiB stress passed.`,
});
