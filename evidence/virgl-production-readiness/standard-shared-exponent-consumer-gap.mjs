import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {decodeStandardPackedFloatImageSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {imageView,surface} from '../../tools/virgl-command/standard-image-fixtures.mjs';
const rows=[];
for(const swizzle of [[0,1,2,3],[2,4,0,5]]){
 const wire=imageView(9,6,125,1,3,swizzle),result=decodeStandardPackedFloatImageSubmission(wire);
 rows.push({kind:'sampler-range',format:125,firstLevel:1,lastLevel:3,swizzle,hex:Buffer.from(wire).toString('hex'),result});
}
const wire=surface(10,6,125,2);rows.push({kind:'surface-mip',format:125,level:2,hex:Buffer.from(wire).toString('hex'),result:decodeStandardPackedFloatImageSubmission(wire)});
if(rows.some(row=>row.result.ok||row.result.error.code!=='unsupported-feature'))throw Error('original125 consumer unexpectedly admitted');
if(!/^status: verified$/m.test(fs.readFileSync('tasks/epic-6-transcendence/E6-T11d29-standard-shared-exponent-images.md','utf8')))throw Error('shared-exponent storage dependency is not verified');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sources=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/shared-exponent-images.mjs','renderer/virgl-command/shared-exponent-gpu.mjs','renderer/virgl-shader/vendor/src/virgl_hw.h','tools/virgl-command/standard-float-image-mesa-formats.yaml','tools/virgl-command/standard-image-fixtures.mjs'].map(path=>{const bytes=fs.readFileSync(path);return{path,bytes:bytes.length,sha256:digest(bytes)};});
const predecessorSeals=[];
for(const role of ['worker','verifier'])for(const file of ['manifest.json','records.json','recording.tar.gz']){const path='evidence/virgl-standard-shared-exponent-images/'+role+'/'+file,bytes=fs.readFileSync(path);predecessorSeals.push({path,bytes:bytes.length,sha256:digest(bytes)});}
const result={schema:'original-shared-exponent-consumer-gap-v1',task:'E6-T11d30',gitHead:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verifiedDependency:'E6-T11d29',authority:'literal-original-wire-refusal-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,sources,predecessorSeals,rows};
fs.writeFileSync('evidence/virgl-production-readiness/standard-shared-exponent-consumer-gap.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.gitHead,rows:rows.length,refusals:rows.map(row=>row.result.error.code)}));
