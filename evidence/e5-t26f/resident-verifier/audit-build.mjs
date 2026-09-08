// Independent read-only digest/record audit. Writes only its result in this directory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../..');
const evidence = 'evidence/e5-t26f/resident-image';
const digests = {};
const hash = b => createHash('sha256').update(b).digest('hex');
const read = p => fs.readFile(path.join(repo, p));
const json = async p => JSON.parse(await read(p));
async function digest(p, expected) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path.join(repo, p))) h.update(b);
  const actual = h.digest('hex');
  if (expected) assert.equal(actual, expected, p);
  digests[p] = actual; return actual;
}
const frozen = '7da050620031145b6e76cf150a894ed2710bd5b2';
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), frozen);
assert.equal(git(['diff', '--name-only', '00cad42c..' + frozen, '--', 'crates', 'web']), '');
const helper = 'tools/guest/e5-t26f-resident-aplay.sh';
const helperHash = await digest(helper, '2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c');
const builderHash = await digest('tools/verify/e5-t26f-resident-image.mjs');
const helperBytes = await read(helper);
const comparison = await json(`${evidence}/comparison.json`);
await digest(`${evidence}/comparison.json`, 'cb580ddf06f71b5a1af71256c0e54bf53857ad33d5b722f9dc5ec6375f808053');
await digest(`${evidence}/tests.log`, comparison.tests.logSha256);
const builds = [];
for (const b of comparison.builds) {
  const dir = `${evidence}/${b.label}`;
  const record = await json(`${dir}/record.json`);
  await digest(`${dir}/record.json`, b.recordSha256);
  await digest(`${evidence}/${b.label}.log`, b.logSha256);
  assert.equal(record.code, 0); assert.equal(record.signal, null); assert.deepEqual(record.before, record.after);
  assert.equal(record.before.builderSha256, builderHash); assert.equal(record.before.helperSha256, helperHash);
  for (const a of record.artifacts) {
    await digest(`${dir}/${a.name}`, a.sha256);
    assert.equal((await fs.stat(path.join(repo, dir, a.name))).size, a.size);
  }
  const info = await json(`${dir}/desktop-info.json`);
  await digest(`${dir}/desktop-info.json`, b.metadataSha256);
  assert.deepEqual(info.fixture, b.fixture); assert.deepEqual(info.image, b.image);
  const imageHash = await digest(info.image.path, info.image.sha256);
  assert.equal((await fs.stat(path.join(repo, info.image.path))).size, 1073741824);
  assert.deepEqual(await read(`${dir}/resident-readback.sh`), helperBytes);
  const inode = (await read(`${dir}/resident-stat.txt`)).toString();
  for (const pattern of [/Type: regular\s+Mode:\s+0444/, /User:\s+0\s+Group:\s+0/, /Links:\s+1/, /Generation:\s+0/, /Size:\s+7225/]) assert.match(inode, pattern);
  for (const field of ['atime', 'mtime', 'ctime', 'crtime']) assert.match(inode, new RegExp(`${field}: 0x67353d80:00000000`));
  const fsck = (await read(`${dir}/fsck.log`)).toString();
  for (let pass = 1; pass <= 5; pass++) assert.ok(fsck.includes(`Pass ${pass}:`));
  assert.doesNotMatch(fsck, /WARNING|UNEXPECTED|error/i);
  const baseDir = path.dirname(info.fixture.basePath);
  assert.deepEqual(await read(`${dir}/MANIFEST.txt`), await read(`${baseDir}/MANIFEST.txt`));
  assert.deepEqual(await read(`${dir}/FILE-MANIFEST.txt`), Buffer.concat([await read(`${baseDir}/FILE-MANIFEST.txt`), Buffer.from(`${helperHash} 0444 /usr/libexec/wasm-vm/e5t26f-resident.sh\n`)]));
  await digest(`${baseDir}/desktop-info.json`, info.fixture.baseInfoSha256);
  builds.push({ label: b.label, imageHash, artifactsAuthenticated: record.artifacts.length, exit: record.code, sameFrozenHelperAndBuilder: true, readbackAndInode: true, fsckFivePasses: true });
}
assert.equal(builds[0].imageHash, builds[1].imageHash);
const base = comparison.builds[0].fixture.basePath;
await digest(base, comparison.baseAfterSha256);
// Retain the initial package-query failure as failure, authenticate every available artifact.
const failed = await json(`${evidence}/a-failed-apk-info/record.json`);
assert.equal(failed.code, 1);
for (const a of failed.artifacts) await digest(`${evidence}/a-failed-apk-info/${a.name}`, a.sha256);
await digest(`${evidence}/a-failed-apk-info/record.json`);
await digest(`${evidence}/a-failed-apk-info.log`);

const chunkDir = 'target/e5-t26f/chunks/resident-2ae65408';
const manifestBytes = await read(`${chunkDir}/manifest.json`), manifest = JSON.parse(manifestBytes);
digests[`${chunkDir}/manifest.json`] = hash(manifestBytes);
assert.equal(hash(manifestBytes), '2245a4d8b8b804bb200079c1ce00dee868762324f18627fa5d2b11fe032639ef');
assert.equal(manifest.image_len, 1073741824); assert.equal(manifest.chunk_size, 131072); assert.equal(manifest.chunks.length, 8192);
const whole = createHash('sha256'); let bytes = 0;
for (const sha of manifest.chunks) {
  assert.match(sha, /^[0-9a-f]{64}$/);
  const chunk = await read(`${chunkDir}/chunks/${sha}.bin`);
  assert.equal(hash(chunk), sha); assert.equal(chunk.length, 131072);
  whole.update(chunk); bytes += chunk.length;
}
const assembled = whole.digest('hex'); assert.equal(assembled, builds[0].imageHash);
const worker = 'evidence/e5-t26f/resident-gates/focused-tests.log';
await digest(worker);
const gate = (await read(worker)).toString();
assert.match(gate, /tests 233/); assert.match(gate, /pass 233/); assert.match(gate, /fail 0/); assert.match(gate, /skipped 0/);
assert.equal(gate.split('\n').filter(l => l.startsWith('✔')).length, 233);
await digest('evidence/e5-t26f/completion/guest-release-8c892667/diagnostic-completion.json', '28046f748fc855531d5bc77874cfff7c57ce85992e231eb68d369d85bdbf2e8a');
await digest('evidence/e5-t26f/completion/critic.md');
for (const name of ['predictions.md', 'attacks.mjs', 'attacks.json', 'focused.log', 'sabotage-playback-event.log', 'sabotage-child-exit.log', 'sabotage-image-readback.log']) await digest(`evidence/e5-t26f/resident-verifier/${name}`);
const scopedManifestExceptions = {};
for (const p of ['web/dist/artifacts.json', 'web/dist/artifacts-node-alpine.json']) scopedManifestExceptions[p] = await digest(p);
const report = { head: frozen, node: process.version, checkedAt: new Date().toISOString(), changedRuntimeOrWebFiles: [],
  builds, initialMechanicalFailureRetained: failed.code, chunks: { count: manifest.chunks.length, bytes, reassembledSha256: assembled },
  workerGate: { passed: 233, failed: 0, skipped: 0, independentlyRerunNewResidentTests: 60 },
  scopedManifestExceptions, digests, browserEvidenceInspected: false };
await fs.writeFile(path.join(out, 'build-audit.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...report, digests: { filesAuthenticated: Object.keys(digests).length } }, null, 2));
