// Closed cold-checkpoint audit only. Never opens the live reuse or launches a browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePreparedSound } from '../../../tools/verify/e5-t26f-resident-proof.mjs';
const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../..');
const cold = path.join(repo, 'evidence/e5-t26f/resident-cold-7da05062');
const hash = b => createHash('sha256').update(b).digest('hex');
async function shaFile(file) {
  const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b);
  return h.digest('hex');
}
async function tree(directory, include = () => true) {
  const entries = [];
  async function visit(relative) {
    for (const name of (await fs.readdir(path.join(directory, relative))).sort()) {
      const next = path.join(relative, name); if (!include(next)) continue;
      const file = path.join(directory, next), info = await fs.lstat(file);
      assert.equal(info.isSymbolicLink(), false);
      if (info.isDirectory()) await visit(next);
      else { assert.equal(info.isFile(), true); entries.push([next, info.size, await shaFile(file)]); }
    }
  }
  await visit(''); assert.ok(entries.length);
  return { sha256: hash(JSON.stringify(entries)), files: entries.length, bytes: entries.reduce((sum, e) => sum + e[1], 0) };
}
const recordPath = path.join(cold, 'diagnostic-checkpoint.json');
const record = JSON.parse(await fs.readFile(recordPath)), m = record.milestones;
assert.equal(record.acceptance, false); assert.equal(m.run.diagnostic.mode, 'create');
assert.deepEqual(record.errors, { browser: [], http: [] });
const checkpointBytes = await fs.readFile(m.run.checkpointFile), checkpoint = JSON.parse(checkpointBytes);
const ownerPath = path.join(m.run.diagnostic.directory, 'e5-t26f-owner.json');
const owner = JSON.parse(await fs.readFile(ownerPath));
assert.deepEqual(owner.binding, m.run.binding);
assert.deepEqual(checkpoint.normalSnapshot, m.normalSnapshot);
assert.deepEqual(checkpoint.resident, m.residentCheckpoint);
assert.equal(checkpoint.profileSha256, m.run.profileSha256);
const profile = await tree(m.run.profile); assert.equal(profile.sha256, checkpoint.profileSha256);
const web = await tree(path.join(repo, 'web'), relative => ['src', 'pkg', 'bench'].includes(relative.split(path.sep)[0]) ||
  (!relative.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/.test(relative)));
assert.equal(web.sha256, owner.binding.runtimeSha256);
const envelope = JSON.parse(checkpoint.session.value), bytes = Buffer.from(envelope.bytes, 'base64');
assert.equal(checkpoint.session.key, 'wasm-vm.desktop-snapshot.v1');
assert.equal(hash(bytes), m.normalSnapshot.sha256); assert.equal(bytes.length, m.normalSnapshot.byteLength);
// Desktop header byte 12 is the retired-instruction boundary, NOT overlay generation.
// The initial audit incorrectly equated those fields; see recorded correction below.
const desktopRetirementBoundary = bytes.readBigUInt64LE(12).toString();
for (const key of ['sha256', 'byteLength', 'preFrontBufferCrc', 'machineResume']) assert.deepEqual(envelope[key], m.normalSnapshot[key]);
const sound = parsePreparedSound(bytes, hash(bytes)); assert.deepEqual(sound, m.residentCheckpoint.sound);
assert.equal(m.normalSnapshot.machineResume.overlayGeneration, 626);
assert.equal(m.normalSnapshotPause.isPaused, true);
const audit = m.normalCheckpointBeforeReload.observed;
assert.equal(m.normalCheckpointBeforeReload.status, 'passed');
assert.equal(audit.decision, 'resume'); assert.equal(audit.generation, 626); assert.equal(audit.finalGeneration, 626);
assert.equal(audit.isPaused, true); assert.equal(audit.stillPaused, true); assert.equal(audit.envelopeSha256, hash(bytes));
const pngPath = path.join(repo, m.residentCheckpoint.screenshot.file);
assert.equal(await shaFile(pngPath), m.residentCheckpoint.screenshot.sha256);
assert.equal(m.initialAplay.accepted, true); assert.equal(m.initialAplay.inputSequenceMatch, true);
assert.equal(m.initialAudio.after.writtenFrames, 1440); assert.equal(m.initialAudio.after.nonSilentFrames, 960);
assert.equal(m.initialAudio.outputAttached, true);
const report = {
  scope: 'closed diagnostic create only; no restore/timing/acceptance claim',
  checkedAt: new Date().toISOString(), head: owner.binding.head, browser: checkpoint.browser,
  artifacts: {
    'evidence/e5-t26f/resident-cold-7da05062/diagnostic-checkpoint.json': await shaFile(recordPath),
    'evidence/e5-t26f/resident-cold-7da05062/resident-prepared.png': await shaFile(pngPath),
    'evidence/e5-t26f/resident-cold-7da05062.log': await shaFile(`${cold}.log`),
    [m.run.checkpointFile]: hash(checkpointBytes), [ownerPath]: await shaFile(ownerPath),
  },
  profile, servedRuntime: web, normalSnapshot: m.normalSnapshot, actualEnvelopeSound: sound,
  desktopRetirementBoundary,
  auditCorrection: { initialAuditExit: 1, incorrectAssertion: 'desktop header u64 at byte 12 equals overlay generation 626',
    actual: desktopRetirementBoundary, correction: 'core desktop builder writes irqstats.retired here; generation is checked in the frozen snapshot metadata/audit, not this field',
    workerRefutation: false },
  frozenAudit: audit,
  manualPngTranscription: { method: 'direct independent image inspection, not OCR or worker summary',
    pre1AndPre2: { pid: 999, starttime: 27744, exe: '/usr/bin/aplay(inode-match)', wchan: 'pipe_read',
      childFifoFd: 3, childFifoFlags: '0100000', parentFd: 3, parentFlags: '0100002', childWriters: 0,
      pcmFd: 4, owner: 999, state: 'PREPARED', hw_ptr: 0, appl_ptr: 0 },
    visiblePreparedGreenAndPrompt: true, twoWindows: true, cursorVisible: true,
    initialAplayUnderrunMs: 0.324, initialAplaySubsequentGreenAndPrompt: true },
  reuseInspected: false,
};
await fs.writeFile(path.join(out, 'cold-audit.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
