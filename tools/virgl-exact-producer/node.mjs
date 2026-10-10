#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,checkExactBank} from '../../renderer/virgl-command/constant-domain.mjs';
import {clone,literalBank,VERTEX,FRAGMENT} from './fixtures.mjs';
const raw=fs.readFileSync(process.argv[2]),native=JSON.parse(raw);let module;
const bridge=await createVirglShaderBridge({onRuntimeInitialized(){module=this;}});
const report={schema:1,task:'E6-T12g6m3b',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(raw).digest('hex'),cases:[],schemaAttacks:[],ownership:[],banks:[],allocationFaults:[],nativeRequests:[],getterInvocations:0};
const request=c=>({stage:c.stage,text:c.text,components:clone(c.components)});
for(const c of native.cases){
 const r=bridge.translateExact(request(c)),old=bridge.translate({stage:c.stage,text:c.text}),pair=bridge.translatePair(c.stage==='vertex'?{vertexText:c.text,fragmentText:c.partner}:{vertexText:c.partner,fragmentText:c.text});
 assert.deepEqual(r,c.result,c.name+' entire original native/Wasm result');assert.deepEqual(old,c.defaultResult,c.name+' unqualified result');assert.deepEqual(pair,c.pairResult,c.name+' unchanged pair');
 assert.deepEqual(bridge.translateExact(request(c)),r,c.name+' exact after default pair');
 if(r.ok&&!c.defaultOk){const contract=parseConstantDomain(r.metadata,c.stage);assert.equal(contract.ok,true);assert.deepEqual(contract.exactDomain.components,c.components);assert.ok(Object.isFrozen(contract.exactDomain.components));
  const words=c.safeWords??literalBank(c);if(c.inherited?.includes('radial'))words[16]=0x3f800000;if(c.inherited?.includes('count'))words[36]=1;
  const accepted=checkExactBank(words,contract.exactDomain,contract.exactBase);assert.equal(accepted.ok,true,c.name);report.banks.push({name:c.name,words,contract,accepted});
  for(const entry of c.components){const wrong=words.slice();wrong[entry.register*4+entry.component]=(entry.word^1)>>>0;const result=checkExactBank(wrong,contract.exactDomain,contract.exactBase);assert.equal(result.ok,false);report.banks.push({name:c.name+'/mismatch',entry,result});}
 }
 report.cases.push({name:c.name,result:r,defaultResult:old,pairResult:pair});
}
const first=native.cases[0],valid=()=>request(first);
function bad(input,label,code='invalid-input'){const result=bridge.translateExact(input);assert.equal(result.ok,false,label);assert.equal(result.error.code,code,label);report.schemaAttacks.push({label,result});}
for(const input of [null,undefined,0,'text',[],()=>{}])bad(input,'request/'+String(input));
for(const key of ['stage','text','components']){
 const absent=valid();delete absent[key];bad(absent,'missing/'+key);
 const inherited=valid(),value=inherited[key];delete inherited[key];Object.setPrototypeOf(inherited,{[key]:value});bad(inherited,'inherited/'+key);
 const getter=valid();Object.defineProperty(getter,key,{get(){report.getterInvocations++;return value;}});bad(getter,'getter/'+key);
}
for(const key of ['extra',Symbol('extra')]){const x=valid();x[key]=true;bad(x,'request-extra/'+String(key));}
for(const value of ['compute',0,null,{},undefined])bad({...valid(),stage:value},'stage/'+String(value),'unsupported-stage');
for(const value of [0,null,[],{},new String(first.text)])bad({...valid(),text:value},'text/'+String(value));
bad({...valid(),text:' '.repeat(49153)},'text-too-large','input-too-large');
for(const text of ['\u0000','\u0080','\u0001'])bad({...valid(),text},'non-ascii');
for(const value of [null,{},[],Array(185).fill({register:0,component:0,word:0})])bad({...valid(),components:value},'components-bounds');
for(const mutate of [a=>{delete a[0];},a=>a.extra=0,a=>a[Symbol('extra')]=0,a=>Object.defineProperty(a,0,{get(){report.getterInvocations++;return {};}}),a=>a[0]=null,a=>a[0]=[],a=>a[0]='record',a=>a.push({...a[0]}),a=>a.reverse()]){const x=valid();mutate(x.components);bad(x,'array-shape');}
for(const key of ['register','component','word']){
 for(const value of [-1,.5,0x100000000,'1',null,{},NaN,Infinity,undefined]){const x=valid();x.components[0][key]=value;bad(x,'component/'+key+'/'+String(value));}
 const x=valid();delete x.components[0][key];bad(x,'component-missing/'+key);
 const y=valid(),value=y.components[0][key];delete y.components[0][key];Object.setPrototypeOf(y.components[0],{[key]:value});bad(y,'component-inherited/'+key);
 const z=valid();Object.defineProperty(z.components[0],key,{get(){report.getterInvocations++;return 0;}});bad(z,'component-getter/'+key);
}
for(const [key,value]of [['register',46],['component',4]]){const x=valid();x.components[0][key]=value;bad(x,'component-bound/'+key);}
for(const key of ['extra',Symbol('extra')]){const x=valid();x.components[0][key]=true;bad(x,'record-extra/'+String(key));}
for(const method of ['ownKeys','getOwnPropertyDescriptor']){const x=new Proxy(valid(),{[method](){throw new Error('reflection fault');}});bad(x,'request-reflection/'+method);const y=valid();y.components=new Proxy(y.components,{[method](){throw new Error('reflection fault');}});bad(y,'array-reflection/'+method);const z=valid();z.components[0]=new Proxy(z.components[0],{[method](){throw new Error('reflection fault');}});bad(z,'record-reflection/'+method);}
{
 const x=valid();delete x.stage;x.backend='raw';bad(x,'same-width unsupported request key');
 const y=valid();y.components=new Proxy(y.components,{ownKeys(){return ['length','00','1'];}});bad(y,'same-width noncanonical array key');
 const z=valid();z.components=new Proxy(z.components,{ownKeys(){return ['length',Symbol('component'),'1'];}});bad(z,'same-width symbol array key');
 for(const value of [-1,.5,185]){const x=valid();x.components=new Proxy(x.components,{getOwnPropertyDescriptor(target,key){const d=Object.getOwnPropertyDescriptor(target,key);return key==='length'?{...d,value}:d;}});bad(x,'hostile length descriptor/'+value);}
 for(const where of ['request','array','record']){const x=valid(),target=where==='request'?x:where==='array'?x.components:x.components[0],missing=where==='request'?'stage':where==='array'?'0':'word',proxy=new Proxy(target,{getOwnPropertyDescriptor(target,key){return key===missing?undefined:Object.getOwnPropertyDescriptor(target,key);}});if(where==='array')x.components=proxy;if(where==='record')x.components[0]=proxy;bad(where==='request'?proxy:x,'missing reflected data descriptor/'+where);}
}
// Snapshot each primitive once, then mutate the caller during the first native allocation.
const malloc=module._malloc,free=module._free,translate=module._bridge_translate_exact;
for(const failAt of [1,2]){let calls=0;const live=new Set();module._malloc=size=>{if(++calls===failAt)return 0;const p=malloc(size);live.add(p);return p;};module._free=p=>{assert.ok(live.delete(p));free(p);};const r=bridge.translateExact(valid());assert.equal(r.ok,false);assert.equal(r.error.code,'allocation-failed');assert.equal(live.size,0);report.allocationFaults.push({failAt,calls,result:r});module._malloc=malloc;module._free=free;assert.deepEqual(bridge.translateExact(valid()),first.result);}
{
 const input=valid();let mutations=0;module._malloc=size=>{input.text='FRAG\nBOGUS\n';input.components[0].word=2;mutations++;return malloc(size);};
 const r=bridge.translateExact(input);module._malloc=malloc;assert.equal(mutations,2);assert.deepEqual(r,first.result);input.components.length=0;assert.deepEqual(r,first.result);report.ownership.push({kind:'native-allocation-mutation',mutations,result:r});
}
{
 const x=valid(),entry=x.components[0];let traps=0;
 x.components[0]=new Proxy(entry,{getOwnPropertyDescriptor(target,key){const d=Object.getOwnPropertyDescriptor(target,key);if(key==='word'){target.word=2;traps++;}return d;}});
 const r=bridge.translateExact(x);assert.equal(traps,1);assert.equal(entry.word,2);assert.deepEqual(r,first.result);report.ownership.push({kind:'descriptor-copy-before-mutation',traps,result:r});
}
// Direct Wasm C boundary rejects invalid tuples independently of the facade.
for(const [label,stage,components,count,length]of [
 ['stage',2,[{register:0,component:0,word:0}],1,first.text.length],
 ['null-text',0,[{register:0,component:0,word:0}],1,-1],
 ['null-components',0,null,1,first.text.length],
 ['zero-count',0,[],0,first.text.length],['over-count',0,[],185,first.text.length],
 ['text-bound',0,[],1,49153],['register-bound',0,[{register:46,component:0,word:0}],1,first.text.length],
 ['component-bound',0,[{register:0,component:4,word:0}],1,first.text.length],
 ['duplicate',0,[{register:0,component:0,word:0},{register:0,component:0,word:0}],2,first.text.length],
 ['unsorted',0,[{register:0,component:1,word:0},{register:0,component:0,word:0}],2,first.text.length],
 ['non-ascii',0,[{register:0,component:0,word:0}],1,1],
 ]){
 const t=malloc(first.text.length+1),p=malloc(184*12);try{module.HEAPU8.set(new TextEncoder().encode(first.text),t);module.HEAPU8[t+first.text.length]=0;const view=new DataView(module.HEAPU8.buffer);for(const [i,e]of(components??[]).entries()){view.setUint32(p+i*12,e.register,true);view.setUint32(p+i*12+4,e.component,true);view.setUint32(p+i*12+8,e.word,true);}if(label==='non-ascii')module.HEAPU8[t]=0;const result=JSON.parse(module.UTF8ToString(translate(stage,length<0?0:t,Math.max(0,length),components===null?0:p,count)));assert.equal(result.ok,false,label);assert.equal(Object.hasOwn(result,'metadata'),false);report.nativeRequests.push({label,result});}finally{free(p);free(t);}
 assert.deepEqual(bridge.translateExact(valid()),first.result,'invalid direct call clears transaction');
}
const ordinary=bridge.translate({stage:'vertex',text:VERTEX});assert.equal(bridge.translatePair({vertexText:VERTEX,fragmentText:FRAGMENT}).ok,true);assert.deepEqual(bridge.translate({stage:'vertex',text:VERTEX}),ordinary,'pair cannot change ordinary stage output');
report.partners=[{stage:'vertex',text:VERTEX,result:ordinary},{stage:'fragment',text:FRAGMENT,result:bridge.translate({stage:'fragment',text:FRAGMENT})}];
bad({...valid(),backend:'raw'},'no-backend-override');assert.equal(bridge.translate(valid()).ok,false,'default method cannot select exact facts');
assert.equal(report.getterInvocations,0);report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} complete native/Wasm results; ${report.schemaAttacks.length} strict-schema attacks; ${report.nativeRequests.length} independent C-boundary attacks; owned mutation held.`);
