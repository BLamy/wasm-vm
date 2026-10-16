import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Critic-owned negative-space guards. UINT32 is the existing domain authority;
// literal words and source versions below are independent of compiler output.
const safe = [0, 1048576000, 1056964608, 1065353216];
const hostile = [0x7f800001, 0xffc12345, 0x80000001, 0x007fffff];
const hex = value => '0x'+value.toString(16).padStart(8,'0');
const immediate = (index, values, kind) => `IMM[${index}] ${kind} {${values.map(kind==='FLT32'?hex:String).join(',')}}`;
const header = (kind, input=false) => ['FRAG', ...(input?['DCL IN[0], GENERIC[0], PERSPECTIVE']:[]),
  'DCL OUT[0], COLOR','DCL TEMP[0..1]', immediate(0,hostile,kind),
  immediate(1,safe,kind), immediate(2,[0,0,0,0],'UINT32')];
const program = (kind, lines, input=false) => [...header(kind,input),...lines,'END',''].join('\n');
const carrier = (kind, values=hostile, spelling=null) => [
  'VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',
  'DCL TEMP[0]',spelling===null?immediate(0,values,kind):`IMM[0] FLT32 {${spelling}}`,
  'IMM[1] UINT32 {8388607,1056964608,0,0}',
  'AND TEMP[0], IMM[0], IMM[1].xxxx','OR TEMP[0], TEMP[0], IMM[1].yyyy',
  'MOV OUT[0], IN[0]','MOV OUT[1], TEMP[0]','END',''].join('\n');

export function getHexLiteralRegressions() {
  const cases=[];
  const semantic=(name,lines,ok,input=false)=>cases.push({name,stage:'fragment',text:program('FLT32',lines,input),
    control:program('UINT32',lines,input),ok});
  const overwritten=['OR TEMP[0], IMM[0], IMM[2]', 'MOV TEMP[0].x, IMM[1].xxxx',
    'MOV TEMP[0].yz, IMM[1].yzyz','MOV TEMP[0].w, IMM[1].wwww','MOV OUT[0], TEMP[0]'];
  semantic('exceptional-dead-complete-overwrite',overwritten,true);
  semantic('exceptional-live-w-after-partial-overwrite',overwritten.filter(s=>!s.startsWith('MOV TEMP[0].w')),false);
  semantic('exceptional-old-version-escaped',['OR TEMP[0], IMM[0], IMM[2]','MOV TEMP[1], TEMP[0]',
    'MOV TEMP[0], IMM[1]','MOV OUT[0], TEMP[1]'],false);
  semantic('exceptional-new-version-safe',['OR TEMP[0], IMM[0], IMM[2]','MOV TEMP[1], TEMP[0]',
    'MOV TEMP[0], IMM[1]','MOV OUT[0], TEMP[0]'],true);
  semantic('missing-three-live-lanes',['OR TEMP[0].x, IMM[0].xxxx, IMM[2].xxxx','MOV OUT[0], TEMP[0]'],false);
  semantic('initialized-mask-only',['OR TEMP[0].x, IMM[0].xxxx, IMM[2].xxxx','MOV OUT[0], IMM[1]',
    'AND TEMP[0].x, TEMP[0].xxxx, IMM[2].xxxx','MOV OUT[0].x, TEMP[0].xxxx'],true);
  semantic('safe-source-alias-snapshot',['OR TEMP[0], IMM[0], IMM[2]',
    'AND TEMP[0], TEMP[0].wzyx, IMM[2]','OR TEMP[0].xy, TEMP[0].yxxy, IMM[1].yyyy',
    'MOV OUT[0], TEMP[0]'],true);
  semantic('safe-both-join-predecessors',['MOV OUT[0], IMM[1]','UIF IN[0].xxxx',
    'OR TEMP[0], IMM[0], IMM[2]','AND TEMP[0], TEMP[0], IMM[2]',
    'ELSE','MOV TEMP[0], IMM[1]','ENDIF','MOV OUT[0], TEMP[0]'],true,true);
  semantic('exceptional-one-join-predecessor',['MOV OUT[0], IMM[1]','UIF IN[0].xxxx',
    'OR TEMP[0], IMM[0], IMM[2]','ELSE','MOV TEMP[0], IMM[1]','ENDIF','MOV OUT[0], TEMP[0]'],false,true);
  semantic('signedness-isge-selector',['ISGE TEMP[0], IMM[0], IMM[2]',
    'UCMP OUT[0], TEMP[0], IMM[1], IMM[1].wzyx'],true);
  semantic('private-bits-do-not-own-numerical-use',['OR TEMP[0], IMM[0], IMM[2]',
    'MUL OUT[0], TEMP[0], IMM[1]'],false);
  for (let lane=0;lane<4;++lane) {
    const words=[0,0x80000000,0x3f800000,0x3f000000];words[lane]=[0x7f800001,0xffc12345,0x80000001,0x007fffff][lane];
    cases.push({name:`finite-carrier-exceptional-lane${lane}`,stage:'vertex',ok:true,
      text:carrier('FLT32',words),control:carrier('UINT32',words)});
  }
  cases.push({name:'mixed-decimal-hex-signed-zero',stage:'vertex',ok:true,
    text:carrier('FLT32',[0,0x80000000,0x3f800000,0x3f000000],'0x00000000,-0.0,0x3F800000,5e-1'),
    control:carrier('UINT32',[0,0x80000000,0x3f800000,0x3f000000])});
  for (const spelling of ['0x3f800000\u00a0','0x3f800000\u200b','0x３f800000','0x3f８00000',
    '0x3f800000\0','0x3f800000\v','0x3f800000\f','0x3f800000\n',
    '0x3f800000;','0x3f800000/*x*/','0x3f800000e0','0x3f800000E0',
    '0x3f800000,',' 0X3f800000','+0x00000000','-0x80000000','0x0000_0000']) {
    cases.push({name:'delimiter-'+JSON.stringify(spelling),stage:'vertex',ok:false,
      text:carrier('FLT32',safe,spelling+',0x3e800000,0x3f000000,0x3f800000')});
  }
  for (let n=0;n<=8;++n) cases.push({name:`end-of-buffer-${n}`,stage:'vertex',ok:false,
    text:'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nIMM[0] FLT32 {0x'+'a'.repeat(n)});
  for (const value of ['-1','+0','00','32','4294967295']) cases.push({name:'immediate-index-'+value,
    stage:'vertex',ok:false,text:carrier('FLT32').replace('IMM[0] FLT32',`IMM[${value}] FLT32`)});
  for (const [byteCount,ok] of [[512,true],[513,false]]) {
    const text=carrier('FLT32',safe),line=text.split('\n').find(s=>s.startsWith('IMM[0]'));
    cases.push({name:'literal-line-limit-'+byteCount,stage:'vertex',ok,
      text:text.replace(line,line+' '.repeat(byteCount-line.length)),
      control:carrier('UINT32',safe).replace(immediate(0,safe,'UINT32'),immediate(0,safe,'UINT32')+' '.repeat(byteCount-immediate(0,safe,'UINT32').length))});
  }
  return cases;
}

export function runHexLiteralRegressions(translate,cases=getHexLiteralRegressions()) {
  const records=[];
  for (const test of cases) {
    const result=translate({stage:test.stage,text:test.text});
    records.push({...test,result});
    try {
      assert.equal(typeof result.ok,'boolean',test.name+' strict admission');
      assert.equal(result.ok,test.ok,test.name+' predetermined domain/grammar');
      if (test.control) {
        const control=translate({stage:test.stage,text:test.control});records.at(-1).controlResult=control;
        assert.deepEqual(result,control,test.name+' unchanged UINT32 authority/source/metadata');
      }
      if (test.ok) {
        assert.ok(result.glsl.includes('#version 300 es'),test.name+' complete shader');
      } else {
        for (const key of ['glsl','metadata','vertex','fragment'])
          assert.equal(Object.hasOwn(result,key),false,test.name+' closed rejection '+key);
      }
    } catch (error) {
      error.counterexample=records.at(-1);throw error;
    }
  }
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..'));
  const native=get('--native'),output=get('--output');
  const report={schema:'virgl-hex-literal-critic-guards-v1',status:'running',cases:getHexLiteralRegressions().length};
  try {
    if (native) {
      report.nativeBinary={path:path.resolve(native),sha256:createHash('sha256').update(fs.readFileSync(native)).digest('hex')};
      report.native=runHexLiteralRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})));
    }
    if (!args.includes('--native-only')) {
      const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));
      const bridge=await createVirglShaderBridge();
      report.wasm=runHexLiteralRegressions(request=>bridge.translate(request));
      if(report.native)for(let i=0;i<report.native.length;++i) {
        // JS input validation uses a shorter invalid-input explanation than C.
        if(report.native[i].result.error?.code==='invalid-input')
          assert.equal(report.wasm[i].result.error?.code,'invalid-input');
        else assert.deepEqual(report.native[i].result,report.wasm[i].result);
      }
    }
    report.status='passed';
  } catch(error) {
    report.status='failed';report.failure={message:error.message,counterexample:error.counterexample};throw error;
  } finally {
    if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  }
  console.log(`${report.cases} independent hexadecimal grammar/domain/version guards passed.`);
}
