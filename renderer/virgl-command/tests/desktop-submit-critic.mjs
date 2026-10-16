// Fresh critic regression: selection is explicit; owner64 stays isolated on reuse.
import { createVirglStandardShadowTextureShaderBridge } from '../../virgl-shader/standard.mjs';
import { checker, makeRig, context, resource, idCommand, backing, transfer } from './submit-acceptance.mjs';

const OK = 0x1100, UNSPEC = 0x1200, OOM = 0x1201, BAD = 0x1205;
const copy = value => structuredClone(value);
const hex = bytes => [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
const set32 = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
const set64 = (bytes, offset, value) => new DataView(bytes.buffer).setBigUint64(offset, value, true);

export async function runDesktopSubmitCritic({ WasmVirglSubmitProof, createVirglStandardDesktopSubmitBridge,
  createVirglSubmitBridge, schedule = 0xa937 }) {
  const c = checker(), actual = document.querySelector('#gpu').getContext('webgl2', { antialias: false });
  c.truth(actual, 'critic actual WebGL2');
  const nativeCalls = [], objectIds = new WeakMap(); let nextObject = 1;
  const describe = value => {
    if (value === null || typeof value !== 'object') return value === undefined ? { undefined: true } : value;
    if (ArrayBuffer.isView(value)) return { type: value.constructor.name, bytes: hex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    if (!objectIds.has(value)) objectIds.set(value, nextObject++);
    return { object: objectIds.get(value), type: value.constructor?.name ?? 'object' };
  };
  const gl = new Proxy(actual, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    return (...args) => { const before = args.map(describe), result = value.apply(target, args);
      nativeCalls.push({ sequence: nativeCalls.length, name: key, before, after: args.map(describe), result: describe(result) }); return result; };
  } });
  const shaderBridge = await createVirglStandardShadowTextureShaderBridge();
  class Selected { constructor(callback, enabled) { return enabled ? WasmVirglSubmitProof.standardDesktop(callback) : new WasmVirglSubmitProof(callback, false); } }
  const result = { schedule, nativeCalls, mismatchedSelections: [], ownership: null };
  window.__desktopCritic = result;
  const plain = makeRig(WasmVirglSubmitProof, createVirglSubmitBridge, gl, shaderBridge, c, schedule, false);
  plain.q.vm.writeMmio(0x14, 0);
  c.equal(plain.q.vm.readMmio(0x10) & 1, 0, 'critic disabled constructor advertises no VIRGL');
  c.equal(plain.q.vm.inspect(), null, 'critic disabled constructor control snapshot absent');
  c.equal(plain.q.vm.submitState(), null, 'critic disabled constructor submission snapshot absent');
  await plain.expect('critic disabled constructor refuses context', context(2), UNSPEC);
  c.equal(plain.events.length, 0, 'critic disabled constructor invokes no host sink');
  result.disabled = { records: plain.q.records, events: plain.events, native: plain.q.vm.inspect(),
    submit: plain.q.vm.submitState(), host: copy(plain.host.bridge.inspect()), machineDigest: plain.q.vm.machineDigest() };
  plain.dispose();
  for (const [label, Wasm, factory] of [
    ['selected native with historical host', Selected, createVirglSubmitBridge],
    ['historical native with selected host', WasmVirglSubmitProof, createVirglStandardDesktopSubmitBridge],
  ]) {
    const rig = makeRig(Wasm, factory, gl, shaderBridge, c, schedule);
    for (let id = 1; id <= 16; id++) await rig.expect(label + ' admit ' + id, resource(id, 0, 64, 16, 8, 1));
    const before = { native: copy(rig.q.vm.inspect()), host: copy(rig.host.bridge.inspect()), events: rig.events.length, objects: rig.trace.objects.size };
    await rig.expect(label + ' refuse17', resource(17, 0, 64, 16, 8, 1), OOM);
    c.same(rig.q.vm.inspect(), before.native, label + ' native rollback');
    c.same(rig.host.bridge.inspect(), before.host, label + ' host rollback');
    c.equal(rig.trace.objects.size, before.objects, label + ' no17 allocation');
    c.equal(rig.events.length - before.events, Wasm === Selected ? 1 : 0, label + ' refusal layer');
    await rig.expect(label + ' packed depth refusal', resource(18, 2, 20, 9, 2, 2), BAD);
    c.same(rig.q.vm.inspect(), before.native, label + ' packed depth rollback');
    result.mismatchedSelections.push({ label, before, after: { native: copy(rig.q.vm.inspect()), host: copy(rig.host.bridge.inspect()) }, records: rig.q.records, events: rig.events });
    rig.dispose();
  }
  const rig = makeRig(Selected, createVirglStandardDesktopSubmitBridge, gl, shaderBridge, c, schedule), { q } = rig;
  window.__desktopActive = () => ({ records: q.records, events: rig.events, native: copy(q.vm.inspect()),
    submit: copy(q.vm.submitState()), host: copy(rig.host.bridge.inspect()),
    response: [...q.read(q.response + BigInt(((q.next - 1) % 128) * 64), 64)] });
  await rig.expect('critic owner64 context', context(2));
  for (let id = 100; id < 164; id++) {
    await rig.expect('critic owner64 create ' + id, resource(id, 0, 64, 16, 8, 1));
    await rig.expect('critic owner64 member ' + id, idCommand(0x202, 2, id));
  }
  const oldAddress = q.backing, newAddress = q.backing + 0x2000n;
  const oldBytes = Uint8Array.of(2, 31, 71, 109, 149, 181, 223, 251), newBytes = Uint8Array.of(241, 211, 173, 137, 103, 67, 29, 3);
  q.write(oldAddress, oldBytes); q.write(newAddress, newBytes);
  await rig.expect('critic owner64 old backing', backing(163, [[oldAddress, 32]]));
  const oldIdentity = copy(q.vm.inspect().resources.find(r => r.identity.id === 163).identity);
  let accepted = null, changed = null, callbackResult = null;
  rig.setIntercept(event => {
    const applied = rig.host.bridge.apply(event);
    if (accepted === null && event.type === 'beginJob') {
      c.equal(event.resources.length, 64, 'critic actual native64 accepted owners');
      c.equal(event.transfer.resourceId, 163, 'critic actual native last owner');
      accepted = copy(event); callbackResult = copy(applied);
      // Poison the caller's object only after host admission has captured it.
      event.context.id = 999; event.resources[63].identity.generation = 'ffffffffffffffff';
      event.resources[63].metadata.width = 4096; event.resources[63].backing.byteLength = 1;
      event.transfer.resourceId = 999; event.transfer.box.width = 4096;
      event.resources.length = 0; changed = copy(event);
    }
    return applied;
  });
  const first = q.enqueue('critic64 upload owns immutable source', transfer(2, 163, 1, [0, 0, 0, 8, 1, 1], 0n, 0, 0, 0x20000000000031n));
  q.kick(); q.run();
  c.equal(q.usedIndex(), first.number, 'critic64 admission does not publish used');
  const poisonedWire = new Uint8Array(first.request); set32(poisonedWire, 16, 999); set32(poisonedWire, 56, 999); set64(poisonedWire, 8, 0n);
  q.write(first.requestAddress, poisonedWire);
  await rig.drain(); q.collect(first); rig.setIntercept(null);
  c.ok(callbackResult, 'critic64 host accepted source before mutation');
  c.equal(rig.exchanges.at(-1).bytes, hex(oldBytes), 'critic64 original literal DMA survives envelope and wire mutation');
  await rig.expect('critic64 read original bytes', transfer(2, 163, 2, [0, 0, 0, 8, 1, 1], 16n));
  c.same([...q.read(oldAddress + 16n, 8)], [...oldBytes], 'critic64 GPU data independently equals old bytes');
  const oldRead = copy(rig.exchanges.at(-1));
  const beforeRefusal = copy(rig.host.bridge.inspect()), staleEpoch = copy(accepted);
  staleEpoch.epoch = '0000000000000000'; staleEpoch.sequence = '000000000000ffff';
  c.bad(rig.host.bridge.apply(staleEpoch), 'critic64 stale epoch refusal', 'invalid-parameter');
  c.same(rig.host.bridge.inspect(), beforeRefusal, 'critic64 stale epoch full-state preservation');
  const entries = [
    q.enqueue('critic64 ordered unref', idCommand(0x102, 0, 163)),
    q.enqueue('critic64 ordered reuse', resource(163, 0, 64, 16, 8, 1)),
    q.enqueue('critic64 ordered new backing', backing(163, [[newAddress, 32]])),
    q.enqueue('critic64 ordered new membership', idCommand(0x202, 2, 163)),
    q.enqueue('critic64 ordered new upload', transfer(2, 163, 1, [0, 0, 0, 8, 1, 1], 0n, 0, 0, 0xffffffffffffffffn)),
    q.enqueue('critic64 ordered new readback', transfer(2, 163, 2, [0, 0, 0, 8, 1, 1], 16n, 0, 0, 0xffffffffffffffffn)),
  ];
  q.kick(); await rig.drain(); for (const entry of entries) q.collect(entry);
  c.same([...q.read(newAddress + 16n, 8)], [...newBytes], 'critic64 replacement GPU bytes use new backing only');
  c.same([...q.read(oldAddress + 16n, 8)], [...oldBytes], 'critic64 new scatter cannot corrupt old backing');
  const newIdentity = copy(q.vm.inspect().resources.find(r => r.identity.id === 163).identity);
  c.truth(oldIdentity.generation !== newIdentity.generation, 'critic64 generation changes on public-ID reuse');
  const beforeStale = copy(rig.host.bridge.inspect());
  c.bad(rig.host.bridge.apply({ type: 'unrefResource', epoch: q.vm.inspect().epoch, resource: oldIdentity }), 'critic64 stale public-ID generation refuses', 'invalid-resource-id');
  c.same(rig.host.bridge.inspect(), beforeStale, 'critic64 stale generation full-state preservation');
  c.equal(q.vm.inspect().resources.length, 64, 'critic64 native count survives ordered replacement');
  c.equal(rig.host.bridge.inspect().resources.length, 64, 'critic64 host count survives ordered replacement');
  result.ownership = { accepted, mutatedCallback: changed, callbackResult, originalWire: hex(first.request), mutatedWire: hex(poisonedWire),
    literalOldBytes: hex(oldBytes), literalNewBytes: hex(newBytes), oldIdentity, newIdentity, oldRead,
    records: q.records, events: rig.events, exchanges: rig.exchanges, completions: rig.completions,
    native: copy(q.vm.inspect()), host: copy(rig.host.bridge.inspect()), machineDigest: q.vm.machineDigest(),
    commandTrace: q.vm.commandTrace(), fenceEvents: rig.trace.events };
  window.__desktopActive = null; rig.dispose();
  c.equal(gl.getError(), gl.NO_ERROR, 'critic final hardware error is clear');
  Object.assign(result, { status: 'passed', assertions: c.assertions, attacks: c.attacks });
  return result;
}
