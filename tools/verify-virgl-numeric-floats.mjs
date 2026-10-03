#!/usr/bin/env node
import assert from 'node:assert/strict';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS } from '../renderer/virgl-shader/tests/components.mjs';
const options=browserOptions(['--sabotage']);
assert.ok(options.sabotage===undefined||['stale-shadow','numeric-decode','sampler-index'].includes(options.sabotage),'known --sabotage');
await runVirglBrowser({options,task:'E6-T12e4c2',boundary:'checked numeric float shadows inside owned raw-u32 shaders; direct host-input hardware proof; guest wire unchanged',
  reportFields:{currentGuest3dAdvertisement:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true},
  modulePath:'/renderer/virgl-shader/tests/numeric-floats.mjs',windowReportKey:'__virglNumericFloatsReport',browserArguments:{sabotage:options.sabotage??null},
  servedFiles:ORIGINAL_INPUTS.map(value=>value.path),pinnedFiles:ORIGINAL_INPUTS,
  coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/numeric-floats.mjs'],
  html:browserDocument({title:'E6-T12e4c2 numeric shader proof',heading:'Numeric shader operations',description:'Actual GPU texture and exact dyadic arithmetic · 352 words reconstructed in full · ordinary float and raw consumers · guest graphics negotiation remains off'}),
  validate(result){assert.equal(result.corpus.length,19);assert.equal(result.corpus.filter(value=>value.result.ok).length,12);assert.equal(result.anchors.length,65);assert.equal(result.pairs.length,29);assert.equal(result.rejectionPairs.length,4);assert.equal(result.vertexProbes.length,9);assert.equal(result.fragmentProbes.length,11);assert.equal(result.crossConsumerProbes.length,10);assert.equal(result.textureDraws.length,4);assert.equal(result.pairDraws.length,26);assert.equal(result.checkedWords,352);assert.equal(result.checkedTexturePixels,4096);assert.equal(result.orientation.captures.length,2);
    assert.equal(result.recovery.singleConversions,result.cases.length*4);assert.equal(result.recovery.pairConversions,result.cases.length*2);assert.equal(result.memory.initialBytes,16777216);assert.equal(result.memory.finalBytes,16777216);assert.equal(result.memory.bufferIdentityStable,true);assert.equal(result.stress.iterations,32);assert.equal(result.guestConstantTransportUnchanged,true);assert.equal(result.hostUniformInjectionOnly,true);assert.equal(result.objects.live,0);assert.deepEqual(result.objects.created,result.objects.deleted);assert.deepEqual(result.omissions,[]);assert.equal(result.sabotage,null);},
  successMessage:result=>`E6-T12e4c2: ${result.cases.length} authored cases; 12/19 unchanged originals; 352 exact words; 4,096 sampled pixels; 26 mixed backend draws; fixed 16 MiB stress passed.`,
});
