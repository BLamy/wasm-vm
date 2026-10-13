import {compilerCases as oldCases} from '../virgl-dimensional-shaders/cases.mjs';
import {comparisonText, comparisonFixtures, signatureCases, pairTexts, zeroSelectors} from './fixtures.mjs';
export function compilerCases() {
  const historical = oldCases(), cases = historical.map(c => ({...c, name: 'historical/' + c.name}));
  for (const c of historical.filter(c => c.kind >= 36)) {
    // These four previously unsupported target programs have matching original
    // FLOAT declarations and plain TEX; only the explicitly new facet admits them.
    const newShadow = /^unsupported-target\/(vertex|fragment)\/SHADOW(CUBE|2D_ARRAY)$/.test(c.name);
    cases.push({...c, name: 'selected-carried/' + c.name, kind: c.kind + 7, okay: newShadow || c.okay, code: newShadow ? null : c.code});
  }
  const add = (name, kind, a, b = '', selectors = zeroSelectors(), okay = true, code = okay ? null : 'unsupported-feature') => cases.push({name, kind, a, b, selectors, okay, code});
  cases.push(...signatureCases());
  for (const c of signatureCases()) for (const [vertex, fragment] of [[0,1],[7,8],[12,13],[15,16],[22,23],[29,30],[36,37]])
    add('historical-new-refusal/' + vertex + '/' + c.name, c.kind === 43 ? vertex : fragment, c.a, '', c.selectors, false);
  for (const f of comparisonFixtures()) add('hardware/' + f.name, 45, f.vertexText, f.fragmentText, f.selectors);
  const number = text => {
    const at = text.indexOf('0:'); return text.slice(0, at) + text.slice(at).trim().split('\n').map((s, i) => i + ': ' + s.replace(/^\d+: /, '')).join('\n') + '\n';
  };
  for (const stage of ['vertex','fragment']) for (const target of ['CUBE','2D_ARRAY']) {
    const kind = stage === 'vertex' ? 43 : 44, good = comparisonText(stage, {target}), slot = 'SAMP[0]';
    for (const explicit of [false,true]) for (const queryShadow of [false,true])
      add(['query-only',stage,target,explicit,queryShadow].join('/'), kind, comparisonText(stage,{target,explicit,opcode:'TXQ',instructionTarget:(queryShadow?'SHADOW':'')+target}));
    for (const declaration of ['2D','SHADOW2D','3D','CUBE','SHADOWCUBE','2D_ARRAY','SHADOW2D_ARRAY'])
      if (declaration.replace(/^SHADOW/,'') !== target) add('dimension-conflict/'+stage+'/'+target+'/'+declaration,kind,comparisonText(stage,{target,declaration}),'',zeroSelectors(),false);
    for (const instructionTarget of ['SHADOW3D','SHADOWCUBE_ARRAY','SHADOW1D','SHADOW1D_ARRAY','CUBE_ARRAY','2D_MSAA','2D_ARRAY_MSAA'])
      add('unsupported-target/'+stage+'/'+target+'/'+instructionTarget,kind,comparisonText(stage,{target,instructionTarget}),'',zeroSelectors(),false);
    for (const type of ['UNORM','FLOAT, SINT','UINT, FLOAT','FLOAT, FLOAT, FLOAT, FLOAT, FLOAT'])
      add('heterogeneous/'+stage+'/'+target+'/'+type,kind,comparisonText(stage,{target,type}),'',zeroSelectors(),false);
    for (const opcode of ['TXL2','TXB2']) {
      let text = comparisonText(stage,{target,opcode});
      if (opcode === 'TXL2') text = text.replace(', '+slot+',',', IN[2], '+slot+',');
      if (opcode === 'TXL2' || stage === 'vertex' || target !== 'CUBE') add('unsupported-overload/'+stage+'/'+target+'/'+opcode,kind,text,'',zeroSelectors(),false);
    }
    add('ordinary-bias2-refusal/'+stage+'/'+target,kind,comparisonText(stage,{target,ordinary:true,opcode:'TXB2'}),'',zeroSelectors(),false);
    const sampled = good.match(/^\d+: TEX[^\n]+$/m)[0].replace(/^\d+: /,'');
    for (const before of [false,true]) {
      const ordinary = sampled.replace('SHADOW'+target,target);
      const mixed = good.replace(/^\d+: TEX[^\n]+$/m,before?ordinary+'\n0: '+sampled:sampled+'\n0: '+ordinary);
      add('mixed-sampling/'+stage+'/'+target+'/'+before,kind,number(mixed),'',zeroSelectors(),false);
    }
    for (const [label,text] of [
      ['offset',good.replace(', '+slot+', SHADOW'+target,', '+slot+', SHADOW'+target+', IMM[1]')],
      ['missing-separator',good.replace(target+', FLOAT',target+' FLOAT')],
      ['bad-slot',good.replaceAll('[0]', '[16]')],
      ['duplicate-view',good.replace('DCL TEMP[0..1]','DCL SVIEW[0], SHADOW'+target+', FLOAT\nDCL TEMP[0..1]')],
      ['guest-key',good.replace(target+', FLOAT',target+', FLOAT, FORMAT')]
    ]) add('refusal/'+stage+'/'+target+'/'+label,kind,text,'',zeroSelectors(),false);
    add('view-range/'+stage+'/'+target,kind,good.replace('SVIEW[0]','SVIEW[0..15]'));
    add('homogeneous-fields/'+stage+'/'+target,kind,comparisonText(stage,{target,type:'FLOAT, FLOAT, FLOAT, FLOAT'}));
    const different = target === 'CUBE' ? '2D_ARRAY' : 'CUBE';
    const independent = good.replace('IMM[0]', 'DCL SAMP[7]\nDCL SVIEW[7], SHADOW'+different+', FLOAT\nDCL SAMP[15]\nDCL SVIEW[15], 3D, UINT\nIMM[0]')
      .replace(/(\d+): MOV OUT\[[01]\], TEMP\[0\]/,'0: TEX TEMP[1], IN[1], SAMP[7], SHADOW'+different+'\n0: XOR TEMP[0], TEMP[0], TEMP[1]\n0: TXQ TEMP[1], IMM[1], SAMP[15], 3D\n$&');
    add('independent-slots/'+stage+'/'+target,kind,number(independent));
  }
  const pair = pairTexts('fragment',{target:'CUBE',opcode:'TXB2',slot:7});
  add('null-vertex',46,pair.vertexText,pair.fragmentText,zeroSelectors(),false,'invalid-input');
  add('null-fragment',47,pair.vertexText,pair.fragmentText,zeroSelectors(),false,'invalid-input');
  add('null-stage',48,comparisonText('vertex'),'',zeroSelectors(),false,'invalid-input');
  add('bad-stage',49,comparisonText('vertex'),'',zeroSelectors(),false,'unsupported-stage');
  add('pair-interface-mismatch',45,pair.vertexText,pair.fragmentText.replaceAll('GENERIC[0]','GENERIC[7]'),zeroSelectors(),false,'incompatible-interface');
  for (const masks of [{signedColorMask:16},{unsignedColorMask:16},{signedColorMask:1,unsignedColorMask:1},{signedMask:2,unsignedMask:2}])
    add('incompatible-host-masks/'+JSON.stringify(masks),45,pair.vertexText,pair.fragmentText,{...zeroSelectors(),...masks},false,'invalid-input');
  return cases;
}
