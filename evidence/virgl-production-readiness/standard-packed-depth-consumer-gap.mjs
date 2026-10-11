import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {computeStandardPackedDepthTransferLayout} from '../../renderer/virgl-command/resources.mjs';
import {decodeStandardUnormDepthImageSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {imageView,surface} from '../../tools/virgl-command/standard-image-fixtures.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.match(fs.readFileSync('tasks/epic-6-transcendence/E6-T11d42-standard-packed-depth-images.md','utf8'),/^status: verified$/m);
const recordedHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(recordedHead,'c60bf20abcd42c1c10fb1863c2666a344d5c8e70','run only at the independently verified D42 head');
const rows=[],heldLayouts=[];
for(const format of [20,21])for(const bind of [1,8,9])for(const lastLevel of [0,2])for(const direction of [1,2]){
 const metadata={id:29,target:2,format,bind,width:9,height:7,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0};
 const fields={resourceHandle:29,level:lastLevel,usage:0,stride:lastLevel?11:41,layerStride:0,box:{x:0,y:0,z:0,width:lastLevel?2:9,height:1,depth:1},dataOffset:3,direction};
 const result=computeStandardPackedDepthTransferLayout(metadata,fields,128);
 assert.equal(result.ok,true);
 assert.equal(result.layout.tightBytes,fields.box.width*4);
 heldLayouts.push({metadata,fields,backingByteLength:128,result});
}
for(const format of [20,21])for(const [kind,bytes] of [['base-view',imageView(9,29,format,0,0)],['private-mip-view',imageView(9,29,format,1,2,[0,4,0,5])],['mip-depth-surface',surface(10,29,format,2)]]){
 const result=decodeStandardUnormDepthImageSubmission(bytes);assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');
 rows.push({kind,format,hex:Buffer.from(bytes).toString('hex'),result});
}
const names=new Set(['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','tools/virgl-command/standard-image-fixtures.mjs','tools/virgl-floating-depth/primary/u_format.yaml','tools/virgl-floating-depth/primary/es-3.0.6.pdf','tools/virgl-floating-depth-consumer/primary/vrend_formats.c','tools/virgl-floating-depth-consumer/primary/vrend_renderer.c',...execFileSync('git',['ls-files','renderer/virgl-shader'],{encoding:'utf8'}).trim().split('\n')]);
const visit=name=>{for(const match of fs.readFileSync(name,'utf8').matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+\.mjs)['"]/g)){const child=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));if(!names.has(child)){names.add(child);visit(child);}}};
for(const name of [...names])if(name.endsWith('.mjs'))visit(name);
const sources=[...names].sort().map(name=>{const raw=fs.readFileSync(name);return {path:name,bytes:raw.length,sha256:sha(raw)};});
const generated=['virgl-shader.mjs','virgl-shader.wasm'].map(name=>{const file='renderer/virgl-shader/build/wasm/'+name,raw=fs.readFileSync(file);return {path:file,bytes:raw.length,sha256:sha(raw)};});
assert.equal(generated[0].sha256,'6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa');
assert.equal(generated[1].sha256,'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc');
const abi=fs.readFileSync('renderer/virgl-shader/vendor/src/virgl_hw.h','utf8');
assert.match(abi,/VIRGL_FORMAT_S8_UINT_Z24_UNORM\s*=\s*20\b/);assert.match(abi,/VIRGL_FORMAT_Z24X8_UNORM\s*=\s*21\b/);
const result={schema:'original-packed-depth-consumer-gap-v1',task:'E6-T11d43',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verifiedDependency:'E6-T11d42',authority:'original-refusals-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,sources,rows,heldLayouts,generated};
assert.equal(rows.length,6);assert.equal(heldLayouts.length,24);
fs.writeFileSync(process.argv[2]??new URL('./standard-packed-depth-consumer-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.gitHead,originalConsumerRefusals:6,heldStorageLayouts:24,nativeExecuted:false}));
