#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const raw=fs.readFileSync(process.argv[2]),rows=JSON.parse(raw),wasm=fs.readFileSync(new URL('../../renderer/virgl-shader/build/wasm/virgl-shader.wasm',import.meta.url));
const bridge=await createVirglShaderBridge({wasmBinary:wasm}),cases=[];
for(const row of rows){const result=bridge.translate({stage:row.stage,text:row.text});assert.deepEqual(result,row.result);assert.equal(result.ok,row.predictedOk);cases.push({name:row.name,inputSha256:row.inputSha256,result});}
fs.writeFileSync(process.argv[3],JSON.stringify({schema:'radial-probe-wasm-v1',status:'passed',nativeSha256:createHash('sha256').update(raw).digest('hex'),wasmSha256:createHash('sha256').update(wasm).digest('hex'),cases},null,2)+'\n');
