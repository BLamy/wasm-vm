#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';
import {VERTEX,FRAGMENT} from './fixtures.mjs';
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures.json',import.meta.url))).map(c=>({...c,partner:c.stage==='vertex'?FRAGMENT:VERTEX}));
const bytes=Buffer.concat([Buffer.from('VEX1'),u(cases.length),...cases.flatMap(c=>{const a=Buffer.from(c.text),b=Buffer.from(c.partner);return[u(c.stage==='vertex'?0:1),u(+c.ok),u(+c.defaultOk),u(a.length),u(c.components.length),u(b.length),...c.components.flatMap(e=>[u(e.register),u(e.component),u(e.word)]),a,b];})]);
fs.writeFileSync(path.join(out,'predictions.json'),JSON.stringify(cases,null,2)+'\n');fs.writeFileSync(path.join(out,'cases.bin'),bytes);
const binary='renderer/virgl-shader/build/exact-producer-sanitize/exact-producer-test',run=spawnSync(binary,[],{input:bytes,maxBuffer:128e6,env:{...process.env,LLVM_PROFILE_FILE:path.join(out,'native.profraw'),ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'}});
fs.writeFileSync(path.join(out,'native.log'),run.stdout??'');fs.writeFileSync(path.join(out,'native.stderr'),run.stderr??'');assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
const failures=[],rejections=[];let probes,layout,alias;
for(const line of run.stdout.toString().trim().split('\n')){
 const m=/^(EXACT|DEFAULT|PAIR) (\d+) (.*)$/.exec(line);
 if(m){const c=cases[Number(m[2])],r=JSON.parse(m[3]);c[{EXACT:'result',DEFAULT:'defaultResult',PAIR:'pairResult'}[m[1]]]=r;
  if(m[1]!=='PAIR')assert.equal(r.ok,m[1]==='EXACT'?c.ok:c.defaultOk,c.name);
  if(m[1]==='EXACT'&&c.ok&&!c.defaultOk){assert.equal(r.metadata.profile,'virgl-webgl2-raw-bits-v42');assert.equal(parseConstantDomain(r.metadata,c.stage).ok,true,c.name);assert.deepEqual(r.metadata.constantExactDomains[0].components,c.components);assert.equal(r.metadata.uniforms[0].count,c.declaredCount);}
 }else if(line.startsWith('ALIAS '))alias=JSON.parse(line.slice(6));
 else if(line.startsWith('FAILURE ')){const [,index,allocation,...rest]=line.split(' ');failures.push({case:Number(index),allocation:Number(allocation),result:JSON.parse(rest.join(' '))});}
 else if(line.startsWith('REJECT ')){const [,index,...rest]=line.split(' ');const result=JSON.parse(rest.join(' '));assert.equal(result.ok,false);rejections.push({index:Number(index),result});}
 else if(line.startsWith('PROBES ')){probes=Number(line.slice(7));assert.equal(probes,40);}
 else if(line.startsWith('LAYOUT ')){layout=line.split(' ').slice(1).map(Number);assert.deepEqual(layout.slice(0,3),[111752,32448,12]);assert.ok(layout[3]<4096);}
 else assert.equal(line,'STATUS passed');
}
for(const c of cases){assert.ok(c.result&&c.defaultResult&&c.pairResult);if(c.ok&&c.defaultOk)assert.deepEqual(c.result,c.defaultResult);if(!c.ok){assert.equal(Object.hasOwn(c.result,'glsl'),false);assert.equal(Object.hasOwn(c.result,'metadata'),false);}c.textSha256=sha(c.text);}
assert.deepEqual(alias,cases[0].result);assert.equal(rejections.length,11);assert.ok(failures.length>4);
assert.ok(failures.some(f=>!f.result.ok));for(const f of failures)if(f.result.ok){const c=cases[f.case];if(f.result.metadata.profile==='virgl-webgl2-raw-bits-v42'){assert.equal(parseConstantDomain(f.result.metadata,c.stage).ok,true);assert.deepEqual(f.result.metadata.constantExactDomains[0].components,c.components);}else assert.deepEqual(f.result,c.result,'recovered allocation fault retains complete ordinary result');}else for(const key of ['glsl','metadata'])assert.equal(Object.hasOwn(f.result,key),false);
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(out,'native.profraw'),'-o',path.join(out,'native.profdata')]);
fs.writeFileSync(path.join(out,'coverage.json'),execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(out,'native.profdata')}`],{maxBuffer:128e6}));
const report={schema:1,task:'E6-T12g6m3b',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases,probes,layout,alias,failures,rejections,binary:{path:binary,bytes:fs.statSync(binary).size,sha256:sha(fs.readFileSync(binary))},fixtureSha256:sha(bytes),stdoutSha256:sha(run.stdout),stderrSha256:sha(run.stderr)};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${cases.length} complete native exact/default/pair cases; 40 raw probes; ${failures.length} allocation faults; native input mutation held.`);
