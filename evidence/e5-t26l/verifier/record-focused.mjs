// Run one exact focused verifier check in the already-proven isolated clone; never shared source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const evidence = path.dirname(fileURLToPath(import.meta.url));
const [label, expectedExit, filter] = process.argv.slice(2);
assert.match(label, /^(sabotage-selection|sabotage-stale|novel-outer-scope)$/);
assert.match(expectedExit, /^(0|101)$/); assert(filter);
const prior = JSON.parse(readFileSync(path.join(evidence, 'pristine-result.json'), 'utf8'));
assert.equal(prior.error, null); assert.equal(prior.initialStatus, ''); assert.equal(prior.finalStatus, '');
const { clone, target, expectedHead } = prior;
const sha = b => createHash('sha256').update(b).digest('hex');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: clone, encoding: 'utf8' }).trim(), expectedHead);
const files = ['crates/core/src/compile_queue.rs', 'crates/core/src/lib.rs', 'crates/core/tests/async_compile_pipeline.rs'];
const pins = () => Object.fromEntries(files.map(f => [f, sha(readFileSync(path.join(clone, f)))]));
const before = pins();
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CARGO_') && !k.startsWith('E5_') &&
  !['RUSTFLAGS','RUST_LOG','RUSTDOCFLAGS','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','MAKEFLAGS','MFLAGS'].includes(k)));
env.CARGO_TARGET_DIR = target; env.CARGO_BUILD_JOBS = '4';
const args = ['test', '-p', 'wasm-vm-core', '--features', 'trace,gpu-trace', '--test', 'async_compile_pipeline', filter, '--', '--exact', '--nocapture'];
const logPath = path.join(evidence, `${label}.log`);
assert(!existsSync(logPath));
const patch = execFileSync('git', ['diff', '--', ...files], { cwd: clone });
writeFileSync(path.join(evidence, `${label}.patch`), patch, { flag: 'wx' });
let output = '';
const startedAt = new Date().toISOString();
const child = spawn('cargo', args, { cwd: clone, env, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output += b.toString(); });
const result = await new Promise(resolve => {
  let error = null; child.once('error', e => { error = String(e); });
  child.once('close', (code, signal) => resolve({ code, signal, error }));
});
writeFileSync(logPath, output, { flag: 'wx' });
const record = { head: expectedHead, clone, target, command: ['cargo', ...args], startedAt, finishedAt: new Date().toISOString(),
  ...result, expectedExit: Number(expectedExit), sourceBefore: before, sourceAfter: pins(),
  logSha256: sha(output), patchSha256: sha(patch) };
writeFileSync(path.join(evidence, `${label}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(output); process.stdout.write(JSON.stringify(record) + '\n');
assert.equal(result.error, null); assert.equal(result.signal, null); assert.equal(result.code, Number(expectedExit));
assert.deepEqual(record.sourceBefore, record.sourceAfter);
assert.match(output, /running 1 test/);
