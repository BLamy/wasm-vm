// Run only after the worker's final implemented handoff.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const out=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(out,'../../..');
const head='179b8fd04e716a24a7b15091b3f7b0de0a356dfb';
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:16*1024*1024});
const evidence=path.join(repo,'evidence/e5-t22a');
const proof=JSON.parse(await readFile(path.join(evidence,'browser-proof.json')));
assert.equal(proof.head,head);
const checked=[];
for(const [file,digest] of Object.entries(proof.digests)){
  assert.equal(sha(git('show',`${head}:${file}`)),digest,file+' frozen blob digest');
  assert.equal(sha(await readFile(path.join(repo,file))),digest,file+' working file digest');
  checked.push({file,digest});
}
for(const [file,expected] of [['host-hotplug.png',proof.screenshotSha256],['demo-suite.png',proof.demoScreenshotSha256]])
  assert.equal(sha(await readFile(path.join(evidence,file))),expected,file);
assert.deepEqual(proof.metrics,['126','0','126']);assert.deepEqual(proof.errors,[]);
assert.match(proof.detail,/E5-T22a/);
assert.equal(proof.observations.length,2);
for(const [i,backend] of ['direct','worker'].entries()){
  const o=proof.observations[i];assert.equal(o.backend,backend);assert.equal(o.rejected,32);
  assert.equal(o.samples.length,1003);
  for(const [j,s] of o.samples.entries()){
    const [w,h]=j<3?[[1,1],[4095,4095],[1367,901]][j]:[640+(j-3)%127,480+(j-3)%79];
    assert.equal(s.width,w);assert.equal(s.height,h);assert.equal(s.pendingEvents,1);
    assert.equal(s.edid.length,128);assert.equal(s.edid.reduce((a,b)=>a+b,0)%256,0);
    assert.equal(s.edid[56]+256*(s.edid[58]>>4),w);assert.equal(s.edid[59]+256*(s.edid[61]>>4),h);
  }
  assert.equal(o.final.advertisedWidth,750);assert.equal(o.final.advertisedHeight,531);
  assert.equal(o.final.resourceCount,0);assert.equal(o.final.resourceBytes,0);
  for(const key of ['scanoutResource','scanoutWidth','scanoutHeight'])assert.equal(o.final[key],null);
  if(backend==='direct')assert.equal(o.afterStop,'false/null');else assert.match(o.afterStop,/stopped/);
}
assert.deepEqual(proof.observations[0].final,proof.observations[1].final);
const mirrors=['display-hotplug.html','display-hotplug.js','linux-worker-protocol.js','loader.js','main.js','roadmap.js'];
for(const file of mirrors)assert.equal(sha(git('show',`${head}:web/${file}`)),sha(git('show',`${head}:web/dist/${file}`)),file+' dist mirror');
const baseline=['crates/core/src/lib.rs','crates/core/src/dispatch.rs','crates/core/src/hart/mod.rs',
 'crates/core/src/dev/virtio/gpu/resources.rs','crates/wasm/tests/gpu_protocol.rs',
 'crates/wasm/tests/hart_ctrl.rs','crates/wasm/tests/hart.rs','tools/ci/determinism-hazards.sh',
 'crates/wasm/tests/input_queues.rs','crates/core/src/dev/virtio/input/mod.rs',
 'crates/core/src/dev/virtio/mmio.rs','crates/core/src/dev/virtio/queue.rs',
 'Cargo.lock','crates/wasm/Cargo.toml','crates/wvseccomp/src/main.rs'];
const carried=baseline.map(file=>{const digest=sha(git('show',`af6b4bf4:${file}`));assert.equal(sha(git('show',`${head}:${file}`)),digest);return {file,digest};});
await writeFile(path.join(out,'final-audit.json'),JSON.stringify({head,proofSha256:sha(await readFile(path.join(evidence,'browser-proof.json'))),
  checked,mirrors,carried,samplesValidated:2006,invalidRequestsRejected:64,metrics:proof.metrics,errors:proof.errors},null,2)+'\n');
console.log('Final browser audit passed: exact-head hashes, screenshots, 2006 samples, 64 rejections, mirrors, baseline identity');
