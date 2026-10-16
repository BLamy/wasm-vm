import {executeFramebufferBlit} from "./multisample.mjs";
import {createBooleanQueries} from "./queries.mjs";
import {PRODUCTION_RESOURCE_LIMITS} from "./resources.mjs";
/** Typed VirGL state and bounded triangle draws. See state-README.md and draw-README.md. */
import {byteColorFormat} from "./color-images.mjs";
import {floatColorFormat} from "./float-images.mjs";
import {packedFloatColorFormat} from "./packed-float-images.mjs";
import {integerColorFormat} from "./integer-images.mjs";
import {packedNormalizedColorFormat} from "./packed-normalized-images.mjs";
import {packedUnsignedColorFormat} from "./packed-unsigned-images.mjs";
import {floatingDepthFormat} from "./floating-depth-images.mjs";
import {unormDepthFormat, packedDepthFormat} from "./unorm-depth-images.mjs";
import { decodeSubmission, decodeStandardSubmission, decodeStandardUniformSubmission, decodeStandardImageSubmission, decodeStandardColorSubmission, decodeStandardFloatImageSubmission, decodeStandardPackedFloatImageSubmission, decodeStandardSharedExponentImageSubmission, decodeStandardIntegerImageSubmission, decodeStandardMultipleColorSubmission, decodeStandardPackedNormalizedImageSubmission, decodeStandardPackedUnsignedImageSubmission, decodeStandardFloatingDepthImageSubmission, decodeStandardUnormDepthImageSubmission, decodeStandardPackedDepthImageSubmission, decodeStandardStencilSubmission, decodeStandardShadowSamplerSubmission, decodeStandardDimensionalSubmission, decodeStandardDimensionalViewSubmission, decodeStandardDimensionalDepthViewSubmission, decodeStandardDimensionalColorSurfaceSubmission, decodeStandardDimensionalDepthSurfaceSubmission, decodeStandardStreamOutputSubmission, decodeProductionSubmission, vertexFormat } from "./decoder.mjs";
import { LIMITS as SHADER_LIMITS } from "../virgl-shader/index.mjs";
import { createKeyCache, hashKey } from "./cache.mjs";
import { parseConstantDomain, checkFiniteBank, checkIndirectBank, checkLoopBank, checkRadialBank, checkRasterBank, checkConversionBank, checkExactBank, COORDINATE_KEY, DISCARD_KEY,
  parseStandardShaderMetadata, normalizeStandardShaderResult, normalizeStandardShaderPair, normalizeStandardShaderTypedPair, deriveStandardShaderInterface, parseStandardUniformShaderMetadata,
  normalizeStandardUniformShaderResult, normalizeStandardUniformShaderPair, deriveStandardUniformShaderInterface, parseStandardTextureShaderMetadata, normalizeStandardTextureShaderResult, normalizeStandardTextureShaderPair, deriveStandardTextureShaderInterface,
  parseStandardIntegerImageShaderMetadata, normalizeStandardIntegerImageShaderResult, normalizeStandardIntegerImageShaderPair, deriveStandardIntegerImageShaderInterface,
  parseStandardMultipleColorShaderMetadata, normalizeStandardMultipleColorShaderResult, normalizeStandardMultipleColorShaderPair, deriveStandardMultipleColorShaderInterface,
  parseStandardInstanceBaseShaderMetadata, normalizeStandardInstanceBaseShaderResult, normalizeStandardInstanceBaseShaderPair, deriveStandardInstanceBaseShaderInterface,
  parseStandardShadowTextureShaderMetadata, normalizeStandardShadowTextureShaderResult, normalizeStandardShadowTextureShaderPair, deriveStandardShadowTextureShaderInterface,
  parseStandardDimensionalTextureShaderMetadata, normalizeStandardDimensionalTextureShaderResult, normalizeStandardDimensionalTextureShaderPair, deriveStandardDimensionalTextureShaderInterface,
  parseStandardDimensionalShadowTextureShaderMetadata, normalizeStandardDimensionalShadowTextureShaderResult, normalizeStandardDimensionalShadowTextureShaderPair, deriveStandardDimensionalShadowTextureShaderInterface,
  parseStandardStreamOutputShaderMetadata, normalizeStandardStreamOutputShaderResult, normalizeStandardStreamOutputShaderPair, deriveStandardStreamOutputShaderInterface, originalStreamOutputWords, selectOriginalStreamBuffer } from "./constant-domain.mjs";

export const STATE_PROFILE = "virgl-tiny-state-v1";
export const STATE_LIMITS = Object.freeze({ contexts: 8, subContexts: 16, objects: 256,
  programs: 64, shaderBytes: 1048576, uniformBytes: 65536 });
export const PRODUCTION_STATE_LIMITS = Object.freeze({ ...STATE_LIMITS,
  contexts: PRODUCTION_RESOURCE_LIMITS.contexts, subContexts: 64 });
export const DRAW_PROFILE = "virgl-tiny-indexed-draw-v1";
export const DRAW_LIMITS = Object.freeze({ drawsPerSubmission: 64, indicesPerSubmission: 65536 });
export const PRODUCTION_DRAW_LIMITS = Object.freeze({ drawsPerSubmission: 256, indicesPerSubmission: 262144 });
export const PRODUCTION_JOB_LIMITS = Object.freeze({ jobs: 1, commandsPerStep: 64, submissionBytes: 262144, transferBytes: 33554432 });
export const ASYNC_PROFILE = "virgl-tiny-async-jobs-v1";
export const STANDARD_ASYNC_PROFILE = "virgl-standard-async-jobs-v1";
export const STANDARD_UNIFORM_ASYNC_PROFILE = "virgl-standard-uniform-async-jobs-v1";
export const STANDARD_BUFFER_ASYNC_PROFILE = "virgl-standard-buffer-async-jobs-v1";
export const STANDARD_PACKED_FLOAT_IMAGE_ASYNC_PROFILE = "virgl-standard-r11g11b10-image-async-jobs-v1";
export const STANDARD_SHARED_EXPONENT_IMAGE_ASYNC_PROFILE = "virgl-standard-rgb9e5-image-async-jobs-v1";
export const STANDARD_INTEGER_IMAGE_ASYNC_PROFILE = "virgl-standard-integer-image-async-jobs-v1";
export const STANDARD_MULTIPLE_COLOR_ASYNC_PROFILE = "virgl-standard-multiple-color-async-jobs-v1";
export const STANDARD_PACKED_NORMALIZED_IMAGE_ASYNC_PROFILE = "virgl-standard-packed-normalized-image-async-jobs-v1";
export const STANDARD_PACKED_UNSIGNED_IMAGE_ASYNC_PROFILE = "virgl-standard-packed-unsigned-image-async-jobs-v1";
export const STANDARD_FLOATING_DEPTH_IMAGE_ASYNC_PROFILE = "virgl-standard-floating-depth-image-async-jobs-v1";
export const STANDARD_UNORM_DEPTH_IMAGE_ASYNC_PROFILE = "virgl-standard-unorm-depth-image-async-jobs-v1";
export const STANDARD_PACKED_DEPTH_IMAGE_ASYNC_PROFILE = "virgl-standard-packed-depth-image-async-jobs-v1";
export const STANDARD_STENCIL_ASYNC_PROFILE = "virgl-standard-stencil-async-jobs-v1";
export const STANDARD_ORDERED_STENCIL_ASYNC_PROFILE = "virgl-standard-ordered-stencil-async-jobs-v1";
export const STANDARD_SHADOW_SAMPLER_ASYNC_PROFILE = "virgl-standard-shadow-sampler-async-jobs-v1";
export const STANDARD_DIMENSIONAL_ASYNC_PROFILE = "virgl-standard-dimensional-rgba8-async-jobs-v1";
export const STANDARD_DIMENSIONAL_VIEW_ASYNC_PROFILE = "virgl-standard-dimensional-rgba8-view-async-jobs-v1";
export const STANDARD_DIMENSIONAL_DEPTH_VIEW_ASYNC_PROFILE = "virgl-standard-dimensional-depth-view-async-jobs-v1";
export const STANDARD_DIMENSIONAL_SHADOW_ASYNC_PROFILE = "virgl-standard-dimensional-shadow-async-jobs-v1";
export const STANDARD_DIMENSIONAL_COLOR_SURFACE_ASYNC_PROFILE = "virgl-standard-dimensional-color-surface-async-jobs-v1";
export const STANDARD_DIMENSIONAL_DEPTH_SURFACE_ASYNC_PROFILE = "virgl-standard-dimensional-depth-surface-async-jobs-v1";
export const STANDARD_INSTANCED_STENCIL_ASYNC_PROFILE = "virgl-standard-instanced-stencil-async-jobs-v1";
export const STANDARD_FLOAT_IMAGE_ASYNC_PROFILE = "virgl-standard-float-image-async-jobs-v1";
export const STANDARD_IMAGE_ASYNC_PROFILE = "virgl-standard-image-async-jobs-v1";
export const STANDARD_COLOR_ASYNC_PROFILE = "virgl-standard-byte-color-async-jobs-v1";
export const STANDARD_TEXTURE_ASYNC_PROFILE = "virgl-standard-texture-async-jobs-v1";
export const JOB_LIMITS = Object.freeze({ jobs: 1, commandsPerStep: 64, submissionBytes: 262144, transferBytes: 4194304 });
export const CACHE_LIMITS = Object.freeze({ translations: 128, translationBytes: 4194304,
  programBytes: 4194304, states: 256, stateBytes: 1048576, debugBytes: 4194304 });
const NAMES = ["NULL", "BLEND", "RASTERIZER", "DSA", "SHADER", "VERTEX_ELEMENTS", "SAMPLER_VIEW", "SAMPLER_STATE", "SURFACE", "QUERY", "STREAMOUT_TARGET"];
const BINDINGS = { 1: "blend", 2: "rasterizer", 3: "dsa", 5: "vertexElements" };
const DRAW_MODES = Object.freeze({ 0: "POINTS", 1: "LINES", 2: "LINE_LOOP", 3: "LINE_STRIP", 4: "TRIANGLES", 5: "TRIANGLE_STRIP", 6: "TRIANGLE_FAN" });
const vertexComponents = (element) => vertexFormat(element.sourceFormat).components;
const dimensionalSamplerTarget = (type, dimensionalShadows = false) => /sampler3D$/.test(type) ? 3 :
  (dimensionalShadows ? /samplerCube(?:Shadow)?$/ : /samplerCube$/).test(type) ? 4 :
  (dimensionalShadows ? /sampler2DArray(?:Shadow)?$/ : /sampler2DArray$/).test(type) ? 7 : 2;
function constantVertexValues(bytes, sourceFormat) {
  const format = vertexFormat(sourceFormat), values = format.integer ?
    format.kind === "sint" ? new Int32Array([0, 0, 0, 1]) : new Uint32Array([0, 0, 0, 1]) : new Float32Array([0, 0, 0, 1]), words = [];
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), output = new DataView(values.buffer);
  if (format.packed) {
    const packed = input.getUint32(0, true), signed = format.kind === "snorm" || format.kind === "sscaled";
    for (let lane = 0; lane < 4; lane++) {
      const bits = lane === 3 ? 2 : 10;
      const field = packed >>> (lane * 10) & (2 ** bits - 1);
      const scalar = signed && (field & 2 ** (bits - 1)) ? field - 2 ** bits : field;
      values[lane] = format.normalized ? signed ? Math.max(-1, scalar / (2 ** (bits - 1) - 1)) : scalar / (2 ** bits - 1) : scalar;
      words.push(output.getUint32(lane * 4, true));
    }
    return { values, words };
  }
  for (let lane = 0; lane < format.components; lane++) {
    const at = lane * format.scalarBytes;
    let value;
    if (format.kind === "float") value = input.getFloat32(at, true);
    else if (format.kind === "half") {
      const bits = input.getUint16(at, true), sign = bits & 0x8000 ? -1 : 1, exponent = bits >>> 10 & 31, fraction = bits & 1023;
      value = exponent === 31 ? fraction ? NaN : sign * Infinity :
        sign * (exponent === 0 ? fraction * 2 ** -24 : (1024 + fraction) * 2 ** (exponent - 25));
    } else {
      const signed = ["snorm", "sscaled", "sint"].includes(format.kind), bits = format.scalarBytes * 8;
      const scalar = format.scalarBytes === 1 ? signed ? input.getInt8(at) : input.getUint8(at) :
        format.scalarBytes === 2 ? signed ? input.getInt16(at, true) : input.getUint16(at, true) :
        signed ? input.getInt32(at, true) : input.getUint32(at, true);
      if (format.normalized) {
        value = signed ? Math.max(-1, scalar / (2 ** (bits - 1) - 1)) : scalar / (2 ** bits - 1);
      } else value = scalar;
    }
    values[lane] = value;
    // Preserve historical original float32 word custody. Compact values record
    // the actual generic binary32 result; the retained ticket owns source bytes.
    words.push(format.kind === "float" ? input.getUint32(at, true) : output.getUint32(lane * 4, true));
  }
  return { values, words };
}
const viewportRectangle = ({ scale, translate }) => [translate[0] - scale[0], translate[1] - Math.abs(scale[1]), scale[0] * 2, Math.abs(scale[1]) * 2];
const STENCIL_OPERATIONS = Object.freeze(["KEEP", "ZERO", "REPLACE", "INCR", "DECR", "INCR_WRAP", "DECR_WRAP", "INVERT"]);
const INACTIVE_STENCIL = Object.freeze({ enabled: false, function: 0, failOperation: 0,
  depthPassOperation: 0, depthFailOperation: 0, valueMask: 0, writeMask: 0 });
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

/** Original retained native constant-buffer ranges, explicitly selected by the host. */
export function createVirglStandardUniformAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true);
}

/** One original buffer allocation may serve all ordinary buffer roles. */
export function createVirglStandardBufferAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true);
}

/** Owned original 2D sampler ranges and framebuffer mip surfaces. */
export function createVirglStandardImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true);
}

/** Original byte colors, including signed samples and linear sRGB operations. */
export function createVirglStandardColorAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true);
}

/** Original sampling operations and native queries from retained image views. */
export function createVirglStandardTextureAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true);
}

/** Original floating native samples and framebuffer planes. */
export function createVirglStandardFloatImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true);
}

/** Original unsigned packed floating samples and framebuffer planes. */
export function createVirglStandardPackedFloatImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true);
}

/** Selected original RGB9E5 sampling with the existing qualified output family. */
export function createVirglStandardSharedExponentImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original typed images require this host-selected compiler and storage owner. */
export function createVirglStandardIntegerImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original multiple native color attachments require explicit host authority. */
export function createVirglStandardMultipleColorAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Selected original packed UNORM consumers reuse qualified FLOAT contracts. */
export function createVirglStandardPackedNormalizedImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Selected original packed UINT samplers and COLOR0..3 outputs. */
export function createVirglStandardPackedUnsignedImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Host capabilities are trusted and non-reentrant. */
/** Selected original non-shadow floating depth views and mip depth surfaces. */
export function createVirglStandardFloatingDepthImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original UN16 image storage and sampling require their explicit host factory. */
export function createVirglStandardUnormDepthImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Selected original packed UN24 views and mip depth surfaces. */
export function createVirglStandardPackedDepthImageAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original stencil state/clears on qualified combined depth-stencil storage. */
export function createVirglStandardStencilAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Selected native face passes retain original primitive order and vertex IDs. */
export function createVirglStandardOrderedStencilAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original instances and divisor phases survive ordered native face passes. */
export function createVirglStandardInstancedStencilAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original 2D depth comparisons use separately owned native sampler bindings. */
export function createVirglStandardShadowSamplerAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Selected original layered RGBA8 DMA with existing shader/surface admission. */
export function createVirglStandardDimensionalAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original dimensional sampler views use their separate compiler and range authority. */
export function createVirglStandardDimensionalViewAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Ordinary float-return samplers over retained original cube/array depth views. */
export function createVirglStandardDimensionalDepthViewAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original cube and array depth comparisons retain native sampler/view authority. */
export function createVirglStandardDimensionalShadowAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original one-layer RGBA8 framebuffer attachments over owned dimensional images. */
export function createVirglStandardDimensionalColorSurfaceAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

/** Original selected cube/array depth surfaces preserve level, layer and aspect. */
export function createVirglStandardDimensionalDepthSurfaceAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

export function createVirglStandardStreamOutputAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

export function createVirglProductionAsyncRenderer(options) {
  return createRenderer(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

function createRenderer(options, drawing, asynchronous = false, standard = false, uniform = false, bufferRoles = false, images = false, colors = false, textureOperations = false, floats = false, packed = false, shared = false, integers = false, multipleColors = false, normalized = false, unsigned = false, floatingDepth = false, unormDepth = false, packedDepth = false, stencil = false, orderedStencil = false, instanceBase = false, shadowSamplers = false, dimensional = false, dimensionalViews = false, dimensionalDepthViews = false, dimensionalShadows = false, dimensionalColorSurfaces = false, dimensionalDepthSurfaces = false, streamOutput = false, production = false) {
  return result(() => {
    const config = dataRecord(options, ["gl", "resources", "bindings", "shaderBridge", "limits", "cacheLimits", ...(drawing ? ["drawLimits"] : []), ...(asynchronous ? ["asyncAccess", "jobLimits"] : []), ...(standard ? ["primitiveAssembly"] : []), ...(uniform ? ["uniformAccess"] : []), ...(images ? ["imageAccess"] : []), ...(streamOutput ? ["streamOutputAccess"] : [])], ["gl", "resources", "bindings", "shaderBridge", ...(asynchronous ? ["asyncAccess"] : []), ...(uniform ? ["uniformAccess"] : []), ...(images ? ["imageAccess"] : []), ...(streamOutput ? ["streamOutputAccess"] : [])]);
    const { gl, resources, bindings, shaderBridge } = config;
    const primitiveAssembly = standard ? config.primitiveAssembly ?? "native" : "native";
    require(["native", "lists"].includes(primitiveAssembly), "invalid-input", "Unknown standard primitive assembly selection.");
    const assemblyLists = primitiveAssembly === "lists";
    require(gl && typeof gl.createVertexArray === "function" && typeof gl.uniform4uiv === "function", "invalid-input", "A WebGL2 context is required.");
    require(!instanceBase || typeof gl.uniform1ui === "function", "invalid-input", "Instance offsets require native uint binding.");
    require(!floats || gl.getExtension("EXT_color_buffer_float") && gl.getExtension("EXT_float_blend") && gl.getExtension("OES_texture_float_linear"),
      "unsupported-host", "Floating image draws require native floating storage, blending and filtering extensions.");
    const indexedColors = multipleColors ? gl.getExtension("OES_draw_buffers_indexed") : null;
    require(!multipleColors || indexedColors && typeof indexedColors.colorMaskiOES === "function" &&
      gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 4 && gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) >= 4,
    "unsupported-host", "Multiple colors require four native attachments and actual indexed color masks.");
    require(resources && ["inspect", "retainStorage", "releaseStorage", "prepareTransfer", "executeTransfer"].every((name) => typeof resources[name] === "function") &&
      bindings && typeof bindings.resolve === "function" && shaderBridge && typeof shaderBridge.translate === "function", "invalid-input", "Resource and shader capabilities are required.");
    require(!drawing || typeof resources.readStorage === "function", "invalid-input", "Drawing requires actual storage readback.");
    const stateLimits = production ? PRODUCTION_STATE_LIMITS : STATE_LIMITS;
    const supplied = dataRecord(config.limits ?? {}, Object.keys(stateLimits), []), limits = { ...stateLimits, ...supplied };
    for (const key of Object.keys(limits)) require(Number.isSafeInteger(limits[key]) && limits[key] >= 0 && limits[key] <= stateLimits[key], "invalid-input", "Limits may only tighten defaults.");
    Object.freeze(limits);
    const cacheLimits = { ...CACHE_LIMITS, ...dataRecord(config.cacheLimits ?? {}, Object.keys(CACHE_LIMITS), []) };
    for (const key of Object.keys(cacheLimits)) require(Number.isSafeInteger(cacheLimits[key]) && cacheLimits[key] >= 0 && cacheLimits[key] <= CACHE_LIMITS[key],
      "invalid-input", "Cache limits may only tighten defaults.");
    Object.freeze(cacheLimits);
    let drawLimits = null;
    if (drawing) {
      const drawCeiling = production ? PRODUCTION_DRAW_LIMITS : DRAW_LIMITS;
      const suppliedDraw = dataRecord(config.drawLimits ?? {}, Object.keys(drawCeiling), []);
      drawLimits = { ...drawCeiling, ...suppliedDraw };
      for (const key of Object.keys(drawLimits)) require(Number.isSafeInteger(drawLimits[key]) && drawLimits[key] >= 0 && drawLimits[key] <= drawCeiling[key],
        "invalid-input", "Draw limits may only tighten defaults.");
      Object.freeze(drawLimits);
    }
    const asyncAccess = config.asyncAccess;
    let jobLimits = null, activeJob = null;
    if (asynchronous) {
      require(asyncAccess && ["prepareTransfer", "validate", "provideInput", "upload", "beginTransferRead", "beginStorageRead", "poll", "release", "inspect"]
        .every((name) => typeof asyncAccess[name] === "function"), "invalid-input", "Asynchronous resource access is required.");
      const jobCeiling = production ? PRODUCTION_JOB_LIMITS : JOB_LIMITS;
      jobLimits = { ...jobCeiling, ...dataRecord(config.jobLimits ?? {}, Object.keys(jobCeiling), []) };
      for (const key of Object.keys(jobLimits)) require(Number.isSafeInteger(jobLimits[key]) && jobLimits[key] >= (key === "commandsPerStep" ? 1 : 0) && jobLimits[key] <= jobCeiling[key],
        "invalid-input", "Job limits may only tighten defaults; step budget must be positive.");
      Object.freeze(jobLimits);
    }
    const uniformAccess = uniform ? config.uniformAccess : null;
    require(!uniform || uniformAccess && ["capture", "validate", "submit", "release", "inspect"].every(name =>
      typeof uniformAccess[name] === "function") && typeof shaderBridge[integers ? "translatePairImages" : "translatePairUniforms"] === "function",
    "invalid-input", "Selected uniform range and compiler capabilities are required.");
    const imageAccess = images ? config.imageAccess : null;
    require(!images || imageAccess && ["capture", "resolve", "refresh", "hold", "holdStorage", "release", "inspect"].every(name => typeof imageAccess[name] === "function"),
      "invalid-input", "Original native image range authority is required.");
    require(!integers || typeof shaderBridge.translateImages === "function", "invalid-input", "Integer images require the selected stage compiler.");
    const integerFormat = format => integerColorFormat(format) || (unsigned ? packedUnsignedColorFormat(format) : null);
    const comparisonSampler = type => shadowSamplers && (type === "sampler2DShadow" || dimensionalShadows &&
      ["samplerCubeShadow", "sampler2DArrayShadow"].includes(type));
    const profile = streamOutput ? "virgl-standard-stream-output-async-jobs-v1" : dimensionalDepthSurfaces ? STANDARD_DIMENSIONAL_DEPTH_SURFACE_ASYNC_PROFILE : dimensionalColorSurfaces ? STANDARD_DIMENSIONAL_COLOR_SURFACE_ASYNC_PROFILE : dimensionalShadows ? STANDARD_DIMENSIONAL_SHADOW_ASYNC_PROFILE : dimensionalDepthViews ? STANDARD_DIMENSIONAL_DEPTH_VIEW_ASYNC_PROFILE : dimensionalViews ? STANDARD_DIMENSIONAL_VIEW_ASYNC_PROFILE : dimensional ? STANDARD_DIMENSIONAL_ASYNC_PROFILE : shadowSamplers ? STANDARD_SHADOW_SAMPLER_ASYNC_PROFILE : instanceBase ? STANDARD_INSTANCED_STENCIL_ASYNC_PROFILE : orderedStencil ? STANDARD_ORDERED_STENCIL_ASYNC_PROFILE : stencil ? STANDARD_STENCIL_ASYNC_PROFILE : packedDepth ? STANDARD_PACKED_DEPTH_IMAGE_ASYNC_PROFILE : unormDepth ? STANDARD_UNORM_DEPTH_IMAGE_ASYNC_PROFILE : floatingDepth ? STANDARD_FLOATING_DEPTH_IMAGE_ASYNC_PROFILE : unsigned ? STANDARD_PACKED_UNSIGNED_IMAGE_ASYNC_PROFILE : normalized ? STANDARD_PACKED_NORMALIZED_IMAGE_ASYNC_PROFILE : multipleColors ? STANDARD_MULTIPLE_COLOR_ASYNC_PROFILE : integers ? STANDARD_INTEGER_IMAGE_ASYNC_PROFILE : shared ? STANDARD_SHARED_EXPONENT_IMAGE_ASYNC_PROFILE : packed ? STANDARD_PACKED_FLOAT_IMAGE_ASYNC_PROFILE : floats ? STANDARD_FLOAT_IMAGE_ASYNC_PROFILE : textureOperations ? STANDARD_TEXTURE_ASYNC_PROFILE : colors ? STANDARD_COLOR_ASYNC_PROFILE : images ? STANDARD_IMAGE_ASYNC_PROFILE : bufferRoles ? STANDARD_BUFFER_ASYNC_PROFILE : uniform ? STANDARD_UNIFORM_ASYNC_PROFILE : standard ? STANDARD_ASYNC_PROFILE : asynchronous ? ASYNC_PROFILE : drawing ? DRAW_PROFILE : STATE_PROFILE;
    const decodeCommands = production ? decodeProductionSubmission : streamOutput ? decodeStandardStreamOutputSubmission : dimensionalDepthSurfaces ? decodeStandardDimensionalDepthSurfaceSubmission : dimensionalColorSurfaces ? decodeStandardDimensionalColorSurfaceSubmission : dimensionalDepthViews ? decodeStandardDimensionalDepthViewSubmission : dimensionalViews ? decodeStandardDimensionalViewSubmission : dimensional ? decodeStandardDimensionalSubmission : shadowSamplers ? decodeStandardShadowSamplerSubmission : stencil ? decodeStandardStencilSubmission : packedDepth ? decodeStandardPackedDepthImageSubmission : unormDepth ? decodeStandardUnormDepthImageSubmission : floatingDepth ? decodeStandardFloatingDepthImageSubmission : unsigned ? decodeStandardPackedUnsignedImageSubmission : normalized ? decodeStandardPackedNormalizedImageSubmission : multipleColors ? decodeStandardMultipleColorSubmission : integers ? decodeStandardIntegerImageSubmission : shared ? decodeStandardSharedExponentImageSubmission : packed ? decodeStandardPackedFloatImageSubmission : floats ? decodeStandardFloatImageSubmission : colors ? decodeStandardColorSubmission : images ? decodeStandardImageSubmission : uniform ? decodeStandardUniformSubmission : standard ? decodeStandardSubmission : decodeSubmission;
    const parseShaderMetadata = streamOutput ? parseStandardStreamOutputShaderMetadata : dimensionalShadows ? parseStandardDimensionalShadowTextureShaderMetadata : dimensionalViews ? parseStandardDimensionalTextureShaderMetadata : shadowSamplers ? parseStandardShadowTextureShaderMetadata : instanceBase ? parseStandardInstanceBaseShaderMetadata : multipleColors ? parseStandardMultipleColorShaderMetadata : integers ? parseStandardIntegerImageShaderMetadata : textureOperations ? parseStandardTextureShaderMetadata : uniform ? parseStandardUniformShaderMetadata : standard ? parseStandardShaderMetadata : parseConstantDomain;
    const captureAccess = streamOutput ? config.streamOutputAccess : null;
    require(!streamOutput || captureAccess && ['allocatePacked', 'release', 'markWritten'].every(k => typeof captureAccess[k] === 'function') && typeof shaderBridge.translateStreamOutput === 'function' && typeof shaderBridge.translatePairStreamOutput === 'function' && gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS) >= 64,
      'unsupported-host', 'Original capture requires its retained native capability and checked compiler.');
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
    const booleanQueries = production ? createBooleanQueries(gl, resources, require, unwrap, check) : null;
    check();
    const provoking = assemblyLists ? gl.getExtension("WEBGL_provoking_vertex") : null;
    require(!assemblyLists || provoking && typeof provoking.provokingVertexWEBGL === "function" &&
      provoking.LAST_VERTEX_CONVENTION_WEBGL === 0x8e4e,
    "unsupported-host", "Native list assembly requires an explicit last-vertex convention.");
    const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    const maxElementIndex = standard ? gl.getParameter(gl.MAX_ELEMENT_INDEX) : null;
    require(!standard || Number.isSafeInteger(maxElementIndex) && maxElementIndex >= 0 && maxElementIndex <= 0xffffffff,
      "unsupported-host", "WebGL maximum element index must be a u32.");
    const maxUnits = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
    const stageSlots = [Math.min(16, gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)), Math.min(16, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))];
    const maxViewport = [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)];
    const uniformBindings = gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS);
    const hostUniformComponents = [gl.getParameter(gl.MAX_VERTEX_UNIFORM_COMPONENTS), gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_COMPONENTS)];
    const uniformHost = uniform ? {
      vertex: gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS), fragment: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS),
      combined: gl.getParameter(gl.MAX_COMBINED_UNIFORM_BLOCKS), blockBytes: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),
      alignment: gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT),
    } : null;
    require(!uniform || Object.values(uniformHost).every(value => Number.isSafeInteger(value) && value > 0) &&
      uniformHost.vertex >= 14 && uniformHost.fragment >= 13 && uniformHost.combined >= 27 &&
      uniformHost.blockBytes >= 16384 && uniformBindings >= 27,
    "unsupported-host", "Native uniform limits cannot support the selected original banks.");
    let unusedUniformBuffer = null;
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
        require(Array.isArray(kind) ? kind.includes(binding.metadata.kind) : binding.metadata.kind === kind, "incompatible-resource", `Expected ${kind} storage.`);
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
          samplers: [Array(32).fill(null), Array(32).fill(null)], constants: [[], []], ...(streamOutput ? {streamTuple: null, streamTuples: new Map(), captureFragment: null} : {}),
          ...(uniform ? { uniformBuffers: [Array(13).fill(null), Array(13).fill(null)] } : {}), viewport: null, scissor: null,
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
      if (streamOutput) request = {...request, streamOutputWords: request.streamOutputWords ?? [0], captureBuffer: 0};
      const key = JSON.stringify([sub.generation, "stage", request.stage, request.text, ...(streamOutput ? [request.streamOutputWords] : []), ...(textureOperations ? [dimensionalShadows ? STANDARD_DIMENSIONAL_SHADOW_ASYNC_PROFILE : dimensionalDepthViews ? STANDARD_DIMENSIONAL_DEPTH_VIEW_ASYNC_PROFILE : dimensionalViews ? STANDARD_DIMENSIONAL_VIEW_ASYNC_PROFILE : shadowSamplers ? STANDARD_SHADOW_SAMPLER_ASYNC_PROFILE : instanceBase ? STANDARD_INSTANCED_STENCIL_ASYNC_PROFILE : unsigned ? STANDARD_PACKED_UNSIGNED_IMAGE_ASYNC_PROFILE : normalized ? STANDARD_PACKED_NORMALIZED_IMAGE_ASYNC_PROFILE : multipleColors ? STANDARD_MULTIPLE_COLOR_ASYNC_PROFILE : integers ? STANDARD_INTEGER_IMAGE_ASYNC_PROFILE : shared ? STANDARD_SHARED_EXPONENT_IMAGE_ASYNC_PROFILE : packed ? STANDARD_PACKED_FLOAT_IMAGE_ASYNC_PROFILE : floats ? STANDARD_FLOAT_IMAGE_ASYNC_PROFILE : STANDARD_TEXTURE_ASYNC_PROFILE] : [])]);
      const cached = translationCache.get(sub, key);
      if (cached) return cached;
      work.translations++;
      const response = streamOutput ? shaderBridge.translateStreamOutput({...request, signedColorMask: 0, unsignedColorMask: 0}) : integers ? shaderBridge.translateImages({ ...request, signedColorMask: 0, unsignedColorMask: 0 }) : shaderBridge.translate(request);
      const translated = streamOutput ? unwrap(normalizeStandardStreamOutputShaderResult(response, request.stage)) : dimensionalShadows ? unwrap(normalizeStandardDimensionalShadowTextureShaderResult(response, request.stage)) : dimensionalViews ? unwrap(normalizeStandardDimensionalTextureShaderResult(response, request.stage)) : shadowSamplers ? unwrap(normalizeStandardShadowTextureShaderResult(response, request.stage)) : instanceBase ? unwrap(normalizeStandardInstanceBaseShaderResult(response, request.stage)) : multipleColors ? unwrap(normalizeStandardMultipleColorShaderResult(response, request.stage)) : integers ? unwrap(normalizeStandardIntegerImageShaderResult(response, request.stage)) : textureOperations ? unwrap(normalizeStandardTextureShaderResult(response, request.stage)) : uniform ? unwrap(normalizeStandardUniformShaderResult(response, request.stage)) : standard ? unwrap(normalizeStandardShaderResult(response, request.stage)) : freeze(unwrap(response));
      unwrap(parseShaderMetadata(translated.metadata, request.stage));
      require(!streamOutput || JSON.stringify(originalStreamOutputWords(translated.metadata)) === JSON.stringify(request.streamOutputWords), 'shader-domain-error', 'Checked compiler changed original capture words.');
      require(typeof translated.glsl === "string" && /^#version 300 es\b/m.test(translated.glsl),
        "shader-error", "Shader bridge returned incompatible output.");
      translationCache.put(sub, key, translated, 1024 + 2 * (key.length + JSON.stringify(translated).length));
      return translated;
    };
    const translatedPair = (sub, vertex, fragment, interfaceKey, validate, inputTypes = null, bufferZeroMask = 0, colorOutputs = null, captureBuffer = -1) => {
      const key = JSON.stringify([sub.generation, "pair", vertex.fields.text, fragment.fields.text, interfaceKey, ...(streamOutput ? [vertex.fields.streamOutputWords, captureBuffer] : []),
        ...(inputTypes?.key ? [inputTypes.key] : []), ...(uniform ? [bufferZeroMask] : []), ...(integers ? [colorOutputs.key] : []), ...(textureOperations ? [dimensionalShadows ? STANDARD_DIMENSIONAL_SHADOW_ASYNC_PROFILE : dimensionalDepthViews ? STANDARD_DIMENSIONAL_DEPTH_VIEW_ASYNC_PROFILE : dimensionalViews ? STANDARD_DIMENSIONAL_VIEW_ASYNC_PROFILE : shadowSamplers ? STANDARD_SHADOW_SAMPLER_ASYNC_PROFILE : instanceBase ? STANDARD_INSTANCED_STENCIL_ASYNC_PROFILE : unsigned ? STANDARD_PACKED_UNSIGNED_IMAGE_ASYNC_PROFILE : normalized ? STANDARD_PACKED_NORMALIZED_IMAGE_ASYNC_PROFILE : multipleColors ? STANDARD_MULTIPLE_COLOR_ASYNC_PROFILE : integers ? STANDARD_INTEGER_IMAGE_ASYNC_PROFILE : shared ? STANDARD_SHARED_EXPONENT_IMAGE_ASYNC_PROFILE : packed ? STANDARD_PACKED_FLOAT_IMAGE_ASYNC_PROFILE : floats ? STANDARD_FLOAT_IMAGE_ASYNC_PROFILE : STANDARD_TEXTURE_ASYNC_PROFILE] : [])]);
      const cached = translationCache.get(sub, key);
      if (cached) { validate(cached); return cached; }
      work.pairTranslations++;
      const request = { vertexText: vertex.fields.text, fragmentText: fragment.fields.text };
      const masks = inputTypes?.key ? { signedMask: inputTypes.signedMask, unsignedMask: inputTypes.unsignedMask } : null;
      const selectors = { signedMask: inputTypes?.signedMask ?? 0, unsignedMask: inputTypes?.unsignedMask ?? 0,
        packedSignedMask: inputTypes?.packedSignedMask ?? 0, packedNormalizedMask: inputTypes?.packedNormalizedMask ?? 0, bufferZeroMask,
        ...(integers ? { signedColorMask: colorOutputs.signedColorMask, unsignedColorMask: colorOutputs.unsignedColorMask } : {}) };
      const response = streamOutput ? shaderBridge.translatePairStreamOutput({...request, ...selectors, streamOutputWords: vertex.fields.streamOutputWords, captureBuffer: Math.max(0, captureBuffer)}) : integers ? shaderBridge.translatePairImages({ ...request, ...selectors }) : uniform ? shaderBridge.translatePairUniforms({ ...request, ...selectors }) : inputTypes?.packedSignedMask ? shaderBridge.translatePairVertexFormats({ ...request, ...masks,
        packedSignedMask: inputTypes.packedSignedMask, packedNormalizedMask: inputTypes.packedNormalizedMask }) :
        masks ? shaderBridge.translatePairTyped({ ...request, ...masks }) : shaderBridge.translatePair(request);
      const translated = streamOutput ? unwrap(normalizeStandardStreamOutputShaderPair(response, selectors)) : dimensionalShadows ? unwrap(normalizeStandardDimensionalShadowTextureShaderPair(response, selectors)) : dimensionalViews ? unwrap(normalizeStandardDimensionalTextureShaderPair(response, selectors)) : shadowSamplers ? unwrap(normalizeStandardShadowTextureShaderPair(response, selectors)) : instanceBase ? unwrap(normalizeStandardInstanceBaseShaderPair(response, selectors)) : multipleColors ? unwrap(normalizeStandardMultipleColorShaderPair(response, selectors)) : integers ? unwrap(normalizeStandardIntegerImageShaderPair(response, selectors)) : textureOperations ? unwrap(normalizeStandardTextureShaderPair(response, selectors)) : uniform ? unwrap(normalizeStandardUniformShaderPair(response, selectors)) : standard ? unwrap(masks ? normalizeStandardShaderTypedPair(response, masks) :
        normalizeStandardShaderPair(response)) : freeze(unwrap(response));
      validate(translated);
      translationCache.put(sub, key, translated, 1024 + 2 * (key.length + JSON.stringify(translated).length));
      return translated;
    };
    const collectObject = (sub, object) => {
      if (object.references !== 0) return;
      sub.live.delete(object); objects.delete(object);
      if (object.type === 9) booleanQueries.destroy(sub, object);
      if (object.imageRange) unwrap(imageAccess.release(object.imageRange));
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
      if (streamOutput) {
        for (const tuple of sub.streamTuples.values()) for (const target of tuple.targets) if (target) objectRef(sub, target, null);
        sub.streamTuples.clear(); sub.streamTuple = null;
        if (sub.captureFragment) {objectRef(sub, sub.captureFragment, null);sub.captureFragment = null;}
      }
      for (const program of [...sub.programs.values()]) deleteProgram(sub, program);
      translationCache.removeOwner(sub); stateCache.removeOwner(sub);
      for (const surface of sub.surfaces) objectRef(sub, surface, null);
      sub.surfaces = [];
      sub.depthSurface = objectRef(sub, sub.depthSurface, null);
      for (const slots of sub.views) for (let slot = 0; slot < slots.length; slot++) slots[slot] = objectRef(sub, slots[slot], null);
      for (let stage = 0; stage < 2; stage++) sub.shaders[stage] = objectRef(sub, sub.shaders[stage], null);
      for (const buffer of sub.vertexBuffers) if (buffer) release(buffer.lease);
      if (sub.indexBuffer) release(sub.indexBuffer.lease);
      if (uniform) for (const bank of sub.uniformBuffers.flat()) if (bank) release(bank.lease);
      for (const object of [...sub.names.values()]) destroyObject(sub, object);
      gl.deleteVertexArray(sub.vao); gl.deleteFramebuffer(sub.framebuffer); subCount--;
    };
    const createObject = (ctx, sub, command) => {
      let fields = command.fields; const type = command.objectType;
      require(!sub.names.has(fields.handle), "duplicate-object", "Object handle is already public.");
      require(objects.size < limits.objects, "limit-exceeded", "Live object limit exceeded.");
      const object = { handle: fields.handle, type, name: command.objectName, generation: generation(), fields, public: true, references: 1 };
      try {
        if (type === 9 && production) {
          Object.assign(object, retain(ctx, fields.resourceHandle, 'query', 'query-buffer'));
          unwrap(resources.validateQueryStorage(object.lease)); booleanQueries.create(object);
        }
        if (type === 10 && streamOutput) {
          Object.assign(object, retain(ctx, fields.resourceHandle, "stream-output", "standard-buffer"));
          require(fields.bufferOffset <= object.metadata.byteLength && fields.bufferSize <= object.metadata.byteLength - fields.bufferOffset, "out-of-bounds", "Original stream-output target exceeds retained storage.");
        }
        if (type === 5) {
          require(fields.elements.length <= maxAttributes, "limit-exceeded", "Vertex elements exceed host attribute slots.");
          if (!standard) for (const element of fields.elements) require(element.sourceOffset % 4 === 0, "invalid-state", "Vertex element offset must be float-aligned.");
        }
        if (type === 6 || type === 8) {
          const floating = floatingDepth && Boolean(floatingDepthFormat(fields.format)) || unormDepth && Boolean(unormDepthFormat(fields.format)) || packedDepth && Boolean(packedDepthFormat(fields.format));
          const depth = type === 8 && (fields.format === 16 || floating);
          Object.assign(object, retain(ctx, fields.resourceHandle, depth ? "depth-surface" : type === 6 ? "view" : "surface", floating ? ["depth-texture", "mip-depth-texture", ...((dimensionalDepthViews && type === 6 || dimensionalDepthSurfaces && type === 8) ? ["dimensional-depth-texture"] : [])] : depth ? "depth-texture" : images ? ["texture", "mip-texture", ...(dimensionalViews && type === 6 || dimensionalColorSurfaces && type === 8 && (fields.format === 67 || production) ? ["dimensional-texture"] : [])] : "texture"));
          if (production && type === 6 && fields.target === 0) {
            fields = {...fields,target:object.metadata.target}; object.fields = fields;
            require(fields.target === 2 ? fields.firstLayer === 0 && fields.lastLayer === 0 : fields.target === 3 ? fields.firstLayer === 0 && fields.lastLayer === 0 : fields.target === 4 ? fields.firstLayer === 0 && fields.lastLayer === 5 : fields.firstLayer <= fields.lastLayer && fields.lastLayer < object.metadata.arraySize,
              "incompatible-resource", "Implicit original sampler target has an invalid layer range.");
          }
          require(object.metadata.format === fields.format, "incompatible-resource", "View format and storage format differ.");
          if (images && (!depth || floating)) {
            if (type === 6) {
              if (dimensionalViews) require(object.metadata.target === fields.target, "incompatible-resource", "Original view target and retained storage target differ.");
              object.imageRange = unwrap(imageAccess.capture(object.lease, fields.firstLevel, fields.lastLevel,
                ...(dimensionalViews && fields.target !== 2 ? [fields.firstLayer, fields.lastLayer] : []))).token;
            }
            else {
              require(fields.level <= object.metadata.lastLevel, "out-of-bounds", "Surface mip level exceeds retained image levels.");
              const level = object.metadata.levels?.[fields.level] ?? object.metadata;
              if (dimensionalColorSurfaces) require(fields.firstLayer === fields.lastLayer &&
                ((object.metadata.kind === "dimensional-texture" || dimensionalDepthSurfaces && object.metadata.kind === "dimensional-depth-texture") ? fields.firstLayer < level.layers : fields.firstLayer === 0),
              "out-of-bounds", "Original surface layer exceeds its retained mip.");
              object.dimensions = Object.freeze({ width: level.width, height: level.height, level: fields.level,
                ...(dimensionalColorSurfaces ? { layer: fields.firstLayer } : {}) });
            }
          }
        }
        if (type === 4) {
          const translated = translatedStage(sub, { stage: fields.stageName, text: fields.text, ...(streamOutput ? {streamOutputWords: fields.streamOutputWords} : {}) });
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
          const address = wrap => wrap === 0 ? gl.REPEAT : wrap === 2 ? gl.CLAMP_TO_EDGE : gl.MIRRORED_REPEAT;
          const imageFilter = fields.minImageFilter === 0 ? gl.NEAREST : gl.LINEAR;
          const minFilter = !standard || fields.minMipFilter === 2 ? imageFilter :
            fields.minMipFilter === 0 ? (fields.minImageFilter === 0 ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_NEAREST) :
              (fields.minImageFilter === 0 ? gl.NEAREST_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_LINEAR);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_WRAP_S, standard ? address(fields.wrapS) : gl.CLAMP_TO_EDGE);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_WRAP_T, standard ? address(fields.wrapT) : gl.CLAMP_TO_EDGE);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_WRAP_R, address(fields.wrapR));
          gl.samplerParameteri(object.sampler, gl.TEXTURE_MIN_FILTER, minFilter);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_MAG_FILTER, fields.magImageFilter === 0 ? gl.NEAREST : gl.LINEAR);
          gl.samplerParameteri(object.sampler, gl.TEXTURE_COMPARE_MODE, shadowSamplers && fields.compareMode === 1 ? gl.COMPARE_REF_TO_TEXTURE : gl.NONE);
          if (standard) gl.samplerParameteri(object.sampler, gl.TEXTURE_COMPARE_FUNC, gl.NEVER + fields.compareFunction);
          gl.samplerParameterf(object.sampler, gl.TEXTURE_MIN_LOD, fields.minLod);
          gl.samplerParameterf(object.sampler, gl.TEXTURE_MAX_LOD, fields.maxLod);
        }
        check();
        if (object.shader) shaderBytes += object.shaderBytes;
        sub.names.set(object.handle, object); sub.live.add(object); objects.add(object);
      } catch (error) {
        if (type === 9 && object.queryParts) booleanQueries.destroy(sub, object);
        if (object.imageRange) unwrap(imageAccess.release(object.imageRange));
        if (object.lease) release(object.lease);
        if (object.shader) gl.deleteShader(object.shader);
        if (object.sampler) gl.deleteSampler(object.sampler);
        throw error;
      }
    };
    const unitFor = (stage, index) => stage === 1 ? index : 16 + index;
    const colorsFor = (sub, fragment) => {
      if (multipleColors) {
        const metadata = fragment.translation.metadata, emitted = metadata.broadcastColor0 ? 15 :
          metadata.outputs.reduce((mask, output) => mask | (1 << output.semanticIndex), 0);
        let signedColorMask = 0, unsignedColorMask = 0;
        const formats = Array.from({ length: 4 }, (_, slot) => sub.surfaces[slot]?.metadata.format ?? 0);
        for (const [slot, format] of formats.entries()) if (emitted & (1 << slot)) {
          const image = integerFormat(format);
          if (image?.signed === true) signedColorMask |= 1 << slot;
          else if (image?.signed === false) unsignedColorMask |= 1 << slot;
        }
        return { signedColorMask, unsignedColorMask, key: "multiple-color-formats-v1:" + formats.join(":") };
      }
      const format = sub.surfaces[0]?.metadata.format ?? 0, image = integerFormat(format);
      return { signedColorMask: image?.signed === true ? 1 : 0, unsignedColorMask: image?.signed === false ? 1 : 0,
        key: "integer-image-color0-v1:" + format };
    };
    const selectedBlendFold = (sub, fragment) => multipleColors ?
      sub.surfaces.some((surface, slot) => surface && !integerFormat(surface.metadata.format) &&
        (fragment.translation.metadata.broadcastColor0 || fragment.translation.metadata.outputs.some(output => output.semanticIndex === slot))) ? blendFoldFor(sub, fragment) : 0 :
      integers && integerFormat(sub.surfaces[0]?.metadata.format) ? 0 : blendFoldFor(sub, fragment);
    const nativeColorOutputs = metadata => {
      if (!multipleColors || !metadata.broadcastColor0) return metadata.outputs;
      const source = metadata.outputs[0];
      return Array.from({ length: 4 }, (_, slot) => ({ ...source, semanticIndex: slot, name: "fsout_c" + slot,
        type: metadata.colorOutputMasks.signedMask & (1 << slot) ? "ivec4" :
          metadata.colorOutputMasks.unsignedMask & (1 << slot) ? "uvec4" : "vec4",
        ...(slot ? { broadcastFrom: source.index } : {}) }));
    };
    const depthFormat = format => floatingDepth && floatingDepthFormat(format) ||
      unormDepth && unormDepthFormat(format) || packedDepth && packedDepthFormat(format);
    const samplingFor = (sub, fragment, vertex = null) => {
      const declarations = standard ? [[0, vertex], [1, fragment]].flatMap(([stage, shader]) =>
        shader.translation.metadata.samplers.map(sampler => ({ stage, sampler }))) :
        fragment.translation.metadata.samplers.map(sampler => ({ stage: 1, sampler }));
      const views = declarations.map(({ stage, sampler }) => {
        require((comparisonSampler(sampler.type) || dimensionalViews && /^(?:i|u)?sampler(?:3D|Cube|2DArray)$/.test(sampler.type) || (integers ? ["sampler2D", "isampler2D", "usampler2D"].includes(sampler.type) : sampler.type === "sampler2D")) && Number.isInteger(sampler.index) && sampler.index >= 0 && sampler.index < (standard ? 16 : 8) &&
          sampler.name === (stage === 0 ? "vssamp" : "fssamp") + sampler.index,
        "shader-link-error", "View specialization requires the checked stage 2D TEX family.");
        const view = sub.views[stage][sampler.index], fields = view?.fields;
        const target = dimensionalViews ? dimensionalSamplerTarget(sampler.type, dimensionalShadows) : 2;
        if (dimensionalViews && fields) require(fields.target === target && (target === 2 || (fields.format === 67 || production && !depthFormat(fields.format)) &&
          (production ? /^(?:i|u)?sampler(?:3D|Cube|2DArray)$/.test(sampler.type) : ["sampler3D", "samplerCube", "sampler2DArray"].includes(sampler.type)) || dimensionalDepthViews && [4, 7].includes(target) &&
          depthFormat(fields.format) && ["samplerCube", "sampler2DArray", ...(dimensionalShadows ? ["samplerCubeShadow", "sampler2DArrayShadow"] : [])].includes(sampler.type)),
        "incompatible-resource", "Original sampler dimension or return type disagrees with retained storage.");
        if (integers && fields) {
          const image = integerFormat(fields.format), nativeType = dimensionalViews && target !== 2 ? (production ? `${image ? image.signed ? "i" : "u" : ""}sampler${({3:"3D",4:"Cube",7:"2DArray"})[target]}` : sampler.type) : image ? image.signed ? "isampler2D" : "usampler2D" : "sampler2D";
          require(comparisonSampler(sampler.type) ? Boolean(depthFormat(fields.format)) : sampler.type === nativeType, "incompatible-resource", "Original sampler return type disagrees with retained image storage.");
        }
        // Linking may precede view binding. The fixed legacy RGBA identity
        // specialization is safe then; draw validation still requires a view.
        return { ...(standard ? { stage } : {}), ...(integers ? { type: sampler.type } : {}), index: sampler.index, name: sampler.name, target, format: fields?.format ?? 67,
          firstLevel: images ? fields?.firstLevel ?? 0 : 0, lastLevel: images ? fields?.lastLevel ?? 0 : 0, firstLayer: dimensionalViews ? fields?.firstLayer ?? 0 : 0, lastLayer: dimensionalViews ? fields?.lastLayer ?? 0 : 0, origin: "lower-left",
          swizzle: fields?.swizzle ?? [0, 1, 2, 3] };
      });
      const key = views.length ? `sampler-view-v1:${JSON.stringify(views)}` : "";
      const identity = views.every((view) => view.format === 67 && view.swizzle.every((value, lane) => value === lane));
      return freeze({ key, suffix: identity ? "" : `|${key}`, views });
    };
    const specializeViews = (text, sampling, stage = 1) => {
      const specialized = sampling.views.filter((view) => (!standard || view.stage === stage) && (comparisonSampler(view.type) ? Boolean(unormDepthFormat(view.format) || packedDepthFormat(view.format)) : view.swizzle.some((value, lane) => value !== lane)));
      if (!specialized.length) return null;
      let helpers = "";
      for (const view of specialized) {
        if (dimensionalShadows && ["samplerCubeShadow", "sampler2DArrayShadow"].includes(view.type)) {
          const gradient = view.type === "samplerCubeShadow" ? "vec3" : "vec2";
          const coordinate = "vec4(coord.xyz,clamp(coord.w,0.0,1.0))";
          for (const [operation, parameters, argumentsText] of [
            ["texture", "vec4 coord", coordinate],
            ["textureGrad", `vec4 coord,${gradient} dx,${gradient} dy`, `${coordinate},dx,dy`]
          ]) {
            const name = `wv_shadow_ref_${view.index}_${operation}`,
              pattern = new RegExp(`\\b${operation}\\s*\\(\\s*${view.name}\\s*,`, "g");
            let hits = 0;
            text = text.replace(pattern, () => { hits++; return `${name}(`; });
            if (hits) {
              helpers += `float ${name}(${parameters}){return ${operation}(${view.name},${argumentsText});}\n`;
              if (operation === "texture" && stage === 1 && view.type === "samplerCubeShadow")
                helpers += `float ${name}(vec4 coord,float bias){return texture(${view.name},${coordinate},bias);}\n`;
            }
          }
          continue;
        }
        if (shadowSamplers && view.type === "sampler2DShadow") {
          // GLES fixed-depth comparisons clamp the post-projective reference.
          // Derive the clamp from the original retained format instead of
          // relying on a native implementation to apply it implicitly.
          const operations = [["texture", "vec3 coord", "vec3(coord.xy,clamp(coord.z,0.0,1.0))"],
            ["textureLod", "vec3 coord,float lod", "vec3(coord.xy,clamp(coord.z,0.0,1.0)),lod"],
            ["textureGrad", "vec3 coord,vec2 dx,vec2 dy", "vec3(coord.xy,clamp(coord.z,0.0,1.0)),dx,dy"],
            ["textureProj", "vec4 coord", "vec4(coord.xy,clamp(coord.z/coord.w,0.0,1.0)*coord.w,coord.w)"]];
          for (const [operation, parameters, argumentsText] of operations) {
            const name = `wv_shadow_ref_${view.index}_${operation}`,
              pattern = new RegExp(`\\b${operation}\\s*\\(\\s*${view.name}\\s*,`, "g");
            let hits = 0;
            text = text.replace(pattern, () => { hits++; return `${name}(`; });
            if (hits) {
              helpers += `float ${name}(${parameters}){return ${operation}(${view.name},${argumentsText});}\n`;
              if (operation === "texture" && stage === 1)
                helpers += `float ${name}(vec3 coord,float bias){return texture(${view.name},vec3(coord.xy,clamp(coord.z,0.0,1.0)),bias);}\n`;
            }
          }
          continue;
        }
        const type = view.type === "isampler2D" ? "ivec4" : view.type === "usampler2D" ? "uvec4" : "vec4",
          lanes = ["v.r", "v.g", "v.b", "v.a", type === "uvec4" ? "0u" : type === "ivec4" ? "0" : "0.0", type === "uvec4" ? "1u" : type === "ivec4" ? "1" : "1.0"],
          swizzle = view.swizzle.map(value => lanes[value]).join(",");
        const coordinate = dimensionalViews && view.target !== 2 ? "vec3" : "vec2",
          gradient = dimensionalViews && [3, 4].includes(view.target) ? "vec3" : "vec2";
        const operations = dimensionalViews && view.target !== 2 ? [
          ["texture", `${coordinate} coord`, "coord"], ["textureLod", `${coordinate} coord,float lod`, "coord,lod"],
          ...(view.target !== 4 ? [["texelFetch", "ivec3 coord,int lod", "coord,lod"]] : []),
          ["textureGrad", `${coordinate} coord,${gradient} dx,${gradient} dy`, "coord,dx,dy"],
          ...(view.target === 3 ? [["textureProj", "vec4 coord", "coord"]] : [])
        ] : textureOperations ? [
          ["texture", "vec2 coord", "coord"], ["textureLod", "vec2 coord,float lod", "coord,lod"],
          ["texelFetch", "ivec2 coord,int lod", "coord,lod"], ["textureGrad", "vec2 coord,vec2 dx,vec2 dy", "coord,dx,dy"],
          ...(shadowSamplers ? [["textureProj", "vec4 coord", "coord"]] : [])
        ] : [["texture", "vec2 coord", "coord"]];
        let total = 0;
        for (const [operation, parameters, argumentsText] of operations) {
          const name = textureOperations ? `wv_view_${view.index}_${operation}` : `wv_view_${view.index}`, pattern = new RegExp(`\\b${operation}\\s*\\(\\s*${view.name}\\s*,`, "g");
          let hits = 0;
          text = text.replace(pattern, () => { hits++; return `${name}(`; }); total += hits;
          if (hits) {
            helpers += `${type} ${name}(${parameters}){${type} v=${operation}(${view.name},${argumentsText});return ${type}(${swizzle});}\n`;
            if (textureOperations && operation === "texture" && stage === 1)
              helpers += `${type} ${name}(${coordinate} coord,float bias){${type} v=texture(${view.name},coord,bias);return ${type}(${swizzle});}\n`;
          }
        }
        require(textureOperations || total > 0, "shader-link-error", "Checked TEX sampler has no emitted lookup to specialize.");
      }
      if (textureOperations && !helpers) return null;
      const main = text.indexOf("\nvoid main(");
      require(main >= 0, "shader-link-error", "Checked shader has no main insertion point.");
      const variant = text.slice(0, main + 1) + helpers + text.slice(main + 1);
      require(variant.length <= SHADER_LIMITS.glslBytes, "limit-exceeded", "View-specialized GLSL exceeds the compiler output bound.");
      return variant;
    };
    const specializeBlend = (text, fold, metadata, sub) => {
      if (!fold) return null;
      require((multipleColors || metadata.outputs.length === 1 && metadata.outputs[0].name === "fsout_c0" &&
        metadata.outputs[0].type === "vec4") && !text.includes("wv_rgb_blend_factor") && !text.includes("wv_unblended_main"),
      "shader-link-error", "Constant blend folding requires the checked single color output.");
      const main = /\bvoid\s+main\s*\(\s*(?:void)?\s*\)/g;
      require([...text.matchAll(main)].length === 1, "shader-link-error", "Constant blend folding requires one checked main.");
      const assignments = multipleColors ? nativeColorOutputs(metadata).filter(output => output.type === "vec4").map(output => {
        const format = sub.surfaces[output.semanticIndex]?.metadata.format,
          floating = Boolean(floatColorFormat(format) || packedFloatColorFormat(format));
        const source = output.name + ".rgb";
        return source + "=" + (floating ? source : "clamp(" + source + ",0.0,1.0)") + "*wv_rgb_blend_factor.rgb;";
      }).join("") : "fsout_c0.rgb=clamp(fsout_c0.rgb,0.0,1.0)*wv_rgb_blend_factor.rgb;";
      const variant = text.replace(main, "void wv_unblended_main(void)") +
        "\nuniform highp vec4 wv_rgb_blend_factor;\nvoid main(void){wv_unblended_main();" +
        assignments + "}\n";
      require(variant.length <= SHADER_LIMITS.glslBytes, "limit-exceeded", "Blend-specialized GLSL exceeds the compiler output bound.");
      return variant;
    };
    const inputTypesFor = (sub, vertex) => {
      let signedMask = 0, unsignedMask = 0, packedSignedMask = 0, packedNormalizedMask = 0;
      if (standard) for (const attribute of vertex.translation.metadata.attributes) {
        const element = sub.vertexElements?.fields.elements[attribute.index];
        const format = element ? vertexFormat(element.sourceFormat) : null;
        if (format?.integer) {
          if (format.kind === "sint") signedMask |= 1 << attribute.index;
          else unsignedMask |= 1 << attribute.index;
        } else if (format?.packed && (format.kind === "snorm" || format.kind === "sscaled") &&
                   sub.vertexBuffers[element.vertexBufferIndex]?.fields.stride > 0) {
          packedSignedMask |= 1 << attribute.index;
          if (format.normalized) packedNormalizedMask |= 1 << attribute.index;
        }
      }
      return Object.freeze({ signedMask, unsignedMask, packedSignedMask, packedNormalizedMask,
        key: packedSignedMask ? `vertex-format-v1:${signedMask}:${unsignedMask}:${packedSignedMask}:${packedNormalizedMask}` :
          signedMask || unsignedMask ? `integer-input-v1:${signedMask}:${unsignedMask}` : "" });
    };
    const zeroMask = (sub, vertex, fragment) => uniform ? [vertex, fragment].reduce((mask, shader, stage) =>
      mask | (sub.uniformBuffers[stage][0] && shader.translation.metadata.uniforms.length ? 1 << stage : 0), 0) : 0;
    const promotedMetadata = (metadata, stage, mask) => {
      if (!(mask & (1 << stage))) return metadata;
      const bank = metadata.uniforms[0], prefix = stage === 0 ? "VS" : "FS";
      return { ...metadata, uniforms: [], guestUniformBlocks: [{ name: `Virgl${prefix}Const0`, stage: metadata.stage,
        slot: 0, byteLength: bank.count * 16, encoding: "raw-32bit-words",
        members: [{ name: bank.name, type: "uvec4[]", count: bank.count, offset: 0, arrayStride: 16 }] }, ...metadata.guestUniformBlocks] };
    };
    const unusedUniformStorage = (reserveSystem) => {
      if (unusedUniformBuffer) return unusedUniformBuffer;
      require(16384 + (reserveSystem ? 656 : 0) <= limits.uniformBytes, "limit-exceeded", "Unreferenced native block backing exceeds the uniform budget.");
      while (16384 + (reserveSystem ? 656 : 0) > limits.uniformBytes - uniformBytes)
        require(programCache.evict(), "limit-exceeded", "Unreferenced native block backing cannot fit beside the system block.");
      const buffer = gl.createBuffer(); require(buffer, "backend-error", "Unreferenced native block backing allocation failed.");
      try { gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferData(gl.UNIFORM_BUFFER, 16384, gl.STATIC_DRAW); check(); }
      catch (error) { gl.deleteBuffer(buffer); throw error; }
      unusedUniformBuffer = buffer; uniformBytes += 16384; return buffer;
    };
    function link(sub, vertex, fragment, captureBuffer = -1) {
      require(vertex?.fields.stage === 0 && fragment?.fields.stage === 1, "missing-shader", "Link requires a vertex shader and a fragment shader.");
      const sampling = samplingFor(sub, fragment, vertex);
      const blendFold = selectedBlendFold(sub, fragment), colorOutputs = integers ? (captureBuffer >= 0 || streamOutput && fragment === sub.captureFragment) ? {signedColorMask: 0, unsignedColorMask: 0, key: "capture-native-float-v1"} : colorsFor(sub, fragment) : null;
      const inputTypes = inputTypesFor(sub, vertex);
      let vs = vertex.translation.metadata;
      let fs = fragment.translation.metadata;
      const bufferZeroMask = zeroMask(sub, vertex, fragment);
      let fragmentBase = fragment.translation.glsl;
      if (streamOutput && captureBuffer >= 0) {vs = selectOriginalStreamBuffer(vs, captureBuffer);fs = selectOriginalStreamBuffer(fs, captureBuffer);}
      const interfaceInfo = standard ? (() => {
        const owned = unwrap(streamOutput ? deriveStandardStreamOutputShaderInterface(vs, fs) : dimensionalShadows ? deriveStandardDimensionalShadowTextureShaderInterface(vs, fs) : dimensionalViews ? deriveStandardDimensionalTextureShaderInterface(vs, fs) : shadowSamplers ? deriveStandardShadowTextureShaderInterface(vs, fs) : instanceBase ? deriveStandardInstanceBaseShaderInterface(vs, fs) : multipleColors ? deriveStandardMultipleColorShaderInterface(vs, fs) : integers ? deriveStandardIntegerImageShaderInterface(vs, fs) : textureOperations ? deriveStandardTextureShaderInterface(vs, fs) : uniform ? deriveStandardUniformShaderInterface(vs, fs) : deriveStandardShaderInterface(vs, fs));
        return { ...owned, inputs: new Map(owned.inputs.map(input => [input.semanticIndex, input])) };
      })() : shaderInterface(vs, fs, fragment.coordinateContract, fragment.discardContract);
      // Generations identify these exact owned immutable bodies/metadata, not public names.
      // Derive the complete pair interface even when another vertex used this fragment.
      const key = `${sub.generation}:${vertex.generation}:${fragment.generation}:${interfaceInfo.key}|${sampling.key}` + (streamOutput ? `|capture:${captureBuffer}` : "") +
        (blendFold ? `|blend-source-constant-v1:${blendFold}` : "") + (inputTypes.key ? `|${inputTypes.key}` : "") + (uniform ? `|buffer-zero:${bufferZeroMask}` : "") + (integers ? `|${colorOutputs.key}` : "");
      const cached = programCache.get(sub, key);
      if (cached) return cached;
      const program = { key, generation: generation(), vertex, fragment, native: null, blocks: [], uniforms: [], samplers: [],
        interfaceKey: interfaceInfo.key, samplingKey: sampling.key, samplingViews: sampling.views, inputKey: inputTypes.key,
        ...(integers ? { colorKey: colorOutputs.key } : {}),
        variantShader: null, fragmentVariantShader: null, variantBytes: 0,
        blendFold, blendUniform: null,
        reflection: { attributes: [], uniforms: [], samplers: [], uniformBlocks: [], outputs: [], ...(standard ? { systemValues: [], rasterUniforms: [] } : {}), ...(textureOperations ? { textureQueries: [] } : {}), ...(instanceBase ? { instanceUniforms: [] } : {}), ...(shadowSamplers ? { shadowUniforms: [] } : {}) },
        ...(standard ? { rasterUniforms: [] } : {}), ...(uniform ? { guestBlocks: [], bufferZeroMask } : {}), ...(textureOperations ? { textureQueries: [] } : {}), ...(instanceBase ? { instanceUniforms: [] } : {}), ...(shadowSamplers ? { shadowUniforms: [] } : {}) };
      try {
        if (standard || interfaceInfo.flat || interfaceInfo.coordinates || interfaceInfo.discard) {
          require(typeof shaderBridge.translatePair === "function", "shader-link-error", interfaceInfo.coordinates ?
            "Fragment coordinates require the checked pair compiler." : interfaceInfo.discard ?
            "Fragment discard requires the checked pair compiler." : "Flat interpolation requires the checked pair compiler.");
          require(integers ? typeof shaderBridge.translatePairImages === "function" : uniform ? typeof shaderBridge.translatePairUniforms === "function" : inputTypes.packedSignedMask ? typeof shaderBridge.translatePairVertexFormats === "function" :
            !inputTypes.key || typeof shaderBridge.translatePairTyped === "function", "shader-link-error", "Vertex formats require the checked pair compiler.");
          const typedAttribute = attribute => ({ ...attribute, type: inputTypes.signedMask & (1 << attribute.index) ? "ivec4" :
            inputTypes.unsignedMask & (1 << attribute.index) ? "uvec4" : "vec4" });
          const expectedVertex = { ...(uniform ? promotedMetadata(vs, 0, bufferZeroMask) : vs), ...(standard ? { inputs: vs.inputs.map(typedAttribute), attributes: vs.attributes.map(typedAttribute) } : {}),
            outputs: vs.outputs.map((output) => output.semantic === "GENERIC" ?
            { ...output, ...(standard ? { type: interfaceInfo.inputs.get(output.semanticIndex)?.interpolation === "flat" ? "uvec4" : "vec4" } : {}),
              interpolation: interfaceInfo.inputs.get(output.semanticIndex)?.interpolation ?? "smooth" } : output) };
          const expectedFragment = uniform ? promotedMetadata(fs, 1, bufferZeroMask) : fs;
          const selectedFragment = integers ? { ...expectedFragment,
            outputs: expectedFragment.outputs.map(output => ({ ...output,
              type: colorOutputs.signedColorMask & (1 << (multipleColors ? output.semanticIndex : 0)) ? "ivec4" : colorOutputs.unsignedColorMask & (1 << (multipleColors ? output.semanticIndex : 0)) ? "uvec4" : "vec4" })),
            colorOutputMasks: { signedMask: colorOutputs.signedColorMask, unsignedMask: colorOutputs.unsignedColorMask } } : expectedFragment;
          const pair = translatedPair(sub, vertex, fragment, interfaceInfo.key, (pair) => require(pair.interfaceKey === interfaceInfo.key &&
            (uniform || pair.fragment?.glsl === fragment.translation.glsl) && JSON.stringify(pair.fragment?.metadata) === JSON.stringify(selectedFragment) &&
            typeof pair.vertex?.glsl === "string" && pair.vertex.glsl.length <= SHADER_LIMITS.glslBytes &&
            /^#version 300 es\b/m.test(pair.vertex.glsl) && JSON.stringify(pair.vertex.metadata) === JSON.stringify(expectedVertex),
          "shader-link-error", "Pair compiler output does not match the selected shader interface."), inputTypes, bufferZeroMask, colorOutputs, captureBuffer);
          if (streamOutput) program.streamOutput = pair.vertex.metadata.streamOutput;
          if (standard || interfaceInfo.flat) {
            program.vertexText = pair.vertex.glsl; vs = pair.vertex.metadata;
            if (uniform) { fragmentBase = pair.fragment.glsl; fs = pair.fragment.metadata; }
          }
        }
        let fragmentText = specializeViews(fragmentBase, sampling);
        fragmentText = specializeBlend(fragmentText ?? fragmentBase, blendFold, fs, sub) ?? fragmentText;
        program.vertexText ??= vertex.translation.glsl;
        program.vertexText = (standard ? specializeViews(program.vertexText, sampling, 0) : null) ?? program.vertexText;
        program.fragmentText = fragmentText ?? fragmentBase;
        if (uniform) fragmentText = program.fragmentText === fragment.translation.glsl ? null : program.fragmentText;
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
        work.programLinks++; if (streamOutput && captureBuffer >= 0) gl.transformFeedbackVaryings(program.native, program.streamOutput.varyings.map(v => v.name), gl.INTERLEAVED_ATTRIBS);
        gl.linkProgram(program.native);
        require(gl.getProgramParameter(program.native, gl.LINK_STATUS), "shader-link-error", `WebGL program link failed: ${gl.getProgramInfoLog(program.native)}`);
        if (streamOutput && captureBuffer >= 0) {
          const expected = program.streamOutput.varyings;
          require(gl.getProgramParameter(program.native, gl.TRANSFORM_FEEDBACK_VARYINGS) === expected.length && gl.getProgramParameter(program.native, gl.TRANSFORM_FEEDBACK_BUFFER_MODE) === gl.INTERLEAVED_ATTRIBS, "shader-reflection-error", "Native capture varying count/mode mismatch.");
          program.reflection.streamOutput = expected.map((varying, index) => {
            const actual = gl.getTransformFeedbackVarying(program.native, index);
            require(actual && actual.name === varying.name && actual.size === 1 && actual.type === [null, gl.UNSIGNED_INT, gl.UNSIGNED_INT_VEC2, gl.UNSIGNED_INT_VEC3, gl.UNSIGNED_INT_VEC4][varying.components], "shader-reflection-error", "Native capture varying type/order mismatch.");
            return {...varying, nativeType: actual.type, size: actual.size};
          });
        }
        for (let index = 0; index < gl.getProgramParameter(program.native, gl.ACTIVE_ATTRIBUTES); index++) {
          const actual = gl.getActiveAttrib(program.native, index), declared = vs.attributes.find((attribute) => attribute.name === actual.name);
          const system = standard ? vs.systemValues.find(value => value.name === actual.name) : null;
          if (system) {
            require(actual.type === gl.INT && actual.size === 1 && gl.getAttribLocation(program.native, actual.name) === -1,
              "shader-reflection-error", "Built-in system value must not expose a bound vertex attribute.");
            program.reflection.systemValues.push({ ...system, location: -1, type: actual.type });
            continue;
          }
          require(declared && actual.type === ({ vec4: gl.FLOAT_VEC4, ivec4: gl.INT_VEC4, uvec4: gl.UNSIGNED_INT_VEC4 })[declared.type] &&
            actual.size === 1 && declared.index < maxAttributes, "shader-reflection-error", "Unknown active vertex attribute.");
          const location = gl.getAttribLocation(program.native, actual.name);
          require(location >= 0, "shader-reflection-error", "Missing vertex attribute location.");
          program.reflection.attributes.push({ ...declared, location, type: actual.type });
        }
        for (const [stage, metadata] of [[0, vs], [1, fs]]) {
          if (shadowSamplers) for (const uniform of metadata.shadowUniforms) {
            const location = gl.getUniformLocation(program.native, uniform.name),
              index = gl.getUniformIndices(program.native, [uniform.name])?.[0];
            const active = location !== null || index !== gl.INVALID_INDEX;
            if (active) {
              require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
                gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === gl.FLOAT_VEC4 &&
                gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1,
              "shader-reflection-error", "Shadow view control reflection mismatch.");
              const value = gl.getUniform(program.native, location);
              require(ArrayBuffer.isView(value) && value.length === 4 && [...value].every(component => component === 0),
                "shader-reflection-error", "Shadow view controls require native zero defaults.");
            }
            program.shadowUniforms.push({ stage, index: uniform.index, semantic: uniform.semantic, location, active });
            program.reflection.shadowUniforms.push({ ...uniform, stage: metadata.stage, active, nativeType: gl.FLOAT_VEC4 });
          }
          if (instanceBase) for (const uniform of metadata.instanceUniforms) {
            require(stage === 0 && uniform.name === "wv_instance_base" && uniform.type === "uint" &&
              uniform.semantic === "INSTANCE_BASE" && uniform.default === 0,
            "shader-reflection-error", "Unsupported instance offset metadata.");
            const location = gl.getUniformLocation(program.native, uniform.name);
            const index = gl.getUniformIndices(program.native, [uniform.name])?.[0];
            const active = location !== null || index !== gl.INVALID_INDEX;
            if (active) require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === gl.UNSIGNED_INT &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1 &&
              gl.getUniform(program.native, location) === 0,
            "shader-reflection-error", "Instance offset reflection mismatch.");
            program.instanceUniforms.push({ location, active });
            program.reflection.instanceUniforms.push({ ...uniform, stage: metadata.stage, active, nativeType: gl.UNSIGNED_INT });
          }
          if (standard) for (const uniform of metadata.rasterUniforms) {
            const pointSize = uniform.semantic === "POINT_SIZE";
            require(pointSize ? stage === 0 && uniform.name === "wv_point_size" && uniform.type === "vec2" :
              stage === 1 && uniform.semantic === "POINT_COORD_Y" && uniform.name === "wv_point_coord_y" && uniform.type === "float",
            "shader-reflection-error", "Unsupported raster uniform metadata.");
            const type = pointSize ? gl.FLOAT_VEC2 : gl.FLOAT;
            const location = gl.getUniformLocation(program.native, uniform.name), index = gl.getUniformIndices(program.native, [uniform.name])?.[0];
            const active = location !== null || index !== gl.INVALID_INDEX;
            if (active) require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === type &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1,
            "shader-reflection-error", "Raster uniform reflection mismatch.");
            else require(!pointSize, "shader-reflection-error", "Missing native point-size binding.");
            program.rasterUniforms.push({ semantic: uniform.semantic, location });
            program.reflection.rasterUniforms.push({ ...uniform, stage: metadata.stage, active, nativeType: type });
          }
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
          if (textureOperations) for (const query of metadata.textureQueries) {
            const location = gl.getUniformLocation(program.native, query.name), index = gl.getUniformIndices(program.native, [query.name])?.[0];
            const active = location !== null || index !== gl.INVALID_INDEX;
            if (active) require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === gl.INT &&
              gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1,
              "shader-reflection-error", "Native original texture query reflection mismatch.");
            program.textureQueries.push({ stage, index: query.index, location, active });
            program.reflection.textureQueries.push({ ...query, stage: metadata.stage, active, nativeType: gl.INT });
          }
          for (const sampler of metadata.samplers) {
            const nativeType = ({ sampler2D: gl.SAMPLER_2D, isampler2D: gl.INT_SAMPLER_2D, usampler2D: gl.UNSIGNED_INT_SAMPLER_2D,
              ...(shadowSamplers ? { sampler2DShadow: gl.SAMPLER_2D_SHADOW } : {}), ...(dimensionalViews ? { sampler3D: gl.SAMPLER_3D, isampler3D: gl.INT_SAMPLER_3D, usampler3D: gl.UNSIGNED_INT_SAMPLER_3D,
                samplerCube: gl.SAMPLER_CUBE, isamplerCube: gl.INT_SAMPLER_CUBE, usamplerCube: gl.UNSIGNED_INT_SAMPLER_CUBE,
                sampler2DArray: gl.SAMPLER_2D_ARRAY, isampler2DArray: gl.INT_SAMPLER_2D_ARRAY, usampler2DArray: gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
                ...(dimensionalShadows ? { samplerCubeShadow: gl.SAMPLER_CUBE_SHADOW, sampler2DArrayShadow: gl.SAMPLER_2D_ARRAY_SHADOW } : {}) } : {}) })[sampler.type];
            require((integers ? nativeType !== undefined : sampler.type === "sampler2D") && sampler.index < stageSlots[stage], "shader-reflection-error", "Sampler exceeds supported host stage slots.");
            const location = gl.getUniformLocation(program.native, sampler.name), index = gl.getUniformIndices(program.native, [sampler.name])?.[0];
            const view = standard || stage === 1 ? sampling.views.find((entry) => entry.index === sampler.index && (!standard || entry.stage === stage)) : null;
            const constant = view?.swizzle.every((value) => value >= 4) ?? false;
            if (location === null && index === gl.INVALID_INDEX) require(standard || constant,
              "shader-reflection-error", "Only a proved all-constant view may eliminate a used sampler.");
            else require(location !== null && index !== undefined && index !== gl.INVALID_INDEX &&
                gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === nativeType &&
                gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1, "shader-reflection-error", "Sampler reflection mismatch.");
            const unit = unitFor(stage, sampler.index);
            program.samplers.push({ location, unit, stage, index: sampler.index, ...(shadowSamplers ? { type: sampler.type } : {}) }); program.reflection.samplers.push({ ...sampler, stage: metadata.stage, unit });
          }
          if (uniform) for (const block of metadata.guestUniformBlocks) {
            const index = gl.getUniformBlockIndex(program.native, block.name), binding = 1 + stage * 13 + block.slot;
            const native = index !== gl.INVALID_INDEX;
            const description = { ...block, index: native ? index : null, binding, native, referenced: false, members: [] };
            if (native) {
              const size = gl.getActiveUniformBlockParameter(program.native, index, gl.UNIFORM_BLOCK_DATA_SIZE),
                vertexReference = gl.getActiveUniformBlockParameter(program.native, index, gl.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER),
                fragmentReference = gl.getActiveUniformBlockParameter(program.native, index, gl.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER),
                indices = [...gl.getActiveUniformBlockParameter(program.native, index, gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)];
              require(size === block.byteLength && indices.length === 1 && !(stage === 0 ? fragmentReference : vertexReference),
                "shader-reflection-error", "Guest native block extent or stage reference mismatch.");
              const member = block.members[0], actual = gl.getActiveUniform(program.native, indices[0]),
                offset = gl.getActiveUniforms(program.native, indices, gl.UNIFORM_OFFSET)[0],
                stride = gl.getActiveUniforms(program.native, indices, gl.UNIFORM_ARRAY_STRIDE)[0],
                blockIndex = gl.getActiveUniforms(program.native, indices, gl.UNIFORM_BLOCK_INDEX)[0];
              require(actual && actual.name === `${member.name}[0]` && actual.type === gl.UNSIGNED_INT_VEC4 &&
                actual.size === member.count && offset === 0 && stride === 16 && blockIndex === index,
              "shader-reflection-error", "Guest native raw-word member reflection mismatch.");
              Object.assign(description, { byteLength: size, referenced: Boolean(vertexReference || fragmentReference),
                vertexReference, fragmentReference, members: [{ name: actual.name, type: actual.type, count: actual.size, offset, arrayStride: stride, blockIndex }] });
              gl.uniformBlockBinding(program.native, index, binding);
              program.guestBlocks.push({ ...block, index, binding, referenced: description.referenced });
              if (!description.referenced) unusedUniformStorage(program.blocks.length === 0);
            }
            program.reflection.uniformBlocks.push(description);
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
        require(program.blocks.length === 1 && gl.getProgramParameter(program.native, gl.ACTIVE_UNIFORM_BLOCKS) === 1 + (uniform ? program.guestBlocks.length : 0),
          "shader-reflection-error", "Every active block must match the system block.");
        if (blendFold) {
          const name = "wv_rgb_blend_factor", index = gl.getUniformIndices(program.native, [name])?.[0];
          program.blendUniform = gl.getUniformLocation(program.native, name);
          require(program.blendUniform !== null && index !== undefined && index !== gl.INVALID_INDEX &&
            gl.getActiveUniforms(program.native, [index], gl.UNIFORM_TYPE)[0] === gl.FLOAT_VEC4 &&
            gl.getActiveUniforms(program.native, [index], gl.UNIFORM_SIZE)[0] === 1,
          "shader-reflection-error", "Blend factor uniform reflection mismatch.");
          const components = program.reflection.uniforms.filter(uniform => uniform.stage === "fragment")
            .reduce((sum, uniform) => sum + uniform.activeCount * 4, 4 + (standard ? program.reflection.rasterUniforms.filter(uniform => uniform.stage === "fragment" && uniform.active).length : 0));
          require(components <= hostUniformComponents[1], "shader-reflection-error", "Blend factor exceeds the host fragment uniform limit.");
          program.reflection.blend = { sourceFactor: blendFold, uniform: name, type: "vec4", count: 1 };
        }
        if (standard) for (let index = 0; index < gl.getProgramParameter(program.native, gl.ACTIVE_UNIFORMS); index++) {
          const actual = gl.getActiveUniform(program.native, index);
          require(actual, "shader-reflection-error", "Missing active native uniform reflection.");
          const blockIndex = gl.getActiveUniforms(program.native, [index], gl.UNIFORM_BLOCK_INDEX)[0];
          // The measured system block includes upstream reserved members. Its
          // complete native extent and owned zero-filled data were checked above.
          const accounted = program.blocks.some(block => block.index === blockIndex) || uniform && program.guestBlocks.some(block => block.index === blockIndex) ||
            program.reflection.uniforms.some(uniform => uniform.name === actual.name &&
              uniform.activeCount === actual.size && actual.type === gl.UNSIGNED_INT_VEC4) ||
            program.reflection.samplers.some(sampler => sampler.name === actual.name &&
              actual.size === 1 && actual.type === ({ sampler2D: gl.SAMPLER_2D, isampler2D: gl.INT_SAMPLER_2D,
                usampler2D: gl.UNSIGNED_INT_SAMPLER_2D, ...(shadowSamplers ? { sampler2DShadow: gl.SAMPLER_2D_SHADOW } : {}), ...(dimensionalViews ? { sampler3D: gl.SAMPLER_3D, isampler3D: gl.INT_SAMPLER_3D, usampler3D: gl.UNSIGNED_INT_SAMPLER_3D,
                samplerCube: gl.SAMPLER_CUBE, isamplerCube: gl.INT_SAMPLER_CUBE, usamplerCube: gl.UNSIGNED_INT_SAMPLER_CUBE,
                sampler2DArray: gl.SAMPLER_2D_ARRAY, isampler2DArray: gl.INT_SAMPLER_2D_ARRAY, usampler2DArray: gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
                ...(dimensionalShadows ? { samplerCubeShadow: gl.SAMPLER_CUBE_SHADOW, sampler2DArrayShadow: gl.SAMPLER_2D_ARRAY_SHADOW } : {}) } : {}) })[sampler.type]) ||
            textureOperations && program.reflection.textureQueries.some(query => query.active && query.name === actual.name &&
              actual.size === 1 && actual.type === gl.INT) ||
            program.reflection.blend?.uniform === actual.name && actual.size === 1 && actual.type === gl.FLOAT_VEC4 ||
            shadowSamplers && program.reflection.shadowUniforms.some(uniform => uniform.active && uniform.name === actual.name &&
              actual.size === 1 && actual.type === gl.FLOAT_VEC4) ||
            instanceBase && program.reflection.instanceUniforms.some(uniform => uniform.active && uniform.name === actual.name &&
              actual.size === 1 && actual.type === gl.UNSIGNED_INT) ||
            program.reflection.rasterUniforms.some(uniform => uniform.active && uniform.name === actual.name &&
              actual.size === 1 && actual.type === uniform.nativeType);
          require(accounted, "shader-reflection-error", `Active native uniform ${actual.name} has no checked binding metadata.`);
        }
        if (standard) for (const stage of ["vertex", "fragment"]) {
          const components = program.reflection.uniforms.filter(uniform => uniform.stage === stage).reduce((sum, uniform) => sum + uniform.activeCount * 4, 0) +
            program.reflection.rasterUniforms.filter(uniform => uniform.stage === stage && uniform.active).reduce((sum, uniform) => sum + (uniform.type === "vec2" ? 2 : 1), 0) +
            (stage === "fragment" && blendFold ? 4 : 0) +
            (shadowSamplers ? program.reflection.shadowUniforms.filter(uniform => uniform.stage === stage && uniform.active).length * 4 : 0) +
            (instanceBase ? program.reflection.instanceUniforms.filter(uniform => uniform.stage === stage && uniform.active).length : 0) +
            (textureOperations ? program.reflection.textureQueries.filter(query => query.stage === stage && query.active).length : 0);
          require(components <= hostUniformComponents[stage === "vertex" ? 0 : 1], "shader-reflection-error", "Raster bindings exceed the host stage uniform limit.");
        }
        for (const output of nativeColorOutputs(fs)) {
          const location = gl.getFragDataLocation(program.native, output.name);
          require(output.semantic === "COLOR" && (location === (multipleColors ? output.semanticIndex : 0) || location === -1 && (standard || fragment.discardContract?.alwaysDiscards === true)),
            "shader-reflection-error", "Unsupported fragment output.");
          program.reflection.outputs.push({ ...output, location });
        }
        if (multipleColors) for (let slot = 0; slot < 4; slot++) require(gl.getFragDataLocation(program.native, "fsout_c" + slot) ===
          (program.reflection.outputs.find(output => output.semanticIndex === slot)?.location ?? -1),
        "shader-reflection-error", "Every active native color location requires owned original output metadata.");
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
    const internalCaptureFragment = sub => {
      if (sub.captureFragment) return sub.captureFragment;
      const fields = freeze({stage: 1, stageName: "fragment", text: "FRAG\nDCL OUT[0], COLOR[0]\nIMM[0] FLT32 {0, 0, 0, 0}\n0: MOV OUT[0], IMM[0]\n1: END\n", streamOutputWords: [0]});
      createObject({id: 0}, sub, {objectType: 4, objectName: "SHADER", fields: {...fields, handle: 0}});
      const object = sub.names.get(0);sub.names.delete(0);object.public = false;sub.captureFragment = object;return object;
    };
    const selectedProgram = (sub) => sub.shaders.every(Boolean) ? link(sub, sub.shaders[0], sub.shaders[1]) : null;
    const applyInstanceBase = (program, base) => {
      for (const uniform of program.instanceUniforms) if (uniform.active) gl.uniform1ui(uniform.location, base);
    };
    const applyInstanceAttributes = (plan, instance) => {
      for (const { attribute, element, buffer } of plan.attributes) {
        if (buffer.fields.stride === 0 || element.instanceDivisor === 0) continue;
        const format = vertexFormat(element.sourceFormat);
        const offset = buffer.fields.offset + element.sourceOffset +
          Math.floor(instance / element.instanceDivisor) * buffer.fields.stride;
        gl.bindBuffer(gl.ARRAY_BUFFER, resolve(buffer.lease).storage.buffer);
        if (format.integer) gl.vertexAttribIPointer(attribute.location, format.components, gl[format.type], buffer.fields.stride, offset);
        else {
          const packedSigned = format.packed && (format.kind === "snorm" || format.kind === "sscaled");
          if (packedSigned) gl.vertexAttribPointer(attribute.location, 4, gl.UNSIGNED_INT_2_10_10_10_REV, false, buffer.fields.stride, offset);
          else gl.vertexAttribPointer(attribute.location, format.components, gl[format.type], format.normalized, buffer.fields.stride, offset);
        }
        // Each one-instance native call fetches element zero relative to this
        // phase. A positive divisor keeps original vertex indices out of it.
        gl.vertexAttribDivisor(attribute.location, Math.min(element.instanceDivisor, drawLimits.indicesPerSubmission));
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };
    const vertexLayout = (sub, elements = sub.vertexElements, buffers = sub.vertexBuffers) => {
      if (!elements) return;
      for (const element of elements.fields.elements) {
        const buffer = buffers[element.vertexBufferIndex]; if (!buffer) continue;
        const format = vertexFormat(element.sourceFormat), offset = buffer.fields.offset + element.sourceOffset;
        require(buffer.fields.stride <= 255 && buffer.fields.stride % format.scalarBytes === 0 && offset % format.scalarBytes === 0,
          "invalid-state", "Vertex buffer stride/offset is not supported by WebGL.");
        require(buffer.fields.offset <= buffer.metadata.byteLength && element.sourceOffset <= buffer.metadata.byteLength - buffer.fields.offset &&
          format.elementBytes <= buffer.metadata.byteLength - buffer.fields.offset - element.sourceOffset, "out-of-bounds", "Vertex element exceeds storage.");
      }
    };
    const xAlpha = (sub, slot = 0) => [2, 233].includes(sub.surfaces[slot]?.metadata.format) || colors && Boolean((byteColorFormat(sub.surfaces[slot]?.metadata.format) || (floats ? floatColorFormat(sub.surfaces[slot]?.metadata.format) : null) || (packed ? packedFloatColorFormat(sub.surfaces[slot]?.metadata.format) : null) || (integers ? integerFormat(sub.surfaces[slot]?.metadata.format) : null) || (normalized ? packedNormalizedColorFormat(sub.surfaces[slot]?.metadata.format) : null))?.implicitAlpha);
    const colorMask = (sub, slot = 0) => {
      const bits = sub.blend?.fields.renderTargets[0].colorMask ?? 15;
      return [1, 2, 4, 8].map((bit) => Boolean(bits & bit) && (bit !== 8 || !xAlpha(sub, slot)));
    };
    const cachedState = (sub, program, drawingNow) => {
      const storage = (binding) => binding ? { generation: binding.resourceGeneration, metadata: binding.metadata, fields: binding.fields } : null;
      const key = JSON.stringify({ sub: sub.generation, program: program?.generation ?? null, programKey: program?.key ?? null, drawingNow,
        vertexElements: sub.vertexElements?.fields ?? null, vertexBuffers: sub.vertexBuffers.map(storage), indexBuffer: storage(sub.indexBuffer),
        targets: sub.surfaces.map(storage), depth: storage(sub.depthSurface), views: sub.views.map(slots => slots.map(storage)),
        samplers: sub.samplers.map(slots => slots.map(object => object ? { generation: object.generation, fields: object.fields } : null)),
        constants: sub.constants, ...(uniform ? { uniformBuffers: sub.uniformBuffers.map(banks => banks.map(storage)) } : {}),
        blend: sub.blend?.fields ?? null,
        rasterizer: sub.rasterizer?.fields ?? null, dsa: sub.dsa?.fields ?? null, viewport: sub.viewport, scissor: sub.scissor,
        blendColor: sub.blendColor, stencilRef: sub.stencilRef, defaults: sub.defaults });
      let state = stateCache.get(sub, key);
      if (!state) {
        state = freeze({ blend: sub.blend?.fields ?? null, rasterizer: sub.rasterizer?.fields ?? null, dsa: sub.dsa?.fields ?? null,
          viewport: sub.viewport, scissor: sub.scissor, blendColor: [...sub.blendColor], stencilRef: { ...sub.stencilRef },
          mask: colorMask(sub), ...(multipleColors ? { colorMasks: Array.from({ length: 4 }, (_, slot) => colorMask(sub, slot)) } : {}),
          originUpperLeft: production && Boolean((sub.surfaces.find(Boolean) ?? sub.depthSurface)?.metadata.flags & 1),
          winsysY: sub.viewport?.scale[1] < 0 ? -1 : 1 });
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
      require(sub.shaders[0] === shaders[0] && (plan.discard ? sub.captureFragment === shaders[1] : sub.shaders[1] === shaders[1]) &&
        sub.programs.get(program.key) === program && programs.has(program) &&
        samplingFor(sub, shaders[1], shaders[0]).key === program.samplingKey &&
        selectedBlendFold(sub, shaders[1]) === program.blendFold &&
        (!integers || (plan.discard ? "capture-native-float-v1" : colorsFor(sub, shaders[1]).key) === program.colorKey) &&
        inputTypesFor(sub, shaders[0]).key === program.inputKey &&
        sub.constants.every((bank, stage) => bank === banks[stage]),
      "stale-draw", "Draw shader, program or constant-bank identity changed.");
      if (uniform) {
        require(zeroMask(sub, shaders[0], shaders[1]) === program.bufferZeroMask &&
          sub.uniformBuffers.every((entries, stage) => entries.every((entry, slot) => entry === plan.uniformBanks[stage][slot])),
        "stale-draw", "Original uniform bank or slot-zero variant changed.");
        for (const range of plan.uniformRanges) unwrap(uniformAccess.validate(range.token));
      }
    };
    const stencilState = sub => {
      const fields = sub.dsa?.fields.stencil ?? [INACTIVE_STENCIL, INACTIVE_STENCIL];
      // Pinned vrend applies front-only state and reference to both faces.
      const frontOnly = fields[0].enabled && !fields[1].enabled;
      return { enabled: fields[0].enabled || fields[1].enabled, faces: [
        { fields: fields[0], reference: sub.stencilRef.front },
        { fields: frontOnly ? fields[0] : fields[1], reference: frontOnly ? sub.stencilRef.front : sub.stencilRef.back },
      ] };
    };
    const applyStencil = (sub, selectedFace = null) => {
      const state = stencilState(sub);
      gl[state.enabled ? "enable" : "disable"](gl.STENCIL_TEST);
      const faces = selectedFace === null ? state.faces : [state.faces[selectedFace], state.faces[selectedFace]];
      faces.forEach(({ fields, reference }, index) => {
        const face = index ? gl.BACK : gl.FRONT;
        gl.stencilFuncSeparate(face, [gl.NEVER, gl.LESS, gl.EQUAL, gl.LEQUAL, gl.GREATER, gl.NOTEQUAL, gl.GEQUAL, gl.ALWAYS][fields.function], reference, fields.valueMask);
        gl.stencilMaskSeparate(face, fields.writeMask);
        gl.stencilOpSeparate(face, gl[STENCIL_OPERATIONS[fields.failOperation]],
          gl[STENCIL_OPERATIONS[fields.depthFailOperation]], gl[STENCIL_OPERATIONS[fields.depthPassOperation]]);
      });
    };
    const restoreStencilMasks = sub => {
      const fields = sub.dsa?.fields.stencil ?? [INACTIVE_STENCIL, INACTIVE_STENCIL];
      // Original full CLEAR restores the literal per-face DSA write masks.
      gl.stencilMaskSeparate(gl.FRONT, fields[0].writeMask); gl.stencilMaskSeparate(gl.BACK, fields[1].writeMask);
    };
    const attachColorSurface = (slot, surface) => {
      const attachment = gl.COLOR_ATTACHMENT0 + slot, storage = surface ? resolve(surface.lease).storage : null;
      if (storage?.renderbuffer) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, storage.renderbuffer);
      else if (surface?.metadata.kind === "dimensional-texture") {
        if (surface.metadata.target === 4) gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment,
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + surface.fields.firstLayer, storage.texture, surface.fields.level);
        else gl.framebufferTextureLayer(gl.FRAMEBUFFER, attachment, storage.texture, surface.fields.level, surface.fields.firstLayer);
      } else gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, storage?.texture ?? null, surface?.fields.level ?? 0);
    };
    const restore = (sub, plan = null, constantAttributes = null) => {
      check(); vertexLayout(sub);
      if (plan) validateDrawPlan(plan);
      const program = plan ? plan.program : production ? null : selectedProgram(sub);
      const { key: stateKey, state } = cachedState(sub, program, Boolean(plan));
      const uploads = plan ? plan.uploads : constantUploads(program, sub.constants, false);
      // Shared-exponent refresh executes native helper draws. Complete those
      // before applying guest draw state, with no helper draw before execution.
      if (shared && plan) for (const sampler of program.samplers) unwrap(imageAccess.refresh(sub.views[sampler.stage][sampler.index].imageRange));
      gl.bindVertexArray(sub.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sub.framebuffer);
      const surface = sub.surfaces[0] ?? null;
      if (multipleColors) for (let slot = 0; slot < 4; slot++) {
        const target = sub.surfaces[slot];
        if (dimensionalColorSurfaces) attachColorSurface(slot, target);
        else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + slot, gl.TEXTURE_2D,
          target ? resolve(target.lease).storage.texture : null, target?.fields.level ?? 0);
      }
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, surface ? resolve(surface.lease).storage.texture : null, images ? surface?.fields.level ?? 0 : 0);
      if (floatingDepth) {
        // Detach both old planes before switching combined and depth-only storage.
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
        if (sub.depthSurface) {
          const target = sub.depthSurface, storage = resolve(target.lease).storage, texture = storage.texture;
          const attachment = (floatingDepthFormat(target.fields.format)?.stencil || packedDepth && packedDepthFormat(target.fields.format)?.stencil) ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
          if (storage.renderbuffer) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, storage.renderbuffer);
          else if (dimensionalDepthSurfaces && target.metadata.kind === "dimensional-depth-texture") {
            if (target.metadata.target === 4) gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment,
              gl.TEXTURE_CUBE_MAP_POSITIVE_X + target.fields.firstLayer, texture, target.fields.level);
            else gl.framebufferTextureLayer(gl.FRAMEBUFFER, attachment, texture, target.fields.level, target.fields.firstLayer);
          } else gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture, target.fields.level);
        }
      } else {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sub.depthSurface ? resolve(sub.depthSurface.lease).storage.texture : null, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
      }
      // WebGL requires every enabled color buffer to have an active output.
      // A checked terminal discard may have no reflected output. Disable it
      // only for that draw; CLEAR and ordinary restoration retain the surface.
      const discardOnly = plan && (standard || program.fragment.discardContract?.alwaysDiscards === true) &&
        program.reflection.outputs.length === 1 && program.reflection.outputs[0].location === -1;
      if (multipleColors) {
        gl.drawBuffers(Array.from({ length: 4 }, (_, slot) => sub.surfaces[slot] &&
          (!plan || program.reflection.outputs.some(output => output.location === slot)) ? gl.COLOR_ATTACHMENT0 + slot : gl.NONE));
        const first = sub.surfaces.findIndex(Boolean);
        gl.readBuffer(first >= 0 ? gl.COLOR_ATTACHMENT0 + first : gl.NONE);
      } else { gl.drawBuffers([surface && !discardOnly ? gl.COLOR_ATTACHMENT0 : gl.NONE]); gl.readBuffer(surface ? gl.COLOR_ATTACHMENT0 : gl.NONE); }
      if ((multipleColors ? sub.surfaces.some(Boolean) : surface) || sub.depthSurface) require(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "incomplete-framebuffer", "Framebuffer is incomplete.");
      gl.useProgram(program?.native ?? null);
      if (instanceBase && program) applyInstanceBase(program, 0);
      for (let slot = 0; slot < maxAttributes; slot++) {
        gl.disableVertexAttribArray(slot); gl.vertexAttribDivisor(slot, 0);
        const type = program?.reflection.attributes.find(attribute => attribute.location === slot)?.type;
        if (type === gl.INT_VEC4) gl.vertexAttribI4i(slot, 0, 0, 0, 1);
        else if (type === gl.UNSIGNED_INT_VEC4) gl.vertexAttribI4ui(slot, 0, 0, 0, 1);
        else gl.vertexAttrib4f(slot, 0, 0, 0, 1);
      }
      if (sub.vertexElements) for (const attribute of program?.reflection.attributes ?? []) {
        const element = sub.vertexElements.fields.elements[attribute.index], buffer = element ? sub.vertexBuffers[element.vertexBufferIndex] : null;
        if (!buffer) continue;
        const format = vertexFormat(element.sourceFormat);
        if (standard && buffer.fields.stride === 0) {
          // State prefixes reset to the generic default. A draw supplies only
          // values collected from its retained, validated GPU read tickets.
          if (plan) {
            const values = constantAttributes.get(attribute.index).values;
            if (format.integer) {
              if (format.kind === "sint") gl.vertexAttribI4iv(attribute.location, values);
              else gl.vertexAttribI4uiv(attribute.location, values);
            } else gl.vertexAttrib4fv(attribute.location, values);
          }
          continue;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, resolve(buffer.lease).storage.buffer);
        if (format.integer) gl.vertexAttribIPointer(attribute.location, format.components, gl[format.type], buffer.fields.stride, buffer.fields.offset + element.sourceOffset);
        else {
          const packedSigned = format.packed && (format.kind === "snorm" || format.kind === "sscaled");
          if (packedSigned) gl.vertexAttribPointer(attribute.location, 4, gl.UNSIGNED_INT_2_10_10_10_REV, false,
            buffer.fields.stride, buffer.fields.offset + element.sourceOffset);
          else gl.vertexAttribPointer(attribute.location, format.components, gl[format.type], format.normalized, buffer.fields.stride, buffer.fields.offset + element.sourceOffset);
        }
        // No admitted draw has an instance index >= the total-work ceiling.
        // Larger wire divisors therefore have the identical constant-zero fetch.
        if (standard) gl.vertexAttribDivisor(attribute.location, Math.min(element.instanceDivisor, drawLimits.indicesPerSubmission));
        gl.enableVertexAttribArray(attribute.location);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      // Selected original buffers remain in the native other-data class. Their
      // fenced index reads feed a private element-array stream at draw time.
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, !bufferRoles && sub.indexBuffer ? resolve(sub.indexBuffer.lease).storage.buffer : null);
      for (let unit = 0; unit < maxUnits; unit++) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null); gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
        gl.bindTexture(gl.TEXTURE_3D, null); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null); gl.bindSampler(unit, null);
      }
      for (let stage = 0; stage < 2; stage++) for (let slot = 0; slot < stageSlots[stage]; slot++) {
        const view = sub.views[stage][slot], sampler = sub.samplers[stage][slot], unit = unitFor(stage, slot);
        let image = null;
        if (images && view) {
          if (!shared && plan && program.samplers.some(entry => entry.stage === stage && entry.index === slot)) unwrap(imageAccess.refresh(view.imageRange));
          image = unwrap(imageAccess.resolve(view.imageRange));
        }
        const nativeTarget = dimensionalViews && (image?.storage.dimensional || dimensionalDepthViews && image?.storage.dimensionalDepth) ? image.storage.target : gl.TEXTURE_2D;
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(nativeTarget, view ? images ? image.storage.texture : resolve(view.lease).storage.texture : null);
        if (images && image) {
          gl.texParameteri(nativeTarget, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(nativeTarget, gl.TEXTURE_MAX_LEVEL, image.metadata.lastLevel);
        }
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
        if (uniform) for (const block of program.guestBlocks) {
          const stage = block.stage === "vertex" ? 0 : 1, bank = sub.uniformBuffers[stage][block.slot];
          const range = plan?.uniformRanges.find(range => range.block === block);
          gl.uniformBlockBinding(program.native, block.index, block.binding);
          if (range) gl.bindBufferRange(gl.UNIFORM_BUFFER, block.binding, range.storage.buffer, range.offset, range.byteLength);
          else if (bank) {
            const owned = resolve(bank.lease);
            gl.bindBufferRange(gl.UNIFORM_BUFFER, block.binding, owned.storage.buffer, bank.fields.offset, bank.fields.length);
          } else if (!block.referenced) gl.bindBufferRange(gl.UNIFORM_BUFFER, block.binding, unusedUniformBuffer, 0, block.byteLength);
        }
        for (const upload of uploads) {
          const uniform = upload.uniform, words = new Uint32Array(upload.words);
          gl.uniform4uiv(uniform.location, words);
        }
        for (const sampler of program.samplers) gl.uniform1i(sampler.location, sampler.unit);
        if (shadowSamplers) for (const uniform of program.shadowUniforms) {
          const swizzle = sub.views[uniform.stage][uniform.index]?.fields.swizzle ?? [0, 1, 2, 3];
          const values = swizzle.map(component => uniform.semantic === "SHADOW_MASK" ? Number(component < 4) : Number(component === 5));
          if (uniform.active) gl.uniform4fv(uniform.location, new Float32Array(values));
        }
        if (textureOperations) for (const query of program.textureQueries) {
          const view = sub.views[query.stage][query.index];
          if (!view?.imageRange) {
            require(!plan, "incomplete-draw", "Original texture query requires its retained view.");
            continue;
          }
          const image = unwrap(imageAccess.resolve(view.imageRange));
          const levels = image.metadata.lastLevel + 1;
          require(Number.isInteger(levels) && levels >= 1 && levels === image.metadata.levels.length,
            "shader-reflection-error", "Captured local image level count disagrees with its owned planes.");
          if (query.active) gl.uniform1i(query.location, levels);
        }
        if (standard) for (const uniform of program.rasterUniforms) {
          if (uniform.semantic === "POINT_SIZE") gl.uniform2f(uniform.location, state.rasterizer?.pointSize ?? 1, state.rasterizer?.pointSizePerVertex ? 1 : 0);
          else gl.uniform1f(uniform.location, state.winsysY);
        }
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
      if (stencil) applyStencil(sub);
      gl.polygonOffset(0, 0); gl.lineWidth(1); gl.sampleCoverage(1, false);
      const rasterizer = state.rasterizer;
      if (rasterizer?.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      const scissor = state.scissor;
      gl.scissor(scissor?.minX ?? 0, scissor?.minY ?? 0, scissor ? scissor.maxX - scissor.minX : 0, scissor ? scissor.maxY - scissor.minY : 0);
      if (rasterizer?.cullFace === 2) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      // Pinned vrend_update_frontface_state inverts Gallium front_ccw only
      // for a lower-left framebuffer; production also admits Y_0_TOP.
      gl.cullFace(gl.BACK); gl.frontFace(Boolean(rasterizer?.frontCcw) !== state.originUpperLeft ? gl.CW : gl.CCW);
      const blend = state.blend, target = blend?.renderTargets[0];
      if (blend?.dither) gl.enable(gl.DITHER); else gl.disable(gl.DITHER);
      const enabled = target?.blendEnable === true && !(!multipleColors && integers && integerFormat(sub.surfaces[0]?.metadata.format));
      if (enabled) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      const ignoresRgbFactors = enabled && target.rgbFunction >= 3;
      gl.blendEquationSeparate(enabled ? gl[BLEND_EQUATIONS[target.rgbFunction]] : gl.FUNC_ADD,
        enabled ? gl[BLEND_EQUATIONS[target.alphaFunction]] : gl.FUNC_ADD);
      gl.blendFuncSeparate(enabled && !ignoresRgbFactors && !mixedBlendConstants(target) ? gl[BLEND_FACTORS[target.rgbSourceFactor]] : gl.ONE,
        enabled && !ignoresRgbFactors ? gl[BLEND_FACTORS[target.rgbDestinationFactor]] : gl.ZERO,
        enabled && target.alphaSourceFactor !== 6 ? gl[BLEND_FACTORS[target.alphaSourceFactor]] : gl.ONE,
        enabled ? gl[BLEND_FACTORS[target.alphaDestinationFactor]] : gl.ZERO);
      gl.blendColor(...state.blendColor);
      const mask = state.mask;
      gl.colorMask(...mask);
      if (multipleColors) for (let slot = 0; slot < 4; slot++) indexedColors.colorMaskiOES(slot, ...state.colorMasks[slot]);
      if (state.viewport) {
        const { scale, translate } = state.viewport;
        gl.viewport(...viewportRectangle(state.viewport));
        gl.depthRange(translate[2] - scale[2], translate[2] + scale[2]);
      } else { gl.viewport(0, 0, 0, 0); gl.depthRange(0, 1); }
      if (plan && assemblyLists) provoking.provokingVertexWEBGL(provoking.LAST_VERTEX_CONVENTION_WEBGL);
      check();
      return stateKey;
    };
    const prepareDraw = (ctx, sub, command, submission, job = null, captureProgram = null, capturePass = false) => {
      const fields = streamOutput && !command.fields.indexed && command.fields.countFromStreamOutput ? freeze({...command.fields, count: command.fields.countFromStreamOutput, start: 0}) : command.fields;
      const discard = streamOutput && (capturePass || sub.rasterizer?.fields.rasterizerDiscard === true);
      require(!images || job, "unsupported-draw", "Original image draws require an owned completion job.");
      // VirGL1.3 uses zero to select an ordinary draw, still with one instance.
      const instances = standard ? Math.max(1, fields.instanceCount) : 1;
      require(fields.count > 0 && (fields.indexed ? production || fields.start === 0 : fields.start <= 0x7fffffff - fields.count),
        "unsupported-draw", "Draws must be nonempty; private indexed starts must be zero and array ranges must fit signed GL integers.");
      require(submission.draws.length < drawLimits.drawsPerSubmission && fields.count <= Math.floor((drawLimits.indicesPerSubmission - submission.indices) / instances),
        "limit-exceeded", "Submission draw or index budget exceeded.");
      require(sub.shaders[0] && (discard || sub.shaders[1]), "incomplete-draw", "Drawing requires the selected shader stages.");
      const primarySurface = multipleColors ? sub.surfaces.find(Boolean) : sub.surfaces[0];
      require((discard || primarySurface) && (discard || sub.viewport) && sub.vertexElements && (!fields.indexed || sub.indexBuffer),
        "incomplete-draw", "Drawing requires a surface, viewport, vertex elements and any indexed draw's index buffer.");
      require(discard || !sub.dsa?.fields.depthEnable || sub.depthSurface, "incomplete-draw", "Active depth testing requires a depth attachment.");
      let stencilLowering = null;
      if (stencil && !discard) {
        const state = stencilState(sub), format = sub.depthSurface?.fields.format;
        const present = floatingDepthFormat(format)?.stencil || packedDepthFormat(format)?.stencil;
        if (state.enabled && present) {
          const [front, back] = state.faces;
          const common = front.reference === back.reference && front.fields.valueMask === back.fields.valueMask &&
            front.fields.writeMask === back.fields.writeMask;
          if (!common) {
            require(orderedStencil, "unsupported-stencil",
              "Native WebGL stencil draws require common effective front/back references and masks.");
            require(assemblyLists, "unsupported-stencil", "Ordered stencil draws require native last-vertex list assembly.");
            stencilLowering = fields.mode <= 3 || sub.rasterizer?.fields.cullFace === 2 ? "front" : "triangles";
            require(stencilLowering === "front" || instances === 1 || instanceBase, "unsupported-stencil",
              "Ordered two-face stencil draws require one original instance.");
          }
        }
      }
      const banks = Object.freeze([...sub.constants]), shaders = Object.freeze([sub.shaders[0], discard ? internalCaptureFragment(sub) : sub.shaders[1]]);
      // Presence and numeric authority apply to the complete declared prefix,
      // even if reflection prunes it. Reject before linking or any draw allocation.
      const approvedBanks = Object.freeze(shaders.map((shader, stage) => shader.constantExactDomain ?
        unwrap(checkExactBank(banks[stage], shader.constantExactDomain, shader.constantExactBase)) : shader.constantConversionDomain ?
        unwrap(checkConversionBank(banks[stage], shader.constantConversionDomain, shader.constantConversionBase)) : shader.constantRasterDomain ?
        unwrap(checkRasterBank(banks[stage], shader.constantRasterDomain, shader.constantConstraint !== null, shader.constantRadialDomain !== null)) : shader.constantRadialDomain ?
        unwrap(checkRadialBank(banks[stage], shader.constantRadialDomain.count, shader.constantConstraint !== null)) : shader.constantAccess ?
        unwrap(shader.constantConstraint ? checkLoopBank(banks[stage], shader.constantConstraint.count) :
          checkIndirectBank(banks[stage], shader.constantAccess.count, shader.constantDomain !== null)) : null));
      const program = captureProgram ?? (discard ? link(sub, shaders[0], shaders[1]) : selectedProgram(sub)), surface = primarySurface ? resolve(primarySurface.lease) : null;
      const uploads = constantUploads(program, banks, true, approvedBanks);
      for (const sampler of program.samplers) {
        const view = sub.views[sampler.stage][sampler.index], state = sub.samplers[sampler.stage][sampler.index];
        require(view && state, "incomplete-draw", "Drawing requires an active sampler view and sampler state.");
        if (dimensionalViews) require(view.fields.target === dimensionalSamplerTarget(sampler.type, dimensionalShadows) &&
          (view.fields.target === 2 || view.metadata.kind === "dimensional-texture" && (view.metadata.format === 67 || production) &&
            (production ? /^(?:i|u)?sampler(?:3D|Cube|2DArray)$/.test(sampler.type) : ["sampler3D", "samplerCube", "sampler2DArray"].includes(sampler.type)) || dimensionalDepthViews &&
            view.metadata.kind === "dimensional-depth-texture" && [4, 7].includes(view.fields.target) && depthFormat(view.fields.format) &&
            ["samplerCube", "sampler2DArray", ...(dimensionalShadows ? ["samplerCubeShadow", "sampler2DArrayShadow"] : [])].includes(sampler.type)),
        "incompatible-resource", "Native dimensional sampler has no compatible original retained view.");
        if (shadowSamplers) require(comparisonSampler(sampler.type) ?
          state.fields.compareMode === 1 && Boolean(depthFormat(view.fields.format)) : state.fields.compareMode === 0,
        "unsupported-sampler", "Original sampler comparison mode disagrees with its native type or depth storage.");
        if (integers && integerFormat(view.fields.format)) require(state.fields.minImageFilter === 0 &&
          state.fields.magImageFilter === 0 && [0, 2].includes(state.fields.minMipFilter),
        "unsupported-sampler", "Integer image sampling requires native nearest-compatible filters.");
        if (depthFormat(view.fields.format) && !comparisonSampler(sampler.type)) require(state.fields.minImageFilter === 0 &&
          state.fields.magImageFilter === 0 && [0, 2].includes(state.fields.minMipFilter),
        "unsupported-sampler", "Non-comparison depth sampling requires native nearest-compatible filters.");
        for (const target of floatingDepth ? [...sub.surfaces, sub.depthSurface].filter(Boolean) : multipleColors ? sub.surfaces.filter(Boolean) : [primarySurface]) {
          const overlap = resolve(view.lease).storage.texture === resolve(target.lease).storage.texture;
          const surfaceLevel = target.fields.level;
          require(!overlap || images && (surfaceLevel < view.fields.firstLevel || surfaceLevel > view.fields.lastLevel),
            "framebuffer-feedback", "A draw cannot sample its own framebuffer texture.");
        }
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
      const uniformBanks = uniform ? sub.uniformBuffers.map(entries => Object.freeze([...entries])) : null, uniformRanges = [];
      if (uniform) {
        try {
          for (const block of program.guestBlocks) {
            const bank = uniformBanks[block.stage === "vertex" ? 0 : 1][block.slot];
            require(bank || !block.referenced, "incomplete-draw", "Drawing requires every referenced original uniform bank.");
            if (!bank) continue;
            require(bank.fields.length >= block.byteLength, "out-of-bounds", "Original uniform range is shorter than the reflected block.");
            const range = unwrap(uniformAccess.capture(bank.lease, bank.fields.offset, bank.fields.length));
            uniformRanges.push({ ...range, block }); job.pendingUniformRanges.add(range.token);
          }
        } catch (error) {
          for (const range of uniformRanges) { job.pendingUniformRanges.delete(range.token); unwrap(uniformAccess.release(range.token)); }
          throw error;
        }
      }
      let capturePlans = [];
      if (streamOutput && !capturePass && sub.streamTuple) {
        const metadata = sub.shaders[0].translation.metadata.streamOutput;
        const used = [...new Set(metadata.outputs.map(output => output.outputBuffer))];
        const targets = sub.streamTuple.targets;
        require(used.every(buffer => targets[buffer]), "incomplete-draw", "Original capture layout needs each bound output target.");
        const targetBuffers = used.map(buffer => resolve(targets[buffer].lease).storage.buffer);
        require(new Set(targetBuffers).size === targetBuffers.length, "feedback-conflict", "Original output slots cannot alias buffer storage.");
        const inputs = [...sub.vertexBuffers.filter(Boolean), ...(sub.indexBuffer ? [sub.indexBuffer] : []), ...sub.uniformBuffers.flat().filter(Boolean)];
        require(inputs.every(input => !targetBuffers.includes(resolve(input.lease).storage.buffer)), "feedback-conflict", "Active feedback storage also supplies a draw input.");
        for (const buffer of used) {
          const capture = link(sub, sub.shaders[0], internalCaptureFragment(sub), buffer);
          capturePlans.push(prepareDraw(ctx, sub, command, submission, job, capture, true));
        }
      }
      // Capture-only attributes can survive native pruning. Include them in the
      // common fenced constant-attribute batch, while each program keeps its own locations.
      const allConstants = [...new Map([...constants, ...capturePlans.flatMap(plan => plan.constants)].map(value => [value.attribute.index, value])).values()];
      return Object.freeze({ ctx, sub, command, fields, instances, vertexWork: fields.count * instances,
        ...(streamOutput ? {discard, capturePass, capturePlans, streamTuple: sub.streamTuple} : {}),
        ...(orderedStencil ? { stencilLowering } : {}),
        surface, ...(multipleColors ? { primarySurface } : {}), attributes, constants, index, indexStorage, indexOffset, indexSize, indexByteLength,
        program, shaders, banks, uploads, ...(streamOutput && !capturePass ? {constants: allConstants} : {}), ...(uniform ? { uniformBanks, uniformRanges: Object.freeze(uniformRanges) } : {}) });
    };
    const captureOriginal = (plan, bytes, constantAttributes, job) => {
      const {sub, fields, instances, streamTuple: tuple} = plan;
      require(tuple.failed !== true, "stale-capture", "A failed native capture tuple requires replacement or reset.");
      const primitiveSize = fields.mode === 0 ? 1 : fields.mode <= 3 ? 2 : 3;
      const values = fields.indexed ? (() => {
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return Array.from({length: fields.count}, (_, i) => plan.indexSize === 1 ? data.getUint8(i) : plan.indexSize === 2 ? data.getUint16(i * 2, true) : data.getUint32(i * 4, true));
      })() : Array.from({length: fields.count}, (_, i) => fields.start + i);
      const primitives = [];
      let segment = [];
      const flush = () => {
        if (fields.mode === 0) for (const value of segment) primitives.push([value]);
        else if (fields.mode === 1) for (let i = 1; i < segment.length; i += 2) primitives.push([segment[i - 1], segment[i]]);
        else if (fields.mode <= 3) {
          for (let i = 1; i < segment.length; i++) primitives.push([segment[i - 1], segment[i]]);
          if (fields.mode === 2 && segment.length >= 2) primitives.push([segment.at(-1), segment[0]]);
        } else if (fields.mode === 4) for (let i = 2; i < segment.length; i += 3) primitives.push(segment.slice(i - 2, i + 1));
        else if (fields.mode === 5) for (let i = 2; i < segment.length; i++) primitives.push(i % 2 ? [segment[i - 1], segment[i - 2], segment[i]] : [segment[i - 2], segment[i - 1], segment[i]]);
        else for (let i = 2; i < segment.length; i++) primitives.push([segment[0], segment[i - 1], segment[i]]);
        segment = [];
      };
      for (const value of values) {if (fields.indexed && fields.primitiveRestart && value === fields.restartIndex) flush();else segment.push(value);}flush();
      require(primitives.length * primitiveSize <= fields.count * 3, "limit-exceeded", "Capture primitive work exceeds the original source ceiling.");
      let capacity = primitives.length * primitiveSize * instances;
      for (const capture of plan.capturePlans) {
        const metadata = capture.program.streamOutput, buffer = metadata.captureBuffer, target = tuple.targets[buffer], stride = metadata.strides[buffer] * 4;
        require(stride > 0 && tuple.cursors[buffer] <= target.fields.bufferSize, "out-of-bounds", "Original capture cursor exceeds its retained target.");
        capacity = Math.min(capacity, Math.floor((target.fields.bufferSize - tuple.cursors[buffer]) / stride));
      }
      const capturedPrimitives = Math.min(primitives.length * instances, Math.floor(capacity / primitiveSize));
      const vertexIds = primitives.flat(), vertices = capturedPrimitives * primitiveSize;
      const captures = [];
      // Bound every allocation and native operation before capture begins. The
      // original submission ceiling bounds expansion to three vertices/source.
      require(vertices <= fields.count * instances * 3 && job.streamCalls + vertices * plan.capturePlans.length <= drawLimits.indicesPerSubmission * 12,
        "limit-exceeded", "Native stream-output work exceeds the submission ceiling.");
      for (const capture of plan.capturePlans) {
        const metadata = capture.program.streamOutput, buffer = metadata.captureBuffer, target = tuple.targets[buffer];
        const copies = vertices * metadata.varyings.length;
        require(job.streamCopies + copies <= drawLimits.indicesPerSubmission * 384, "limit-exceeded", "Native capture scatter exceeds its bounded work.");
        job.streamCopies += copies;
        if (!vertices) continue;
        const packed = unwrap(captureAccess.allocatePacked(vertices * metadata.packedStrideBytes));job.streamAllocations.push(packed.token);
        const feedback = gl.createTransformFeedback();require(feedback, "backend-error", "Native feedback allocation failed.");job.streamFeedbacks.push(feedback);
        captures.push({capture, metadata, target, buffer, packed, feedback, cursor: tuple.cursors[buffer]});
      }
      if (captures.length) tuple.failed = true;
      for (const [captureIndex, entry] of captures.entries()) {
        const {capture, metadata, target, buffer, packed, feedback, cursor} = entry;
        const owned = resolve(target.lease);
        if (!job.streamHolds.has(target.generation)) {objectRef(sub, null, target);job.streamHolds.set(target.generation, {sub, object: target});}
        for (const sampler of capture.program.samplers) {
          const token = sub.views[sampler.stage][sampler.index].imageRange;
          if (!job.imageHolds.has(token)) job.imageHolds.set(token, unwrap(imageAccess.hold(token)).token);
        }
        restore(sub, capture, constantAttributes);
        for (const range of capture.uniformRanges) {
          unwrap(uniformAccess.validate(range.token));unwrap(uniformAccess.submit(range.token));job.pendingUniformRanges.delete(range.token);
          if (job.uniformHolds.has(range.generation)) unwrap(uniformAccess.release(range.token));else job.uniformHolds.set(range.generation, range.token);
        }
        // The internal C-compiled fragment has no guest effects. A complete
        // default framebuffer avoids guest integer-output compatibility rules.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);gl.drawBuffers([gl.BACK]);gl.readBuffer(gl.BACK);gl.enable(gl.RASTERIZER_DISCARD);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, packed.storage.buffer);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);check();
        let active = false, out = 0;
        const runCapture = () => { try {
          gl.beginTransformFeedback(gl.POINTS);active = true;check();
          for (let instance = 0; out < vertices && instance < instances; instance++) {
            applyInstanceBase(capture.program, instance);applyInstanceAttributes(capture, instance);check();
            for (let i = 0; i < vertexIds.length && out < vertices;) {
              let count = 1;
              while (i + count < vertexIds.length && out + count < vertices && vertexIds[i + count] === vertexIds[i] + count) count++;
              gl.drawArrays(gl.POINTS, vertexIds[i], count);job.streamCalls++;check();i += count;out += count;
            }
          }
          gl.endTransformFeedback();active = false;check();
        } finally {
          if (active && !gl.isContextLost()) gl.endTransformFeedback();
          gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
          gl.disable(gl.RASTERIZER_DISCARD);
        } };
        // Each physical pass captures POINTS. Measure only the first output
        // buffer and normalize that draw by its own original primitive size.
        if (production && captureIndex === 0) booleanQueries.measureFeedback(sub, primitiveSize, runCapture); else runCapture();
        // Invalidate readers before any partial native write. A failed scatter
        // drains with this job and never presents old contents as current.
        unwrap(captureAccess.markWritten(target.lease));
        gl.bindBuffer(gl.COPY_READ_BUFFER, packed.storage.buffer);gl.bindBuffer(gl.COPY_WRITE_BUFFER, owned.storage.buffer);
        try {
          for (let vertex = 0; vertex < vertices; vertex++) for (const varying of metadata.varyings) {
            const output = metadata.outputs[varying.outputIndex];
            gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, vertex * metadata.packedStrideBytes + varying.packedOffset,
              target.fields.bufferOffset + cursor + vertex * metadata.strides[buffer] * 4 + output.destinationOffset * 4, varying.components * 4);check();
          }
        } finally {gl.bindBuffer(gl.COPY_READ_BUFFER, null);gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);}
        tuple.cursors[buffer] += vertices * metadata.strides[buffer] * 4;
        entry.record = {buffer, targetGeneration: target.generation, resourceGeneration: target.resourceGeneration, offset: target.fields.bufferOffset,
          cursorBefore: cursor, cursorAfter: tuple.cursors[buffer], vertices, packedStrideBytes: metadata.packedStrideBytes, varyingReflection: capture.program.reflection.streamOutput};
      }
      tuple.failed = false;
      return {tuple: tuple.key, primitiveSize, requestedPrimitives: primitives.length * instances, capturedPrimitives, overflow: capturedPrimitives < primitives.length * instances,
        captures: captures.map(entry => entry.record), nativeCalls: job.streamCalls, scatterCalls: job.streamCopies};
    };
    const issueDraw = (plan, bytes, submission, constantAttributes = null, job = null) => {
      const { ctx, sub, command, fields, instances, vertexWork, surface, attributes, indexStorage, indexOffset, indexSize, indexByteLength } = plan;
      const indices = fields.indexed ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
      let actualMinIndex = fields.indexed ? 0xffffffff : fields.start, actualMaxIndex = fields.indexed ? 0 : fields.start + fields.count - 1;
      let validIndexCount = fields.indexed ? 0 : fields.count, restartCount = 0, normalize = bufferRoles && fields.indexed;
      const fixedRestart = 2 ** (indexSize * 8) - 1;
      for (let offset = 0; offset < indexByteLength; offset += indexSize) {
        const value = indexSize === 1 ? indices.getUint8(offset) : indexSize === 2 ? indices.getUint16(offset, true) : indices.getUint32(offset, true);
        if (standard && fields.primitiveRestart && value === fields.restartIndex) {
          restartCount++; normalize ||= value !== fixedRestart; continue;
        }
        require(standard || value !== fixedRestart, "unsupported-draw", "Index 0xffff requires unsupported primitive-restart lowering.");
        // A nonrestart u32 sentinel cannot be preserved by widening. Smaller
        // sentinels remain real vertex IDs in a private native u32 stream.
        require(!standard || value !== 0xffffffff && value <= maxElementIndex,
          "unsupported-draw", "Actual vertex index exceeds the native maximum element index.");
        normalize ||= standard && value === fixedRestart;
        validIndexCount++;
        actualMinIndex = Math.min(actualMinIndex, value); actualMaxIndex = Math.max(actualMaxIndex, value);
      }
      const empty = validIndexCount === 0;
      if (empty) { actualMinIndex = null; actualMaxIndex = null; }
      require(!standard || empty || actualMaxIndex <= maxElementIndex,
        "unsupported-draw", "Actual vertex index exceeds the native maximum element index.");
      for (const candidate of [plan, ...(plan.capturePlans ?? [])]) validateDrawPlan(candidate);
      require(!streamOutput || !plan.capturePlans.length || empty || actualMaxIndex <= 0x7fffffff, "unsupported-draw", "Original feedback vertex identity exceeds legal native array capture indices.");
      const vertexFetches = [...attributes, ...(plan.capturePlans ?? []).flatMap(candidate => candidate.attributes)].map(({ attribute, element, buffer }) => {
        const offset = buffer.fields.offset + element.sourceOffset, stride = buffer.fields.stride;
        const format = vertexFormat(element.sourceFormat), elementBytes = format.elementBytes;
        const divisor = element.instanceDivisor;
        const constant = stride === 0;
        const packedSignedArray = !constant && format.packed && (format.kind === "snorm" || format.kind === "sscaled");
        const first = empty ? null : constant || divisor ? 0 : actualMinIndex,
          last = empty ? null : constant ? 0 : divisor ? Math.floor((instances - 1) / divisor) : actualMaxIndex;
        // vertexLayout proved that the first complete element fits. Bound
        // the largest actual fetch with division, independent of wire hints.
        require(empty || constant || last <= Math.floor((buffer.metadata.byteLength - offset - elementBytes) / stride),
          "out-of-bounds", "An actual vertex fetch exceeds retained storage.");
        return { attributeIndex: attribute.index, location: attribute.location,
          resourceId: buffer.metadata.id, resourceGeneration: buffer.resourceGeneration,
          stride, offset, components: vertexComponents(element), firstByte: empty ? null : offset + first * stride, requiredEnd: empty ? null : offset + last * stride + elementBytes,
          ...(standard ? { sourceFormat: element.sourceFormat, elementBytes,
            nativeType: packedSignedArray ? gl.UNSIGNED_INT_2_10_10_10_REV : gl[format.type], normalized: format.normalized && !packedSignedArray,
            ...(format.integer ? { nativeIntegerInput: true } : {}),
            divisor, nativeDivisor: constant ? 0 : Math.min(divisor, drawLimits.indicesPerSubmission), firstElement: first, lastElement: last,
            ...(empty ? { fetchEmpty: true } : {}),
            ...(constant ? { constant: true, componentWords: constantAttributes.get(attribute.index).words,
              genericValues: [...constantAttributes.get(attribute.index).values] } : {}) } : {}) };
      });
      // readStorage changes copy/pixel bindings. Restore every supported binding
      // after its synchronous GPU read, immediately before issuing the real draw.
      let captured = null;
      if (streamOutput && plan.capturePlans.length) {
        try { captured = captureOriginal(plan, bytes, constantAttributes, job); }
        catch (error) { if (production) booleanQueries.invalidateFeedback(sub); throw error; }
      }
      const stateKey = restore(sub, plan, constantAttributes);
      if (plan.discard && !surface) {gl.bindFramebuffer(gl.FRAMEBUFFER, null);gl.drawBuffers([gl.BACK]);gl.readBuffer(gl.BACK);}
      if (plan.discard) gl.enable(gl.RASTERIZER_DISCARD);
      const splitStencil = plan.stencilLowering === "triangles";
      const assembled = splitStencil || assemblyLists && [2, 6].includes(fields.mode);
      const nativeMode = splitStencil ? 4 : assembled ? fields.mode === 2 ? 1 : 4 : fields.mode;
      const sourceIndex = i => !indices ? fields.start + i : indexSize === 1 ? indices.getUint8(i) :
        indexSize === 2 ? indices.getUint16(i * 2, true) : indices.getUint32(i * 4, true);
      const isRestart = value => fields.primitiveRestart && value === fields.restartIndex;
      // Enumerate original triangle identities twice: first to bound storage,
      // then to fill it. Strip parity resets at restart; the original LAST
      // vertex remains last even when swapping the two winding vertices.
      const visitStencilTriangles = emit => {
        let a = 0, b = 0, length = 0;
        for (let i = 0; i < fields.count; i++) {
          const value = sourceIndex(i);
          if (fields.indexed && isRestart(value)) { length = 0; continue; }
          if (fields.mode === 4) {
            if (length % 3 === 0) a = value;
            else if (length % 3 === 1) b = value;
            else emit(a, b, value);
          } else {
            if (length === 0) a = value;
            else if (length === 1) b = value;
            else {
              if (fields.mode === 5 && length % 2) emit(b, a, value);
              else emit(a, b, value);
              if (fields.mode === 5) a = b;
              b = value;
            }
          }
          length++;
        }
      };
      let nativeCount = fields.count;
      if (splitStencil) {
        nativeCount = 0; visitStencilTriangles(() => { nativeCount += 3; });
        normalize = true;
      } else if (assembled) {
        nativeCount = 0; let length = 0;
        for (let i = 0; i <= fields.count; i++) {
          if (i === fields.count || isRestart(sourceIndex(i))) {
            nativeCount += fields.mode === 2 ? length >= 2 ? length * 2 : 0 : Math.max(0, length - 2) * 3;
            length = 0;
          } else length++;
        }
        require(nativeCount <= fields.count * 3, "limit-exceeded", "Expanded native primitive work exceeds original source bound.");
        normalize = true;
      }
      const nativeDrawCalls = splitStencil ? nativeCount / 3 * 2 * instances : 1;
      const nativeVertexWork = nativeCount * instances * (splitStencil ? 2 : 1);
      require(!orderedStencil || nativeVertexWork <= vertexWork * 6 && nativeDrawCalls <= vertexWork * 2,
        "limit-exceeded", "Ordered native work exceeds the original source budget.");
      const mode = gl[DRAW_MODES[nativeMode]], nativeIndexed = fields.indexed || assembled;
      const nativeIndexSize = normalize ? 4 : indexSize, nativeIndexOffset = normalize ? 0 : indexOffset;
      const indexType = nativeIndexSize === 1 ? gl.UNSIGNED_BYTE : nativeIndexSize === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
      const originalIndexBuffer = normalize ? gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) : null;
      try {
        if (normalize) {
          const byteLength = nativeCount * 4;
          require(standard && job && job.normalizedIndices.length < drawLimits.drawsPerSubmission &&
            byteLength <= drawLimits.indicesPerSubmission * (assemblyLists ? 12 : 4) - job.normalizedBytes,
          "limit-exceeded", "Owned normalized index budget exceeded.");
          job.normalizationScratchBytes = byteLength;
          const words = new Uint32Array(nativeCount);
          if (splitStencil) {
            let out = 0;
            visitStencilTriangles((a, b, c) => { words[out++] = a; words[out++] = b; words[out++] = c; });
          } else if (assembled) {
            let first = 0, previous = 0, length = 0, out = 0;
            for (let i = 0; i <= fields.count; i++) {
              if (i === fields.count || isRestart(sourceIndex(i))) {
                if (fields.mode === 2 && length >= 2) { words[out++] = previous; words[out++] = first; }
                length = 0;
              } else {
                const value = sourceIndex(i);
                if (length === 0) first = value;
                else if (fields.mode === 2) { words[out++] = previous; words[out++] = value; }
                else if (length >= 2) { words[out++] = first; words[out++] = previous; words[out++] = value; }
                previous = value; length++;
              }
            }
          } else for (let i = 0; i < words.length; i++) {
            const offset = i * indexSize, value = indexSize === 1 ? indices.getUint8(offset) : indexSize === 2 ? indices.getUint16(offset, true) : indices.getUint32(offset, true);
            words[i] = fields.primitiveRestart && value === fields.restartIndex ? 0xffffffff : value;
          }
          const buffer = gl.createBuffer();
          require(buffer, "backend-error", "Normalized index buffer allocation failed.");
          // Own before upload/check: even a partial native allocation drains
          // with the job. The work ceiling bounds all retained streams.
          job.normalizedIndices.push(buffer); job.normalizedBytes += byteLength;
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, words, gl.STREAM_DRAW); check();
        }
        if (images) {
          for (const sampler of plan.program.samplers) {
            const token = sub.views[sampler.stage][sampler.index].imageRange;
            if (!job.imageHolds.has(token)) job.imageHolds.set(token, unwrap(imageAccess.hold(token)).token);
          }
          holdImageSurfaces(job, sub);
        }
        if (uniform) {
          for (const range of plan.uniformRanges) unwrap(uniformAccess.validate(range.token));
          for (const range of plan.uniformRanges) {
            unwrap(uniformAccess.submit(range.token)); job.pendingUniformRanges.delete(range.token);
            if (job.uniformHolds.has(range.generation)) unwrap(uniformAccess.release(range.token));
            else job.uniformHolds.set(range.generation, range.token);
          }
        }
        const raster = () => { if (splitStencil) {
          for (let instance = 0; nativeCount > 0 && instance < instances; instance++) {
            if (instanceBase) {
              applyInstanceBase(plan.program, instance); applyInstanceAttributes(plan, instance); check();
            }
            for (let i = 0; i < nativeCount; i += 3) for (let face = 0; face < 2; face++) {
              applyStencil(sub, face); gl.enable(gl.CULL_FACE); gl.cullFace(face ? gl.FRONT : gl.BACK); check();
              work.drawCalls++;
              gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_INT, i * 4); check();
            }
          }
        } else if (nativeIndexed) {
          if (plan.stencilLowering === "front") { applyStencil(sub, 0); check(); }
          if (instances > 1) gl.drawElementsInstanced(mode, nativeCount, indexType, nativeIndexOffset, instances);
          else gl.drawElements(mode, nativeCount, indexType, nativeIndexOffset);
        } else {
          if (plan.stencilLowering === "front") { applyStencil(sub, 0); check(); }
          if (instances > 1) gl.drawArraysInstanced(mode, fields.start, fields.count, instances);
          else gl.drawArrays(mode, fields.start, fields.count);
        } };
        if (production) booleanQueries.measure(sub, raster); else raster();
      } finally {
        if (instanceBase && splitStencil) {
          applyInstanceBase(plan.program, 0); applyInstanceAttributes(plan, 0);
        }
        if (normalize) {
          job.normalizationScratchBytes = 0;
          // Detach from the VAO before any yield; native storage remains owned
          // until the job's final completion/drain or explicit disposal.
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, originalIndexBuffer);
        }
        if (plan.stencilLowering) {
          applyStencil(sub);
          gl[sub.rasterizer?.fields.cullFace === 2 ? "enable" : "disable"](gl.CULL_FACE);
          gl.cullFace(gl.BACK);
        }
      }
      if (!splitStencil) work.drawCalls++;
      check();
      work.draws++;
      submission.indices += vertexWork;
      submission.draws.push({ byteOffset: command.byteOffset, opcode: 8, count: fields.count, indexed: fields.indexed, mode: fields.mode, start: fields.start,
        indexOffset, indexByteLength, actualMinIndex, actualMaxIndex,
        ...(streamOutput ? {streamOutput: captured, rasterizerDiscard: plan.discard, countFromStreamOutput: command.fields.countFromStreamOutput} : {}),
        ...(standard ? { instanceCount: fields.instanceCount, effectiveInstances: instances, vertexWork, indexSize,
          primitiveRestart: fields.primitiveRestart, restartIndex: fields.restartIndex, validIndexCount, restartCount,
          normalizedIndices: normalize, nativeIndexSize, nativeIndexOffset, normalizedIndexBytes: normalize ? nativeCount * 4 : 0,
          ...(assemblyLists ? { primitiveAssembly, assembled, nativeMode, nativeCount, nativeIndexed, nativeVertexWork } : {}),
          ...(orderedStencil ? { stencilLowering: plan.stencilLowering, nativeDrawCalls } : {}) } : {}),
        contextId: ctx.id, contextGeneration: ctx.generation, subContextId: sub.id, subContextGeneration: sub.generation,
        indexResourceId: indexStorage?.metadata.id ?? null, indexResourceGeneration: indexStorage?.generation ?? null,
        vertexFetches, framebuffer: surface ? { resourceId: surface.metadata.id, resourceGeneration: surface.generation,
          width: images ? (plan.primarySurface ?? sub.surfaces[0]).dimensions.width : surface.metadata.width, height: images ? (plan.primarySurface ?? sub.surfaces[0]).dimensions.height : surface.metadata.height,
          ...(images ? { level: (plan.primarySurface ?? sub.surfaces[0]).fields.level } : {}),
          ...(dimensionalColorSurfaces ? { target: plan.primarySurface.metadata.target, layer: plan.primarySurface.fields.firstLayer } : {}),
          ...(multipleColors ? { colors: Array.from({ length: 4 }, (_, slot) => {
            const target = sub.surfaces[slot];
            return target ? { slot, resourceId: target.metadata.id, resourceGeneration: target.resourceGeneration,
              format: target.metadata.format, level: target.fields.level, width: target.dimensions.width, height: target.dimensions.height,
              ...(dimensionalColorSurfaces ? { target: target.metadata.target, layer: target.fields.firstLayer } : {}) } : null;
          }) } : {}),
          depthResourceId: sub.depthSurface?.metadata.id ?? null, depthResourceGeneration: sub.depthSurface?.resourceGeneration ?? null,
          ...(dimensionalDepthSurfaces && sub.depthSurface ? { depth: { target: sub.depthSurface.metadata.target, format: sub.depthSurface.fields.format, level: sub.depthSurface.fields.level, layer: sub.depthSurface.fields.firstLayer, width: sub.depthSurface.dimensions.width, height: sub.depthSurface.dimensions.height } } : {}) } : null,
        vertexShader: ref(sub.shaders[0]), fragmentShader: ref(sub.shaders[1]),
        ...(uniform ? { bufferZeroMask: plan.program.bufferZeroMask, uniformRanges: plan.uniformRanges.map(range => ({
          stage: range.block.stage, slot: range.block.slot, binding: range.block.binding,
          resourceId: range.metadata.id, resourceGeneration: range.generation, offset: range.offset, length: range.byteLength })) } : {}) });
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
    const apply = (ctx, command, submission, job = null) => {
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
        case 19: booleanQueries.begin(sub, lookup(sub, fields.handle, 9)); break;
        case 20: booleanQueries.end(sub, lookup(sub, fields.handle, 9)); break;
        case 21: booleanQueries.get(lookup(sub, fields.handle, 9)); break;
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
            require(floatingDepth ? (["depth-texture", "mip-depth-texture"].includes(depthSurface.metadata.kind) || dimensionalDepthSurfaces && depthSurface.metadata.kind === "dimensional-depth-texture") : depthSurface.metadata.kind === "depth-texture", "incompatible-resource", "The depth attachment requires a qualified depth surface.");
            resolve(depthSurface.lease);
          }
          for (const surface of surfaces) if (surface) {
            require(images ? (["texture", "mip-texture"].includes(surface.metadata.kind) || dimensionalColorSurfaces && surface.metadata.kind === "dimensional-texture" && (surface.metadata.format === 67 || production)) : surface.metadata.kind === "texture", "incompatible-resource", "A depth surface cannot be a color attachment.");
            resolve(surface.lease);
            require(!depthSurface || ((images ? surface.dimensions.width : surface.metadata.width) === (floatingDepth ? depthSurface.dimensions?.width ?? depthSurface.metadata.width : depthSurface.metadata.width) && (images ? surface.dimensions.height : surface.metadata.height) === (floatingDepth ? depthSurface.dimensions?.height ?? depthSurface.metadata.height : depthSurface.metadata.height)),
              "incompatible-resource", "Color and depth attachment dimensions differ.");
          }
          const attachments = [...surfaces,depthSurface].filter(Boolean);
          require(attachments.every(target => target.metadata.nrSamples === attachments[0].metadata.nrSamples),
            "incompatible-resource", "Framebuffer attachment sample counts differ.");
          for (let index = 0; index < Math.max(sub.surfaces.length, surfaces.length); index++) objectRef(sub, sub.surfaces[index], surfaces[index]);
          sub.depthSurface = objectRef(sub, sub.depthSurface, depthSurface);
          sub.surfaces = surfaces; break;
        }
        case 6: {
          const buffers = [];
          try {
            for (const value of fields.buffers) {
              if (value.resourceHandle === 0) { require(value.stride === 0 && value.offset === 0, "invalid-state", "Unbound vertex buffer fields must be zero."); buffers.push(null); continue; }
              const binding = retain(ctx, value.resourceHandle, "vertex", bufferRoles ? "standard-buffer" : uniform ? ["vertex-buffer", "uniform-buffer"] : "vertex-buffer"); buffers.push({ ...binding, fields: value });
              require(value.offset <= binding.metadata.byteLength && value.stride <= 255 &&
                (standard || value.stride % 4 === 0 && value.offset % 4 === 0), "out-of-bounds", "Invalid vertex buffer range/stride.");
            }
            vertexLayout(sub, sub.vertexElements, buffers);
          } catch (error) { for (const buffer of buffers) if (buffer) release(buffer.lease); throw error; }
          for (const buffer of sub.vertexBuffers) if (buffer) release(buffer.lease);
          sub.vertexBuffers = buffers; break;
        }
        case 16: case 17: {
          require(production && job, "unsupported-blit", "Image copies require a retained production job.");
          let source = null, destination = null;
          const copying = op === 17, role = !copying && fields.mask & 48 ? "depth-surface" : "surface";
          try {
            source = retain(ctx,fields.source.resourceHandle,role,["texture","mip-texture","depth-texture","mip-depth-texture"]);
            destination = retain(ctx,fields.destination.resourceHandle,role,["texture","mip-texture","depth-texture","mip-depth-texture"]);
            require(!copying || source.metadata.nrSamples === 0 && destination.metadata.nrSamples === 0 &&
              [1, 67].includes(source.metadata.format) && source.metadata.format === destination.metadata.format,
              "unsupported-blit", "Resource copies require matching single-sample RGBA8 or BGRA8 images.");
            const blit = copying ? {mask: 15, filter: 0, scissor: null,
              source: {...fields.source, format: source.metadata.format},
              destination: {...fields.destination, format: destination.metadata.format}} : fields;
            for (const entry of [source,destination]) if (!job.imageSources.has(entry.resourceGeneration)) {
              const held = unwrap(imageAccess.holdStorage(entry.lease));job.imageSources.set(held.generation,held.token);
            }
            executeFramebufferBlit(gl,blit,resolve(source.lease),resolve(destination.lease),require,check);
            unwrap(imageAccess.markWritten(destination.lease));return;
          } finally {if (source) release(source.lease);if (destination) release(destination.lease);}
        }
        case 7: {
          require(!images || job, "unsupported-clear", "Original image clears require an owned completion job.");
          if (multipleColors) {
            const targets = Array.from({ length: 4 }, (_, slot) => ({ slot, surface: sub.surfaces[slot] }))
              .filter(({ slot }) => fields.buffers & (4 << slot));
            for (const { surface } of targets) {
              require(surface, "incomplete-framebuffer", "Selected color CLEAR needs its original surface.");
              require(integerFormat(surface.metadata.format) || fields.color.every(Number.isFinite),
                "invalid-value", "A floating attachment clear requires finite original float words.");
            }
            require(!(fields.buffers & 1) || sub.depthSurface, "incomplete-framebuffer", "Depth CLEAR needs a depth surface.");
            holdImageSurfaces(job, sub); restore(sub); gl.disable(gl.SCISSOR_TEST);
            for (const { slot, surface } of targets) {
              indexedColors.colorMaskiOES(slot, true, true, true, !xAlpha(sub, slot));
              const format = integerFormat(surface.metadata.format);
              if (format) gl[format.signed ? "clearBufferiv" : "clearBufferuiv"](gl.COLOR, slot,
                format.signed ? new Int32Array(fields.colorWords) : new Uint32Array(fields.colorWords));
              else gl.clearBufferfv(gl.COLOR, slot, fields.color);
            }
            if (fields.buffers & 2) { gl.stencilMask(255); gl.clearStencil(fields.stencil); }
            if (fields.buffers & 1) { gl.depthMask(true); gl.clearDepth(fields.depth); }
            if (fields.buffers & 3) gl.clear((fields.buffers & 1 ? gl.DEPTH_BUFFER_BIT : 0) | (fields.buffers & 2 ? gl.STENCIL_BUFFER_BIT : 0));
            if (fields.buffers & 2) restoreStencilMasks(sub);
            for (let slot = 0; slot < 4; slot++) indexedColors.colorMaskiOES(slot, ...colorMask(sub, slot));
            gl.depthMask(sub.dsa?.fields.depthWriteMask ?? false);
            if (sub.rasterizer?.fields.scissor) gl.enable(gl.SCISSOR_TEST);
            check(); return;
          }
          const integerClear = integers ? integerFormat(sub.surfaces[0]?.metadata.format) : null;
          require(!integers || !(fields.buffers & 4) || integerClear || fields.color.every(Number.isFinite),
            "invalid-value", "A floating color clear requires finite original float words.");
          if (images) holdImageSurfaces(job, sub);
          require(!(fields.buffers & 4) || sub.surfaces[0], "incomplete-framebuffer", "Color CLEAR needs a color surface.");
          require(!(fields.buffers & 1) || sub.depthSurface, "incomplete-framebuffer", "Depth CLEAR needs a depth surface.");
          restore(sub);
          // Gallium full clear ignores scissor and component/depth write masks.
          // Pinned vrend_clear restores these after issuing the complete clear.
          gl.disable(gl.SCISSOR_TEST);
          const floatClear = floats && Boolean(floatColorFormat(sub.surfaces[0]?.metadata.format) || (packed ? packedFloatColorFormat(sub.surfaces[0]?.metadata.format) : null));
          if (fields.buffers & 4) {
            gl.colorMask(true, true, true, !xAlpha(sub));
            if (integerClear) gl[integerClear.signed ? "clearBufferiv" : "clearBufferuiv"](gl.COLOR, 0,
              integerClear.signed ? new Int32Array(fields.colorWords) : new Uint32Array(fields.colorWords));
            else if (floatClear) gl.clearBufferfv(gl.COLOR, 0, fields.color);
            else gl.clearColor(...fields.color);
          }
          if (fields.buffers & 1) { gl.depthMask(true); gl.clearDepth(fields.depth); }
          gl.clear((!floatClear && !integerClear && fields.buffers & 4 ? gl.COLOR_BUFFER_BIT : 0) | (fields.buffers & 1 ? gl.DEPTH_BUFFER_BIT : 0));
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
            value = { ...retain(ctx, fields.resourceHandle, "index", bufferRoles ? "standard-buffer" : "index-buffer"), fields };
            if (fields.offset > value.metadata.byteLength) { release(value.lease); throw new StateFault("out-of-bounds", "Index offset exceeds storage."); }
          }
          if (sub.indexBuffer) release(sub.indexBuffer.lease); sub.indexBuffer = value; break;
        }
        case 12:
          if (uniform && fields.stage <= 1 && fields.index <= 12) {
            const old = sub.uniformBuffers[fields.stage][fields.index];
            if (old) release(old.lease); sub.uniformBuffers[fields.stage][fields.index] = null;
          }
          if (fields.stage <= 1 && fields.index === 0) sub.constants[fields.stage] = fields.words;
          else sub.resets[`${command.name}:${fields.stage}:${fields.index}`] = fields;
          break;
        case 13: sub.stencilRef = fields; break;
        case 14: sub.blendColor = fields.color; break;
        case 15: if (fields.scissors.length) sub.scissor = fields.scissors[0]; break;
        case 25: {
          if (!streamOutput) break;
          const targets = fields.handles.map(handle => lookup(sub, handle, 10, true));
          if (!targets.some(Boolean)) {sub.streamTuple = null;break;}
          const key = targets.map(target => target?.generation ?? 0).join(":");
          let tuple = sub.streamTuples.get(key);
          if (!tuple) {
            require(sub.streamTuples.size < limits.objects, "limit-exceeded", "Retained output tuple budget exceeded.");
            tuple = {key, targets: targets.map(target => objectRef(sub, null, target)), cursors: [0, 0, 0, 0]};sub.streamTuples.set(key, tuple);
          }
          sub.streamTuple = tuple;sub.resets.streamOutputAppendBitmask = fields.appendBitmask;break;
        }
        case 27: {
          require(uniform, "unsupported-command", "Uniform bindings require explicit host selection.");
          if (fields.stage > 1 || fields.index > 12) { sub.resets[`${command.name}:${fields.stage}:${fields.index}`] = fields; break; }
          let value = null;
          if (fields.resourceHandle) {
            value = { ...retain(ctx, fields.resourceHandle, "uniform", bufferRoles ? "standard-buffer" : ["vertex-buffer", "uniform-buffer"]), fields };
            try {
              require(fields.offset % uniformHost.alignment === 0 && fields.offset <= value.metadata.byteLength &&
                fields.length <= value.metadata.byteLength - fields.offset, "out-of-bounds", "Original uniform buffer range or native alignment is invalid.");
            } catch (error) { release(value.lease); throw error; }
          }
          const old = sub.uniformBuffers[fields.stage][fields.index];
          if (old) release(old.lease); sub.uniformBuffers[fields.stage][fields.index] = value; break;
        }
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
          if (!production && candidate.every(Boolean)) link(sub, candidate[0], candidate[1]);
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
        constants: sub.constants.map((words) => [...words]), ...(streamOutput ? {streamOutput: sub.streamTuple ? {key: sub.streamTuple.key, targets: sub.streamTuple.targets.map(ref), cursors: [...sub.streamTuple.cursors]} : null} : {}),
        ...(uniform ? { uniformBuffers: sub.uniformBuffers.map(entries => entries.map(bank => bank ?
          { ...bank.fields, resourceGeneration: bank.resourceGeneration } : null)) } : {}), viewport: sub.viewport, scissor: sub.scissor, blendColor: [...sub.blendColor],
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
      if (uniform) {
        for (const token of job.pendingUniformRanges) unwrap(uniformAccess.release(token));
        job.pendingUniformRanges.clear();
      }
      job.request = null;
    };
    const releaseUniformHolds = job => {
      if (!uniform) return;
      for (const token of job.uniformHolds.values()) unwrap(uniformAccess.release(token));
      job.uniformHolds.clear();
    };
    const releaseCaptures = job => {
      if (!streamOutput) return;
      for (const token of job.streamAllocations) unwrap(captureAccess.release(token));job.streamAllocations.length = 0;
      for (const feedback of job.streamFeedbacks) gl.deleteTransformFeedback(feedback);job.streamFeedbacks.length = 0;
      for (const {sub, object} of job.streamHolds.values()) objectRef(sub, object, null);job.streamHolds.clear();
    };
    const releaseNormalizedIndices = (job) => {
      for (const buffer of job.normalizedIndices) gl.deleteBuffer(buffer);
      job.normalizedIndices.length = 0; job.normalizedBytes = 0; job.normalizationScratchBytes = 0;
    };
    const getJob = (token) => {
      alive(); require(activeJob && activeJob.token === token, "invalid-job", "Unknown, completed or foreign renderer job.");
      return activeJob;
    };
    const validateJob = (job) => {
      require(context(job.ctx.id) === job.ctx, "stale-context", "Renderer context identity changed.");
      if (uniform) for (const token of job.pendingUniformRanges) unwrap(uniformAccess.validate(token));
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
    const holdImageSurfaces = (job, sub) => {
      for (const surface of [...sub.surfaces, sub.depthSurface]) if (surface && !job.imageSources.has(surface.resourceGeneration)) {
        const held = unwrap(imageAccess.holdStorage(surface.lease)); job.imageSources.set(held.generation, held.token);
      }
    };
    const releaseImageHolds = job => {
      if (!images) return;
      for (const token of [...job.imageHolds.values(), ...job.imageSources.values()]) unwrap(imageAccess.release(token));
      job.imageHolds.clear(); job.imageSources.clear();
    };
    const finishJob = (job, gpuComplete) => {
      if (production && gpuComplete && !job.error) booleanQueries.pollPending();
      releaseJobAccess(job);
      releaseNormalizedIndices(job); releaseUniformHolds(job); releaseImageHolds(job); releaseCaptures(job);
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
        if (production && !job.error && !gl.isContextLost()) booleanQueries.pollPending();
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
              constantAttributes.set(read.attributeIndex, constantVertexValues(read.bytes, read.sourceFormat));
            }
          }
          // Keep earlier collected tickets alive and revalidate the entire batch
          // in this task. A later read cannot hide a changed earlier source.
          validateJob(job);
          job.serial++; issueDraw(job.pending.plan, indexBytes, job.submission, constantAttributes, job);
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
          job.serial++; issueDraw(job.pending.plan, polled.bytes, job.submission, null, job);
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
            const plan = prepareDraw(job.ctx, sub, job.command, job.submission, job);
            if (plan.constants.length) {
              const reads = plan.constants.map(({ attribute, element, buffer }) => ({
                lease: buffer.lease, attributeIndex: attribute.index, sourceFormat: element.sourceFormat,
                box: { x: buffer.fields.offset + element.sourceOffset, y: 0, z: 0, width: vertexFormat(element.sourceFormat).elementBytes, height: 1, depth: 1 },
              }));
              if (plan.index) reads.push({ lease: plan.index.lease,
                box: { x: plan.indexOffset, y: 0, z: 0, width: plan.indexByteLength, height: 1, depth: 1 } });
              require(reads.length <= 17 && reads.reduce((sum, read) => sum + read.box.width, 0) <= jobLimits.transferBytes,
                "limit-exceeded", "Constant attribute and index staging exceeds job limit.");
              job.pending = { sub, plan, reads: [], readStarted: false, fenceSerial: job.serial };
              for (const read of reads) {
                job.serial++;
                const access = unwrap(asyncAccess.beginStorageRead(read.lease, read.box));
                job.pending.reads.push({ ...access, attributeIndex: read.attributeIndex, sourceFormat: read.sourceFormat, ready: false });
                job.pending.readStarted = true; job.pending.fenceSerial = job.serial; job.hadFence = true;
              }
              job.phase = "waiting-attributes"; return jobStatus(job, "waiting-gpu");
            }
            if (!plan.index) {
              issueDraw(plan, null, job.submission, null, job); advanceJob(job); budget--; continue;
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
          apply(job.ctx, job.command, job.submission, job); advanceJob(job); budget--;
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
      ...(production ? {checkpointQueryState() { return result(() => {
        alive(); idle();const state=booleanQueries.checkpointState();
        require(state.every(q=>!q.requested && q.nativeParts===0 && q.state!=='active' && q.state!=='ended'),
          'busy','Checkpoint requires drained original queries.');return success({queries:state});
      }); }} : {}),
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
          ...(drawing ? { drawLimits } : {}), ...(standard ? { primitiveAssembly } : {}),
          ...(asynchronous ? { jobLimits, jobs: { active: activeJob === null ? 0 : 1, status: activeJob?.phase ?? "idle",
            appliedCommands: activeJob?.index ?? 0, commandCount: activeJob?.commands.length ?? 0,
            draws: activeJob?.submission.draws.length ?? 0,
            inputBytes: activeJob?.phase === "upload-ready" ? activeJob.pending.layout.tightBytes : 0,
            outputBytes: activeJob?.request?.bytes?.byteLength ?? 0,
            reads: asyncAccess.inspect().reads, transfers: asyncAccess.inspect().transfers, stagingBytes: asyncAccess.inspect().stagingBytes,
            ...(standard ? { normalizedBuffers: activeJob?.normalizedIndices.length ?? 0,
              normalizedBytes: activeJob?.normalizedBytes ?? 0, normalizationScratchBytes: activeJob?.normalizationScratchBytes ?? 0,
              ...(images ? { imageHolds: activeJob?.imageHolds.size ?? 0, imageSources: activeJob?.imageSources.size ?? 0 } : {}),
            ...(uniform ? { uniformPending: activeJob?.pendingUniformRanges.size ?? 0, uniformHolds: activeJob?.uniformHolds.size ?? 0 } : {}) } : {}) } } : {}),
          budgets: { contexts: contexts.size, subContexts: subCount, objects: objects.size, programs: programs.size,
            ...(production ? {queries: booleanQueries.inspect()} : {}),
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
          work.failedSubmissions++; releaseJobAccess(activeJob); releaseNormalizedIndices(activeJob); releaseUniformHolds(activeJob); releaseImageHolds(activeJob); releaseCaptures(activeJob);
          if (activeJob.sync) gl.deleteSync(activeJob.sync); activeJob = null;
        }
        for (const ctx of contexts.values()) for (const sub of ctx.subs.values()) disposeSub(sub);
        if (unusedUniformBuffer) { gl.deleteBuffer(unusedUniformBuffer); unusedUniformBuffer = null; uniformBytes -= 16384; }
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
              error: null, serial: 0, completedSerial: -1, hadFence: false, sync: null,
              normalizedIndices: [], normalizedBytes: 0, normalizationScratchBytes: 0, ...(streamOutput ? {streamAllocations: [], streamFeedbacks: [], streamHolds: new Map(), streamCalls: 0, streamCopies: 0} : {}),
              ...(uniform ? { pendingUniformRanges: new Set(), uniformHolds: new Map() } : {}), ...(images ? { imageHolds: new Map(), imageSources: new Map() } : {}) };
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
