/** Typed VirGL state and bounded indexed draws. See state-README.md and draw-README.md. */
import { decodeSubmission } from "./decoder.mjs";
import { LIMITS as SHADER_LIMITS } from "../virgl-shader/index.mjs";
import { parseConstantDomain, checkFiniteBank, checkIndirectBank, checkLoopBank, checkRadialBank, checkRasterBank } from "./constant-domain.mjs";

export const STATE_PROFILE = "virgl-tiny-state-v1";
export const STATE_LIMITS = Object.freeze({ contexts: 8, subContexts: 16, objects: 256,
  programs: 64, shaderBytes: 1048576, uniformBytes: 65536 });
export const DRAW_PROFILE = "virgl-tiny-indexed-draw-v1";
export const DRAW_LIMITS = Object.freeze({ drawsPerSubmission: 64, indicesPerSubmission: 65536 });
export const ASYNC_PROFILE = "virgl-tiny-async-jobs-v1";
export const JOB_LIMITS = Object.freeze({ jobs: 1, commandsPerStep: 64, submissionBytes: 262144, transferBytes: 4194304 });
const NAMES = ["NULL", "BLEND", "RASTERIZER", "DSA", "SHADER", "VERTEX_ELEMENTS", "SAMPLER_VIEW", "SAMPLER_STATE", "SURFACE"];
const BINDINGS = { 1: "blend", 2: "rasterizer", 3: "dsa", 5: "vertexElements" };
function freeze(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const success = (fields = {}) => freeze({ ok: true, ...fields });
class StateFault extends Error { constructor(code, message) { super(message); this.code = code; } }
function require(condition, code, message) { if (!condition) throw new StateFault(code, message); }
function failure(error, extra = {}, command = null) {
  if (!(error instanceof StateFault)) throw error;
  return freeze({ ok: false, error: { code: error.code, message: error.message,
    byteOffset: command?.byteOffset ?? 0, opcode: command?.opcode ?? null }, ...extra });
}
function result(fn) { try { return fn(); } catch (error) { return failure(error); } }
function uint(value, name) {
  require(Number.isInteger(value) && value >= 1 && value <= 0xffffffff, "invalid-input", `${name} must be a u32.`);
}
function dataRecord(value, keys, required = keys) {
  let entries;
  try {
    require(value !== null && typeof value === "object" && !Array.isArray(value), "invalid-input", "Expected a data record.");
    entries = Object.getOwnPropertyDescriptors(value);
  } catch (error) { if (error instanceof StateFault) throw error; throw new StateFault("invalid-input", "Unusable data record."); }
  const out = {};
  for (const key of Reflect.ownKeys(entries)) {
    require(keys.includes(key) && Object.hasOwn(entries[key], "value"), "invalid-input", "Unknown or accessor property.");
    out[key] = entries[key].value;
  }
  for (const key of required) require(Object.hasOwn(out, key), "invalid-input", `Missing ${key}.`);
  return out;
}
function unwrap(value) {
  require(value?.ok === true, value?.error?.code ?? "backend-error", value?.error?.message ?? "Host operation failed.");
  return value;
}
const ref = (object) => object ? { handle: object.handle, generation: object.generation } : null;

// Reconstruct the interface from checked stage metadata. The guest never supplies
// a compiler key, and physical register order does not identify a varying.
function shaderInterface(vertex, fragment) {
  require(Array.isArray(vertex.outputs) && vertex.outputs.length <= 8 &&
    Array.isArray(fragment.inputs) && fragment.inputs.length <= 8,
  "shader-link-error", "Shader interface exceeds the bounded varying profile.");
  const outputs = new Map(), inputs = new Map(), registers = new Set();
  const generic = (entry) => entry && entry.semantic === "GENERIC" && entry.type === "vec4" &&
    Number.isInteger(entry.index) && entry.index >= 0 && entry.index <= 7 &&
    Number.isInteger(entry.semanticIndex) && entry.semanticIndex >= 0 && entry.semanticIndex <= 7 &&
    entry.name === `vso_g${entry.semanticIndex}` && [3, 7, 15].includes(entry.componentMask);
  for (const output of vertex.outputs) {
    if (output?.semantic !== "GENERIC") continue;
    require(generic(output) && output.interpolation === "smooth" &&
      output.writtenMask === output.componentMask && !outputs.has(output.semanticIndex),
    "shader-link-error", "Vertex varying metadata is incompatible.");
    outputs.set(output.semanticIndex, output);
  }
  for (const input of fragment.inputs) {
    require(generic(input) && ["smooth", "flat"].includes(input.interpolation) &&
      !inputs.has(input.semanticIndex) && !registers.has(input.index),
    "shader-link-error", "Fragment varying metadata is incompatible.");
    const output = outputs.get(input.semanticIndex);
    require(output && (input.componentMask & ~output.writtenMask) === 0,
      "shader-link-error", "Fragment input is not written by the vertex shader.");
    inputs.set(input.semanticIndex, input); registers.add(input.index);
  }
  const ordered = [...inputs.values()].sort((left, right) => left.semanticIndex - right.semanticIndex);
  return { key: `generic-interpolation-v1:${ordered.map((input) =>
    `g${input.semanticIndex}/${input.componentMask}/${input.interpolation}`).join(";")}`,
  flat: ordered.some((input) => input.interpolation === "flat"), inputs };
}

/** The state-only entry point deliberately continues to reject every draw. */
export function createVirglStateRenderer(options) {
  return createRenderer(options, false);
}

/** Execute the bounded indexed draw profile using the same private state engine. */
export function createVirglDrawRenderer(options) {
  return createRenderer(options, true);
}

/** Owned jobs; the caller pumps step from later browser tasks. */
export function createVirglAsyncRenderer(options) {
  return createRenderer(options, true, true);
}

/** Host capabilities are trusted and non-reentrant. */
function createRenderer(options, drawing, asynchronous = false) {
  return result(() => {
    const config = dataRecord(options, ["gl", "resources", "bindings", "shaderBridge", "limits", ...(drawing ? ["drawLimits"] : []), ...(asynchronous ? ["asyncAccess", "jobLimits"] : [])], ["gl", "resources", "bindings", "shaderBridge", ...(asynchronous ? ["asyncAccess"] : [])]);
    const { gl, resources, bindings, shaderBridge } = config;
    require(gl && typeof gl.createVertexArray === "function" && typeof gl.uniform4uiv === "function", "invalid-input", "A WebGL2 context is required.");
    require(resources && ["inspect", "retainStorage", "releaseStorage", "prepareTransfer", "executeTransfer"].every((name) => typeof resources[name] === "function") &&
      bindings && typeof bindings.resolve === "function" && shaderBridge && typeof shaderBridge.translate === "function", "invalid-input", "Resource and shader capabilities are required.");
    require(!drawing || typeof resources.readStorage === "function", "invalid-input", "Drawing requires actual storage readback.");
    const supplied = dataRecord(config.limits ?? {}, Object.keys(STATE_LIMITS), []), limits = { ...STATE_LIMITS, ...supplied };
    for (const key of Object.keys(limits)) require(Number.isSafeInteger(limits[key]) && limits[key] >= 0 && limits[key] <= STATE_LIMITS[key], "invalid-input", "Limits may only tighten defaults.");
    Object.freeze(limits);
    let drawLimits = null;
    if (drawing) {
      const suppliedDraw = dataRecord(config.drawLimits ?? {}, Object.keys(DRAW_LIMITS), []);
      drawLimits = { ...DRAW_LIMITS, ...suppliedDraw };
      for (const key of Object.keys(drawLimits)) require(Number.isSafeInteger(drawLimits[key]) && drawLimits[key] >= 0 && drawLimits[key] <= DRAW_LIMITS[key],
        "invalid-input", "Draw limits may only tighten defaults.");
      Object.freeze(drawLimits);
    }
    const asyncAccess = config.asyncAccess;
    let jobLimits = null, activeJob = null;
    if (asynchronous) {
      require(asyncAccess && ["prepareTransfer", "validate", "provideInput", "upload", "beginTransferRead", "beginStorageRead", "poll", "release", "inspect"]
        .every((name) => typeof asyncAccess[name] === "function"), "invalid-input", "Asynchronous resource access is required.");
      jobLimits = { ...JOB_LIMITS, ...dataRecord(config.jobLimits ?? {}, Object.keys(JOB_LIMITS), []) };
      for (const key of Object.keys(jobLimits)) require(Number.isSafeInteger(jobLimits[key]) && jobLimits[key] >= (key === "commandsPerStep" ? 1 : 0) && jobLimits[key] <= JOB_LIMITS[key],
        "invalid-input", "Job limits may only tighten defaults; step budget must be positive.");
      Object.freeze(jobLimits);
    }
    const profile = asynchronous ? ASYNC_PROFILE : drawing ? DRAW_PROFILE : STATE_PROFILE;
    const idle = () => require(activeJob === null, "busy", "A renderer job is active; cancel and drain it before changing state.");
    const contexts = new Map(), objects = new Set(), programs = new Set();
    let disposed = false, nextGeneration = 1, subCount = 0, shaderBytes = 0, uniformBytes = 0, leaseCount = 0;
    const check = () => {
      require(!gl.isContextLost(), "backend-error", "WebGL context is lost.");
      const error = gl.getError(); require(error === gl.NO_ERROR, "backend-error", `WebGL error ${error}.`);
    };
    check();
    const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    const maxUnits = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
    const stageSlots = [Math.min(16, gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)), Math.min(16, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))];
    const maxViewport = [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)];
    const uniformBindings = gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS);
    const hostUniformComponents = [gl.getParameter(gl.MAX_VERTEX_UNIFORM_COMPONENTS), gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_COMPONENTS)];
    check();
    require(maxUnits >= 32 && maxAttributes >= 2 && uniformBindings >= 1, "unsupported-host", "WebGL limits do not support the state profile.");
    require(hostUniformComponents.every((count) => Number.isSafeInteger(count) && count > 0),
      "unsupported-host", "WebGL stage uniform component limits must be positive integers.");
    Object.freeze(hostUniformComponents);
    const generation = () => { require(nextGeneration < Number.MAX_SAFE_INTEGER, "limit-exceeded", "Generation space exhausted."); return nextGeneration++; };
    const alive = () => require(!disposed, "disposed", "State renderer is disposed.");
    const resourceContext = (id) => {
      const snapshot = unwrap(resources.inspect());
      require(!snapshot.disposed, "stale-context", "Resource store is disposed.");
      const ctx = snapshot.contexts.find((entry) => entry.id === id);
      require(ctx, "missing-context", "Resource context does not exist."); return ctx;
    };
    const context = (id) => {
      alive(); uint(id, "contextId");
      const ctx = contexts.get(id); require(ctx, "missing-context", "State context does not exist.");
      require(resourceContext(id).generation === ctx.resourceContextGeneration, "stale-context", "Resource context generation changed."); return ctx;
    };
    const resolve = (lease) => unwrap(bindings.resolve(lease));
    const release = (lease) => {
      const released = resources.releaseStorage(lease);
      // Store disposal already releases every lease. Still collect our own GL
      // objects when the host shuts the two independent owners down in this order.
      if (!released.ok) require(released.error?.code === "disposed" && unwrap(resources.inspect()).disposed === true,
        released.error?.code ?? "invalid-lease", released.error?.message ?? "Storage lease release failed.");
      leaseCount--;
    };
    const retain = (ctx, id, role, kind) => {
      const lease = unwrap(resources.retainStorage(ctx.id, id, role)).lease;
      try {
        const binding = resolve(lease);
        require(binding.metadata.kind === kind, "incompatible-resource", `Expected ${kind} storage.`);
        leaseCount++; return { lease, metadata: binding.metadata, resourceGeneration: binding.generation };
      } catch (error) { unwrap(resources.releaseStorage(lease)); throw error; }
    };
    const lookup = (sub, handle, type, optional = false) => {
      if (handle === 0 && optional) return null;
      const object = sub.names.get(handle);
      require(object, "missing-object", `Object ${handle} is not public in this subcontext.`);
      require(object.type === type, "wrong-object-type", `Object ${handle} is not ${NAMES[type]}.`); return object;
    };
    const createSub = (id) => {
      require(subCount < limits.subContexts, "limit-exceeded", "Subcontext limit exceeded.");
      let vao = null, framebuffer = null;
      try {
        vao = gl.createVertexArray(); framebuffer = gl.createFramebuffer();
        require(vao && framebuffer, "backend-error", "Subcontext helper allocation failed."); check();
        const sub = { id, generation: generation(), names: new Map(), live: new Set(), programs: new Map(), vao, framebuffer,
          blend: null, rasterizer: null, dsa: null, vertexElements: null, shaders: [null, null], surfaces: [],
          vertexBuffers: [], indexBuffer: null, views: [Array(32).fill(null), Array(32).fill(null)],
          samplers: [Array(32).fill(null), Array(32).fill(null)], constants: [[], []], viewport: null,
          blendColor: [0, 0, 0, 0], stencilRef: { front: 0, back: 0 }, defaults: { width: 0, height: 0 }, resets: {} };
        subCount++; return sub;
      } catch (error) { if (vao) gl.deleteVertexArray(vao); if (framebuffer) gl.deleteFramebuffer(framebuffer); throw error; }
    };
    const deleteProgram = (sub, program) => {
      sub.programs.delete(program.key); programs.delete(program);
      if (gl.getParameter(gl.CURRENT_PROGRAM) === program.native) gl.useProgram(null);
      gl.deleteProgram(program.native);
      if (program.variantShader) gl.deleteShader(program.variantShader);
      shaderBytes -= program.variantBytes;
      for (const block of program.blocks) { gl.deleteBuffer(block.buffer); uniformBytes -= block.byteLength; }
    };
    const collectObject = (sub, object) => {
      if (object.references !== 0) return;
      sub.live.delete(object); objects.delete(object);
      if (object.lease) release(object.lease);
      if (object.shader) {
        for (const program of [...sub.programs.values()]) if (program.vertex === object || program.fragment === object) deleteProgram(sub, program);
        gl.deleteShader(object.shader); shaderBytes -= object.shaderBytes;
      }
      if (object.sampler) gl.deleteSampler(object.sampler);
    };
    const objectRef = (sub, old, value) => {
      if (old === value) return value;
      if (value) value.references++;
      if (old) { old.references--; collectObject(sub, old); }
      return value;
    };
    function destroyObject(sub, object) {
      sub.names.delete(object.handle); object.public = false;
      if (object.type === 7) {
        // Pinned sampler-state destruction compacts the later slots after each match.
        for (let stage = 0; stage < 2; stage++) {
          const remaining = sub.samplers[stage].filter((value) => value !== object);
          sub.samplers[stage] = remaining.concat(Array(32 - remaining.length).fill(null));
        }
      } else if ([3, 5].includes(object.type) && sub[BINDINGS[object.type]] === object) sub[BINDINGS[object.type]] = null;
      // Surfaces, views and shader selectors retain independent binding references.
      object.references--; collectObject(sub, object);
    }
    const disposeSub = (sub) => {
      for (const program of [...sub.programs.values()]) deleteProgram(sub, program);
      for (const surface of sub.surfaces) objectRef(sub, surface, null);
      sub.surfaces = [];
      for (const slots of sub.views) for (let slot = 0; slot < slots.length; slot++) slots[slot] = objectRef(sub, slots[slot], null);
      for (let stage = 0; stage < 2; stage++) sub.shaders[stage] = objectRef(sub, sub.shaders[stage], null);
      for (const buffer of sub.vertexBuffers) if (buffer) release(buffer.lease);
      if (sub.indexBuffer) release(sub.indexBuffer.lease);
      for (const object of [...sub.names.values()]) destroyObject(sub, object);
      gl.deleteVertexArray(sub.vao); gl.deleteFramebuffer(sub.framebuffer); subCount--;
    };
    const createObject = (ctx, sub, command) => {
      const fields = command.fields, type = command.objectType;
      require(!sub.names.has(fields.handle), "duplicate-object", "Object handle is already public.");
      require(objects.size < limits.objects, "limit-exceeded", "Live object limit exceeded.");
      const object = { handle: fields.handle, type, name: command.objectName, generation: generation(), fields, public: true, references: 1 };
      try {
        if (type === 2) require(!fields.scissor, "unsupported-feature", "Active scissor rasterization is unsupported.");
        if (type === 5) {
          require(fields.elements.length <= maxAttributes, "limit-exceeded", "Vertex elements exceed host attribute slots.");
          for (const element of fields.elements) require(element.sourceOffset % 4 === 0, "invalid-state", "Vertex element offset must be float-aligned.");
        }
        if (type === 6 || type === 8) {
          if (type === 6) require(fields.swizzle.every((component, index) => component === index), "unsupported-feature", "Only identity sampler swizzles are supported.");
          Object.assign(object, retain(ctx, fields.resourceHandle, type === 6 ? "view" : "surface", "texture"));
          require(object.metadata.format === fields.format, "incompatible-resource", "View format and storage format differ.");
        }
        if (type === 4) {
          const translated = unwrap(shaderBridge.translate({ stage: fields.stageName, text: fields.text }));
          const contract = unwrap(parseConstantDomain(translated.metadata, fields.stageName));
          object.constantDomain = contract.domain;
          object.constantAccess = contract.access ?? null;
          object.constantConstraint = contract.constraint ?? null;
          object.constantRadialDomain = contract.radialDomain ?? null;
          object.constantRasterDomain = contract.rasterDomain ?? null;
          require(typeof translated.glsl === "string" && /^#version 300 es\b/m.test(translated.glsl), "shader-error", "Shader bridge returned incompatible output.");
          object.shaderBytes = fields.text.length + translated.glsl.length;
          require(object.shaderBytes <= limits.shaderBytes - shaderBytes, "limit-exceeded", "Shader storage budget exceeded.");
          object.shader = gl.createShader(fields.stage === 0 ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
          require(object.shader, "backend-error", "Shader allocation failed.");
          gl.shaderSource(object.shader, translated.glsl); gl.compileShader(object.shader);
          require(gl.getShaderParameter(object.shader, gl.COMPILE_STATUS), "shader-error", `WebGL shader compilation failed: ${gl.getShaderInfoLog(object.shader)}`);
          object.translation = freeze(translated);
        }
        if (type === 7) {
          object.sampler = gl.createSampler(); require(object.sampler, "backend-error", "Sampler allocation failed.");
          gl.samplerParameteri(object.sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_WRAP_R, fields.wrapR === 0 ? gl.REPEAT : gl.CLAMP_TO_EDGE);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_MIN_FILTER, fields.minImageFilter === 0 ? gl.NEAREST : gl.LINEAR);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_MAG_FILTER, fields.magImageFilter === 0 ? gl.NEAREST : gl.LINEAR);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_COMPARE_MODE, gl.NONE);
          gl.samplerParameterf(object.sampler, gl.TEXTURE_MIN_LOD, fields.minLod);
          gl.samplerParameterf(object.sampler, gl.TEXTURE_MAX_LOD, fields.maxLod);
        }
        check();
        if (object.shader) shaderBytes += object.shaderBytes;
        sub.names.set(object.handle, object); sub.live.add(object); objects.add(object);
      } catch (error) {
        if (object.lease) release(object.lease);
        if (object.shader) gl.deleteShader(object.shader);
        if (object.sampler) gl.deleteSampler(object.sampler);
        throw error;
      }
    };
    const unitFor = (stage, index) => stage === 1 ? index : 16 + index;
    function link(sub, vertex, fragment) {
      require(vertex?.fields.stage === 0 && fragment?.fields.stage === 1, "missing-shader", "Link requires a vertex shader and a fragment shader.");
      // A successfully checked selector is immutable. Repeated restoration can
      // reuse its canonical key without rebuilding the varying maps each time.
      if (fragment.interfaceKey !== undefined) {
        const cached = sub.programs.get(`${vertex.generation}:${fragment.generation}:${fragment.interfaceKey}`);
        if (cached) return cached;
      }
      let vs = vertex.translation.metadata;
      const fs = fragment.translation.metadata, interfaceInfo = shaderInterface(vs, fs);
      const key = `${vertex.generation}:${fragment.generation}:${interfaceInfo.key}`;
      require(programs.size < limits.programs, "limit-exceeded", "Linked program limit exceeded.");
      const program = { key, vertex, fragment, native: null, blocks: [], uniforms: [], samplers: [],
        interfaceKey: interfaceInfo.key, variantShader: null, variantBytes: 0,
        reflection: { attributes: [], uniforms: [], samplers: [], uniformBlocks: [], outputs: [] } };
      try {
        if (interfaceInfo.flat) {
          require(typeof shaderBridge.translatePair === "function", "shader-link-error", "Flat interpolation requires the checked pair compiler.");
          const pair = unwrap(shaderBridge.translatePair({ vertexText: vertex.fields.text, fragmentText: fragment.fields.text }));
          const expectedVertex = { ...vs, outputs: vs.outputs.map((output) => output.semantic === "GENERIC" ?
            { ...output, interpolation: interfaceInfo.inputs.get(output.semanticIndex)?.interpolation ?? "smooth" } : output) };
          require(pair.interfaceKey === interfaceInfo.key &&
            pair.fragment?.glsl === fragment.translation.glsl && JSON.stringify(pair.fragment?.metadata) === JSON.stringify(fs) &&
            typeof pair.vertex?.glsl === "string" && pair.vertex.glsl.length <= SHADER_LIMITS.glslBytes &&
            /^#version 300 es\b/m.test(pair.vertex.glsl) && JSON.stringify(pair.vertex.metadata) === JSON.stringify(expectedVertex),
          "shader-link-error", "Pair compiler output does not match the selected shader interface.");
          require(pair.vertex.glsl.length <= limits.shaderBytes - shaderBytes, "limit-exceeded", "Vertex variant storage budget exceeded.");
          program.variantBytes = pair.vertex.glsl.length; shaderBytes += program.variantBytes;
          program.variantShader = gl.createShader(gl.VERTEX_SHADER);
          require(program.variantShader, "backend-error", "Vertex variant allocation failed.");
          gl.shaderSource(program.variantShader, pair.vertex.glsl); gl.compileShader(program.variantShader);
          require(gl.getShaderParameter(program.variantShader, gl.COMPILE_STATUS), "shader-error",
            `WebGL vertex variant compilation failed: ${gl.getShaderInfoLog(program.variantShader)}`);
          vs = pair.vertex.metadata;
        }
        program.native = gl.createProgram(); require(program.native, "backend-error", "Program allocation failed.");
        gl.attachShader(program.native, program.variantShader ?? vertex.shader); gl.attachShader(program.native, fragment.shader);
        gl.linkProgram(program.native);
        require(gl.getProgramParameter(program.native, gl.LINK_STATUS), "shader-link-error", `WebGL program link failed: ${gl.getProgramInfoLog(program.native)}`);
        for (let index = 0; index < gl.getProgramParameter(program.native, gl.ACTIVE_ATTRIBUTES); index++) {
          const actual = gl.getActiveAttrib(program.native, index), declared = vs.attributes.find((attribute) => attribute.name === actual.name);
          require(declared && actual.type === gl.FLOAT_VEC4 && actual.size === 1 && declared.index < maxAttributes, "shader-reflection-error", "Unknown active vertex attribute.");
          const location = gl.getAttribLocation(program.native, actual.name);
          require(location >= 0, "shader-reflection-error", "Missing vertex attribute location.");
          program.reflection.attributes.push({ ...declared, location, type: actual.type });
        }
        for (const [stage, metadata] of [[0, vs], [1, fs]]) {
          for (const uniform of metadata.uniforms) {
            require(uniform.type === "uvec4[]" && uniform.encoding === "float32-bits" && Number.isInteger(uniform.count) && uniform.count > 0 && uniform.count <= 47,
              "shader-reflection-error", "Unsupported uniform metadata.");
            const name = `${uniform.name}[0]`, location = gl.getUniformLocation(program.native, name);
            const index = gl.getUniformIndices(program.native, [name])?.[0];
            let activeCount = 0;
            if (location !== null || index !== gl.INVALID_INDEX) {
              require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
                gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === gl.UNSIGNED_INT_VEC4,
              "shader-reflection-error", "Constant reflection mismatch.");
              activeCount = gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0];
              require(Number.isInteger(activeCount) && activeCount > 0 && activeCount <= uniform.count &&
                activeCount * 4 <= hostUniformComponents[stage], "shader-reflection-error", "Constant extent exceeds its declaration or host stage limit.");
            }
            // The upstream declaration can include an unaddressable 47th element.
            // Driver-retained suffixes are not permission to upload guest CONST46.
            const uploadCount = Math.min(activeCount, 46);
            const access = (stage === 0 ? vertex : fragment).constantAccess;
            require(!access || uploadCount > access.indices[access.indices.length - 1],
              "shader-reflection-error", "Constant upload extent does not cover every proved indirect index.");
            if (uploadCount) program.uniforms.push({ stage, uploadCount, location,
              conditional: (stage === 0 ? vertex : fragment).constantDomain !== null });
            program.reflection.uniforms.push({ ...uniform, name, stage: metadata.stage, activeCount, uploadCount });
          }
          for (const sampler of metadata.samplers) {
            require(sampler.type === "sampler2D" && sampler.index < stageSlots[stage], "shader-reflection-error", "Sampler exceeds supported host stage slots.");
            const location = gl.getUniformLocation(program.native, sampler.name), index = gl.getUniformIndices(program.native, [sampler.name])?.[0];
            require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === gl.SAMPLER_2D &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1, "shader-reflection-error", "Sampler reflection mismatch.");
            const unit = unitFor(stage, sampler.index);
            program.samplers.push({ location, unit, stage, index: sampler.index }); program.reflection.samplers.push({ ...sampler, stage: metadata.stage, unit });
          }
          for (const block of metadata.uniformBlocks ?? []) {
            const index = gl.getUniformBlockIndex(program.native, block.name);
            require(index !== gl.INVALID_INDEX && gl.getActiveUniformBlockParameter(program.native, index, gl.UNIFORM_BLOCK_DATA_SIZE) === block.byteLength &&
              block.byteLength === 656 && block.name === "VirglBlock" && program.blocks.length === 0,
            "shader-reflection-error", "System block reflection mismatch.");
            require(block.byteLength <= limits.uniformBytes - uniformBytes, "limit-exceeded", "System uniform storage budget exceeded.");
            const data = new Uint8Array(block.byteLength), members = [];
            for (const member of block.members) {
              require(member.name === "winsys_adjust_y" && member.type === "float" && member.default === 1 && member.offset === 640,
                "shader-reflection-error", "Unsupported system uniform metadata.");
              let uniformIndex = gl.INVALID_INDEX;
              for (const name of [member.name, `${block.name}.${member.name}`]) {
                const candidate = gl.getUniformIndices(program.native, [name])?.[0];
                if (candidate !== undefined && candidate !== gl.INVALID_INDEX) { uniformIndex = candidate; break; }
              }
              require(uniformIndex !== gl.INVALID_INDEX && gl.getActiveUniforms(program.native, [uniformIndex], gl.UNIFORM_OFFSET)[0] === member.offset &&
                gl.getActiveUniforms(program.native, [uniformIndex], gl.UNIFORM_TYPE)[0] === gl.FLOAT, "shader-reflection-error", "System member reflection mismatch.");
              new DataView(data.buffer).setFloat32(member.offset, 1, true);
              members.push({ name: member.name, offset: member.offset, type: gl.FLOAT, value: 1 });
            }
            require(members.length === 1, "shader-reflection-error", "Missing coordinate-system uniform.");
            const buffer = gl.createBuffer(); require(buffer, "backend-error", "System uniform buffer allocation failed.");
            program.blocks.push({ buffer, byteLength: block.byteLength, data, index }); uniformBytes += block.byteLength;
            gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferData(gl.UNIFORM_BUFFER, data, gl.STATIC_DRAW);
            gl.uniformBlockBinding(program.native, index, 0);
            program.reflection.uniformBlocks.push({ name: block.name, index, byteLength: block.byteLength, binding: 0, members });
          }
        }
        require(program.blocks.length === 1 && gl.getProgramParameter(program.native, gl.ACTIVE_UNIFORM_BLOCKS) === 1,
          "shader-reflection-error", "Every active block must match the system block.");
        for (const output of fs.outputs) {
          const location = gl.getFragDataLocation(program.native, output.name);
          require(output.semantic === "COLOR" && location === 0, "shader-reflection-error", "Unsupported fragment output.");
          program.reflection.outputs.push({ ...output, location });
        }
        check(); freeze(program.reflection); sub.programs.set(key, program); programs.add(program);
        fragment.interfaceKey = interfaceInfo.key; return program;
      } catch (error) {
        if (program.native) gl.deleteProgram(program.native);
        if (program.variantShader) gl.deleteShader(program.variantShader);
        shaderBytes -= program.variantBytes;
        for (const block of program.blocks) { gl.deleteBuffer(block.buffer); uniformBytes -= block.byteLength; }
        throw error;
      }
    }
    const selectedProgram = (sub) => sub.shaders.every(Boolean) ? link(sub, sub.shaders[0], sub.shaders[1]) : null;
    const vertexLayout = (sub, elements = sub.vertexElements, buffers = sub.vertexBuffers) => {
      if (!elements) return;
      for (const element of elements.fields.elements) {
        const buffer = buffers[element.vertexBufferIndex]; if (!buffer) continue;
        require(buffer.fields.stride <= 255 && buffer.fields.stride % 4 === 0 && buffer.fields.offset % 4 === 0,
          "invalid-state", "Vertex buffer stride/offset is not supported by WebGL.");
        require(buffer.fields.offset <= buffer.metadata.byteLength && element.sourceOffset <= buffer.metadata.byteLength - buffer.fields.offset &&
          8 <= buffer.metadata.byteLength - buffer.fields.offset - element.sourceOffset, "out-of-bounds", "Vertex element exceeds storage.");
      }
    };
    const colorMask = (sub) => {
      const bits = sub.blend?.fields.renderTargets[0].colorMask ?? 15;
      return [1, 2, 4, 8].map((bit) => Boolean(bits & bit));
    };
    // Restoration also follows SET, CLEAR, binding changes and restoreContext.
    // A partial/invalid conditional or indirect bank remains CPU state but is never uploaded.
    const constantUploads = (program, banks, strict, approvedBanks = null) => Object.freeze((program?.uniforms ?? []).flatMap((uniform) => {
      const bank = banks[uniform.stage], count = uniform.uploadCount * 4;
      const shader = uniform.stage === 0 ? program.vertex : program.fragment;
      let words;
      if (shader.constantRasterDomain || shader.constantRadialDomain || shader.constantAccess) {
        const checked = approvedBanks?.[uniform.stage] ?? (shader.constantRasterDomain ?
          checkRasterBank(bank, shader.constantRasterDomain, shader.constantConstraint !== null, shader.constantRadialDomain !== null) : shader.constantRadialDomain ?
          checkRadialBank(bank, shader.constantRadialDomain.count, shader.constantConstraint !== null) : shader.constantConstraint ?
          checkLoopBank(bank, shader.constantConstraint.count) : checkIndirectBank(bank, shader.constantAccess.count, uniform.conditional));
        if (!checked.ok && !strict) return [];
        words = Object.freeze(unwrap(checked).words.slice(0, count));
      } else if (uniform.conditional) {
        const checked = checkFiniteBank(bank, uniform.uploadCount);
        if (!checked.ok && !strict) return [];
        words = unwrap(checked).words;
      } else {
        if (strict) require(bank.length >= count, "incomplete-draw", "Drawing requires every active constant word.");
        words = Object.freeze(Array.from({ length: count }, (_, index) => bank[index] ?? 0));
      }
      return [Object.freeze({ uniform, words })];
    }));
    const validateDrawPlan = (plan) => {
      const { ctx, sub, program, shaders, banks } = plan;
      require(context(ctx.id) === ctx && ctx.subs.get(sub.id) === sub && ctx.current === sub.id,
        "stale-context", "Draw context or subcontext identity changed.");
      require(sub.shaders.every((shader, stage) => shader === shaders[stage]) &&
        sub.programs.get(program.key) === program && programs.has(program) &&
        sub.constants.every((bank, stage) => bank === banks[stage]),
      "stale-draw", "Draw shader, program or constant-bank identity changed.");
    };
    const restore = (sub, plan = null) => {
      check(); vertexLayout(sub);
      if (plan) validateDrawPlan(plan);
      const program = plan ? plan.program : selectedProgram(sub);
      const uploads = plan ? plan.uploads : constantUploads(program, sub.constants, false);
      gl.bindVertexArray(sub.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sub.framebuffer);
      const surface = sub.surfaces[0] ?? null;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, surface ? resolve(surface.lease).storage.texture : null, 0);
      gl.drawBuffers([surface ? gl.COLOR_ATTACHMENT0 : gl.NONE]); gl.readBuffer(surface ? gl.COLOR_ATTACHMENT0 : gl.NONE);
      if (surface) require(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "incomplete-framebuffer", "Framebuffer is incomplete.");
      gl.useProgram(program?.native ?? null);
      for (let slot = 0; slot < maxAttributes; slot++) {
        gl.disableVertexAttribArray(slot); gl.vertexAttribDivisor(slot, 0); gl.vertexAttrib4f(slot, 0, 0, 0, 1);
      }
      if (sub.vertexElements) for (const attribute of program?.reflection.attributes ?? []) {
        const element = sub.vertexElements.fields.elements[attribute.index], buffer = element ? sub.vertexBuffers[element.vertexBufferIndex] : null;
        if (!buffer) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, resolve(buffer.lease).storage.buffer);
        gl.vertexAttribPointer(attribute.location, 2, gl.FLOAT, false, buffer.fields.stride, buffer.fields.offset + element.sourceOffset);
        gl.enableVertexAttribArray(attribute.location);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sub.indexBuffer ? resolve(sub.indexBuffer.lease).storage.buffer : null);
      for (let unit = 0; unit < maxUnits; unit++) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null); gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
        gl.bindTexture(gl.TEXTURE_3D, null); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null); gl.bindSampler(unit, null);
      }
      for (let stage = 0; stage < 2; stage++) for (let slot = 0; slot < stageSlots[stage]; slot++) {
        const view = sub.views[stage][slot], sampler = sub.samplers[stage][slot], unit = unitFor(stage, slot);
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, view ? resolve(view.lease).storage.texture : null);
        gl.bindSampler(unit, sampler?.sampler ?? null);
      }
      gl.activeTexture(gl.TEXTURE0);
      for (let slot = 0; slot < uniformBindings; slot++) gl.bindBufferBase(gl.UNIFORM_BUFFER, slot, null);
      if (program) {
        for (const block of program.blocks) {
          gl.bindBuffer(gl.UNIFORM_BUFFER, block.buffer); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, block.data);
          gl.uniformBlockBinding(program.native, block.index, 0); gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, block.buffer);
        }
        for (const upload of uploads) {
          const uniform = upload.uniform, words = new Uint32Array(upload.words);
          gl.uniform4uiv(uniform.location, words);
        }
        for (const sampler of program.samplers) gl.uniform1i(sampler.location, sampler.unit);
      }
      gl.bindBuffer(gl.UNIFORM_BUFFER, null);
      for (const target of [gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, gl.PIXEL_PACK_BUFFER, gl.PIXEL_UNPACK_BUFFER]) gl.bindBuffer(target, null);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (const pname of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS, gl.UNPACK_ROW_LENGTH,
        gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) gl.pixelStorei(pname, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      for (const cap of [gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.RASTERIZER_DISCARD, gl.POLYGON_OFFSET_FILL,
        gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) gl.disable(cap);
      gl.depthMask(false); gl.depthFunc(gl.NEVER); gl.clearDepth(1); gl.clearStencil(0);
      gl.stencilMaskSeparate(gl.FRONT, 0); gl.stencilMaskSeparate(gl.BACK, 0);
      gl.stencilFuncSeparate(gl.FRONT, gl.NEVER, sub.stencilRef.front, 0);
      gl.stencilFuncSeparate(gl.BACK, gl.NEVER, sub.stencilRef.back, 0);
      gl.stencilOpSeparate(gl.FRONT_AND_BACK, gl.KEEP, gl.KEEP, gl.KEEP);
      gl.polygonOffset(0, 0); gl.lineWidth(1); gl.sampleCoverage(1, false);
      const rasterizer = sub.rasterizer?.fields;
      if (rasterizer?.cullFace === 2) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      // All supported resource flags are zero: pinned lower-left FBOs invert
      // Gallium front_ccw (vrend_update_frontface_state).
      gl.cullFace(gl.BACK); gl.frontFace(rasterizer?.frontCcw ? gl.CW : gl.CCW);
      const blend = sub.blend?.fields, target = blend?.renderTargets[0];
      if (blend?.dither) gl.enable(gl.DITHER); else gl.disable(gl.DITHER);
      if (target?.blendEnable) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
      gl.blendFuncSeparate(target?.blendEnable ? (target.rgbSourceFactor === 3 ? gl.SRC_ALPHA : gl.ONE) : gl.ONE,
        target?.blendEnable ? gl.ONE_MINUS_SRC_ALPHA : gl.ZERO, gl.ONE, target?.blendEnable ? gl.ONE_MINUS_SRC_ALPHA : gl.ZERO);
      gl.blendColor(...sub.blendColor);
      const mask = colorMask(sub);
      gl.colorMask(...mask);
      if (sub.viewport) {
        const { scale, translate } = sub.viewport;
        gl.viewport(translate[0] - scale[0], translate[1] - scale[1], scale[0] * 2, scale[1] * 2);
        gl.depthRange(translate[2] - scale[2], translate[2] + scale[2]);
      } else { gl.viewport(0, 0, 0, 0); gl.depthRange(0, 1); }
      check();
    };
    const prepareDraw = (ctx, sub, command, submission) => {
      const fields = command.fields;
      require(fields.indexed && fields.start === 0 && fields.count > 0,
        "unsupported-draw", "Only nonempty indexed draws with start zero are supported.");
      require(submission.draws.length < drawLimits.drawsPerSubmission && fields.count <= drawLimits.indicesPerSubmission - submission.indices,
        "limit-exceeded", "Submission draw or index budget exceeded.");
      require(sub.shaders.every(Boolean), "incomplete-draw", "Drawing requires both shader stages.");
      require(sub.surfaces[0] && sub.viewport && sub.vertexElements && sub.indexBuffer,
        "incomplete-draw", "Drawing requires a surface, viewport, vertex elements and index buffer.");
      const banks = Object.freeze([...sub.constants]), shaders = Object.freeze([...sub.shaders]);
      // Presence and numeric authority apply to the complete declared prefix,
      // even if reflection prunes it. Reject before linking or any draw allocation.
      const approvedBanks = Object.freeze(shaders.map((shader, stage) => shader.constantRasterDomain ?
        unwrap(checkRasterBank(banks[stage], shader.constantRasterDomain, shader.constantConstraint !== null, shader.constantRadialDomain !== null)) : shader.constantRadialDomain ?
        unwrap(checkRadialBank(banks[stage], shader.constantRadialDomain.count, shader.constantConstraint !== null)) : shader.constantAccess ?
        unwrap(shader.constantConstraint ? checkLoopBank(banks[stage], shader.constantConstraint.count) :
          checkIndirectBank(banks[stage], shader.constantAccess.count, shader.constantDomain !== null)) : null));
      const program = selectedProgram(sub), surface = resolve(sub.surfaces[0].lease);
      const uploads = constantUploads(program, banks, true, approvedBanks);
      for (const sampler of program.samplers) {
        const view = sub.views[sampler.stage][sampler.index], state = sub.samplers[sampler.stage][sampler.index];
        require(view && state, "incomplete-draw", "Drawing requires an active sampler view and sampler state.");
        require(resolve(view.lease).storage.texture !== surface.storage.texture,
          "framebuffer-feedback", "A draw cannot sample its own framebuffer texture.");
      }
      const attributes = program.reflection.attributes.map((attribute) => {
        const element = sub.vertexElements.fields.elements[attribute.index];
        const buffer = element ? sub.vertexBuffers[element.vertexBufferIndex] : null;
        require(buffer, "incomplete-draw", "Drawing requires each active vertex attribute buffer.");
        require(buffer.fields.stride !== 0, "unsupported-draw", "Gallium constant attributes with stride zero are unsupported.");
        resolve(buffer.lease);
        return { attribute, element, buffer };
      });
      vertexLayout(sub);
      const index = sub.indexBuffer, indexStorage = resolve(index.lease), indexOffset = index.fields.offset;
      // Pinned indexed draws use the index-binding byte offset; DRAW.start is not
      // added to it. Subtraction proves the range before multiplying or reading.
      require(fields.count <= Math.floor((indexStorage.metadata.byteLength - indexOffset) / 2),
        "out-of-bounds", "Index draw range exceeds retained storage.");
      const indexByteLength = fields.count * 2;
      return Object.freeze({ ctx, sub, command, fields, surface, attributes, index, indexStorage, indexOffset, indexByteLength,
        program, shaders, banks, uploads });
    };
    const issueDraw = (plan, bytes, submission) => {
      const { ctx, sub, command, fields, surface, attributes, indexStorage, indexOffset, indexByteLength } = plan;
      const indices = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let actualMinIndex = 65535, actualMaxIndex = 0;
      for (let offset = 0; offset < indexByteLength; offset += 2) {
        const value = indices.getUint16(offset, true);
        // WebGL2's fixed primitive restart is always enabled. The wire profile
        // disables restart, so accepting ushort 0xffff would change semantics.
        require(value !== 65535, "unsupported-draw", "Index 0xffff requires unsupported primitive-restart lowering.");
        actualMinIndex = Math.min(actualMinIndex, value); actualMaxIndex = Math.max(actualMaxIndex, value);
      }
      const vertexFetches = attributes.map(({ attribute, element, buffer }) => {
        const offset = buffer.fields.offset + element.sourceOffset, stride = buffer.fields.stride;
        // vertexLayout proved that the first complete RG32 element fits. Bound
        // the largest actual fetch with division, independent of wire hints.
        require(actualMaxIndex <= Math.floor((buffer.metadata.byteLength - offset - 8) / stride),
          "out-of-bounds", "An actual index fetch exceeds vertex storage.");
        return { attributeIndex: attribute.index, location: attribute.location,
          resourceId: buffer.metadata.id, resourceGeneration: buffer.resourceGeneration,
          stride, offset, firstByte: offset + actualMinIndex * stride, requiredEnd: offset + actualMaxIndex * stride + 8 };
      });
      // readStorage changes copy/pixel bindings. Restore every supported binding
      // after its synchronous GPU read, immediately before issuing the real draw.
      restore(sub, plan);
      gl.drawElements(gl.TRIANGLES, fields.count, gl.UNSIGNED_SHORT, indexOffset);
      check();
      submission.indices += fields.count;
      submission.draws.push({ byteOffset: command.byteOffset, opcode: 8, count: fields.count,
        indexOffset, indexByteLength, actualMinIndex, actualMaxIndex,
        contextId: ctx.id, contextGeneration: ctx.generation, subContextId: sub.id, subContextGeneration: sub.generation,
        indexResourceId: indexStorage.metadata.id, indexResourceGeneration: indexStorage.generation,
        vertexFetches, framebuffer: { resourceId: surface.metadata.id, resourceGeneration: surface.generation,
          width: surface.metadata.width, height: surface.metadata.height },
        vertexShader: ref(sub.shaders[0]), fragmentShader: ref(sub.shaders[1]) });
    };
    const draw = (ctx, sub, command, submission) => {
      const plan = prepareDraw(ctx, sub, command, submission);
      const bytes = unwrap(resources.readStorage(plan.index.lease,
        { x: plan.indexOffset, y: 0, z: 0, width: plan.indexByteLength, height: 1, depth: 1 })).bytes;
      issueDraw(plan, bytes, submission);
    };
    const apply = (ctx, command, submission) => {
      const fields = command.fields, sub = ctx.subs.get(ctx.current), op = command.opcode;
      switch (op) {
        case 1: createObject(ctx, sub, command); break;
        case 2: {
          const object = lookup(sub, fields.handle, command.objectType, true), binding = BINDINGS[command.objectType];
          if (command.objectType === 5) vertexLayout(sub, object);
          // Blend/rasterizer are copied into the pinned subcontext, not referenced.
          sub[binding] = object && [1, 2].includes(command.objectType) ?
            { handle: object.handle, generation: object.generation, fields: object.fields } : object;
          break;
        }
        case 3: destroyObject(sub, lookup(sub, fields.handle, command.objectType)); break;
        case 4: {
          if (fields.viewports.length === 0) break;
          const viewport = fields.viewports[0], { scale, translate } = viewport;
          require(scale[0] >= 0 && scale[1] >= 0 && scale[0] * 2 <= maxViewport[0] && scale[1] * 2 <= maxViewport[1] &&
            [translate[0] - scale[0], translate[1] - scale[1], scale[0] * 2, scale[1] * 2].every((v) => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) &&
            translate[2] - scale[2] >= 0 && translate[2] + scale[2] <= 1 && scale[2] >= 0,
          "unsupported-feature", "Viewport must be an integer positive rectangle with normalized depth range.");
          sub.viewport = viewport; break;
        }
        case 5: {
          const surfaces = fields.colorSurfaces.map((handle) => lookup(sub, handle, 8, true));
          for (const surface of surfaces) if (surface) resolve(surface.lease);
          for (let index = 0; index < Math.max(sub.surfaces.length, surfaces.length); index++) objectRef(sub, sub.surfaces[index], surfaces[index]);
          sub.surfaces = surfaces; break;
        }
        case 6: {
          const buffers = [];
          try {
            for (const value of fields.buffers) {
              if (value.resourceHandle === 0) { require(value.stride === 0 && value.offset === 0, "invalid-state", "Unbound vertex buffer fields must be zero."); buffers.push(null); continue; }
              const binding = retain(ctx, value.resourceHandle, "vertex", "vertex-buffer"); buffers.push({ ...binding, fields: value });
              require(value.offset <= binding.metadata.byteLength && value.stride <= 255 && value.stride % 4 === 0 && value.offset % 4 === 0, "out-of-bounds", "Invalid vertex buffer range/stride.");
            }
            vertexLayout(sub, sub.vertexElements, buffers);
          } catch (error) { for (const buffer of buffers) if (buffer) release(buffer.lease); throw error; }
          for (const buffer of sub.vertexBuffers) if (buffer) release(buffer.lease);
          sub.vertexBuffers = buffers; break;
        }
        case 7:
          require(sub.surfaces[0], "incomplete-framebuffer", "CLEAR needs a color surface.");
          restore(sub);
          gl.colorMask(true, true, true, true); gl.clearColor(...fields.color); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.colorMask(...colorMask(sub)); check(); return;
        case 8:
          if (!drawing) throw new StateFault("unsupported-draw", "DRAW_VBO execution belongs to the next renderer boundary.");
          draw(ctx, sub, command, submission); return;
        case 10: case 18: {
          if (fields.stage > 1) { sub.resets[`${command.name}:${fields.stage}`] = fields; break; }
          const type = op === 10 ? 6 : 7, values = fields.handles.map((handle) => lookup(sub, handle, type, true));
          require(values.every((value, index) => !value || fields.startSlot + index < stageSlots[fields.stage]), "limit-exceeded", "Active sampler slot exceeds host limits.");
          const slots = op === 10 ? sub.views[fields.stage] : sub.samplers[fields.stage];
          for (const [index, value] of values.entries()) {
            const slot = fields.startSlot + index;
            slots[slot] = op === 10 ? objectRef(sub, slots[slot], value) : value;
          }
          break;
        }
        case 11: {
          let value = null;
          if (fields.resourceHandle) {
            value = { ...retain(ctx, fields.resourceHandle, "index", "index-buffer"), fields };
            if (fields.offset > value.metadata.byteLength) { release(value.lease); throw new StateFault("out-of-bounds", "Index offset exceeds storage."); }
          }
          if (sub.indexBuffer) release(sub.indexBuffer.lease); sub.indexBuffer = value; break;
        }
        case 12:
          if (fields.stage <= 1 && fields.index === 0) sub.constants[fields.stage] = fields.words;
          else sub.resets[`${command.name}:${fields.stage}:${fields.index}`] = fields;
          break;
        case 13: sub.stencilRef = fields; break;
        case 14: sub.blendColor = fields.color; break;
        case 28:
          require(ctx.subs.has(fields.subContextId), "missing-subcontext", "Subcontext is not live."); ctx.current = fields.subContextId; break;
        case 29:
          require(!ctx.subs.has(fields.subContextId), "duplicate-subcontext", "Subcontext already exists.");
          ctx.subs.set(fields.subContextId, createSub(fields.subContextId)); ctx.current = fields.subContextId; break;
        case 30: {
          require(fields.subContextId !== 0, "invalid-subcontext", "Default subcontext cannot be destroyed.");
          const doomed = ctx.subs.get(fields.subContextId); require(doomed, "missing-subcontext", "Subcontext is not live.");
          disposeSub(doomed); ctx.subs.delete(fields.subContextId); if (ctx.current === fields.subContextId) ctx.current = 0; break;
        }
        case 31: {
          if (fields.stage > 1) { sub.resets[`${command.name}:${fields.stage}`] = fields; break; }
          const shader = lookup(sub, fields.handle, 4, true);
          require(!shader || shader.fields.stage === fields.stage, "wrong-shader-stage", "Shader stage and binding disagree.");
          const candidate = [...sub.shaders]; candidate[fields.stage] = shader;
          if (candidate.every(Boolean)) link(sub, candidate[0], candidate[1]);
          sub.shaders[fields.stage] = objectRef(sub, sub.shaders[fields.stage], shader); break;
        }
        case 38: sub.defaults = fields; break;
        case 43: case 45: {
          const prepared = unwrap(resources.prepareTransfer(ctx.id, command)); unwrap(resources.executeTransfer(prepared.ticket)); break;
        }
        case 44: return;
        case 52: link(sub, lookup(sub, fields.vertexHandle, 4), lookup(sub, fields.fragmentHandle, 4)); break;
        default: sub.resets[`${command.name}:${fields.stage ?? fields.id ?? 0}`] = fields; break;
      }
      restore(ctx.subs.get(ctx.current));
    };
    const describeSub = (sub) => ({ id: sub.id, generation: sub.generation,
      objects: [...sub.live].map((object) => ({ handle: object.handle, type: object.type, name: object.name, generation: object.generation,
        public: object.public, references: object.references, fields: object.fields,
        ...(object.lease ? { resourceGeneration: object.resourceGeneration } : {}),
        ...(object.translation ? { translation: object.translation } : {}) })),
      bindings: { blend: ref(sub.blend), rasterizer: ref(sub.rasterizer), dsa: ref(sub.dsa), vertexElements: ref(sub.vertexElements),
        vertexShader: ref(sub.shaders[0]), fragmentShader: ref(sub.shaders[1]), framebuffer: sub.surfaces.map(ref),
        vertexBuffers: sub.vertexBuffers.map((buffer) => buffer ? { ...buffer.fields, resourceGeneration: buffer.resourceGeneration } : null),
        indexBuffer: sub.indexBuffer ? { ...sub.indexBuffer.fields, resourceGeneration: sub.indexBuffer.resourceGeneration } : null,
        samplerViews: sub.views.map((slots) => slots.map(ref)), samplerStates: sub.samplers.map((slots) => slots.map(ref)),
        constants: sub.constants.map((words) => [...words]), viewport: sub.viewport, blendColor: [...sub.blendColor],
        stencilRef: { ...sub.stencilRef }, framebufferDefaults: { ...sub.defaults } },
      programs: [...sub.programs.values()].map((program) => ({ vertexHandle: program.vertex.handle, fragmentHandle: program.fragment.handle,
        vertexGeneration: program.vertex.generation, fragmentGeneration: program.fragment.generation,
        key: program.key, interfaceKey: program.interfaceKey, variantBytes: program.variantBytes,
        reflection: program.reflection })), resets: { ...sub.resets } });
    const releaseJobAccess = (job) => {
      if (job.pending) {
        const pending = job.pending; job.pending = null;
        unwrap(asyncAccess.release(pending.ticket));
      }
      job.request = null;
    };
    const getJob = (token) => {
      alive(); require(activeJob && activeJob.token === token, "invalid-job", "Unknown, completed or foreign renderer job.");
      return activeJob;
    };
    const validateJob = (job) => {
      require(context(job.ctx.id) === job.ctx, "stale-context", "Renderer context identity changed.");
      if (job.pending) {
        require(job.ctx.subs.get(job.pending.sub.id) === job.pending.sub && job.ctx.current === job.pending.sub.id,
          "stale-context", "Renderer subcontext identity changed.");
        unwrap(asyncAccess.validate(job.pending.ticket));
      }
    };
    const jobStatus = (job, status) => Object.freeze({ ok: true, status, appliedCommands: job.index,
      ...(job.request ? { request: job.request } : {}) });
    const finishJob = (job, gpuComplete) => {
      releaseJobAccess(job);
      if (job.sync) { gl.deleteSync(job.sync); job.sync = null; }
      activeJob = null;
      const extra = { appliedCommands: job.index, draws: job.submission.draws, gpuComplete };
      const completed = job.error ? failure(job.error, extra, job.command) : success({ profile, ...extra,
        byteLength: job.byteLength, contextId: job.ctx.id, subContextId: job.ctx.current });
      return Object.freeze({ ok: true, status: "done", appliedCommands: job.index, result: completed });
    };
    const finishOrFence = (job) => {
      if (!job.sync && job.hadFence && job.completedSerial === job.serial) return finishJob(job, true);
      if (!job.sync) {
        job.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        require(job.sync, "backend-error", "Completion fence allocation failed.");
        job.fenceSerial = job.serial; job.hadFence = true; gl.flush(); check();
      }
      job.phase = "finishing"; return jobStatus(job, "waiting-gpu");
    };
    const failJob = (job, error, uncertain = false) => {
      if (!(error instanceof StateFault)) throw error;
      job.error ??= error; job.request = null;
      if (uncertain || gl.isContextLost() || unwrap(resources.inspect()).disposed) return finishJob(job, false);
      if (job.pending?.readStarted) { job.phase = "retiring"; return jobStatus(job, "waiting-gpu"); }
      releaseJobAccess(job);
      try { return finishOrFence(job); }
      catch (finishError) { if (!(finishError instanceof StateFault)) throw finishError; return finishJob(job, false); }
    };
    const transferRequest = (job, prepared, bytes) => Object.freeze({
      token: Object.freeze({}), command: freeze({ byteOffset: job.command.byteOffset, opcode: job.command.opcode }),
      resource: prepared.resource, backingGeneration: prepared.backingGeneration, layout: prepared.layout,
      ...(bytes ? { bytes } : {}) });
    const stepJob = (token) => {
      const job = getJob(token);
      let polling = false;
      try {
        if (job.phase === "cancelling" || job.phase === "retiring") {
          if (job.pending?.readStarted) {
            polling = true;
            const polled = unwrap(asyncAccess.poll(job.pending.ticket, true));
            if (polled.status === "pending") return jobStatus(job, "waiting-gpu");
            polling = false; job.completedSerial = job.pending.fenceSerial;
          }
          releaseJobAccess(job); return finishOrFence(job);
        }
        if (!job.error) validateJob(job);
        if (job.phase === "finishing") {
          polling = true;
          const status = gl.clientWaitSync(job.sync, 0, 0);
          require(status === gl.TIMEOUT_EXPIRED || status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED,
            "backend-error", "Completion fence wait failed.");
          check();
          if (status === gl.TIMEOUT_EXPIRED) return jobStatus(job, "waiting-gpu");
          job.completedSerial = job.fenceSerial; return finishJob(job, true);
        }
        if (job.phase === "needs-input" || job.phase === "needs-output") return jobStatus(job, job.phase);
        let budget = jobLimits.commandsPerStep;
        if (job.phase === "waiting-index" || job.phase === "waiting-transfer") {
          polling = true;
          const polled = unwrap(asyncAccess.poll(job.pending.ticket));
          if (polled.status === "pending") return jobStatus(job, "waiting-gpu");
          polling = false; job.completedSerial = job.pending.fenceSerial;
          if (job.phase === "waiting-transfer") {
            job.request = transferRequest(job, job.pending, polled.bytes);
            job.phase = "needs-output"; return jobStatus(job, job.phase);
          }
          // No yield or public host callback separates the revision check and draw.
          unwrap(asyncAccess.validate(job.pending.ticket));
          job.serial++; issueDraw(job.pending.plan, polled.bytes, job.submission);
          releaseJobAccess(job); job.index++; budget--; job.phase = "ready";
        } else if (job.phase === "upload-ready") {
          job.serial++; unwrap(asyncAccess.upload(job.pending.ticket));
          releaseJobAccess(job); job.index++; budget--; job.phase = "ready";
        }
        while (job.index < job.commands.length && budget > 0) {
          job.command = job.commands[job.index];
          const sub = job.ctx.subs.get(job.ctx.current);
          if (job.command.opcode === 8) {
            // Planning may link a program, so account for even a failed prefix.
            job.serial++;
            const plan = prepareDraw(job.ctx, sub, job.command, job.submission);
            require(plan.indexByteLength <= jobLimits.transferBytes, "limit-exceeded", "Index staging exceeds job byte limit.");
            const read = unwrap(asyncAccess.beginStorageRead(plan.index.lease,
              { x: plan.indexOffset, y: 0, z: 0, width: plan.indexByteLength, height: 1, depth: 1 }));
            job.pending = { ...read, sub, plan, readStarted: true, fenceSerial: job.serial };
            job.hadFence = true; job.phase = "waiting-index"; return jobStatus(job, "waiting-gpu");
          }
          if (job.command.opcode === 43 || job.command.opcode === 45) {
            const prepared = unwrap(asyncAccess.prepareTransfer(job.ctx.id, job.command));
            job.pending = { ...prepared, sub, readStarted: false };
            require(prepared.layout.tightBytes <= jobLimits.transferBytes, "limit-exceeded", "Transfer exceeds job byte limit.");
            if (prepared.layout.direction === "upload") {
              job.request = transferRequest(job, prepared); job.phase = "needs-input"; return jobStatus(job, job.phase);
            }
            job.serial++; unwrap(asyncAccess.beginTransferRead(prepared.ticket));
            job.pending.readStarted = true; job.pending.fenceSerial = job.serial;
            job.hadFence = true; job.phase = "waiting-transfer"; return jobStatus(job, "waiting-gpu");
          }
          // END_TRANSFERS issues no GL work. Other state operations restore GL state.
          if (job.command.opcode !== 44) job.serial++;
          apply(job.ctx, job.command, job.submission); job.index++; budget--;
        }
        return job.index === job.commands.length ? finishOrFence(job) : jobStatus(job, "ready");
      } catch (error) { return failJob(job, error, polling && error.code === "backend-error"); }
    };
    const renderer = {
      createContext(id) { return result(() => {
        alive(); idle(); uint(id, "contextId"); require(!contexts.has(id), "duplicate-context", "State context already exists.");
        require(contexts.size < limits.contexts, "limit-exceeded", "Context limit exceeded.");
        const resourceGeneration = resourceContext(id).generation, contextGeneration = generation(), sub = createSub(0);
        const ctx = { id, generation: contextGeneration, resourceContextGeneration: resourceGeneration, current: 0, subs: new Map([[0, sub]]) };
        contexts.set(id, ctx); return success({ context: { id, generation: ctx.generation } });
      }); },
      destroyContext(id) { return result(() => {
        alive(); idle(); uint(id, "contextId"); const ctx = contexts.get(id); require(ctx, "missing-context", "State context does not exist.");
        for (const sub of ctx.subs.values()) disposeSub(sub); contexts.delete(id); return success();
      }); },
      executeSubmission(id, bytes, provenance = {}) {
        let appliedCommands = 0, command = null;
        const submission = drawing ? { draws: [], indices: 0 } : null;
        const drawResults = () => drawing ? { draws: submission.draws } : {};
        try {
          idle();
          const decoded = decodeSubmission(bytes, provenance);
          if (!decoded.ok) return freeze({ ...decoded, appliedCommands, ...drawResults() });
          const ctx = context(id);
          require(decoded.contextId === null || decoded.contextId === id, "invalid-provenance", "Context provenance disagrees with execution context.");
          for (command of decoded.commands) { apply(ctx, command, submission); appliedCommands++; }
          return success({ profile, appliedCommands, byteLength: decoded.byteLength, contextId: id, subContextId: ctx.current, ...drawResults() });
        } catch (error) { return failure(error, { appliedCommands, ...drawResults() }, command); }
      },
      restoreContext(id) { return result(() => { idle(); const ctx = context(id); restore(ctx.subs.get(ctx.current)); return success({ contextId: id, subContextId: ctx.current }); }); },
      inspect(id) { return result(() => {
        if (id !== undefined) { uint(id, "contextId"); require(contexts.has(id), "missing-context", "State context does not exist."); }
        const selected = id === undefined ? [...contexts.values()] : [contexts.get(id)];
        return success({ profile, disposed, limits, hostUniformComponents, ...(drawing ? { drawLimits } : {}),
          ...(asynchronous ? { jobLimits, jobs: { active: activeJob === null ? 0 : 1, status: activeJob?.phase ?? "idle",
            appliedCommands: activeJob?.index ?? 0, commandCount: activeJob?.commands.length ?? 0,
            draws: activeJob?.submission.draws.length ?? 0,
            inputBytes: activeJob?.phase === "upload-ready" ? activeJob.pending.layout.tightBytes : 0,
            outputBytes: activeJob?.request?.bytes?.byteLength ?? 0,
            reads: asyncAccess.inspect().reads, transfers: asyncAccess.inspect().transfers, stagingBytes: asyncAccess.inspect().stagingBytes } } : {}),
          budgets: { contexts: contexts.size, subContexts: subCount, objects: objects.size, programs: programs.size,
            shaders: [...objects].filter((o) => o.type === 4).length, samplers: [...objects].filter((o) => o.type === 7).length,
            leases: leaseCount, shaderBytes, uniformBytes },
          contexts: selected.map((ctx) => ({ id: ctx.id, generation: ctx.generation, resourceContextGeneration: ctx.resourceContextGeneration,
            currentSubContext: ctx.current, subContexts: [...ctx.subs.values()].map(describeSub) })) });
      }); },
      dispose() { return result(() => {
        if (disposed) return success();
        if (activeJob) { releaseJobAccess(activeJob); if (activeJob.sync) gl.deleteSync(activeJob.sync); activeJob = null; }
        for (const ctx of contexts.values()) for (const sub of ctx.subs.values()) disposeSub(sub);
        contexts.clear(); disposed = true; return success();
      }); },
    };
    if (asynchronous) {
      // This entry point has no synchronous escape hatch while using the job profile.
      delete renderer.executeSubmission;
      Object.assign(renderer, {
        beginSubmission(id, bytes, provenance = {}) {
          return result(() => {
            alive(); idle(); require(jobLimits.jobs > 0, "limit-exceeded", "Renderer jobs are disabled.");
            const decoded = decodeSubmission(bytes, provenance);
            if (!decoded.ok) return freeze({ ...decoded, appliedCommands: 0, draws: [] });
            require(decoded.byteLength <= jobLimits.submissionBytes, "limit-exceeded", "Submission exceeds job byte budget.");
            const ctx = context(id);
            require(decoded.contextId === null || decoded.contextId === id, "invalid-provenance", "Context provenance disagrees with execution context.");
            const token = Object.freeze({});
            activeJob = { token, ctx, commands: decoded.commands, byteLength: decoded.byteLength, index: 0,
              command: null, submission: { draws: [], indices: 0 }, phase: "ready", pending: null, request: null,
              error: null, serial: 0, completedSerial: -1, hadFence: false, sync: null };
            return success({ job: token, profile, byteLength: decoded.byteLength, commandCount: decoded.commands.length });
          });
        },
        step(token) { return result(() => stepJob(token)); },
        provideInput(token, requestToken, bytes) { return result(() => {
          const job = getJob(token);
          require(job.phase === "needs-input" && job.request.token === requestToken, "invalid-request", "Unknown or consumed input request.");
          validateJob(job); unwrap(asyncAccess.provideInput(job.pending.ticket, bytes));
          job.request = null; job.phase = "upload-ready"; return success();
        }); },
        acknowledgeOutput(token, requestToken) { return result(() => {
          const job = getJob(token);
          require(job.phase === "needs-output" && job.request.token === requestToken, "invalid-request", "Unknown or consumed output request.");
          validateJob(job); releaseJobAccess(job); job.index++; job.phase = "ready"; return success();
        }); },
        cancel(token) { return result(() => {
          const job = getJob(token);
          require(!job.error, "invalid-job", "Job is already cancelling or failed.");
          job.error = new StateFault("cancelled", "Renderer job was cancelled."); job.request = null;
          job.phase = "cancelling"; return success({ status: "cancelling" });
        }); },
      });
    }
    // Do not recursively freeze capabilities or any of the native GL objects they own.
    return Object.freeze({ ok: true, renderer: Object.freeze(renderer) });
  });
}
