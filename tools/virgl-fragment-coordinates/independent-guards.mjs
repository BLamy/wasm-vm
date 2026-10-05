#!/usr/bin/env node
// Specification guards: builtin bounds and known-lane authority after overwrites.
// No imports from the worker case generator, compiler IR or pixel oracle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.cwd(),options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--native','--sanitize','--output'].includes(process.argv[i]));options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.native&&options.output,'native binary and report required');
const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));
const {parseConstantDomain,checkRasterBank}=await import(pathToFileURL(path.join(root,'renderer/virgl-command/constant-domain.mjs')));
const bridge=await createVirglShaderBridge(),hash=b=>createHash('sha256').update(b).digest('hex');
const POLICY={kind:'tgsi-fragment-position-v1',stage:'fragment',input:0,semanticIndex:0,source:'gl_FragCoord',interpolation:'linear',origin:'lower-left',pixelCenter:'half-integer',components:'window-xy-depth-z-reciprocal-clip-w',precision:'essl3-highp-builtin',rasterization:'single-sample-half-pixel',surfaceOrigin:'lower-left',authority:'existing-input-no-static-range-facts'};
const BUILTIN={index:0,name:'gl_FragCoord',type:'vec4',semantic:'POSITION',semanticIndex:0,componentMask:15,interpolation:'linear'};
const KEY='|tgsi-fragment-position-v1:in0/linear/lower-left/half-integer/window-z/reciprocal-w';
const props=['PROPERTY FS_COORD_ORIGIN LOWER_LEFT','PROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER'];
const header=['FRAG',...props,'DCL IN[0], POSITION, LINEAR'];
const suffix=m=>[...'xyzw'].filter((_,i)=>m&(1<<i)).join('');
const singlePartner='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
const fragment=body=>[...header,'DCL OUT[0], COLOR','DCL TEMP[0..3]','IMM[0] UINT32 {1065353216,1065353216,1065353216,1065353216}',...body,'END',''].join('\n');
const cases=[];
const add=(name,text,ok,fields={})=>cases.push({name,text,ok,partner:singlePartner,pairOk:ok,...fields});
add('original-direct',fragment(['MOV OUT[0], IN[0]']),true,{direct:true});
for(const [label,mutate]of [
 ['origin-upper-left',t=>t.replace('LOWER_LEFT','UPPER_LEFT')],['center-integer',t=>t.replace('HALF_INTEGER','INTEGER')],
 ['origin-missing',t=>t.replace(props[0]+'\n','')],['center-missing',t=>t.replace(props[1]+'\n','')],
 ['origin-duplicate',t=>t.replace(props[0],props[0]+'\n'+props[0])],['center-duplicate',t=>t.replace(props[1],props[1]+'\n'+props[1])],
 ['position-mask3',t=>t.replace('IN[0], POSITION','IN[0].xy, POSITION')],['position-mask7',t=>t.replace('IN[0], POSITION','IN[0].xyz, POSITION')],
 ['position-register7',t=>t.replaceAll('IN[0]','IN[7]')],['position-register8',t=>t.replaceAll('IN[0]','IN[8]')],
 ['position-range',t=>t.replace('DCL IN[0]','DCL IN[0..1]')],['position-perspective',t=>t.replace('LINEAR','PERSPECTIVE')],
 ['position-output',t=>t.replace('OUT[0], COLOR','OUT[0], POSITION')],['output-register1',t=>t.replaceAll('OUT[0]','OUT[1]')],
 ['output-incomplete',t=>t.replace('MOV OUT[0], IN[0]','MOV OUT[0].x, IN[0]')],['discard',t=>t.replace('END','KILL\nEND')]
])add(label,mutate(cases[0].text),false);
// Eight registers include POSITION and GENERIC0 without confusing semanticIndex0.
const semantics=[0,2,3,4,5,6,7];
for(const interpolation of ['PERSPECTIVE','CONSTANT'])for(const mask of [3,7,15])for(const reverse of [false,true]){
 const declarations=['DCL IN[0], POSITION, LINEAR',...semantics.map((sid,i)=>`DCL IN[${i+1}]${mask===15?'':'.'+suffix(mask)}, GENERIC[${sid}], ${interpolation}`)];
 const text=['FRAG',...(reverse?props.toReversed():props),...(reverse?declarations.toReversed():declarations),'DCL OUT[0], COLOR','MOV OUT[0], IN[0]','END',''].join('\n');
 const outputs=semantics.map((sid,i)=>`DCL OUT[${i+1}], GENERIC[${sid}]`);
 const partner=['VERT','DCL IN[0]','DCL OUT[0], POSITION',...outputs,'MOV OUT[0], IN[0]',...semantics.map((_,i)=>`MOV OUT[${i+1}], IN[0]`),'END',''].join('\n');
 const inputs=[BUILTIN,...semantics.map((sid,i)=>({index:i+1,name:`vso_g${sid}`,type:'vec4',semantic:'GENERIC',semanticIndex:sid,componentMask:mask,interpolation:interpolation==='CONSTANT'?'flat':'smooth'}))];
 add(`eight-inputs-${interpolation}-${mask}-${reverse}`,text,true,{partner,inputs});
 const missing=partner.replace(outputs[6]+'\n','').replace('MOV OUT[7], IN[0]\n','');
 add(`missing-GENERIC7-${interpolation}-${mask}-${reverse}`,text,true,{partner:missing,pairOk:false,inputs});
 add(`ninth-input-${interpolation}-${mask}-${reverse}`,text.replace('DCL OUT[0]',`DCL IN[8], GENERIC[1], ${interpolation}\nDCL OUT[0]`),false,{partner});
 add(`duplicate-GENERIC0-${interpolation}-${mask}-${reverse}`,text.replace('GENERIC[7]','GENERIC[0]'),false,{partner});
}
// An unknown builtin becomes known only where an explicit literal overwrites it.
// Snapshot and alias variants challenge both source and destination versions.
for(let mask=1;mask<=15;mask++)for(let lane=0;lane<4;lane++)for(const version of ['live','saved','killed','reversed']){
 const body=['MOV TEMP[0], IN[0]',`MOV TEMP[0].${suffix(mask)}, IMM[0]`];
 let source='TEMP[0]',consumed=lane;
 if(version==='saved'){body.push('MOV TEMP[2], TEMP[0]','MOV TEMP[0], IN[0]');source='TEMP[2]';}
 if(version==='killed')body.push('MOV TEMP[2], TEMP[0]','MOV TEMP[0], IN[0]');
 if(version==='reversed'){body.push('MOV TEMP[0], TEMP[0].wzyx');consumed=3-lane;}
 body.push(`F2I TEMP[1], ${source}.${'xyzw'[lane].repeat(4)}`,'I2F OUT[0], TEMP[1]');
 add(`conversion-${version}-${mask}-${lane}`,fragment(body),version!=='killed'&&Boolean(mask&(1<<consumed)));
}
for(const op of ['EX2','LG2','SIN','POW'])for(let mask=1;mask<=15;mask++){
 const body=['MOV TEMP[0], IN[0]',`MOV TEMP[0].${suffix(mask)}, IMM[0]`,`${op} TEMP[1], TEMP[0]${op==='POW'?', IMM[0]':''}`,'MOV OUT[0], TEMP[1]'];
 add(`bounded-${op}-mask-${mask}`,fragment(body),Boolean(mask&1));
}
// The new outer wrapper must retain the old copied-word bank restriction even
// though its POSITION input is unused by this particular isolated program.
for(let mask=1;mask<=15;mask++){
 const body=['DCL CONST[0..1]','OR TEMP[3], IMM[0], IMM[0]','MOV TEMP[0], CONST[0]','MOV TEMP[2], IMM[0]',`MOV TEMP[2].${suffix(mask)}, TEMP[0].wzyx`,'MOV OUT[0], TEMP[2]'];
 const copiedMask=[...'xyzw'].reduce((result,_,i)=>result|((mask&(1<<i))?(1<<(3-i)):0),0);
 add('coordinate-raster-bank-'+mask,fragment(body),true,{copiedMask});
}
let metadataAttacks=0,getterInvocations=0,bankAttacks=0;const banks=[],metadataRecords=[];
const native=[],wasm=[],predictions=cases.map(c=>({name:c.name,ok:c.ok,pairOk:c.pairOk,textSha256:hash(c.text),partnerSha256:hash(c.partner)}));
for(const c of cases){
 const run=spawnSync(options.native,['fragment'],{input:c.text,encoding:'utf8',maxBuffer:4e6});assert.equal(run.status,0);assert.equal(run.stderr,'');
 const result=JSON.parse(run.stdout),w=bridge.translate({stage:'fragment',text:c.text}),pair=bridge.translatePair({vertexText:c.partner,fragmentText:c.text});
 assert.equal(result.ok,c.ok,c.name+' predetermined native admission');assert.equal(w.ok,c.ok,c.name+' predetermined Wasm admission');assert.deepEqual(w,result,c.name+' complete source/metadata parity');assert.equal(pair.ok,c.pairOk,c.name+' predetermined pair admission');
 if(!c.ok){for(const r of [result,w])for(const k of ['glsl','metadata'])assert.equal(Object.hasOwn(r,k),false,c.name+' closed failure');}
 if(!c.pairOk)for(const k of ['vertex','fragment','metadata'])assert.equal(Object.hasOwn(pair,k),false,c.name+' closed pair');
 if(c.ok){
  assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v38');assert.deepEqual(result.metadata.coordinateContract,POLICY);assert.deepEqual(result.metadata.inputs,c.inputs??[BUILTIN]);
  const contract=parseConstantDomain(result.metadata,'fragment');assert.equal(contract.ok,true);assert.deepEqual(contract.coordinates,POLICY);assert.ok(Object.isFrozen(contract.coordinates));
  if(c.copiedMask){
   assert.equal(result.metadata.coordinateBaseProfile,'virgl-webgl2-raw-bits-v27');assert.deepEqual(contract.rasterDomain.components,[{register:0,mask:c.copiedMask}]);
   const caller=Array(8).fill(0),owned=checkRasterBank(caller,contract.rasterDomain,false,false);assert.equal(owned.ok,true);caller.fill(0xdeadbeef);assert.deepEqual(owned.words,Array(8).fill(0));assert.ok(Object.isFrozen(owned.words));
   for(let lane=0;lane<4;lane++)for(const word of [0,0x80000000,1,0x80000001,0x00800000,0x7f800000,0xff800000,0x7fc12345]){
    const words=owned.words.slice();words[lane]=word;const expected=(word&0x7f800000)!==0x7f800000&&(!(c.copiedMask&(1<<lane))||![1,0x80000001].includes(word)),checked=checkRasterBank(words,contract.rasterDomain,false,false);assert.equal(checked.ok,expected,c.name+' copied-word domain lane'+lane+'/'+word);bankAttacks++;banks.push({name:c.name,lane,word,expected,result:checked});
   }
   const erased=structuredClone(result.metadata);delete erased.constantRasterDomains;assert.equal(parseConstantDomain(erased,'fragment').ok,false,'underlying raster obligation cannot disappear');
  }
  if(c.pairOk){assert.deepEqual(pair.fragment,{glsl:result.glsl,metadata:result.metadata});assert.equal(pair.interfaceKey,'generic-interpolation-v1:'+(c.inputs??[]).filter(i=>i.semantic==='GENERIC').toSorted((a,b)=>a.semanticIndex-b.semanticIndex).map(i=>`g${i.semanticIndex}/${i.componentMask}/${i.interpolation}`).join(';')+KEY);}
  if(c.direct)for(const lane of 'xyzw')assert.ok(result.glsl.includes('gl_FragCoord.'+lane),'component '+lane+' independently addresses its builtin');
 }
 native.push({name:c.name,result});wasm.push({name:c.name,result:w,pair});
}
const normal=native[0].result.metadata;
const attack=(name,mutate)=>{const m=structuredClone(normal);mutate(m);const result=parseConstantDomain(m,'fragment');assert.equal(result.ok,false,name);assert.equal(result.error.code,'shader-domain-error');metadataAttacks++;metadataRecords.push({name,result});};
for(const value of [null,true,7,'POSITION',[],Object.create({semantic:'POSITION'})])attack('non-own POSITION '+String(value),m=>m.inputs[0]=value);
for(const key of Object.keys(BUILTIN))attack('prototype POSITION '+key,m=>{const value=m.inputs[0][key];delete m.inputs[0][key];Object.setPrototypeOf(m.inputs[0],Object.defineProperty({},key,{get(){getterInvocations++;return value;}}));});
for(const key of Object.keys(POLICY))attack('prototype policy '+key,m=>{const value=m.coordinateContract[key];delete m.coordinateContract[key];Object.setPrototypeOf(m.coordinateContract,Object.defineProperty({},key,{get(){getterInvocations++;return value;}}));});
attack('sparse interface',m=>delete m.inputs[0]);attack('extra interface field',m=>m.inputs.extra=true);
attack('symbol policy',m=>m.coordinateContract[Symbol('origin')]='lower-left');
attack('indexed accessor',m=>Object.defineProperty(m.inputs,'0',{get(){getterInvocations++;return BUILTIN;}}));
attack('POSITION semantic accessor',m=>Object.defineProperty(m.inputs[0],'semantic',{get(){getterInvocations++;return 'POSITION';}}));
attack('inherited entire policy',m=>m.coordinateContract=Object.create(POLICY));
assert.equal(getterInvocations,0,'untrusted property getters stay inert');
const additional={};
if(options.sanitize){
 const u=w=>{const b=Buffer.alloc(4);b.writeUInt32LE(w);return b;};
 const fixture=Buffer.concat([Buffer.from('VCG1'),u(cases.length),...cases.flatMap(c=>{const text=Buffer.from(c.text),partner=Buffer.from(c.partner);return[u(1),u(+c.ok),u(0),u(text.length),u(partner.length),u(+c.pairOk),text,partner];})]);
 const output=path.dirname(path.resolve(options.output));fs.mkdirSync(output,{recursive:true});const profile=path.join(output,'independent-native.profraw');
 const run=spawnSync(options.sanitize,[],{input:fixture,env:{...process.env,LLVM_PROFILE_FILE:profile,UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:64e6});
 fs.writeFileSync(path.join(output,'independent-cases.bin'),fixture);fs.writeFileSync(path.join(output,'independent-native.log'),run.stdout??'');fs.writeFileSync(path.join(output,'independent-native.stderr'),run.stderr??'');assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.stderr.length,0);
 for(const line of run.stdout.toString().trim().split('\n')){const m=/^(CASE|PAIR) (\d+) (.*)$/.exec(line);if(!m){assert.equal(line,'STATUS passed');continue;}const i=Number(m[2]),value=JSON.parse(m[3]);assert.deepEqual(value,m[1]==='CASE'?native[i].result:wasm[i].pair,'sanitized complete '+m[1]+' '+cases[i].name);}
 Object.assign(additional,{fixtureSha256:hash(fixture),sanitizedBinarySha256:hash(fs.readFileSync(options.sanitize)),originalProfileSha256:hash(fs.readFileSync(profile)),logSha256:hash(run.stdout)});
}
fs.mkdirSync(path.dirname(path.resolve(options.output)),{recursive:true});
fs.writeFileSync(options.output,JSON.stringify({schema:'fragment-coordinate-independent-guards-v1',task:'E6-T12g6k',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),cases:cases.length,metadataAttacks,bankAttacks,getterInvocations,predictions,native,wasm,banks,metadataRecords,...additional},null,2)+'\n');
console.log(`${cases.length} independent coordinate native/Wasm/pair guards; ${metadataAttacks} inert metadata and ${bankAttacks} copied-bank attacks passed.`);
