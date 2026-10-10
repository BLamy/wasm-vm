import { createVirglStandardShaderBridge } from '../../virgl-shader/standard.mjs';
import { decodeStandardSubmission } from '../decoder.mjs';
import { checks, rig, meta, add, transfer, submit, dispose, join, clear, blob, hex } from './standard-instanced-draws.mjs';
import { constantSpec, constantDraw, constantSetup } from './standard-constant-attributes.mjs';
import { criticModel, criticPixels } from '../../../tools/virgl-command/standard-constant-adversarial-oracle.mjs';
const SEED = 0xa17c9e53;
function random(seed) { let n = seed >>> 0; return () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return n >>> 0; }; }
function specimen(short = false) {
  const s = constantSpec({ seed: SEED, components: [2, 4, 1, 3, 4], strides: [0, 16, 0, 0, 0],
    divisors: [0xffffffff, 2, 1, 0, 17], instances: 7, base: 0xb4d40000 });
  const next = random(SEED ^ 0x5a17e0d3), original = s.data.get(3), data = new Map();
  s.elements.forEach((e, i) => {
    const oldOffset = s.bindings[i][1] + e[0], stride = s.bindings[i][0], lanes = s.components[i],
      bufferOffset = 4 * (1 + next() % 11), sourceOffset = 4 * (1 + next() % 6),
      last = stride === 0 ? 0 : Math.floor((s.instances - 1) / s.divisors[i]), end = bufferOffset + sourceOffset + last * stride + lanes * 4;
    const bytes = new Uint8Array(end - (short && i === 4 ? 1 : 0));
    for (let n = 0; n <= last; n++) for (let k = 0; k < lanes * 4; k++) {
      const at = bufferOffset + sourceOffset + n * stride + k; if (at < bytes.length) bytes[at] = original[oldOffset + n * stride + k];
    }
    s.bindings[i] = [stride, bufferOffset, i + 3]; s.elements[i] = [sourceOffset, e[1], i, e[3]]; data.set(i + 3, bytes);
  });
  const old = s.data.get(22), indexOffset = 4 * (1 + next() % 9), index = new Uint8Array(indexOffset + s.ids.length * 4);
  index.set(old.subarray(s.indexOffset), indexOffset); s.indexOffset = indexOffset; data.set(22, index); s.data = data;
  return s;
}
function poison(gl) {
  gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 0, 0); gl.colorMask(false, false, false, false); gl.viewport(0, 0, 1, 1);
  for (let i = 0; i < gl.getParameter(gl.MAX_VERTEX_ATTRIBS); i++) { gl.enableVertexAttribArray(i); gl.vertexAttribDivisor(i, 13); gl.vertexAttrib4f(i, .17, .93, .61, .29); }
}
async function capture(r, record) {
  const { c, gl } = r; c.ok(record.result, 'critic completed draw'); c.same(record.result.gpuComplete, true, 'critic completion fence');
  const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.allocations[0].storage.texture, 0); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); for (const k of ['PACK_ROW_LENGTH', 'PACK_SKIP_PIXELS', 'PACK_SKIP_ROWS']) gl.pixelStorei(gl[k], 0); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const pixels = new Uint8Array(r.width * r.height * 4); gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.deleteFramebuffer(framebuffer);
  const draw = record.result.draws.at(-1), nativeBuffers = [];
  for (const [id, bytes] of r.bufferBytes) {
    const generation = id === 22 ? draw.indexResourceGeneration : draw.vertexFetches.find(a => a.resourceId === id).resourceGeneration,
      allocation = r.allocations.find(a => a.metadata.id === id && a.generation === generation), physical = new Uint8Array(bytes.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER, allocation.storage.buffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, physical); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    c.same(hex(physical), hex(bytes), 'critic native source equals original GPU upload ' + id);
    nativeBuffers.push({ resourceId: id, generation, nativeBuffer: r.trace.id(allocation.storage.buffer), blob: await blob(r, physical) });
  }
  const model = criticModel(r.history, r.bufferBytes, r.spec.used), audit = criticPixels(pixels, model, r.width, r.height),
    calls = r.trace.calls.filter(call => call.label === record.label).map(({ program, ...a }) => a), call = calls.at(-1),
    frame = { label: record.label, width: r.width, height: r.height, used: r.spec.used,
      history: r.history.map(h => ({ ...h })), inputs: r.exchanges.map(e => ({ ...e })),
      native: { calls, buffers: nativeBuffers }, predicted: { ids: model.ids, fetches: model.fetches }, audit, pixels: await blob(r, pixels) };
  r.frames.push(frame);
  // Sabotage must reach this named pixel check after the real draw and fence.
  c.same(audit.held, true, record.label + ' promoted independent pixel oracle');
  c.same(call.name, 'drawElementsInstanced', 'critic native wide-index instanced call');
  c.same(call.args, [5, 4, gl.UNSIGNED_INT, r.spec.indexOffset, 7], 'critic exact native arguments');
  for (const f of model.fetches) {
    const observed = draw.vertexFetches.find(a => a.attributeIndex === f.attributeIndex), a = call.attributes.find(a => a.name === 'in_' + f.attributeIndex);
    for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) c.same(observed[key], f[key], 'critic raw byte bound ' + key);
    c.same(a.enabled, !f.constant, 'critic array state'); c.same(a.divisor, f.nativeDivisor, 'critic native divisor');
    if (f.constant) { c.same(a.genericValues, f.genericValues, 'critic native defaults'); c.same(observed.componentWords, f.componentWords, 'critic raw words'); }
  }
  c.same(gl.getError(), gl.NO_ERROR, 'critic completed physical capture');
}
export async function runAcceptance({ smoke = false } = {}) {
  const c = checks(), report = { schema: 'D7-critic-hardware-v1', status: 'running', guestExecution: false, productionNegotiation: false,
    seed: SEED, predictions: c.rows, frames: [], runs: [], blobs: [], rejections: [], suspensions: [], invalidations: [] };
  window.__standardConstantEvidence = report;
  const gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true }), debug = gl.getExtension('WEBGL_debug_renderer_info');
  report.gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL); c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu), false, 'critic physical GPU');
  const bridge = await createVirglStandardShaderBridge(), make = (s, options = {}) => {
    const next = random(SEED ^ 0x1f124b9d), r = rig(gl, bridge, c, { width: s.width, height: s.height, step: 3, delay: () => 1 + next() % 7, ...options });
    r.frames = report.frames; r.blobs = report.blobs; return r;
  }, done = r => {
    const inspection = c.ok(r.renderer.inspect(), 'critic completed ownership'); c.same(inspection.jobs.reads, 0, 'critic no pending reads'); c.same(inspection.jobs.stagingBytes, 0, 'critic no pending staging');
    report.runs.push({ history: r.history, exchanges: r.exchanges, events: r.trace.events, calls: r.trace.calls.map(({ program, ...a }) => a), inspection }); dispose(r);
  };
  {
    const s = specimen(), r = make(s), a = await submit(r, 1, join(constantSetup(r, s), constantDraw(s)), 'critic-seeded-exact');
    await capture(r, a);
    if (!smoke) { poison(gl); await capture(r, await submit(r, 2, join(constantSetup(r, s, { create: false }), constantDraw(s)), 'critic-poison-B'));
      poison(gl); await capture(r, await submit(r, 1, join(clear([0, 0, 0, 0]), constantDraw(s)), 'critic-poison-A')); }
    done(r);
  }
  if (!smoke) {
    {
      const s = specimen(true), r = make(s), rec = await submit(r, 1, join(constantSetup(r, s), constantDraw(s)), 'critic-one-byte-short');
      c.same(rec.result.error.code, 'out-of-bounds', 'critic exact end minus one'); c.same(r.trace.calls.length, 0, 'critic short has no draw');
      report.rejections.push({ label: rec.label, record: rec, events: r.trace.events, draws: 0 }); done(r);
    }
    for (const budget of [56, 55]) {
      const s = specimen(), r = make(s, { jobLimits: { transferBytes: budget } }), rec = await submit(r, 1, join(constantSetup(r, s, { uploadChunk: budget }), constantDraw(s)), 'critic-budget-' + budget);
      if (budget === 56) await capture(r, rec); else { c.same(rec.result.error.code, 'limit-exceeded', 'critic aggregate minus one'); c.same(r.trace.events.filter(e => e.name === 'copyBufferSubData').length, 0, 'critic budget failure before any copy'); c.same(r.trace.calls.length, 0, 'critic budget failure before draw'); report.rejections.push({ label: rec.label, record: rec, events: r.trace.events, draws: 0 }); } done(r);
    }
    for (const action of ['collected-distinct', 'cancel', 'reuse', 'cpu-backing', 'reset-cancel', 'store-dispose']) {
      const s = specimen(), fenceCounts = new Map(), r = make(s, { step: 2, delay: ({ label }) => {
        const n = fenceCounts.get(label) ?? 0; fenceCounts.set(label, n + 1); return label === 'critic-pending-' + action ? n === 0 ? 0 : 9 : 2;
      } });
      c.ok((await submit(r, 1, constantSetup(r, s), 'critic-setup-' + action)).result, 'critic source setup');
      const oldGeneration = r.allocations.find(a => a.metadata.id === 3).generation; let point, changedSnapshot, fired = false, newGeneration;
      const rec = await submit(r, 1, join(clear([0, 0, 0, 0]), constantDraw(s)), 'critic-pending-' + action, async (_step, token) => {
        const inspection = c.ok(r.renderer.inspect(), 'critic suspension'); if (fired || inspection.jobs.status !== 'waiting-attributes') return;
        const collected = r.trace.events.filter(e => e.name === 'getBufferSubData' && e.label === 'critic-pending-' + action);
        if (action === 'collected-distinct' && !collected.length) return;
        fired = true; point = { inspection, collected, events: r.trace.events.map(e => ({ ...e })) }; c.same(inspection.jobs.reads, 5, 'critic all five reads retained');
        if (action === 'cancel' || action === 'reset-cancel') {
          if (action === 'reset-cancel') c.same(r.renderer.resetCaches().error.code, 'busy', 'critic reset rejects active batch'); c.ok(r.renderer.cancel(token), 'critic cancellation');
        } else if (action === 'collected-distinct') {
          c.same(collected.length, 1, 'critic only first source collected');
          const original = s.data.get(3), changed = original.slice(), v = new DataView(changed.buffer), at = s.bindings[0][1] + s.elements[0][0]; v.setFloat32(at, .875, true); v.setFloat32(at + 4, .125, true);
          c.ok(r.store.writeBacking(3, 0, changed), 'critic changed first backing');
          const command = c.ok(decodeStandardSubmission(transfer(3, changed.length)), 'critic distinct upload packet').commands[0], access = c.ok(r.store.prepareTransfer(1, command), 'critic distinct upload ticket');
          c.ok(r.store.executeTransfer(access.ticket), 'critic actual distinct GPU upload');
          const actual = new Uint8Array(changed.length), native = r.allocations.find(a => a.metadata.id === 3).storage.buffer;
          gl.bindBuffer(gl.COPY_READ_BUFFER, native); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, actual); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
          c.same(hex(actual), hex(changed), 'critic changed source physically read back');
          changedSnapshot = { resourceId: 3, generation: oldGeneration, original: await blob(r, original), changed: await blob(r, changed), actual: await blob(r, actual), otherPendingResources: [5, 6, 7, 22] };
        } else if (action === 'reuse') {
          c.ok(r.store.unref(3), 'critic retire collected public name'); newGeneration = add(r, meta(3, 0, 64, 16, s.data.get(3).length), new Uint8Array(s.data.get(3).length)).generation; c.same(newGeneration > oldGeneration, true, 'critic reused generation');
        } else if (action === 'cpu-backing') { const b = s.data.get(3).slice(); b.fill(127); c.ok(r.store.writeBacking(3, 0, b), 'critic CPU-only backing mutation'); }
        else c.ok(r.store.dispose(), 'critic store invalidation');
      });
      c.same(fired, true, 'critic actual suspension reached');
      if (action === 'reuse' || action === 'cpu-backing') { await capture(r, rec); c.same(rec.result.draws[0].vertexFetches[0].resourceGeneration, oldGeneration, 'critic retained original generation'); }
      else { c.same(rec.result.ok, false, 'critic invalid batch fails'); c.same(r.trace.calls.length, 0, 'critic invalid batch never draws'); c.same(rec.result.gpuComplete, action !== 'store-dispose', 'critic drain versus invalidation');
        if (action !== 'store-dispose') c.same(rec.result.error.code, action === 'collected-distinct' ? 'stale-storage' : 'cancelled', 'critic pending error');
        if (action === 'reset-cancel') c.ok(r.renderer.resetCaches(), 'critic drained reset'); }
      report.suspensions.push({ action, point, changedSnapshot, oldGeneration, newGeneration, record: rec, async: r.asyncAccess.inspect(), events: r.trace.events }); done(r);
    }
    {
      const s = specimen(), r = make(s, { resourceLimits: { tickets: 1 } }), rec = await submit(r, 1, join(constantSetup(r, s), constantDraw(s)), 'critic-partial-allocation');
      c.same(rec.result.error.code, 'limit-exceeded', 'critic partial limit'); c.same(rec.result.gpuComplete, true, 'critic first real copy drains'); c.same(r.trace.events.filter(e => e.name === 'copyBufferSubData').length, 1, 'critic first real GPU copy'); c.same(r.trace.calls.length, 0, 'critic partial allocation no draw');
      report.rejections.push({ label: rec.label, record: rec, events: r.trace.events, draws: 0 }); done(r);
    }
    {
      const s = specimen(), r = make(s, { delay: 7 }); c.ok((await submit(r, 1, constantSetup(r, s), 'critic-dispose-setup')).result, 'critic disposal sources');
      const token = c.ok(r.renderer.beginSubmission(1, constantDraw(s)), 'critic disposal job').job;
      for (let i = 0; i < 1000; i++) { await new Promise(resolve => setTimeout(resolve, 0)); r.trace.nextTurn(); c.ok(r.renderer.step(token), 'critic dispose later task'); if (r.renderer.inspect().jobs.status === 'waiting-attributes') break; }
      const before = c.ok(r.renderer.inspect(), 'critic disposal state'); c.same(before.jobs.reads, 5, 'critic disposal owns five tickets'); c.ok(r.renderer.dispose(), 'critic explicit renderer invalidation'); const after = r.asyncAccess.inspect();
      c.same(after.reads, 0, 'critic disposal releases reads'); c.same(after.stagingBytes, 0, 'critic disposal releases staging'); c.same(r.renderer.step(token).ok, false, 'critic disposed job rejected');
      report.invalidations.push({ action: 'renderer-dispose', before, after, events: r.trace.events, nativeDraws: r.trace.calls.length }); dispose(r);
    }
  }
  report.status = 'passed'; return report;
}
