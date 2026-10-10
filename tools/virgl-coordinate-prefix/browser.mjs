#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';

const options=browserOptions(['--fault']);
const fault=options.fault??null;
assert.ok(fault===null||fault==='coordinate');
const files=[
 'evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi',
 'target/evidence/virgl-coordinate-prefix/banks.bin'];
const report=await runVirglBrowser({options,task:'E6-T12g6m4b',
 boundary:'original c580 finite fragment-coordinate prefix',
 reportFields:{productionNegotiation:false,fault},
 modulePath:'/renderer/virgl-shader/tests/coordinate-prefix.mjs',
 windowReportKey:'__virglCoordinatePrefixReport',serializedAcceptance:true,
 browserArguments:{fault},servedFiles:files,
 pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),
 coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/coordinate-prefix.mjs'],
 html:browserDocument({title:'Original c580 coordinate prefix',
  heading:'Original compositor coordinate arithmetic on WebGL2',
  description:'Private finite-envelope evidence for the authenticated c580 fragment prefix.'}),
 validate(a){assert.equal(a.frames.length,6);assert.equal(a.frames.reduce((n,frame)=>n+frame.pixels.length,0),96);},
 successMessage:a=>`3 original banks, two viewport origins, 96 physical float pixels checked.`});
process.exit(report.status==='passed'?0:1);
