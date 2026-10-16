import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// The oracle decodes IEEE binary32 mathematically; no compiler ordering key,
// result, metadata or emitted GLSL contributes to a predicted selected bit.
const view = new DataView(new ArrayBuffer(4));
const number = word => {view.setUint32(0, word, true); return view.getFloat32(0, true);};
const choose = (a, b) => number(a) < number(b) ? a : b;
const negate = (word, enabled) => enabled ? (word ^ 0x80000000) >>> 0 : word;
const imm = (index, words) => `IMM[${index}] UINT32 {${words.join(',')}}`;
const repeated = (index, word) => imm(index, Array(4).fill(word));
const program = (extras, body) => ['FRAG', 'DCL IN[0], GENERIC[0], PERSPECTIVE', 'DCL OUT[0], COLOR',
  'DCL TEMP[0..2]', 'DCL CONST[0..45]', ...extras, ...body, 'END', ''].join('\n');
const ordinarySafe = word => (word & 0x7fffffff) === 0 || ((word & 0x7f800000) !== 0 && (word & 0x7f800000) !== 0x7f800000);

export function getMinimumSelectionRegressions() {
  const cases = [];
  const add = (name, text, ok, extra = {}) => cases.push({name, stage: 'fragment', text, ok, ...extra});
  const pairs = [[0,0x80000000],[0x80000000,0],[0,0],[0x80000000,0x80000000],
    [1,0],[0,1],[0x80000001,0],[0,0x80000001],[0x007fffff,0x00800000],[0x80800000,0x807fffff],
    [0x3f800000,0x3f800000],[0x3f800001,0x3f800000],[0xbf800001,0xbf800000],
    [0x7f7fffff,0x7f800000],[0xff800000,0xff7fffff],[0x7f800000,0xff800000],
    [0x7fc12345,0x3f800000],[0x3f800000,0x7fc12345],[0x7f800001,0xffc54321],
    [0xff800001,0x7fc12345],[0x7fffffff,0xffffffff],[0xffffffff,0x7fffffff]];
  let state = 19088743;
  const next = () => {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0;};
  for (let i = 0; i < 10; i++) pairs.push([next(), next()]);
  for (const [a, b] of pairs) for (const modifier of ['', 'a', 'b', 'ab']) for (let plane = 0; plane < 32; plane++) {
    const expectedWord = choose(negate(a, modifier.includes('a')), negate(b, modifier.includes('b')));
    const expectedBit = (expectedWord >>> plane) & 1;
    add(`precise-selected-${a}-${b}-${modifier || 'none'}-bit-${plane}`, program([
      repeated(0,a), repeated(1,b), repeated(2,plane), repeated(3,1)], [
      `MIN_PRECISE TEMP[0], ${modifier.includes('a') ? '-' : ''}IMM[0], ${modifier.includes('b') ? '-' : ''}IMM[1]`,
      'USHR TEMP[1], TEMP[0], IMM[2]', 'AND TEMP[1], TEMP[1], IMM[3]', 'MOV OUT[0], TEMP[1]']),
    expectedBit === 0, {a,b,modifier,plane,expectedWord,expectedBit,noFiniteBank:true});
  }
  for (const op of ['MIN', 'MIN_PRECISE']) {
    for (let mask = 1; mask < 16; mask++) for (const swizzle of ['xyzw','wzyx','xxxx','zzyy']) {
      const lanes = [...'xyzw'].filter((_, lane) => (mask >>> lane) & 1).join('');
      const consumed = [...lanes].map(lane => 'xyzw'.indexOf(swizzle['xyzw'.indexOf(lane)]));
      for (const killedSource of [0,1]) {
        add(`${op}-killed-source-${killedSource}-${lanes}-${swizzle}`, program([repeated(0,0)], [
          'MOV TEMP[0], IN[0]', 'MOV TEMP[1], IN[0]', `UADD TEMP[${killedSource}].x, CONST[0], CONST[1]`,
          `${op} TEMP[2].${lanes}, TEMP[0].${swizzle}, TEMP[1].${swizzle}`, 'MOV OUT[0], IMM[0]']),
        op === 'MIN_PRECISE' || consumed.every(lane => lane !== 0), {consumed,noFiniteBank:true});
      }
      add(`${op}-aliased-selected-output-${lanes}-${swizzle}`, program([
        imm(0,[0x80000000,0x3f800000,0xbf800000,0x3fc00000]), imm(1,[0,0x40000000,0xbfc00000,0xbf000000])], [
        'MOV TEMP[0], IMM[0]', `${op} TEMP[0].${lanes}, TEMP[0].${swizzle}, IMM[1].wzyx`, 'MOV OUT[0], TEMP[0]']), true);
    }
    for (const [a,b] of pairs.slice(0,22)) {
      const answer = choose(a,b), ok = op === 'MIN' ? ordinarySafe(a) && ordinarySafe(b) : ordinarySafe(answer);
      add(`${op}-selected-raster-authority-${a}-${b}`, program([repeated(0,a),repeated(1,b)], [`${op} OUT[0], IMM[0], IMM[1]`]), ok);
    }
    for (const target of ['TEMP[0]','TEMP[1]']) add(`${op}-saved-numeric-version-${target}`, program([], [
      'MOV TEMP[0], IN[0]', 'MOV TEMP[1], TEMP[0]', 'UADD TEMP[0], CONST[0], CONST[1]',
      `${op} OUT[0], ${target}, IN[0]`]), target === 'TEMP[1]');
    add(`${op}-copied-bank-output-obligations`, program([], [`${op} OUT[0], CONST[0], CONST[45]`]), true,
      op === 'MIN' ? {finiteBank:true} : {finiteBank:true,rasterComponents:[{register:0,mask:15},{register:45,mask:15}]});
    add(`${op}-numeric-predecessors`, program([], ['UIF IN[0].xxxx', 'MOV TEMP[0], IN[0]', 'ELSE',
      'MOV TEMP[0], CONST[0]', 'ENDIF', `${op} OUT[0], TEMP[0], IN[0]`]), true, {finiteBank:true});
    add(`${op}-killed-predecessor-no-authority`, program([], ['UIF IN[0].xxxx', 'MOV TEMP[0], IN[0]', 'ELSE',
      'UADD TEMP[0], CONST[0], CONST[1]', 'ENDIF', `${op} OUT[0], TEMP[0], IN[0]`]), false);
    for (const token of [op+'0',op+'_SAT',op.toLowerCase()]) add(`${op}-unsupported-token-${token}`,
      program([repeated(0,0)],[`${token} OUT[0], IMM[0], IMM[0]`]), false);
    for (const source of ['|IMM[0]|','IMM[0].xy','CONST[46]']) add(`${op}-unsupported-source-${source}`,
      program([repeated(0,0)],[`${op} OUT[0], ${source}, IMM[0]`]), false);
  }
  for (const first of ['MIN','MIN_PRECISE']) add(first+'-adjacent-local-precision', program([repeated(0,0)], [
    `${first} TEMP[0], IMM[0], IMM[0]`, `${first === 'MIN' ? 'MIN_PRECISE' : 'MIN'} TEMP[1], IMM[0], IMM[0]`,
    'MAX_PRECISE TEMP[2], IMM[0], IMM[0]', 'FSEQ_PRECISE TEMP[2], IMM[0], IMM[0]',
    'FSNE_PRECISE TEMP[2], IMM[0], IMM[0]', 'MOV_PRECISE OUT[0], IMM[0]']), true,
  {operations:['MIN','MIN_PRECISE'],legacyPrecision:['FSEQ','FSNE','MAX','MOV']});
  return cases;
}

export function runMinimumSelectionRegressions(translate, cases = getMinimumSelectionRegressions()) {
  const rows = [];
  for (const c of cases) {
    const result = translate({stage:c.stage,text:c.text}); rows.push({...c,result});
    try {
      assert.equal(typeof result.ok, 'boolean', c.name+' public boolean');
      assert.equal(result.ok,c.ok,c.name+' independent bit/authority prediction');
      if (!c.ok) for (const key of ['glsl','metadata','vertex','fragment']) assert.equal(Object.hasOwn(result,key),false,c.name+' closed result');
      else {
        assert.ok(result.glsl.startsWith('#version 300 es'));
        assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v32');
        assert.equal(result.metadata.minimumWordContract.precise,'ordered-less-first-otherwise-second-original-word');
        assert.equal(result.metadata.minimumWordContract.ordinary,'existing-finite-numeric-authority');
        if (c.noFiniteBank) assert.equal(Object.hasOwn(result.metadata,'constantDomains'),false,c.name+' no numeric dependency');
        if (c.finiteBank) assert.equal(result.metadata.constantDomains[0].kind,'constant-bank-finite-f32-v1');
        if (c.rasterComponents) assert.deepEqual(result.metadata.constantRasterDomains[0].components,c.rasterComponents,c.name+' both selectable arms');
        if (c.operations) assert.deepEqual(result.metadata.minimumWordContract.operations,c.operations);
        if (c.legacyPrecision) assert.deepEqual(result.metadata.preciseWordContract.operations,c.legacyPrecision,c.name+' unchanged old precision inventory');
      }
    } catch (error) {error.counterexample=rows.at(-1);throw error;}
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..'));
  const native=get('--native'), output=get('--output'), cases=getMinimumSelectionRegressions();
  const report={schema:'virgl-minimum-selection-critic-guards-v1',task:'E6-T12g6g1',status:'running',cases:cases.length,
    testSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
  try {
    if (native) {
      report.nativeBinary={path:path.resolve(native),sha256:createHash('sha256').update(fs.readFileSync(native)).digest('hex')};
      report.native=runMinimumSelectionRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})),cases);
    }
    if (!args.includes('--native-only')) {
      const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));
      const bridge=await createVirglShaderBridge();report.wasm=runMinimumSelectionRegressions(request=>bridge.translate(request),cases);
      if (report.native) for (let index=0;index<cases.length;index++) assert.deepEqual(report.native[index].result,report.wasm[index].result,'exact native/Wasm parity '+cases[index].name);
    }
    report.status='passed';
  } catch (error) {report.status='failed';report.failure={message:error.message,counterexample:error.counterexample};throw error;}
  finally {if (output) fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  console.log(`${cases.length} independent minimum bit/lane/version/authority guards passed.`);
}
