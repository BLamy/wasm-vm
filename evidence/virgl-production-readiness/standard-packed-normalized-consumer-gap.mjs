// Install and run only after D35 is independently verified and releases its leases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodeStandardMultipleColorSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {imageView,surface} from '../../tools/virgl-command/standard-image-fixtures.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.match(fs.readFileSync('tasks/epic-6-transcendence/E6-T11d35-standard-packed-normalized-images.md','utf8'),/^status: verified$/m);
const descriptors=JSON.parse(fs.readFileSync('tools/virgl-command/standard-packed-normalized-formats.json')).records,records=[];
for(const row of descriptors)for(const [kind,wire] of [['base-view',imageView(9,6,row.originalFormat,0,0,[0,1,2,3])],['mip-swizzled-view',imageView(9,6,row.originalFormat,1,3,[2,4,0,5])],['mip-surface',surface(10,6,row.originalFormat,2)]]){
 const result=decodeStandardMultipleColorSubmission(wire);assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');
 records.push({kind,format:row.originalFormat,name:row.originalName,hex:Buffer.from(wire).toString('hex'),result});
}
assert.equal(records.length,39);
const names=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-normalized-images.mjs','renderer/virgl-shader/standard.mjs','renderer/virgl-shader/vendor/src/virgl_hw.h','tools/virgl-command/standard-packed-normalized-formats.json'];
const sources=names.map(path=>{const raw=fs.readFileSync(path);return{path,bytes:raw.length,sha256:sha(raw)};});
const result={schema:'original-packed-normalized-consumer-gap-v1',task:'E6-T11d36',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verifiedDependency:'E6-T11d35',authority:'original-wire-refusal-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,sources,records};
fs.writeFileSync(new URL('./standard-packed-normalized-consumer-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.gitHead,originalWireRefusals:records.length}));
