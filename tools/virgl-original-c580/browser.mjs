#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';

const options=browserOptions(['--fault']);
const fault=options.fault??null;
assert.ok(fault===null||fault==='discard'||fault==='output');
const files=[
  'evidence/virgl-workload-inventory/captures/es2gears/shaders/403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c.tgsi',
  'evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi',
  'target/evidence/virgl-original-c580/banks.bin',
];
const report = await runVirglBrowser({
  options,task:'E6-T12g6m5a',boundary:'full unchanged 403b/c580 physical body',
  reportFields:{productionNegotiation:false,fault},
  modulePath:'/renderer/virgl-shader/tests/original-c580.mjs',
  windowReportKey:'__originalC580Report',serializedAcceptance:true,
  browserArguments:{fault},servedFiles:files,
  pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),
  coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/original-c580.mjs'],
  html:browserDocument({title:'Original c580 physical proof',heading:'Unchanged compositor pair',
    description:'Complete captured pair, exact banks, independent color and discard pixels on hardware.'}),
  validate(acceptance){
    assert.equal(acceptance.frames.length,6);
    assert.equal(acceptance.frames.reduce((n,frame)=>n+frame.pixels.length,0),96);
    assert.equal(acceptance.rejections.length,3);
  },
  successMessage:()=> 'Three original pairs, 96 independent pixels, real discard and full reflection passed.',
});
process.exit(report.status === 'passed' ? 0 : 1);
