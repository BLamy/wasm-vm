// Verifier-only recording: one no-local clone, one prescribed runtime target. Never a browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(evidence, '../../..');
const expectedHead = '42bb34d854aca091a3940191a8da3b7aff765cad';
const scratch = mkdtempSync('/private/tmp/e5-t26l-verifier.');
const clone = path.join(scratch, 'repo');
const target = path.join(scratch, 'cargo-target');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const removedKeys = Object.keys(process.env).filter(k => k.startsWith('CARGO_') || k.startsWith('E5_') ||
  ['RUSTFLAGS', 'RUST_LOG', 'RUSTDOCFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'MAKEFLAGS', 'MFLAGS'].includes(k));
const env = { ...process.env };
for (const k of removedKeys) delete env[k];
// Only verifier-owned fresh target is introduced after scrubbing inherited Cargo variables.
env.CARGO_TARGET_DIR = target;
env.CARGO_BUILD_JOBS = '4';
const commands = [];
const sourceFiles = ['crates/core/src/compile_queue.rs', 'crates/core/src/lib.rs',
  'crates/core/tests/async_compile_pipeline.rs', 'Makefile', 'tools/verify/e5-t26l-browser-priority.mjs',
  'tools/verify/e5-t26l-browser-priority.test.mjs', 'tools/verify/e5-t26f-browser-roundtrip.mjs'];
const pins = root => Object.fromEntries(sourceFiles.map(f => [f, sha(readFileSync(path.join(root, f)))]));
const sharedBefore = pins(shared);
async function run(label, executable, args, cwd) {
  const filename = path.join(evidence, `${label}.log`);
  assert(!existsSync(filename), `refuse overwrite ${filename}`);
  let output = '';
  const startedAt = new Date().toISOString();
  const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output += b.toString(); });
  const result = await new Promise(resolve => {
    let error = null;
    child.once('error', e => { error = String(e); });
    child.once('close', (code, signal) => resolve({ code, signal, error }));
  });
  const finishedAt = new Date().toISOString();
  writeFileSync(filename, output, { flag: 'wx' });
  commands.push({ label, executable, args, cwd, startedAt, finishedAt, ...result, log: path.basename(filename), sha256: sha(output) });
  process.stdout.write(JSON.stringify(commands.at(-1)) + '\n');
  assert.equal(result.error, null); assert.equal(result.signal, null); assert.equal(result.code, 0, label);
  return output;
}
const startedAt = new Date().toISOString();
const initial = { expectedHead, scratch, clone, target, removedKeys, explicitBuildEnv: {
  CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: '4' }, startedAt, sharedBefore };
writeFileSync(path.join(evidence, 'pristine-invocation.json'), JSON.stringify(initial, null, 2) + '\n', { flag: 'wx' });
let error = null, initialStatus = null, finalStatus = null, clonePins = null;
try {
  await run('clone', 'git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--no-local', '--no-checkout',
    '--single-branch', '--branch', 'codex/e5-t26l-live-compile-priority', shared, clone], scratch);
  await run('checkout', 'git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', expectedHead], clone);
  assert.equal((await run('clone-head', 'git', ['rev-parse', 'HEAD'], clone)).trim(), expectedHead);
  assert(!existsSync(path.join(clone, '.git/objects/info/alternates')));
  initialStatus = await run('clone-initial-status', 'git', ['status', '--porcelain=v1', '--untracked-files=all'], clone);
  assert.equal(initialStatus, ''); assert(!existsSync(target)); assert(!existsSync(path.join(clone, 'target')));
  clonePins = pins(clone); assert.deepEqual(clonePins, sharedBefore);
  await run('rustc-version', 'rustc', ['-Vv'], clone);
  await run('node-version', 'node', ['--version'], clone);
  await run('wasm-pack-version', 'wasm-pack', ['--version'], clone);
  await run('pristine-runtime', 'make', ['verify-E5-T26l-runtime'], clone);
} catch (e) { error = String(e.stack || e); }
finally {
  if (existsSync(path.join(clone, '.git'))) {
    try { finalStatus = await run('clone-final-status', 'git', ['status', '--porcelain=v1', '--untracked-files=all'], clone); }
    catch (e) { error ||= String(e); }
  }
  const sharedAfter = pins(shared);
  const record = { ...initial, finishedAt: new Date().toISOString(), error, commands, initialStatus, finalStatus,
    clonePins, clonePinsAfter: clonePins ? pins(clone) : null, sharedAfter,
    sharedUnchanged: JSON.stringify(sharedBefore) === JSON.stringify(sharedAfter) };
  writeFileSync(path.join(evidence, 'pristine-result.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ error, scratch, finalStatus, sharedUnchanged: record.sharedUnchanged }) + '\n');
}
assert.equal(error, null); assert.equal(finalStatus, '');
