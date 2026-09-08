// Offline parser checks against retained bytes; mutated copies are NOT native evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const files = ['run.sh', 'versions.txt', ...['builtin', 'whole'].flatMap(mode => [`${mode}.pid`, `${mode}.strace`, ...['stat', 'fdinfo', 'io'].map(kind => `${mode}-${kind}.data`)])];
const digest = file => createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex');
const before = files.map(digest);
const checks = [
  { name: 'valid' },
  { name: 'output-byte-mismatch', file: 'builtin-stat.data', edit: bytes => { const changed = Buffer.from(bytes); changed[0] ^= 1; return changed; }, error: /actual proc read bytes differ/ },
  { name: 'returned-byte-mismatch', file: 'builtin.strace', edit: bytes => bytes.toString().replace(/(read\(0<\/proc\/\d+\/stat>[^\n]+?= )1\n/, '$12\n'), error: /truncated\/mismatched read payload/ },
  { name: 'missing-read', file: 'builtin.strace', edit: bytes => bytes.toString().replace(/^\d+\s+read\(0<\/proc\/\d+\/stat>[^\n]+\n/m, ''), error: /actual proc read bytes differ/ },
];
const results = [];
for (const check of checks) {
  const target = path.join(directory, `parser-check-${check.name}`);
  mkdirSync(target);
  for (const file of files) copyFileSync(path.join(directory, file), path.join(target, file));
  if (check.edit) {
    const file = path.join(target, check.file), original = readFileSync(file);
    const edited = Buffer.from(check.edit(original));
    assert.notDeepEqual(edited, original, 'attack must actually modify its copy');
    writeFileSync(file, edited);
  }
  const run = spawnSync(process.execPath, ['tools/verify/e5-t26f-ash-read-probe.mjs', target], { cwd: root, encoding: 'utf8', timeout: 5000 });
  writeFileSync(path.join(target, 'parser.log'), `$ node tools/verify/e5-t26f-ash-read-probe.mjs ${target}\n${run.stdout}${run.stderr}\nexit=${run.status}\n`);
  if (check.error) {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, check.error);
    assert.equal(existsSync(path.join(target, 'summary.json')), false, 'refusal must not emit summary');
  } else assert.equal(run.status, 0, run.stderr);
  results.push({ name: check.name, passed: true, parserExit: run.status });
}
assert.deepEqual(files.map(digest), before, 'canonical raw evidence changed');
writeFileSync(path.join(directory, 'parser-checks.json'), JSON.stringify({ acceptance: false, scope: 'Offline parser validation only; attacks are synthetic copies, not new native runs.', rawPreserved: true, results }, null, 2) + '\n', { flag: 'wx' });
console.log('4 parser checks passed; canonical raw files unchanged.');
