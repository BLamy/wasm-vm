// Closed unprofiled COMPLETE record only; no live profiling evidence or browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(out, '../../..');
const dir = 'evidence/e5-t26f/resident-reuse-7da05062';
const hash = b => createHash('sha256').update(b).digest('hex');
const read = p => fs.readFile(path.join(repo, p));
const json = async p => JSON.parse(await read(p));
const raw = await read(`${dir}/diagnostic-completion.json`), r = JSON.parse(raw), m = r.milestones;
assert.equal(hash(raw), '8178ca2126a17ecbc1360b5c7adf3acd30c635558150d57b9283dfd1691f2e4a');
const cold = await json('evidence/e5-t26f/resident-cold-7da05062/diagnostic-checkpoint.json');
assert.deepEqual(m.run.binding, cold.milestones.run.binding);
assert.deepEqual(m.residentCheckpoint, cold.milestones.residentCheckpoint);
assert.deepEqual(m.normalSnapshot, cold.milestones.normalSnapshot);
assert.equal(m.run.profileSha256, cold.milestones.run.profileSha256);
assert.equal(r.acceptance, false); assert.equal(r.functionalChecksPassed, true);
assert.equal(r.timingPassed, false); assert.equal(r.checksPassed, false);
assert.equal(m.run.diagnostic.mode, 'reuse'); assert.equal(m.run.diagnostic.complete, true);
assert.equal(m.run.diagnostic.cpu, false); assert.equal(m.run.diagnostic.latency, false);
assert.equal(m.run.postRestoreCommand, 'play'); assert.equal(m.run.postRestoreKeyDelayMs, 5);
const elapsed = m.postRestoreEnd - m.postRestoreStart;
assert.equal(m.postRestoreStart, m.normalRestore.result.completedAt);
assert.equal(elapsed, 4731.884999990463); assert.ok(elapsed > 2000);
assert.equal(m.deferredInteractionCap.elapsedMs, elapsed); assert.equal(m.deferredInteractionCap.limitMs, 2000);
assert.equal(m.deferredInteractionCap.error.message, 'post-restore interaction exceeded 2 seconds');
assert.equal(m.residentBeforeGesture.length, 2);
for (const s of m.residentBeforeGesture) {
  assert.ok(s.observedAt >= m.postRestoreStart && s.observedAt < m.postRestoreCursor.observedAt);
  assert.equal(s.policy, 'locked'); assert.equal(s.context, 'suspended'); assert.equal(s.pcm.available, true);
  for (const k of ['writeIndex', 'readIndex', 'fillFrames', 'writtenFrames', 'nonSilentFrames', 'maxAbs']) assert.equal(s.pcm[k], 0);
}
assert.ok(m.residentBeforeGesture[1].observedAt - m.residentBeforeGesture[0].observedAt >= 350);
const ap = m.postRestoreAplay;
assert.equal(ap.command, 'play'); assert.equal(ap.accepted, true); assert.equal(ap.inputSequenceMatch, true);
assert.equal(ap.keyboardFrames, 10); assert.equal(ap.domEvents, 10); assert.equal(ap.terminalMarkerSeen, true);
assert.equal(ap.redMarkerSeen, false); assert.ok(ap.visualDiffPixels >= 2000);
assert.equal(m.postRestoreAudioBefore.writeIndex, 0);
assert.equal(m.postRestorePcmAtCompletion.pcm.writtenFrames, 1440);
assert.equal(m.postRestorePcmAtCompletion.pcm.nonSilentFrames, 1440);
assert.equal(m.postRestoreAudioAfter.guestAttached, true); assert.equal(m.postRestoreAudioAfter.context, 'running');
assert.ok(m.postRestoreAudioAfter.renderedFrames > m.postRestoreAudioBefore.renderedFrames);
const restores = [];
for (const [label, saved] of [['normal', m.normalSnapshot], ['drag', m.dragSnapshot]]) {
  const v = m[`${label}Restore`].result;
  assert.equal(v.snapshotSha256, saved.sha256); assert.equal(v.snapshotBytes, saved.byteLength);
  assert.equal(v.observation.firstPresent.crc32, saved.preFrontBufferCrc);
  assert.equal(v.handshake.generation, 2); assert.equal(v.report.agentRehandshake, true);
  assert.equal(v.report.fullRepairFrame, true); assert.equal(v.bootStates.some(x => x.state === 'booting'), false);
  assert.deepEqual(v.coherenceAudit.restoreBoundary, { attempted: true, decision: 'resume', overlayGeneration: 626 });
  restores.push({ label, sha256: saved.sha256, crc: saved.preFrontBufferCrc, receipt: v.coherenceAudit.restoreBoundary });
}
for (const k of ['dragBeforeSnapshot', 'dragHeldSnapshot', 'dragSnapshot', 'dragReleasedSnapshot']) assert.match(m[k].sha256, /^[0-9a-f]{64}$/);
assert.equal(m.dragMovement.observed.titlebar.left - m.dragMovement.before.left, 80);
assert.equal(m.dragMovement.paused.isPaused, true);
for (const k of ['dragCheckpointPublished', 'dragCheckpointBeforeReload']) {
  assert.equal(m[k].status, 'passed');
  assert.equal(m[k].observed.isPaused, true); assert.equal(m[k].observed.stillPaused, true);
  assert.equal(m[k].observed.generation, 626); assert.equal(m[k].observed.finalGeneration, 626);
  assert.equal(m[k].observed.decision, 'resume'); assert.equal(m[k].observed.envelopeSha256, m.dragSnapshot.sha256);
}
const release = m.dragGuestRelease;
assert.equal(release.initial.pointerFrames, 0); assert.equal(release.samples.length, 7);
let time = -Infinity;
for (const s of release.samples) {
  assert.ok(Number.isFinite(s.at) && s.at >= time); time = s.at;
  assert.deepEqual(s.heldButtons, []); assert.deepEqual(s.titlebar, { left: 637, right: 1280, top: 32, bottom: 58 });
  if (s.frame) {
    assert.equal(s.pointerFrames, 1); assert.equal(s.frame.source, 'pointermove');
    assert.deepEqual(s.frame.coordinates, { x: Math.round(669 / 1280 * 32767), y: Math.round(55 / 800 * 32767) });
    assert.equal(s.frame.events.every(e => e.eventType === 3), true);
  }
  if (s.rendered) { assert.equal(s.rendered.x, 669); assert.equal(s.rendered.y, 55); assert.equal(s.rendered.matchedPixels, 94); }
}
const dwell = release.observed.at - release.acknowledgedAt; assert.ok(dwell >= 1000);
assert.deepEqual(r.errors, { browser: [], http: [] });
const server = (await read(`${dir}/diagnostic-completion-server.log`)).toString();
const http404 = server.split('\n').filter(l => /" 404 /.test(l));
assert.equal(http404.length, 2); assert.equal(http404.every(l => l.includes('GET /favicon.ico ')), true);
const log = (await read(`${dir}.log`)).toString();
assert.match(log, /AssertionError \[ERR_ASSERTION\]: post-restore interaction exceeded 2 seconds/);
const artifacts = {};
for (const file of [...(await fs.readdir(path.join(repo, dir))).map(f => `${dir}/${f}`), `${dir}.log`, 'evidence/e5-t26f/resident-records.md']) artifacts[file] = hash(await read(file));
const result = { scope: 'closed diagnostic COMPLETE at 7da05062; committed in 33a65efb; not F acceptance',
  artifacts, exactCap: { t0: m.postRestoreStart, end: m.postRestoreEnd, elapsed, limit: 2000, passed: false },
  laterTelemetryElapsedMs: m.postRestoreInteraction.elapsedMs,
  beforeGestureOffsetsMs: m.residentBeforeGesture.map(s => s.observedAt - m.postRestoreStart),
  pcmObservedMs: m.postRestorePcmAtCompletion.elapsedMs, pcmFirstArrivalTime: 'not established by this record',
  pcm: m.postRestorePcmAtCompletion.pcm, restores,
  drag: { actualHorizontalPx: 80, panelClampVerticalPx: 19, samples: 7, acknowledgedAt: release.acknowledgedAt, finalAt: release.observed.at, dwellMs: dwell },
  manuallyViewedPngs: ['diagnostic-completion-timing.png', 'diagnostic-completion.png'],
  visualWitness: 'post PID999/start27744/exe inode match/pipe_read/FIFO3 flags0100000/parentFD3 flags0100002/PCM4 owner999 PREPARED hw0 app0; physically typed play; green aplay; original job Done; prompt',
  xruns: 'first-playback terminal retains recovered 0.324ms underrun; no new underrun displayed in resident post block, not a zero-XRUN counter claim',
  profilingEvidenceInspected: false };
await fs.writeFile(path.join(out, 'reuse-audit.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
