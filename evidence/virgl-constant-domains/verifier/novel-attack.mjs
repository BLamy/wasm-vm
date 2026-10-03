import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {finiteBinary32Word,checkFiniteBank,parseConstantDomain} from '../../../renderer/virgl-command/constant-domain.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const seeds=[0x92556a61,0xc310478b,0x1058d09d,0x5fff00b7];
const view=new DataView(new ArrayBuffer(4));
const finite=w=>{view.setUint32(0,w,true);return Number.isFinite(view.getFloat32(0,true));};
const records=[];
for(const seed of seeds){let state=seed,accepted=0,rejected=0;const words=[];
 for(let i=0;i<10000;i++){state^=state<<13;state^=state>>>17;state^=state<<5;const word=state>>>0,expected=finite(word),actual=finiteBinary32Word(word);assert.equal(actual,expected);words.push(word);if(actual)accepted++;else rejected++;}
 records.push({kind:'predicate',seed,count:words.length,accepted,rejected,wordBytesSha256:sha(new Uint32Array(words))});
}
for(let count=0;count<=46;count++){
 const input=Array.from({length:184},(_,i)=>[0x80000000,0x00000001,0x807fffff,0xff7fffff][i%4]);
 const good=checkFiniteBank(input,count);assert.equal(good.ok,true);assert.deepEqual(good.words,input.slice(0,count*4));assert.ok(Object.isFrozen(good.words));
 const expected=[...good.words];input.fill(0x7f800000);assert.deepEqual(good.words,expected);
 const entry={kind:'prefix',count,ownedWords:good.words.length,ownedSha256:sha(new Uint32Array(good.words))};
 for(const [position,expectedOk]of [[count*4-1,false],[count*4,true]])if(position>=0&&position<184){
  const bank=Array(184).fill(0x80000001);bank[position]=0xff800001;const result=checkFiniteBank(bank,count);assert.equal(result.ok,expectedOk);if(!expectedOk)assert.equal(result.error.code,'constant-domain-error');entry[position]=result.ok;
 }
 if(count>0){const short=Array((count-1)*4).fill(0),result=checkFiniteBank(short,count);assert.equal(result.error.code,'incomplete-draw');entry.shortCode=result.error.code;}
 records.push(entry);
}
let prototypeCalls=0;const prototype={};Object.defineProperty(prototype,'hidden',{get(){prototypeCalls++;throw new Error('prototype read');}});
for(const stage of ['vertex','fragment']){const name=stage==='vertex'?'vsconst0':'fsconst0';const domain=Object.assign(Object.create(prototype),{kind:'constant-bank-finite-f32-v1',stage,slot:0,name,count:47});const metadata=Object.assign(Object.create(prototype),{profile:'virgl-webgl2-raw-bits-v7',stage,inputs:[],outputs:[],attributes:[],uniforms:[{name,type:'uvec4[]',count:47,encoding:'float32-bits'}],samplers:[],uniformBlocks:[],constantDomains:[domain]});const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,true);assert.equal(result.domain.count,47);domain.count=1;assert.equal(result.domain.count,47);records.push({kind:'hostile-prototype',stage,result});}
assert.equal(prototypeCalls,0);
const report={schema:1,status:'passed',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),seeds,prototypeCalls,sourceSha256:sha(fs.readFileSync('renderer/virgl-command/constant-domain.mjs')),harnessSha256:sha(fs.readFileSync(import.meta.filename)),records};
fs.writeFileSync('evidence/virgl-constant-domains/verifier/novel-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,predicateChecks:40000,prefixExtents:47,metadataStages:2,prototypeCalls}));
