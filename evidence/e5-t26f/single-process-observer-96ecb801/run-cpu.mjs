// Existing read-only cpu probe on a new copy of the closed checkpoint.
// Never rewrites the original attempt or substitutes this diagnostic for F acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(root, '../../..');
const invocation = JSON.parse(await readFile(path.join(root, 'invocation.json')));
const head = invocation.head;
const currentHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(currentHead(), head);
assert.equal(JSON.parse(await readFile(path.join(root, 'cold/exit.json'))).code, 0);
assert.equal(JSON.parse(await readFile(path.join(root, 'reuse/exit.json'))).code, 1);
const sourceBindings = {};
for (const f of [invocation.command, 'tools/verify/e5-t26f-resident-proof.mjs',
  'tools/guest/e5-t26f-resident-observer.sh', 'tools/guest/e5-t26f-observer.c',
  'target/e5-t26f/observer-build-v1/e5t26f-observe',
  'target/e5-t26f/observer-build-v1/build-info.json']) {
  sourceBindings[f] = hash(await readFile(path.join(repo, f)));
  assert.equal(sourceBindings[f], invocation.sourceBindings[f], `frozen input changed: ${f}`);
}
sourceBindings[path.relative(repo, fileURLToPath(import.meta.url))] = hash(await readFile(fileURLToPath(import.meta.url)));
for (const [file, expected] of Object.entries({
  'tools/verify/e5-t22c-cpu-profile.mjs': 'f75fb38299169c662f6f6668d63d17e8ddaf6ec70a19082455e9de121ea5d5d4',
  'crates/wasm/src/jit_browser.rs': '0b0830a1ea2f0c979ca4ae662b281b5e6c0044b7ce6964a52715ed887861deb8',
  'web/pkg/wasm_vm_wasm_bg.wasm': '84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d',
  'web/dist/pkg/wasm_vm_wasm_bg.wasm': '84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d',
})) {
  assert.equal(hash(await readFile(path.join(repo, file))), expected, file);
  sourceBindings[file] = expected;
}
const directory = path.join(root, 'cpu'); await mkdir(directory);
const output = path.join(directory, 'record');
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith('E5_') && !k.startsWith('CARGO_') && !['RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG'].includes(k)));
const config = { ...invocation.common, E5_T26F_DIAGNOSTIC: 'reuse', E5_T26F_DIAGNOSTIC_CPU: '1', E5_T26F_DIAGNOSTIC_JIT: '1', E5_T26F_DIAGNOSTIC_RESIDENCY: 'repack-off', E5_T26F_OUT: output };
await writeFile(path.join(directory, 'invocation.json'), JSON.stringify({ head, acceptance: false,
  command: invocation.command, config, sourceBindings }, null, 2) + '\n', { flag: 'wx' });
let log = JSON.stringify({ head, config }) + '\n';
const child = spawn(process.execPath, [invocation.command], { cwd: repo, env: { ...clean, ...config }, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { log += b.toString(); process.stdout.write(b); });
const result = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
});
await writeFile(path.join(directory, 'run.log'), log, { flag: 'wx' });
await writeFile(path.join(directory, 'exit.json'), JSON.stringify(result) + '\n', { flag: 'wx' });
assert.equal(result.signal, null); assert.equal(currentHead(), head);
for (const [f, digest] of Object.entries(sourceBindings)) assert.equal(hash(await readFile(path.join(repo, f))), digest);
assert.ok([0, 1].includes(result.code));
const file = path.join(output, result.code === 0 ? 'diagnostic-iteration.json' : 'failure-post-restore-interaction-checks.json');
const raw = JSON.parse(await readFile(file));
if (result.code === 1) assert.equal(raw.error?.message, 'post-restore interaction exceeded 2 seconds');
console.log(JSON.stringify({ childExit: result.code, elapsedMs: raw.milestones.postRestoreEnd - raw.milestones.postRestoreStart,
  cpuProfile: raw.milestones.cpuProfile }));
