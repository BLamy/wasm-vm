#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'high-register','branch-join','counter'].includes(fault));
const files=['tools/virgl-compiler-bounds/cases.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-original-corpus/oracle.mjs','tools/virgl-radial-domain/oracle.mjs'];
await runVirglBrowser({options,task:'E6-T12g6b',boundary:'checked compiler resource envelope; synthetic programs only',reportFields:{productionNegotiation:false},modulePath:'/renderer/virgl-shader/tests/compiler-bounds.mjs',windowReportKey:'__virglCompilerBoundsReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/compiler-bounds.mjs','tools/virgl-compiler-bounds/cases.mjs'],html:browserDocument({title:'Bounded compositor compiler','heading':'Checked compiler capacity on physical WebGL2',description:'Synthetic TEMP511 / IMM31 / depth16 resource witnesses. Production guest negotiation remains disabled.'}),validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.vertices.length,9);assert.equal(a.fragments.length,9);assert.equal(a.checkedWords,3456);assert.equal(a.checkedPixels,27648);assert.equal(a.objects.live,0);},successMessage:a=>`${a.checkedWords} exact hardware words and ${a.checkedPixels} pixels; all bounded objects disposed.`});
