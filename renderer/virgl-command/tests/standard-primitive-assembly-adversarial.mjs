import { createVirglStandardShaderBridge } from '../../virgl-shader/standard.mjs';
import { checks, dispose, packet, join, blob, clear } from './standard-instanced-draws.mjs';
import { assemblySpec, assemblyDraw, assemblySetup, assemblyRig, assemblySubmit } from './standard-primitive-assembly.mjs';
import { criticFrame, primitiveGroups } from '../../../tools/virgl-command/standard-assembly-adversarial-oracle.mjs';

// Selected by the fresh verifier before opening worker evidence.
export const CRITIC_SEED = 795804360;
export function seededPlan(seed = CRITIC_SEED) {
  let word = seed >>> 0;
  const next = () => (word = (Math.imul(word, 1664525) + 1013904223) >>> 0);
  const base = 65536 + next() % 8192, marker = 0x00f00000 + next() % 65536;
  const vertices = [3, 19, 61, 103, 7, 37, 79, 131].map(n => base + n);
  const rotate = (ids, amount) => ids.slice(amount).concat(ids.slice(0, amount));
  const a = rotate(vertices.slice(0, 4), next() % 4).reverse();
  const b = rotate(vertices.slice(4), next() % 4);
  // One-point and two-point tails, repeated exact custom markers, and opposite
  // winding are predictions. Expectations never consult observed GPU output.
  const segments = [[], a, [], b, [vertices[0]], [vertices[4], vertices[5]], []];
  const ids = segments.flatMap((s, i) => i ? [marker, ...s] : s);
  return { seed, base, marker, ids, segments, vertices, indexOffset: 28,
    offsets: [28, 44, 68], sourceOffsets: [12, 4, 20],
    emitted: Object.fromEntries([2, 6].map(mode => [mode, segments.flatMap(s => primitiveGroups(mode, s)).flat()])) };
}

export async function runAcceptance() {
  const c = checks(), plan = seededPlan(), report = { schema: 'standard-assembly-critic-v1', status: 'running', guestExecution: false, productionNegotiation: false, seed: CRITIC_SEED,
    plan, predictions: c.rows, frames: [], runs: [], blobs: [], ownership: [] };
  window.__standardAssemblyEvidence = report;
  const gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  const debug = gl.getExtension('WEBGL_debug_renderer_info'); c.same(Boolean(debug), true, 'critic hardware identity'); report.gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu), false, 'critic actual local hardware');
  const bridge = await createVirglStandardShaderBridge();
  const make = spec => { const r = assemblyRig(gl, bridge, c, spec, { step: 1, delay: ({ ordinal }) => 4 + ((ordinal ^ CRITIC_SEED) >>> 0) % 5 }); r.frames = report.frames; r.blobs = report.blobs; return r; };
  const bounded = jobs => { c.same(jobs.normalizationScratchBytes, 0, 'critic one CPU vector detached at yield'); c.same(jobs.normalizedBytes <= 786432, true, 'critic private bytes bounded'); c.same(jobs.normalizedBuffers <= 64, true, 'critic private count bounded'); };
  const done = r => {
    const inspection = c.ok(r.renderer.inspect(), 'critic final inspection');
    for (const key of ['reads', 'stagingBytes', 'normalizedBuffers', 'normalizedBytes', 'normalizationScratchBytes']) c.same(inspection.jobs[key], 0, 'critic released ' + key);
    report.runs.push({ history: r.history, exchanges: r.exchanges, events: r.trace.events, calls: r.trace.calls.map(({ program, ...a }) => a), normalizationEvents: r.normalizationEvents, nativeState: r.nativeState, inspection }); dispose(r);
  };
  for (const [mode, smooth, cull, frontCcw] of [[2, false, false, false], [2, true, false, false], [6, false, false, false], [6, true, false, false], [6, false, true, false], [6, false, true, true]]) {
    const s = assemblySpec({ mode, smooth, cull, frontCcw, indexSize: 4, indexOffset: plan.indexOffset, instances: 4, generic: false, base: plan.base, restartIndex: plan.marker, ids: plan.ids,
      offsets: plan.offsets, sourceOffsets: plan.sourceOffsets, seed: CRITIC_SEED }), r = make(s), yields = [];
    const record = await assemblySubmit(r, 1, join(assemblySetup(r, s), assemblyDraw(s)), `critic-${mode}-${smooth}-${cull}-${frontCcw}`, () => {
      const jobs = r.renderer.inspect().jobs; bounded(jobs);
      if (jobs.normalizedBuffers) { c.same(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) === r.allocations.find(a => a.metadata.id === 22).storage.buffer, true, 'critic original indexed EBO restored before yield'); yields.push({ ...jobs }); }
    });
    c.same(record.result.ok, true, 'critic seeded original wide draw'); c.same(yields.length > 0, true, 'critic reaches retained native yield');
    const frame = await criticFrame(r, record, blob); c.same(frame.prediction.nativeIds, plan.emitted[mode], 'critic prespecified original native list');
    report.ownership.push({ label: record.label, yields, record }); done(r);
  }
  // Arrays may retain a historical EBO despite synthesizing start+i.
  {
    const s = assemblySpec({ mode: 2, indexed: false, instances: 2, start: 23, generic: false, seed: CRITIC_SEED }), raw = new Uint8Array(36);
    new DataView(raw.buffer).setUint32(28, plan.marker, true); s.data.set(22, raw);
    const r = make(s); let point;
    const record = await assemblySubmit(r, 1, join(assemblySetup(r, s), packet(11, 0, [22, 4, 28]), assemblyDraw(s)), 'critic-arrays-retained-EBO', () => {
      const jobs = r.renderer.inspect().jobs; bounded(jobs);
      if (jobs.draws && jobs.normalizedBuffers) { point = { jobs: { ...jobs }, binding: r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)) }; c.same(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) === r.allocations.find(a => a.metadata.id === 22).storage.buffer, true, 'critic actual array original EBO survives private storage'); }
    });
    c.same(Boolean(point), true, 'critic array private-buffer yield observed'); await criticFrame(r, record, blob); report.ownership.push({ label: record.label, point, record }); done(r);
  }
  // Cancellation occurs only after the final actual draw, at a later fence poll.
  {
    const s = assemblySpec({ mode: 6, indexSize: 4, base: plan.base, restartIndex: plan.marker, ids: plan.ids, instances: 2, seed: CRITIC_SEED }), r = make(s); let point;
    c.ok((await assemblySubmit(r, 1, assemblySetup(r, s), 'critic-cancel-setup')).result, 'critic cancellation setup');
    const record = await assemblySubmit(r, 1, join(clear([0, 0, 0, 0]), assemblyDraw(s)), 'critic-cancel-final-fence', (_step, token) => {
      const jobs = r.renderer.inspect().jobs; bounded(jobs);
      if (!point && jobs.status === 'finishing' && jobs.draws === 1) { point = { jobs: { ...jobs }, eventCount: r.trace.events.length }; c.same(jobs.normalizedBuffers, 1, 'critic final fence retains native storage'); c.ok(r.renderer.cancel(token), 'critic cancel after draw'); }
    });
    c.same(Boolean(point), true, 'critic cancellation at final fence'); c.same(record.result.error.code, 'cancelled', 'critic cancellation result'); c.same(record.result.draws.length, 1, 'critic only native draw retained');
    await criticFrame(r, record, blob); report.ownership.push({ label: record.label, point, record }); done(r);
  }
  report.status = 'passed'; return report;
}
