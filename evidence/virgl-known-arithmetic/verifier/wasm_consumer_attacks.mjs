#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {parseConstantDomain,checkConversionBank} from '../../../renderer/virgl-command/constant-domain.mjs';
const E=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(E,'../../..'),O=path.join(ROOT,'target/evidence/virgl-known-arithmetic-critic'),U=path.join(O,'unpacked');
const sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p));
const native=read(path.join(E,'native-attacks.json')),oldNative=read(path.join(U,'hot/native/report.json'));
const {default:create}=await import(pathToFileURL(path.join(U,'generated/wasm/virgl-shader.mjs')));
const module=await create({wasmBinary:fs.readFileSync(path.join(U,'generated/wasm/virgl-shader.wasm'))});
function request(strings,fn){const ps=[];try{for(const text of strings){const p=module._malloc(text.length+1);assert.ok(p);ps.push(p);for(let i=0;i<text.length;i++)module.HEAPU8[p+i]=text.charCodeAt(i);module.HEAPU8[p+text.length]=0;}return JSON.parse(module.UTF8ToString(fn(ps)));}finally{for(const p of ps)module._free(p);}}
const single=(stage,text)=>request([text],ps=>module._bridge_translate(stage==='vertex'?0:1,ps[0],text.length));
const pair=(vertex,fragment)=>request([vertex,fragment],ps=>module._bridge_translate_pair(ps[0],vertex.length,ps[1],fragment.length));
const report={schema:'virgl-known-arithmetic-critic-wasm-consumer-v1',task:'E6-T12g6m1',status:'running',nativeAttackSha256:sha(fs.readFileSync(path.join(E,'native-attacks.json'))),originalWasmSha256:sha(fs.readFileSync(path.join(U,'generated/wasm/virgl-shader.wasm'))),cases:[],attacks:[],getterInvocations:0,legacy:[],inheritedBanks:[]};
for(const c of native.cases){const result=single(c.stage,c.text),p=pair(c.partner,c.text);assert.deepEqual(result,c.result,c.name);assert.deepEqual(p,c.pairResult,c.name+' whole pair');report.cases.push({name:c.name,ok:result.ok,resultSha256:sha(JSON.stringify(result)),pairSha256:sha(JSON.stringify(p))});}
const tooLarge=single('fragment',' '.repeat(49153));assert.equal(tooLarge.error.code,'input-too-large');report.textLimit=tooLarge;
const good=native.cases.find(c=>c.name==='both-operation-wrapper').result.metadata,clone=()=>structuredClone(good);
function bad(m,name,stage='fragment'){const result=parseConstantDomain(m,stage);assert.equal(result.ok,false,name);report.attacks.push({name,result});}
const accepted=parseConstantDomain(good,'fragment');assert.equal(accepted.ok,true);assert.deepEqual(accepted.knownArithmetic.operations,['ADD','MUL']);assert.ok(Object.isFrozen(accepted.knownArithmetic)&&Object.isFrozen(accepted.knownArithmetic.operations));
for(const field of Object.keys(good.knownArithmeticContract)){
 let m=clone();m.knownArithmeticContract[field]='forged';bad(m,'policy/'+field);
 m=clone();Object.defineProperty(m.knownArithmeticContract,field,{enumerable:true,get(){report.getterInvocations++;return good.knownArithmeticContract[field];}});bad(m,'accessor/'+field);
 m=clone();delete m.knownArithmeticContract[field];bad(m,'missing/'+field);
}
for(const base of ['virgl-webgl2-raw-bits-v40','virgl-webgl2-raw-bits-v0','virgl-webgl2-raw-bits-v41',null,{}]){const m=clone();m.knownArithmeticBaseProfile=base;bad(m,'base/'+JSON.stringify(base));}
for(const ops of [[],['MUL','ADD'],['ADD','ADD'],['MUL','MUL'],['DIV'],['ADD','MUL','ADD']]){const m=clone();m.knownArithmeticContract.operations=ops;bad(m,'operations/'+JSON.stringify(ops));}
let m=clone();Object.defineProperty(m.knownArithmeticContract.operations,1,{enumerable:true,get(){report.getterInvocations++;return'MUL';}});bad(m,'second-array-accessor');
m=clone();m.knownArithmeticContract.operations.extra=0;bad(m,'array-extra');
m=clone();delete m.knownArithmeticContract.operations[0];bad(m,'array-hole');
m=clone();m.knownArithmeticContract=Object.create(m.knownArithmeticContract);bad(m,'inherited-policy-forgery');
m=clone();m.knownArithmeticContract=new Proxy(m.knownArithmeticContract,{ownKeys(){throw new Error('critic proxy reflection');}});bad(m,'proxy-reflection-failure');
m=clone();m.knownArithmeticContract.stage='vertex';bad(m,'policy-wrong-stage');bad(clone(),'top-wrong-stage','vertex');
// Valid outer policy with invalid inherited base forces the previously unrecorded :checked branch.
m=clone();delete m.sineContract;bad(m,'invalid-inherited-base-return');
assert.equal(report.getterInvocations,0);
const bankCase=oldNative.cases.find(c=>c.name==='direct-bank-composition'),contract=parseConstantDomain(bankCase.result.metadata,'fragment');assert.equal(contract.ok,true);
for(const [word,ok]of [[0,true],[0x80000000,true],[0x4effffff,true],[0x4f000000,false],[0xcf000000,true],[0xcf000001,false],[0x7f800000,false],[0x7fc00001,false]]){const input=Array(184).fill(0);input[0]=word;const result=checkConversionBank(input,contract.conversionDomain,contract);assert.equal(result.ok,ok);if(ok){input.fill(0xdeadbeef);assert.equal(result.words[0],word);assert.ok(Object.isFrozen(result.words));}report.inheritedBanks.push({word,ok,result});}
function sealed(base,name){const manifest=read(path.join(ROOT,base,'manifest.json')),idx=read(path.join(ROOT,base,'records.json')),archive=path.join(ROOT,base,manifest.archive.path);assert.equal(sha(fs.readFileSync(archive)),manifest.archive.sha256);assert.equal(sha(fs.readFileSync(path.join(ROOT,base,'records.json'))),manifest.recordIndex.sha256);const e=idx.records.find(r=>r.path===name);assert.ok(e);const raw=execFileSync('tar',['-xOf',archive,name],{maxBuffer:128e6});assert.equal(sha(raw),e.sha256);return JSON.parse(raw);}
const lists=[['discard',sealed('evidence/virgl-fragment-discard/worker/revision-2','hot/native/report.json').cases.map(c=>({...c,old:c.result}))],['power',sealed('evidence/virgl-power/worker','hot/native/report.json').cases.map(c=>({...c,old:c.result}))],['held',sealed('evidence/virgl-power/worker','hot/legacy.json').cases]];
const originalLegacy=read(path.join(U,'hot/legacy.json')),extensions=read(path.join(ROOT,'tools/virgl-known-arithmetic/extensions.json'));let at=0;
for(const[kind,list]of lists)for(const c of list){const result=single(c.stage,c.text),name=kind+'/'+c.name,extension=!c.old.ok&&result.ok;
 if(extension){assert.ok(extensions.some(e=>e.name===name&&e.stage===c.stage&&e.textSha256===sha(c.text)));assert.deepEqual(result,originalLegacy.extensions.find(e=>e.name===name).result);}else assert.deepEqual(result,c.old,name+' complete old result');
 assert.equal(sha(JSON.stringify(result)),originalLegacy.cases[at].resultSha256,name+' actual recorded legacy hash');assert.equal(originalLegacy.cases[at++].name,name);
 if(kind==='discard'){const p=c.stage==='fragment'?pair(c.partner,c.text):pair(c.text,c.partner);assert.deepEqual(p,c.pairResult,name+' inherited whole pair');}
 report.legacy.push({name,extension,resultSha256:sha(JSON.stringify(result))});}
assert.equal(at,10041);assert.equal(report.legacy.filter(c=>c.extension).length,5);
for(const o of oldNative.originals){const text=fs.readFileSync(path.join(ROOT,o.path),'utf8');assert.equal(sha(text),o.sha256);assert.deepEqual(single('fragment',text),o.result);}
report.fullOriginalGate=oldNative.originals.map(o=>({sha256:o.sha256,ok:false}));report.status='passed';fs.writeFileSync(path.join(E,'wasm-consumer-attacks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'passed',publicSinglesPairs:report.cases.length,metadataAttacks:report.attacks.length,legacyResults:report.legacy.length,legacyExtensions:5,getterInvocations:0}));
