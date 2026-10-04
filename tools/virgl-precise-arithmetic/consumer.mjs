#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,checkRasterBank,checkRadialBank,checkLoopBank,checkFiniteBank} from '../../renderer/virgl-command/constant-domain.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/precise-arithmetic-cases.json',import.meta.url)));
const bridge=await createVirglShaderBridge({wasmBinary:fs.readFileSync(new URL('../../renderer/virgl-shader/build/wasm/virgl-shader.wasm',import.meta.url))});
const clone=structuredClone,report={schema:'precise-arithmetic-consumer-v1',status:'running',contracts:[],forgeries:[],ownership:[],combined:[]};
let invoked=0;
for(const entry of fixture.cases.filter(e=>e.ok&&e.expected.preciseArithmeticContract)){
  const result=bridge.translate({stage:entry.stage,text:entry.text});assert.equal(result.ok,true,entry.name);
  const base=result.metadata,checked=parseConstantDomain(base,entry.stage);assert.equal(checked.ok,true,entry.name);
  assert.deepEqual(checked.arithmetic,entry.expected.preciseArithmeticContract);
  report.contracts.push({case:entry.name,result,checked});
  const mutations=[['drop arithmetic',m=>delete m.preciseArithmeticContract],['drop base',m=>delete m.arithmeticBaseProfile],
    ['recursive base',m=>m.arithmeticBaseProfile=m.profile],['unknown base',m=>m.arithmeticBaseProfile='unknown'],
    ['legacy base',m=>m.arithmeticBaseProfile='virgl-webgl2-straight-line-v5'],['downgrade outer',m=>m.profile=m.arithmeticBaseProfile],
    ['wrong kind',m=>m.preciseArithmeticContract.kind='other'],['wrong stage',m=>m.preciseArithmeticContract.stage=entry.stage==='vertex'?'fragment':'vertex'],
    ['empty operations',m=>m.preciseArithmeticContract.operations=[]],['unknown operation',m=>m.preciseArithmeticContract.operations=['MAD']],
    ['unsorted',m=>m.preciseArithmeticContract.operations=['MUL','ADD']],['duplicate',m=>m.preciseArithmeticContract.operations=['ADD','ADD']],
    ['rounding policy',m=>m.preciseArithmeticContract.rounding='toward-zero'],['nan policy',m=>m.preciseArithmeticContract.nan='preserve-payload'],
    ['underflow policy',m=>m.preciseArithmeticContract.subnormals='flush'],['extra field',m=>m.preciseArithmeticContract.extra=true],
    ['boolean operation',m=>m.preciseArithmeticContract.operations=[true]],['sparse operation',m=>{m.preciseArithmeticContract.operations.length=2;delete m.preciseArithmeticContract.operations[0];}]];
  for(const key of ['constantDomains','constantAccesses','constantConstraints','constantRadialDomains','constantRasterDomains','rasterBaseProfile','preciseWordContract'])
    if(Object.hasOwn(base,key))mutations.push(['erase '+key,m=>delete m[key]]);
  for(const [name,mutate]of mutations){const bad=clone(base);mutate(bad);const value=parseConstantDomain(bad,entry.stage);assert.equal(value.ok,false,entry.name+'/'+name);assert.equal(value.error.code,'shader-domain-error');report.forgeries.push({case:entry.name,name,metadata:bad,result:value});}
  for(const key of ['kind','stage','operations','rounding','nan','subnormals']){
    const bad=clone(base);Object.defineProperty(bad.preciseArithmeticContract,key,{enumerable:true,get(){invoked++;return key;}});
    const value=parseConstantDomain(bad,entry.stage);assert.equal(value.ok,false);report.forgeries.push({case:entry.name,name:'accessor '+key,result:value});
  }
  const before=JSON.stringify(checked.arithmetic);base.preciseArithmeticContract.operations[0]='MAD';base.preciseArithmeticContract.nan='bad';
  assert.equal(JSON.stringify(checked.arithmetic),before);assert.ok(Object.isFrozen(checked.arithmetic)&&Object.isFrozen(checked.arithmetic.operations));
  report.ownership.push({case:entry.name,owned:checked.arithmetic});
  if(checked.domain){
    const words=Array(Math.min(checked.domain.count,46)*4).fill(0);if(checked.constraint)words[36]=2;if(checked.radialDomain)words[16]=0x3f800000;
    const approve=values=>checked.rasterDomain?checkRasterBank(values,checked.rasterDomain,!!checked.constraint,!!checked.radialDomain):
      checked.radialDomain?checkRadialBank(values,checked.domain.count,!!checked.constraint):checked.constraint?
      checkLoopBank(values,checked.domain.count):checkFiniteBank(values,Math.min(checked.domain.count,46));
    assert.equal(approve(words).ok,true,entry.name);const corrupt=words.slice();corrupt[0]=0x7f800000;assert.equal(approve(corrupt).ok,false);
    report.combined.push({case:entry.name,name:'finite prefix',good:words,bad:corrupt});
    if(checked.constraint){const bad=words.slice();bad[36]=19;assert.equal(approve(bad).ok,false);report.combined.push({case:entry.name,name:'integer count',bad});}
    if(checked.radialDomain){const bad=words.slice();bad[16]=0;assert.equal(approve(bad).ok,false);report.combined.push({case:entry.name,name:'radial coefficient',bad});}
    if(checked.rasterDomain)for(const c of checked.rasterDomain.components)for(let lane=0;lane<4;lane++)if(c.mask&(1<<lane)){
      const bad=words.slice();bad[c.register*4+lane]=1;assert.equal(approve(bad).ok,false);report.combined.push({case:entry.name,name:'copied subnormal',register:c.register,lane,bad});
    }
  }
}
assert.equal(invoked,0,'no hostile accessor invoked');report.status='passed';report.accessorInvocations=invoked;process.stdout.write(JSON.stringify(report)+'\n');
