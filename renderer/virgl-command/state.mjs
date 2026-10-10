/** Typed VirGL state and bounded triangle draws. See state-README.md and draw-README.md. */
import { decodeSubmission, decodeStandardSubmission } from "./decoder.mjs";
import { LIMITS as SHADER_LIMITS } from "../virgl-shader/index.mjs";
import { createKeyCache, hashKey } from "./cache.mjs";
import { parseConstantDomain, checkFiniteBank, checkIndirectBank, checkLoopBank, checkRadialBank, checkRasterBank, checkConversionBank, checkExactBank, COORDINATE_KEY, DISCARD_KEY,
  parseStandardShaderMetadata, normalizeStandardShaderResult, normalizeStandardShaderPair, deriveStandardShaderInterface } from "./constant-domain.mjs";

export const STATE_PROFILE = "virgl-tiny-state-v1";
export const STATE_LIMITS = Object.freeze({ contexts: 8, subContexts: 16, objects: 256,
  programs: 64, shaderBytes: 1048576, uniformBytes: 65536 });
export const DRAW_PROFILE = "virgl-tiny-indexed-draw-v1";
export const DRAW_LIMITS = Object.freeze({ drawsPerSubmission: 64, indicesPerSubmission: 65536 });
export const ASYNC_PROFILE = "virgl-tiny-async-jobs-v1";
export const STANDARD_ASYNC_PROFILE = "virgl-standard-async-jobs-v1";
export const JOB_LIMITS = Object.freeze({ jobs: 1, commandsPerStep: 64, submissionBytes: 262144, transferBytes: 4194304 });
export const CACHE_LIMITS = Object.freeze({ translations: 128, translationBytes: 4194304,
  programBytes: 4194304, states: 256, stateBytes: 1048576, debugBytes: 4194304 });
const NAMES = ["NULL", "BLEND", "RASTERIZER", "DSA", "SHADER", "VERTEX_ELEMENTS", "SAMPLER_VIEW", "SAMPLER_STATE", "SURFACE"];
const BINDINGS = { 1: "blend", 2: "rasterizer", 3: "dsa", 5: "vertexElements" };
const vertexComponents = (element) => element.sourceFormat - 27;
const viewportRectangle = ({ scale, translate }) => [translate[0] - scale[0], translate[1] - Math.abs(scale[1]), scale[0] * 2, Math.abs(scale[1]) * 2];
const BLEND_EQUATIONS = Object.freeze(["FUNC_ADD", "FUNC_SUBTRACT", "FUNC_REVERSE_SUBTRACT", "MIN", "MAX"]);
const BLEND_FACTORS = Object.freeze({ 1: "ONE", 2: "SRC_COLOR", 3: "SRC_ALPHA", 4: "DST_ALPHA", 5: "DST_COLOR",
  6: "SRC_ALPHA_SATURATE", 7: "CONSTANT_COLOR", 8: "CONSTANT_ALPHA", 17: "ZERO", 18: "ONE_MINUS_SRC_COLOR",
  19: "ONE_MINUS_SRC_ALPHA", 20: "ONE_MINUS_DST_ALPHA", 21: "ONE_MINUS_DST_COLOR", 23: "ONE_MINUS_CONSTANT_COLOR", 24: "ONE_MINUS_CONSTANT_ALPHA" });
function mixedBlendConstants(target) {
  return target?.blendEnable === true && target.rgbFunction < 3 &&
    ([7, 23].includes(target.rgbSourceFactor) && [8, 24].includes(target.rgbDestinationFactor) ||
     [8, 24].includes(target.rgbSourceFactor) && [7, 23].includes(target.rgbDestinationFactor));
}
const blendFoldFor = (sub, fragment) => mixedBlendConstants(sub.blend?.fields.renderTargets[0]) &&
  fragment?.discardContract?.alwaysDiscards !== true ? sub.blend.fields.renderTargets[0].rgbSourceFactor : 0;
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
function shaderInterface(vertex, fragment, coordinates = null, discard = null) {
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
  let position = false;
  for (const input of fragment.inputs) {
    if (input?.semantic === "POSITION") {
      require(coordinates && !position && input.index === coordinates.input && input.semanticIndex === coordinates.semanticIndex &&
        input.name === coordinates.source && input.type === "vec4" && input.componentMask === 15 && input.interpolation === coordinates.interpolation &&
        !registers.has(input.index), "shader-link-error", "Fragment POSITION lacks its authenticated convention.");
      position = true; registers.add(input.index); continue;
    }
    require(generic(input) && ["smooth", "flat"].includes(input.interpolation) &&
      !inputs.has(input.semanticIndex) && !registers.has(input.index),
    "shader-link-error", "Fragment varying metadata is incompatible.");
    const output = outputs.get(input.semanticIndex);
    require(output && (input.componentMask & ~output.writtenMask) === 0,
      "shader-link-error", "Fragment input is not written by the vertex shader.");
    inputs.set(input.semanticIndex, input); registers.add(input.index);
  }
  require(position === Boolean(coordinates), "shader-link-error", "Coordinate policy and builtin interface disagree.");
  const ordered = [...inputs.values()].sort((left, right) => left.semanticIndex - right.semanticIndex);
  return { key: `generic-interpolation-v1:${ordered.map((input) =>
    `g${input.semanticIndex}/${input.componentMask}/${input.interpolation}`).join(";")}${coordinates ? COORDINATE_KEY : ""}${discard ? DISCARD_KEY + Number(discard.alwaysDiscards) : ""}`,
  flat: ordered.some((input) => input.interpolation === "flat"), coordinates: position, discard: Boolean(discard), inputs };
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

/** Explicit host selection of ordinary native shader semantics and word banks. */
export function createVirglStandardAsyncRenderer(options) {
  return createRenderer(options, true, true, true);
}

/** Host capabilities are trusted and non-reentrant. */
function createRenderer(options, drawing, asynchronous = false, standard = false) {
  return result(() => {
    const config = dataRecord(options, ["gl", "resources", "bindings", "shaderBridge", "limits", "cacheLimits", ...(drawing ? ["drawLimits"] : []), ...(asynchronous ? ["asyncAccess", "jobLimits"] : [])], ["gl", "resources", "bindings", "shaderBridge", ...(asynchronous ? ["asyncAccess"] : [])]);
    const { gl, resources, bindings, shaderBridge } = config;
    require(gl && typeof gl.createVertexArray === "function" && typeof gl.uniform4uiv === "function", "invalid-input", "A WebGL2 context is required.");
    require(resources && ["inspect", "retainStorage", "releaseStorage", "prepareTransfer", "executeTransfer"].every((name) => typeof resources[name] === "function") &&
      bindings && typeof bindings.resolve === "function" && shaderBridge && typeof shaderBridge.translate === "function", "invalid-input", "Resource and shader capabilities are required.");
    require(!drawing || typeof resources.readStorage === "function", "invalid-input", "Drawing requires actual storage readback.");
    const supplied = dataRecord(config.limits ?? {}, Object.keys(STATE_LIMITS), []), limits = { ...STATE_LIMITS, ...supplied };
    for (const key of Object.keys(limits)) require(Number.isSafeInteger(limits[key]) && limits[key] >= 0 && limits[key] <= STATE_LIMITS[key], "invalid-input", "Limits may only tighten defaults.");
    Object.freeze(limits);
    const cacheLimits = { ...CACHE_LIMITS, ...dataRecord(config.cacheLimits ?? {}, Object.keys(CACHE_LIMITS), []) };
    for (const key of Object.keys(cacheLimits)) require(Number.isSafeInteger(cacheLimits[key]) && cacheLimits[key] >= 0 && cacheLimits[key] <= CACHE_LIMITS[key],
      "invalid-input", "Cache limits may only tighten defaults.");
    Object.freeze(cacheLimits);
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
    const profile = standard ? STANDARD_ASYNC_PROFILE : asynchronous ? ASYNC_PROFILE : drawing ? DRAW_PROFILE : STATE_PROFILE;
    const decodeCommands = standard ? decodeStandardSubmission : decodeSubmission;
    const parseShaderMetadata = standard ? parseStandardShaderMetadata : parseConstantDomain;
    const idle = () => require(activeJob === null, "busy", "A renderer job is active; cancel and drain it before changing state.");
    const contexts = new Map(), objects = new Set(), programs = new Set();
    let disposed = false, nextGeneration = 1, subCount = 0, shaderBytes = 0, uniformBytes = 0, leaseCount = 0;
    const translationCache = createKeyCache({ entries: cacheLimits.translations, bytes: cacheLimits.translationBytes });
    const stateCache = createKeyCache({ entries: cacheLimits.states, bytes: cacheLimits.stateBytes });
    const programCache = createKeyCache({ entries: limits.programs, bytes: cacheLimits.programBytes, release: collectProgram });
    const work = { translations: 0, pairTranslations: 0, shaderCompiles: 0, programLinks: 0,
      submissions: 0, decodedSubmissions: 0, completedSubmissions: 0, failedSubmissions: 0, appliedCommands: 0, drawCalls: 0, draws: 0 };
    let activeFrame = null, lastFrame = null, lastFrameNumber = -1, debugBytes = 0;
    const check = () => {
      require(!gl.isContextLost(), "backend-error", "WebGL context is lost.");
      const error = gl.getError(); require(error === gl.NO_ERROR, "backend-error", `WebGL error ${error}.`);
    };
    check();
    const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    const maxElementIndex = standard ? gl.getParameter(gl.MAX_ELEMENT_INDEX) : null;
    require(!standard || Number.isSafeInteger(maxElementIndex) && maxElementIndex >= 0 && maxElementIndex <= 0xffffffff,
      "unsupported-host", "WebGL maximum element index must be a u32.");
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
          blend: null, rasterizer: null, dsa: null, vertexElements: null, shaders: [null, null], surfaces: [], depthSurface: null,
          vertexBuffers: [], indexBuffer: null, views: [Array(32).fill(null), Array(32).fill(null)],
          samplers: [Array(32).fill(null), Array(32).fill(null)], constants: [[], []], viewport: null, scissor: null,
          blendColor: [0, 0, 0, 0], stencilRef: { front: 0, back: 0 }, defaults: { width: 0, height: 0 }, resets: {} };
        subCount++; return sub;
      } catch (error) { if (vao) gl.deleteVertexArray(vao); if (framebuffer) gl.deleteFramebuffer(framebuffer); throw error; }
    };
    function collectProgram(program, sub) {
      sub.programs.delete(program.key); programs.delete(program);
      if (gl.getParameter(gl.CURRENT_PROGRAM) === program.native) gl.useProgram(null);
      gl.deleteProgram(program.native);
      if (program.variantShader) gl.deleteShader(program.variantShader);
      if (program.fragmentVariantShader) gl.deleteShader(program.fragmentVariantShader);
      shaderBytes -= program.variantBytes;
      for (const block of program.blocks) { gl.deleteBuffer(block.buffer); uniformBytes -= block.byteLength; }
    }
    const deleteProgram = (sub, program) => programCache.remove(sub, program.key);
    const makeProgramRoom = (variantBytes) => {
      const evictableBytes = [...programs].reduce((sum, program) => sum + program.variantBytes, 0);
      require(limits.programs > 0 && limits.uniformBytes >= 656 && variantBytes <= limits.shaderBytes - shaderBytes + evictableBytes,
        "limit-exceeded", "One program cannot fit the native allocation budgets.");
      while (programs.size >= limits.programs || variantBytes > limits.shaderBytes - shaderBytes || 656 > limits.uniformBytes - uniformBytes) {
        require(programCache.evict(), "limit-exceeded", "Linked program, variant or system-uniform budget exceeded.");
      }
    };
    const translatedStage = (sub, request) => {
      const key = JSON.stringify([sub.generation, "stage", request.stage, request.text]);
      const cached = translationCache.get(sub, key);
      if (cached) return cached;
      work.translations++;
      const response = shaderBridge.translate(request);
      const translated = standard ? unwrap(normalizeStandardShaderResult(response, request.stage)) : freeze(unwrap(response));
      unwrap(parseShaderMetadata(translated.metadata, request.stage));
      require(typeof translated.glsl === "string" && /^#version 300 es\b/m.test(translated.glsl),
        "shader-error", "Shader bridge returned incompatible output.");
      translationCache.put(sub, key, translated, 1024 + 2 * (key.length + JSON.stringify(translated).length));
      return translated;
    };
    const translatedPair = (sub, vertex, fragment, interfaceKey, validate) => {
      const key = JSON.stringify([sub.generation, "pair", vertex.fields.text, fragment.fields.text, interfaceKey]);
      const cached = translationCache.get(sub, key);
      if (cached) { validate(cached); return cached; }
      work.pairTranslations++;
      const response = shaderBridge.translatePair({ vertexText: vertex.fields.text, fragmentText: fragment.fields.text });
      const translated = standard ? unwrap(normalizeStandardShaderPair(response)) : freeze(unwrap(response));
      validate(translated);
      translationCache.put(sub, key, translated, 1024 + 2 * (key.length + JSON.stringify(translated).length));
      return translated;
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
      translationCache.removeOwner(sub); stateCache.removeOwner(sub);
      for (const surface of sub.surfaces) objectRef(sub, surface, null);
      sub.surfaces = [];
      sub.depthSurface = objectRef(sub, sub.depthSurface, null);
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
        if (type === 5) {
          require(fields.elements.length <= maxAttributes, "limit-exceeded", "Vertex elements exceed host attribute slots.");
          for (const element of fields.elements) require(element.sourceOffset % 4 === 0, "invalid-state", "Vertex element offset must be float-aligned.");
        }
        if (type === 6 || type === 8) {
          const depth = type === 8 && fields.format === 16;
          Object.assign(object, retain(ctx, fields.resourceHandle, depth ? "depth-surface" : type === 6 ? "view" : "surface", depth ? "depth-texture" : "texture"));
          require(object.metadata.format === fields.format, "incompatible-resource", "View format and storage format differ.");
        }
        if (type === 4) {
          const translated = translatedStage(sub, { stage: fields.stageName, text: fields.text });
          const contract = unwrap(parseShaderMetadata(translated.metadata, fields.stageName));
          object.constantDomain = contract.domain;
          object.constantAccess = contract.access ?? null;
          object.constantConstraint = contract.constraint ?? null;
          object.constantRadialDomain = contract.radialDomain ?? null;
          object.constantRasterDomain = contract.rasterDomain ?? null;
          object.constantConversionDomain = contract.conversionDomain ?? null;
          object.constantConversionBase = contract.exactBase ?? contract;
          object.constantExactDomain = contract.exactDomain ?? null;
          object.constantExactBase = contract.exactBase ?? null;
          object.coordinateContract = contract.coordinates ?? null;
          object.discardContract = contract.discard ?? null;
          require(typeof translated.glsl === "string" && /^#version 300 es\b/m.test(translated.glsl), "shader-error", "Shader bridge returned incompatible output.");
          object.shaderBytes = fields.text.length + translated.glsl.length;
          require(object.shaderBytes <= limits.shaderBytes - shaderBytes, "limit-exceeded", "Shader storage budget exceeded.");
          object.shader = gl.createShader(fields.stage === 0 ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
          require(object.shader, "backend-error", "Shader allocation failed.");
          gl.shaderSource(object.shader, translated.glsl); work.shaderCompiles++; gl.compileShader(object.shader);
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
    const samplingFor = (sub, fragment, vertex = null) => {
      const declarations = standard ? [[0, vertex], [1, fragment]].flatMap(([stage, shader]) =>
        shader.translation.metadata.samplers.map(sampler => ({ stage, sampler }))) :
        fragment.translation.metadata.samplers.map(sampler => ({ stage: 1, sampler }));
      const views = declarations.map(({ stage, sampler }) => {
        require(sampler.type === "sampler2D" && Number.isInteger(sampler.index) && sampler.index >= 0 && sampler.index < (standard ? 16 : 8) &&
          sampler.name === (stage === 0 ? "vssamp" : "fssamp") + sampler.index,
        "shader-link-error", "View specialization requires the checked stage 2D TEX family.");
        const view = sub.views[stage][sampler.index], fields = view?.fields;
        // Linking may precede view binding. The fixed legacy RGBA identity
        // specialization is safe then; draw validation still requires a view.
        return { ...(standard ? { stage } : {}), index: sampler.index, name: sampler.name, target: 2, format: fields?.format ?? 67,
          firstLevel: 0, lastLevel: 0, firstLayer: 0, lastLayer: 0, origin: "lower-left",
          swizzle: fields?.swizzle ?? [0, 1, 2, 3] };
      });
      const key = views.length ? `sampler-view-v1:${JSON.stringify(views)}` : "";
      const identity = views.every((view) => view.format === 67 && view.swizzle.every((value, lane) => value === lane));
      return freeze({ key, suffix: identity ? "" : `|${key}`, views });
    };
    const specializeViews = (text, sampling, stage = 1) => {
      const specialized = sampling.views.filter((view) => (!standard || view.stage === stage) && view.swizzle.some((value, lane) => value !== lane));
      if (!specialized.length) return null;
      let helpers = "";
      for (const view of specialized) {
        const name = `wv_view_${view.index}`, pattern = new RegExp(`\\btexture\\s*\\(\\s*${view.name}\\s*,`, "g");
        let hits = 0;
        text = text.replace(pattern, () => { hits++; return `${name}(`; });
        require(hits > 0, "shader-link-error", "Checked TEX sampler has no emitted lookup to specialize.");
        const lanes = ["v.r", "v.g", "v.b", "v.a", "0.0", "1.0"];
        helpers += `vec4 ${name}(vec2 coord){vec4 v=texture(${view.name},coord);return vec4(${view.swizzle.map((value) => lanes[value]).join(",")});}\n`;
      }
      const main = text.indexOf("\nvoid main(");
      require(main >= 0, "shader-link-error", "Checked shader has no main insertion point.");
      const variant = text.slice(0, main + 1) + helpers + text.slice(main + 1);
      require(variant.length <= SHADER_LIMITS.glslBytes, "limit-exceeded", "View-specialized GLSL exceeds the compiler output bound.");
      return variant;
    };
    const specializeBlend = (text, fold, metadata) => {
      if (!fold) return null;
      require(metadata.outputs.length === 1 && metadata.outputs[0].name === "fsout_c0" &&
        metadata.outputs[0].type === "vec4" && !text.includes("wv_rgb_blend_factor") && !text.includes("wv_unblended_main"),
      "shader-link-error", "Constant blend folding requires the checked single color output.");
      const main = /\bvoid\s+main\s*\(\s*(?:void)?\s*\)/g;
      require([...text.matchAll(main)].length === 1, "shader-link-error", "Constant blend folding requires one checked main.");
      const variant = text.replace(main, "void wv_unblended_main(void)") +
        "\nuniform highp vec4 wv_rgb_blend_factor;\nvoid main(void){wv_unblended_main();" +
        "fsout_c0.rgb=clamp(fsout_c0.rgb,0.0,1.0)*wv_rgb_blend_factor.rgb;}\n";
      require(variant.length <= SHADER_LIMITS.glslBytes, "limit-exceeded", "Blend-specialized GLSL exceeds the compiler output bound.");
      return variant;
    };
    function link(sub, vertex, fragment) {
      require(vertex?.fields.stage === 0 && fragment?.fields.stage === 1, "missing-shader", "Link requires a vertex shader and a fragment shader.");
      const sampling = samplingFor(sub, fragment, vertex);
      const blendFold = blendFoldFor(sub, fragment);
      let vs = vertex.translation.metadata;
      const fs = fragment.translation.metadata;
      const interfaceInfo = standard ? (() => {
        const owned = unwrap(deriveStandardShaderInterface(vs, fs));
        return { ...owned, inputs: new Map(owned.inputs.map(input => [input.semanticIndex, input])) };
      })() : shaderInterface(vs, fs, fragment.coordinateContract, fragment.discardContract);
      // Generations identify these exact owned immutable bodies/metadata, not public names.
      // Derive the complete pair interface even when another vertex used this fragment.
      const key = `${sub.generation}:${vertex.generation}:${fragment.generation}:${interfaceInfo.key}|${sampling.key}` +
        (blendFold ? `|blend-source-constant-v1:${blendFold}` : "");
      const cached = programCache.get(sub, key);
      if (cached) return cached;
      const program = { key, generation: generation(), vertex, fragment, native: null, blocks: [], uniforms: [], samplers: [],
        interfaceKey: interfaceInfo.key, samplingKey: sampling.key, samplingViews: sampling.views,
        variantShader: null, fragmentVariantShader: null, variantBytes: 0,
        blendFold, blendUniform: null,
        reflection: { attributes: [], uniforms: [], samplers: [], uniformBlocks: [], outputs: [], ...(standard ? { systemValues: [] } : {}) } };
      try {
        if (standard || interfaceInfo.flat || interfaceInfo.coordinates || interfaceInfo.discard) {
          require(typeof shaderBridge.translatePair === "function", "shader-link-error", interfaceInfo.coordinates ?
            "Fragment coordinates require the checked pair compiler." : interfaceInfo.discard ?
            "Fragment discard requires the checked pair compiler." : "Flat interpolation requires the checked pair compiler.");
          const expectedVertex = { ...vs, outputs: vs.outputs.map((output) => output.semantic === "GENERIC" ?
            { ...output, ...(standard ? { type: interfaceInfo.inputs.get(output.semanticIndex)?.interpolation === "flat" ? "uvec4" : "vec4" } : {}),
              interpolation: interfaceInfo.inputs.get(output.semanticIndex)?.interpolation ?? "smooth" } : output) };
          const pair = translatedPair(sub, vertex, fragment, interfaceInfo.key, (pair) => require(pair.interfaceKey === interfaceInfo.key &&
            pair.fragment?.glsl === fragment.translation.glsl && JSON.stringify(pair.fragment?.metadata) === JSON.stringify(fs) &&
            typeof pair.vertex?.glsl === "string" && pair.vertex.glsl.length <= SHADER_LIMITS.glslBytes &&
            /^#version 300 es\b/m.test(pair.vertex.glsl) && JSON.stringify(pair.vertex.metadata) === JSON.stringify(expectedVertex),
          "shader-link-error", "Pair compiler output does not match the selected shader interface."));
          if (standard || interfaceInfo.flat) {
            program.vertexText = pair.vertex.glsl; vs = pair.vertex.metadata;
          }
        }
        let fragmentText = specializeViews(fragment.translation.glsl, sampling);
        fragmentText = specializeBlend(fragmentText ?? fragment.translation.glsl, blendFold, fs) ?? fragmentText;
        program.vertexText ??= vertex.translation.glsl;
        program.vertexText = (standard ? specializeViews(program.vertexText, sampling, 0) : null) ?? program.vertexText;
        program.fragmentText = fragmentText ?? fragment.translation.glsl;
        const vertexVariant = standard ? program.vertexText !== vertex.translation.glsl : interfaceInfo.flat;
        const requiredVariantBytes = (vertexVariant ? program.vertexText.length : 0) + (fragmentText?.length ?? 0);
        makeProgramRoom(requiredVariantBytes);
        if (vertexVariant) {
            program.variantBytes = program.vertexText.length; shaderBytes += program.variantBytes;
            program.variantShader = gl.createShader(gl.VERTEX_SHADER);
            require(program.variantShader, "backend-error", "Vertex variant allocation failed.");
            gl.shaderSource(program.variantShader, program.vertexText); work.shaderCompiles++; gl.compileShader(program.variantShader);
            require(gl.getShaderParameter(program.variantShader, gl.COMPILE_STATUS), "shader-error",
              `WebGL vertex variant compilation failed: ${gl.getShaderInfoLog(program.variantShader)}`);
        }
        if (fragmentText !== null) {
          program.variantBytes += fragmentText.length; shaderBytes += fragmentText.length;
          program.fragmentVariantShader = gl.createShader(gl.FRAGMENT_SHADER);
          require(program.fragmentVariantShader, "backend-error", "Fragment view variant allocation failed.");
          gl.shaderSource(program.fragmentVariantShader, fragmentText); work.shaderCompiles++; gl.compileShader(program.fragmentVariantShader);
          require(gl.getShaderParameter(program.fragmentVariantShader, gl.COMPILE_STATUS), "shader-error",
            `WebGL fragment view variant compilation failed: ${gl.getShaderInfoLog(program.fragmentVariantShader)}`);
        }
        program.native = gl.createProgram(); require(program.native, "backend-error", "Program allocation failed.");
        gl.attachShader(program.native, program.variantShader ?? vertex.shader); gl.attachShader(program.native, program.fragmentVariantShader ?? fragment.shader);
        work.programLinks++; gl.linkProgram(program.native);
        require(gl.getProgramParameter(program.native, gl.LINK_STATUS), "shader-link-error", `WebGL program link failed: ${gl.getProgramInfoLog(program.native)}`);
        for (let index = 0; index < gl.getProgramParameter(program.native, gl.ACTIVE_ATTRIBUTES); index++) {
          const actual = gl.getActiveAttrib(program.native, index), declared = vs.attributes.find((attribute) => attribute.name === actual.name);
          const system = standard ? vs.systemValues.find(value => value.name === actual.name) : null;
          if (system) {
            require(actual.type === gl.INT && actual.size === 1 && gl.getAttribLocation(program.native, actual.name) === -1,
              "shader-reflection-error", "Built-in system value must not expose a bound vertex attribute.");
            program.reflection.systemValues.push({ ...system, location: -1, type: actual.type });
            continue;
          }
          require(declared && actual.type === gl.FLOAT_VEC4 && actual.size === 1 && declared.index < maxAttributes, "shader-reflection-error", "Unknown active vertex attribute.");
          const location = gl.getAttribLocation(program.native, actual.name);
          require(location >= 0, "shader-reflection-error", "Missing vertex attribute location.");
          program.reflection.attributes.push({ ...declared, location, type: actual.type });
        }
        for (const [stage, metadata] of [[0, vs], [1, fs]]) {
          const guestConstantLimit = standard ? 512 : stage === 0 && metadata.profile === "virgl-webgl2-straight-line-v6" ? 128 : 46;
          for (const uniform of metadata.uniforms) {
            require(uniform.type === "uvec4[]" && uniform.encoding === (standard ? "raw-32bit-words" : "float32-bits") &&
              Number.isInteger(uniform.count) && uniform.count > 0 && uniform.count <= guestConstantLimit + (standard ? 0 : 1),
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
            // A final CONST0 declaration can retain one inaccessible suffix.
            // Native array size never increases the profile's guest index limit.
            const uploadCount = Math.min(activeCount, guestConstantLimit);
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
            const view = standard || stage === 1 ? sampling.views.find((entry) => entry.index === sampler.index && (!standard || entry.stage === stage)) : null;
            const constant = view?.swizzle.every((value) => value >= 4) ?? false;
            if (location === null && index === gl.INVALID_INDEX) require(standard || constant,
              "shader-reflection-error", "Only a proved all-constant view may eliminate a used sampler.");
            else require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
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
        if (blendFold) {
          const name = "wv_rgb_blend_factor", index = gl.getUniformIndices(program.native, [name])?.[0];
          program.blendUniform = gl.getUniformLocation(program.native, name);
          require(program.blendUniform !== null && index !== undefined && index !== gl.INVALID_INDEX &&
            gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === gl.FLOAT_VEC4 &&
            gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1,
          "shader-reflection-error", "Blend factor uniform reflection mismatch.");
          const components = program.reflection.uniforms.filter(uniform => uniform.stage === "fragment")
            .reduce((sum, uniform) => sum + uniform.activeCount * 4, 4);
          require(components <= hostUniformComponents[1], "shader-reflection-error", "Blend factor exceeds the host fragment uniform limit.");
          program.reflection.blend = { sourceFactor: blendFold, uniform: name, type: "vec4", count: 1 };
        }
        if (standard) for (let index = 0; index < gl.getProgramParameter(program.native, gl.ACTIVE_UNIFORMS); index++) {
          const actual = gl.getActiveUniform(program.native, index);
          require(actual, "shader-reflection-error", "Missing active native uniform reflection.");
          const blockIndex = gl.getActiveUniforms(program.native, [index], gl.UNIFORM_BLOCK_INDEX)[0];
          // The measured system block includes upstream reserved members. Its
          // complete native extent and owned zero-filled data were checked above.
          const accounted = program.blocks.some(block => block.index === blockIndex) ||
            program.reflection.uniforms.some(uniform => uniform.name === actual.name &&
              uniform.activeCount === actual.size && actual.type === gl.UNSIGNED_INT_VEC4) ||
            program.reflection.samplers.some(sampler => sampler.name === actual.name &&
              actual.size === 1 && actual.type === gl.SAMPLER_2D) ||
            program.reflection.blend?.uniform === actual.name && actual.size === 1 && actual.type === gl.FLOAT_VEC4;
          require(accounted, "shader-reflection-error", `Active native uniform ${actual.name} has no checked binding metadata.`);
        }
        for (const output of fs.outputs) {
          const location = gl.getFragDataLocation(program.native, output.name);
          require(output.semantic === "COLOR" && (location === 0 || location === -1 && (standard || fragment.discardContract?.alwaysDiscards === true)),
            "shader-reflection-error", "Unsupported fragment output.");
          program.reflection.outputs.push({ ...output, location });
        }
        check(); freeze(program.reflection);
        const cacheBytes = 1024 + 2 * (key.length + JSON.stringify(program.reflection).length + requiredVariantBytes);
        require(programCache.put(sub, key, program, cacheBytes), "limit-exceeded", "Program cache byte budget exceeded.");
        sub.programs.set(key, program); programs.add(program); return program;
      } catch (error) {
        if (program.native) gl.deleteProgram(program.native);
        if (program.variantShader) gl.deleteShader(program.variantShader);
        if (program.fragmentVariantShader) gl.deleteShader(program.fragmentVariantShader);
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
          vertexComponents(element) * 4 <= buffer.metadata.byteLength - buffer.fields.offset - element.sourceOffset, "out-of-bounds", "Vertex element exceeds storage.");
      }
    };
    const xAlpha = (sub) => [2, 233].includes(sub.surfaces[0]?.metadata.format);
    const colorMask = (sub) => {
      const bits = sub.blend?.fields.renderTargets[0].colorMask ?? 15;
      return [1, 2, 4, 8].map((bit) => Boolean(bits & bit) && (bit !== 8 || !xAlpha(sub)));
    };
    const cachedState = (sub, program, drawingNow) => {
      const storage = (binding) => binding ? { generation: binding.resourceGeneration, metadata: binding.metadata, fields: binding.fields } : null;
      const key = JSON.stringify({ sub: sub.generation, program: program?.generation ?? null, programKey: program?.key ?? null, drawingNow,
        vertexElements: sub.vertexElements?.fields ?? null, vertexBuffers: sub.vertexBuffers.map(storage), indexBuffer: storage(sub.indexBuffer),
        targets: sub.surfaces.map(storage), depth: storage(sub.depthSurface), views: sub.views.map(slots => slots.map(storage)),
        samplers: sub.samplers.map(slots => slots.map(object => object ? { generation: object.generation, fields: object.fields } : null)),
        constants: sub.constants,
        blend: sub.blend?.fields ?? null,
        rasterizer: sub.rasterizer?.fields ?? null, dsa: sub.dsa?.fields ?? null, viewport: sub.viewport, scissor: sub.scissor,
        blendColor: sub.blendColor, stencilRef: sub.stencilRef, defaults: sub.defaults });
      let state = stateCache.get(sub, key);
      if (!state) {
        state = freeze({ blend: sub.blend?.fields ?? null, rasterizer: sub.rasterizer?.fields ?? null, dsa: sub.dsa?.fields ?? null,
          viewport: sub.viewport, scissor: sub.scissor, blendColor: [...sub.blendColor], stencilRef: { ...sub.stencilRef },
          mask: colorMask(sub), winsysY: sub.viewport?.scale[1] < 0 ? -1 : 1 });
        stateCache.put(sub, key, state, 512 + 2 * (key.length + JSON.stringify(state).length));
      }
      return { key, state };
    };
    const cacheInspection = () => ({ translation: translationCache.inspect(), program: programCache.inspect(), state: stateCache.inspect() });
    const appendFrame = (kind, entry) => {
      if (!activeFrame) return;
      const charge = 256 + 2 * JSON.stringify(entry).length;
      if (!activeFrame.complete || charge > cacheLimits.debugBytes - debugBytes) {
        activeFrame.complete = false; activeFrame.dropped[kind]++; return;
      }
      activeFrame[kind].push(freeze(entry)); debugBytes += charge;
    };
    const recordSubmission = (id, bytes, decoded, sequence) => {
      if (!activeFrame) return;
      if (!activeFrame.complete || decoded.byteLength * 4 + 1024 > cacheLimits.debugBytes - debugBytes) {
        activeFrame.complete = false; activeFrame.dropped.submissions++; return;
      }
      // Use intrinsic view access after decoder validation, never caller getters/iterators.
      const prototype = Object.getPrototypeOf(Uint8Array.prototype);
      const get = name => Object.getOwnPropertyDescriptor(prototype, name).get.call(bytes);
      const view = new Uint8Array(get("buffer"), get("byteOffset"), get("byteLength"));
      const hex = Array.from(view, byte => byte.toString(16).padStart(2, "0")).join("");
      appendFrame("submissions", { sequence, contextId: id, byteLength: decoded.byteLength, commandCount: decoded.commands.length, hex,
        provenance: { event: decoded.event, sourceSha256: decoded.sourceSha256 } });
    };
    const recordOutcome = (sequence, outcome) => appendFrame("outcomes", { sequence, ok: outcome.ok,
      appliedCommands: outcome.appliedCommands ?? 0, draws: outcome.draws?.length ?? 0, gpuComplete: outcome.gpuComplete ?? null,
      error: outcome.error ?? null });
    const advanceJob = job => { job.index++; work.appliedCommands++; };
    // Restoration also follows SET, CLEAR, binding changes and restoreContext.
    // A partial/invalid conditional or indirect bank remains CPU state but is never uploaded.
    const constantUploads = (program, banks, strict, approvedBanks = null) => Object.freeze((program?.uniforms ?? []).flatMap((uniform) => {
      const bank = banks[uniform.stage], count = uniform.uploadCount * 4;
      const shader = uniform.stage === 0 ? program.vertex : program.fragment;
      let words;
      if (shader.constantExactDomain || shader.constantConversionDomain || shader.constantRasterDomain || shader.constantRadialDomain || shader.constantAccess) {
        const checked = approvedBanks?.[uniform.stage] ?? (shader.constantExactDomain ?
          checkExactBank(bank, shader.constantExactDomain, shader.constantExactBase) : shader.constantConversionDomain ?
          checkConversionBank(bank, shader.constantConversionDomain, shader.constantConversionBase) : shader.constantRasterDomain ?
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
        // Every absent standard word is zeroed, including strict draws, so
        // shortening/reset cannot retain a preceding draw's native bank.
        if (strict && !standard) require(bank.length >= count, "incomplete-draw", "Drawing requires every active constant word.");
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
        samplingFor(sub, shaders[1], shaders[0]).key === program.samplingKey &&
        blendFoldFor(sub, shaders[1]) === program.blendFold &&
        sub.constants.every((bank, stage) => bank === banks[stage]),
      "stale-draw", "Draw shader, program or constant-bank identity changed.");
    };
    const restore = (sub, plan = null, constantAttributes = null) => {
      check(); vertexLayout(sub);
      if (plan) validateDrawPlan(plan);
      const program = plan ? plan.program : selectedProgram(sub);
      const { key: stateKey, state } = cachedState(sub, program, Boolean(plan));
      const uploads = plan ? plan.uploads : constantUploads(program, sub.constants, false);
      gl.bindVertexArray(sub.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sub.framebuffer);
      const surface = sub.surfaces[0] ?? null;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, surface ? resolve(surface.lease).storage.texture : null, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sub.depthSurface ? resolve(sub.depthSurface.lease).storage.texture : null, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
      // WebGL requires every enabled color buffer to have an active output.
      // A checked terminal discard may have no reflected output. Disable it
      // only for that draw; CLEAR and ordinary restoration retain the surface.
      const discardOnly = plan && (standard || program.fragment.discardContract?.alwaysDiscards === true) &&
        program.reflection.outputs.length === 1 && program.reflection.outputs[0].location === -1;
      gl.drawBuffers([surface && !discardOnly ? gl.COLOR_ATTACHMENT0 : gl.NONE]); gl.readBuffer(surface ? gl.COLOR_ATTACHMENT0 : gl.NONE);
      if (surface || sub.depthSurface) require(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "incomplete-framebuffer", "Framebuffer is incomplete.");
      gl.useProgram(program?.native ?? null);
      for (let slot = 0; slot < maxAttributes; slot++) {
        gl.disableVertexAttribArray(slot); gl.vertexAttribDivisor(slot, 0); gl.vertexAttrib4f(slot, 0, 0, 0, 1);
      }
      if (sub.vertexElements) for (const attribute of program?.reflection.attributes ?? []) {
        const element = sub.vertexElements.fields.elements[attribute.index], buffer = element ? sub.vertexBuffers[element.vertexBufferIndex] : null;
        if (!buffer) continue;
        if (standard && buffer.fields.stride === 0) {
          // State prefixes reset to the generic default. A draw supplies only
          // values collected from its retained, validated GPU read tickets.
          if (plan) gl.vertexAttrib4fv(attribute.location, constantAttributes.get(attribute.index).values);
          continue;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, resolve(buffer.lease).storage.buffer);
        gl.vertexAttribPointer(attribute.location, vertexComponents(element), gl.FLOAT, false, buffer.fields.stride, buffer.fields.offset + element.sourceOffset);
        // No admitted draw has an instance index >= the total-work ceiling.
        // Larger wire divisors therefore have the identical constant-zero fetch.
        if (standard) gl.vertexAttribDivisor(attribute.location, Math.min(element.instanceDivisor, DRAW_LIMITS.indicesPerSubmission));
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
          new DataView(block.data.buffer).setFloat32(640, state.winsysY, true);
          gl.bindBuffer(gl.UNIFORM_BUFFER, block.buffer); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, block.data);
          gl.uniformBlockBinding(program.native, block.index, 0); gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, block.buffer);
        }
        for (const upload of uploads) {
          const uniform = upload.uniform, words = new Uint32Array(upload.words);
          gl.uniform4uiv(uniform.location, words);
        }
        for (const sampler of program.samplers) gl.uniform1i(sampler.location, sampler.unit);
        if (program.blendFold) {
          const color = state.blendColor.map(value => Math.max(0, Math.min(1, value)));
          let factor = [8, 24].includes(program.blendFold) ? Array(3).fill(color[3]) : color.slice(0, 3);
          if ([23, 24].includes(program.blendFold)) factor = factor.map(value => 1 - value);
          gl.uniform4fv(program.blendUniform, new Float32Array([...factor, 1]));
        }
      }
      gl.bindBuffer(gl.UNIFORM_BUFFER, null);
      for (const target of [gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, gl.PIXEL_PACK_BUFFER, gl.PIXEL_UNPACK_BUFFER]) gl.bindBuffer(target, null);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (const pname of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS, gl.UNPACK_ROW_LENGTH,
        gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) gl.pixelStorei(pname, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      for (const cap of [gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.POLYGON_OFFSET_FILL,
        gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) gl.disable(cap);
      const dsa = state.dsa;
      if (dsa?.depthEnable) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      gl.depthMask(dsa?.depthWriteMask ?? false);
      gl.depthFunc([gl.NEVER, gl.LESS, gl.EQUAL, gl.LEQUAL, gl.GREATER, gl.NOTEQUAL, gl.GEQUAL, gl.ALWAYS][dsa?.depthFunction ?? 0]);
      gl.clearDepth(1); gl.clearStencil(0);
      gl.stencilMaskSeparate(gl.FRONT, 0); gl.stencilMaskSeparate(gl.BACK, 0);
      gl.stencilFuncSeparate(gl.FRONT, gl.NEVER, state.stencilRef.front, 0);
      gl.stencilFuncSeparate(gl.BACK, gl.NEVER, state.stencilRef.back, 0);
      gl.stencilOpSeparate(gl.FRONT_AND_BACK, gl.KEEP, gl.KEEP, gl.KEEP);
      gl.polygonOffset(0, 0); gl.lineWidth(1); gl.sampleCoverage(1, false);
      const rasterizer = state.rasterizer;
      if (rasterizer?.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      const scissor = state.scissor;
      gl.scissor(scissor?.minX ?? 0, scissor?.minY ?? 0, scissor ? scissor.maxX - scissor.minX : 0, scissor ? scissor.maxY - scissor.minY : 0);
      if (rasterizer?.cullFace === 2) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      // All supported resource flags are zero: pinned lower-left FBOs invert
      // Gallium front_ccw (vrend_update_frontface_state).
      gl.cullFace(gl.BACK); gl.frontFace(rasterizer?.frontCcw ? gl.CW : gl.CCW);
      const blend = state.blend, target = blend?.renderTargets[0];
      if (blend?.dither) gl.enable(gl.DITHER); else gl.disable(gl.DITHER);
      if (target?.blendEnable) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      const enabled = target?.blendEnable === true, ignoresRgbFactors = enabled && target.rgbFunction >= 3;
      gl.blendEquationSeparate(enabled ? gl[BLEND_EQUATIONS[target.rgbFunction]] : gl.FUNC_ADD,
        enabled ? gl[BLEND_EQUATIONS[target.alphaFunction]] : gl.FUNC_ADD);
      gl.blendFuncSeparate(enabled && !ignoresRgbFactors && !mixedBlendConstants(target) ? gl[BLEND_FACTORS[target.rgbSourceFactor]] : gl.ONE,
        enabled && !ignoresRgbFactors ? gl[BLEND_FACTORS[target.rgbDestinationFactor]] : gl.ZERO,
        enabled && target.alphaSourceFactor !== 6 ? gl[BLEND_FACTORS[target.alphaSourceFactor]] : gl.ONE,
        enabled ? gl[BLEND_FACTORS[target.alphaDestinationFactor]] : gl.ZERO);
      gl.blendColor(...state.blendColor);
      const mask = state.mask;
      gl.colorMask(...mask);
      if (state.viewport) {
        const { scale, translate } = state.viewport;
        gl.viewport(...viewportRectangle(state.viewport));
        gl.depthRange(translate[2] - scale[2], translate[2] + scale[2]);
      } else { gl.viewport(0, 0, 0, 0); gl.depthRange(0, 1); }
      check();
      return stateKey;
    };
    const prepareDraw = (ctx, sub, command, submission) => {
      const fields = command.fields;
      // VirGL1.3 uses zero to select an ordinary draw, still with one instance.
      const instances = standard ? Math.max(1, fields.instanceCount) : 1;
      require(fields.count > 0 && (fields.indexed ? fields.start === 0 : fields.start <= 0x7fffffff - fields.count),
        "unsupported-draw", "Draws must be nonempty; indexed start must be zero and array ranges must fit signed GL integers.");
      require(submission.draws.length < drawLimits.drawsPerSubmission && fields.count <= Math.floor((drawLimits.indicesPerSubmission - submission.indices) / instances),
        "limit-exceeded", "Submission draw or index budget exceeded.");
      require(sub.shaders.every(Boolean), "incomplete-draw", "Drawing requires both shader stages.");
      require(sub.surfaces[0] && sub.viewport && sub.vertexElements && (!fields.indexed || sub.indexBuffer),
        "incomplete-draw", "Drawing requires a surface, viewport, vertex elements and any indexed draw's index buffer.");
      require(!sub.dsa?.fields.depthEnable || sub.depthSurface, "incomplete-draw", "Active depth testing requires a Z16 depth attachment.");
      const banks = Object.freeze([...sub.constants]), shaders = Object.freeze([...sub.shaders]);
      // Presence and numeric authority apply to the complete declared prefix,
      // even if reflection prunes it. Reject before linking or any draw allocation.
      const approvedBanks = Object.freeze(shaders.map((shader, stage) => shader.constantExactDomain ?
        unwrap(checkExactBank(banks[stage], shader.constantExactDomain, shader.constantExactBase)) : shader.constantConversionDomain ?
        unwrap(checkConversionBank(banks[stage], shader.constantConversionDomain, shader.constantConversionBase)) : shader.constantRasterDomain ?
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
        require(standard || buffer.fields.stride !== 0, "unsupported-draw", "Gallium constant attributes with stride zero are unsupported.");
        resolve(buffer.lease);
        return { attribute, element, buffer };
      });
      vertexLayout(sub);
      const index = fields.indexed ? sub.indexBuffer : null, indexStorage = index ? resolve(index.lease) : null, indexOffset = index?.fields.offset ?? 0;
      // Pinned indexed draws use the index-binding byte offset; DRAW.start is not
      // added to it. Subtraction proves the range before multiplying or reading.
      const indexSize = index?.fields.indexSize ?? 0;
      require(!index || fields.count <= Math.floor((indexStorage.metadata.byteLength - indexOffset) / indexSize),
        "out-of-bounds", "Index draw range exceeds retained storage.");
      const indexByteLength = index ? fields.count * indexSize : 0;
      const constants = attributes.filter(({ buffer }) => buffer.fields.stride === 0);
      return Object.freeze({ ctx, sub, command, fields, instances, vertexWork: fields.count * instances,
        surface, attributes, constants, index, indexStorage, indexOffset, indexSize, indexByteLength,
        program, shaders, banks, uploads });
    };
    const issueDraw = (plan, bytes, submission, constantAttributes = null) => {
      const { ctx, sub, command, fields, instances, vertexWork, surface, attributes, indexStorage, indexOffset, indexSize, indexByteLength } = plan;
      const indices = fields.indexed ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
      let actualMinIndex = fields.indexed ? 0xffffffff : fields.start, actualMaxIndex = fields.indexed ? 0 : fields.start + fields.count - 1;
      for (let offset = 0; offset < indexByteLength; offset += indexSize) {
        const value = indexSize === 1 ? indices.getUint8(offset) : indexSize === 2 ? indices.getUint16(offset, true) : indices.getUint32(offset, true);
        // WebGL2's fixed primitive restart is always enabled. The wire profile
        // disables restart, so each index type's sentinel needs later lowering.
        require(value !== 2 ** (indexSize * 8) - 1, "unsupported-draw", standard ?
          "Fixed restart index requires unsupported primitive-restart lowering." : "Index 0xffff requires unsupported primitive-restart lowering.");
        actualMinIndex = Math.min(actualMinIndex, value); actualMaxIndex = Math.max(actualMaxIndex, value);
      }
      require(!standard || actualMaxIndex <= maxElementIndex, "unsupported-draw", "Actual vertex index exceeds the native maximum element index.");
      const vertexFetches = attributes.map(({ attribute, element, buffer }) => {
        const offset = buffer.fields.offset + element.sourceOffset, stride = buffer.fields.stride;
        const elementBytes = vertexComponents(element) * 4;
        const divisor = element.instanceDivisor;
        const constant = stride === 0;
        const first = constant || divisor ? 0 : actualMinIndex, last = constant ? 0 : divisor ? Math.floor((instances - 1) / divisor) : actualMaxIndex;
        // vertexLayout proved that the first complete element fits. Bound
        // the largest actual fetch with division, independent of wire hints.
        require(constant || last <= Math.floor((buffer.metadata.byteLength - offset - elementBytes) / stride),
          "out-of-bounds", "An actual vertex fetch exceeds retained storage.");
        return { attributeIndex: attribute.index, location: attribute.location,
          resourceId: buffer.metadata.id, resourceGeneration: buffer.resourceGeneration,
          stride, offset, components: vertexComponents(element), firstByte: offset + first * stride, requiredEnd: offset + last * stride + elementBytes,
          ...(standard ? { divisor, nativeDivisor: constant ? 0 : Math.min(divisor, DRAW_LIMITS.indicesPerSubmission), firstElement: first, lastElement: last,
            ...(constant ? { constant: true, componentWords: constantAttributes.get(attribute.index).words,
              genericValues: [...constantAttributes.get(attribute.index).values] } : {}) } : {}) };
      });
      // readStorage changes copy/pixel bindings. Restore every supported binding
      // after its synchronous GPU read, immediately before issuing the real draw.
      const stateKey = restore(sub, plan, constantAttributes);
      const mode = fields.mode === 5 ? gl.TRIANGLE_STRIP : gl.TRIANGLES;
      const indexType = indexSize === 1 ? gl.UNSIGNED_BYTE : indexSize === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
      if (fields.indexed) {
        if (instances > 1) gl.drawElementsInstanced(mode, fields.count, indexType, indexOffset, instances);
        else gl.drawElements(mode, fields.count, indexType, indexOffset);
      } else if (instances > 1) gl.drawArraysInstanced(mode, fields.start, fields.count, instances);
      else gl.drawArrays(mode, fields.start, fields.count);
      work.drawCalls++;
      check();
      work.draws++;
      submission.indices += vertexWork;
      submission.draws.push({ byteOffset: command.byteOffset, opcode: 8, count: fields.count, indexed: fields.indexed, mode: fields.mode, start: fields.start,
        indexOffset, indexByteLength, actualMinIndex, actualMaxIndex,
        ...(standard ? { instanceCount: fields.instanceCount, effectiveInstances: instances, vertexWork, indexSize } : {}),
        contextId: ctx.id, contextGeneration: ctx.generation, subContextId: sub.id, subContextGeneration: sub.generation,
        indexResourceId: indexStorage?.metadata.id ?? null, indexResourceGeneration: indexStorage?.generation ?? null,
        vertexFetches, framebuffer: { resourceId: surface.metadata.id, resourceGeneration: surface.generation,
          width: surface.metadata.width, height: surface.metadata.height,
          depthResourceId: sub.depthSurface?.metadata.id ?? null, depthResourceGeneration: sub.depthSurface?.resourceGeneration ?? null },
        vertexShader: ref(sub.shaders[0]), fragmentShader: ref(sub.shaders[1]) });
      if (activeFrame) {
        if (!activeFrame.programs.some(entry => entry.generation === plan.program.generation)) appendFrame("programs", {
          generation: plan.program.generation, key: plan.program.key, hash: hashKey(plan.program.key),
          vertexTGSI: plan.shaders[0].fields.text, fragmentTGSI: plan.shaders[1].fields.text,
          vertexESSL300: plan.program.vertexText, fragmentESSL300: plan.program.fragmentText, reflection: plan.program.reflection });
        appendFrame("draws", { number: work.draws, command: submission.draws.at(-1), programGeneration: plan.program.generation,
          programKey: plan.program.key, stateKey, stateHash: hashKey(stateKey), bindings: describeSub(sub).bindings,
          uploads: plan.uploads.map(upload => ({ stage: upload.uniform.stage, words: [...upload.words] })) });
      }
    };
    const draw = (ctx, sub, command, submission) => {
      const plan = prepareDraw(ctx, sub, command, submission);
      const bytes = plan.index ? unwrap(resources.readStorage(plan.index.lease,
        { x: plan.indexOffset, y: 0, z: 0, width: plan.indexByteLength, height: 1, depth: 1 })).bytes : null;
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
          require(scale[0] >= 0 && scale[0] * 2 <= maxViewport[0] && Math.abs(scale[1]) * 2 <= maxViewport[1] &&
            viewportRectangle(viewport).every((v) => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) &&
            translate[2] - scale[2] >= 0 && translate[2] + scale[2] <= 1 && scale[2] >= 0,
          "unsupported-feature", "Viewport must have integer bounded dimensions and a normalized GL depth range.");
          sub.viewport = viewport; break;
        }
        case 5: {
          const surfaces = fields.colorSurfaces.map((handle) => lookup(sub, handle, 8, true));
          const depthSurface = lookup(sub, fields.depthStencilSurface, 8, true);
          if (depthSurface) {
            require(depthSurface.metadata.kind === "depth-texture", "incompatible-resource", "The depth attachment requires a Z16 surface.");
            resolve(depthSurface.lease);
          }
          for (const surface of surfaces) if (surface) {
            require(surface.metadata.kind === "texture", "incompatible-resource", "A depth surface cannot be a color attachment.");
            resolve(surface.lease);
            require(!depthSurface || (surface.metadata.width === depthSurface.metadata.width && surface.metadata.height === depthSurface.metadata.height),
              "incompatible-resource", "Color and depth attachment dimensions differ.");
          }
          for (let index = 0; index < Math.max(sub.surfaces.length, surfaces.length); index++) objectRef(sub, sub.surfaces[index], surfaces[index]);
          sub.depthSurface = objectRef(sub, sub.depthSurface, depthSurface);
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
        case 7: {
          require(!(fields.buffers & 4) || sub.surfaces[0], "incomplete-framebuffer", "Color CLEAR needs a color surface.");
          require(!(fields.buffers & 1) || sub.depthSurface, "incomplete-framebuffer", "Depth CLEAR needs a Z16 depth surface.");
          restore(sub);
          // Gallium full clear ignores scissor and component/depth write masks.
          // Pinned vrend_clear restores these after issuing the complete clear.
          gl.disable(gl.SCISSOR_TEST);
          if (fields.buffers & 4) { gl.colorMask(true, true, true, !xAlpha(sub)); gl.clearColor(...fields.color); }
          if (fields.buffers & 1) { gl.depthMask(true); gl.clearDepth(fields.depth); }
          gl.clear((fields.buffers & 4 ? gl.COLOR_BUFFER_BIT : 0) | (fields.buffers & 1 ? gl.DEPTH_BUFFER_BIT : 0));
          gl.colorMask(...colorMask(sub)); gl.depthMask(sub.dsa?.fields.depthWriteMask ?? false);
          if (sub.rasterizer?.fields.scissor) gl.enable(gl.SCISSOR_TEST);
          check(); return;
        }
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
        case 15: if (fields.scissors.length) sub.scissor = fields.scissors[0]; break;
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
        case 9: case 43: case 45: {
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
      bindings: { blend: ref(sub.blend), rasterizer: ref(sub.rasterizer), dsa: ref(sub.dsa), vertexElements: ref(sub.vertexElements), depthSurface: ref(sub.depthSurface),
        vertexShader: ref(sub.shaders[0]), fragmentShader: ref(sub.shaders[1]), framebuffer: sub.surfaces.map(ref),
        vertexBuffers: sub.vertexBuffers.map((buffer) => buffer ? { ...buffer.fields, resourceGeneration: buffer.resourceGeneration } : null),
        indexBuffer: sub.indexBuffer ? { ...sub.indexBuffer.fields, resourceGeneration: sub.indexBuffer.resourceGeneration } : null,
        samplerViews: sub.views.map((slots) => slots.map(ref)), samplerStates: sub.samplers.map((slots) => slots.map(ref)),
        constants: sub.constants.map((words) => [...words]), viewport: sub.viewport, scissor: sub.scissor, blendColor: [...sub.blendColor],
        stencilRef: { ...sub.stencilRef }, framebufferDefaults: { ...sub.defaults } },
      programs: [...sub.programs.values()].map((program) => ({ vertexHandle: program.vertex.handle, fragmentHandle: program.fragment.handle,
        vertexGeneration: program.vertex.generation, fragmentGeneration: program.fragment.generation,
        key: program.key, generation: program.generation, interfaceKey: program.interfaceKey, samplingKey: program.samplingKey,
        samplingViews: program.samplingViews, variantBytes: program.variantBytes,
        reflection: program.reflection })), resets: { ...sub.resets } });
    const releaseJobAccess = (job) => {
      if (job.pending) {
        const pending = job.pending; job.pending = null;
        if (pending.reads) for (const read of pending.reads) unwrap(asyncAccess.release(read.ticket));
        else unwrap(asyncAccess.release(pending.ticket));
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
        if (job.pending.reads) for (const read of job.pending.reads) unwrap(asyncAccess.validate(read.ticket));
        else unwrap(asyncAccess.validate(job.pending.ticket));
      }
    };
    const pollAttributeReads = (pending, discard = false) => {
      let ready = true;
      for (const read of pending.reads) {
        if (read.ready) continue;
        const polled = unwrap(asyncAccess.poll(read.ticket, discard));
        if (polled.status === "pending") ready = false;
        else { read.ready = true; if (!discard) read.bytes = polled.bytes; }
      }
      return ready;
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
      work[job.error ? "failedSubmissions" : "completedSubmissions"]++; recordOutcome(job.sequence, completed);
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
            const ready = job.pending.reads ? pollAttributeReads(job.pending, true) :
              unwrap(asyncAccess.poll(job.pending.ticket, true)).status === "ready";
            if (!ready) return jobStatus(job, "waiting-gpu");
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
        if (job.phase === "waiting-attributes") {
          polling = true;
          if (!pollAttributeReads(job.pending)) return jobStatus(job, "waiting-gpu");
          polling = false; job.completedSerial = job.pending.fenceSerial;
          const constantAttributes = new Map(); let indexBytes = null;
          for (const read of job.pending.reads) {
            if (read.attributeIndex === undefined) indexBytes = read.bytes;
            else {
              const values = new Float32Array([0, 0, 0, 1]), words = [], view = new DataView(read.bytes.buffer, read.bytes.byteOffset, read.bytes.byteLength);
              for (let lane = 0; lane < read.bytes.byteLength / 4; lane++) {
                words.push(view.getUint32(lane * 4, true)); values[lane] = view.getFloat32(lane * 4, true);
              }
              constantAttributes.set(read.attributeIndex, { values, words });
            }
          }
          // Keep earlier collected tickets alive and revalidate the entire batch
          // in this task. A later read cannot hide a changed earlier source.
          validateJob(job);
          job.serial++; issueDraw(job.pending.plan, indexBytes, job.submission, constantAttributes);
          releaseJobAccess(job); advanceJob(job); budget--; job.phase = "ready";
        } else if (job.phase === "waiting-index" || job.phase === "waiting-transfer") {
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
          releaseJobAccess(job); advanceJob(job); budget--; job.phase = "ready";
        } else if (job.phase === "upload-ready") {
          job.serial++; unwrap(asyncAccess.upload(job.pending.ticket));
          releaseJobAccess(job); advanceJob(job); budget--; job.phase = "ready";
        }
        while (job.index < job.commands.length && budget > 0) {
          job.command = job.commands[job.index];
          const sub = job.ctx.subs.get(job.ctx.current);
          if (job.command.opcode === 8) {
            // Planning may link a program, so account for even a failed prefix.
            job.serial++;
            const plan = prepareDraw(job.ctx, sub, job.command, job.submission);
            if (plan.constants.length) {
              const reads = plan.constants.map(({ attribute, element, buffer }) => ({
                lease: buffer.lease, attributeIndex: attribute.index,
                box: { x: buffer.fields.offset + element.sourceOffset, y: 0, z: 0, width: vertexComponents(element) * 4, height: 1, depth: 1 },
              }));
              if (plan.index) reads.push({ lease: plan.index.lease,
                box: { x: plan.indexOffset, y: 0, z: 0, width: plan.indexByteLength, height: 1, depth: 1 } });
              require(reads.length <= 17 && reads.reduce((sum, read) => sum + read.box.width, 0) <= jobLimits.transferBytes,
                "limit-exceeded", "Constant attribute and index staging exceeds job limit.");
              job.pending = { sub, plan, reads: [], readStarted: false, fenceSerial: job.serial };
              for (const read of reads) {
                job.serial++;
                const access = unwrap(asyncAccess.beginStorageRead(read.lease, read.box));
                job.pending.reads.push({ ...access, attributeIndex: read.attributeIndex, ready: false });
                job.pending.readStarted = true; job.pending.fenceSerial = job.serial; job.hadFence = true;
              }
              job.phase = "waiting-attributes"; return jobStatus(job, "waiting-gpu");
            }
            if (!plan.index) {
              issueDraw(plan, null, job.submission); advanceJob(job); budget--; continue;
            }
            require(plan.indexByteLength <= jobLimits.transferBytes, "limit-exceeded", "Index staging exceeds job byte limit.");
            const read = unwrap(asyncAccess.beginStorageRead(plan.index.lease,
              { x: plan.indexOffset, y: 0, z: 0, width: plan.indexByteLength, height: 1, depth: 1 }));
            job.pending = { ...read, sub, plan, readStarted: true, fenceSerial: job.serial };
            job.hadFence = true; job.phase = "waiting-index"; return jobStatus(job, "waiting-gpu");
          }
          if ([9, 43, 45].includes(job.command.opcode)) {
            const prepared = unwrap(asyncAccess.prepareTransfer(job.ctx.id, job.command));
            job.pending = { ...prepared, sub, readStarted: false };
            require(prepared.layout.tightBytes <= jobLimits.transferBytes, "limit-exceeded", "Transfer exceeds job byte limit.");
            if (prepared.inline) { job.phase = "upload-ready"; return jobStatus(job, job.phase); }
            if (prepared.layout.direction === "upload") {
              job.request = transferRequest(job, prepared); job.phase = "needs-input"; return jobStatus(job, job.phase);
            }
            job.serial++; unwrap(asyncAccess.beginTransferRead(prepared.ticket));
            job.pending.readStarted = true; job.pending.fenceSerial = job.serial;
            job.hadFence = true; job.phase = "waiting-transfer"; return jobStatus(job, "waiting-gpu");
          }
          // END_TRANSFERS issues no GL work. Other state operations restore GL state.
          if (job.command.opcode !== 44) job.serial++;
          apply(job.ctx, job.command, job.submission); advanceJob(job); budget--;
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
        const sequence = ++work.submissions;
        const submission = drawing ? { draws: [], indices: 0 } : null;
        const drawResults = () => drawing ? { draws: submission.draws } : {};
        try {
          idle();
          const decoded = decodeCommands(bytes, provenance);
          if (!decoded.ok) {
            const rejected = freeze({ ...decoded, appliedCommands, ...drawResults() });
            work.failedSubmissions++; recordOutcome(sequence, rejected); return rejected;
          }
          work.decodedSubmissions++;
          const ctx = context(id);
          require(decoded.contextId === null || decoded.contextId === id, "invalid-provenance", "Context provenance disagrees with execution context.");
          recordSubmission(id, bytes, decoded, sequence);
          for (command of decoded.commands) { apply(ctx, command, submission); appliedCommands++; work.appliedCommands++; }
          const completed = success({ profile, appliedCommands, byteLength: decoded.byteLength, contextId: id, subContextId: ctx.current, ...drawResults() });
          work.completedSubmissions++; recordOutcome(sequence, completed); return completed;
        } catch (error) {
          const rejected = failure(error, { appliedCommands, ...drawResults() }, command);
          work.failedSubmissions++; recordOutcome(sequence, rejected); return rejected;
        }
      },
      restoreContext(id) { return result(() => { idle(); const ctx = context(id); restore(ctx.subs.get(ctx.current)); return success({ contextId: id, subContextId: ctx.current }); }); },
      resetCaches() { return result(() => {
        alive(); idle(); programCache.clear(); translationCache.clear(); stateCache.clear();
        activeFrame = null; lastFrame = null; debugBytes = 0; return success();
      }); },
      beginFrame(number) { return result(() => {
        alive(); idle(); require(Number.isSafeInteger(number) && number >= 0 && number > lastFrameNumber, "invalid-frame", "Host frame numbers must be increasing safe integers.");
        require(activeFrame === null, "busy", "A host frame capture is active.");
        require(cacheLimits.debugBytes >= 8192, "limit-exceeded", "Frame capture metadata budget is disabled.");
        lastFrame = null; debugBytes = 8192; lastFrameNumber = number;
        activeFrame = { schema: "virgl-render-frame-v1", number, authority: "host-labelled-frame", presented: false, complete: true,
          dropped: { submissions: 0, programs: 0, draws: 0, outcomes: 0 }, submissions: [], programs: [], draws: [], outcomes: [],
          start: { work: { ...work }, caches: cacheInspection() }, end: null };
        return success({ number });
      }); },
      endFrame(number) { return result(() => {
        alive(); idle(); require(activeFrame !== null && number === activeFrame.number, "invalid-frame", "No matching host frame capture.");
        activeFrame.end = { work: { ...work }, caches: cacheInspection() };
        // Header reserve plus independently charged records bounds the complete serialized payload.
        debugBytes = 256 + 2 * JSON.stringify(activeFrame).length;
        require(debugBytes <= cacheLimits.debugBytes, "limit-exceeded", "Frame capture exceeded its reserved metadata budget.");
        lastFrame = freeze(activeFrame); activeFrame = null; return success({ dump: lastFrame });
      }); },
      frameDump() { return result(() => { alive(); return success({ dump: lastFrame }); }); },
      inspect(id) { return result(() => {
        if (id !== undefined) { uint(id, "contextId"); require(contexts.has(id), "missing-context", "State context does not exist."); }
        const selected = id === undefined ? [...contexts.values()] : [contexts.get(id)];
        return success({ profile, disposed, limits, cacheLimits, hostUniformComponents, work: { ...work }, caches: cacheInspection(),
          debug: { activeFrame: activeFrame?.number ?? null, lastFrame: lastFrame?.number ?? null, complete: lastFrame?.complete ?? activeFrame?.complete ?? null },
          ...(drawing ? { drawLimits } : {}),
          ...(asynchronous ? { jobLimits, jobs: { active: activeJob === null ? 0 : 1, status: activeJob?.phase ?? "idle",
            appliedCommands: activeJob?.index ?? 0, commandCount: activeJob?.commands.length ?? 0,
            draws: activeJob?.submission.draws.length ?? 0,
            inputBytes: activeJob?.phase === "upload-ready" ? activeJob.pending.layout.tightBytes : 0,
            outputBytes: activeJob?.request?.bytes?.byteLength ?? 0,
            reads: asyncAccess.inspect().reads, transfers: asyncAccess.inspect().transfers, stagingBytes: asyncAccess.inspect().stagingBytes } } : {}),
          budgets: { contexts: contexts.size, subContexts: subCount, objects: objects.size, programs: programs.size,
            shaders: [...objects].filter((o) => o.type === 4).length, samplers: [...objects].filter((o) => o.type === 7).length,
            leases: leaseCount, shaderBytes, uniformBytes,
            cacheBytes: translationCache.inspect().bytes + programCache.inspect().bytes + stateCache.inspect().bytes, debugBytes },
          contexts: selected.map((ctx) => ({ id: ctx.id, generation: ctx.generation, resourceContextGeneration: ctx.resourceContextGeneration,
            currentSubContext: ctx.current, subContexts: [...ctx.subs.values()].map(describeSub) })) });
      }); },
      dispose() { return result(() => {
        if (disposed) return success();
        if (activeJob) {
          recordOutcome(activeJob.sequence, failure(new StateFault("cancelled", "Renderer disposed."), {
            appliedCommands: activeJob.index, draws: activeJob.submission.draws, gpuComplete: false }));
          work.failedSubmissions++; releaseJobAccess(activeJob); if (activeJob.sync) gl.deleteSync(activeJob.sync); activeJob = null;
        }
        for (const ctx of contexts.values()) for (const sub of ctx.subs.values()) disposeSub(sub);
        contexts.clear(); activeFrame = null; lastFrame = null; debugBytes = 0; disposed = true; return success();
      }); },
    };
    if (asynchronous) {
      // This entry point has no synchronous escape hatch while using the job profile.
      delete renderer.executeSubmission;
      Object.assign(renderer, {
        beginSubmission(id, bytes, provenance = {}) {
          return result(() => {
            const sequence = ++work.submissions;
            try {
            alive(); idle(); require(jobLimits.jobs > 0, "limit-exceeded", "Renderer jobs are disabled.");
            const decoded = decodeCommands(bytes, provenance);
            if (!decoded.ok) {
              const rejected = freeze({ ...decoded, appliedCommands: 0, draws: [] });
              work.failedSubmissions++; recordOutcome(sequence, rejected); return rejected;
            }
            work.decodedSubmissions++;
            require(decoded.byteLength <= jobLimits.submissionBytes, "limit-exceeded", "Submission exceeds job byte budget.");
            const ctx = context(id);
            require(decoded.contextId === null || decoded.contextId === id, "invalid-provenance", "Context provenance disagrees with execution context.");
            const token = Object.freeze({});
            recordSubmission(id, bytes, decoded, sequence);
            activeJob = { token, ctx, sequence, commands: decoded.commands, byteLength: decoded.byteLength, index: 0,
              command: null, submission: { draws: [], indices: 0 }, phase: "ready", pending: null, request: null,
              error: null, serial: 0, completedSerial: -1, hadFence: false, sync: null };
            return success({ job: token, profile, byteLength: decoded.byteLength, commandCount: decoded.commands.length });
            } catch (error) {
              const rejected = failure(error); work.failedSubmissions++; recordOutcome(sequence, rejected); return rejected;
            }
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
          validateJob(job); releaseJobAccess(job); advanceJob(job); job.phase = "ready"; return success();
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
