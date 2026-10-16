#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'base','exponent','broadcast'].includes(fault));
const files=['tools/virgl-exponent-logarithm/cases.mjs','tools/virgl-power/cases.mjs','tools/virgl-power/plan.mjs','tools/virgl-power/captures.mjs','tools/virgl-power/oracle.mjs','renderer/virgl-shader/build/power-reference.json','tools/virgl-saturation/cases.mjs','tools/virgl-precise-arithmetic/oracle.mjs','tools/virgl-signed-conversions/cases.mjs','renderer/virgl-shader/build/power-primary.json',
  'renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6j2',boundary:'private statically bounded scalar POW',reportFields:{productionNegotiation:false},
  modulePath:'/renderer/virgl-shader/tests/power.mjs',windowReportKey:'__virglPowerReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
  pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/power.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-power/cases.mjs'],
  html:browserDocument({title:'TGSI bounded power',heading:'Bounded power on physical WebGL2',description:'Independent mathematical predictions, physical carrier words, complete RGBA8 bytes and pinned Mesa GLSL. Production negotiation remains disabled.'}),
  validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.objects.live,0);
    for(const op of ['POW'])for(const backend of ['owned','mesa'])assert.ok(a.vertices.some(v=>v.backend===backend&&v.op===op));
    assert.equal(a.checkedWords,a.vertices.reduce((n,v)=>n+v.vectors.length*12,0));
    assert.equal(a.checkedPixels,a.fragments.length*16);
    assert.equal(a.consumers.length,2);for(const c of a.consumers)assert.equal(c.captures.length,6);
  },
  successMessage:a=>`${a.checkedWords} bounded physical power words and ${a.checkedPixels} pixels; all objects disposed.`});
