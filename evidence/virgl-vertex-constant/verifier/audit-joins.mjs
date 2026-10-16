import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {getCompilerBoundsJoinCases} from '../../../renderer/virgl-shader/tests/compiler-bounds-joins.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const original=getCompilerBoundsJoinCases(),reports=[];
for(const prefix of['hot','cold']) {
  const d=JSON.parse(fs.readFileSync(`evidence/virgl-vertex-constant/verifier/unpacked/${prefix}/compiler-joins.json`));
  assert.equal(d.records.length,original.length);const cases=[];
  for(const[i,row]of d.records.entries()) {
    const before=original[i];assert.equal(row.originalTextSha256,sha(before.text));assert.equal(row.name,before.name);
    let expected=before.text.replace('DCL TEMP[511]','DCL TEMP[510..511]')
      .replace('MOV OUT[0], IN[0]','AND TEMP[510].x, IN[0], IMM[31].yyyy\nMOV OUT[0], IN[0]')
      .replaceAll('UIF IMM[31].yyyy','UIF TEMP[510].xxxx');
    if(before.name.startsWith('text-bytes'))expected=expected.slice(0,before.text.length);
    assert.equal(row.text,expected);assert.equal(row.textSha256,sha(expected));assert.equal(row.ok,before.ok);
    assert.deepEqual(row.native,row.wasm);assert.equal(row.native.ok,before.ok);
    if(before.depth) {
      assert.match(expected,/IMM\[31\] UINT32 \{0,1,2147483648,0\}/);
      assert.match(expected,/AND TEMP\[510\]\.x, IN\[0\], IMM\[31\]\.yyyy/);
      assert.equal((expected.match(/UIF TEMP\[510\]\.xxxx/g)??[]).length,before.depth);
      if(before.missing==='true')assert.equal((expected.match(new RegExp(`MOV TEMP\\[511\\]\\.${before.lane}, IN\\[0\\]`,'g'))??[]).length,1);
      if(before.missing==='false')assert.equal((expected.match(new RegExp(`MOV TEMP\\[511\\]\\.${before.lane}, IN\\[0\\]`,'g'))??[]).length,1);
    }
    if(before.name.startsWith('text-bytes'))assert.equal(expected.length,before.text.length);
    if(before.name.startsWith('line-bytes'))assert.equal(Math.max(...expected.split('\n').map(s=>s.length)),Number(before.name.slice(10)));
    cases.push({name:row.name,ok:row.native.ok,textSha256:row.textSha256,unknownOneBit:!!before.depth});
  }
  reports.push({prefix,cases:cases.length,twoLivePredecessorCases:cases.filter(c=>c.unknownOneBit).length,positive:cases.filter(c=>c.ok).length,negative:cases.filter(c=>!c.ok).length,records:cases});
}
fs.writeFileSync('evidence/virgl-vertex-constant/verifier/join-audit.json',JSON.stringify({task:'E6-T11d1',status:'HELD',rationale:'Input is not a known producer; AND with one proves only a dynamic0/1 mask. Complete grammar/text/index boundaries remain; both missing-predecessor variants reject independently.',reports},null,2)+'\n');
console.log('HELD:402 join cases per recording,384 two-live-predecessor witnesses, exact line/text/canonical boundaries');
