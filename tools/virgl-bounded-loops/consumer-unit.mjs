/** Recorded v12 metadata, raw count, complete finite bank and ownership checks. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from 'node:inspector';
import { parseConstantDomain, checkLoopBank } from '../../renderer/virgl-command/constant-domain.mjs';
import { decodeSubmission } from '../../renderer/virgl-command/decoder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = ['renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/decoder.mjs', 'tools/virgl-bounded-loops/consumer-unit.mjs'];
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const frozen = value => value === null || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(frozen));
const indices = () => Array.from({ length: 36 }, (_, i) => i + 10);
function metadata(stage = 'vertex', version = 12, count = 46) {
  const name = stage === 'vertex' ? 'vsconst0' : 'fsconst0';
  return { profile: typeof version === 'number' ? `virgl-webgl2-raw-bits-v${version}` : version,
    stage, inputs: [], outputs: [], attributes: [], uniforms: [{ name, type: 'uvec4[]', count, encoding: 'float32-bits' }], samplers: [], uniformBlocks: [],
    ...([7, 9, 11, 12].includes(version) ? { constantDomains: [{ kind: 'constant-bank-finite-f32-v1', stage, slot: 0, name, count }] } : {}),
    ...([10, 11, 12].includes(version) ? { constantAccesses: [{ kind: 'constant-bank-static-indirect-v1', stage, slot: 0, name, count, indices: indices() }] } : {}),
    ...(version === 12 ? { constantConstraints: [{ kind: 'constant-bank-counted-table-i32-v1', stage, slot: 0, name, count, register: 9, component: 0, maximum: 18 }] } : {}) };
}
const encoded = value => {
  if (typeof value === 'number') return { type: 'number', value: Number.isFinite(value) ? value : String(value) };
  if (typeof value === 'symbol' || typeof value === 'bigint') return { type: typeof value, value: String(value) };
  if (value === undefined) return { type: 'undefined' };
  return { type: typeof value, value };
};
const fullBank = (count = 18) => { const words = Array.from({ length: 184 }, (_, i) => [0, 0x80000000, 1, 0x80000001, 0x3f800000, 0xbf800000, 0x7f7fffff, 0xff7fffff][i % 8]); words[36] = count; return words; };

export function runConsumerAcceptance() {
  const schemas = [], banks = [], ownership = []; let getterCalls = 0;
  const accessor = (value, key) => Object.defineProperty(value, key, { enumerable: true, configurable: true,
    get() { getterCalls++; throw new Error('Rejected accessors must never execute.'); } });
  const schemaCase = (name, stage, input, ok, recipe = null) => {
    const result = parseConstantDomain(input, stage); assert.equal(result.ok, ok, name); assert.ok(frozen(result), name);
    if (ok) assert.deepEqual(result, { ok: true, domain: clone(input.constantDomains?.[0] ?? null),
      ...(input.constantAccesses ? { access: clone(input.constantAccesses[0]) } : {}),
      ...(input.constantConstraints ? { constraint: clone(input.constantConstraints[0]) } : {}) });
    else assert.equal(result.error.code, 'shader-domain-error', name);
    schemas.push({ name, stage, ...(recipe ? { recipe } : { input: clone(input) }), result, frozen: true });
  };
  for (const stage of ['vertex', 'fragment']) {
    for (const count of [46, 47]) for (const extra of [false, true]) {
      const value = metadata(stage, 12, count); if (extra) value.constantAccesses[0].indices = Array.from({ length: 46 }, (_, i) => i);
      schemaCase(`${stage}-extent${count}-extra${extra}`, stage, value, true);
    }
    for (const version of ['virgl-webgl2-straight-line-v5', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const value = metadata(stage, version); schemaCase(`${stage}-old-${version}`, stage, value, true);
      value.constantConstraints = metadata(stage).constantConstraints;
      schemaCase(`${stage}-old-${version}-forbids-constraint`, stage, value, false);
    }
    const mutations = [
      ['unknown-profile', v => { v.profile = 'virgl-webgl2-raw-bits-v13'; }],
      ['missing-constraint', v => { delete v.constantConstraints; }],
      ['empty-constraint', v => { v.constantConstraints = []; }],
      ['duplicate-constraint', v => { v.constantConstraints.push(clone(v.constantConstraints[0])); }],
      ['constraint-not-array', v => { v.constantConstraints = {}; }],
      ['constraint-not-record', v => { v.constantConstraints[0] = []; }],
      ['constraint-kind', v => { v.constantConstraints[0].kind = 'observed-loop-count-v1'; }],
      ['constraint-stage', v => { v.constantConstraints[0].stage = stage === 'vertex' ? 'fragment' : 'vertex'; }],
      ['constraint-slot', v => { v.constantConstraints[0].slot = 1; }],
      ['constraint-name', v => { v.constantConstraints[0].name += '[0]'; }],
      ...[['register', 8], ['component', 1], ['maximum', 19], ['maximum', 17], ['maximum', '18'], ['maximum', 18.5],
        ['count', 45], ['count', 48], ['count', '46'], ['count', true], ['register', true], ['component', false], ['slot', false]].map(([key, value], i) =>
        [`constraint-field-${i}`, v => { v.constantConstraints[0][key] = value; }]),
      ['count-mismatch', v => { v.constantConstraints[0].count = 47; }],
      ['entire-extent45', v => { v.constantConstraints[0].count = v.constantDomains[0].count = v.constantAccesses[0].count = v.uniforms[0].count = 45; v.constantAccesses[0].indices.pop(); }],
      ['constraint-extra', v => { v.constantConstraints[0].extra = 1; }],
      ...['kind', 'stage', 'slot', 'name', 'count', 'register', 'component', 'maximum'].map(key => [`missing-${key}`, v => { delete v.constantConstraints[0][key]; }]),
      ['missing-domain', v => { delete v.constantDomains; }], ['missing-access', v => { delete v.constantAccesses; }],
      ['domain-mismatch', v => { v.constantDomains[0].count = 47; }], ['access-mismatch', v => { v.constantAccesses[0].count = 47; }],
      ['unordered-access', v => { v.constantAccesses[0].indices.reverse(); }], ['index46', v => { v.constantAccesses[0].indices.push(46); }],
    ];
    for (const [name, mutate] of mutations) { const value = metadata(stage); mutate(value); schemaCase(`${stage}-${name}`, stage, value, false); }
    for (let missing = 10; missing <= 45; missing++) { const value = metadata(stage);
      value.constantAccesses[0].indices = value.constantAccesses[0].indices.filter(index => index !== missing);
      schemaCase(`${stage}-missing-index${missing}`, stage, value, false); }
    for (const location of ['metadata', 'array', 'record']) {
      const value = metadata(stage);
      accessor(...(location === 'metadata' ? [value, 'constantConstraints'] : location === 'array' ? [value.constantConstraints, '0'] : [value.constantConstraints[0], 'maximum']));
      schemaCase(`${stage}-${location}-accessor`, stage, value, false, `${location}-accessor`);
    }
    for (const mutation of ['sparse', 'extra', 'symbol', 'inherited', 'revoked', 'throwing-descriptors']) {
      const value = metadata(stage), array = value.constantConstraints;
      if (mutation === 'sparse') delete array[0];
      if (mutation === 'extra') array.extra = 1;
      if (mutation === 'symbol') array[Symbol('extra')] = 1;
      if (mutation === 'inherited') { const record = array[0]; delete array[0]; Object.setPrototypeOf(array, { 0: record }); }
      if (mutation === 'revoked') { const proxy = Proxy.revocable([], {}); proxy.revoke(); value.constantConstraints = proxy.proxy; }
      if (mutation === 'throwing-descriptors') value.constantConstraints = new Proxy([], { ownKeys() { throw new Error('denied'); } });
      schemaCase(`${stage}-array-${mutation}`, stage, value, false, `array-${mutation}`);
    }
    for (const mutation of ['symbol', 'inherited', 'revoked', 'throwing-descriptors']) {
      const value = metadata(stage), record = value.constantConstraints[0];
      if (mutation === 'symbol') record[Symbol('extra')] = 1;
      if (mutation === 'inherited') { delete record.maximum; Object.setPrototypeOf(record, { maximum: 18 }); }
      if (mutation === 'revoked') { const proxy = Proxy.revocable({}, {}); proxy.revoke(); value.constantConstraints[0] = proxy.proxy; }
      if (mutation === 'throwing-descriptors') value.constantConstraints[0] = new Proxy({}, { ownKeys() { throw new Error('denied'); } });
      schemaCase(`${stage}-record-${mutation}`, stage, value, false, `record-${mutation}`);
    }
  }
  const bankCase = (name, words, extent, code = null, recipe = null) => {
    const result = checkLoopBank(words, extent); assert.equal(result.ok, code === null, name); assert.ok(frozen(result), name);
    if (code) assert.equal(result.error.code, code, name); else assert.deepEqual(result.words, words, name);
    banks.push({ name, ...(recipe ? { recipe } : { words: words.map(encoded) }), extent: encoded(extent), result, frozen: true });
  };
  for (const extent of [46, 47]) {
    for (let count = 0; count <= 32; count++) bankCase(`extent${extent}-count${count}`, fullBank(count), extent, count <= 18 ? null : 'constant-constraint-error');
    for (const [word, expected] of [[0x80000000, null], [0x80000001, null], [0xff7fffff, null], [0x80800000, null],
      [0x3f800000, 'constant-constraint-error'], [0x7f000000, 'constant-constraint-error'], [0x7f7fffff, 'constant-constraint-error'],
      [0x7f800000, 'constant-domain-error'], [0xff800000, 'constant-domain-error'], [0xffffffff, 'constant-domain-error'], [0x7fffffff, 'constant-domain-error']])
      bankCase(`extent${extent}-word${word.toString(16)}`, fullBank(word), extent, expected);
    for (const word of [-1, 0x100000000, .5, NaN, Infinity, -Infinity, '18', null, undefined, true, false, 18n, Symbol('count'), {}]) {
      const words = fullBank(); words[36] = word;
      bankCase(`extent${extent}-invalid-${typeof word}-${String(word)}`, words, extent, 'constant-domain-error');
    }
    for (const lane of [0, 35, 36, 37, 180, 183]) { const words = fullBank(); words[lane] = 0x7fc00000;
      bankCase(`extent${extent}-poison${lane}`, words, extent, 'constant-domain-error'); }
    bankCase(`extent${extent}-short`, fullBank().slice(0, 180), extent, 'incomplete-draw');
    bankCase(`extent${extent}-short-invalid-count`, fullBank(19).slice(0, 180), extent, 'incomplete-draw');
    bankCase(`extent${extent}-partial-register`, fullBank().slice(0, 183), extent, 'constant-domain-error');
    bankCase(`extent${extent}-extra-register`, [...fullBank(), 0, 0, 0, 0], extent, 'constant-domain-error');
    const words = fullBank(19); words[183] = 0x7fc00000;
    bankCase(`extent${extent}-finite-before-count`, words, extent, 'constant-domain-error');
  }
  for (const extent of [0, 45, 48, -1, 46.5, '46', true, null, undefined, NaN, Infinity])
    bankCase(`invalid-extent-${typeof extent}-${String(extent)}`, fullBank(), extent, 'constant-constraint-error');
  for (const mutation of ['typed-array', 'null', 'sparse', 'accessor', 'extra', 'symbol', 'revoked', 'throwing-descriptors']) {
    let words = fullBank();
    if (mutation === 'typed-array') words = new Uint32Array(words);
    if (mutation === 'null') words = null;
    if (mutation === 'sparse') delete words[36];
    if (mutation === 'accessor') accessor(words, '36');
    if (mutation === 'extra') words.extra = 1;
    if (mutation === 'symbol') words[Symbol('extra')] = 1;
    if (mutation === 'revoked') { const proxy = Proxy.revocable([], {}); proxy.revoke(); words = proxy.proxy; }
    if (mutation === 'throwing-descriptors') words = new Proxy([], { ownKeys() { throw new Error('denied'); } });
    bankCase(`bank-${mutation}`, words, 46, 'constant-domain-error', mutation);
  }
  const input = metadata(), parsed = parseConstantDomain(input, 'vertex');
  input.constantConstraints[0].maximum = 19; input.constantConstraints[0].register = 8; input.constantAccesses[0].indices.fill(0);
  assert.equal(parsed.constraint.maximum, 18); assert.equal(parsed.constraint.register, 9); assert.deepEqual(parsed.access.indices, indices());
  assert.throws(() => { parsed.constraint.maximum = 19; }, TypeError);
  ownership.push({ name: 'metadata-copy', retained: parsed, changedMaximum: 19, changedRegister: 8, frozenMutationRejected: true });
  for (const stage of [0, 1]) {
    const words = fullBank(), packet = new Uint8Array(12 + words.length * 4), view = new DataView(packet.buffer);
    [0x00ba000c, stage, 0, ...words].forEach((word, i) => view.setUint32(i * 4, word, true));
    const requestHex = Buffer.from(packet).toString('hex'), decoded = decodeSubmission(packet); assert.equal(decoded.ok, true); assert.ok(frozen(decoded));
    const bank = decoded.commands[0].fields.words, approved = checkLoopBank(bank, 47); packet.fill(255);
    assert.deepEqual(approved.words, words); assert.notEqual(approved.words, bank); assert.throws(() => { approved.words[36] = 19; }, TypeError);
    const failed = checkLoopBank(Object.freeze(fullBank(19)), 47), negative = checkLoopBank(Object.freeze(fullBank(0x80000000)), 47);
    const restored = checkLoopBank(Object.freeze(fullBank()), 47);
    assert.equal(failed.error.code, 'constant-constraint-error'); assert.equal(negative.words[36], 0x80000000); assert.deepEqual(restored.words, approved.words);
    assert.notEqual(restored.words, approved.words);
    ownership.push({ name: `decoder-stage${stage}-replacement`, requestHex, packetAfterHex: Buffer.from(packet).toString('hex'),
      approved, failed, negative, restored, distinctReferences: true, frozenMutationRejected: true });
  }
  assert.equal(getterCalls, 0);
  return { schema: 'wasm-vm-bounded-loop-consumer-unit-v1', task: 'E6-T12e9', status: 'passed', schemas, banks, ownership, getterCalls,
    stats: { schemas: schemas.length, banks: banks.length, ownership: ownership.length } };
}

async function main() {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--output');
  const output = path.resolve(process.argv[3]); await fs.mkdir(output, { recursive: true });
  const session = new Session(); session.connect(); const post = (method, args = {}) => new Promise((resolve, reject) => session.post(method, args, (error, value) => error ? reject(error) : resolve(value)));
  await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const report = runConsumerAcceptance();
  const coverage = (await post('Profiler.takePreciseCoverage')).result.filter(entry => FILES.slice(0, 2).some(name => entry.url === new URL(name, `file://${ROOT}/`).href));
  await post('Profiler.stopPreciseCoverage'); session.disconnect(); assert.equal(coverage.length, 2);
  const coverageBytes = Buffer.from(JSON.stringify(coverage, null, 2) + '\n'); await fs.writeFile(path.join(output, 'coverage.json'), coverageBytes);
  report.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  report.sources = await Promise.all(FILES.map(async source => { const bytes = await fs.readFile(path.join(ROOT, source)); return { path: source, bytes: bytes.length, sha256: sha(bytes) }; }));
  report.coverage = { path: 'coverage.json', bytes: coverageBytes.length, sha256: sha(coverageBytes) };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, ...report.stats, output }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
