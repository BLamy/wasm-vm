// Fresh critic guards: source rational equations, raw bit admission, predecessor
// versions and authority. No worker fixture/helper is imported as an oracle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const hash=b=>createHash('sha256').update(b).digest('hex');
const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`,repeat=(i,w)=>imm(i,Array(4).fill(w));
const program=(decl,body)=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..2]','DCL CONST[0..45]',...decl,...body,'END',''].join('\n');
const safe=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
const bitLength=n=>n.toString(2).length;
const rounded=(n,d)=>{const q=n/d,r=n%d;return q+BigInt(2n*r>d||(2n*r===d&&(q&1n)!==0n));};
export function preciseFractionReference(w){
 const exp=(w>>>23)&255;if(exp===255)return 0x7fc00000;
 const significand=BigInt((w&0x7fffff)|(exp?0x800000:0)),shift=exp?exp-150:-149;
 let n=shift>=0?significand<<BigInt(shift):significand,d=shift>=0?1n:1n<<BigInt(-shift);
 if(w&0x80000000)n=-n;n=((n%d)+d)%d;if(n===0n)return 0;
 let e=bitLength(n)-bitLength(d);if(e>=0?n<(d<<BigInt(e)):(n<<BigInt(-e))<d)e--;
 if(e< -126)return Number(rounded(n<<149n,d));
 let q=rounded(n<<BigInt(23-e),d);if(q===1n<<24n){q>>=1n;e++;}
 return ((e+127)*0x800000+Number(q-0x800000n))>>>0;
}
export function getPreciseFractionRegressions(){
 const cases=[],add=(name,text,ok,extra={})=>cases.push({name,stage:'fragment',text,ok,...extra});
 const words=[0,0x80000000,1,0x80000001,0x7fffff,0x807fffff,0x800000,0x80800000,
  0xb3000000,0xb3000001,0xb2ffffff,0xb3800000,0xb3c00000,0xb3c00001,0xbf7fffff,0xbf800001,0x3f800001,0xbf000000,0xbeffffff,
  0x4affffff,0xcaffffff,0x4b000000,0xcb000000,0x7f800000,0xff800000,0x7fc12345,0xff800001,0x7fffffff,0xffffffff];
 let state=324508637;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<35;i++)words.push(next());
 const anchors=new Map([[0,0],[0x80000000,0],[1,1],[0x80000001,0x3f800000],[0xb3000000,0x3f800000],
  [0xb3000001,0x3f7fffff],[0xbf7fffff,0x33800000],[0xbf800001,0x3f7ffffe],[0x3f800001,0x34000000],[0x7f800000,0x7fc00000]]);
 for(const [w,expected]of anchors)assert.equal(preciseFractionReference(w),expected,'literal mathematical anchor');
 for(const w of words)for(const negate of [false,true]){
  const source=(w^(negate?0x80000000:0))>>>0,expected=preciseFractionReference(source);
  for(let plane=0;plane<32;plane++){
   const bit=(expected>>>plane)&1;
   add(`fraction-${w}-${negate}-bit-${plane}`,program([repeat(0,w),repeat(1,plane),repeat(2,1)],
    [`FRC_PRECISE TEMP[0], ${negate?'-':''}IMM[0]`,'USHR TEMP[1], TEMP[0], IMM[1]','AND TEMP[1], TEMP[1], IMM[2]','MOV OUT[0], TEMP[1]']),bit===0,{source,expected,plane,expectedBit:bit,noFiniteBank:true});
  }
  add(`fraction-known-output-${w}-${negate}`,program([repeat(0,w)],[`FRC_PRECISE OUT[0], ${negate?'-':''}IMM[0]`]),safe(expected),{source,expected,noFiniteBank:true});
 }
 for(let mask=1;mask<16;mask++)for(const swizzle of ['xyzw','wzyx','xxxx','zxyw','yyzz']){
  const suffix=[...'xyzw'].filter((_,lane)=>mask&(1<<lane)).join(''),consumed=[...suffix].map(c=>'xyzw'.indexOf(swizzle['xyzw'.indexOf(c)]));
  add(`fraction-killed-output-${mask}-${swizzle}`,program([repeat(0,0)],['MOV TEMP[0], IN[0]','UADD TEMP[0].x, CONST[0], CONST[1]',
   `FRC_PRECISE TEMP[1].${suffix}, TEMP[0].${swizzle}`,`MOV OUT[0], IMM[0]`,`MOV OUT[0].${suffix}, TEMP[1]`]),consumed.every(lane=>lane!==0),{consumed,noFiniteBank:true});
  add(`fraction-killed-unused-${mask}-${swizzle}`,program([repeat(0,0)],['MOV TEMP[0], IN[0]','UADD TEMP[0].x, CONST[0], CONST[1]',
   `FRC_PRECISE TEMP[1].${suffix}, TEMP[0].${swizzle}`,'MOV OUT[0], IMM[0]']),true,{noFiniteBank:true});
  add(`fraction-alias-${mask}-${swizzle}`,program([imm(0,[0x3f800001,0xbf7fffff,0x80000000,0xbf800001])],['MOV TEMP[0], IMM[0]',
   `FRC_PRECISE TEMP[0].${suffix}, -TEMP[0].${swizzle}`,'MOV OUT[0], TEMP[0]']),true,{noFiniteBank:true});
 }
 for(const target of ['TEMP[0]','TEMP[1]'])add(`fraction-saved-version-${target}`,program([],['FRC_PRECISE TEMP[0], IN[0]','MOV TEMP[1], TEMP[0]',
  'UADD TEMP[0], CONST[0], CONST[1]',`MOV OUT[0], ${target}`]),target==='TEMP[1]',{noFiniteBank:true});
 add('fraction-unknown-output',program([],['UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE OUT[0], TEMP[0]']),false);
 add('fraction-unknown-numeric-reader',program([repeat(0,0)],['UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE TEMP[0], TEMP[0]','ADD OUT[0], TEMP[0], IMM[0]']),false);
 add('fraction-no-new-unknown-F2I-range',program([],['FRC_PRECISE TEMP[0], CONST[0]','F2I TEMP[0], TEMP[0]','I2F OUT[0], TEMP[0]']),false);
 add('fraction-no-new-input-F2I-range',program([],['FRC_PRECISE TEMP[0], IN[0]','F2I TEMP[0], TEMP[0]','I2F OUT[0], TEMP[0]']),false);
 add('fraction-unknown-private-carrier',program([repeat(0,0x3f000000),repeat(1,0x7fffff)],['UADD TEMP[0], CONST[0], CONST[1]',
  'FRC_PRECISE TEMP[0], TEMP[0]','AND TEMP[0], TEMP[0], IMM[1]','OR OUT[0], TEMP[0], IMM[0]']),true,{noFiniteBank:true});
 add('fraction-safe-replacement',program([repeat(0,0xbf000000)],['UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE TEMP[0], IMM[0]','MOV OUT[0], TEMP[0]']),true,{noFiniteBank:true});
 add('fraction-valid-join',program([],['UIF IN[0].xxxx','FRC_PRECISE TEMP[0], IN[0]','ELSE','FRC_PRECISE TEMP[0], CONST[45]','ENDIF','MOV OUT[0], TEMP[0]']),true,{finiteBank:true});
 add('fraction-killed-join',program([],['UIF IN[0].xxxx','FRC_PRECISE TEMP[0], IN[0]','ELSE','UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE TEMP[0], TEMP[0]','ENDIF','MOV OUT[0], TEMP[0]']),false);
 add('fraction-bank-output',program([],['FRC_PRECISE OUT[0], CONST[45]']),true,{finiteBank:true});
 add('fraction-copied-prefix-raster',program([],['FRC_PRECISE OUT[0].x, CONST[0].wwww','MOV OUT[0].yzw, CONST[45]']),true,{finiteBank:true,rasterComponents:[{register:45,mask:14}]});
 for(const token of ['FRC_PRECISE_SAT','FRC_PRECISE0','frc_precise'])add('fraction-token-'+token,program([repeat(0,0)],[`${token} OUT[0], IMM[0]`]),false);
 for(const source of ['|IMM[0]|','IMM[0].xy','CONST[46]','TEMP[3]'])add('fraction-source-'+source,program([repeat(0,0)],[`FRC_PRECISE OUT[0], ${source}`]),false);
 add('fraction-adjacent-precision-inventory',program([repeat(0,0)],['FRC TEMP[0], IMM[0]','FRC_PRECISE TEMP[1], -TEMP[0]',
  'ADD_PRECISE TEMP[1], TEMP[1], IMM[0]','MUL_PRECISE TEMP[1], TEMP[1], IMM[0]','MIN_PRECISE TEMP[2], TEMP[1], IMM[0]',
  'MAX_PRECISE TEMP[2], TEMP[2], IMM[0]','FSEQ_PRECISE TEMP[2], TEMP[2], IMM[0]','MOV_PRECISE OUT[0], IMM[0]']),true,{legacyPrecision:['FSEQ','MAX','MOV']});
 return cases;
}
export function runPreciseFractionRegressions(translate,cases=getPreciseFractionRegressions()){
 const rows=[];
 for(const c of cases){const result=translate({stage:c.stage,text:c.text});rows.push({...c,result});
  try{assert.equal(typeof result.ok,'boolean');assert.equal(result.ok,c.ok,c.name+' independent equation/authority');
   if(!c.ok)for(const key of ['glsl','metadata','vertex','fragment'])assert.equal(Object.hasOwn(result,key),false,c.name+' closed rejection');
   else{assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v33');assert.deepEqual(result.metadata.fractionWordContract.operations,['FRC_PRECISE']);
    assert.equal(result.metadata.fractionWordContract.equation,'x-minus-floor');assert.equal(result.metadata.fractionWordContract.authority,'existing-numeric-or-static-word-authority');
    if(c.noFiniteBank)assert.equal(Object.hasOwn(result.metadata,'constantDomains'),false,c.name+' unknown private reads have no numeric dependence');
    if(c.finiteBank)assert.equal(result.metadata.constantDomains[0].kind,'constant-bank-finite-f32-v1');
    if(c.rasterComponents)assert.deepEqual(result.metadata.constantRasterDomains[0].components,c.rasterComponents);
    if(c.legacyPrecision)assert.deepEqual(result.metadata.preciseWordContract.operations,c.legacyPrecision);}
  }catch(e){e.counterexample=rows.at(-1);throw e;}
 }
 return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined;
 const root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..')),native=get('--native'),output=get('--output'),cases=getPreciseFractionRegressions();
 const report={schema:'virgl-precise-fraction-critic-guards-v1',task:'E6-T12g6g2',status:'running',seed:324508637,cases:cases.length,testSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url)))};
 try{if(native){report.nativeBinary={path:path.resolve(native),sha256:hash(fs.readFileSync(native))};report.native=runPreciseFractionRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})),cases);}
  if(!args.includes('--native-only')){const{createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));const bridge=await createVirglShaderBridge();report.wasm=runPreciseFractionRegressions(r=>bridge.translate(r),cases);
   if(report.native)for(let i=0;i<cases.length;i++)assert.deepEqual(report.native[i].result,report.wasm[i].result,'native/Wasm parity '+cases[i].name);}
  report.status='passed';
 }catch(e){report.status='failed';report.failure={message:e.message,counterexample:e.counterexample};throw e;}
 finally{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(`${cases.length} independent precise-fraction bit/lane/version/authority guards passed.`);
}
