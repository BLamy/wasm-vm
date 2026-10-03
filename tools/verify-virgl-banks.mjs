#!/usr/bin/env node
import assert from 'node:assert/strict';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS } from '../renderer/virgl-shader/tests/components.mjs';
const options=browserOptions(['--sabotage']);
assert.ok(options.sabotage===undefined||options.sabotage==='high-alias','--sabotage accepts high-alias');
await runVirglBrowser({options,task:'E6-T12e3',boundary:'bounded frontend CONST45/TEMP117/179 non-END instructions; direct hardware proof; command transport unchanged',
  reportFields:{currentGuest3dAdvertisement:false,commandRendererWidened:false},
  modulePath:'/renderer/virgl-shader/tests/banks.mjs',windowReportKey:'__virglBanksReport',browserArguments:{sabotage:options.sabotage??null},
  servedFiles:ORIGINAL_INPUTS.map(x=>x.path),pinnedFiles:ORIGINAL_INPUTS,
  html:browserDocument({title:'E6-T12e3 register bank proof',heading:'Bounded shader register banks',description:'Direct compiler proof · CONST45 and TEMP117 · exact vertex feedback and fragment pixels · command transport unchanged'}),
  validate(a){assert.equal(a.corpus.length,19);assert.equal(a.corpus.filter(x=>x.result.ok).length,12);assert.equal(a.anchors.length,9);assert.equal(a.pairs.length,4);
    assert.equal(a.draws.length,5);assert.equal(a.checkedPixels,1280);assert.equal(a.transformFeedback.length,4);assert.equal(a.recovery.singleConversions,a.cases.length*8);assert.equal(a.recovery.pairConversions,a.cases.length*4);
    assert.equal(a.memory.initialBytes,16777216);assert.equal(a.memory.finalBytes,16777216);assert.equal(a.memory.bufferIdentityStable,true);assert.equal(a.stress.iterations,32);
    assert.equal(a.commandRendererWidened,false);assert.equal(a.sabotage,null);assert.deepEqual(a.omissions,[]);},
  successMessage:a=>`E6-T12e3: ${a.cases.length} bank cases;12/19 originals;1280 exact pixels and96 exact TF floats; fixed16MiB maximal pair stress passed.`,
});
