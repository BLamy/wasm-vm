import assert from 'node:assert/strict';
import test from 'node:test';
import {validateSessionWitnesses} from '../../web/session-witnesses.js';
const point = n => ({transition: String(n), retired: String(n), phase: 'before', ordinal: 0, sequence: String(n)});
const row = n => ({...point(n), digest: Array(32).fill(n)});
const extension = (kind, rows) => ({kind, required: false, bytes: [...new TextEncoder().encode(JSON.stringify(rows))]});
const fixture = () => ({machine: {gpu: null}, begin: point(0), end: point(2), extensions: [
  extension('e9-exact-initial-witness-v1', [row(0)]), extension('e9-exact-state-witnesses-v1', [row(0), row(2)]),
]});
test('known reference-free witnesses support completed and incomplete histories', () => {
  assert.deepEqual(validateSessionWitnesses(fixture(), {finished: true}), [row(0), row(2)]);
  const pending = fixture(); pending.extensions.pop(); assert.deepEqual(validateSessionWitnesses(pending), [row(0)]);
  assert.throws(() => validateSessionWitnesses(pending, {finished: true}), /finish/);
  assert.deepEqual(validateSessionWitnesses({...pending, extensions: []}), []);
});
test('malformed or unknown extension data cannot authorize reclamation', () => {
  const cases = [
    value => {value.extensions[0].kind = 'future-blob-references';},
    value => {value.extensions[0].required = true;},
    value => {value.extensions[0].bytes = [255];},
    value => {value.extensions[0] = extension('e9-exact-initial-witness-v1', [{...row(0), blob: {sha256: 'a'.repeat(64), length: '1'}}]);},
    value => {value.extensions[1] = extension('e9-exact-state-witnesses-v1', [row(2), row(0)]);},
    value => {value.extensions[1] = extension('e9-exact-state-witnesses-v1', [row(0), {...row(2), digest: Array(32).fill(256)}]);},
    value => {value.extensions.push(value.extensions[0]);},
  ];
  for (const mutate of cases) {const value = fixture(); mutate(value); assert.throws(() => validateSessionWitnesses(value));}
});
