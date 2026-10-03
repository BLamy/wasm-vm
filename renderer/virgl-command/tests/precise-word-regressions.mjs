// Fresh verifier regressions: literal admission expectations and hostile metadata.
// The physical exact-word oracle is the separate precise-words.mjs browser gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';
import {parseConstantDomain} from '../constant-domain.mjs';

export function runPreciseWordRegressions(bridge, parse = parseConstantDomain) {
  const observations = {admissions: [], contracts: [], ownership: [], getterCalls: 0};
  const program = (stage, body, bank = false) => [
    stage === 'vertex' ? 'VERT' : 'FRAG',
    stage === 'vertex' ? 'DCL IN[0]' : 'DCL IN[0], GENERIC[0], CONSTANT',
    stage === 'vertex' ? 'DCL OUT[0], POSITION' : 'DCL OUT[0], COLOR',
    'DCL TEMP[0..117]', ...(bank ? ['DCL CONST[0..1]'] : []), ...body, 'END', '',
  ].join('\n');
  const requireResult = (stage, name, body, accepted, profile = 17, bank = false) => {
    const text = program(stage, body, bank), result = bridge.translate({stage, text});
    assert.equal(result.ok, accepted, name + '/' + stage);
    if (accepted) {
      assert.equal(result.metadata.profile, 'virgl-webgl2-raw-bits-v' + profile);
      const operations = body.some(line => line.startsWith('MAX_PRECISE')) ? ['MAX', 'MOV'] : ['MOV'];
      assert.deepEqual(result.metadata.preciseWordContract,
        {kind: 'tgsi-precise-word-local-v1', stage, operations});
      assert.equal(result.glsl.split('/* TGSI PRECISE word-local */').length - 1,
        body.filter(line => line.includes('_PRECISE')).length);
      if (bank) assert.deepEqual(result.metadata.constantDomains,
        [{kind: 'constant-bank-finite-f32-v1', stage, slot: 0,
          name: (stage === 'vertex' ? 'vs' : 'fs') + 'const0', count: 2}]);
    } else {
      assert.deepEqual(Object.keys(result).sort(), ['error', 'ok']);
      assert.equal(typeof result.error.code, 'string');
      assert.ok(JSON.stringify(result).length < 512);
    }
    observations.admissions.push({stage, name, accepted});
  };
  for (const stage of ['vertex', 'fragment']) {
    requireResult(stage, 'retained-copy-flag', ['MOV_PRECISE OUT[0], IN[0]'], true);
    for (const [name, a, b, accepted] of [
      ['positive-zero-tie', 0, 0x80000000, true],
      ['negative-zero-tie', 0x80000000, 0, true],
      ['source0-nan-selects-normal', 0x7fc055aa, 0x3f800000, true],
      ['source1-nan-forbids-floating-output', 0x3f800000, 0x7fc055aa, false],
      ['source0-negative-infinity-selects-normal', 0xff800000, 0x3f800000, true],
      ['source1-infinity-forbids-floating-output', 0x3f800000, 0x7f800000, false],
      ['selected-positive-subnormal-forbids-output', 1, 0, false],
      ['negative-subnormal-selects-zero', 0x80000001, 0, true],
    ]) requireResult(stage, name, [
      `IMM[0] UINT32 {${a},${a},${a},${a}}`, `IMM[1] UINT32 {${b},${b},${b},${b}}`,
      'MAX_PRECISE TEMP[0], IMM[0], IMM[1]', 'MOV_PRECISE OUT[0], TEMP[0]',
    ], accepted);
    requireResult(stage, 'bank-selection-does-not-grant-output', [
      'MOV TEMP[0], CONST[0]', 'MAX_PRECISE TEMP[0], TEMP[0], IN[0]',
      'MOV_PRECISE OUT[0], TEMP[0]',
    ], false, 17, true);
    for (const destination of ['TEMP[0]', 'TEMP[1]']) requireResult(stage, 'numeric-bank-negated-alias-' + destination, [
      'IMM[0] FLT32 {0,0,0,0}', 'ADD TEMP[0], CONST[0], IMM[0]', 'MOV TEMP[1], IN[0]',
      `MAX_PRECISE ${destination}, -TEMP[0].wzyx, TEMP[1].yxwz`,
      `ADD TEMP[2], ${destination}, IMM[0]`, 'MOV_PRECISE OUT[0], TEMP[2]',
    ], true, 18, true);
    requireResult(stage, 'undefined-selected-away-source', [
      'IMM[0] FLT32 {1,1,1,1}', 'MOV TEMP[0], IMM[0]',
      'MAX_PRECISE TEMP[0], TEMP[0], TEMP[1]', 'MOV_PRECISE OUT[0], TEMP[0]',
    ], false);
    requireResult(stage, 'undefined-consumed-lane', [
      'IMM[0] FLT32 {0,0,0,0}', 'MOV TEMP[0].xy, IN[0].xyxy',
      'MAX_PRECISE TEMP[0].xy, -TEMP[0].zwxy, IMM[0]', 'MOV_PRECISE OUT[0], IN[0]',
    ], false);
    for (const [count, accepted] of [[178, true], [179, false]]) requireResult(stage, 'instruction-count-' + (count + 1), [
      ...Array(count).fill('MOV_PRECISE TEMP[0], IN[0]'), 'MOV_PRECISE OUT[0], TEMP[0]',
    ], accepted);
    for (const opcode of ['ADD_PRECISE', 'MUL_PRECISE', 'MAX_SAT_PRECISE', 'MOV_PRECISE_PRECISE'])
      requireResult(stage, 'gated-' + opcode, [opcode + ' TEMP[0], IN[0], IN[0]', 'MOV OUT[0], IN[0]'], false);
  }
  const fixture = JSON.parse(fs.readFileSync(new URL('../../virgl-shader/tests/precise-word-cases.json', import.meta.url)));
  for (const entry of fixture.cases.filter(item => item.name.startsWith('profile-'))) {
    const result = bridge.translate({stage: entry.stage, text: entry.text});
    assert.equal(result.ok, true, entry.name);
    const base = result.metadata, parsed = parse(base, entry.stage);
    assert.equal(parsed.ok, true); assert.deepEqual(parsed.precision, entry.expected.preciseWordContract);
    const mutations = [
      ['missing', metadata => { delete metadata.preciseWordContract; }],
      ['symbol-record-key', metadata => { metadata.preciseWordContract[Symbol('extra')] = 0; }],
      ['inherited-kind', metadata => {
        delete metadata.preciseWordContract.kind;
        Object.setPrototypeOf(metadata.preciseWordContract, {kind: 'tgsi-precise-word-local-v1'});
      }],
      ['inherited-operation', metadata => {
        const array = []; array.length = 1; Object.setPrototypeOf(array, {0: 'MOV'});
        metadata.preciseWordContract.operations = array;
      }],
      ['operation-getter', metadata => {
        Object.defineProperty(metadata.preciseWordContract.operations, '0', {enumerable: true,
          get() { observations.getterCalls++; throw new Error('must not execute caller getter'); }});
      }],
      ['revoked-record', metadata => {
        const proxy = Proxy.revocable({}, {}); proxy.revoke(); metadata.preciseWordContract = proxy.proxy;
      }],
      ['revoked-array', metadata => {
        const proxy = Proxy.revocable([], {}); proxy.revoke(); metadata.preciseWordContract.operations = proxy.proxy;
      }],
    ];
    for (const key of ['constantDomains', 'constantAccesses', 'constantConstraints', 'constantRadialDomains'])
      if (Object.hasOwn(base, key)) mutations.push(['missing-' + key, metadata => { delete metadata[key]; }]);
    for (const [name, mutate] of mutations) {
      const metadata = structuredClone(base); mutate(metadata);
      const actual = parse(metadata, entry.stage);
      assert.equal(actual.ok, false, entry.name + '/' + name); assert.equal(actual.error.code, 'shader-domain-error');
      observations.contracts.push({profile: entry.name, name});
    }
    const snapshot = JSON.stringify(parsed.precision);
    base.preciseWordContract.stage = 'changed'; base.preciseWordContract.operations.push('ADD');
    assert.equal(JSON.stringify(parsed.precision), snapshot);
    assert.equal(Object.isFrozen(parsed.precision), true); assert.equal(Object.isFrozen(parsed.precision.operations), true);
    observations.ownership.push(entry.name);
  }
  assert.equal(observations.getterCalls, 0);
  return {status: 'passed', ...observations};
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bridge = await createVirglShaderBridge({wasmBinary: fs.readFileSync(new URL('../../virgl-shader/build/wasm/virgl-shader.wasm', import.meta.url))});
  console.log(JSON.stringify(runPreciseWordRegressions(bridge)));
}
