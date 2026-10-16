import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--inputs']),root=path.resolve(import.meta.dirname,'../..');assert.ok(options.inputs);
const nativePath=path.relative(root,path.resolve(options.inputs,'native.jsonl')).split(path.sep).join('/'),files=[nativePath,'tools/virgl-shadow-shaders-critic/browser-test.mjs','tools/virgl-shadow-shaders-critic/fixtures.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex'),pins=[];
for(const name of files){const raw=await fs.readFile(path.join(root,name));pins.push({path:name,size:raw.length,sha256:sha(raw)});}
const report=await runVirglBrowser({options,task:'E6-T11d48-critic',boundary:'Independent original same-slot cross-stage shadow/view/query case',modulePath:'/tools/virgl-shadow-shaders-critic/browser-test.mjs',windowReportKey:'__shadowCriticReport',serializedAcceptance:true,browserArguments:{nativePath:'/'+nativePath},servedFiles:files,pinnedFiles:pins,coveragePaths:['renderer/virgl-shader/standard.mjs'],html:browserDocument({title:'Independent shadow critic',heading:'Original cross-stage shadow/view/query proof',description:'Literal original words · independent stage/slot views · native completed corruption'}),validate(a){assert.equal(a.frames.length,2);assert.equal(a.frames[0].status,'held');assert.equal(a.frames[1].status,'refuted');assert.equal(a.frames[1].misses.length,4);assert.ok(a.cleaned);assert.equal(a.unused.length,2);},successMessage:()=> 'Independent original shadow plane held; four completed control words physically refuted.'});
for(const b of report.acceptance?.blobs??[]){const compressed=Buffer.from(b.gzipBase64,'base64'),raw=gunzipSync(compressed);assert.equal(sha(compressed),b.gzipSha256);assert.equal(raw.length,b.bytes);assert.equal(sha(raw),b.sha256);delete b.gzipBase64;b.path=b.key+'.bin.gz';await fs.writeFile(path.join(path.resolve(options.output),b.path),compressed);}
await fs.writeFile(path.join(path.resolve(options.output),'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
