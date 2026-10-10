#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseConstantDomain,checkConversionBank} from '../../renderer/virgl-command/constant-domain.mjs';
const raw=fs.readFileSync(process.argv[2]),native=JSON.parse(raw),report={schema:'virgl-known-arithmetic-consumer-v1',task:'E6-T12g6m1',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(raw).digest('hex'),contracts:[],attacks:[],getterInvocations:0,banks:[]};
const bad=(metadata,stage,name)=>{const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,false,name);report.attacks.push({name,result});};
for(const c of native.cases.filter(c=>c.ok)){
 const m=c.result.metadata,contract=parseConstantDomain(m,c.stage);assert.equal(contract.ok,true,c.name);assert.ok(Object.isFrozen(contract.knownArithmetic.operations));report.contracts.push({name:c.name,contract});
 if(!['direct-bank-composition','discard-composition','indirect-known','ADD/SIN OUT[0], TEMP[0]'].includes(c.name))continue;
 for(const key of Object.keys(m.knownArithmeticContract)){
  const copy=structuredClone(m);copy.knownArithmeticContract[key]='other';bad(copy,c.stage,c.name+'/'+key);
  const getter=structuredClone(m);Object.defineProperty(getter.knownArithmeticContract,key,{enumerable:true,get(){report.getterInvocations++;return null;}});bad(getter,c.stage,c.name+'/getter/'+key);
 }
 for(const target of ['knownArithmeticContract','knownArithmeticBaseProfile']){
  const copy=structuredClone(m);delete copy[target];bad(copy,c.stage,c.name+'/missing/'+target);
  const getter=structuredClone(m);Object.defineProperty(getter,target,{enumerable:true,get(){report.getterInvocations++;return null;}});bad(getter,c.stage,c.name+'/getter/'+target);
 }
 for(const ops of [[],['MUL','ADD'],['ADD','ADD'],['DIV'],['ADD','MUL','ADD']]){const copy=structuredClone(m);copy.knownArithmeticContract.operations=ops;bad(copy,c.stage,c.name+'/operations/'+JSON.stringify(ops));}
 const accessor=structuredClone(m);Object.defineProperty(accessor.knownArithmeticContract.operations,0,{enumerable:true,get(){report.getterInvocations++;return 'ADD';}});bad(accessor,c.stage,c.name+'/array accessor');
 for(const key of Object.keys(m).filter(k=>/^(constant|.*BaseProfile$|.*Contract$)/.test(k)&&!['knownArithmeticContract','knownArithmeticBaseProfile'].includes(k))){const copy=structuredClone(m);delete copy[key];bad(copy,c.stage,c.name+'/base erase/'+key);}
 const restored=structuredClone(m);restored.profile=restored.knownArithmeticBaseProfile;delete restored.knownArithmeticBaseProfile;delete restored.knownArithmeticContract;
 const base=parseConstantDomain(restored,c.stage);assert.equal(base.ok,true);const copied={...contract};delete copied.knownArithmetic;assert.deepEqual(copied,base);
 if(contract.conversionDomain){
  const words=Array(contract.conversionDomain.count*4).fill(0),approved=checkConversionBank(words,contract.conversionDomain,contract);assert.equal(approved.ok,true);words.fill(0xdeadbeef);assert.ok(Object.isFrozen(approved.words));assert.equal(approved.words[0],0);
  const checks=[];for(const [word,wanted]of [[0,true],[0x80000000,true],[1,true],[0x4effffff,true],[0x4f000000,false],[0xcf000000,true],[0xcf000001,false],[0x7f800000,false],[0x7fc00001,false]]){
   const input=approved.words.slice();input[0]=word;const result=checkConversionBank(input,contract.conversionDomain,contract);assert.equal(result.ok,wanted);checks.push({word,wanted,result});}
  assert.equal(checkConversionBank(approved.words.slice(0,-4),contract.conversionDomain,contract).ok,false);report.banks.push({name:c.name,contract,approved,checks});
 }
}
assert.equal(report.getterInvocations,0);assert.equal(report.banks.length,1);report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(`${report.attacks.length} inert policy attacks; inherited owned F2I bank passed.`);
