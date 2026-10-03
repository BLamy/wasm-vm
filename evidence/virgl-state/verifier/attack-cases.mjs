import { createResourceStore, createWebGL2TransferBackend } from '/renderer/virgl-command/resources.mjs';
import { createVirglStateRenderer } from '/renderer/virgl-command/state.mjs';
import { createVirglShaderBridge } from '/renderer/virgl-shader/index.mjs';

const packet = (op, type, words) => { const bytes = new Uint8Array(4 + 4 * words.length), dv = new DataView(bytes.buffer); dv.setUint32(0, op | (type << 8) | (words.length << 16), true); words.forEach((v, i) => dv.setUint32(4 + 4 * i, v, true)); return bytes; };
export async function runIndependentStateAttacks(fixtures) {
  let assertions = 0, pixels = 0, drawCalls = 0;
  const equal = (a, b, label) => { assertions++; if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(label + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
  const truth = (value, label) => equal(Boolean(value), true, label);
  const ok = (r, label) => { equal(r.ok, true, label + ' ' + JSON.stringify(r.error)); return r; };
  const bad = (r, code, label) => { equal(r.ok, false, label); equal(r.error.code, code, label); };
  const gl = document.querySelector('#gpu').getContext('webgl2');
  const wrapped = new Proxy(gl, { get(target, key) { const v = Reflect.get(target, key, target); if (typeof v !== 'function') return v; return (...args) => { if (/^draw(?:Arrays|Elements)/.test(key)) drawCalls++; return v.apply(target, args); }; } });
  const allocations = new Map(), realBackend = ok(createWebGL2TransferBackend(gl), 'backend').backend;
  const backend = { ...realBackend, allocate(meta) { const storage = realBackend.allocate(meta); allocations.set(meta.id, storage); return storage; } };
  const { store, bindings } = ok(createResourceStore({ backend }), 'resources');
  const shaderBridge = await createVirglShaderBridge();
  const renderer = ok(createVirglStateRenderer({ gl: wrapped, resources: store, bindings, shaderBridge }), 'renderer').renderer;
  const original = Uint8Array.from(fixtures.commands.submissions.find(s => s.event === 161).data);
  const expected = new Map(), programs = new Map(), rounds = [], rejections = [];
  const run = (id, bytes, label) => ok(renderer.executeSubmission(id, bytes), label);
  const logical = (id) => { const c = renderer.inspect(id).contexts[0]; return c.subContexts.find(s => s.id === c.currentSubContext); };
  for (const [id, delta] of [[2, 0], [3, 100]]) {
    ok(store.createContext(id), 'resource context');
    for (const meta of fixtures.resources) { ok(store.createResource({ ...meta, id: meta.id + delta }), 'resource'); ok(store.attachContext(id, meta.id + delta), 'attach'); }
    for (const b of fixtures.backing) { const flat = new Uint8Array(b.iovLengths.reduce((a, b) => a + b, 0)); for (const r of b.ranges) flat.set(r.data, r.offset); ok(store.attachBacking(b.resourceId + delta, [flat]), 'backing'); }
    ok(renderer.createContext(id), 'state context');
    const raw = original.slice(), dv = new DataView(raw.buffer);
    if (delta) for (const offset of [4, 60, 4740, 4784, 4804, 5100, 5644, 5668, 5680]) dv.setUint32(offset, dv.getUint32(offset, true) + delta, true);
    const result = renderer.executeSubmission(id, raw); bad(result, 'unsupported-draw', 'explicit draw boundary'); equal(result.appliedCommands, 38, '38 original prefix commands'); equal(result.error.byteOffset, 5684, 'original draw offset');
    programs.set(id, gl.getParameter(gl.CURRENT_PROGRAM)); expected.set(id, { bits: [0x3f800000, 0x3f800000, 0x3f800000, 0x3f800000], mask: [true, true, true, true] });
    run(id, packet(31, 0, [0, 1]), 'unbind fragment before prelink'); equal(gl.getParameter(gl.CURRENT_PROGRAM), null, 'missing stage unbinds program');
    run(id, packet(52, 0, [1, 2, 0, 0, 0, 0]), 'prelink without binding'); equal(gl.getParameter(gl.CURRENT_PROGRAM), null, 'prelink leaves GL unbound'); equal(logical(id).bindings.fragmentShader, null, 'prelink leaves virtual fragment unbound');
    run(id, packet(31, 0, [2, 1]), 'rebind fragment'); truth(gl.getParameter(gl.CURRENT_PROGRAM) === programs.get(id), 'prelink cache returns original program');
  }
  const stateOracle = (id) => {
    const program = gl.getParameter(gl.CURRENT_PROGRAM), wanted = expected.get(id);
    truth(program === programs.get(id), 'context owns exact program');
    equal(Array.from(gl.getUniform(program, gl.getUniformLocation(program, 'fsconst0[0]'))), wanted.bits, 'raw constant words');
    equal(Array.from(gl.getParameter(gl.COLOR_WRITEMASK)), wanted.mask, 'virtual write mask');
    const index = gl.getUniformBlockIndex(program, 'VirglBlock'); equal(gl.getActiveUniformBlockParameter(program, index, gl.UNIFORM_BLOCK_BINDING), 0, 'system block rebound');
    const b = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 0), data = new Uint8Array(656); gl.bindBuffer(gl.COPY_READ_BUFFER, b); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, data); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    const wantedBlock = new Uint8Array(656); new DataView(wantedBlock.buffer).setFloat32(640, 1, true); equal(Array.from(data), Array.from(wantedBlock), 'system UBO contents restored');
    for (const cap of [gl.SCISSOR_TEST, gl.RASTERIZER_DISCARD, gl.DEPTH_TEST, gl.STENCIL_TEST]) equal(gl.isEnabled(cap), false, 'unsupported host state disabled');
    equal(gl.getError(), gl.NO_ERROR, 'state oracle GL error');
  };
  const pixelOracle = (storage, width, height, color) => {
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, storage.texture, 0); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'independent framebuffer'); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    for (const pname of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS]) gl.pixelStorei(pname, 0);
    const data = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data); truth(data.every((v, i) => v === color[i % 4]), 'literal full CLEAR pixels'); pixels += width * height;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.deleteFramebuffer(fbo); equal(gl.getError(), gl.NO_ERROR, 'independent read GL error');
  };
  const seedValues = [0x6a09e667, 0xbb67ae85, 0x3c6ef372];
  for (const seed of seedValues) {
    let state = seed >>> 0; const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    for (let n = 0; n < 16; n++) {
      const id = (n & 1) ? 3 : 2, delta = id === 3 ? 100 : 0, mask = random() & 15;
      const bits = [0x80000000, 1 + (random() & 0x7ffffe), random() & 0x7f7fffff, 0xbf800000];
      run(id, packet(12, 0, [1, 0, ...bits]), 'finite raw constants including negative zero and subnormal');
      run(id, packet(1, 1, [80, 0, 0, mask * 0x08000000, 0, 0, 0, 0, 0, 0, 0]), 'fresh copied blend'); run(id, packet(2, 1, [80]), 'bind copied mask'); run(id, packet(3, 1, [80]), 'delete copied mask name');
      expected.set(id, { bits, mask: [1, 2, 4, 8].map(b => Boolean(mask & b)) });
      const missing = 1000 + (random() & 0xffff), beforeBudgets = renderer.inspect().budgets, beforeLeases = store.inspect().budgets.leases;
      for (const [name, bytes, code] of [
        ['wrong type', packet(2, 1, [1]), 'wrong-object-type'],
        ['destroyed copied object', packet(2, 1, [80]), 'missing-object'],
        ['missing subcontext', packet(28, 0, [missing]), 'missing-subcontext'],
        ['active depth', packet(1, 3, [missing, 1, 0, 0, 0]), 'unsupported-feature'],
        ['active storage reset', packet(34, 0, [5, 0, 1, 0, 0]), 'unsupported-feature'],
        ['active image reset', packet(35, 0, [5, 0, 0, 0, 0, 0, 1]), 'unsupported-feature'],
        ['nonidentity swizzle', packet(1, 6, [missing, 6 + delta, 0x02000043, 0, 0, 0]), 'unsupported-feature'],
        ['incompatible surface', packet(1, 8, [missing, 3 + delta, 67, 0, 0]), 'incompatible-resource'],
        ['missing shader', packet(52, 0, [1, missing, 0, 0, 0, 0]), 'missing-object'],
        ['wrong shader stage', packet(31, 0, [1, 1]), 'wrong-shader-stage'],
        ['second vertex retain rollback', packet(6, 0, [16, 0, 3 + delta, 16, 0, missing]), 'missing-resource'],
      ]) {
        const result = renderer.executeSubmission(id, bytes); bad(result, code, name); equal(result.appliedCommands, 0, name + ' applies no prefix');
        equal(renderer.inspect().budgets, beforeBudgets, name + ' no state allocation leak'); equal(store.inspect().budgets.leases, beforeLeases, name + ' no lease leak');
        ok(renderer.restoreContext(id), name + ' recovery'); rejections.push({ seed, n, context: id, name, code, missing });
      }
      const p = programs.get(id), blockIndex = gl.getUniformBlockIndex(p, 'VirglBlock'), buffer = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 0);
      gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(656).fill(0x7e));
      gl.uniformBlockBinding(p, blockIndex, gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS) - 1); gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, null);
      gl.uniform4uiv(gl.getUniformLocation(p, 'fsconst0[0]'), new Uint32Array(4).fill(0x42)); gl.useProgram(null); gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.colorMask(false, false, false, false); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 0, 0); gl.enable(gl.RASTERIZER_DISCARD); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.enable(gl.STENCIL_TEST);
      equal(gl.getError(), gl.NO_ERROR, 'valid independent host poison'); ok(renderer.restoreContext(id), 'restore poisoned virtual context'); stateOracle(id);
      const color = [random() & 1, random() & 1, random() & 1, 1]; run(id, packet(7, 0, [4, ...color.map(v => v ? 0x3f800000 : 0), 0, 0x3ff00000, 0]), 'full CLEAR ignores copied mask');
      equal(Array.from(gl.getParameter(gl.COLOR_WRITEMASK)), expected.get(id).mask, 'clear restores mask'); pixelOracle(allocations.get(5 + delta), 32, 32, color.map(v => v * 255));
      const other = id === 2 ? 3 : 2; ok(renderer.restoreContext(other), 'switch to other virtual context'); stateOracle(other); ok(renderer.restoreContext(id), 'switch back'); stateOracle(id);
      rounds.push({ seed, n, context: id, bits, mask, clear: color });
    }
  }
  // Triple-name reuse: resource and surface names are reused while the old FBO
  // binding still holds the original surface generation and storage.
  ok(renderer.restoreContext(2), 'lifetime context'); const oldTexture = allocations.get(5), oldGeneration = logical(2).bindings.framebuffer[0].generation;
  ok(store.unref(5), 'remove original public resource'); run(2, packet(3, 8, [3]), 'remove bound surface public name'); truth(gl.isTexture(oldTexture.texture), 'old bound texture survives both public names');
  const originalMeta = fixtures.resources.find(r => r.id === 5); ok(store.createResource({ ...originalMeta, width: 1, height: 1 }), 'reuse resource ID5'); ok(store.attachContext(2, 5), 'attach new resource generation'); run(2, packet(1, 8, [3, 5, 67, 0, 0]), 'reuse surface ID3');
  equal(logical(2).bindings.framebuffer[0].generation, oldGeneration, 'double numeric reuse cannot redirect old FBO'); truth(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === oldTexture.texture, 'actual old FBO storage retained');
  run(2, packet(7, 0, [4, 0x3f800000, 0, 0x3f800000, 0x3f800000, 0, 0x3ff00000, 0]), 'clear retained old surface after double reuse'); pixelOracle(oldTexture, 32, 32, [255, 0, 255, 255]);
  run(2, packet(5, 0, [1, 0, 3]), 'explicit FBO rebinding selects new surface'); equal(gl.isTexture(oldTexture.texture), false, 'old storage released at final FBO unbind'); truth(gl.isTexture(allocations.get(5).texture), 'new resource stays alive');
  // Trusted-capability controls cover explicit host defenses, separately from
  // the actual frozen bridge and GPU path used in every original/seeded case.
  const sentinel = new Error('independent unexpected trusted host error');
  const throwsRenderer = ok(createVirglStateRenderer({ gl: wrapped, resources: { ...store, inspect() { throw sentinel; } }, bindings, shaderBridge }), 'throw control renderer').renderer;
  let observedError;
  try { throwsRenderer.createContext(3); } catch (error) { observedError = error; }
  truth(observedError === sentinel, 'unexpected trusted errors propagate unchanged');
  equal(throwsRenderer.inspect().budgets.contexts, 0, 'throw control never publishes context');
  ok(throwsRenderer.dispose(), 'throw control cleanup');
  let omittedBlocks = 0;
  const optionalBridge = { translate(request) { const result = shaderBridge.translate(request); if (request.stage === 'fragment' && result.ok) { equal(result.metadata.uniformBlocks, [], 'actual fragment has no blocks'); delete result.metadata.uniformBlocks; omittedBlocks++; } return result; } };
  const optionalRenderer = ok(createVirglStateRenderer({ gl: wrapped, resources: store, bindings, shaderBridge: optionalBridge }), 'optional metadata renderer').renderer;
  ok(optionalRenderer.createContext(3), 'optional metadata context');
  const optionalRaw = original.slice(), optionalDv = new DataView(optionalRaw.buffer);
  for (const offset of [4, 60, 4740, 4784, 4804, 5100, 5644, 5668, 5680]) optionalDv.setUint32(offset, optionalDv.getUint32(offset, true) + 100, true);
  const optionalResult = optionalRenderer.executeSubmission(3, optionalRaw); bad(optionalResult, 'unsupported-draw', 'optional metadata still reaches explicit draw boundary');
  equal(optionalResult.appliedCommands, 38, 'optional metadata full state prefix'); equal(omittedBlocks, 1, 'one empty fragment metadata omission');
  const optionalPrograms = optionalRenderer.inspect(3).contexts[0].subContexts.find(s => s.id === 1).programs;
  equal(optionalPrograms[0].reflection.uniformBlocks.map(b => [b.name, b.byteLength]), [['VirglBlock', 656]], 'original vertex block remains required and reflected');
  ok(optionalRenderer.dispose(), 'optional metadata cleanup');
  ok(renderer.dispose(), 'renderer cleanup'); ok(store.dispose(), 'store cleanup');
  for (const [key, value] of Object.entries(renderer.inspect().budgets)) equal(value, 0, 'final state budget ' + key);
  for (const [key, value] of Object.entries(store.inspect().budgets)) equal(value, 0, 'final resource budget ' + key);
  equal(drawCalls, 0, 'zero actual draws'); equal(gl.getError(), gl.NO_ERROR, 'final GL error');
  return { status: 'passed', assertions, pixels, rounds, rejections, drawCalls, finalStateBudgets: renderer.inspect().budgets, finalResourceBudgets: store.inspect().budgets,
    trustedHostControls: ['ordinary host Error propagates unchanged with no context publication', 'missing empty fragment uniformBlocks still requires the original vertex block'],
    novel: ['prelink after unbinding a stage', 'negative-zero/subnormal u32 constants', 'overwrite actual system UBO bytes and block binding', '48 seeded A/B/A clear/state recoveries', 'resource and surface IDs simultaneously reused while old framebuffer binding survives'] };
}
