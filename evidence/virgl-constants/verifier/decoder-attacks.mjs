#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeSubmission } from '../../../renderer/virgl-command/decoder.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schema: 'constant-critic-decoder-v1', cases: [], seeds: [0x182fa35b, 0x97d45361, 0xaf053bc9, 0x398cea17] };
const packet = (stage, slot, words) => {
  const raw = Buffer.alloc(12 + 4 * words.length); raw.writeUInt32LE((words.length + 2) * 65536 + 12);
  raw.writeUInt32LE(stage, 4); raw.writeUInt32LE(slot, 8); words.forEach((value, i) => raw.writeUInt32LE(value >>> 0, 12 + i * 4)); return raw;
};
const finite = [0, 0x80000000, 1, 0x80000001, 0x7f7fffff, 0xff7fffff, 0x3f000000, 0xbf800000];
function errorFor(count, stage, slot) {
  if (count > 184) return 'limit-exceeded';
  if (stage > 5) return 'invalid-enum';
  if (slot >= 15) return 'limit-exceeded';
  if (count % 4) return 'payload-length';
  if (count && (stage > 1 || slot !== 0)) return 'unsupported-feature';
  return null;
}
function check(raw, code, name, expectedWords = null) {
  const inputSha256 = sha(raw), inputHex = raw.toString('hex'), result = decodeSubmission(raw);
  assert.equal(result.ok, code === null, name);
  if (code) { assert.equal(result.error.code, code, name); assert.ok(!Object.hasOwn(result, 'commands'), name); }
  else { assert.deepEqual(result.commands[0].fields.words, expectedWords, name); assert.ok(Object.isFrozen(result.commands[0].fields.words)); }
  report.cases.push({ name, inputSha256, inputHex, expectedError: code, result });
  return result;
}
for (const seed of report.seeds) {
  let rng = seed;
  for (const count of [0, 1, 3, 4, 32, 180, 183, 184, 185, 188]) for (const stage of [0, 1, 2, 5, 6]) for (const slot of [0, 1, 14, 15]) {
    const words = Array.from({ length: count }, () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return finite[(rng >>> 16) % finite.length]; });
    const raw = packet(stage, slot, words), decoded = check(raw, errorFor(count, stage, slot), `${seed.toString(16)}-${count}-${stage}-${slot}`, words);
    raw.fill(0xff); if (decoded.ok) assert.deepEqual(decoded.commands[0].fields.words, words, 'snapshot survived mutation');
  }
}
for (const word of [0x7f800000, 0xff800000, 0x7fc00000, 0xff800001, 0x7f800001]) for (const stage of [0, 1]) for (const location of [0, 3, 31, 179, 180, 183]) {
  const words = Array(184).fill(0); words[location] = word;
  check(packet(stage, 0, words), 'invalid-value', `nonfinite-${word.toString(16)}-${stage}-${location}`);
}
const full = packet(0, 0, Array(184).fill(0x3f800000));
for (let bytes = 4; bytes < full.length; bytes += 4) check(full.subarray(0, bytes), 'truncated-payload', `truncated-${bytes}`);
const owned = new Uint8Array(full), decoded = decodeSubmission(owned);
structuredClone(owned.buffer, { transfer: [owned.buffer] }); assert.equal(owned.byteLength, 0); assert.deepEqual(decoded.commands[0].fields.words, Array(184).fill(0x3f800000));
report.detachedOwnership = { byteLength: owned.byteLength, decoded };
report.stats = { cases: report.cases.length, accepted: report.cases.filter(c => c.result.ok).length, rejected: report.cases.filter(c => !c.result.ok).length };
report.status = 'passed'; await fs.writeFile(new URL('./decoder-attacks.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.stats));
