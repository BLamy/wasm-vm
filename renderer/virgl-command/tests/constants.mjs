// Authored raw packets exercise constant transport on the actual command renderer.
// Pixel expectations are literal rational geometry/color, never translated GLSL.
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';
import { ORIGINAL_INPUTS } from '../../virgl-shader/tests/components.mjs';
import { digest } from '../../virgl-shader/tests/browser.mjs';
import { createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { createVirglDrawRenderer, createVirglAsyncRenderer } from '../state.mjs';
import { decodeSubmission } from '../decoder.mjs';
import { runDecoderAcceptance } from '../../../tools/virgl-constants/decoder.mjs';

const require = (condition, label) => { if (!condition) throw new Error(label); };
const equal = (actual, expected, label) => require(JSON.stringify(actual) === JSON.stringify(expected), `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
const ok = (result, label) => { require(result?.ok === true, `${label}: ${JSON.stringify(result)}`); return result; };
const bits = (value) => { const b = new ArrayBuffer(4), v = new DataView(b); v.setFloat32(0, value, true); return v.getUint32(0, true); };
const packet = (opcode, type, words) => { const b = new Uint8Array(4 + words.length * 4), v = new DataView(b.buffer); v.setUint32(0, opcode + type * 256 + words.length * 65536, true); words.forEach((word, i) => v.setUint32(4 + 4 * i, word, true)); return b; };
const join = (...parts) => { const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const part of parts) { b.set(part, at); at += part.length; } return b; };
const bind = (handle, stage) => packet(31, 0, [handle, stage]);
const constants = (stage, words) => packet(12, 0, [stage, 0, ...words]);
const link = () => packet(52, 0, [1, 2, 0, 0, 0, 0]);
const CLEAR = packet(7, 0, [4, 0, 0, bits(1), bits(1), 0, 0, 0]);
const DRAW = packet(8, 0, [0, 6, 4, 1, 1, 0, 0, 0, 0, 0, 3, 0]);
const VERTICES = [-1, -1, 1, -1, 1, 1, -1, 1];
const INDICES = [0, 1, 2, 0, 2, 3];
const POISONS = [[16, -8, 4, -2], [-1, 32, -16, 8]].map(values => values.map(bits));
function shaderPacket(handle, stage, text) {
  const result = packet(1, 4, [handle, stage, text.length + 1, 256, 0, ...Array(Math.ceil((text.length + 1) / 4)).fill(0)]);
  result.set(new TextEncoder().encode(text), 24); return result;
}
function bank(mode, stage) {
  const values = Array.from({ length: 46 }, () => [0, 0, 0, 0]);
  if (stage === 0) {
    values[0] = mode === 'B' ? [.25, -.25, 0, 0] : [0, 0, 0, 0];
    values[5] = [.75, .75, .75, .75]; values[7] = [1, 1, 1, 1];
    values[45] = mode === 'B' ? [.5, .5, 1, 1] : [1, 1, 1, 1];
  } else {
    values[0] = [.125, .25, .25, .25]; values[5] = [.75, .125, .5, 1];
    values[7] = [.375, .125, 0, .5]; values[45] = mode === 'B' ? [.625, .25, .5, .5] : [.125, .5, .25, .5];
  }
  return values.flat().map(bits);
}
function currentSub(snapshot, id) { const ctx = snapshot.contexts.find(value => value.id === id); return ctx.subContexts.find(value => value.id === ctx.currentSubContext); }
function expected(mode) {
  return { rectangle: mode === 'B' ? [12, 4, 16, 16] : [0, 0, 32, 32],
    color: mode === 'B' ? [191, 128, 191, 191] : mode === 'low' ? [128, 96, 64, 191] : ['inactive-fragment', 'both-inactive'].includes(mode) ? [255, 0, 0, 255] : [64, 191, 128, 191] };
}
function tile(bytes, name) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const flipped = new Uint8ClampedArray(4096);
  for (let y = 0; y < 32; y++) flipped.set(bytes.subarray(y * 128, (y + 1) * 128), (31 - y) * 128);
  canvas.getContext('2d').putImageData(new ImageData(flipped, 32, 32), 0, 0);
  const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
  image.src = canvas.toDataURL(); image.alt = name; caption.textContent = name; figure.append(image, caption); document.querySelector('#draws').append(figure);
}
function instrument(gl, report, initialMode = null) {
  const ids = new WeakMap(), objects = [], live = new Map(), locations = new WeakMap(), uniformNames = new WeakMap(); let serial = 0;
  const events = report.glEvents = [], control = { mode: initialMode, label: '', mutation: null };
  const id = object => object ? ids.get(object) ?? null : null;
  const creations = { createShader: 'Shader', createProgram: 'Program', createBuffer: 'Buffer', createTexture: 'Texture', createVertexArray: 'VertexArray', createFramebuffer: 'Framebuffer', createSampler: 'Sampler', fenceSync: 'Sync' };
  const record = (call, detail) => events.push({ sequence: events.length, call, label: control.label, ...detail });
  const stageMatches = name => (control.mode?.startsWith('fs-') ? name?.startsWith('fsconst') : name?.startsWith('vsconst'));
  const proxy = new Proxy(gl, { get(target, key) {
    const value = Reflect.get(target, key, target); if (typeof value !== 'function') return value;
    return (...args) => {
      if (control.mutation && key === 'useProgram') { control.mutation.fill(0xff); record('input-mutation', { bytes: control.mutation.length }); control.mutation = null; }
      const actual = value.apply(target, args); let result = actual;
      if (creations[key] && actual) { const identity = `${creations[key]}:${++serial}`; ids.set(actual, identity); objects.push({ object: actual, id: identity, kind: creations[key] }); live.set(identity, creations[key]); record(key, { id: identity }); }
      if (/^delete/.test(key) && args[0]) { live.delete(id(args[0])); record(key, { id: id(args[0]) }); }
      if (key === 'getParameter' && [gl.MAX_VERTEX_UNIFORM_COMPONENTS, gl.MAX_FRAGMENT_UNIFORM_COMPONENTS].includes(args[0])) {
        const vertex = args[0] === gl.MAX_VERTEX_UNIFORM_COMPONENTS;
        if (control.mode?.startsWith('host-invalid') && vertex) result = ({ 'host-invalid-zero': 0, 'host-invalid-negative': -1, 'host-invalid-fraction': 1.5, 'host-invalid-string': '1024', 'host-invalid-nan': NaN, 'host-invalid-infinity': Infinity })[control.mode];
        if (control.mode === 'vs-limit' && vertex || control.mode === 'fs-limit' && !vertex) result = 183;
        if (control.mode === 'order-limit' && vertex) result = 187;
        record(key, { parameter: vertex ? 'MAX_VERTEX_UNIFORM_COMPONENTS' : 'MAX_FRAGMENT_UNIFORM_COMPONENTS', actual, delivered: Number.isFinite(result) ? result : String(result), fault: control.mode });
      }
      if (key === 'getUniformLocation') {
        if (actual) locations.set(actual, { name: args[1], programId: id(args[0]) });
        if (stageMatches(args[1]) && /(?:absent|missing-location)$/.test(control.mode ?? '')) result = null;
        record(key, { programId: id(args[0]), name: args[1], actualPresent: actual !== null, deliveredPresent: result !== null, fault: control.mode });
      }
      if (key === 'getUniformIndices') {
        if (!uniformNames.has(args[0])) uniformNames.set(args[0], new Map());
        args[1].forEach((name, index) => uniformNames.get(args[0]).set(actual[index], name));
        if (stageMatches(args[1][0]) && /(?:absent|missing-index)$/.test(control.mode ?? '')) result = [gl.INVALID_INDEX];
        record(key, { programId: id(args[0]), names: [...args[1]], actual: [...actual], delivered: [...result], fault: control.mode });
      }
      if (key === 'getActiveUniforms') {
        const name = uniformNames.get(args[0])?.get(args[1][0]), type = args[2] === gl.UNIFORM_TYPE, mode = control.mode?.replace(/^(?:vs|fs)-/, '');
        if (stageMatches(name)) {
          if (type && mode === 'wrong-type') result = [gl.FLOAT_VEC4];
          if (!type && ['size48', 'exceeds-declared', 'size-zero', 'size-negative', 'size-fraction', 'size-nan', 'shorter'].includes(mode))
            result = [({ size48: 48, 'exceeds-declared': 47, 'size-zero': 0, 'size-negative': -1, 'size-fraction': 1.5, 'size-nan': NaN, shorter: 8 })[mode]];
        }
        record(key, { programId: id(args[0]), name, parameter: type ? 'UNIFORM_TYPE' : 'UNIFORM_SIZE', actual: [...actual], delivered: [...result].map(x => Number.isFinite(x) ? x : String(x)), fault: control.mode });
      }
      if (key === 'shaderSource') record(key, { id: id(args[0]), source: args[1] });
      if (key === 'compileShader') record(key, { id: id(args[0]), status: target.getShaderParameter(args[0], gl.COMPILE_STATUS), log: target.getShaderInfoLog(args[0]) });
      if (key === 'linkProgram') record(key, { id: id(args[0]), status: target.getProgramParameter(args[0], gl.LINK_STATUS), log: target.getProgramInfoLog(args[0]) });
      if (key === 'uniform4uiv') record(key, { ...locations.get(args[0]), words: [...args[1]], currentProgramId: id(target.getParameter(gl.CURRENT_PROGRAM)) });
      if (['drawElements', 'getBufferSubData', 'copyBufferSubData', 'fenceSync', 'clientWaitSync'].includes(key)) record(key, { programId: id(target.getParameter(gl.CURRENT_PROGRAM)), arguments: args.map(x => typeof x === 'number' ? x : ArrayBuffer.isView(x) ? { byteLength: x.byteLength } : id(x)), result: typeof result === 'number' ? result : id(result) });
      return result;
    };
  } });
  return { gl: proxy, control, events, id, counts: () => Object.fromEntries(Object.values(creations).map(kind => [kind, [...live.values()].filter(value => value === kind).length])),
    finish() { equal(live.size, 0, 'all instrumented objects deleted'); for (const entry of objects) equal(gl[`is${entry.kind}`](entry.object), false, `${entry.id} actually collected`); report.glObjects = { created: objects.length, live: live.size }; } };
}
function makeRig(gl, bridge, report, asynchronous = false, fault = null) {
  const watch = instrument(gl, report, fault), allocations = new Map();
  const actualBackend = ok(createWebGL2TransferBackend(watch.gl), 'actual WebGL backend').backend;
  const backend = { ...actualBackend, allocate(meta) { const value = actualBackend.allocate(meta); allocations.set(meta.id, value); return value; } };
  const { store, bindings, asyncAccess } = ok(createResourceStore({ backend }), 'actual resource store');
  report.translations = []; report.submissions = []; report.draws = []; report.attacks = []; report.lifecycle = [];
  const capability = { translate(request) { const result = bridge.translate(request); report.translations.push({ request, result }); return result; }, translatePair: request => bridge.translatePair(request) };
  const created = (asynchronous ? createVirglAsyncRenderer : createVirglDrawRenderer)({ gl: watch.gl, resources: store, bindings, ...(asynchronous ? { asyncAccess, jobLimits: { commandsPerStep: report.schedule.commandsPerStep } } : {}), shaderBridge: capability });
  if (!created.ok && !fault?.startsWith('host-invalid')) throw new Error('unexpected renderer construction: ' + JSON.stringify(created));
  if (!created.ok) { report.constructorResult = created; ok(store.dispose(), 'failed constructor resource disposal'); watch.finish(); return { created, report }; }
  const renderer = created.renderer, rig = { gl, watch, store, renderer, allocations, report, asynchronous };
  rig.snapshot = () => ok(renderer.inspect(), 'renderer inspection');
  rig.execute = (contextId, bytes, label, mutate = false) => {
    watch.control.label = label; const input = [...bytes]; if (mutate) watch.control.mutation = bytes;
    const result = renderer.executeSubmission(contextId, bytes); const record = { label, contextId, bytes: input, result };
    if (mutate) { record.inputAfter = [...bytes]; equal(watch.control.mutation, null, 'sync mutation occurred after decode'); }
    report.submissions.push(record); return result;
  };
  rig.run = (contextId, bytes, label, mutate = false) => ok(rig.execute(contextId, bytes, label, mutate), label);
  rig.asyncRun = async (contextId, bytes, label) => {
    watch.control.label = label; const record = { label, contextId, bytes: [...bytes], states: [] }; report.submissions.push(record);
    const started = ok(renderer.beginSubmission(contextId, bytes), `${label} begin`); bytes.fill(0xff); record.inputAfter = [...bytes];
    for (let n = 0; n < 1000; n++) {
      const state = ok(renderer.step(started.job), `${label} step`); record.states.push({ status: state.status, appliedCommands: state.appliedCommands });
      if (state.status === 'done') { record.result = state.result; return state.result; }
      require(['ready', 'waiting-gpu'].includes(state.status), 'uploaded fixture resources require no guest DMA exchange');
      record.delays ??= []; const delay = (Math.imul(report.schedule.seed, n + 1) >>> 0) % 3; record.delays.push(delay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('async constant job exceeded 1000 steps');
  };
  rig.dispose = () => { watch.control.mode = null; ok(renderer.dispose(), 'renderer disposal'); report.finalBudgets = rig.snapshot().budgets;
    Object.values(report.finalBudgets).forEach(value => equal(value, 0, 'renderer final zero budget')); ok(store.dispose(), 'resource disposal');
    report.finalResourceBudgets = ok(store.inspect(), 'disposed resource inspection').budgets; Object.values(report.finalResourceBudgets).forEach(value => equal(value, 0, 'resource final zero budget'));
    equal(gl.getError(), gl.NO_ERROR, 'actual GL final error'); watch.finish(); };
  return rig;
}
function createResources(rig) {
  rig.report.geometry = { positions: VERTICES, components: 2, indices: INDICES, width: 32, height: 32 };
  for (const [id, target, format, bindFlags, width, height, data] of [
    [101, 0, 64, 16, 32, 1, new Uint8Array(new Float32Array(VERTICES).buffer)],
    [102, 0, 64, 32, 12, 1, new Uint8Array(new Uint16Array(INDICES).buffer)],
    [103, 2, 67, 10, 32, 32, new Uint8Array(4096)]]) {
    ok(rig.store.createResource({ id, target, format, bind: bindFlags, width, height, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 }), 'resource creation');
    ok(rig.store.attachBacking(id, [data]), 'resource backing');
  }
}
function createContext(rig, id) {
  ok(rig.store.createContext(id), 'resource context'); ok(rig.renderer.createContext(id), 'renderer context');
  for (const resourceId of [101, 102, 103]) ok(rig.store.attachContext(id, resourceId), 'resource membership');
  for (const [resourceHandle, width] of [[101, 32], [102, 12]]) {
    const ticket = ok(rig.store.prepareTransfer(id, { opcode: 43, fields: { resourceHandle, level: 0, usage: 0, stride: 0, layerStride: 0, box: { x: 0, y: 0, z: 0, width, height: 1, depth: 1 }, dataOffset: 0, direction: 1 } }), 'resource upload preparation').ticket;
    ok(rig.store.executeTransfer(ticket), 'actual fixture resource upload');
  }
}
function setupBytes(fixtures, variant = 'high') {
  const names = variant === 'inactive-vertex' ? ['inactive', 'high'] : variant === 'inactive-fragment' ? ['high', 'inactive'] : variant === 'both-inactive' ? ['inactive', 'inactive'] : [variant, variant];
  const vertex = fixtures.find(value => value.name === `hardware-${names[0]}-vertex`), fragment = fixtures.find(value => value.name === `hardware-${names[1]}-fragment`);
  return join(shaderPacket(1, 0, vertex.text), shaderPacket(2, 1, fragment.text),
    packet(1, 8, [10, 103, 67, 0, 0]), packet(5, 0, [1, 0, 10]), packet(1, 5, [11, 0, 0, 0, 29]), packet(2, 5, [11]),
    packet(6, 0, [8, 0, 101]), packet(11, 0, [102, 2, 0]), packet(4, 0, [0, bits(16), bits(16), bits(.5), bits(16), bits(16), bits(.5)]), bind(1, 0));
}
function prepare(rig, fixtures, id, variant = 'high', mode = 'A', upload = true) {
  rig.run(id, setupBytes(fixtures, variant), `context${id} ${variant} setup`);
  if (upload) rig.run(id, join(constants(0, bank(mode, 0)), constants(1, bank(mode, 1))), `context${id} ${mode}184-word uploads`);
  rig.run(id, link(), `context${id} ${variant} explicit prelink`); rig.run(id, bind(2, 1), `context${id} bind fragment`);
}
function readPixels(rig) {
  const gl = rig.gl, old = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), fb = gl.createFramebuffer();
  try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rig.allocations.get(103).texture, 0);
    equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'independent read FBO'); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const bytes = new Uint8Array(4096); gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, bytes); equal(gl.getError(), gl.NO_ERROR, 'independent GPU pixel read'); return bytes;
  } finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old); gl.deleteFramebuffer(fb); }
}
function actualUniforms(rig, program) {
  const gl = rig.gl, actual = gl.getParameter(gl.CURRENT_PROGRAM), records = [];
  for (const uniform of program.reflection.uniforms) {
    const base = uniform.name.replace(/\[0\]$/, ''), words = [];
    for (let i = 0; i < uniform.activeCount; i++) { const at = gl.getUniformLocation(actual, `${base}[${i}]`); require(at !== null, 'actual retained element location'); words.push(...gl.getUniform(actual, at)); }
    records.push({ ...uniform, words });
  }
  return records;
}
async function capture(rig, id, name, mode, drawResult, display = true) {
  const snapshot = rig.snapshot(), sub = currentSub(snapshot, id), program = sub.programs.find(value => value.vertexGeneration === sub.bindings.vertexShader.generation && value.fragmentGeneration === sub.bindings.fragmentShader.generation);
  require(program, 'active diagnostic program'); const bytes = readPixels(rig), oracle = expected(mode);
  const record = { name, expectedMode: mode, contextId: id, subContextId: sub.id, subContextGeneration: sub.generation, ...oracle, pixels: 0,
    program, nativeProgramId: rig.watch.id(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM)), bindings: sub.bindings, hostUniformComponents: snapshot.hostUniformComponents, budgets: snapshot.budgets, nativeCounts: rig.watch.counts(), storedConstantBytes: snapshot.contexts.reduce((sum, ctx) => sum + ctx.subContexts.reduce((n, current) => n + current.bindings.constants.reduce((words, stage) => words + stage.length * 4, 0), 0), 0),
    uniforms: actualUniforms(rig, program), rgbaBytes: [...bytes], rgbaSha256: await digest(bytes), draw: drawResult.draws[0] };
  record.submissionIndex = rig.report.submissions.length - 1; record.selectedShaders = sub.objects.filter(value => [sub.bindings.vertexShader.generation, sub.bindings.fragmentShader.generation].includes(value.generation)).map(value => ({ stage: value.fields.stage, text: value.fields.text }));
  rig.report.draws.push(record); if (display) tile(bytes, name);
  const [x0, y0, width, height] = oracle.rectangle;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const want = x >= x0 && x < x0 + width && y >= y0 && y < y0 + height ? oracle.color : [0, 0, 255, 255], observed = [...bytes.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    if (JSON.stringify(observed) !== JSON.stringify(want)) record.failure = { pixel: [x, y], expected: want, observed };
    equal(observed, want, `${name} independent pixel (${x},${y})`); record.pixels++;
  }
  return record;
}
async function phase(rig, id, name, mode, display = true) { rig.run(id, CLEAR.slice(), `${name} clear`); const result = rig.run(id, DRAW.slice(), `${name} draw`); return capture(rig, id, name, mode, result, display); }
function rejectDraw(rig, id, label, words = null, stage = 1, prefix = false) {
  if (words !== null && !prefix) rig.run(id, constants(stage, words), `${label} replace prefix`);
  const before = rig.snapshot(), eventsAt = rig.watch.events.length;
  const result = rig.execute(id, prefix ? join(constants(stage, words), DRAW) : DRAW.slice(), label);
  equal(result.ok, false, `${label} reject`); equal(result.error.code, 'incomplete-draw', `${label} missing-state`); equal(result.appliedCommands, prefix ? 1 : 0, `${label} applied prefix truth`);
  const after = rig.snapshot(); equal(after.budgets, before.budgets, `${label} unchanged budgets`);
  const changed = rig.watch.events.slice(eventsAt); require(!changed.some(event => ['drawElements', 'getBufferSubData', 'copyBufferSubData'].includes(event.call)), `${label} rejects before index read/stage/draw`);
  if (!prefix) equal(after, before, `${label} draw alone does not mutate state`);
  rig.report.attacks.push({ name: label, before, after, result, events: changed });
}
function poison(rig, values, paddingOnly = false) {
  const gl = rig.gl, program = gl.getParameter(gl.CURRENT_PROGRAM), before = [];
  for (const stage of ['vs', 'fs']) for (const index of paddingOnly ? [46] : [0, 5, 7, 45]) {
    const name = `${stage}const0[${index}]`, location = gl.getUniformLocation(program, name); if (location === null) continue;
    gl.uniform4uiv(location, new Uint32Array(values)); before.push({ name, values, observed: [...gl.getUniform(program, location)] });
  }
  equal(gl.getError(), gl.NO_ERROR, 'actual external uniform poison'); return { nativeProgramId: rig.watch.id(program), entries: before };
}
async function primary(gl, bridge, fixtures, report) {
  const rig = makeRig(gl, bridge, report);
  try {
    createResources(rig); createContext(rig, 1); prepare(rig, fixtures, 1);
    await phase(rig, 1, 'A first high-bank draw', 'A');
    const mutation = join(constants(0, bank('A', 0)), constants(1, bank('A', 1)));
    rig.run(1, mutation, 'sync mutate caller packet after predecode', true);
    equal(currentSub(rig.snapshot(), 1).bindings.constants, [bank('A', 0), bank('A', 1)], 'sync decoded words owned');
    await phase(rig, 1, 'A after synchronous source mutation', 'A');
    report.poison = [poison(rig, POISONS[0])];
    createContext(rig, 2); prepare(rig, fixtures, 2, 'high', 'B'); await phase(rig, 2, 'B isolated context', 'B');
    report.poison.push(poison(rig, POISONS[1])); await phase(rig, 1, 'A restored after B', 'A');
    await phase(rig, 2, 'B restored after A', 'B');
    rig.run(1, packet(29, 0, [7]), 'create subcontext7'); prepare(rig, fixtures, 1, 'high', 'B'); await phase(rig, 1, 'B isolated subcontext7', 'B');
    rig.run(1, packet(28, 0, [0]), 'select default subcontext'); report.poison.push(poison(rig, POISONS[0])); await phase(rig, 1, 'A restored default subcontext', 'A');
    rig.run(1, packet(28, 0, [7]), 'select subcontext7 again'); await phase(rig, 1, 'B restored subcontext7', 'B');
    const oldSub = currentSub(rig.snapshot(), 1).generation;
    report.lifecycle.push({ name: 'destroy/recreate-subcontext7', before: rig.snapshot() });
    rig.run(1, packet(30, 0, [7]), 'destroy subcontext7'); rig.run(1, packet(29, 0, [7]), 'recreate subcontext7'); prepare(rig, fixtures, 1, 'high', 'B', false);
    require(currentSub(rig.snapshot(), 1).generation !== oldSub, 'subcontext numeric reuse advances generation');
    equal(currentSub(rig.snapshot(), 1).bindings.constants, [[], []], 'recreated subcontext has empty constant banks'); rejectDraw(rig, 1, 'recreated subcontext lacks inherited data');
    rig.run(1, join(constants(0, bank('B', 0)), constants(1, bank('B', 1))), 'new subcontext B banks'); await phase(rig, 1, 'B recreated subcontext', 'B');
    report.lifecycle.at(-1).after = rig.snapshot();
    const oldContext = rig.snapshot().contexts.find(ctx => ctx.id === 2).generation;
    report.lifecycle.push({ name: 'destroy/recreate-context2', before: rig.snapshot() });
    ok(rig.renderer.destroyContext(2), 'destroy renderer context2'); ok(rig.store.destroyContext(2), 'destroy resource context2'); createContext(rig, 2); prepare(rig, fixtures, 2, 'high', 'B', false);
    require(rig.snapshot().contexts.find(ctx => ctx.id === 2).generation !== oldContext, 'context numeric reuse advances generation');
    equal(currentSub(rig.snapshot(), 2).bindings.constants, [[], []], 'recreated context has empty constant banks'); rejectDraw(rig, 2, 'recreated context lacks inherited data');
    rig.run(2, join(constants(0, bank('B', 0)), constants(1, bank('B', 1))), 'new context B banks'); await phase(rig, 2, 'B recreated context', 'B');
    report.lifecycle.at(-1).after = rig.snapshot();
    rig.run(1, packet(28, 0, [0]), 'select A for completeness attacks');
    for (const stage of [0, 1]) {
      rejectDraw(rig, 1, `stage${stage} short180 replaces184`, bank('A', stage).slice(0, 180), stage);
      equal(currentSub(rig.snapshot(), 1).bindings.constants[stage].length, 180, 'stored short prefix excludes old suffix');
      rig.run(1, constants(stage, bank('A', stage)), `stage${stage} full recovery`);
      rejectDraw(rig, 1, `stage${stage} empty replaces184`, [], stage);
      equal(currentSub(rig.snapshot(), 1).bindings.constants[stage], [], 'empty state excludes old suffix');
      rig.run(1, constants(stage, bank('A', stage)), `stage${stage} empty recovery`);
      rejectDraw(rig, 1, `stage${stage} valid prefix then failed draw`, bank('A', stage).slice(0, 180), stage, true);
      rig.run(1, constants(stage, bank('A', stage)), `stage${stage} applied-prefix recovery`);
    }
    const before = rig.snapshot(), eventsAt = rig.watch.events.length;
    const malformed = rig.execute(1, join(constants(1, bank('B', 1)), constants(0, [...bank('A', 0), 0, 0, 0, 0])), 'malformed tail predecodes before valid prefix');
    equal(malformed.ok, false, '188-word malformed tail rejects'); equal(malformed.appliedCommands, 0, 'malformed tail applies no prefix'); equal(rig.snapshot(), before, 'malformed tail preserves all state');
    equal(rig.watch.events.length, eventsAt, 'malformed tail no GL effects'); report.attacks.push({ name: 'malformed-tail', before, after: rig.snapshot(), result: malformed, events: [] });
    await phase(rig, 1, 'A after incomplete and malformed recovery', 'A');
  } finally { rig.dispose(); }
}
async function variants(gl, bridge, fixtures, reports) {
  for (const variant of ['low', 'order', 'inactive-vertex', 'inactive-fragment', 'both-inactive']) {
    const report = { name: variant, classification: 'actual-hardware' }; reports.push(report); const rig = makeRig(gl, bridge, report);
    try {
      createResources(rig); createContext(rig, 1); prepare(rig, fixtures, 1, variant, 'A', false);
      const active = currentSub(rig.snapshot(), 1).programs[0].reflection.uniforms;
      for (const uniform of active) {
        if (variant === 'both-inactive' || variant === `inactive-${uniform.stage}`) equal([uniform.activeCount, uniform.uploadCount], [0, 0], `${uniform.stage} actual unused declaration inactive`);
        else require(uniform.activeCount > 0, 'actual read keeps constants active');
      }
      if (variant === 'low') {
        report.retainedExtent = active.map(uniform => ({ stage: uniform.stage, count: uniform.count, activeCount: uniform.activeCount, uploadCount: uniform.uploadCount }));
        rig.run(1, join(constants(0, bank('A', 0).slice(0, 32)), constants(1, bank('A', 1).slice(0, 32))), 'low-address32-word inputs');
        if (active.some(uniform => uniform.uploadCount > 8)) rejectDraw(rig, 1, 'low shader conservatively needs retained prefix');
      }
      for (const [stage, name] of [[0, 'vertex'], [1, 'fragment']]) if (active.find(uniform => uniform.stage === name)?.uploadCount > 0) rig.run(1, constants(stage, bank('A', stage)), `${variant} active ${name} full prefix`);
      await phase(rig, 1, `${variant} actual renderer`, ['low', 'inactive-vertex', 'inactive-fragment', 'both-inactive'].includes(variant) ? variant : 'A');
      if (variant === 'order') {
        report.padding = [];
        for (const values of POISONS) {
          const poisoned = poison(rig, values, true); require(poisoned.entries.length > 0, 'qualified host retains at least one declared host-only47th element');
          const frame = await phase(rig, 1, 'order47 restored with poisoned host padding', 'A');
          const after = poisoned.entries.map(entry => { const at = rig.gl.getUniformLocation(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM), entry.name); return { name: entry.name, observed: [...rig.gl.getUniform(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM), at)] }; });
          equal(after, poisoned.entries.map(entry => ({ name: entry.name, observed: values })), 'renderer never writes retained host-only index46');
          report.padding.push({ poisoned, after, drawName: frame.name });
        }
      }
      if (variant === 'both-inactive') require(!report.glEvents.some(event => event.call === 'uniform4uiv'), 'fully inactive arrays produce no constant uploads');
    } finally { rig.dispose(); }
  }
}
async function validationFaults(gl, bridge, fixtures, reports) {
  const failures = ['vs-wrong-type', 'fs-wrong-type', 'vs-size48', 'vs-exceeds-declared', 'vs-size-zero', 'vs-size-negative', 'vs-size-fraction', 'vs-size-nan', 'vs-missing-index', 'vs-missing-location', 'fs-missing-index', 'fs-missing-location', 'vs-limit', 'fs-limit', 'order-limit'];
  for (const mode of failures) {
    const report = { name: mode, classification: 'real-GL-pass-through-reflection-validation' }; reports.push(report);
    const rig = makeRig(gl, bridge, report, false, mode.endsWith('limit') ? mode : null);
    try {
      createResources(rig); createContext(rig, 1); rig.run(1, setupBytes(fixtures, mode === 'order-limit' ? 'order' : 'high'), `${mode} unlinked setup`);
      const before = rig.snapshot(), countsBefore = rig.watch.counts(), eventsAt = rig.watch.events.length; rig.watch.control.mode = mode;
      const result = rig.execute(1, link(), `${mode} injected link reflection`); equal(result.ok, false, `${mode} reject`); equal(result.error.code, 'shader-reflection-error', `${mode} error`); equal(result.appliedCommands, 0, `${mode} no applied link`);
      equal(rig.snapshot(), before, `${mode} unchanged publication/budgets`); equal(rig.watch.counts(), countsBefore, `${mode} no native leaks`);
      report.validation = { mode, result, before, after: rig.snapshot(), countsBefore, countsAfter: rig.watch.counts(), events: rig.watch.events.slice(eventsAt) };
      require(report.validation.events.some(event => event.call === 'linkProgram' && event.status), 'fault follows successful actual linking');
      if (mode.startsWith('fs-')) require(report.validation.events.some(event => event.call === 'createBuffer'), 'late fragment failure follows VS system-buffer allocation');
      rig.watch.control.mode = null;
      if (!mode.endsWith('limit')) { rig.run(1, link(), `${mode} recovery link`); rig.run(1, join(constants(0, bank('A', 0)), constants(1, bank('A', 1)), bind(2, 1)), `${mode} recovery banks/bind`); await phase(rig, 1, `${mode} genuine recovery draw`, 'A', false); }
    } finally { rig.dispose(); }
  }
  for (const mode of ['vs-shorter', 'fs-shorter', 'vs-absent', 'fs-absent']) {
    const report = { name: mode, classification: 'real-GL-pass-through-reflection-validation' }; reports.push(report); const rig = makeRig(gl, bridge, report);
    try {
      createResources(rig); createContext(rig, 1); rig.run(1, setupBytes(fixtures, 'low'), `${mode} low setup`); rig.watch.control.mode = mode;
      rig.run(1, link(), `${mode} injected reflection`); rig.watch.control.mode = null;
      const reflection = currentSub(rig.snapshot(), 1).programs[0].reflection.uniforms, stage = mode.startsWith('vs') ? 'vertex' : 'fragment', target = reflection.find(uniform => uniform.stage === stage);
      equal([target.count, target.activeCount, target.uploadCount], [46, mode.endsWith('shorter') ? 8 : 0, mode.endsWith('shorter') ? 8 : 0], 'declared extent survives simulated driver pruning');
      report.validation = { mode, reflection, result: 'accepted', actualDrawClaim: false };
      if (mode.endsWith('shorter')) {
        rig.run(1, join(constants(0, bank('A', 0).slice(0, mode.startsWith('vs') ? 32 : 184)), constants(1, bank('A', 1).slice(0, mode.startsWith('fs') ? 32 : 184)), bind(2, 1)), 'short reflected prefix inputs');
        await phase(rig, 1, `${mode} low valid output`, 'low', false); report.validation.actualDrawClaim = 'low shader output only; shorter reflection supplied by wrapper';
      }
    } finally { rig.dispose(); }
  }
  for (const mode of ['host-invalid-zero', 'host-invalid-negative', 'host-invalid-fraction', 'host-invalid-string', 'host-invalid-nan', 'host-invalid-infinity']) {
    const report = { name: mode, classification: 'real-GL-pass-through-host-limit-validation' }; reports.push(report); const rig = makeRig(gl, bridge, report, false, mode);
    equal(rig.created.ok, false, `${mode} constructor rejects`); equal(rig.created.error.code, 'unsupported-host', `${mode} unsupported host`);
  }
}
async function asynchronous(gl, bridge, fixtures, report) {
  const rig = makeRig(gl, bridge, report, true);
  try {
    createResources(rig); createContext(rig, 1);
    ok(await rig.asyncRun(1, join(setupBytes(fixtures), constants(0, bank('A', 0)), constants(1, bank('A', 1)), link(), bind(2, 1)), 'async A setup with source mutation'), 'async setup');
    equal(currentSub(rig.snapshot(), 1).bindings.constants, [bank('A', 0), bank('A', 1)], 'async begin owns all constant words after packet mutation');
    const first = ok(await rig.asyncRun(1, join(CLEAR, DRAW), 'async A high draw'), 'async draw'); await capture(rig, 1, 'async A high draw', 'A', first);
    ok(await rig.asyncRun(1, join(constants(0, bank('B', 0)), constants(1, bank('B', 1))), 'async B bank replacement'), 'async replacement');
    const second = ok(await rig.asyncRun(1, join(CLEAR, DRAW), 'async B high draw'), 'async B draw'); await capture(rig, 1, 'async B high draw', 'B', second);
    ok(await rig.asyncRun(1, constants(1, bank('B', 1).slice(0, 180)), 'async short180 bank'), 'async short prefix');
    const before = rig.snapshot(), eventsAt = rig.watch.events.length, rejected = await rig.asyncRun(1, DRAW.slice(), 'async missing last vec4');
    equal(rejected.ok, false, 'async incomplete draw rejects'); equal(rejected.error.code, 'incomplete-draw', 'async missing-state'); equal(rejected.appliedCommands, 0, 'async reject before draw');
    equal(rig.snapshot().budgets, before.budgets, 'async reject budgets stable'); require(!rig.watch.events.slice(eventsAt).some(event => ['drawElements', 'getBufferSubData', 'copyBufferSubData'].includes(event.call)), 'async incomplete rejects before staged index collection');
    report.attacks.push({ name: 'async-short180', before, after: rig.snapshot(), result: rejected, events: rig.watch.events.slice(eventsAt) });
    ok(await rig.asyncRun(1, constants(1, []), 'async empty bank'), 'async empty prefix');
    const emptyBefore = rig.snapshot(), emptyEventsAt = rig.watch.events.length, emptyResult = await rig.asyncRun(1, DRAW.slice(), 'async empty draw');
    equal(emptyResult.ok, false, 'async empty draw rejects'); equal(emptyResult.error.code, 'incomplete-draw', 'async empty incomplete-draw'); equal(emptyResult.appliedCommands, 0, 'async empty reject before draw');
    equal(rig.snapshot().budgets, emptyBefore.budgets, 'async empty budget stable'); require(!rig.watch.events.slice(emptyEventsAt).some(event => ['drawElements', 'getBufferSubData', 'copyBufferSubData'].includes(event.call)), 'async empty rejects before index collection');
    report.attacks.push({ name: 'async-empty', before: emptyBefore, after: rig.snapshot(), result: emptyResult, events: rig.watch.events.slice(emptyEventsAt) });
    ok(await rig.asyncRun(1, join(constants(0, bank('A', 0)), constants(1, bank('A', 1))), 'async recovered A bank'), 'async recovery prefix');
    const recovered = ok(await rig.asyncRun(1, join(CLEAR, DRAW), 'async A recovery draw'), 'async recovery draw'); await capture(rig, 1, 'async A recovered after short and empty', 'A', recovered);
  } finally { rig.dispose(); }
}
export async function runAcceptance() {
  const report = { schema: 'wasm-vm-constant-browser-v1', status: 'running', guestExecution: false, productionVirgl: false, policy: 'declared count unchanged; legal prefix min(activeCount,46); wholly inactive requires none; no semantic read-set claim', shaderFixtures: [], corpus: [], rigs: [], validationRigs: [] };
  window.__virglConstantsReport = report;
  try {
    const canvas = document.querySelector('#gpu'); canvas.width = canvas.height = 32;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true }); require(gl instanceof WebGL2RenderingContext, 'actual WebGL2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info'); require(debug, 'hardware renderer identity'); report.renderer = { vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) };
    require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer), 'hardware rendering');
    report.decoder = runDecoderAcceptance();
    report.hostUniformComponents = [gl.getParameter(gl.MAX_VERTEX_UNIFORM_COMPONENTS), gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_COMPONENTS)];
    const bridge = await createVirglShaderBridge(), fixtureResponse = await fetch('/renderer/virgl-command/tests/constant-shaders.json'); require(fixtureResponse.ok, 'exact shader fixture');
    const fixtureBytes = new Uint8Array(await fixtureResponse.arrayBuffer()), fixtures = JSON.parse(new TextDecoder().decode(fixtureBytes)); report.fixture = { bytes: fixtureBytes.length, sha256: await digest(fixtureBytes) };
    for (const input of fixtures) {
      const result = ok(bridge.translate({ stage: input.stage, text: input.text }), `${input.name} translate`); equal(result.metadata.uniforms.map(uniform => uniform.count), [input.expected.constantCount], `${input.name} unchanged declaration extent`);
      report.shaderFixtures.push({ ...input, inputSha256: await digest(input.text), result });
    }
    for (const input of ORIGINAL_INPUTS) {
      const response = await fetch(`/${input.path}`); require(response.ok, 'unchanged original source'); const bytes = new Uint8Array(await response.arrayBuffer()); equal(await digest(bytes), input.sha256, 'original source SHA');
      const text = new TextDecoder().decode(bytes), stage = text.startsWith('VERT') ? 'vertex' : 'fragment', result = bridge.translate({ stage, text }); report.corpus.push({ ...input, stage, result });
    }
    equal(report.corpus.filter(value => value.result.ok).length, 12, 'unchanged12/19 corpus outcome');
    const decodedPacket = constants(1, bank('A', 1)), decoded = ok(decodeSubmission(decodedPacket), 'standalone immutable decode'); decodedPacket.fill(0xff);
    equal(decoded.commands[0].fields.words, bank('A', 1), 'independent decode snapshot'); report.decodedOwnership = { mutatedInput: [...decodedPacket], decoded };
    const main = { name: 'primary', classification: 'actual-hardware' }; report.rigs.push(main); await primary(gl, bridge, fixtures, main);
    await variants(gl, bridge, fixtures, report.rigs); await validationFaults(gl, bridge, fixtures, report.validationRigs);
    for (const [seed, commandsPerStep] of [[0x7c1209ad, 1], [0x491be583, 2], [0xea016f35, 3], [0x265d8cb7, 8]]) {
      const async = { name: `async-${seed.toString(16)}`, classification: 'actual-hardware', schedule: { seed, commandsPerStep } }; report.rigs.push(async); await asynchronous(gl, bridge, fixtures, async);
    }
    report.checkedPixels = [...report.rigs, ...report.validationRigs].reduce((n, rig) => n + (rig.draws ?? []).reduce((sum, draw) => sum + draw.pixels, 0), 0);
    report.status = 'passed'; document.querySelector('#status').textContent = `${report.checkedPixels} exact hardware pixels;184-word transport; active declaration policy and ownership attacks passed`; document.querySelector('#renderer').textContent = report.renderer.renderer; return report;
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; document.querySelector('#status').textContent = error.message; throw error; }
}
