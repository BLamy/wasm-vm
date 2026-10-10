// Permanent critic oracle for actual private GPU feedback. Interpret TGSI source
// and literal/attribute/owned-bank inputs; never returned expectedWords or GLSL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {preciseFractionReference} from './precise-fraction-regressions.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const bits=x=>new Uint32Array(new Float32Array([x]).buffer)[0];
export function runPreciseFractionCaptureRegressions(report){
 const acceptance=report.acceptance??report,rows=[];let words=0;
 for(let record=0;record<acceptance.vertices.length;record++){
  const v=acceptance.vertices[record];if(v.backend!=='owned'||v.op!=='FRC_PRECISE')continue;
  assert.equal(hash(v.text),v.textSha256);
  for(let vector=0;vector<v.vectors.length;vector++){
   const x=v.vectors[vector],storage=new Map(),key=(file,index)=>file+index;
   storage.set('IN0',x.attributeWords.slice());assert.deepEqual(x.attributeWords,x.position.map(bits));
   if(v.inputSource)storage.set('IN1',x.inputWords.slice());
   if(x.bankUpload)for(let at=0;at<x.bankUpload.words.length;at+=4)storage.set(key('CONST',at/4),x.bankUpload.words.slice(at,at+4));
   else if(v.variant==='join'){const bank=Array(184).fill(0);bank[172]=x.condition;for(let at=0;at<184;at+=4)storage.set(key('CONST',at/4),bank.slice(at,at+4));}
   const source=text=>{const m=/^(-?)(IMM|TEMP|CONST|IN|OUT)\[(\d+)\](?:\.([xyzw]{4}))?$/.exec(text);assert.ok(m,text);
    const a=storage.get(key(m[2],m[3]));assert.ok(a,text);return [...(m[4]||'xyzw')].map(c=>((a['xyzw'.indexOf(c)]??0)^(m[1]?0x80000000:0))>>>0);};
   const flow=[];let active=true;
   for(let text of v.text.split('\n')){
    text=text.trim();if(!text||['VERT','END'].includes(text)||text.startsWith('DCL '))continue;
    const literal=/^IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}$/.exec(text);
    if(literal){storage.set('IMM'+literal[1],literal[3].split(',').map(n=>literal[2]==='UINT32'?Number(n):bits(Number(n))));continue;}
    if(text.startsWith('UIF ')){const yes=source(text.slice(4))[0]!==0;flow.push({active,yes});active=active&&yes;continue;}
    if(text==='ELSE'){const f=flow.at(-1);active=f.active&&!f.yes;continue;}
    if(text==='ENDIF'){active=flow.pop().active;continue;}if(!active)continue;
    const [op,...rest]=text.split(' '),parts=rest.join(' ').split(', '),dst=/^(OUT|TEMP)\[(\d+)\](?:\.([xyzw]+))?$/.exec(parts[0]);assert.ok(dst,text);
    const operands=parts.slice(1).map(source),value=storage.get(key(dst[1],dst[2]))?.slice()??Array(4).fill(0),writes={};
    for(const c of dst[3]||'xyzw'){const lane='xyzw'.indexOf(c),a=operands[0][lane],b=operands[1]?.[lane];
     if(op==='MOV')writes[lane]=a;else if(op==='FRC_PRECISE')writes[lane]=preciseFractionReference(a);
     else if(op==='AND')writes[lane]=(a&b)>>>0;else if(op==='OR')writes[lane]=(a|b)>>>0;else if(op==='USHR')writes[lane]=a>>>(b&31);else throw new Error('Unrecognized independent source operation '+text);
    }
    for(const [lane,w]of Object.entries(writes))value[lane]=w;storage.set(key(dst[1],dst[2]),value);
   }
   assert.equal(flow.length,0);const wanted=[...storage.get('OUT0'),...storage.get('OUT1'),...storage.get('OUT2')],bytes=Buffer.from(x.bytes),observed=Array.from({length:12},(_,i)=>bytes.readUInt32LE(i*4));
   assert.equal(bytes.length,48);assert.equal(hash(bytes),x.sha256);assert.deepEqual(observed,x.observed);
   const point={record,vector,textSha256:v.textSha256,captureSha256:x.sha256,input:x.input,expectedWords:wanted,observedWords:observed};
   try{assert.deepEqual(observed,wanted,`private precise fraction physical source equation at record ${record}, vector ${vector}`);}catch(e){e.counterexample=point;throw e;}
   rows.push(point);words+=12;
  }
 }
 assert.ok(words>0);return{words,rows};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined,reportFile=get('--report'),output=get('--output');assert.ok(reportFile);
 const report={schema:'virgl-fraction-critic-capture-guards-v1',task:'E6-T12g6g2',status:'running',testSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),sourceReferenceSha256:hash(fs.readFileSync(new URL('./precise-fraction-regressions.mjs',import.meta.url))),inputReportSha256:hash(fs.readFileSync(reportFile))};
 try{report.physical=runPreciseFractionCaptureRegressions(JSON.parse(fs.readFileSync(reportFile)));report.status='passed';}
 catch(e){report.status='failed';report.failure={message:e.message,counterexample:e.counterexample};throw e;}
 finally{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(`${report.physical.words} private physical capture words satisfy the independent source equation.`);
}
