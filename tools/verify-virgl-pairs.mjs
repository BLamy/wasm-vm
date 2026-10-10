#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS } from '../renderer/virgl-shader/tests/components.mjs';
const options=browserOptions(['--sabotage']);
assert.ok(options.sabotage===undefined||options.sabotage==='flat-reuse','--sabotage accepts flat-reuse');
const commandPaths=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs', 'renderer/virgl-command/float-images.mjs','renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs','renderer/virgl-command/tests/flat-pairs.mjs', 'renderer/virgl-command/color-images.mjs'];
const pins=await Promise.all(commandPaths.map(async path=>{const bytes=await fs.readFile(fileURLToPath(new URL(`../${path}`,import.meta.url)));return{path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));
await runVirglBrowser({options,task:'E6-T12e2',boundary:'unchanged flat TGSI, internally derived stage interfaces and actual renderer program variants; no production 3D activation',
 reportFields:{currentGuest3dAdvertisement:false,commandStreamReplay:false},
 modulePath:'/renderer/virgl-command/tests/flat-pairs.mjs',windowReportKey:'__virglPairsReport',browserArguments:{sabotage:options.sabotage??null},
 servedFiles:[...ORIGINAL_INPUTS.map(x=>x.path),...commandPaths],pinnedFiles:[...ORIGINAL_INPUTS,...pins],
 coveragePaths:['renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs','renderer/virgl-shader/index.mjs'],
 html:browserDocument({title:'E6-T12e2 flat shader pair proof',heading:'Derived flat shader interfaces',description:'Unchanged captured fragment · independent unequal vertex pixels · renderer variants, cache ownership and cleanup'}),
 validate(acceptance){assert.equal(acceptance.shaderPairs.status,'passed');assert.equal(acceptance.rendererPairs.status,'passed');assert.equal(acceptance.shaderPairs.corpus.filter(x=>x.result.ok).length,12);assert.equal(acceptance.shaderPairs.draws.length,8);assert.ok(acceptance.rendererPairs.draws.length>=40);assert.equal(acceptance.rendererPairs.faults.length,12);assert.equal(acceptance.rendererPairs.quota.length,2);assert.equal(acceptance.sabotage,null);},
 successMessage:a=>`E6-T12e2:12/19 originals; ${a.shaderPairs.cases.length} native/Wasm pair cases; ${a.shaderPairs.draws.length} direct and ${a.rendererPairs.draws.length} renderer draws; cache/lifecycle/fault proof passed.`,
});
