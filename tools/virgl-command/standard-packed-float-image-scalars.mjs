#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {r11g11b10FromFloatWords} from '../../renderer/virgl-command/packed-float-images.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
assert.equal(process.argv.length,4);
const input=fs.readFileSync(process.argv[2]),vectors=JSON.parse(input);
assert.equal(vectors.schema,'original-packed-scalar-inverse-v1');
assert.equal(vectors.nativeExecuted,false);
assert.equal(vectors.records.length,11950);
const records=[];
for(const row of vectors.records){
 assert.equal(row.words.length,3);
 for(const word of row.words)assert.ok(Number.isInteger(word)&&word>=0&&word<=0xffffffff);
 const actual=r11g11b10FromFloatWords(...row.words),held=actual===row.expected;
 records.push({...row,actual,held});assert.equal(held,true,JSON.stringify(row));
}
const sources=['renderer/virgl-command/packed-float-images.mjs','tools/virgl-command/standard-packed-float-image-scalars.mjs','tools/virgl-command/standard-packed-float-image-scalar-vectors.py'].map(name=>{const raw=fs.readFileSync(path.join(root,name));return{path:name,sha256:sha(raw),bytes:raw.length};});
fs.writeFileSync(process.argv[3],JSON.stringify({schema:'original-packed-scalar-audit-v1',task:'E6-T11d27',gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:'passed',inputSha256:sha(input),nativeExecuted:false,sources,records},null,2)+'\n');
console.log(`Independent packed scalar inverse passed ${records.length} vectors.`);
