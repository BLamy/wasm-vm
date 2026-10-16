// Independent verifier byte oracle. Expected pixels use only literal rectangle
// coordinates/row loops; no implementation layout function is imported.
import { createResourceStore, createWebGL2TransferBackend } from '/renderer/virgl-command/resources.mjs';
export function runResourceAttack(gl) {
  let assertions = 0;
  const equal = (a, b, label) => { assertions++; if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(label + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
  const ok = (r, label) => { equal(r.ok, true, label); return r; };
  const bad = (r, code, label) => { equal(r.ok, false, label); equal(r.error.code, code, label + ' code'); };
  const bytes = (a, b, label) => equal(Array.from(a), Array.from(b), label);
  const base = { depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 };
  const texture = (id, width, height) => ({ id, target: 2, format: 67, bind: 10, width, height, ...base });
  const staging = (id, width) => ({ id, target: 0, format: 64, bind: 524288, width, height: 1, ...base });
  const split = (data) => { const out = [new Uint8Array(0)]; for (let i = 0; i < data.length;) { const n = 1 + (i % 5); out.push(data.slice(i, i + n)); i += n; if ((i % 3) === 0) out.push(new Uint8Array(0)); } return out; };
  const allocations = new Map();
  const real = ok(createWebGL2TransferBackend(gl), 'backend').backend;
  let uploadCalls = 0, readCalls = 0;
  const backend = { ...real, allocate(meta) { const storage = real.allocate(meta); allocations.set(meta.id, storage); return storage; }, upload(...args) { uploadCalls++; return real.upload(...args); }, readback(...args) { readCalls++; return real.readback(...args); } };
  const store = ok(createResourceStore({ backend }), 'store').store;
  const other = ok(createResourceStore({ backend: { maxTextureSize: 16, allocate() { return {}; }, destroy() {}, upload() {}, readback() { return new Uint8Array(0); }, dispose() {} } }), 'foreign store').store;
  ok(store.createContext(1), 'context');
  const directRead = (id, w, h) => {
    const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, allocations.get(id).texture, 0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'direct framebuffer complete');
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    for (const p of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS]) gl.pixelStorei(p, 0);
    const data = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.deleteFramebuffer(framebuffer);
    equal(gl.getError(), gl.NO_ERROR, 'direct GPU error'); return data;
  };
  const seeds = [0xd00dfeed, 0x31415926, 0x9e3779b9];
  const records = [];
  for (const seed of seeds) {
    let state = seed >>> 0;
    const random = (n) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
    for (let i = 0; i < 24; i++) {
      const w = 1 + random(6), h = 1 + random(5), x = random(w), y = random(h), rw = 1 + random(w - x), rh = 1 + random(h - y);
      const useDefault = i % 3 === 0, rowStride = useDefault ? w * 4 : rw * 4 + random(7), offset = random(6);
      const end = offset + (rh - 1) * rowStride + rw * 4, source = new Uint8Array(end + 3).fill(0xa6), expected = new Uint8Array(w * h * 4);
      for (let row = 0; row < rh; row++) for (let column = 0; column < rw; column++) for (let c = 0; c < 4; c++) {
        const value = random(256); source[offset + row * rowStride + column * 4 + c] = value;
        expected[((row + y) * w + column + x) * 4 + c] = value;
      }
      ok(store.createResource(texture(11, w, h)), 'texture allocation'); ok(store.attachContext(1, 11), 'texture attachment');
      ok(store.createResource(staging(12, source.length)), 'staging'); ok(store.attachContext(1, 12), 'staging attachment');
      ok(store.attachBacking(11, split(source)), 'texture backing'); ok(store.attachBacking(12, split(source)), 'staging backing');
      const copy = i % 2 === 0, common = { resourceHandle: 11, level: 0, usage: 0, stride: useDefault ? 0 : rowStride, layerStride: 0, box: { x, y, z: 0, width: rw, height: rh, depth: 1 } };
      const cmd = (read) => copy ? { opcode: 45, fields: { ...common, stagingResourceHandle: 12, stagingOffset: offset, flags: read ? 3 : 1 } } : { opcode: 43, fields: { ...common, dataOffset: offset, direction: read ? 2 : 1 } };
      const sourceId = copy ? 12 : 11, prepared = ok(store.prepareTransfer(1, cmd(false)), 'prepare independent rectangle');
      bad(other.executeTransfer(prepared.ticket), 'invalid-ticket', 'foreign ticket rejected');
      ok(store.writeBacking(sourceId, 0, new Uint8Array(source.length).fill(0xf1)), 'mutate backing after snapshot');
      ok(store.executeTransfer(prepared.ticket), 'upload independent rectangle');
      bytes(directRead(11, w, h), expected, 'direct GPU rectangle oracle');
      bad(store.cancelTransfer(prepared.ticket), 'invalid-ticket', 'consumed ticket cannot cancel');
      const guard = new Uint8Array(source.length).fill(0x73), readExpected = guard.slice();
      for (let row = 0; row < rh; row++) for (let column = 0; column < rw * 4; column++) readExpected[offset + row * rowStride + column] = source[offset + row * rowStride + column];
      ok(store.writeBacking(sourceId, 0, guard), 'readback guard');
      ok(store.executeTransfer(ok(store.prepareTransfer(1, cmd(true)), 'prepare read').ticket), 'execute read');
      bytes(ok(store.readBacking(sourceId, 0, guard.length), 'read all guard bytes').bytes, readExpected, 'independent scatter and guards');
      const stale = ok(store.prepareTransfer(1, cmd(false)), 'prepare revoked ticket').ticket, beforeCalls = [uploadCalls, readCalls];
      ok(store.detachContext(1, sourceId), 'revoke membership'); ok(store.attachContext(1, sourceId), 'restore numeric identity');
      bad(store.executeTransfer(stale), 'stale-ticket', 'revoked membership rejected'); equal([uploadCalls, readCalls], beforeCalls, 'revocation rejects before GPU call');
      const lease = ok(store.retainStorage(1, 11), 'retain actual texture').lease;
      bad(other.readStorage(lease), 'invalid-lease', 'foreign lease rejected');
      const old = allocations.get(11); ok(store.unref(11), 'public unref');
      equal(gl.isTexture(old.texture), true, 'lease holds actual texture'); bytes(directRead(11, w, h), expected, 'unref preserves texture bytes');
      ok(store.releaseStorage(lease), 'release texture'); equal(gl.isTexture(old.texture), false, 'lease release deletes actual texture');
      ok(store.unref(12), 'staging unref');
      const budgets = ok(store.inspect(), 'inspect case cleanup').budgets;
      for (const [key, value] of Object.entries(budgets)) if (key !== 'contexts') equal(value, 0, 'case cleanup ' + key);
      records.push({ seed, i, w, h, x, y, rw, rh, rowStride, offset, sourceBytes: source.length, directionPair: copy ? 'COPY_TRANSFER3D' : 'TRANSFER3D', directGpuBytes: expected.length });
    }
  }
  ok(store.dispose(), 'dispose'); ok(other.dispose(), 'dispose foreign');
  for (const [key, value] of Object.entries(ok(store.inspect(), 'final budgets').budgets)) equal(value, 0, 'final ' + key);
  const sweep = ok(createWebGL2TransferBackend(gl), 'direct backend sweep').backend;
  const sweepTexture = sweep.allocate({ ...texture(90, 2, 2), kind: 'texture', byteLength: 16 });
  const sweepBuffer = sweep.allocate({ ...staging(91, 8), bind: 16, kind: 'vertex-buffer', byteLength: 8 });
  equal(gl.isTexture(sweepTexture.texture), true, 'direct live texture'); equal(gl.isBuffer(sweepBuffer.buffer), true, 'direct live buffer');
  sweep.dispose(); equal(gl.isTexture(sweepTexture.texture), false, 'direct sweep deletes texture'); equal(gl.isBuffer(sweepBuffer.buffer), false, 'direct sweep deletes buffer');
  const initializerFault = new Proxy(gl, { get(target, key) { const value = Reflect.get(target, key, target); if (key === 'getParameter') return () => { throw new Error('verifier injected generic initializer exception'); }; return typeof value === 'function' ? value.bind(target) : value; } });
  bad(createWebGL2TransferBackend(initializerFault), 'backend-error', 'generic initializer exception cleanup'); equal(gl.getError(), gl.NO_ERROR, 'initializer cleanup GL errors');
  const defensive = ok(createResourceStore({ backend: { maxTextureSize: 16, allocate() { return {}; }, destroy() {}, upload() {}, readback() { return new Uint8Array(0); }, dispose() {} } }), 'defensive input store').store;
  bad(defensive.createResource(null), 'invalid-input', 'null metadata ResourceFault rethrow');
  ok(defensive.createResource(staging(1, 8)), 'defensive staging'); bad(defensive.attachBacking(1, null), 'invalid-input', 'nonarray backing ResourceFault rethrow');
  ok(defensive.createContext(1), 'allocation fault context'); ok(defensive.createResource({ ...staging(2, 8), bind: 16 }), 'allocation fault buffer');
  ok(defensive.attachContext(1, 2), 'allocation fault membership'); ok(defensive.attachBacking(2, [new Uint8Array(8)]), 'allocation fault backing');
  const actualUint8Array = globalThis.Uint8Array, allocationFault = new RangeError('verifier injected gather allocation failure'); let allocationPropagated = false;
  try {
    globalThis.Uint8Array = new Proxy(actualUint8Array, { construct() { throw allocationFault; } });
    defensive.prepareTransfer(1, { opcode: 43, fields: { resourceHandle: 2, level: 0, usage: 0, stride: 0, layerStride: 0, box: { x: 0, y: 0, z: 0, width: 8, height: 1, depth: 1 }, dataOffset: 0, direction: 1 } });
  } catch (error) { allocationPropagated = error === allocationFault; }
  finally { globalThis.Uint8Array = actualUint8Array; }
  equal(allocationPropagated, true, 'gather allocation exception propagates');
  const failedPrepareState = defensive.inspect(); equal(failedPrepareState.budgets.scratchBytes, 0, 'gather failure returns reserved scratch'); equal(failedPrepareState.budgets.tickets, 0, 'gather failure publishes no ticket');
  equal(failedPrepareState.resources.find((r) => r.id === 2).references, 0, 'gather failure retains no resource');
  ok(defensive.dispose(), 'defensive disposal');
  const sentinel = new Error('verifier programmer exception'); let propagated = false;
  try { createResourceStore({ backend: { get allocate() { throw sentinel; } } }); } catch (error) { propagated = error === sentinel; }
  equal(propagated, true, 'unexpected trusted programmer defect propagates');
  return { status: 'passed', assertions, records, seeds, uploadCalls, readCalls, gpuOracle: 'direct framebuffer readPixels of retained GL allocation', finalBudgets: store.inspect().budgets,
    defensiveCoverage: ['direct live allocation disposal', 'generic GL initialization exception', 'invalid null record', 'invalid nonarray backing', 'trusted programmer exception propagation', 'trusted gather allocation fault releases reserved scratch without ticket publication'] };
}
