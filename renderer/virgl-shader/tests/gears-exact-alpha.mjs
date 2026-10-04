#!/usr/bin/env node
// A TGSI raw MOV to OUT[1].w copies CONST[9].w exactly. Lighting tolerances
// cannot license alpha drift; authenticate and inspect physical feedback bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const GEARS='80a42bf3c99720ded8979c28cf04fdf1e4080c5ff44f7c05f43d693b3e063e02';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export function verifyExactAlpha(report,label='<report>') {
  const acceptance=report.acceptance??report;
  const vertex=acceptance.vertices.find(v=>v.sha256===GEARS);
  assert.ok(vertex,`${label}: literal gears feedback required`);
  assert.deepEqual(vertex.writtenMasks,[15,15],`${label}: alpha is a defined written lane`);
  assert.equal(vertex.vectors.length,48,`${label}: all recorded gears vectors required`);
  for(const vector of vertex.vectors){
    assert.equal(vector.constantWords.length,10,`${label}/${vector.name}: literal ten-entry bank`);
    const raw=Buffer.from(vector.bytes);assert.equal(raw.length,32,`${label}/${vector.name}: eight physical words`);
    assert.equal(sha(raw),vector.sha256,`${label}/${vector.name}: raw feedback digest`);
    const actual=raw.readUInt32LE(28),expected=vector.constantWords[9][3];
    assert.equal(actual,vector.observed[7],`${label}/${vector.name}: feedback word binding`);
    assert.equal(actual,expected,`${label}/${vector.name}: exact raw MOV alpha (no ULP allowance)`);
  }
  return {label,vectors:vertex.vectors.length,alphaWordsCheckedExactly:vertex.vectors.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.ok(process.argv.length>2,'usage: node gears-exact-alpha.mjs <browser-report.json> [...]');
  const reports=process.argv.slice(2).map(file=>{const raw=fs.readFileSync(file);return {...verifyExactAlpha(JSON.parse(raw),file),reportSha256:sha(raw)};});
  console.log(JSON.stringify({status:'passed',reports,alphaWordsCheckedExactly:reports.reduce((n,r)=>n+r.alphaWordsCheckedExactly,0)}));
}
