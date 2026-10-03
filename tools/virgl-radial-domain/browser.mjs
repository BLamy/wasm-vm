#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserDocument,browserOptions,runVirglBrowser} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(),repo=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const runtime=fs.readdirSync(path.join(repo,'renderer/virgl-command')).filter(x=>x.endsWith('.mjs')).map(x=>'renderer/virgl-command/'+x);
runtime.push('renderer/virgl-command/tests/radial-domain.mjs','tools/virgl-radial-domain/oracle.mjs','renderer/virgl-command/tests/bounded-loops-shaders.json','renderer/virgl-shader/tests/radial-domain-cases.json');
const pinnedFiles=runtime.map(filename=>{const bytes=fs.readFileSync(path.join(repo,filename));return{path:filename,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
await runVirglBrowser({options,task:'E6-T12f3',boundary:'Restricted radial coefficient admission in the isolated shared renderer',reportFields:{currentGuest3dAdvertisement:false},modulePath:'/renderer/virgl-command/tests/radial-domain.mjs',windowReportKey:'__virglRadialDomainReport',servedFiles:runtime,pinnedFiles,coveragePaths:['renderer/virgl-command/tests/radial-domain.mjs','tools/virgl-radial-domain/oracle.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs'],html:browserDocument({title:'Radial admission proof',heading:'Restricted radial domain',description:'Admitted hardware paths and before-effect failures'}),validate(r){assert.equal(r.status,'passed');assert.equal(r.rigs.length,21);assert.equal(r.drawCount,138);assert.equal(r.checkedPixels,138*4096);assert.ok(r.rigs.every(x=>x.glObjects.live===0));},successMessage:r=>`${r.drawCount} admitted hardware draws; ${r.checkedPixels} checked pixels.`});
