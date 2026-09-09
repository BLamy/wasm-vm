// P11/P12: inspect only closed artifacts. No browser, collector repair, or input writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parsePreparedSound, assertFreshLockedPcm } from '../../../tools/verify/e5-t26f-resident-proof.mjs';
import { compileQueueObservation } from '../../../tools/verify/e5-t26f-compile-queue-observation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const dir = path.join(repo, 'evidence/e5-t26f/single-process-observer-05b82bc6');
const sha256 = b => createHash('sha256').update(b).digest('hex');
async function sha256File(f) { const h = createHash('sha256'); for await (const b of createReadStream(f)) h.update(b); return h.digest('hex'); }
const record = { acceptance: false, files: {}, predictions: 'P11/P12 registered in preflight.md before browser; source-independent bytes must match sealed bindings.' };
async function file(f) { const b = await readFile(f); record.files[f] = { sha256: sha256(b), size: b.length }; return b; }
const json = async f => JSON.parse(await file(f));
try {
  const invocation = await json(path.join(dir, 'invocation.json'));
  const cold = await json(path.join(dir, 'cold/diagnostic-checkpoint.json'));
  const raw = await json(path.join(dir, 'reuse/failure-post-restore-interaction-checks.json'));
  const m = raw.milestones, binding = m.run.binding;
  record.head = invocation.head; record.sourceBindings = {};
  for (const [f, expected] of Object.entries(invocation.sourceBindings)) {
    const actual = await sha256File(path.join(repo, f));
    assert.equal(actual, expected, `frozen input changed: ${f}`);
    record.sourceBindings[f] = { expected, actual };
  }
  assert.equal(Object.keys(record.sourceBindings).length, 17);
  assert.equal(raw.head, invocation.head); assert.equal(binding.head, invocation.head);
  assert.deepEqual(cold.milestones.run.binding, binding);
  const owner = await json(path.join(invocation.retained, 'e5-t26f-owner.json'));
  assert.deepEqual(owner.binding, binding);
  const runner = (await readFile(path.join(repo, invocation.command))).toString();
  const start = runner.indexOf('async function treeDigest('), end = runner.indexOf('\nasync function diagnosticBinding(');
  assert.ok(start > 0 && end > start);
  const treeSource = runner.slice(start, end);
  const entries = [];
  // Execute the runner's exact function, with its final serialized entries retained.
  const treeDigest = vm.runInNewContext(treeSource + '\ntreeDigest', { assert, readdir, lstat, path, sha256File,
    sha256: bytes => { entries.push(JSON.parse(bytes)); return sha256(bytes); } });
  const runtime = await treeDigest(path.join(repo, 'web'), relative =>
    ['src', 'pkg', 'bench'].includes(relative.split(path.sep)[0]) ||
    (!relative.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/u.test(relative)));
  assert.equal(runtime, binding.runtimeSha256);
  const profile = await treeDigest(path.join(invocation.retained, 'checkpoint-profile'));
  const checkpoint = await json(path.join(invocation.retained, 'normal-checkpoint.json'));
  assert.equal(profile, checkpoint.profileSha256); assert.equal(profile, m.run.profileSha256);
  assert.equal(profile, cold.milestones.run.profileSha256);
  record.trees = { functionSha256: sha256(treeSource), runtime: { sha256: runtime, count: entries[0].length, entries: entries[0] },
    checkpointProfile: { path: path.join(invocation.retained, 'checkpoint-profile'), sha256: profile, count: entries[1].length, entries: entries[1] } };
  assert.equal(checkpoint.session.key, 'wasm-vm.desktop-snapshot.v1');
  const envelope = JSON.parse(checkpoint.session.value), bytes = Buffer.from(envelope.bytes, 'base64');
  assert.equal(envelope.schema, 'wasm-vm.e5-t26f.desktop-snapshot.v1');
  assert.equal(sha256(bytes), envelope.sha256); assert.equal(bytes.length, envelope.byteLength);
  for (const key of ['sha256', 'byteLength', 'preFrontBufferCrc', 'machineResume']) assert.deepEqual(envelope[key], checkpoint.normalSnapshot[key]);
  assert.deepEqual(checkpoint.normalSnapshot, cold.milestones.normalSnapshot);
  assert.deepEqual(checkpoint.normalSnapshot, m.normalSnapshot);
  const sound = parsePreparedSound(bytes, checkpoint.normalSnapshot.sha256);
  assert.deepEqual(sound, checkpoint.resident.sound); assert.deepEqual(sound, m.residentCheckpoint.sound);
  assert.deepEqual(checkpoint.resident, cold.milestones.residentCheckpoint);
  assert.deepEqual(checkpoint.resident, m.residentCheckpoint);
  assert.equal(envelope.machineResume.persisted, true); assert.equal(envelope.machineResume.paused, true);
  assert.equal(m.normalRestore.result.observation.firstPresent.crc32, envelope.preFrontBufferCrc);
  assert.deepEqual(m.normalRestore.result.machineResume, envelope.machineResume);
  assert.equal(m.normalRestore.result.snapshotSha256, envelope.sha256);
  record.envelope = { sha256: sha256(bytes), byteLength: bytes.length, crcMetadata: envelope.preFrontBufferCrc,
    crcFirstPresent: m.normalRestore.result.observation.firstPresent.crc32, machineResume: envelope.machineResume,
    note: 'CRC is paired front-buffer metadata, not CRC32 of the envelope. Envelope/section/trailer hashes are checked by parsePreparedSound.' };
  record.sound = sound;
  const kernel = JSON.parse(await readFile(path.join(repo, 'web/artifacts-alpine.json'))).artifacts.kernel;
  const url = new URL(kernel.url, binding.origin + '/desktop-cursor.html');
  const root = url.pathname.startsWith('/releases/') ? repo : path.join(repo, 'web');
  const kernelFile = path.resolve(root, '.' + url.pathname);
  assert.equal(url.origin, binding.origin); assert.ok(kernelFile.startsWith(root + path.sep));
  assert.equal(await sha256File(kernelFile), binding.kernelSha256);
  record.kernelSha256 = binding.kernelSha256;
  const imageInfo = await json(path.join(repo, invocation.common.E5_T26F_IMAGE_INFO));
  assert.equal(await sha256File(path.join(repo, invocation.common.E5_T26F_IMAGE)), binding.imageSha256);
  assert.equal((await lstat(path.join(repo, invocation.common.E5_T26F_IMAGE))).size, binding.imageBytes);
  assert.equal(imageInfo.image.sha256, binding.imageSha256);
  assert.equal(await sha256File(path.join(repo, invocation.common.E5_T26F_DESKTOP_ASSET_DIR, 'manifest.json')), binding.manifestSha256);
  record.imageSha256 = binding.imageSha256; record.manifestSha256 = binding.manifestSha256;
  const screenshotFile = path.join(repo, checkpoint.resident.screenshot.file);
  assert.equal(sha256(await file(screenshotFile)), checkpoint.resident.screenshot.sha256);
  await file(path.join(dir, 'reuse/failure-post-restore-interaction-checks.png'));
  record.coldExit = await json(path.join(dir, 'cold/exit.json')); record.reuseExit = await json(path.join(dir, 'reuse/exit.json'));
  assert.deepEqual(record.coldExit, { code: 0, signal: null }); assert.deepEqual(record.reuseExit, { code: 1, signal: null });
  assert.deepEqual(cold.errors, { browser: [], http: [] });
  assert.equal(raw.errors, undefined);
  record.errorCoverage = { cold: cold.errors, genericReuseHasFullErrorArrays: false,
    presentationErrors: m.normalRestore.result.presentation.errors, laterCoherence: m.normalRestore.result.coherenceAudit };
  assert.deepEqual(record.errorCoverage.presentationErrors, []);
  for (const key of ['fullRepairFrame', 'agentRehandshake']) assert.equal(m.normalRestore.result.report[key], true);
  assert.equal(m.normalRestore.result.handshake.version, 1);
  assert.equal(m.normalRestore.result.bootStates.some(s => s.state === 'booting'), false);
  assert.equal(m.normalRestore.result.report.soundXrunEvents, 0);
  assert.equal(m.residentBeforeGesture.length, 2);
  for (const s of m.residentBeforeGesture) { assertFreshLockedPcm(s); assert.ok(s.observedAt >= m.postRestoreStart); }
  assert.ok(m.residentBeforeGesture[1].observedAt > m.residentBeforeGesture[0].observedAt);
  for (const command of [checkpoint.resident.prepared, m.postRestoreAplay]) {
    for (const k of ['accepted', 'inputSequenceMatch', 'terminalMarkerSeen']) assert.equal(command[k], true);
    assert.equal(command.redMarkerSeen, false);
  }
  assert.equal(m.postRestoreAplay.command, 'play'); assert.equal(m.run.postRestoreKeyDelayMs, 5);
  assert.equal(m.postRestoreOutputAttached.outputAttached, true);
  assert.ok(m.postRestorePcmAtCompletion.pcm.writtenFrames > 0 && m.postRestorePcmAtCompletion.pcm.nonSilentFrames > 0 && m.postRestorePcmAtCompletion.pcm.maxAbs > 0);
  assert.ok(m.postRestoreAudioAfter.renderedFrames > m.postRestoreAudioBefore.renderedFrames);
  assert.deepEqual(m.postRestoreInteraction.heldButtons, []);
  assert.equal(m.postRestoreInteraction.audio.policy, 'unlocked'); assert.equal(m.postRestoreInteraction.audio.context, 'running');
  assert.equal(m.postRestoreStart, m.normalRestore.result.completedAt);
  assert.equal(raw.error.message, 'post-restore interaction exceeded 2 seconds');
  const elapsedMs = m.postRestoreEnd - m.postRestoreStart; assert.ok(elapsedMs > 2000);
  record.functional = { restore: m.normalRestore, prepared: checkpoint.resident.prepared, residentBeforeGesture: m.residentBeforeGesture,
    cursor: m.postRestoreCursor, play: m.postRestoreAplay, pcm: m.postRestorePcmAtCompletion, attached: m.postRestoreOutputAttached,
    audioBefore: m.postRestoreAudioBefore, audioAfter: m.postRestoreAudioAfter, interaction: m.postRestoreInteraction };
  record.timing = { start: m.postRestoreStart, end: m.postRestoreEnd, elapsedMs, capMs: 2000, fTimingPassed: false, fVerified: false };
  try { compileQueueObservation(raw, 1); throw new Error('unexpected collector success'); }
  catch (e) { assert.equal(e.code, 'ERR_ASSERTION'); assert.equal(e.actual, 'resident-observer-v1'); assert.equal(e.expected, 'resident-aplay-v1');
    record.collectorRefutation = { code: e.code, actual: e.actual, expected: e.expected, stack: e.stack }; }
  const names = await readdir(dir); assert.ok(!names.includes('observation.json'));
  await file(path.join(repo, 'evidence/e5-t26f/single-process-observer-05b82bc6.log'));
  for (const [f, pin] of Object.entries(record.files)) assert.equal(await sha256File(f), pin.sha256, `record mutated: ${f}`);
  for (const [f, pin] of Object.entries(invocation.sourceBindings)) assert.equal(await sha256File(path.join(repo, f)), pin, `input mutated: ${f}`);
  record.integrityHeld = true;
} catch (error) { record.failure = String(error); record.stack = error.stack; process.exitCode = 1; }
await writeFile(path.join(here, 'browser-integrity-v1.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ integrityHeld: record.integrityHeld ?? false, failure: record.failure ?? null,
  trees: record.trees && { runtime: { sha256: record.trees.runtime.sha256, count: record.trees.runtime.count },
    profile: { sha256: record.trees.checkpointProfile.sha256, count: record.trees.checkpointProfile.count } },
  envelope: record.envelope, timing: record.timing, collectorRefuted: Boolean(record.collectorRefutation) }));
