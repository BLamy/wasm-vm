// Fresh critic: SHA256-derived original fields, truncated private mip ranges,
// GPU-only refresh, opposite-format ID reuse and completed native sabotage.
// Expected fields are prepared independently before recorded evidence access.
import { checks, rig, add, finish, blob, nativeRead, physicalFence, poll, gpuClear } from './standard-floating-depth-rig.mjs';
import { command } from './standard-integer-images.mjs';

const unhex = text => Uint8Array.from(text.match(/../g) ?? [], value => Number.parseInt(value, 16));
const hex = raw => [...raw].map(value => value.toString(16).padStart(2, '0')).join('');
function packet(opcode, words) {
  const raw = new Uint8Array((words.length + 1) * 4), data = new DataView(raw.buffer);
  data.setUint32(0, opcode | words.length << 16, true);
  words.forEach((word, index) => data.setUint32((index + 1) * 4, word, true));
  return raw;
}
function wire(plane, direction = 1, inline = false) {
  const fields = [6, plane.level, 0, plane.stride, 0, plane.x ?? 0, plane.y ?? 0, 0, plane.width, plane.height, 1];
  if (!inline) return packet(43, [...fields, plane.offset, direction]);
  const input = unhex(plane.inputHex), row = input.length / plane.height, span = (plane.height - 1) * plane.stride + row;
  const padded = new Uint8Array(Math.ceil(span / 4) * 4).fill(0x51), view = new DataView(padded.buffer);
  for (let y = 0; y < plane.height; y++) padded.set(input.subarray(y * row, (y + 1) * row), y * plane.stride);
  return packet(9, [...fields, ...Array.from({ length: padded.length / 4 }, (_, i) => view.getUint32(i * 4, true))]);
}
function fieldMisses(format, expected, raw, publicFields = false) {
  const size = format === 126 ? 8 : 4, count = expected.length, misses = [];
  if (raw.length !== count * (publicFields ? size : 20)) return [{ field: 'complete-byte-count', expected: count * (publicFields ? size : 20), observed: raw.length }];
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const fail = value => { if (misses.length < 8) misses.push(value); };
  expected.forEach((prediction, pixel) => {
    const depth = view.getUint32(pixel * (publicFields ? size : 16), true);
    if (!prediction.depthAllowed.includes(depth)) fail({ pixel, field: 'depth', expected: prediction.depthAllowed, observed: depth });
    if (!publicFields) for (let lane = 1; lane < 4; lane++) {
      const value = view.getUint32(pixel * 16 + lane * 4, true), wanted = lane === 3 ? 1 : 0;
      if (value !== wanted) fail({ pixel, field: 'native-diagnostic-lane', lane, expected: wanted, observed: value });
    }
    if (publicFields && format === 126) for (let byte = 4; byte < 8; byte++) {
      const value = raw[pixel * 8 + byte], wanted = byte === 4 ? prediction.stencil : 0;
      if (value !== wanted) fail({ pixel, field: byte === 4 ? 'stencil' : 'canonical-X24', byte, expected: wanted, observed: value });
    }
    if (!publicFields) for (let lane = 0; lane < 4; lane++) {
      const value = raw[count * 16 + pixel * 4 + lane], wanted = lane === 0 ? prediction.stencil : 0;
      if (value !== wanted) fail({ pixel, field: 'native-stencil', lane, expected: wanted, observed: value });
    }
  });
  return misses;
}
function corruptStencil(r, texture, level, expected) {
  const gl = r.traced, read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  const enabled = gl.isEnabled(gl.SCISSOR_TEST), box = gl.getParameter(gl.SCISSOR_BOX), front = gl.getParameter(gl.STENCIL_WRITEMASK), back = gl.getParameter(gl.STENCIL_BACK_WRITEMASK);
  const framebuffer = gl.createFramebuffer(), delivered = (expected + 1) & 255;
  try {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, texture, level);
    gl.drawBuffers([gl.NONE]);
    if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('critic stencil sabotage framebuffer incomplete');
    gl.enable(gl.SCISSOR_TEST); gl.scissor(1, 1, 1, 1); gl.stencilMask(255);
    gl.clearBufferiv(gl.STENCIL, 0, new Int32Array([delivered]));
    if (gl.getError() !== gl.NO_ERROR) throw Error('critic native stencil sabotage failed');
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl[enabled ? 'enable' : 'disable'](gl.SCISSOR_TEST); gl.scissor(...box);
    gl.stencilMaskSeparate(gl.FRONT, front); gl.stencilMaskSeparate(gl.BACK, back); gl.deleteFramebuffer(framebuffer);
  }
  return { field: 'actual-private-native-stencil', local: level, x: 1, y: 1, original: expected, delivered };
}

export async function runAcceptance({ fault = null } = {}) {
  const originals = await (await fetch('/renderer/virgl-command/tests/standard-floating-depth-critic-originals.json')).json();
  const c = checks(), gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  if (!gl) throw Error('critic requires actual WebGL2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const report = { schema: 'fresh-original-floating-depth-ranges-v1', status: 'running', guestExecution: false,
    productionNegotiation: false, productionDrawAuthority: false, gpu: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
    fault, runs: [], blobs: [], predictions: c.rows, originalSchema: originals.schema };
  window.__standardFloatingDepthEvidence = report;
  for (const source of originals.rows.filter(row => !fault || row.format === 126).slice(0, fault ? 1 : originals.rows.length)) {
    const format = source.format, packed = format === 126, size = packed ? 8 : 4;
    const metadata = { id: 6, target: 2, format, bind: 9, width: 15, height: 9, depth: 1, arraySize: 1, lastLevel: 3, nrSamples: 0, flags: 0 };
    const backing = unhex(source.backingHex), r = rig(gl, c, { delay: source.seed % 3 + 1 });
    const row = { kind: 'fresh-original-private-range', seed: source.seed, metadata, backing: await blob(report, backing), planes: [], views: [], wires: [], originalLogicalBytes: source.originalLogicalBytes, originalOwnedBytes: source.originalOwnedBytes };
    report.runs.push(row);
    try {
      const resource = add(r, metadata, backing), storage = r.allocations[0].storage;
      row.sourceGeneration = resource.generation; row.sourceTexture = r.trace.id(storage.texture);
      for (const plane of source.planes) {
        const raw = unhex(plane.inputHex), original = raw.slice(), bytes = wire(plane);
        row.planes.push({ ...plane, input: await blob(report, original) });
        const prepared = c.ok(r.asyncAccess.prepareTransfer(1, command(bytes)), 'critic original transfer preparation');
        c.ok(r.asyncAccess.provideInput(prepared.ticket, raw), 'critic own original field custody'); raw.fill(255);
        r.setLabel('critic-original-upload-' + plane.level); c.ok(r.asyncAccess.upload(prepared.ticket), 'critic physical original upload');
        c.ok(r.asyncAccess.release(prepared.ticket), 'critic original input release'); row.wires.push({ wire: hex(bytes), layout: prepared.layout });
      }
      row.uploadFence = await physicalFence(r, 'critic-original-upload-completed');
      for (const plane of source.planes) {
        const native = await nativeRead(r, storage.texture, plane.width, plane.height, plane.level, packed);
        row.planes[plane.level].native = await blob(report, native);
        c.same(fieldMisses(format, plane.predictions, native), [], 'critic independently predicted complete original native fields');
      }
      const lease = c.ok(r.store.retainStorage(1, 6, 'view'), 'critic original retained generation').lease;
      const capture = c.ok(r.imageAccess.capture(lease, 1, 2), 'critic private truncated original range');
      const resolved = c.ok(r.imageAccess.resolve(capture.token), 'critic native private range identity');
      row.privateMetadata = resolved.metadata; row.privateTexture = r.trace.id(resolved.storage.texture); row.privateGeneration = resolved.generation;
      c.same(resolved.metadata.gpuByteLength, source.privateOwnedBytes, 'critic private native texture and persistent PBO complete charge');
      row.afterCapture = r.store.inspect(); c.same(row.afterCapture.budgets.gpuBytes, source.originalOwnedBytes + source.privateOwnedBytes, 'critic private charge precedes native refresh');
      r.setLabel('critic-initial-native-range-copy'); c.ok(r.imageAccess.refresh(capture.token), 'critic original native range refresh');
      row.initialCopyFence = await physicalFence(r, 'critic-initial-range-completed');
      row.initialPrivate = [];
      for (let local = 0; local < 2; local++) {
        const plane = source.planes[local + 1], native = await nativeRead(r, resolved.storage.texture, plane.width, plane.height, local, packed);
        row.initialPrivate.push({ local, original: local + 1, native: await blob(report, native) });
        c.same(fieldMisses(format, plane.predictions, native), [], 'critic truncated local level preserves original fields');
      }
      row.backingBeforeMutation = await blob(report, c.ok(r.store.readBacking(6, 0, backing.length), 'critic complete backing before GPU mutation').bytes);
      const patch = wire(source.patch, 1, true), preparedPatch = c.ok(r.store.prepareTransfer(2, command(patch)), 'critic nonzero partial original mip');
      r.setLabel('critic-nonzero-level-one-patch'); c.ok(r.store.executeTransfer(preparedPatch.ticket), 'critic actual native partial mip patch');
      row.patch = { ...source.patch, wire: hex(patch), layout: preparedPatch.layout, input: await blob(report, unhex(source.patch.inputHex)), fence: await physicalFence(r, 'critic-partial-mip-completed') };
      r.setLabel('critic-GPU-only-original-level-two'); gpuClear(r, storage.texture, 2, [source.clear.depth, source.clear.stencil], packed);
      row.clear = { ...source.clear, fence: await physicalFence(r, 'critic-GPU-only-clear-completed') };
      r.setLabel('critic-refreshed-native-range-copy'); c.ok(r.imageAccess.refresh(capture.token), 'critic GPU-only refresh with stale guest backing');
      row.refreshFence = await physicalFence(r, 'critic-refreshed-range-completed');
      const unchanged = c.ok(r.store.readBacking(6, 0, backing.length), 'critic complete backing after native mutation').bytes;
      row.backingAfterMutation = await blob(report, unchanged); c.same(hex(unchanged), source.backingHex, 'critic native mutation and refresh preserve all segmented backing');
      if (fault) {
        r.setLabel('critic-completed-private-stencil-corruption');
        row.corruption = corruptStencil(r, resolved.storage.texture, 1, 0xdb);
        row.secondFence = await physicalFence(r, 'critic-stencil-corruption-second-completion');
        c.same(row.secondFence.sync === row.refreshFence.sync, false, 'critic completed native mutation has a distinct second physical fence');
      }
      row.refreshedPrivate = [];
      for (let local = 0; local < 2; local++) {
        const plane = source.planes[local + 1], native = await nativeRead(r, resolved.storage.texture, plane.width, plane.height, local, packed);
        const misses = fieldMisses(format, source.afterMutationPredictions[local + 1], native);
        row.refreshedPrivate.push({ local, original: local + 1, native: await blob(report, native), misses });
        if (fault && local === 1) report.sabotage = { fault, originalFence: row.refreshFence, fence: row.secondFence, fenceCompleted: true, held: misses.length === 0, misses, nativeMutation: row.corruption };
        c.same(misses, [], 'critic unchanged independent private native field inverse');
      }
      row.publicTransfers = [];
      for (const plane of source.planes) {
        const bytes = wire(plane, 2), prepared = c.ok(r.store.prepareTransfer(2, command(bytes)), 'critic public original mip read');
        r.setLabel('critic-public-original-mip-' + plane.level); c.ok(r.store.executeTransfer(prepared.ticket), 'critic actual public native field read');
        const output = new Uint8Array(plane.width * plane.height * size);
        for (let y = 0; y < plane.height; y++) output.set(c.ok(r.store.readBacking(6, plane.offset + y * plane.stride, plane.width * size), 'critic complete public row').bytes, y * plane.width * size);
        row.publicTransfers.push({ level: plane.level, wire: hex(bytes), layout: prepared.layout, public: await blob(report, output) });
        c.same(fieldMisses(format, source.afterMutationPredictions[plane.level], output, true), [], 'critic independent public depth stencil and X24 inverse');
      }
      const hold = c.ok(r.imageAccess.hold(capture.token), 'critic old private completion hold').token;
      const pending = c.ok(r.asyncAccess.prepareTransfer(2, command(wire(source.planes[1], 2))), 'critic queued old nonzero mip read');
      r.setLabel('critic-queued-old-mip-read'); c.ok(r.asyncAccess.beginTransferRead(pending.ticket), 'critic physical queued old mip read');
      row.beforeReuse = r.store.inspect(); c.ok(r.store.unref(6), 'critic original public generation retires');
      const replacement = originals.rows.find(row => row.seed === source.seed && row.format !== format);
      const reused = add(r, { ...metadata, format: replacement.format }, unhex(replacement.backingHex));
      row.replacement = { format: replacement.format, generation: reused.generation, texture: r.trace.id(r.allocations.at(-1).storage.texture), backing: await blob(report, unhex(replacement.backingHex)) };
      c.same(reused.generation === resource.generation, false, 'critic opposite-format original ID reuse changes generation');
      c.same(row.replacement.texture === row.sourceTexture, false, 'critic opposite-format original ID has unequal native texture');
      c.same(r.asyncAccess.validate(pending.ticket).ok, false, 'critic old queued original transfer is stale');
      c.same(r.asyncAccess.poll(pending.ticket).ok, false, 'critic stale old original fields cannot publish into replacement');
      const discarded = await poll(r, pending.ticket, { discard: true });
      row.discarded = { status: discarded.status, fence: r.trace.events.filter(event => event.name === 'clientWaitSync').at(-1) };
      c.ok(r.asyncAccess.release(pending.ticket), 'critic physically completed old read releases once');
      c.ok(r.store.destroyContext(1), 'critic old view context generation retires');
      c.same(r.imageAccess.resolve(capture.token).ok, false, 'critic stale old view refuses public access');
      c.ok(r.imageAccess.release(capture.token), 'critic old public private view releases'); c.ok(r.store.releaseStorage(lease), 'critic old original storage lease releases');
      row.beforeHoldRelease = r.store.inspect(); row.heldPrivate = [];
      for (let local = 0; local < 2; local++) {
        const plane = source.planes[local + 1], native = await nativeRead(r, resolved.storage.texture, plane.width, plane.height, local, packed);
        row.heldPrivate.push({ local, original: local + 1, native: await blob(report, native) });
        c.same(fieldMisses(format, source.afterMutationPredictions[local + 1], native), [], 'critic old truncated native fields survive format and context reuse');
      }
      c.ok(r.imageAccess.release(hold), 'critic final old private native hold retires'); row.afterHoldRelease = r.store.inspect();
      c.same(row.afterHoldRelease.budgets.gpuBytes, replacement.originalOwnedBytes, 'critic final hold releases old source texture private texture and PBO charges');
      const replacementAfter = c.ok(r.store.readBacking(6, 0, unhex(replacement.backingHex).length), 'critic replacement backing after old completion').bytes;
      row.replacementAfter = await blob(report, replacementAfter); c.same(hex(replacementAfter), replacement.backingHex, 'critic old native completion never changes opposite-format replacement backing');
      c.same(gl.getError(), gl.NO_ERROR, 'critic original field range attack has no native errors');
    } finally { await finish(r, report, row); }
  }
  report.status = 'passed'; return report;
}
