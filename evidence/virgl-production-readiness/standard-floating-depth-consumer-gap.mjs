// Run at the independently verified D39 head after verifier leases are released.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodeStandardPackedUnsignedImageSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {imageView,surface} from '../../tools/virgl-command/standard-image-fixtures.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.match(fs.readFileSync('tasks/epic-6-transcendence/E6-T11d39-standard-floating-depth-images.md','utf8'),/^status: verified$/m);
const descriptors=JSON.parse(fs.readFileSync('tools/virgl-command/standard-floating-depth-formats.json')),records=[];
for(const row of descriptors)for(const [kind,wire] of [['base-view',imageView(9,6,row.originalFormat,0,0,[0,1,2,3])],['mip-swizzled-view',imageView(9,6,row.originalFormat,1,3,[0,4,0,5])],['mip-depth-surface',surface(10,6,row.originalFormat,2)]]){
 const result=decodeStandardPackedUnsignedImageSubmission(wire);assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');
 records.push({kind,format:row.originalFormat,name:row.originalName,hex:Buffer.from(wire).toString('hex'),result});
}
assert.equal(records.length,6);
const names=new Set(['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-shader/standard.mjs','tools/virgl-command/standard-image-fixtures.mjs','tools/virgl-command/standard-floating-depth-formats.json',...execFileSync('git',['ls-files','renderer/virgl-shader'],{encoding:'utf8'}).trim().split('\n')]);
const visit=name=>{const text=fs.readFileSync(name,'utf8');for(const match of text.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+\.mjs)['"]/g)){const child=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));if(!names.has(child)){names.add(child);visit(child);}}};
for(const name of [...names])if(name.endsWith('.mjs'))visit(name);
const sources=[...names].sort().map(name=>{const raw=fs.readFileSync(name);return{path:name,bytes:raw.length,sha256:sha(raw)};});
const result={schema:'original-floating-depth-consumer-gap-v1',task:'E6-T11d40',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verifiedDependency:'E6-T11d39',authority:'original-wire-refusal-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,sources,records};
fs.writeFileSync(process.argv[2]??new URL('./standard-floating-depth-consumer-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.gitHead,originalWireRefusals:records.length}));
