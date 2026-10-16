#!/usr/bin/env node
// Promoted fresh-critic gate. Scoped compiler preparation and bounded hardware
// attacks; no production deployment or unrelated workspace gauntlet.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const output=path.resolve(process.argv[2]??'target/evidence/virgl-standard-packed-adversarial');await fs.mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),commands=[];
const emcc=process.env.EMCC??execFileSync('bash',['tools/setup-virgl-emsdk.sh'],{encoding:'utf8'}).trim(),env={...process.env,EMCC:emcc};
function run(label,command,args,expected=0){
 const startedAt=new Date().toISOString();let exit=0,bytes;
 try{bytes=execFileSync(command,args,{env,timeout:300000});}catch(e){exit=e.status;bytes=Buffer.concat([e.stdout??Buffer.alloc(0),e.stderr??Buffer.alloc(0)]);}
 assert.equal(exit,expected,label+' exit');commands.push({label,command:[command,...args],exit,startedAt,finishedAt:new Date().toISOString(),logSha256:sha(bytes)});return bytes;
}
await fs.writeFile(path.join(output,'prepare-native.log'),run('native preparation','bash',['renderer/virgl-shader/build.sh','standard-packed-native']));
await fs.writeFile(path.join(output,'prepare-wasm.log'),run('fixed-memory compiler preparation','bash',['renderer/virgl-shader/build.sh','wasm']));
for(const file of ['renderer/virgl-command/tests/standard-packed-vertex-fetch-adversarial.mjs','tools/virgl-command/standard-packed-adversarial-oracle.mjs','tools/virgl-command/standard-packed-adversarial-compiler.mjs'])run('syntax '+file,'node',['--check',file]);
await fs.writeFile(path.join(output,'compiler.log'),run('literal native/Wasm masks','node',['tools/virgl-command/standard-packed-adversarial-compiler.mjs',path.join(output,'compiler')]));
await fs.writeFile(path.join(output,'hardware.log'),run('seeded hardware','node',['tools/verify-virgl-standard-packed.mjs','--output',path.join(output,'hardware'),'--adversarial','true']));
const hardware=JSON.parse(await fs.readFile(path.join(output,'hardware/report.json'))),result=hardware.browserResult.result;
assert.equal(hardware.status,'passed');assert.equal(result.frames.length,92);assert.equal(result.rejections.length,14);assert.equal(result.suspensions.length,9);assert.equal(result.ownership.length,6);
const faults=[];
for(const mutation of ['native-normalize','constant-field','shader-sign']){
 const dir=path.join(output,'fault-'+mutation);await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'invocation.log'),run('promoted pixel sabotage '+mutation,'node',['tools/verify-virgl-standard-packed.mjs','--output',dir,'--adversarial','true','--smoke','true','--mutation',mutation],1));
 const report=JSON.parse(await fs.readFile(path.join(dir,'report.json'))),f=report.partial.frames[0];
 assert.equal(report.status,'failed');assert.equal(report.partial.frames.length,1);assert.equal(f.history.at(-1).result.gpuComplete,true);assert.ok(f.native.calls.length);assert.equal(f.audit.held,false);assert.ok(report.failure.message.includes('independent original compact pixels'));
 faults.push({mutation,draws:f.native.calls.length,completedFence:true,pixelMisses:f.audit.misses,reportSha256:sha(await fs.readFile(path.join(dir,'report.json')))});
}
const report={schema:'standard-packed-promoted-critic-gate-v1',status:'passed',frames:result.frames.length,pixels:result.frames.reduce((n,f)=>n+f.audit.pixels,0),seeds:result.seeds,
 rejections:result.rejections.length,suspensions:result.suspensions.length,ownership:result.ownership.length,hardwareReportSha256:sha(await fs.readFile(path.join(output,'hardware/report.json'))),faults,commands};
await fs.writeFile(path.join(output,'suite-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'passed',frames:report.frames,pixels:report.pixels,completedFaults:faults.length}));
