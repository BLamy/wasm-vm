// Independent critic inputs and output oracles. The served worker module exposes
// only its audited packet/resource scaffolding; none of its acceptance functions
// or expected-output helpers are called here.
import { createVirglShaderBridge } from '/renderer/virgl-shader/index.mjs';
import { createVirglDrawRenderer } from '/renderer/virgl-command/state.mjs';
import { createResourceStore, createWebGL2TransferBackend } from '/renderer/virgl-command/resources.mjs';
import { makeRig, createResources, createContext, setupBytes, constants, link, bind,
  CLEAR, DRAW, join, packet, readPixels, currentSub, poison } from '/renderer/virgl-command/tests/constants.mjs';

const report = { schema: 'constant-critic-attacks-v1', status: 'running', rigs: [], faults: [], assertions: 0, checkedPixels: 0 };
window.criticReport = report;
function insist(value, label) { report.assertions++; if (!value) throw new Error(label); }
function same(a, b, label) { insist(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function good(r, label) { insist(r?.ok === true, `${label}: ${JSON.stringify(r)}`); return r; }
function bit(value) { const b = new ArrayBuffer(4), d = new DataView(b); d.setFloat32(0, value, true); return d.getUint32(0, true); }
function bank(which, stage) {
  const r = Array.from({ length: 46 }, (_, i) => [(i - 23) / 64, (i + 1) / 128, -i / 64, .25]);
  if (stage === 0) {
    r[0] = which === 'A' ? [-.25, .25, 0, 0] : [.5, -.5, 0, 0];
    r[45] = which === 'A' ? [.5, .5, 1, 1] : [.25, .25, 1, 1];
    r[5] = [.125, .25, .375, .5];
  } else {
    r[0] = which === 'A' ? [.125, .125, .125, 0] : [0, .25, 0, 0];
    r[45] = which === 'A' ? [.25, .375, .5, 0] : [.75, 0, .125, 0];
    r[5] = which === 'A' ? [.625, .75, .875, 1] : [.875, .5, .25, .125];
  }
  return r.flat().map(bit);
}
const RECT = { A: [4, 12, 16, 16], B: [20, 4, 8, 8] };
const COLOR = { A: [96, 128, 159, 159], B: [191, 64, 32, 223] };
async function pixels(rig, context, v, f, label, submit = true) {
  if (submit) { rig.run(context, CLEAR.slice(), `${label}:clear`); rig.run(context, DRAW.slice(), `${label}:draw`); }
  const raw = readPixels(rig), [x0, y0, w, h] = RECT[v], snapshot = rig.snapshot();
  const entry = { label, context, v, f, rectangle: RECT[v], color: COLOR[f], bytes: [...raw], snapshot, pixels: 0 };
  rig.report.criticFrames ??= []; rig.report.criticFrames.push(entry);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const expected = x >= x0 && x < x0 + w && y >= y0 && y < y0 + h ? COLOR[f] : [0, 0, 255, 255];
    const actual = [...raw.subarray((y * 32 + x) * 4, (y * 32 + x + 1) * 4)];
    if (JSON.stringify(expected) !== JSON.stringify(actual)) entry.failure = { x, y, expected, actual };
    same(actual, expected, `${label}: independent pixel ${x},${y}`); entry.pixels++; report.checkedPixels++;
  }
  same(currentSub(snapshot, context).bindings.constants, [bank(v, 0), bank(f, 1)], `${label}: exact selected stage banks`);
}
function prepare(rig, fixtures, context, v, f, variant = 'high', upload = true) {
  rig.run(context, setupBytes(fixtures, variant), `critic setup ${context}/${variant}`);
  if (upload) rig.run(context, join(constants(0, bank(v, 0)), constants(1, bank(f, 1))), 'critic asymmetric upload');
  rig.run(context, join(link(), bind(2, 1)), 'critic prelink and bind');
}
function reject(rig, context, label) {
  const before = rig.snapshot(), at = rig.watch.events.length, result = rig.execute(context, DRAW.slice(), label);
  same(result.ok, false, `${label}: rejected`); same(result.error.code, 'incomplete-draw', `${label}: code`); same(result.appliedCommands, 0, `${label}: applied`);
  same(rig.snapshot(), before, `${label}: state and budgets unchanged`);
  const events = rig.watch.events.slice(at); insist(!events.some(e => ['drawElements', 'getBufferSubData', 'copyBufferSubData', 'fenceSync'].includes(e.call)), `${label}: no index read/stage/fence/draw`);
  rig.report.criticRejections ??= []; rig.report.criticRejections.push({ label, before, result, after: rig.snapshot(), events });
}
function proxyGl(gl, overrides) { return new Proxy(gl, { get(t, key) { return overrides[key] ?? (typeof t[key] === 'function' ? t[key].bind(t) : t[key]); } }); }

export async function run() {
  try {
    const canvas = document.querySelector('#gpu'); canvas.width = canvas.height = 32;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
    insist(gl instanceof WebGL2RenderingContext, 'real WebGL2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info'); insist(ext, 'driver identity');
    report.renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); insist(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer), 'hardware path');
    const bridge = await createVirglShaderBridge(), fixtures = await (await fetch('/renderer/virgl-command/tests/constant-shaders.json')).json();
    report.fixtures = fixtures;
    report.oracle = { rectangle: RECT, color: COLOR, banks: { A: [bank('A', 0), bank('A', 1)], B: [bank('B', 0), bank('B', 1)] }, derivation: 'VS = input * scale + offset on a 32x32 viewport; FS RGB = CONST45 + CONST0, alpha = CONST5.x; fixed rational inputs and independently rounded RGBA8 literals' };
    const own = { name: 'asymmetric-owner-sequence', classification: 'actual-hardware' }; report.rigs.push(own);
    const rig = makeRig(gl, bridge, own);
    try {
      createResources(rig); createContext(rig, 11); createContext(rig, 22);
      prepare(rig, fixtures, 11, 'A', 'A'); await pixels(rig, 11, 'A', 'A', 'initial A/A');
      prepare(rig, fixtures, 22, 'B', 'B'); await pixels(rig, 22, 'B', 'B', 'initial B/B');
      rig.run(11, constants(1, bank('B', 1)), 'replace only A fragment with B'); await pixels(rig, 11, 'A', 'B', 'A/B cross-stage');
      rig.run(22, constants(0, bank('B', 0).slice(0, 180)), 'short only B vertex');
      same(currentSub(rig.snapshot(), 22).bindings.constants[0].length, 180, 'short VS owns exactly180'); reject(rig, 22, 'short VS after independent FS');
      await pixels(rig, 11, 'A', 'B', 'other owner survives short VS');
      rig.run(22, constants(0, bank('A', 0)), 'recover B owner with A vertex'); await pixels(rig, 22, 'A', 'B', 'A/B recovery');
      rig.run(11, constants(1, bank('B', 1).slice(0, 180)), 'short A owner fragment');
      await pixels(rig, 22, 'A', 'B', 'complete owner survives short other FS'); reject(rig, 11, 'short FS after owner switch');
      rig.run(11, constants(1, bank('A', 1)), 'restore A fragment'); await pixels(rig, 11, 'A', 'A', 'A/A recovered');
      rig.run(11, packet(29, 0, [5]), 'new sub5'); prepare(rig, fixtures, 11, 'B', 'A'); await pixels(rig, 11, 'B', 'A', 'B/A sub5');
      own.criticPoison = poison(rig, [.9375, -.5, .0625, .25].map(bit));
      rig.run(11, packet(28, 0, [0]), 'select sub0'); await pixels(rig, 11, 'A', 'A', 'sub0 after poisoned sub5');
      rig.run(11, packet(28, 0, [5]), 'select sub5'); await pixels(rig, 11, 'B', 'A', 'poisoned sub5 restored');
      const prior = rig.snapshot().contexts.find(c => c.id === 22).generation;
      good(rig.renderer.destroyContext(22), 'destroy context22'); good(rig.store.destroyContext(22), 'destroy resource context22');
      createContext(rig, 22); prepare(rig, fixtures, 22, 'B', 'B', 'high', false);
      insist(rig.snapshot().contexts.find(c => c.id === 22).generation !== prior, 'numeric context reuse changed generation');
      same(currentSub(rig.snapshot(), 22).bindings.constants, [[], []], 'recreated context empty'); reject(rig, 22, 'recreated owner no inherited data');
      rig.run(22, join(constants(0, bank('B', 0)), constants(1, bank('B', 1))), 'new owner banks'); await pixels(rig, 22, 'B', 'B', 'recreated owner recovery');
      const before = rig.snapshot(), events = rig.watch.events.length;
      const malformed = rig.execute(22, join(constants(0, bank('A', 0)), constants(1, [...bank('A', 1), 0, 0, 0, 0])), 'bad188 after valid replacement');
      same(malformed.ok, false, 'bad188 rejects'); same(malformed.appliedCommands, 0, 'bad188 no prefix'); same(rig.snapshot(), before, 'bad188 state unchanged'); same(rig.watch.events.length, events, 'bad188 zero GL effects');
    } finally { rig.dispose(); }

    // Both stage limits are tested exactly below and at the retained declaration
    // footprint. These pass-through overrides are validation, not claimed GPUs.
    for (const stage of [0, 1]) for (const [variant, needed] of [['high', 184], ['order', 188]]) for (const difference of [-1, 0]) {
      const limit = needed + difference, marker = { name: `limit-stage${stage}-${variant}-${limit}`, classification: 'actual-GL-host-limit-validation', stage, variant, limit, expected: difference === 0 };
      report.rigs.push(marker);
      const wrapped = proxyGl(gl, { getParameter(p) { return p === (stage ? gl.MAX_FRAGMENT_UNIFORM_COMPONENTS : gl.MAX_VERTEX_UNIFORM_COMPONENTS) ? limit : gl.getParameter(p); } });
      const r = makeRig(wrapped, bridge, marker);
      try {
        createResources(r); createContext(r, 1); r.run(1, setupBytes(fixtures, variant), 'limit unlinked setup');
        const before = r.snapshot(), objects = r.watch.counts(), at = r.watch.events.length, result = r.execute(1, link(), 'limit attempted link');
        marker.linkResult = result; marker.linkEvents = r.watch.events.slice(at);
        same(result.ok, difference === 0, 'exact stage component boundary');
        if (difference < 0) { same(result.error.code, 'shader-reflection-error', 'limit error'); same(r.snapshot(), before, 'limit rollback'); same(r.watch.counts(), objects, 'limit no native leak'); }
        else { r.run(1, join(constants(0, bank('B', 0)), constants(1, bank('A', 1)), bind(2, 1)), 'limit inputs'); await pixels(r, 1, 'B', 'A', 'limit exact boundary draw'); }
      } finally { r.dispose(); }
    }

    for (const [name, patch] of [['count-zero', { count: 0 }], ['count48', { count: 48 }], ['count-fraction', { count: 46.5 }], ['wrong-encoding', { encoding: 'integer-bits' }], ['wrong-type', { type: 'vec4[]' }]]) {
      const marker = { name: `metadata-${name}`, classification: 'trusted-compiler-boundary-validation' }; report.rigs.push(marker);
      const changedBridge = { ...bridge, translate(request) { const r = bridge.translate(request); return r.ok && request.stage === 'fragment' ? { ...r, metadata: { ...r.metadata, uniforms: r.metadata.uniforms.map(u => ({ ...u, ...patch })) } } : r; } };
      const r = makeRig(gl, changedBridge, marker);
      try {
        createResources(r); createContext(r, 1); r.run(1, setupBytes(fixtures), 'invalid metadata setup');
        const before = r.snapshot(), objects = r.watch.counts(), at = r.watch.events.length, result = r.execute(1, link(), 'invalid fragment metadata link');
        marker.result = result; marker.events = r.watch.events.slice(at);
        same(result.ok, false, 'invalid metadata refused'); same(result.error.code, 'shader-reflection-error', 'invalid metadata error');
        same(r.snapshot(), before, 'invalid metadata unchanged'); same(r.watch.counts(), objects, 'invalid metadata no leaks');
        insist(marker.events.some(e => e.call === 'createBuffer') && marker.events.some(e => e.call === 'deleteBuffer'), 'late metadata failure released VS UBO');
      } finally { r.dispose(); }
    }

    for (const [name, value] of [['unsafe', Number.MAX_SAFE_INTEGER + 1], ['null', null], ['undefined', undefined], ['negative-zero', -0]]) for (const stage of [0, 1]) {
      const backend = good(createWebGL2TransferBackend(gl), 'host validation backend').backend;
      const { store, bindings } = good(createResourceStore({ backend }), 'host validation store');
      const wrapped = proxyGl(gl, { getParameter(p) { return p === (stage ? gl.MAX_FRAGMENT_UNIFORM_COMPONENTS : gl.MAX_VERTEX_UNIFORM_COMPONENTS) ? value : gl.getParameter(p); } });
      const result = createVirglDrawRenderer({ gl: wrapped, resources: store, bindings, shaderBridge: bridge });
      same(result.ok, false, `${name} stage${stage} reject`); same(result.error.code, 'unsupported-host', 'host invalid class');
      good(store.dispose(), 'host validation cleanup'); report.faults.push({ name, stage, result });
    }

    for (const [seed, steps] of [[0x6da0c389, 4], [0xdb81295b, 7]]) {
      const marker = { name: `detached-async-${seed.toString(16)}`, classification: 'actual-hardware', schedule: { seed, commandsPerStep: steps } }; report.rigs.push(marker);
      const r = makeRig(gl, bridge, marker, true);
      const send = async (bytes, label) => {
        r.watch.control.label = label; const original = [...bytes]; const started = good(r.renderer.beginSubmission(1, bytes), `${label}: begin`);
        structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); same(bytes.byteLength, 0, 'caller buffer actually detached');
        const record = { label, original, detachedLength: bytes.byteLength, states: [] }; marker.detachedSubmissions ??= []; marker.detachedSubmissions.push(record);
        for (let i = 0; i < 1000; i++) {
          const next = good(r.renderer.step(started.job), `${label}: step`); record.states.push(next);
          if (next.status === 'done') { record.result = next.result; return next.result; }
          await new Promise(resolve => setTimeout(resolve, (Math.imul(seed, i + 3) >>> 0) % 4));
        }
        throw new Error('detached async budget exhausted');
      };
      try {
        createResources(r); createContext(r, 1);
        good(await send(join(setupBytes(fixtures), constants(0, bank('B', 0)), constants(1, bank('A', 1)), link(), bind(2, 1)), 'detached async setup'), 'detached setup');
        good(await send(join(CLEAR, DRAW), 'detached B/A draw'), 'detached first draw'); await pixels(r, 1, 'B', 'A', 'detached B/A', false);
        good(await send(constants(0, bank('A', 0).slice(0, 180)), 'detached short VS'), 'short VS transport');
        const before = r.snapshot(), at = r.watch.events.length, rejected = await send(DRAW.slice(), 'detached incomplete draw');
        same(rejected.ok, false, 'detached incomplete reject'); same(rejected.error.code, 'incomplete-draw', 'detached incomplete class'); same(rejected.appliedCommands, 0, 'detached incomplete no draw applied');
        same(r.snapshot().budgets, before.budgets, 'detached incomplete no allocation');
        const events = r.watch.events.slice(at); insist(!events.some(e => ['drawElements', 'copyBufferSubData', 'getBufferSubData'].includes(e.call)), 'detached incomplete no staged index');
        marker.incomplete = { before, after: r.snapshot(), rejected, events };
        good(await send(join(constants(0, bank('A', 0)), constants(1, bank('B', 1)), CLEAR, DRAW), 'detached recovery A/B'), 'detached recovery');
        await pixels(r, 1, 'A', 'B', 'detached A/B recovery', false);
      } finally { r.dispose(); }
    }
    report.status = 'passed'; return report;
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; throw error; }
}
