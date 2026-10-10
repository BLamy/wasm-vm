#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--inputs','--fault']);assert.ok(options.inputs);assert.ok(!options.fault||['lod-selection','gradient-state','query-levels'].includes(options.fault));
const root=await fs.realpath(path.resolve(import.meta.dirname,'../..')),inputs=path.relative(root,await fs.realpath(path.resolve(options.inputs))).split(path.sep).join('/'),
  matrix=inputs+'/native/cases.json',native=inputs+'/native/native.jsonl',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[matrix,native,'tools/virgl-standard-texture/hardware-fixtures.mjs'],pinned=[];
for(const name of files) {const bytes=await fs.readFile(path.join(root,name));pinned.push({path:name,size:bytes.length,sha256:hash(bytes)});}
const report=await runVirglBrowser({options,task:'E6-T11d23',boundary:'Original 2D texture-operation compiler',reportFields:{productionNegotiation:false},
  modulePath:'/renderer/virgl-shader/tests/standard-texture-browser.mjs',windowReportKey:'__standardTextureReport',serializedAcceptance:true,
  browserArguments:{matrixPath:'/'+matrix,nativePath:'/'+native,fault:options.fault??null},servedFiles:files,pinnedFiles:pinned,
  coveragePaths:['renderer/virgl-shader/standard.mjs','renderer/virgl-shader/tests/standard-texture-browser.mjs'],
  html:browserDocument({title:'Original 2D texture operations',heading:'Original 2D texture operations on the GPU',description:'Original shader operands and mip images · native queries · full pixels and physical fences'}),
  validate(acceptance){assert.equal(acceptance.frames.length,246);assert.ok(acceptance.compiles.length>=472);assert.ok(acceptance.frames.every(frame=>frame.gpuComplete?.fenced&&frame.cleaned&&frame.audit.held));},
  successMessage:acceptance=>acceptance.frames.length+' original texture-operation hardware frames passed.'});
const output=path.resolve(options.output);
for(const item of report.acceptance?.blobs??[]) {
  const zipped=Buffer.from(item.gzipBase64,'base64');assert.equal(hash(zipped),item.gzipSha256);const raw=gunzipSync(zipped);assert.equal(raw.length,item.bytes);assert.equal(hash(raw),item.sha256);
  delete item.gzipBase64;item.path=item.key+'.bin.gz';await fs.writeFile(path.join(output,item.path),zipped);
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
