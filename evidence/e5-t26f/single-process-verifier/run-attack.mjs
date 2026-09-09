// Independent bounded source-fixture attack. Retains every output, including failures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const sha = b => createHash('sha256').update(b).digest('hex');
const files = ['tools/guest/e5-t26f-observer.c', 'tools/verify/e5-t26f-observer.test.c',
  'tools/guest/e5-t26f-resident-observer.sh', 'tools/verify/e5-t26f-observer-build.mjs',
  'tools/verify/e5-t26f-observer-image.mjs', 'tools/guest/e5-t26f-resident-aplay.sh'];
const pins = () => Object.fromEntries(files.map(f => [f, sha(readFileSync(path.join(repo, f)))]));
const before = pins();
assert.equal(before[files[0]], '4ce161e7c1d82c19d2bd924c5f93d3d097c93a1ab6c53cec397e8ec1d2ee30e9');
const attempt = mkdtempSync(path.join(here, 'attack-'));
const write = (f, bytes) => writeFileSync(path.join(attempt, f), bytes, { flag: 'wx' });
const result = { acceptance: false, scope: 'controlled source-fixture semantics only', before, runs: [] };
const run = (name, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: attempt } });
  const record = { name, cmd, args, status: r.status, signal: r.signal, error: r.error?.message ?? null };
  result.runs.push(record);
  write(`${name}.stdout`, r.stdout ?? ''); write(`${name}.stderr`, r.stderr ?? '');
  write(`${name}.json`, JSON.stringify(record, null, 2) + '\n');
  assert.equal(r.error, undefined); assert.equal(r.signal, null);
  return r;
};
try {
  const source = readFileSync(path.join(repo, files[0]), 'utf8');
  const tests = readFileSync(path.join(repo, files[1]), 'utf8');
  const main = readFileSync(path.join(here, 'attack-main.c'), 'utf8');
  const testMain = 'int main(int argc, char **argv) {';
  assert.equal(tests.split(testMain).length, 2);
  const testBody = tests.slice(0, tests.indexOf(testMain)) + main;
  const pcmStart = source.indexOf('static bool parse_pcm('), pcmEnd = source.indexOf('static bool parse_io(');
  assert.ok(pcmStart > 0 && pcmEnd > pcmStart);
  const guard = 'if (!remember_key(key, keys, &key_count)) return false;';
  const section = source.slice(pcmStart, pcmEnd);
  assert.equal(section.split(guard).length, 2);
  const mutant = source.slice(0, pcmStart) + section.replace(guard, '') + source.slice(pcmEnd);
  result.mutation = { guard, scope: 'parse_pcm only', originalSha256: sha(source), mutantSha256: sha(mutant) };
  for (const [variant, bytes] of [['original', source], ['mutant', mutant]]) {
    mkdirSync(path.join(attempt, variant, 'tools/guest'), { recursive: true });
    mkdirSync(path.join(attempt, variant, 'tools/verify'), { recursive: true });
    write(`${variant}/tools/guest/e5-t26f-observer.c`, bytes);
    write(`${variant}/tools/verify/attack.c`, testBody);
    const binary = path.join(attempt, variant, 'attack');
    const compiled = run(`${variant}-compile`, '/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror',
      '-Wno-unused-function', '-Wno-unused-variable', '-O1', '-g', '-fsanitize=address,undefined',
      path.join(attempt, variant, 'tools/verify/attack.c'), '-o', binary]);
    assert.equal(compiled.status, 0, compiled.stderr);
    const valid = run(`${variant}-valid`, binary, [path.join(attempt, `${variant}-valid-tree`), 'valid']);
    assert.equal(valid.status, 0, valid.stderr);
    const duplicate = run(`${variant}-duplicate`, binary, [path.join(attempt, `${variant}-duplicate-tree`), 'duplicate']);
    assert.equal(duplicate.status, variant === 'original' ? 0 : 1, duplicate.stderr);
    if (variant === 'mutant') assert.match(duplicate.stderr, /CHECK failed: result == 30/);
    const oracle = run(`${variant}-worker-parser`, binary, ['worker-parser']);
    assert.equal(oracle.status, variant === 'original' ? 0 : 1, oracle.stderr);
    if (variant === 'mutant') assert.match(oracle.stderr, /CHECK failed: !parse_pcm\(&t, 111\)/);
  }
  result.held = true;
} catch (error) {
  result.failure = String(error); process.exitCode = 1;
} finally {
  result.after = pins();
  try { assert.deepEqual(result.after, before); } catch (error) { result.immutabilityFailure = String(error); process.exitCode = 1; }
  write('result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ attempt, held: result.held ?? false, failure: result.failure ?? null, immutable: !result.immutabilityFailure }));
}
