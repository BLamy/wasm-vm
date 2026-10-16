#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'signedness','winner'].includes(fault));
const files=['tools/virgl-signed-integers/cases.mjs','renderer/virgl-shader/build/signed-integers-primary.json',
  'renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6d',boundary:'private signed32 comparison/maximum; isolated synthetic programs',reportFields:{productionNegotiation:false},
  modulePath:'/renderer/virgl-shader/tests/signed-integers.mjs',windowReportKey:'__virglSignedIntegersReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
  pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/signed-integers.mjs','tools/virgl-signed-integers/cases.mjs'],
  html:browserDocument({title:'Exact signed TGSI integers',heading:'Signed comparison and maximum on physical WebGL2',description:'Independent BigInt predictions, physical carrier words, all bit planes and pinned Mesa GLSL. Production negotiation remains disabled.'}),
  validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.objects.live,0);
    const owned=a.vertices.filter(v=>v.backend==='owned');assert.equal(owned.length,154);assert.equal(owned.reduce((n,v)=>n+v.vectors.length*12,0),24192);
    assert.equal(a.fragments.filter(f=>f.backend==='owned').length,576);assert.equal(a.fragments.filter(f=>f.backend==='owned').reduce((n,f)=>n+f.checkedPixels,0),9216);
    assert.ok(a.vertices.some(v=>v.backend==='mesa'&&v.predicate)&&a.vertices.some(v=>v.backend==='mesa'&&v.op==='IMAX'));
    assert.equal(a.consumers.length,4);for(const c of a.consumers)assert.equal(c.captures.length,6);},
  successMessage:a=>`${a.checkedWords} exact physical signed words and ${a.checkedPixels} pixels; all objects disposed.`});
