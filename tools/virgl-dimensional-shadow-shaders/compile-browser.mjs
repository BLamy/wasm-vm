import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--inputs']);assert.ok(options.inputs);
const root=await fs.realpath(path.resolve(import.meta.dirname,'../..')),inputs=path.relative(root,await fs.realpath(options.inputs)).split(path.sep).join('/');
const files=[inputs+'/cases.json',inputs+'/native.jsonl'],pins=[];
for(const name of files){const bytes=await fs.readFile(path.join(root,name));pins.push({path:name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const report=await runVirglBrowser({options,task:'E6-T11d61',boundary:'Original cube and array comparison compiler signatures',reportFields:{productionNegotiation:false,compileOnly:true},modulePath:'/renderer/virgl-shader/tests/standard-dimensional-shadow-texture-compile-browser.mjs',windowReportKey:'__dimensionalShadowCompileReport',browserArguments:{matrixPath:'/'+files[0],nativePath:'/'+files[1]},servedFiles:files,pinnedFiles:pins,coveragePaths:['renderer/virgl-shader/standard.mjs','renderer/virgl-shader/tests/standard-dimensional-shadow-texture-compile-browser.mjs'],html:browserDocument({title:'Original comparison compiler signatures',heading:'Cube and array comparison programs on Metal',description:'Original reference and bias lanes · native compile/link/reflection'}),validate(a){assert.equal(a.status,'passed');assert.equal(a.compiles.length,78);assert.equal(a.refusals.length,498);assert.ok(a.compiles.every(c=>c.link.okay&&c.cleaned&&c.uniforms.length===1));},successMessage:a=>a.compiles.length+' native comparison programs compiled and linked.'});
process.exit(report.status==='passed'?0:1);
