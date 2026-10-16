#!/usr/bin/env node
// Actual consumer contracts, rational classification, and one sealed source sabotage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,checkRadialBank} from '../../renderer/virgl-command/constant-domain.mjs';
import {proof,admitted,hardwareBank,thresholdWord} from './oracle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),output=path.resolve(process.argv[2]);
fs.mkdirSync(output,{recursive:true});const hash=raw=>createHash('sha256').update(raw).digest('hex');
const bind=(p,base=root)=>{const raw=fs.readFileSync(p);return{path:path.relative(base,p),bytes:raw.length,sha256:hash(raw)}};
const fixturePath=path.join(root,'renderer/virgl-shader/tests/radial-domain-cases.json'),fixture=JSON.parse(fs.readFileSync(fixturePath));
const bridge=await createVirglShaderBridge({wasmBinary:fs.readFileSync(path.join(root,'renderer/virgl-shader/build/wasm/virgl-shader.wasm'))});
const report={schema:'radial-consumer-domain-v1',status:'running',guestExecution:false,gpuExecution:false,proof:proof(),sources:[fixturePath,'renderer/virgl-command/constant-domain.mjs','tools/virgl-radial-domain/oracle.mjs','tools/virgl-radial-domain/domain.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'].map(p=>bind(path.isAbsolute(p)?p:path.join(root,p))),results:[],forgeries:[],ownership:[],combined:[]};
for(const kernel of fixture.kernels){
 const input=fixture.cases.find(c=>c.name===kernel.case),result=bridge.translate({stage:input.stage,text:input.text});assert.equal(result.ok,true);
 const parsed=parseConstantDomain(result.metadata,kernel.stage);assert.equal(parsed.ok,true);assert.deepEqual(parsed.radialDomain,input.expected.constantRadialDomains[0]);
 const record={kernel,result,parsed,cases:[]};report.results.push(record);
 for(const witness of report.proof.cases){const values=hardwareBank(kernel,witness.word),actual=checkRadialBank(values,kernel.count,Boolean(parsed.constraint));assert.equal(actual.ok,admitted(witness.word));record.cases.push({word:witness.word,bank:values,result:actual});}
 const mutation=structuredClone(result.metadata);const checks=[];
 for(const key of['constantDomains','constantAccesses','constantConstraints','constantRadialDomains'])if(Object.hasOwn(mutation,key))checks.push(['drop '+key,m=>{delete m[key]}]);
 for(const [key,value]of[['kind','forged'],['stage',kernel.stage==='vertex'?'fragment':'vertex'],['slot',false],['count',kernel.count-1],['register',3],['component',1],['minimumMagnitude',thresholdWord+1]])checks.push(['radial '+key,m=>{m.constantRadialDomains[0][key]=value}]);
 checks.push(['extra radial field',m=>{m.constantRadialDomains[0].extra=0}],['duplicate radial',m=>{m.constantRadialDomains.push({...m.constantRadialDomains[0]})}],['unconditional profile',m=>{m.profile='virgl-webgl2-raw-bits-v13'}]);
 for(const [name,mutate]of checks){const md=structuredClone(mutation);mutate(md);const actual=parseConstantDomain(md,kernel.stage);assert.equal(actual.ok,false,name);assert.equal(actual.error.code,'shader-domain-error');report.forgeries.push({case:kernel.case,name,metadata:md,result:actual});}
 const getter=structuredClone(mutation);Object.defineProperty(getter.constantRadialDomains[0],'minimumMagnitude',{enumerable:true,get(){throw new Error('must not invoke metadata accessor')}});const rejected=parseConstantDomain(getter,kernel.stage);assert.equal(rejected.ok,false);report.forgeries.push({case:kernel.case,name:'accessor minimumMagnitude',result:rejected});
 const values=hardwareBank(kernel,0x3f800000),owned=checkRadialBank(values,kernel.count,Boolean(parsed.constraint));assert.equal(owned.ok,true);values[16]=0;assert.equal(owned.words[16],0x3f800000);assert.equal(Object.isFrozen(owned.words),true);assert.equal(checkRadialBank(values,kernel.count,Boolean(parsed.constraint)).ok,false);report.ownership.push({case:kernel.case,callerAfter:values,approved:owned});
 if(parsed.constraint){const values=hardwareBank(kernel,0x3f800000,undefined,19),actual=checkRadialBank(values,kernel.count,true);assert.equal(actual.ok,false);assert.equal(actual.error.code,'constant-constraint-error');report.combined.push({case:kernel.case,bank:values,result:actual});}
}
const sourcePath=path.join(root,'renderer/virgl-command/constant-domain.mjs'),before=fs.readFileSync(sourcePath,'utf8'),seam='if (magnitude < 0x3727c5ac)';assert.equal(before.split(seam).length,2);
const faultPath=path.join(output,'removed-coefficient-check.mjs'),after=before.replace(seam,'if (false && magnitude < 0x3727c5ac)');fs.writeFileSync(faultPath,after);
const fault=await import(pathToFileURL(faultPath).href),kernel=fixture.kernels.find(k=>k.case==='unmarked-structural-port-loop-fragment'),values=hardwareBank(kernel,0x35800000);
values[8]=0x40800000;values[10]=0x3f800000;values[24]=0;values[28]=0x3f800000;
const actual=fault.checkRadialBank(values,46,true);assert.equal(actual.ok,true,'removed actual consumer check admits counterexample');
let caught=null;try{assert.equal(admitted(actual.words[16]),true,'independent definedness oracle before GPU execution');}catch(error){caught={name:error.name,message:error.message};}assert.ok(caught);
report.sabotage={source:bind(sourcePath),before:seam,after:'if (false && magnitude < 0x3727c5ac)',fault:bind(faultPath,output),bank:values,result:actual,oracleAdmitted:admitted(actual.words[16]),caught,gpuDraws:0};
report.status='passed';fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,domainChecks:report.results.reduce((n,r)=>n+r.cases.length,0),forgeries:report.forgeries.length,sourceFaultCaught:true}));
