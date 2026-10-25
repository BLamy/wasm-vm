import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {desktopWallOpen,validateDesktopWallAmendment,OLD_DESKTOP_WALL_MS,
  QUALIFIED_DESKTOP_WALL_MS,FROZEN_V10_SHA256} from './e9-workload-wall.mjs';
import {loadQualificationAssets} from './e9-workload-assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const desktop=path.resolve(root,process.env.E9_T22N_DESKTOP??'target/evidence/e9-t22c-submission-a161b0f8d/desktop');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=name=>fs.readFile(path.join(root,name));

test('v11 is a wall-only amendment chained to the exact failed v10 input',async()=>{
  const [v10Bytes,v11Bytes,reportBytes]=await Promise.all([
    read('docs/design/session-workload-qualification-v10.json'),
    read('docs/design/session-workload-qualification-v11.json'),
    fs.readFile(path.join(desktop,'report.json'))]);
  const v11=JSON.parse(v11Bytes),report=JSON.parse(reportBytes);
  assert.equal(sha(v10Bytes),FROZEN_V10_SHA256);
  assert.equal(sha(reportBytes),'12b51f16c8502c9c4243e1c639c8d619a015c780bb5fa97630caa32fe224e593');
  assert.equal(report.inputs.serializationSha256,FROZEN_V10_SHA256);
  assert.equal(report.head,v11.retainedFailure.head);
  assert.equal(report.dirty,'');
  assert.equal(validateDesktopWallAmendment(v11,sha(v10Bytes)),QUALIFIED_DESKTOP_WALL_MS);
  for(const changed of [
    {...v11,desktopHostWallMs:Infinity},
    {...v11,desktopHostWallMs:OLD_DESKTOP_WALL_MS},
    {...v11,guestTransitionBound:'unbounded'},
    {...v11,workload:'smaller'},
    {...v11,previousQualification:{...v11.previousQualification,sha256:'0'.repeat(64)}},
    {...v11,retainedFailure:{...v11.retainedFailure,reportSha256:'0'.repeat(64)}}
  ])assert.throws(()=>validateDesktopWallAmendment(changed,sha(v10Bytes)),/wall-only/);
  assert.throws(()=>validateDesktopWallAmendment(v11,'0'.repeat(64)),/wall-only/);
});

test('the exact eight-hour failure is retained as incomplete evidence',async()=>{
  const reportBytes=await fs.readFile(path.join(desktop,'report.json'));
  const report=JSON.parse(reportBytes),result=report.result;
  const saved=JSON.parse(await fs.readFile(path.join(desktop,'saved/storage.json')));
  assert.equal(report.status,'failed');
  assert.equal(result.status,'failed');
  assert.match(result.error,/desktop qualification wall bound/);
  assert.match(report.failure,/desktop qualification wall bound/);
  assert.deepEqual(report.errors,[]);
  assert.equal(result.phase,'boot');
  assert.equal(result.failurePosition.transition,'17550000000');
  assert.equal(result.checkpoints.length,351);
  assert.equal(result.receipts,2472);
  assert.equal(result.blocks.length,952);
  assert.deepEqual(result.viewports,[]);
  assert.equal(result.retentionAtEnd.payloadBytes,8692849469);
  assert.equal(saved.stores.chunks.length,10320);
  assert.equal(saved.stores.objects.length,2822);
  const metadata=Object.fromEntries(saved.stores.metadata.map(row=>[row.key,row.value]));
  assert.equal(metadata.payloadBytes,8692849469);
  assert.equal(metadata.limits.maxBytes,16*1024**3);
  const oldPage=await fs.readFile(path.join(desktop,'executed-source/tools/verify/e9-workload-desktop-page.mjs'));
  assert.equal(sha(oldPage),report.executedSources.find(row=>row.path==='tools/verify/e9-workload-desktop-page.mjs').sha256);
  assert.match(oldPage.toString(),/performance\.now\(\)-begun<28800000/);
});

test('old boundary refuses; new finite boundary admits until 16 hours',()=>{
  const begun=1200;
  assert.equal(desktopWallOpen(begun+OLD_DESKTOP_WALL_MS,begun,OLD_DESKTOP_WALL_MS),false);
  assert.equal(desktopWallOpen(begun+OLD_DESKTOP_WALL_MS,begun,QUALIFIED_DESKTOP_WALL_MS),true);
  assert.equal(desktopWallOpen(begun+QUALIFIED_DESKTOP_WALL_MS-1,begun,QUALIFIED_DESKTOP_WALL_MS),true);
  assert.equal(desktopWallOpen(begun+QUALIFIED_DESKTOP_WALL_MS,begun,QUALIFIED_DESKTOP_WALL_MS),false);
  for(const [now,start,limit] of [[begun-1,begun,QUALIFIED_DESKTOP_WALL_MS],
    [Infinity,begun,QUALIFIED_DESKTOP_WALL_MS],[NaN,begun,QUALIFIED_DESKTOP_WALL_MS],
    [begun,begun,Infinity],[begun,begun,0],[begun,begun,Number.MAX_SAFE_INTEGER+1]])
    assert.equal(desktopWallOpen(now,start,limit),false);
});

test('software qualification keeps its prior version and has no desktop wall profile',async()=>{
  const assets=await loadQualificationAssets('software');
  try{
    assert.equal(assets.qualification.version,10);
    assert.equal(assets.qualification.desktopHostWallMs,undefined);
    assert.equal(assets.receipt.wallProfileSha256,null);
  }finally{await assets.close();}
});

test('the production page differs from the failed sealed source only at its wall guard',async()=>{
  const oldPage=(await fs.readFile(path.join(desktop,'executed-source/tools/verify/e9-workload-desktop-page.mjs'))).toString();
  const newPage=(await read('tools/verify/e9-workload-desktop-page.mjs')).toString();
  const wallImport="import {desktopWallOpen,QUALIFIED_DESKTOP_WALL_MS} from '/e9-workload-wall.mjs';\n";
  assert.equal(newPage.split(wallImport).length,2);
  let reverted=newPage.replace(wallImport,'');
  const changes=[
    ["qualification?.version===11&&qualification.desktopHostWallMs===QUALIFIED_DESKTOP_WALL_MS\n    &&qualification.browserContext", "qualification?.version===10&&qualification.browserContext"],
    ["desktopWallOpen(performance.now(),begun,qualification.desktopHostWallMs)","performance.now()-begun<28800000"]
  ];
  for(const [after,before] of changes){assert.equal(reverted.split(after).length,2);reverted=reverted.replace(after,before);}
  assert.equal(reverted,oldPage,'all guest transitions, cadence, GPU, workload and replay logic are byte-identical');
});
