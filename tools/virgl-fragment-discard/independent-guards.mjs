#!/usr/bin/env node
// Promoted adversarial guards: literal words, surviving versions and inert own metadata.
// No worker case generator, compiler IR, emitted GLSL or captured pixel oracle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const repo=process.cwd(),options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--sanitize','--output'].includes(process.argv[i]));assert.ok(process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.sanitize&&options.output,'sanitizer binary and output directory required');
const {createVirglShaderBridge}=await import(pathToFileURL(repo+'/renderer/virgl-shader/index.mjs'));
const {parseConstantDomain}=await import(pathToFileURL(repo+'/renderer/virgl-command/constant-domain.mjs'));
const nativeBinary=path.resolve(options.sanitize);
const evidence=path.resolve(options.output);fs.mkdirSync(evidence,{recursive:true});
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
const ordinary='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {.25,.5,.75,1}\nMOV OUT[0], IMM[0]\nEND\n';
const prefix=['FRAG','DCL OUT[0], COLOR','DCL CONST[0]','DCL TEMP[0..2]','IMM[0] FLT32 {.25,.5,.75,1}','IMM[1] UINT32 {3212836864,0,0,0}','IMM[2] UINT32 {2147483648,0,0,0}'];
const make=(body,headers=prefix)=>[...headers,...body,'END',''].join('\n');
const cases=[],add=(name,text,ok,always=false,stage='fragment')=>cases.push({name,text,ok,always,stage,partner:stage==='fragment'?vertex:ordinary,pairOk:ok});
const words=[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7fc12345,0xffc12345,0x7f800001,0xff800001,0x7fffffff,0xffffffff];
const decode=w=>{const b=new ArrayBuffer(4),d=new DataView(b);d.setUint32(0,w,true);return d.getFloat32(0,true);};
const modifiers=[['',''],['-',''],['','|'],['-','|']];
for(const value of words)for(let lane=0;lane<4;lane++)for(const [negative,absolute]of modifiers){
 const v=Array(4).fill(0);v[lane]=value;let f=decode(value);if(absolute)f=Math.abs(f);if(negative)f=-f;
 add('ordered-'+value.toString(16)+'-'+lane+'-'+negative+absolute,make([`KILL_IF ${negative}${absolute}IMM[3]${absolute}`,'MOV OUT[0], IMM[0]'],[...prefix,`IMM[3] UINT32 {${v}}`]),true,f<0);
}
let rng=0x6d2b79f5;const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;};
for(let n=0;n<64;n++){
 const v=Array.from({length:4},()=>random()),swizzle=Array.from({length:4},()=>['x','y','z','w'][random()%4]).join('');const [negative,absolute]=modifiers[random()%4];
 const killed=[...swizzle].some(c=>{let value=decode(v['xyzw'.indexOf(c)]);if(absolute)value=Math.abs(value);if(negative)value=-value;return value<0;});
 add('fresh-word-alias-'+n,make(['MOV TEMP[0], IMM[3]','MOV TEMP[0], TEMP[0].wzyx',`KILL_IF ${negative}${absolute}TEMP[0].${swizzle}${absolute}`,'MOV OUT[0], IMM[0]'],[...prefix,`IMM[3] UINT32 {${v.slice().reverse()}}`]),true,killed);
}
const novel=make(['UIF CONST[0].xxxx','MOV TEMP[0], IMM[1]','KILL_IF TEMP[0]','ELSE','MOV TEMP[0], IMM[2]','ENDIF','KILL_IF TEMP[0]','MOV OUT[0], IMM[0]']);
add('novel-killed-negative-versus-surviving-negative-zero',novel,true,false);
add('novel-survivor-without-word-initialization',novel.replace('MOV TEMP[0], IMM[2]\n',''),false);
add('novel-survivor-excludes-killed-numeric-origin',make(['UIF CONST[0].xxxx','MOV TEMP[0], IMM[0]','KILL','ELSE','NOT TEMP[0], CONST[0]','ENDIF','KILL_IF IMM[2]','ADD OUT[0], TEMP[0], IMM[0]']),false);
add('novel-survivor-excludes-killed-address',make(['UIF CONST[0].xxxx','UARL ADDR[0].x, IMM[2]','KILL','ENDIF','KILL_IF IMM[2]','MOV OUT[0], CONST[ADDR[0].x]'],[...prefix.slice(0,4),'DCL ADDR[0]',...prefix.slice(4)]),false);
for(const mask of ['x','xy','xyz'])for(const swizzle of ['xxxx','yyyy','zzzz','wwww','xyzw']){
 const ok=[...swizzle].every(c=>mask.includes(c));
 add('source-initialization-'+mask+'-'+swizzle,make([`MOV TEMP[0].${mask}, IMM[1]`,`KILL_IF TEMP[0].${swizzle}`,'MOV OUT[0], IMM[0]']),ok,ok&&swizzle.includes('x'));
}
add('destination-overwrite-erases-old-negative',make(['MOV TEMP[0], IMM[1]','MOV TEMP[0].x, IMM[2]','KILL_IF TEMP[0]','MOV OUT[0], IMM[0]']),true,false);
add('saved-version-retains-old-negative',make(['MOV TEMP[0], IMM[1]','MOV TEMP[1], TEMP[0]','MOV TEMP[0], IMM[2]','KILL_IF TEMP[1]','MOV OUT[0], IMM[0]']),true,true);
add('dead-source-still-initialized',make(['KILL','KILL_IF TEMP[1]']),false);
add('all-dead-source-still-initialized',make(['UIF CONST[0].xxxx','KILL','ELSE','KILL','ENDIF','KILL_IF TEMP[1]']),false);
add('dead-valid-source-terminal',make(['KILL','KILL_IF IMM[2]']),true,true);
add('partially-known-sign-not-terminal',make(['OR TEMP[0], CONST[0], IMM[2]','KILL_IF TEMP[0]','MOV OUT[0], IMM[0]']),true,false);
for(const count of [767,768,769])add('instruction-bound-'+count,make(Array(count).fill('KILL'),['FRAG','DCL OUT[0], COLOR']),count<=768,true);
for(const depth of [15,16,17])add('depth-'+depth,make([...Array(depth).fill('UIF CONST[0].xxxx'),'KILL',...Array(depth).fill('ENDIF'),'MOV OUT[0], IMM[0]']),depth<=16,false);
for(const label of ['0','1','00','767','768','1000'])add('label-'+label,make([label+': KILL','MOV OUT[0], IMM[0]']),['0','00'].includes(label),true);
for(const op of ['KILL','KILL_IF IN[0]','KILL_IF -|IN[0]|'])add('wrong-stage-'+op,vertex.replace('END',op+'\nEND'),false,false,'vertex');
for(const op of ['KILL_PRECISE','KILL_SAT','KILL_IF_SAT IMM[1]','KILL_IF_PRECISE IMM[1]','DEMOTE','KILL IMM[1]','KILL_IF IMM[1], IMM[2]','KILL_IF TEMP[2].xyzw','KILL_IF OUT[0]','KILL_IF -|IMM[1]','KILL_IF ||IMM[1]||','KILL_IF --IMM[1]'])add('malformed-'+op,make([op,'MOV OUT[0], IMM[0]']),false);
for(const decl of ['DCL OUT[0..1], COLOR','DCL OUT[1], COLOR','DCL OUT[7], COLOR','DCL OUT[1], GENERIC[0]','DCL OUT[1], POSITION'])add('out-of-domain-'+decl,make(['KILL'],['FRAG','DCL OUT[0], COLOR',decl]),false);
add('uninitialized-surviving-output',make(['UIF CONST[0].xxxx','KILL','ELSE','MOV OUT[0].x, IMM[0]','ENDIF']),false);
add('zero-not-terminal-surviving-output',make(['UIF CONST[0].xxxx','KILL_IF IMM[2]','ELSE','MOV OUT[0], IMM[0]','ENDIF']),false);
add('both-terminal-no-output',make(['UIF CONST[0].xxxx','KILL','ELSE','KILL_IF IMM[1]','ENDIF']),true,true);
const predictionRaw=JSON.stringify({task:'E6-T12g6l',seed:0x6d2b79f5,cases},null,2)+'\n';fs.writeFileSync(evidence+'/predictions.json',predictionRaw);
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const fixture=Buffer.concat([Buffer.from('VDG1'),u32(cases.length),...cases.flatMap(c=>{const t=Buffer.from(c.text),p=Buffer.from(c.partner);return[u32(c.stage==='fragment'?1:0),u32(+c.ok),u32(0),u32(t.length),u32(p.length),u32(+c.pairOk),t,p];})]);
fs.writeFileSync(evidence+'/cases.bin',fixture);
const run=spawnSync(nativeBinary,[],{input:fixture,env:{...process.env,LLVM_PROFILE_FILE:evidence+'/native.profraw',ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'},maxBuffer:128e6});
fs.writeFileSync(evidence+'/native.log',run.stdout??'');fs.writeFileSync(evidence+'/native.stderr',run.stderr??'');assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.stderr.length,0);
const outputs=cases.map(c=>({...c}));
for(const line of run.stdout.toString().trim().split('\n')){const m=/^(CASE|PAIR) (\d+) (.*)$/.exec(line);if(m)outputs[Number(m[2])][m[1]==='CASE'?'native':'nativePair']=JSON.parse(m[3]);else assert.equal(line,'STATUS passed');}
const wasm=await createVirglShaderBridge(),owned=[],forgeries=[];let accessorInvocations=0;
const verifyAlways=(actual,wanted,label)=>assert.equal(actual,wanted,label+' terminal liveness');
for(const c of outputs){
 assert.equal(c.native.ok,c.ok,c.name);assert.equal(c.nativePair.ok,c.pairOk,c.name+' pair');
 if(c.ok){verifyAlways(c.native.metadata.discardContract.alwaysDiscards,c.always,c.name);assert.equal(c.nativePair.interfaceKey.endsWith('|tgsi-fragment-discard-v1:ordered-any-negative/raw-words/always-'+Number(c.always)),true,c.name+' key');}
 else for(const key of ['metadata','glsl'])assert.equal(Object.hasOwn(c.native,key),false,c.name+' closed rejection');
 c.wasm=wasm.translate({stage:c.stage,text:c.text});c.wasmPair=wasm.translatePair(c.stage==='fragment'?{vertexText:c.partner,fragmentText:c.text}:{vertexText:c.text,fragmentText:c.partner});assert.deepEqual(c.wasm,c.native);assert.deepEqual(c.wasmPair,c.nativePair);
 if(!c.ok)continue;
 const md=structuredClone(c.native.metadata),parsed=parseConstantDomain(md,'fragment');assert.equal(parsed.ok,true);const before=JSON.stringify(parsed);md.discardContract.operations.reverse();md.discardContract.alwaysDiscards=!md.discardContract.alwaysDiscards;md.outputs[0].writtenMask=0;assert.equal(JSON.stringify(parsed),before);assert.equal(Object.isFrozen(parsed.discard.operations),true);owned.push(c.name);
}
{
 const base=outputs.find(c=>c.ok&&!c.always).native.metadata;
 const attack=(name,make)=>{const md=structuredClone(base);make(md);const observed=parseConstantDomain(md,'fragment');assert.equal(observed.ok,false,name);forgeries.push({name,observed});};
 attack('inherited-policy-fields',m=>m.discardContract=Object.create(m.discardContract));
 attack('inherited-metadata-fields',m=>{const p=structuredClone(m);for(const k of Object.keys(m))delete m[k];Object.setPrototypeOf(m,p);});
 attack('symbol-policy-key',m=>m.discardContract[Symbol('other')]=1);
 attack('nonenumerable-policy-key',m=>Object.defineProperty(m.discardContract,'other',{value:1}));
 attack('nonenumerable-operation-key',m=>Object.defineProperty(m.discardContract.operations,'other',{value:1}));
 attack('prototype-operation-slot',m=>{const a=m.discardContract.operations;const p=Object.create(Array.prototype);Object.defineProperty(p,0,{get(){accessorInvocations++;return 'KILL_IF';}});delete a[0];Object.setPrototypeOf(a,p);});
 attack('prototype-output-slot',m=>{const a=m.outputs;const p=Object.create(Array.prototype);Object.defineProperty(p,0,{get(){accessorInvocations++;return base.outputs[0];}});delete a[0];Object.setPrototypeOf(a,p);});
 attack('policy-own-getter',m=>Object.defineProperty(m.discardContract,'alwaysDiscards',{get(){accessorInvocations++;return true;}}));
 attack('wrong-v39-base',m=>m.discardBaseProfile='virgl-webgl2-raw-bits-v39');
 attack('unproven-survivor-mask',m=>m.outputs[0].writtenMask=1);
 assert.equal(accessorInvocations,0);
}
const result={schema:'fragment-discard-independent-guards-v1',task:'E6-T12g6l',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),runtimeSources:['bridge.c','raw_bits.c','raw_bits.h'].map(name=>({path:'renderer/virgl-shader/'+name,sha256:createHash('sha256').update(fs.readFileSync(path.join(repo,'renderer/virgl-shader',name))).digest('hex')})),seed:0x6d2b79f5,cases:outputs,forgeries,accessorInvocations,predictionsSha256:createHash('sha256').update(predictionRaw).digest('hex'),nativeBinarySha256:createHash('sha256').update(fs.readFileSync(nativeBinary)).digest('hex'),nativeLogSha256:createHash('sha256').update(run.stdout).digest('hex')};
fs.writeFileSync(evidence+'/report.json',JSON.stringify(result,null,2)+'\n');console.log(outputs.length+' fresh native/Wasm single/pair predictions and '+forgeries.length+' strict ownership attacks passed.');
