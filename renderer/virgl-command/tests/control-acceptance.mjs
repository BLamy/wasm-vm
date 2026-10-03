// Literal VirtIO control packets through actual wasm RAM/MMIO and Machine.run(1).
// GPU allocation evidence below uses WebGL2; trusted failure controls are labelled.
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';

const OK = 0x1100, UNSPEC = 0x1200, OOM = 0x1201, BAD_RESOURCE = 0x1203, BAD_CONTEXT = 0x1204, BAD_PARAMETER = 0x1205;
const hex = (bytes) => [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
const address = (value) => BigInt(value).toString(16).padStart(16, '0');
const json = (value) => JSON.stringify(value, (_, v) => v instanceof Uint8Array ? [...v] : v);
const u32 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
const u16 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
const u64 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(offset, BigInt(value), true);
const get16 = (bytes, offset = 0) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
const get32 = (bytes, offset = 0) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
function header(opcode, ctx, length) { const bytes = new Uint8Array(length); u32(bytes, 0, opcode); u32(bytes, 16, ctx); return bytes; }
function context(id) { const bytes = header(0x200, id, 96); u32(bytes, 24, 5); bytes.set([112, 114, 111, 111, 102], 32); return bytes; }
function resource(id, target, format, bind, width, height) {
  const bytes = header(0x204, 0, 72);
  [id, target, format, bind, width, height, 1, 1, 0, 0, 0, 0].forEach((v, i) => u32(bytes, 24 + 4 * i, v)); return bytes;
}
function idCommand(opcode, ctx, id) { const bytes = header(opcode, ctx, 32); u32(bytes, 24, id); return bytes; }
function backing(id, entries) {
  const bytes = header(0x106, 0, 32 + 16 * entries.length); u32(bytes, 24, id); u32(bytes, 28, entries.length);
  entries.forEach(([addr, length], i) => { u64(bytes, 32 + i * 16, addr); u32(bytes, 40 + i * 16, length); }); return bytes;
}
function response(request, type) {
  const bytes = header(type, get32(request, 16), 24), fenced = get32(request, 4) & 1;
  u32(bytes, 4, fenced); if (fenced) bytes.set(request.subarray(8, 16), 8); bytes[20] = request[20]; return bytes;
}
function checker() {
  let assertions = 0; const attacks = [];
  const equal = (a, b, label) => { assertions++; if (!Object.is(a, b)) throw new Error(`${label}: expected ${json(b)}, got ${json(a)}`); };
  const same = (a, b, label) => equal(json(a), json(b), label);
  const truth = (v, label) => equal(Boolean(v), true, label);
  const ok = (v, label) => { equal(v?.ok, true, `${label}: ${v?.error?.code ?? ''} ${v?.error?.message ?? ''}`); return v; };
  const bad = (v, label, code) => { equal(v?.ok, false, `${label} rejected`); truth(typeof v?.error?.message === 'string', `${label} structured message`); if (code) equal(v.error.code, code, `${label} code`); attacks.push({ name: label, code: v.error.code }); return v; };
  const throws = (fn, label) => { let threw = false; try { fn(); } catch { threw = true; } truth(threw, `${label} throws`); attacks.push({ name: label, code: 'host-input-rejected' }); };
  return { equal, same, truth, ok, bad, throws, attacks, get assertions() { return assertions; } };
}
function trackingGL(gl) {
  const names = ['Buffer', 'Texture', 'VertexArray', 'Framebuffer', 'Shader', 'Program', 'Sampler'];
  const live = Object.fromEntries(names.map((name) => [name, new Set()]));
  const created = Object.fromEntries(names.map((name) => [name, 0]));
  let fault = null, callback = null, throwAfter = null;
  const proxy = new Proxy(gl, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    return (...args) => {
      if (callback && callback.name === key) { const pending = callback; callback = null; pending.fn(); }
      if (fault === key) { fault = null; return null; }
      const result = value.apply(target, args);
      for (const name of names) {
        if (key === `create${name}` && result) { live[name].add(result); created[name]++; }
        if (key === `delete${name}` && args[0]) live[name].delete(args[0]);
      }
      if (throwAfter === key) { throwAfter = null; throw new Error(`Deliberate trusted host exception after ${key}`); }
      return result;
    };
  } });
  return { gl: proxy, failOnce: (name) => { fault = name; }, throwAfterOnce: (name) => { throwAfter = name; }, callbackOnce: (name, fn) => { callback = { name, fn }; },
    counts: () => Object.fromEntries(names.map((name) => [name, live[name].size])), created: () => ({ ...created }) };
}
class Queue {
  constructor(WasmVirglControlProof, callback, c, proof = true, negotiate = true) {
    this.c = c; this.vm = new WasmVirglControlProof(callback, proof); this.layout = this.vm.layout();
    this.base = BigInt('0x' + this.layout.ramBase); this.next = 0; this.records = [];
    for (const [name, offset] of Object.entries({ desc: 0x6000, avail: 0x7000, used: 0x8000, request: 0x10000, response: 0x14000, backing: 0x20000, backing2: 0x30000 })) this[name] = this.base + BigInt(offset);
    c.equal(this.layout.ramBytes, 4194304, 'bounded proof RAM'); this.configure(); if (negotiate) this.negotiate();
  }
  write(addr, bytes) { this.vm.writeRam(address(addr), bytes); }
  read(addr, length) { return this.vm.readRam(address(addr), length); }
  configure() {
    this.next = 0; this.write(this.avail, new Uint8Array(40)); this.write(this.used, new Uint8Array(136));
    this.vm.writeMmio(0x30, 0); this.vm.writeMmio(0x38, 16);
    for (const [offset, addr] of [[0x80, this.desc], [0x90, this.avail], [0xa0, this.used]]) {
      this.vm.writeMmio(offset, Number(addr & 0xffffffffn)); this.vm.writeMmio(offset + 4, Number(addr >> 32n));
    }
    this.vm.writeMmio(0x44, 1);
  }
  negotiate() {
    this.vm.writeMmio(0x70, 3); this.vm.writeMmio(0x24, 0); this.vm.writeMmio(0x20, 1);
    this.vm.writeMmio(0x24, 1); this.vm.writeMmio(0x20, 1); this.vm.writeMmio(0x70, 11);
    this.c.truth(this.vm.readMmio(0x70) & 8, 'proof feature negotiation accepted'); this.vm.writeMmio(0x70, 15);
  }
  descriptor(index, addr, length, writable, next) {
    const bytes = new Uint8Array(16); u64(bytes, 0, addr); u32(bytes, 8, length); u16(bytes, 12, (writable ? 2 : 0) | (next === null ? 0 : 1)); u16(bytes, 14, next ?? 0);
    this.write(this.desc + BigInt(index * 16), bytes);
  }
  submit(request, requestParts = [request.length], responseParts = [24]) {
    this.c.equal(requestParts.reduce((a, b) => a + b, 0), request.length, 'request SG length');
    this.write(this.request, request); this.write(this.response, new Uint8Array(64).fill(0xa5));
    const total = requestParts.length + responseParts.length; this.c.truth(total <= 16, 'bounded descriptors');
    let offset = 0;
    requestParts.forEach((length, i) => { this.descriptor(i, this.request + BigInt(offset), length, false, i + 1); offset += length; });
    offset = 0;
    responseParts.forEach((length, part) => { const i = requestParts.length + part; this.descriptor(i, this.response + BigInt(offset), length, true, i + 1 < total ? i + 1 : null); offset += length; });
    const ring = this.next % 16, entry = new Uint8Array(2); this.write(this.avail + 4n + BigInt(ring * 2), entry);
    this.next = (this.next + 1) & 65535; u16(entry, 0, this.next); this.write(this.avail + 2n, entry);
    this.vm.writeMmio(0x50, 0); const run = this.vm.run1(); this.c.equal(run.outcome, 'MaxInstrs', 'actual Machine.run instruction boundary');
    this.c.equal(get16(this.read(this.used + 2n, 2)), this.next, 'used ring progresses once');
    this.c.equal(get32(this.read(this.used + 4n + BigInt(ring * 8), 4)), 0, 'used descriptor head');
    return { response: this.read(this.response, 24), usedLength: get32(this.read(this.used + 8n + BigInt(ring * 8), 4)), run };
  }
  expect(label, request, expected, portable = false) {
    const result = this.submit(request); this.c.equal(result.usedLength, 24, `${label} full reply length`);
    this.c.equal(hex(result.response), hex(response(request, expected)), `${label} independent response bytes`);
    this.c.same([...this.read(this.response + 24n, 40)], new Array(40).fill(0xa5), `${label} reply guard`);
    const state = this.vm.inspect(), record = { case: label, request: hex(request), response: hex(result.response), usedIndex: this.next,
      ring: { descriptors: hex(this.read(this.desc, 256)), avail: hex(this.read(this.avail, 40)), used: hex(this.read(this.used, 136)) },
      machineDigest: result.run.machineDigest, transportCanonical: state ? hex(state.canonicalBytes) : '', transportDigest: state?.digest ?? '' };
    this.records.push(record); if (portable) this.portableRecords.push(record); return record;
  }
  reset() { this.vm.writeMmio(0x70, 0); this.vm.run1(); this.configure(); this.negotiate(); }
  dispose() { this.vm.free(); }
}


// These probes deliberately revoke trusted host owners or throw after actual GL
// deletion. They prove fail-closed cleanup, not failure-atomic guest semantics.
function isolatedHostFaults(createVirglControlBridge, tracked, shaderBridge, c) {
  const zero = { Buffer: 0, Texture: 0, VertexArray: 0, Framebuffer: 0, Shader: 0, Program: 0, Sampler: 0 };
  const config = { gl: tracked.gl, shaderBridge };
  const make = (extra = {}) => c.ok(createVirglControlBridge({ ...config, ...extra }), 'isolated real host bridge');
  const epoch = '0000000000000001', ctx = { id: 2, generation: '0000000000000001' }, res = { id: 3, generation: '0000000000000002' };
  const meta = { id: 3, target: 0, format: 64, bind: 16, width: 8, height: 1, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 };
  const ctxEvent = { type: 'createContext', epoch, context: ctx, debugName: Uint8Array.of(255, 0, 128) };
  const resEvent = { type: 'createResource', epoch, resource: res, metadata: meta };
  const destroy = { type: 'destroyContext', epoch, context: ctx };
  const seed = (host, withResource = true) => { c.ok(host.bridge.apply(ctxEvent), 'isolated context'); if (withResource) c.ok(host.bridge.apply(resEvent), 'isolated resource'); };
  const dispose = (host) => { c.ok(host.bridge.dispose(), 'isolated host disposal'); c.same(tracked.counts(), zero, 'isolated host zero GL leaks'); };
  const poisoned = (host, label) => {
    c.equal(host.bridge.inspect().poisoned, true, `${label} marks host poison`);
    c.bad(host.bridge.apply(destroy), `${label} blocks following operation`, 'bridge-poisoned');
    c.ok(host.bridge.apply({ type: 'reset', epoch: '0000000000000002' }), `${label} reset recovery`);
    c.equal(host.bridge.inspect().poisoned, false, `${label} reset clears poison`);
  };
  for (const [label, invalid] of [
    ['null config', null], ['unknown config field', { ...config, extra: true }],
    ['bad resource limit', { ...config, resourceLimits: { resources: 17 } }],
    ['bad state limit', { ...config, stateLimits: { contexts: 9 } }],
    ['missing shader capability', { ...config, shaderBridge: {} }],
  ]) { c.bad(createVirglControlBridge(invalid), `trusted constructor ${label}`, 'invalid-parameter'); c.same(tracked.counts(), zero, `${label} constructor rollback`); }
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  c.bad(createVirglControlBridge(revoked.proxy), 'trusted constructor descriptor trap', 'bridge-poisoned');
  tracked.throwAfterOnce('getError'); c.bad(createVirglControlBridge(config), 'trusted constructor GL exception', 'out-of-memory');
  c.same(tracked.counts(), zero, 'constructor exception releases partial GL helpers');

  let host = make({ resourceLimits: { resources: 1 }, stateLimits: { contexts: 1 } }); seed(host);
  c.bad(host.bridge.apply({ ...ctxEvent, context: { id: 4, generation: '0000000000000003' } }), 'trusted tightened state limit', 'out-of-memory');
  c.equal(host.probes.owners().store.inspect().contexts.length, 1, 'state quota rolls back companion store context');
  c.bad(host.bridge.apply({ ...resEvent, resource: { id: 4, generation: '0000000000000003' }, metadata: { ...meta, id: 4 } }), 'trusted tightened resource limit', 'out-of-memory'); dispose(host);

  // A trusted host holding probes can revoke owners behind the adapter. Numeric
  // guest input cannot do this; the mapping still returns precise failures.
  host = make(); seed(host); c.ok(host.probes.owners().store.destroyContext(2), 'trusted external context revocation');
  c.bad(host.bridge.apply({ type: 'attachResource', epoch, context: ctx, resource: res }), 'trusted missing owner context mapping', 'invalid-context-id'); dispose(host);
  host = make(); seed(host); c.ok(host.probes.owners().store.unref(3), 'trusted external resource revocation');
  c.bad(host.bridge.apply({ type: 'attachResource', epoch, context: ctx, resource: res }), 'trusted missing owner resource mapping', 'invalid-resource-id'); dispose(host);

  host = make();
  let disposeDuringAllocation;
  tracked.callbackOnce('createVertexArray', () => { disposeDuringAllocation = host.bridge.dispose(); });
  c.ok(host.bridge.apply(ctxEvent), 'context survives rejected reentrant disposal');
  c.bad(disposeDuringAllocation, 'trusted reentrant bridge disposal', 'bridge-poisoned'); dispose(host);

  // Unknown GL exception during state context creation is rolled back where
  // possible, but the adapter poisons rather than claiming arbitrary atomicity.
  host = make(); tracked.throwAfterOnce('getError');
  c.bad(host.bridge.apply(ctxEvent), 'trusted unexpected context allocation exception', 'bridge-poisoned'); poisoned(host, 'unexpected allocation'); dispose(host);

  host = make();
  tracked.callbackOnce('createFramebuffer', () => { c.ok(host.probes.owners().store.destroyContext(2), 'trusted revoke during failed compound creation'); });
  tracked.failOnce('createFramebuffer');
  c.bad(host.bridge.apply(ctxEvent), 'trusted compound rollback fails closed', 'bridge-poisoned'); poisoned(host, 'compound rollback failure'); dispose(host);

  host = make(); seed(host, false); tracked.throwAfterOnce('deleteFramebuffer');
  c.bad(host.bridge.apply(destroy), 'trusted partial context teardown fails closed', 'bridge-poisoned'); poisoned(host, 'partial context teardown'); dispose(host);
  host = make(); seed(host); tracked.throwAfterOnce('deleteBuffer');
  c.bad(host.bridge.apply({ type: 'unrefResource', epoch, resource: res }), 'trusted partial resource teardown fails closed', 'bridge-poisoned'); poisoned(host, 'partial resource teardown'); dispose(host);

  // Both cleanup owners are attempted even if the first fails. Throwing after
  // deletion lets the harness check zero surviving actual GL objects precisely.
  for (const operation of ['reset', 'dispose']) {
    host = make(); seed(host); tracked.throwAfterOnce('deleteFramebuffer');
    const result = operation === 'reset' ? host.bridge.apply({ type: 'reset', epoch: '0000000000000002' }) : host.bridge.dispose();
    c.bad(result, `trusted ${operation} renderer cleanup failure`, 'bridge-poisoned');
    c.equal(host.bridge.inspect().poisoned, true, `${operation} cleanup retains poison`);
    c.equal(host.probes.owners().store.inspect().disposed, true, `${operation} attempts store cleanup after renderer failure`);
    if (operation === 'reset') c.ok(host.bridge.apply({ type: 'reset', epoch: '0000000000000003' }), 'second reset recovers renderer cleanup failure');
    dispose(host);
  }
  for (const operation of ['reset', 'dispose']) {
    host = make(); seed(host); tracked.throwAfterOnce('deleteBuffer');
    const result = operation === 'reset' ? host.bridge.apply({ type: 'reset', epoch: '0000000000000002' }) : host.bridge.dispose();
    c.bad(result, `trusted ${operation} store cleanup failure`, 'bridge-poisoned');
    c.equal(host.bridge.inspect().poisoned, true, `${operation} store cleanup retains poison`);
    if (operation === 'reset') c.ok(host.bridge.apply({ type: 'reset', epoch: '0000000000000003' }), 'second reset recovers store cleanup failure');
    dispose(host);
  }
  host = make(); tracked.failOnce('createVertexArray');
  c.bad(host.bridge.apply({ type: 'reset', epoch: '0000000000000002' }), 'trusted reset replacement allocation failure', 'bridge-poisoned');
  c.equal(host.bridge.inspect().poisoned, true, 'failed reset replacement stays poisoned');
  c.ok(host.bridge.apply({ type: 'reset', epoch: '0000000000000003' }), 'reset replacement allocation recovery'); dispose(host);
}

export async function runBrowserAcceptance({ WasmVirglControlProof, createVirglControlBridge }, options = {}) {
  const c = checker(), gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  c.truth(gl, 'actual WebGL2 context'); const tracked = trackingGL(gl), shaderBridge = await createVirglShaderBridge();
  const host = c.ok(createVirglControlBridge({ gl: tracked.gl, shaderBridge }), 'create actual control bridge');
  const { bridge, probes } = host, events = [], callbackCommits = []; let intercept = null, q;
  const callback = (event) => {
    events.push(structuredClone(event));
    if (intercept) { const action = intercept; intercept = null; return action(event); }
    const result = bridge.apply(event);
    if (result.ok) {
      const owners = probes.owners();
      callbackCommits.push({ type: event.type, epoch: event.epoch, liveGL: tracked.counts(),
        rendererContextIds: owners.renderer.inspect().contexts.map((v) => v.id),
        resourceIds: owners.store.inspect().resources.map((v) => v.id) });
    }
    return result;
  };
  const owners = () => probes.owners();
  const expect = (label, request, expected = OK, portable = false) => q.expect(label, request, expected, portable);
  const unchanged = (label, request, expected) => {
    const state = q.vm.inspect(), before = json(bridge.inspect()), calls = events.length, allocations = tracked.counts();
    expect(label, request, expected); c.equal(hex(q.vm.inspect().canonicalBytes), hex(state.canonicalBytes), `${label} transport atomic`);
    c.equal(json(bridge.inspect()), before, `${label} host owners atomic`); c.equal(events.length, calls, `${label} validation precedes callback`);
    c.same(tracked.counts(), allocations, `${label} GL allocation atomic`); c.attacks.push({ name: label, code: expected });
  };
  const rejectHost = (event, label, code) => { const before = json(bridge.inspect()); c.bad(bridge.apply(event), label, code); c.equal(json(bridge.inspect()), before, `${label} owners unchanged`); };
  const lease = (id, role) => c.ok(owners().store.retainStorage(2, id, role), `retain ${id}`).lease;
  const storage = (token) => c.ok(owners().bindings.resolve(token), 'resolve actual allocation').storage;
  const allRecords = [], portability = [];
  try {
    // Production-default constructor does not advertise or accept 3D, even in the proof build.
    const ordinaryCalls = []; const ordinary = new Queue(WasmVirglControlProof, (e) => { ordinaryCalls.push(e); return { ok: true }; }, c, false, false);
    ordinary.vm.writeMmio(0x14, 0); c.equal(ordinary.vm.readMmio(0x10) & 1, 0, 'production VIRGL feature disabled'); c.equal(ordinary.vm.readMmio(0x10c), 0, 'production capsets zero');
    ordinary.expect('default-context-disabled', context(2), UNSPEC); c.equal(ordinaryCalls.length, 0, 'default command never enters callback'); c.equal(ordinary.vm.inspect(), null, 'default has no proof state'); allRecords.push(...ordinary.records); ordinary.dispose();

    q = new Queue(WasmVirglControlProof, callback, c, true, false); q.portableRecords = [];
    q.vm.writeMmio(0x14, 0); c.equal(q.vm.readMmio(0x10) & 1, 1, 'explicit proof advertises VIRGL'); c.equal(q.vm.readMmio(0x10c), 0, 'proof capsets remain zero');
    unchanged('unnegotiated-context-disabled', context(2), UNSPEC); q.dispose(); allRecords.push(...q.records);
    // Exact ordered native portable fixture starts from a fresh queue, epoch and generation.
    q = new Queue(WasmVirglControlProof, callback, c); q.portableRecords = [];
    const p = (label, request, expected = OK) => expect(label, request, expected, true);
    p('portable-context-create', context(2));
    c.truth(callbackCommits.at(-1).rendererContextIds.includes(2), 'actual renderer context');
    c.truth(owners().renderer.inspect().contexts.some((v) => v.id === 2), 'actual renderer context remains live after OK');
    for (const args of [[3, 0, 64, 16, 64, 1], [4, 0, 64, 32, 12, 1], [5, 2, 67, 10, 32, 32], [6, 2, 67, 10, 2, 2], [7, 0, 64, 524288, 1048576, 1]]) {
      const before = tracked.created(); p('portable-resource-create', resource(...args));
      c.truth(callbackCommits.at(-1).resourceIds.includes(args[0]), 'actual resource allocation before OK');
      if (args[0] === 7) c.same(tracked.created(), before, 'CPU staging resource creates zero GL objects');
    }
    const pattern = Uint8Array.from({ length: 64 }, (_, i) => i ^ 0x5a);
    q.write(q.backing, pattern.subarray(0, 7)); q.write(q.backing2, pattern.subarray(7));
    p('portable-backing-split', backing(3, [[q.backing, 7], [q.backing2, 57]]));
    const saved = structuredClone(events.at(-1)); c.same(saved.segments.map((s) => [s.address, s.length]), [[address(q.backing), 7], [address(q.backing2), 57]], 'ordered SG callback metadata');
    c.same(saved.segments.flatMap((s) => [...s.data]), [...pattern], 'independent owned SG bytes');
    q.write(q.backing, new Uint8Array(7).fill(255)); c.same(events.at(-1), saved, 'callback bytes survive guest RAM mutation');
    c.same([...c.ok(owners().store.readBacking(3, 0, 64), 'read actual attached backing').bytes], [...pattern], 'renderer backing owns initial SG copy');
    for (let id = 3; id <= 7; id++) p('portable-context-attach', idCommand(0x202, 2, id));
    const vertexLease = lease(3, 'vertex'), indexLease = lease(4, 'index'), surfaceLease = lease(5, 'surface');
    const vertex = storage(vertexLease).buffer, index = storage(indexLease).buffer, texture = storage(surfaceLease).texture;
    c.truth(gl.isBuffer(vertex), 'actual GL vertex buffer'); c.truth(gl.isBuffer(index), 'actual GL index buffer'); c.truth(gl.isTexture(texture), 'actual GL texture');
    c.ok(owners().store.releaseStorage(vertexLease), 'release vertex proof lease'); c.ok(owners().store.releaseStorage(indexLease), 'release index proof lease'); c.ok(owners().store.releaseStorage(surfaceLease), 'release surface proof lease');
    p('duplicate-context-attach', idCommand(0x202, 2, 3), BAD_PARAMETER); p('duplicate-backing-attach', backing(3, [[q.backing, 7]]), BAD_PARAMETER);
    const oldResource = q.vm.inspect().resources.find((v) => v.identity.id === 3).identity;
    p('portable-resource-unref', idCommand(0x102, 0, 3)); c.equal(gl.isBuffer(vertex), false, 'unref deletes unretained actual buffer');
    p('portable-resource-reuse', resource(3, 0, 64, 16, 64, 1)); c.truth(q.vm.inspect().resources.find((v) => v.identity.id === 3).identity.generation !== oldResource.generation, 'reused ID changes transport generation');
    p('old-membership-does-not-attach-new-resource', idCommand(0x203, 2, 3), BAD_PARAMETER); p('fresh-membership', idCommand(0x202, 2, 3));
    p('destroy-context-with-resources', header(0x201, 2, 24)); c.equal(q.vm.inspect().resources.length, 5, 'context destruction retains public resources');
    p('context-id-reuse', context(2)); p('old-context-membership-gone', idCommand(0x203, 2, 4), BAD_PARAMETER);
    for (let id = 3; id <= 7; id++) p('portable-final-unref', idCommand(0x102, 0, id)); p('portable-final-context-destroy', header(0x201, 2, 24));
    c.same([q.vm.inspect().logicalBytes, q.vm.inspect().gpuBytes, q.vm.inspect().backingBytes], [0, 0, 0], 'portable final transport zero budgets');
    portability.push(...q.portableRecords);

    // Structural guest attacks share the actual queue and recover with valid commands.
    for (const opcode of [0x205, 0x206, 0x207, 0x108, 0x109]) unchanged('later-command-disabled', header(opcode, 0, 32), UNSPEC);
    for (const [offset, value] of [[24, 65], [28, 1], [4, 1], [20, 1], [21, 1]]) { const bytes = context(2); bytes[offset] = value; unchanged(`invalid-context-field-${offset}`, bytes, BAD_PARAMETER); }
    for (const length of [24, 25, 31, 32, 95]) unchanged(`short-context-${length}`, context(2).slice(0, length), BAD_PARAMETER);
    for (let capacity = 1; capacity < 24; capacity++) {
      const before = hex(q.vm.inspect().canonicalBytes), calls = events.length, result = q.submit(context(2), [96], [capacity]);
      c.equal(result.usedLength, 0, `short reply ${capacity} zero used length`); c.same([...q.read(q.response, 64)], new Array(64).fill(165), `short reply ${capacity} no bytes written`);
      c.equal(hex(q.vm.inspect().canonicalBytes), before, `short reply ${capacity} no transport change`); c.equal(events.length, calls, `short reply ${capacity} no renderer callback`);
    }
    const split = q.submit(context(2), [3, 22, 14, 57], [7, 17]); c.equal(hex(split.response), hex(response(context(2), OK)), 'split header and response whole wire oracle'); c.equal(split.usedLength, 24, 'split complete reply');
    expect('attack-buffer-create', resource(3, 0, 64, 16, 64, 1)); expect('attack-resource-attach', idCommand(0x202, 2, 3));
    for (const entries of [[], [[q.backing, 0]], [[0xffffffffffffffffn, 4]], [[q.base - 1n, 4]], [[q.base + 4194304n - 2n, 4]], [[BigInt('0x' + q.layout.gpuBase), 4]], [[q.backing, 4], [q.base + 4194304n, 1]]]) unchanged('invalid-SG-range', backing(3, entries), BAD_PARAMETER);
    const shortList = backing(3, [[q.backing, 4]]); u32(shortList, 28, 2); unchanged('short-SG-list', shortList, BAD_PARAMETER);
    const padding = backing(3, [[q.backing, 4]]); u32(padding, 44, 1); unchanged('nonzero-SG-padding', padding, BAD_PARAMETER);
    unchanged('SG-entry-budget', backing(3, Array.from({ length: 257 }, () => [q.backing, 1])), BAD_PARAMETER);
    q.write(q.backing, Uint8Array.of(4, 8, 15, 16)); expect('SG-aliases-and-short-aggregate-valid', backing(3, [[q.backing, 4], [q.backing + 1n, 3], [q.backing, 4]]));
    c.same([...c.ok(owners().store.readBacking(3, 0, 11), 'read aliases').bytes], [4, 8, 15, 16, 8, 15, 16, 4, 8, 15, 16], 'ordered aliased SG copied literally');
    expect('SG-detach', idCommand(0x107, 0, 3));

    // Actual retained GL storage outlives public name and context membership.
    expect('retained-texture-create', resource(5, 2, 67, 10, 2, 2)); expect('retained-texture-attach', idCommand(0x202, 2, 5));
    const retained = lease(5, 'surface'), oldTexture = storage(retained).texture, oldEvent = structuredClone(events.at(-1));
    expect('retained-texture-unref', idCommand(0x102, 0, 5)); c.truth(gl.isTexture(oldTexture), 'retained actual texture survives public unref'); c.bad(owners().store.retainStorage(2, 5, 'surface'), 'removed name lookup', 'missing-resource');
    c.equal(storage(retained).texture, oldTexture, 'old lease resolves exact original GPU allocation');
    expect('retained-id-recreate', resource(5, 2, 67, 10, 2, 2)); expect('retained-new-attach', idCommand(0x202, 2, 5));
    const replacement = lease(5, 'surface'), newTexture = storage(replacement).texture; c.truth(newTexture !== oldTexture && gl.isTexture(newTexture), 'reused ID allocates distinct live GL texture');
    rejectHost(oldEvent, 'stale resource generation adapter event', 'invalid-resource-id');
    expect('retained-context-destroy', header(0x201, 2, 24)); c.truth(gl.isTexture(oldTexture), 'retained texture survives context destruction');
    c.ok(owners().store.releaseStorage(retained), 'release retired texture'); c.equal(gl.isTexture(oldTexture), false, 'release deletes old actual allocation'); c.truth(gl.isTexture(newTexture), 'release does not delete replacement');
    c.ok(owners().store.releaseStorage(replacement), 'release replacement lease');

    // Real GL allocation returns are fault-controlled before publication; successful recovery uses real GL.
    const allocationFailure = (label, method, request) => {
      const before = hex(q.vm.inspect().canonicalBytes), budgets = json(owners().store.inspect().budgets), live = tracked.counts(); tracked.failOnce(method);
      expect(label, request, OOM); c.equal(hex(q.vm.inspect().canonicalBytes), before, `${label} Rust transaction rollback`);
      c.equal(json(owners().store.inspect().budgets), budgets, `${label} owner budget rollback`); c.same(tracked.counts(), live, `${label} actual partial GL objects deleted`);
      c.attacks.push({ name: label, code: 'out-of-memory', trustedFault: method }); expect(`${label}-recovery`, request);
    };
    allocationFailure('trusted-texture-allocation-failure', 'createTexture', resource(6, 2, 67, 10, 2, 2));
    allocationFailure('trusted-compound-context-allocation-failure', 'createFramebuffer', context(2));
    expect('failure-context-resource-attach', idCommand(0x202, 2, 3));
    for (const [label, request] of [['trusted-detach-failure-before-apply', idCommand(0x203, 2, 3)], ['trusted-unref-failure-before-apply', idCommand(0x102, 0, 3)], ['trusted-destroy-failure-before-apply', header(0x201, 2, 24)]]) {
      const before = hex(q.vm.inspect().canonicalBytes), hostBefore = json(bridge.inspect()); intercept = () => ({ ok: false, error: { code: 'out-of-memory', message: 'Deliberate pre-apply fault' } });
      expect(label, request, OOM); c.equal(hex(q.vm.inspect().canonicalBytes), before, `${label} transport unchanged`); c.equal(json(bridge.inspect()), hostBefore, `${label} host unchanged`); c.attacks.push({ name: label, trustedFault: true });
    }
    expect('successful-context-resource-detach', idCommand(0x203, 2, 3)); expect('successful-context-resource-reattach', idCommand(0x202, 2, 3));
    let bridgeReentrant;
    tracked.callbackOnce('createTexture', () => { bridgeReentrant = bridge.apply({ type: 'reset', epoch: '0000000000000002' }); });
    expect('reentrant-host-operation-contained', resource(8, 2, 67, 10, 2, 2)); c.bad(bridgeReentrant, 'reentrant bridge operation', 'bridge-poisoned');
    intercept = (event) => { c.throws(() => q.vm.inspect(), 'reentrant wasm inspect'); c.throws(() => q.vm.run1(), 'reentrant wasm run'); c.throws(() => q.vm.readRam(address(q.backing), 1), 'reentrant wasm RAM read'); c.throws(() => q.vm.writeRam(address(q.backing), Uint8Array.of(1)), 'reentrant wasm RAM write'); c.throws(() => q.vm.readMmio(0), 'reentrant wasm MMIO read'); c.throws(() => q.vm.writeMmio(0x14, 0), 'reentrant wasm MMIO write'); return bridge.apply(event); };
    expect('reentrant-wasm-contained', resource(9, 0, 64, 16, 8, 1));

    // Direct host events cannot substitute stale generations or malformed data.
    const currentEpoch = q.vm.inspect().epoch, currentContext = q.vm.inspect().contexts.find((v) => v.identity.id === 2).identity;
    const metadata = { ...events.find((v) => v.type === 'createResource').metadata, id: 77 };
    const identity77 = { id: 77, generation: '000000000000ffff' };
    for (const [label, event, code] of [
      ['null host event', null, 'invalid-parameter'], ['array host event', [], 'invalid-parameter'],
      ['unknown host operation', { type: 'submit', epoch: currentEpoch }, 'invalid-parameter'],
      ['unknown host field', { type: 'destroyContext', epoch: currentEpoch, context: currentContext, extra: 1 }, 'invalid-parameter'],
      ['zero host identity', { type: 'destroyContext', epoch: currentEpoch, context: { id: 0, generation: currentContext.generation } }, 'invalid-parameter'],
      ['malformed full-width identity', { type: 'destroyContext', epoch: currentEpoch, context: { id: 2, generation: '00000000000000AF' } }, 'invalid-parameter'],
      ['stale context generation', { type: 'destroyContext', epoch: currentEpoch, context: { id: 2, generation: '0000000000000001' } }, 'invalid-context-id'],
      ['duplicate context identity', { type: 'createContext', epoch: currentEpoch, context: currentContext, debugName: new Uint8Array() }, 'invalid-context-id'],
      ['oversized debug name', { type: 'createContext', epoch: currentEpoch, context: identity77, debugName: new Uint8Array(65) }, 'invalid-parameter'],
      ['metadata identity mismatch', { type: 'createResource', epoch: currentEpoch, resource: identity77, metadata: { ...metadata, id: 78 } }, 'invalid-parameter'],
      ['metadata unknown field', { type: 'createResource', epoch: currentEpoch, resource: identity77, metadata: { ...metadata, extra: 0 } }, 'invalid-parameter'],
      ['resource invalid tuple', { type: 'createResource', epoch: currentEpoch, resource: identity77, metadata: { ...metadata, format: 66 } }, 'invalid-parameter'],
      ['host reset skips epoch', { type: 'reset', epoch: address(BigInt('0x' + currentEpoch) + 2n) }, 'invalid-parameter'],
    ]) rejectHost(event, label, code);
    let eventGetterCalled = false;
    rejectHost({ get type() { eventGetterCalled = true; return 'destroyContext'; }, epoch: currentEpoch, context: currentContext }, 'event accessor rejected', 'invalid-parameter');
    c.equal(eventGetterCalled, false, 'event accessors never invoked');
    // Every nonfatal callback error mapping preserves both transaction owners.
    for (const [code, wire] of [['invalid-context-id', BAD_CONTEXT], ['invalid-resource-id', BAD_RESOURCE], ['invalid-parameter', BAD_PARAMETER], ['out-of-memory', OOM], ['unspecified', UNSPEC]]) {
      const before = hex(q.vm.inspect().canonicalBytes), hostBefore = json(bridge.inspect());
      intercept = () => ({ ok: false, error: { code, message: 'Deliberate structured pre-apply failure' } });
      expect(`callback-structured-${code}`, resource(11, 0, 64, 16, 8, 1), wire);
      c.equal(hex(q.vm.inspect().canonicalBytes), before, `${code} transport failure atomic`); c.equal(json(bridge.inspect()), hostBefore, `${code} host failure atomic`);
      c.equal(q.vm.inspect().poisoned, false, `${code} remains recoverable`); c.attacks.push({ name: `callback-structured-${code}`, trustedFault: true });
    }
    expect('structured-error-resource-recovery', resource(11, 0, 64, 16, 8, 1)); expect('structured-error-resource-cleanup', idCommand(0x102, 0, 11));

    // Callback exceptions/malformed returns poison transport until reset. No claim of host rollback after a throw.
    for (const mode of ['throw', 'promise', 'accessor', 'error-accessor', 'message-accessor', 'revoked-proxy', 'inherited-then', 'own-then-getter', 'null', 'primitive', 'array', 'wrong-ok', 'missing-error-message', 'nonstring-error-message', 'error-array', 'unknown-error', 'extra-success-key', 'symbol-key', 'explicit-poison']) {
      let responseGetterCalled = false;
      intercept = (event) => {
        if (mode === 'throw') { c.ok(bridge.apply(event), 'host mutation before injected throw'); throw new Error('Deliberate host throw after apply'); }
        if (mode === 'promise') return Promise.resolve({ ok: true });
        if (mode === 'accessor') return { get ok() { responseGetterCalled = true; return true; } };
        if (mode === 'error-accessor') return { ok: false, get error() { responseGetterCalled = true; return {}; } };
        if (mode === 'message-accessor') return { ok: false, error: { code: 'unspecified', get message() { responseGetterCalled = true; return ''; } } };
        if (mode === 'revoked-proxy') { const proxy = Proxy.revocable({}, {}); proxy.revoke(); return proxy.proxy; }
        if (mode === 'inherited-then') return Object.assign(Object.create({ then() {} }), { ok: true });
        if (mode === 'own-then-getter') return { ok: true, get then() { responseGetterCalled = true; return () => {}; } };
        if (mode === 'null') return null;
        if (mode === 'primitive') return 1;
        if (mode === 'array') return [];
        if (mode === 'wrong-ok') return { ok: 0, error: { code: 'unspecified', message: '' } };
        if (mode === 'missing-error-message') return { ok: false, error: { code: 'unspecified', other: '' } };
        if (mode === 'nonstring-error-message') return { ok: false, error: { code: 'unspecified', message: 1 } };
        if (mode === 'error-array') return { ok: false, error: [] };
        if (mode === 'symbol-key') return { ok: true, [Symbol('extra')]: 1 };
        if (mode === 'explicit-poison') return { ok: false, error: { code: 'bridge-poisoned', message: 'Deliberate poison' } };
        if (mode === 'unknown-error') return { ok: false, error: { code: 'made-up', message: 'bad return' } };
        return { ok: true, extra: true };
      };
      const oldEpoch = q.vm.inspect().epoch; expect(`callback-${mode}-fails-closed`, resource(10, 0, 64, 16, 8, 1), UNSPEC);
      c.equal(responseGetterCalled, false, `${mode} response getters never invoked`); c.equal(q.vm.inspect().poisoned, true, `${mode} transport poisoned`); const calls = events.length; expect('poisoned-command-blocked', context(3), UNSPEC); c.equal(events.length, calls, 'poisoned transport invokes no callback');
      c.attacks.push({ name: `callback-${mode}`, code: 'bridge-poisoned', trustedFault: true }); q.reset();
      c.equal(q.vm.inspect().poisoned, false, 'reset clears transport poison'); c.equal(q.vm.inspect().epoch, address(BigInt('0x' + oldEpoch) + 1n), 'reset advances epoch once');
      c.equal(bridge.inspect().epoch, q.vm.inspect().epoch, 'reset epochs align across wasm and renderer'); c.equal(owners().store.inspect().resources.length, 0, 'reset clears current and retired storage');
      rejectHost({ type: 'destroyContext', epoch: oldEpoch, context: { id: 2, generation: '0000000000000001' } }, 'old epoch host event', 'invalid-parameter');
      expect('reset-valid-context-recovery', context(2)); expect('reset-context-cleanup', header(0x201, 2, 24));
    }
    // Default 2D namespace/fence semantics remain active on the same queue.
    const twoD = header(0x101, 0, 40); [3, 67, 2, 2].forEach((v, i) => u32(twoD, 24 + i * 4, v)); u32(twoD, 4, 1); u64(twoD, 8, 0x1122334455667788n);
    expect('2D-fenced-create-preserved', twoD); unchanged('3D-cannot-steal-2D-id', resource(3, 0, 64, 16, 64, 1), BAD_RESOURCE);
    expect('2D-unref', idCommand(0x102, 0, 3)); expect('3D-reuse-after-2D-unref', resource(3, 0, 64, 16, 64, 1));
    expect('2D-cannot-steal-3D-id', twoD, BAD_RESOURCE); expect('final-resource-unref', idCommand(0x102, 0, 3));
    for (const [label, operation] of [['uppercase-address', () => q.vm.readRam('000000008000000A', 1)], ['short-address', () => q.vm.readRam('80000000', 1)], ['RAM-boundary', () => q.vm.readRam(address(q.base + 4194303n), 2)], ['unaligned-MMIO', () => q.vm.readMmio(1)], ['outside-MMIO', () => q.vm.writeMmio(4096, 1)]]) c.throws(operation, label);
    c.equal(q.vm.inspect().contexts.length, 0, 'final transport contexts empty'); c.equal(q.vm.inspect().resources.length, 0, 'final transport resources empty');
    allRecords.push(...q.records); q.dispose(); q = null;
    c.ok(bridge.dispose(), 'dispose adapter'); c.ok(bridge.dispose(), 'idempotent adapter disposal');
    c.same(tracked.counts(), { Buffer: 0, Texture: 0, VertexArray: 0, Framebuffer: 0, Shader: 0, Program: 0, Sampler: 0 }, 'all real GL allocations released');
    c.bad(bridge.apply({ type: 'reset', epoch: '00000000000000ff' }), 'disposed adapter fails closed', 'bridge-poisoned');
    isolatedHostFaults(createVirglControlBridge, tracked, shaderBridge, c);
    c.equal(gl.getError(), gl.NO_ERROR, 'zero actual WebGL errors');
    const summary = { assertions: c.assertions, attacks: c.attacks.length, portableCommands: portability.length, totalCommands: allRecords.length, actualGLAllocations: tracked.created(), finalLiveGL: tracked.counts() };
    return { status: 'passed', guestExecution: false, controlPlaneReplay: true, summary, assertions: c.assertions, attacks: c.attacks, portableRecords: portability, records: allRecords, callbackCommits,
      scope: 'Actual wasm guest RAM/MMIO and Machine service boundary into WebGL2 resource/state owners; no 3D submissions, transfers, fences or Linux guest workload.', options: { ...options } };
  } finally { if (q) q.dispose(); bridge.dispose(); }
}
