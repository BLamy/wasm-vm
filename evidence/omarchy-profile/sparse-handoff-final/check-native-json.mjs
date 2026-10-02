import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [binary, output] = process.argv.slice(2);
const cases = [];
for (const mask of [0,1,0x80000000,0x80000082,0x1fe,0x3fe,0x7ffffffe,0xfffffffe]) {
  const result = JSON.parse(execFileSync(binary,[String(mask),'4096'],{encoding:'utf8'}));
  assert.equal(result.version,(mask >>> 1) ? 4096 : 0);
  assert.equal(result.words.length,32);
  for (let reg=0; reg<32; reg++) {
    assert.match(result.words[reg],/^[0-9a-f]{16}$/);
    const expected = reg && (mask >>> reg & 1) ? 0xfedcba9876540000n | BigInt(reg) : 0n;
    assert.equal(BigInt('0x'+result.words[reg]),expected);
  }
  cases.push(result);
}
writeFileSync(output,JSON.stringify({binary,binarySha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),passed:true,cases},null,2)+'\n');
console.log('8 masks / 256 exact 64-bit JSON words: passed');
