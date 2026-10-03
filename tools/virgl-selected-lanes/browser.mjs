#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserDocument,browserOptions,runVirglBrowser} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--mode','--fault-artifacts']);
const mode=options.mode??'normal';assert.ok(['normal','guard-open','width-proof'].includes(mode));
const repo=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const runtime=fs.readdirSync(path.join(repo,'renderer/virgl-command')).filter(x=>x.endsWith('.mjs')).map(x=>'renderer/virgl-command/'+x);
runtime.push('renderer/virgl-command/tests/selected-lanes.mjs','renderer/virgl-command/tests/selected-lanes-oracle.mjs','renderer/virgl-command/tests/bounded-loops-shaders.json');
const pinnedFiles=runtime.map(filename=>{const bytes=fs.readFileSync(path.join(repo,filename));return{path:filename,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
let faultWasm=null,fault=null;
if(mode!=='normal'){
 const directory=fs.realpathSync(options['fault-artifacts']),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));fault=manifest.modes[mode];
 const artifact=fs.realpathSync(path.join(directory,fault.wasm.path)),relative=path.relative(repo,artifact);assert.ok(relative&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative));faultWasm='/'+relative.split(path.sep).join('/');runtime.push(faultWasm.slice(1));
}
await runVirglBrowser({options,task:'E6-T12f2',boundary:'One selected-away interpolation family through the shared renderer',reportFields:{currentGuest3dAdvertisement:false,mode,fault},modulePath:'/renderer/virgl-command/tests/selected-lanes.mjs',windowReportKey:'__virglSelectedLanesReport',browserArguments:{mode,faultWasm},servedFiles:runtime,pinnedFiles,coveragePaths:['renderer/virgl-command/tests/selected-lanes.mjs','renderer/virgl-command/tests/selected-lanes-oracle.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs'],html:browserDocument({title:'Selected interpolation proof',heading:'Selected interpolation lanes',description:'Exact hardware words and explicit demand witnesses'}),validate(r){assert.equal(mode,'normal');assert.equal(r.status,'passed');assert.equal(r.checkedWords,1216);assert.equal(r.checkedPixels,304*4096);assert.equal(r.observerPixels,48*4096);assert.equal(r.rigs.length,88);assert.ok(r.rigs.every(x=>x.objects.live===0));},successMessage:r=>`${r.checkedWords} exact words; ${r.checkedPixels} pixels; ${r.observerPixels} observed demand pixels.`});
