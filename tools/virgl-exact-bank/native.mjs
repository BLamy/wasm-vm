#!/usr/bin/env node
// Reuse the original C driver/protocol: this leaf changes no native compiler semantics.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {VERTEX,FRAGMENT,COMPOSITION_VERTEX} from './fixtures.mjs';
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const profiles={finite:7,count:12,radial:14,'radial-count':16,raster:27,conversion:41};
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures.json',import.meta.url))).map(c=>({...c,ok:true,pairOk:true,
  expectedProfile:c.expectedProfile??`virgl-webgl2-raw-bits-v${c.role==='physical'?2:profiles[c.composition]}`,partner:c.stage==='vertex'?FRAGMENT:c.role==='composition'?COMPOSITION_VERTEX:VERTEX}));
const bytes=Buffer.concat([Buffer.from('VKA1'),u(2),u(0),u(0),u(0x3fc00000),u(0x3fc00000),u(0),u(0x3fc00000),u(0),u(0x3fc00000),u(cases.length),...cases.flatMap(c=>{const a=Buffer.from(c.text),b=Buffer.from(c.partner);return[u(c.stage==='vertex'?0:1),u(1),u(a.length),u(b.length),u(1),a,b];})]);
fs.writeFileSync(path.join(out,'predictions.json'),JSON.stringify(cases,null,2)+'\n');fs.writeFileSync(path.join(out,'cases.bin'),bytes);
const binary='renderer/virgl-shader/build/known-branch-sanitize/known-branch-test',run=spawnSync(binary,[],{input:bytes,maxBuffer:128e6,env:{...process.env,LLVM_PROFILE_FILE:path.join(out,'native.profraw'),ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'}});
fs.writeFileSync(path.join(out,'native.log'),run.stdout??'');fs.writeFileSync(path.join(out,'native.stderr'),run.stderr??'');assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.signal,null);assert.equal(run.stderr.length,0);
for(const line of run.stdout.toString().trim().split('\n')){const m=/^(CASE|PAIR) (\d+) (.*)$/.exec(line);if(line.startsWith('WORD ')){assert.ok(['WORD 0 1069547520','WORD 1 1069547520'].includes(line));}else if(m){const c=cases[Number(m[2])],r=JSON.parse(m[3]);assert.equal(r.ok,true,c.name);if(m[1]==='CASE'){assert.equal(r.metadata.profile,c.expectedProfile,c.name);c.result=r;}else c.pairResult=r;}else assert.ok(['PREDICATES 8 passed','LAYOUT 111744 112 32448','STATUS passed'].includes(line),line);}
for(const c of cases){assert.ok(c.result&&c.pairResult);c.textSha256=sha(c.text);}
execFileSync('xcrun',['llvm-profdata','merge','-sparse',path.join(out,'native.profraw'),'-o',path.join(out,'native.profdata')]);
fs.writeFileSync(path.join(out,'coverage.json'),execFileSync('xcrun',['llvm-cov','export',binary,`-instr-profile=${path.join(out,'native.profdata')}`],{maxBuffer:128e6}));
const report={schema:1,task:'E6-T12g6m3a',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases,binary:{path:binary,bytes:fs.statSync(binary).size,sha256:sha(fs.readFileSync(binary))},fixtureSha256:sha(bytes),stdoutSha256:sha(run.stdout),stderrSha256:sha(run.stderr)};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${cases.length} unchanged original native singles/pairs; zero sanitizer errors.`);
