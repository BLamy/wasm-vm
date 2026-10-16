import { rig, finish, blob, nativeRead, submit, checks } from './standard-instanced-stencil-rig.mjs';
import { createVirglStandardInstanceBaseShaderBridge, createVirglStandardIntegerImageShaderBridge } from '../../virgl-shader/standard.mjs';
import { createVirglStandardOrderedStencilAsyncRenderer } from '../state.mjs';
import { fixture, setup, state, draw, join, packet, face, clear, dsa, refs } from '../../../tools/virgl-instanced-stencil/fixtures.mjs';
import { model, compare } from '../../../tools/virgl-instanced-stencil/oracle.mjs';
import { metadata } from '../../../tools/virgl-stencil/fixtures.mjs';
import { boundaries } from '../../../tools/virgl-instanced-stencil/boundaries.mjs';

export async function runAcceptance({ mode = 'matrix', seed = 0x47d195a3, smoke = false, fault = null } = {}) {
  const c = checks(), gl = document.querySelector('#gpu').getContext('webgl2', {
    antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true
  });
  if (!gl) throw Error('actual instanced stencil WebGL2 unavailable');
  const bridge = await createVirglStandardInstanceBaseShaderBridge();
  const oldBridge = await createVirglStandardIntegerImageShaderBridge();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const report = { status: 'running', mode, seed, fault, gpu: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
    guestExecution: false, productionNegotiation: false, runs: [], blobs: [], predictions: c.rows };
  window.__standardInstancedStencilEvidence = report;
  const cases = [], add = options => cases.push(fixture({ seed, ordinal: cases.length, instances: 5, ...options }));
  if (fault) add({ format: 20, mode: 4, divisor: 2, name: 'instanced-actual-control-' + fault });
  else if (mode === 'matrix') {
    for (const format of [20, 126]) for (const primitive of smoke ? [4] : [4, 5, 6])
      for (const size of smoke ? [2] : [0, 1, 2, 4]) for (const divisor of smoke ? [2] : [[1, 2, 3, 0xffffffff][cases.length % 4]])
        add({ format, mode: primitive, indexSize: size || 2, indexed: size !== 0, divisor,
          name: `instanced-${format}/mode${primitive}/${size ? 'u' + size * 8 : 'arrays'}/divisor${divisor}` });
    if (!smoke) for (const format of [20, 126]) for (const variant of ['zero', 'one', 'smooth', 'buffered', 'per-vertex', 'common', 'cull', 'disabled', 'front-only', 'back-only'])
      add({ format, name: `instanced-${format}/${variant}`, instances: variant === 'zero' ? 0 : variant === 'one' ? 1 : 5,
        smooth: variant === 'smooth', generic: variant !== 'buffered', divisor: variant === 'per-vertex' ? 0 : 2,
        cull: variant === 'cull', ...(variant === 'common' ? { frontRef: 117, backRef: 117,
          front: face({ zpass: 2, writeMask: 255 }), back: face({ zpass: 3, writeMask: 255 }) } : {}),
        ...(variant === 'disabled' ? { front: face({ enabled: false }), back: face({ enabled: false }) } : {}),
        ...(variant === 'front-only' ? { back: face({ enabled: false }) } : {}),
        ...(variant === 'back-only' ? { front: face({ enabled: false }) } : {}) });
    if (!smoke) for (const format of [20, 126, 18, 21]) for (const primitive of [0, 1, 2, 3])
      add({ format, mode: primitive, instances: 5, name: `instanced-${format}/ordinary${primitive}` });
    if (!smoke) for (const format of [18, 21]) for (const primitive of [4, 5, 6])
      add({ format, mode: primitive, instances: 5, name: `instanced-absent-${format}/mode${primitive}` });
  } else if (mode === 'bindings') {
    for (const format of [20, 126]) for (const instanceUse of ['absent', 'unused'])
      add({ format, instanceUse, name: `instanced-${format}/instance-${instanceUse}` });
  } else if (mode === 'typed') {
    for (const format of [20, 126]) for (const attributeFormat of [196, 200, 8, 123, 172, 173])
      for (const generic of [true, false]) add({ format, attributeFormat, generic, attributeDivisor: 3,
        name: `instanced-${format}/input${attributeFormat}/${generic ? 'constant' : 'divisor3'}` });
  } else if (mode === 'limits') {
    for (const format of [20, 126]) for (const limitKind of ['split-exact', 'split-minus-one', 'instances-exact', 'instances-minus-one'])
      add({ format, name: `instanced-${format}/limit-${limitKind}`, limitKind,
        ...(limitKind.startsWith('instances-') ? { instances: 65536, ids: [17], divisor: 0xffffffff } : {}) });
  } else if (mode === 'segments') {
    for (const format of [20, 126]) for (const primitive of [4, 5, 6])
      for (const pattern of ['edges', 'all', 'one-tail', 'two-tail', 'degenerate', 'fixed-byte', 'fixed-short', 'fixed-wide', 'disabled-byte-max', 'out-of-type'])
        add({ format, mode: primitive, name: `instanced-${format}/mode${primitive}/${pattern}`,
          pattern: pattern.endsWith('tail') ? 'partial' : ['edges', 'all', 'degenerate'].includes(pattern) ? pattern : 'edges',
          tail: pattern === 'one-tail' ? 1 : 2,
          indexSize: ['fixed-byte', 'disabled-byte-max', 'out-of-type'].includes(pattern) ? 1 : pattern === 'fixed-wide' ? 4 : 2,
          restartIndex: ['fixed-byte', 'disabled-byte-max'].includes(pattern) ? 255 : ['fixed-short', 'out-of-type'].includes(pattern) ? 65535 : pattern === 'fixed-wide' ? 0xffffffff : 17,
          enabled: pattern !== 'disabled-byte-max' });
  } else if (mode === 'failures') {
    for (const format of [20, 126]) for (const phase of ['historical', 'native-selection', 'short-index', 'short-vertex', 'short-instance', 'empty', 'work-budget', 'allocation', 'upload', 'draw', 'uint', 'pointer'])
      add({ format, failurePhase: phase, name: `instanced-${format}/failure-${phase}`, divisor: phase === 'pointer' ? 1 : 2,
        shortIndex: phase === 'short-index', shortVertex: phase === 'short-vertex', shortInstance: phase === 'short-instance',
        ...(phase === 'empty' ? { ids: [] } : {}) });
  } else if (mode === 'boundaries') {
    for (const format of [20, 126]) for (const kind of ['complete', 'reuse-index', 'stale-index', 'collected-index', 'cancel-waiting', 'cancel-finishing', 'owner-first', 'renderer-first', 'reuse-instance', 'poison-instance', 'shader-reuse', 'context-destroy'])
      add({ format, mode: 5, boundaryKind: kind, name: `instanced-${format}/boundary-${kind}`, level: 1, outputLevel: 1 });
  } else throw Error('unknown instanced stencil mode');

  for (const f of cases) {
    const phase = f.failurePhase;
    const options = { delay: ({ ordinal }) => f.boundaryKind === 'collected-index' ? ordinal % 2 ? 7 : 0 : ((Math.imul(ordinal + 1, seed) >>> 0) % 7), step: 1,
      failure: ['allocation', 'upload', 'draw', 'uint', 'pointer'].includes(phase) ? phase : null,
      failAt: phase === 'draw' ? 10 : 2, fault,
      ...(phase === 'historical' ? { rendererFactory: createVirglStandardOrderedStencilAsyncRenderer } : {}),
      ...(phase === 'native-selection' ? { selection: 'native' } : {}),
      ...(f.limitKind ? { limits: { drawLimits: { indicesPerSubmission: f.count * Math.max(1, f.instances) - Number(f.limitKind.endsWith('minus-one')) } } } : {}),
      ...(phase === 'work-budget' ? { limits: { drawLimits: { indicesPerSubmission: f.count * Math.max(1, f.instances) - 1 } } } : {}) };
    const r = rig(gl, phase === 'historical' ? oldBridge : bridge, c, f, options);
    const row = { name: f.name, format: f.format, level: f.level, width: f.width, height: f.height, outputLevel: f.outputLevel,
      sourceMetadata: f.source.metadata, sourceBacking: await blob(report, f.source.backing), planes: [], buffers: [], frames: [],
      failurePhase: phase ?? null, target: metadata(1, 31, f.targetWidth, f.targetHeight, f.outputLastLevel) };
    report.runs.push(row); r.blobs = report.blobs;
    r.outputBackingBytes = Math.max(20000, 5 + f.height * (f.width * 16 + 3));
    row.targetBackingBytes = r.outputBackingBytes;
    r.add(row.target, new Uint8Array(r.outputBackingBytes).fill(0x2e));
    for (const [id, raw] of f.buffers) {
      r.add({ id, target: 0, format: 64, bind: 0, width: raw.length, height: 1, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 }, raw);
      row.buffers.push({ id, input: await blob(report, raw) });
    }
    r.add(f.source.metadata, f.source.backing);
    for (const p of f.source.planes) row.planes.push({ ...p, input: await blob(report, p.input) });
    try {
      c.ok((await submit(r, 1, setup(f), 'instanced-setup')).result, 'complete original instanced stencil setup');
      c.ok((await submit(r, 1, state(f), 'instanced-state')).result, 'original instanced stencil state');
      row.before = { renderer: r.renderer.inspect(), resources: r.store.inspect(), native: r.nativeOrderedState() };
      if (fault) {
        const common = { ...f, front: face({ writeMask: 0 }), back: face({ writeMask: 0 }), frontRef: 0, backRef: 0 };
        row.baseline = await submit(r, 1, join(dsa(33, common.front, common.back, common), refs(0, 0), draw(f),
          clear(4, 0, 1, f.clearWords)), 'instanced-control-baseline');
        c.ok(row.baseline.result, 'unmodified original common native baseline');
        row.corruption = { before: { ...r.lastCompletion } };
        c.ok((await submit(r, 1, join(packet(2, 3, [30]), refs(f.frontRef, f.backRef)), 'instanced-control-asymmetric')).result,
          'original asymmetric state after baseline');
      }
      gl.cullFace(gl.FRONT);
      gl.getExtension('WEBGL_provoking_vertex').provokingVertexWEBGL(0x8e4d);
      const originalEbo = r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING));
      r.armOrderedFailure(Boolean(phase)); r.armInstanceControl(Boolean(phase || fault));
      row.yields = [];
      row.execution = await submit(r, 1, ['allocation', 'upload'].includes(phase) ? join(draw(f), draw(f)) : draw(f), 'instanced-draw', () => {
        row.yields.push({ renderer: r.renderer.inspect().jobs, native: r.nativeOrderedState(), eventSequence: r.events.at(-1)?.sequence ?? 0 });
      });
      r.armOrderedFailure(false); r.armInstanceControl(false);
      row.restored = r.nativeOrderedState();
      row.after = { renderer: r.renderer.inspect(), resources: r.store.inspect(), native: row.restored };
      if (fault) row.corruption.after = { ...r.lastCompletion };
      const calls = r.draws.filter(d => d.label === 'instanced-draw');
      let prefixPasses = null, hasFrame = true;
      if (phase) {
        const expected = ['historical', 'native-selection'].includes(phase) ? 'unsupported-stencil' :
          phase.startsWith('short-') ? 'out-of-bounds' : phase === 'empty' ? 'unsupported-draw' : phase === 'work-budget' ? 'limit-exceeded' : 'backend-error';
        c.same(row.execution.result.ok, false, 'original instanced draw refuses or stops on real error');
        c.same(row.execution.result.error.code, expected, 'specific instanced failure');
        hasFrame = ['allocation', 'upload', 'draw', 'uint', 'pointer'].includes(phase);
        prefixPasses = phase === 'draw' ? 9 : ['uint', 'pointer'].includes(phase) ? 8 : null;
        c.same(calls.length, phase === 'draw' ? 10 : ['uint', 'pointer'].includes(phase) ? 8 : ['allocation', 'upload'].includes(phase) ? 40 : 0, 'native suffix stops at the actual error');
        c.same(row.execution.result.draws.length, ['allocation', 'upload'].includes(phase) ? 1 : 0, 'only completed original draws enter the result');
        if (!hasFrame) c.same(r.orderedIndices.length, 0, 'original bounds fail before normalized native allocation');
      } else if (f.limitKind?.endsWith('minus-one')) {
        c.same(row.execution.result.error.code, 'limit-exceeded', 'whole original instance work bound refuses');
        c.same(calls.length, 0, 'whole work bound precedes all native draws'); hasFrame = false;
      } else c.ok(row.execution.result, 'original multi-instance native draw completes');
      if (f.limitKind) row.limits = { kind: f.limitKind, count: f.count, instances: f.instances,
        originalLimit: f.count * Math.max(1, f.instances) - Number(f.limitKind.endsWith('minus-one')) };
      c.same(row.execution.result.gpuComplete, true, 'actual native completion consumed');
      c.same(gl.getError(), gl.NO_ERROR, 'real errors drained');
      c.same(row.restored.ebo, originalEbo, 'normalized element buffer detached before yield');
      if (hasFrame) {
        c.same(row.restored.cullFace, gl.BACK, 'supported native cull mode restored');
        c.same(row.restored.cull, f.cull, 'original cull enable restored');
        c.same(row.restored.instance.base, f.instanceUse ? null : 0, 'zero instance offset or native inactivity restored before yield');
        for (const a of row.restored.instance.attributes) if (a.enabled && a.divisor > 0)
          c.same(a.offset, a.name === 'in_1' ? 8 : 12, 'original instanced attribute pointer restored');
        const colorTexture = r.allocations.find(a => a.metadata.id === 1).storage.texture;
        const depthTexture = r.allocations.find(a => a.metadata.id === 6).storage.texture;
        const color = await nativeRead(r, colorTexture, 31, f.width, f.height, f.outputLevel);
        const depth = await nativeRead(r, depthTexture, f.format, f.width, f.height, f.level);
        const historyIndex = r.history.length - 1;
        const original = model(r.history, f.buffers, { format: f.format, width: f.width, height: f.height,
          input: f.source.planes[f.level].input, clearWords: f.clearWords, prefixPasses });
        row.frames.push({ historyIndex, prefixPasses, completion: { ...r.lastCompletion }, color: await blob(report, color), depth: await blob(report, depth) });
        row.originalPrimitives = original.primitives; row.originalNativeIds = original.nativeIds; row.originalLowering = original.lowering;
        c.same(compare(original, color, depth, f.width, f.height, f.format), [], 'independent original instance order, color, depth and S8');
        if (mode === 'boundaries') await boundaries({ r, row, report, c, f, seed });
      }
    } finally { await finish(r, report, row); }
    for (const entry of row.orderedIndices) c.same(entry.deleted, true, 'normalized original stream retires once');
    if (window.__recordPackedConsumerRun) {
      row.predictions = c.rows.splice(0);
      const index = report.runs.indexOf(row);
      report.runs[index] = { name: row.name, format: row.format, ...await window.__recordPackedConsumerRun(index, JSON.stringify(row)) };
    }
  }
  report.status = 'passed'; return report;
}
