#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {clone} from './fixtures.mjs';
const raw=fs.readFileSync(process.argv[2]),native=JSON.parse(raw);let module;
const bridge=await createVirglShaderBridge({onRuntimeInitialized(){module=this;}});
const report={schema:1,task:'E6-T12g6m3c',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(raw).digest('hex'),cases:[],schemaAttacks:[],ownership:[],allocationFaults:[],nativeRequests:[],getterInvocations:0};
const request=c=>Object.fromEntries(['vertexText','fragmentText','vertexComponents','fragmentComponents'].map(k=>[k,clone(c[k])]));
function direct(c,paired=true,stage=0){
 const texts=[c.vertexText,c.fragmentText],words=[c.vertexComponents,c.fragmentComponents],tp=[0,0],wp=[0,0];
 try{for(let s=0;s<2;s++){tp[s]=module._malloc(texts[s].length+1);assert.ok(tp[s]);module.HEAPU8.set(new TextEncoder().encode(texts[s]),tp[s]);module.HEAPU8[tp[s]+texts[s].length]=0;if(!words[s].length)continue;wp[s]=module._malloc(words[s].length*12);assert.ok(wp[s]);const view=new DataView(module.HEAPU8.buffer);words[s].forEach((w,i)=>{view.setUint32(wp[s]+i*12,w.register,true);view.setUint32(wp[s]+i*12+4,w.component,true);view.setUint32(wp[s]+i*12+8,w.word,true);});}
  const result=paired==='old'?module._bridge_translate_pair(tp[0],texts[0].length,tp[1],texts[1].length):paired?module._bridge_translate_pair_exact(tp[0],texts[0].length,wp[0],words[0].length,tp[1],texts[1].length,wp[1],words[1].length):words[stage].length?module._bridge_translate_exact(stage,tp[stage],texts[stage].length,wp[stage],words[stage].length):module._bridge_translate(stage,tp[stage],texts[stage].length);
  return JSON.parse(module.UTF8ToString(result));
 }finally{for(let s=0;s<2;s++){if(wp[s])module._free(wp[s]);if(tp[s])module._free(tp[s]);}}
}
const canonical=words=>words.every((w,i)=>!i||w.register*4+w.component>words[i-1].register*4+words[i-1].component);
for(const c of native.cases){
 const r=direct(c),facade=bridge.translatePairExact(request(c)),old=direct(c,'old'),oldFacade=bridge.translatePair({vertexText:c.vertexText,fragmentText:c.fragmentText});
 assert.deepEqual(r,c.result,c.name+' complete native/Wasm paired C result');assert.deepEqual(old,c.defaultResult,c.name+' complete old C pair');
 if(c.vertexText.length<=49152&&c.fragmentText.length<=49152)assert.deepEqual(oldFacade,old,c.name+' old facade result');else assert.equal(oldFacade.error.code,'input-too-large');
 if(canonical(c.vertexComponents)&&canonical(c.fragmentComponents))assert.deepEqual(facade,r,c.name+' actual facade/C result');else{assert.equal(facade.ok,false);assert.equal(facade.error.code,r.error.code);}
 const singles=[direct(c,false,0),direct(c,false,1)];
 assert.deepEqual(singles,c.singles,c.name+' complete native/Wasm single stages');
 assert.deepEqual(bridge.translatePairExact(request(c)),facade,c.name+' pair after defaults/singles');report.cases.push({name:c.name,result:r,facadeResult:facade,defaultResult:old,defaultFacadeResult:oldFacade,singles});
}
const first=native.cases[0],valid=()=>request(first);
function bad(x,label,code='invalid-input'){const result=bridge.translatePairExact(x);assert.equal(result.ok,false,label);assert.equal(result.error.code,code,label);assert.deepEqual(Object.keys(result).sort(),['error','ok']);report.schemaAttacks.push({label,result});}
for(const x of [null,undefined,0,'shader',[],()=>{}])bad(x,'request/'+String(x));
const names=['vertexText','fragmentText','vertexComponents','fragmentComponents'];
for(const key of names){
 const a=valid();delete a[key];bad(a,'absent/'+key);
 const b=valid(),value=b[key];delete b[key];Object.setPrototypeOf(b,{[key]:value});bad(b,'inherited/'+key);
 const c=valid();Object.defineProperty(c,key,{get(){report.getterInvocations++;return value;}});bad(c,'getter/'+key);
}
for(const key of ['stage','backend','key','fs_info','interfaceKey',Symbol('extra')]){const x=valid();x[key]=0;bad(x,'extra/'+String(key));}
for(const key of ['vertexText','fragmentText']){
 for(const value of [0,null,[],{},new String(first[key])])bad({...valid(),[key]:value},'text-shape/'+key);
 bad({...valid(),[key]:' '.repeat(49153)},'text-max/'+key,'input-too-large');
 for(const value of ['\0','\u0080','\u0001'])bad({...valid(),[key]:value},'text-ascii/'+key);
}
bad({...valid(),vertexComponents:[],fragmentComponents:[]},'empty paired union');
for(const key of ['vertexComponents','fragmentComponents']){
 for(const value of [null,{},new Uint32Array(3),Array(185).fill({register:0,component:0,word:0})])bad({...valid(),[key]:value},'array-shape/'+key);
 for(const mutate of [a=>{delete a[0];},a=>a.extra=0,a=>a[Symbol('extra')]=0,a=>Object.defineProperty(a,0,{get(){report.getterInvocations++;return {};}}),a=>a[0]=null,a=>a[0]=[],a=>a[0]='record',a=>a.splice(1,0,{...a[0]}),a=>a.reverse()]){const x=valid();mutate(x[key]);bad(x,'array-own/'+key);}
 for(const field of ['register','component','word']){
  for(const value of [-1,.5,0x100000000,'1',null,{},NaN,Infinity,undefined]){const x=valid();x[key][0][field]=value;bad(x,'field/'+key+'/'+field+'/'+String(value));}
  const a=valid();delete a[key][0][field];bad(a,'field-absent/'+key+'/'+field);
  const b=valid(),value=b[key][0][field];delete b[key][0][field];Object.setPrototypeOf(b[key][0],{[field]:value});bad(b,'field-inherited/'+key+'/'+field);
  const c=valid();Object.defineProperty(c[key][0],field,{get(){report.getterInvocations++;return 0;}});bad(c,'field-getter/'+key+'/'+field);
 }
 for(const [field,value]of[['register',46],['component',4]]){const x=valid();x[key][0][field]=value;bad(x,'field-bound/'+key+'/'+field);}
 for(const field of ['extra',Symbol('extra')]){const x=valid();x[key][0][field]=0;bad(x,'record-extra/'+key);}
 for(const value of [-1,.5,185]){const x=valid();x[key]=new Proxy(x[key],{getOwnPropertyDescriptor(target,name){const d=Object.getOwnPropertyDescriptor(target,name);return name==='length'?{...d,value}:d;}});bad(x,'length-descriptor/'+key+'/'+value);}
 for(const fake of ['00',Symbol('index')]){const x=valid();x[key]=new Proxy(x[key],{ownKeys(){return ['length',fake,'1','2'];}});bad(x,'same-width-array-key/'+key+'/'+String(fake));}
 for(const method of ['ownKeys','getOwnPropertyDescriptor'])for(const level of ['array','record']){const x=valid(),target=level==='array'?x[key]:x[key][0],p=new Proxy(target,{[method](){throw new Error('bounded reflected fault');}});if(level==='array')x[key]=p;else x[key][0]=p;bad(x,'reflection/'+key+'/'+level+'/'+method);}
 for(const level of ['array','record']){const x=valid(),target=level==='array'?x[key]:x[key][0],p=new Proxy(target,{getOwnPropertyDescriptor(target,name){return name===(level==='array'?'0':'word')?undefined:Object.getOwnPropertyDescriptor(target,name);}});if(level==='array')x[key]=p;else x[key][0]=p;bad(x,'missing-reflected-field/'+key+'/'+level);}
}
for(const method of ['ownKeys','getOwnPropertyDescriptor'])bad(new Proxy(valid(),{[method](){throw new Error('request reflection fault');}}),'request-reflection/'+method);
{
 const x=valid();delete x.vertexText;x.vertexShader='replacement';bad(x,'same-width-unknown-request-key');
 const y=valid();bad(new Proxy(y,{getOwnPropertyDescriptor(target,key){return key==='vertexText'?undefined:Object.getOwnPropertyDescriptor(target,key);}}),'missing-reflected-request-field');
}
const malloc=module._malloc,free=module._free;
for(const failAt of [1,2,3,4]){let count=0;const live=new Set();module._malloc=n=>{if(++count===failAt)return 0;const p=malloc(n);live.add(p);return p;};module._free=p=>{assert.ok(live.delete(p));free(p);};const result=bridge.translatePairExact(valid());assert.equal(result.ok,false);assert.equal(result.error.code,'allocation-failed');assert.equal(live.size,0);report.allocationFaults.push({failAt,count,result});module._malloc=malloc;module._free=free;assert.deepEqual(bridge.translatePairExact(valid()),first.result);}
{
 const x=valid();let mutations=0;module._malloc=n=>{for(const key of names)if(key.endsWith('Text'))x[key]='FRAG\nBOGUS\n';else x[key][0].word=2;++mutations;return malloc(n);};
 const result=bridge.translatePairExact(x);module._malloc=malloc;assert.equal(mutations,4);assert.deepEqual(result,first.result);report.ownership.push({kind:'both-stage-malloc-mutation',mutations,result});
}
for(const key of ['vertexComponents','fragmentComponents']){
 const x=valid(),entry=x[key][0];let traps=0;x[key][0]=new Proxy(entry,{getOwnPropertyDescriptor(target,name){const d=Object.getOwnPropertyDescriptor(target,name);if(name==='word'){target.word=2;++traps;}return d;}});
 const result=bridge.translatePairExact(x);assert.equal(traps,1);assert.equal(entry.word,2);assert.deepEqual(result,first.result);report.ownership.push({kind:'descriptor-snapshot/'+key,traps,result});
}
{
 const x=valid();let nested=0;module._malloc=n=>{if(!nested){++nested;assert.deepEqual(bridge.translateExact({stage:'fragment',text:first.fragmentText,components:clone(first.fragmentComponents)}),first.singles[1]);x.vertexComponents[0].word=2;x.fragmentText='FRAG\nBOGUS\n';}return malloc(n);};
 const result=bridge.translatePairExact(x);module._malloc=malloc;assert.equal(nested,1);assert.deepEqual(result,first.result);report.ownership.push({kind:'opposite-stage-reentrant-allocation',nested,result});
}
// Exercise the C ABI directly; the own-data facade cannot supply these shapes.
for(const [label,side,kind]of['null-text','null-tuples','over-count','over-length','bad-register','bad-component','duplicate','unsorted','non-ascii'].flatMap(kind=>[0,1].map(side=>[kind+'/'+side,side,kind]))){
 const tp=[malloc(first.vertexText.length+1),malloc(first.fragmentText.length+1)],wp=[malloc(184*12),malloc(184*12)],lengths=[first.vertexText.length,first.fragmentText.length],counts=[first.vertexComponents.length,first.fragmentComponents.length];
 try{
  for(let s=0;s<2;s++){const text=first[s===0?'vertexText':'fragmentText'];module.HEAPU8.set(new TextEncoder().encode(text),tp[s]);module.HEAPU8[tp[s]+text.length]=0;const view=new DataView(module.HEAPU8.buffer);for(const [i,w]of first[s===0?'vertexComponents':'fragmentComponents'].entries()){view.setUint32(wp[s]+i*12,w.register,true);view.setUint32(wp[s]+i*12+4,w.component,true);view.setUint32(wp[s]+i*12+8,w.word,true);}}
  const ptrs=tp.slice(),words=wp.slice(),view=new DataView(module.HEAPU8.buffer);
  if(kind==='null-text')ptrs[side]=0;if(kind==='null-tuples')words[side]=0;if(kind==='over-count')counts[side]=185;if(kind==='over-length')lengths[side]=49153;
  if(kind==='bad-register')view.setUint32(wp[side],46,true);if(kind==='bad-component')view.setUint32(wp[side]+4,4,true);
  if(kind==='duplicate')module.HEAPU8.copyWithin(wp[side]+12,wp[side],wp[side]+12);
  if(kind==='unsorted')view.setUint32(wp[side],45,true);if(kind==='non-ascii')module.HEAPU8[tp[side]]=0;
  const result=JSON.parse(module.UTF8ToString(module._bridge_translate_pair_exact(ptrs[0],lengths[0],words[0],counts[0],ptrs[1],lengths[1],words[1],counts[1])));assert.equal(result.ok,false,label);assert.deepEqual(Object.keys(result).sort(),['error','ok']);report.nativeRequests.push({label,result});
 }finally{wp.forEach(free);tp.forEach(free);}
 assert.deepEqual(bridge.translatePairExact(valid()),first.result,label+' native cleanup');
}
assert.equal(report.getterInvocations,0);report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} whole native/Wasm pairs; ${report.schemaAttacks.length} own-schema attacks; ${report.nativeRequests.length} direct C ABI attacks; owned reentrancy held.`);
