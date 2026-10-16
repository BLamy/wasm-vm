import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Handwritten negative-space guard. Neither compiler IR nor worker witnesses
// supply these expectations. A lane is readable after a join only if both
// predecessors initialize it; the outer frames already own a safe output.
export function getCompilerBoundsJoinCases() {
  const cases = [];
  for (const stage of ['vertex', 'fragment']) {
    for (let depth = 1; depth <= 16; ++depth) {
      for (const lane of 'xyzw') {
        for (const missing of [null, 'true', 'false']) {
          const vertex = stage === 'vertex';
          const rest = [...'xyzw'].filter(c => c !== lane).join('');
          const lines = [vertex ? 'VERT' : 'FRAG',
            vertex ? 'DCL IN[0]' : 'DCL IN[0], GENERIC[0], PERSPECTIVE',
            vertex ? 'DCL OUT[0], POSITION' : 'DCL OUT[0], COLOR',
            'DCL TEMP[511]',
            ...Array.from({length:32}, (_, i) => `IMM[${i}] UINT32 {0,1,2147483648,0}`),
            'MOV OUT[0], IN[0]',
            `MOV TEMP[511].${rest}, IN[0]`,
            ...Array(depth).fill('UIF IMM[31].yyyy'),
            ...(missing === 'true' ? [] : [`MOV TEMP[511].${lane}, IN[0]`]),
            'ELSE',
            ...(missing === 'false' ? [] : [`MOV TEMP[511].${lane}, IN[0]`]),
            'ENDIF',
            'MOV OUT[0], TEMP[511]',
            ...Array(depth - 1).fill('ENDIF'),
            'END', ''];
          cases.push({name:`${stage}-depth${depth}-${lane}-${missing ?? 'both'}`,
            stage, text:lines.join('\n'), ok:missing === null, depth, lane, missing});
        }
      }
    }
  }
  const positive = cases[0];
  for (const spelling of ['0511','512','65535','4294967295','-1','+511','0x1ff'])
    cases.push({name:`canonical-${spelling}`,stage:'vertex',
      text:positive.text.replaceAll('TEMP[511]', `TEMP[${spelling}]`),ok:false});
  cases.push({name:'immediate32',stage:'vertex',text:positive.text.replaceAll('UIF IMM[31]', 'UIF IMM[32]'),ok:false});
  for (const [file, index] of [['IN',8],['OUT',8],['SAMP',8],['SVIEW',8],['CONST',46]])
    cases.push({name:`wrong-file-${file}${index}`,stage:'vertex',
      text:positive.text.replace('DCL TEMP[511]',`DCL TEMP[511]\nDCL ${file}[${index}]`),ok:false});
  cases.push({name:'depth17',stage:'vertex',
    text:positive.text.replace('UIF IMM[31].yyyy','UIF IMM[31].yyyy\n'+'UIF IMM[31].yyyy\n'.repeat(16))
      .replace('\nEND\n','\n'+'ENDIF\n'.repeat(16)+'END\n'),ok:false});
  const selected='MOV OUT[0], TEMP[511]';
  for (const width of [512,513]) cases.push({name:`line-bytes${width}`,stage:'vertex',
    text:positive.text.replace(selected,selected+' '.repeat(width-selected.length)),ok:width===512});
  for (const width of [49152,49153]) cases.push({name:`text-bytes${width}`,stage:'vertex',
    text:positive.text+'\n'.repeat(width-positive.text.length),ok:width===49152});
  return cases;
}

export function runCompilerBoundsJoinRegressions(translate, cases=getCompilerBoundsJoinCases()) {
  const records=[];
  for (const test of cases) {
    const result=translate({stage:test.stage,text:test.text});
    assert.equal(typeof result.ok,'boolean',test.name+' strict admission');
    records.push({...test,result});
    if (result.ok !== test.ok) {
      const error=new Error(`${test.name}: predicted ok=${test.ok}, observed ok=${result.ok}`);
      error.counterexample={test,result};
      throw error;
    }
    if (test.ok) {
      assert.match(result.glsl,/raw_temp\[512\]/,test.name+' physical array extent');
      assert.match(result.glsl,/raw_temp\[511\]/,test.name+' highest row use');
    } else {
      assert.equal(Object.hasOwn(result,'glsl'),false,test.name+' no partial source');
      assert.equal(Object.hasOwn(result,'vertex'),false,test.name+' no partial pair');
    }
  }
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const root=path.resolve(get('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..'));
  const output=args.includes('--output')?path.resolve(get('--output')):null;
  const binary=args.includes('--native')?path.resolve(get('--native')):null;
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const cases=getCompilerBoundsJoinCases(),report={schema:'virgl-compiler-bounds-join-guard-v1',status:'running',cases:cases.length};
  try {
    if (binary) {
      report.nativeBinary={path:binary,sha256:sha(fs.readFileSync(binary))};
      report.native=runCompilerBoundsJoinRegressions(request=>JSON.parse(execFileSync(binary,[request.stage],{input:request.text,maxBuffer:4e6})),cases);
    }
    if (!args.includes('--native-only')) {
      const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));
      const bridge=await createVirglShaderBridge();
      report.wasm=runCompilerBoundsJoinRegressions(request=>bridge.translate(request),cases);
      if (report.native) for(let i=0;i<cases.length;++i)assert.deepEqual(report.wasm[i].result,report.native[i].result,cases[i].name+' native/Wasm');
    }
    report.status='passed';
  } catch (error) {
    report.status='failed';report.failure={message:error.message,stack:error.stack,counterexample:error.counterexample};
    throw error;
  } finally {
    if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  }
  console.log(`${cases.length} independent high-register join and bank cases passed.`);
}
