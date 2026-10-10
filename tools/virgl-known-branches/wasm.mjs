#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import createModule from '../../renderer/virgl-shader/build/wasm/virgl-shader.mjs';
const nativePath=process.argv[2],out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});const native=JSON.parse(fs.readFileSync(nativePath)),bridge=await createVirglShaderBridge(),module=await createModule(),cases=[];
function request(texts,fn){const pointers=[];try{for(const text of texts){const bytes=Buffer.from(text),p=module._malloc(bytes.length+1);assert.ok(p);pointers.push(p);module.HEAPU8.set(bytes,p);module.HEAPU8[p+bytes.length]=0;}return JSON.parse(module.UTF8ToString(fn(pointers)));}finally{for(const p of pointers)module._free(p);}}
function facadeExpected(c,result){return /[^\x09\x0a\x0d\x20-\x7e]/.test(c.text)?{ok:false,error:{code:'invalid-input',message:'TGSI must be printable ASCII without NUL bytes.'}}:result;}
for(const c of native.cases){
 const result=request([c.text],ps=>module._bridge_translate(c.stage==='vertex'?0:1,ps[0],Buffer.byteLength(c.text))),texts=c.stage==='fragment'?[c.partner,c.text]:[c.text,c.partner],pair=request(texts,ps=>module._bridge_translate_pair(ps[0],Buffer.byteLength(texts[0]),ps[1],Buffer.byteLength(texts[1])));
 assert.deepEqual(result,c.result,c.name+' complete native/Wasm C single');assert.deepEqual(pair,c.pairResult,c.name+' complete native/Wasm C pair');
 const facade=bridge.translate({stage:c.stage,text:c.text}),facadePair=bridge.translatePair({vertexText:texts[0],fragmentText:texts[1]});
 assert.deepEqual(facade,facadeExpected(c,result),c.name+' existing facade');assert.deepEqual(facadePair,facadeExpected(c,pair),c.name+' existing pair facade');
 cases.push({name:c.name,result,pair,facade,facadePair});
}
const report={schema:'virgl-known-branches-wasm-v1',task:'E6-T12g6m2',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(fs.readFileSync(nativePath)).digest('hex'),cases};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${cases.length} complete native/Wasm C singles/pairs and original JavaScript facade results recorded.`);
