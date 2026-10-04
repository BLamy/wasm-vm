// E6-T12f4b: independently predicted reaching bank components and raw-word domain.
// Run after build.sh wasm. An optional isolated domain module supports sensitivity proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

const domainUrl = process.env.VIRGL_RASTER_BANK_VERIFIER_DOMAIN ?
  pathToFileURL(process.env.VIRGL_RASTER_BANK_VERIFIER_DOMAIN) : new URL('../constant-domain.mjs', import.meta.url);
const {parseConstantDomain, checkRasterBank, rasterBinary32Word} = await import(domainUrl);
const wasmUrl = new URL('../../virgl-shader/build/wasm/virgl-shader.wasm', import.meta.url);
const wasm = fs.readFileSync(wasmUrl);
const bridge = await createVirglShaderBridge({wasmBinary: wasm});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const report = {schema: 'raster-bank-independent-regressions-v1', status: 'running',
  domainModuleSha256: hash(fs.readFileSync(domainUrl)), wasmSha256: hash(wasm),
  novel: [], mutations: [], words: [], combined: [], hostileDescriptor: null};
const number = word => {
  const bytes = new ArrayBuffer(4), view = new DataView(bytes);
  view.setUint32(0, word, true);
  return view.getFloat32(0, true);
};
const admitted = word => Number.isInteger(word) && word >= 0 && word <= 0xffffffff &&
  Number.isFinite(number(word)) && (number(word) === 0 || Math.abs(number(word)) >= 2 ** -126);
const shader = stage => [stage === 'vertex' ? 'VERT' : 'FRAG',
  ...(stage === 'vertex' ? ['DCL IN[0]', 'DCL IN[1]', 'DCL OUT[0], POSITION',
    'DCL OUT[1], GENERIC[0]', 'DCL OUT[2], GENERIC[1]'] : ['DCL OUT[0], COLOR']),
  'DCL TEMP[0..117]', 'DCL CONST[0..5]', 'IMM[0] UINT32 {0,0,0,0}',
  'OR TEMP[117], IMM[0], IMM[0]', 'MOV TEMP[0], CONST[0]', 'MOV TEMP[1], CONST[1]',
  'UIF CONST[5].xxxx', 'MOV TEMP[0].xy, TEMP[0].yxzw', 'UIF CONST[5].yyyy',
  'MOV TEMP[0].z, CONST[2].wwww', 'ELSE', 'MOV TEMP[0].z, CONST[3].yyyy', 'ENDIF',
  'ELSE', 'MOV TEMP[0].yw, CONST[4].wzyx', 'ENDIF',
  'UCMP TEMP[1].xz, CONST[5].zzzz, TEMP[0].wzyx, TEMP[1].xxyy',
  'MOV TEMP[1].y, CONST[4].zzzz',
  'MOV_PRECISE ' + (stage === 'vertex' ? 'OUT[1]' : 'OUT[0]') + ', TEMP[1]',
  ...(stage === 'vertex' ? ['MOV OUT[0], IN[0]', 'MOV OUT[2], IN[1]'] : []), 'END', ''].join('\n');

try {
  // Literal backward reasoning: T1.x selects C0.w/C4.x or old C1.x;
  // T1.z selects C0.x/C4.z or old C1.y; T1.y is C4.z; T1.w is C1.w.
  // Both nested writes to T0.z are dead. The raw selectors in C5 are never copied.
  const components = [{register: 0, mask: 9}, {register: 1, mask: 11}, {register: 4, mask: 5}];
  for (const stage of ['vertex', 'fragment']) {
    const text = shader(stage), result = bridge.translate({stage, text});
    assert.equal(result.ok, true, 'novel nested predecessor/alias copy admitted');
    const metadata = result.metadata;
    assert.equal(metadata.profile, 'virgl-webgl2-raw-bits-v27');
    assert.equal(metadata.rasterBaseProfile, 'virgl-webgl2-raw-bits-v20');
    assert.deepEqual(metadata.preciseWordContract, {kind: 'tgsi-precise-word-local-v1', stage, operations: ['MOV']});
    const expected = {kind: 'constant-bank-raster-copy-f32-v1', stage, slot: 0,
      name: (stage === 'vertex' ? 'vs' : 'fs') + 'const0', count: 6, components};
    assert.deepEqual(metadata.constantRasterDomains, [expected]);
    const contract = parseConstantDomain(metadata, stage);
    assert.equal(contract.ok, true);
    const words = Array(24).fill(1);
    for (const {register, mask} of components) for (let lane = 0; lane < 4; lane++)
      if (mask & (1 << lane)) words[register * 4 + lane] = [0, 0x80000000, 0x00800000, 0x80800001][lane];
    const approval = checkRasterBank(words, expected);
    assert.equal(approval.ok, true, 'all uncopied finite subnormals stay private');
    assert.deepEqual(approval.words, words);
    assert.equal(Object.isFrozen(approval.words), true);
    words.fill(0xffffffff);
    assert.equal(approval.words[20], 1, 'approved raw selector remains owned and exact');
    report.novel.push({stage, text, textSha256: hash(text), result, approvedWords: approval.words});
    for (const {register, mask} of components) for (let lane = 0; lane < 4; lane++) if (mask & (1 << lane)) {
      for (const word of [1, 0x80000001, 0x007fffff, 0x807fffff, 0x7f800000, 0xff800000, 0x7fa12345, 0xffc12345]) {
        const bank = approval.words.slice(); bank[register * 4 + lane] = word;
        const observed = checkRasterBank(bank, expected);
        assert.equal(observed.ok, false, 'every independent required lane rejects unsafe value');
        assert.equal(observed.error.code, Number.isFinite(number(word)) ? 'constant-raster-domain-error' : 'constant-domain-error');
        report.mutations.push({stage, register, lane, word, observed});
      }
    }
    for (const key of ['rasterBaseProfile', 'constantRasterDomains', 'constantDomains', 'preciseWordContract']) {
      const erased = clone(metadata); delete erased[key];
      assert.equal(parseConstantDomain(erased, stage).ok, false, 'novel simultaneous obligation ' + key);
    }
    for (const [name, change] of [
      ['drop-live-component', value => value.components[1].mask = 9],
      ['include-dead-predecessor', value => value.components.splice(2, 0, {register: 2, mask: 8})],
    ]) {
      const bad = clone(expected); change(bad);
      assert.notDeepEqual(metadata.constantRasterDomains[0], bad, 'literal compiler oracle detects ' + name);
    }
  }

  // Numeric decoding is independent of the production exponent-mask predicate.
  let state = 0xd713a9b5;
  const boundaries = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff,
    0x00800000, 0x80800000, 0x00800001, 0x80800001, 0x7f7fffff, 0xff7fffff,
    0x7f800000, 0xff800000, 0x7f800001, 0xffc0ffff, -1, 0x100000000, .5, true, NaN];
  for (let i = 0; i < 2048; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; boundaries.push(state >>> 0); }
  for (const word of boundaries) {
    const wanted = admitted(word), observed = rasterBinary32Word(word);
    assert.equal(observed, wanted);
    report.words.push({word: typeof word === 'number' && !Number.isFinite(word) ? String(word) : word, wanted, observed});
  }

  // Count/coefficient contracts are checked against the same full bank prefix.
  const counted = {kind: 'constant-bank-raster-copy-f32-v1', stage: 'fragment', slot: 0,
    name: 'fsconst0', count: 46, components: [{register: 28, mask: 8}, {register: 44, mask: 8}]};
  const words = Array(184).fill(0); words[16] = 0x3f800000; words[36] = 18;
  const approval = checkRasterBank(words, counted, true, true);
  assert.equal(approval.ok, true);
  for (const [name, at, word, code] of [
    ['count-overrun', 36, 19, 'constant-constraint-error'],
    ['normal-float-is-not-count', 36, 0x3f800000, 'constant-constraint-error'],
    ['undefined-radial-predecessor', 16, 0, 'constant-radial-domain-error'],
    ['copied-table-subnormal', 28 * 4 + 3, 1, 'constant-raster-domain-error'],
    ['nonfinite-unselected-prefix', 10, 0x7fc055aa, 'constant-domain-error'],
  ]) {
    const bank = words.slice(); bank[at] = word;
    const observed = checkRasterBank(bank, counted, true, true);
    assert.equal(observed.ok, false); assert.equal(observed.error.code, code);
    report.combined.push({name, at, word, observed});
  }
  for (const count of [0, 1, 18, 0x80000000, 0x80000001, 0xbf800000]) {
    const bank = words.slice(); bank[36] = count;
    const observed = checkRasterBank(bank, counted, true, true);
    assert.equal(observed.ok, true); assert.equal(observed.words[36], count);
    report.combined.push({name: 'private-signed-count', count, observed});
  }
  const badCount = clone(counted); badCount.components.unshift({register: 9, mask: 1});
  assert.equal(checkRasterBank(words, badCount, true, true).ok, false, 'integer count never gains raster authority');
  for (const [name, change] of [
    ['missing-component', value => value.components = []],
    ['duplicate-component', value => value.components.push({...value.components[0]})],
    ['hole-component', value => delete value.components[0]],
    ['boolean-mask', value => value.components[0].mask = true],
    ['count-outside-bound', value => value.count = 48],
  ]) {
    const bad = clone(counted); change(bad);
    const observed = checkRasterBank(words, bad, true, true);
    assert.equal(observed.ok, false); assert.equal(observed.error.code, 'constant-raster-domain-error');
    report.combined.push({name, observed});
  }
  const sentinel = new Error('independent descriptor trap');
  const hostile = new Proxy({}, {ownKeys() { throw sentinel; }});
  const descriptorFailure = checkRasterBank(words, hostile);
  assert.equal(descriptorFailure.ok, false, 'host descriptor exceptions cannot become successful bank approval');
  assert.equal(descriptorFailure.error.code, 'constant-raster-domain-error');
  report.hostileDescriptor = {trap: sentinel.message, observed: descriptorFailure};
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = {name: error.name, message: error.message, stack: error.stack};
  process.exitCode = 1;
}
process.stdout.write(JSON.stringify(report) + '\n');
