// Verifier-promoted original queue test: an old image outlives a same-name image
// of a different target. Expectations come only from original bytes/coordinates.
import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {checker, makeRig, context, idCommand, transfer, submission} from './submit-acceptance.mjs';
import {capture, memory, allocation, padded} from './native-dimensional-color-surfaces.mjs';
import {metadata, setup, surface, packet, join, shader, clear, draw, word, CLEAR} from '../../../tools/virgl-dimensional-color-surfaces/fixtures.mjs';
import {sampler} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {pairTexts} from '../../../tools/virgl-dimensional-shaders/fixtures.mjs';

const hex = bytes => [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
const copy = value => JSON.parse(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? [...v] : typeof v === 'bigint' ? v.toString(16) : v));
const put = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
const viewport = (width, height) => packet(4, 0, [0, ...[width / 2, height / 2, .5, width / 2, height / 2, .5].map(word)]);
const pointDraw = count => packet(8, 0, [0, count, 0, 0, 1, 0, 0, 0, 0, 0, 0xffffffff, 0]);
const targetName = target => ({3: '3D', 4: 'CUBE', 7: '2D_ARRAY'})[target];

function image(target, size, height, depth, arraySize, seed, {zero = false} = {}) {
  const source = metadata(6, target, 67, 10, size, height, depth, arraySize, 2);
  const levels = Array.from({length: 3}, (_, level) => {
    const width = Math.max(1, size >> level), h = Math.max(1, height >> level);
    const layers = target === 3 ? Math.max(1, depth >> level) : arraySize;
    const bytes = new Uint8Array(width * h * layers * 4);
    for (let z = 0; z < layers; z++) for (let y = 0; y < h; y++) for (let x = 0; x < width; x++) for (let lane = 0; lane < 4; lane++) {
      bytes[((z * h + y) * width + x) * 4 + lane] = zero ? 0 : lane === 3 ? 255 : ((seed + level * 17 + z * 19 + y * 23 + x * 29 + lane * 31) & 1) * 255;
    }
    return {level, width, height: h, layers, bytes};
  });
  const level = zero ? 0 : 1, layer = zero ? 0 : levels[level].layers - 1;
  const selected = levels[level], points = [[0, 0], [selected.width - 1, selected.height - 1]];
  const positions = new Uint8Array(new Float32Array(points.flatMap(([x, y]) => [(2 * x + 1) / selected.width - 1, (2 * y + 1) / selected.height - 1, 0, 1])).buffer);
  return {target, source, levels, level, layer, points, positions, width: selected.width, height: selected.height};
}

function coordinates(f) {
  const texels = [], values = [];
  for (const p of f.levels) for (let z = 0; z < p.layers; z++) for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const u = (x + .5) / p.width, v = (y + .5) / p.height;
    const a = 2 * u - 1, b = 2 * v - 1;
    const xyz = f.target === 4 ? [[1, -b, -a], [-1, -b, a], [a, 1, b], [a, -1, -b], [a, -b, 1], [-a, -b, -1]][z] : [u, v, f.target === 3 ? (z + .5) / p.layers : z];
    values.push(...xyz, p.level);
    texels.push({level: p.level, layer: z, x, y, offset: ((z * p.height + y) * p.width + x) * 4});
  }
  const positions = texels.flatMap((_, i) => [(2 * (i % 64) + 1) / 64 - 1, (2 * Math.floor(i / 64) + 1) / 3 - 1, 0, 1]);
  return {texels, coordinates: new Uint8Array(new Float32Array(values).buffer), positions: new Uint8Array(new Float32Array(positions).buffer)};
}

function expectedWords(w, levels) {
  const words = new Uint32Array(64 * 3 * 4);
  for (const [i, t] of w.texels.entries()) for (let lane = 0; lane < 4; lane++) {
    const byte = levels[t.level].bytes[t.offset + lane];
    if (byte !== 0 && byte !== 255) throw Error('Novel exact witness requires original binary byte.');
    words[i * 4 + lane] = byte === 255 ? 0x3f800000 : 0;
  }
  return new Uint8Array(words.buffer);
}

function paintModel(f, levels) {
  const p = levels[f.level];
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.bytes.set([255, 0, 255, 0], ((f.layer * p.height + y) * p.width + x) * 4);
  for (const [x, y] of f.points) p.bytes.set([0, 255, 0, 255], ((f.layer * p.height + y) * p.width + x) * 4);
}

async function runCase(Wasm, createBridge, native, compiler, c, seed, target, replacementTarget, report, fault) {
  const old = image(target, 5, target === 4 ? 5 : 3, target === 3 ? 5 : 1, target === 4 ? 6 : target === 7 ? 5 : 1, seed);
  const fresh = image(replacementTarget, 4, 4, replacementTarget === 3 ? 3 : 1, replacementTarget === 4 ? 6 : replacementTarget === 7 ? 4 : 1, seed, {zero: true});
  const oldModel = old.levels.map(p => ({...p, bytes: p.bytes.slice()})), newModel = fresh.levels.map(p => ({...p, bytes: p.bytes.slice()}));
  const oldWitness = coordinates(old), newWitness = coordinates(fresh), bufferBytes = Math.max(oldWitness.positions.length, newWitness.positions.length);
  const row = {name: `different-target-reuse/${target}-to-${replacementTarget}`, seed, fixture: copy(old), replacement: copy(fresh), oldWitness: copy(oldWitness), newWitness: copy(newWitness), uploads: [], planes: [], outputs: [], colorOperations: []};
  const control = {armed: false, hits: 0}, trace = capture(native, row, control);
  const Selected = class {constructor(callback) {return Wasm.standardDimensionalDepth(callback);}};
  const rig = makeRig(Selected, createBridge, trace.gl, compiler, c, seed, true, false, true), ram = new Map();
  const cost = f => f.levels.reduce((n, p) => n + p.bytes.length, 0);
  row.costPrediction = {oldBytes: cost(old), newBytes: cost(fresh), outputBytes: 64 * 3 * 16, bufferBytes: 2 * bufferBytes};
  const baseBytes = row.costPrediction.oldBytes + row.costPrediction.outputBytes + row.costPrediction.bufferBytes;
  report.rows.push(row);
  window.__colorSurfaceActive = () => ({row, host: copy(rig.host.bridge.inspect()), native: copy(rig.q.vm.inspect())});
  try {
    await rig.expect('novel original context', context(1));
    const metas = [old.source, metadata(1, 2, 196, 2, 64, 3), metadata(3, 0, 64, 16, bufferBytes, 1), metadata(4, 0, 64, 16, bufferBytes, 1)];
    for (const [i, m] of metas.entries()) {
      await rig.expect('novel original allocation ' + m.id, allocation(m));
      const body = memory(rig, m.id, i, c); ram.set(m.id, body);
      await rig.expect('novel original backing ' + m.id, body.attach);
      await rig.expect('novel original membership ' + m.id, idCommand(0x202, 1, m.id));
    }
    const sourceRequest = (p, direction) => {
      const stride = p.width * 4 + 7, layerStride = stride * p.height + 11;
      const wire = transfer(1, 6, direction, [0, 0, 0, p.width, p.height, p.layers], 5n, stride, layerStride, 0xffffffffffffffffn);
      put(wire, 60, p.level); return {wire, stride, layerStride};
    };
    const upload = async (f, label) => {
      for (const p of f.levels) {
        const r = sourceRequest(p, 1), body = padded(p, p.bytes, r.stride, r.layerStride, 0x8d);
        ram.get(6).write(body); const at = rig.exchanges.length;
        const record = await rig.expect(label + '/mip' + p.level, r.wire);
        c.equal(rig.exchanges[at].bytes, hex(p.bytes), 'novel every original upload byte');
        row.uploads.push({label, level: p.level, input: hex(p.bytes), record, guards: ram.get(6).guards()});
      }
    };
    const bufferUpload = async (id, bytes, label) => {
      const body = new Uint8Array(4096).fill(0x9b); body.set(bytes, 5); ram.get(id).write(body);
      await rig.expect(label, transfer(1, id, 1, [0, 0, 0, bytes.length, 1, 1], 5n)); ram.get(id).guards();
    };
    await upload(old, 'novel old source');
    await bufferUpload(3, old.positions, 'novel original color positions');
    await rig.expect('novel original old surface', submission(1, setup(old)));
    const view = (handle, f) => packet(1, 6, [handle, 6, 67 | f.target << 24, (f.source.arraySize - 1) << 16, 2 << 8, 0 | 1 << 3 | 2 << 6 | 3 << 9]);
    const oldPair = pairTexts('fragment', {target: targetName(target), type: 'FLOAT', opcode: 'TXL', slot: 7});
    await rig.expect('novel old view and checked witness', submission(1, join(shader(41, 0, oldPair.vertexText), shader(42, 1, oldPair.fragmentText), packet(1, 5, [13, 0, 0, 0, 31, 0, 0, 1, 31, 0, 0, 2, 31, 0, 0, 3, 31]), surface(21, 1, 0, 0, 196), sampler(50, {mip: 0, min: 0, mag: 0}), view(51, old), packet(10, 0, [1, 7, 51]), packet(18, 0, [1, 7, 50]))));
    c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes, baseBytes, 'novel exact old storage and full-range view charges');
    const sample = async (label, w, levels, viewHandle, shaderBase) => {
      await bufferUpload(3, w.positions, label + '/positions'); await bufferUpload(4, w.coordinates, label + '/coordinates');
      await rig.expect(label + '/original bindings', submission(1, join(packet(31, 0, [0, 1]), packet(5, 0, [1, 0, 21]), viewport(64, 3), packet(2, 5, [13]), packet(6, 0, [16, 0, 3, 16, 0, 4, 16, 0, 4, 16, 0, 4]), packet(10, 0, [1, 7, viewHandle]), packet(31, 0, [shaderBase, 0]), packet(31, 0, [shaderBase + 1, 1]))));
      const start = trace.calls.length, operation = await rig.expect(label + '/native point draw', submission(1, join(clear([0, 0, 0, 0]), pointDraw(w.texels.length)), 0xffffffffffffffffn));
      const wanted = expectedWords(w, levels), stride = 64 * 16 + 7, body = new Uint8Array(4096).fill(0xc7), expectedBacking = body.slice();
      for (let y = 0; y < 3; y++) expectedBacking.set(wanted.subarray(y * 1024, (y + 1) * 1024), 5 + y * stride);
      ram.get(1).write(body); const at = rig.exchanges.length;
      const record = await rig.expect(label + '/original output206', transfer(1, 1, 2, [0, 0, 0, 64, 3, 1], 5n, stride, 0, 0xffffffffffffffffn));
      const nativeDraw = trace.states.filter(s => s.sequence >= start && /^drawArrays/.test(trace.calls[s.sequence].name)).at(-1);
      const plane = {label, operation, record, width: 64, height: 3, denseActual: rig.exchanges[at].bytes, denseExpected: hex(wanted), backingActual: hex(ram.get(1).read()), backingExpected: hex(expectedBacking), guards: ram.get(1).guards(), native: nativeDraw, host: copy(rig.host.bridge.inspect())};
      row.planes.push(plane);
      c.truth(nativeDraw, 'novel original witness reaches actual native draw');
      c.equal(plane.denseActual, plane.denseExpected, 'novel full sampled image after native work and original DMA: ' + label);
      c.equal(plane.backingActual, plane.backingExpected, 'novel full sampled image and untouched SG padding');
      return plane;
    };
    const paint = async (label, handle, f, levels, physicalFault = false) => {
      await bufferUpload(3, f.positions, label + '/positions');
      await rig.expect(label + '/original color bindings', submission(1, join(packet(31, 0, [0, 1]), packet(5, 0, [1, 0, handle]), viewport(f.width, f.height), packet(2, 5, [12]), packet(6, 0, [16, 0, 3]), packet(31, 0, [10, 0]), packet(31, 0, [11, 1]))));
      const start = trace.calls.length; control.armed = physicalFault;
      const record = await rig.expect(label + '/original clear and point draw', submission(1, join(clear(CLEAR), draw()), 0x20000000000001n));
      control.armed = false; const states = trace.states.filter(s => s.sequence >= start);
      row.colorOperations.push({label, target: f.target, level: f.level, layer: f.layer, record, native: states, host: copy(rig.host.bridge.inspect())});
      c.truth(states.some(s => /^drawArrays/.test(trace.calls[s.sequence].name)), 'novel retained surface reaches native point draw');
      if (!physicalFault) for (const s of states) {
        const a = s.state.attachments[0]; c.equal(a.level, f.level, 'novel original native mip');
        c.equal(f.target === 4 ? a.face - native.TEXTURE_CUBE_MAP_POSITIVE_X : a.layer, f.layer, 'novel original native layer or cube face');
      }
      paintModel(f, levels); return states[0].state.attachments[0].texture;
    };
    const warm = await sample('old-warm', oldWitness, oldModel, 51, 41), oldLinks = warm.host.renderer.work.programLinks;
    const before = copy(rig.host.bridge.inspect()), oldResource = before.store.resources.find(r => r.id === 6 && r.public);
    await rig.expect('novel old public name unref', idCommand(0x102, 0, 6)); const unref = copy(rig.host.bridge.inspect());
    c.equal(unref.store.budgets.gpuBytes, baseBytes, 'novel old surface/view hold original GPU chain');
    c.equal(unref.store.budgets.backingBytes, before.store.budgets.backingBytes - 4096, 'novel unref retires only original backing');
    c.equal(unref.store.budgets.cpuBytes, before.store.budgets.cpuBytes - 4096, 'novel unref retires only original CPU charge');
    await rig.expect('novel different-target same-name allocation', allocation(fresh.source));
    const replacementTexture = trace.calls.filter(v => v.name === 'createTexture').at(-1).result;
    const replacementRam = memory(rig, 6, 4, c); ram.set(6, replacementRam);
    await rig.expect('novel replacement original backing', replacementRam.attach); await rig.expect('novel replacement original membership', idCommand(0x202, 1, 6));
    await upload(fresh, 'novel replacement zero source');
    const reused = copy(rig.host.bridge.inspect()), newResource = reused.store.resources.find(r => r.id === 6 && r.public);
    c.truth(oldResource.generation !== newResource.generation, 'novel different-target original generation separates');
    c.equal(newResource.target, replacementTarget, 'novel new original target is different');
    c.equal(reused.store.budgets.gpuBytes, baseBytes + cost(fresh), 'novel both differently sized native chains charged exactly');
    row.retainedUnref = {before, unref, reused, oldGeneration: oldResource.generation, newGeneration: newResource.generation, replacementTexture};
    replacementRam.write(new Uint8Array(4096).fill(0xbd)); const uploads = trace.calls.filter(v => /^texSubImage/.test(v.name)).length;
    const oldTexture = await paint('old-after-different-target-reuse', 20, old, oldModel, fault); row.retainedUnref.oldTexture = oldTexture;
    const oldAfter = await sample('old-view-after-different-target-reuse', oldWitness, oldModel, 51, 41);
    c.same(oldAfter.native.state.program, warm.native.state.program, 'novel old program reused after different-target public name');
    c.equal(oldAfter.host.renderer.work.programLinks, oldLinks, 'novel old sampler cache retained');
    c.truth(oldAfter.denseActual !== warm.denseActual, 'novel old native write changes old original witness');
    c.truth(oldTexture.object !== replacementTexture.object, 'novel native old/new texture identity separates');
    c.equal(trace.calls.filter(v => /^texSubImage/.test(v.name)).length, uploads, 'novel old render/refresh uses no CPU texture upload');
    c.equal(hex(replacementRam.read()), 'bd'.repeat(4096), 'novel old native work does not read or write poisoned replacement guest backing'); replacementRam.guards();
    for (const p of fresh.levels) {
      const r = sourceRequest(p, 2); replacementRam.write(new Uint8Array(4096).fill(0x4e)); const at = rig.exchanges.length;
      const record = await rig.expect('novel replacement remains zero mip' + p.level, r.wire), wanted = padded(p, p.bytes, r.stride, r.layerStride, 0x4e);
      const output = {label: 'new-before-paint', level: p.level, record, denseActual: rig.exchanges[at].bytes, denseExpected: hex(p.bytes), backingActual: hex(replacementRam.read()), backingExpected: hex(wanted), guards: replacementRam.guards()}; row.outputs.push(output);
      c.equal(output.denseActual, output.denseExpected, 'novel every replacement native texel remains zero'); c.equal(output.backingActual, output.backingExpected, 'novel all replacement SG padding remains untouched');
    }
    const newPair = pairTexts('fragment', {target: targetName(replacementTarget), type: 'FLOAT', opcode: 'TXL', slot: 7});
    await rig.expect('novel replacement surface and differently typed view', submission(1, join(surface(23, 6, fresh.level, fresh.layer), view(53, fresh), shader(61, 0, newPair.vertexText), shader(62, 1, newPair.fragmentText))));
    const newWarm = await sample('new-warm-zero', newWitness, newModel, 53, 61);
    c.truth(newWarm.native.state.program.object !== warm.native.state.program.object, 'novel different sampler target has a distinct checked native program');
    const newTexture = await paint('new-original-surface', 23, fresh, newModel);
    c.same(newTexture, replacementTexture, 'novel replacement color surface uses its own native image');
    const newAfter = await sample('new-view-after-paint', newWitness, newModel, 53, 61);
    c.same(newAfter.native.state.program, newWarm.native.state.program, 'novel new checked program reused');
    const oldAgain = await sample('old-view-after-new-target-write', oldWitness, oldModel, 51, 41);
    c.equal(oldAgain.denseActual, oldAfter.denseActual, 'novel new target write leaves every original old texel unchanged');
    c.same(oldAgain.native.state.program, warm.native.state.program, 'novel alternating different targets preserves old cache identity');
    c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes, baseBytes + cost(fresh), 'novel no target-switch owner or GPU-charge leak');
    c.equal(native.getError(), native.NO_ERROR, 'novel zero native graphics errors'); row.status = 'passed';
  } catch (error) {row.status = 'failed'; row.failure = {message: error.message, stack: error.stack}; throw error;}
  finally {
    row.faultHits = control.hits; row.calls = trace.calls; row.attachmentStates = trace.states; row.records = copy(rig.q.records); row.events = copy(rig.events); row.exchanges = copy(rig.exchanges); row.completions = copy(rig.completions); row.guestTrace = rig.q.vm.commandTrace(); row.machineDigest = rig.q.vm.machineDigest(); row.beforeDispose = copy(rig.host.bridge.inspect());
    rig.dispose(); row.cleaned = rig.trace.snapshot(); c.equal(rig.trace.objects.size, 0, 'novel all old/new native owners retire'); c.equal(rig.trace.syncs.size, 0, 'novel all native fences retire'); window.__colorSurfaceActive = null;
    if (window.__recordDimensionalColorSurfaceRun) report.rows[report.rows.length - 1] = await window.__recordDimensionalColorSurfaceRun(report.rows.length - 1, JSON.stringify(row));
  }
}

export async function runAcceptance({WasmVirglSubmitProof: Wasm, createVirglStandardDimensionalColorSurfaceSubmitBridge: createBridge, seeds, fault = false}) {
  const native = document.querySelector('#gpu').getContext('webgl2', {antialias: false, failIfMajorPerformanceCaveat: true}), c = checker(); c.truth(native, 'novel hardware WebGL2');
  const info = native.getExtension('WEBGL_debug_renderer_info'), gpu = native.getParameter(info.UNMASKED_RENDERER_WEBGL); c.truth(!/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu), 'novel native hardware renderer');
  const compiler = await createVirglStandardDimensionalShadowTextureShaderBridge(), report = {status: 'running', gpu, rows: [], actualLinuxGuest: false, productionAuthority: false}; window.__dimensionalColorSurfaceReport = report;
  try {
    for (const seed of fault ? seeds.slice(0, 1) : seeds) for (const [old, replacement] of fault ? [[3, 4]] : [[3, 4], [4, 7], [7, 3]]) await runCase(Wasm, createBridge, native, compiler, c, seed, old, replacement, report, fault);
    report.status = 'passed'; report.summary = {status: 'passed', gpu, runs: report.rows.length, schedules: seeds, assertions: c.assertions}; return report;
  } finally {report.assertions = c.assertions;}
}
