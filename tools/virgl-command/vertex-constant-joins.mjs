#!/usr/bin/env node
// Reuse the promoted join oracle with an unknown one-bit condition. The original
// immediate condition became provably true in verified v41, so its unused ELSE
// no longer contributes a predecessor. Preserve each grammar/size boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {getCompilerBoundsJoinCases} from '../../renderer/virgl-shader/tests/compiler-bounds-joins.mjs';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const bridge=await createVirglShaderBridge(),records=[];
const sha=s=>createHash('sha256').update(s).digest('hex');
for(const test of getCompilerBoundsJoinCases()){
  let text=test.text.replace('DCL TEMP[511]','DCL TEMP[510..511]')
    .replace('MOV OUT[0], IN[0]','AND TEMP[510].x, IN[0], IMM[31].yyyy\nMOV OUT[0], IN[0]')
    .replaceAll('UIF IMM[31].yyyy','UIF TEMP[510].xxxx');
  if(test.name.startsWith('text-bytes'))text=text.slice(0,test.text.length);
  const native=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',[test.stage],{input:text,maxBuffer:4e6}));
  const wasm=bridge.translate({stage:test.stage,text});assert.deepEqual(wasm,native,test.name+' complete parity');assert.equal(native.ok,test.ok,test.name+' independent two-live-predecessor oracle');
  records.push({...test,originalTextSha256:sha(test.text),text,textSha256:sha(text),native,wasm});
}
const report={schema:1,task:'E6-T11d1',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),records};
fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(`${records.length} retained dynamic join/canonical bounds passed in native and Wasm`);
