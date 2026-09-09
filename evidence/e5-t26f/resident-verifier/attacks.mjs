// Harness-only: source copies/mutations stay in a new temporary directory.
// No browser, Docker, emulator, or shared source writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { parsePreparedSound } from '../../../tools/verify/e5-t26f-resident-proof.mjs';

const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../..');
const hash = x => createHash('sha256').update(x).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(head, '7da050620031145b6e76cf150a894ed2710bd5b2');
const names = ['resident-proof', 'resident-aplay', 'resident-image'];
const sourceFiles = ['tools/guest/e5-t26f-resident-aplay.sh',
  'tools/verify/e5-t26f-browser-roundtrip.mjs',
  ...names.flatMap(n => [`tools/verify/e5-t26f-${n}.test.mjs`, ...(n === 'resident-aplay' ? [] : [`tools/verify/e5-t26f-${n}.mjs`])])];
const before = Object.fromEntries(await Promise.all(sourceFiles.map(async f => [f, hash(await fs.readFile(path.join(repo, f)))])));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(RUSTFLAGS$|RUST_LOG$|CARGO_|NODE_OPTIONS$)/.test(key)));
const run = async (cwd, args, log) => {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 2**20 });
  const text = `$ ${process.execPath} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}\nexit=${result.status} signal=${result.signal}\n`;
  await fs.writeFile(path.join(out, log), text, { flag: 'wx' });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { exit: result.status, log, sha256: hash(text) };
};
const baseline = await run(repo, ['--test', ...names.map(n => `tools/verify/e5-t26f-${n}.test.mjs`)], 'focused.log');
assert.equal(baseline.exit, 0);

// Independent literal envelope construction: hashes are recomputed after mutation.
function envelope(count, lastStream = 1) {
  const snd = Buffer.alloc(184 + count * 8);
  snd.write('WVSND001'); snd.writeUInt16LE(1, 8); snd[12] = 1;
  snd.writeBigUInt64LE(128n, 16); snd[48] = 2; snd[49] = 1;
  snd.writeUInt32LE(0x101, 52); snd.writeUInt32LE(3840, 60); snd.writeUInt32LE(1920, 64);
  snd[72] = 2; snd[73] = 5; snd[74] = 7; snd.writeUInt32LE(count, 164);
  snd[176] = 1; snd[177] = 1; snd[179] = 1;
  for (let i = 0; i < count; i++) { snd.writeUInt32LE(0x111, 184 + i * 8); snd.writeUInt32LE(i === count - 1 ? lastStream : 1, 188 + i * 8); }
  const sections = [[4, Buffer.from('opaque carried agent')], [3, snd], [1, Buffer.from('opaque carried gpu')], [2, Buffer.from('opaque carried input')]];
  const body = Buffer.concat(sections.map(([tag, bytes]) => {
    const header = Buffer.alloc(40); header.writeUInt16LE(tag); header.writeUInt16LE(1, 2); header.writeUInt32LE(bytes.length, 4);
    Buffer.from(hash(bytes), 'hex').copy(header, 8); return Buffer.concat([header, bytes]);
  }));
  const header = Buffer.alloc(28); header.write('WVMDESK1'); header.writeUInt16LE(1, 8);
  header.writeBigUInt64LE(616n, 12); header.writeUInt32LE(4, 20); header.writeUInt32LE(body.length, 24);
  const bytes = Buffer.concat([header, body]); return Buffer.concat([bytes, Buffer.from(hash(bytes), 'hex')]);
}
const atBound = envelope(256), overflow = envelope(257), lastPlayback = envelope(256, 0);
const result = parsePreparedSound(atBound, hash(atBound));
assert.equal(result.events.length, 256); assert.deepEqual(result.events.at(-1), { code: 0x111, stream: 1 });
assert.throws(() => parsePreparedSound(overflow, hash(overflow)), /codec bound/);
assert.throws(() => parsePreparedSound(lastPlayback, hash(lastPlayback)), /queued playback XRUN/);
const novel = { acceptedCaptureEvents: 256, refusedOverflow: 257, refusedLastPlaybackIndex: 255,
  reorderedSections: [4, 3, 1, 2], nonSoundPayloads: 'opaque placeholders; this tests only the sound-proof reader, not restoration',
  envelopeSha256: { bound: hash(atBound), overflow: hash(overflow), lastPlayback: hash(lastPlayback) } };

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'e5t26f-resident-critic-'));
for (const file of sourceFiles) {
  await fs.mkdir(path.dirname(path.join(scratch, file)), { recursive: true });
  await fs.copyFile(path.join(repo, file), path.join(scratch, file));
}
const mutations = [
  { name: 'playback-event', file: 'tools/verify/e5-t26f-resident-proof.mjs',
    from: '    assert.notEqual(event.stream, 0, "prepared checkpoint has a queued playback XRUN");', to: '    // SABOTAGE: allow queued playback event.',
    pattern: 'queued playback XRUN refuses', test: 'tools/verify/e5-t26f-resident-proof.test.mjs' },
  { name: 'child-exit', file: 'tools/guest/e5-t26f-resident-aplay.sh',
    from: '    if wait "$e5_pid"; then', to: '    if :; then # SABOTAGE: green without waiting for same child',
    pattern: 'nonzero original child exit', test: 'tools/verify/e5-t26f-resident-aplay.test.mjs' },
  { name: 'image-readback', file: 'tools/verify/e5-t26f-resident-image.mjs',
    from: '    assert.deepEqual(await io.readFile(path.join(destination, "resident-readback.sh")), helperBytes, "installed helper readback differs");',
    to: '    // SABOTAGE: accept different installed bytes after zero-exit Docker.',
    pattern: 'zero-exit Docker', test: 'tools/verify/e5-t26f-resident-image.test.mjs' },
];
const sabotage = [];
for (const mutation of mutations) {
  const original = await fs.readFile(path.join(repo, mutation.file), 'utf8');
  assert.equal(original.split(mutation.from).length, 2, 'mutation has one exact target');
  const modified = original.replace(mutation.from, mutation.to);
  await fs.writeFile(path.join(scratch, mutation.file), modified);
  const killed = await run(scratch, ['--test', `--test-name-pattern=${mutation.pattern}`, mutation.test], `sabotage-${mutation.name}.log`);
  assert.notEqual(killed.exit, 0, `${mutation.name} survived`);
  let semanticWitness = null;
  if (mutation.name === 'playback-event') {
    const mutant = await import(pathToFileURL(path.join(scratch, mutation.file)));
    semanticWitness = mutant.parsePreparedSound(lastPlayback, hash(lastPlayback)).events.at(-1);
    assert.deepEqual(semanticWitness, { code: 0x111, stream: 0 });
  }
  sabotage.push({ ...mutation, originalSha256: hash(original), mutatedSha256: hash(modified), ...killed, semanticWitness });
  await fs.writeFile(path.join(scratch, mutation.file), original);
}
const after = Object.fromEntries(await Promise.all(sourceFiles.map(async f => [f, hash(await fs.readFile(path.join(repo, f)))])));
assert.deepEqual(after, before, 'shared source changed');
const report = { head, node: process.version, scratch, browserRun: false, sharedSourcesUnchanged: true, sourceSha256: before,
  baseline, novel, sabotage, scrubbed: ['RUSTFLAGS', 'RUST_LOG', 'CARGO_*', 'NODE_OPTIONS'], scriptSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))) };
await fs.writeFile(path.join(out, 'attacks.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
