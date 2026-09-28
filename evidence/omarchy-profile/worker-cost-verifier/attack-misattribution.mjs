// Bounded false-attribution attack on a copy of actual evidence. No guest run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateWorkerCostProfile} from '../../../tools/verify/omarchy-worker-cost-capture.mjs';
import {bindNames,summarize} from '../../../tools/verify/e5-t22c-symbolize-cpu.mjs';
const out=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(out,'../../..');
const rawPath=path.join(repo,'evidence/omarchy-profile/worker-cost-r1/desktop/worker-cpu.json');
const namedPath=path.join(repo,'target/omarchy-worker-cost-symbols/named.wasm');
const releasePath=path.join(repo,'web/dist/pkg/wasm_vm_wasm_bg.wasm');
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(rawPath),recording=JSON.parse(bytes);
const release=fs.readFileSync(releasePath),named=fs.readFileSync(namedPath);
const binding=bindNames(release,named);
const baseline=validateWorkerCostProfile(recording,recording.url);
const before=summarize(recording,binding.names);
const weights=new Map();
for(let i=0;i<recording.profile.samples.length;i++) {
  const id=recording.profile.samples[i];
  weights.set(id,(weights.get(id)||0)+recording.profile.timeDeltas[i]);
}
const moduleUrl=new URL('./pkg/wasm_vm_wasm_bg.wasm',recording.url).href;
const targets=recording.profile.nodes.filter(n=>n.callFrame.url===moduleUrl&&/^wasm-function\[\d+\]$/.test(n.callFrame.functionName)&&weights.has(n.id));
assert.ok(targets.length);
targets.sort((a,b)=>weights.get(b.id)-weights.get(a.id));
const target=targets[0],index=Number(target.callFrame.functionName.match(/\d+/)[0]);
const boundName=binding.names.get(index);assert.ok(boundName);
const shadowWorker=new URL('/decoy/linux-worker.js',recording.url).href;
const falseOwner=structuredClone(recording);falseOwner.target.url=shadowWorker;
let ownershipError;
try {validateWorkerCostProfile(falseOwner,recording.url);} catch(error){ownershipError=String(error);}
assert.ok(ownershipError,'suffix-match worker must not pass exact ownership');
const falseAttribution=structuredClone(recording);
const decoyUrl=new URL('/decoy/pkg/wasm_vm_wasm_bg.wasm',recording.url).href;
falseAttribution.profile.nodes.find(n=>n.id===target.id).callFrame.url=decoyUrl;
assert.deepEqual(validateWorkerCostProfile(falseAttribution,recording.url),baseline);
const after=summarize(falseAttribution,binding.names);
const foreignLabel=`${target.callFrame.functionName} ${decoyUrl}`;
const selfMap=summary=>new Map(summary.self.map(row=>[row.name,row.us]));
assert.equal(selfMap(after).get(foreignLabel),weights.get(target.id),'foreign index must retain its own unresolved URL label');
assert.equal((selfMap(before).get(boundName)||0)-(selfMap(after).get(boundName)||0),weights.get(target.id),'foreign samples must not inherit the bound release name');
assert.equal(after.totalUs,before.totalUs);assert.equal(after.samples,before.samples);
assert.equal(sha(fs.readFileSync(rawPath)),sha(bytes),'original profile changed');
assert.equal(sha(fs.readFileSync(namedPath)),sha(named),'original companion changed');
assert.equal(sha(fs.readFileSync(releasePath)),sha(release),'original release changed');
const result={checkedAt:new Date().toISOString(),kind:'same-origin decoy worker/module misattribution',
  rawSha256:sha(bytes),namedSha256:sha(named),releaseSha256:sha(release),
  originalNodeId:target.id,functionIndex:index,boundReleaseName:boundName,nodeWeightUs:weights.get(target.id),
  shadowWorkerRejected:true,ownershipError,decoyModuleUrl:decoyUrl,retainedForeignLabel:foreignLabel,
  foreignWeightUs:selfMap(after).get(foreignLabel),exactReleaseAttributionReducedByUs:weights.get(target.id),
  totalUsPreserved:true,rawFilesUnchanged:true,guestRerun:false};
fs.writeFileSync(path.join(out,'misattribution-attack.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
