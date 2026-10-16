#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {parseConstantDomain,checkIndirectBank,checkLoopBank,checkFiniteBank} from '../../renderer/virgl-command/constant-domain.mjs';
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+2*i],process.argv[3+2*i]])),output=path.resolve(args['--output']),native=JSON.parse(fs.readFileSync(args['--native']));
fs.mkdirSync(output,{recursive:true});let getters=0;const checks=[];
const observe=(name,metadata,stage,expected)=>{const result=parseConstantDomain(metadata,stage);assert.deepEqual(result,expected);checks.push({name,metadata,stage,result});return result;};
const groups=['raw','integer','float','numeric','component','dot','constant','structured','indirect','loop'];
for(const entry of [...groups.flatMap(g=>native[g+'Cases']),...native.cases])if(entry.result.ok){const result=parseConstantDomain(entry.result.metadata,entry.stage);assert.equal(result.ok,true,entry.name);checks.push({name:entry.name,metadata:entry.result.metadata,stage:entry.stage,result});}
const singles=native.cases.filter(e=>e.name==='eq-vertex'||e.name==='eq-fragment');
for(const entry of singles){const original=entry.result.metadata;observe('valid13-'+entry.stage,original,entry.stage,{ok:true,domain:null});
 for(const key of ['constantDomains','constantAccesses','constantConstraints'])for(const value of [[],null,{},0,false]){const md={...original,[key]:value},result=parseConstantDomain(md,entry.stage);assert.equal(result.ok,false);checks.push({name:'forbidden13-'+key,metadata:md,stage:entry.stage,result});}
 for(const key of ['constantDomains','constantAccesses','constantConstraints']){const md={...original};Object.defineProperty(md,key,{get(){getters++;throw new Error('invoked');},enumerable:true});assert.equal(parseConstantDomain(md,entry.stage).ok,false);}
 const unknown={...original,profile:'virgl-webgl2-raw-bits-v14'};assert.equal(parseConstantDomain(unknown,entry.stage).ok,false);checks.push({name:'unknown14',metadata:unknown,stage:entry.stage,result:parseConstantDomain(unknown,entry.stage)});
 const parsed=observe('owned13',original,entry.stage,{ok:true,domain:null});original.uniforms[0].count=1;assert.deepEqual(parsed,{ok:true,domain:null});original.uniforms[0].count=46;
}
for(const entry of native.cases.filter(e=>e.name.startsWith('loop-equality'))){const parsed=parseConstantDomain(entry.result.metadata,entry.stage),words=Array(184).fill(0);words[36]=18;assert.equal(checkLoopBank(words,46).ok,true);words[36]=19;assert.equal(checkLoopBank(words,46).ok,false);assert.equal(parsed.constraint.maximum,18);}
assert.equal(getters,0);const names=['renderer/virgl-command/constant-domain.mjs','tools/virgl-raw-equality/consumer.mjs'];const sources=names.map(name=>{const raw=fs.readFileSync(name);return{path:name,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({schema:'raw-equality-consumer-v1',status:'passed',checks,getters,sources},null,2)+'\n');console.log('constant obligation checks',checks.length,'getters',getters);
