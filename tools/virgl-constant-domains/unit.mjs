/** Recorded pure contract checks; no GPU, guest compiler admission or host mocks. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from 'node:inspector';
import { CONDITIONAL_PROFILE, CONSTANT_DOMAIN_KIND, parseConstantDomain,
  finiteBinary32Word, checkFiniteBank } from '../../renderer/virgl-command/constant-domain.mjs';
import { decodeSubmission } from '../../renderer/virgl-command/decoder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const freeze = (value) => value === null || typeof value !== 'object' ||
  (Object.isFrozen(value) && Object.values(value).every(freeze));
const clone = (value) => structuredClone(value);
function metadata(stage = 'vertex', count = 46, profile = CONDITIONAL_PROFILE) {
  const name = stage === 'vertex' ? 'vsconst0' : 'fsconst0';
  return { profile, stage, inputs: [], outputs: [], attributes: [],
    uniforms: [{ name, type: 'uvec4[]', count, encoding: 'float32-bits' }], samplers: [], uniformBlocks: [],
    ...(profile === CONDITIONAL_PROFILE ? { constantDomains: [{ kind: CONSTANT_DOMAIN_KIND, stage, slot: 0, name, count }] } : {}) };
}
const ownAccessor = (value, key) => Object.defineProperty(value, key, { enumerable: true, configurable: true,
  get() { throw new Error('a rejected accessor must never execute'); } });
function revoked() { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }
const encoded = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? { type: 'number', value } : { type: 'number', value: String(value) };
  return { type: typeof value, value: typeof value === 'bigint' ? String(value) : typeof value === 'symbol' ? 'word' : value };
};

export function runUnitAcceptance() {
  const predicates = [], schemas = [], banks = [], ownership = [];
  // Every exponent, both signs and three significand boundaries; expected results
  // derive from the independently enumerated exponent, not the tested predicate.
  for (const sign of [0, 1]) for (let exponent = 0; exponent < 256; exponent++) for (const mantissa of [0, 1, 0x7fffff]) {
    const word = sign * 0x80000000 + exponent * 0x800000 + mantissa, expected = exponent !== 255;
    const result = finiteBinary32Word(word); assert.equal(result, expected);
    predicates.push({ input: encoded(word), sign, exponent, mantissa, expected, result });
  }
  for (const value of [-1, 0x100000000, .5, NaN, Infinity, -Infinity, '0', null, undefined, true, 0n, Symbol('word'), {}]) {
    const result = finiteBinary32Word(value); assert.equal(result, false);
    predicates.push({ input: encoded(value), expected: false, result });
  }
  const schemaCase = (name, stage, input, expected, recipe = null) => {
    const result = parseConstantDomain(input, stage);
    assert.equal(result.ok, expected.ok, name); assert.ok(freeze(result), `${name}: frozen result`);
    if (expected.ok) assert.deepEqual(result.domain, expected.domain, name);
    else assert.equal(result.error.code, 'shader-domain-error', name);
    schemas.push({ name, stage, ...(recipe ? { recipe } : { input }), expected, result }); return result;
  };
  for (const stage of ['vertex', 'fragment']) {
    for (const count of [1, 8, 46, 47]) {
      const input = metadata(stage, count), before = clone(input);
      schemaCase(`${stage}-extent${count}`, stage, input, { ok: true, domain: clone(input.constantDomains[0]) });
      assert.deepEqual(input, before, 'schema parsing leaves original metadata unchanged');
    }
    for (const profile of ['virgl-webgl2-straight-line-v5', ...[1, 2, 3, 4, 5, 6].map(v => `virgl-webgl2-raw-bits-v${v}`)]) {
      schemaCase(`${stage}-${profile}`, stage, metadata(stage, 46, profile), { ok: true, domain: null });
    }
    const mutations = [
      ['unknown-profile', v => { v.profile = 'virgl-webgl2-raw-bits-v8'; }],
      ['missing-contract', v => { delete v.constantDomains; }],
      ['old-profile-with-contract', v => { v.profile = 'virgl-webgl2-raw-bits-v6'; }],
      ['wrong-metadata-stage', v => { v.stage = stage === 'vertex' ? 'fragment' : 'vertex'; }],
      ['empty-contract', v => { v.constantDomains = []; }],
      ['duplicate-contract', v => { v.constantDomains.push(clone(v.constantDomains[0])); }],
      ['unknown-kind', v => { v.constantDomains[0].kind = 'finite-normal-only-v1'; }],
      ['wrong-stage', v => { v.constantDomains[0].stage = stage === 'vertex' ? 'fragment' : 'vertex'; }],
      ['slot-one', v => { v.constantDomains[0].slot = 1; }],
      ['wrong-name', v => { v.constantDomains[0].name = 'otherconst0'; }],
      ['name-has-array-suffix', v => { v.constantDomains[0].name += '[0]'; }],
      ['zero-extent', v => { v.constantDomains[0].count = v.uniforms[0].count = 0; }],
      ['extent48', v => { v.constantDomains[0].count = v.uniforms[0].count = 48; }],
      ['fraction-extent', v => { v.constantDomains[0].count = v.uniforms[0].count = 1.5; }],
      ['extent-disagreement', v => { v.constantDomains[0].count--; }],
      ['uniform-name', v => { v.uniforms[0].name = 'otherconst0'; }],
      ['uniform-type', v => { v.uniforms[0].type = 'vec4[]'; }],
      ['uniform-encoding', v => { v.uniforms[0].encoding = 'numeric'; }],
      ['no-uniform', v => { v.uniforms = []; }],
      ['duplicate-uniform', v => { v.uniforms.push(clone(v.uniforms[0])); }],
      ['unknown-metadata-key', v => { v.unknown = true; }],
      ['unknown-domain-key', v => { v.constantDomains[0].unknown = true; }],
      ['unknown-uniform-key', v => { v.uniforms[0].unknown = true; }],
      ...['kind', 'stage', 'slot', 'name', 'count'].map(key => [`missing-domain-${key}`, v => { delete v.constantDomains[0][key]; }]),
    ];
    for (const [name, mutate] of mutations) {
      const input = metadata(stage); mutate(input); schemaCase(`${stage}-${name}`, stage, input, { ok: false });
    }
    const bothRemoved = metadata(stage); delete bothRemoved.constantDomains; bothRemoved.profile = 'virgl-webgl2-raw-bits-v6';
    schemaCase(`${stage}-legacy-after-both-markers-removed`, stage, bothRemoved, { ok: true, domain: null });
  }
  for (const [name, make] of [
    ['null-record', () => null], ['array-record', () => []], ['primitive-record', () => 1],
    ['revoked-record', revoked],
    ['throwing-descriptors', () => new Proxy({}, { ownKeys() { throw new Error('unavailable'); } })],
    ['inherited-profile', () => { const v = metadata(); const profile = v.profile; delete v.profile; return Object.assign(Object.create({ profile }), v); }],
    ['metadata-accessor', () => ownAccessor(metadata(), 'constantDomains')],
    ['domain-accessor', () => { const v = metadata(); ownAccessor(v.constantDomains[0], 'kind'); return v; }],
    ['array-accessor', () => { const v = metadata(); ownAccessor(v.constantDomains, '0'); return v; }],
    ['sparse-array', () => { const v = metadata(); delete v.constantDomains[0]; return v; }],
    ['array-extra-key', () => { const v = metadata(); v.constantDomains.extra = 1; return v; }],
    ['array-symbol', () => { const v = metadata(); v.constantDomains[Symbol('extra')] = 1; return v; }],
    ['record-symbol', () => { const v = metadata(); v[Symbol('extra')] = 1; return v; }],
    ['contract-not-array', () => { const v = metadata(); v.constantDomains = {}; return v; }],
  ]) schemaCase(name, 'vertex', make(), { ok: false }, { base: 'vertex-extent46', mutation: name });
  schemaCase('unknown-requested-stage', 'geometry', metadata(), { ok: false });

  const finiteWords = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff, 0x00800000, 0x80800000,
    0x3f800000, 0xbf800000, 0x7f7fffff, 0xff7fffff];
  const full = Array.from({ length: 184 }, (_, i) => finiteWords[i % finiteWords.length]);
  const bankCase = (name, input, uploadCount, code = null, recipe = null) => {
    const result = checkFiniteBank(input, uploadCount); assert.ok(freeze(result), `${name}: frozen result`);
    assert.equal(result.ok, code === null, name);
    if (code) assert.equal(result.error.code, code, name);
    else assert.deepEqual(result.words, input.slice(0, uploadCount * 4), name);
    banks.push({ name, ...(recipe ? { recipe } : { words: input }), uploadCount: encoded(uploadCount), expectedCode: code, result }); return result;
  };
  for (const count of [0, 1, 8, 45, 46]) bankCase(`full-prefix${count}`, full, count);
  bankCase('empty-inactive', [], 0);
  bankCase('empty-active', [], 1, 'incomplete-draw');
  bankCase('short180-active46', full.slice(0, 180), 46, 'incomplete-draw');
  bankCase('short180-active45', full.slice(0, 180), 45);
  for (const word of [0x7f800000, 0xff800000, 0x7f800001, 0xff800001, 0x7fc00000, 0xffc00000, 0x7fffffff, 0xffffffff]) {
    for (const index of [0, 3, 180, 183]) {
      const input = [...full]; input[index] = word;
      bankCase(`nonfinite-${word.toString(16)}-lane${index}`, input, 46, 'constant-domain-error');
      if (index >= 180) bankCase(`pruned-${word.toString(16)}-lane${index}`, input, 45);
      bankCase(`inactive-${word.toString(16)}-lane${index}`, input, 0);
    }
  }
  bankCase('short-nonfinite-remains-incomplete', [0x7f800000, 0, 0, 0], 46, 'incomplete-draw');
  bankCase('bank188-not-guest-addressable', [...full, 0, 0, 0, 0], 46, 'constant-domain-error');
  bankCase('bank183-not-vec4', full.slice(0, 183), 45, 'constant-domain-error');
  for (const count of [-1, .5, 47, '1', NaN, Infinity]) bankCase(`bad-count-${String(count)}`, full, count, 'constant-domain-error');
  for (const [name, make] of [
    ['not-array', () => new Uint32Array(4)], ['null', () => null], ['revoked', revoked],
    ['sparse', () => Array(4)], ['accessor', () => ownAccessor([0, 0, 0, 0], '0')],
    ['extra-key', () => Object.assign([0, 0, 0, 0], { extra: 1 })],
  ]) bankCase(`bank-${name}`, make(), 1, 'constant-domain-error', { mutation: name });
  for (const word of [-1, 0x100000000, .5, '0', null]) bankCase(`invalid-word-${String(word)}`, [word, 0, 0, 0], 1, 'constant-domain-error');

  const sourceMetadata = metadata(), parsed = parseConstantDomain(sourceMetadata, 'vertex');
  sourceMetadata.constantDomains[0].count = 1; sourceMetadata.uniforms[0].count = 1;
  assert.equal(parsed.domain.count, 46); assert.throws(() => { parsed.domain.count = 1; }, TypeError);
  ownership.push({ name: 'contract-copy', sourceCountAfter: 1, retained: parsed, frozenMutationRejected: true });
  const mutable = [...full], checked = checkFiniteBank(mutable, 46); mutable.fill(0x7f800000);
  assert.deepEqual(checked.words, full); assert.throws(() => { checked.words[0] = 0x7f800000; }, TypeError);
  ownership.push({ name: 'bank-copy', sourceAfter: mutable, retained: checked, frozenMutationRejected: true });
  // The real predecoder's frozen word arrays, not mutable packet views, are what
  // SET stores and the consumer snapshots. Exercise both stages and replacement.
  for (const stage of [0, 1]) {
    const input = new Uint8Array(12 + full.length * 4), view = new DataView(input.buffer);
    [0x00ba000c, stage, 0, ...full].forEach((word, i) => view.setUint32(i * 4, word, true));
    const requestHex = Buffer.from(input).toString('hex'), decoded = decodeSubmission(input);
    assert.equal(decoded.ok, true); assert.ok(freeze(decoded));
    const original = decoded.commands[0].fields.words, snapshot = checkFiniteBank(original, 46); input.fill(255);
    assert.deepEqual(original, full); assert.deepEqual(snapshot.words, full); assert.notEqual(snapshot.words, original);
    assert.throws(() => { original[0] = 0x7f800000; }, TypeError);
    const replacement = Object.freeze(full.slice(0, 180)), rejected = checkFiniteBank(replacement, 46);
    assert.equal(rejected.error.code, 'incomplete-draw'); assert.deepEqual(snapshot.words, full);
    ownership.push({ name: `decoder-stage${stage}-replace`, requestHex, inputAfterHex: Buffer.from(input).toString('hex'),
      decodedWords: original, snapshot, replacement, rejected, distinctReferences: original !== replacement,
      frozenMutationRejected: true });
  }
  return { schema: 'wasm-vm-constant-domains-unit-v1', status: 'passed',
    profile: CONDITIONAL_PROFILE, kind: CONSTANT_DOMAIN_KIND, predicates, schemas, banks, ownership,
    stats: { predicates: predicates.length, schemas: schemas.length, banks: banks.length, ownership: ownership.length } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--output');
  const output = path.resolve(process.argv[3]); await fs.mkdir(output, { recursive: true });
  const session = new Session(); session.connect();
  const post = (name, args = {}) => new Promise((resolve, reject) => session.post(name, args, (error, value) => error ? reject(error) : resolve(value)));
  await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const report = runUnitAcceptance();
  const coverage = await post('Profiler.takePreciseCoverage'); await post('Profiler.stopPreciseCoverage'); session.disconnect();
  const selected = coverage.result.filter(script => script.url === new URL('../../renderer/virgl-command/constant-domain.mjs', import.meta.url).href);
  assert.equal(selected.length, 1); const coverageBytes = Buffer.from(JSON.stringify({ result: selected }, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'coverage.json'), coverageBytes);
  report.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  report.sources = [];
  for (const source of ['renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs', 'tools/virgl-constant-domains/unit.mjs']) {
    const bytes = await fs.readFile(path.join(ROOT, source)); report.sources.push({ path: source, bytes: bytes.length, sha256: hash(bytes) });
  }
  report.coverage = { path: 'coverage.json', bytes: coverageBytes.length, sha256: hash(coverageBytes) };
  await fs.writeFile(path.join(output, 'unit-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, ...report.stats, output }));
}
