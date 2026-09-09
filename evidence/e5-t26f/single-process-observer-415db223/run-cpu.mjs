// One read-only profile on a fresh copy of this head's closed checkpoint.
// Diagnostic only: preserves the original unprofiled failure and F endpoint.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
const invocation = JSON.parse(await readFile(path.join(root, 'invocation.json')));
const head = invocation.head;
const headNow = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(head, '415db223733214b6c6e7b69b0ad331150969be56');
assert.equal(headNow(), head);
assert.equal(JSON.parse(await readFile(path.join(root, 'cold/exit.json'))).code, 0);
assert.equal(JSON.parse(await readFile(path.join(root, 'reuse/exit.json'))).code, 1);
const original = JSON.parse(await readFile(path.join(root, 'reuse/failure-post-restore-interaction-checks.json')));
assert.equal(original.error.message, 'post-restore interaction exceeded 2 seconds');
const sourceBindings = { ...invocation.sourceBindings,
  'tools/verify/e5-t22c-cpu-profile.mjs': 'f75fb38299169c662f6f6668d63d17e8ddaf6ec70a19082455e9de121ea5d5d4',
  'crates/wasm/src/jit_browser.rs': '0b0830a1ea2f0c979ca4ae662b281b5e6c0044b7ce6964a52715ed887861deb8',
  'web/pkg/wasm_vm_wasm_bg.wasm': 'a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42',
  'web/dist/pkg/wasm_vm_wasm_bg.wasm': 'a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42',
};
sourceBindings[path.relative(repo, fileURLToPath(import.meta.url))] = sha(await readFile(fileURLToPath(import.meta.url)));
async function verifyBindings() {
  assert.equal(headNow(), head);
  for (const [file, digest] of Object.entries(sourceBindings))
    assert.equal(sha(await readFile(path.join(repo, file))), digest, file);
}
await verifyBindings();
const directory = path.join(root, 'cpu-default');
await mkdir(directory); // Never overwrite any attempt.
const output = path.join(directory, 'record');
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('E5_') && !key.startsWith('CARGO_') && !['RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG'].includes(key)));
const config = { ...invocation.common, E5_T26F_DIAGNOSTIC: 'reuse',
  E5_T26F_DIAGNOSTIC_CPU: '1', E5_T26F_OUT: output };
await writeFile(path.join(directory, 'invocation.json'), JSON.stringify({ head, acceptance: false,
  command: invocation.command, config, sourceBindings }, null, 2) + '\n', { flag: 'wx' });
let log = JSON.stringify({ head, config }) + '\n';
const child = spawn(process.execPath, [invocation.command], {
  cwd: repo, env: { ...clean, ...config }, stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
  log += bytes.toString(); process.stdout.write(bytes);
});
const result = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
});
await writeFile(path.join(directory, 'run.log'), log, { flag: 'wx' });
await writeFile(path.join(directory, 'exit.json'), JSON.stringify(result) + '\n', { flag: 'wx' });
assert.equal(result.signal, null);
await verifyBindings();
assert.ok([0, 1].includes(result.code));
const file = path.join(output, result.code === 0 ? 'diagnostic-iteration.json' : 'failure-post-restore-interaction-checks.json');
const raw = JSON.parse(await readFile(file));
if (result.code === 1) assert.equal(raw.error.message, 'post-restore interaction exceeded 2 seconds');
console.log(JSON.stringify({ childExit: result.code, acceptance: false,
  elapsedMs: raw.milestones.postRestoreEnd - raw.milestones.postRestoreStart,
  cpuProfile: raw.milestones.cpuProfile }));
