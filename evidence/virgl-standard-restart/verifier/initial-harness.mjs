import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeSubmission, decodeStandardSubmission} from '../decoder.mjs';
import {checks, meta, add, transfer, clear, dispose, packet, join, blob, hex} from './standard-instanced-draws.mjs';
import {restartSpec, restartSetup, restartDraw, restartRig, restartSubmit} from './standard-primitive-restart.mjs';
import {independentRestart, compareRestartPixels, literalRestartAdmission} from '../../../tools/virgl-command/standard-restart-adversarial-oracle.mjs';

export const SEED = 0xc37a4d29;
const random = (() => {let x = SEED; return () => {x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0;};})();
function specimen(options = {}) {
  const s = restartSpec({seed: SEED, mode: 2, indexSize: 4, base: 0x20000, instances: 4, restartIndex: 0x9d620431,
    indexOffset: 44, offsets: [44, 20, 60], sourceOffsets: [12, 28, 4], ...options});
  if (s.indexSize === 4 && s.pattern !== 'all') {
    // Nonmonotonic wide IDs, with geometry and exact native-ID tags generated
    // independently of the worker's ID list. The custom marker exceeds storage.
    s.vertexIds = [73, 11, 109, 37, 151, 53, 191, 89].map(n => s.base + n);
    let a = s.vertexIds.slice(0, 4), b = s.vertexIds.slice(4);
    if (s.mode === 1) {a = a.slice(0, 3); b = b.slice(0, 3);}
    if (s.mode === 4) {a = [a[0], a[1], a[2], a[0], a[2], a[3]]; b = [b[0], b[1], b[2], b[0], b[2], b[3]];}
    if (options.tail !== undefined) {a = a.slice(0, options.tail); b = b.slice(0, options.tail); if (s.mode === 2 && options.tail === 3) {a = [a[0], a[1], a[0]]; b = [b[0], b[1], b[0]];}}
    s.ids = [s.restartIndex, ...a, s.restartIndex, s.restartIndex, ...b, s.restartIndex];
    s.count = s.ids.length;
    const prefix = s.offsets[0] + s.sourceOffsets[0], raw = new Uint8Array(prefix + Math.max(...s.vertexIds) * 16 + 16 - (s.shortSlot === 0 ? 1 : 0)), v = new DataView(raw.buffer);
    const tri = s.mode >= 4, points = tri ? (s.mode === 5 ? [[3, 3], [7, 3], [3, 7], [7, 7], [10, 10], [14, 10], [10, 14], [14, 14]] :
      [[3, 3], [7, 3], [7, 7], [3, 7], [10, 10], [14, 10], [14, 14], [10, 14]]) :
      [[3.5, 3.5], [7.5, 3.5], [7.5, 7.5], [3.5, 7.5], [10.5, 10.5], [14.5, 10.5], [14.5, 14.5], [10.5, 14.5]];
    s.vertexIds.forEach((id, n) => [points[n][0] / 16, points[n][1] / 8 - 1, id, 1].forEach((value, lane) => {
      const at = prefix + id * 16 + lane * 4; if (at + 4 <= raw.length) v.setFloat32(at, value, true);
    })); s.data.set(3, raw);
    const indices = new Uint8Array(s.indexOffset + s.count * 4 - (s.shortIndex ? 1 : 0)), iv = new DataView(indices.buffer);
    s.ids.forEach((id, n) => {if (s.indexOffset + n * 4 + 4 <= indices.length) iv.setUint32(s.indexOffset + n * 4, id, true);}); s.data.set(22, indices);
  }
  return s;
}
export function runWireAcceptance() {
  const c = checks(), records = [], test = (bytes, label) => {
    const source = hex(bytes), expected = literalRestartAdmission(source), legacyExpected = literalRestartAdmission(source, true);
    const standard = decodeStandardSubmission(bytes), legacy = decodeSubmission(bytes);
    c.same(standard.ok, expected, label + ' critic literal standard'); c.same(legacy.ok, legacyExpected, label + ' critic literal legacy');
    records.push({label, hex: source, expected, legacyExpected, standard, legacy});
  };
  for (const mode of [0, 1, 2, 3, 4, 5, 6, 7, 0xffffffff]) for (const indexed of [0, 1, 2]) for (const enabled of [0, 1, 2])
    test(packet(8, 0, [0, 7, mode, indexed, 2, 0, 0, enabled, enabled ? 0x9d620431 : 0, 0, 0, 0]), 'critic-flags-' + [mode, indexed, enabled].join('-'));
  for (const mode of [1, 2, 3, 4, 5, 6]) {
    const words = [0, 7, mode, 1, 4, 0, 0, 1, 0x9d620431, 0, 0, 0];
    for (const [slot, value] of [[5, 0xffffffff], [6, 9], [11, 1], [0, 0xffffffff], [9, 1]]) {const w = [...words]; w[slot] = value; test(packet(8, 0, w), 'critic-hostile-' + mode + '-' + slot);}
    const bytes = packet(8, 0, words); test(join(bytes, packet(8, 0, [])), 'critic-malformed-' + mode);
    test(bytes.subarray(0, bytes.length - 1), 'critic-short-' + mode);
  }
  return {status: 'passed', seed: SEED, records, predictions: c.rows};
}
async function frame(r, record, {allowError = false} = {}) {
  const {gl, c} = r; if (!allowError) c.ok(record.result, record.label + ' completed draw'); c.same(record.result.gpuComplete, true, 'critic actual final fence');
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.allocations[0].storage.texture, 0); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); for (const n of ['PACK_ROW_LENGTH', 'PACK_SKIP_PIXELS', 'PACK_SKIP_ROWS']) gl.pixelStorei(gl[n], 0); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const pixels = new Uint8Array(r.width * r.height * 4); gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.deleteFramebuffer(fb);
  const draw = record.result.draws.at(-1), buffers = [], normalized = [], calls = r.trace.calls.filter(call => call.label === record.label).map(({program, ...call}) => call);
  for (const [id, source] of r.bufferBytes) {
    const generation = id === 22 ? draw.indexResourceGeneration : draw.vertexFetches.find(f => f.resourceId === id).resourceGeneration,
      allocation = r.allocations.find(a => a.metadata.id === id && a.generation === generation), bytes = new Uint8Array(source.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER, allocation.storage.buffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    const saved = await blob(r, bytes); c.same(saved.sha256, hex(new Uint8Array(await crypto.subtle.digest('SHA-256', source))), 'critic original physical bytes ' + id);
    buffers.push({resourceId: id, generation, nativeBuffer: r.trace.id(allocation.storage.buffer), blob: saved});
  }
  for (const entry of r.normalized.filter(e => e.label === record.label)) {c.same(entry.deleted, true, 'critic retired private native index'); normalized.push({nativeBuffer: entry.nativeBuffer, bytes: entry.bytes, blob: await blob(r, entry.raw)});}
  const model = independentRestart(r.history, r.bufferBytes), audit = compareRestartPixels(pixels, model, r.width, r.height), saved = {
    label: record.label, width: r.width, height: r.height, used: [0, 1, 2], history: r.history.map(h => ({...h})), inputs: r.exchanges.map(e => ({...e})),
    native: {calls, buffers, normalized, events: r.trace.events.map(e => ({...e}))},
    predicted: {ids: model.ids, min: model.min, max: model.max, valid: model.valid, restarts: model.restarts, fetches: model.fetches}, audit, pixels: await blob(r, pixels)};
  r.frames.push(saved); c.same(audit.misses, [], record.label + ' promoted independent restart pixel oracle');
  const instanced = model.effective > 1;
  for (const call of calls) {
    c.same(call.name, 'drawElements' + (instanced ? 'Instanced' : ''), 'critic indexed native entry');
    c.same(call.args, [model.draw.mode, model.draw.count, {1: 5121, 2: 5123, 4: 5125}[model.nativeSize], model.nativeOffset, ...(instanced ? [model.effective] : [])], 'critic literal native mode/type/offset');
    c.same(model.normalize ? normalized.some(n => n.nativeBuffer === call.indexBuffer) : call.indexBuffer === buffers.find(b => b.resourceId === 22).nativeBuffer, true, 'critic original/private native binding');
    for (const f of model.fetches) {
      const observed = draw.vertexFetches.find(a => a.attributeIndex === f.attributeIndex), a = call.attributes.find(a => a.name === 'in_' + f.attributeIndex);
      for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) c.same(observed[key], f[key], 'critic source bounds ' + key);
      if (model.valid === 0) c.same(observed.fetchEmpty, true, 'critic explicit empty fetch');
      c.same(a.enabled, !f.constant, 'critic original generic enable'); c.same(a.divisor, f.nativeDivisor, 'critic original native divisor');
      if (f.constant) {c.same(a.genericValues, f.genericValues, 'critic original native generic'); c.same(observed.componentWords, f.componentWords, 'critic original generic words');}
      else {c.same([a.stride, a.offset, a.components], [f.stride, f.offset, f.components], 'critic original native vertex source'); c.same(a.buffer, buffers.find(b => b.resourceId === f.resourceId).nativeBuffer, 'critic original native vertex buffer');}
    }
  }
  c.same([draw.actualMinIndex, draw.actualMaxIndex, draw.validIndexCount, draw.restartCount, draw.nativeIndexSize, draw.nativeIndexOffset, draw.vertexWork],
    [model.min, model.max, model.valid, model.restarts, model.nativeSize, model.nativeOffset, model.draw.count * model.effective], 'critic exact source min/max/work');
  if (model.normalize) for (const n of normalized) c.same(n.blob.sha256, hex(new Uint8Array(await crypto.subtle.digest('SHA-256', model.normalized))), 'critic literal normalized GPU bytes');
  c.same(draw.indexResourceGeneration, buffers.find(b => b.resourceId === 22).generation, 'critic original index identity preserved'); c.same(gl.getError(), gl.NO_ERROR, 'critic physical capture GL error');
  return saved;
}

export async function runAcceptance({smoke = false} = {}) {
  const c = checks(), report = {schema: 'standard-restart-fresh-critic-v1', seed: SEED, status: 'running', guestExecution: false, productionNegotiation: false,
    predictions: c.rows, frames: [], runs: [], rejections: [], suspensions: [], ownership: [], blobs: [], wire: runWireAcceptance(), schedules: []}; window.__standardRestartEvidence = report;
  const gl = document.querySelector('#gpu').getContext('webgl2', {antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true}), debug = gl.getExtension('WEBGL_debug_renderer_info');
  c.same(gl instanceof WebGL2RenderingContext, true, 'critic actual WebGL2'); c.same(Boolean(debug), true, 'critic hardware identity'); report.gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL); c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu), false, 'critic physical GPU');
  const bridge = await createVirglStandardShaderBridge();
  const delayed = ({ordinal, label, turn}) => {const ticks = 1 + (((SEED >>> (ordinal % 23)) ^ Math.imul(ordinal + 1, 0x45d9f3b)) >>> 0) % 7; report.schedules.push({ordinal, label, turn, ticks}); return ticks;};
  const make = (s, options = {}) => {const r = restartRig(gl, bridge, c, s, {step: 1, delay: delayed, ...options}); r.frames = report.frames; r.blobs = report.blobs; r.yields = []; return r;};
  const drive = (r, ctx, bytes, label, action = null) => restartSubmit(r, ctx, bytes, label, async (step, token) => {
    const inspection = r.renderer.inspect().jobs, binding = r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)), owned = r.normalized.filter(e => !e.deleted).map(e => e.nativeBuffer);
    r.yields.push({label, inspection, binding, owned}); c.same(inspection.normalizationScratchBytes, 0, 'critic CPU scratch cannot cross yield');
    c.same(binding === null || !owned.includes(binding), true, 'critic private native EBO detached before yield'); if (action) await action(step, token);
  });
  const done = r => {const inspection = c.ok(r.renderer.inspect(), 'critic final counters'); for (const key of ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']) c.same(inspection.jobs[key], 0, 'critic released ' + key);
    report.runs.push({history: r.history, exchanges: r.exchanges, calls: r.trace.calls.map(({program, ...a}) => a), events: r.trace.events,
      normalizationEvents: r.normalizationEvents, yields: r.yields, inspection}); dispose(r);};
  // Independently seeded custom markers and nonmonotonic wide IDs, with three
  // schedules, including a different delay for every actual native fence.
  for (const schedule of smoke ? ['per-fence'] : ['per-fence', 'rotated', 'ordinary']) for (const mode of smoke ? [2] : [2, 1, 3, 4, 5, 6]) {
    const marker = schedule === 'per-fence' && mode === 2 ? 0x9d620431 : 0x81000000 | (random() & 0xffffff), s = specimen({mode, restartIndex: marker >>> 0, base: 0x18000 + random() % 32768}),
      r = make(s, {delay: schedule === 'ordinary' ? 0 : schedule === 'rotated' ? ({ordinal}) => 2 + (ordinal * 3 + 5) % 8 : delayed, step: schedule === 'rotated' ? 3 : 1});
    await frame(r, await drive(r, 1, join(restartSetup(r, s), restartDraw(s)), 'critic-mode-' + mode + '-wide-custom-' + schedule)); done(r);
  }
  if (!smoke) {
    for (const mode of [1, 2, 3, 4, 5, 6]) for (const tail of [1, 2, 3]) {const s = specimen({mode, tail}), r = make(s); await frame(r, await drive(r, 1, join(restartSetup(r, s), restartDraw(s)), 'critic-tail-' + mode + '-' + tail)); done(r);}
    for (const options of [{pattern: 'all', allCount: 11}, {pattern: 'all', allCount: 7, restartIndex: 0xffffffff},
      {indexSize: 1, base: 16, indexOffset: 19, enabled: false, maximumVertex: true}, {indexSize: 2, base: 48, indexOffset: 30, enabled: false, maximumVertex: true},
      {indexSize: 1, base: 16, indexOffset: 23, restartIndex: 0x100ff, maximumVertex: true}, {indexSize: 2, base: 48, indexOffset: 34, restartIndex: 0x100ffff, maximumVertex: true}]) {
      const s = specimen(options), r = make(s); await frame(r, await drive(r, 1, join(restartSetup(r, s), restartDraw(s)), 'critic-special-' + JSON.stringify(options))); done(r);
    }
    for (const action of ['stale-index', 'collected-index', 'cancel', 'reuse']) {
      const s = specimen(), r = make(s, {delay: action === 'collected-index' ? ({ordinal}) => ordinal % 2 ? 13 : 0 : delayed});
      c.ok((await drive(r, 1, restartSetup(r, s), 'critic-pending-setup-' + action)).result, 'critic pending setup');
      const oldGeneration = r.allocations.find(a => a.metadata.id === 22).generation; let fired = false, point, newGeneration;
      const record = await drive(r, 1, join(clear([0, 0, 0, 0]), restartDraw(s)), 'critic-pending-' + action, async (_step, token) => {
        const inspection = r.renderer.inspect().jobs;
        if (fired || inspection.status !== 'waiting-attributes' || action === 'collected-index' && !r.trace.events.some(e => e.name === 'getBufferSubData' && e.bytes === s.count * 4)) return;
        fired = true; point = {inspection, events: r.trace.events.map(e => ({...e}))};
        if (action === 'cancel') c.ok(r.renderer.cancel(token), 'critic cancelled original read');
        else if (action === 'reuse') {c.ok(r.store.unref(22), 'critic retired public original name'); newGeneration = add(r, meta(22, 0, 64, 32, s.data.get(22).length), new Uint8Array(s.data.get(22).length)).generation;}
        else {const bytes = s.data.get(22).slice(); bytes.fill(0); c.ok(r.store.writeBacking(22, 0, bytes), 'critic changed original bytes');
          const command = c.ok(decodeStandardSubmission(transfer(22, bytes.length)), 'critic literal upload').commands[0], ticket = c.ok(r.store.prepareTransfer(1, command), 'critic concurrent original transfer').ticket; c.ok(r.store.executeTransfer(ticket), 'critic actual GPU original revision');}
      });
      c.same(fired, true, 'critic whole pending batch reached');
      if (action === 'reuse') {await frame(r, record); c.same(record.result.draws[0].indexResourceGeneration, oldGeneration, 'critic retained public generation'); c.same(newGeneration > oldGeneration, true, 'critic name reuse distinct generation');}
      else {c.same(record.result.error.code, action === 'cancel' ? 'cancelled' : 'stale-storage', 'critic original source error'); c.same(r.trace.calls.length, 0, 'critic invalid source never draws'); c.same(r.normalized.length, 0, 'critic invalid source never allocates'); c.same(record.result.gpuComplete, true, 'critic original read real drain');}
      report.suspensions.push({action, point, oldGeneration, newGeneration, record}); done(r);
    }
    for (const [label, options] of [['critic-create-fails', {failAllocation: 2}], ['critic-upload-fails', {failUpload: 2}]]) {
      const s = specimen(), r = make(s, options), record = await drive(r, 1, join(restartSetup(r, s), restartDraw(s), restartDraw(s)), label);
      c.same(record.result.error.code, 'backend-error', 'critic partial native failure'); c.same(record.result.draws.length, 1, 'critic partial success prefix'); c.same(r.trace.calls.length, 1, 'critic failed suffix never draws'); await frame(r, record, {allowError: true}); report.ownership.push({label, record}); done(r);
    }
    for (const phase of ['waiting-attributes', 'finishing']) {
      const s = specimen(), r = make(s); c.ok((await drive(r, 1, restartSetup(r, s), 'critic-owned-setup-' + phase)).result, 'critic owned setup'); let fired = false, point;
      const record = await drive(r, 1, join(clear([0, 0, 0, 0]), restartDraw(s), ...(phase === 'finishing' ? [] : [restartDraw(s)])), 'critic-owned-cancel-' + phase, (_step, token) => {
        const inspection = r.renderer.inspect().jobs; if (fired || inspection.draws !== 1 || inspection.status !== phase) return;
        fired = true; point = {inspection}; c.same(inspection.normalizedBuffers, 1, 'critic retained native scratch before cancel'); c.ok(r.renderer.cancel(token), 'critic cancel with live scratch');
      });
      c.same(fired, true, 'critic owned suspension reached'); c.same(record.result.error.code, 'cancelled', 'critic owned cancellation'); c.same(record.result.draws.length, 1, 'critic cancelled suffix absent'); await frame(r, record, {allowError: true}); report.ownership.push({label: record.label, point, record}); done(r);
    }
    // The exact native maximum is a valid restart only when enabled.
    {const s = specimen({enabled: false}), r = make(s); new DataView(s.data.get(22).buffer).setUint32(s.indexOffset, 0xffffffff, true);
      const record = await drive(r, 1, join(restartSetup(r, s), restartDraw(s)), 'critic-real-u32-max'); c.same(record.result.error.code, 'unsupported-draw', 'critic nonrestart native sentinel'); c.same(r.trace.calls.length, 0, 'critic sentinel before draw'); c.same(r.normalized.length, 0, 'critic sentinel before normalization'); report.rejections.push({label: record.label, record}); done(r);}
    {const s = specimen(), r = make(s), bytes = join(restartDraw(s), restartDraw(s)); c.ok((await drive(r, 1, restartSetup(r, s), 'critic-dispose-setup')).result, 'critic disposal setup');
      r.currentLabel = 'critic-owned-dispose'; r.trace.label(r.currentLabel); const token = c.ok(r.renderer.beginSubmission(1, bytes), 'critic disposal submission').job; let before;
      for (let n = 0; n < 1000; n++) {await new Promise(resolve => setTimeout(resolve, 1)); r.trace.nextTurn(); const step = c.ok(r.renderer.step(token), 'critic disposal later task'), inspection = r.renderer.inspect().jobs;
        if (inspection.draws === 1 && inspection.status === 'waiting-attributes') {before = {inspection, events: r.trace.events.map(e => ({...e}))}; break;} c.same(step.status === 'done', false, 'critic disposal suspension before completion');}
      c.same(Boolean(before), true, 'critic disposal with live scratch and reads'); c.ok(r.renderer.dispose(), 'critic explicit disposal'); c.same(r.renderer.step(token).ok, false, 'critic disposed job token invalid');
      for (const entry of r.normalized) c.same(gl.isBuffer(entry.buffer), false, 'critic disposed private native object'); report.ownership.push({label: 'critic-owned-dispose', before, after: r.renderer.inspect()}); done(r);}
  }
  report.status = 'passed'; return report;
}
