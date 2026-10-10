#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createVirglStandardUniformShaderBridge,createVirglStandardShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {normalizeStandardUniformShaderResult,normalizeStandardUniformShaderPair,parseStandardUniformShaderMetadata,
  deriveStandardUniformShaderInterface,normalizeStandardShaderResult,normalizeStandardShaderPair} from '../../renderer/virgl-command/constant-domain.mjs';
import createModule from '../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
import {compilerCases,selectorKeys,zeroSelectors,basicVertex,basicFragment} from './cases.mjs';
import {hardwareFixtures} from './hardware-fixtures.mjs';
import {metadataAttacks} from './metadata-attacks.mjs';
const [mode,name]=process.argv.slice(2),output=path.resolve(name);await fs.mkdir(output,{recursive:true});
if(mode==='cases') {
  const cases=[...compilerCases(),...hardwareFixtures().map(fixture=>({name:fixture.name,kind:2,a:fixture.vertexText,b:fixture.fragmentText,
    selectors:fixture.selectors,okay:true,code:null}))],word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},parts=[word(cases.length)];
  for(const c of cases) {const a=Buffer.from(c.a),b=Buffer.from(c.b);parts.push(word(c.kind),...selectorKeys.map(k=>word(c.selectors[k])),word(a.length),a,word(b.length),b);}
  await fs.writeFile(path.join(output,'cases.bin'),Buffer.concat(parts));
  await fs.writeFile(path.join(output,'cases.json'),JSON.stringify({cases},null,2)+'\n');
} else if(mode==='audit') {
  const {cases}=JSON.parse(await fs.readFile(path.join(output,'cases.json'))),native=(await fs.readFile(path.join(output,'native.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(native.length,cases.length);const bridge=await createVirglStandardUniformShaderBridge(),old=await createVirglStandardShaderBridge(),raw=await createModule(),responses=[];
  function direct(c) {
    const pointers=[];
    try {
      for(const text of [c.a,c.b]) {const p=raw._malloc(text.length+1);assert.ok(p);pointers.push(p);raw.HEAPU8.set(Buffer.from(text),p);raw.HEAPU8[p+text.length]=0;}
      const [v,f]=pointers,m=selectorKeys.map(k=>c.selectors[k]);let p;
      if(c.kind<2)p=raw._bridge_translate_standard_uniform(c.kind,v,c.a.length);
      else if(c.kind<5)p=raw._bridge_translate_standard_uniform_pair(c.kind===3?0:v,c.a.length,c.kind===4?0:f,c.b.length,...m);
      else if(c.kind===5)p=raw._bridge_translate_standard_uniform(0,0,c.a.length);
      else if(c.kind===6)p=raw._bridge_translate_standard_uniform(-1,v,c.a.length);
      else if(c.kind<9)p=raw._bridge_translate_standard(c.kind-7,v,c.a.length);
      else if(c.kind===9)p=raw._bridge_translate_standard_pair(v,c.a.length,f,c.b.length);
      else if(c.kind===10)p=raw._bridge_translate_standard_pair_typed(v,c.a.length,f,c.b.length,...m.slice(0,2));
      else p=raw._bridge_translate_standard_pair_vertex_formats(v,c.a.length,f,c.b.length,...m.slice(0,4));
      return JSON.parse(raw.UTF8ToString(p));
    }finally{pointers.reverse().forEach(p=>raw._free(p));}
  }
  for(const [i,c]of cases.entries()) {
    const r=direct(c);assert.deepEqual(r,native[i].result,c.name+' complete native/Wasm response');assert.equal(r.ok,c.okay,c.name+' literal admission');
    if(!r.ok) {assert.equal(r.error.code,c.code,c.name);assert.deepEqual(Object.keys(r),['ok','error']);
      if(c.kind<7) {assert.equal(normalizeStandardUniformShaderResult(r,'vertex').ok,false);assert.equal(normalizeStandardUniformShaderPair(r,c.selectors).ok,false);}}
    else if(c.kind<7) {
      const normalized=c.kind<2?normalizeStandardUniformShaderResult(r,c.kind?'fragment':'vertex'):normalizeStandardUniformShaderPair(r,c.selectors);
      assert.equal(normalized.ok,true,c.name+' explicitly selected normalizer');assert.ok(Object.isFrozen(normalized));
      const bodies=c.kind<2?[[c.kind?'fragment':'vertex',c.a,r]]:[['vertex',c.a,r.vertex],['fragment',c.b,r.fragment]];
      for(const [stage,text,body]of bodies) {
        const at=stage==='fragment'&&c.kind>=2?1:0,original=native[i].originalTokens[at];
        const declarations=[...text.matchAll(/^DCL CONST\[(\d+)(?:\.\.(\d+))?\](?:\[(\d+)(?:\.\.(\d+))?\])?$/gm)].map(match=>
          ({slot:match[3]===undefined?0:Number(match[1]),first:Number(match[3]??match[1]),last:Number(match[4]??match[3]??match[2]??match[1]),dimensional:match[3]!==undefined}));
        assert.deepEqual(original.constantDeclarations,declarations,c.name+' original dimensional token order/ranges');
        const sources=[];for(const [instruction,line]of [...text.matchAll(/^\d+: (.*)$/gm)].entries())
          for(const match of line[1].matchAll(/CONST\[(\d+|ADDR\[0\]\.x(?:\s*[+-]\d+)?)(?:)\](?:\[(\d+|ADDR\[0\]\.x(?:\s*[+-]\d+)?)\])?/g)) {
            const register=match[2]??match[1],indirect=register.startsWith('ADDR'),offset=indirect?Number(register.match(/[+-]\d+$/)?.[0]??0):Number(register);
            sources.push({instruction,slot:match[2]===undefined?0:Number(match[1]),index:offset,indirect,indirectDimension:false});
          }
        assert.deepEqual(original.constantSources,sources,c.name+' original signed vector token indices');
        const counts=new Map();
        for(const match of text.matchAll(/^DCL CONST\[(\d+)(?:\.\.(\d+))?\](?:\[(\d+)(?:\.\.(\d+))?\])?$/gm)) {
          const slot=match[3]===undefined?0:Number(match[1]),last=Number(match[4]??match[3]??match[2]??match[1]);
          counts.set(slot,Math.max(counts.get(slot)??0,last+1));
        }
        const selected=c.kind>=2&&Boolean(c.selectors.bufferZeroMask&(stage==='vertex'?1:2)),prefix=stage==='vertex'?'vs':'fs';
        const blocks=[...counts].filter(([slot])=>slot||selected).sort((a,b)=>a[0]-b[0]).map(([slot,count])=>({name:'Virgl'+(stage==='vertex'?'VS':'FS')+'Const'+slot,
          stage,slot,byteLength:count*16,encoding:'raw-32bit-words',members:[{name:prefix+'const'+slot,type:'uvec4[]',count,offset:0,arrayStride:16}]}));
        assert.deepEqual(body.metadata.guestUniformBlocks,blocks,c.name+' independently declared native banks');
        assert.deepEqual(body.metadata.uniforms,counts.has(0)&&!selected?[{name:prefix+'const0',type:'uvec4[]',count:counts.get(0),encoding:'raw-32bit-words'}]:[]);
        for(const block of blocks)assert.ok(body.glsl.includes('layout(std140) uniform '+block.name+' { uvec4 '+block.members[0].name+'['+block.members[0].count+']; };'));
        for(const match of text.matchAll(/CONST\[(\d+)\]\[ADDR\[0\]\.x\s*([+-])\s*(\d+)\]/g))
          assert.ok(body.glsl.includes(prefix+'const'+match[1]+'[addr0 + ('+(match[2]==='-'?'-':'')+match[3]+')]'),c.name+' original signed dynamic offset');
        assert.equal(normalizeStandardShaderResult({ok:true,glsl:body.glsl,metadata:body.metadata},stage).ok,false,'old result admission isolated');
        if(c.kind<2)assert.equal(parseStandardUniformShaderMetadata(body.metadata,stage).ok,true);
      }
      if(c.kind>=2) {assert.equal(deriveStandardUniformShaderInterface(r.vertex.metadata,r.fragment.metadata,c.selectors).ok,true);assert.equal(normalizeStandardShaderPair(r).ok,false);}
    }
    if([0,1,2,7,8,9,10,11].includes(c.kind)) {
      const request={vertexText:c.a,fragmentText:c.b},facade=c.kind<7?bridge:old;
      const r2=c.kind<2||c.kind===7||c.kind===8?facade.translate({stage:c.kind===0||c.kind===7?'vertex':'fragment',text:c.a}):
        c.kind===2?facade.translatePairUniforms({...request,...c.selectors}):c.kind===9?facade.translatePair(request):
        c.kind===10?facade.translatePairTyped({...request,signedMask:c.selectors.signedMask,unsignedMask:c.selectors.unsignedMask}):
        facade.translatePairVertexFormats({...request,...Object.fromEntries(selectorKeys.slice(0,4).map(k=>[k,c.selectors[k]]))});
      if(r.ok)assert.deepEqual(r2,r,c.name+' owned facade');
      else {assert.equal(r2.ok,false);assert.equal(r2.error.code,r.error.code,c.name+' facade rejection');}
    }
    responses.push({case:i,name:c.name,result:r});
  }
  await fs.writeFile(path.join(output,'wasm.jsonl'),responses.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const good=cases.find(c=>c.name==='four-formats-zero-3'),request={vertexText:good.a,fragmentText:good.b,...good.selectors},baseline=bridge.translatePairUniforms(request),saved=JSON.stringify(baseline),rejections=[];
  const reject=(label,value)=>{const r=bridge.translatePairUniforms(value);assert.equal(r.ok,false,label);assert.deepEqual(Object.keys(r),['ok','error']);rejections.push({label,result:r});};
  for(const value of [null,[],4,Object.create(request),{...request,key:{}},{...request,vertexText:new String(good.a)},
    {...request,vertexText:'\0'},{...request,fragmentText:' '.repeat(49153)}])reject('strict-'+rejections.length,value);
  for(const key of selectorKeys)for(const value of ['2',null,NaN,Infinity,-1,.5,65536,new Number(2)])reject(key+'-'+String(value),{...request,[key]:value});
  for(const mask of [4,0xffffffff])reject('buffer-zero-'+mask,{...request,bufferZeroMask:mask});
  let getters=0;for(const key of Object.keys(request)) {const value={...request};Object.defineProperty(value,key,{get(){getters++;return request[key];},enumerable:true});reject('accessor-'+key,value);}assert.equal(getters,0);
  reject('symbol',{...request,[Symbol('guest-key')]:0});reject('own-keys-throws',new Proxy({}, {ownKeys(){throw Error('trap');}}));
  reject('descriptor-throws',new Proxy(request,{getOwnPropertyDescriptor(){throw Error('trap');}}));
  const caller={...request};let changed=false;const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,key){const own=Reflect.getOwnPropertyDescriptor(t,key);if(key==='bufferZeroMask'&&!changed){changed=true;t.vertexText='\0';t.bufferZeroMask=4;}return own;}});
  assert.deepEqual(bridge.translatePairUniforms(proxy),baseline);reject('later-mutation',caller);assert.equal(JSON.stringify(baseline),saved);
  assert.equal(Object.hasOwn(old,'translatePairUniforms'),false);
  for(const method of ['translatePair','translatePairTyped','translatePairVertexFormats'])assert.equal(old[method](request).ok,false);
  const defaultRequest={vertexText:good.a,fragmentText:good.b},formatRequest={...defaultRequest,...Object.fromEntries(selectorKeys.slice(0,4).map(k=>[k,good.selectors[k]]))};
  assert.deepEqual(bridge.translatePair(defaultRequest),bridge.translatePairUniforms({...defaultRequest,...zeroSelectors}));
  assert.deepEqual(bridge.translatePairTyped({...defaultRequest,signedMask:2,unsignedMask:4}),bridge.translatePairUniforms({...defaultRequest,...zeroSelectors,signedMask:2,unsignedMask:4}));
  assert.deepEqual(bridge.translatePairVertexFormats(formatRequest),bridge.translatePairUniforms({...formatRequest,bufferZeroMask:0}));
  const peer=await createVirglStandardUniformShaderBridge();assert.deepEqual(peer.translatePairUniforms(request),baseline);
  const all=cases.find(c=>c.name==='all-banks-zero-3'),allResult=bridge.translatePairUniforms({vertexText:all.a,fragmentText:all.b,...all.selectors});
  const metadata=metadataAttacks(allResult,all.selectors);await fs.writeFile(path.join(output,'metadata-attacks.json'),JSON.stringify(metadata,null,2)+'\n');
  let runtime;const pressure=[],constrained=await createVirglStandardUniformShaderBridge({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)pressure.push(p);}}});
  const failed=constrained.translatePairUniforms(request);assert.equal(failed.error.code,'allocation-failed');assert.deepEqual(Object.keys(failed),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);
  runtime._free(pressure.shift());const scratchFailure=constrained.translatePairUniforms({vertexText:all.a,fragmentText:all.b,...all.selectors});
  assert.equal(scratchFailure.ok,false);assert.equal(scratchFailure.error.code,'translation-error');assert.equal(scratchFailure.error.message,'Checked upstream TGSI parsing failed.');
  assert.deepEqual(Object.keys(scratchFailure),['ok','error']);assert.equal(runtime.HEAPU8.byteLength,16777216);
  pressure.reverse().forEach(p=>runtime._free(p));assert.deepEqual(constrained.translatePairUniforms(request),baseline);assert.equal(runtime.HEAPU8.byteLength,16777216);
  const report={status:'passed',cases:cases.length,exactNativeWasm:true,rejections,getters,ownedSnapshots:true,peerIsolation:true,
    pressure:{allocations:pressure.length+1,result:failed,scratchFailure,bytes:16777216,recovered:true},basic:{vertex:basicVertex,fragment:basicFragment}};
  await fs.writeFile(path.join(output,'node.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:cases.length,rejections:rejections.length,fixedMemoryRecovery:true}));
} else throw Error('cases or audit mode required');
