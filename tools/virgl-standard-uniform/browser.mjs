#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--inputs','--fault']);assert.ok(options.inputs);assert.ok(!options.fault||['block-word','range-offset','slot-zero-variant'].includes(options.fault));
const root=await fs.realpath(path.resolve(import.meta.dirname,'../..')),inputs=path.relative(root,await fs.realpath(path.resolve(options.inputs))).split(path.sep).join('/'),
  matrix=inputs+'/native/cases.json',native=inputs+'/native/native.jsonl',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[matrix,native,'tools/virgl-standard-uniform/cases.mjs','tools/virgl-standard-uniform/hardware-fixtures.mjs','renderer/virgl-command/constant-domain.mjs'],pinned=[];
for(const name of files) {const bytes=await fs.readFile(path.join(root,name));pinned.push({path:name,size:bytes.length,sha256:hash(bytes)});}
const report=await runVirglBrowser({options,task:'E6-T11d16',boundary:'Explicit original dimensional uniform shader compiler',reportFields:{productionNegotiation:false},
  modulePath:'/renderer/virgl-shader/tests/standard-uniform-browser.mjs',windowReportKey:'__standardUniformReport',serializedAcceptance:true,
  browserArguments:{matrixPath:'/'+matrix,nativePath:'/'+native,fault:options.fault??null},servedFiles:files,pinnedFiles:pinned,
  coveragePaths:['renderer/virgl-shader/standard.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-shader/tests/standard-uniform-browser.mjs'],
  html:browserDocument({title:'Original guest uniform banks',heading:'Original guest uniform banks on the GPU',description:'All raw words and all bank limits · native block reflection · complete pixels and GPU fences'}),
  validate(acceptance){assert.equal(acceptance.frames.length,125);assert.ok(acceptance.compiles.length>=200);assert.ok(acceptance.frames.every(frame=>frame.gpuComplete?.fenced&&frame.cleaned&&frame.audit.held));},
  successMessage:acceptance=>acceptance.frames.length+' hardware frames passed, including every original raw bank word.'});
const output=path.resolve(options.output);
for(const item of report.acceptance?.blobs??[]) {
  const zipped=Buffer.from(item.gzipBase64,'base64');assert.equal(hash(zipped),item.gzipSha256);const raw=gunzipSync(zipped);assert.equal(raw.length,item.bytes);assert.equal(hash(raw),item.sha256);
  delete item.gzipBase64;item.path=item.key+'.bin.gz';await fs.writeFile(path.join(output,item.path),zipped);
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
