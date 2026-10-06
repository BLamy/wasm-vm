#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';

const options=browserOptions(['--fault']);
const files=[
 'evidence/virgl-workload-inventory/captures/es2gears/shaders/7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e.tgsi',
 'evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi',
 'target/evidence/virgl-92cb-raster/geometry.bin',
 'target/evidence/virgl-92cb-raster/raster.json'];
const report=await runVirglBrowser({options,task:'E6-T12g6m5b2b2',
 boundary:'dedicated-worker physical original pc0..222 private compiler and draw-time certificate',
 reportFields:{productionNegotiation:false},
 modulePath:'/renderer/virgl-shader/tests/original-92cb-private-power.mjs',
 windowReportKey:'__virglOriginal92cbPrivatePowerReport',serializedAcceptance:true,
 browserArguments:{fault:options.fault??null},servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),
 coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/original-92cb-private-power.mjs'],
 html:browserDocument({title:'Original 92cb private first-power compiler',
  heading:'Original pc0..222 powers on WebGL2',
  description:'Private physical prefix and draw-time certificate; no production renderer DRAW authority.'}),
 validate(a){
  assert.equal(a.executionRealm,'dedicated-offscreen-worker');
  assert.equal(a.banks.length,3);
  assert.deepEqual(a.banks.map(bank=>bank.branches),[16,0,16]);
  assert.ok(a.banks.every(bank=>bank.minimum>.49&&bank.maxDeltaError<.1));
 },
 successMessage:a=>`3 certified original banks, ${a.banks.reduce((n,bank)=>n+bank.covered,0)} physical pixels checked.`});
process.exit(report.status==='passed'?0:1);
