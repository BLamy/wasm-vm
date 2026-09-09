// One existing guest-PC diagnostic on a new copy of the ORIGINAL 05b seal.
// Not the derived quiet snapshot, not acceptance and not a performance comparison.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(root, '../../..');
const original = JSON.parse(await readFile(path.join(repo,
  'evidence/e5-t26f/single-process-observer-05b82bc6/invocation.json')));
const head = '001e80864911863145f2127192bae5df8186e68b';
const currentHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBindings = {
  'tools/verify/e5-t22c-cpu-profile.mjs': 'f75fb38299169c662f6f6668d63d17e8ddaf6ec70a19082455e9de121ea5d5d4',
  'tools/verify/e5-t26f-guest-profile.mjs': '1b9d202be44aa3c01f770ef5483551be0cfc828631b6cbc78caff53baf70948a',
  'tools/verify/e5-t26k-decoded-cache.mjs': 'fc6dde980554845fc3d28f5e44dcd0caf0c1659d48b320054a00aeb8e67e9843',
};
for (const file of [original.command, 'tools/verify/e5-t26f-resident-proof.mjs',
  'tools/guest/e5-t26f-resident-observer.sh', 'tools/guest/e5-t26f-observer.c',
  'target/e5-t26f/observer-build-v1/e5t26f-observe',
  'target/e5-t26f/observer-build-v1/build-info.json']) sourceBindings[file] = original.sourceBindings[file];
sourceBindings[path.relative(repo, fileURLToPath(import.meta.url))] = hash(await readFile(fileURLToPath(import.meta.url)));
async function checkPins() {
  assert.equal(currentHead(), head);
  for (const [file, digest] of Object.entries(sourceBindings)) {
    assert.equal(hash(await readFile(path.join(repo, file))), digest, `input drift: ${file}`);
  }
}
await checkPins();
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('E5_') && !key.startsWith('CARGO_') && !['RUSTFLAGS', 'RUST_LOG'].includes(key)));
const config = { ...original.common, E5_T26F_REQUIRE_HEAD: head,
  E5_T26F_DIAGNOSTIC: 'reuse', E5_T26F_DIAGNOSTIC_GUEST_PROFILE: '1', E5_T26F_OUT: path.join(root, 'record') };
await writeFile(path.join(root, 'invocation.json'), JSON.stringify({ head, acceptance: false, fVerified: false,
  command: original.command, config, sourceBindings,
  limitation: 'Existing sampled interpreted virtual-PC histogram only; no PID/ASID tags, whole-CPU attribution or speedup claim' }, null, 2) + '\n', { flag: 'wx' });
let log = JSON.stringify({ head, config }) + '\n';
const child = spawn(process.execPath, [original.command], { cwd: repo, env: { ...clean, ...config }, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes.toString(); process.stdout.write(bytes); });
const result = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
});
await writeFile(path.join(root, 'run.log'), log, { flag: 'wx' });
await writeFile(path.join(root, 'exit.json'), JSON.stringify(result) + '\n', { flag: 'wx' });
await checkPins();
assert.equal(result.signal, null); assert.ok([0, 1].includes(result.code));
const file = path.join(config.E5_T26F_OUT,
  result.code === 0 ? 'diagnostic-iteration.json' : 'failure-post-restore-interaction-checks.json');
const bytes = await readFile(file), raw = JSON.parse(bytes);
if (result.code === 1) assert.equal(raw.error?.message, 'post-restore interaction exceeded 2 seconds');
assert.equal(raw.milestones.guestProfileAfter.available, true);
console.log(JSON.stringify({ acceptance: false, fVerified: false, childExit: result.code,
  rawPath: file, rawSha256: hash(bytes), elapsedMs: raw.milestones.postRestoreEnd - raw.milestones.postRestoreStart,
  profile: raw.milestones.guestProfileAfter.state }));
