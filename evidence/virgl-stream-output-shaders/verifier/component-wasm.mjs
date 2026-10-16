import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(root,'../../..'),out=path.join(root,'native-components');
const generated=path.join(repo,'target/evidence/d65-critic-opened-01/worker/cold/recording/generated'),sha=b=>createHash('sha256').update(b).digest('hex');
const {default:createModule}=await import(pathToFileURL(path.join(generated,'virgl-shader.mjs'))),module=await createModule();
const cases=JSON.parse(await fs.readFile(path.join(out,'cases.json'),'utf8')),lines=(await fs.readFile(path.join(out,'native.jsonl'),'utf8')).trim().split('\n'),rows=[];
for(const[index,c]of cases.entries()){
 const pointers=[];
 try{
  const text=Buffer.from(c.a),input=module._malloc(text.length+1),layout=module._malloc(c.words.length*4);assert.ok(input&&layout);pointers.push(input,layout);module.HEAPU8.set(text,input);module.HEAPU8[input+text.length]=0;
  const view=new DataView(module.HEAPU8.buffer);c.words.forEach((word,i)=>view.setUint32(layout+i*4,word,true));
  const response=module.UTF8ToString(module._bridge_translate_standard_stream_output(c.kind,input,text.length,0,0,layout,c.words.length,c.capture)),native=JSON.parse(lines[index]);
  const original=lines[index].slice(lines[index].indexOf('"response":')+11,lines[index].lastIndexOf(',"originalTokens":'));
  assert.equal(response,original,'complete native/Wasm C response bytes '+c.name);assert.deepEqual(JSON.parse(response),native.response);
  rows.push({index,name:c.name,originalWords:c.words,nativeResponseBytes:original,wasmResponseBytes:response,response:JSON.parse(response),fixedMemoryBytes:module.HEAPU8.byteLength});
 }finally{for(const p of pointers.reverse())module._free(p);}
}
assert.equal(module.HEAPU8.byteLength,16777216);
await fs.writeFile(path.join(out,'wasm.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
await fs.writeFile(path.join(out,'wasm-report.json'),JSON.stringify({schema:'stream-output-shaders-independent-component-wasm-v1',status:'passed',cases:rows.length,completeCResponseBytesIdentical:true,fixedMemoryBytes:module.HEAPU8.byteLength,generatedModuleSha256:sha(await fs.readFile(path.join(generated,'virgl-shader.mjs'))),generatedWasmSha256:sha(await fs.readFile(path.join(generated,'virgl-shader.wasm')))},null,2)+'\n');
console.log(JSON.stringify({status:'passed',cases:rows.length,completeCResponseBytesIdentical:true}));
