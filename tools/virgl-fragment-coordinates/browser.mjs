#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS,physicalPlan} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'x','y','z','w'].includes(fault));
const files=['tools/virgl-fragment-coordinates/cases.mjs','renderer/virgl-shader/build/coordinate-primary.json',`renderer/virgl-shader/build/coordinate-reference-${seed}.json`,
 'renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6k',boundary:'private captured fragment POSITION coordinates',reportFields:{productionNegotiation:false},
 modulePath:'/renderer/virgl-shader/tests/fragment-coordinates.mjs',windowReportKey:'__virglFragmentCoordinatesReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/fragment-coordinates.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-fragment-coordinates/cases.mjs'],
 html:browserDocument({title:'TGSI fragment coordinates',heading:'Fragment coordinates on physical WebGL2',description:'Independent rational geometry, full component words, lower-left viewports and pinned Mesa shaders. Production negotiation remains disabled.'}),
 validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.objects.live,0);assert.equal(a.probes.length,physicalPlan(seed).length);
  for(const backend of ['owned','mesa'])for(let lane=0;lane<4;lane++)assert.ok(a.probes.some(p=>p.backend===backend&&p.lane===lane));
  assert.equal(a.directPixels,a.probes.reduce((n,p)=>n+p.geometry.width*p.geometry.height,0));assert.equal(a.consumerPixels,65536);assert.equal(a.checkedPixels,a.directPixels+a.consumerPixels);
  assert.equal(a.consumers.length,2);for(const c of a.consumers){assert.equal(c.captures.length,32);assert.equal(c.rejections.length,24);}
 },successMessage:a=>`${a.checkedPixels} independently predicted physical fragment-coordinate pixels; all objects disposed.`});
