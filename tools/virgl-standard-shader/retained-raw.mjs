import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions([]);
const files=['renderer/virgl-shader/tests/raw-bit-hardware.json','tools/virgl-standard-shader/retained-raw-page.mjs','tools/virgl-original-programs/oracle.mjs'];
const pinnedFiles=files.map(path=>{const raw=fs.readFileSync(path);return {path,size:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};});
await runVirglBrowser({options,task:'E6-T11d4',boundary:'Unchanged original raw-bit anchors and independent BigInt oracle at current frontend limits',reportFields:{productionNegotiation:false},serializedAcceptance:true,modulePath:'/tools/virgl-standard-shader/retained-raw-page.mjs',windowReportKey:'__retainedRawReport',servedFiles:files,pinnedFiles,coveragePaths:['renderer/virgl-shader/index.mjs','tools/virgl-standard-shader/retained-raw-page.mjs','renderer/virgl-shader/tests/raw-bits.mjs'],html:browserDocument({title:'Retained raw bits',heading:'Original raw-bit shader custody',description:'Unchanged authored sources and reference, physical GPU words at seven shift boundaries.'}),validate(r){assert.equal(r.status,'passed');assert.equal(r.frames.length,42);assert.ok(r.frames.every(f=>f.fragment.metadata.profile==='virgl-webgl2-raw-bits-v1'&&f.mismatches.length===0&&f.outputs[0].maxError===0));},successMessage:()=> '42 physical retained raw-bit frames and 672 exact RGBA pixels passed.'});
