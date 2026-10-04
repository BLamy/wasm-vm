// Fresh critic guards. Predictions are generated independently of worker cases,
// compiler IR and emitted GLSL. Each case checks a consumed authority boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const hash=b=>createHash('sha256').update(b).digest('hex');
const imm=(i,words)=>`IMM[${i}] UINT32 {${words.join(',')}}`,repeat=(i,w)=>imm(i,Array(4).fill(w));
const normal=w=>(w&0x7fffffff)===0||((w>>>23)&255)>0&&((w>>>23)&255)<255;
const divide=(a,b)=>normal(a)&&normal(b)&&(b&0x7fffffff)>=0x00800000&&(b&0x7fffffff)<=0x7e800000&&
 ((b&0x7fffffff)===0x3f800000||(a&0x7fffffff)===0||((a>>>23)&255)-((b>>>23)&255)>=-124&&((a>>>23)&255)-((b>>>23)&255)<=125);
const wordOf=x=>new Uint32Array(new Float32Array([x]).buffer)[0];
const floatOf=w=>new Float32Array(new Uint32Array([w]).buffer)[0];
const produced=(op,w)=>op==='I2F'?wordOf(w|0):op==='TRUNC'?wordOf(Math.trunc(floatOf(w))):op==='SSG'?wordOf(Math.sign(floatOf(w))):Number.isFinite(floatOf(w))?wordOf(floatOf(w)-Math.floor(floatOf(w))):0x7fc00000;
const program=(decl,body)=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..3]','DCL CONST[0..45]',...decl,...body,'END',''].join('\n');
export function getSaturationRegressions(){
 const cases=[],add=(name,decl,body,ok,extra={})=>cases.push({name,stage:'fragment',text:program(decl,body),ok,...extra});
 const safe=[0,0x80000000,0x00800000,0x80800000,0x3e800000,0xbe800000,0x3f7fffff,0x3f800000,0xbf800000,0x3f800001,0x40000000,0x7e800000,0xfe800000,0x7f7fffff];
 const denied=[1,0x80000001,0x007fffff,0x807fffff,0x7f800000,0xff800000,0x7fc12345,0xffffffff];
 for(const a of [...safe,...denied])for(const negate of [false,true])for(const op of ['MOV_SAT','DIV_SAT']){
  const tail=op==='DIV_SAT'?', IMM[1]':'';
  add(`numeric-authority-${op}-${a}-${negate}`,[repeat(0,a),repeat(1,0x3f800000)],
   [`${op} TEMP[0], ${negate?'-':''}IMM[0]${tail}`,'MOV OUT[0], IMM[1]'],normal(a));
 }
 for(const a of safe)for(const b of [...safe,...denied,0x7e800001])for(const negate of [false,true])
  add(`bounded-division-${a}-${b}-${negate}`,[repeat(0,a),repeat(1,b)],
   [`DIV_SAT TEMP[0], IMM[0], ${negate?'-':''}IMM[1]`,'MOV OUT[0], IMM[0]'],divide(a,b));
 const numerator=[0x3f000000,0x7fc12345,0x40000000,0x80000001],denominator=[0x40000000,0,0x3f800000,0x7f800000];
 for(let mask=1;mask<16;mask++)for(const swizzle of ['xyzw','wzyx','xxxx','zxyw'])for(const op of ['MOV_SAT','DIV_SAT']){
  const suffix=[...'xyzw'].filter((_,i)=>mask&(1<<i)).join(''),indices=[...suffix].map(c=>'xyzw'.indexOf(swizzle['xyzw'.indexOf(c)]));
  add(`unused-special-lanes-${op}-${mask}-${swizzle}`,[imm(0,numerator),imm(1,denominator),repeat(2,0)],
   [`${op} TEMP[0].${suffix}, -IMM[0].${swizzle}${op==='DIV_SAT'?', IMM[1].'+swizzle:''}`,'MOV OUT[0], IMM[2]'],indices.every(i=>op==='MOV_SAT'?normal(numerator[i]):divide(numerator[i],denominator[i])),{consumed:indices});
  add(`killed-numerator-${op}-${mask}-${swizzle}`,[repeat(0,0),repeat(1,0x3f800000)],
   ['MOV TEMP[0], IN[0]','UADD TEMP[0].x, CONST[0], CONST[1]',`${op} TEMP[1].${suffix}, TEMP[0].${swizzle}${op==='DIV_SAT'?', IMM[1]':''}`,'MOV OUT[0], IMM[0]'],indices.every(i=>i!==0),{consumed:indices});
  if(op==='DIV_SAT')add(`killed-static-divisor-${mask}-${swizzle}`,[repeat(0,0),repeat(1,0x3f800000)],
   ['MOV TEMP[0], IMM[1]','UADD TEMP[0].x, CONST[0], CONST[1]',`DIV_SAT TEMP[1].${suffix}, IMM[0], TEMP[0].${swizzle}`,'MOV OUT[0], IMM[0]'],indices.every(i=>i!==0),{consumed:indices});
 }
 for(const target of ['TEMP[0]','TEMP[1]']){
  add(`saved-denominator-${target}`,[repeat(0,0x3f000000),repeat(1,0x40000000)],
   ['MOV TEMP[0], IMM[1]','MOV TEMP[1], TEMP[0]','MOV TEMP[0], IN[0]',`DIV_SAT OUT[0], IMM[0], ${target}`],target==='TEMP[1]');
  add(`saved-nonunit-numerator-${target}`,[repeat(0,0x3f000000),repeat(1,0x40000000)],
   ['MOV TEMP[0], IMM[0]','MOV TEMP[1], TEMP[0]','MOV TEMP[0], IN[0]',`DIV_SAT OUT[0], ${target}, IMM[1]`],target==='TEMP[1]');
 }
 for(const b of [0x3f800000,0xbf800000,0x40000000,0xc0000000]){
  add(`dynamic-numerator-${b}`,[repeat(0,b)],['DIV_SAT OUT[0], IN[0], IMM[0]'],(b&0x7fffffff)===0x3f800000);
  add(`join-divisor-version-${b}`,[repeat(0,0x3f000000),repeat(1,0x3f800000),repeat(2,b)],
   ['UIF CONST[43].xxxx','MOV TEMP[0], IMM[1]','ELSE','MOV TEMP[0], IMM[2]','ENDIF','DIV_SAT OUT[0], IMM[0], TEMP[0]'],b===0x3f800000);
 }
 for(const op of ['MOV_SAT','DIV_SAT']){
  const tail=op==='DIV_SAT'?', IMM[1]':'';
  add(`saved-numeric-version-${op}`,[repeat(0,0),repeat(1,0x3f800000)],
   [`${op} TEMP[0], IN[0]${tail}`,'MOV TEMP[1], TEMP[0]','UADD TEMP[0], CONST[0], CONST[1]','MOV OUT[0], TEMP[1]'],true);
  add(`bad-authority-join-${op}`,[repeat(0,0),repeat(1,0x3f800000)],
   ['UIF CONST[43].xxxx','MOV TEMP[0], IN[0]','ELSE','UADD TEMP[0], CONST[0], CONST[1]','ENDIF',`${op} OUT[0], TEMP[0]${tail}`],false);
  add(`no-invented-F2I-range-${op}`,[repeat(0,0),repeat(1,0x3f800000)],
   [`${op} TEMP[0], IMM[0]${tail}`,'F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'],false);
  for(const spelling of [`${op}_PRECISE`,`${op}0`,op.toLowerCase()])add(`spelling-${spelling}`,[repeat(0,0),repeat(1,0x3f800000)],[`${spelling} OUT[0], IMM[0]${tail}`],false);
 }
 // The defensive unsafe-known-numerator predicate has no hits under current
 // authority producers. Attack that invariant through distinct typed/private
 // producers and selection/join boundaries before using a nonunit denominator.
 for(const w of [...safe,...denied])for(const producer of ['I2F','TRUNC','SSG','FRC_PRECISE']){
  const after=produced(producer,w),wanted=(producer==='I2F'||producer==='FRC_PRECISE'||normal(w))&&divide(after,0x40000000);
  add(`defensive-premise-${producer}-${w}`,[repeat(0,w),repeat(1,0x40000000)],
   [`${producer} TEMP[0], IMM[0]`,'DIV_SAT OUT[0], TEMP[0], IMM[1]'],wanted);
 }
 // Novel attack: poison only the denominator lane that an aliased swizzle
 // newly consumes. The good old version remains live in a separate register.
 for(const swizzle of ['xyzw','wzyx','xxxx','zxyw'])for(let lane=0;lane<4;lane++){
  const c='xyzw'[lane],consumed='xyzw'.indexOf(swizzle[lane]);
  add(`novel-alias-denominator-poison-${swizzle}-${lane}`,[repeat(0,0x3f000000),repeat(1,0x3f800000)],
   ['MOV TEMP[0], IMM[1]','MOV TEMP[1], TEMP[0]','MOV TEMP[0].x, IN[0].xxxx',`DIV_SAT TEMP[0].${c}, IMM[0].${swizzle}, TEMP[0].${swizzle}`,'MOV OUT[0], IMM[0]'],consumed!==0,{consumed});
 }
 return cases;
}
export function runSaturationRegressions(translate,cases=getSaturationRegressions()){
 const rows=[];
 for(const c of cases){const result=translate({stage:c.stage,text:c.text});rows.push({...c,result});
  try{assert.equal(typeof result.ok,'boolean');assert.equal(result.ok,c.ok,c.name+' independent consumed-version/domain prediction');
   if(!c.ok)for(const key of ['glsl','metadata','vertex','fragment'])assert.equal(Object.hasOwn(result,key),false,c.name+' closed rejection');
   else{assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v34');assert.equal(result.metadata.saturationContract.equation,'post-operation-ternary-zero-one');assert.equal(result.metadata.saturationContract.authority,'existing-numeric-authority');}}
  catch(e){e.counterexample=rows.at(-1);throw e;}
 }return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined;
 const root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..')),native=get('--native'),output=get('--output'),cases=getSaturationRegressions();
 const report={schema:'virgl-saturation-critic-guards-v1',task:'E6-T12g6h',status:'running',cases:cases.length,testSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url)))};
 try{if(native){report.nativeBinary={path:path.resolve(native),sha256:hash(fs.readFileSync(native))};report.native=runSaturationRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})),cases);}
  if(!args.includes('--native-only')){const{createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));const bridge=await createVirglShaderBridge();report.wasm=runSaturationRegressions(r=>bridge.translate(r),cases);
   if(report.native)for(let i=0;i<cases.length;i++)assert.deepEqual(report.native[i].result,report.wasm[i].result,'native/Wasm parity '+cases[i].name);}
  report.status='passed';
 }catch(e){report.status='failed';report.failure={message:e.message,counterexample:e.counterexample};throw e;}
 finally{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(`${cases.length} independent saturation consumed-lane/version/domain guards passed.`);
}
