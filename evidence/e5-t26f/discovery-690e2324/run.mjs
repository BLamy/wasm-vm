// Reproduce one NEW cold seal and one unchanged-policy F discovery observation.
// Generated evidence orchestration, not a new acceptance command or F verdict.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../..');
const head = '690e23245b4b376c55c0b830f7690c8a0f72059e';
const currentHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(currentHead(), head);
const sha = b => createHash('sha256').update(b).digest('hex');
const retained = await mkdtemp(path.join(os.tmpdir(), 'e5-t26f-discovery-'));
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith('E5_T26F_') && !k.startsWith('E5_T26K_') && !k.startsWith('CARGO_') && !['RUSTFLAGS', 'RUST_LOG'].includes(k)));
const common = {
  E5_T26F_REQUIRE_HEAD: head, E5_T26F_HEADED: '0', E5_T26F_FIXTURE: 'resident-aplay-v1',
  E5_T26F_DIAGNOSTIC_PROFILE: retained, E5_T26F_DIAGNOSTIC_PORT: '61633',
  E5_T26F_TIMEOUT_MS: '1800000',
  E5_T26F_IMAGE: 'target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4',
  E5_T26F_IMAGE_INFO: 'target/e5-t26f/resident-image-2ae65408-a/desktop-info.json',
  E5_T26F_DESKTOP_ASSET_DIR: 'target/e5-t26f/chunks/resident-2ae65408',
};
const command = 'tools/verify/e5-t26f-browser-roundtrip.mjs';
const collector = 'tools/verify/e5-t26f-discovery-observation.mjs';
const sourceBindings = {};
for (const file of [command, collector, 'tools/verify/e5-t26f-resident-proof.mjs',
  'evidence/e5-t26f/discovery-690e2324/run.mjs']) sourceBindings[file] = sha(await readFile(path.join(repo, file)));
await writeFile(path.join(out, 'invocation.json'), JSON.stringify({ head, acceptance: false, common, command,
  sourceBindings, retained, order: ['cold', 'reuse-default4096-repack-off24'] }, null, 2) + '\n', { flag: 'wx' });
async function run(label, overrides) {
  assert.equal(currentHead(), head);
  const directory = path.join(out, label); await mkdir(directory);
  const config = { ...common, ...overrides, E5_T26F_OUT: directory };
  let log = JSON.stringify({ head, config, command }) + '\n';
  const child = spawn(process.execPath, [command], { cwd: repo, env: { ...clean, ...config }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { log += b.toString(); process.stdout.write(b); });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  await writeFile(path.join(directory, 'run.log'), log, { flag: 'wx' });
  await writeFile(path.join(directory, 'exit.json'), JSON.stringify(result) + '\n', { flag: 'wx' });
  assert.equal(result.signal, null); assert.equal(currentHead(), head);
  return { ...result, directory };
}
const cold = await run('cold', { E5_T26F_DIAGNOSTIC: 'create' });
assert.equal(cold.code, 0, 'cold failed; never rebind or reuse an old seal');
const reuse = await run('reuse', { E5_T26F_DIAGNOSTIC: 'reuse', E5_T26F_DIAGNOSTIC_JIT: '1',
  E5_T26F_DIAGNOSTIC_RESIDENCY: 'repack-off' });
assert.ok([0, 1].includes(reuse.code));
const record = path.join(reuse.directory, reuse.code === 0 ? 'diagnostic-iteration.json' : 'failure-post-restore-interaction-checks.json');
execFileSync(process.execPath, [collector, record, String(reuse.code), path.join(out, 'observation.json')],
  { cwd: repo, env: clean, stdio: 'inherit' });
console.log('Discovery observation closed; no F verification or policy change.');
