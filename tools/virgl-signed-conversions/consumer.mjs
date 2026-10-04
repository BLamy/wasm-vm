#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseConstantDomain,checkConversionBank,signedConversionBinary32Word} from '../../renderer/virgl-command/constant-domain.mjs';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const native=JSON.parse(fs.readFileSync(process.argv[2])),bridge=await createVirglShaderBridge();
const report={schema:'virgl-signed-conversions-consumer-v1',task:'E6-T12g6e',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  nativeSha256:createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'),contracts:[],forgeries:[],banks:[],combined:[],accessorInvocations:0};
const bad=(metadata,stage,name)=>{const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,false,name);assert.equal(result.error.code,'shader-domain-error');report.forgeries.push({name,metadata,result});};
for(const c of native.cases.filter(c=>c.ok)){
  const metadata=c.result.metadata,contract=parseConstantDomain(metadata,c.stage);assert.equal(contract.ok,true,c.name);assert.ok(contract.conversion);
  report.contracts.push({name:c.name,metadata,contract});
  if(c.base){const base=bridge.translate({stage:c.stage,text:c.base.text});assert.equal(base.ok,true);const restored=structuredClone(metadata);
    restored.profile=restored.conversionBaseProfile;delete restored.conversionBaseProfile;delete restored.signedConversionContract;delete restored.constantConversionDomains;
    assert.deepEqual(restored,base.metadata,c.name+' every original base obligation');report.combined.push({name:c.name,base:base.metadata,restored,contract});
  }
  const mutations=[['missing policy',m=>delete m.signedConversionContract],['missing base',m=>delete m.conversionBaseProfile],
    ['recursive base',m=>m.conversionBaseProfile=m.profile],['unknown base',m=>m.conversionBaseProfile='other'],
    ['legacy base',m=>m.conversionBaseProfile='virgl-webgl2-straight-line-v5'],['profile downgrade',m=>m.profile=m.conversionBaseProfile],
    ['wrong kind',m=>m.signedConversionContract.kind='other'],['wrong stage',m=>m.signedConversionContract.stage=c.stage==='vertex'?'fragment':'vertex'],
    ['rounding',m=>m.signedConversionContract.integerToFloat='toward-zero'],['truncation',m=>m.signedConversionContract.floatToInteger='floor'],
    ['undefined domain',m=>m.signedConversionContract.domain='all-words'],['empty operations',m=>m.signedConversionContract.operations=[]],
    ['bad operation',m=>m.signedConversionContract.operations=['U2F']],['duplicates',m=>m.signedConversionContract.operations=['I2F','I2F']],
    ['unsorted',m=>m.signedConversionContract.operations=['F2I','I2F']],['boolean operation',m=>m.signedConversionContract.operations=[true]],
    ['extra policy field',m=>m.signedConversionContract.extra=true],['sparse operations',m=>{m.signedConversionContract.operations.length=2;delete m.signedConversionContract.operations[0];}]];
  for(const key of ['constantDomains','constantAccesses','constantConstraints','constantRadialDomains','constantRasterDomains','rasterBaseProfile','preciseWordContract','arithmeticBaseProfile','preciseArithmeticContract','constantConversionDomains'])
    if(Object.hasOwn(metadata,key))mutations.push(['erase '+key,m=>delete m[key]]);
  for(const [name,mutate]of mutations){const copy=structuredClone(metadata);mutate(copy);bad(copy,c.stage,c.name+'/'+name);}
  for(const key of ['kind','stage','operations','integerToFloat','floatToInteger','domain']){const copy=structuredClone(metadata);
    Object.defineProperty(copy.signedConversionContract,key,{enumerable:true,get(){report.accessorInvocations++;return 'bad';}});bad(copy,c.stage,c.name+'/accessor '+key);}
  const frozen=JSON.stringify(contract);const mutable=structuredClone(metadata),owned=parseConstantDomain(mutable,c.stage);mutable.signedConversionContract.operations[0]='U2F';
  assert.equal(JSON.stringify(owned),frozen);assert.ok(Object.isFrozen(owned.conversion)&&Object.isFrozen(owned.conversion.operations));
  if(!contract.conversionDomain)continue;
  const domain=contract.conversionDomain,words=Array(Math.min(domain.count,46)*4).fill(0);if(contract.radialDomain)words[16]=0x3f800000;
  const checked=checkConversionBank(words,domain,contract);assert.equal(checked.ok,true,c.name);words.fill(0xdeadbeef);assert.ok(checked.words.every((w,i)=>w===(contract.radialDomain&&i===16?0x3f800000:0)));assert.ok(Object.isFrozen(checked.words));
  const safe=checked.words.slice(),row={name:c.name,domain,safe,checked,rejections:[],admissions:[]};report.banks.push(row);
  for(const component of domain.components)for(let lane=0;lane<4;lane++)if(component.mask&(1<<lane)){
    for(const value of [0x4f000000,0x4f000001,0xcf000001,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7f800001,0xffc12345]){
      const bad=safe.slice();bad[component.register*4+lane]=value;const result=checkConversionBank(bad,domain,contract);assert.equal(result.ok,false,c.name+' forbidden word');row.rejections.push({register:component.register,lane,value,result});
    }
    for(const value of [0,0x80000000,1,0x80000001,0x3fc00000,0xbfc00000,0x4effffff,0xceffffff,0xcf000000]){
      const good=safe.slice();good[component.register*4+lane]=value;const result=checkConversionBank(good,domain,contract);
      const raster=contract.rasterDomain?.components.some(e=>e.register===component.register&&(e.mask&(1<<lane)));
      if(raster&&(value===1||value===0x80000001))assert.equal(result.ok,false,'base raster subnormal restriction preserved');
      else assert.equal(result.ok,true,c.name+' defined endpoint');row.admissions.push({register:component.register,lane,value,result});
    }
  }
  assert.equal(checkConversionBank(safe.slice(0,-4),domain,contract).ok,false,'complete declared prefix');
  if(contract.constraint){const bad=safe.slice();bad[36]=19;assert.equal(checkConversionBank(bad,domain,contract).ok,false);row.rejections.push({name:'base loop count',words:bad});}
  if(contract.radialDomain){const bad=safe.slice();bad[16]=0;assert.equal(checkConversionBank(bad,domain,contract).ok,false);row.rejections.push({name:'base radial coefficient',words:bad});}
  for(const field of ['count','stage','name','kind','slot','components']){const copy=structuredClone(metadata);const d=copy.constantConversionDomains[0];
    d[field]=field==='components'?[]:field==='count'?true:field==='slot'?1:'wrong';bad(copy,c.stage,c.name+'/bank '+field);}
}
for(const [w,wanted]of [[0,true],[0x80000000,true],[0xcf000000,true],[0x4effffff,true],[0x4f000000,false],[0xcf000001,false],[0x7f800000,false],[true,false],[-1,false],[1.5,false]])assert.equal(signedConversionBinary32Word(w),wanted);
assert.equal(report.accessorInvocations,0,'no metadata getter invoked');report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(`${report.contracts.length} conversion contracts, ${report.forgeries.length} metadata attacks and ${report.banks.length} owned range banks passed.`);
