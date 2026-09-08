// Directly execute the frozen compilerEnv function with poisoned inputs; no compiler/build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const source = readFileSync(path.join(repo, 'tools/verify/e5-t26f-observer-build.mjs'), 'utf8');
const sha = createHash('sha256').update(source).digest('hex');
assert.equal(sha, 'e89170a56623174bcf7def80dc230fa79794408bc18df7debcf55a5bb9efd36e');
const keys = ['CFLAGS', 'CPPFLAGS', 'CXXFLAGS', 'CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'OBJC_INCLUDE_PATH',
  'LIBRARY_PATH', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG', 'CARGO_HOME',
  'CARGO_TARGET_DIR', 'RUSTUP_HOME', 'CC', 'CXX', 'ZIG_LIB_DIR', 'ZIG_GLOBAL_CACHE_DIR', 'ZIG_LOCAL_CACHE_DIR',
  'SOURCE_DATE_EPOCH', 'TMPDIR', 'E5_T26F_FIXTURE'];
// Prediction: only PATH survives; epoch/cache/temp are replaced by owned values.
const inherited = { PATH: '/controlled/path', ...Object.fromEntries(keys.map(k => [k, `/POISON/${k}`])) };
const start = source.indexOf('function compilerEnv('), end = source.indexOf('\nasync function resolveCompiler(');
assert.ok(start > 0 && end > start);
const body = source.slice(start, end);
const env = vm.runInNewContext(`${body}\ncompilerEnv('/owned/output', '/pinned/zig', inherited)`,
  { assert, path, EPOCH: 1731542400, POISON_ENV: keys.filter(k => !['SOURCE_DATE_EPOCH', 'TMPDIR', 'ZIG_GLOBAL_CACHE_DIR', 'ZIG_LOCAL_CACHE_DIR'].includes(k)), inherited });
assert.equal(JSON.stringify(env), JSON.stringify({ PATH: '/controlled/path', TMPDIR: '/owned/output/.tmp',
  SOURCE_DATE_EPOCH: '1731542400', ZIG_GLOBAL_CACHE_DIR: '/owned/output/.zig-global-cache', ZIG_LOCAL_CACHE_DIR: '/owned/output/.zig-local-cache' }));
writeFileSync(path.join(here, 'env-result.json'), JSON.stringify({ acceptance: false, sourceSha256: sha,
  sourceLines: '125-137', prediction: 'Only PATH inherited; owned epoch, cache and temporary values; no poison forwarded.',
  input: inherited, output: env, held: true, limit: 'Executes the exact environment constructor, not Zig or a cross-build.' }, null, 2) + '\n', { flag: 'wx' });
console.log('HELD: exact compilerEnv constructor discarded all injected poison; no build ran.');
