#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {cases} from './fixtures.mjs';
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const fixtures=cases();
const bytes=Buffer.concat([Buffer.from('VEP1'),u(fixtures.length),...fixtures.flatMap(c=>{const v=Buffer.from(c.vertexText),f=Buffer.from(c.fragmentText);return[u(v.length),u(f.length),u(c.vertexComponents.length),u(c.fragmentComponents.length),u(+c.ok),u(+c.defaultOk),...[...c.vertexComponents,...c.fragmentComponents].flatMap(e=>[u(e.register),u(e.component),u(e.word)]),v,f];})]);
fs.writeFileSync(path.join(out,'predictions.json'),JSON.stringify(fixtures,null,2)+'\n');fs.writeFileSync(path.join(out,'cases.bin'),bytes);
const binary='renderer/virgl-shader/build/exact-pair-sanitize/exact-pair-test';
const run=spawnSync(binary,[],{input:bytes,maxBuffer:160e6,env:{...process.env,LLVM_PROFILE_FILE:path.join(out,'native.profraw'),ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'}});
fs.writeFileSync(path.join(out,'native.log'),run.stdout??'');fs.writeFileSync(path.join(out,'native.stderr'),run.stderr??'');assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
const failures=[],rejections=[];let alias,layout;
for(const line of run.stdout.toString().trim().split('\n')){
 let m=/^(EXACT|DEFAULT) (\d+) (.*)$/.exec(line);
 if(m){const c=fixtures[+m[2]],r=JSON.parse(m[3]);c[m[1]==='EXACT'?'result':'defaultResult']=r;assert.equal(r.ok,m[1]==='EXACT'?c.ok:c.defaultOk,c.name);}
 else if((m=/^SINGLE (\d+) (\d+) (.*)$/.exec(line))){const c=fixtures[+m[1]];c.singles??=[];c.singles[+m[2]]=JSON.parse(m[3]);}
 else if((m=/^FAILURE (\d+) (\d+) (.*)$/.exec(line)))failures.push({case:+m[1],allocation:+m[2],result:JSON.parse(m[3])});
 else if((m=/^REJECT (\d+) (.*)$/.exec(line))){const result=JSON.parse(m[2]);assert.equal(result.ok,false);rejections.push({index:+m[1],result});}
 else if(line.startsWith('ALIAS '))alias=JSON.parse(line.slice(6));
 else if(line.startsWith('LAYOUT ')){layout=line.split(' ').slice(1).map(Number);assert.deepEqual(layout,[111752,32448,12,2996]);}
 else assert.equal(line,'STATUS passed');
}
const strip=r=>({glsl:r.glsl,metadata:r.metadata});
for(const c of fixtures){
 assert.ok(c.result&&c.defaultResult&&c.singles?.length===2,c.name);
 if(c.ok){
  assert.equal(c.singles[0].ok,true,c.name);assert.equal(c.singles[1].ok,true,c.name);
  assert.deepEqual(c.result.fragment,strip(c.singles[1]),c.name+' entire fragment result unchanged');
  const expected=structuredClone(c.singles[0].metadata);
  for(const line of c.fragmentText.split('\n')){
   const d=/^DCL IN\[\d+\](?:\.[xyzw]+)?, GENERIC\[(\d+)\], (CONSTANT|PERSPECTIVE)/.exec(line);if(!d)continue;
   const output=expected.outputs.find(x=>x.semantic==='GENERIC'&&x.semanticIndex===+d[1]);assert.ok(output);output.interpolation=d[2]==='CONSTANT'?'flat':'smooth';
  }
  assert.deepEqual(c.result.vertex.metadata,expected,c.name+' only full checked fragment-derived vertex interpolation changes');
  if(c.interfaceKey)assert.equal(c.result.interfaceKey,c.interfaceKey,c.name+' literal checked full interface key');
  if(c.defaultOk)assert.deepEqual(c.result,c.defaultResult,c.name+' ordinary whole pair winner');
  for(const [stage,words]of[['vertex',c.vertexComponents],['fragment',c.fragmentComponents]])if(c.result[stage].metadata.profile==='virgl-webgl2-raw-bits-v42')assert.deepEqual(c.result[stage].metadata.constantExactDomains[0].components,words);
 }else assert.deepEqual(Object.keys(c.result).sort(),['error','ok'],c.name+' no partial output');
 c.vertexSha256=sha(c.vertexText);c.fragmentSha256=sha(c.fragmentText);
}
for(const f of failures){if(f.result.ok){const c=fixtures[f.case];assert.deepEqual(f.result,c.result,'complete recovered allocation result');}else assert.deepEqual(Object.keys(f.result).sort(),['error','ok']);}
assert.deepEqual(alias,fixtures[0].result);assert.equal(rejections.length,17);assert.ok(failures.length>20);
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(out,'native.profraw'),'-o',path.join(out,'native.profdata')]);
fs.writeFileSync(path.join(out,'coverage.json'),execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(out,'native.profdata')}`],{maxBuffer:160e6}));
const report={schema:1,task:'E6-T12g6m3c',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:fixtures,failures,rejections,alias,layout,binary:{path:binary,bytes:fs.statSync(binary).size,sha256:sha(fs.readFileSync(binary))},fixtureSha256:sha(bytes),stdoutSha256:sha(run.stdout),stderrSha256:sha(run.stderr)};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${fixtures.length} whole native paired/default/two-single transactions; ${failures.length} actual allocation faults; owned opposite-stage mutation held.`);
