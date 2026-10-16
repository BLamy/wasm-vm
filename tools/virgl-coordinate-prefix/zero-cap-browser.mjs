#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';

const options=browserOptions(['--fault']);
const fault=options.fault??null;
assert.ok(fault===null||fault==='coordinate'||fault==='branch');
const files=[
 'evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi',
 'target/evidence/virgl-zero-cap/banks.bin'];
const report=await runVirglBrowser({options,task:'E6-T12g6m4c',
 boundary:'original c580 zero-capped branch',
 reportFields:{productionNegotiation:false,fault},
 modulePath:'/renderer/virgl-shader/tests/zero-cap.mjs',
 windowReportKey:'__virglZeroCapReport',serializedAcceptance:true,
 browserArguments:{fault},servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),
 coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/zero-cap.mjs'],
 html:browserDocument({title:'Original c580 zero-cap branch',
  heading:'Original compositor zero-cap branch on WebGL2',
  description:'Private finite-envelope and ordered-branch evidence for the authenticated c580 fragment prefix.'}),
 validate(a){assert.equal(a.frames.length,12);assert.equal(a.frames.reduce((n,frame)=>n+frame.pixels.length,0),192);},
 successMessage:a=>`3 original banks, two zero signs and viewport origins, 192 physical float pixels checked.`});
process.exit(report.status==='passed'?0:1);
