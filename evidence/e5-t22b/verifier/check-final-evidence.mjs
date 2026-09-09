import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir='evidence/e5-t22b/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=f=>sha(readFileSync(f));
const frozen='66bb2a48019d089756cdfaee3d5ea578f156bc28';
const proof=JSON.parse(readFileSync(dir+'viewport-proof.json'));
assert.equal(hash(dir+'viewport-proof.json'),'d273f19eb6f5b7ce92505d049fada88dc73ee79f02776a3be83478cd66587690');
assert.equal(hash(dir+'acceptance.log'),'703d8693242638966c4c0b08d64a39a9d9b80e2ef5c7a9d039ecce24f9017a43');
assert.equal(proof.head,frozen);
const initial=JSON.parse(readFileSync(dir+'initial/viewport-proof.json'));
const files=Object.entries(proof.digests).map(([file,digest])=>{
  assert.equal(hash(file),digest,file+' current bytes');
  assert.equal(sha(execFileSync('git',['show',frozen+':'+file],{maxBuffer:64*1024*1024})),digest,file+' frozen bytes');
  return {file,digest,unchanged:initial.digests[file]===digest};
});
for(const f of ['src/sink/presentation.js','src/sink/viewport.js','display-resize.js','display-resize.html','main.js','ide.js','roadmap.js']) {
  assert.equal(hash('web/'+f),hash('web/dist/'+f),'source/dist '+f);
}
for(const r of proof.results) {
  assert.equal(hash(dir+r.screenshotName),r.screenshotSha256);
  const c=r.checks.find(c=>c.label==='two-matching-partial-frames-before-raf');
  assert.ok(c.coalesced&&c.partial);assert.equal(c.state.sizeMismatch,false);
  assert.equal(c.state.backend,r.backend);
  assert.equal(r.afterDispose.dprWatcherPending,false);
  assert.equal(r.afterDispose.timerPending,false);
}
assert.equal(hash(dir+'demo-suite.png'),proof.demoScreenshotSha256);
assert.deepEqual(proof.metrics,['126','0','126']);assert.deepEqual(proof.errors,[]);
assert.equal(proof.appOwnership.paused,true);
assert.equal(proof.appOwnership.gpu.advertisedWidth,1122);
assert.equal(proof.appOwnership.gpu.advertisedHeight,240);
assert.equal(proof.appOwnership.gpu.scanoutResource,null);
assert.equal(hash(dir+'initial/viewport-proof.json'),'2ff642aa2a49afd6964101705edc54e2f924797c71092a6719d8dd6bf95679fe');
for(const f of ['odd-transition.json','odd-transition-repeat.json']) assert.equal(hash(dir+'verifier/'+f),'cd2be46575d0b6f4ab886a2435e36800739aab459f7dd6b4d9efe8d9ad0ac8b6');
const attack=JSON.parse(readFileSync(dir+'verifier/odd-transition-final-66bb2a48.json'));
assert.ok(attack.results.every(r=>r.checks.every(c=>c.mismatches===0)));
assert.equal(attack.digests['web/src/sink/presentation.js'],proof.digests['web/src/sink/presentation.js']);
const testOutput=execFileSync('node',['--test','web/tests/e5-t22b-viewport.test.mjs'],{encoding:'utf8'});
writeFileSync(dir+'verifier/final-unit-tests.log',testOutput);
const result={frozen,checkedHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files,
  screenshotDigestsVerified:7,cases:proof.results.length,oracles:proof.results.reduce((n,r)=>n+r.checks.length,0),
  checkedBytes:proof.results.reduce((n,r)=>n+r.checks.reduce((a,c)=>a+c.checkedBytes,0),0),
  attackChecks:attack.results.reduce((n,r)=>n+r.checks.length,0),attackSha256:hash(dir+'verifier/odd-transition-final-66bb2a48.json'),
  unitLogSha256:hash(dir+'verifier/final-unit-tests.log'),mainApp:proof.appOwnership,metrics:proof.metrics,errors:proof.errors};
writeFileSync(dir+'verifier/final-integrity.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
