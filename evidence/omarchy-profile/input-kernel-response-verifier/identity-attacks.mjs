// Independent finite guard checks. Synthetic state; not desktop acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const load = name => import(pathToFileURL(`${process.cwd()}/tools/verify/${name}`));
const { assertInputKernelPreparedSource } = await load('omarchy-input-kernel-response-state.mjs');
const { assertPreparedDirectSource, assertPreparedDirectProperties } = await load('omarchy-prepared-direct-state.mjs');
const source = {
  kernel: { size: 24208896, sha256: '3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d' },
  chunkManifest: { size: 1097812, sha256: '5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44' },
  bootSnapshot: { size: 205400326, sha256: '265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8' },
  overlayDelta: { size: 1285559, sha256: '1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c' },
  image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 },
};
const arFoot = { address: '0x55558518d650', pid: 473 };
const makeResponse = foot => ({ exit: 0, stdout: ['true', 'true', '1', '1', '1', 'true', 'true', 'true',
  JSON.stringify({ class: 'foot', mapped: true, hidden: false, visible: true, acceptsInput: true,
    at: [12, 38], size: [1256, 750], ...foot })].join('\n') });
const cases = [];
function refused(name, operation) {
  let error;
  try { operation(); } catch (e) { error = String(e); }
  assert.ok(error, `adversarial case accepted: ${name}`);
  cases.push({ name, rejected: true, error });
}
assertInputKernelPreparedSource(source);
assertPreparedDirectProperties(makeResponse(arFoot), arFoot);
assertPreparedDirectProperties(makeResponse({ address: '0x55555eb73630', pid: 503 }));
for (const role of ['kernel', 'chunkManifest', 'bootSnapshot', 'overlayDelta']) {
  for (const field of ['size', 'sha256']) {
    const bad = structuredClone(source);
    bad[role][field] = field === 'size' ? bad[role][field] + 1 : '0'.repeat(64);
    refused(`${role} ${field}`, () => assertInputKernelPreparedSource(bad));
  }
}
refused('AR pair through unchanged AJ default', () => assertPreparedDirectSource(source));
refused('AR Foot through unchanged AJ default', () => assertPreparedDirectProperties(makeResponse(arFoot)));
for (const [name, foot] of [
  ['AJ address with AR pid', { ...arFoot, address: '0x55555eb73630' }],
  ['AJ pid with AR address', { ...arFoot, pid: 503 }],
  ['hidden AR Foot', { ...arFoot, hidden: true }],
  ['AR Foot rejecting input', { ...arFoot, acceptsInput: false }],
]) refused(name, () => assertPreparedDirectProperties(makeResponse(foot), arFoot));
const checked = {};
for (const name of ['omarchy-input-kernel-response-state.mjs', 'omarchy-prepared-direct-state.mjs']) {
  const bytes = await fs.readFile(`tools/verify/${name}`);
  checked[name] = createHash('sha256').update(bytes).digest('hex');
}
console.log(JSON.stringify({ purpose: 'synthetic explicit AR guard attacks; not desktop acceptance', passed: true,
  controls: ['AR source accepted', 'AR Foot explicitly accepted', 'unchanged AJ Foot accepted'], checked, cases }, null, 2));
