#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS,physicalPlan,specialPlan,physicalLoops} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'word','control'].includes(fault));
const files=['tools/virgl-known-branches/cases.mjs','tools/virgl-known-branches/flow-cases.mjs','tools/virgl-known-branches/original-cases.mjs','tools/virgl-known-branches/held-cases.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6m2',boundary:'private proved raw UIF liveness',reportFields:{productionNegotiation:false},modulePath:'/renderer/virgl-shader/tests/known-branches.mjs',windowReportKey:'__virglKnownBranchesReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/known-branches.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-known-branches/cases.mjs'],
 html:browserDocument({title:'Proved raw TGSI branches',heading:'Proved branch liveness on physical WebGL2',description:'Integer raw truth, complete original syntax, selected literal words and byte readbacks. Private compiler proof.'}),
 validate(a){assert.deepEqual(a.plan,physicalPlan(seed));assert.equal(a.objects.live,0);assert.equal(a.vertices.length,a.plan.length);assert.equal(a.fragments.length,a.plan.length*8);assert.equal(a.checkedWords,a.plan.length*32+physicalLoops().length*8);assert.equal(a.checkedPixels,a.plan.length*128+specialPlan().length*16);assert.equal(a.special.length,specialPlan().length);assert.equal(a.loops.length,physicalLoops().length);assert.equal(a.consumers.length,2);},
 successMessage:a=>`${a.checkedWords} physical branch words; ${a.checkedPixels} exact byte pixels; objects disposed.`});
