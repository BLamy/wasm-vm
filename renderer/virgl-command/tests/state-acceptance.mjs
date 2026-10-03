// Hardware state proof. Original submission bytes are never rewritten on the
// primary path; synthetic packets below are explicitly separate attacks.
import { createVirglShaderBridge } from "../../virgl-shader/index.mjs";
import { createResourceStore, createWebGL2TransferBackend } from "../resources.mjs";
import { createVirglStateRenderer } from "../state.mjs";

const WHITE = [0x3f800000, 0x3f800000, 0x3f800000, 0x3f800000];
const ORANGE = [0x3f800000, 0x3f000000, 0, 0x3f800000];
const QUARTER_ALPHA = [0x3f800000, 0x3f800000, 0x3f800000, 0x3e800000];
const B_CONSTANTS = [0x3e800000, 0x3f000000, 0x3f400000, 0x3f800000];
const C_CONSTANTS = [0, 0x3f800000, 0, 0x3f800000];
const ORIGINAL_TYPES = [1, 2, 3, 4, 5, 6, 7, 8];

function packet(opcode, type, words) {
  const bytes = new Uint8Array(4 + words.length * 4), view = new DataView(bytes.buffer);
  view.setUint32(0, opcode + type * 256 + words.length * 65536, true);
  words.forEach((word, i) => view.setUint32(4 + i * 4, word, true));
  return bytes;
}
function join(...parts) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function replaceWord(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}
function checker() {
  let assertions = 0;
  const attacks = [];
  const equal = (actual, expected, label) => {
    assertions++;
    if (!Object.is(actual, expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const same = (actual, expected, label) => equal(JSON.stringify(actual), JSON.stringify(expected), label);
  const truth = (value, label) => equal(Boolean(value), true, label);
  const ok = (result, label) => { equal(result?.ok, true, `${label}: ${result?.error?.code ?? ""} ${result?.error?.message ?? ""}`); return result; };
  const bad = (result, label, applied) => {
    equal(result?.ok, false, `${label} rejected`);
    truth(typeof result.error?.code === "string" && typeof result.error?.message === "string", `${label} structured failure`);
    if (applied !== undefined) equal(result.appliedCommands, applied, `${label} applied prefix`);
    attacks.push({ name: label, code: result.error.code, appliedCommands: result.appliedCommands ?? null });
    return result;
  };
  return { equal, same, truth, ok, bad, attacks, get assertions() { return assertions; } };
}
function pixelOracle(bytes, color, c, label) {
  c.equal(bytes.length, 4096, `${label} 32x32 RGBA bytes`);
  for (let i = 0; i < bytes.length; i++) c.equal(bytes[i], color[i % 4], `${label} byte ${i}`);
}
function readTexture(gl, storage, width, height, c, label) {
  const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), previousRead = gl.getParameter(gl.READ_BUFFER);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, storage.texture, 0);
  c.equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, `${label} independent FBO completeness`);
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
  const bytes = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous); gl.readBuffer(previousRead); gl.deleteFramebuffer(framebuffer);
  c.equal(gl.getError(), gl.NO_ERROR, `${label} independent readPixels error`);
  return bytes;
}
function trackedBackend(backend) {
  const allocations = new Map(), live = new Set();
  return { allocations, live, backend: {
    maxTextureSize: backend.maxTextureSize,
    allocate(meta) { const storage = backend.allocate(meta); allocations.set(meta.id, { metadata: meta, storage }); live.add(storage); return storage; },
    destroy(storage) { backend.destroy(storage); live.delete(storage); },
    upload(...args) { return backend.upload(...args); }, readback(...args) { return backend.readback(...args); },
    dispose() { backend.dispose(); },
  } };
}
function installResources(fixtures, store, contextId, resourceDelta, c) {
  c.ok(store.createContext(contextId), `resource context ${contextId}`);
  for (const meta of fixtures.resources) {
    c.ok(store.createResource({ ...meta, id: meta.id + resourceDelta }), `resource ${meta.id + resourceDelta}`);
    c.ok(store.attachContext(contextId, meta.id + resourceDelta), `attach resource ${meta.id + resourceDelta}`);
  }
  for (const backing of fixtures.backing) {
    const bytes = new Uint8Array(backing.iovLengths.reduce((sum, size) => sum + size, 0));
    for (const range of backing.ranges) bytes.set(range.data, range.offset);
    let offset = 0;
    const segments = backing.iovLengths.map((length) => { const result = bytes.slice(offset, offset + length); offset += length; return result; });
    c.ok(store.attachBacking(backing.resourceId + resourceDelta, segments), `backing ${backing.resourceId + resourceDelta}`);
  }
}
function currentSubcontext(renderer, contextId, c) {
  const state = c.ok(renderer.inspect(contextId), `inspect context ${contextId}`);
  const context = state.contexts.find((entry) => entry.id === contextId);
  c.truth(context, `context ${contextId} exists`);
  const sub = context.subContexts.find((entry) => entry.id === context.currentSubContext);
  c.truth(sub, `selected subcontext ${context.currentSubContext} exists`);
  return { state, context, sub };
}
function objectCount(renderer, contextId, c) { return currentSubcontext(renderer, contextId, c).sub.objects.length; }

function stateOracle(gl, allocations, delta, constants, mask, viewport, blend, c, label) {
  const program = gl.getParameter(gl.CURRENT_PROGRAM), vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  c.truth(program && gl.getProgramParameter(program, gl.LINK_STATUS), `${label} actual linked program`);
  c.truth(vao && gl.isVertexArray(vao), `${label} actual vertex array`);
  c.same([...gl.getParameter(gl.COLOR_WRITEMASK)], mask, label === "original" ? "original color mask" : `${label} color mask`);
  c.same([...gl.getParameter(gl.VIEWPORT)], viewport, `${label} viewport`);
  c.same([...gl.getParameter(gl.DEPTH_RANGE)], [0, 1], `${label} depth range`);
  const location = gl.getUniformLocation(program, "fsconst0[0]");
  c.truth(location !== null, `${label} reflected fragment constant location`);
  c.same([...gl.getUniform(program, location)], constants,
    label === "original" ? "original fragment constant bits" : `${label} fragment constant bits`);
  c.equal(gl.getUniform(program, gl.getUniformLocation(program, "fssamp0")), 0, `${label} sampler uniform unit`);
  c.equal(gl.getFragDataLocation(program, "fsout_c0"), 0, `${label} fragment output location`);
  const attributes = [];
  for (const [name, offset] of [["in_0", 0], ["in_1", 8]]) {
    const at = gl.getAttribLocation(program, name);
    c.truth(at >= 0, `${label} ${name} reflected location`);
    c.equal(gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_ENABLED), true, `${label} ${name} enabled`);
    c.equal(gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_SIZE), 2, `${label} ${name} components`);
    c.equal(gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_TYPE), gl.FLOAT, `${label} ${name} float input`);
    c.equal(gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED), false, `${label} ${name} unnormalized`);
    c.equal(gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_STRIDE), 16, `${label} ${name} stride`);
    c.equal(gl.getVertexAttribOffset(at, gl.VERTEX_ATTRIB_ARRAY_POINTER), offset, `${label} ${name} offset`);
    c.equal(gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), allocations.get(3 + delta).storage.buffer, `${label} ${name} resource identity`);
    attributes.push({ name, location: at, components: 2, stride: 16, offset });
  }
  c.equal(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING), allocations.get(4 + delta).storage.buffer, `${label} index resource identity`);
  c.equal(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME),
    allocations.get(5 + delta).storage.texture, `${label} framebuffer surface storage identity`);
  gl.activeTexture(gl.TEXTURE0);
  c.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), allocations.get(6 + delta).storage.texture, `${label} sampler view resource identity`);
  const sampler = gl.getParameter(gl.SAMPLER_BINDING);
  c.truth(sampler && gl.isSampler(sampler), `${label} sampler state object`);
  for (const [parameter, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.NONE]]) {
    c.equal(gl.getSamplerParameter(sampler, parameter), value, `${label} sampler parameter ${parameter}`);
  }
  c.equal(gl.isEnabled(gl.BLEND), blend, `${label} blend enabled`);
  c.equal(gl.isEnabled(gl.CULL_FACE), false, `${label} original culling disabled`);
  c.equal(gl.getParameter(gl.FRONT_FACE), gl.CCW, `${label} lower-left framebuffer front-face mapping`);
  for (const capability of [gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.DITHER, gl.RASTERIZER_DISCARD,
    gl.POLYGON_OFFSET_FILL, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) {
    c.equal(gl.isEnabled(capability), false, `${label} inactive capability ${capability}`);
  }
  c.equal(gl.getParameter(gl.DEPTH_WRITEMASK), false, `${label} depth write mask`);
  if (blend) {
    for (const [parameter, value] of [[gl.BLEND_SRC_RGB, gl.SRC_ALPHA], [gl.BLEND_DST_RGB, gl.ONE_MINUS_SRC_ALPHA],
      [gl.BLEND_SRC_ALPHA, gl.ONE], [gl.BLEND_DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
      [gl.BLEND_EQUATION_RGB, gl.FUNC_ADD], [gl.BLEND_EQUATION_ALPHA, gl.FUNC_ADD]]) c.equal(gl.getParameter(parameter), value, `${label} alpha blend ${parameter}`);
  }
  const blockIndex = gl.getUniformBlockIndex(program, "VirglBlock");
  c.truth(blockIndex !== gl.INVALID_INDEX, `${label} VirglBlock reflected`);
  c.equal(gl.getActiveUniformBlockParameter(program, blockIndex, gl.UNIFORM_BLOCK_DATA_SIZE), 656, `${label} VirglBlock std140 bytes`);
  const binding = gl.getActiveUniformBlockParameter(program, blockIndex, gl.UNIFORM_BLOCK_BINDING);
  const blockBuffer = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, binding);
  c.truth(blockBuffer && gl.isBuffer(blockBuffer), `${label} system UBO binding`);
  let uniformIndex = gl.getUniformIndices(program, ["winsys_adjust_y"])[0];
  if (uniformIndex === gl.INVALID_INDEX) uniformIndex = gl.getUniformIndices(program, ["VirglBlock.winsys_adjust_y"])[0];
  c.truth(uniformIndex !== gl.INVALID_INDEX, `${label} winsys_adjust_y reflection`);
  c.equal(gl.getActiveUniforms(program, [uniformIndex], gl.UNIFORM_OFFSET)[0], 640, `${label} winsys_adjust_y offset`);
  c.equal(gl.getActiveUniforms(program, [uniformIndex], gl.UNIFORM_TYPE)[0], gl.FLOAT, `${label} winsys_adjust_y type`);
  const oldCopy = gl.getParameter(gl.COPY_READ_BUFFER_BINDING), bytes = new Uint8Array(656);
  gl.bindBuffer(gl.COPY_READ_BUFFER, blockBuffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes); gl.bindBuffer(gl.COPY_READ_BUFFER, oldCopy);
  const expectedBlock = new Uint8Array(656); new DataView(expectedBlock.buffer).setFloat32(640, 1, true);
  c.same([...bytes], [...expectedBlock], `${label} actual system UBO bytes`);
  c.equal(gl.getError(), gl.NO_ERROR, `${label} GL state query errors`);
  return { program, vao, framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), sampler,
    report: { attributes, constants: [...gl.getUniform(program, location)], mask: [...mask], viewport: [...viewport],
      uniformBlock: { name: "VirglBlock", binding, byteLength: 656, member: "winsys_adjust_y", offset: 640, value: 1 } } };
}

function poison(gl, program, c) {
  if (program) {
    gl.useProgram(program);
    const location = gl.getUniformLocation(program, "fsconst0[0]");
    if (location) gl.uniform4uiv(location, new Uint32Array([0, 0, 0, 0]));
  }
  const vao = gl.createVertexArray(), buffer = gl.createBuffer(), texture = gl.createTexture(), sampler = gl.createSampler(), framebuffer = gl.createFramebuffer();
  gl.useProgram(null); gl.bindVertexArray(vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, 8, gl.STATIC_DRAW);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
  gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.bindSampler(0, sampler);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.activeTexture(gl.TEXTURE0 + 3); gl.viewport(1, 2, 3, 4); gl.depthRange(0.25, 0.5);
  for (const capability of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.DITHER,
    gl.RASTERIZER_DISCARD, gl.POLYGON_OFFSET_FILL, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) gl.enable(capability);
  gl.colorMask(false, false, false, false); gl.depthMask(true); gl.depthFunc(gl.NEVER);
  gl.cullFace(gl.FRONT); gl.frontFace(gl.CW); gl.scissor(0, 0, 0, 0);
  gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_SUBTRACT); gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE);
  c.equal(gl.getError(), gl.NO_ERROR, "host poison creates valid foreign state");
  return () => { gl.deleteVertexArray(vao); gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteSampler(sampler); gl.deleteFramebuffer(framebuffer); };
}

function trustedFaultControls(gl, resources, bindings, shaderBridge, originalBytes, c) {
  const control = { mode: null, injected: false, allocatedSampler: null };
  const wrapped = new Proxy(gl, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args) => {
      if (control.mode === "already-lost-context" && key === "isContextLost") return true;
      if (control.mode === key && ["createVertexArray", "createFramebuffer", "createShader", "createSampler", "createProgram", "createBuffer"].includes(key)) return null;
      if (control.mode === "compile-status" && key === "getShaderParameter" && args[1] === target.COMPILE_STATUS) return false;
      if (control.mode === "late-output-reflection" && key === "getFragDataLocation") return 1;
      if (["surface-final-check", "sampler-final-check"].includes(control.mode) && key === "getError" && !control.injected) {
        control.injected = true; return target.INVALID_OPERATION;
      }
      const result = value.apply(target, args);
      if (control.mode === "sampler-final-check" && key === "createSampler") control.allocatedSampler = result;
      return result;
    };
  } });
  const cases = ["createVertexArray", "createFramebuffer", "createShader", "compile-status", "createSampler",
    "createProgram", "createBuffer", "late-output-reflection", "surface-final-check", "sampler-final-check"];
  c.equal(c.bad(createVirglStateRenderer(null), "null renderer configuration").error.code, "invalid-input", "null configuration error code");
  const throwingConfig = new Proxy({ gl, resources, bindings, shaderBridge }, {
    getOwnPropertyDescriptor() { throw new Error("trusted configuration descriptor fault"); },
  });
  c.equal(c.bad(createVirglStateRenderer(throwingConfig), "throwing renderer configuration descriptor").error.code,
    "invalid-input", "throwing configuration error code");
  control.mode = "already-lost-context";
  c.bad(createVirglStateRenderer({ gl: wrapped, resources, bindings, shaderBridge }), "trusted already-lost context factory rejection");
  control.mode = null;
  c.equal(gl.isContextLost(), false, "trusted lost-context control never loses actual hardware context");
  for (const mode of cases) {
    const renderer = c.ok(createVirglStateRenderer({ gl: wrapped, resources, bindings, shaderBridge }), `trusted ${mode} renderer`).renderer;
    if (mode === "createVertexArray" || mode === "createFramebuffer") {
      control.mode = mode;
      c.bad(renderer.createContext(2), `trusted ${mode} allocation failure`);
      c.equal(c.ok(renderer.inspect(), `trusted ${mode} unpublished context`).budgets.subContexts, 0, `trusted ${mode} rollback helper count`);
      control.mode = null; c.ok(renderer.createContext(2), `trusted ${mode} same-context recovery`);
    } else {
      c.ok(renderer.createContext(2), `trusted ${mode} context`);
      const linking = ["createProgram", "createBuffer", "late-output-reflection"].includes(mode);
      if (linking) c.ok(renderer.executeSubmission(2, originalBytes.slice(4136, 4708)), `trusted ${mode} actual captured shaders`);
      const input = linking ? originalBytes.slice(4708, 4736)
        : ["createSampler", "sampler-final-check"].includes(mode) ? originalBytes.slice(5136, 5176)
          : mode === "surface-final-check" ? packet(1, 8, [120, 5, 67, 0, 0]) : originalBytes.slice(4136, 4420);
      const priorLeases = c.ok(resources.inspect(), `trusted ${mode} resource counters before`).budgets.leases;
      control.mode = mode; control.injected = false; control.allocatedSampler = null;
      c.bad(renderer.executeSubmission(2, input), `trusted ${mode} controlled state failure`, 0);
      const after = c.ok(renderer.inspect(), `trusted ${mode} rollback inspection`).budgets;
      c.equal(after.objects, linking ? 2 : 0, `trusted ${mode} no unreachable objects`);
      c.equal(after.programs, 0, `trusted ${mode} no leaked program`);
      c.equal(after.uniformBytes, 0, `trusted ${mode} no leaked system buffer bytes`);
      c.equal(after.leases, 0, `trusted ${mode} no leaked renderer resource lease`);
      c.equal(c.ok(resources.inspect(), `trusted ${mode} resource counters after`).budgets.leases, priorLeases,
        `trusted ${mode} no leaked external resource lease`);
      if (["surface-final-check", "sampler-final-check"].includes(mode)) c.equal(control.injected, true, `trusted ${mode} final check reached`);
      if (mode === "sampler-final-check") {
        c.truth(control.allocatedSampler, "trusted sampler final-check allocated actual sampler before failure");
        c.equal(gl.isSampler(control.allocatedSampler), false, "trusted sampler final-check rollback deleted actual sampler");
      }
      control.mode = null;
      c.ok(renderer.executeSubmission(2, input), `trusted ${mode} actual same-context recovery`);
    }
    c.ok(renderer.dispose(), `trusted ${mode} dispose`); c.ok(renderer.dispose(), `trusted ${mode} idempotent dispose`);
    for (const [key, value] of Object.entries(c.ok(renderer.inspect(), `trusted ${mode} final counters`).budgets)) {
      c.equal(value, 0, `trusted ${mode} final ${key}`);
    }
    c.equal(gl.getError(), gl.NO_ERROR, `trusted ${mode} actual GL error state`);
  }
  return { boundary: "trusted failure controls, not substitutes for GPU success oracles", cases: ["null-configuration", "throwing-configuration-descriptor", "already-lost-context", ...cases],
    sameContextRecovery: true, idempotentDispose: true };
}

export async function runBrowserAcceptance(fixtures, options = {}) {
  const c = checker(), canvas = document.getElementById("gpu");
  c.truth(canvas, "actual GPU canvas");
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  c.truth(gl, "actual WebGL2 context");
  const tracked = trackedBackend(c.ok(createWebGL2TransferBackend(gl), "resource WebGL backend").backend);
  const resourceFactory = c.ok(createResourceStore({ backend: tracked.backend }), "resource store and trusted bindings");
  const { store, bindings } = resourceFactory;
  const actualBridge = await createVirglShaderBridge(options.bridgeOptions ?? {}), translations = [];
  const shaderBridge = { translate(request) {
    const result = actualBridge.translate(request);
    translations.push({ stage: request.stage, text: request.text, ok: result.ok, metadata: result.metadata ?? null });
    return result;
  } };
  const renderer = c.ok(createVirglStateRenderer({ gl, resources: store, bindings, shaderBridge }), "state renderer").renderer;
  const source = new Map(fixtures.commands.submissions.map((entry) => [entry.event, entry]));
  const raw = (event) => Uint8Array.from(source.get(event).data);
  const labels = (event) => ({ sourceSha256: source.get(event).sourceSha256, event, contextId: 2 });
  const run = (ctx, bytes, label) => c.ok(renderer.executeSubmission(ctx, bytes), label);
  const originalResults = [];
  const original = (event, expectedApplied, stopOffset) => {
    const result = renderer.executeSubmission(2, raw(event), labels(event));
    if (stopOffset === undefined) c.ok(result, `original event ${event}`);
    else {
      c.bad(result, `original event ${event} explicit unsupported draw`, expectedApplied);
      c.equal(result.error.opcode, 8, `original event ${event} stops at DRAW_VBO`);
      c.equal(result.error.byteOffset, stopOffset, `original event ${event} draw byte offset`);
    }
    c.equal(result.appliedCommands, expectedApplied, `original event ${event} applied commands`);
    originalResults.push({ event, sourceSha256: source.get(event).sourceSha256, byteLength: raw(event).length,
      ok: result.ok, appliedCommands: result.appliedCommands, stopOffset: result.error?.byteOffset ?? null });
    return result;
  };

  installResources(fixtures, store, 2, 0, c); c.ok(renderer.createContext(2), "state context A");
  c.bad(bindings.resolve({}), "forged resource binding capability");
  const bindingLease = c.ok(store.retainStorage(2, 3, "vertex"), "binding capability lease").lease;
  c.equal(c.ok(bindings.resolve(bindingLease), "resolve actual resource binding").storage.buffer,
    tracked.allocations.get(3).storage.buffer, "binding capability resolves actual storage");
  const foreignFactory = c.ok(createResourceStore({ backend: c.ok(createWebGL2TransferBackend(gl), "foreign capability backend").backend }),
    "foreign capability store");
  c.bad(foreignFactory.bindings.resolve(bindingLease), "foreign store cannot resolve resource lease");
  c.ok(foreignFactory.store.dispose(), "foreign capability store cleanup");
  c.ok(store.releaseStorage(bindingLease), "release binding capability lease");
  c.bad(bindings.resolve(bindingLease), "released resource binding capability");
  original(161, 38, 5684);
  const first = stateOracle(gl, tracked.allocations, 0, WHITE, [true, true, true, true], [0, 0, 32, 32], false, c, "original");
  const firstLogical = currentSubcontext(renderer, 2, c);
  c.equal(firstLogical.context.currentSubContext, 1, "original selected subcontext1");
  c.equal(firstLogical.sub.objects.length, 9, "original nine objects");
  c.same([...new Set(firstLogical.sub.objects.map((object) => object.type))].sort((a, b) => a - b), ORIGINAL_TYPES, "all eight typed object families");
  c.equal(firstLogical.sub.programs.length, 1, "one original linked program");
  c.same(translations.slice(0, 2).map((item) => [item.stage, item.text]),
    [["vertex", fixtures.commands.shaders.VERT], ["fragment", fixtures.commands.shaders.FRAG]], "bridge consumed both unmodified original TGSI texts");
  c.truth(translations.slice(0, 2).every((item) => item.ok), "actual captured shader translations succeeded");
  pixelOracle(readTexture(gl, tracked.allocations.get(5).storage, 32, 32, c, "original CLEAR"), [0, 0, 255, 255], c, "independent original blue CLEAR");

  // CLEAR ignores the Gallium blend color mask, and restores it afterward.
  run(2, join(packet(1, 1, [70, 0, 0, 5 * 0x08000000, 0, 0, 0, 0, 0, 0, 0]), packet(2, 1, [70])), "synthetic masked blend");
  run(2, packet(7, 0, [4, 0x3f800000, 0, 0, 0x3f800000, 0, 0x3ff00000, 0]), "red CLEAR under partial mask");
  pixelOracle(readTexture(gl, tracked.allocations.get(5).storage, 32, 32, c, "mask-independent red CLEAR"), [255, 0, 0, 255], c, "CLEAR ignores partial color mask");
  c.same([...gl.getParameter(gl.COLOR_WRITEMASK)], [true, false, true, false], "CLEAR restores bound partial color mask");
  run(2, raw(161).slice(4848, 4884), "original blue CLEAR packet after mask attack");
  pixelOracle(readTexture(gl, tracked.allocations.get(5).storage, 32, 32, c, "restored original blue"), [0, 0, 255, 255], c, "CLEAR blue independent of partial mask");
  run(2, join(packet(2, 1, [7]), packet(3, 1, [70])), "restore original blend and remove attack object");

  // B reuses all numeric object handles, but owns different resources and state.
  installResources(fixtures, store, 3, 100, c); c.ok(renderer.createContext(3), "state context B");
  const syntheticB = raw(161);
  for (const [offset, id] of [[4, 103], [60, 104], [4740, 106], [4784, 107], [4804, 105],
    [5100, 106], [5644, 104], [5668, 103], [5680, 103]]) replaceWord(syntheticB, offset, id);
  B_CONSTANTS.forEach((value, i) => replaceWord(syntheticB, 5348 + 4 * i, value));
  replaceWord(syntheticB, 5208, 5 * 0x08000000);
  replaceWord(syntheticB, 5312, 0x41400000); replaceWord(syntheticB, 5316, 0x41200000);
  c.bad(renderer.executeSubmission(3, syntheticB), "synthetic B explicit unsupported draw", 38);
  const stateB = stateOracle(gl, tracked.allocations, 100, B_CONSTANTS, [true, false, true, false], [4, 6, 24, 20], false, c, "context B");
  c.truth(first.program !== stateB.program && first.vao !== stateB.vao && first.framebuffer !== stateB.framebuffer,
    "A and B have distinct actual state objects");
  const syntheticC = syntheticB.slice(4112);
  C_CONSTANTS.forEach((value, i) => replaceWord(syntheticC, 5348 - 4112 + i * 4, value));
  replaceWord(syntheticC, 5208 - 4112, 10 * 0x08000000);
  run(3, join(packet(29, 0, [2]), packet(28, 0, [2])), "B creates and selects subcontext2");
  c.bad(renderer.executeSubmission(3, syntheticC), "synthetic B subcontext2 unsupported draw", 33);
  stateOracle(gl, tracked.allocations, 100, C_CONSTANTS, [false, true, false, true], [4, 6, 24, 20], false, c, "B subcontext2");
  for (const [ctx, subId, delta, constants, mask, viewport, name] of [
    [2, 1, 0, WHITE, [true, true, true, true], [0, 0, 32, 32], "A after B2"],
    [3, 1, 100, B_CONSTANTS, [true, false, true, false], [4, 6, 24, 20], "B1 after A"],
    [2, 1, 0, WHITE, [true, true, true, true], [0, 0, 32, 32], "A after B1"],
  ]) {
    run(ctx, packet(28, 0, [subId]), `${name} select`);
    const cleanup = poison(gl, gl.getParameter(gl.CURRENT_PROGRAM), c);
    c.ok(renderer.restoreContext(ctx), `${name} explicit restore`);
    const observed = stateOracle(gl, tracked.allocations, delta, constants, mask, viewport, false, c, name);
    if (ctx === 2) { c.equal(observed.program, first.program, `${name} exact original program`); c.equal(observed.vao, first.vao, `${name} exact original VAO`); }
    cleanup();
  }

  // Namespace destruction is distinct from retained bindings. Use B2 so the
  // primary captured handle generations and remaining original bytes stay intact.
  run(3, packet(28, 0, [2]), "select B2 for typed lifetime attacks");
  const oldShaderProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const oldShaderGeneration = currentSubcontext(renderer, 3, c).sub.bindings.fragmentShader.generation;
  run(3, packet(3, 4, [2]), "destroy bound fragment shader public name");
  c.equal(gl.getParameter(gl.CURRENT_PROGRAM), oldShaderProgram, "bound shader survives public name destruction");
  c.truth(currentSubcontext(renderer, 3, c).sub.objects.some((object) => object.type === 4 && object.handle === 2 && !object.public),
    "bound shader remains an explicitly private object");
  run(3, raw(161).slice(4420, 4708), "reuse destroyed fragment shader handle2");
  c.equal(currentSubcontext(renderer, 3, c).sub.bindings.fragmentShader.generation, oldShaderGeneration,
    "shader ID reuse does not retarget an existing binding");
  run(3, packet(31, 0, [2, 1]), "explicit bind selects new shader generation");
  c.truth(gl.getParameter(gl.CURRENT_PROGRAM) !== oldShaderProgram, "new shader generation has distinct actual linked program");
  c.equal(gl.isProgram(oldShaderProgram), false, "old shader program released after final binding drops");
  const retainedView = packet(1, 6, [110, 106, 0x02000043, 0, 0, 0x688]);
  run(3, join(retainedView, packet(10, 0, [1, 0, 110])), "create and bind temporary view110");
  const oldViewGeneration = currentSubcontext(renderer, 3, c).sub.bindings.samplerViews[1][0].generation;
  run(3, packet(3, 6, [110]), "destroy bound sampler view name");
  c.truth(currentSubcontext(renderer, 3, c).sub.objects.some((object) => object.handle === 110 && !object.public && object.references > 0),
    "bound sampler view survives name destruction");
  run(3, retainedView, "reuse retained sampler view handle110");
  c.equal(currentSubcontext(renderer, 3, c).sub.bindings.samplerViews[1][0].generation, oldViewGeneration,
    "sampler view ID reuse does not alias retained binding");
  run(3, join(packet(10, 0, [1, 0, 5]), packet(3, 6, [110])), "unbind retained view and destroy new view generation");
  c.truth(!currentSubcontext(renderer, 3, c).sub.objects.some((object) => object.handle === 110), "both retired and new view generations released");
  run(3, join(packet(1, 1, [111, 0, 0, 6 * 0x08000000, 0, 0, 0, 0, 0, 0, 0]), packet(2, 1, [111]), packet(3, 1, [111])),
    "destroy bound blend namespace after copied state");
  c.same([...gl.getParameter(gl.COLOR_WRITEMASK)], [false, true, true, false], "bound blend snapshot survives destroy");
  run(3, packet(1, 1, [111, 0, 0, 9 * 0x08000000, 0, 0, 0, 0, 0, 0, 0]), "reuse blend snapshot numeric handle");
  c.same([...gl.getParameter(gl.COLOR_WRITEMASK)], [false, true, true, false], "blend ID reuse leaves old copied state");
  run(3, packet(2, 1, [111]), "bind new blend generation");
  c.same([...gl.getParameter(gl.COLOR_WRITEMASK)], [true, false, false, true], "explicit bind applies new copied blend");
  run(3, join(packet(2, 1, [7]), packet(3, 1, [111])), "restore B2 blend snapshot");
  const sampler112 = raw(161).slice(5136, 5176), sampler113 = sampler112.slice();
  replaceWord(sampler112, 4, 112); replaceWord(sampler113, 4, 113);
  run(3, join(sampler112, sampler113, packet(18, 0, [1, 0, 6, 112, 113])), "bind three sampler states for ordered deletion");
  gl.activeTexture(gl.TEXTURE0 + 2); const lastSampler = gl.getParameter(gl.SAMPLER_BINDING);
  run(3, packet(3, 7, [112]), "destroy middle bound sampler state");
  const compacted = currentSubcontext(renderer, 3, c).sub.bindings.samplerStates[1];
  c.same(compacted.slice(0, 3).map((entry) => entry?.handle ?? null), [6, 113, null], "sampler deletion compacts subsequent binding slots");
  gl.activeTexture(gl.TEXTURE0 + 1); c.equal(gl.getParameter(gl.SAMPLER_BINDING), lastSampler, "compacted sampler uses same actual GL object");
  gl.activeTexture(gl.TEXTURE0 + 2); c.equal(gl.getParameter(gl.SAMPLER_BINDING), null, "compacted tail sampler slot cleared");
  run(3, join(packet(18, 0, [1, 0, 6, 0, 0]), packet(3, 7, [113])), "restore B2 sampler bindings");
  run(2, packet(28, 0, [1]), "return to original A after typed lifetime attacks");

  // Bounded errors: typed names, active feature resets, and late object failure.
  const rejectStable = (bytes, name, applied = 0) => {
    const objects = objectCount(renderer, 2, c), leases = c.ok(store.inspect(), `${name} resource before`).budgets.leases;
    c.bad(renderer.executeSubmission(2, bytes), name, applied);
    c.equal(objectCount(renderer, 2, c), objects, `${name} no unreachable object`);
    c.equal(c.ok(store.inspect(), `${name} resource after`).budgets.leases, leases, `${name} no leaked resource lease`);
    c.ok(renderer.restoreContext(2), `${name} valid state recovery`);
  };
  rejectStable(packet(2, 1, [9]), "wrong typed handle");
  rejectStable(packet(2, 1, [999]), "missing object handle");
  rejectStable(packet(28, 0, [999]), "missing subcontext selection");
  rejectStable(packet(29, 0, [1]), "duplicate subcontext");
  rejectStable(packet(1, 8, [88, 999, 67, 0, 0]), "surface missing resource late failure");
  rejectStable(packet(1, 8, [88, 3, 67, 0, 0]), "surface buffer attachment incompatible");
  rejectStable(packet(1, 8, [88, 105, 67, 0, 0]), "surface resource belongs to another context");
  rejectStable(packet(1, 6, [88, 6, 0x02000043, 0, 0, 0]), "nonidentity sampler view rejected");
  rejectStable(packet(1, 6, [88, 3, 0x02000043, 0, 0, 0x688]), "sampler view buffer attachment incompatible");
  rejectStable(packet(1, 3, [88, 1, 0, 0, 0]), "active depth hidden in DSA");
  rejectStable(packet(34, 0, [5, 0, 1, 0, 0]), "active shader storage hidden in reset");
  rejectStable(packet(35, 0, [5, 0, 0, 0, 0, 0, 1]), "active image hidden in reset");
  rejectStable(packet(31, 0, [1, 5]), "active unsupported shader stage");
  rejectStable(packet(31, 0, [1, 1]), "vertex shader in fragment binding");
  rejectStable(packet(52, 0, [1, 999, 0, 0, 0, 0]), "missing fragment shader linkage");
  rejectStable(packet(11, 0, [4, 2, 14]), "index offset beyond logical storage");
  rejectStable(packet(6, 0, [16, 0, 3, 16, 0, 999]), "second vertex lease failure rolls back first lease");
  rejectStable(join(packet(1, 1, [81, 0, 0, 15 * 0x08000000, 0, 0, 0, 0, 0, 0, 0]), packet(255, 0, [])),
    "malformed wire tail applies no prefix");
  run(2, packet(31, 0, [0, 1]), "explicit missing fragment shader state");
  c.ok(renderer.restoreContext(2), "restore incomplete shader state");
  c.equal(gl.getParameter(gl.CURRENT_PROGRAM), null, "missing shader unbinds stale GL program");
  run(2, packet(31, 0, [2, 1]), "restore original fragment shader binding");
  c.equal(gl.getParameter(gl.CURRENT_PROGRAM), first.program, "shader rebind recovers original actual program");
  run(2, packet(5, 0, [0, 0]), "empty framebuffer binding");
  c.bad(renderer.executeSubmission(2, raw(161).slice(4848, 4884)), "CLEAR missing framebuffer state", 0);
  run(2, packet(5, 0, [1, 0, 3]), "recover original framebuffer surface");
  run(2, packet(4, 0, [0]), "empty viewport update is a no-op");
  c.same([...gl.getParameter(gl.VIEWPORT)], [0, 0, 32, 32], "empty viewport preserves current rectangle");
  run(2, packet(6, 0, []), "empty vertex buffer reset");
  for (const name of ["in_0", "in_1"]) c.equal(gl.getVertexAttrib(gl.getAttribLocation(first.program, name), gl.VERTEX_ATTRIB_ARRAY_ENABLED),
    false, `empty vertex reset disables ${name}`);
  run(2, raw(161).slice(5656, 5684), "restore captured vertex buffers after empty reset");
  run(2, packet(6, 0, [0, 0, 0]), "explicit null vertex buffer slot");
  c.same(currentSubcontext(renderer, 2, c).sub.bindings.vertexBuffers, [null], "explicit null vertex buffer retained as one null slot");
  for (const name of ["in_0", "in_1"]) c.equal(gl.getVertexAttrib(gl.getAttribLocation(first.program, name), gl.VERTEX_ATTRIB_ARRAY_ENABLED),
    false, `null vertex buffer slot disables ${name}`);
  run(2, raw(161).slice(5656, 5684), "restore captured vertex buffers after null slot");
  run(2, join(packet(1, 5, [93, 0, 0, 0, 29]), packet(2, 5, [93])), "one vertex element with two reflected shader attributes");
  c.equal(gl.getVertexAttrib(gl.getAttribLocation(first.program, "in_0"), gl.VERTEX_ATTRIB_ARRAY_ENABLED), true,
    "existing vertex element enables first reflected attribute");
  c.equal(gl.getVertexAttrib(gl.getAttribLocation(first.program, "in_1"), gl.VERTEX_ATTRIB_ARRAY_ENABLED), false,
    "missing vertex element disables second reflected attribute");
  run(2, join(packet(2, 5, [9]), packet(3, 5, [93])), "restore captured two-element vertex layout");
  c.equal(gl.getVertexAttrib(gl.getAttribLocation(first.program, "in_1"), gl.VERTEX_ATTRIB_ARRAY_ENABLED), true,
    "restored vertex element re-enables second reflected attribute");
  const positiveRasterizer = raw(161).slice(5248, 5288), positiveSampler = raw(161).slice(5136, 5176);
  replaceWord(positiveRasterizer, 4, 91); replaceWord(positiveRasterizer, 8, 536871106 | 512 | 32768);
  replaceWord(positiveSampler, 4, 92); replaceWord(positiveSampler, 8, (725010 & ~(7 << 6)) | (2 << 6) | 512 | 8192);
  run(2, join(packet(1, 1, [90, 4, 0, 2093098513, 0, 0, 0, 0, 0, 0, 0]), positiveRasterizer, positiveSampler,
    packet(2, 1, [90]), packet(2, 2, [91]), packet(18, 0, [1, 0, 92])), "supported positive state variants");
  c.equal(gl.isEnabled(gl.DITHER), true, "positive dither state"); c.equal(gl.isEnabled(gl.CULL_FACE), true, "positive back-face culling state");
  c.equal(gl.getParameter(gl.CULL_FACE_MODE), gl.BACK, "back-face culling mode"); c.equal(gl.getParameter(gl.FRONT_FACE), gl.CW, "frontCcw true XOR lower-left framebuffer origin");
  c.equal(gl.getParameter(gl.BLEND_SRC_RGB), gl.ONE, "positive additive ONE source blend factor");
  gl.activeTexture(gl.TEXTURE0); const linear = gl.getParameter(gl.SAMPLER_BINDING);
  c.equal(gl.getSamplerParameter(linear, gl.TEXTURE_MIN_FILTER), gl.LINEAR, "positive linear minification");
  c.equal(gl.getSamplerParameter(linear, gl.TEXTURE_MAG_FILTER), gl.LINEAR, "positive linear magnification");
  c.equal(gl.getSamplerParameter(linear, gl.TEXTURE_WRAP_R), gl.CLAMP_TO_EDGE, "positive clamp-edge R wrap");
  run(2, join(packet(2, 1, [7]), packet(2, 2, [8]), packet(18, 0, [1, 0, 6]),
    packet(3, 1, [90]), packet(3, 2, [91]), packet(3, 7, [92])), "restore original state after positive variants");
  run(2, packet(1, 1, [80, 0, 0, 15 * 0x08000000, 0, 0, 0, 0, 0, 0, 0]), "create temporary blend80");
  run(2, packet(3, 1, [80]), "destroy blend80");
  rejectStable(packet(2, 1, [80]), "destroyed object cannot bind");
  run(2, join(packet(1, 1, [80, 0, 0, 10 * 0x08000000, 0, 0, 0, 0, 0, 0, 0]), packet(2, 1, [80])), "reuse blend80 with new state");
  c.same([...gl.getParameter(gl.COLOR_WRITEMASK)], [false, true, false, true], "reused object handle has fresh color mask");
  run(2, join(packet(2, 1, [7]), packet(3, 1, [80])), "recover original blend after reuse");
  const oldObjects = objectCount(renderer, 2, c);
  c.bad(renderer.executeSubmission(2, join(packet(1, 1, [81, 0, 0, 15 * 0x08000000, 0, 0, 0, 0, 0, 0, 0]),
    packet(1, 8, [82, 999, 67, 0, 0]))), "late ordered failure preserves only committed prefix", 1);
  c.equal(objectCount(renderer, 2, c), oldObjects + 1, "late failure has exactly one reachable prefix object");
  run(2, packet(3, 1, [81]), "late failure prefix cleanup");

  for (const [name, limits] of [["contexts", { contexts: 0 }], ["subcontexts", { subContexts: 0 }],
    ["objects", { objects: 1 }], ["programs", { programs: 0 }],
    ["shader text bytes", { shaderBytes: 255 }], ["system uniform bytes", { uniformBytes: 655 }]]) {
    const bounded = c.ok(createVirglStateRenderer({ gl, resources: store, bindings, shaderBridge, limits }), `bounded ${name} renderer`).renderer;
    if (name === "contexts" || name === "subcontexts") c.bad(bounded.createContext(2), `bounded ${name} creation`);
    else {
      c.ok(bounded.createContext(2), `bounded ${name} context`);
      if (name === "objects") {
        c.ok(bounded.executeSubmission(2, packet(1, 1, [1, 0, 0, 15 * 0x08000000, 0, 0, 0, 0, 0, 0, 0])), "exact one-object budget");
        c.bad(bounded.executeSubmission(2, packet(1, 1, [2, 0, 0, 15 * 0x08000000, 0, 0, 0, 0, 0, 0, 0])), "object budget rejection", 0);
      } else if (name === "shader text bytes") {
        c.bad(bounded.executeSubmission(2, raw(161).slice(4136, 4420)), "shader source byte budget rejection", 0);
      } else {
        c.ok(bounded.executeSubmission(2, raw(161).slice(4136, 4708)), `bounded ${name} real shader creation`);
        c.bad(bounded.executeSubmission(2, raw(161).slice(4708, 4736)), `bounded ${name} link rejection`, 0);
        c.equal(c.ok(bounded.inspect(), `bounded ${name} inspect after failure`).budgets.programs, 0, `${name} leaves no leaked program`);
        c.equal(c.ok(bounded.inspect(), `bounded ${name} uniform accounting`).budgets.uniformBytes, 0, `${name} leaves no system buffer bytes`);
      }
    }
    c.ok(bounded.dispose(), `bounded ${name} disposal`);
    for (const [key, value] of Object.entries(c.ok(bounded.inspect(), `bounded ${name} final inspect`).budgets)) {
      c.equal(value, 0, `bounded ${name} final ${key}`);
    }
  }
  const faultControls = trustedFaultControls(gl, store, bindings, shaderBridge, raw(161), c);
  {
    const childFactory = c.ok(createResourceStore({ backend: c.ok(createWebGL2TransferBackend(gl), "store-first backend").backend }), "store-first resource store");
    installResources(fixtures, childFactory.store, 2, 0, c);
    const child = c.ok(createVirglStateRenderer({ gl, resources: childFactory.store, bindings: childFactory.bindings, shaderBridge }), "store-first state renderer").renderer;
    c.ok(child.createContext(2), "store-first state context");
    c.bad(child.executeSubmission(2, raw(161)), "store-first setup explicit unsupported draw", 38);
    c.truth(c.ok(child.inspect(), "store-first active objects").budgets.leases > 0, "store-first setup has active surface/view/buffer leases");
    c.equal(c.ok(child.inspect(), "store-first active program").budgets.programs, 1, "store-first setup has actual linked shader program");
    c.ok(childFactory.store.dispose(), "resource store disposed before active renderer");
    c.ok(child.dispose(), "renderer cleanup after resource leases revoked");
    for (const [key, value] of Object.entries(c.ok(child.inspect(), "store-first final state").budgets)) c.equal(value, 0, `store-first final state ${key}`);
    for (const [key, value] of Object.entries(c.ok(childFactory.store.inspect(), "store-first final resources").budgets)) c.equal(value, 0, `store-first final resource ${key}`);
  }
  c.ok(renderer.restoreContext(2), "recover main context after bounded isolated renderers");

  original(173, 3);
  original(185, 5, 4184);
  const orange = stateOracle(gl, tracked.allocations, 0, ORANGE, [true, true, true, true], [0, 0, 32, 32], false, c, "original tint phase");
  c.equal(orange.program, first.program, "same linked program through original tint update");
  pixelOracle(readTexture(gl, tracked.allocations.get(5).storage, 32, 32, c, "original phase185 clear"), [0, 0, 255, 255], c, "phase185 independent blue CLEAR");
  original(197, 3); original(209, 7, 4240);
  const alpha = stateOracle(gl, tracked.allocations, 0, QUARTER_ALPHA, [true, true, true, true], [0, 0, 32, 32], true, c, "original alpha phase");
  c.equal(alpha.program, first.program, "same linked program through original blend update");
  pixelOracle(readTexture(gl, tracked.allocations.get(5).storage, 32, 32, c, "original phase209 clear"), [0, 0, 255, 255], c, "phase209 independent blue CLEAR");
  original(221, 3); original(233, 6);

  const lifecycle = [];
  const applyLifecycle = (entry) => {
    c.equal(entry.eventsSha256, "c6a95dbcf78f2cdd955af45fbec044cfc5fe4fbb8a4a4a93afefbad37b6856f9", `lifecycle event ${entry.event} source hash`);
    if (entry.type === "ctx_detach_resource") c.ok(store.detachContext(entry.contextId, entry.resourceId), `original lifecycle ${entry.event} detach`);
    if (entry.type === "resource_detach_iov") c.ok(store.detachBacking(entry.resourceId), `original lifecycle ${entry.event} detach backing`);
    if (entry.type === "resource_unref") c.ok(store.unref(entry.resourceId), `original lifecycle ${entry.event} public unref`);
    if (entry.type === "context_destroy") { c.ok(renderer.destroyContext(entry.contextId), `original lifecycle ${entry.event} state context destroy`); c.ok(store.destroyContext(entry.contextId), `original lifecycle ${entry.event} resource context destroy`); }
    lifecycle.push(entry);
  };
  const oldSurface = tracked.allocations.get(5).storage;
  const removedResourceLease = c.ok(store.retainStorage(2, 5, "surface"), "retained binding capability before public removal").lease;
  fixtures.lifecycle.filter((entry) => entry.event < 249).forEach(applyLifecycle);
  c.truth(gl.isTexture(oldSurface.texture), "bound surface retains texture after public resource5 removal");
  c.equal(c.ok(bindings.resolve(removedResourceLease), "resolve retained binding after public unref").storage.texture,
    oldSurface.texture, "retained capability keeps original storage identity");
  c.ok(store.releaseStorage(removedResourceLease), "release independent retained capability before surface lifetime proof");
  c.bad(store.retainStorage(2, 5, "surface"), "removed resource5 has no new public lookup");
  const teardown = raw(249), surfaceDestroyEnd = 11384;
  const prefix = c.ok(renderer.executeSubmission(2, teardown.slice(0, surfaceDestroyEnd), labels(249)), "original249 through surface name destruction");
  c.equal(prefix.appliedCommands, 131, "exact original249 prefix command count");
  const retained = currentSubcontext(renderer, 2, c).sub.objects.find((object) => object.handle === 3 && object.type === 8);
  c.truth(retained && retained.public === false && retained.references > 0, "destroyed surface name retained by framebuffer binding");
  c.truth(gl.isTexture(oldSurface.texture), "surface name destruction retains actual bound texture");
  pixelOracle(readTexture(gl, oldSurface, 32, 32, c, "retained surface after public object destroy"), [0, 0, 255, 255], c, "retained surface pixels before unbind");
  const suffix = c.ok(renderer.executeSubmission(2, teardown.slice(surfaceDestroyEnd), labels(249)), "original249 unbind and remaining teardown");
  c.equal(suffix.appliedCommands, 11, "exact original249 suffix command count");
  c.equal(prefix.appliedCommands + suffix.appliedCommands, 142, "all original249 packets executed once");
  c.equal(gl.isTexture(oldSurface.texture), false, "framebuffer unbind releases final surface storage");
  originalResults.push({ event: 249, sourceSha256: source.get(249).sourceSha256, byteLength: teardown.length,
    ok: true, appliedCommands: 142, splitByteOffset: surfaceDestroyEnd, prefixCommands: prefix.appliedCommands, suffixCommands: suffix.appliedCommands });
  fixtures.lifecycle.filter((entry) => entry.event > 249).forEach(applyLifecycle);
  c.equal(c.ok(store.inspect(), "original lifecycle complete").resources.filter((entry) => entry.id < 100).length, 0, "all original resource generations released");

  c.ok(renderer.destroyContext(3), "destroy synthetic B contexts and all reused handles");
  c.ok(store.destroyContext(3), "destroy synthetic B resource context");
  for (const meta of fixtures.resources) c.ok(store.unref(meta.id + 100), `synthetic resource ${meta.id + 100} unref`);
  c.ok(renderer.dispose(), "state renderer disposal");
  const finalState = c.ok(renderer.inspect(), "final state inspection");
  for (const [key, value] of Object.entries(finalState.budgets)) c.equal(value, 0, `final state ${key} budget`);
  c.ok(store.dispose(), "resource store disposal");
  c.bad(bindings.resolve(bindingLease), "disposed resource binding capability");
  const finalResources = c.ok(store.inspect(), "final resource inspection").budgets;
  for (const [key, value] of Object.entries(finalResources)) c.equal(value, 0, `final resource ${key} budget`);
  c.equal(tracked.live.size, 0, "no leaked actual GPU resource storage");
  c.equal(gl.getError(), gl.NO_ERROR, "final hardware GL error state");
  return { status: "passed", guestExecution: false, drawReplay: false, assertions: c.assertions,
    summary: { status: "passed", originalSubmissions: 8, originalObjects: 9, objectTypes: 8,
      explicitDrawStops: 3, contexts: "A/B2/A/B1/A", clearPixelsChecked: 6 * 1024,
      surfaceLifetime: "public resource → public object → framebuffer unbind", attacks: c.attacks.length,
      shaders: "original TGSI → verified Wasm bridge → linked hardware WebGL2", zeroGlErrors: true },
    originalResults, lifecycle, originalReflection: firstLogical.sub.programs[0].reflection,
    states: [first.report, stateB.report, orange.report, alpha.report], translations, attacks: c.attacks, faultControls,
    finalStateBudgets: finalState.budgets, finalResourceBudgets: finalResources };
}
