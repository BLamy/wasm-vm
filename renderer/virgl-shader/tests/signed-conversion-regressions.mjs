import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Critic-owned domain expectations enumerate the actual feasible words of
// bounded input cubes. DataView supplies binary32 semantics independently of
// the compiler's known-bit proof and unsigned conversion helper.
const view = new DataView(new ArrayBuffer(4));
const float = word => { view.setUint32(0, word, true); return view.getFloat32(0, true); };
const signed = word => { view.setUint32(0, word, true); return view.getInt32(0, true); };
const bits = value => { view.setFloat32(0, value, true); return view.getUint32(0, true); };
const defined = word => Number.isFinite(float(word)) && float(word) >= -(2 ** 31) && float(word) < 2 ** 31;
const rawOutput = word => (word & 0x7fffffff) === 0 || (word & 0x7f800000) > 0 && (word & 0x7f800000) < 0x7f800000;
const imm = (index, words) => `IMM[${index}] UINT32 {${words.join(',')}}`;
const program = (extras, body) => {
  const immediates = new Map(extras.map(line => [Number(/^IMM\[(\d+)\]/.exec(line)[1]), line]));
  immediates.set(2, imm(2, Array(4).fill(0x3f000000)));
  return ['FRAG', 'DCL IN[0], GENERIC[0], PERSPECTIVE', 'DCL OUT[0], COLOR',
    'DCL TEMP[0..2]', 'DCL CONST[0..45]', ...[0, 1, 2].map(index => immediates.get(index) || imm(index, Array(4).fill(0))),
    ...body, 'END', ''].join('\n');
};
const source = (register, modifier) => modifier.includes('|') ? `${modifier.startsWith('-') ? '-' : ''}|${register}|` : `${modifier}${register}`;
const modified = (word, modifier) => modifier === '-' ? (word ^ 0x80000000) >>> 0 : modifier === '|' ? word & 0x7fffffff : modifier === '-|' ? (word | 0x80000000) >>> 0 : word;
function cube(mask, base) {
  const free = [...Array(32).keys()].filter(bit => ((mask >>> bit) & 1) && !((base >>> bit) & 1));
  assert.ok(free.length <= 3, 'bounded independent enumeration');
  return Array.from({length: 2 ** free.length}, (_, choice) => free.reduce((word, bit, index) =>
    ((choice >>> index) & 1) ? (word | (2 ** bit)) >>> 0 : word, base));
}

export function getSignedConversionRegressions() {
  const cases = [];
  const add = (name, text, ok, extra = {}) => cases.push({name, stage: 'fragment', text, ok, ...extra});
  const bases = [0, 0x80000000, 0x3fc00000, 0xbfc00000, 0x4effffff, 0xceffffff,
    0x4f000000, 0xcf000000, 0x7f800000, 0xff800000, 0x7fc00001, 0xffc00001];
  for (const base of bases) for (const mask of [0, 1, 7, 0x80000000, 0x00800001, 0x40000001, 0x41000001]) {
    for (const modifier of ['', '-', '|', '-|']) for (const lanes of ['x', 'xz', 'yw', 'xyzw']) {
      const feasibleWords = cube(mask, base).map(word => modified(word, modifier));
      const ok = feasibleWords.every(defined);
      add(`range-cube-${base}-${mask}-${modifier || 'identity'}-${lanes}`, program([
        imm(0, Array(4).fill(mask)), imm(1, Array(4).fill(base))], [
        'AND TEMP[0], CONST[0], IMM[0]', 'OR TEMP[0], TEMP[0], IMM[1]',
        `F2I TEMP[1].${lanes}, ${source('TEMP[0].wzyx', modifier)}`, 'MOV OUT[0], IMM[2]']), ok,
      {feasibleWords, noRangeBank: true});
    }
  }
  for (const word of [0, 1, 0xffffffff, 0x80000000, 0x80000001, 0x7fffffff, 0x7ffffffe,
    0x01000001, 0x01000003, 0xfeffffff, 0xfdffffff, 0x3f000000]) {
    const rounded = bits(signed(word));
    add('roundtrip-domain-' + word, program([imm(0, Array(4).fill(word))], [
      'I2F TEMP[0], IMM[0]', 'F2I TEMP[1], TEMP[0]', 'I2F OUT[0], TEMP[1]']), defined(rounded),
    {sourceWord: word, roundedWord: rounded, noRangeBank: true});
  }
  for (const word of [0, 0x80000000, 1, 0x80000001, 0x3fc00000, 0xbfc00000, 0x4effffff,
    0xceffffff, 0xcf000000, 0x4f000000, 0xcf000001, 0x7f800000, 0xffc12345]) {
    const result = defined(word) ? Math.trunc(float(word)) >>> 0 : null;
    add('private-result-output-' + word, program([imm(0, Array(4).fill(word))], [
      'F2I TEMP[0], IMM[0]', 'MOV OUT[0], TEMP[0]']), result !== null && rawOutput(result),
    {sourceWord: word, truncatedWord: result, noRangeBank: true});
    add('forbidden-dead-result-' + word, program([imm(0, Array(4).fill(word))], [
      'F2I TEMP[0], IMM[0]', 'MOV OUT[0], IMM[2]']), defined(word), {noRangeBank: true});
  }
  for (let mask = 1; mask < 16; mask++) for (const swizzle of ['xyzw', 'wzyx', 'xxxx', 'zzyy']) {
    const lanes = [...'xyzw'].filter((_, i) => (mask >>> i) & 1).join('');
    let consumed = 0;
    for (const lane of lanes) consumed |= 1 << 'xyzw'.indexOf(swizzle['xyzw'.indexOf(lane)]);
    add('direct-bank-consumed-' + mask + '-' + swizzle, program([], [
      `F2I TEMP[0].${lanes}, CONST[45].${swizzle}`, 'MOV OUT[0], IMM[2]']), true,
    {components: [{register: 45, mask: consumed}]});
    add('version-old-private-escape-' + mask + '-' + swizzle, program([], [
      'F2I TEMP[0], CONST[45]', 'MOV TEMP[1], TEMP[0]', `I2F TEMP[0].${lanes}, TEMP[0].${swizzle}`,
      'MOV OUT[0], IMM[2]', `MOV OUT[0].${lanes}, TEMP[1]`]), false);
    add('version-new-conversion-authority-' + mask + '-' + swizzle, program([], [
      'F2I TEMP[0], CONST[45]', 'MOV TEMP[1], TEMP[0]', `I2F TEMP[0].${lanes}, TEMP[0].${swizzle}`,
      'MOV OUT[0], IMM[2]', `MOV OUT[0].${lanes}, TEMP[0]`]), true,
    {components: [{register: 45, mask: 15}]});
  }
  for (const modifier of ['', '-', '|', '-|']) {
    add('unknown-computed-range-' + modifier, program([], ['MOV TEMP[0], CONST[0]',
      `F2I TEMP[1], ${source('TEMP[0]', modifier)}`, 'MOV OUT[0], IMM[2]']), false);
    add('input-range-' + modifier, program([], [`F2I TEMP[0], ${source('IN[0]', modifier)}`,
      'MOV OUT[0], IMM[2]']), false);
    if (modifier) add('dynamic-modifier-range-' + modifier, program([], [
      `F2I TEMP[0], ${source('CONST[0]', modifier)}`, 'MOV OUT[0], IMM[2]']), false);
  }
  add('join-private-arm-range', program([], ['UIF IN[0].xxxx', 'MOV TEMP[0], CONST[0]',
    'ELSE', 'MOV TEMP[0], IMM[2]', 'ENDIF', 'F2I TEMP[1], TEMP[0]', 'MOV OUT[0], IMM[2]']), false);
  add('join-all-small-range', program([imm(0, Array(4).fill(0x3f7fffff))], ['UIF IN[0].xxxx',
    'AND TEMP[0], CONST[0], IMM[0]', 'ELSE', 'MOV TEMP[0], IMM[2]', 'ENDIF',
    'F2I TEMP[1], TEMP[0]', 'MOV OUT[0], TEMP[1]']), true, {noRangeBank: true});
  return cases;
}

export function runSignedConversionRegressions(translate, cases = getSignedConversionRegressions()) {
  const records = [];
  for (const c of cases) {
    const result = translate({stage: c.stage, text: c.text});
    records.push({...c, result});
    try {
      assert.equal(typeof result.ok, 'boolean', c.name + ' public boolean result');
      assert.equal(result.ok, c.ok, c.name + ' independent conversion/range/provenance prediction');
      if (!c.ok) for (const key of ['glsl', 'metadata', 'vertex', 'fragment']) assert.equal(Object.hasOwn(result, key), false, c.name + ' closed ' + key);
      else {
        assert.ok(result.glsl.startsWith('#version 300 es'));
        assert.equal(result.metadata.signedConversionContract.integerToFloat, 'nearest-even');
        assert.equal(result.metadata.signedConversionContract.floatToInteger, 'toward-zero');
        if (c.noRangeBank) assert.equal(Object.hasOwn(result.metadata, 'constantConversionDomains'), false, c.name + ' static range requires no dynamic guard');
        if (c.components) assert.deepEqual(result.metadata.constantConversionDomains[0].components, c.components, c.name + ' exact consumed lane union');
      }
    } catch (error) {
      error.counterexample = records.at(-1);
      throw error;
    }
  }
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const root = path.resolve(get('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
  const native = get('--native'), output = get('--output'), cases = getSignedConversionRegressions();
  const report = {schema: 'virgl-signed-conversion-critic-guards-v1', task: 'E6-T12g6e', status: 'running', cases: cases.length,
    testSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
  try {
    if (native) {
      report.nativeBinary = {path: path.resolve(native), sha256: createHash('sha256').update(fs.readFileSync(native)).digest('hex')};
      report.native = runSignedConversionRegressions(({stage, text}) => JSON.parse(execFileSync(path.resolve(native), [stage], {input: text, maxBuffer: 4e6})), cases);
    }
    if (!args.includes('--native-only')) {
      const {createVirglShaderBridge} = await import(pathToFileURL(path.join(root, 'renderer/virgl-shader/index.mjs')));
      const bridge = await createVirglShaderBridge();
      report.wasm = runSignedConversionRegressions(request => bridge.translate(request), cases);
      if (report.native) for (let i = 0; i < cases.length; i++) assert.deepEqual(report.native[i].result, report.wasm[i].result, 'exact native/Wasm parity at ' + cases[i].name);
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {message: error.message, counterexample: error.counterexample};
    throw error;
  } finally {
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`${cases.length} independent signed conversion range/lane/version guards passed.`);
}
