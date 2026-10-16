#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,checkExactBank} from '../../renderer/virgl-command/constant-domain.mjs';
import {clone,wrapExact,literalBank,inheritedPlan} from './fixtures.mjs';
const raw=fs.readFileSync(process.argv[2]),native=JSON.parse(raw),bridge=await createVirglShaderBridge();
const report={schema:1,task:'E6-T12g6m3a',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(raw).digest('hex'),cases:[],metadataAttacks:[],bankAttacks:[],ownership:[],getterInvocations:0};
const approve=(bank,c)=>checkExactBank(bank,c.exactDomain,c.exactBase);
const bad=(metadata,stage,label)=>{const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,false,label);report.metadataAttacks.push({label,result});};
for(const c of native.cases){
 const original=bridge.translate({stage:c.stage,text:c.text}),pair=bridge.translatePair(c.stage==='vertex'?{vertexText:c.text,fragmentText:c.partner}:{vertexText:c.partner,fragmentText:c.text});
 assert.deepEqual(original,c.result,c.name+' full native/Wasm result');assert.deepEqual(pair,c.pairResult,c.name+' full native/Wasm pair');
 const count=original.metadata.uniforms[0].count,plan=c.role==='physical'?{components:c.components,words:c.safeWords??literalBank(c,count),attacks:[]}:inheritedPlan(c.name,count);
 const wrapped=wrapExact(original,c.stage,plan.components),contract=parseConstantDomain(wrapped.metadata,c.stage);assert.equal(contract.ok,true,c.name);
 const base=parseConstantDomain(original.metadata,c.stage);assert.deepEqual(contract.exactBase,base);const inherited={...contract};delete inherited.exactDomain;delete inherited.exactBase;assert.deepEqual(inherited,base,c.name+' entire unchanged inherited contract');
 const accepted=approve(plan.words,contract);assert.equal(accepted.ok,true,c.name);assert.deepEqual(accepted.words,plan.words);assert.ok(Object.isFrozen(accepted)&&Object.isFrozen(accepted.words)&&Object.isFrozen(contract.exactDomain.components[0]));
 report.cases.push({name:c.name,stage:c.stage,original,pair,wrapped,contract,plan,accepted});
 for(const attack of plan.attacks){const words=plan.words.slice();words[attack.index]=attack.word;const result=approve(words,contract);assert.equal(result.ok,false,c.name+'/'+attack.code);assert.equal(result.error.code,attack.code);report.bankAttacks.push({label:c.name+'/inherited',attack,words,result});}
 for(const word of [0,2,0x80000000,0x00800000]){const words=plan.words.slice(),entry=plan.components[0];if(word===entry.word)continue;words[entry.register*4+entry.component]=word;const result=approve(words,contract);assert.equal(result.ok,false);report.bankAttacks.push({label:c.name+'/different-exact-word',word,result});}
 for(const length of [0,Math.max(0,plan.words.length-4)]){const result=approve(plan.words.slice(0,length),contract);assert.equal(result.ok,false);assert.equal(result.error.code,'incomplete-draw');report.bankAttacks.push({label:c.name+'/short',length,result});}
 const ownedWords=plan.words.slice(),ownedMetadata=clone(wrapped.metadata),ownedContract=parseConstantDomain(ownedMetadata,c.stage),copy=approve(ownedWords,ownedContract);assert.equal(copy.ok,true);ownedWords.fill(0xdeadbeef);ownedMetadata.constantExactDomains[0].components[0].word^=1;ownedMetadata.constantExactDomains[0].count=1;assert.deepEqual(copy,accepted);assert.deepEqual(ownedContract,contract);report.ownership.push({name:c.name,ownedContract,copy});
 if(!['vertex-0-x','fragment-inactive-47','inherited-conversion-branch','inherited-radial-count'].includes(c.name))continue;
 const m=wrapped.metadata;
 for(const key of Object.keys(m.constantExactDomains[0])){
  const absent=clone(m);delete absent.constantExactDomains[0][key];bad(absent,c.stage,c.name+'/absent-domain/'+key);
  const getter=clone(m);Object.defineProperty(getter.constantExactDomains[0],key,{enumerable:true,get(){report.getterInvocations++;return null;}});bad(getter,c.stage,c.name+'/getter-domain/'+key);
  const inherited=clone(m),value=inherited.constantExactDomains[0][key];delete inherited.constantExactDomains[0][key];Object.setPrototypeOf(inherited.constantExactDomains[0],{[key]:value});bad(inherited,c.stage,c.name+'/inherited-domain/'+key);
 }
 for(const key of ['exactBaseProfile','constantExactDomains']){const missing=clone(m);delete missing[key];bad(missing,c.stage,c.name+'/marker-missing/'+key);const getter=clone(m);Object.defineProperty(getter,key,{get(){report.getterInvocations++;return null;}});bad(getter,c.stage,c.name+'/marker-getter/'+key);}
 for(const key of ['register','component','word'])for(const value of [-1,.5,0x100000000,'1',null,{},NaN,Infinity]){const a=clone(m);a.constantExactDomains[0].components[0][key]=value;bad(a,c.stage,c.name+'/component/'+key+'/'+String(value));}
 for(const [label,mutate]of [
  ['kind',d=>d.kind+='x'],['stage',d=>d.stage=c.stage==='vertex'?'fragment':'vertex'],['slot',d=>d.slot=1],['name',d=>d.name='otherconst0'],['count',d=>d.count=48],['count-mismatch',d=>d.count=d.count===1?2:1],['empty',d=>d.components=[]],['register46',d=>d.components[0].register=46],['lane4',d=>d.components[0].component=4],['duplicate',d=>d.components.push({...d.components[0]})],['unsorted',d=>d.components=[{register:0,component:1,word:0},{register:0,component:0,word:0}]],['extra',d=>d.extra=1],['symbol',d=>d[Symbol('extra')]=1],['holes',d=>{d.components.length=2;delete d.components[0];}],['entry-getter',d=>Object.defineProperty(d.components[0],'word',{get(){report.getterInvocations++;return 1;}})],['entry-prototype',d=>{const word=d.components[0].word;delete d.components[0].word;Object.setPrototypeOf(d.components[0],{word});}],['array-getter',d=>Object.defineProperty(d.components,0,{get(){report.getterInvocations++;return {};}})],['array-extra',d=>d.components.extra=1],['too-many',d=>d.components=Array(185).fill({register:0,component:0,word:0})]
 ]){const a=clone(m);mutate(a.constantExactDomains[0]);bad(a,c.stage,c.name+'/'+label);}
 for(const value of ['virgl-webgl2-raw-bits-v42','virgl-webgl2-raw-bits-v43','virgl-webgl2-raw-bits-v0',null]){const a=clone(m);a.exactBaseProfile=value;bad(a,c.stage,c.name+'/base/'+value);}
 for(const [field,value]of [['name','wrongconst0'],['type','vec4[]'],['count',0],['encoding','float32']]){const a=clone(m);a.uniforms[0][field]=value;bad(a,c.stage,c.name+'/uniform/'+field);}
 for(const key of ['uniforms','constantExactDomains']){const a=clone(m);a[key]=[];bad(a,c.stage,c.name+'/empty/'+key);const b=clone(m);b[key].push(clone(b[key][0]));bad(b,c.stage,c.name+'/duplicate/'+key);}
 const stripped=clone(m);stripped.profile=stripped.exactBaseProfile;bad(stripped,c.stage,c.name+'/relabelled-with-markers');
 for(const key of Object.keys(original.metadata).filter(k=>/^(constant|.*BaseProfile$|.*Contract$)/.test(k))){const a=clone(m);delete a[key];bad(a,c.stage,c.name+'/stripped-inherited/'+key);}
}
// Descriptor traps cannot split the inherited extent from the new declared bank.
{
 const original=native.cases.find(c=>c.name==='inherited-finite'),m=wrapExact(original.result,original.stage,[{register:0,component:0,word:0}]).metadata,d=m.constantExactDomains[0];
 m.constantExactDomains[0]=new Proxy(d,{ownKeys(target){m.uniforms[0].count=45;target.count=45;return Reflect.ownKeys(target);}});
 bad(m,original.stage,'descriptor trap cannot split declared extents');
}
for(const c of report.cases){
 const base=c.contract.exactBase,domain=c.contract.exactDomain,words=c.plan.words;
 for(const mutate of [b=>b.ok=false,b=>delete b.domain,b=>b.domain=undefined,b=>b.extra=true,b=>Object.defineProperty(b,'ok',{get(){report.getterInvocations++;return true;}})]){
  const value=clone(base);mutate(value);const result=checkExactBank(words,domain,value);assert.equal(result.ok,false);assert.equal(result.error.code,'constant-exact-domain-error');report.bankAttacks.push({label:c.name+'/invalid-owned-base',result});
 }
 for(const key of ['domain','access','constraint','radialDomain','rasterDomain','conversionDomain'])if(base[key]!=null){
  for(const field of ['kind','stage','slot','name','count']){const value=clone(base);value[key][field]=field==='count'?1:field==='slot'?1:'incorrect';const result=checkExactBank(words,domain,value);assert.equal(result.ok,false);assert.equal(result.error.code,'constant-exact-domain-error');report.bankAttacks.push({label:c.name+'/inconsistent-base/'+key+'/'+field,result});}
 }
 const malformed=clone(domain);malformed.components[0].word='1';const result=checkExactBank(words,malformed,base);assert.equal(result.ok,false);assert.equal(result.error.code,'constant-exact-domain-error');report.bankAttacks.push({label:c.name+'/invalid-exact-argument',result});
 const accessor=words.slice();Object.defineProperty(accessor,0,{get(){report.getterInvocations++;return 1;}});const inert=checkExactBank(accessor,domain,base);assert.equal(inert.ok,false);report.bankAttacks.push({label:c.name+'/inert-bank-accessor',result:inert});
}
// The maximum canonical set is 184 exact words; no float interpretation occurs.
const source=native.cases.find(c=>c.name==='fragment-inactive-47'),components=Array.from({length:184},(_,i)=>({register:Math.floor(i/4),component:i%4,word:i===0?1:i===182?5:0})),all=wrapExact(source.result,source.stage,components),full=parseConstantDomain(all.metadata,source.stage);assert.equal(full.ok,true);assert.equal(approve(components.map(e=>e.word),full).ok,true);report.maximum=full;
for(const word of [0,0x80000000,1,0x7fffff,0xffffffff]){const a=wrapExact(native.cases[0].result,'vertex',[{register:0,component:0,word}]),c=parseConstantDomain(a.metadata,'vertex');assert.equal(c.ok,true);const result=approve([word,0,0,0],c);assert.equal(result.ok,true);assert.equal(result.words[0],word);report.bankAttacks.push({label:'literal-raw-encoding',word,result});}
assert.equal(report.getterInvocations,0);report.status='passed';fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(`${report.cases.length} exact native/Wasm originals; ${report.metadataAttacks.length} owned metadata attacks; ${report.bankAttacks.length} banks; aliases independent.`);
