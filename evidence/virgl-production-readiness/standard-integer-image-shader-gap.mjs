import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..');
const expected='d8d510a689cfb5440cc8b3b65fd94adb9baee109';
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(head,expected,'run original refusal at its independently verified dependency');
const {createVirglStandardTextureShaderBridge}=await import(pathToFileURL(root+'/renderer/virgl-shader/standard.mjs'));
const bridge=await createVirglStandardTextureShaderBridge(),records=[];
for(const stage of ['vertex','fragment'])for(const type of ['UINT','SINT'])for(const op of ['TEX','TXL','TXF','TXD','TXQ',...(stage==='fragment'?['TXB']:[])]){
 const dst=stage==='vertex'?'OUT[1]':'OUT[0]';
 const prefix=stage==='vertex'?'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n':'FRAG\nDCL OUT[0], COLOR\n';
 const text=prefix+`DCL CONST[0..2]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, ${type}\n0: ${op} ${dst}, CONST[0], ${op==='TXD'?'CONST[1], CONST[2], ':''}SAMP[0], 2D\n`+(stage==='vertex'?'1: MOV OUT[0], IN[0]\n2: END\n':'1: END\n');
 const result=bridge.translate({stage,text});
 assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');
 records.push({stage,type,op,text,result});
}
const sourceNames=['renderer/virgl-shader/standard_guard.c','renderer/virgl-shader/standard_guard.h','renderer/virgl-shader/standard_emit.c','renderer/virgl-shader/bridge.c','renderer/virgl-shader/bridge.h','renderer/virgl-shader/standard.mjs','renderer/virgl-shader/build.sh','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'];
const sources=Object.fromEntries(sourceNames.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
const record={schema:'original-integer-image-shader-gap-v1',sourceSnapshotHead:head,authority:'isolated-compiler-refusal-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,records,sources};
fs.writeFileSync(path.join(import.meta.dirname,'standard-integer-image-shader-gap.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({head,originalRefusals:records.length}));
