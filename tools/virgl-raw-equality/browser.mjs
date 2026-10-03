#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserDocument,browserOptions,runVirglBrowser} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--fault','--fault-artifacts']);
const fault=options.fault??null;
assert.ok(fault===null||['nan-guard','zero-sign','ne-complement','mask-one'].includes(fault));
let faultWasm=null,servedFiles=[];
if(fault){const manifest=JSON.parse(fs.readFileSync(path.join(options['fault-artifacts'],'manifest.json')));faultWasm='/'+path.relative(process.cwd(),path.join(options['fault-artifacts'],manifest.modes[fault].wasm.path));servedFiles.push(faultWasm.slice(1));}
await runVirglBrowser({options,task:'E6-T12f1',boundary:'Raw binary32 equality and inequality masks; isolated shader compiler only',reportFields:{guestExecution:false,currentGuest3dAdvertisement:false,predecessorFullGateClaimed:false},modulePath:'/renderer/virgl-shader/tests/raw-equality.mjs',windowReportKey:'__virglRawEqualityReport',browserArguments:{fault,faultWasm},servedFiles,coveragePaths:['renderer/virgl-shader/tests/raw-equality.mjs','renderer/virgl-shader/tests/raw-equality-oracle.mjs'],html:browserDocument({title:'Raw equality proof',heading:'Raw binary32 equality',description:'Exact words from actual GPU rendering'}),validate(result){assert.equal(result.status,'passed');assert.equal(result.fault,null);assert.equal(result.vertexProbes.length,16);assert.equal(result.fragmentProbes.length,16);assert.equal(result.migratedProbes.length,8);assert.equal(result.checkedWords,640);assert.equal(result.objects.live,0);assert.deepEqual(result.objects.created,result.objects.deleted);},successMessage:result=>`${result.checkedWords} exact equality words; 8 unchanged migrated shader bodies rendered.`});
