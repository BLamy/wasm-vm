/** Pure public consumer checks. Hardware lifecycle evidence is recorded separately. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from 'node:inspector';
import { parseConstantDomain, checkIndirectBank } from '../../renderer/virgl-command/constant-domain.mjs';
import { decodeSubmission } from '../../renderer/virgl-command/decoder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = ['renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs',
  'tools/virgl-indirect-constants/consumer-unit.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = value => value === null || typeof value !== 'object' ||
  (Object.isFrozen(value) && Object.values(value).every(frozen));
const clone = value => structuredClone(value);
const profile = version => `virgl-webgl2-raw-bits-v${version}`;
function metadata(stage = 'vertex', version = 11, count = 46, indices = [0, 23, 45]) {
  const name = stage === 'vertex' ? 'vsconst0' : 'fsconst0';
  const value = { profile: typeof version === 'number' ? profile(version) : version, stage,
    inputs: [], outputs: [], attributes: [],
    uniforms: [{ name, type: 'uvec4[]', count, encoding: 'float32-bits' }], samplers: [], uniformBlocks: [] };
  if ([7, 9, 11].includes(version)) value.constantDomains = [
    { kind: 'constant-bank-finite-f32-v1', stage, slot: 0, name, count }];
  if ([10, 11].includes(version)) value.constantAccesses = [
    { kind: 'constant-bank-static-indirect-v1', stage, slot: 0, name, count, indices }];
  return value;
}
const encode = value => {
  if (typeof value === 'number') return { type: 'number', value: Number.isFinite(value) ? value : String(value) };
  if (typeof value === 'bigint' || typeof value === 'symbol') return { type: typeof value, value: String(value) };
  if (value === undefined) return { type: 'undefined' };
  return { type: typeof value, value };
};

export function runConsumerAcceptance() {
  const schemas = [], banks = [], ownership = [];
  let getterCalls = 0;
  const accessor = (value, key) => Object.defineProperty(value, key, { enumerable: true, configurable: true,
    get() { getterCalls++; throw new Error('Rejected accessors must never run.'); } });
  const schemaCase = (name, stage, input, ok, recipe = null) => {
    const result = parseConstantDomain(input, stage);
    assert.equal(result.ok, ok, name); assert.ok(frozen(result), `${name}: recursively frozen`);
    if (ok) assert.deepEqual(result, { ok: true, domain: clone(input.constantDomains?.[0] ?? null),
      ...(input.constantAccesses ? { access: clone(input.constantAccesses[0]) } : {}) });
    else assert.equal(result.error.code, 'shader-domain-error', name);
    schemas.push({ name, stage, ...(recipe ? { recipe } : { input: clone(input) }), result, frozen: true });
    return result;
  };
  for (const stage of ['vertex', 'fragment']) {
    for (const version of [10, 11]) {
      for (const count of [1, 8, 46, 47]) schemaCase(`${stage}-v${version}-extent${count}`, stage,
        metadata(stage, version, count, Array.from({ length: Math.min(count, 46) }, (_, i) => i)), true);
      for (const index of [0, 23, 45]) schemaCase(`${stage}-v${version}-singleton${index}`, stage,
        metadata(stage, version, 46, [index]), true);
    }
    for (const version of ['virgl-webgl2-straight-line-v5', 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const value = metadata(stage, version);
      schemaCase(`${stage}-old-${version}`, stage, value, true);
      value.constantAccesses = metadata(stage).constantAccesses;
      schemaCase(`${stage}-old-${version}-forbids-access`, stage, value, false);
    }
    const mutations = [
      ['unknown-profile', v => { v.profile = profile(12); }],
      ['missing-access', v => { delete v.constantAccesses; }],
      ['empty-access', v => { v.constantAccesses = []; }],
      ['duplicate-access', v => { v.constantAccesses.push(clone(v.constantAccesses[0])); }],
      ['access-not-array', v => { v.constantAccesses = {}; }],
      ['access-record-array', v => { v.constantAccesses[0] = []; }],
      ['access-kind', v => { v.constantAccesses[0].kind = 'observed-index-v1'; }],
      ['access-stage', v => { v.constantAccesses[0].stage = stage === 'vertex' ? 'fragment' : 'vertex'; }],
      ['access-slot', v => { v.constantAccesses[0].slot = 1; }],
      ['access-name', v => { v.constantAccesses[0].name += '[0]'; }],
      ...[0, 48, 1.5, '46', null].map(count => [`access-count-${String(count)}`, v => { v.constantAccesses[0].count = count; }]),
      ['extent-mismatch', v => { v.uniforms[0].count = 45; }],
      ['no-uniform', v => { v.uniforms = []; }],
      ['duplicate-uniform', v => { v.uniforms.push(clone(v.uniforms[0])); }],
      ['uniform-name', v => { v.uniforms[0].name = 'otherconst0'; }],
      ['uniform-type', v => { v.uniforms[0].type = 'vec4[]'; }],
      ['uniform-encoding', v => { v.uniforms[0].encoding = 'numeric'; }],
      ['uniform-extra', v => { v.uniforms[0].extra = 1; }],
      ['empty-indices', v => { v.constantAccesses[0].indices = []; }],
      ['indices-not-array', v => { v.constantAccesses[0].indices = {}; }],
      ['indices-too-many', v => { v.constantAccesses[0].indices = Array.from({ length: 47 }, (_, i) => i); }],
      ...[[-1], [46], [0xffffffff], [0x80000000], [1.5], ['1'], [null], [0, 0], [23, 0]].map((indices, i) =>
        [`indices-invalid-${i}`, v => { v.constantAccesses[0].indices = indices; }]),
      ['index-outside-extent', v => { v.constantAccesses[0].count = v.uniforms[0].count = 23; }],
      ['extent47-index46', v => { v.constantAccesses[0].count = v.uniforms[0].count = 47; v.constantAccesses[0].indices = [46]; }],
      ['extra-access-key', v => { v.constantAccesses[0].extra = 1; }],
      ...['kind', 'stage', 'slot', 'name', 'count', 'indices'].map(key => [`missing-access-${key}`, v => { delete v.constantAccesses[0][key]; }]),
      ['v11-missing-domain', v => { delete v.constantDomains; }],
      ['v11-domain-count-mismatch', v => { v.constantDomains[0].count = 45; }],
      ['v11-domain-stage-mismatch', v => { v.constantDomains[0].stage = stage === 'vertex' ? 'fragment' : 'vertex'; }],
      ['v10-forbids-domain', v => { v.profile = profile(10); }],
    ];
    for (const [name, mutate] of mutations) { const value = metadata(stage); mutate(value); schemaCase(`${stage}-${name}`, stage, value, false); }
    for (const version of [10, 11]) for (const location of ['metadata', 'accesses', 'access', 'indices', 'uniform']) {
      const value = metadata(stage, version);
      const targets = { metadata: [value, 'constantAccesses'], accesses: [value.constantAccesses, '0'],
        access: [value.constantAccesses[0], 'indices'], indices: [value.constantAccesses[0].indices, '1'], uniform: [value.uniforms[0], 'count'] };
      accessor(...targets[location]);
      schemaCase(`${stage}-v${version}-${location}-accessor`, stage, value, false, `${location}-accessor`);
    }
    for (const location of ['accesses', 'indices']) for (const mutation of ['sparse', 'extra', 'symbol', 'inherited']) {
      const value = metadata(stage), target = location === 'accesses' ? value.constantAccesses : value.constantAccesses[0].indices;
      if (mutation === 'sparse') delete target[0];
      if (mutation === 'extra') target.extra = 1;
      if (mutation === 'symbol') target[Symbol('extra')] = 1;
      if (mutation === 'inherited') { const first = target[0]; delete target[0]; Object.setPrototypeOf(target, { 0: first }); }
      schemaCase(`${stage}-${location}-${mutation}`, stage, value, false, `${location}-${mutation}`);
    }
    for (const mutation of ['revoked', 'throwing-descriptors', 'symbol', 'inherited']) {
      const value = metadata(stage);
      if (mutation === 'revoked') { const proxy = Proxy.revocable({}, {}); proxy.revoke(); value.constantAccesses[0] = proxy.proxy; }
      if (mutation === 'throwing-descriptors') value.constantAccesses[0] = new Proxy({}, { ownKeys() { throw new Error('denied'); } });
      if (mutation === 'symbol') value.constantAccesses[0][Symbol('extra')] = 1;
      if (mutation === 'inherited') { const indices = value.constantAccesses[0].indices; delete value.constantAccesses[0].indices; Object.setPrototypeOf(value.constantAccesses[0], { indices }); }
      schemaCase(`${stage}-access-${mutation}`, stage, value, false, `access-${mutation}`);
    }
  }
  const full = Array.from({ length: 184 }, (_, i) => [0, 0x80000000, 1, 0x80000001,
    0x007fffff, 0x807fffff, 0x00800000, 0x80800000, 0x3f800000, 0xbf800000, 0x7f7fffff, 0xff7fffff][i % 12]);
  const bankCase = (name, words, count, finite, code = null, recipe = null) => {
    const result = checkIndirectBank(words, count, finite);
    assert.equal(result.ok, code === null, name); assert.ok(frozen(result), name);
    if (code) assert.equal(result.error.code, code, name);
    else assert.deepEqual(result.words, words.slice(0, Math.min(count, 46) * 4), name);
    banks.push({ name, ...(recipe ? { recipe } : { words: words.map(encode) }), count: encode(count), finite: encode(finite), result, frozen: true });
    return result;
  };
  for (const finite of [false, true]) {
    const policy = finite ? 'finite' : 'raw', code = finite ? 'constant-domain-error' : 'constant-access-error';
    for (const count of [1, 8, 45, 46, 47]) {
      bankCase(`${policy}-extent${count}`, full, count, finite);
      bankCase(`${policy}-short-extent${count}`, full.slice(0, (Math.min(count, 46) - 1) * 4), count, finite, 'incomplete-draw');
    }
    for (const count of [0, 48, -1, 1.5, '46', null, NaN, Infinity]) bankCase(`${policy}-invalid-count-${String(count)}`, full, count, finite, code);
    for (const word of [0x7f800000, 0xff800000, 0x7f800001, 0xff800001, 0x7fc00000, 0xffc00000, 0x7fffffff, 0xffffffff])
      bankCase(`${policy}-word-${word.toString(16)}`, [word, 0, 0, 0], 1, finite, finite ? code : null);
    for (const word of [-1, 0x100000000, .5, NaN, Infinity, -Infinity, '0', null, undefined, true, 0n, Symbol('word'), {}])
      bankCase(`${policy}-invalid-word-${typeof word}-${String(word)}`, [word, 0, 0, 0], 1, finite, code);
    bankCase(`${policy}-bank188`, [...full, 0, 0, 0, 0], 47, finite, code);
    bankCase(`${policy}-bank183`, full.slice(0, 183), 45, finite, code);
    bankCase(`${policy}-short-nonfinite`, [0x7f800000, 0, 0, 0], 46, finite, 'incomplete-draw');
    const suffix = [...full]; suffix[183] = 0xffffffff;
    bankCase(`${policy}-outside-declared-prefix`, suffix, 45, finite);
    for (const mutation of ['typed-array', 'null', 'sparse', 'accessor', 'extra', 'symbol', 'revoked', 'throwing-descriptors']) {
      let value = [0, 0, 0, 0];
      if (mutation === 'typed-array') value = new Uint32Array(4);
      if (mutation === 'null') value = null;
      if (mutation === 'sparse') delete value[0];
      if (mutation === 'accessor') accessor(value, '0');
      if (mutation === 'extra') value.extra = 1;
      if (mutation === 'symbol') value[Symbol('extra')] = 1;
      if (mutation === 'revoked') { const proxy = Proxy.revocable([], {}); proxy.revoke(); value = proxy.proxy; }
      if (mutation === 'throwing-descriptors') value = new Proxy([], { ownKeys() { throw new Error('denied'); } });
      bankCase(`${policy}-bank-${mutation}`, value, 1, finite, code, mutation);
    }
  }
  for (const finite of [undefined, 0, 'true', null]) bankCase(`invalid-policy-${String(finite)}`, full, 46, finite, 'constant-access-error');
  // Every declared lane participates, including unselected candidates and suffix lanes.
  for (let lane = 0; lane < 184; lane++) { const value = [...full]; value[lane] = 0x7fc00000;
    bankCase(`finite-poison-lane${lane}`, value, 47, true, 'constant-domain-error'); }
  const source = metadata(), parsed = parseConstantDomain(source, 'vertex');
  source.constantAccesses[0].indices.fill(44); source.constantAccesses[0].count = 1; source.constantDomains[0].count = 1;
  assert.deepEqual(parsed.access.indices, [0, 23, 45]); assert.equal(parsed.access.count, 46); assert.equal(parsed.domain.count, 46);
  assert.throws(() => { parsed.access.indices[0] = 44; }, TypeError);
  ownership.push({ name: 'metadata-copy', retained: parsed, originalIndicesAfter: source.constantAccesses[0].indices, frozenMutationRejected: true });
  for (const stage of [0, 1]) {
    const packet = new Uint8Array(12 + full.length * 4), view = new DataView(packet.buffer);
    [0x00ba000c, stage, 0, ...full].forEach((word, i) => view.setUint32(i * 4, word, true));
    const requestHex = Buffer.from(packet).toString('hex'), decoded = decodeSubmission(packet);
    assert.equal(decoded.ok, true); assert.ok(frozen(decoded));
    const words = decoded.commands[0].fields.words, first = checkIndirectBank(words, 47, true);
    packet.fill(255); assert.deepEqual(words, full); assert.deepEqual(first.words, full);
    assert.notEqual(first.words, words); assert.throws(() => { first.words[0] = 1; }, TypeError);
    const short = checkIndirectBank(Object.freeze(full.slice(0, 180)), 47, true);
    const changed = [...full]; changed[92] = 2;
    const second = checkIndirectBank(Object.freeze(changed), 47, true);
    assert.equal(short.error.code, 'incomplete-draw'); assert.equal(second.words[92], 2); assert.equal(first.words[92], full[92]);
    ownership.push({ name: `decoder-stage${stage}-replacement`, requestHex, packetAfterHex: Buffer.from(packet).toString('hex'),
      original: words, first, short, second, distinctReferences: first.words !== words && first.words !== second.words,
      frozenMutationRejected: true });
  }
  assert.equal(getterCalls, 0);
  return { schema: 'wasm-vm-indirect-consumer-unit-v1', task: 'E6-T12e8', status: 'passed', schemas, banks, ownership, getterCalls,
    stats: { schemas: schemas.length, banks: banks.length, ownership: ownership.length } };
}

async function main() {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--output');
  const output = path.resolve(process.argv[3]); await fs.mkdir(output, { recursive: true });
  const session = new Session(); session.connect();
  const post = (method, args = {}) => new Promise((resolve, reject) => session.post(method, args, (error, value) => error ? reject(error) : resolve(value)));
  await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const report = runConsumerAcceptance();
  const coverage = (await post('Profiler.takePreciseCoverage')).result.filter(entry => FILES.slice(0, 2).some(name => entry.url === new URL(name, `file://${ROOT}/`).href));
  await post('Profiler.stopPreciseCoverage'); session.disconnect(); assert.equal(coverage.length, 2);
  const coverageBytes = Buffer.from(JSON.stringify(coverage, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'coverage.json'), coverageBytes);
  report.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  report.sources = await Promise.all(FILES.map(async source => { const bytes = await fs.readFile(path.join(ROOT, source)); return { path: source, bytes: bytes.length, sha256: sha(bytes) }; }));
  report.coverage = { path: 'coverage.json', bytes: coverageBytes.length, sha256: sha(coverageBytes) };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, ...report.stats, output }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
