import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeSubmission, decodeStandardSubmission} from '../decoder.mjs';
import {topologySpec, topologyDraw, topologySetup} from './standard-core-topologies.mjs';
import {checks, rig, meta, add, transfer, clear, submit, dispose, packet, join, blob} from './standard-instanced-draws.mjs';
import {independentTopology, compareIndependent, literalAdmission} from '../../../tools/virgl-command/standard-topology-adversarial-oracle.mjs';

const SEED = 0x25df967b;
const hex = bytes => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
function specimen(options = {}) {
  const s = topologySpec({seed: SEED, mode: 2, base: 0x14101, start: 13, indexOffset: 28,
    offsets: [40, 52, 28], sourceOffsets: [12, 4, 20], ...options});
  s.ids = Array.from({length: s.count}, (_, i) => s.indexed ? s.base + [9, 1, 5, 3, 17][i] : s.start + i);
  const points = s.mode === 6 ? [[3, 3], [12, 3], [12, 12], [3, 12], [3, 3]] : [[3.5, 3.5], [12.5, 3.5], [12.5, 12.5], [3.5, 12.5], [3.5, 3.5]];
  if (s.mode === 2 && s.count === 3) points[2] = points[0];
  const prefix = s.offsets[0] + s.sourceOffsets[0];
  const bytes = new Uint8Array(prefix + Math.max(...s.ids) * 16 + 16 - (s.shortSlot === 0 ? 1 : 0)), v = new DataView(bytes.buffer);
  for (let i = 0; i < s.ids.length; i++) for (let lane = 0; lane < 4; lane++) {
    const at = prefix + s.ids[i] * 16 + lane * 4;
    if (at + 4 <= bytes.length) v.setFloat32(at, [points[i][0] / 16, points[i][1] / 8 - 1, 0, 1][lane], true);
  }
  s.data.set(3, bytes);
  if (s.indexed) {
    const bytes = new Uint8Array(s.indexOffset + s.count * s.indexSize - (s.shortIndex ? 1 : 0)), v = new DataView(bytes.buffer);
    s.ids.forEach((id, i) => {const at = s.indexOffset + i * s.indexSize; if (at + s.indexSize <= bytes.length) {
      if (s.indexSize === 1) v.setUint8(at, id); else if (s.indexSize === 2) v.setUint16(at, id, true); else v.setUint32(at, id, true);
    }}); s.data.set(22, bytes);
  }
  return s;
}
export function runWireAcceptance() {
  const c = checks(), records = [];
  const test = (bytes, label) => {
    const source = hex(bytes), expected = literalAdmission(source), oldExpected = literalAdmission(source, true);
    const standard = decodeStandardSubmission(bytes), legacy = decodeSubmission(bytes);
    c.same(standard.ok, expected, label + ' independent standard admission'); c.same(legacy.ok, oldExpected, label + ' independent legacy admission');
    records.push({label, hex: source, expected, oldExpected, standard, legacy});
  };
  for (const mode of [0, 1, 2, 3, 4, 5, 6, 7, 15, 0xffffffff]) for (const instances of [0, 1, 3])
    test(packet(8, 0, [0, 5, mode, 1, instances, 0, 0, 0, 0, 0, 0, 0]), 'critic-mode-' + mode + '-' + instances);
  for (const mode of [1, 2, 3, 6]) {
    const draw = topologyDraw(specimen({mode}));
    for (const [slot, value] of [[5, 0xffffffff], [6, 1], [7, 2], [8, 123], [11, 1], [3, 2], [0, 0xffffffff]]) {
      const bytes = draw.slice(); new DataView(bytes.buffer).setUint32(4 + slot * 4, value, true); test(bytes, 'critic-unsupported-' + mode + '-' + slot);
    }
    test(join(draw, packet(8, 0, [])), 'critic-empty-tail-' + mode);
    test(draw.subarray(0, draw.length - 1), 'critic-byte-short-' + mode);
    test(join(draw, new Uint8Array([8, 0, 0])), 'critic-short-header-' + mode);
  }
  return {status: 'passed', seed: SEED, records, predictions: c.rows};
}
async function frame(r, record) {
  const {gl, c} = r; c.ok(record.result, record.label + ' completed native draw'); c.same(record.result.gpuComplete, true, 'real final fence');
  const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.allocations[0].storage.texture, 0); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); for (const name of ['PACK_ROW_LENGTH', 'PACK_SKIP_PIXELS', 'PACK_SKIP_ROWS']) gl.pixelStorei(gl[name], 0); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const pixels = new Uint8Array(r.width * r.height * 4); gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.deleteFramebuffer(framebuffer);
  const draw = record.result.draws.at(-1), buffers = [];
  for (const [id, original] of r.bufferBytes) {
    const generation = id === 22 ? draw.indexResourceGeneration : draw.vertexFetches.find(f => f.resourceId === id).resourceGeneration;
    const allocation = r.allocations.find(a => a.metadata.id === id && a.generation === generation), actual = new Uint8Array(original.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER, allocation.storage.buffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, actual); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    const saved = await blob(r, actual), expected = await crypto.subtle.digest('SHA-256', original);
    c.same(saved.sha256, hex(new Uint8Array(expected)), 'independent original GPU bytes ' + id);
    buffers.push({resourceId: id, generation, nativeBuffer: r.trace.id(allocation.storage.buffer), blob: saved});
  }
  const model = independentTopology(r.history, r.bufferBytes), audit = compareIndependent(pixels, model, r.width, r.height);
  const calls = r.trace.calls.filter(x => x.label === record.label).map(({program, ...call}) => call);
  const saved = {label: record.label, width: r.width, height: r.height, history: r.history.map(x => ({...x})), inputs: r.exchanges.map(x => ({...x})),
    native: {calls, buffers, events: r.trace.events.map(e => ({...e})), state: {
      lineWidth: gl.getParameter(gl.LINE_WIDTH), viewport: [...gl.getParameter(gl.VIEWPORT)],
      scissor: gl.isEnabled(gl.SCISSOR_TEST), colorMask: [...gl.getParameter(gl.COLOR_WRITEMASK)],
    }}, audit, pixels: await blob(r, pixels)};
  r.frames.push(saved); c.same(audit.misses, [], record.label + ' promoted independent topology pixel oracle');
  c.same(saved.native.state.lineWidth, 1, 'critic restored one-pixel line width');
  c.same(saved.native.state.viewport, [0, 0, r.width, r.height], 'critic restored viewport');
  c.same(saved.native.state.scissor, false, 'critic restored scissor enable');
  c.same(saved.native.state.colorMask, [true, true, true, true], 'critic restored color writes');
  const call = calls.at(-1), instanced = model.effective > 1;
  c.same(call.name, (model.draw.indexed ? 'drawElements' : 'drawArrays') + (instanced ? 'Instanced' : ''), 'critic exact native call');
  c.same(call.args, model.draw.indexed ? [model.draw.mode, model.draw.count, {1: 5121, 2: 5123, 4: 5125}[model.index.size], model.index.offset, ...(instanced ? [model.effective] : [])] :
    [model.draw.mode, model.draw.start, model.draw.count, ...(instanced ? [model.effective] : [])], 'critic literal mode and original native args');
  c.same(draw.actualMinIndex, model.min, 'critic actual min from nonmonotonic indices'); c.same(draw.actualMaxIndex, model.max, 'critic actual max from nonmonotonic indices');
  c.same(draw.vertexWork, model.draw.count * model.effective, 'critic full incomplete-tail work');
  for (const f of model.fetches) {
    const observed = draw.vertexFetches.find(o => o.attributeIndex === f.attributeIndex), a = call.attributes.find(a => a.name === 'in_' + f.attributeIndex);
    for (const key of ['resourceId', 'stride', 'offset', 'components', 'firstByte', 'requiredEnd', 'divisor', 'nativeDivisor', 'firstElement', 'lastElement']) c.same(observed[key], f[key], 'critic original byte bound ' + key);
    c.same(a.enabled, !f.constant, 'critic generic array enable'); c.same(a.divisor, f.nativeDivisor, 'critic restored divisor');
    if (f.constant) {c.same(a.genericValues, f.genericValues, 'critic original generic native value'); c.same(observed.componentWords, f.componentWords, 'critic original generic words');}
    else {c.same([a.stride, a.offset, a.components], [f.stride, f.offset, f.components], 'critic native binding'); c.same(a.buffer, buffers.find(b => b.resourceId === f.resourceId).nativeBuffer, 'critic retained native source');}
  }
  c.same(gl.getError(), gl.NO_ERROR, 'critic native draw and capture clean'); return saved;
}
function poison(gl) {
  gl.viewport(0, 0, 1, 1); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 0, 0); gl.colorMask(false, false, false, false); gl.lineWidth(3);
  for (let i = 0; i < gl.getParameter(gl.MAX_VERTEX_ATTRIBS); i++) {gl.enableVertexAttribArray(i); gl.vertexAttribDivisor(i, 11); gl.vertexAttrib4f(i, .6, .7, .8, .9);}
}
export async function runAcceptance({smoke = false} = {}) {
  const c = checks(), report = {schema: 'standard-topology-fresh-critic-v1', seed: SEED, status: 'running', guestExecution: false, productionNegotiation: false,
    predictions: c.rows, frames: [], runs: [], rejections: [], suspensions: [], blobs: [], wire: runWireAcceptance()}; window.__standardTopologyEvidence = report;
  const gl = document.querySelector('#gpu').getContext('webgl2', {antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true}), debug = gl.getExtension('WEBGL_debug_renderer_info');
  c.same(gl instanceof WebGL2RenderingContext, true, 'critic real native WebGL2'); c.same(Boolean(debug), true, 'critic hardware GPU identity'); report.gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu), false, 'critic native hardware');
  const bridge = await createVirglStandardShaderBridge(), delay = ({ordinal}) => 1 + (((SEED >>> (ordinal % 23)) ^ ordinal) % 6);
  const make = (s, options = {}) => {const r = rig(gl, bridge, c, {width: s.width, height: s.height, delay, step: 2, ...options}); r.frames = report.frames; r.blobs = report.blobs; return r;};
  const done = r => {const inspection = c.ok(r.renderer.inspect(), 'critic final ownership'); c.same(inspection.jobs.reads, 0, 'critic reads drained'); c.same(inspection.jobs.stagingBytes, 0, 'critic staging drained');
    report.runs.push({history: r.history, exchanges: r.exchanges, calls: r.trace.calls.map(({program, ...call}) => call), events: r.trace.events, inspection}); dispose(r);};
  const modes = smoke ? [2] : [2, 1, 3, 6];
  for (const mode of modes) for (const [kind, options] of (smoke ? [['wide', {}]] : [['wide', {}], ['arrays-zero', {indexed: false, instances: 0}], ['arrays-two', {indexed: false, instances: 2}], ['byte-one', {indexSize: 1, indexOffset: 7, base: 51, instances: 1}], ['short-four', {indexSize: 2, indexOffset: 14, base: 32760}]])) {
    const s = specimen({mode, ...options}), r = make(s); await frame(r, await submit(r, 1, join(topologySetup(r, s), topologyDraw(s)), 'critic-mode-' + mode + '-' + kind));
    if (mode === 2 && kind === 'wide' && !smoke) {
      const b = specimen({mode: 3}); poison(gl); await frame(r, await submit(r, 2, join(topologySetup(r, b, {create: false}), topologyDraw(b)), 'critic-mode-B'));
      poison(gl); r.spec = s; await frame(r, await submit(r, 1, join(clear([0, 0, 0, 0]), topologyDraw(s)), 'critic-mode-A-restored'));
    }
    done(r);
  }
  if (!smoke) {
    for (const mode of [1, 2, 3, 6]) for (const count of [1, 2, 3, 5]) {const s = specimen({mode, count, instances: 1}), r = make(s);
      await frame(r, await submit(r, 1, join(topologySetup(r, s), topologyDraw(s)), 'critic-tail-' + mode + '-' + count)); done(r);}
    for (const mode of [1, 2, 3, 6]) {
      for (const [label, options, limits, expected] of [['short-tail', {shortSlot: 0, count: 5}, {}, 'out-of-bounds'], ['short-index', {shortIndex: true}, {}, 'out-of-bounds'],
        ['work-minus-one', {}, {drawLimits: {indicesPerSubmission: 15}}, 'limit-exceeded'], ['work-exact', {}, {drawLimits: {indicesPerSubmission: 16}}, null]]) {
        const s = specimen({mode, ...options}), r = make(s, limits), record = await submit(r, 1, join(topologySetup(r, s), topologyDraw(s)), 'critic-' + label + '-' + mode);
        if (!expected) await frame(r, record);
        else {c.same(record.result.error.code, expected, 'critic exact missing bound'); c.same(r.trace.calls.length, 0, 'critic no native draw on reject'); report.rejections.push({label: record.label, record, events: r.trace.events, draws: 0});} done(r);
      }
      const s = specimen({mode}), r = make(s); c.ok((await submit(r, 1, topologySetup(r, s), 'critic-atomic-setup-' + mode)).result, 'critic atomic setup');
      const before = r.renderer.inspect().work.appliedCommands;
      for (const [label, bytes] of [['malformed-tail', join(topologyDraw(s), packet(8, 0, []))], ['nonempty', topologyDraw(s, {count: 0})], ['indexed-start', packet(8, 0, [1, 4, mode, 1, 4, 0, 0, 0, 0, 0, 0, 0])]]) {
        const record = await submit(r, 1, bytes, 'critic-' + label + '-' + mode); c.same(record.result.ok, false, 'critic atomic invalid new-mode packet'); c.same(r.trace.calls.length, 0, 'critic atomic rejection before draw');
        if (label === 'malformed-tail') c.same(r.renderer.inspect().work.appliedCommands, before, 'critic malformed tail applies no valid prefix');
        report.rejections.push({label: record.label, record, events: r.trace.events, draws: 0});
      } done(r);
    }
    for (const action of ['stale-index', 'cancel', 'reuse', 'cpu-backing']) {
      const s = specimen(), r = make(s); c.ok((await submit(r, 1, topologySetup(r, s), 'critic-pending-setup-' + action)).result, 'critic pending original upload');
      const oldGeneration = r.allocations.find(a => a.metadata.id === 4).generation; let point, fired = false, newGeneration;
      const record = await submit(r, 1, join(clear([0, 0, 0, 0]), topologyDraw(s)), 'critic-pending-' + action, async (_step, job) => {
        const inspection = c.ok(r.renderer.inspect(), 'critic waiting inspection'); if (fired || inspection.jobs.status !== 'waiting-attributes') return; fired = true;
        point = {inspection, events: r.trace.events.map(e => ({...e}))}; c.same(inspection.jobs.reads, 2, 'critic complete index/generic read batch');
        if (action === 'cancel') c.ok(r.renderer.cancel(job), 'critic cancel pending batch');
        else if (action === 'reuse') {c.ok(r.store.unref(4), 'critic retire original generic public name'); newGeneration = add(r, meta(4, 0, 64, 16, s.data.get(4).length), new Uint8Array(s.data.get(4).length)).generation; c.same(newGeneration > oldGeneration, true, 'critic distinct reused generation');}
        else if (action === 'cpu-backing') c.ok(r.store.writeBacking(4, 0, new Uint8Array(s.data.get(4).length)), 'critic mutate CPU-only backing');
        else {const bytes = s.data.get(22).slice(); bytes.fill(0); c.ok(r.store.writeBacking(22, 0, bytes), 'critic changed pending index backing');
          const command = c.ok(decodeStandardSubmission(transfer(22, bytes.length)), 'critic literal revised index transfer').commands[0];
          const access = c.ok(r.store.prepareTransfer(1, command), 'critic retained revision transfer'); c.ok(r.store.executeTransfer(access.ticket), 'critic actual GPU revision mutation');}
      }); c.same(fired, true, 'critic pending point reached');
      if (['reuse', 'cpu-backing'].includes(action)) {await frame(r, record); c.same(record.result.draws[0].vertexFetches[1].resourceGeneration, oldGeneration, 'critic original GPU generation retained');}
      else {c.same(record.result.ok, false, 'critic pending mutation rejected'); c.same(record.result.error.code, action === 'cancel' ? 'cancelled' : 'stale-storage', 'critic specific pending failure'); c.same(record.result.gpuComplete, true, 'critic pending error drains final fence'); c.same(r.trace.calls.length, 0, 'critic failed batch never draws');}
      report.suspensions.push({action, point, oldGeneration, newGeneration, record, async: r.asyncAccess.inspect(), events: r.trace.events}); done(r);
    }
  }
  report.status = 'passed'; return report;
}
