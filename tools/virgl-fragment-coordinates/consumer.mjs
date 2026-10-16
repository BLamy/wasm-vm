#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,checkConversionBank,checkIndirectBank,checkRasterBank,checkRadialBank,checkLoopBank} from '../../renderer/virgl-command/constant-domain.mjs';
const native=JSON.parse(fs.readFileSync(process.argv[2])),bridge=await createVirglShaderBridge();
const report={schema:'virgl-fragment-coordinate-consumer-v1',task:'E6-T12g6k',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'),contracts:[],forgeries:[],banks:[],combined:[],accessorInvocations:0};
const inert=value=>{if(value===null||typeof value!=='object')return value;const copy=Array.isArray(value)?[]:{};
 for(const [key,d]of Object.entries(Object.getOwnPropertyDescriptors(value)))if(d.enumerable)copy[key]=Object.hasOwn(d,'value')?inert(d.value):'[accessor]';return copy;};
const bad=(metadata,stage,name)=>{const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,false,name);assert.equal(result.error.code,'shader-domain-error');report.forgeries.push({name,metadata:inert(metadata),result});};
const seen=new Set();
for(const c of native.cases.filter(c=>c.ok)){
 const metadata=c.result.metadata,contract=parseConstantDomain(metadata,c.stage);assert.equal(contract.ok,true,c.name);assert.ok(contract.coordinates);
 report.contracts.push({name:c.name,metadata,contract});
 const mutable=structuredClone(metadata),owned=parseConstantDomain(mutable,c.stage),before=JSON.stringify(owned);mutable.coordinateContract.origin='upper-left';mutable.inputs[0].name='forged';assert.equal(JSON.stringify(owned),before);assert.ok(Object.isFrozen(owned.coordinates));
 if(c.base){const base=bridge.translate({stage:c.base.stage,text:c.base.text});assert.equal(base.ok,true,c.name);const restored=structuredClone(metadata);restored.profile=restored.coordinateBaseProfile;delete restored.coordinateBaseProfile;delete restored.coordinateContract;restored.inputs=restored.inputs.filter(i=>i.semantic!=='POSITION');
  const expected={...base.metadata,inputs:base.metadata.inputs.filter(i=>i.index!==0)};assert.deepEqual(restored,expected,c.name+' complete underlying policies');report.combined.push({name:c.name,base:base.metadata,restored,contract});}
 const signature=JSON.stringify(metadata);if(seen.has(signature))continue;seen.add(signature);
 const mutations=[['missing policy',m=>delete m.coordinateContract],['missing base',m=>delete m.coordinateBaseProfile],['recursive base',m=>m.coordinateBaseProfile=m.profile],['unknown base',m=>m.coordinateBaseProfile='other'],['legacy base',m=>m.coordinateBaseProfile='virgl-webgl2-straight-line-v5'],['profile downgrade',m=>m.profile=m.coordinateBaseProfile],['remove builtin',m=>m.inputs=m.inputs.filter(i=>i.semantic!=='POSITION')],['duplicate builtin',m=>m.inputs.push(structuredClone(m.inputs[0]))],['builtin is GENERIC',m=>m.inputs[0].semantic='GENERIC'],['extra policy',m=>m.coordinateContract.extra=true]];
 for(const key of Object.keys(metadata.coordinateContract))mutations.push(['policy '+key,m=>m.coordinateContract[key]=typeof m.coordinateContract[key]==='number'?true:'other']);
 for(const key of ['index','name','type','semantic','semanticIndex','componentMask','interpolation'])mutations.push(['POSITION '+key,m=>m.inputs[0][key]=typeof m.inputs[0][key]==='number'?true:'other']);
 const neighbor=metadata.inputs.find(i=>i.semantic==='GENERIC');if(neighbor)for(const [key,value]of [['index',0],['index',8],['name','gl_FragCoord'],['type','vec3'],['semantic','POSITION'],['semanticIndex',8],['componentMask',1],['interpolation','linear']])mutations.push(['neighbor '+key+' '+value,m=>m.inputs.find(i=>i.semantic==='GENERIC')[key]=value]);
 for(const key of Object.keys(metadata).filter(k=>/^(constant|.*BaseProfile$|.*Contract$)/.test(k)&&!['coordinateBaseProfile','coordinateContract'].includes(k)))mutations.push(['erase '+key,m=>delete m[key]]);
 for(const [name,mutate]of mutations){const copy=structuredClone(metadata);mutate(copy);bad(copy,c.stage,c.name+'/'+name);}
 for(const target of ['coordinateContract','inputs','coordinateBaseProfile']){const copy=structuredClone(metadata);Object.defineProperty(copy,target,{enumerable:true,get(){report.accessorInvocations++;return null;}});bad(copy,c.stage,c.name+'/accessor '+target);}
 for(const key of Object.keys(metadata.coordinateContract)){const copy=structuredClone(metadata);Object.defineProperty(copy.coordinateContract,key,{enumerable:true,get(){report.accessorInvocations++;return 'bad';}});bad(copy,c.stage,c.name+'/policy accessor '+key);}
 for(const key of ['index','name','type','semantic','semanticIndex','componentMask','interpolation']){const copy=structuredClone(metadata);Object.defineProperty(copy.inputs[0],key,{enumerable:true,get(){report.accessorInvocations++;return 'bad';}});bad(copy,c.stage,c.name+'/POSITION accessor '+key);}
 bad(metadata,'vertex',c.name+'/foreign stage');
 const downgraded=structuredClone(metadata);downgraded.profile=downgraded.coordinateBaseProfile;delete downgraded.coordinateBaseProfile;delete downgraded.coordinateContract;bad(downgraded,'fragment',c.name+'/builtin without wrapper');
 if(!contract.domain&&!contract.conversionDomain&&!metadata.uniforms.length)continue;
 const count=(contract.domain??contract.conversionDomain)?.count??metadata.uniforms[0].count,words=Array(Math.min(count,46)*4).fill(0);if(contract.radialDomain)words[16]=0x3f800000;
 const check=w=>contract.conversionDomain?checkConversionBank(w,contract.conversionDomain,contract):contract.rasterDomain?checkRasterBank(w,contract.rasterDomain,!!contract.constraint,!!contract.radialDomain):contract.radialDomain?checkRadialBank(w,count,!!contract.constraint):contract.constraint?checkLoopBank(w,count):checkIndirectBank(w,count,contract.domain!==null);
 const approved=check(words);assert.equal(approved.ok,true,c.name);words.fill(0xdeadbeef);assert.notDeepEqual(words,approved.words);assert.ok(Object.isFrozen(approved.words));const row={name:c.name,contract,safe:approved.words,checks:[]};report.banks.push(row);
 for(const value of [0,0x80000000,1,0x80000001,0x00800000,0x80800000,0x3fc00000,0xbfc00000,0x7f800000,0xff800000,0x7fc12345]){
  const w=approved.words.slice();w[0]=value;const result=check(w),special=(value&0x7f800000)===0x7f800000,raster=contract.rasterDomain?.components.some(e=>e.register===0&&(e.mask&1));
  const wanted=(!(contract.domain||contract.conversionDomain)||!special)&&!(raster&&(value===1||value===0x80000001));assert.equal(result.ok,wanted,c.name+' inherited numerical bank restriction');row.checks.push({value,wanted,result});}
 assert.equal(check(approved.words.slice(0,-4)).ok,false,'declared bank prefix survives coordinate wrapper');
}
assert.equal(report.accessorInvocations,0);assert.equal(report.combined.length,4);report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(`${report.contracts.length} coordinate policies; ${report.forgeries.length} metadata attacks and ${report.banks.length} inherited owned banks passed.`);
