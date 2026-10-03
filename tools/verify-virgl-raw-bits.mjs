#!/usr/bin/env node
import assert from 'node:assert/strict';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS } from '../renderer/virgl-shader/tests/components.mjs';
const options=browserOptions(['--sabotage']);
assert.ok(options.sabotage===undefined||options.sabotage==='shift-mask','--sabotage accepts shift-mask');
await runVirglBrowser({options,task:'E6-T12e4a',boundary:'owned private raw-u32 shader storage and masked bitwise operations; direct host-uniform hardware proof; guest wire unchanged',
  reportFields:{currentGuest3dAdvertisement:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true},
  modulePath:'/renderer/virgl-shader/tests/raw-bits.mjs',windowReportKey:'__virglRawBitsReport',browserArguments:{sabotage:options.sabotage??null},
  servedFiles:ORIGINAL_INPUTS.map(value=>value.path),pinnedFiles:ORIGINAL_INPUTS,
  html:browserDocument({title:'E6-T12e4a raw shader word proof',heading:'Lossless private shader words',description:'Direct hardware compiler proof · byte carriers and32 bitplanes · raw uniforms are host probes · guest constant transport unchanged'}),
  validate(result){assert.equal(result.corpus.length,19);assert.equal(result.corpus.filter(value=>value.result.ok).length,12);assert.equal(result.anchors.length,44);assert.equal(result.pairs.length,18);assert.equal(result.rejectionPairs.length,4);assert.equal(result.vertexProbes.length,10);assert.equal(result.fragmentProbes.length,10);assert.equal(result.pairDraws.length,15);assert.equal(result.checkedWords,480);assert.equal(result.orientation.captures.length,2);
    assert.equal(result.recovery.singleConversions,result.cases.length*4);assert.equal(result.recovery.pairConversions,result.cases.length*2);assert.equal(result.memory.initialBytes,16777216);assert.equal(result.memory.finalBytes,16777216);assert.equal(result.memory.bufferIdentityStable,true);assert.equal(result.stress.iterations,32);assert.equal(result.guestConstantTransportUnchanged,true);assert.equal(result.hostUniformInjectionOnly,true);assert.equal(result.objects.live,0);assert.deepEqual(result.objects.created,result.objects.deleted);assert.deepEqual(result.omissions,[]);assert.equal(result.sabotage,null);},
  successMessage:result=>`E6-T12e4a: ${result.cases.length} authored cases;12/19 unchanged originals;480 exact raw words;15 mixed backend pixel draws;fixed16MiB stress passed.`,
});
