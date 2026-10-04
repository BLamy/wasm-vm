import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const view=new DataView(new ArrayBuffer(4));
const value=w=>{view.setUint32(0,w,true);return view.getFloat32(0,true);};
const bits=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true);};
const imm=(i,words)=>`IMM[${i}] UINT32 {${words.join(',')}}`;
const rep=(i,w)=>imm(i,Array(4).fill(w));
const legal=(op,w)=>{const x=value(w),e=(w>>>23)&255;return Number.isFinite(x)&&(e!==0||x===0)&&(op==='EX2'?x>=-125&&x<=126:x>0&&e!==0);};
const program=(extra,body)=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..4]','DCL CONST[0..45]',rep(0,bits(1)),...extra,...body,'END',''].join('\n');
export function getExponentLogarithmRegressions(){
 const cases=[],add=(name,text,ok,extra={})=>cases.push({name,stage:'fragment',text,ok,...extra});
 const words=[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7fc01234,
 ...[-126,-125,-124,-1,-.5,.5,1,2,125,126,127].flatMap(x=>{const w=bits(x);return [w-1,w,w+1];})];
 for(const op of ['EX2','LG2']){
  for(const w of words)for(const neg of [false,true]){
   const source=(w^(neg?0x80000000:0))>>>0;
   add(`${op}-domain-${w}-${neg}`,program([rep(1,w)],[`${op} TEMP[1], ${neg?'-':''}IMM[1]`,'MOV OUT[0], IMM[0]']),legal(op,source),{sourceWord:source});
  }
  for(let mask=1;mask<16;mask++)for(const sw of ['xyzw','wzyx','yyyy','zzzz','xwzy'])for(const neg of [false,true]){
   const src=[bits(2),bits(-1),1,0x7fc12345],lanes=[...'xyzw'].filter((_,i)=>mask&(1<<i)).join(''),postX=(src['xyzw'.indexOf(sw[0])]^(neg?0x80000000:0))>>>0;
   add(`${op}-scalar-mask-${mask}-${sw}-${neg}`,program([imm(1,src)],[`${op} TEMP[1].${lanes}, ${neg?'-':''}IMM[1].${sw}`,'MOV OUT[0], IMM[0]']),legal(op,postX),{sourceWord:postX});
   // Only source x is initialized. Unread y/z/w must neither help nor block it.
   add(`${op}-initialized-x-${mask}-${sw}-${neg}`,program([rep(1,bits(2))],[`MOV TEMP[0].${sw[0]}, IMM[1].xxxx`,`${op} TEMP[1].${lanes}, ${neg?'-':''}TEMP[0].${sw}`,'MOV OUT[0], IMM[0]']),legal(op,(bits(2)^(neg?0x80000000:0))>>>0));
  }
  // Every possible partially known word is enumerated independently. This
  // includes asymmetric +/-125.5 and a safe unknown-sign +/-124 domain.
  for(const base of [bits(1),bits(-1),bits(124),bits(125.5),bits(126),0,0x00800000,0x7f000000])
   for(const mask of [1,3,0x80000000,0x80000001,0x800003ff,0x00800001])for(const neg of [false,true]){
    const positions=Array.from({length:32},(_,i)=>i).filter(i=>(mask>>>i)&1),poss=[];
    for(let n=0;n<2**positions.length;n++){let w=base&~mask;positions.forEach((p,i)=>{if(n&(1<<i))w|=1<<p;});poss.push((w^(neg?0x80000000:0))>>>0);}
    const ok=poss.every(w=>legal(op,w));
    add(`${op}-partial-${base}-${mask}-${neg}`,program([rep(1,mask),rep(2,(base&~mask)>>>0)],[
     'AND TEMP[0], CONST[0], IMM[1]','OR TEMP[0], TEMP[0], IMM[2]',`${op} TEMP[1], ${neg?'-':''}TEMP[0]`,'MOV OUT[0], IMM[0]']),ok,{possibilityCount:poss.length,minimum:Math.min(...poss.map(value)),maximum:Math.max(...poss.map(value))});
   }
  for(const source of ['IN[0]','CONST[0]','TEMP[0]'])add(`${op}-opaque-${source}`,program([],['ADD TEMP[0], IN[0], IMM[0]',`${op} TEMP[1], ${source}`,'MOV OUT[0], IMM[0]']),false);
  for(const first of ['I2F','TRUNC','SSG','FRC_PRECISE','MOV_SAT'])add(`${op}-typed-${first}`,program([], [
   `${first} TEMP[0], ${first==='I2F'?'CONST[0]':'IN[0]'}`,`${op} TEMP[1], TEMP[0]`,'MOV OUT[0], IMM[0]']),first==='SSG'&&op==='EX2');
  for(const destination of ['TEMP[0]','TEMP[1]'])add(`${op}-saved-killed-${destination}`,program([],['MOV TEMP[0], IMM[0]','MOV TEMP[1], TEMP[0]',
   'UADD TEMP[0], CONST[0], CONST[1]',`${op} TEMP[2], ${destination}`,'MOV OUT[0], IMM[0]']),destination==='TEMP[1]');
  for(const overwrite of ['UADD TEMP[0], CONST[0], CONST[1]','MOV TEMP[0], IN[0]'])add(`${op}-join-version-kill-${overwrite}`,program([],['MOV TEMP[0], IMM[0]',
   'UIF CONST[43].xxxx',overwrite,'ELSE','MOV TEMP[0], IMM[0]','ENDIF',`${op} TEMP[2], TEMP[0]`,'MOV OUT[0], IMM[0]']),false);
  for(const pair of [[1,1.5],[125.5,-125.5],[1,-1],[1,2]]){
   // Join bit facts describe all encodings sharing common bits, beyond the
   // two actual endpoints. Enumerate those encodings before predicting.
   const a=bits(pair[0]),b=bits(pair[1]),mask=(a^b)>>>0,positions=Array.from({length:32},(_,i)=>i).filter(i=>(mask>>>i)&1);if(positions.length>14)continue;
   const possible=[];for(let n=0;n<2**positions.length;n++){let w=a&~mask;positions.forEach((p,i)=>{if(n&(1<<i))w|=1<<p;});possible.push(w>>>0);}
   add(`${op}-join-partial-${pair}`,program([rep(1,a),rep(2,b)],['UIF CONST[43].xxxx','MOV TEMP[0], IMM[1]','ELSE','MOV TEMP[0], IMM[2]','ENDIF',`${op} TEMP[2], TEMP[0]`,'MOV OUT[0], IMM[0]']),possible.every(w=>legal(op,w)),{possibilityCount:possible.length});
  }
  for(const consumer of ['F2I TEMP[2], TEMP[1]',`${op} TEMP[2], TEMP[1]`])add(`${op}-no-result-facts-${consumer}`,program([], [
   `${op} TEMP[1], IMM[0]`,consumer,'MOV OUT[0], IMM[0]']),false);
  for(const spelling of [op+'_PRECISE',op+'_SAT',op.toLowerCase(),'SIN','POW'])add(`${op}-unsupported-${spelling}`,program([], [
   `${spelling} TEMP[1], IMM[0]${spelling==='POW'?', IMM[0]':''}`,'MOV OUT[0], IMM[0]']),false);
 }
 return cases;
}
export function runExponentLogarithmRegressions(translate,cases=getExponentLogarithmRegressions()){
 const rows=[];
 for(const c of cases){const result=translate({stage:c.stage,text:c.text});rows.push({...c,result});
  try{assert.equal(result.ok,c.ok,c.name+' independently enumerated domain');
   if(!c.ok)for(const key of ['glsl','metadata','vertex','fragment'])assert.equal(Object.hasOwn(result,key),false,c.name+' closed rejection');
   else{assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v35');assert.equal(result.metadata.exponentContract.source,'post-swizzle-x-replicated-before-mask');
    assert.equal(result.metadata.exponentContract.result,'ordinary-highp-no-static-range-facts');assert.match(result.glsl,/float_rhs = vec4\(\/\* exponent:(EX2|LG2) \*\/ (exp2|log2)\(/);}
  }catch(error){error.counterexample=rows.at(-1);throw error;}
 }
 return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined,root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..')),native=get('--native'),output=get('--output'),cases=getExponentLogarithmRegressions();
 const report={schema:'virgl-exponent-logarithm-critic-guards-v1',task:'E6-T12g6i',status:'running',cases:cases.length,testSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
 try{if(native){report.nativeBinary={path:path.resolve(native),sha256:createHash('sha256').update(fs.readFileSync(native)).digest('hex')};report.native=runExponentLogarithmRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})),cases);}
  if(!args.includes('--native-only')){const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));const bridge=await createVirglShaderBridge();report.wasm=runExponentLogarithmRegressions(r=>bridge.translate(r),cases);
   if(report.native)for(let i=0;i<cases.length;i++)assert.deepEqual(report.native[i].result,report.wasm[i].result,'native/Wasm exact parity '+cases[i].name);}
  report.status='passed';
 }catch(error){report.status='failed';report.failure={message:error.message,counterexample:error.counterexample};throw error;}
 finally{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(cases.length+' independent exponent/logarithm domain/lane/version guards passed');
}
