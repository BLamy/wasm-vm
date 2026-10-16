#!/usr/bin/env node
// Fresh-critic bank model and original/base-profile helper coverage.
// Base contracts are supplemental fixtures, never counted as captured originals.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Session} from 'node:inspector';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {approve} from '../../renderer/virgl-shader/tests/original-corpus.mjs';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';

const session = new Session(); session.connect();
const post = (name, params = {}) => new Promise((resolve, reject) =>
  session.post(name, params, (error, result) => error ? reject(error) : resolve(result)));
await post('Profiler.enable'); await post('Profiler.startPreciseCoverage', {callCount:true, detailed:true});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const manifest = JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/original-corpus.json'));
const wasm = fs.readFileSync('evidence/virgl-original-corpus/artifacts/worker/virgl-shader.wasm');
const identity = JSON.parse(fs.readFileSync('evidence/virgl-original-corpus/manifest.json'));
assert.equal(sha(wasm), identity.artifacts.find(e => e.path.endsWith('worker/virgl-shader.wasm')).sha256);
const bridge = await createVirglShaderBridge({wasmBinary:wasm});
const report = {schema:'original-corpus-fresh-verifier-admission-v1', originals:[], pairs:[],
  banks:[], forgeries:[], bases:[], getters:0, status:'running'};
const finite = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff &&
  Math.floor(value / 0x800000) % 256 !== 255;
const raster = value => finite(value) && (value % 0x80000000 === 0 ||
  Math.floor(value / 0x800000) % 256 !== 0);
function model(metadata, words, active) {
  if (!metadata.constantDomains && !metadata.constantAccesses) return true;
  const complete = !!(metadata.constantAccesses || metadata.constantRadialDomains || metadata.constantRasterDomains);
  const length = (complete ? metadata.uniforms[0].count : active) * 4;
  if (words.length < length) return false;
  const bank = words.slice(0, length);
  if (metadata.constantDomains && !bank.every(finite)) return false;
  if (!bank.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff)) return false;
  if (metadata.constantConstraints && words[36] < 0x80000000 && words[36] > 18) return false;
  if (metadata.constantRadialDomains && words[16] % 0x80000000 < 0x3727c5ac) return false;
  return !metadata.constantRasterDomains || metadata.constantRasterDomains[0].components.every(entry =>
    [0,1,2,3].every(lane => !(entry.mask & (1 << lane)) || raster(words[entry.register * 4 + lane])));
}
function bank(metadata) {
  const words = Array((metadata.uniforms[0]?.count ?? 0) * 4).fill(0);
  if (metadata.constantRadialDomains) words[16] = 0x3f800000;
  if (metadata.constantConstraints) words[36] = 13;
  return words;
}
function check(name, metadata, words, active = metadata.uniforms[0]?.count ?? 0) {
  const input = words.slice();
  const expected = model(metadata, words, active), result = approve(metadata, words, active);
  assert.equal(result.ok, expected, name);
  if (result.ok) {
    const before = JSON.stringify(result); words.fill(0xffffffff);
    assert.equal(JSON.stringify(result), before, name + ': owned bank');
  }
  report.banks.push({name, metadata:clone(metadata), input, activeCount:active, expected, result});
}
for (const original of manifest.originals) {
  const text = fs.readFileSync(original.path, 'utf8'); assert.equal(sha(text), original.sha256);
  const result = bridge.translate({stage:original.stage, text});
  assert.equal(result.ok, true); assert.deepEqual(result.metadata, original.metadata);
  report.originals.push({sha256:original.sha256, result});
  check(original.sha256 + '/safe', original.metadata, bank(original.metadata));
  if (!original.metadata.constantDomains) continue;
  for (const lane of [0,16,36,(original.metadata.uniforms[0].count * 4) - 1]) {
    if (lane >= original.metadata.uniforms[0].count * 4) continue;
    for (const raw of [0,0x80000000,1,0x80000013,18,19,0x3727c5ab,0x3727c5ac,
      0xb727c5ab,0xb727c5ac,0x7f800000,0xff800000,0x7fc01234,0x7f7fffff]) {
      const words = bank(original.metadata); words[lane] = raw;
      check(original.sha256 + '/' + lane + '/' + raw, original.metadata, words);
    }
  }
  for (const key of Object.keys(original.metadata).filter(key => key.startsWith('constant') || key.endsWith('Contract'))) {
    const metadata = clone(original.metadata); Object.defineProperty(metadata, key, {enumerable:true,
      get() {report.getters++; throw new Error('untrusted getter invoked');}});
    assert.equal(parseConstantDomain(metadata, original.stage).ok, false);
    report.forgeries.push({sha256:original.sha256, kind:'accessor', key});
  }
  if (original.metadata.constantRadialDomains && original.metadata.constantConstraints) {
    const metadata = clone(original.metadata); metadata.constantRasterDomains[0].components[0] = {register:9, mask:1};
    assert.equal(parseConstantDomain(metadata, original.stage).ok, false);
    report.forgeries.push({sha256:original.sha256, kind:'counter-copied-alpha-authority'});
  }
}
for (const vertex of manifest.originals.filter(e => e.stage === 'vertex'))
  for (const fragment of manifest.originals.filter(e => e.stage === 'fragment')) {
    const result = bridge.translatePair({vertexText:fs.readFileSync(vertex.path,'utf8'),
      fragmentText:fs.readFileSync(fragment.path,'utf8')});
    if (!result.ok) continue;
    for (const metadata of [result.vertex.metadata, result.fragment.metadata]) {
      const parsed = parseConstantDomain(metadata, metadata.stage); assert.equal(parsed.ok, true);
      check(vertex.sha256 + '/' + fragment.sha256 + '/' + metadata.stage, metadata, bank(metadata));
    }
    report.pairs.push({vertex:vertex.sha256, fragment:fragment.sha256, result});
  }
assert.equal(report.pairs.length,57);
// Outer raster contracts explicitly embed the independently verified old base.
// These calls cover the helper's generic radial and loop arms without creating
// a stripped TGSI body or increasing the19 original observation count.
for (const prefix of ['a6143f11','e911b393','616a643d']) {
  const metadata = clone(manifest.originals.find(e => e.sha256.startsWith(prefix)).metadata);
  metadata.profile = metadata.rasterBaseProfile; delete metadata.rasterBaseProfile; delete metadata.constantRasterDomains;
  assert.equal(parseConstantDomain(metadata, metadata.stage).ok, true);
  check('supplemental-base/' + prefix, metadata, bank(metadata)); report.bases.push({name:prefix, metadata});
}
const fixture = JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/indirect-constant-cases.json'))
  .find(e => e.name === 'literal-0-vertex');
const indirect = bridge.translate({stage:fixture.stage,text:fixture.text});
assert.equal(indirect.ok,true); assert.equal(indirect.metadata.profile,fixture.expected.profile);
assert.deepEqual(indirect.metadata.constantAccesses,fixture.expected.constantAccesses);
try {
  check('supplemental-existing-indirect',indirect.metadata,bank(indirect.metadata));
} catch (error) {
  report.helperFault = {name:error.name,message:error.message,stack:error.stack,
    inputMetadata:indirect.metadata,inputBank:bank(indirect.metadata)};
  process.exitCode = 1;
}
report.bases.push({name:fixture.name,text:fixture.text,metadata:indirect.metadata});
assert.equal(report.getters,0); report.status=report.helperFault ? 'failed' : 'passed';
const coverage = await post('Profiler.takePreciseCoverage'); await post('Profiler.stopPreciseCoverage'); session.disconnect();
report.coverage = coverage.result.filter(e => e.url.endsWith('/renderer/virgl-shader/tests/original-corpus.mjs') ||
  e.url.endsWith('/renderer/virgl-command/constant-domain.mjs'));
report.sources = ['tools/virgl-original-corpus/verifier-regressions.mjs',
  'renderer/virgl-shader/tests/original-corpus.mjs','renderer/virgl-command/constant-domain.mjs',
  'renderer/virgl-shader/tests/indirect-constant-cases.json'].map(path => ({path,sha256:sha(fs.readFileSync(path))}));
console.log(JSON.stringify(report));
