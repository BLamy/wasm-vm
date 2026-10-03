// Portable worker acceptance: deterministic CPU boundary checks plus real WebGL2
// readback. The browser oracle reads allocated GL objects, never a CPU shadow.
import { decodeSubmission } from "../decoder.mjs";
import { computeTransferLayout, createResourceStore, createWebGL2TransferBackend } from "../resources.mjs";

const VERTEX_BYTES = [
  0, 0, 128, 191, 0, 0, 128, 191, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 128, 63, 0, 0, 128, 191, 0, 0, 128, 63, 0, 0, 0, 0,
  0, 0, 128, 191, 0, 0, 128, 63, 0, 0, 0, 0, 0, 0, 128, 63,
  0, 0, 128, 63, 0, 0, 128, 63, 0, 0, 128, 63, 0, 0, 128, 63,
];
const INDEX_BYTES = [0, 0, 1, 0, 2, 0, 2, 0, 1, 0, 3, 0];
const TEXTURE_BYTES = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255];
const DEFAULT_SEEDS = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344];
const baseMeta = { target: 0, format: 64, bind: 16, width: 64, height: 1,
  depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 };
const bufferMeta = (id, width = 64, bind = 16) => ({ id, ...baseMeta, width, bind });
const textureMeta = (id, width = 4, height = 3) => ({ id, ...baseMeta, target: 2, format: 67, bind: 10, width, height });
const box = (x, y, width, height = 1) => ({ x, y, z: 0, width, height, depth: 1 });
const transfer = (id, region, dataOffset = 0, direction = 1, stride = 0, layerStride = 0) => ({
  opcode: 43, name: "TRANSFER3D", objectType: 0, objectName: "NULL", byteOffset: 0, byteLength: 56,
  payloadDwords: 13, fields: { resourceHandle: id, level: 0, usage: 0, stride, layerStride, box: region, dataOffset, direction },
});
const copyTransfer = (id, stagingId, region, stagingOffset = 0, flags = 1, stride = 0, layerStride = 0) => ({
  opcode: 45, name: "COPY_TRANSFER3D", objectType: 0, objectName: "NULL", byteOffset: 0, byteLength: 60,
  payloadDwords: 14, fields: { resourceHandle: id, level: 0, usage: 0, stride, layerStride, box: region,
    stagingResourceHandle: stagingId, stagingOffset, flags, synchronized: Boolean(flags & 1), readFromHost: Boolean(flags & 2) },
});

function checks() {
  let assertions = 0;
  const cases = [];
  const equal = (actual, expected, label) => {
    assertions++;
    if (!Object.is(actual, expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const truth = (value, label) => equal(Boolean(value), true, label);
  const same = (actual, expected, label) => equal(JSON.stringify(actual), JSON.stringify(expected), label);
  const bytes = (actual, expected, label) => {
    equal(actual.length, expected.length, `${label} length`);
    for (let i = 0; i < expected.length; i++) equal(actual[i], expected[i], `${label} byte ${i}`);
  };
  const ok = (result, label) => {
    equal(result?.ok, true, `${label} (${result?.error?.code ?? ""}: ${result?.error?.message ?? ""})`);
    return result;
  };
  const bad = (result, label, record = true) => {
    equal(result?.ok, false, `${label} rejected`);
    same(Object.keys(result).sort(), ["error", "ok"], `${label} no partial success`);
    truth(typeof result.error.code === "string" && result.error.code.length > 0, `${label} structured code`);
    truth(typeof result.error.message === "string" && result.error.message.length > 0, `${label} diagnostic`);
    if (record) cases.push({ name: label, code: result.error.code });
    return result;
  };
  return { equal, truth, same, bytes, ok, bad, cases, get assertions() { return assertions; } };
}

function memoryBackend() {
  const live = new Map();
  const statistics = { allocations: 0, destructions: 0, uploads: 0, readbacks: 0 };
  const control = { failAllocate: false, failUpload: false, failReadback: false, shortReadback: false,
    failDestroy: false, failDispose: false };
  const backend = {
    maxTextureSize: 16384,
    allocate(meta) {
      if (control.failAllocate) throw new Error("injected allocation failure");
      const storage = { kind: meta.target === 2 ? "texture" : "buffer" };
      live.set(storage, new Uint8Array(meta.target === 2 ? meta.width * meta.height * 4 : meta.width));
      statistics.allocations++;
      return storage;
    },
    destroy(storage) {
      if (control.failDestroy) throw new Error("injected destroy failure");
      if (live.delete(storage)) statistics.destructions++;
    },
    upload(storage, meta, layout, tight) {
      if (control.failUpload) throw new Error("injected upload failure");
      const destination = live.get(storage);
      for (let row = 0; row < layout.rowCount; row++) {
        const start = meta.target === 2 ? ((layout.box.y + row) * meta.width + layout.box.x) * 4 : layout.box.x;
        destination.set(tight.subarray(row * layout.rowBytes, (row + 1) * layout.rowBytes), start);
      }
      statistics.uploads++;
    },
    readback(storage, meta, layout) {
      if (control.failReadback) throw new Error("injected readback failure");
      if (control.shortReadback) return new Uint8Array(Math.max(0, layout.tightBytes - 1));
      const source = live.get(storage), result = new Uint8Array(layout.tightBytes);
      for (let row = 0; row < layout.rowCount; row++) {
        const start = meta.target === 2 ? ((layout.box.y + row) * meta.width + layout.box.x) * 4 : layout.box.x;
        result.set(source.subarray(start, start + layout.rowBytes), row * layout.rowBytes);
      }
      statistics.readbacks++;
      return result;
    },
    dispose() { if (control.failDispose) throw new Error("injected dispose failure"); },
  };
  return { backend, live, statistics, control };
}

function fullCleanup(store, c, label) {
  c.ok(store.dispose(), `${label} dispose`);
  const state = c.ok(store.inspect(), `${label} inspect disposed`);
  for (const [key, value] of Object.entries(state.budgets)) c.equal(value, 0, `${label} final ${key}`);
  return state.budgets;
}

function fixtureMetadata(fixtures, c) {
  c.equal(fixtures.resources.length, 5, "original resource count");
  const expected = [bufferMeta(3, 64, 16), bufferMeta(4, 12, 32), textureMeta(5, 32, 32),
    textureMeta(6, 2, 2), bufferMeta(7, 1048576, 524288)];
  for (const [i, meta] of expected.entries()) c.same(fixtures.resources[i], meta, `original resource ${meta.id} metadata`);
  const sources = [
    [156, 3, "f5eeb6294d3e81fcce432bf79250004844f5597b62ba7c1843780c14a3dec751", 4096, 64],
    [157, 4, "3fa8bf0940bec2c126815596ab68436434c8acc27d52289d182b06f52c4165ab", 4096, 12],
    [160, 7, "da1741f5aaf544e3609af2515998cdf6673735dd64691c22ea78a1d8efbfb50f", 1048576, 16],
  ];
  for (const [event, id, hash, size, selected] of sources) {
    const backing = fixtures.backing.find((entry) => entry.resourceId === id);
    c.equal(backing.event, event, `input resource ${id} source event`);
    c.equal(backing.sourceSha256, hash, `input resource ${id} source hash`);
    c.equal(backing.iovLengths.reduce((a, b) => a + b, 0), size, `input resource ${id} backing length`);
    c.equal(backing.ranges.length, 1, `input resource ${id} selected range`);
    c.equal(backing.ranges[0].offset, 0, `input resource ${id} selected offset`);
    c.equal(backing.ranges[0].data.length, selected, `input resource ${id} selected length`);
  }
  return sources.map(([event, resourceId, sourceSha256, backingBytes, bytes]) =>
    ({ event, resourceId, sourceSha256, backingBytes, offset: 0, bytes }));
}

export function runNativeAcceptance(fixtures, options = {}) {
  const c = checks(), sources = fixtureMetadata(fixtures, c);
  const texture = textureMeta(10, 4, 3);
  const fields = transfer(10, box(1, 1, 2, 2), 3).fields;
  const layout = c.ok(computeTransferLayout(texture, fields, 27), "default full-resource row stride exact fit").layout;
  for (const [key, expected] of Object.entries({ kind: "texture", offset: 3, rowBytes: 8, rowCount: 2,
    rowStride: 16, footprintBytes: 24, requiredEnd: 27, tightBytes: 16, direction: "upload" })) {
    c.equal(layout[key], expected, `independent layout ${key}`);
  }
  c.same(layout.box, fields.box, "layout preserves box");
  c.truth(Object.isFrozen(layout) && Object.isFrozen(layout.box), "layout frozen");
  c.bad(computeTransferLayout(texture, fields, 26), "default stride one-byte-short backing");
  const paddedFields = { ...fields, stride: 12, layerStride: 24 };
  const padded = c.ok(computeTransferLayout(texture, paddedFields, 23), "explicit row padding exact fit").layout;
  c.equal(padded.footprintBytes, 20, "footprint excludes final row padding");
  c.equal(padded.requiredEnd, 23, "nonzero data offset included");
  c.bad(computeTransferLayout(texture, paddedFields, 22), "row padding one-byte-short backing");
  c.bad(computeTransferLayout(texture, { ...fields, stride: 7 }, 100), "row overlap");
  c.bad(computeTransferLayout(texture, { ...fields, stride: 12, layerStride: 12 }, 100), "layer overlap");
  for (const [name, changed] of [
    ["box x past extent", { box: box(3, 0, 2) }], ["box y past extent", { box: box(0, 2, 1, 2) }],
    ["negative origin", { box: box(-1, 0, 1) }], ["zero extent", { box: box(0, 0, 0) }],
    ["overflow origin", { box: box(0xffffffff, 0, 2) }], ["invalid level", { level: 1 }],
    ["huge offset", { dataOffset: 0xffffffff }], ["unsafe offset", { dataOffset: Number.MAX_SAFE_INTEGER }],
    ["NaN stride", { stride: NaN }], ["fractional stride", { stride: 8.5 }],
    ["overflow rows", { stride: 0xffffffff }], ["unsupported layer", { box: { ...box(0, 0, 1), z: 1 } }],
    ["unsupported depth", { box: { ...box(0, 0, 1), depth: 2 } }],
  ]) c.bad(computeTransferLayout(texture, { ...fields, ...changed }, 128), name);
  c.bad(computeTransferLayout({ ...texture, format: 29 }, fields, 128), "invalid texture format");
  c.bad(computeTransferLayout(bufferMeta(11, 12), transfer(11, box(0, 0, 13)).fields, 4096), "logical buffer extent independent of backing page");
  const bufferLayout = c.ok(computeTransferLayout(bufferMeta(11, 64), transfer(11, box(7, 0, 8), 3).fields, 11), "buffer byte addressing exact fit").layout;
  c.equal(bufferLayout.rowBytes, 8, "buffer width measured in bytes");
  c.equal(bufferLayout.requiredEnd, 11, "buffer source offset measured in bytes");
  c.equal(c.ok(computeTransferLayout(texture, copyTransfer(10, 12, box(0, 0, 2, 2), 9, 3, 8, 16).fields, 25),
    "copy readback layout").layout.direction, "readback", "READ_FROM_HOST reverses direction");

  const memory = memoryBackend();
  const store = c.ok(createResourceStore({ backend: memory.backend }), "memory store").store;
  c.ok(store.createContext(2), "create default context");
  c.bad(store.createContext(2), "duplicate context");
  c.ok(store.createResource(bufferMeta(3, 16)), "create small vertex storage");
  c.bad(store.createResource(bufferMeta(3, 16)), "duplicate resource ID");
  c.bad(store.attachContext(99, 3), "missing context");
  c.bad(store.attachContext(2, 99), "missing resource");
  c.ok(store.attachContext(2, 3), "attach small vertex");
  c.bad(store.attachContext(2, 3), "duplicate attachment");
  c.bad(store.prepareTransfer(2, transfer(3, box(0, 0, 8))), "missing backing");
  const segments = [new Uint8Array([90, 91, 1]), new Uint8Array([2, 3, 4, 5]), new Uint8Array([6, 7, 8])];
  c.ok(store.attachBacking(3, segments), "split backing attached");
  segments.forEach((segment) => segment.fill(0));
  c.bytes(c.ok(store.readBacking(3, 0, 10), "read cloned backing").bytes, [90, 91, 1, 2, 3, 4, 5, 6, 7, 8], "attached pages cloned");
  c.bad(store.attachBacking(3, [new Uint8Array(10)]), "duplicate backing attachment");
  const preparedCommand = transfer(3, box(4, 0, 8), 2);
  const prepared = c.ok(store.prepareTransfer(2, preparedCommand), "prepare split upload");
  preparedCommand.fields.box.x = 0; preparedCommand.fields.dataOffset = 0;
  c.ok(store.writeBacking(3, 2, new Uint8Array(8).fill(42)), "write source after prepare");
  c.ok(store.executeTransfer(prepared.ticket), "execute snapshotted upload");
  c.bad(store.executeTransfer(prepared.ticket), "ticket is single use");
  const lease = c.ok(store.retainStorage(2, 3, "vertex"), "retain vertex storage").lease;
  const expectedBuffer = [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0];
  c.bytes(c.ok(store.readStorage(lease), "read memory storage").bytes, expectedBuffer, "prepared ticket snapshot semantics");
  c.ok(store.releaseStorage(lease), "release vertex lease");
  const beforeRejected = c.ok(store.readBacking(3, 0, 10), "backing before rejected write").bytes;
  c.bad(store.writeBacking(3, 9, new Uint8Array([1, 2])), "write beyond scatter backing");
  c.bytes(c.ok(store.readBacking(3, 0, 10), "backing after rejected write").bytes, beforeRejected, "rejected write atomic");
  c.bad(store.readBacking(3, 9, 2), "read beyond scatter backing");

  // Pending tickets bind both context attachment and backing generation.
  for (const mode of ["backing", "attachment", "unref"]) {
    const uploads = memory.statistics.uploads;
    const pending = c.ok(store.prepareTransfer(2, transfer(3, box(0, 0, 8), 2)), `prepare before ${mode}`).ticket;
    if (mode === "backing") {
      c.ok(store.detachBacking(3), "detach pending source backing");
      c.ok(store.attachBacking(3, [new Uint8Array(10).fill(7)]), "reattach different backing");
    } else if (mode === "attachment") {
      c.ok(store.detachContext(2, 3), "detach pending context resource");
      c.ok(store.attachContext(2, 3), "reattach same ID");
    } else {
      c.ok(store.unref(3), "unref pending resource");
      c.ok(store.createResource(bufferMeta(3, 16)), "reuse public resource ID");
      c.ok(store.attachContext(2, 3), "attach reused resource ID");
      c.ok(store.attachBacking(3, [new Uint8Array(10)]), "back reused resource ID");
    }
    c.bad(store.executeTransfer(pending), `${mode} invalidates prepared ticket`);
    c.equal(memory.statistics.uploads, uploads, `${mode} rejected before backend write`);
  }
  const cancellation = c.ok(store.prepareTransfer(2, transfer(3, box(0, 0, 8))), "prepare cancellation").ticket;
  c.ok(store.cancelTransfer(cancellation), "cancel pending ticket");
  c.bad(store.executeTransfer(cancellation), "cancelled ticket cannot execute");

  // Public name, backing, attachment and leased GPU lifetime are distinct.
  c.ok(store.createResource(textureMeta(5, 2, 2)), "create retained texture");
  c.ok(store.attachContext(2, 5), "attach retained texture");
  c.ok(store.attachBacking(5, [Uint8Array.from(TEXTURE_BYTES)]), "back retained texture");
  c.ok(store.executeTransfer(c.ok(store.prepareTransfer(2, transfer(5, box(0, 0, 2, 2))), "prepare retained texture").ticket), "upload retained texture");
  const oldLease = c.ok(store.retainStorage(2, 5, "view"), "retain old texture").lease;
  const destroysBefore = memory.statistics.destructions;
  c.ok(store.unref(5), "global public unref");
  c.equal(memory.statistics.destructions, destroysBefore, "leased texture not destroyed on unref");
  c.bad(store.retainStorage(2, 5, "view"), "new lookup after public unref fails");
  c.bad(store.readBacking(5, 0, 1), "public backing gone after unref");
  c.bytes(c.ok(store.readStorage(oldLease), "old lease after global unref").bytes, TEXTURE_BYTES, "old texture remains readable");
  c.ok(store.createResource(textureMeta(5, 1, 1)), "reuse retained texture ID");
  c.ok(store.attachContext(2, 5), "attach reused texture");
  c.bytes(c.ok(store.readStorage(oldLease), "old lease after ID reuse").bytes, TEXTURE_BYTES, "ID reuse cannot alias leased storage");
  c.ok(store.destroyContext(2), "destroy originating context");
  c.bytes(c.ok(store.readStorage(oldLease), "old lease after context destroy").bytes, TEXTURE_BYTES, "lease lifetime independent of context");
  c.ok(store.releaseStorage(oldLease), "release last old texture reference");
  c.equal(memory.statistics.destructions, destroysBefore + 1, "old storage destroyed exactly once");
  c.bad(store.readStorage(oldLease), "released lease stale");
  c.bad(store.releaseStorage(oldLease), "duplicate lease release");
  c.ok(store.createContext(2), "recreate context ID");
  c.ok(store.attachContext(2, 3), "attach existing buffer to recreated context");

  // Allocation and backend failures must leave accounting and backing coherent.
  const beforeAllocation = c.ok(store.inspect(), "before allocation failure").budgets;
  memory.control.failAllocate = true;
  c.bad(store.createResource(bufferMeta(9, 32)), "backend allocation failure");
  memory.control.failAllocate = false;
  c.same(c.ok(store.inspect(), "after allocation failure").budgets, beforeAllocation, "allocation failure budget rollback");
  c.ok(store.createResource(bufferMeta(9, 32)), "recover allocation same ID");
  const failedUpload = c.ok(store.prepareTransfer(2, transfer(3, box(0, 0, 8))), "prepare failing backend upload").ticket;
  memory.control.failUpload = true;
  c.bad(store.executeTransfer(failedUpload), "backend upload failure structured");
  memory.control.failUpload = false;
  c.bad(store.executeTransfer(failedUpload), "failed backend upload consumes ticket");
  c.equal(c.ok(store.inspect(), "after failed ticket").budgets.scratchBytes, 0, "failed upload releases scratch budget");

  // CPU staging never allocates GPU storage, and copy readbacks write only rows.
  const allocatedBeforeStaging = memory.statistics.allocations;
  c.ok(store.createResource(bufferMeta(7, 64, 524288)), "create CPU staging");
  c.equal(memory.statistics.allocations, allocatedBeforeStaging, "staging has no backend allocation");
  c.ok(store.attachContext(2, 7), "attach CPU staging");
  c.ok(store.attachBacking(7, [new Uint8Array(3).fill(0xaa), new Uint8Array(61).fill(0xaa)]), "split destination staging");
  const readback = copyTransfer(3, 7, box(0, 0, 8), 5, 3);
  const beforeReadbackFailure = c.ok(store.readBacking(7, 0, 64), "before short backend read").bytes;
  memory.control.shortReadback = true;
  c.bad(store.executeTransfer(c.ok(store.prepareTransfer(2, readback), "prepare short backend read").ticket), "short backend readback rejected");
  memory.control.shortReadback = false;
  c.bytes(c.ok(store.readBacking(7, 0, 64), "after short backend read").bytes, beforeReadbackFailure, "short backend read has no partial backing writes");
  c.ok(store.executeTransfer(c.ok(store.prepareTransfer(2, readback), "prepare successful copy readback").ticket), "copy readback recovery");
  c.bytes(c.ok(store.readBacking(7, 0, 5), "readback prefix guard").bytes, Array(5).fill(0xaa), "staging prefix guard");
  c.bytes(c.ok(store.readBacking(7, 13, 51), "readback suffix guard").bytes, Array(51).fill(0xaa), "staging suffix guard");
  for (const side of ["destination backing", "destination attachment", "primary backing"]) {
    const pending = c.ok(store.prepareTransfer(2, readback), `prepare copy before ${side} detach`).ticket;
    const oldReads = memory.statistics.readbacks;
    if (side === "destination backing") {
      c.ok(store.detachBacking(7), "detach pending copy destination backing");
      c.ok(store.attachBacking(7, [new Uint8Array(64).fill(0xbb)]), "reattach pending copy destination backing");
    } else if (side === "destination attachment") {
      c.ok(store.detachContext(2, 7), "detach pending copy destination attachment");
      c.ok(store.attachContext(2, 7), "reattach pending copy destination attachment");
    } else {
      c.ok(store.detachBacking(3), "detach pending copy primary backing");
      c.ok(store.attachBacking(3, [new Uint8Array(10)]), "reattach pending copy primary backing");
    }
    const before = c.ok(store.readBacking(7, 0, 64), `destination before stale ${side}`).bytes;
    c.bad(store.executeTransfer(pending), `pending copy ${side} invalidates ticket`);
    c.equal(memory.statistics.readbacks, oldReads, `stale ${side} rejected before backend read`);
    c.bytes(c.ok(store.readBacking(7, 0, 64), `destination after stale ${side}`).bytes, before,
      `stale ${side} causes no backing write`);
  }
  const pendingCopyUpload = c.ok(store.prepareTransfer(2, copyTransfer(3, 7, box(0, 0, 8))),
    "prepare copy upload before unused primary backing detach").ticket;
  const beforeStaleCopyUploads = memory.statistics.uploads;
  c.ok(store.detachBacking(3), "detach copy upload primary backing");
  c.ok(store.attachBacking(3, [new Uint8Array(10)]), "reattach copy upload primary backing");
  c.bad(store.executeTransfer(pendingCopyUpload), "copy upload primary backing identity invalidates ticket");
  c.equal(memory.statistics.uploads, beforeStaleCopyUploads, "stale copy upload rejected before backend writes");
  c.ok(store.attachContext(2, 9), "attach resource without primary backing");
  const pendingNoBacking = c.ok(store.prepareTransfer(2, copyTransfer(9, 7, box(0, 0, 8))),
    "copy upload initially absent primary backing").ticket;
  c.ok(store.attachBacking(9, [new Uint8Array(8)]), "attach previously absent primary backing");
  c.bad(store.executeTransfer(pendingNoBacking), "copy upload null-to-attached primary backing invalidates ticket");
  c.equal(memory.statistics.uploads, beforeStaleCopyUploads, "new primary backing rejected before backend writes");
  const finalBudgets = fullCleanup(store, c, "lifecycle");
  c.equal(memory.live.size, 0, "no leaked backend storage");
  c.equal(memory.statistics.allocations, memory.statistics.destructions, "every allocated storage destroyed");

  // Lowered public budgets are exercised as behavior, independently of exports.
  for (const [limit, maximum] of [["resources", 2], ["contexts", 2], ["tickets", 2], ["leases", 2]]) {
    const boundedMemory = memoryBackend();
    const bounded = c.ok(createResourceStore({ backend: boundedMemory.backend, limits: { [limit]: maximum } }), `bounded ${limit} store`).store;
    c.ok(bounded.createContext(1), `bounded ${limit} context`);
    c.ok(bounded.createResource(bufferMeta(1, 8)), `bounded ${limit} resource`);
    c.ok(bounded.attachContext(1, 1), `bounded ${limit} attachment`);
    c.ok(bounded.attachBacking(1, [new Uint8Array(8)]), `bounded ${limit} backing`);
    if (limit === "resources") {
      c.ok(bounded.createResource(bufferMeta(2, 8)), "last resource budget");
      c.bad(bounded.createResource(bufferMeta(3, 8)), "resource count budget");
    } else if (limit === "contexts") {
      c.ok(bounded.createContext(2), "last context budget"); c.bad(bounded.createContext(3), "context count budget");
    } else if (limit === "tickets") {
      for (let i = 0; i < 2; i++) c.ok(bounded.prepareTransfer(1, transfer(1, box(0, 0, 8))), `ticket at budget ${i}`);
      c.bad(bounded.prepareTransfer(1, transfer(1, box(0, 0, 8))), "pending ticket budget");
    } else {
      for (let i = 0; i < 2; i++) c.ok(bounded.retainStorage(1, 1, "vertex"), `lease at budget ${i}`);
      c.bad(bounded.retainStorage(1, 1, "vertex"), "lease count budget");
    }
    fullCleanup(bounded, c, `bounded ${limit}`);
    c.equal(boundedMemory.live.size, 0, `bounded ${limit} no storage leak`);
  }
  for (const [budget, limit] of [["resources", 1], ["gpuBytes", 16]]) {
    const m = memoryBackend(), s = c.ok(createResourceStore({ backend: m.backend, limits: { [budget]: limit } }),
      `retained ${budget} cap store`).store;
    c.ok(s.createContext(1), `retained ${budget} context`);
    c.ok(s.createResource(bufferMeta(1, 16)), `retained ${budget} resource`);
    c.ok(s.attachContext(1, 1), `retained ${budget} attachment`);
    const retained = c.ok(s.retainStorage(1, 1, "vertex"), `retained ${budget} lease`).lease;
    c.ok(s.unref(1), `retained ${budget} public unref`);
    c.bad(s.createResource(bufferMeta(1, 16)), `retired storage still counts against ${budget}`);
    c.ok(s.releaseStorage(retained), `retained ${budget} release`);
    c.ok(s.createResource(bufferMeta(1, 16)), `retained ${budget} allocation after release`);
    fullCleanup(s, c, `retained ${budget} cap`);
  }
  for (const [name, limits] of [["segments", { segments: 2 }], ["backing bytes", { resourceBytes: 16 }],
    ["CPU bytes", { cpuBytes: 16 }], ["scratch bytes", { scratchBytes: 7 }]]) {
    const m = memoryBackend(), s = c.ok(createResourceStore({ backend: m.backend, limits }), `bounded ${name} store`).store;
    c.ok(s.createContext(1), `bounded ${name} context`);
    c.ok(s.createResource(bufferMeta(1, 16)), `bounded ${name} resource`);
    c.ok(s.attachContext(1, 1), `bounded ${name} attachment`);
    if (name === "segments") {
      c.bad(s.attachBacking(1, [new Uint8Array(1), new Uint8Array(1), new Uint8Array(1)]), "segment count budget");
      c.ok(s.attachBacking(1, [new Uint8Array(8), new Uint8Array(8)]), "exact segment count budget");
    } else if (name === "backing bytes") {
      c.bad(s.attachBacking(1, [new Uint8Array(17)]), "per-resource backing byte budget");
      c.ok(s.attachBacking(1, [new Uint8Array(16)]), "exact backing byte budget");
    } else if (name === "CPU bytes") {
      c.ok(s.attachBacking(1, [new Uint8Array(12)]), "CPU backing uses twelve bytes");
      c.bad(s.prepareTransfer(1, transfer(1, box(0, 0, 8))), "combined backing plus scratch CPU budget");
      c.ok(s.writeBacking(1, 0, new Uint8Array(4)), "exact combined CPU byte budget");
      c.bad(s.writeBacking(1, 0, new Uint8Array(5)), "write scratch CPU byte budget");
    } else {
      c.ok(s.attachBacking(1, [new Uint8Array(16)]), "scratch backing");
      c.bad(s.prepareTransfer(1, transfer(1, box(0, 0, 8))), "upload scratch byte budget");
      c.bad(s.prepareTransfer(1, transfer(1, box(0, 0, 8), 0, 2)), "readback reserves scratch byte budget");
      const t = c.ok(s.prepareTransfer(1, transfer(1, box(0, 0, 7))), "exact scratch byte budget").ticket;
      c.ok(s.cancelTransfer(t), "release exact scratch reservation");
    }
    fullCleanup(s, c, `bounded ${name}`);
  }
  {
    const m = memoryBackend(), s = c.ok(createResourceStore({ backend: m.backend }), "two-context membership store").store;
    c.ok(s.createContext(9), "create high context ID"); c.ok(s.createContext(1), "create low context ID");
    c.ok(s.createResource(bufferMeta(2, 8)), "shared-context resource");
    c.ok(s.attachContext(9, 2), "attach high context"); c.ok(s.attachContext(1, 2), "attach low context");
    c.same(c.ok(s.inspect(), "inspect sorted shared attachments").resources[0].attachments, [1, 9], "two-context attachment sort");
    c.ok(s.attachBacking(2, [new Uint8Array(8)]), "shared-context backing");
    const pending = c.ok(s.prepareTransfer(9, transfer(2, box(0, 0, 8))), "prepare old context generation").ticket;
    c.ok(s.destroyContext(9), "destroy context with pending transfer");
    c.ok(s.createContext(9), "reuse context numeric ID"); c.ok(s.attachContext(9, 2), "reattach reused context ID");
    c.bad(s.executeTransfer(pending), "reused context ID cannot revive old ticket");
    c.equal(m.statistics.uploads, 0, "stale context rejected before backend write");
    c.ok(s.unref(2), "unref resource attached in two contexts");
    c.truth(c.ok(s.inspect(), "both contexts after global unref").contexts.every((context) => context.resourceIds.length === 0),
      "global unref removes all context memberships");
    fullCleanup(s, c, "two-context membership");
  }
  // Trusted backend fault controls exercise accounting/retry; these are not GPU
  // success claims and do not replace the browser's actual transfer proofs.
  for (const path of ["lease release", "ticket release", "dispose tickets", "backend dispose"]) {
    const m = memoryBackend(), s = c.ok(createResourceStore({ backend: m.backend }), `fault ${path} store`).store;
    c.ok(s.createContext(1), `fault ${path} context`);
    c.ok(s.createResource(bufferMeta(1, 8)), `fault ${path} resource`);
    c.ok(s.attachContext(1, 1), `fault ${path} attach`);
    c.ok(s.attachBacking(1, [new Uint8Array(8)]), `fault ${path} backing`);
    if (path === "lease release") {
      const lease = c.ok(s.retainStorage(1, 1, "vertex"), "fault retain lease").lease;
      c.ok(s.unref(1), "fault unref leased resource"); m.control.failDestroy = true;
      c.bad(s.releaseStorage(lease), "trusted destroy failure during lease release");
    } else if (path === "ticket release") {
      const ticket = c.ok(s.prepareTransfer(1, transfer(1, box(0, 0, 8))), "fault prepare ticket").ticket;
      c.ok(s.unref(1), "fault unref pending resource"); m.control.failDestroy = true;
      c.bad(s.executeTransfer(ticket), "trusted destroy failure during ticket release");
      const state = c.ok(s.inspect(), "failed ticket cleanup accounting").budgets;
      c.equal(state.tickets, 0, "failed cleanup still consumes ticket"); c.equal(state.scratchBytes, 0, "failed cleanup releases scratch");
    } else if (path === "dispose tickets") {
      c.ok(s.prepareTransfer(1, transfer(1, box(0, 0, 8))), "fault prepare disposal ticket");
      m.control.failDestroy = true;
      c.bad(s.dispose(), "trusted destroy failure while disposing pending tickets");
    } else {
      m.control.failDispose = true;
      c.bad(s.dispose(), "trusted backend disposal failure");
    }
    m.control.failDestroy = false; m.control.failDispose = false;
    fullCleanup(s, c, `fault ${path} retry`);
    c.ok(s.dispose(), `fault ${path} repeated dispose`);
    c.equal(m.live.size, 0, `fault ${path} eventual no leak`);
    c.equal(m.statistics.allocations, m.statistics.destructions, `fault ${path} destroyed exactly once`);
  }
  for (const [name, changed] of [["zero ID", { id: 0 }], ["bad format", { format: 67 }],
    ["unsupported bind", { bind: 1 }], ["mip levels", { lastLevel: 1 }], ["multisample", { nrSamples: 2 }],
    ["resource flags", { flags: 1 }], ["empty width", { width: 0 }], ["resource size cap", { width: 4194305 }],
    ["array layers", { arraySize: 2 }], ["buffer height", { height: 2 }]]) {
    const m = memoryBackend(), s = c.ok(createResourceStore({ backend: m.backend }), `invalid ${name} store`).store;
    c.bad(s.createResource({ ...bufferMeta(1), ...changed }), `invalid resource ${name}`);
    c.equal(m.statistics.allocations, 0, `${name} rejected before allocation`);
    fullCleanup(s, c, `invalid ${name}`);
  }
  {
    const m = memoryBackend(), s = c.ok(createResourceStore({ backend: m.backend }), "backing byte-view boundary store").store;
    c.bad(s.createResource(new Proxy(bufferMeta(2, 8), { ownKeys() { throw new Error("trusted record reflection fault"); } })),
      "throwing metadata reflection trap");
    c.ok(s.createResource(bufferMeta(1, 8)), "backing boundary resource");
    c.bad(s.attachBacking(1, []), "empty segment list");
    c.bad(s.attachBacking(1, [new Uint16Array(4)]), "non-byte backing segment");
    c.bad(s.attachBacking(1, new Array(1)), "sparse segment array");
    const revoked = Proxy.revocable([], {}); revoked.revoke();
    c.bad(s.attachBacking(1, revoked.proxy), "revoked segment array reflection");
    c.bad(s.attachBacking(1, new Proxy([new Uint8Array(8)], { getOwnPropertyDescriptor() { throw new Error("trusted segment reflection fault"); } })),
      "throwing segment reflection trap");
    for (const mode of ["detach", "shrink"]) {
      const backing = mode === "shrink" ? new ArrayBuffer(8, { maxByteLength: 16 }) : new ArrayBuffer(8);
      if (mode === "shrink") c.truth(typeof backing.resize === "function", "resizable buffers available for reflected shrink attack");
      const first = new Uint8Array(backing), second = new Uint8Array(8);
      let triggered = false;
      const entries = new Proxy([first, second], { getOwnPropertyDescriptor(target, key) {
        if (key === "1" && !triggered) {
          triggered = true;
          if (mode === "detach") structuredClone(backing, { transfer: [backing] });
          else backing.resize(4);
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      } });
      const before = c.ok(s.inspect(), `before reflected ${mode}`).budgets;
      c.bad(s.attachBacking(1, entries), `earlier segment ${mode} during later segment reflection`);
      c.truth(triggered, `reflected ${mode} fault actually triggered`);
      c.equal(first.byteLength, mode === "detach" ? 0 : 4, `reflected ${mode} changed earlier view length`);
      c.same(c.ok(s.inspect(), `after reflected ${mode}`).budgets, before, `reflected ${mode} has no backing or budget publication`);
      c.bad(s.readBacking(1, 0, 1), `reflected ${mode} left backing unattached`);
    }
    c.bad(s.attachBacking(1, Array.from({ length: 257 }, () => new Uint8Array(0))), "default 256 segment budget");
    let accessed = 0;
    const accessor = Object.defineProperty([null], "0", { get() { accessed++; return new Uint8Array(8); } });
    c.bad(s.attachBacking(1, accessor), "backing segment accessor");
    c.equal(accessed, 0, "segment getter never invoked");
    const detached = new Uint8Array(8); structuredClone(detached.buffer, { transfer: [detached.buffer] });
    c.bad(s.attachBacking(1, [detached]), "detached backing segment");
    if (typeof SharedArrayBuffer === "function") c.bad(s.attachBacking(1, [new Uint8Array(new SharedArrayBuffer(8))]), "shared backing segment");
    const host = new Uint8Array([99, 98, 97, 1, 2, 3, 4, 5, 6, 7, 8, 96]);
    c.ok(s.attachBacking(1, [new Uint8Array(0), host.subarray(3, 11), new Uint8Array(0)]), "unaligned host byte view with empty SG segments");
    host.fill(0);
    const read = c.ok(s.readBacking(1, 0, 8), "owned byte-view read").bytes;
    c.bytes(read, [1, 2, 3, 4, 5, 6, 7, 8], "byteOffset and exact segment extent honored");
    read.fill(0);
    c.bytes(c.ok(s.readBacking(1, 0, 8), "read after caller output mutation").bytes, [1, 2, 3, 4, 5, 6, 7, 8], "read output owns its bytes");
    c.ok(s.writeBacking(1, 8, new Uint8Array(0)), "empty write at backing end");
    c.bytes(c.ok(s.readBacking(1, 8, 0), "empty read at backing end").bytes, [], "empty end range");
    fullCleanup(s, c, "backing byte-view boundary");
  }
  const seeds = options.seeds ?? DEFAULT_SEEDS, count = options.count ?? 1024;
  c.truth(Array.isArray(seeds) && seeds.length > 0 && seeds.length <= 64 && seeds.every((s) => Number.isInteger(s) && s >= 0 && s <= 0xffffffff), "bounded mutation seeds");
  c.truth(Number.isInteger(count) && count >= 0 && count <= 100000, "bounded mutation count");
  const states = seeds.map((seed) => seed >>> 0);
  const random = (index) => { let x = states[index]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (states[index] = x >>> 0); };
  let accepted = 0, rejected = 0;
  for (let i = 0; i < count; i++) {
    const si = i % seeds.length, randomValue = random(si), mode = Math.floor(i / seeds.length) % 4;
    const value = (i & 32) ? randomValue : randomValue % [6, 24, 128, 8][mode];
    const changed = { ...fields, box: { ...fields.box } };
    if (mode === 0) changed.box.x = value;
    if (mode === 1) changed.stride = value;
    if (mode === 2) changed.dataOffset = value;
    if (mode === 3) changed.box.width = value;
    const result = computeTransferLayout(texture, changed, 128);
    const expectedRow = changed.stride || 16, expectedRowBytes = changed.box.width * 4;
    const expectedFootprint = expectedRow + expectedRowBytes;
    const shouldAccept = changed.box.width > 0 && changed.box.x <= 4 && changed.box.width <= 4 - changed.box.x &&
      expectedRow >= expectedRowBytes && changed.dataOffset <= 128 && expectedFootprint <= 128 - changed.dataOffset;
    c.equal(result.ok, shouldAccept, `seed ${seeds[si]} mutation ${i} independent layout acceptance`);
    if (result.ok) {
      accepted++;
      c.truth(result.layout.requiredEnd <= 128 && result.layout.box.x + result.layout.box.width <= 4,
        `seed ${seeds[si]} mutation ${i} accepted layout bounded`);
      c.equal(result.layout.rowStride, expectedRow, `mutation ${i} row stride`);
      c.equal(result.layout.footprintBytes, expectedFootprint, `mutation ${i} footprint`);
    } else {
      rejected++; c.bad(result, `seed ${seeds[si]} mutation ${i}`, false);
    }
    c.same(computeTransferLayout(texture, changed, 128), result, `mutation ${i} deterministic`);
    c.equal(c.ok(computeTransferLayout(texture, fields, 27), `mutation ${i} recovery`).layout.requiredEnd, 27, `mutation ${i} recovery layout`);
  }
  return { status: "passed", guestExecution: false, sources, assertions: c.assertions,
    cases: c.cases, mutations: { count, seeds: seeds.slice(), accepted, rejected },
    memoryBackend: { ...memory.statistics }, finalBudgets };
}

function originalCommands(fixtures, c) {
  const decoded = new Map();
  for (const source of fixtures.commands.submissions) {
    const result = c.ok(decodeSubmission(Uint8Array.from(source.data), { sourceSha256: source.sourceSha256,
      event: source.event, contextId: source.contextId }), `decode original event ${source.event}`);
    decoded.set(source.event, result);
  }
  return (event, offset) => {
    const command = decoded.get(event).commands.find((value) => value.byteOffset === offset);
    c.truth(command, `original transfer event ${event} offset ${offset}`);
    return command;
  };
}

function installFixtureBacking(store, entry, c) {
  const flat = new Uint8Array(entry.iovLengths.reduce((a, b) => a + b, 0));
  for (const range of entry.ranges) flat.set(range.data, range.offset);
  let position = 0;
  const segments = entry.iovLengths.map((length) => { const part = flat.slice(position, position + length); position += length; return part; });
  c.ok(store.attachBacking(entry.resourceId, segments), `original backing resource ${entry.resourceId}`);
  // The store owns a clone, including the original page padding.
  segments.forEach((segment) => segment.fill(0x5a));
}

function trackedBackend(backend) {
  const allocations = new Map(), live = new Set(), events = [];
  return { allocations, live, events, backend: {
    maxTextureSize: backend.maxTextureSize,
    allocate(meta) { const storage = backend.allocate(meta); allocations.set(meta.id, { meta, storage }); live.add(storage); events.push({ action: "allocate", id: meta.id }); return storage; },
    destroy(storage) { backend.destroy(storage); live.delete(storage); events.push({ action: "destroy" }); },
    upload(...args) { return backend.upload(...args); },
    readback(...args) { return backend.readback(...args); },
    dispose() { return backend.dispose(); },
  } };
}

function directGpuRead(gl, allocation, c, label) {
  const { storage, meta } = allocation;
  if (storage.kind === "buffer") {
    const previous = gl.getParameter(gl.COPY_READ_BUFFER_BINDING), bytes = new Uint8Array(meta.width);
    gl.bindBuffer(gl.COPY_READ_BUFFER, storage.buffer);
    gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes);
    gl.bindBuffer(gl.COPY_READ_BUFFER, previous);
    c.equal(gl.getError(), gl.NO_ERROR, `${label} direct getBufferSubData error`);
    return bytes;
  }
  const framebuffer = gl.createFramebuffer(), previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  const oldReadBuffer = gl.getParameter(gl.READ_BUFFER), pbo = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  const stores = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS];
  const values = stores.map((key) => gl.getParameter(key));
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, storage.texture, 0);
  c.equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, `${label} direct framebuffer complete`);
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  stores.forEach((key, i) => gl.pixelStorei(key, i === 0 ? 1 : 0));
  const bytes = new Uint8Array(meta.width * meta.height * 4);
  gl.readPixels(0, 0, meta.width, meta.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous); gl.readBuffer(oldReadBuffer);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); stores.forEach((key, i) => gl.pixelStorei(key, values[i]));
  gl.deleteFramebuffer(framebuffer);
  c.equal(gl.getError(), gl.NO_ERROR, `${label} direct readPixels error`);
  return bytes;
}

function poisonState(gl, c) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buffers = [];
  for (const target of [gl.ELEMENT_ARRAY_BUFFER, gl.ARRAY_BUFFER, gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, gl.PIXEL_PACK_BUFFER, gl.PIXEL_UNPACK_BUFFER]) {
    const value = gl.createBuffer(); buffers.push([target, value]); gl.bindBuffer(target, value); gl.bufferData(target, 65536, gl.STATIC_DRAW);
  }
  gl.activeTexture(gl.TEXTURE0 + 3);
  const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
  const read = gl.createFramebuffer(), draw = gl.createFramebuffer();
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const set = [
    [gl.PACK_ALIGNMENT, 8], [gl.PACK_ROW_LENGTH, 7], [gl.PACK_SKIP_PIXELS, 1], [gl.PACK_SKIP_ROWS, 1],
    [gl.UNPACK_ALIGNMENT, 8], [gl.UNPACK_ROW_LENGTH, 7], [gl.UNPACK_IMAGE_HEIGHT, 9],
    [gl.UNPACK_SKIP_PIXELS, 1], [gl.UNPACK_SKIP_ROWS, 1], [gl.UNPACK_SKIP_IMAGES, 1],
    [gl.UNPACK_FLIP_Y_WEBGL, true], [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true],
    [gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL],
  ];
  set.forEach(([key, value]) => gl.pixelStorei(key, value));
  c.equal(gl.getError(), gl.NO_ERROR, "hostile transfer state installed without GL errors");
  return { apply() {
    gl.bindVertexArray(vao);
    buffers.forEach(([target, value]) => gl.bindBuffer(target, value));
    gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    set.forEach(([key, value]) => gl.pixelStorei(key, value));
    c.equal(gl.getError(), gl.NO_ERROR, "hostile transfer state reapplied without GL errors");
  }, dispose() {
    gl.bindVertexArray(null); buffers.forEach(([, value]) => gl.deleteBuffer(value)); gl.deleteVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(read); gl.deleteFramebuffer(draw); gl.deleteTexture(texture);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  } };
}

function trustedGlFaultControls(gl, c) {
  // All uninjected calls delegate to the real context. These controls prove
  // rollback, not successful transfer semantics; the direct GPU oracles do that.
  const control = { mode: null, lastBuffer: null, lastTexture: null };
  const wrapped = new Proxy(gl, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args) => {
      if (control.mode === key) {
        if (["createVertexArray", "createFramebuffer", "createBuffer", "createTexture"].includes(key)) return null;
        throw new Error(`trusted GL fault control ${key}`);
      }
      const result = value.apply(target, args);
      if (key === "createBuffer") control.lastBuffer = result;
      if (key === "createTexture") control.lastTexture = result;
      return result;
    };
  } });
  const tested = [];
  for (const name of ["createVertexArray", "createFramebuffer"]) {
    control.mode = name;
    c.bad(createWebGL2TransferBackend(wrapped), `trusted GL helper allocation failure ${name}`);
    control.mode = null;
    c.equal(gl.getError(), gl.NO_ERROR, `trusted ${name} cleanup GL errors`);
    tested.push(name);
  }
  for (const [name, meta] of [["createBuffer", bufferMeta(1, 8)], ["bufferData", bufferMeta(1, 8)],
    ["createTexture", textureMeta(1, 2, 2)], ["texStorage2D", textureMeta(1, 2, 2)]]) {
    const backend = c.ok(createWebGL2TransferBackend(wrapped), `trusted ${name} backend`).backend;
    const tracked = trackedBackend(backend);
    const store = c.ok(createResourceStore({ backend: tracked.backend }), `trusted ${name} store`).store;
    control.mode = name; control.lastBuffer = null; control.lastTexture = null;
    c.bad(store.createResource(meta), `trusted GL resource allocation failure ${name}`);
    const failedObject = meta.target === 2 ? control.lastTexture : control.lastBuffer;
    control.mode = null;
    for (const [key, value] of Object.entries(c.ok(store.inspect(), `trusted ${name} rollback`).budgets)) {
      c.equal(value, 0, `trusted ${name} rollback ${key}`);
    }
    if (failedObject !== null) c.equal(meta.target === 2 ? gl.isTexture(failedObject) : gl.isBuffer(failedObject),
      false, `trusted ${name} partial GPU object deleted`);
    c.ok(store.createResource(meta), `trusted ${name} subsequent allocation recovery`);
    const recovered = tracked.allocations.get(1).storage;
    c.truth(recovered.kind === "texture" ? gl.isTexture(recovered.texture) : gl.isBuffer(recovered.buffer),
      `trusted ${name} recovery owns actual GL object`);
    fullCleanup(store, c, `trusted GL ${name}`);
    backend.destroy(recovered); backend.destroy(recovered); backend.dispose(); backend.dispose();
    c.equal(recovered.kind === "texture" ? gl.isTexture(recovered.texture) : gl.isBuffer(recovered.buffer),
      false, `trusted ${name} idempotent destruction`);
    c.equal(gl.getError(), gl.NO_ERROR, `trusted ${name} final GL errors`);
    tested.push(name);
  }
  return { boundary: "trusted fault controls; not GPU transfer success evidence", failuresAndRecovery: tested,
    idempotentDestroyAndDispose: "passed" };
}

export async function runBrowserAcceptance(fixtures, options = {}) {
  const native = runNativeAcceptance(fixtures, options), c = checks();
  const canvas = document.getElementById("gpu");
  c.truth(canvas, "hardware GPU canvas exists");
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  c.truth(gl, "actual WebGL2 context available");
  const backendResult = c.ok(createWebGL2TransferBackend(gl), "actual WebGL2 transfer backend");
  const tracked = trackedBackend(backendResult.backend);
  const store = c.ok(createResourceStore({ backend: tracked.backend }), "GPU resource store").store;
  const command = originalCommands(fixtures, c);
  const execute = (cmd, label) => {
    hostile.apply();
    return c.ok(store.executeTransfer(c.ok(store.prepareTransfer(2, cmd), `${label} prepare`).ticket), `${label} execute`);
  };
  c.ok(store.createContext(2), "original default context before sub-context commands");
  const hostile = poisonState(gl, c);
  for (const meta of fixtures.resources) {
    hostile.apply();
    c.ok(store.createResource(meta), `original resource ${meta.id} GPU allocate`);
    c.ok(store.attachContext(2, meta.id), `original resource ${meta.id} attach`);
  }
  c.same([...tracked.allocations.keys()], [3, 4, 5, 6], "CPU staging resource 7 has no GL allocation");
  for (const entry of fixtures.backing) installFixtureBacking(store, entry, c);
  const originalBudgets = c.ok(store.inspect(), "original resource budget anchors").budgets;
  c.equal(originalBudgets.gpuBytes, 4188, "original logical GPU bytes 64+12+4096+16");
  c.equal(originalBudgets.backingBytes, 1064960, "original page backing bytes 4*4096+1MiB");
  execute(command(161, 0), "original vertex TRANSFER3D");
  execute(command(161, 56), "original index TRANSFER3D");
  execute(command(161, 4736), "original texture COPY_TRANSFER3D upload");
  c.equal(gl.getError(), gl.NO_ERROR, "original transfers under hostile host state");
  const vertex = directGpuRead(gl, tracked.allocations.get(3), c, "original vertex");
  const index = directGpuRead(gl, tracked.allocations.get(4), c, "original index");
  const texture = directGpuRead(gl, tracked.allocations.get(6), c, "original texture");
  c.bytes(vertex, VERTEX_BYTES, "original vertex GPU bytes");
  c.bytes(index, INDEX_BYTES, "original index GPU bytes");
  c.bytes(texture, TEXTURE_BYTES, "original texture GPU bytes");
  for (const [id, role, expected] of [[3, "vertex", VERTEX_BYTES], [4, "index", INDEX_BYTES]]) {
    const lease = c.ok(store.retainStorage(2, id, role), `production buffer readback retain ${id}`).lease;
    hostile.apply();
    c.bytes(c.ok(store.readStorage(lease), `production buffer readStorage ${id}`).bytes,
      expected, `production buffer actual GPU readback ${id}`);
    c.ok(store.releaseStorage(lease), `production buffer readback release ${id}`);
  }
  const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING), indexVao = gl.createVertexArray();
  gl.bindVertexArray(indexVao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tracked.allocations.get(4).storage.buffer);
  c.equal(gl.getError(), gl.NO_ERROR, "index resource retains ELEMENT_ARRAY_BUFFER first-bind type");
  c.equal(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING), tracked.allocations.get(4).storage.buffer, "actual index element binding");
  gl.bindVertexArray(previousVao); gl.deleteVertexArray(indexVao);

  // Upload a new 32x32 pattern to resource5; captured readback offsets alone are
  // reused. This deliberately makes no draw replay or captured-image claim.
  const pattern = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const offset = (y * 32 + x) * 4;
    pattern.set([(x * 7 + y * 3) & 255, (x ^ y) * 5, (x * 13 + y * 11) & 255, 255], offset);
  }
  c.ok(store.writeBacking(5, 0, pattern), "synthetic framebuffer-pattern backing");
  execute(transfer(5, box(0, 0, 32, 32)), "synthetic texture5 upload");
  c.bytes(directGpuRead(gl, tracked.allocations.get(5), c, "synthetic resource5"), pattern, "synthetic texture direct GPU oracle");
  const readbacks = [];
  for (const [event, offset] of [[173, 64], [197, 4160], [221, 8256]]) {
    execute(command(event, 4104), `original READ_FROM_HOST event ${event}`);
    const bytes = c.ok(store.readBacking(7, offset, 4096), `read staging event ${event}`).bytes;
    c.bytes(bytes, pattern, `actual GPU readback event ${event} staging offset ${offset}`);
    readbacks.push({ event, stagingOffset: offset, bytes: [...bytes] });
  }

  // A pixel crosses SG segments; nonzero offset and row padding stay untouched.
  c.ok(store.createResource(textureMeta(40, 4, 3)), "scatter texture allocate");
  c.ok(store.attachContext(2, 40), "scatter texture attach");
  const scatterBytes = new Uint8Array(23).fill(0xcc);
  scatterBytes.set(TEXTURE_BYTES.slice(0, 8), 3); scatterBytes.set(TEXTURE_BYTES.slice(8), 15);
  c.ok(store.attachBacking(40, [scatterBytes.slice(0, 5), scatterBytes.slice(5, 7), scatterBytes.slice(7)]), "pixel-crossing SG backing");
  const scatterCommand = transfer(40, box(1, 1, 2, 2), 3, 1, 12, 24);
  execute(scatterCommand, "padded split-pixel texture upload");
  const scatterGpu = directGpuRead(gl, tracked.allocations.get(40), c, "scatter texture");
  const scatterExpected = new Uint8Array(4 * 3 * 4);
  scatterExpected.set(TEXTURE_BYTES.slice(0, 8), (1 * 4 + 1) * 4); scatterExpected.set(TEXTURE_BYTES.slice(8), (2 * 4 + 1) * 4);
  c.bytes(scatterGpu, scatterExpected, "scatter sub-box actual GPU oracle");
  c.ok(store.writeBacking(40, 0, new Uint8Array(23).fill(0xdd)), "poison scatter destination before readback");
  execute(transfer(40, box(1, 1, 2, 2), 3, 2, 12, 24), "padded split-pixel texture readback");
  const scatterOutput = c.ok(store.readBacking(40, 0, 23), "scatter readback bytes").bytes;
  const scatterReadExpected = new Uint8Array(23).fill(0xdd);
  scatterReadExpected.set(TEXTURE_BYTES.slice(0, 8), 3); scatterReadExpected.set(TEXTURE_BYTES.slice(8), 15);
  c.bytes(scatterOutput, scatterReadExpected, "readback leaves prefix and inter-row padding unchanged");
  c.ok(store.detachBacking(40), "remove exact fit backing");
  c.ok(store.attachBacking(40, [new Uint8Array(22)]), "one-byte-short backing attached");
  c.bad(store.prepareTransfer(2, scatterCommand), "one-byte-short scatter transfer rejected before GPU");
  c.bytes(directGpuRead(gl, tracked.allocations.get(40), c, "after short scatter reject"), scatterExpected, "short transfer cannot mutate GPU storage");
  c.ok(store.detachBacking(40), "remove short backing before default stride");
  const defaultSource = new Uint8Array(27).fill(0xee);
  defaultSource.set(TEXTURE_BYTES.slice(8), 3); defaultSource.set(TEXTURE_BYTES.slice(0, 8), 19);
  c.ok(store.attachBacking(40, [defaultSource.slice(0, 6), defaultSource.slice(6)]), "default-stride exact footprint backing");
  execute(transfer(40, box(1, 1, 2, 2), 3), "default full-resource width stride upload");
  const defaultExpected = new Uint8Array(4 * 3 * 4);
  defaultExpected.set(TEXTURE_BYTES.slice(8), (1 * 4 + 1) * 4);
  defaultExpected.set(TEXTURE_BYTES.slice(0, 8), (2 * 4 + 1) * 4);
  c.bytes(directGpuRead(gl, tracked.allocations.get(40), c, "default-stride texture"), defaultExpected,
    "actual GPU default row stride uses full texture width");
  c.ok(store.writeBacking(40, 0, new Uint8Array(27).fill(0xab)), "default-stride readback guards");
  execute(transfer(40, box(1, 1, 2, 2), 3, 2), "default full-resource width stride readback");
  const defaultReadExpected = new Uint8Array(27).fill(0xab);
  defaultReadExpected.set(TEXTURE_BYTES.slice(8), 3); defaultReadExpected.set(TEXTURE_BYTES.slice(0, 8), 19);
  const defaultScatterOutput = c.ok(store.readBacking(40, 0, 27), "default-stride backing read").bytes;
  c.bytes(defaultScatterOutput, defaultReadExpected, "default-stride readback excludes row padding and guards");

  // The comparison-only captured outputs are poisoned, then every original
  // input upload is repeated from its own source backing. They never enter it.
  const poisonedFixtures = { ...fixtures, referenceOutputSnapshots: fixtures.referenceOutputSnapshots.map((entry) =>
    ({ ...entry, data: entry.data.map((byte, i) => byte ^ (1 + (i * 29) % 255)) })) };
  c.equal(poisonedFixtures.referenceOutputSnapshots.reduce((sum, entry) => sum + entry.data.length, 0), 12288,
    "all selected comparison-only output bytes poisoned");
  c.truth(poisonedFixtures.referenceOutputSnapshots.every((entry, i) => entry.data.every((byte, j) => byte !== fixtures.referenceOutputSnapshots[i].data[j])),
    "every selected output reference byte changed");
  // No referenceOutputSnapshots member is consulted by the source installer.
  for (const id of [3, 4, 7]) {
    c.ok(store.detachBacking(id), `poison proof detach input ${id}`);
    installFixtureBacking(store, poisonedFixtures.backing.find((entry) => entry.resourceId === id), c);
  }
  execute(command(161, 0), "poison-reference vertex upload");
  execute(command(161, 56), "poison-reference index upload");
  execute(command(161, 4736), "poison-reference texture upload");
  c.bytes(directGpuRead(gl, tracked.allocations.get(3), c, "poison-reference vertex"), VERTEX_BYTES, "poisoned references leave GPU vertex unchanged");
  c.bytes(directGpuRead(gl, tracked.allocations.get(4), c, "poison-reference index"), INDEX_BYTES, "poisoned references leave GPU index unchanged");
  c.bytes(directGpuRead(gl, tracked.allocations.get(6), c, "poison-reference texture"), TEXTURE_BYTES, "poisoned references leave GPU texture unchanged");

  const retainedAllocation = tracked.allocations.get(5);
  const retainedLease = c.ok(store.retainStorage(2, 5, "surface"), "retain actual GPU texture5").lease;
  c.ok(store.detachContext(2, 5), "detach retained actual GPU texture context");
  c.ok(store.detachBacking(5), "detach retained actual GPU texture backing");
  c.ok(store.unref(5), "actual GPU public unref texture5");
  c.truth(gl.isTexture(retainedAllocation.storage.texture), "leased actual GPU texture remains allocated");
  c.bad(store.retainStorage(2, 5, "surface"), "actual GPU lookup after unref fails");
  c.ok(store.createResource(textureMeta(5, 1, 1)), "reuse actual GPU texture ID5");
  c.ok(store.attachContext(2, 5), "attach reused actual GPU texture ID5");
  c.truth(tracked.allocations.get(5).storage.texture !== retainedAllocation.storage.texture, "reused public ID allocates distinct GPU storage");
  c.bytes(directGpuRead(gl, retainedAllocation, c, "retained old GPU storage"), pattern, "retained GPU storage survives public ID reuse");
  hostile.apply();
  c.bytes(c.ok(store.readStorage(retainedLease), "retained old GPU lease read").bytes, pattern, "retained lease reads old actual GPU storage");
  c.ok(store.releaseStorage(retainedLease), "release old actual GPU texture");
  c.equal(gl.isTexture(retainedAllocation.storage.texture), false, "last lease deletes old actual GPU texture");
  c.truth(gl.isTexture(tracked.allocations.get(5).storage.texture), "releasing old lease leaves reused GPU texture alive");

  const gpuBudgets = c.ok(store.inspect(), "GPU live accounting").budgets;
  const finalBudgets = fullCleanup(store, c, "GPU");
  c.equal(tracked.live.size, 0, "all actual WebGL allocations destroyed");
  hostile.dispose();
  c.equal(gl.getError(), gl.NO_ERROR, "final WebGL error state");
  const faultControls = trustedGlFaultControls(gl, c);
  return { status: "passed", guestExecution: false, native, gpu: { assertions: c.assertions,
    originalUploads: { vertex: [...vertex], index: [...index], texture: [...texture] },
    readbacks, scatterReadback: [...scatterOutput], defaultStrideReadback: [...defaultScatterOutput], referenceOutputBytesPoisoned: 12288,
    indexElementBinding: "passed", hostStatePoison: "passed", sourceOracle: "direct GPU objects",
    originalBudgets, liveBudgets: gpuBudgets, finalBudgets, faultControls, cases: c.cases } };
}
