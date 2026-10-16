#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS,physicalPlan} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'word','shadow'].includes(fault));
const files=['tools/virgl-known-arithmetic/cases.mjs','tools/virgl-known-arithmetic/flow-cases.mjs','tools/virgl-precise-arithmetic/oracle.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6m1',boundary:'private materialized known ADD/MUL producers',reportFields:{productionNegotiation:false},modulePath:'/renderer/virgl-shader/tests/known-arithmetic.mjs',windowReportKey:'__virglKnownArithmeticReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/known-arithmetic.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-known-arithmetic/cases.mjs'],
 html:browserDocument({title:'Known TGSI arithmetic',heading:'Known arithmetic on physical WebGL2',description:'Independent rational words, actual numeric shadows and complete byte readbacks. Private compiler proof.'}),
 validate(a){assert.deepEqual(a.plan,physicalPlan(seed));assert.equal(a.objects.live,0);assert.equal(a.vertices.length,a.plan.length);assert.equal(a.fragments.length,a.plan.length*8);assert.equal(a.math.length,8);assert.equal(a.checkedWords,a.plan.length*40+64);assert.equal(a.checkedPixels,a.plan.length*128);assert.equal(a.consumers.length,2);},
 successMessage:a=>`${a.checkedWords} physical known words; ${a.checkedPixels} exact byte pixels; objects disposed.`});
