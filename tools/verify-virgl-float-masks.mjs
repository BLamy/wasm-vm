#!/usr/bin/env node
import assert from 'node:assert/strict';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS } from '../renderer/virgl-shader/tests/components.mjs';
const options=browserOptions(['--sabotage']);
assert.ok(options.sabotage===undefined||['unordered-guard','signed-zero','negative-order'].includes(options.sabotage),'known --sabotage');
await runVirglBrowser({options,task:'E6-T12e4c1',boundary:'exact ordered binary32 comparison masks over owned raw-u32 shader words; direct host-uniform hardware proof; guest wire unchanged',
  reportFields:{currentGuest3dAdvertisement:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true},
  modulePath:'/renderer/virgl-shader/tests/float-masks.mjs',windowReportKey:'__virglFloatMasksReport',browserArguments:{sabotage:options.sabotage??null},
  servedFiles:ORIGINAL_INPUTS.map(value=>value.path),pinnedFiles:ORIGINAL_INPUTS,
  coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/float-masks.mjs'],
  html:browserDocument({title:'E6-T12e4c1 ordered binary32 proof',heading:'Ordered binary32 comparisons',description:'Actual GPU raw-word comparisons including NaNs, signed zeros, infinities and subnormals ·768 words reconstructed in full · guest graphics negotiation remains off'}),
  validate(result){assert.equal(result.corpus.length,19);assert.equal(result.corpus.filter(value=>value.result.ok).length,12);assert.equal(result.anchors.length,58);assert.equal(result.pairs.length,41);assert.equal(result.rejectionPairs.length,4);assert.equal(result.vertexProbes.length,8);assert.equal(result.fragmentProbes.length,8);assert.equal(result.pairDraws.length,38);assert.equal(result.checkedWords,768);assert.equal(result.orientation.captures.length,2);assert.equal(result.finiteSelections.vertex.captures.length,12);assert.equal(result.finiteSelections.fragment.draws.length,12);
    assert.equal(result.recovery.singleConversions,result.cases.length*4);assert.equal(result.recovery.pairConversions,result.cases.length*2);assert.equal(result.memory.initialBytes,16777216);assert.equal(result.memory.finalBytes,16777216);assert.equal(result.memory.bufferIdentityStable,true);assert.equal(result.stress.iterations,32);assert.equal(result.guestConstantTransportUnchanged,true);assert.equal(result.hostUniformInjectionOnly,true);assert.equal(result.objects.live,0);assert.deepEqual(result.objects.created,result.objects.deleted);assert.deepEqual(result.omissions,[]);assert.equal(result.sabotage,null);},
  successMessage:result=>`E6-T12e4c1: ${result.cases.length} authored cases;12/19 unchanged originals;768 exact words;finite ordered selections;38 mixed backend pixel draws;fixed16MiB stress passed.`,
});
