#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+2*i],process.argv[3+2*i]]));
const out=path.resolve(args['--output']),nativePath=path.resolve(args['--native']);fs.mkdirSync(out,{recursive:true});
const sha=raw=>createHash('sha256').update(raw).digest('hex'),binding=file=>{const raw=fs.readFileSync(file);return{path:file,bytes:raw.length,sha256:sha(raw)};};
const native=JSON.parse(fs.readFileSync(nativePath)),fd=fs.openSync(path.join(out,'calls.jsonl'),'w');assert.equal(native.schema,'original-corpus-native-v1');
const report={schema:'original-corpus-wasm-v1',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:sha(fs.readFileSync(nativePath)),sources:['tools/virgl-original-corpus/wasm.mjs','renderer/virgl-shader/index.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'].map(binding),calls:0,ownership:[]};
let module,memory;
try{
 const bridge=await createVirglShaderBridge({wasmBinary:fs.readFileSync('renderer/virgl-shader/build/wasm/virgl-shader.wasm'),onRuntimeInitialized(){module=this;}});memory=module.HEAPU8.buffer;assert.equal(memory.byteLength,16777216);
 const originals=new Map(native.originals.map(e=>[e.sha256,e]));
 function record(kind,name,result,expected){assert.deepEqual(result,expected,'complete native/Wasm result '+name);assert.equal(module.HEAPU8.buffer,memory);fs.writeSync(fd,JSON.stringify({index:report.calls++,kind,name,result})+'\n');return result;}
 const single=(e,kind='original')=>record(kind,e.sha256,bridge.translate({stage:e.stage,text:e.text}),e.result);
 const pair=(e,kind='pair')=>record(kind,e.vertex+'/'+e.fragment,bridge.translatePair({vertexText:originals.get(e.vertex).text,fragmentText:originals.get(e.fragment).text}),e.result);
 for(const e of originals.values()){assert.equal(sha(fs.readFileSync(e.path)),e.sha256);single(e);}
 for(const e of native.pairs)pair(e);
 for(const [index,e]of native.attacks.entries()){
  record('attack',e.name,bridge.translate({stage:e.stage,text:e.text}),e.result);
  single(native.originals[index%19],'recovery-single');pair(native.pairs[index%88],'recovery-pair');
 }
 for(let round=0;round<8;round++){for(const e of originals.values())single(e,'repeat-single');for(const e of native.pairs)pair(e,'repeat-pair');}
 for(const e of native.originals){const request={stage:e.stage,text:e.text},result=record('owned-single',e.sha256,bridge.translate(request),e.result),before=JSON.stringify(result);request.stage='invalid';request.text='';single(native.originals[0],'overwrite');assert.equal(JSON.stringify(result),before);report.ownership.push({kind:'single',sha256:e.sha256,result});}
 for(const e of native.pairs.filter(e=>e.ok)){const request={vertexText:originals.get(e.vertex).text,fragmentText:originals.get(e.fragment).text},result=record('owned-pair',e.vertex+'/'+e.fragment,bridge.translatePair(request),e.result),before=JSON.stringify(result);request.vertexText='';request.fragmentText='';pair(native.pairs[0],'overwrite-pair');assert.equal(JSON.stringify(result),before);report.ownership.push({kind:'pair',vertex:e.vertex,fragment:e.fragment,result});}
 report.memory={initialBytes:memory.byteLength,finalBytes:module.HEAPU8.byteLength,sameBuffer:module.HEAPU8.buffer===memory};report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message};process.exitCode=1;}
finally{fs.closeSync(fd);report.log={path:'calls.jsonl',bytes:fs.statSync(path.join(out,'calls.jsonl')).size,sha256:sha(fs.readFileSync(path.join(out,'calls.jsonl')))};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,calls:report.calls,error:report.error}));
