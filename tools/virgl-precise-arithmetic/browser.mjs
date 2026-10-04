#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {browserDocument,browserOptions,runVirglBrowser} from '../lib/virgl-browser-runner.mjs';
import {kernelVectors} from './oracle.mjs';
const options=browserOptions(['--seed','--fault-wasm','--fault-kernel','--fault-vector']);
const fixture=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/precise-arithmetic-cases.json',import.meta.url)));
const seed=Number(options.seed??0x5e74bf09)>>>0;
const counts=fixture.kernels.reduce((a,k)=>{const n=kernelVectors(k,seed).length;a.draws+=n;a.words+=['ORIGINAL','RASTER'].includes(k.op)?0:n*4;return a;},{draws:0,words:0});
const runtime=fs.readdirSync(new URL('../../renderer/virgl-command/',import.meta.url)).filter(x=>x.endsWith('.mjs')).map(x=>'renderer/virgl-command/'+x);
runtime.push('renderer/virgl-command/tests/precise-arithmetic.mjs','tools/virgl-precise-arithmetic/oracle.mjs','renderer/virgl-command/tests/bounded-loops-shaders.json','renderer/virgl-shader/tests/precise-arithmetic-cases.json',...fixture.kernels.filter(k=>k.originalPath).map(k=>k.originalPath));
if(options['fault-wasm'])runtime.push(options['fault-wasm'].replace(/^\//,''));
const pinnedFiles=runtime.map(path=>{const bytes=fs.readFileSync(new URL('../../'+path,import.meta.url));return{path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
await runVirglBrowser({options,task:'E6-T12f5',serializedAcceptance:true,
  boundary:'Explicit integer binary32 GPU rounding in the isolated shared renderer',
  reportFields:{currentGuest3dAdvertisement:false},modulePath:'/renderer/virgl-command/tests/precise-arithmetic.mjs',
  windowReportKey:'__virglPreciseArithmeticReport',browserArguments:{seed,faultWasm:options['fault-wasm']??null,faultKernel:options['fault-kernel']??null,faultVector:options['fault-vector']??null},
  servedFiles:runtime,pinnedFiles,coveragePaths:['renderer/virgl-command/tests/precise-arithmetic.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-precise-arithmetic/oracle.mjs'],
  html:browserDocument({title:'Explicit binary32 rounding',heading:'Separate PRECISE ADD and MUL',description:'Independent rational predictions and complete GPU bit-plane pixels'}),
  validate(r){assert.equal(r.status,'passed');assert.equal(r.rigs.length,fixture.kernels.length);assert.equal(r.drawCount,counts.draws);assert.equal(r.checkedWords,counts.words);assert.equal(r.checkedPixels,counts.draws*128);assert.equal(r.helperCoverage.length,4);assert.ok([...r.rigs,...r.helperCoverage].every(x=>x.objects.live===0));},
  successMessage:r=>`${r.checkedWords} exactly rounded words; ${r.checkedPixels} physical pixels.`});
