#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseConstantDomain,checkConversionBank,checkRasterBank} from '../../renderer/virgl-command/constant-domain.mjs';
const raw=fs.readFileSync(process.argv[2]),native=JSON.parse(raw),report={schema:'virgl-known-branches-consumer-v1',task:'E6-T12g6m2',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(raw).digest('hex'),contracts:[],attacks:[],getterInvocations:0,banks:[],raster:[]};
const bad=(metadata,stage,name)=>{const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,false,name);report.attacks.push({name,result});};
for(const c of native.cases.filter(c=>c.ok)){
 const m=c.result.metadata,contract=parseConstantDomain(m,c.stage);assert.equal(contract.ok,true,c.name);if(c.held)continue;assert.ok(Object.isFrozen(contract.branchLiveness));report.contracts.push({name:c.name,contract});
 if(!['direct-bank-composition','live/kill','coordinates/composition','known-arithmetic/composition','raster/false','loop/recognized-dead','gpu/zero/608135816'].includes(c.name))continue;
 for(const key of Object.keys(m.branchContract)){
  for(const value of['other',null,{},0,false]){const copy=structuredClone(m);copy.branchContract[key]=value;bad(copy,c.stage,c.name+'/'+key+'/'+JSON.stringify(value));}
  const getter=structuredClone(m);Object.defineProperty(getter.branchContract,key,{enumerable:true,get(){report.getterInvocations++;return null;}});bad(getter,c.stage,c.name+'/getter/'+key);
  const absent=structuredClone(m);delete absent.branchContract[key];bad(absent,c.stage,c.name+'/absent/'+key);
 }
 for(const target of ['branchContract','branchBaseProfile']){
  const copy=structuredClone(m);delete copy[target];bad(copy,c.stage,c.name+'/missing/'+target);
  const getter=structuredClone(m);Object.defineProperty(getter,target,{enumerable:true,get(){report.getterInvocations++;return null;}});bad(getter,c.stage,c.name+'/getter/'+target);
 }
 for(const profile of['virgl-webgl2-raw-bits-v41','virgl-webgl2-raw-bits-v42','virgl-webgl2-raw-bits-v0','virgl-webgl2-straight-line-v5',null]){const copy=structuredClone(m);copy.branchBaseProfile=profile;bad(copy,c.stage,c.name+'/base/'+profile);}
 for(const [label,mutate]of[['extra',m=>m.branchContract.extra=1],['prototype',m=>{const condition=m.branchContract.condition;delete m.branchContract.condition;Object.setPrototypeOf(m.branchContract,{condition});}],['symbol',m=>m.branchContract[Symbol('extra')]=1],['nonenumerable',m=>Object.defineProperty(m.branchContract,'hidden',{value:1})],['stage',m=>m.branchContract.stage=c.stage==='vertex'?'fragment':'vertex'],['top-profile',m=>m.profile=m.branchBaseProfile]]){const copy=structuredClone(m);mutate(copy);bad(copy,c.stage,c.name+'/'+label);}
 for(const key of Object.keys(m).filter(k=>/^(constant|.*BaseProfile$|.*Contract$)/.test(k)&&!['branchContract','branchBaseProfile'].includes(k))){const copy=structuredClone(m);delete copy[key];bad(copy,c.stage,c.name+'/base erase/'+key);const getter=structuredClone(m);Object.defineProperty(getter,key,{enumerable:true,get(){report.getterInvocations++;return null;}});bad(getter,c.stage,c.name+'/base getter/'+key);}
 const restored=structuredClone(m);restored.profile=restored.branchBaseProfile;delete restored.branchBaseProfile;delete restored.branchContract;
 const base=parseConstantDomain(restored,c.stage);assert.equal(base.ok,true);const copied={...contract};delete copied.branchLiveness;assert.deepEqual(copied,base);
 if(contract.conversionDomain){
  const words=Array(contract.conversionDomain.count*4).fill(0),approved=checkConversionBank(words,contract.conversionDomain,contract);assert.equal(approved.ok,true);words.fill(0xdeadbeef);assert.ok(Object.isFrozen(approved.words));assert.equal(approved.words[0],0);
  const checks=[];for(const [word,wanted]of [[0,true],[0x80000000,true],[1,true],[0x4effffff,true],[0x4f000000,false],[0xcf000000,true],[0xcf000001,false],[0x7f800000,false],[0x7fc00001,false]]){const input=approved.words.slice();input[0]=word;const result=checkConversionBank(input,contract.conversionDomain,contract);assert.equal(result.ok,wanted);checks.push({word,wanted,result});}
  assert.equal(checkConversionBank(approved.words.slice(0,-4),contract.conversionDomain,contract).ok,false);report.banks.push({name:c.name,contract,approved,checks});
 }
 if(contract.rasterDomain){
  const owned=Array(contract.rasterDomain.count*4).fill(0),safe=checkRasterBank(owned,contract.rasterDomain,Boolean(contract.constraint),Boolean(contract.radialDomain));assert.equal(safe.ok,true);owned.fill(1);assert.equal(safe.words[0],0);assert.ok(Object.isFrozen(safe.words));
  const checks=[];for(const [word,wanted]of [[0,true],[0x80000000,true],[0x00800000,true],[0x7f7fffff,true],[1,false],[0x7fffff,false],[0x7f800000,false],[0x7fc00001,false]]){const input=safe.words.slice();input[0]=word;const result=checkRasterBank(input,contract.rasterDomain,Boolean(contract.constraint),Boolean(contract.radialDomain));assert.equal(result.ok,wanted);checks.push({word,wanted,result});}report.raster.push({name:c.name,contract,safe,checks});
 }
}
assert.equal(report.getterInvocations,0);assert.equal(report.banks.length,1);assert.equal(report.raster.length,1);report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(`${report.attacks.length} inert owned policy attacks; inherited F2I/raster banks passed.`);
