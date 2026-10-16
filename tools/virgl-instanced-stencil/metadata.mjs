#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createVirglStandardInstanceBaseShaderBridge, createVirglStandardIntegerImageShaderBridge } from '../../renderer/virgl-shader/standard.mjs';
import { parseStandardInstanceBaseShaderMetadata as parse, normalizeStandardInstanceBaseShaderResult as stage,
  normalizeStandardInstanceBaseShaderPair as pair, deriveStandardInstanceBaseShaderInterface as derive,
  normalizeStandardMultipleColorShaderResult as oldStage } from '../../renderer/virgl-command/constant-domain.mjs';
import { vertex, fragment } from '../virgl-ordered-stencil/fixtures.mjs';

const output = path.resolve(process.argv[2]);
await fs.mkdir(output, { recursive: true });
const bridge = await createVirglStandardInstanceBaseShaderBridge(), oldBridge = await createVirglStandardIntegerImageShaderBridge();
const selectors = { signedMask: 0, unsignedMask: 0, packedSignedMask: 0, packedNormalizedMask: 0, bufferZeroMask: 0, signedColorMask: 0, unsignedColorMask: 0 };
const rows = [], clone = value => JSON.parse(JSON.stringify(value)), hash = value => createHash('sha256').update(value).digest('hex');
const report = { task: 'E6-T11d47', status: 'running', gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  nativeExecution: false, guestExecution: false, productionNegotiation: false, rows };
const deepFrozen = value => { if (value && typeof value === 'object') { assert.equal(Object.isFrozen(value), true); for (const v of Object.values(value)) deepFrozen(v); } };
function check(name, request, original, received, expected) {
  assert.equal(received.ok, expected, name);
  deepFrozen(received);
  const negativeZero = value => value && typeof value === 'object' ? Object.values(value).some(negativeZero) : Object.is(value, -0);
  rows.push({ name, request, original, received, ...(negativeZero(original) ? { originalContainsNegativeZero: true } : {}) });
}
const vs = bridge.translate({ stage: 'vertex', text: vertex(.25) });
const fsResult = bridge.translate({ stage: 'fragment', text: fragment(false) });
const paired = bridge.translatePairImages({ vertexText: vertex(.25), fragmentText: fragment(false), ...selectors });
check('original vertex', null, vs, stage(vs, 'vertex'), true);
check('original fragment', null, fsResult, stage(fsResult, 'fragment'), true);
check('original pair', null, paired, pair(paired), true);
check('stage metadata', null, vs.metadata, parse(vs.metadata, 'vertex'), true);
check('original interface', null, paired, derive(paired.vertex.metadata, paired.fragment.metadata), true);
const old = oldBridge.translate({ stage: 'vertex', text: vertex(.25) });
check('old stage remains admitted by old parser', null, old, oldStage(old, 'vertex'), true);
check('old profile refused by new parser', null, old, stage(old, 'vertex'), false);
check('new profile refused by old parser', null, vs, oldStage(vs, 'vertex'), false);

const absent = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
for (const [name, text] of [['absent', absent], ['declared-unused', absent.replace('DCL OUT[0]', 'DCL SV[0], INSTANCEID\nDCL OUT[0]')]]) {
  const request = { stage: 'vertex', text }, original = bridge.translate(request);
  check(name, request, original, stage(original, 'vertex'), true);
  assert.equal(original.metadata.instanceUniforms.length, name === 'absent' ? 0 : 1);
}
for (const [field, value] of [['signedMask', 2], ['unsignedMask', 2], ['packedSignedMask', 2], ['packedNormalizedMask', 2], ['bufferZeroMask', 1], ['signedColorMask', 1], ['unsignedColorMask', 1]]) {
  const host = { ...selectors, [field]: value, ...(field === 'packedNormalizedMask' ? { packedSignedMask: 2 } : {}) };
  const vertexText = field === 'bufferZeroMask' ? vertex(.25).replace('DCL IN[0]', 'DCL CONST[0][0]\nDCL IN[0]') : vertex(.25);
  const original = bridge.translatePairImages({ vertexText, fragmentText: fragment(false), ...host });
  check('owned selector ' + field, host, original, pair(original, host), true);
  check('interface selector ' + field, host, original, derive(original.vertex.metadata, original.fragment.metadata, host), true);
}
const metaMutations = [
  ['missing offset', m => { m.instanceUniforms = []; }],
  ['missing array', m => { delete m.instanceUniforms; }],
  ['unknown field', m => { m.base = 7; }],
  ['duplicate offset', m => { m.instanceUniforms.push(clone(m.instanceUniforms[0])); }],
  ['name', m => { m.instanceUniforms[0].name = 'guest_instance_base'; }],
  ['type', m => { m.instanceUniforms[0].type = 'int'; }],
  ['semantic', m => { m.instanceUniforms[0].semantic = 'INSTANCEID'; }],
  ['nonzero default', m => { m.instanceUniforms[0].default = 1; }],
  ['negative zero', m => { m.instanceUniforms[0].default = -0; }],
  ['unknown record field', m => { m.instanceUniforms[0].guestValue = 9; }],
  ['removed original semantic', m => { m.systemValues = m.systemValues.filter(v => v.semantic !== 'INSTANCEID'); }],
  ['malformed original semantic', m => { m.systemValues[0].semantic = 'UNKNOWN'; }],
  ['unknown profile', m => { m.profile = 'virgl-webgl2-standard-instance-base-gles3-v2'; }]
];
for (const [name, mutate] of metaMutations) {
  const original = clone(vs); mutate(original.metadata);
  check('metadata refusal ' + name, null, original, stage(original, 'vertex'), false);
  check('parse refusal ' + name, null, original.metadata, parse(original.metadata, 'vertex'), false);
}
const fragmentOffset = clone(fsResult); fragmentOffset.metadata.instanceUniforms = clone(vs.metadata.instanceUniforms);
check('fragment cannot own base', null, fragmentOffset, stage(fragmentOffset, 'fragment'), false);
for (const [name, mutate] of [
  ['key', r => { r.interfaceKey += 'x'; }],
  ['vertex offset', r => { r.vertex.metadata.instanceUniforms = []; }],
  ['fragment offset', r => { r.fragment.metadata.instanceUniforms = clone(vs.metadata.instanceUniforms); }],
  ['promotion', r => { r.vertex.metadata.outputs.find(o => o.semantic === 'GENERIC').interpolation = 'smooth'; }],
  ['unknown pair key', r => { r.base = 5; }],
  ['bad glsl', r => { r.vertex.glsl = '#version 100\n'; }]
]) {
  const original = clone(paired); mutate(original);
  check('pair refusal ' + name, null, original, pair(original), false);
}
for (const glsl of [null, '#version 100', 'x'.repeat(262145)]) {
  const original = clone(vs); original.glsl = glsl;
  check('incompatible stage source ' + String(glsl).length, null, original, stage(original, 'vertex'), false);
}
for (const value of [null, [], {}, { ok: 0 }, { ok: false, error: { code: 'bad', message: 'bad' } }, { ok: true, ...vs, base: 5 }]) {
  check('stage response refusal ' + rows.length, null, value, stage(value, 'vertex'), false);
  check('pair response refusal ' + rows.length, null, value, pair(value), false);
}
const error = bridge.translate({ stage: 'vertex', text: 'VERT\n0: INVALID\n' });
check('actual compiler stage error', null, error, stage(error, 'vertex'), false);
const pairError = bridge.translatePairImages({ vertexText: 'VERT\n0: INVALID\n', fragmentText: fragment(false), ...selectors });
check('actual compiler pair error', null, pairError, pair(pairError), false);
let getters = 0;
const hostile = clone(vs);
Object.defineProperty(hostile.metadata.instanceUniforms[0], 'default', { enumerable: true, get() { getters++; throw Error('getter ran'); } });
const received = stage(hostile, 'vertex'); assert.equal(received.ok, false); assert.equal(getters, 0);
rows.push({ name: 'getter rejected without invocation', originalShape: 'instanceUniforms[0].default accessor', received, getters });
const badInterface = clone(paired); badInterface.vertex.metadata.instanceUniforms = [];
check('interface rejects forged offset', null, badInterface, derive(badInterface.vertex.metadata, badInterface.fragment.metadata), false);
for (const [name, invoke] of [['stage', value => stage(value, 'vertex')], ['metadata', value => parse(value, 'vertex')],
  ['pair', value => pair(value)], ['interface', value => derive(value, paired.fragment.metadata)]]) {
  let traps = 0;
  const hostile = new Proxy({}, { ownKeys() { traps++; throw Error('original ' + name + ' proxy trap'); } });
  const received = invoke(hostile); assert.equal(received.ok, false); assert.equal(traps, 1);
  rows.push({ name: 'own-property trap refusal ' + name, originalShape: 'ownKeys proxy throws', traps, received });
}
for (const [name, invoke] of [['stage', () => stage(vs, 'vertex')], ['metadata', () => parse(vs.metadata, 'vertex')],
  ['pair', () => pair(paired)], ['interface', () => derive(paired.vertex.metadata, paired.fragment.metadata)]]) {
  const originalFreeze = Object.freeze; let throws = 0;
  try {
    Object.freeze = value => { if (throws === 0) { throws++; throw Error('bounded native-freeze fault ' + name); } return originalFreeze(value); };
    assert.throws(invoke, { message: 'bounded native-freeze fault ' + name });
  } finally { Object.freeze = originalFreeze; }
  rows.push({ name: 'unexpected intrinsic fault ' + name, environmentFault: 'Object.freeze throws once; restored synchronously in finally',
    nativeExecution: false, throws, outcome: 'unexpected exception propagates without being recast as compiler refusal' });
}
report.status = 'passed';
const raw = Buffer.from(JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(output, 'metadata.json'), raw);
console.log(JSON.stringify({ status: report.status, rows: rows.length, sha256: hash(raw) }));
