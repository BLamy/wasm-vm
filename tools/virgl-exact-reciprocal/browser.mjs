#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--fault','--seed']);
const contract='renderer/virgl-command/constant-domain.mjs';
const fault=options.fault??null;
assert.ok(fault===null||fault==='shadow');
const seed=Number(options.seed??1);assert.ok(Number.isInteger(seed)&&seed>=1&&seed<=3);
const faultFiles=fault?['target/virgl-exact-reciprocal-fault/virgl-shader.wasm',
 'target/virgl-exact-reciprocal-fault/raw_bits.c','target/virgl-exact-reciprocal-fault/bridge.c',
 'target/virgl-exact-reciprocal-fault/manifest.json']:[];
const report=await runVirglBrowser({options,task:'E6-T12g6m4a',boundary:'private exact-bank power-of-two reciprocal producer',
 reportFields:{productionNegotiation:false,fault},modulePath:'/renderer/virgl-shader/tests/exact-reciprocal.mjs',
 windowReportKey:'__virglExactReciprocalReport',serializedAcceptance:true,
 browserArguments:{fault,seed},servedFiles:[contract,...faultFiles],
 pinnedFiles:[contract,...faultFiles].map(p=>({path:p,sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),
 coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/exact-reciprocal.mjs',contract],
 html:browserDocument({title:'Exact bank reciprocal',heading:'Exact reciprocal words on physical WebGL2',description:'Private original-compositor prerequisite: compiler literal, enforced constant bank and independently predicted pixels.'}),
 validate(a){assert.equal(a.frames.length,6);assert.equal(a.frames.reduce((n,f)=>n+f.checkedPixels,0),384);},
 successMessage:a=>`${a.frames.length} physical exact-reciprocal frames / 384 predicted channels.`});
process.exit(report.status==='passed'?0:1);
