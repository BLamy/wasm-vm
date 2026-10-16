#!/usr/bin/env node
// Shared production decoder, original dword layout, independent integer bounds.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {decodeProductionSubmission} from '../../renderer/virgl-command/decoder.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const parameters={output:null,cases:100000,seed:0};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--cases','--seed'].includes(process.argv[i])&&process.argv[i+1]);parameters[process.argv[i].slice(2)]=process.argv[i+1];}
parameters.cases=Number(parameters.cases);parameters.seed=Number(parameters.seed);assert.ok(Number.isSafeInteger(parameters.cases)&&parameters.cases>0&&parameters.cases<=100000);assert.ok(Number.isInteger(parameters.seed));
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v>>>0,true);
const get=(b,at)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(at,true);
const packet=(op,obj,words)=>{const b=new Uint8Array((words.length+1)*4);put(b,0,(words.length<<16)|(obj<<8)|op);words.forEach((v,i)=>put(b,(i+1)*4,v));return b;};
function rng(seed){let state=seed>>>0;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};}
const boundary=[0,1,2,3,7,15,16,31,63,127,255,256,512,1023,16384,0x7fffffff,0x80000000,0xfffffffe,0xffffffff];
const pick=r=>boundary[r()%boundary.length];
const deepFrozen=v=>!v||typeof v!=='object'||Object.isFrozen(v)&&Object.values(v).every(deepFrozen);
const sourceFiles=['renderer/virgl-command/decoder.mjs','tools/virgl-production/recovery-decoder.mjs'];
const report={schema:'production-recovery-decoder-v1',status:'running',combinedDecoderCases:parameters.cases*4,seeds:[],families:[],sources:[],startedAt:new Date().toISOString(),node:process.version};
for(const p of sourceFiles){const b=await fs.readFile(path.join(repo,p));report.sources.push({path:p,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
let active;
try{
 for(const [family,base]of [['packet-framing',0x6e125a7d],['transfer-arithmetic',0x394b1e85],['object-fields',0x8d37f92b],['draw-fields',0xc649ae71]]){
  const seed=(base^parameters.seed)>>>0,r=rng(seed),digest=createHash('sha256'),started=performance.now();let accepted=0,rejected=0,oracleChecks=0;
  report.seeds.push({family,seed:seed.toString(16).padStart(8,'0')});
  for(let i=0;i<parameters.cases;i++){
   if(i%1024===0)assert.ok(performance.now()-started<60000,family+' 60-second budget at '+i);
   let input,expected=null;
   if(family==='packet-framing'){
    const n=r()%97;input=new Uint8Array(n);for(let j=0;j<n;j++)input[j]=r()&255;
    const choice=r()%6;
    if(choice===0){input=packet(24,0,[0xffffffff]);input[0]=255;expected=false;}
    else if(choice===1){input=packet(24,0,[0xffffffff]);put(input,0,(0xffff<<16)|24);expected=false;}
    else if(choice===2){input=packet(24,0,[0xffffffff]);expected=true;}
    else if(choice===3){input=packet(28,0,[r()]);expected=true;}
    else if(n%4!==0)expected=false;
   }else if(family==='transfer-arithmetic'){
    const x=pick(r),y=pick(r),z=pick(r),w=pick(r),h=pick(r),d=pick(r),stride=pick(r),layer=pick(r),offset=pick(r),level=pick(r),id=r()%5?1:0,direction=r()%4;
    input=packet(43,0,[id,level,r(),stride,layer,x,y,z,w,h,d,offset,direction]);
    // Signed coordinates and u32 backing offsets are predicted without JS Number products.
    const span=BigInt(stride)*BigInt(h>0?h-1:0)+BigInt(layer)*BigInt(d>0?d-1:0);
    expected=id>0&&level<=14&&w>0&&w<=0x7fffffff&&x<=0x7fffffff-w&&h>0&&h<=0x7fffffff&&y<=0x7fffffff-h&&d>0&&d<=0x7fffffff&&z<=0x7fffffff-d&&span<=0xffffffffn&&(direction===1||direction===2)&&BigInt(offset)+span<=0xffffffffn;
   }else if(family==='object-fields'){
    const kind=r()%8;
    if(kind===0)input=packet(1,10,[r()%7?1:0,pick(r),pick(r),pick(r)]);
    else if(kind===1)input=packet(25,0,[r(),...Array.from({length:r()%7},()=>r())]);
    else if(kind===2)input=packet(1,6,[r()%7?1:0,r()%7?3:0,(pick(r)&0xffffff)|((r()%9)<<24),r(),r(),r()]);
    else if(kind===3)input=packet(27,0,[pick(r),pick(r),pick(r),pick(r),r()%3?1:0]);
    else if(kind===4)input=packet(11,0,[r()%3?1:0,pick(r),pick(r)]);
    else if(kind===5)input=packet(1,8,[r()%7?1:0,r()%7?3:0,pick(r),pick(r),r()]);
    else if(kind===6)input=packet(1,2,[r()%7?1:0,r(),r(),r(),r(),r(),r(),r(),r()]);
    else input=packet(1,7,[r()%7?1:0,r(),r(),r(),r()]);
    if(r()%13===0){put(input,0,get(input,0)^(1<<16));expected=false;}
   }else{
    const start=pick(r),count=pick(r),mode=r()%10,indexed=r()%4,instances=pick(r),bias=r()%5?0:r(),firstInstance=r()%5?0:r(),restart=r()%4,restartIndex=r()%3?0:r(),min=pick(r),max=pick(r),from=r()%3?0:r();
    input=packet(8,0,[start,count,mode,indexed,instances,bias,firstInstance,restart,restartIndex,min,max,from]);
    expected=(indexed===0||indexed===1)&&(restart===0||restart===1)&&mode<=6&&bias===0&&firstInstance===0&&(restart?indexed===1:restartIndex===0)&&((!indexed&&from!==0)||BigInt(start)+BigInt(count)<=0xffffffffn)&&min<=max;
   }
   // Real byte views at deliberately unaligned host offsets exercise the snapshot path.
   const padding=3+(r()%7),guarded=new Uint8Array(input.length+padding+17).fill(0xb7);guarded.set(input,padding);const view=guarded.subarray(padding,padding+input.length),before=guarded.slice();
   active={family,index:i,seed:seed.toString(16),input:Buffer.from(view).toString('hex'),expected};
   const result=decodeProductionSubmission(view,{contextId:2,event:i});assert.equal(typeof result.ok,'boolean');assert.deepEqual(guarded,before,'decoder never writes original input/guards');assert.ok(deepFrozen(result),'decoder result is deeply immutable');
   if(expected!==null){assert.equal(result.ok,expected,JSON.stringify(active));oracleChecks++;}
   if(result.ok){accepted++;let offset=0;for(const command of result.commands){assert.equal(command.byteOffset,offset);assert.equal(command.byteLength,(command.payloadDwords+1)*4);offset+=command.byteLength;assert.ok(offset<=view.length);}assert.equal(offset,view.length);assert.equal(result.byteLength,view.length);}
   else{rejected++;assert.equal(typeof result.error.code,'string');assert.equal(typeof result.error.message,'string');}
   if(i%1024===0)assert.deepEqual(decodeProductionSubmission(view,{contextId:2,event:i}),result,'same original packet produces identical result');
   digest.update(Buffer.from(view));digest.update(Buffer.from([result.ok?1:0]));
  }
  const row={family,cases:parameters.cases,seed:seed.toString(16).padStart(8,'0'),timeoutSeconds:60,elapsedMillis:Math.round(performance.now()-started),accepted,rejected,independentOracleChecks:oracleChecks,sha256:digest.digest('hex'),panicOobHang:false};report.families.push(row);console.log(JSON.stringify(row));
 }
 report.status='passed';report.summary={status:'passed',cases:report.families.reduce((n,f)=>n+f.cases,0),accepted:report.families.reduce((n,f)=>n+f.accepted,0),rejected:report.families.reduce((n,f)=>n+f.rejected,0),independentOracleChecks:report.families.reduce((n,f)=>n+f.independentOracleChecks,0)};
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack,active};process.exitCode=1;console.error(error.stack);}
finally{report.finishedAt=new Date().toISOString();if(parameters.output){await fs.mkdir(path.dirname(path.resolve(parameters.output)),{recursive:true});await fs.writeFile(parameters.output,JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report.summary??report.failure));}
