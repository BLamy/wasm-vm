import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Critic expectations use binary32 decoding and mathematical truncation/sign.
// A private 0/1 bit projection may rasterize only when it is exactly zero;
// its predetermined admission exposes every bit of a known scalar result.
const view = new DataView(new ArrayBuffer(4));
const value = word => { view.setUint32(0, word, true); return view.getFloat32(0, true); };
const bits = number => { view.setFloat32(0, number, true); return view.getUint32(0, true); };
const answer = (op, word) => bits(op === 'TRUNC' ? Math.trunc(value(word)) : value(word) > 0 ? 1 : value(word) < 0 ? -1 : 0);
const imm = (index, words) => `IMM[${index}] UINT32 {${words.join(',')}}`;
const repeated = (index, word) => imm(index, Array(4).fill(word));
const program = (extras, body) => ['FRAG', 'DCL IN[0], GENERIC[0], PERSPECTIVE', 'DCL OUT[0], COLOR',
  'DCL TEMP[0..2]', 'DCL CONST[0..45]', ...extras, ...body, 'END', ''].join('\n');
const words = [0, 0x80000000, 0x00800000, 0x80800000, 0x3f7fffff, 0xbf7fffff, 0x3f800000, 0xbf800000,
  0x3fc00000, 0xbfc00000, 0x4affffff, 0xcaffffff, 0x4b000001, 0xcb000001, 0x7f7fffff, 0xff7fffff];

export function getScalarOperationRegressions() {
  const cases = [];
  const add = (name, text, ok, extra = {}) => cases.push({name, stage: 'fragment', text, ok, ...extra});
  for (const op of ['TRUNC', 'SSG']) {
    for (const sourceWord of words) for (let plane = 0; plane < 32; plane++) {
      const expectedWord = answer(op, sourceWord), expectedBit = (expectedWord >>> plane) & 1;
      add(`${op}-known-result-${sourceWord}-bit-${plane}`, program([
        repeated(0, sourceWord), repeated(1, plane), repeated(2, 1)], [
        `${op} TEMP[0], IMM[0]`, 'USHR TEMP[1], TEMP[0], IMM[1]', 'AND TEMP[1], TEMP[1], IMM[2]',
        'MOV OUT[0], TEMP[1]']), expectedBit === 0, {sourceWord, expectedWord, plane, expectedBit, noFiniteBank: true});
    }
    for (let mask = 1; mask < 16; mask++) for (const swizzle of ['xyzw', 'wzyx', 'xxxx', 'zzyy']) {
      const lanes = [...'xyzw'].filter((_, lane) => (mask >>> lane) & 1).join('');
      const consumed = [...lanes].map(lane => 'xyzw'.indexOf(swizzle['xyzw'.indexOf(lane)]));
      const ok = consumed.every(lane => lane !== 0);
      add(`${op}-killed-lane-${lanes}-${swizzle}`, program([repeated(0, 0x3f800000)], [
        'MOV TEMP[0], IN[0]', 'UADD TEMP[0].x, CONST[0], CONST[1]',
        `${op} TEMP[1].${lanes}, TEMP[0].${swizzle}`, 'MOV OUT[0], IMM[0]']), ok, {consumed, noFiniteBank: true});
      add(`${op}-aliased-private-lane-${lanes}-${swizzle}`, program([
        imm(0, [1, 0x3fc00000, 0xbfc00000, 0x80000000]), repeated(1, 0)], [
        'MOV TEMP[0], IMM[0]', `${op} TEMP[0].${lanes}, TEMP[0].${swizzle}`, 'MOV OUT[0], IMM[1]']), ok,
      {consumed, noFiniteBank: true});
      add(`${op}-finite-bank-negated-${lanes}-${swizzle}`, program([repeated(0, 0)], [
        `${op} TEMP[0].${lanes}, -CONST[45].${swizzle}`, 'MOV OUT[0], IMM[0]',
        `MOV OUT[0].${lanes}, TEMP[0]`]), true, {finiteBank: true});
    }
    for (const raw of [1, 0x80000001, 0x007fffff, 0x807fffff, 0x7f800000, 0xff800000, 0x7fc12345, 0xffffffff])
      add(`${op}-raw-numeric-denial-${raw}`, program([repeated(0, raw), repeated(1, 0)], [
        `${op} TEMP[0], IMM[0]`, 'MOV OUT[0], IMM[1]']), false);
    for (const target of ['TEMP[0]', 'TEMP[1]']) add(`${op}-saved-version-${target}`, program([], [
      `${op} TEMP[0], IN[0]`, 'MOV TEMP[1], TEMP[0]', 'UADD TEMP[0], CONST[0], CONST[1]',
      `${op} OUT[0], ${target}`]), target === 'TEMP[1]', {noFiniteBank: true});
    add(`${op}-private-f2i-cannot-become-numeric`, program([], [
      'F2I TEMP[0], CONST[45]', `${op} OUT[0], TEMP[0]`]), false);
    add(`${op}-i2f-restores-typed-authority`, program([], [
      'F2I TEMP[0], CONST[45]', 'I2F TEMP[0], TEMP[0]', `${op} OUT[0], TEMP[0]`]), true,
    {components: [{register: 45, mask: 15}]});
    add(`${op}-two-numeric-predecessors`, program([], [
      'UIF IN[0].xxxx', `${op} TEMP[0], CONST[0]`, 'ELSE', `${op} TEMP[0], IN[0]`,
      'ENDIF', `${op} OUT[0], TEMP[0]`]), true, {finiteBank: true});
    add(`${op}-private-predecessor-denied`, program([], [
      'UIF IN[0].xxxx', `${op} TEMP[0], CONST[0]`, 'ELSE', 'UADD TEMP[0], CONST[0], CONST[1]',
      'ENDIF', `${op} OUT[0], TEMP[0]`]), false);
    for (const token of [op + '0', op + '_SAT', op + '_PRECISE', op.toLowerCase()])
      add(`${op}-bounded-token-${token}`, program([repeated(0, 0)], [`${token} OUT[0], IMM[0]`]), false);
    add(`${op}-absolute-modifier-remains-gated`, program([repeated(0, 0x3fc00000)], [`${op} OUT[0], |IMM[0]|`]), false);
  }
  add('ssg-proves-small-f2i-range', program([], ['SSG TEMP[0], CONST[45]', 'F2I TEMP[0], TEMP[0]',
    'I2F OUT[0], TEMP[0]']), true, {finiteBank: true, noConversionBank: true});
  add('ssg-result-integer-cannot-launder', program([], ['SSG TEMP[0], CONST[45]', 'F2I TEMP[0], TEMP[0]',
    'TRUNC OUT[0], TEMP[0]']), false);
  add('trunc-computed-range-remains-unproved', program([repeated(0, 0)], ['TRUNC TEMP[0], CONST[45]',
    'F2I TEMP[0], TEMP[0]', 'MOV OUT[0], IMM[0]']), false);
  for (const [first, second] of [['TRUNC', 'SSG'], ['SSG', 'TRUNC']])
    add(first + '-then-' + second + '-one-wrapper', program([], [
      `${first} TEMP[0], CONST[45]`, `${second} OUT[0], TEMP[0]`]), true,
    {finiteBank: true, operations: ['TRUNC', 'SSG']});
  return cases;
}

export function runScalarOperationRegressions(translate, cases = getScalarOperationRegressions()) {
  const rows = [];
  for (const c of cases) {
    const result = translate({stage: c.stage, text: c.text}); rows.push({...c, result});
    try {
      assert.equal(typeof result.ok, 'boolean', c.name + ' public boolean');
      assert.equal(result.ok, c.ok, c.name + ' mathematical bit/provenance prediction');
      if (!c.ok) for (const key of ['glsl', 'metadata', 'vertex', 'fragment']) assert.equal(Object.hasOwn(result, key), false, c.name + ' closed result');
      else {
        assert.ok(result.glsl.startsWith('#version 300 es'));
        assert.equal(result.metadata.profile, 'virgl-webgl2-raw-bits-v31');
        assert.equal(result.metadata.scalarWordContract.domain, 'existing-finite-numeric-authority');
        assert.equal(result.metadata.scalarWordContract.truncation, 'toward-zero-preserve-zero-sign');
        assert.equal(result.metadata.scalarWordContract.sign, 'negative-one-positive-one-canonical-zero');
        if (c.operations) assert.deepEqual(result.metadata.scalarWordContract.operations, c.operations, c.name + ' sorted complete operations');
        if (c.noFiniteBank) assert.equal(Object.hasOwn(result.metadata, 'constantDomains'), false, c.name + ' no numeric bank dependency');
        if (c.finiteBank) assert.equal(result.metadata.constantDomains[0].kind, 'constant-bank-finite-f32-v1', c.name + ' full dependency retained');
        if (c.components) assert.deepEqual(result.metadata.constantConversionDomains[0].components, c.components, c.name + ' original direct conversion obligation');
        if (c.noConversionBank) assert.equal(Object.hasOwn(result.metadata, 'constantConversionDomains'), false, c.name + ' independently bounded shadow range');
      }
    } catch (error) { error.counterexample = rows.at(-1); throw error; }
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), get = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const root = path.resolve(get('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
  const native = get('--native'), output = get('--output'), cases = getScalarOperationRegressions();
  const report = {schema: 'virgl-scalar-operation-critic-guards-v1', task: 'E6-T12g6f', status: 'running', cases: cases.length,
    testSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
  try {
    if (native) {
      report.nativeBinary = {path: path.resolve(native), sha256: createHash('sha256').update(fs.readFileSync(native)).digest('hex')};
      report.native = runScalarOperationRegressions(({stage, text}) => JSON.parse(execFileSync(path.resolve(native), [stage], {input: text, maxBuffer: 4e6})), cases);
    }
    if (!args.includes('--native-only')) {
      const {createVirglShaderBridge} = await import(pathToFileURL(path.join(root, 'renderer/virgl-shader/index.mjs')));
      const bridge = await createVirglShaderBridge(); report.wasm = runScalarOperationRegressions(request => bridge.translate(request), cases);
      if (report.native) for (let index = 0; index < cases.length; index++) assert.deepEqual(report.native[index].result, report.wasm[index].result, 'exact native/Wasm parity: ' + cases[index].name);
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = {message: error.message, counterexample: error.counterexample}; throw error; }
  finally { if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
  console.log(`${cases.length} independent scalar bit/lane/version/provenance guards passed.`);
}
