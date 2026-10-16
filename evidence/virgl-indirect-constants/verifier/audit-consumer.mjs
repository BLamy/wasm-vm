import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseConstantDomain,checkIndirectBank} from '../../../renderer/virgl-command/constant-domain.mjs';
const rows=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=new URL('../../../',import.meta.url),out=new URL('./',import.meta.url);
function check(name,result,expected){assert.equal(result.ok,expected,name);rows.push({name,result});return result;}
function metadata(stage,version,count=46){const name=stage==='vertex'?'vsconst0':'fsconst0';const bank={stage,slot:0,name,count};return {profile:`virgl-webgl2-raw-bits-v${version}`,stage,inputs:[],outputs:[],attributes:[],uniforms:[{name,type:'uvec4[]',count,encoding:'float32-bits'}],samplers:[],uniformBlocks:[],constantAccesses:[{kind:'constant-bank-static-indirect-v1',...bank,indices:[0,17,45]}],...(version===11?{constantDomains:[{kind:'constant-bank-finite-f32-v1',...bank}]}:{})};}
for(const stage of ['vertex','fragment'])for(const version of [10,11]){
 for(const [path,value] of [['constantAccesses.0.slot',false],['constantAccesses.0.slot',true],['constantAccesses.0.count',true],['constantAccesses.0.indices.0',false],['constantAccesses.0.indices.1',true],['uniforms.0.count',true],['constantAccesses.0.count',46.25],['constantAccesses.0.indices.1',17.5],['constantAccesses.0.name','vsconst1'],['constantAccesses.0.indices',[0,46]],['constantAccesses.0.indices',[45,17,0]]]){
  const input=metadata(stage,version),keys=path.split('.');let parent=input;for(const k of keys.slice(0,-1))parent=parent[k];parent[keys.at(-1)]=value;check(`${stage}-v${version}-${path}-${JSON.stringify(value)}`,parseConstantDomain(input,stage),false);
 }
 const input=metadata(stage,version),result=check(`${stage}-v${version}-owned`,parseConstantDomain(input,stage),true);
 input.constantAccesses[0].indices.reverse(); input.constantAccesses[0].indices.push(46); input.constantAccesses[0].count=1;
 assert.deepEqual(result.access.indices,[0,17,45]);assert.equal(result.access.count,46);assert.ok(Object.isFrozen(result.access.indices));
}
let state=0xA869D7E1;function rand(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
for(let count=1;count<=47;count++)for(const finite of [false,true]){
 const length=Math.min(count,46)*4;
 const words=Array.from({length},()=>finite?(rand()&0x807fffff)>>>0:rand());
 const before=[...words],result=check(`extent-${count}-${finite}`,checkIndirectBank(words,count,finite),true);
 words.fill(0xffffffff);assert.deepEqual(result.words,before);assert.notEqual(result.words,words);assert.ok(Object.isFrozen(result.words));
 for(let n=0;n<length;n+=4){const short=check(`missing-${count}-${finite}-${n}`,checkIndirectBank(before.slice(0,n),count,finite),false);assert.equal(short.error.code,'incomplete-draw');}
 for(const bad of [false,true,-1,0x100000000,0.5]){const poisoned=[...before];poisoned[length-1]=bad;check(`invalid-word-${count}-${finite}-${bad}`,checkIndirectBank(poisoned,count,finite),false);}
}
for(let lane=0;lane<184;lane++)for(const bad of [0x7f800000,0xff800000,0x7fa019a3,0xffa019a3]){const words=new Array(184).fill(0);words[lane]=bad;check(`nonfinite-${lane}-${bad}`,checkIndirectBank(words,47,true),false);assert.equal(checkIndirectBank(words,47,false).ok,true);}
let getters=0;const words=[0,0,0,0];Object.defineProperty(words,2,{get(){getters++;return 0;}});check('bank-accessor',checkIndirectBank(words,1,false),false);assert.equal(getters,0);
const source='renderer/virgl-command/constant-domain.mjs',bytes=await fs.readFile(new URL(source,root));
await fs.writeFile(new URL('consumer-attack-report.json',out),JSON.stringify({schema:1,cases:rows.length,getters,source:{path:source,bytes:bytes.length,sha256:sha(bytes)},rows},null,2)+'\n');
console.log(`Independent consumer passed: ${rows.length} schema/prefix/type/ownership cases; seed 0xA869D7E1.`);
