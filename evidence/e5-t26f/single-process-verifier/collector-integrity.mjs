// Incremental read-only admission/arithmetic review; no gates, browser or profile scan.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileQueueObservation } from '../../../tools/verify/e5-t26f-compile-queue-observation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const sha = b => createHash('sha256').update(b).digest('hex');
const read = f => readFileSync(path.resolve(repo, f));
const rawPath = 'evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.json';
const postPath = 'evidence/e5-t26f/single-process-observer-05b82bc6/posthoc-observation.json';
const provenancePath = 'evidence/e5-t26f/single-process-observer-05b82bc6/posthoc-provenance.json';
const pins = {
  'tools/verify/e5-t26f-discovery-observation.mjs': '423019e85fc480cb3badf91c412a558a1f7ffaf44ac54c033eac31e5c0f1380f',
  'tools/verify/e5-t26f-discovery-observation.test.mjs': 'bec3a06c8e466a490680463ab0db7a52f56dffec3fc503666566266e1c46cf1e',
  'tools/verify/e5-t26f-compile-queue-observation.test.mjs': '6243d3aee5ec34333c496d6510d7db39bd514a0a03656bc4df7727a9de897c81',
  'tools/verify/e5-t26f-compile-queue-observation.mjs': 'fff0cf5e7bbbf9c822bbe6b62cb2dcf936076da1eeb3d455d3cdd7a915c02dcc',
  'tools/verify/e5-t26f-resident-proof.mjs': 'd5615b185536f0f0af3da7d4b133ec28ec9e2c62962d22b3cd57e8c24f5a5810',
  [rawPath]: '0881a4aa55808bd0884b5a6ef2f05af4da9601b119e188390cef94b4c667002a',
  [postPath]: '7a0ec6b45330319c6a49457365f968538bbda0ce78bf6fad38565f984d01dc50',
  'evidence/e5-t26f/single-process-collector-gates.log': '65b83ca58cfc82f2d8c30c10ea9fbd2e7154c28ad8e43c6874758e566ca88df8',
};
const record = { acceptance: false, operation: 'review collector patch and independently recompute original raw counters', pins };
try {
  for (const [f, pin] of Object.entries(pins)) assert.equal(sha(read(f)), pin, f);
  const collectorPath = 'tools/verify/e5-t26f-discovery-observation.mjs';
  const old = execFileSync('git', ['show', `05b82bc6:${collectorPath}`], { cwd: repo }).toString();
  const current = read(collectorPath).toString();
  const body = s => s.slice(s.indexOf('export const DISCOVERY_COUNTERS'));
  const oldGuard = 'assert.equal(run.fixture?.kind, "resident-aplay-v1");';
  assert.equal(body(current).replace('validateObservationFixture(run);', oldGuard), body(old));
  record.unchangedAccountingAndTimingBodySha256 = sha(body(old));
  const rawBytes = read(rawPath), raw = JSON.parse(rawBytes), original = structuredClone(raw);
  const post = JSON.parse(read(postPath)), provenanceBytes = read(provenancePath), provenance = JSON.parse(provenanceBytes);
  record.provenanceSha256 = sha(provenanceBytes);
  assert.equal(provenance.rawSha256, pins[rawPath]); assert.equal(provenance.outputSha256, pins[postPath]);
  assert.equal(provenance.originalWrapperExit, 1); assert.equal(provenance.postprocessingExit, 0);
  assert.equal(provenance.originalCollectorSha256, sha(old));
  for (const [f, pin] of Object.entries(provenance.sourceBindings)) assert.equal(pin, pins[f]);
  assert.equal(post.record, path.join(repo, rawPath)); assert.equal(post.recordSha256, pins[rawPath]);
  const m = raw.milestones, a = m.jitBefore.state, b = m.jitAfter.state;
  const exact = n => { assert.ok(Number.isSafeInteger(n) && n >= 0); return BigInt(n); };
  const delta = (oldValue, newValue) => exact(newValue) - exact(oldValue);
  const discover = Object.fromEntries(['nominated', 'deduped', 'droppedStale', 'droppedOverflow', 'countsDropped', 'excluded']
    .map(k => [k, Number(delta(a.discovery[k], b.discovery[k]))]));
  const q = Object.fromEntries(['admitted', 'droppedBackpressure', 'cancelledStale', 'popped']
    .map(k => [k, delta(a.compileQueue[k], b.compileQueue[k])]));
  const discoveryDepth = delta(a.discovery.queueDepth, b.discovery.queueDepth);
  const pending = delta(a.compileQueue.queueDepth, b.compileQueue.queueDepth);
  const staged = delta(a.discovery.nominated, b.discovery.nominated) - discoveryDepth;
  const submitted = delta(a.jitSubmittedMembers, b.jitSubmittedMembers);
  const poppedUnsubmitted = q.popped - submitted;
  const incoming = staged - q.admitted;
  const displaced = q.admitted - pending - q.cancelledStale - q.popped;
  assert.equal(staged, pending + q.droppedBackpressure + q.cancelledStale + q.popped);
  assert.equal(incoming + displaced, q.droppedBackpressure);
  const accounting = { staged, submitted, pendingDepthDelta: pending, droppedBackpressure: q.droppedBackpressure,
    cancelledStale: q.cancelledStale, popped: q.popped, poppedUnsubmitted, incomingRejected: incoming, residentDisplaced: displaced };
  for (const [k, v] of Object.entries(accounting)) { assert.ok(v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER)); accounting[k] = Number(v); }
  assert.deepEqual(post.accounting, accounting); assert.deepEqual(post.deltas, discover);
  assert.deepEqual(post.compileQueue.deltas, Object.fromEntries(Object.entries(q).map(([k,v])=>[k,Number(v)])));
  assert.equal(post.compileQueue.depthDelta, Number(pending));
  assert.deepEqual(post.before, m.jitBefore); assert.deepEqual(post.after, m.jitAfter);
  assert.deepEqual(post.binding, m.run.binding); assert.equal(post.profileSha256, m.run.profileSha256);
  assert.equal(post.snapshotSha256, m.normalSnapshot.sha256); assert.equal(post.head, raw.head);
  assert.equal(m.postRestoreStart, m.normalRestore.result.completedAt);
  assert.ok(m.jitBefore.requestedAt >= m.postRestoreStart && m.jitBefore.receivedAt < m.postRestoreEnd && m.jitAfter.requestedAt >= m.postRestoreEnd);
  for (const s of [a,b]) { assert.equal(s.discovery.generation, s.discoveryGeneration); assert.equal(s.hasExecutor,true);
    assert.equal(s.decodedCacheEntries,4096); assert.equal(s.jitResidencyPolicy,'repack-off'); assert.equal(s.jitResidencyCap,24);
    assert.equal(s.entryCost.timingEnabled,false); }
  assert.equal(a.discoveryGeneration,b.discoveryGeneration);
  assert.equal(post.elapsedMs, m.postRestoreEnd-m.postRestoreStart);
  for (const key of ['acceptance','fVerified','fTimingPassed']) assert.equal(post[key],false);
  // Independently recomputed arithmetic above; now compare the actual patched public function.
  const actual = compileQueueObservation(raw,1);
  const {record: ignoredRecord, recordSha256: ignoredSha, ...derived} = post;
  assert.deepEqual(actual,derived); assert.deepEqual(raw,original);
  assert.ok(!existsSync(path.join(repo,'evidence/e5-t26f/single-process-observer-05b82bc6/observation.json')));
  for (const [f,pin] of Object.entries(pins)) assert.equal(sha(read(f)),pin,`after ${f}`);
  assert.equal(sha(read(provenancePath)),record.provenanceSha256);
  record.rawSamples = { before: {discovery:a.discovery,compileQueue:a.compileQueue,submitted:a.jitSubmittedMembers},
    after: {discovery:b.discovery,compileQueue:b.compileQueue,submitted:b.jitSubmittedMembers} };
  record.independent = { discoveryDelta: discover, discoveryDepthDelta: Number(discoveryDepth),
    compileQueueDelta: Object.fromEntries(Object.entries(q).map(([k,v])=>[k,Number(v)])), accounting,
    guestRetiredDelta: Number(delta(a.guestRetired,b.guestRetired)), jitRetiredDelta: Number(delta(a.retiredViaJit,b.retiredViaJit)),
    elapsedMs: post.elapsedMs, fTimingPassed: false, fVerified: false };
  record.held = true;
} catch(error) { record.failure=String(error); record.stack=error.stack; process.exitCode=1; }
writeFileSync(path.join(here,'collector-integrity-v1.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({held:record.held??false,failure:record.failure??null,independent:record.independent}));
