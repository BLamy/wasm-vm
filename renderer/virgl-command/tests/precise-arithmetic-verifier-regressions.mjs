// Fresh-verifier regression: precise words cannot steal ordinary numeric or copied-bank authority.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';
import {parseConstantDomain,checkRasterBank} from '../constant-domain.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../virgl-shader/tests/precise-arithmetic-cases.json',import.meta.url)));
assert.ok(process.argv.length===2||(process.argv.length===4&&process.argv[2]==='--wasm'),'only an explicit source-fault Wasm override');
const binary=process.argv[3]??new URL('../../virgl-shader/build/wasm/virgl-shader.wasm',import.meta.url);
const bridge=await createVirglShaderBridge({wasmBinary:fs.readFileSync(binary)});
const report={status:'running',cases:[],forgeries:[],accessors:0};
for(const stage of ['vertex','fragment']){
 const original=fixture.cases.find(e=>e.name==='arithmetic-add-xyzw-direct-'+stage).text;
 const target=stage==='vertex'?'OUT[1]':'OUT[0]';
 const exposed=original.replace('MOV '+target+', TEMP[115]','MOV '+target+', TEMP[117]');
 assert.notEqual(exposed,original);
 const zero=exposed.replace('ADD_PRECISE TEMP[117].xyzw, TEMP[0], TEMP[1]','MUL_PRECISE TEMP[117].xyzw, TEMP[0], IMM[0].xxxx');
 const reversed=exposed.replace('ADD_PRECISE TEMP[117].xyzw, TEMP[0], TEMP[1]','ADD_PRECISE TEMP[117].xyzw, IMM[0].xxxx, TEMP[0]');
 const reversedZero=exposed.replace('ADD_PRECISE TEMP[117].xyzw, TEMP[0], TEMP[1]','MUL_PRECISE TEMP[117].xyzw, IMM[0].xxxx, TEMP[0]');
 const copied=exposed.replace('ADD_PRECISE TEMP[117].xyzw, TEMP[0], TEMP[1]','ADD_PRECISE TEMP[117].xyzw, TEMP[0], IMM[0].xxxx');
 for(const [name,text]of [['private output',exposed],['multiply zero shortcut',zero],['add zero shortcut',copied],['safe left private right',reversed],['safe zero left private right',reversedZero]]){
  const result=bridge.translate({stage,text});assert.equal(result.ok,false,name+'/'+stage);assert.equal(result.error.code,'unsupported-feature');report.cases.push({name,stage,text,result});
 }
 const combined=fixture.cases.find(e=>e.name==='numeric-raster-mixed-'+stage).text;
 const poisoned=combined.replace('DCL TEMP[0]','DCL TEMP[0]\nIMM[2] UINT32 {65535,65535,65535,65535}').replace('ADD_PRECISE TEMP[0], IMM[0], IMM[1].xxxx','AND TEMP[0], CONST[1], IMM[2]\nADD_PRECISE TEMP[0], TEMP[0], IMM[1].xxxx');
 assert.notEqual(poisoned,combined);
 const result=bridge.translate({stage,text:poisoned});assert.equal(result.ok,false,'derived bank low bits must not borrow raster authority');report.cases.push({name:'private-bank mixed raster',stage,text:poisoned,result});
 const good=bridge.translate({stage,text:combined});assert.equal(good.ok,true);report.cases.push({name:'authorized mixed raster',stage,text:combined,result:good});const approved=parseConstantDomain(good.metadata,stage);assert.equal(approved.ok,true);
 for(const key of ['constantDomains','constantRasterDomains','rasterBaseProfile']){
  const bad=structuredClone(good.metadata);delete bad[key];const rejection=parseConstantDomain(bad,stage);assert.equal(rejection.ok,false,key);report.forgeries.push({name:'nested v27 erase '+key,stage,metadata:bad,result:rejection});
 }
 const invalid=structuredClone(good.metadata);invalid.preciseArithmeticContract.operations=[];assert.equal(parseConstantDomain(invalid,stage).ok,false);
 const bank=Array(approved.domain.count*4).fill(0);bank[0]=0x3f800000;assert.equal(checkRasterBank(bank,approved.rasterDomain).ok,true);
 for(let lane=0;lane<4;lane++){
  const words=bank.slice();words[lane]=1;
  const result=checkRasterBank(words,approved.rasterDomain);
  // The mixed certificate guards only zw; xy retain the existing finite policy.
  assert.equal(result.ok,lane<2);report.cases.push({name:'mixed bank lane guard',stage,lane,words,result});
 }
 for(const key of ['arithmeticBaseProfile','preciseArithmeticContract']){
  const bad=structuredClone(good.metadata);Object.defineProperty(bad,key,{enumerable:true,get(){report.accessors++;throw new Error('must not invoke getter');}});
  const result=parseConstantDomain(bad,stage);assert.equal(result.ok,false);report.forgeries.push({name:'top accessor '+key,stage,result});
 }
}
assert.equal(report.accessors,0);report.status='passed';process.stdout.write(JSON.stringify(report)+'\n');
