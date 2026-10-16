#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'negative','rounding','special'].includes(fault));
const files=['tools/virgl-precise-fraction/cases.mjs','tools/virgl-precise-fraction/plan.mjs','tools/virgl-precise-arithmetic/oracle.mjs','tools/virgl-signed-conversions/cases.mjs','renderer/virgl-shader/build/precise-fraction-primary.json',
  'renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6g2',boundary:'private exact FRC_PRECISE and ordinary FRC; isolated synthetic programs',reportFields:{productionNegotiation:false},
  modulePath:'/renderer/virgl-shader/tests/precise-fraction.mjs',windowReportKey:'__virglPreciseFractionReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
  pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/precise-fraction.mjs','renderer/virgl-shader/tests/fraction-banks.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-precise-fraction/cases.mjs'],
  html:browserDocument({title:'TGSI precise fraction',heading:'Exact rational fraction on physical WebGL2',description:'Independent mathematical predictions, physical carrier words, all bit planes and pinned Mesa GLSL. Production negotiation remains disabled.'}),
  validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.objects.live,0);
    assert.ok(a.vertices.some(v=>v.backend==='owned'&&v.op==='FRC')&&a.vertices.some(v=>v.backend==='owned'&&v.op==='FRC_PRECISE'));
    assert.ok(a.vertices.some(v=>v.backend==='mesa'&&v.op==='FRC')&&a.vertices.some(v=>v.backend==='mesa'&&v.op==='FRC_PRECISE'));
    assert.equal(a.checkedWords,a.vertices.reduce((n,v)=>n+v.vectors.length*12,0));
    assert.equal(a.checkedPixels,a.fragments.length*16+320);
    assert.equal(a.consumers.length,4);for(const c of a.consumers)assert.equal(c.captures.length,6);
    assert.equal(a.bankDraws.length,4);for(const c of a.bankDraws){assert.equal(c.draws.length,5);assert.equal(c.attacks.length,6);assert.equal(c.oracleStops.length,0);assert.equal(c.yieldAttacks.length,c.asynchronous?1:0);}},
  successMessage:a=>`${a.checkedWords} exact physical fraction words and ${a.checkedPixels} pixels; all objects disposed.`});
