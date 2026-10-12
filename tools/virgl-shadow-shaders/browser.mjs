import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {shadowFixtures} from './fixtures.mjs';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--inputs','--fault']);assert.ok(options.inputs);assert.ok(!options.fault||options.fault==='wrong-mask');
const root=await fs.realpath(path.resolve(import.meta.dirname,'../..')),inputs=path.relative(root,await fs.realpath(path.resolve(options.inputs))).split(path.sep).join('/'),matrix=inputs+'/native/cases.json',native=inputs+'/native/native.jsonl',hash=b=>createHash('sha256').update(b).digest('hex');
const files=[matrix,native,'tools/virgl-shadow-shaders/fixtures.mjs','tools/virgl-instance-base/fixtures.mjs'],pins=[];
for(const name of files){const bytes=await fs.readFile(path.join(root,name));pins.push({path:name,size:bytes.length,sha256:hash(bytes)});}
const report=await runVirglBrowser({options,task:'E6-T11d48',boundary:'Original floating 2D comparisons and host-owned view controls',reportFields:{productionNegotiation:false},modulePath:'/renderer/virgl-shader/tests/standard-shadow-texture-browser.mjs',windowReportKey:'__shadowTextureReport',serializedAcceptance:true,browserArguments:{matrixPath:'/'+matrix,nativePath:'/'+native,fault:options.fault??null},servedFiles:files,pinnedFiles:pins,coveragePaths:['renderer/virgl-shader/standard.mjs','renderer/virgl-shader/tests/standard-shadow-texture-browser.mjs'],html:browserDocument({title:'Original shadow comparisons',heading:'Original shadow and view words on Metal',description:'Native depth comparisons · original view swizzles · whole raw planes · physical fences'}),validate(a){assert.equal(a.frames.length,shadowFixtures().length);assert.ok(a.compiles.length>=2000);assert.equal(a.typeControls.length,1);assert.equal(a.typeControls[0].okay,false);assert.ok(a.frames.every(f=>f.gpuComplete?.fenced&&f.cleaned&&f.audit.held));},successMessage:a=>a.frames.length+' original shadow/view raw planes passed.'});
for(const item of report.acceptance?.blobs??[]){const zipped=Buffer.from(item.gzipBase64,'base64');assert.equal(hash(zipped),item.gzipSha256);const bytes=gunzipSync(zipped);assert.equal(bytes.length,item.bytes);assert.equal(hash(bytes),item.sha256);delete item.gzipBase64;item.path=item.key+'.bin.gz';await fs.writeFile(path.join(path.resolve(options.output),item.path),zipped);}
await fs.writeFile(path.join(path.resolve(options.output),'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
