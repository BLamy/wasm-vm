import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Critic-owned expectations. Signed decoding uses DataView, independent of the
// emitter's sign-bit bias. Unknown IMAX cannot combine one-sided authority.
const signed=w=>{const bytes=new ArrayBuffer(4),v=new DataView(bytes);v.setUint32(0,w,true);return v.getInt32(0,true);};
const safe=w=>(w&0x7fffffff)===0 || (w&0x7f800000)>0 && (w&0x7f800000)<0x7f800000;
const imm=(i,v,kind='UINT32')=>`IMM[${i}] ${kind} {${Array(4).fill(v).map(w=>kind==='FLT32'?'0x'+w.toString(16).padStart(8,'0'):String(w)).join(',')}}`;
const head=(extra=[])=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..2]','DCL CONST[0..1]',...extra];
const program=(extra,body)=>[...head(extra),...body,'END',''].join('\n');
export function getSignedIntegerRegressions(){
  const cases=[],add=(name,text,ok)=>cases.push({name,stage:'fragment',text,ok});
  // A may be +Inf (0x7f800000); B may be1. IMAX then selects +Inf.
  // A owns bit23=1; B owns bit24=0. Their UNION falsely says normal.
  const untrusted=[imm(0,0x00800000),imm(1,0xfeffffff),imm(2,0x3f800000)];
  const setup=['OR TEMP[0], CONST[0], IMM[0]','AND TEMP[1], CONST[1], IMM[1]'];
  for(let bits=1;bits<=15;bits++){
    const mask=[...'xyzw'].filter((_,i)=>bits>>i&1).join('');
    add('imax-complementary-facts-output-mask-'+mask,program(untrusted,[...setup,`IMAX TEMP[2].${mask}, TEMP[0], TEMP[1]`,'MOV OUT[0], IMM[2]',`MOV OUT[0].${mask}, TEMP[2]`]),false);
    add('imax-complementary-facts-numeric-mask-'+mask,program(untrusted,[...setup,`IMAX TEMP[2].${mask}, TEMP[0], TEMP[1]`,'MOV OUT[0], IMM[2]',`MUL OUT[0].${mask}, TEMP[2], IMM[2]`]),false);
    add('imax-complementary-facts-dead-mask-'+mask,program(untrusted,[...setup,`IMAX TEMP[2].${mask}, TEMP[0], TEMP[1]`,'MOV TEMP[2], IMM[2]','MOV OUT[0], TEMP[2]']),true);
    add('imax-input-locator-output-mask-'+mask,program([imm(0,0x3f800000)],[`IMAX TEMP[0].${mask}, IN[0].wzyx, IN[0].xyzw`,'MOV OUT[0], IMM[0]',`MOV OUT[0].${mask}, TEMP[0]`]),false);
  }
  const common=[imm(0,0x007fffff),imm(1,0x3f000000),imm(2,0x3f800000)];
  const commonSetup=['AND TEMP[0], CONST[0], IMM[0]','OR TEMP[0], TEMP[0], IMM[1]','AND TEMP[1], CONST[1], IMM[0]','OR TEMP[1], TEMP[1], IMM[2]','IMAX TEMP[2], TEMP[0].wzyx, TEMP[1].xyzw'];
  add('imax-common-normal-intersection-output',program(common,[...commonSetup,'MOV OUT[0], TEMP[2]']),true);
  add('imax-common-normal-intersection-numeric',program(common,[...commonSetup,'MUL OUT[0], TEMP[2], IMM[2]']),true);
  for(const op of ['ISLT','IMAX']){
    for(const [a,b] of [[0x80000000,0],[0x7fffffff,0xffffffff],[0xffffffff,0x80000000],[0x80000001,0],[1,0],[0x3f000000,0x3f800000],[0,0]]){
      const answer=op==='ISLT'?(signed(a)<signed(b)?0xffffffff:0):signed(a)>=signed(b)?a:b;
      for(const kind of ['UINT32','FLT32'])add(`${op}-${kind}-direct-${a}-${b}`,program([imm(0,a,kind),imm(1,b,kind)],[`${op} OUT[0], IMM[0], IMM[1]`]),safe(answer));
    }
    const special=op==='ISLT'?[imm(0,0),imm(1,1),imm(2,0x3f800000)]:[imm(0,1),imm(1,0),imm(2,0x3f800000)];
    const start=[`${op} TEMP[0], IMM[0], IMM[1]`];
    add(op+'-private-old-escaped',program(special,[...start,'MOV TEMP[1], TEMP[0]','MOV TEMP[0], IMM[2]','MOV OUT[0], TEMP[1]']),false);
    add(op+'-private-new-version',program(special,[...start,'MOV TEMP[1], TEMP[0]','MOV TEMP[0], IMM[2]','MOV OUT[0], TEMP[0]']),true);
    add(op+'-join-one-private-predecessor',program(special,['UIF IN[0].xxxx',...start,'ELSE','MOV TEMP[0], IMM[2]','ENDIF','MOV OUT[0], TEMP[0]']),false);
    add(op+'-join-killed-both-predecessors',program(special,['UIF IN[0].xxxx',...start,'MOV TEMP[0], IMM[2]','ELSE','MOV TEMP[0], IMM[2]','ENDIF','MOV OUT[0], TEMP[0]']),true);
    add(op+'-join-missing-predecessor',program(special,['UIF IN[0].xxxx',...start,'ENDIF','MOV OUT[0], TEMP[0]']),false);
    for(const bad of [op+'0',op+'_SAT',op+'_PRECISE',op.toLowerCase()])add(op+'-lexical-'+bad,program(special,[bad+' TEMP[0], IMM[0], IMM[1]','MOV OUT[0], IMM[2]']),false);
  }
  return cases;
}
export function runSignedIntegerRegressions(translate,cases=getSignedIntegerRegressions()){
  const records=[];
  for(const c of cases){const result=translate({stage:c.stage,text:c.text});records.push({...c,result});
    try{assert.equal(typeof result.ok,'boolean',c.name+' boolean admission');assert.equal(result.ok,c.ok,c.name+' predetermined signed/domain outcome');
      if(c.ok){assert.ok(result.glsl.includes('#version 300 es'));for(const key of ['constantRasterDomains','constantDomains'])assert.equal(Object.hasOwn(result.metadata,key),false,c.name+' no new bank domain');}
      else for(const key of ['glsl','metadata','vertex','fragment'])assert.equal(Object.hasOwn(result,key),false,c.name+' closed '+key);
    }catch(error){error.counterexample=records.at(-1);throw error;}
  }return records;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..')),native=get('--native'),output=get('--output');
  const report={schema:'virgl-signed-integer-critic-guards-v1',status:'running',cases:getSignedIntegerRegressions().length};
  try{
    if(native){report.nativeBinary={path:path.resolve(native),sha256:createHash('sha256').update(fs.readFileSync(native)).digest('hex')};report.native=runSignedIntegerRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})));}
    if(!args.includes('--native-only')){const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));const bridge=await createVirglShaderBridge();report.wasm=runSignedIntegerRegressions(request=>bridge.translate(request));if(report.native)for(let i=0;i<report.native.length;i++)assert.deepEqual(report.native[i].result,report.wasm[i].result,'exact signed guard parity');}
    report.status='passed';
  }catch(error){report.status='failed';report.failure={message:error.message,counterexample:error.counterexample};throw error;}
  finally{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  console.log(`${report.cases} independent signed integer domain/version/mask guards passed.`);
}
