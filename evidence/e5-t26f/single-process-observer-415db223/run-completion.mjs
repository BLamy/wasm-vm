// Existing diagnostic completion path; the two-second failure is retained/rethrown.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
const invocation = JSON.parse(await readFile(path.join(root, 'invocation.json')));
const headNow = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(invocation.head, '415db223733214b6c6e7b69b0ad331150969be56');
assert.equal(JSON.parse(await readFile(path.join(root, 'cold/exit.json'))).code, 0);
assert.equal(JSON.parse(await readFile(path.join(root, 'reuse/exit.json'))).code, 1);
const sourceBindings = { ...invocation.sourceBindings,
  'web/pkg/wasm_vm_wasm_bg.wasm': 'a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42',
  'web/dist/pkg/wasm_vm_wasm_bg.wasm': 'a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42',
};
sourceBindings[path.relative(repo, fileURLToPath(import.meta.url))] = sha(await readFile(fileURLToPath(import.meta.url)));
async function verifyBindings() {
  assert.equal(headNow(), invocation.head);
  for (const [file, digest] of Object.entries(sourceBindings))
    assert.equal(sha(await readFile(path.join(repo, file))), digest, file);
}
await verifyBindings();
const directory = path.join(root, 'completion');
await mkdir(directory);
const output = path.join(directory, 'record');
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('E5_') && !key.startsWith('CARGO_') && !['RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG'].includes(key)));
const config = { ...invocation.common, E5_T26F_DIAGNOSTIC: 'reuse',
  E5_T26F_DIAGNOSTIC_COMPLETE: '1', E5_T26F_OUT: output };
await writeFile(path.join(directory, 'invocation.json'), JSON.stringify({ head: invocation.head,
  acceptance: false, command: invocation.command, config, sourceBindings }, null, 2) + '\n', { flag: 'wx' });
let log = JSON.stringify({ config }) + '\n';
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
let raw;
try { raw = JSON.parse(await readFile(path.join(output, 'diagnostic-completion.json'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (raw) {
  assert.equal(raw.head, invocation.head);
  assert.equal(raw.acceptance, false);
  console.log(JSON.stringify({ childExit: result.code, acceptance: false,
    functionalChecksPassed: raw.functionalChecksPassed, timingPassed: raw.timingPassed,
    elapsedMs: raw.milestones.postRestoreEnd - raw.milestones.postRestoreStart }));
} else {
  console.log(JSON.stringify({ childExit: result.code, acceptance: false, completionReportPresent: false }));
  process.exitCode = 1;
}
