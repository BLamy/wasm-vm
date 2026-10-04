#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'selection'].includes(fault));
const files=['tools/virgl-minimum-selection/cases.mjs','tools/virgl-signed-conversions/cases.mjs','renderer/virgl-shader/build/minimum-selection-primary.json',
  'renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6g1',boundary:'private finite MIN/MIN_PRECISE; isolated synthetic programs',reportFields:{productionNegotiation:false},
  modulePath:'/renderer/virgl-shader/tests/minimum-selection.mjs',windowReportKey:'__virglMinimumSelectionReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
  pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/minimum-selection.mjs','renderer/virgl-shader/tests/minimum-banks.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-minimum-selection/cases.mjs'],
  html:browserDocument({title:'TGSI minimum selection',heading:'Exact operand selection on physical WebGL2',description:'Independent mathematical predictions, physical carrier words, all bit planes and pinned Mesa GLSL. Production negotiation remains disabled.'}),
  validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.objects.live,0);
    assert.ok(a.vertices.some(v=>v.backend==='owned'&&v.op==='MIN')&&a.vertices.some(v=>v.backend==='owned'&&v.op==='MIN_PRECISE'));
    assert.ok(a.vertices.some(v=>v.backend==='mesa'&&v.op==='MIN')&&a.vertices.some(v=>v.backend==='mesa'&&v.op==='MIN_PRECISE'));
    assert.equal(a.checkedWords,a.vertices.reduce((n,v)=>n+v.vectors.length*12,0));
    assert.equal(a.checkedPixels,a.fragments.length*16+320);
    assert.equal(a.consumers.length,4);for(const c of a.consumers)assert.equal(c.captures.length,6);
    assert.equal(a.bankDraws.length,4);for(const c of a.bankDraws){assert.equal(c.draws.length,5);assert.equal(c.attacks.length,6);assert.equal(c.oracleStops.length,0);assert.equal(c.yieldAttacks.length,c.asynchronous?1:0);}},
  successMessage:a=>`${a.checkedWords} exact physical minimum words and ${a.checkedPixels} pixels; all objects disposed.`});
