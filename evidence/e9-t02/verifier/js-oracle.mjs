import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const bytes = fs.readFileSync(process.argv[2]);
const manifest = JSON.parse(bytes.toString('utf8'));
for (const [actual, expected] of [[manifest.begin.sequence, 9007199254740993n], [manifest.end.sequence, 9007199254740994n], [manifest.begin.transition, 9007199254741093n]]) {
  assert.equal(typeof actual, 'string');
  assert.equal(BigInt(actual), expected);
}
const serialized = JSON.stringify(manifest);
const roundtrip = JSON.parse(serialized);
assert.equal(roundtrip.begin.sequence, '9007199254740993');
assert.equal(roundtrip.end.sequence, '9007199254740994');
for (const sequence of [9007199254740991n, 9007199254740992n, 9007199254740993n, 18446744073709551615n]) {
  const encoded = JSON.stringify({sequence: sequence.toString()});
  assert.equal(BigInt(JSON.parse(encoded).sequence), sequence);
}
console.log(JSON.stringify({status:'passed', node:process.version, begin:roundtrip.begin.sequence, end:roundtrip.end.sequence, fixture_sha256:crypto.createHash('sha256').update(bytes).digest('hex'), serialized_sha256:crypto.createHash('sha256').update(serialized).digest('hex')}, null, 2));
