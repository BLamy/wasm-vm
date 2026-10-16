#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
import {approve} from '../../renderer/virgl-shader/tests/original-corpus.mjs';
import {fragmentVectors,vertexVectors,word} from './oracle.mjs';
const manifest=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/original-corpus.json')),report={schema:'original-corpus-consumer-v1',status:'passed',contracts:[],forgeries:[],banks:[],ownership:[],getters:0};
const clone=x=>JSON.parse(JSON.stringify(x));
for(const original of manifest.originals){
 const metadata=clone(original.metadata),parsed=parseConstantDomain(metadata,original.stage);assert.equal(parsed.ok,true);report.contracts.push({sha256:original.sha256,metadata:clone(metadata),parsed});
 for(const key of ['profile','stage',...Object.keys(metadata).filter(k=>k.endsWith('Domains')||k.endsWith('Contract')||k.endsWith('BaseProfile')||['constantAccesses','constantConstraints'].includes(k))]){
  const bad=clone(metadata);delete bad[key];const result=parseConstantDomain(bad,original.stage);assert.equal(result.ok,false,original.sha256+'/'+key);report.forgeries.push({sha256:original.sha256,removed:key,metadata:bad,result});
  const accessor=clone(metadata);Object.defineProperty(accessor,key,{enumerable:true,get(){report.getters++;throw new Error('caller getter');}});assert.equal(parseConstantDomain(accessor,original.stage).ok,false);
 }
 const before=JSON.stringify(parsed);for(const key of Object.keys(metadata))if(Array.isArray(metadata[key]))metadata[key].length=0;assert.equal(JSON.stringify(parsed),before);report.ownership.push({sha256:original.sha256,parsed,before});
 const input={...original,text:fs.readFileSync(original.path,'utf8')};
 const vector=original.stage==='vertex'?vertexVectors(input)[0]:fragmentVectors(input)[0];
 let values=original.stage==='vertex'?vector.constants.flat().map(word):vector.bank??(vector.constants?.length?vector.constants.map(word):[]),count=original.metadata.uniforms[0]?.count??0;
 // Flat input comes from the vertex bank; its fragment declares no bank.
 if(!count)values=[];
 const outcome=approve(original.metadata,values,count);assert.equal(outcome.ok,true);report.banks.push({sha256:original.sha256,kind:'valid',words:values,activeCount:count,result:outcome});
 if(!parsed.domain)continue;
 const attack=(kind,words,error)=>{const result=approve(original.metadata,words,count);assert.equal(result.ok,error===null,original.sha256+'/'+kind);if(error)assert.equal(result.error.code,error);report.banks.push({sha256:original.sha256,kind,words,activeCount:count,result});};
 attack('short',values.slice(0,-4),'incomplete-draw');
 for(const bad of [0x7f800000,0xff800000,0x7fc00000]){const words=values.slice();words[0]=bad;attack('non-finite-'+bad,words,'constant-domain-error');}
 if(parsed.constraint){for(const raw of [19,0x7fffffff]){const words=values.slice();words[36]=raw;attack('loop-count-'+raw,words,raw===0x7fffffff?'constant-domain-error':'constant-constraint-error');}const words=values.slice();words[36]=0x80000001;attack('negative-signed-count',words,null);}
 if(parsed.radialDomain){for(const raw of [0,0x80000000,0x3727c5ab]){const words=values.slice();words[16]=raw;attack('unsafe-radial-'+raw,words,'constant-radial-domain-error');}}
 if(parsed.rasterDomain){const lane=parsed.rasterDomain.components[0].register*4+3;for(const raw of [1,0x80000001,0x007fffff]){const words=values.slice();words[lane]=raw;attack('unsafe-raster-'+raw,words,'constant-raster-domain-error');}const words=values.slice();words[lane]=0x80000000;attack('signed-zero-raster',words,null);}
}
assert.equal(report.getters,0);
report.sources=['tools/virgl-original-corpus/consumer.mjs','tools/virgl-original-corpus/oracle.mjs','renderer/virgl-shader/tests/original-corpus.json','renderer/virgl-shader/tests/original-corpus.mjs','renderer/virgl-command/constant-domain.mjs'].map(path=>{const raw=fs.readFileSync(path);return{path,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};});
console.log(JSON.stringify(report));
