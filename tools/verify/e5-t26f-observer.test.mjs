// Bounded host-C self-validation and one temporary-source guard sabotage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../guest/e5-t26f-observer.c', import.meta.url));
const test = fileURLToPath(new URL('./e5-t26f-observer.test.c', import.meta.url));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const pins = { observer: hash(source), tests: hash(test) };
const directory = mkdtempSync(path.join(os.tmpdir(), 'e5t26f-observer-build-'));
const flags = ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-O1', '-g', '-fsanitize=address,undefined'];
function run(command, args) {
  console.log(`$ ${[command, ...args].map(value => JSON.stringify(value)).join(' ')}`);
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}
try {
  assert.equal(run('clang', [...flags, source, '-o', path.join(directory, 'observer')]).status, 0);
  const executable = path.join(directory, 'observer-tests');
  assert.equal(run('clang', [...flags, test, '-o', executable]).status, 0);
  assert.equal(run(executable, []).status, 0);

  const sink = path.join(directory, 'parent-fd3');
  const topology = run('/bin/sh', ['-c', `set -eu
exec 3>"$2"
record=$(exec "$1" 111 "$$")
printf 'parent-writer-retained' >&3
printf '%s\\n' "$record"
`, 'observer-transport', executable, sink]);
  assert.equal(topology.status, 0);
  assert.equal(topology.stdout, 'e5-observe-v1/111/777/4/0100000/5/0100002/|rchar:\t100|wchar: 89 |syscr: 19|syscw: 5\n');
  assert.equal(readFileSync(sink, 'utf8'), 'parent-writer-retained');
  const wrongParent = run('/bin/sh', ['-c', `set -u
exec 3>"$2"
wrong=1; [ "$$" != 1 ] || wrong=2
record=$(exec "$1" 111 "$wrong"); status=$?
[ "$status" -eq 10 ] && [ -z "$record" ] || exit 92
printf 'parent-writer-retained' >&3
`, 'observer-transport-refusal', executable, sink]);
  assert.equal(wrongParent.status, 0);
  assert.equal(wrongParent.stdout, '');
  assert.equal(readFileSync(sink, 'utf8'), 'parent-writer-retained');
  console.log('PASS: real shell parent/getppid and retained FD3; wrong parent refuses without a record (fixture proc/devices).');

  const guest = path.join(directory, 'tools/guest'), verify = path.join(directory, 'tools/verify');
  mkdirSync(guest, { recursive: true }); mkdirSync(verify, { recursive: true });
  const original = readFileSync(source, 'utf8');
  const guard = 'if (bit == 2 ? n != pid : !equal(value, "0")) return false;';
  assert.equal(original.split(guard).length, 2, 'sabotage exactly the actual pointer guard');
  writeFileSync(path.join(guest, 'e5-t26f-observer.c'), original.replace(guard, 'if (bit == 2 && n != pid) return false;'), { flag: 'wx' });
  const mutantTest = path.join(verify, 'e5-t26f-observer.test.c');
  copyFileSync(test, mutantTest);
  const mutant = path.join(directory, 'observer-mutant-tests');
  assert.equal(run('clang', [...flags, mutantTest, '-o', mutant]).status, 0);
  const rejected = run(mutant, []);
  assert.equal(rejected.status, 1, 'mutant must fail the test, not compilation or a signal');
  assert.match(rejected.stderr, /CHECK failed: !parse_pcm\(&t, 111\)/);
  assert.deepEqual({ observer: hash(source), tests: hash(test) }, pins, 'original files unchanged by sabotage');
  console.log(`PASS: sanitized C fixtures; zero-pointer mutant killed; source SHA256 ${JSON.stringify(pins)}`);
  rmSync(directory, { recursive: true, force: true });
} catch (error) {
  console.error(`Retained failed build: ${directory}`);
  throw error;
}
