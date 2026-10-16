import { boundaries as heldBoundaries } from './ordered-boundaries.mjs';
import { submit, blob, nativeRead } from '../../renderer/virgl-command/tests/standard-instanced-stencil-rig.mjs';
import { textureTransfer, shader } from '../virgl-stencil/fixtures.mjs';
import { draw, join, packet, clear } from './fixtures.mjs';
import { model, compare } from './oracle.mjs';

export async function boundaries(args) {
  const { r, row, report, c, f } = args, kind = f.boundaryKind;
  if (!['reuse-instance', 'poison-instance', 'shader-reuse', 'context-destroy'].includes(kind)) return heldBoundaries(args);
  const b = row.boundary = { kind, seed: args.seed }, source = f.source.planes[f.level];
  const reset = join(...f.source.planes.map(p => textureTransfer(6, p.level, p.width, p.height, p.offset, p.stride)), clear(4, 0, 1, f.clearWords));
  c.ok((await submit(r, 1, reset.slice(), 'instanced-boundary-reset')).result, 'reset complete original native planes before lifetime attack');
  b.originalGeneration = r.allocations.find(a => a.metadata.id === 4).generation;
  b.programBefore = r.renderer.inspect().contexts.find(ctx => ctx.id === 1).subContexts[0].programs;
  let fired = false;
  b.execution = await submit(r, 1, draw(f), 'instanced-boundary-' + kind, async (step, token) => {
    const inspection = r.renderer.inspect().jobs;
    if (fired || inspection.status !== 'waiting-attributes') return;
    fired = true;
    b.point = { eventSequence: r.events.at(-1)?.sequence ?? 0, renderer: r.renderer.inspect(), native: r.nativeOrderedState() };
    c.same(inspection.normalizationScratchBytes, 0, 'instance lifetime attack occurs at a bounded suspension');
    if (kind === 'reuse-instance') {
      c.ok(r.store.unref(4), 'retire captured original per-instance public name');
      const raw = new Uint8Array(f.buffers.get(4).length).fill(0x3d);
      const fresh = r.add({ id: 4, target: 0, format: 64, bind: 0, width: raw.length, height: 1, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 }, raw);
      b.replacement = { generation: fresh.generation, input: await blob(report, raw) };
    }
    if (kind === 'poison-instance') {
      const raw = new Uint8Array(f.buffers.get(4).length).fill(0xcd);
      c.ok(r.store.writeBacking(4, 0, raw), 'poison original public backing without a native upload');
      b.poison = await blob(report, raw);
    }
    if (kind === 'shader-reuse') {
      const request = packet(3, 4, [10]);
      b.busy = { hex: [...request].map(v => v.toString(16).padStart(2, '0')).join(''), result: r.renderer.beginSubmission(1, request) };
      c.same(b.busy.result.error.code, 'busy', 'in-flight shader identity cannot be replaced');
    }
    if (kind === 'context-destroy') c.ok(r.store.destroyContext(1), 'destroy original resource context at suspension');
  });
  c.same(fired, true, 'instance lifetime attack reached original suspension');
  if (kind === 'context-destroy') {
    c.same(b.execution.result.ok, false, 'destroyed context cannot submit a captured instance draw');
    c.same(b.execution.result.error.code, 'missing-context', 'destroyed original context is rejected');
    c.same(b.execution.result.gpuComplete, true, 'destroyed context drains native completion');
    c.ok(r.renderer.destroyContext(1), 'retire drained renderer context');
    c.ok(r.store.createContext(1), 'new original resource context generation');
    for (const id of [1, 3, 4, 5, 6, 22]) c.ok(r.store.attachContext(1, id), 'attach public resource to fresh context');
    c.ok(r.renderer.createContext(1), 'new owned renderer context');
    const { setup, state } = await import('./fixtures.mjs');
    b.recreated = await submit(r, 1, join(setup(f), state(f), draw(f)), 'instanced-recreated-context');
    c.ok(b.recreated.result, 'fresh context owns a new checked instance location');
  } else c.ok(b.execution.result, 'retained original per-instance draw completes');
  if (kind === 'shader-reuse') {
    const originalShader = f.vertex;
    b.recreated = await submit(r, 1, join(packet(3, 4, [10]), shader(10, 0, originalShader), packet(31, 0, [10, 0]), reset, draw(f)), 'instanced-recreated-shader');
    c.ok(b.recreated.result, 'public shader handle reuse owns a fresh native uint location');
  }
  b.programAfter = r.renderer.inspect().contexts.find(ctx => ctx.id === 1).subContexts[0].programs;
  if (b.recreated) c.same(b.programAfter[0].generation > b.programBefore[0].generation, true, 'instance binding generation advances after reuse');
  b.restored = r.nativeOrderedState(); c.same(b.restored.instance.base, 0, 'lifetime attack restores owned zero base');
  const colorTexture = r.allocations.find(a => a.metadata.id === 1).storage.texture, depthTexture = r.allocations.find(a => a.metadata.id === 6).storage.texture;
  const color = await nativeRead(r, colorTexture, 31, f.width, f.height, f.outputLevel), depth = await nativeRead(r, depthTexture, f.format, f.width, f.height, f.level);
  const original = model(r.history, f.buffers, { format: f.format, width: f.width, height: f.height, input: source.input, clearWords: f.clearWords });
  b.frame = { historyIndex: r.history.length - 1, color: await blob(report, color), depth: await blob(report, depth), completion: { ...r.lastCompletion } };
  c.same(compare(original, color, depth, f.width, f.height, f.format), [], 'original retained instance bytes and new program generations remain physical');
  if (b.replacement) b.replacement.after = await blob(report, c.ok(r.store.readBacking(4, 0, f.buffers.get(4).length), 'replacement instance backing').bytes);
  if (b.poison) b.poisonAfter = await blob(report, c.ok(r.store.readBacking(4, 0, f.buffers.get(4).length), 'poisoned instance backing').bytes);
}
