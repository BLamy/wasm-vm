import { rig, finish, blob, submit, checks } from './standard-instanced-stencil-rig.mjs';
import { createVirglStandardInstanceBaseShaderBridge } from '../../virgl-shader/standard.mjs';
import { createVirglStandardInstancedStencilAsyncRenderer } from '../state.mjs';
import { fixture, setup } from '../../../tools/virgl-instanced-stencil/fixtures.mjs';
import { metadata } from '../../../tools/virgl-stencil/fixtures.mjs';

export async function runAcceptance({ seed = 0x47d195a3 } = {}) {
  const c = checks(), gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  if (!gl) throw Error('native reflection context unavailable');
  const bridge = await createVirglStandardInstanceBaseShaderBridge(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const report = { status: 'running', mode: 'reflection', seed, gpu: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), guestExecution: false,
    productionNegotiation: false, runs: [], blobs: [], predictions: c.rows };
  window.__standardInstancedStencilEvidence = report;
  for (const reflection of ['location', 'index', 'undefined-index', 'type', 'size', 'default', 'budget-2', 'budget-3']) {
    const f = fixture({ format: 20, seed, instances: 5 });
    const r = rig(gl, bridge, c, f, { reflection }), row = { name: 'native-reflection-' + reflection, reflection,
      format: f.format, sourceMetadata: f.source.metadata, sourceBacking: await blob(report, f.source.backing), buffers: [], planes: [] };
    report.runs.push(row); r.blobs = report.blobs; r.outputBackingBytes = 20000;
    r.add(metadata(1, 31, f.targetWidth, f.targetHeight, f.outputLastLevel), new Uint8Array(20000).fill(0x2e));
    for (const [id, raw] of f.buffers) { r.add({ id, target: 0, format: 64, bind: 0, width: raw.length, height: 1, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 }, raw); row.buffers.push({ id, input: await blob(report, raw) }); }
    r.add(f.source.metadata, f.source.backing);
    for (const p of f.source.planes) row.planes.push({ ...p, input: await blob(report, p.input) });
    try {
      row.execution = await submit(r, 1, setup(f), 'instanced-reflection-' + reflection);
      c.same(row.execution.result.ok, reflection === 'budget-3', 'exact checked uint reflection and component budget');
      if (reflection !== 'budget-3') c.same(row.execution.result.error.code, 'shader-reflection-error', 'specific native reflection refusal');
      c.same(r.draws.length, 0, 'reflection qualification precedes all guest draws');
      c.same(row.execution.result.gpuComplete, true, 'reflection refusal drains original setup prefix');
      row.inspection = r.renderer.inspect();
      const missing = new Proxy(r.traced, { get(target, name) { if (name === 'uniform1ui') return undefined; const v = Reflect.get(target, name, target); return typeof v === 'function' ? v.bind(target) : v; } });
      const before = r.nativeObjects.length;
      row.factoryProbe = createVirglStandardInstancedStencilAsyncRenderer({ gl: missing, shaderBridge: bridge, resources: r.store, bindings: r.bindings,
        asyncAccess: r.asyncAccess, uniformAccess: r.uniformAccess, imageAccess: r.imageAccess, primitiveAssembly: 'lists' });
      c.same(row.factoryProbe.error.code, 'invalid-input', 'native uint API is required before allocation');
      c.same(r.nativeObjects.length, before, 'missing uint binding allocates no selected native objects');
    } finally { await finish(r, report, row); }
    if (window.__recordPackedConsumerRun) { row.predictions = c.rows.splice(0); const index = report.runs.indexOf(row); report.runs[index] = { name: row.name, ...await window.__recordPackedConsumerRun(index, JSON.stringify(row)) }; }
  }
  report.status = 'passed'; return report;
}
