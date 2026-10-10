import { createVirglStandardShaderBridge } from '../../virgl-shader/standard.mjs';
import { checks, dispose, join, blob, clear, packet } from './standard-instanced-draws.mjs';
import { pointSpec, pointDraw, pointSetup, pointRig, pointSubmit } from './standard-native-points.mjs';
import { criticPointFrame } from '../../../tools/virgl-command/standard-point-adversarial-oracle.mjs';

export const CRITIC_SEED = 0x2deaad13;
const word = n => new Uint32Array(new Float32Array([n]).buffer)[0];
export function seededPlan(seed = CRITIC_SEED) {
  let word = seed >>> 0;
  const next = () => (word = (Math.imul(word, 1103515245) + 12345) >>> 0);
  const base = 65536 + next() % 2048, marker = 0x01000000 + next() % 16384;
  const ids = [base + 3, base + 29, base + 61, base + 97];
  const sizes = ids.map(() => [2, 3.25, 4, 5.25, 6, 7.25][next() % 6]);
  const centers = [[2.25, 3.25], [7.25, 11.25], [12.25, 6.25], [9.25, 9.25]];
  const fixedSize = [2.25, 4.25, 6.25][next() % 3];
  return { seed, base, marker, ids: [marker, ...ids.slice(0, 2), marker, ...ids.slice(2), marker], originalIds: ids, sizes, centers, fixedSize,
    indexOffset: 20, offsets: [28, 44, 12], sourceOffsets: [12, 4, 20],
    schedule: 'step=1; delay=3+((ordinal*17 xor seed) mod 7)' };
}

export async function runAcceptance({ smoke = false } = {}) {
  const c = checks(), plan = seededPlan(), report = { schema: 'standard-point-critic-v1', status: 'running', guestExecution: false, productionNegotiation: false,
    seed: CRITIC_SEED, plan, predictions: c.rows, frames: [], runs: [], blobs: [], ownership: [], rejections: [] };
  window.__standardPointEvidence = report;
  const gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  const debug = gl.getExtension('WEBGL_debug_renderer_info'); c.same(Boolean(debug), true, 'critic point hardware identity'); report.gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu), false, 'critic actual point hardware'); report.range = [...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];
  const bridge = await createVirglStandardShaderBridge();
  const make = s => { const r = pointRig(gl, bridge, c, s, { step: 1, delay: ({ ordinal }) => 3 + ((Math.imul(ordinal, 17) ^ CRITIC_SEED) >>> 0) % 7 }); r.frames = report.frames; r.blobs = report.blobs; return r; };
  const bounded = jobs => { c.same(jobs.normalizationScratchBytes, 0, 'critic no CPU scratch at yield'); c.same(jobs.normalizedBytes <= 786432, true, 'critic native point bytes bounded'); c.same(jobs.normalizedBuffers <= 64, true, 'critic native point count bounded'); };
  const done = r => { const inspection = c.ok(r.renderer.inspect(), 'critic point final inspection'); for (const key of ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']) c.same(inspection.jobs[key], 0, 'critic released point ' + key);
    report.runs.push({ history: r.history, exchanges: r.exchanges, events: r.trace.events, calls: r.trace.calls.map(({ program, ...row }) => row), nativeState: r.nativeState, inspection }); dispose(r); };
  const common = { indexSize: 4, indexOffset: plan.indexOffset, base: plan.base, enabled: true, restartIndex: plan.marker, ids: plan.ids, sizes: plan.sizes,
    centers: plan.centers, offsets: plan.offsets, sourceOffsets: plan.sourceOffsets, seed: CRITIC_SEED, fixedSize: plan.fixedSize };
  const cases = [
    ['critic-seeded-alias-1', { coord: 'alias', psize: 'full', instances: 4, divisors: [0, 2, 3], negativeY: true }, true],
    ['critic-seeded-system-1', { coord: 'system', instances: 3, divisors: [0, 1, 2] }, true],
    ['critic-seeded-fixed', { coord: 'alias', perVertex: false }, false],
    ['critic-seeded-constant', { coord: 'alias', instances: 4, strides: [16, 0, 0], divisors: [0, 7, 11], negativeY: true }, false],
    ['critic-seeded-XY-outside', { ids: [plan.originalIds[0]], centers: [[-.75, 7.25]], sizes: [6], output: 'swizzle', coord: 'system' }, true],
    ['critic-seeded-near', { clipZ: -1.125, sizes: [2048, 2048, 2048, 2048], coord: 'alias' }, false],
    ['critic-seeded-far', { clipZ: 1.125, sizes: [2048, 2048, 2048, 2048], coord: 'system' }, true],
    ['critic-seeded-clamp', { ids: [plan.originalIds[0]], centers: [[8.25, 8.25]], sizes: [2048], coord: 'alias', negativeY: true }, false],
    ['critic-unused-point-coord', { coord: 'system', output: 'coord', unusedCoordinate: true }, false],
    ['critic-point-blend-budget', { ids: [plan.originalIds[0]], centers: [[8.25, 8.25]], sizes: [4], coord: 'alias', blend: true }, false],
  ];
  for (const [label, options, shift] of smoke ? cases.slice(0, 1) : cases) {
    const s = pointSpec({ ...common, ...options });
    if (shift) s.fragment = s.fragment.replaceAll('IN[0]', 'IN[1]').replaceAll('SV[0]', 'SV[1]');
    if (options.unusedCoordinate) s.fragment = 'FRAG\nDCL SV[1], PCOORD\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.25,0.5,0.75,1.0}\n0: MOV OUT[0], IMM[0]\n1: END\n';
    const r = make(s), yields = [];
    const blend = options.blend ? [packet(1, 1, [10, 0, 0, 1 | (7 << 4) | (8 << 9) | (1 << 17) | (17 << 22) | (15 << 27), 0, 0, 0, 0, 0, 0, 0]), packet(2, 1, [10]), packet(14, 0, [.25, .5, .75, .25].map(word))] : [];
    const record = await pointSubmit(r, 1, join(pointSetup(r, s), ...blend, pointDraw(s)), label, () => { const jobs = r.renderer.inspect().jobs; bounded(jobs); if (jobs.draws && jobs.status === 'finishing') yields.push({ ...jobs }); });
    c.ok(record.result, 'critic seeded actual points'); c.same(yields.length > 0, true, 'critic delayed fence retains native points');
    await criticPointFrame(r, record, blob); report.ownership.push({ label, yields, record }); done(r);
  }
  if (!smoke) {
    const a = pointSpec({ ...common, coord: 'alias', psize: 'full' }), b = pointSpec({ ...common, coord: 'system', perVertex: false, negativeY: true, fixedSize: plan.fixedSize + 1 });
    const r = make(a), vao = gl.createVertexArray(), ebo = gl.createBuffer();
    await criticPointFrame(r, await pointSubmit(r, 1, join(pointSetup(r, a), pointDraw(a)), 'critic-A-first'), blob);
    const poison = () => { const program = gl.getParameter(gl.CURRENT_PROGRAM); gl.uniform2f(gl.getUniformLocation(program, 'wv_point_size'), 43, 0); gl.uniform1f(gl.getUniformLocation(program, 'wv_point_coord_y'), 31);
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 0, 0]), gl.STREAM_DRAW); gl.viewport(0, 0, 1, 1); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 0, 0); gl.colorMask(false, false, false, false); };
    poison(); await criticPointFrame(r, await pointSubmit(r, 2, join(pointSetup(r, b, { create: false }), pointDraw(b)), 'critic-B'), blob);
    poison(); r.spec = a; r.bufferBytes = a.data; await criticPointFrame(r, await pointSubmit(r, 1, join(clear([0, 0, 0, 0]), pointDraw(a)), 'critic-A-last'), blob);
    c.same(report.frames.at(-1).pixels.sha256, report.frames.at(-3).pixels.sha256, 'critic A pixels restored exactly'); gl.deleteVertexArray(vao); gl.deleteBuffer(ebo); done(r);
    const s = pointSpec({ ...common, coord: 'alias' }), cancel = make(s); let point;
    c.ok((await pointSubmit(cancel, 1, pointSetup(cancel, s), 'critic-cancel-setup')).result, 'critic point cancellation setup');
    const record = await pointSubmit(cancel, 1, join(clear([0, 0, 0, 0]), pointDraw(s)), 'critic-cancel-native-fence', (_step, token) => {
      const jobs = cancel.renderer.inspect().jobs; bounded(jobs); if (!point && jobs.status === 'finishing' && jobs.draws === 1) { point = { jobs: { ...jobs }, events: cancel.trace.events.length }; c.same(jobs.normalizedBuffers, 1, 'critic point fence keeps native storage'); c.ok(cancel.renderer.cancel(token), 'critic cancel after actual point draw'); }
    });
    c.same(Boolean(point), true, 'critic cancellation reaches delayed final fence'); c.same(record.result.error.code, 'cancelled', 'critic final point cancellation'); c.same(record.result.draws.length, 1, 'critic cancellation keeps one actual point draw');
    await criticPointFrame(cancel, record, blob); report.ownership.push({ label: record.label, point, record }); done(cancel);
    for (const [parameter, delivered, blend] of [[gl.MAX_VERTEX_UNIFORM_COMPONENTS, 1, false], [gl.MAX_FRAGMENT_UNIFORM_COMPONENTS, 4, true]]) {
      const actual = gl.getParameter(parameter), limited = new Proxy(gl, { get(target, name) { const value = Reflect.get(target, name, target); if (name === 'getParameter') return p => p === parameter ? delivered : target.getParameter(p); return typeof value === 'function' ? value.bind(target) : value; } });
      const s = pointSpec({ ...common, ids: [plan.originalIds[0]], centers: [[8.25, 8.25]], sizes: [4], coord: 'alias' }), r = pointRig(limited, bridge, c, s, { step: 1, delay: 4 }); r.frames = report.frames; r.blobs = report.blobs;
      const extra = blend ? [packet(1, 1, [10, 0, 0, 1 | (7 << 4) | (8 << 9) | (1 << 17) | (17 << 22) | (15 << 27), 0, 0, 0, 0, 0, 0, 0]), packet(2, 1, [10]), packet(14, 0, [.25, .5, .75, .25].map(word))] : [];
      const record = await pointSubmit(r, 1, join(pointSetup(r, s), ...extra, pointDraw(s)), 'critic-uniform-budget-' + parameter);
      c.same(record.result.error.code, 'shader-reflection-error', 'critic typed raster component limit'); c.same(record.result.error.message, blend ? 'Blend factor exceeds the host fragment uniform limit.' : 'Raster bindings exceed the host stage uniform limit.', 'critic exact component rejection'); c.same(r.trace.calls.length, 0, 'critic component limit rejects before native draw');
      report.rejections.push({ parameter, actual, delivered, record }); done(r);
    }
  }
  report.status = 'passed'; return report;
}
