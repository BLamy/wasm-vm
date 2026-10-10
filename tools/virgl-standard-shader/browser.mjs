import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--inputs','--fault']);assert.ok(options.inputs);assert.ok(!options.fault||options.fault==='sine');
// Canonicalize both sides: macOS temporary clones use /var -> /private/var.
const root=await fs.realpath(path.resolve(import.meta.dirname,'../..')),inputs=path.relative(root,await fs.realpath(path.resolve(options.inputs))).split(path.sep).join('/');
const matrix=inputs+'/native/cases.json',native=inputs+'/native/native.jsonl',geometry=inputs+'/geometry.bin',banks=inputs+'/c580.bin';
const files=[matrix,native,geometry,banks,'tools/virgl-original-programs/oracle.mjs'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const pinned=[];for(const file of files){const bytes=await fs.readFile(path.join(root,file));pinned.push({path:file,size:bytes.length,sha256:hash(bytes)});}
const report=await runVirglBrowser({options,task:'E6-T11d4',boundary:'Distinct bounded standard shader compiler and actual hardware shader semantics',reportFields:{productionNegotiation:false},modulePath:'/renderer/virgl-shader/tests/standard-browser.mjs',windowReportKey:'__standardShaderReport',serializedAcceptance:true,browserArguments:{matrixPath:'/'+matrix,nativePath:'/'+native,geometryPath:'/'+geometry,banksPath:'/'+banks,fault:options.fault??null},servedFiles:files,pinnedFiles:pinned,coveragePaths:['renderer/virgl-shader/standard.mjs','renderer/virgl-shader/tests/standard-browser.mjs'],html:browserDocument({title:'Bounded standard guest shaders',heading:'Standard guest shader compiler on WebGL2',description:'Complete captured programs and independent physical values. Isolated compiler; production guest negotiation is still gated.'}),validate(a){assert.ok(a.compiles.length>=200);assert.ok(a.frames.length>=48);assert.equal(a.frames.filter(f=>f.name.startsWith('full-original-92cb')).length,3);assert.equal(a.frames.filter(f=>f.name.startsWith('full-original-c580')).length,6);assert.ok(a.frames.every(f=>f.mismatches.length===0));},successMessage:a=>`${a.compiles.length} physical compiles/programs, ${a.frames.length} independent GPU frames passed.`});
const output=path.resolve(options.output);await fs.mkdir(path.join(output,'pixels'),{recursive:true});
for(const [i,frame]of(report.acceptance?.frames??[]).entries())for(const item of frame.outputs){const p=item.pixels;if(!p?.gzipBase64)continue;const zipped=Buffer.from(p.gzipBase64,'base64');assert.equal(hash(zipped),p.gzipSha256);const raw=gunzipSync(zipped);assert.equal(hash(raw),p.sha256);assert.equal(raw.length,p.bytes);const relative=`pixels/frame-${i}-attachment-${item.output}.f32.gz`;await fs.writeFile(path.join(output,relative),zipped);delete p.gzipBase64;p.path=relative;}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
