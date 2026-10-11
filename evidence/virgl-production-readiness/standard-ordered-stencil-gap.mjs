import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const frozen='ff80836249c9f235cae516421498a574b51b6f9c';
const pin=JSON.parse(await fs.readFile(new URL('./standard-ordered-stencil-gap.json',import.meta.url),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(pin.sourceHead,frozen);
// This recorder reproduces the verified predecessor. Changed runtime must
// use its own selected acceptance, never relabel the old refusal recording.
for(const source of pin.runtimeSources){
 const body=await fs.readFile(path.join(repo,source.path));
 assert.equal(body.length,source.bytes,source.path+' original length');
 assert.equal(sha(body),source.sha256,source.path+' original identity');
}
const output=path.resolve(process.argv[2]??path.join(repo,'target/evidence/virgl-ordered-stencil-gap-repro'));
execFileSync(process.execPath,[path.join(repo,'tools/verify-virgl-standard-stencil.mjs'),'--output',output,'--mode','failures'],{cwd:repo,stdio:'inherit'});
execFileSync('python3',[path.join(repo,'tools/virgl-stencil/values.py'),output],{cwd:repo,stdio:'inherit'});
const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));
assert.equal(report.status,'passed');
assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
const negative=[];
for(const index of report.browserResult.result.runs){
 const run=JSON.parse(await fs.readFile(path.join(output,index.path),'utf8'));
 if(!['reference','value-mask','write-mask'].includes(run.failurePhase))continue;
 const f=run.failure,expected=pin.nativeNegatives.find(p=>p.format===run.format&&p.phase===run.failurePhase);
 assert.ok(expected);assert.equal(f.hex,expected.packetHex);
 assert.equal(f.result.ok,false);assert.equal(f.result.error.code,'unsupported-stencil');
 assert.equal(f.result.error.byteOffset,40);assert.equal(f.result.error.opcode,8);
 assert.equal(f.result.gpuComplete,true);assert.deepEqual(f.result.draws,[]);
 assert.ok(!run.events.some(e=>e.label===f.label&&['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','blitFramebuffer'].includes(e.name)));
 negative.push({name:run.name,format:run.format,phase:run.failurePhase,packetHex:f.hex,result:f.result,wholeRun:index});
}
assert.equal(negative.length,6);
const result={schema:'original-asymmetric-stencil-native-repro-v1',sourceHead:frozen,executionHead:report.gitHead,status:'passed',originalNativeRefusals:negative,runtimeSources:report.sources,browser:report.browser,browserErrors:report.browserErrors,wholeReport:{path:'report.json',sha256:sha(await fs.readFile(path.join(output,'report.json')))},guestExecution:false,productionNegotiation:false,productionDrawAuthority:false};
await fs.writeFile(path.join(output,'original-asymmetry-gap.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,sourceHead:frozen,executionHead:result.executionHead,originalNativeRefusals:negative.length,output}));
