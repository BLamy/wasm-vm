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
 'target/evidence/virgl-92cb-raster/raster.json',
 'renderer/virgl-shader/tests/original-programs.mjs',
 'renderer/virgl-shader/tests/original-programs-worker.mjs',
 'tools/virgl-original-programs/oracle.mjs',
 'tools/virgl-original-programs/guard-cases.mjs'];
const report=await runVirglBrowser({options,task:'E6-T12g6m',
 boundary:'dedicated-worker physical full original programs and guarded numerical domains',
 reportFields:{productionNegotiation:false},
 modulePath:'/renderer/virgl-shader/tests/original-programs.mjs',
 windowReportKey:'__virglOriginalProgramsReport',serializedAcceptance:true,
 browserArguments:{fault:options.fault??null},servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),
 coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/original-programs.mjs'],
 html:browserDocument({title:'Full original compositor programs',
  heading:'Complete original 92cb on WebGL2',
  description:'Full physical source and draw-time certificate; no production renderer DRAW authority.'}),
 validate(a){
  assert.equal(a.executionRealm,'dedicated-offscreen-worker');
  assert.equal(a.banks.length,3);
  assert.equal(a.guard.cases.length,22);
  assert.equal(a.banks.reduce((n,bank)=>n+bank.covered,0),1612644);
  assert.ok(a.banks.every(bank=>bank.probes.length===29&&bank.maxOutputError<=0.0001));
 },
 successMessage:a=>`3 certified original banks, ${a.banks.reduce((n,bank)=>n+bank.covered,0)} physical pixels checked.`});
process.exit(report.status==='passed'?0:1);
