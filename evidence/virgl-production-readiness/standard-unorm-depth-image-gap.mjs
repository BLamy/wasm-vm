import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {computeStandardFloatingDepthTransferLayout} from '../../renderer/virgl-command/resources.mjs';
import {decodeStandardFloatingDepthImageSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {imageView,surface} from '../../tools/virgl-command/standard-image-fixtures.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.match(fs.readFileSync('tasks/epic-6-transcendence/E6-T11d40-standard-floating-depth-consumer.md','utf8'),/^status: verified$/m);
const rows=[];
for(const bind of [1,8,9])for(const lastLevel of [0,2])for(const direction of [1,2]){
 const metadata={id:29,target:2,format:16,bind,width:9,height:7,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0};
 const fields={resourceHandle:29,level:lastLevel,usage:0,stride:lastLevel?7:21,layerStride:0,box:{x:0,y:0,z:0,width:lastLevel?2:9,height:1,depth:1},dataOffset:3,direction};
 const result=computeStandardFloatingDepthTransferLayout(metadata,fields,128),legacy=bind===1&&lastLevel===0;
 assert.equal(result.ok,legacy);if(!legacy)assert.equal(result.error.code,'unsupported-resource');
 rows.push({kind:'layout',metadata,fields,backingByteLength:128,legacy,result});
}
for(const [kind,bytes,legacy] of [['base-view',imageView(9,29,16,0,0),false],['private-mip-view',imageView(9,29,16,1,2,[0,4,0,5]),false],['mip-depth-surface',surface(10,29,16,2),false],['legacy-base-surface',surface(10,29,16,0),true]]){
 const result=decodeStandardFloatingDepthImageSubmission(bytes);assert.equal(result.ok,legacy);if(!legacy)assert.equal(result.error.code,'unsupported-feature');
 rows.push({kind,hex:Buffer.from(bytes).toString('hex'),legacy,result});
}
const names=new Set(['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','tools/virgl-command/standard-image-fixtures.mjs','tools/virgl-floating-depth/primary/u_format.yaml','tools/virgl-floating-depth-consumer/primary/vrend_formats.c',...execFileSync('git',['ls-files','renderer/virgl-shader'],{encoding:'utf8'}).trim().split('\n')]);
const visit=name=>{for(const match of fs.readFileSync(name,'utf8').matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+\.mjs)['"]/g)){const child=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));if(!names.has(child)){names.add(child);visit(child);}}};
for(const name of [...names])if(name.endsWith('.mjs'))visit(name);
const sources=[...names].sort().map(name=>{const raw=fs.readFileSync(name);return {path:name,bytes:raw.length,sha256:sha(raw)};});
assert.match(fs.readFileSync('renderer/virgl-shader/vendor/src/virgl_hw.h','utf8'),/VIRGL_FORMAT_Z16_UNORM\s*=\s*16\b/);
const result={schema:'original-unorm-depth-image-gap-v1',task:'E6-T11d41',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verifiedDependency:'E6-T11d40',authority:'original-refusals-and-legacy-admission-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,sources,rows};
assert.equal(rows.filter(r=>!r.legacy).length,13);assert.equal(rows.filter(r=>r.legacy).length,3);
fs.writeFileSync(process.argv[2]??new URL('./standard-unorm-depth-image-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.gitHead,originalRefusals:13,legacyAdmissions:3,nativeExecuted:false}));
