// Independent format/role and lifetime regression. No native pixel claim.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createResourceStore} from '../resources.mjs';
import {decodeSubmission} from '../decoder.mjs';

const roles = ['view', 'surface', 'depth-surface', 'vertex', 'index', 'readback'];
const metadata = (format, bind, width = 5, height = 3) => ({id: 19, target: 2, format, bind, width, height,
  depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0});
function rig() {
  const allocated = [], destroyed = [];
  const resource = createResourceStore({backend: {maxTextureSize: 16384,
    allocate(meta) {const value = {format: meta.format, allocation: allocated.length}; allocated.push(value); return value;},
    destroy(value) {destroyed.push(value);}, upload() {}, readback() {throw new Error('metadata proof has no pixel authority');}, dispose() {},
  }});
  assert.equal(resource.ok, true);
  assert.equal(resource.store.createContext(9).ok, true);
  return {...resource, allocated, destroyed};
}
function finish(r) {
  assert.equal(r.store.dispose().ok, true);
  assert.equal(Object.values(r.store.inspect().budgets).every(value => value === 0), true);
  assert.equal(r.allocated.length, r.destroyed.length);
}
function packet(type, words) {
  const bytes = new Uint8Array((words.length + 1) * 4), view = new DataView(bytes.buffer);
  view.setUint32(0, 1 | (type << 8) | (words.length << 16), true);
  words.forEach((value, i) => view.setUint32((i + 1) * 4, value, true));
  return bytes;
}

export function runRequiredFormatRoles() {
  let roleChecks = 0, rejectedBeforeAllocation = 0, wireChecks = 0;
  for (const [width, height] of [[3, 5], [5, 7], [11, 3]]) {
    for (const format of [2, 67, 233]) for (const bind of [2, 8, 10, 10 | (1 << 18), 10 | (1 << 20)]) {
      const r = rig(), meta = metadata(format, bind, width, height);
      assert.equal(r.store.createResource(meta).ok, true);
      assert.equal(r.store.attachContext(9, meta.id).ok, true);
      const expected = new Set(['readback', ...((bind & 8) ? ['view'] : []), ...((bind & 2) ? ['surface'] : [])]);
      for (const role of roles) {
        const result = r.store.retainStorage(9, meta.id, role);
        assert.equal(result.ok, expected.has(role), `format ${format}/bind ${bind}/role ${role}`);
        if (result.ok) {
          const resolved = r.bindings.resolve(result.lease);
          assert.equal(resolved.ok, true);
          assert.equal(resolved.metadata.format, format);
          assert.equal(resolved.role, role);
          assert.equal(r.store.releaseStorage(result.lease).ok, true);
        }
        roleChecks++;
      }
      finish(r);
    }
  }
  for (const [meta, expected] of [
    [metadata(16, 1), ['depth-surface', 'readback']],
    [{...metadata(64, 16, 37, 1), target: 0}, ['vertex', 'readback']],
    [{...metadata(64, 32, 41, 1), target: 0}, ['index', 'readback']],
  ]) {
    const r = rig(); assert.equal(r.store.createResource(meta).ok, true); assert.equal(r.store.attachContext(9, meta.id).ok, true);
    for (const role of roles) {
      const result = r.store.retainStorage(9, meta.id, role);
      assert.equal(result.ok, expected.includes(role));
      if (result.ok) assert.equal(r.store.releaseStorage(result.lease).ok, true);
      roleChecks++;
    }
    finish(r);
  }
  for (const change of [
    ...[1, 20, 177, 0, 0xffffffff].map(format => ({format})),
    ...[0, 1, 3, 4, 5, 6, 7, 8, 0x1000002].map(target => ({target})),
    ...[1, 2, 0xffffffff].map(lastLevel => ({lastLevel})),
    ...[0, 2, 0xffffffff].map(arraySize => ({arraySize})),
    ...[0, 2, 0xffffffff].map(depth => ({depth})),
    ...[1, 4, 0xffffffff].map(nrSamples => ({nrSamples})),
    ...[1, 0xffffffff].map(flags => ({flags})),
    ...[0, 1, 3, 16, 32, 524288, 0xffffffff].map(bind => ({bind})),
  ]) {
    const r = rig(), before = structuredClone(r.store.inspect().budgets);
    assert.equal(r.store.createResource({...metadata(67, 10), ...change}).ok, false, JSON.stringify(change));
    assert.equal(r.allocated.length, 0);
    assert.deepEqual(r.store.inspect().budgets, before);
    rejectedBeforeAllocation++;
    finish(r);
  }
  // Reusing a public ID for 10-bit storage cannot change the retained RGBA lease.
  const r = rig(), original = metadata(67, 10), first = r.store.createResource(original);
  assert.equal(first.ok, true); assert.equal(r.store.attachContext(9, 19).ok, true);
  const oldLease = r.store.retainStorage(9, 19, 'view'); assert.equal(oldLease.ok, true);
  original.format = 233; original.bind = 2;
  assert.equal(r.store.unref(19).ok, true);
  const replacement = r.store.createResource(metadata(233, 2)); assert.equal(replacement.ok, true);
  assert.equal(r.store.attachContext(9, 19).ok, true);
  assert.equal(r.store.retainStorage(9, 19, 'view').ok, false);
  const old = r.bindings.resolve(oldLease.lease); assert.equal(old.ok, true);
  assert.equal(old.metadata.format, 67); assert.equal(old.generation, first.resource.generation);
  assert.notEqual(old.generation, replacement.resource.generation);
  assert.equal(r.store.releaseStorage(oldLease.lease).ok, true);
  assert.equal(r.bindings.resolve(oldLease.lease).ok, false);
  finish(r);
  // Combined ZERO/ONE/nonidentity selectors are legal independently of spelling.
  for (const format of [2, 67, 233]) for (let selector = 0; selector < 1296; selector++) {
    let n = selector, packed = 0; const swizzle = [];
    for (let lane = 0; lane < 4; lane++) {const value = n % 6; n = Math.floor(n / 6); swizzle.push(value); packed |= value << (lane * 3);}
    const decoded = decodeSubmission(packet(6, [12, 19, (2 << 24) | format, 0, 0, packed]));
    assert.equal(decoded.ok, true); assert.deepEqual(decoded.commands[0].fields.swizzle, swizzle); wireChecks++;
  }
  for (const format of [1, 16, 20, 64, 177]) {
    assert.equal(decodeSubmission(packet(6, [12, 19, (2 << 24) | format, 0, 0, 0x688])).ok, false); wireChecks++;
  }
  for (const word of [1, 0x10000, 0xffffffff]) {
    assert.equal(decodeSubmission(packet(6, [12, 19, 0x02000043, word, 0, 0x688])).ok, false);
    assert.equal(decodeSubmission(packet(6, [12, 19, 0x02000043, 0, word, 0x688])).ok, false);
    assert.equal(decodeSubmission(packet(8, [12, 19, 67, word, 0])).ok, false);
    assert.equal(decodeSubmission(packet(8, [12, 19, 67, 0, word])).ok, false); wireChecks += 4;
  }
  return {status: 'passed', roleChecks, rejectedBeforeAllocation, wireChecks, retainedIdReuse: true, guestDepthView: false,
    boundary: 'Independent metadata/role and wire guards; physical pixels are established by the sealed hardware records.'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(runRequiredFormatRoles(), null, 2));
