#!/usr/bin/env node
// Fresh critic: independent integer predicates, source-version and dead-state attacks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
const root=process.cwd(),original=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p));
const modulePath=path.resolve(original,'generated/wasm/virgl-shader.mjs'),wasmPath=path.resolve(original,'generated/wasm/virgl-shader.wasm'),binary=path.resolve(original,'generated/known-branch-sanitize/known-branch-test');
const policyPath=path.resolve(process.argv[4]??'renderer/virgl-command/constant-domain.mjs'),{parseConstantDomain,checkConversionBank}=await import(pathToFileURL(policyPath));
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nEND\n',fragment='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {.25,.5,.75,1}\nMOV OUT[0], IMM[0]\nEND\n';
const color=[1048576000,1056964608,1061158912,1065353216];
const prog=(body,words=[0,1,2147483648,2143289345],extra=[])=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..7]',...extra,`IMM[0] UINT32 {${words}}`,`IMM[1] UINT32 {${color}}`,...body,'END',''].join('\n');
const branch=(cond,truth,live=['MOV OUT[0], IMM[1]'],dead=['SIN TEMP[7], IN[0]'])=>[`UIF ${cond}`,...(truth?live:dead),'ELSE',...(truth?dead:live),'ENDIF'];
const cases=[],add=(name,text,ok,prediction,stage='fragment',properties={})=>cases.push({name,stage,text,ok,pairOk:ok,partner:stage==='vertex'?fragment:vertex,prediction,...properties});
const seeds=[0xa4093822,0x299f31d0];
for(const seed of seeds){let x=seed;const next=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
 for(let i=0;i<8;i++){
  const word=next()||2147483648,bit=(1<<(next()%32))>>>0,n=i%4,lane='xyzw'[n],w=[next(),next(),next(),next()];w[n]=i%2?word:0;
  add(`raw-swizzle/${seed}/${i}`,prog([`MOV TEMP[0].${lane}, IMM[0].${lane.repeat(4)}`,...branch(`TEMP[0].${lane.repeat(4)}`,w[n]!==0)],w),true,'Only the just-written selected raw lane decides; all other immediate lanes are irrelevant.');
  add(`stale-selected-version/${seed}/${i}`,prog([`MOV TEMP[0].${lane}, IMM[0].${lane.repeat(4)}`,`MOV TEMP[0].${lane}, IN[0].xxxx`,...branch(`TEMP[0].${lane.repeat(4)}`,true)],w),false,'Live unknown overwrite of the same mask erases raw word truth, so live unsafe SIN cannot be pruned.');
  add(`unrelated-mask/${seed}/${i}`,prog([`MOV TEMP[0], IMM[0]`,`MOV TEMP[0].${'xyzw'[(n+1)%4]}, IN[0].xxxx`,...branch(`TEMP[0].${lane.repeat(4)}`,w[n]!==0)],w),true,'Writing a disjoint mask does not erase the selected original word.');
  add(`proved-bit/${seed}/${i}`,prog([`OR TEMP[0].x, IN[0].xxxx, IMM[0].xxxx`,...branch('TEMP[0].xxxx',true)],[bit,0,0,0]),true,'The independently chosen one bit proves raw nonzero for every dynamic input word.');
  add(`unknown-bit/${seed}/${i}`,prog([`AND TEMP[0].x, IN[0].xxxx, IMM[0].xxxx`,...branch('TEMP[0].xxxx',true)],[bit,0,0,0]),false,'Only the dynamic chosen bit survives AND: zero remains possible and there is no proved one.');
  add(`nested-dead-discard/${seed}/${i}`,prog(branch('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['UIF TEMP[7].zzzz','KILL_IF -|TEMP[6]|','ELSE','UARL ADDR[0].x, TEMP[5].wwww','MOV TEMP[4], CONST[ADDR[0].x]','ENDIF']),[0,word,bit,0],['DCL CONST[0..3]','DCL ADDR[0]']),true,'Nested reads and terminating discard inside an unreachable parent cannot affect fallthrough facts; actual dead indirect use accounts for ADDR.');
  add(`address-version-not-published/${seed}/${i}`,prog(['UIF IMM[0].xxxx','UARL ADDR[0].x, IMM[0].xxxx','ELSE','MOV TEMP[0], IMM[1]','ENDIF','MOV OUT[0], CONST[ADDR[0].x]'],[0,word,bit,0],['DCL CONST[0..3]','DCL ADDR[0]']),false,'A dead address write cannot initialize a live indirect read.');
 }
}
add('novel/aliased-swizzle',prog(['MOV TEMP[0], IMM[0]','MOV TEMP[0].xy, TEMP[0].yxxx',...branch('TEMP[0].xxxx',true)],[0,2147483648,0,0]),true,'Aliased masked MOV reads old y for x before publishing either destination; x becomes raw negative-zero and true.');
add('novel/aliased-other-lane',prog(['MOV TEMP[0], IMM[0]','MOV TEMP[0].xy, TEMP[0].yxxx',...branch('TEMP[0].yyyy',false)],[0,2147483648,0,0]),true,'The same aliased MOV reads old x for y; y remains exact zero, independently of the new x.');
add('novel/discard-live-join',prog(['UIF IN[0].xxxx','KILL','ELSE','MOV TEMP[0].z, IMM[0].zzzz','ENDIF',...branch('TEMP[0].zzzz',true)]),true,'Terminated predecessor supplies no join input; surviving initialized z has raw sign bit.');
add('novel/nonterminal-discard-join',prog(['UIF IN[0].xxxx','KILL_IF IMM[0].zzzz','ELSE','MOV TEMP[0].z, IMM[0].zzzz','ENDIF',...branch('TEMP[0].zzzz',true)]),false,'Negative-zero KILL_IF never terminates: the other live predecessor still lacks z.');
add('novel/discard-dead-syntax',prog(branch('IMM[0].xxxx',true,['KILL'],['UIF TEMP[7].xxxx','MOV TEMP[0].q, IMM[1]','ENDIF']),[1,0,0,0]),false,'Even an always-discarding live arm cannot bypass invalid dead destination grammar.');
add('no-numeric-shadow-truth',prog(['ADD TEMP[0].x, IN[0].xxxx, IMM[1].xxxx',...branch('TEMP[0].xxxx',true)]),false,'Numeric shadow and output provenance do not prove a raw bit.');
add('observed-bank-is-not-truth',prog(branch('CONST[0].xxxx',true),[0,1,0,0],['DCL CONST[0]']),false,'CONST data has no captured-value authority even when a caller expects nonzero.');
add('unknown-raster-edge',prog(['UIF IN[0].xxxx','MOV OUT[0], CONST[0]','ELSE','MOV OUT[0], CONST[1]','ENDIF','UIF IMM[0].xxxx','SIN TEMP[7], IN[0]','ENDIF'],[0,1,0,0],['DCL CONST[0..1]']),true,'First dynamic UIF keeps both raster-copy predecessors; only independent exact-zero UIF removes its own SIN.');
for(const tail of ['\nEND\n','\nBOGUS\n','\nUIF IMM[0]\n','\n\u0000'])add('dead-complete-tail/'+JSON.stringify(tail),prog(branch('IMM[0].xxxx',false))+tail,false,'Entire original text, including after END, must reject this extra tail.');
for(const [name,source,expected] of [['raw-minus','-IMM[0].xxxx',false],['wrong-swizzle','IMM[0].yyyy',false]])add(name,prog(branch(source,false),[0,1,0,0]),expected,'Raw UIF permits no numeric modifier, and y is true so the unsafe then arm is live.');
const held=read(path.join(original,'hot/native/report.json')).cases;
for(const stage of ['vertex','fragment']){
 const full=held.find(c=>c.name==='held/profile-26-'+stage).text.replaceAll('_PRECISE','');
 add('complete-radial-loop-old/'+stage,full,true,'Whole previously certified radial/count loop graph remains admitted through nonprecise v16.',stage,{expectedProfile:'virgl-webgl2-raw-bits-v16'});
 add('complete-radial-loop-branch/'+stage,full.replace('\nEND\n',`\nUIF IMM[3].zzzz\nSIN TEMP[117], IN[${stage==='vertex'?0:1}]\nENDIF\nEND\n`),true,'Whole inherited radial/count certificates compose with an independently proved dead SIN; all old bank/indirect/count guards remain.',stage,{expectedBranchBase:'virgl-webgl2-raw-bits-v16'});
}
add('original-discard-priority','FRAG\nDCL OUT[0], COLOR\nKILL\nEND\n',true,'Original always-discard successful result wins before any retry.', 'fragment',{expectedProfile:'virgl-webgl2-raw-bits-v39'});
add('original-coordinate-priority','FRAG\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n',true,'Original coordinate-copy result wins before any retry.', 'fragment',{expectedProfile:'virgl-webgl2-raw-bits-v38'});
// Scope-complete boundary attacks authored by the fresh critic, before running.
for(const word of [0x80000000,0x7f800001,0xffc12345])add('explicit-raw-truth/'+word,prog(branch('IMM[0].xxxx',true),[word,0,0,0]),true,'Raw negative zero and either sign of nonzero NaN encoding take the nonzero UIF edge.');
add('true-without-else',prog(['UIF IMM[0].yyyy','MOV OUT[0], IMM[1]','ENDIF']),true,'True edge alone supplies the complete output; unknown fallthrough does not participate.');
add('false-without-else',prog(['MOV OUT[0], IMM[1]','UIF IMM[0].xxxx','SIN OUT[0], IN[0]','ENDIF']),true,'False edge without ELSE preserves the live preceding output.');
add('missing-live-output',prog(['UIF IMM[0].xxxx','MOV OUT[0], IMM[1]','ENDIF']),false,'Only the dead edge writes OUT: live output remains uninitialized.');
add('missing-live-output-mask',prog(branch('IMM[0].xxxx',false,['MOV OUT[0].xyz, IMM[1]'],['MOV OUT[0].w, IMM[1].wwww'])),false,'Dead w write cannot complete the live xyz output mask.');
add('missing-live-temp',prog(branch('IMM[0].yyyy',true,['MOV OUT[0], TEMP[0]'])),false,'A live uninitialized TEMP read cannot be hidden behind a proved-true selector.');
for(const seed of seeds){const bit=(1<<(seed%32))>>>0;
 add('join-retains-common-one/'+seed,prog(['UIF IN[0].xxxx','OR TEMP[0].x, IN[0].yyyy, IMM[0].yyyy','ELSE','OR TEMP[0].x, IN[0].zzzz, IMM[0].yyyy','ENDIF',...branch('TEMP[0].xxxx',true)],[0,bit,0,0]),true,'Both live dynamic predecessors guarantee the same independently chosen one bit.');
 add('join-conflicting-zero-one/'+seed,prog(['UIF IN[0].xxxx','MOV TEMP[0].x, IMM[0].xxxx','ELSE','MOV TEMP[0].x, IMM[0].yyyy','ENDIF',...branch('TEMP[0].xxxx',true)],[0,bit,0,0]),false,'Join of exact zero and exact one is unknown; neither old selected predecessor grants authority.');
}
add('unused-declared-address',prog(branch('IMM[0].xxxx',false),[0,1,0,0],['DCL CONST[0..3]','DCL ADDR[0]']),false,'Unused ADDR stays rejected when no actual indirect use accounts for its declaration.');
add('live-indirect-initialized',prog(['UARL ADDR[0].x, IMM[0].xxxx',...branch('IMM[0].xxxx',false,['MOV OUT[0], CONST[ADDR[0].x]'])],[0,1,0,0],['DCL CONST[0..3]','DCL ADDR[0]']),true,'An actual live authorized address-zero write supplies live indirect read authority; all bank guards remain.');
add('dead-indirect-missing-bank',prog(branch('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['MOV TEMP[0], CONST[ADDR[0].x]']),[0,1,0,0],['DCL ADDR[0]']),false,'Dead indirect use still requires an originally declared CONST bank.');
add('dead-indirect-missing-address',prog(branch('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['MOV TEMP[0], CONST[ADDR[0].x]']),[0,1,0,0],['DCL CONST[0]']),false,'Dead indirect use still requires an originally declared ADDR.');
for(const bad of ['SQRT TEMP[7], IN[0]','SIN TEMP[7]','SIN TEMP[7], |IN[0]|','MOV TEMP[7], IN[0].qqqq','MOV TEMP[8], IMM[1]','UIF -IMM[0]','KILL_IF |TEMP[7]','BRK'])add('dead-original-grammar/'+bad,prog(branch('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],[bad])),false,'Complete dead original opcode/arity/modifier/declaration/control grammar remains enforced.');
add('dead-unrecognized-loop',prog(branch('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['BGNLOOP :0','BRK','ENDLOOP :0'])),false,'A syntactically balanced unrecognized loop cannot be waived in a dead arm.');
add('dead-malformed-loop-frame',prog(['UIF IMM[0].xxxx','BGNLOOP :0','UIF IMM[0].xxxx','ENDLOOP :0','ENDIF','ENDIF','MOV OUT[0], IMM[1]']),false,'Original syntax must reject ENDLOOP when the top frame is a UIF, even before certificate recognition and despite a dead parent.');
const recognizedDead=held.find(c=>c.name==='loop/recognized-dead').text;
add('dead-corrupted-loop-certificate',recognizedDead.replace('UADD TEMP[8].x, TEMP[3].xxxx, IMM[0].yyyy','UADD TEMP[8].x, TEMP[3].xxxx, IMM[0].xxxx'),false,'Mutating the certified loop step from one to zero rejects the whole original graph even when its parent edge is dead.','vertex');
const labelled=prog(['0: UIF IMM[0].xxxx :2','1: SIN TEMP[7], IN[0]','2: ELSE :4','3: MOV OUT[0], IMM[1]','4: ENDIF']).replace('\nEND\n','\n5: END\n');
add('complete-labelled-positions',labelled,true,'Original labels and branch targets continue to address original instruction slots after dead emission.');
for(const [name,t] of [['wrong-first-label',labelled.replace('0: UIF','1: UIF')],['wrong-dead-target',labelled.replace('xxxx :2','xxxx :3')],['out-of-range-target',labelled.replace('xxxx :2','xxxx :768')],['double-dead-else',labelled.replace('1: SIN TEMP[7], IN[0]','1: ELSE')]])add('complete-labelled-'+name,t,false,'All original instruction positions and targets must validate before pruning.');
for(const depth of [16,17])add('complete-flow-depth/'+depth,prog([...Array(depth).fill('UIF IMM[0].xxxx'),'SIN TEMP[7], IN[0]',...Array(depth).fill('ENDIF'),'MOV OUT[0], IMM[1]']),depth===16,'Full original nesting bound is 16, including dead nested parents.');
for(const count of [768,769])add('complete-instruction-bound/'+count,prog(['UIF IMM[0].xxxx',...Array(count-4).fill('MOV TEMP[0], TEMP[7]'),'ELSE','MOV OUT[0], IMM[1]','ENDIF']),count===768,'All original data and control slots count toward the 768 bound, including dead data.');
for(const width of [512,513]){const line='SIN TEMP[7], IN[0]';add('complete-line-bound/'+width,prog(branch('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],[line+' '.repeat(width-line.length)])),width===512,'The original line limit counts dead trailing whitespace.');}
for(const size of [49152,49153]){const base=prog(branch('IMM[0].xxxx',false));add('complete-source-bound/'+size,base+'\n'.repeat(size-Buffer.byteLength(base)),size===49152,'The byte limit applies to the complete untouched original source.');}
for(const index of [511,512])add('complete-register-bound/'+index,prog(branch('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],[`MOV TEMP[${index}], TEMP[${index}]`]),[0,1,0,0],[`DCL TEMP[${index}]`]),index===511,'The declaration/register limit applies even to actual dead reads and writes.');
const words=[{op:0,a:0,b:1069547520,wanted:1069547520},{op:0,a:1069547520,b:0,wanted:1069547520}],u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const fixture=Buffer.concat([Buffer.from('VKA1'),u(words.length),...words.flatMap(w=>[u(w.op),u(w.a),u(w.b),u(w.wanted)]),u(cases.length),...cases.flatMap(c=>{const t=Buffer.from(c.text),p=Buffer.from(c.partner);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(t.length),u(p.length),u(+c.pairOk),t,p];})]);
const predictionRaw=JSON.stringify({schema:1,task:'E6-T12g6m2',seeds,words,cases},null,2)+'\n';fs.writeFileSync(path.join(out,'predictions.json'),predictionRaw);fs.writeFileSync(path.join(out,'cases.bin'),fixture);
const report={schema:1,task:'E6-T12g6m2',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'running',seeds,predictionsSha256:hash(predictionRaw),fixtureSha256:hash(fixture),binary:{path:binary,sha256:hash(fs.readFileSync(binary))},wasm:{path:wasmPath,sha256:hash(fs.readFileSync(wasmPath))},policy:{path:policyPath,sha256:hash(fs.readFileSync(policyPath))},cases:[],policyAttacks:[],getterInvocations:0};
try{
 const run=spawnSync(binary,[],{input:fixture,env:{...process.env,LLVM_PROFILE_FILE:path.join(out,'native.profraw'),UBSAN_OPTIONS:'halt_on_error=1',ASAN_OPTIONS:'abort_on_error=1'},maxBuffer:64e6});
 fs.writeFileSync(path.join(out,'native.log'),run.stdout??'');fs.writeFileSync(path.join(out,'native.stderr'),run.stderr??'');assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
 const {default:createModule}=await import(pathToFileURL(modulePath)),module=await createModule({wasmBinary:fs.readFileSync(wasmPath)});
 const native=new Map();for(const line of run.stdout.toString().split('\n')){const m=/^(CASE|PAIR) (\d+) (.*)$/.exec(line);if(m){const n=Number(m[2]),row=native.get(n)??{};row[m[1]]=JSON.parse(m[3]);native.set(n,row);}}
 const req=(texts,pair,stage)=>{const ps=[];try{for(const text of texts){const b=Buffer.from(text),p=module._malloc(b.length+1);assert.ok(p);ps.push(p);module.HEAPU8.set(b,p);module.HEAPU8[p+b.length]=0;}return JSON.parse(module.UTF8ToString(pair?module._bridge_translate_pair(ps[0],Buffer.byteLength(texts[0]),ps[1],Buffer.byteLength(texts[1])):module._bridge_translate(stage==='vertex'?0:1,ps[0],Buffer.byteLength(texts[0]))));}finally{for(const p of ps)module._free(p);}};
 for(const [index,c]of cases.entries()){
  const n=native.get(index);assert.ok(n,c.name);const single=req([c.text],false,c.stage),pair=req(c.stage==='vertex'?[c.text,c.partner]:[c.partner,c.text],true,c.stage);assert.deepEqual(single,n.CASE,c.name+' complete native/Wasm single');assert.deepEqual(pair,n.PAIR,c.name+' complete native/Wasm pair');assert.equal(single.ok,c.ok,c.name+' handwritten public prediction');
  if(c.ok){assert.equal(single.metadata.profile,c.expectedProfile??'virgl-webgl2-raw-bits-v41',c.name);const domain=parseConstantDomain(single.metadata,c.stage);assert.equal(domain.ok,true,c.name);if(!c.expectedProfile)assert.ok(domain.branchLiveness,c.name);if(c.expectedBranchBase)assert.equal(single.metadata.branchBaseProfile,c.expectedBranchBase,c.name);assert.deepEqual(pair[c.stage].metadata,single.metadata);}
  report.cases.push({...c,index,textSha256:hash(c.text),result:single,pair});
 }
 const chosen=report.cases.find(c=>c.name==='unknown-raster-edge').result.metadata;
 for(const key of Object.keys(chosen.branchContract)){
  const forged=structuredClone(chosen);forged.branchContract[key]='forged by fresh critic';const result=parseConstantDomain(forged,'fragment');assert.equal(result.ok,false,'forged branch policy '+key);report.policyAttacks.push({key,result});
  const accessor=structuredClone(chosen);Object.defineProperty(accessor.branchContract,key,{enumerable:true,get(){report.getterInvocations++;return chosen.branchContract[key];}});const a=parseConstantDomain(accessor,'fragment');assert.equal(a.ok,false,'accessor policy '+key);report.policyAttacks.push({key,accessor:true,result:a});
 }
 for(const base of [41,42,0,-1,NaN]){const forged=structuredClone(chosen);forged.branchBaseProfile='virgl-webgl2-raw-bits-v'+base;const result=parseConstantDomain(forged,'fragment');assert.equal(result.ok,false,'non-descending base '+base);report.policyAttacks.push({base:String(base),result});}
 const erased=structuredClone(chosen);delete erased.constantRasterDomains;assert.equal(parseConstantDomain(erased,'fragment').ok,false,'branch never erases old raster obligation');assert.equal(report.getterInvocations,0,'getters remain inert');
 report.status='passed';report.nativeLogSha256=hash(run.stdout);report.nativeStderrSha256=hash(run.stderr);console.log(`${report.cases.length} independent original-native/Wasm singles/pairs; ${report.policyAttacks.length} policy attacks passed.`);
}catch(e){report.status='failed';report.error={name:e.name,message:e.message,stack:e.stack};throw e;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
