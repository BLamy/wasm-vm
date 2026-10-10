#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {adversarialTextureFixtures} from './adversarial-fixtures.mjs';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';

const options=browserOptions(['--seed','--fault']);
const seed=Number(options.seed);assert.ok(Number.isInteger(seed)&&seed>0&&seed<=0xffffffff,'explicit uint32 seed');
assert.ok(!options.fault||options.fault==='lod-selection','physical LOD control only');
const root=await fs.realpath(path.resolve(import.meta.dirname,'../..')),output=path.resolve(options.output);
await fs.mkdir(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const boundary=JSON.parse(await fs.readFile(path.join(root,'tools/virgl-standard-texture/boundary.json')));
for(const file of boundary.files)assert.equal(hash(await fs.readFile(path.join(root,file.path))),file.afterSha256,'frozen compiler '+file.path);
assert.equal(hash(await fs.readFile(path.join(root,'renderer/virgl-shader/build/wasm/virgl-shader.wasm'))),'41d5c79624d7799cb9339b3fb754bfb4b744ee959b70d8cc2daedfb0a1fb4ac8','actual generated fixed-memory compiler');
const fixtures=adversarialTextureFixtures(seed),cases=fixtures.map(f=>({name:f.name,kind:2,a:f.vertexText,b:f.fragmentText,selectors:f.selectors,okay:true,code:null}));
const word=n=>{const raw=Buffer.alloc(4);raw.writeUInt32LE(n);return raw;},parts=[word(cases.length)];
for(const c of cases){const a=Buffer.from(c.a),b=Buffer.from(c.b);parts.push(word(2),...Object.values(c.selectors).map(word),word(a.length),a,word(b.length),b);}
await fs.writeFile(path.join(output,'cases.bin'),Buffer.concat(parts));
await fs.writeFile(path.join(output,'cases.json'),JSON.stringify({cases},null,2)+'\n');
await fs.writeFile(path.join(output,'original-inputs.json'),JSON.stringify({seed,frames:fixtures.map(f=>({name:f.name,stage:f.stage,opcode:f.opcode,slot:f.slot,vertexText:f.vertexText,fragmentText:f.fragmentText,selectors:f.selectors,resourceWidth:f.resourceWidth,resourceHeight:f.resourceHeight,firstLevel:f.firstLevel,lastLevel:f.lastLevel,width:f.width,height:f.height,levels:f.levels,positions:[...f.positions],coordinates:[...f.coordinates],planes:f.planes.map(p=>({level:p.level,width:p.width,height:p.height,hex:Buffer.from(p.bytes).toString('hex')}))}))},null,2)+'\n');
const binary=path.join(root,'renderer/virgl-shader/build/standard-texture-native/standard-texture-test');
const native=execFileSync(binary,[path.join(output,'cases.bin')],{maxBuffer:4*1024*1024});
const responses=native.toString().trim().split('\n').map(JSON.parse);assert.equal(responses.length,cases.length);assert.ok(responses.every(r=>r.result.ok));
await fs.writeFile(path.join(output,'native.jsonl'),native);
const relative=filename=>path.relative(root,filename).split(path.sep).join('/');
const files=[relative(path.join(output,'cases.json')),relative(path.join(output,'native.jsonl')),'tools/virgl-standard-texture/adversarial-fixtures.mjs'],pinned=[];
for(const name of [...files,relative(path.join(output,'original-inputs.json'))]){const bytes=await fs.readFile(path.join(root,name));pinned.push({path:name,size:bytes.length,sha256:hash(bytes)});}
const report=await runVirglBrowser({options,task:'E6-T11d23',boundary:'Independent original mip/query/source-modifier compiler attack',reportFields:{productionNegotiation:false,seed,physicalControl:options.fault??null,nativeCompilerSha256:hash(await fs.readFile(binary))},
  modulePath:'/renderer/virgl-shader/tests/standard-texture-adversarial.mjs',windowReportKey:'__standardTextureReport',serializedAcceptance:true,
  browserArguments:{seed,matrixPath:'/'+files[0],nativePath:'/'+files[1],fault:options.fault??null},servedFiles:files,pinnedFiles:pinned,
  coveragePaths:['renderer/virgl-shader/standard.mjs','renderer/virgl-shader/tests/standard-texture-adversarial.mjs'],
  html:browserDocument({title:'Independent original texture compiler proof',heading:'Independent original mip and query proof',description:'Separate image words and source modifiers · original stage slots 7 and 14 · completed native GPU fences'}),
  validate(acceptance){assert.equal(acceptance.frames.length,16);assert.equal(acceptance.compiles.length,32);assert.ok(acceptance.frames.every(f=>f.gpuComplete.fenced&&f.cleaned&&f.audit.held));},
  successMessage:acceptance=>acceptance.frames.length+' independent original texture frames passed.'});
for(const item of report.acceptance?.blobs??[]){const zipped=Buffer.from(item.gzipBase64,'base64');assert.equal(hash(zipped),item.gzipSha256);const raw=gunzipSync(zipped);assert.equal(raw.length,item.bytes);assert.equal(hash(raw),item.sha256);delete item.gzipBase64;item.path=item.key+'.bin.gz';await fs.writeFile(path.join(output,item.path),zipped);}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
process.exit(report.status==='passed'?0:1);
