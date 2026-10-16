import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]])),wasm=fs.readFileSync(args['--wasm']),expected=JSON.parse(fs.readFileSync(args['--native'])),fixtures=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/selected-lanes-cases.json')).cases;
let module;const bridge=await createVirglShaderBridge({wasmBinary:wasm,onRuntimeInitialized(){module=this;}}),results=[];
for(const input of fixtures){const wanted=expected.find(e=>e.name===input.name),result=bridge.translate({stage:input.stage,text:input.text});assert.deepEqual(result,wanted.result,input.name);assert.equal(module.HEAPU8.byteLength,16777216);results.push({name:input.name,stage:input.stage,inputSha256:crypto.createHash('sha256').update(input.text).digest('hex'),result});}
const pairs=JSON.parse(fs.readFileSync(path.join(path.dirname(args['--native']),'pairs.json'))).map(input=>{const result=bridge.translatePair({vertexText:input.vertexText,fragmentText:input.fragmentText});assert.deepEqual(result,input.result,input.name);assert.equal(module.HEAPU8.byteLength,16777216);return{name:input.name,result};});
fs.writeFileSync(args['--output'],JSON.stringify({schema:'selected-lanes-fault-wasm-v1',wasmSha256:crypto.createHash('sha256').update(wasm).digest('hex'),status:'passed',results,pairs},null,2)+'\n');console.log('fault parity',results.length,pairs.length);
