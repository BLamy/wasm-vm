import { createVirglStandardShaderBridge } from "../../virgl-shader/standard.mjs";
import { drawModel } from "../../../tools/virgl-command/standard-draw-oracle.mjs";
import { checks, rig, specimen, setup, physicalFrame, drawPacket, submit,
  dispose, join, hex, blob, clear } from "./standard-instanced-draws.mjs";

const SEED = 0xe47c2a91;
function independentlySized({ divisors = [0, 3, 5], short = null, calibration = false } = {}) {
  const s = specimen({ seed: SEED, instances: 7, indexed: true, indexSize: 4,
    indexOffset: 20, base: 65557, divisors, exact: !calibration, width: 70 });
  // IN1 uses only x: make its last R32_FLOAT component end exactly at storage.
  // The sabotage calibration keeps room for corrupted divisor1 fetches so a
  // completed GPU draw reaches the pixel oracle; the novel boundary stays exact.
  const end = 32 + (calibration ? 6 : Math.floor(6 / divisors[1])) * 16 + 4;
  s.data.set(4, s.data.get(4).slice(0, end));
  if (short) {
    const id = { vertex: 3, instance: 4, index: 6 }[short];
    s.data.set(id, s.data.get(id).slice(0, -1));
  }
  return s;
}
function setupR32(r, s) {
  const bytes = setup(r, s), view = new DataView(bytes.buffer);
  for (let at = 0; at < bytes.length;) {
    const header = view.getUint32(at, true), words = header >>> 16;
    if ((header & 255) === 1 && (header >>> 8 & 255) === 5)
      view.setUint32(at + 4 + 8 * 4, 28, true); // Literal element1 sourceFormat.
    at += (words + 1) * 4;
  }
  return bytes;
}
async function predict(report, r, s, commands, label) {
  const model = drawModel([{ ctx: 1, hex: hex(commands) }], s.data, s.used);
  const expected = new Uint8Array(s.width * s.height * 4), ambiguous = [];
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const colors = model.pixel(x, y, s.width, s.height);
    expected.set(colors[0], (y * s.width + x) * 4);
    if (colors.length > 1) ambiguous.push({ x, y, colors });
  }
  const plan = { label, seed: SEED, beforeSubmission: true, effectiveInstances: 7,
    ids: model.ids, fetches: model.fetches, work: model.draw.count * model.effective,
    indexBytes: model.draw.count * model.index.size,
    expectedPixels: await blob(r, expected), ambiguous };
  report.plans.push(plan);
  r.c.same(model.ids, [65557, 65558, 65559, 65560], label + " independent wide IDs");
  r.c.same(model.fetches.map(f => f.requiredEnd), [1049008, 32 + Math.floor(6 / s.divisors[1]) * 16 + 4, 64], label + " original byte ends");
  r.c.same(model.fetches.map(f => f.components), [4, 1, 4], label + " literal R32 active color");
  r.c.same(plan.work, 28, label + " bounded vertex-instance work");
  r.c.same(plan.indexBytes, 16, label + " index staging extent");
  return plan;
}
export async function runAdversarial({ smoke = false } = {}) {
  const c = checks(), report = { schema: "virgl-standard-draw-critic-v1", status: "running",
    guestExecution: false, productionNegotiation: false, predictions: c.rows,
    plans: [], frames: [], blobs: [], runs: [], rejections: [], suspensions: [] };
  window.__standardDrawEvidence = report;
  const gl = document.querySelector("#gpu").getContext("webgl2", {
    antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  c.same(gl instanceof WebGL2RenderingContext, true, "critic actual WebGL2");
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  c.same(Boolean(debug), true, "critic actual GPU identity");
  report.gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu), false, "critic physical GPU");
  report.maxElementIndex = gl.getParameter(gl.MAX_ELEMENT_INDEX);
  const bridge = await createVirglStandardShaderBridge();
  const make = (s, options = {}) => {
    const r = rig(gl, bridge, c, { width: s.width, height: s.height, ...options });
    r.frames = report.frames; r.blobs = report.blobs; return r;
  };
  const done = r => {
    report.runs.push({ history: r.history, exchanges: r.exchanges, events: r.trace.events,
      calls: r.trace.calls.map(({ program, ...call }) => call), work: r.renderer.inspect().work });
    dispose(r);
  };
  // Run this first so real divisor2=>1 sabotage reaches the named physical oracle.
  {
    const s = independentlySized({ divisors: [0, 2, 5], calibration: true }), r = make(s),
      label = "critic-divisor-pixel-oracle", commands = join(setupR32(r, s), drawPacket(s));
    await predict(report, r, s, commands, label);
    const record = await submit(r, 1, commands, label);
    await physicalFrame(r, record); done(r);
  }
  if (!smoke) for (const [delay, step] of [[0, 1], [3, 2], [7, 5]]) {
    {
      const s = independentlySized(), r = make(s, { delay, step,
        ...(delay === 0 ? { hostIndexLimit: 65560 } : {}) }), label = "critic-mixed-wide-r32-" + delay,
        commands = join(setupR32(r, s), drawPacket(s, { hints: [1, 1] }));
      await predict(report, r, s, commands, label);
      const record = await submit(r, 1, commands, label);
      await physicalFrame(r, record); done(r);
    }
    for (const short of ["vertex", "instance", "index"]) {
      const s = independentlySized({ short }), r = make(s, { delay, step }), label = "critic-one-byte-short-" + short + "-" + delay;
      const expectedEnd = { vertex: 1049008, instance: 68, index: 36 }[short];
      report.plans.push({ label, beforeSubmission: true, expectedEnd,
        byteLength: s.data.get({ vertex: 3, instance: 4, index: 6 }[short]).length,
        expectedError: "out-of-bounds", expectedNativeDraws: 0 });
      const record = await submit(r, 1, join(setupR32(r, s), drawPacket(s, { hints: [0, 0] })), label);
      c.same(record.result.ok, false, label + " rejects");
      c.same(record.result.error.code, "out-of-bounds", label + " final component fails");
      c.same(r.trace.calls.length, 0, label + " before native draw");
      report.rejections.push({ label, record, events: r.trace.events, nativeDraws: [] }); done(r);
    }
    for (const overrides of [{ instances: 0xffffffff }, { count: 0xfffffffe }]) {
      const s = independentlySized(), r = make(s, { delay, step }),
        label = "critic-u32-work-" + Object.keys(overrides)[0] + "-" + delay;
      report.plans.push({ label, beforeSubmission: true, overrides,
        expectedError: "limit-exceeded", expectedNativeDraws: 0 });
      const literalDraw = drawPacket(s, overrides);
      if (Object.hasOwn(overrides, "count")) new DataView(literalDraw.buffer).setUint32(8, overrides.count, true);
      const record = await submit(r, 1, join(setupR32(r, s), literalDraw), label);
      c.same(record.result.error.code, "limit-exceeded", label + " subtraction/division before multiplication");
      c.same(r.trace.calls.length, 0, label + " no speculative native draw");
      report.rejections.push({ label, record, events: r.trace.events, nativeDraws: [] }); done(r);
    }
  }
  if (!smoke) {
    const s = independentlySized(), r = make(s, { delay: 4, step: 1 });
    c.ok((await submit(r, 1, setupR32(r, s), "critic-reset-setup")).result, "critic pending reset setup");
    let fired = false, resetDuring;
    const record = await submit(r, 1, join(clear([0, 0, 0, 0]), drawPacket(s)), "critic-pending-reset-cancel",
      async (_step, token) => {
        if (fired || r.renderer.inspect().jobs.status !== "waiting-index") return;
        fired = true; resetDuring = r.renderer.resetCaches();
        c.same(resetDuring.error.code, "busy", "pending reset cannot abandon retained GPU read");
        c.ok(r.renderer.cancel(token), "pending reset cancellation requested");
      });
    c.same(fired, true, "critic reached real pending GPU index read");
    c.same(record.result.error.code, "cancelled", "critic pending reset cancels");
    c.same(record.result.gpuComplete, true, "critic pending reset drains real fence");
    c.same(r.trace.calls.length, 0, "critic pending reset never draws");
    const after = r.asyncAccess.inspect(), resetAfter = r.renderer.resetCaches();
    c.same([after.reads, after.stagingBytes], [0, 0], "critic pending reset releases read staging");
    c.ok(resetAfter, "reset admitted after complete drain");
    report.suspensions.push({ label: "critic-pending-reset-cancel", resetDuring, resetAfter,
      record, async: after, events: r.trace.events }); done(r);
  }
  report.status = "passed"; return report;
}
