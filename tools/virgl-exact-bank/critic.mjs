#!/usr/bin/env node
// Independent exact-bank regression predictions. No observed pixel/compiler values are oracles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';

const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const moduleFile=process.argv[3]?path.resolve(process.argv[3]):new URL('../../renderer/virgl-command/constant-domain.mjs',import.meta.url);
const {parseConstantDomain,checkExactBank}=await import(moduleFile instanceof URL?moduleFile.href:pathToFileURL(moduleFile).href);
const bridge=await createVirglShaderBridge(),clone=x=>JSON.parse(JSON.stringify(x));
const seeds=[0xd15ea5e1,0x8badf00d,0x13579bdf],profile='virgl-webgl2-raw-bits-v42',kind='constant-bank-exact-u32-v1';
const sha=x=>createHash('sha256').update(x).digest('hex');
function source(stage){return stage==='vertex'?
 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0]\nDCL CONST[0..45]\nIMM[0] UINT32 {1,0,0,0}\nIMM[1] FLT32 {.25,.5,.5,1}\nIMM[2] FLT32 {0,1,0,1}\nUSEQ TEMP[0].x, CONST[0].xxxx, IMM[0].xxxx\nUCMP OUT[1], TEMP[0].xxxx, IMM[1], IMM[2]\nMOV OUT[0], IN[0]\nEND\n':
 'FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0]\nDCL CONST[0..45]\nIMM[0] UINT32 {1,0,0,0}\nIMM[1] FLT32 {.25,.5,.5,1}\nIMM[2] FLT32 {0,1,0,1}\nUSEQ TEMP[0].x, CONST[0].xxxx, IMM[0].xxxx\nUCMP OUT[0], TEMP[0].xxxx, IMM[1], IMM[2]\nEND\n';}
function wrap(original,stage,components){
 const m=clone(original.metadata);m.exactBaseProfile=m.profile;m.profile=profile;
 m.constantExactDomains=[{kind,stage,slot:0,name:stage==='vertex'?'vsconst0':'fsconst0',count:m.uniforms[0].count,components:clone(components)}];return m;
}
const predictions={task:'E6-T12g6m3a',seeds,predictedBeforeExecution:true,
 raw:['0','0x80000000','1','2','0x007fffff','0x00800000','0xffffffff'],
 rules:['every exact-u32 match returns the owned184-word prefix','a different finite exact word rejects constant-exact-domain-error',
 'a shortened bank rejects incomplete-draw','own malformed/accessor/inherited-only/extra policy fields reject with zero getter calls',
 'descriptor-time caller mutations cannot change already copied component/bank values','removing the equality predicate fails the adjacent-word assertion']};
fs.writeFileSync(path.join(output,'predictions.json'),JSON.stringify(predictions,null,2)+'\n');
const report={schema:1,task:'E6-T12g6m3a',status:'running',seeds,moduleSha256:sha(fs.readFileSync(moduleFile)),cases:[],metadataAttacks:[],novel:[],getterInvocations:0};
const approve=(words,c)=>checkExactBank(words,c.exactDomain,c.exactBase);
const bad=(metadata,stage,label)=>{const value=parseConstantDomain(metadata,stage);assert.equal(value.ok,false,label);report.metadataAttacks.push({label,value});};
try{
 for(const stage of ['vertex','fragment']){
  const original=bridge.translate({stage,text:source(stage)});assert.equal(original.ok,true);assert.equal(original.metadata.profile,'virgl-webgl2-raw-bits-v2');assert.equal(original.metadata.uniforms[0].count,46);
  const sparse=[{register:0,component:0,word:1},{register:45,component:3,word:0}],metadata=wrap(original,stage,sparse),contract=parseConstantDomain(metadata,stage);
  assert.equal(contract.ok,true);assert.deepEqual(contract.exactBase,parseConstantDomain(original.metadata,stage));
  const words=Array(184).fill(0);words[0]=1;
  assert.deepEqual(approve(words,contract).words,words);
  for(const raw of [0,0x80000000,1,2,0x007fffff,0x00800000,0xffffffff]){
   const m=wrap(original,stage,[{register:0,component:0,word:raw},{register:45,component:3,word:0}]),c=parseConstantDomain(m,stage),bank=words.slice();bank[0]=raw;
   const good=approve(bank,c);assert.equal(good.ok,true);assert.equal(good.words[0],raw);
   const adjacent=bank.slice();adjacent[0]=raw===0xffffffff?0xfffffffe:(raw+1)>>>0;
   const rejected=approve(adjacent,c);assert.equal(rejected.ok,false,`${stage}: adjacent exact word must reject`);assert.equal(rejected.error.code,'constant-exact-domain-error');
   report.cases.push({label:stage+'/literal/'+raw,metadata:m,bank,good,adjacent,rejected});
  }
  for(const length of [0,4,180]){const result=approve(words.slice(0,length),contract);assert.equal(result.ok,false);assert.equal(result.error.code,'incomplete-draw');report.cases.push({label:stage+'/short/'+length,result});}
  for(const key of ['kind','stage','slot','name','count','components']){
   const missing=clone(metadata);delete missing.constantExactDomains[0][key];bad(missing,stage,'missing-domain/'+key);
   const accessor=clone(metadata);Object.defineProperty(accessor.constantExactDomains[0],key,{get(){report.getterInvocations++;return metadata.constantExactDomains[0][key];}});bad(accessor,stage,'getter-domain/'+key);
   const inherited=clone(metadata),value=inherited.constantExactDomains[0][key];delete inherited.constantExactDomains[0][key];Object.setPrototypeOf(inherited.constantExactDomains[0],{[key]:value});bad(inherited,stage,'inherited-domain/'+key);
  }
  for(const key of ['register','component','word']){
   for(const value of [true,'1',-1,.25,0x100000000,NaN,Infinity,null]){const m=clone(metadata);m.constantExactDomains[0].components[0][key]=value;bad(m,stage,'component/'+key+'/'+String(value));}
   const missing=clone(metadata);delete missing.constantExactDomains[0].components[0][key];bad(missing,stage,'missing-component/'+key);
   const accessor=clone(metadata);Object.defineProperty(accessor.constantExactDomains[0].components[0],key,{get(){report.getterInvocations++;return 1;}});bad(accessor,stage,'getter-component/'+key);
  }
  for(const count of [0,-1,.5,48,NaN,Infinity,'46']){const m=clone(metadata);m.constantExactDomains[0].count=count;bad(m,stage,'count/'+String(count));}
  for(const [label,mutate] of [
   ['stage',m=>m.constantExactDomains[0].stage='geometry'],['slot',m=>m.constantExactDomains[0].slot=1],['name',m=>m.constantExactDomains[0].name='other'],
   ['duplicate',m=>m.constantExactDomains[0].components.push(clone(m.constantExactDomains[0].components[1]))],
   ['unsorted',m=>m.constantExactDomains[0].components.reverse()],['register46',m=>m.constantExactDomains[0].components[1].register=46],
   ['lane4',m=>m.constantExactDomains[0].components[1].component=4],['unknown',m=>m.constantExactDomains[0].extra=true],
   ['symbol',m=>m.constantExactDomains[0][Symbol('extra')]=1],['recursive-base',m=>m.exactBaseProfile=profile],
   ['missing-base',m=>delete m.exactBaseProfile],['missing-exact',m=>delete m.constantExactDomains],
   ['stripped-wrapper',m=>m.profile=m.exactBaseProfile],['uniform-count',m=>m.uniforms[0].count=45]
  ]){const m=clone(metadata);mutate(m);bad(m,stage,label);}
  // Novel attack: mutate a previously copied descriptor while later descriptors are read.
  const callerBank=words.slice(),bankProxy=new Proxy(callerBank,{getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);if(key==='183')target[0]=2;return d;}});
  const copied=approve(bankProxy,contract);assert.equal(callerBank[0],2);assert.equal(copied.ok,true);assert.equal(copied.words[0],1);assert.ok(Object.isFrozen(copied.words));
  const callerComponent={register:0,component:0,word:1},componentProxy=new Proxy(callerComponent,{getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);if(key==='word')target.word=2;return d;}});
  const alias=clone(metadata);alias.constantExactDomains[0].components[0]=componentProxy;
  const owned=parseConstantDomain(alias,stage);assert.equal(callerComponent.word,2);assert.equal(owned.ok,true);assert.equal(owned.exactDomain.components[0].word,1);assert.equal(approve(words,owned).ok,true);
  report.novel.push({stage,callerBankWord:callerBank[0],approvedWord:copied.words[0],callerComponentWord:callerComponent.word,ownedComponentWord:owned.exactDomain.components[0].word});
  for(const seed of seeds){let state=seed;const next=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
   for(let trial=0;trial<24;trial++){
    const bank=Array.from({length:184},()=>next()&0x7f7fffff),components=bank.map((word,index)=>({register:index>>>2,component:index&3,word}));
    const c=parseConstantDomain(wrap(original,stage,components),stage);assert.equal(c.ok,true);const good=approve(bank,c);assert.equal(good.ok,true);assert.deepEqual(good.words,bank);
    const index=next()%184,wrong=bank.slice();wrong[index]^=1;const result=approve(wrong,c);assert.equal(result.ok,false,'independent changed exact word');assert.equal(result.error.code,'constant-exact-domain-error');
    bank.fill(0);assert.equal(good.words[index],components[index].word);report.cases.push({label:stage+'/seed/'+seed+'/'+trial,index,componentsSha256:sha(JSON.stringify(components)),result});
   }
  }
 }
 assert.equal(report.getterInvocations,0);report.status='passed';
 console.log(`${report.cases.length} independent exact-bank cases, ${report.metadataAttacks.length} owned schema attacks and descriptor-time mutation checks passed.`);
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};throw error;}
finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
