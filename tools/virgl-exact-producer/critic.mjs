// Independent bounded adversarial transactions. Predictions precede every call.
// node tools/virgl-exact-producer/critic.mjs OUTPUT [NATIVE_BINARY] [FAULT_WASM]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,checkExactBank} from '../../renderer/virgl-command/constant-domain.mjs';
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const seeds=[0xa54ff53a,0x510e527f,0x9b05688c];
const partner={vertex:'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n',fragment:'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nIMM[0] FLT32 {.25,.5,.5,1}\nMOV OUT[0], IN[0]\nMOV OUT[1], IMM[0]\nEND\n'};
const cases=[];
function add(name,stage,text,components,ok,defaultOk=false){cases.push({name,stage,text,components:components.sort((a,b)=>a.register*4+a.component-b.register*4-b.component),ok,defaultOk,partner:partner[stage]});}
function shader(stage,body,bank='0..45'){
 const head=stage==='vertex'?['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]']:['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR'];
 return [...head,`DCL CONST[${bank}]`,'DCL TEMP[0..7]','IMM[0] FLT32 {.25,.5,.5,1}','IMM[1] UINT32 {0,1,0,0}',...body,...(stage==='vertex'?['MOV OUT[0], IN[0]']:[]),'END',''].join('\n');
}
for(const seed of seeds)for(const stage of ['vertex','fragment']){
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(const word of [0,1,0x80000000,0xffffffff,0x7fc00001,0x3f800000]){
  const register=next()%2?45:0,component=next()%4,s='xyzw'[component].repeat(4),output=stage==='vertex'?'OUT[1]':'OUT[0]';
  const predicate=`MOV TEMP[0].z, CONST[${register}].${s}`;
  const live=`MOV ${output}, IMM[0]`,dead=`SIN ${output}, IN[0]`;
  const arms=word!==0?[live,'ELSE',dead]:[dead,'ELSE',live];
  const body=[predicate,'UIF TEMP[0].zzzz',...arms,'ENDIF'];
  const components=[{register,component,word}];
  add(`${seed}/${stage}/${register}.${component}/${word}/known`,stage,shader(stage,body),clone(components),true);
  add(`${seed}/${stage}/${word}/other-lane`,stage,shader(stage,body.map(x=>x===predicate?`MOV TEMP[0].z, CONST[${register}].${'xyzw'[(component+1)%4].repeat(4)}`:x)),clone(components),false);
  add(`${seed}/${stage}/${word}/overwritten`,stage,shader(stage,[predicate,'MOV TEMP[0].z, IN[0].xxxx',...body.slice(1)]),clone(components),false);
  add(`${seed}/${stage}/${word}/missing-mask`,stage,shader(stage,body.map(x=>x===predicate?predicate.replace('.z,','.y,'):x)),clone(components),false);
  add(`${seed}/${stage}/${word}/conflicting-join`,stage,shader(stage,[predicate,'UIF IN[0].xxxx',`MOV TEMP[0].z, IMM[1].${word===0?'yyyy':'xxxx'}`,'ENDIF',...body.slice(1)]),clone(components),false);
  add(`${seed}/${stage}/${word}/dead-grammar`,stage,shader(stage,body.map(x=>x===dead?`SQRT ${output}, IN[0]`:x)),clone(components),false);
 }
}
// Valid grammar with an unused undeclared obligation must reach the private check.
for(const stage of ['vertex','fragment']){
 const output=stage==='vertex'?'OUT[1]':'OUT[0]';
 const text=shader(stage,['UIF CONST[0].xxxx',`MOV ${output}, IMM[0]`,'ELSE',`SIN ${output}, IN[0]`,'ENDIF'],'0');
 add(`unused-undeclared/${stage}`,stage,text,[{register:45,component:0,word:0}],false);
 add(`unrecognized-complete-loop/${stage}`,stage,shader(stage,['UIF CONST[0].xxxx',`MOV ${output}, IMM[0]`,'ELSE','BGNLOOP :0',`SIN ${output}, IN[0]`,'BRK','ENDLOOP :0','ENDIF']),[{register:0,component:0,word:1}],false);
 for(const [name,word,ok]of [['positive-zero',0,true],['negative-zero',0x80000000,true],['integer-one',1,false],['too-large',0x41100000,false]]){
  add(`typed-SIN/${stage}/${name}`,stage,shader(stage,[`SIN ${output}, -CONST[0].xxxx`]),[{register:0,component:0,word}],ok);
 }
}
// A retained certificate's successful missing-lane retry must retain this call's facts.
const selected=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/selected-lanes-cases.json',import.meta.url)));
for(const stage of ['vertex','fragment'])for(const variant of ['plain','finite-payload','finite-width']){
 const original=selected.cases.find(c=>c.name===`a-${variant}-${stage}`);
 add(`demand/${stage}/${variant}`,stage,original.text.replace('END\n','UIF CONST[44].wwww\nSIN TEMP[116].x, IN[2].xxxx\nENDIF\nEND\n'),[{register:44,component:3,word:0}],true);
}
// END is not an instruction. Worker maxima contain765; independently reach768/769.
const maximal=JSON.parse(fs.readFileSync(new URL('./fixtures.json',import.meta.url)));
for(const kind of ['conditional','ordinary'])for(const count of [768,769]){
 const original=maximal.find(c=>c.name===`max-text-instructions-temporaries-${kind}`);
 const lines=original.text.split('\n').filter(s=>s.trim()).map(s=>s.trim());
 const instructionCount=lines.filter(s=>!s.startsWith('DCL ')&&!s.startsWith('IMM[')&&!['VERT','FRAG','END'].includes(s)).length;
 assert.equal(instructionCount,765);
 lines.splice(lines.length-1,0,...Array(count-instructionCount).fill('OR TEMP[511], IMM[0], IMM[0]'));
 let remaining=49152-(lines.join('\n')+'\n').length;
 for(let i=0;i<lines.length&&remaining;i++){const padding=Math.min(511-lines[i].length,remaining);lines[i]+=' '.repeat(padding);remaining-=padding;}
 assert.equal(remaining,0);const text=lines.join('\n')+'\n';assert.equal(text.length,49152);
 add(`actual-instruction-bound/${kind}/${count}`,original.stage,text,clone(original.components),count===768,kind==='ordinary'&&count===768);
}
// Every prediction is frozen before touching either actual native or Wasm result.
fs.writeFileSync(path.join(out,'predictions.json'),JSON.stringify({task:'E6-T12g6m3b',seeds,cases,novel:'Reentrant opposite-stage compilation during descriptor snapshot, with earlier caller records mutated after copy.'},null,2)+'\n');
const u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const bytes=Buffer.concat([Buffer.from('VEX1'),u(cases.length),...cases.flatMap(c=>{const a=Buffer.from(c.text),b=Buffer.from(c.partner);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(+c.defaultOk),u(a.length),u(c.components.length),u(b.length),...c.components.flatMap(e=>[u(e.register),u(e.component),u(e.word)]),a,b];})]);
fs.writeFileSync(path.join(out,'cases.bin'),bytes);
const nativeBinary=path.resolve(process.argv[3]??'renderer/virgl-shader/build/exact-producer-sanitize/exact-producer-test');
const run=spawnSync(nativeBinary,[],{input:bytes,maxBuffer:128e6,env:{...process.env,LLVM_PROFILE_FILE:path.join(out,'native.profraw'),ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'}});
fs.writeFileSync(path.join(out,'native.log'),run.stdout??'');fs.writeFileSync(path.join(out,'native.stderr'),run.stderr??'');assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.stderr.length,0);
for(const line of run.stdout.toString().split('\n')){const m=/^(EXACT|DEFAULT|PAIR) (\d+) (.*)$/.exec(line);if(m)cases[Number(m[2])][{EXACT:'result',DEFAULT:'defaultResult',PAIR:'pairResult'}[m[1]]]=JSON.parse(m[3]);}
const faultWasm=process.argv[4];
const bridge=await createVirglShaderBridge(faultWasm?{wasmBinary:fs.readFileSync(faultWasm)}:{});
const results=[];
for(const c of cases){
 const request={stage:c.stage,text:c.text,components:clone(c.components)};
 const r=bridge.translateExact(request);assert.equal(r.ok,c.ok,c.name);assert.deepEqual(r,c.result,c.name+' full native/Wasm parity');
 assert.deepEqual(bridge.translate({stage:c.stage,text:c.text}),c.defaultResult,c.name+' default independence');
 assert.deepEqual(bridge.translatePair(c.stage==='vertex'?{vertexText:c.text,fragmentText:c.partner}:{vertexText:c.partner,fragmentText:c.text}),c.pairResult,c.name+' pair independence');
 assert.deepEqual(bridge.translateExact(request),r,c.name+' after pair');
 if(c.ok&&!c.defaultOk){assert.equal(r.metadata.profile,'virgl-webgl2-raw-bits-v42');assert.deepEqual(r.metadata.constantExactDomains[0].components,c.components);const contract=parseConstantDomain(r.metadata,c.stage);assert.equal(contract.ok,true);if(c.name.endsWith('/known'))assert.ok(r.glsl.includes(`/* proved raw UIF */ if (${c.components[0].word!==0})`));}
 else if(c.ok){assert.deepEqual(r,c.defaultResult,'ordinary complete result wins');}
 else {assert.equal(Object.hasOwn(r,'metadata'),false);assert.equal(Object.hasOwn(r,'glsl'),false);}
 results.push({...c});
}
const first=cases[0],normal=()=>({stage:first.stage,text:first.text,components:clone(first.components)});
const other=cases.find(c=>c.stage!==first.stage&&c.ok&&c.name.endsWith('/known'));
const novel=normal();novel.components.push({register:45,component:3,word:9});novel.components.sort((a,b)=>a.register*4+a.component-b.register*4-b.component);
const reference=bridge.translateExact(clone(novel));assert.equal(reference.ok,true);
let nested=null,traps=0;const earlier=novel.components[0],last=novel.components.at(-1);
novel.components[novel.components.length-1]=new Proxy(last,{getOwnPropertyDescriptor(target,key){const d=Object.getOwnPropertyDescriptor(target,key);if(key==='word'){traps++;nested=bridge.translateExact({stage:other.stage,text:other.text,components:clone(other.components)});novel.text='BOGUS';earlier.word=2;}return d;}});
const owned=bridge.translateExact(novel);assert.equal(traps,1);assert.deepEqual(nested,other.result);assert.deepEqual(owned,reference,'reentrant descriptor transaction keeps primitive/earlier tuple snapshots');assert.equal(earlier.word,2);assert.equal(novel.text,'BOGUS');
const schema=[],bad=(input,label)=>{const r=bridge.translateExact(input);assert.equal(r.ok,false,label);assert.equal(r.error.code,'invalid-input',label);schema.push({label,result:r});};let getters=0;
for(const key of ['stage','text','components']){const r=normal();Object.defineProperty(r,key,{get(){getters++;return undefined;}});bad(r,'own-getter/'+key);const p=normal();delete p[key];Object.setPrototypeOf(p,{[key]:normal()[key]});bad(p,'inherited/'+key);}
for(const method of ['ownKeys','getOwnPropertyDescriptor'])for(const level of ['request','array','record']){const r=normal(),target=level==='request'?r:level==='array'?r.components:r.components[0],p=new Proxy(target,{[method](){throw new Error('independent reflection sabotage');}});if(level==='request')bad(p,level+'/'+method);else{if(level==='array')r.components=p;else r.components[0]=p;bad(r,level+'/'+method);}}
for(const key of ['register','component','word'])for(const value of [NaN,Infinity,-1,0.5,'1',{},0x100000000]){const r=normal();r.components[0][key]=value;bad(r,key+'/'+String(value));}
const old=bridge.translate({stage:'vertex',text:partner.fragment});for(const attack of schema)assert.equal(attack.result.ok,false);assert.deepEqual(bridge.translate({stage:'vertex',text:partner.fragment}),old);assert.equal(getters,0);
const report={task:'E6-T12g6m3b',status:'passed',seeds,cases:results,schema,getters,novel:{traps,result:owned,nested,earlierMutatedWord:earlier.word,textAfter:novel.text},harnessSha256:sha(fs.readFileSync(new URL(import.meta.url))),binarySha256:sha(fs.readFileSync(nativeBinary)),inputSha256:sha(bytes),stdoutSha256:sha(run.stdout)};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(out,'native.profraw'),'-o',path.join(out,'native.profdata')]);
fs.writeFileSync(path.join(out,'native-coverage.json'),execFileSync('xcrun',['llvm-cov','export',nativeBinary,`-instr-profile=${path.join(out,'native.profdata')}`],{maxBuffer:128e6}));
console.log(`${cases.length} independent original-executable/native/Wasm transactions, ${schema.length} schema attacks; reentrant snapshot held.`);
