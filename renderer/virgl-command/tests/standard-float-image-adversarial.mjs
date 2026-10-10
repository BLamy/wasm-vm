import {createStandardFloatColorResourceStore, createStandardFloatColorTransferBackend} from '../resources.mjs';

const hex = data => Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), b => b.toString(16).padStart(2, '0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g) ?? [], x => Number.parseInt(x, 16));
const ok = result => { if (!result.ok) throw Error(JSON.stringify(result.error)); return result; };
const same = (actual, wanted, label) => { if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw Error(label + ': ' + JSON.stringify({actual, wanted})); };

function traced(gl, fault, row) {
  const objects = new Map(), methods = new Map(); let next = 1;
  const id = value => value ? objects.get(value)?.id ?? null : null;
  const proxy = new Proxy(gl, {get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    if (methods.has(name)) return methods.get(name);
    const invoke = (...original) => {
      const args = [...original];
      if (fault && name === 'texStorage2D' && args[2] === gl.R32F) {
        args[2] = gl.R16F;
        row.faults.push({name, original: original[2], delivered: args[2]});
      }
      const answer = value.apply(target, args);
      if (/^create(Buffer|Texture|Framebuffer|VertexArray)$/.test(name) && answer) {
        objects.set(answer, {id: next++, name, deletes: 0});
      }
      if (name === 'fenceSync' && answer) objects.set(answer, {id: next++, name, deletes: 0});
      if (/^delete(Buffer|Texture|Framebuffer|VertexArray|Sync)$/.test(name) && original[0]) {
        const owned = objects.get(original[0]); if (owned) { owned.deletes++; same(owned.deletes, 1, 'native object deletes once'); }
      }
      const selected = ['texStorage2D', 'texSubImage2D', 'texParameteri', 'bufferData', 'framebufferTexture2D', 'blitFramebuffer', 'readPixels', 'getBufferSubData', 'fenceSync', 'clientWaitSync', 'deleteSync', 'deleteTexture', 'deleteBuffer'];
      if (selected.includes(name)) {
        const event = {ordinal: row.events.length, name, args: args.map(v => ArrayBuffer.isView(v) ? {type: v.constructor.name, bytes: v.byteLength, hex: hex(v)} : v && typeof v === 'object' ? id(v) : v)};
        if (name === 'texStorage2D' || name === 'texSubImage2D') event.texture = id(gl.getParameter(gl.TEXTURE_BINDING_2D));
        if (name === 'bufferData') event.buffer = id(gl.getParameter(args[0] === gl.PIXEL_PACK_BUFFER ? gl.PIXEL_PACK_BUFFER_BINDING : gl.COPY_WRITE_BUFFER_BINDING));
        if (name === 'readPixels') event.buffer = id(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING));
        if (name === 'getBufferSubData') event.buffer = id(gl.getParameter(gl.COPY_READ_BUFFER_BINDING));
        if (name === 'clientWaitSync') event.actual = answer;
        if (name === 'fenceSync') event.sync = id(answer);
        if (name === 'blitFramebuffer') {
          for (const [role, framebuffer] of [['source', gl.READ_FRAMEBUFFER], ['target', gl.DRAW_FRAMEBUFFER]]) {
            event[role] = id(gl.getFramebufferAttachmentParameter(framebuffer, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME));
            event[role + 'Level'] = gl.getFramebufferAttachmentParameter(framebuffer, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL);
          }
        }
        row.events.push(event);
      }
      return answer;
    };
    methods.set(name, invoke); return invoke;
  }});
  return {gl: proxy, id, objects};
}

async function fence(t) {
  const gl = t.gl, sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); same(Boolean(sync), true, 'physical sync'); gl.flush();
  let completed;
  try {
    for (let i = 0; i < 1000; i++) {
      await new Promise(resolve => setTimeout(resolve, i % 3));
      const actual = gl.clientWaitSync(sync, 0, 0);
      if (actual === gl.ALREADY_SIGNALED || actual === gl.CONDITION_SATISFIED) { completed = {sync: t.id(sync), actual}; break; }
      same(actual, gl.TIMEOUT_EXPIRED, 'legal physical wait');
    }
    same(Boolean(completed), true, 'physical fence completed'); return completed;
  } finally { gl.deleteSync(sync); }
}

function native(t, texture, plane, level) {
  const gl = t.gl, framebuffer = gl.createFramebuffer(), data = new Float32Array(plane.width * plane.height * 4);
  try {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); same(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'native plane complete');
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    for (const property of ['PACK_ROW_LENGTH', 'PACK_SKIP_PIXELS', 'PACK_SKIP_ROWS']) gl.pixelStorei(gl[property], 0);
    gl.readPixels(0, 0, plane.width, plane.height, gl.RGBA, gl.FLOAT, data);
    return hex(data);
  } finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.deleteFramebuffer(framebuffer); }
}

function command(metadata, plane, direction = 1, box = null) {
  return {opcode: 43, fields: {resourceHandle: metadata.id, level: plane.level, usage: 0, stride: plane.stride, layerStride: 0,
    box: box ?? {x: 0, y: 0, z: 0, width: plane.width, height: plane.height, depth: 1}, dataOffset: plane.offset, direction}};
}

async function poll(owner, token, discard = false) {
  for (let i = 0; i < 1000; i++) {
    await new Promise(resolve => setTimeout(resolve, i % 3)); const result = ok(owner.asyncAccess.poll(token, discard));
    if (result.status === 'ready') return result;
  }
  throw Error('physical PBO completion exceeded bound');
}

function halfValue(word) {
  const sign = word & 0x8000 ? -1 : 1, e = word >> 10 & 31, f = word & 1023;
  return sign * (e ? (1024 + f) * 2 ** (e - 25) : f * 2 ** -24);
}
function mismatch(spec, input, observed) {
  const original = bytes(input), data = new DataView(original.buffer), actual = bytes(observed), floats = new DataView(actual.buffer), misses = [];
  const pixels = original.length / (spec.components * spec.size);
  for (let pixel = 0; pixel < pixels; pixel++) for (let lane = 0; lane < 4; lane++) {
    const at = (pixel * spec.components + lane) * spec.size;
    const wanted = lane < spec.components ? spec.precision === 16 ? halfValue(data.getUint16(at, true)) : data.getFloat32(at, true) : lane === 3 ? 1 : 0;
    const got = floats.getFloat32((pixel * 4 + lane) * 4, true);
    if (wanted !== got) misses.push({pixel, lane, wanted, observed: got});
  }
  return misses;
}

export async function runAdversarial({specs, fault = false}) {
  const gl = document.querySelector('canvas').getContext('webgl2', {antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true});
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const report = {schema: 'independent-native-floating-images-v1', guestExecution: false, productionDrawAuthority: false,
    gpu: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), fault, status: 'running', runs: []};
  window.__criticFloatImages = report;
  for (const spec of fault ? specs.filter(s => s.format === 28).slice(0, 1) : specs) {
    const row = {seed: spec.seed, format: spec.format, events: [], faults: [], allocations: [], operations: [], observations: [], snapshots: []}; report.runs.push(row);
    const t = traced(gl, fault, row), backend = ok(createStandardFloatColorTransferBackend(t.gl)).backend;
    const owner = ok(createStandardFloatColorResourceStore({backend: {...backend, allocate(meta) {
      const storage = backend.allocate(meta); row.allocations.push({metadata: meta, texture: t.id(storage.texture)}); return storage;
    }}}));
    const store = owner.store;
    const snapshot = point => row.snapshots.push({point, state: store.inspect(), async: owner.asyncAccess.inspect(), images: owner.imageAccess.inspect()});
    const add = source => {
      const resource = ok(store.createResource(source.metadata)).resource, backing = bytes(source.backing), cuts = [1, 4, 11, 27, 65, backing.length];
      let start = 0; const segments = [];
      for (const end of cuts) { if (end > start && end <= backing.length) { segments.push(backing.subarray(start, end)); start = end; } }
      ok(store.attachBacking(source.metadata.id, segments)); backing.fill(0);
      for (const context of [1, 2]) ok(store.attachContext(context, source.metadata.id));
      return resource;
    };
    const upload = source => {
      for (const plane of source.planes) {
        const prepared = ok(store.prepareTransfer(1, command(source.metadata, plane)));
        row.operations.push({kind: 'initial-upload', command: command(source.metadata, plane), layout: prepared.layout, queued: store.inspect()});
        ok(store.executeTransfer(prepared.ticket));
      }
    };
    try {
      for (const context of [1, 2]) ok(store.createContext(context));
      const first = add(spec); row.originalGeneration = first.generation;
      same(first.byteLength, spec.predicted.logicalBytes, 'independently predicted logical allocation'); same(first.gpuByteLength, spec.predicted.physicalBytes, 'independently predicted physical allocation');
      const oldLease = ok(store.retainStorage(1, 37, 'view')).lease, source = ok(owner.bindings.resolve(oldLease)).storage.texture;
      row.initialFence = await fence(t); row.initialNative = native(t, source, spec.planes[0], 0);
      upload(spec); const uploadFence = await fence(t); row.uploadFence = uploadFence;
      for (const plane of spec.planes) {
        const observed = native(t, source, plane, plane.level); row.observations.push({kind: 'initial-plane', level: plane.level, native: observed, fence: uploadFence});
        const misses = mismatch(spec, plane.input, observed);
        if (fault && misses.length) { report.control = {fenceCompleted: true, fence: uploadFence, misses, observation: row.observations.at(-1)}; throw Error('unchanged independent original-value oracle rejects actual R32F to R16F'); }
        same(misses, [], 'independent original native input');
      }
      const view = ok(owner.imageAccess.capture(oldLease, 1, 3)), resolved = ok(owner.imageAccess.resolve(view.token)); row.view = {metadata: resolved.metadata, generation: resolved.generation, texture: t.id(resolved.storage.texture)};
      same(resolved.metadata.byteLength, spec.predicted.viewLogicalBytes, 'independent private logical bytes'); same(resolved.metadata.gpuByteLength, spec.predicted.viewPhysicalBytes, 'independent private native bytes');
      ok(owner.imageAccess.refresh(view.token)); row.firstViewFence = await fence(t);
      for (const plane of spec.planes.slice(1, 4)) row.observations.push({kind: 'initial-view', level: plane.level, local: plane.level - 1, native: native(t, resolved.storage.texture, plane, plane.level - 1), fence: row.firstViewFence});
      const patch = spec.patch, patchCommand = command(spec.metadata, patch, 1, patch.box), prepared = ok(owner.asyncAccess.prepareTransfer(1, patchCommand));
      same(prepared.layout.scratchBytes, spec.predicted.patchScratchBytes, 'nonzero partial native upload scratch');
      const supplied = bytes(patch.input); ok(owner.asyncAccess.provideInput(prepared.ticket, supplied)); supplied.fill(255);
      row.operations.push({kind: 'partial-upload', command: patchCommand, layout: prepared.layout, queued: store.inspect()});
      ok(owner.asyncAccess.upload(prepared.ticket)); ok(owner.asyncAccess.release(prepared.ticket));
      const fullRead = ok(owner.asyncAccess.prepareTransfer(1, command(spec.metadata, spec.planes[1], 2)));
      same(fullRead.layout.scratchBytes, spec.predicted.readScratchBytes, 'exact float read scratch');
      ok(owner.asyncAccess.beginTransferRead(fullRead.ticket)); snapshot('queued-mip-read'); const output = await poll(owner, fullRead.ticket);
      row.publicRead = {level: 1, native: hex(output.bytes), layout: fullRead.layout}; ok(owner.asyncAccess.release(fullRead.ticket));
      const beforeNativeMutation = ok(store.readBacking(37, 0, bytes(spec.backing).length)).bytes;
      const mutation = spec.mutation, wordBytes = bytes(mutation.input), expanded = new Uint8Array(spec.nativeComponents * spec.size);
      expanded.set(wordBytes); if (spec.components === 3) {
        const view = new DataView(expanded.buffer);
        if (spec.precision === 16) view.setUint16(6, 0x3c00, true); else view.setUint32(12, 0x3f800000, true);
      }
      const uploadType = spec.precision === 16 ? new Uint16Array(expanded.buffer) : new Float32Array(expanded.buffer);
      t.gl.activeTexture(gl.TEXTURE0); t.gl.bindTexture(gl.TEXTURE_2D, source);
      t.gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); t.gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      t.gl.texSubImage2D(gl.TEXTURE_2D, mutation.level, mutation.x, mutation.y, 1, 1, [gl.RED, gl.RG, gl.RGBA, gl.RGBA][spec.components - 1], spec.precision === 16 ? gl.HALF_FLOAT : gl.FLOAT, uploadType);
      row.backingBeforeMutation = hex(beforeNativeMutation); row.backingAfterMutation = hex(ok(store.readBacking(37, 0, beforeNativeMutation.length)).bytes);
      same(row.backingAfterMutation, row.backingBeforeMutation, 'native-only revision has unchanged backing');
      ok(owner.imageAccess.refresh(view.token)); row.refreshFence = await fence(t);
      for (const plane of spec.planes.slice(1, 4)) row.observations.push({kind: 'refreshed-view', level: plane.level, local: plane.level - 1, native: native(t, resolved.storage.texture, plane, plane.level - 1), fence: row.refreshFence});
      const hold = ok(owner.imageAccess.hold(view.token)).token, box = {x: 3, y: 2, z: 0, width: 7, height: 4, depth: 1}, old = ok(owner.asyncAccess.beginStorageRead(oldLease, box));
      same(old.layout.scratchBytes, spec.predicted.oldReadScratchBytes, 'partial old generation float scratch'); snapshot('queued-old-read');
      ok(store.unref(37)); const replacement = add(spec.replacement); row.newGeneration = replacement.generation; same(replacement.generation > first.generation, true, 'unequal ID reuse'); upload(spec.replacement);
      snapshot('old-and-new-queued'); const retired = await poll(owner, old.ticket); row.oldPublicRead = {generation: first.generation, box, native: hex(retired.bytes), layout: old.layout}; ok(owner.asyncAccess.release(old.ticket));
      const oldView = ok(owner.imageAccess.resolve(view.token)); same(oldView.generation, first.generation, 'private range stays old generation');
      ok(owner.imageAccess.release(view.token)); ok(store.releaseStorage(oldLease)); snapshot('only-hold-retains-old');
      row.holdFence = await fence(t); ok(owner.imageAccess.release(hold)); same(store.inspect().resources.some(x => x.generation === first.generation), false, 'old native ranges retire after physical completion');
      const fresh = ok(store.retainStorage(2, 37, 'readback')).lease, freshBox = {x: 0, y: 0, z: 0, width: 7, height: 3, depth: 1};
      const cancelled = ok(owner.asyncAccess.beginStorageRead(fresh, freshBox)); await poll(owner, cancelled.ticket, true); ok(owner.asyncAccess.release(cancelled.ticket));
      const pending = ok(owner.asyncAccess.beginStorageRead(fresh, freshBox)); snapshot('dispose-pending-read'); ok(store.dispose());
      same(owner.asyncAccess.poll(pending.ticket).ok, false, 'disposed PBO cannot collect'); ok(owner.asyncAccess.release(pending.ticket)); same(owner.asyncAccess.release(pending.ticket).ok, false, 'revoked PBO releases once');
      same(gl.getError(), gl.NO_ERROR, 'no native error in partial/range experiment');
    } finally {
      ok(store.dispose()); row.final = store.inspect(); row.objects = [...t.objects.values()];
      for (const item of row.objects) same(item.deletes, 1, 'all native objects deleted once');
      for (const value of Object.values(row.final.budgets)) same(value, 0, 'all terminal ownership bytes zero');
    }
  }
  report.status = 'passed'; return report;
}
