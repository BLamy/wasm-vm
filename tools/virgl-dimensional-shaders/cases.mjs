import {compilerCases as oldCases} from '../virgl-shadow-shaders/cases.mjs';
import {dimensionalFixtures, dimensionalText, legal, targets, returns, zeroSelectors, pairTexts} from './fixtures.mjs';
export function compilerCases() {
  const historical = oldCases(), cases = historical.map(c => ({...c, name: 'historical/' + c.name}));
  for (const c of historical.filter(c => c.kind >= 29)) {
    // Eighteen literal cube programs were historical bad targets. Their original
    // calls still refuse; the new selected facet now admits these legal forms.
    const cube = c.name.endsWith('/bad-target') && /DCL SVIEW\[0\], CUBE, (SINT|UINT)/.test(c.a) && !/: TXF /.test(c.a);
    cases.push({...c, name: 'selected-carried/' + c.name, kind: c.kind + 7, okay: cube || c.okay, code: cube ? null : c.code});
  }
  const add = (name, kind, a, b = '', selectors = zeroSelectors(), okay = true, code = okay ? null : 'unsupported-feature') => cases.push({name, kind, a, b, selectors, okay, code});
  for (const f of dimensionalFixtures()) add('hardware/' + f.name, 38, f.vertexText, f.fragmentText, f.selectors);
  for (const stage of ['vertex', 'fragment']) for (const target of targets) for (const type of returns)
    for (const opcode of ['TEX', 'TXL', 'TXF', 'TXD', 'TXP', 'TXQ', 'TXB']) for (const slot of [0, 7, 15]) {
      const f = {target, type, opcode, slot};
      add([stage, target, type, opcode, slot].join('/'), stage === 'vertex' ? 36 : 37, dimensionalText(stage, f), '', zeroSelectors(), legal(stage, target, opcode));
      if (legal(stage, target, opcode) && opcode !== 'TXQ') for (const suffix of ['_SAT', '_PRECISE', '_SAT_PRECISE'])
        add([stage, target, type, opcode + suffix, slot].join('/'), stage === 'vertex' ? 36 : 37, dimensionalText(stage, {...f, opcode: opcode + suffix}));
    }
  for (const stage of ['vertex', 'fragment']) {
    const kind = stage === 'vertex' ? 36 : 37, good = dimensionalText(stage);
    for (const target of targets) for (const declaration of ['2D', ...targets]) if (target !== declaration)
      add('target-conflict/' + stage + '/' + target + '/' + declaration, kind, dimensionalText(stage, {target, declaration}), '', zeroSelectors(), false);
    for (const target of ['1D', '1D_ARRAY', 'CUBE_ARRAY', 'SHADOWCUBE', 'SHADOW2D_ARRAY', '2D_MSAA', 'BUFFER'])
      add('unsupported-target/' + stage + '/' + target, kind, dimensionalText(stage, {target}), '', zeroSelectors(), false);
    for (const type of ['UNORM', 'FLOAT, SINT', 'UINT, FLOAT', 'FLOAT, FLOAT, FLOAT, FLOAT, FLOAT'])
      add('heterogeneous/' + stage + '/' + type, kind, dimensionalText(stage, {type}), '', zeroSelectors(), false);
    for (const [label, text] of [['missing-separator', good.replace('3D, FLOAT', '3D FLOAT')], ['bad-slot', good.replaceAll('[0], 3D', '[16], 3D')],
      ['guest-key', good.replace('3D, FLOAT', '3D, FLOAT, FORMAT')], ['offset', good.replace('SAMP[0], 3D', 'SAMP[0], 3D, IMM[1]')],
      ['duplicate-view', good.replace('DCL TEMP[0..1]', 'DCL SVIEW[0], CUBE, FLOAT\nDCL TEMP[0..1]')]])
      add('refusal/' + stage + '/' + label, kind, text, '', zeroSelectors(), false);
    add('homogeneous-fields/' + stage, kind, dimensionalText(stage, {type: 'UINT, UINT, UINT, UINT'}));
    add('view-range/' + stage, kind, good.replace('SVIEW[0]', 'SVIEW[0..15]'));
    const number = text => {
      const at = text.indexOf('0:'); return text.slice(0, at) + text.slice(at).trim().split('\n').map((s, i) => i + ': ' + s.replace(/^\d+: /, '')).join('\n') + '\n';
    };
    add('same-slot-mixed-dimensions/' + stage, kind, number(good.replace(/(\d+): MOV OUT\[[01]\], TEMP\[0\]/, '0: TEX TEMP[1], IN[1], SAMP[0], CUBE\n$&')), '', zeroSelectors(), false);
    const multiple = good.replace('IMM[0]', 'DCL SAMP[7]\nDCL SVIEW[7], CUBE, SINT\nDCL SAMP[15]\nDCL SVIEW[15], 2D_ARRAY, UINT\nIMM[0]')
      .replace(/(\d+): MOV OUT\[[01]\], TEMP\[0\]/, '0: TEX TEMP[1], IN[1], SAMP[7], CUBE\n0: XOR TEMP[0], TEMP[0], TEMP[1]\n0: TXF TEMP[1], IMM[1], SAMP[15], 2D_ARRAY\n0: XOR TEMP[0], TEMP[0], TEMP[1]\n$&');
    add('independent-dimensions-and-returns/' + stage, kind, number(multiple));
  }
  const pair = pairTexts('fragment', {target: '3D'});
  add('null-vertex', 39, pair.vertexText, pair.fragmentText, zeroSelectors(), false, 'invalid-input');
  add('null-fragment', 40, pair.vertexText, pair.fragmentText, zeroSelectors(), false, 'invalid-input');
  add('null-stage', 41, dimensionalText('vertex'), '', zeroSelectors(), false, 'invalid-input');
  add('bad-stage', 42, dimensionalText('vertex'), '', zeroSelectors(), false, 'unsupported-stage');
  add('pair-interface-mismatch', 38, pair.vertexText, pair.fragmentText.replace('GENERIC[0]', 'GENERIC[7]'), zeroSelectors(), false, 'incompatible-interface');
  add('bad-color-mask', 38, pair.vertexText, pair.fragmentText, {...zeroSelectors(), signedColorMask: 16}, false, 'invalid-input');
  return cases;
}
