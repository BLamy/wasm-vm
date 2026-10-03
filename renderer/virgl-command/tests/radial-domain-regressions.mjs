// Promoted by the fresh E6-T12f3 verifier. Run against the built, actual Wasm bridge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';
import {checkRadialBank} from '../constant-domain.mjs';

export function runRadialDomainRegressions(bridge, bankChecker = checkRadialBank) {
  const fixture = JSON.parse(fs.readFileSync(new URL('../../virgl-shader/tests/radial-domain-cases.json', import.meta.url)));
  const observations = {graphs: [], coefficients: [], extents: []};
  for (const stage of ['vertex', 'fragment']) {
    const plain = fixture.cases.find(c => c.name === 'plain-' + stage).text;
    const probes = [
      // This enclosing zero selector skips the entire certified graph at execution.
      // Its conditional definition cannot initialize the later outside consumer.
      ['dead-enclosure', plain.replace('MAX TEMP[0].x', 'UIF IMM[0].yyyy\nMAX TEMP[0].x')
        .replace('ADD TEMP[4]', 'ENDIF\nADD TEMP[4]'), false],
      ['negated-selector', plain.replace('UIF TEMP[1].xxxx', 'UIF -TEMP[1].xxxx'), false],
      ['missing-else-component', plain.replace('MOV TEMP[2], CONST[5]', 'MOV TEMP[2].xyz, CONST[5].xyzx'), false],
      ['current-producer-alias', plain.replace('FSLT TEMP[1].x', 'FSLT TEMP[0].x')
        .replace('UIF TEMP[1].xxxx', 'UIF TEMP[0].xxxx'), true],
    ];
    for (const [name, text, accepted] of probes) {
      const result = bridge.translate({stage, text});
      assert.equal(result.ok, accepted, name + '/' + stage);
      if (accepted) {
        assert.equal(result.metadata.profile, 'virgl-webgl2-raw-bits-v14');
        assert.equal(result.metadata.constantRadialDomains[0].minimumMagnitude, 0x3727c5ac);
      } else assert.equal(result.error.code, 'unsupported-feature');
      observations.graphs.push({name, stage, accepted});
    }
  }
  // Binary32 -> Number is exact; this numeric comparison is independent of the
  // consumer's magnitude-word comparison and of the compiler's predicate graph.
  const bytes = new ArrayBuffer(4), view = new DataView(bytes);
  const numeric = word => { view.setUint32(0, word, true); return view.getFloat32(0, true); };
  const threshold = numeric(0x3727c5ac);
  const coefficients = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff,
    0x3727c5ab, 0x3727c5ac, 0x3727c5ad, 0xb727c5ab, 0xb727c5ac, 0xb727c5ad,
    0x35800000, 0x7f800000, 0xff800000, 0x7fa00123, 0xffc00123, 0x7f7fffff, 0xff7fffff];
  for (const count of [6, 46]) for (const coefficient of coefficients) {
    const words = Array(count * 4).fill(0); words[16] = coefficient;
    if (count === 46) words[36] = 18;
    const expected = Number.isFinite(numeric(coefficient)) && Math.abs(numeric(coefficient)) >= threshold;
    const result = bankChecker(words, count, count === 46);
    assert.equal(result.ok, expected, 'numeric admission for ' + coefficient);
    if (expected) {
      assert.deepEqual(result.words, words); assert.notEqual(result.words, words);
      words[16] = 0;
      assert.equal(result.words[16], coefficient);
      assert.equal(Object.isFrozen(result.words), true);
    } else assert.equal(result.error.code, Number.isFinite(numeric(coefficient)) ? 'constant-radial-domain-error' : 'constant-domain-error');
    observations.coefficients.push({count, coefficient, accepted: expected});
  }
  for (const [count, counted] of [[4, false], [48, false], [5.5, false], [true, false], [6, true], [46, 0], [46, null]]) {
    const result = bankChecker(Array(184).fill(0), count, counted);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'constant-radial-domain-error');
    observations.extents.push({count, counted});
  }
  const words = Array(184).fill(0); words[16] = 0x3f800000; words[36] = 19;
  const combined = bankChecker(words, 46, true);
  assert.equal(combined.ok, false); assert.equal(combined.error.code, 'constant-constraint-error');
  words[36] = 0x80000000;
  assert.equal(bankChecker(words, 46, true).ok, true);
  assert.equal(bankChecker(words.slice(0, 24), 6).ok, true);
  return {status: 'passed', ...observations, combinedCountChecked: true};
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bridge = await createVirglShaderBridge({wasmBinary: fs.readFileSync(new URL('../../virgl-shader/build/wasm/virgl-shader.wasm', import.meta.url))});
  console.log(JSON.stringify(runRadialDomainRegressions(bridge)));
}
