#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const nativePath=process.argv[2],out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});const native=JSON.parse(fs.readFileSync(nativePath)),bridge=await createVirglShaderBridge(),cases=[];
for(const c of native.cases){const result=bridge.translate({stage:c.stage,text:c.text}),pair=bridge.translatePair(c.stage==='fragment'?{vertexText:c.partner,fragmentText:c.text}:{vertexText:c.text,fragmentText:c.partner});
 assert.deepEqual(result,c.result,c.name);assert.deepEqual(pair,c.pairResult,c.name+' complete pair');cases.push({name:c.name,result,pair});}
const report={schema:'virgl-known-arithmetic-wasm-v1',task:'E6-T12g6m1',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:createHash('sha256').update(fs.readFileSync(nativePath)).digest('hex'),cases};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${cases.length} complete native/Wasm singles and pairs match.`);
