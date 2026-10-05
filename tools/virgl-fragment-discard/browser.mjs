#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS,physicalPlan} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'inhibit','invert','x-only','unconditional'].includes(fault));
const files=['tools/virgl-fragment-discard/cases.mjs','renderer/virgl-shader/build/discard-primary.json',`renderer/virgl-shader/build/discard-reference-${seed}.json`,
 'renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'];
await runVirglBrowser({options,task:'E6-T12g6l',boundary:'private fragment discard and surviving predecessor initialization',reportFields:{productionNegotiation:false},
 modulePath:'/renderer/virgl-shader/tests/fragment-discard.mjs',windowReportKey:'__virglFragmentDiscardReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/fragment-discard.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-fragment-discard/cases.mjs'],
 html:browserDocument({title:'TGSI fragment discard',heading:'Fragment discard on physical WebGL2',description:'Literal source words, surviving paths, cropped viewports and unmodified pinned Mesa shaders. Production negotiation remains disabled.'}),
 validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.objects.live,0);assert.equal(a.probes.length,physicalPlan(seed).length);
  for(const backend of ['owned','mesa'])for(let lane=0;lane<4;lane++)assert.ok(a.probes.some(p=>p.backend===backend&&p.lane===lane));
  assert.equal(a.directPixels,a.probes.reduce((n,p)=>n+p.geometry.width*p.geometry.height,0));assert.equal(a.consumerPixels,a.consumers.reduce((n,c)=>n+c.captures.length*1024,0));assert.equal(a.checkedPixels,a.directPixels+a.consumerPixels);
  assert.equal(a.consumers.length,2);for(const c of a.consumers){assert.equal(c.captures.length,18);assert.equal(c.rejections.length,10);}
 },successMessage:a=>`${a.checkedPixels} literal physical discard pixels; all objects disposed.`});
