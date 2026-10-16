import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const output=path.dirname(fileURLToPath(import.meta.url));
const file=process.argv[2]??fileURLToPath(new URL('../../../renderer/virgl-command/constant-domain.mjs',import.meta.url));
const {checkLoopBank,parseConstantDomain}=await import(pathToFileURL(file));
let seed=0xa705fe23; const draws=[];
const random=()=>seed=(Math.imul(seed,22695477)+1)>>>0;
for(const word of [0,1,17,18,19,20,0x80000000,0x80000001,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0xffffffff,...Array.from({length:256},random)]){
 const words=Array(184).fill(0); words[36]=word;
 const expected=((word&0x7f800000)!==0x7f800000)&&((word|0)<=18);
 const result=checkLoopBank(words,46);assert.equal(result.ok,expected,`word ${word.toString(16)}`);
 if(expected){words[36]=19;assert.equal(result.words[36],word);assert.ok(Object.isFrozen(result.words));}
 draws.push({word,expected,result});
}
let calls=0;const words=Array(184).fill(0);Object.defineProperty(words,'36',{get(){calls++;return 18;},enumerable:true});assert.equal(checkLoopBank(words,46).ok,false);assert.equal(calls,0);
const meta={profile:'virgl-webgl2-raw-bits-v12',stage:'vertex',inputs:[],outputs:[],attributes:[],uniforms:[{name:'vsconst0',type:'uvec4[]',count:46,encoding:'float32-bits'}],samplers:[],uniformBlocks:[],constantDomains:[{kind:'constant-bank-finite-f32-v1',stage:'vertex',slot:0,name:'vsconst0',count:46}],constantAccesses:[{kind:'constant-bank-static-indirect-v1',stage:'vertex',slot:0,name:'vsconst0',count:46,indices:Array.from({length:36},(_,i)=>10+i)}],constantConstraints:[{kind:'constant-bank-counted-table-i32-v1',stage:'vertex',slot:0,name:'vsconst0',count:46,register:9,component:0,maximum:18}]};
assert.equal(parseConstantDomain(meta,'vertex').ok,true);const mutations=[];
for(const key of ['slot','count','register','component','maximum'])for(const value of [true,false,null,'18',18.1,NaN,Infinity,{},[]]){const bad=structuredClone(meta);bad.constantConstraints[0][key]=value;const result=parseConstantDomain(bad,'vertex');assert.equal(result.ok,false,`${key}/${String(value)}`);mutations.push({key,value:String(value),result});}
for(let missing=10;missing<=45;missing++){const bad=structuredClone(meta);bad.constantAccesses[0].indices=bad.constantAccesses[0].indices.filter(x=>x!==missing);assert.equal(parseConstantDomain(bad,'vertex').ok,false);}
fs.writeFileSync(path.join(output,'consumer-results.json'),JSON.stringify({seed:'a705fe23',draws,mutations,missingIndicesRejected:36,accessorCalls:calls},null,2)+'\n');console.log('independent bank checks',draws.length,'typed metadata mutants',mutations.length,'all pass');
