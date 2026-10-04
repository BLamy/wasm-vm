#!/usr/bin/env node
// Fresh-critic regression: an indirect bank's declared extent survives reflection0.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
const helper = process.argv[2] ?? 'renderer/virgl-shader/tests/original-corpus.mjs';
const {approve} = await import(pathToFileURL(fs.realpathSync(helper)).href);
const wasm = fs.readFileSync('evidence/virgl-original-corpus/artifacts/worker/virgl-shader.wasm');
const bridge = await createVirglShaderBridge({wasmBinary:wasm});
const fixtures = JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/indirect-constant-cases.json'));
const report = {schema:'original-corpus-access-fresh-verifier-v1', cases:[], getters:0, status:'running'};
for (const stage of ['vertex','fragment']) for (const version of [10,11]) {
  const fixture = fixtures.find(e => e.stage === stage && e.ok &&
    e.expected.profile === 'virgl-webgl2-raw-bits-v' + version);
  const translated = bridge.translate({stage,text:fixture.text});
  assert.equal(translated.ok,true);assert.equal(translated.metadata.profile,fixture.expected.profile);
  assert.equal(translated.metadata.constantAccesses[0].count,46);
  const metadata = translated.metadata;
  function check(name,words,ok,code=null) {
    const before = words.slice(), result = approve(metadata,words,0);
    assert.equal(result.ok,ok,stage+'/'+version+'/'+name);
    if (ok) {
      assert.deepEqual(result.words,before);assert.equal(result.words.length,184);
      const owned = JSON.stringify(result);words.fill(0xffffffff);assert.equal(JSON.stringify(result),owned);
    } else if (code) assert.equal(result.error.code,code);
    report.cases.push({stage,version,name,input:before,activeCount:0,result});
  }
  check('complete-indirect-extent',Array(184).fill(0),true);
  check('empty-despite-reflection0',[],false,'incomplete-draw');
  check('missing-last-register-despite-reflection0',Array(180).fill(0),false,'incomplete-draw');
  for (const raw of [0x7f800000,0xff800000,0x7fc01234,0xffffffff]) {
    const words = Array(184).fill(0);words[183]=raw;
    check('raw-encoding-'+raw,words,version===10,version===11?'constant-domain-error':null);
  }
  for (const value of [-1,4294967296,1.5,false]) {
    const words=Array(184).fill(0);words[183]=value;
    check('invalid-u32-'+String(value),words,false,version===10?'constant-access-error':'constant-domain-error');
  }
  const accessor=Array(184).fill(0);Object.defineProperty(accessor,'183',{enumerable:true,
    get(){report.getters++;throw new Error('bank getter invoked');}});
  const rejected=approve(metadata,accessor,0);assert.equal(rejected.ok,false);
  report.cases.push({stage,version,name:'getter-last-indirect-word',result:rejected});
}
assert.equal(report.getters,0);report.status='passed';
report.sources=[helper,'tools/virgl-original-corpus/verifier-access.mjs',
  'renderer/virgl-shader/tests/indirect-constant-cases.json'].map(path=>({path,
    sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));
console.log(JSON.stringify(report));
