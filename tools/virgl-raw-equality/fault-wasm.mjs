import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]])),wasm=fs.readFileSync(args['--wasm']),expected=JSON.parse(fs.readFileSync(args['--native'])),fixtures=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/raw-equality-cases.json')).cases;
let module;const bridge=await createVirglShaderBridge({wasmBinary:wasm,onRuntimeInitialized(){module=this;}}),results=[];
for(const input of fixtures){const wanted=expected.find(e=>e.name===input.name),result=bridge.translate({stage:input.stage,text:input.text});assert.deepEqual(result,wanted.result,input.name);assert.equal(module.HEAPU8.byteLength,16777216);results.push({name:input.name,stage:input.stage,inputSha256:crypto.createHash('sha256').update(input.text).digest('hex'),result});}
fs.writeFileSync(args['--output'],JSON.stringify({schema:'raw-equality-fault-wasm-v1',wasmSha256:crypto.createHash('sha256').update(wasm).digest('hex'),status:'passed',results},null,2)+'\n');console.log('fault parity',results.length);
