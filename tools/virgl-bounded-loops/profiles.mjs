/** Replay E7's literal public profile cases; inventory only four v10 diagnostics. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from 'node:inspector';
import { parseConstantDomain } from '../../renderer/virgl-command/constant-domain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HELD_HEAD = '62e90790d5c6f0a5da5fa528c482679c16c74290';
const BASELINE = 'evidence/virgl-structured-conditionals/cold-clone/acceptance/profiles/report.json';
const PRIOR = 'evidence/virgl-indirect-constants/cold-clone/acceptance/profiles/report.json';
const HELD_FILES = ['tools/virgl-indirect-constants/profiles.mjs',
  'tools/virgl-indirect-constants/profile_receipt.py', PRIOR, 'tools/virgl-structured-conditionals/profiles.mjs',
  'tools/virgl-structured-conditionals/profiles_receipt.py', BASELINE];
const FILES = ['renderer/virgl-command/constant-domain.mjs', 'tools/virgl-bounded-loops/profiles.mjs', ...HELD_FILES];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = value => value === null || typeof value !== 'object' ||
  (Object.isFrozen(value) && Object.values(value).every(frozen));
const MIGRATIONS = ['vertex-v10-with-domain', 'vertex-v10-without-domain',
  'fragment-v10-with-domain', 'fragment-v10-without-domain'];
const BEFORE = 'Unknown shader profile.';
const AFTER = 'Indirect shader profile requires a constant access contract.';

export function runProfiles(held) {
  assert.equal(held.schema, 'wasm-vm-structured-profiles-v1');
  assert.equal(held.task, 'E6-T12e7'); assert.equal(held.status, 'passed'); assert.equal(held.cases.length, 50);
  const cases = [], diagnosticDeltas = [];
  for (const original of held.cases) {
    const { name, stage } = original;
    assert.ok(['vertex', 'fragment'].includes(stage));
    const expected = structuredClone(original.expected);
    let input, getterCalls = 0;
    if (original.recipe) {
      assert.equal(original.recipe, 'v9-domain-accessor'); assert.equal(name, `${stage}-v9-accessor`);
      input = structuredClone(held.cases.find(entry => entry.name === `${stage}-v9-extent46`).input);
      Object.defineProperty(input, 'constantDomains', { enumerable: true,
        get() { getterCalls++; throw new Error('Metadata accessors must never execute.'); } });
    } else input = structuredClone(original.input);
    if (MIGRATIONS.includes(name)) {
      assert.equal(input.profile, 'virgl-webgl2-raw-bits-v10');
      assert.equal(Object.hasOwn(input, 'constantAccesses'), false);
      assert.deepEqual(expected, { ok: false, error: { code: 'shader-domain-error', message: BEFORE } });
      expected.error.message = AFTER;
      diagnosticDeltas.push({ name, before: BEFORE, after: AFTER, outcome: 'shader-domain-error' });
    }
    const result = parseConstantDomain(input, stage);
    assert.deepEqual(result, expected, name); assert.ok(frozen(result), name); assert.equal(getterCalls, 0);
    if (!original.recipe) assert.deepEqual(input, original.input, 'unchanged complete held input');
    cases.push({ name, stage, ...(original.recipe ? { recipe: original.recipe, getterCalls } : { input }),
      expected, result, frozen: true });
  }
  assert.deepEqual(diagnosticDeltas.map(entry => entry.name), MIGRATIONS);
  return { cases, diagnosticDeltas };
}

async function main() {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--output');
  const output = path.resolve(process.argv[3]); await fs.mkdir(output, { recursive: true });
  for (const name of HELD_FILES) assert.deepEqual(await fs.readFile(path.join(ROOT, name)),
    execFileSync('git', ['show', `${HELD_HEAD}:${name}`], { cwd: ROOT }), `unchanged verified E7 input/oracle: ${name}`);
  const held = JSON.parse(await fs.readFile(path.join(ROOT, BASELINE), 'utf8'));
  const session = new Session(); session.connect();
  const post = (method, args = {}) => new Promise((resolve, reject) => session.post(method, args, (error, value) => error ? reject(error) : resolve(value)));
  await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const result = runProfiles(held);
  const prior = JSON.parse(await fs.readFile(path.join(ROOT, PRIOR), 'utf8'));
  assert.equal(prior.task, 'E6-T12e8'); assert.equal(prior.status, 'passed');
  assert.deepEqual(result.cases, prior.cases); assert.deepEqual(result.diagnosticDeltas, prior.diagnosticDeltas);
  const coverage = (await post('Profiler.takePreciseCoverage')).result.filter(entry => entry.url.endsWith('/renderer/virgl-command/constant-domain.mjs'));
  await post('Profiler.stopPreciseCoverage'); session.disconnect(); assert.equal(coverage.length, 1);
  const coverageBytes = Buffer.from(JSON.stringify(coverage, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'coverage.json'), coverageBytes);
  const sources = await Promise.all(FILES.map(async name => { const bytes = await fs.readFile(path.join(ROOT, name));
    return { path: name, bytes: bytes.length, sha256: sha(bytes) }; }));
  const report = { schema: 'wasm-vm-e9-retained-profiles-v1', task: 'E6-T12e9', status: 'passed', heldHead: HELD_HEAD,
    predecessorFullGateClaimed: false, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    command: process.argv, node: process.version, sources, ...result,
    coverage: { path: 'coverage.json', bytes: coverageBytes.length, sha256: sha(coverageBytes) } };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('E9 retained profiles passed: 50 complete public cases; four explicitly inventoried v10 rejection diagnostics.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
