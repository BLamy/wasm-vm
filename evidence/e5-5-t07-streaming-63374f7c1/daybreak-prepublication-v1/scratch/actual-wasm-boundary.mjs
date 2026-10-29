import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const repo = '/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905';
const mod = await import(pathToFileURL(`${repo}/web/dist/pkg/wasm_vm_wasm.js`));
const wasmBytes = await readFile(`${repo}/web/dist/pkg/wasm_vm_wasm_bg.wasm`);
await mod.default({module_or_path: wasmBytes});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const kernel = new Uint8Array([0x13,0x05,0x10,0,0x6f,0,0,0]);
const newVm = () => new mod.WasmLinux(16, kernel, new Uint8Array(), '', () => {}, false);
const saveHash = vm => sha(vm.saveSnapshot());

const vm = newVm();
vm.stampBootSnapshotIdentity(new Uint8Array(32));
const original = vm.saveSnapshot();
const originalHash = sha(original);
const originalState = vm.stateDigest();

// Independent xorshift schedule and non-zero-offset views with sentinel bytes.
let x = 0x5e55a7c1 >>> 0, at = 0;
const staged = new mod.SnapshotBuffer(original.length);
let chunks = 0, maxChunk = 0;
while (at < original.length) {
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  const n = Math.min(original.length - at, 1 + (x % 131071));
  const carrier = new Uint8Array(n + 17);
  carrier.fill(0xa5); carrier.set(original.subarray(at, at + n), 11);
  staged.append(carrier.subarray(11, 11 + n));
  at += n; chunks++; maxChunk = Math.max(maxChunk, n);
}
assert.equal(staged.byteLength(), original.length);
assert.equal(staged.sha256(), originalHash, 'subarray byteOffset/length must be honored');
assert.equal(vm.restoreSnapshotBuffer(staged), 'resume');
assert.equal(staged.__wbg_ptr, 0, 'valid restore consumes JS ownership');
assert.equal(vm.stateDigest(), originalState);

// Novel failed-append attack: every rejected append must preserve a valid prefix,
// which must remain usable to finish and restore the exact snapshot.
const prefix = 37;
const recoverable = new mod.SnapshotBuffer(original.length);
recoverable.append(original.subarray(0, prefix));
const prefixHash = recoverable.sha256();
for (const bad of [new Uint8Array(0), new Uint8Array(256 * 1024 + 1), new Uint8Array(original.length)]) {
  assert.throws(() => recoverable.append(bad));
  assert.equal(recoverable.byteLength(), prefix);
  assert.equal(recoverable.sha256(), prefixHash);
}
at = prefix;
while (at < original.length) {
  const n = Math.min(original.length - at, 8191);
  recoverable.append(original.subarray(at, at + n)); at += n;
}
assert.equal(recoverable.sha256(), originalHash);
assert.equal(vm.restoreSnapshotBuffer(recoverable), 'resume');
assert.equal(vm.stateDigest(), originalState);

const refusalBaseline = saveHash(vm);

// Incomplete ownership is consumed even when Rust returns an error.
const incomplete = new mod.SnapshotBuffer(original.length);
incomplete.append(original.subarray(0, 19));
assert.throws(() => vm.restoreSnapshotBuffer(incomplete), /incomplete/);
assert.equal(incomplete.__wbg_ptr, 0);
assert.equal(saveHash(vm), refusalBaseline);

// Independent corruptions: duplicate a TLV tag, make a section length overflow the
// container, corrupt a late device byte, and alter each coherence field.
const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
const sections = [];
for (let p = 84; p < original.length;) {
  const tag = view.getUint32(p, true), length = view.getUint32(p + 4, true);
  sections.push({p, tag, length}); p += 8 + length;
}
assert.equal(sections.at(-1).p + 8 + sections.at(-1).length, original.length);
const cases = [];
for (const [want, offset] of [['foreign_build', 19], ['foreign_image', 55], ['stale', 79]]) {
  const b = original.slice(); b[offset] ^= 0x41; cases.push({want, b, name:`identity-${offset}`});
}
{
  const b = original.slice(); new DataView(b.buffer).setUint32(sections[1].p, sections[0].tag, true);
  cases.push({want:'corrupt', b, name:'duplicate-tlv-tag'});
}
{
  const b = original.slice(); new DataView(b.buffer).setUint32(sections[3].p + 4, 0xfffffff0, true);
  cases.push({want:'corrupt', b, name:'section-length-overflow'});
}
{
  // VIRTIO_RNG (tag 10) ends in bool, bool, u64. Force the first final-state
  // bool to 2: a structurally complete late device section with invalid state.
  const late = sections.find(s => s.tag === 10); const b = original.slice();
  b[late.p + 8 + late.length - 10] = 2;
  cases.push({want:'corrupt', b, name:'late-device-invalid-bool'});
}
const refusals = [];
for (const {want, b, name} of cases) {
  const sb = new mod.SnapshotBuffer(b.length);
  for (let p = 0; p < b.length;) {
    const n = Math.min(b.length - p, 12347); sb.append(b.subarray(p, p + n)); p += n;
  }
  let got; try { got = vm.restoreSnapshotBuffer(sb); } catch (e) { got = String(e).includes('corrupt') ? 'corrupt' : String(e); }
  assert.equal(got, want, name);
  assert.equal(sb.__wbg_ptr, 0, `${name} consumes ownership`);
  assert.equal(saveHash(vm), refusalBaseline, `${name} mutated machine`);
  refusals.push({name, want, got});
}

// Missing resume identity is also a consuming refusal and must not mutate.
const missingVm = newVm(); const missingBefore = saveHash(missingVm);
const missing = new mod.SnapshotBuffer(original.length);
for (let p=0; p<original.length;) { const n=Math.min(original.length-p, 32749); missing.append(original.subarray(p,p+n)); p+=n; }
assert.equal(missingVm.restoreSnapshotBuffer(missing), 'missing');
assert.equal(missing.__wbg_ptr, 0);
assert.equal(saveHash(missingVm), missingBefore);

missingVm.free(); vm.free();
console.log(JSON.stringify({passed:true, wasmBytes:wasmBytes.length, wasmSha256:sha(wasmBytes), originalBytes:original.length,
  originalSha256:originalHash, chunks, maxChunk, sectionCount:sections.length, refusals}, null, 2));
