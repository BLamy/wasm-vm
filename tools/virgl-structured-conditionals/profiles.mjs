/** Public consumer checks for the two closed structured compiler profiles. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from 'node:inspector';
import { parseConstantDomain } from '../../renderer/virgl-command/constant-domain.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = ['renderer/virgl-command/constant-domain.mjs', 'tools/virgl-structured-conditionals/profiles.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = value => value === null || typeof value !== 'object' ||
  (Object.isFrozen(value) && Object.values(value).every(frozen));
const profile = version => `virgl-webgl2-raw-bits-v${version}`;
function metadata(stage, version, count = 46) {
  const name = stage === 'vertex' ? 'vsconst0' : 'fsconst0';
  return { profile: profile(version), stage, inputs: [], outputs: [], attributes: [],
    uniforms: [{ name, type: 'uvec4[]', count, encoding: 'float32-bits' }], samplers: [], uniformBlocks: [],
    ...([7, 9].includes(version) ? { constantDomains: [{ kind: 'constant-bank-finite-f32-v1', stage, slot: 0, name, count }] } : {}) };
}
const failure = message => ({ ok: false, error: { code: 'shader-domain-error', message } });

export function runProfiles() {
  const cases = [];
  function check(name, stage, input, expected, recipe = null) {
    const before = recipe ? null : structuredClone(input);
    const result = parseConstantDomain(input, stage);
    assert.deepEqual(result, expected, name);
    assert.ok(frozen(result), `${name}: frozen result`);
    if (!recipe) assert.deepEqual(input, before, `${name}: unchanged input`);
    cases.push({ name, stage, ...(recipe ? { recipe } : { input: before }), expected, result, frozen: true });
  }
  for (const stage of ['vertex', 'fragment']) {
    check(`${stage}-v8-unconditional`, stage, metadata(stage, 8), { ok: true, domain: null });
    for (const version of [7, 9]) for (const count of [1, 8, 46, 47]) {
      const input = metadata(stage, version, count);
      check(`${stage}-v${version}-extent${count}`, stage, input,
        { ok: true, domain: structuredClone(input.constantDomains[0]) });
    }
    const negatives = [
      ['v9-missing-domain', v => { delete v.constantDomains; }, 'Conditional shader profile requires a constant domain.'],
      ['v9-empty-domain', v => { v.constantDomains = []; }, 'Conditional shader requires one domain and one constant bank.'],
      ['v9-duplicate-domain', v => { v.constantDomains.push(structuredClone(v.constantDomains[0])); }, 'Array extent exceeds the bounded contract.'],
      ['v9-wrong-kind', v => { v.constantDomains[0].kind = 'finite-normal-only-v1'; }, 'Unknown or inconsistent constant-bank domain.'],
      ['v9-wrong-stage', v => { v.constantDomains[0].stage = stage === 'vertex' ? 'fragment' : 'vertex'; }, 'Unknown or inconsistent constant-bank domain.'],
      ['v9-wrong-slot', v => { v.constantDomains[0].slot = 1; }, 'Unknown or inconsistent constant-bank domain.'],
      ['v9-wrong-name', v => { v.constantDomains[0].name = 'otherconst0'; }, 'Unknown or inconsistent constant-bank domain.'],
      ['v9-extent-mismatch', v => { v.constantDomains[0].count = 45; }, 'Constant domain does not match the declared bank extent and encoding.'],
      ['v9-extent48', v => { v.constantDomains[0].count = v.uniforms[0].count = 48; }, 'Constant domain does not match the declared bank extent and encoding.'],
      ['v9-numeric-uniform', v => { v.uniforms[0].encoding = 'numeric'; }, 'Constant domain does not match the declared bank extent and encoding.'],
      ['v9-extra-field', v => { v.constantDomains[0].optional = true; }, 'Unknown or accessor property.'],
      ['v8-with-domain', v => { v.profile = profile(8); }, 'Unconditional shader profile carries a conditional contract.'],
      ['v10-with-domain', v => { v.profile = profile(10); }, 'Unknown shader profile.'],
      ['v10-without-domain', v => { v.profile = profile(10); delete v.constantDomains; }, 'Unknown shader profile.'],
      ['v7-missing-domain', v => { v.profile = profile(7); delete v.constantDomains; }, 'Conditional shader profile requires a constant domain.'],
    ];
    for (const [name, mutate, message] of negatives) {
      const input = metadata(stage, 9); mutate(input);
      check(`${stage}-${name}`, stage, input, failure(message));
    }
    let getterCalls = 0;
    const input = metadata(stage, 9);
    Object.defineProperty(input, 'constantDomains', { enumerable: true,
      get() { getterCalls++; throw new Error('must not execute metadata accessors'); } });
    check(`${stage}-v9-accessor`, stage, input, failure('Unknown or accessor property.'), 'v9-domain-accessor');
    assert.equal(getterCalls, 0);
    cases.at(-1).getterCalls = getterCalls;
  }
  return cases;
}

async function main() {
  const index = process.argv.indexOf('--output');
  assert.ok(index >= 0 && process.argv[index + 1], '--output DIRECTORY is required');
  const output = path.resolve(process.argv[index + 1]);
  await fs.mkdir(output, { recursive: true });
  const session = new Session(); session.connect();
  const post = (method, parameters = {}) => new Promise((resolve, reject) =>
    session.post(method, parameters, (error, result) => error ? reject(error) : resolve(result)));
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const cases = runProfiles();
  const coverage = (await post('Profiler.takePreciseCoverage')).result.filter(entry =>
    entry.url.endsWith('/renderer/virgl-command/constant-domain.mjs'));
  await post('Profiler.stopPreciseCoverage'); session.disconnect();
  assert.equal(coverage.length, 1, 'actual public consumer coverage');
  const coverageBytes = Buffer.from(JSON.stringify(coverage, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'coverage.json'), coverageBytes);
  const sources = await Promise.all(FILES.map(async name => {
    const bytes = await fs.readFile(path.join(ROOT, name));
    return { path: name, bytes: bytes.length, sha256: sha(bytes) };
  }));
  const report = { schema: 'wasm-vm-structured-profiles-v1', task: 'E6-T12e7', status: 'passed',
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    command: process.argv, node: process.version, sources, cases,
    coverage: { path: 'coverage.json', bytes: coverageBytes.length, sha256: sha(coverageBytes) } };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`Structured profiles passed: ${cases.length} public schema checks; v7/v9 contracts mandatory.\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
