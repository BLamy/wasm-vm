#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseConstantDomain,checkConversionBank,checkIndirectBank,checkRasterBank,checkRadialBank,checkLoopBank} from '../../renderer/virgl-command/constant-domain.mjs';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const native=JSON.parse(fs.readFileSync(process.argv[2])),bridge=await createVirglShaderBridge();
const report={schema:'virgl-minimum-selection-consumer-v1',task:'E6-T12g6g1',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  nativeSha256:createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'),contracts:[],forgeries:[],banks:[],combined:[],accessorInvocations:0};
const inert=value=>{if(value===null||typeof value!=='object')return value;const copy=Array.isArray(value)?[]:{};
  for(const [key,d]of Object.entries(Object.getOwnPropertyDescriptors(value)))if(d.enumerable)copy[key]=Object.hasOwn(d,'value')?inert(d.value):'[accessor]';return copy;};
const bad=(metadata,stage,name)=>{const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,false,name);assert.equal(result.error.code,'shader-domain-error');report.forgeries.push({name,metadata:inert(metadata),result});};
const seen=new Set();
for(const c of native.cases.filter(c=>c.ok)){
  const metadata=c.result.metadata,contract=parseConstantDomain(metadata,c.stage);assert.equal(contract.ok,true,c.name);assert.ok(contract.minimum);
  report.contracts.push({name:c.name,metadata,contract});
  if(c.base){const base=bridge.translate({stage:c.stage,text:c.base.text});assert.equal(base.ok,true);const restored=structuredClone(metadata);
    restored.profile=restored.minimumBaseProfile;delete restored.minimumBaseProfile;delete restored.minimumWordContract;
    assert.deepEqual(restored,base.metadata,c.name+' complete existing base obligations');report.combined.push({name:c.name,base:base.metadata,restored,contract});}
  const mutable=structuredClone(metadata),owned=parseConstantDomain(mutable,c.stage),before=JSON.stringify(owned);
  mutable.minimumWordContract.operations[0]='FLOOR';assert.equal(JSON.stringify(owned),before);assert.ok(Object.isFrozen(owned.minimum)&&Object.isFrozen(owned.minimum.operations));
  const key=JSON.stringify(metadata);if(seen.has(key))continue;seen.add(key);
  const mutations=[['missing policy',m=>delete m.minimumWordContract],['missing base',m=>delete m.minimumBaseProfile],
    ['recursive base',m=>m.minimumBaseProfile=m.profile],['unknown base',m=>m.minimumBaseProfile='other'],
    ['legacy base',m=>m.minimumBaseProfile='virgl-webgl2-straight-line-v5'],['profile downgrade',m=>m.profile=m.minimumBaseProfile],
    ['wrong kind',m=>m.minimumWordContract.kind='other'],['wrong stage',m=>m.minimumWordContract.stage=c.stage==='vertex'?'fragment':'vertex'],
    ['ordinary',m=>m.minimumWordContract.ordinary='all-private-words'],['precise',m=>m.minimumWordContract.precise='first-on-unordered'],
    ['modifiers',m=>m.minimumWordContract.modifiers='after-selection'],['output',m=>m.minimumWordContract.output='all-private-words'],
    ['empty operations',m=>m.minimumWordContract.operations=[]],['bad operation',m=>m.minimumWordContract.operations=['FLOOR']],
    ['duplicates',m=>m.minimumWordContract.operations=['MIN','MIN']],['unsorted',m=>m.minimumWordContract.operations=['MIN_PRECISE','MIN']],
    ['boolean operation',m=>m.minimumWordContract.operations=[true]],['extra field',m=>m.minimumWordContract.extra=true],
    ['sparse operations',m=>{m.minimumWordContract.operations.length=2;delete m.minimumWordContract.operations[0];}]];
  for(const key of ['constantDomains','constantAccesses','constantConstraints','constantRadialDomains','constantRasterDomains','rasterBaseProfile','preciseWordContract','arithmeticBaseProfile','preciseArithmeticContract','constantConversionDomains','conversionBaseProfile','signedConversionContract','scalarBaseProfile','scalarWordContract'])
    if(Object.hasOwn(metadata,key))mutations.push(['erase '+key,m=>delete m[key]]);
  for(const [name,mutate]of mutations){const copy=structuredClone(metadata);mutate(copy);bad(copy,c.stage,c.name+'/'+name);}
  for(const key of ['kind','stage','operations','ordinary','precise','modifiers','output']){const copy=structuredClone(metadata);
    Object.defineProperty(copy.minimumWordContract,key,{enumerable:true,get(){report.accessorInvocations++;return 'bad';}});bad(copy,c.stage,c.name+'/accessor '+key);}
  if(!contract.domain&&!contract.conversionDomain&&!metadata.uniforms.length)continue;
  const count=(contract.domain??contract.conversionDomain)?.count??metadata.uniforms[0].count,words=Array(Math.min(count,46)*4).fill(0);
  if(contract.radialDomain)words[16]=0x3f800000;
  const check=w=>contract.conversionDomain?checkConversionBank(w,contract.conversionDomain,contract):contract.rasterDomain?checkRasterBank(w,contract.rasterDomain,!!contract.constraint,!!contract.radialDomain):contract.radialDomain?checkRadialBank(w,count,!!contract.constraint):contract.constraint?checkLoopBank(w,count):checkIndirectBank(w,count,contract.domain!==null);
  const approved=check(words);assert.equal(approved.ok,true,c.name);words.fill(0xdeadbeef);assert.notDeepEqual(words,approved.words);assert.ok(Object.isFrozen(approved.words));
  const row={name:c.name,contract,safe:approved.words,checks:[]};report.banks.push(row);
  for(const value of [0,0x80000000,1,0x80000001,0x00800000,0x80800000,0x3fc00000,0xbfc00000,0x7f800000,0xff800000,0x7fc12345]){
    const w=approved.words.slice();w[0]=value;const result=check(w),special=(value&0x7f800000)===0x7f800000;
    const raster=contract.rasterDomain?.components.some(e=>e.register===0&&(e.mask&1));
    const wanted=(!(contract.domain||contract.conversionDomain)||!special)&&!(raster&&(value===1||value===0x80000001));assert.equal(result.ok,wanted,c.name+' inherited finite/raster restriction');row.checks.push({value,wanted,result});}
  assert.equal(check(approved.words.slice(0,-4)).ok,false,'declared prefix survives wrapper');
}
assert.equal(report.accessorInvocations,0);report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(`${report.contracts.length} minimum contracts; ${report.forgeries.length} metadata attacks and ${report.banks.length} owned banks passed.`);
