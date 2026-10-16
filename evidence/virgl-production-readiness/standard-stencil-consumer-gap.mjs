import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodeStandardPackedDepthImageSubmission as decode} from '../../renderer/virgl-command/decoder.mjs';
import {imageView,surface,packet} from '../../tools/virgl-command/standard-image-fixtures.mjs';
const verifiedHead='5a0d9fc9655f1e0956154763bda420aec721865a';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.match(fs.readFileSync('tasks/epic-6-transcendence/E6-T11d43-standard-packed-depth-consumer.md','utf8'),/^status: verified$/m);
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(head,verifiedHead);
const original=(enabled,func,fail,zpass,zfail,valueMask,writeMask)=>(enabled|func<<1|fail<<4|zpass<<7|zfail<<10|valueMask<<13|writeMask<<21)>>>0;
const front=original(1,7,0,2,4,255,255),back=original(1,1,7,6,5,255,255),inactive=original(0,4,3,5,7,85,170),rows=[];
for(const [name,first,second]of [['front-only',front,inactive],['back-enabled-front-disabled',inactive,back],['two-sided-common-ref-masks',front,back],['both-disabled-nonzero-fields',inactive,inactive]]){
 const bytes=packet(1,3,[31,7<<2,first,second,0]),result=decode(bytes);assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');rows.push({kind:'DSA',name,hex:Buffer.from(bytes).toString('hex'),result});
}
for(const [name,depth,alpha]of [['inactive-alpha-function',(7<<2)|(4<<9),0],['inactive-alpha-reference',7<<2,0x3e800000]]){
 const bytes=packet(1,3,[31,depth,0,0,alpha]),result=decode(bytes);assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');rows.push({kind:'DSA',name,hex:Buffer.from(bytes).toString('hex'),result});
}
for(const buffers of [2,3,6,7]){
 const bytes=packet(7,0,[buffers,0x3e800000,0x3f000000,0x3f400000,0x3f800000,0,0x3fe00000,173]),result=decode(bytes);assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');rows.push({kind:'CLEAR',buffers,hex:Buffer.from(bytes).toString('hex'),result});
}
const held=[];
for(const refs of [0,13|29<<8,255|255<<8]){const bytes=packet(13,0,[refs]),result=decode(bytes);assert.equal(result.ok,true);held.push({kind:'SET_STENCIL_REF',hex:Buffer.from(bytes).toString('hex'),result});}
for(const format of [20,126])for(const [kind,bytes]of [['private-view',imageView(9,29,format,1,2,[0,4,0,5])],['mip-surface',surface(10,29,format,2)]]){const result=decode(bytes);assert.equal(result.ok,true);held.push({kind,format,hex:Buffer.from(bytes).toString('hex'),result});}
const names=new Set(['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','tools/virgl-command/standard-image-fixtures.mjs','tools/virgl-floating-depth/primary/u_format.yaml','tools/virgl-floating-depth/primary/es-3.0.6.pdf','tools/virgl-floating-depth/primary/webgl2.html','tools/virgl-stencil/primary/webgl1.html','tools/virgl-floating-depth-consumer/primary/vrend_renderer.c',...execFileSync('git',['ls-files','renderer/virgl-shader'],{encoding:'utf8'}).trim().split('\n')]);
const visit=name=>{for(const match of fs.readFileSync(name,'utf8').matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+\.mjs)['"]/g)){const child=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));if(!names.has(child)){names.add(child);visit(child);}}};for(const name of [...names])if(name.endsWith('.mjs'))visit(name);
const sources=[...names].sort().map(name=>{const raw=fs.readFileSync(name);return {path:name,bytes:raw.length,sha256:sha(raw)};});
const generated=['virgl-shader.mjs','virgl-shader.wasm'].map(name=>{const file='renderer/virgl-shader/build/wasm/'+name,raw=fs.readFileSync(file);return {path:file,bytes:raw.length,sha256:sha(raw)};});assert.equal(generated[0].sha256,'6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa');assert.equal(generated[1].sha256,'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc');
const result={schema:'original-stencil-consumer-gap-v1',task:'E6-T11d44',gitHead:head,verifiedDependency:'E6-T11d43',authority:'original-refusals-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,sources,generated,rows,held};assert.equal(rows.length,10);assert.equal(held.length,7);
fs.writeFileSync(process.argv[2]??new URL('./standard-stencil-consumer-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({head,originalConsumerRefusals:rows.length,heldOriginalPackets:held.length,nativeExecuted:false}));
