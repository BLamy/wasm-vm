#!/usr/bin/env node
// Admission/reflection fixtures are literal. Numerical GPU predictions live in
// oracle.mjs, independent of this native/wasm compiler equivalence check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge, LIMITS} from '../../renderer/virgl-shader/index.mjs';

const output = process.argv[2]; assert.ok(output, 'output JSON path required');
const manifest = JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/gears-originals.json'));
assert.deepEqual(LIMITS, manifest.limits);
const bridge = await createVirglShaderBridge(), sha = raw => createHash('sha256').update(raw).digest('hex');
const entries = [...manifest.originals, ...manifest.retainedPartners], results = [], pairs = [];
for (const entry of entries) {
  const raw = fs.readFileSync(entry.path); assert.equal(sha(raw), entry.sha256); assert.equal(raw.length, entry.bytes);
  const result = bridge.translate({stage: entry.stage, text: raw.toString()}), native = JSON.parse(
    execFileSync('renderer/virgl-shader/build/native/virgl-shader', [entry.stage], {input: raw, maxBuffer: 1048576}));
  assert.equal(result.ok, entry.admitted); assert.equal(native.ok, entry.admitted);
  if (entry.admitted) {
    assert.deepEqual(result.metadata, entry.metadata); assert.deepEqual(native.metadata, result.metadata);
    assert.equal(sha(Buffer.from(native.glsl)), sha(Buffer.from(result.glsl)), 'native/wasm literal emitted source ' + entry.sha256);
  }
  else {assert.deepEqual(result.error, entry.rejection); assert.equal(native.error.code, entry.rejection.code);}
  results.push({sha256: entry.sha256, bytes: raw.length, stage: entry.stage, result, native});
}
const by = prefix => entries.find(e => e.sha256.startsWith(prefix));
for (const [v, f, expected] of [['80a42bf3','86d0ee79',true], ['403b0529','c2474531',true],
  ['7bf4d0d0','c2474531',true], ['7bf4d0d0','92cb866a',false], ['403b0529','c5806d5f',false]]) {
  const vertex = by(v), fragment = by(f), result = bridge.translatePair({vertexText: fs.readFileSync(vertex.path, 'utf8'), fragmentText: fs.readFileSync(fragment.path, 'utf8')});
  assert.equal(result.ok, expected); pairs.push({vertex: vertex.sha256, fragment: fragment.sha256, expected, result});
}
const binary = fs.readFileSync('renderer/virgl-shader/build/native/virgl-shader');
const report = {schema: 1, task: 'E6-T12g6a', status: 'passed', guestExecution: false, productionNegotiation: false,
  gitHead: execFileSync('git', ['rev-parse','HEAD'], {encoding: 'utf8'}).trim(), limits: LIMITS,
  nativeBinary: {bytes: binary.length, sha256: sha(binary)}, originals: results, pairs};
fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log('Native/wasm original admission equal; two larger original programs explicitly rejected');
