/** Bounded resource ownership and transfers. See resources-README.md. */
/** Original RGBA8 volume, cube and array layout; selected by the host only. */
export const STANDARD_DIMENSIONAL_TRANSFER_PROFILE = "virgl-standard-dimensional-rgba8-transfer-v1";
export const STANDARD_DIMENSIONAL_VIEW_TRANSFER_PROFILE = "virgl-standard-dimensional-rgba8-view-transfer-v1";
export const STANDARD_DIMENSIONAL_DEPTH_VIEW_TRANSFER_PROFILE = "virgl-standard-dimensional-depth-view-transfer-v1";
import {dimensionalDepthMetadata, dimensionalDepthTransferCosts, createDimensionalDepthGpuAccess, STANDARD_DIMENSIONAL_DEPTH_TRANSFER_PROFILE} from "./dimensional-depth-images.mjs";
export {STANDARD_DIMENSIONAL_DEPTH_TRANSFER_PROFILE};
const DIMENSIONAL_LIMITS = Object.freeze({ texture3DSize: 2048, cubeTextureSize: 16384, arrayLayers: 2048 });

function dimensionalMetadata(meta, limits, require, product, color = null) {
  const target = meta.target;
  require([3, 4, 7].includes(target) && (meta.format === 67 || color) && meta.nrSamples === 0 && meta.flags === 0,
    "unsupported-resource", "Only original single-sample RGBA8 volume, cube and array storage is selected.");
  const roles = meta.bind & 10, hints = (1 << 18) | (1 << 20);
  require(roles !== 0 && (!color?.snorm && !color?.sharedExponent || roles === 8) && (meta.bind & ~(10 | hints)) === 0, "unsupported-resource", "Unqualified dimensional image role.");
  require(target === 3 ? meta.arraySize === 1 : target === 4 ? meta.depth === 1 && meta.arraySize === 6 && meta.width === meta.height : meta.depth === 1,
    "unsupported-resource", "Original volume, cube or array shape is inconsistent.");
  const size = target === 3 ? limits.texture3DSize : target === 4 ? limits.cubeTextureSize : limits.textureSize;
  require(meta.width <= size && meta.height <= size && (target !== 3 || meta.depth <= size) &&
    (target !== 7 || meta.arraySize <= limits.arrayLayers), "limit-exceeded", "Dimensional storage exceeds the selected host limits.");
  const largest = Math.max(meta.width, meta.height, target === 3 ? meta.depth : 1);
  require(meta.lastLevel <= Math.floor(Math.log2(largest)), "unsupported-resource", "Mip chain extends beyond its final dimensional level.");
  const levels = [];
  let width = meta.width, height = meta.height, layers = target === 3 ? meta.depth : meta.arraySize, byteLength = 0, gpuByteLength = 0;
  for (let level = 0; level <= meta.lastLevel; level++) {
    const pixels = product(product(width, height, limits.resourceBytes, "Dimensional plane exceeds the byte limit."), layers,
      limits.resourceBytes, "Dimensional level exceeds the byte limit.");
    const bytes = product(pixels, color?.pixelBytes ?? 4, limits.resourceBytes, "Dimensional level exceeds the byte limit.");
    const nativeBytes = product(pixels, color?.nativePixelBytes ?? 4, limits.resourceBytes, "Native dimensional level exceeds byte limit.");
    require(bytes <= limits.resourceBytes - byteLength && nativeBytes <= limits.resourceBytes - gpuByteLength, "limit-exceeded", "Complete dimensional mip chain exceeds the resource limit.");
    levels.push({ level, width, height, layers, byteLength: bytes, gpuByteLength: nativeBytes });
    byteLength += bytes; gpuByteLength += nativeBytes; width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
    if (target === 3) layers = Math.max(1, Math.floor(layers / 2));
  }
  return { ...meta, kind: "dimensional-texture", pixelBytes: color?.pixelBytes ?? 4, byteLength, gpuByteLength, levels, ...(color?.precision ? {floatPrecision:color.precision} : {}), ...(color?.packedFloat ? {packedFloat:true} : {}), ...(color?.sharedExponent ? {sharedExponent:true} : {}), ...(color?.integerBits ? {integerBits:color.integerBits} : {}), ...(color?.packedNormalized ? {packedNormalized:true} : {}), ...(color?.packedUnsigned ? {packedUnsigned:true} : {}) };
}

function dimensionalLayout(meta, fields, backingBytes, limits, require, product) {
  require(fields.resourceHandle === meta.id && fields.level <= meta.lastLevel,
    "invalid-transfer", "Dimensional resource identity or level mismatch.");
  const selected = meta.levels[fields.level], box = fields.box;
  for (const [origin, extent, bound] of [[box.x, box.width, selected.width], [box.y, box.height, selected.height], [box.z, box.depth, selected.layers]]) {
    require(origin <= bound && extent <= bound - origin, "out-of-bounds", "Dimensional transfer box exceeds its selected level.");
  }
  const rowBytes = product(box.width, meta.pixelBytes, limits.transferBytes, "Dimensional transfer row exceeds the byte limit.");
  const rowStride = fields.stride || product(selected.width, meta.pixelBytes, 0xffffffff, "Default dimensional row stride overflows.");
  require(rowStride >= rowBytes, "out-of-bounds", "Dimensional rows overlap.");
  const layerStride = fields.layerStride || product(rowStride, selected.height, 0xffffffff, "Default dimensional layer stride overflows.");
  require(layerStride >= product(rowStride, box.height, 0xffffffff, "Dimensional layer stride overflows."),
    "out-of-bounds", "Dimensional layers overlap.");
  const rows = product(box.height - 1, rowStride, 0xffffffff, "Dimensional row footprint overflows.");
  const layers = product(box.depth - 1, layerStride, 0xffffffff, "Dimensional layer footprint overflows.");
  require(rows <= 0xffffffff - layers && rowBytes <= 0xffffffff - layers - rows,
    "out-of-bounds", "Complete dimensional footprint overflows.");
  const footprintBytes = layers + rows + rowBytes;
  const inline = Object.hasOwn(fields, "dataWords");
  const offset = inline ? 0 : Object.hasOwn(fields, "flags") ? fields.stagingOffset : fields.dataOffset;
  require(offset <= backingBytes && footprintBytes <= backingBytes - offset, "out-of-bounds", "Dimensional transfer exceeds backing bytes.");
  require(footprintBytes <= limits.transferBytes, "limit-exceeded", "Dimensional transfer footprint exceeds the byte limit.");
  if (inline) require(fields.dataWords.length * 4 === Math.ceil(footprintBytes / 4) * 4,
    "invalid-transfer", "Inline dimensional data must contain exactly its aligned footprint.");
  const tightBytes = product(product(rowBytes, box.height, limits.transferBytes, "Dimensional plane exceeds the transfer limit."),
    box.depth, limits.transferBytes, "Dimensional transfer exceeds the byte limit.");
  const layout = { kind: "texture", box: { ...box }, level: fields.level, levelWidth: selected.width, levelHeight: selected.height,
    offset, rowBytes, rowCount: box.height, layerCount: box.depth, rowStride, layerStride, footprintBytes, requiredEnd: offset + footprintBytes, tightBytes,
    direction: fields.direction === 2 || fields.flags === 3 ? "readback" : "upload" };
  if (meta.kind === "dimensional-depth-texture") return {...layout,...dimensionalDepthTransferCosts(meta,layout,limits,product)};
  const color = ownedColorFormat(meta), pixels = product(product(box.width,box.height,limits.scratchBytes,"Color plane too large"),box.depth,limits.scratchBytes,"Color layers too large");
  if (!color && meta.format === 67) return layout;
  const nativeReadBytes = product(pixels,color?.readPixelBytes ?? 4,limits.scratchBytes,"Native layered read too large");
  const scratchBytes = fields.direction === 2 || fields.flags === 3 ? nativeReadBytes : product(pixels,Math.max(meta.pixelBytes,color?.nativePixelBytes ?? (meta.format === 2 ? 3 : 4)),limits.scratchBytes,"Layered upload too large");
  const conversionBytes = color?.sharedExponent && layout.direction === "readback" ? product(box.width*box.height,4,limits.gpuBytes,"Shared layer conversion too large") : 0;
  return {...layout,scratchBytes,nativeReadBytes,...(layout.direction === "readback" ? {stagingBytes:nativeReadBytes+conversionBytes,conversionBytes} : {})};
}

function* dimensionalRows(layout) {
  for (let layer = 0; layer < layout.layerCount; layer++) for (let row = 0; row < layout.rowCount; row++) {
    yield { backing: layout.offset + layer * layout.layerStride + row * layout.rowStride,
      tight: (layer * layout.rowCount + row) * layout.rowBytes };
  }
}

function createDimensionalGpuAccess(gl, framebuffer, check, require, colorFormat, nativeUpload) {
  require(["texStorage3D", "texSubImage3D", "framebufferTextureLayer"].every(name => typeof gl[name] === "function"),
    "invalid-input", "Dimensional storage requires a WebGL2 context.");
  const nativeLimits = { texture3DSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE), cubeTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
    arrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) };
  require(Object.values(nativeLimits).every(value => Number.isInteger(value) && value > 0),
    "unsupported-host", "Invalid dimensional texture limits.");
  const textureTarget = target => target === 3 ? gl.TEXTURE_3D : target === 4 ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D_ARRAY;
  const attach = (storage, layout, layer) => {
    if (storage.target === gl.TEXTURE_CUBE_MAP) gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + layout.box.z + layer, storage.texture, layout.level);
    else gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, storage.texture, layout.level, layout.box.z + layer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Dimensional read framebuffer is incomplete.");
  };
  return Object.freeze({
    nativeLimits,
    allocate(meta) {
      const texture = gl.createTexture();
      require(texture !== null, "backend-error", "Dimensional texture allocation failed.");
      const target = textureTarget(meta.target), profile = colorFormat(meta);
      try {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(target, texture);
        if (meta.target === 4) gl.texStorage2D(target, meta.lastLevel + 1, profile.internal, meta.width, meta.height);
        else gl.texStorage3D(target, meta.lastLevel + 1, profile.internal, meta.width, meta.height, meta.target === 3 ? meta.depth : meta.arraySize);
        gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(target, axis, gl.CLAMP_TO_EDGE);
        check(); return Object.freeze({ kind: "texture", dimensional: true, texture, target, format:meta.format });
      } catch (error) { gl.deleteTexture(texture); throw error; }
    },
    upload(storage, layout, bytes, meta) {
      const profile=colorFormat(meta), native=nativeUpload(meta.format,bytes);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(storage.target, storage.texture);
      const box = layout.box;
      if (storage.target === gl.TEXTURE_CUBE_MAP) {
        const planeElements = native.length / box.depth;
        for (let layer = 0; layer < box.depth; layer++) gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + box.z + layer,
          layout.level, box.x, box.y, box.width, box.height, profile.upload, profile.type, native.subarray(layer * planeElements, (layer + 1) * planeElements));
      } else gl.texSubImage3D(storage.target, layout.level, box.x, box.y, box.z, box.width, box.height, box.depth,
        profile.upload, profile.type, native);
      check();
    },
    read(storage, layout, bytes = null) {
      const profile=colorFormat({format:storage.format});
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      try {
        const planeBytes = (layout.nativeReadBytes ?? layout.tightBytes) / layout.layerCount;
        for (let layer = 0; layer < layout.layerCount; layer++) {
          attach(storage, layout, layer);
          gl.readPixels(layout.box.x, layout.box.y, layout.box.width, layout.box.height, profile.readFormat ?? gl.RGBA, profile.readType ?? profile.type,
            bytes === null ? layer * planeBytes : bytes.subarray(layer * planeBytes, (layer + 1) * planeBytes));
        }
      } finally { gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0); }
      check();
    },
  });
}

function copyDimensionalTextureRange(gl, source, destination, meta, firstLevel, firstLayer, check, require) {
  require(source.dimensional && destination.dimensional && source.target === destination.target,
    "backend-error", "Dimensional copy requires matching owned native targets.");
  const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    scissor = gl.isEnabled(gl.SCISSOR_TEST);
  let read = null, draw = null;
  const attach = (target, storage, level, layer) => {
    if (storage.target === gl.TEXTURE_CUBE_MAP) gl.framebufferTexture2D(target, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + layer, storage.texture, level);
    else gl.framebufferTextureLayer(target, gl.COLOR_ATTACHMENT0, storage.texture, level, layer);
  };
  try {
    read = gl.createFramebuffer(); draw = gl.createFramebuffer();
    require(read && draw, "backend-error", "Dimensional copy framebuffer allocation failed.");
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    for (const level of meta.levels) for (let layer = 0; layer < level.layers; layer++) {
      attach(gl.READ_FRAMEBUFFER, source, firstLevel + level.level, layer + (meta.target === 7 ? firstLayer : 0));
      attach(gl.DRAW_FRAMEBUFFER, destination, level.level, layer);
      require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE &&
        gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
      "backend-error", "Dimensional copy framebuffer is incomplete.");
      gl.blitFramebuffer(0, 0, level.width, level.height, 0, 0, level.width, level.height, gl.COLOR_BUFFER_BIT, gl.NEAREST); check();
    }
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
    if (read) gl.deleteFramebuffer(read); if (draw) gl.deleteFramebuffer(draw);
    if (scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
  }
}

import {byteColorFormat, STANDARD_COLOR_TRANSFER_PROFILE} from "./color-images.mjs";
import {floatColorFormat, halfFromFloatWord, STANDARD_FLOAT_COLOR_TRANSFER_PROFILE} from "./float-images.mjs";
import {packedFloatColorFormat, r11g11b10FromFloatWords, STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE} from "./packed-float-images.mjs";
import {sharedExponentColorFormat, STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE} from "./shared-exponent-images.mjs";
import {integerColorFormat, STANDARD_INTEGER_COLOR_TRANSFER_PROFILE} from "./integer-images.mjs";
import {packedNormalizedColorFormat, STANDARD_PACKED_NORMALIZED_TRANSFER_PROFILE} from "./packed-normalized-images.mjs";
import {packedUnsignedColorFormat, STANDARD_PACKED_UNSIGNED_TRANSFER_PROFILE} from "./packed-unsigned-images.mjs";
import {createSharedExponentPacker} from "./shared-exponent-gpu.mjs";
import {floatingDepthFormat, STANDARD_FLOATING_DEPTH_TRANSFER_PROFILE} from "./floating-depth-images.mjs";
import {unormDepthFormat, packedDepthFormat, STANDARD_UNORM_DEPTH_TRANSFER_PROFILE, STANDARD_PACKED_DEPTH_TRANSFER_PROFILE} from "./unorm-depth-images.mjs";
import {createFloatingDepthPacker} from "./floating-depth-gpu.mjs";
const ownedColorFormat = meta => byteColorFormat(meta.format) || (meta.floatPrecision ? floatColorFormat(meta.format) : null) || (meta.packedFloat ? packedFloatColorFormat(meta.format) : null) || (meta.sharedExponent ? sharedExponentColorFormat(meta.format) : null) || (meta.integerBits ? integerColorFormat(meta.format) : null) || (meta.packedNormalized ? packedNormalizedColorFormat(meta.format) : null) || (meta.packedUnsigned ? packedUnsignedColorFormat(meta.format) : null) || (meta.floatingDepth ? floatingDepthFormat(meta.format) : null) || (meta.unormDepth ? unormDepthFormat(meta.format) : null) || (meta.packedDepth ? packedDepthFormat(meta.format) : null);
export const RESOURCE_LIMITS = Object.freeze({
  resources: 16, contexts: 8, segments: 256, tickets: 64, leases: 64,
  resourceBytes: 4194304, transferBytes: 4194304,
  cpuBytes: 33554432, gpuBytes: 33554432, scratchBytes: 8388608,
  textureSize: 16384,
});
// Desktop allocation counts are separately selected by the host. Byte budgets,
// storage admission and every historical store's defaults remain unchanged.
export const STANDARD_DESKTOP_RESOURCE_LIMITS = Object.freeze({ ...RESOURCE_LIMITS, resources: 64 });
export const STANDARD_DIMENSIONAL_RESOURCE_LIMITS = Object.freeze({ ...STANDARD_DESKTOP_RESOURCE_LIMITS, ...DIMENSIONAL_LIMITS });
export const PRODUCTION_RESOURCE_LIMITS = Object.freeze({ ...STANDARD_DIMENSIONAL_RESOURCE_LIMITS,
  segments: 16384,
  resourceBytes: 33554432, transferBytes: 33554432, cpuBytes: 201326592,
  gpuBytes: 134217728, scratchBytes: 67108864 });
const U32 = 0xffffffff;
const META_KEYS = ["id", "target", "format", "bind", "width", "height", "depth", "arraySize", "lastLevel", "nrSamples", "flags"];
const COMMON_KEYS = ["resourceHandle", "level", "usage", "stride", "layerStride", "box"];
const BOX_KEYS = ["x", "y", "z", "width", "height", "depth"];
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const success = (data = {}) => Object.freeze({ ok: true, ...data });
const failure = (code, message) => freeze({ ok: false, error: { code, message } });
class ResourceFault extends Error {
  constructor(code, message) { super(message); this.result = failure(code, message); }
}
function require(condition, code, message) { if (!condition) throw new ResourceFault(code, message); }
function result(fn) {
  try { return fn(); } catch (error) {
    if (error instanceof ResourceFault) return error.result;
    throw error;
  }
}
function record(value, allowed, required = allowed) {
  let descriptors;
  try {
    require(value !== null && typeof value === "object" && !Array.isArray(value), "invalid-input", "Expected a data record.");
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (error instanceof ResourceFault) throw error;
    throw new ResourceFault("invalid-input", "Unusable data record.");
  }
  const out = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    require(allowed.includes(key) && Object.hasOwn(descriptors[key], "value"), "invalid-input", "Unknown or accessor record property.");
    out[key] = descriptors[key].value;
  }
  for (const key of required) require(Object.hasOwn(out, key), "invalid-input", `Missing ${key}.`);
  return out;
}
function uint(value, name, nonzero = false) {
  require(Number.isInteger(value) && value >= (nonzero ? 1 : 0) && value <= U32,
    "invalid-input", `${name} must be ${nonzero ? "a nonzero " : "a "}u32.`);
  return value;
}
function limitsFor(overrides = {}, baseline = RESOURCE_LIMITS) {
  const supplied = record(overrides, Object.keys(baseline), []);
  const limits = { ...baseline, ...supplied };
  for (const key of Object.keys(limits)) require(Number.isSafeInteger(limits[key]) && limits[key] >= 0 && limits[key] <= baseline[key],
    "invalid-input", `Limit ${key} may only tighten its default.`);
  return Object.freeze(limits);
}
function byteView(value) {
  try {
    const proto = Object.getPrototypeOf(Uint8Array.prototype);
    require(Object.getOwnPropertyDescriptor(proto, Symbol.toStringTag).get.call(value) === "Uint8Array", "invalid-input", "Expected Uint8Array bytes.");
    const buffer = Object.getOwnPropertyDescriptor(proto, "buffer").get.call(value);
    Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get.call(buffer);
    const offset = Object.getOwnPropertyDescriptor(proto, "byteOffset").get.call(value);
    const length = Object.getOwnPropertyDescriptor(proto, "byteLength").get.call(value);
    return new Uint8Array(buffer, offset, length);
  } catch (error) {
    if (error instanceof ResourceFault) throw error;
    throw new ResourceFault("invalid-input", "Bytes must be attached and non-shared.");
  }
}
function checkedProduct(a, b, maximum, message) {
  require(a === 0 || b <= Math.floor(maximum / a), "out-of-bounds", message);
  return a * b;
}
function normalizeMetadata(value, limits, uniform = false, bufferRoles = false, mipmaps = false, colors = false, floats = false, packed = false, shared = false, integers = false, normalized = false, unsigned = false, floatingDepth = false, unormDepth = false, packedDepth = false, dimensional = false, dimensionalDepth = false, streamOutput = false, production = false) {
  const meta = record(value, META_KEYS);
  for (const key of META_KEYS) uint(meta[key], key, ["id", "width", "height", "depth", "arraySize"].includes(key));
  const dimensionalColor = production ? byteColorFormat(meta.format) || floatColorFormat(meta.format) || packedFloatColorFormat(meta.format) || sharedExponentColorFormat(meta.format) || integerColorFormat(meta.format) || packedNormalizedColorFormat(meta.format) || packedUnsignedColorFormat(meta.format) || ([2,233].includes(meta.format) ? {pixelBytes:4,nativePixelBytes:meta.format === 2 ? 3 : 4} : null) : null;
  if (dimensional && [3, 4, 7].includes(meta.target)) return freeze(dimensionalDepth && meta.format !== 67 && !dimensionalColor ?
    dimensionalDepthMetadata(meta, limits, require, checkedProduct) : dimensionalMetadata(meta, limits, require, checkedProduct, dimensionalColor));
  require(meta.depth === 1 && meta.arraySize === 1 && (meta.lastLevel === 0 || mipmaps && meta.target === 2 && ([2, 67, 233].includes(meta.format) || colors && byteColorFormat(meta.format) || floats && floatColorFormat(meta.format) || packed && packedFloatColorFormat(meta.format) || shared && sharedExponentColorFormat(meta.format) || integers && integerColorFormat(meta.format) || normalized && packedNormalizedColorFormat(meta.format) || unsigned && packedUnsignedColorFormat(meta.format) || floatingDepth && floatingDepthFormat(meta.format) || unormDepth && unormDepthFormat(meta.format) || packedDepth && packedDepthFormat(meta.format))) && (meta.nrSamples === 0 || production && meta.target === 2 && meta.lastLevel === 0 && [2,4].includes(meta.nrSamples) && (meta.bind & 3) !== 0 && meta.flags === 0) && (meta.flags === 0 || (production && meta.flags === 1 && meta.target === 2 && [1,2,67].includes(meta.format))),
    "unsupported-resource", mipmaps ? "Only qualified 2D levels, one layer, one sample and no flags are supported." : "Only one-level, single-layer, single-sample resources without flags are supported.");
  let kind, byteLength, levels, color, gpuByteLength;
  if (meta.target === 0 && meta.format === 64 && meta.height === 1) {
    kind = production && meta.bind === 131072 ? "query-buffer" : bufferRoles && (meta.bind & ~(streamOutput ? 2160 : 112)) === 0 ? "standard-buffer" : ({ 16: "vertex-buffer", 32: "index-buffer", 524288: "staging", ...(uniform ? { 64: "uniform-buffer", 80: "uniform-buffer" } : {}) })[meta.bind];
    require(kind !== undefined, "unsupported-resource", "Unsupported buffer binding class.");
    byteLength = meta.width;
  } else if (meta.target === 2 && (floatingDepth && floatingDepthFormat(meta.format) || unormDepth && unormDepthFormat(meta.format) || packedDepth && packedDepthFormat(meta.format))) {
    color = (packedDepth ? packedDepthFormat(meta.format) : null) || (unormDepth ? unormDepthFormat(meta.format) : null) || floatingDepthFormat(meta.format);
    require([1, 8, 9].includes(meta.bind), "unsupported-resource", "Floating depth storage requires original depth/sampler roles.");
    require(meta.width <= limits.textureSize && meta.height <= limits.textureSize, "limit-exceeded", "Depth dimensions exceed host/profile limits.");
    require(meta.lastLevel <= Math.floor(Math.log2(Math.max(meta.width, meta.height))), "unsupported-resource", "Depth mip chain extends beyond the final 1x1 level.");
    levels = []; byteLength = 0; gpuByteLength = 0;
    for (let level = 0, width = meta.width, height = meta.height; level <= meta.lastLevel; level++) {
      const pixels = checkedProduct(width, height, limits.resourceBytes, "Depth plane is too large.");
      const bytes = checkedProduct(pixels, color.pixelBytes, limits.resourceBytes, "Depth plane is too large.");
      const nativeBytes = checkedProduct(pixels, color.allocationPixelBytes, limits.resourceBytes, "Owned native depth plane is too large.");
      require(bytes <= limits.resourceBytes - byteLength && nativeBytes <= limits.resourceBytes - gpuByteLength,
        "limit-exceeded", "Complete depth chain exceeds the resource byte limit.");
      levels.push({ level, width, height, byteLength: bytes, gpuByteLength: nativeBytes }); byteLength += bytes; gpuByteLength += nativeBytes;
      width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
    }
    kind = meta.lastLevel ? "mip-depth-texture" : "depth-texture";
  } else if (meta.target === 2 && meta.format === 16) {
    require(meta.bind === 1, "unsupported-resource", "Required Z16 storage admits only the measured depth-surface role.");
    require(meta.width <= limits.textureSize && meta.height <= limits.textureSize, "limit-exceeded", "Depth dimensions exceed host/profile limits.");
    kind = "depth-texture";
    byteLength = checkedProduct(checkedProduct(meta.width, meta.height, limits.resourceBytes, "Depth allocation is too large."), 2,
      limits.resourceBytes, "Depth allocation is too large.");
  } else {
    color = (colors ? byteColorFormat(meta.format) : null) || (floats ? floatColorFormat(meta.format) : null) || (packed ? packedFloatColorFormat(meta.format) : null) || (shared ? sharedExponentColorFormat(meta.format) : null) || (integers ? integerColorFormat(meta.format) : null) || (normalized ? packedNormalizedColorFormat(meta.format) : null) || (unsigned ? packedUnsignedColorFormat(meta.format) : null);
    const roles = meta.bind & 10, hints = (1 << 18) | (1 << 20);
    require(meta.target === 2 && ([2, 67, 233].includes(meta.format) || color) && roles !== 0 && (!color?.snorm || roles === 8) && (!color?.sharedExponent || meta.bind === 8) && (meta.bind & ~(10 | hints)) === 0,
      "unsupported-resource", "Only required normalized 2D color formats with render/sampler roles and scanout/shared hints are supported.");
    require(meta.width <= limits.textureSize && meta.height <= limits.textureSize, "limit-exceeded", "Texture dimensions exceed host/profile limits.");
    kind = "texture";
    byteLength = checkedProduct(checkedProduct(meta.width, meta.height, limits.resourceBytes, "Texture allocation is too large."), color?.pixelBytes ?? 4,
      limits.resourceBytes, "Texture allocation is too large.");
    if (color) gpuByteLength = checkedProduct(checkedProduct(meta.width, meta.height, limits.resourceBytes, "Native color allocation is too large."), color.nativePixelBytes, limits.resourceBytes, "Native color allocation is too large.");
    if (mipmaps && meta.lastLevel > 0) {
      // Validate the maximum first: guest level words never control an unbounded
      // loop or JavaScript's masked shift counts. NPOT dimensions round down.
      require(meta.lastLevel <= Math.floor(Math.log2(Math.max(meta.width, meta.height))),
        "unsupported-resource", "Mip chain extends beyond the final 1x1 level.");
      levels = []; byteLength = 0; if (color) gpuByteLength = 0;
      for (let level = 0, width = meta.width, height = meta.height; level <= meta.lastLevel; level++) {
        const bytes = checkedProduct(checkedProduct(width, height, limits.resourceBytes, "Mip allocation is too large."), color?.pixelBytes ?? 4,
          limits.resourceBytes, "Mip allocation is too large.");
        require(bytes <= limits.resourceBytes - byteLength, "limit-exceeded", "Complete mip chain exceeds the resource byte limit.");
        let nativeBytes;
        if (color) {
          nativeBytes = checkedProduct(checkedProduct(width, height, limits.resourceBytes, "Native mip is too large."), color.nativePixelBytes, limits.resourceBytes, "Native mip is too large.");
          require(nativeBytes <= limits.resourceBytes - gpuByteLength, "limit-exceeded", "Native mip chain exceeds resource byte limit.");
          gpuByteLength += nativeBytes;
        }
        levels.push({ level, width, height, byteLength: bytes, ...(color ? { gpuByteLength: nativeBytes } : {}) }); byteLength += bytes;
        width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
      }
      // Historical draw/view consumers require kind=texture and therefore cannot
      // silently sample the new allocation before their own view qualification.
      kind = "mip-texture";
    }
  }
  if (meta.nrSamples) {
    require(kind === "texture" || kind === "depth-texture", "unsupported-resource", "Multisample resources require color or depth attachments.");
    require(!color?.sharedExponent && !color?.snorm && !color?.integerBits && !color?.packedUnsigned,
      "unsupported-resource", "This multisample format has no qualified native storage.");
    gpuByteLength = checkedProduct(gpuByteLength ?? byteLength, meta.nrSamples, limits.resourceBytes, "Native samples exceed the resource byte limit.");
  }
  require(byteLength <= limits.resourceBytes, "limit-exceeded", "Resource exceeds per-resource byte limit.");
  return freeze({ ...meta, kind, byteLength, ...(meta.nrSamples ? {gpuByteLength} : {}), ...(levels ? { levels } : {}), ...(color ? { pixelBytes: color.pixelBytes, gpuByteLength, ...(color.precision ? { floatPrecision: color.precision } : {}), ...(color.packedFloat ? { packedFloat: true } : {}), ...(color.sharedExponent ? { sharedExponent: true } : {}), ...(color.integerBits ? { integerBits: color.integerBits } : {}), ...(color.packedNormalized ? { packedNormalized: true } : {}), ...(color.packedUnsigned ? { packedUnsigned: true } : {}), ...(color.floatingDepth ? { floatingDepth: true } : {}), ...(color.unormDepth ? { unormDepth: true } : {}), ...(color.packedDepth ? { packedDepth: true } : {}) } : {}) });
}
function inlineWords(value) {
  // The wire submission cap leaves at most 65524 words after its inline header.
  // Read only own data descriptors: sparse/accessor arrays cannot invoke code.
  let descriptors, length;
  try {
    require(Array.isArray(value), "invalid-input", "Inline data must be dwords.");
    length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    require(Number.isInteger(length) && length >= 1 && length <= 65524, "limit-exceeded", "Inline data exceeds wire limits.");
    descriptors = Object.getOwnPropertyDescriptors(value);
  }
  catch (error) { if (error instanceof ResourceFault) throw error; throw new ResourceFault("invalid-input", "Unusable inline dwords."); }
  require(Reflect.ownKeys(descriptors).length === length + 1, "invalid-input", "Inline data must be a dense dword array.");
  return Array.from({ length }, (_, i) => {
    const descriptor = descriptors[i];
    require(descriptor && Object.hasOwn(descriptor, "value"), "invalid-input", "Inline dwords cannot be sparse or accessors.");
    return uint(descriptor.value, "inline dword");
  });
}
function normalizedFields(value) {
  const allowed = [...COMMON_KEYS, "dataWords", "dataOffset", "direction", "stagingResourceHandle", "stagingOffset", "flags", "synchronized", "readFromHost"];
  const fields = record(value, allowed, COMMON_KEYS);
  for (const key of COMMON_KEYS.filter((key) => key !== "box")) uint(fields[key], key, key === "resourceHandle");
  fields.box = record(fields.box, BOX_KEYS);
  for (const key of BOX_KEYS) uint(fields.box[key], key, ["width", "height", "depth"].includes(key));
  const copy = Object.hasOwn(fields, "flags");
  if (Object.hasOwn(fields, "dataWords")) {
    for (const key of allowed.filter((key) => !COMMON_KEYS.includes(key) && key !== "dataWords")) require(!Object.hasOwn(fields, key), "invalid-transfer", "Mixed inline transfer encodings.");
    fields.dataWords = inlineWords(fields.dataWords);
  } else if (copy) {
    require(!Object.hasOwn(fields, "dataOffset") && !Object.hasOwn(fields, "direction"), "invalid-transfer", "Mixed transfer encodings.");
    uint(fields.stagingResourceHandle, "stagingResourceHandle", true);
    uint(fields.stagingOffset, "stagingOffset");
    require(fields.flags === 1 || fields.flags === 3, "invalid-transfer", "Only synchronized copy flags 1/3 are supported.");
    if (Object.hasOwn(fields, "synchronized")) require(fields.synchronized === true, "invalid-transfer", "Inconsistent synchronization flag.");
    if (Object.hasOwn(fields, "readFromHost")) require(fields.readFromHost === (fields.flags === 3), "invalid-transfer", "Inconsistent transfer direction.");
  } else {
    for (const key of ["stagingResourceHandle", "stagingOffset", "synchronized", "readFromHost"]) require(!Object.hasOwn(fields, key), "invalid-transfer", "Mixed transfer encodings.");
    uint(fields.dataOffset, "dataOffset");
    require(fields.direction === 1 || fields.direction === 2, "invalid-transfer", "Transfer direction must be 1 or 2.");
  }
  return fields;
}
function layoutFor(meta, fields, backingBytes, limits) {
  require(meta.nrSamples === 0, "invalid-transfer", "Multisample storage must be resolved before transfer.");
  uint(backingBytes, "backingByteLength");
  require(meta.kind !== "staging", "unsupported-resource", "Staging resources have no GPU transfer storage.");
  if (["dimensional-texture", "dimensional-depth-texture"].includes(meta.kind)) return freeze(dimensionalLayout(meta, fields, backingBytes, limits, require, checkedProduct));
  require(fields.resourceHandle === meta.id && fields.level <= meta.lastLevel, "invalid-transfer", "Resource identity or level mismatch.");
  const selected = ["mip-texture", "mip-depth-texture"].includes(meta.kind) ? meta.levels[fields.level] : meta;
  const box = fields.box;
  for (const [origin, extent, bound] of [[box.x, box.width, selected.width], [box.y, box.height, selected.height], [box.z, box.depth, meta.depth]]) {
    require(origin <= bound && extent <= bound - origin, "out-of-bounds", "Transfer box exceeds logical resource extent.");
  }
  const depth = ["depth-texture", "mip-depth-texture"].includes(meta.kind), texture = meta.kind === "texture" || meta.kind === "mip-texture" || depth;
  require(texture || (box.y === 0 && box.z === 0 && box.height === 1 && box.depth === 1), "invalid-transfer", "Buffer coordinates are byte-addressed one-dimensional ranges.");
  require(box.z === 0 && box.depth === 1, "invalid-transfer", "Only one 2D layer is supported.");
  const color = Object.hasOwn(meta, "pixelBytes") ? ownedColorFormat(meta) : null;
  const pixelBytes = depth ? color?.pixelBytes ?? 2 : texture ? color?.pixelBytes ?? 4 : 1;
  const rowBytes = checkedProduct(box.width, pixelBytes, limits.transferBytes, "Transfer row exceeds byte limit.");
  const defaultStride = checkedProduct(selected.width, pixelBytes, U32, "Default stride overflows u32.");
  const rowStride = fields.stride || defaultStride;
  require(rowStride >= rowBytes, "out-of-bounds", "Row stride overlaps the transferred row.");
  const minimumLayer = checkedProduct(rowStride, box.height, U32, "Layer stride calculation overflows u32.");
  const layerStride = fields.layerStride || checkedProduct(rowStride, selected.height, U32, "Default layer stride overflows u32.");
  require(layerStride >= minimumLayer, "out-of-bounds", "Layer stride overlaps transferred rows.");
  const span = checkedProduct(box.height - 1, rowStride, U32, "Row footprint overflows u32.");
  require(rowBytes <= U32 - span, "out-of-bounds", "Transfer footprint overflows u32.");
  const footprintBytes = span + rowBytes;
  const inline = Object.hasOwn(fields, "dataWords");
  const offset = inline ? 0 : Object.hasOwn(fields, "flags") ? fields.stagingOffset : fields.dataOffset;
  require(offset <= backingBytes && footprintBytes <= backingBytes - offset, "out-of-bounds", "Transfer exceeds backing bytes.");
  require(footprintBytes <= limits.transferBytes, "limit-exceeded", "Strided transfer footprint exceeds byte limit.");
  if (inline) require(fields.dataWords.length * 4 === Math.ceil(footprintBytes / 4) * 4,
    "invalid-transfer", "Inline payload must contain exactly the aligned strided footprint.");
  const tightBytes = checkedProduct(rowBytes, box.height, limits.transferBytes, "Tight transfer exceeds byte limit.");
  const direction = (fields.direction === 2 || fields.flags === 3) ? "readback" : "upload";
  const legacyDepth = depth && !meta.floatingDepth && !meta.unormDepth && !meta.packedDepth;
  const packedBytes = legacyDepth && direction === "readback" ? checkedProduct(tightBytes, 2, RESOURCE_LIMITS.scratchBytes, "Depth conversion exceeds scratch byte limit.") : tightBytes;
  const colorScratch = color ? checkedProduct(checkedProduct(box.width, box.height, RESOURCE_LIMITS.scratchBytes, "Color transfer is too large."), direction === "readback" ? color.floatingDepth && color.stencil ? 16 : color.readPixelBytes ?? 4 : Math.max(color.pixelBytes, color.nativePixelBytes), RESOURCE_LIMITS.scratchBytes, "Native color scratch exceeds byte limit.") : 0;
  const nativeDepthRead = (color?.floatingDepth || color?.unormDepth || color?.packedDepth) && direction === "readback" ? checkedProduct(box.width * box.height, color.readPixelBytes, RESOURCE_LIMITS.scratchBytes, "Native depth read exceeds scratch limit.") : 0;
  const depthConversion = nativeDepthRead ? checkedProduct(box.width * box.height, color.conversionPixelBytes, RESOURCE_LIMITS.gpuBytes, "Depth conversion exceeds GPU byte limit.") : 0;
  return freeze({ kind: texture ? "texture" : "buffer", box: { ...box }, offset, rowBytes, rowCount: box.height,
    ...(["mip-texture", "mip-depth-texture"].includes(meta.kind) ? { level: fields.level, levelWidth: selected.width, levelHeight: selected.height } : {}),
    rowStride, layerStride, footprintBytes, requiredEnd: offset + footprintBytes, tightBytes,
    direction, ...(color ? { scratchBytes: colorScratch, ...(color.sharedExponent ? { conversionBytes: direction === "readback" ? tightBytes : 0 } : {}), stagingBytes: direction === "readback" ? color.sharedExponent ? checkedProduct(colorScratch, 2, RESOURCE_LIMITS.gpuBytes, "Shared exponent staging exceeds GPU byte limit.") : colorScratch : 0 } : {}), ...(nativeDepthRead ? { nativeReadBytes: nativeDepthRead, conversionBytes: depthConversion, stagingBytes: nativeDepthRead + depthConversion } : {}), ...(legacyDepth ? { scratchBytes: packedBytes, conversionBytes: direction === "readback" ? packedBytes : 0,
      stagingBytes: direction === "readback" ? checkedProduct(packedBytes, 2, RESOURCE_LIMITS.gpuBytes, "Depth staging exceeds GPU byte limit.") : 0 } : {}) });
}

const scratchCharge = (layout) => layout.scratchBytes ?? layout.tightBytes;
const stagingCharge = (layout) => layout.stagingBytes ?? layout.tightBytes;

/** Pure checked wire-layout validation; no backing or GPU bytes are accessed. */
export function computeTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits), normalizedFields(fields), backingByteLength, limits) });
  });
}

function copySegments(segments, offset, bytes, write) {
  let remaining = bytes.byteLength, cursor = 0, skip = offset;
  for (const segment of segments) {
    if (skip >= segment.byteLength) { skip -= segment.byteLength; continue; }
    const count = Math.min(remaining, segment.byteLength - skip);
    if (write) segment.set(bytes.subarray(cursor, cursor + count), skip);
    else bytes.set(segment.subarray(skip, skip + count), cursor);
    cursor += count; remaining -= count; skip = 0;
    if (remaining === 0) break;
  }
  // All callers establish these bounds before any read/write.
  require(remaining === 0, "out-of-bounds", "Scatter/gather range was not fully backed.");
}
function gather(backing, layout) {
  const out = new Uint8Array(scratchCharge(layout)).subarray(0, layout.tightBytes);
  if (layout.layerCount !== undefined) {
    for (const row of dimensionalRows(layout)) copySegments(backing.segments, row.backing, out.subarray(row.tight, row.tight + layout.rowBytes), false);
    return out;
  }
  for (let row = 0; row < layout.rowCount; row++) copySegments(backing.segments, layout.offset + row * layout.rowStride,
    out.subarray(row * layout.rowBytes, (row + 1) * layout.rowBytes), false);
  return out;
}
function gatherInline(words, layout) {
  const out = new Uint8Array(scratchCharge(layout)).subarray(0, layout.tightBytes);
  if (layout.layerCount !== undefined) {
    for (const row of dimensionalRows(layout)) for (let byte = 0; byte < layout.rowBytes; byte++) {
      const offset = row.backing + byte;
      out[row.tight + byte] = (words[offset >>> 2] >>> ((offset & 3) * 8)) & 255;
    }
    return out;
  }
  for (let row = 0; row < layout.rowCount; row++) for (let byte = 0; byte < layout.rowBytes; byte++) {
    const offset = row * layout.rowStride + byte;
    out[row * layout.rowBytes + byte] = (words[offset >>> 2] >>> ((offset & 3) * 8)) & 255;
  }
  return out;
}
function scatter(backing, layout, bytes) {
  if (layout.layerCount !== undefined) {
    for (const row of dimensionalRows(layout)) copySegments(backing.segments, row.backing, bytes.subarray(row.tight, row.tight + layout.rowBytes), true);
    return;
  }
  for (let row = 0; row < layout.rowCount; row++) copySegments(backing.segments, layout.offset + row * layout.rowStride,
    bytes.subarray(row * layout.rowBytes, (row + 1) * layout.rowBytes), true);
}

export function createResourceStore(options) { return createStore(options, false); }

/** Explicit host-selected original constant-buffer storage; old admissions stay isolated. */
export function createStandardUniformResourceStore(options) { return createStore(options, true); }

export function computeStandardUniformTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Original creation hints cannot restrict later vertex/index/uniform roles. */
export function createStandardBufferResourceStore(options) { return createStore(options, true, true); }

export function computeStandardBufferTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Host-selected original multilevel 2D storage; view/draw consumers stay gated. */
export function createStandardTextureResourceStore(options) { return createStore(options, true, true, true); }

export function computeStandardTextureTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Original image subresources have private, budgeted GPU view authority. */
export function createStandardImageResourceStore(options) { return createStore(options, true, true, true, true); }

export function createStandardColorResourceStore(options) { return createStore(options, true, true, true, true, true); }

export function computeStandardColorTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

export function createStandardFloatColorResourceStore(options) { return createStore(options, true, true, true, true, true, true); }
export function computeStandardFloatColorTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

export function createStandardPackedFloatColorResourceStore(options) { return createStore(options, true, true, true, true, true, true, true); }
export function computeStandardPackedFloatColorTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

export function createStandardSharedExponentResourceStore(options) { return createStore(options, true, true, true, true, true, true, true, true); }
export function computeStandardSharedExponentTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Selected original UINT/SINT storage; typed shader/command admission is separate. */
export function createStandardIntegerColorResourceStore(options) { return createStore(options, true, true, true, true, true, true, true, true, true); }
export function computeStandardIntegerColorTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Original packed UNORM storage; command consumers retain their own closed boundary. */
export function createStandardPackedNormalizedResourceStore(options) { return createStore(options, true, true, true, true, true, true, true, true, true, true); }
export function computeStandardPackedNormalizedTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Original packed UINT storage; command admission remains separately gated. */
export function createStandardPackedUnsignedResourceStore(options) { return createStore(options, true, true, true, true, true, true, true, true, true, true, true); }
export function computeStandardPackedUnsignedTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

export function createStandardFloatingDepthResourceStore(options) { return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true); }
export function computeStandardFloatingDepthTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Original UN16 roles and mips require a distinct host-selected owner. */
export function createStandardUnormDepthResourceStore(options) { return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true); }
export function computeStandardUnormDepthTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Original packed UN24 storage; original guest consumers stay separately gated. */
export function createStandardPackedDepthResourceStore(options) { return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true); }
export function computeStandardPackedDepthTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

/** Bounded desktop lifetimes compose only already-qualified native storage. */
export function createStandardDesktopResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DESKTOP_RESOURCE_LIMITS);
}

/** Original dimensional RGBA8 ownership remains outside historical view consumers. */
export function createStandardDimensionalResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DIMENSIONAL_RESOURCE_LIMITS, true);
}
/** Owned native dimensional sampler ranges, separately selected by the host. */
export function createStandardDimensionalViewResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DIMENSIONAL_RESOURCE_LIMITS, true, true);
}
/** Original cube/array depth allocation and DMA, with historical views closed. */
export function createStandardDimensionalDepthResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DIMENSIONAL_RESOURCE_LIMITS, true, true, true);
}
/** Retained original cube/array depth views require this distinct consumer. */
export function createStandardDimensionalDepthViewResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DIMENSIONAL_RESOURCE_LIMITS, true, true, true, true);
}
/** Retained one-layer RGBA8 color surfaces use unchanged dimensional storage. */
export function createStandardDimensionalColorSurfaceResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DIMENSIONAL_RESOURCE_LIMITS, true, true, true, true, true);
}
/** Single-layer original cube/array depth attachments reuse the qualified backend. */
export function createStandardDimensionalDepthSurfaceResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DIMENSIONAL_RESOURCE_LIMITS, true, true, true, true, true, true);
}
/** Selected original buffer capture; historical stores keep their masks. */
export function createStandardStreamOutputResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, STANDARD_DIMENSIONAL_RESOURCE_LIMITS, true, true, true, true, true, true, true);
}
/** Larger selected desktop budget; historical fixtures retain their fixed limits. */
export function createProductionResourceStore(options) {
  return createStore(options, true, true, true, true, true, true, true, true, true, true, true, true, true, true, PRODUCTION_RESOURCE_LIMITS, true, true, true, true, true, true, true);
}
export function computeStandardDimensionalDepthTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides, STANDARD_DIMENSIONAL_RESOURCE_LIMITS);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}
export function computeStandardDimensionalTransferLayout(metadata, fields, backingByteLength, overrides = {}) {
  return result(() => {
    const limits = limitsFor(overrides, STANDARD_DIMENSIONAL_RESOURCE_LIMITS);
    return success({ layout: layoutFor(normalizeMetadata(metadata, limits, true, true, true, true, true, true, true, true, true, true, true, true, true, true), normalizedFields(fields), backingByteLength, limits) });
  });
}

function createStore(options, uniform, bufferRoles = false, mipmaps = false, images = false, colors = false, floats = false, packed = false, shared = false, integers = false, normalized = false, unsigned = false, floatingDepth = false, unormDepth = false, packedDepth = false, resourceLimits = RESOURCE_LIMITS, dimensional = false, dimensionalViews = false, dimensionalDepth = false, dimensionalDepthViews = false, dimensionalColorSurfaces = false, dimensionalDepthSurfaces = false, streamOutput = false) {
  return result(() => {
    const config = record(options, ["backend", "limits"], ["backend"]), backend = config.backend;
    require(backend && typeof backend === "object", "invalid-input", "A transfer backend is required.");
    for (const method of ["allocate", "destroy", "upload", "readback", "dispose"]) require(typeof backend[method] === "function", "invalid-input", `Backend is missing ${method}.`);
    require(Number.isInteger(backend.maxTextureSize) && backend.maxTextureSize > 0, "invalid-input", "Backend must provide its texture dimension limit.");
    require(!images || typeof backend.copyTextureRange === "function", "invalid-input", "Image views require native GPU copies.");
    require(!colors || backend.colorProfile === STANDARD_COLOR_TRANSFER_PROFILE, "invalid-input", "Byte colors require the qualified native transfer backend.");
    require(!floats || backend.floatProfile === STANDARD_FLOAT_COLOR_TRANSFER_PROFILE, "invalid-input", "Float images require the selected native transfer backend.");
    require(!packed || backend.packedFloatProfile === STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE, "invalid-input", "Packed float images require their selected native transfer backend.");
    require(!shared || backend.sharedExponentProfile === STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE, "invalid-input", "Shared exponent images require their selected native transfer backend.");
    require(!integers || backend.integerProfile === STANDARD_INTEGER_COLOR_TRANSFER_PROFILE, "invalid-input", "Integer images require their selected native transfer backend.");
    require(!normalized || backend.packedNormalizedProfile === STANDARD_PACKED_NORMALIZED_TRANSFER_PROFILE, "invalid-input", "Packed normalized images require their selected native transfer backend.");
    require(!unsigned || backend.packedUnsignedProfile === STANDARD_PACKED_UNSIGNED_TRANSFER_PROFILE, "invalid-input", "Packed unsigned images require their selected native transfer backend.");
    require(!floatingDepth || backend.floatingDepthProfile === STANDARD_FLOATING_DEPTH_TRANSFER_PROFILE, "invalid-input", "Floating depth images require their selected native transfer backend.");
    require(!unormDepth || backend.unormDepthProfile === STANDARD_UNORM_DEPTH_TRANSFER_PROFILE, "invalid-input", "UN16 depth images require their selected native transfer backend.");
    require(!packedDepth || backend.packedDepthProfile === STANDARD_PACKED_DEPTH_TRANSFER_PROFILE, "invalid-input", "Packed UN24 depth images require their selected native transfer backend.");
    require(!dimensional || backend.dimensionalProfile === STANDARD_DIMENSIONAL_TRANSFER_PROFILE &&
      [backend.maxTexture3DSize, backend.maxCubeTextureSize, backend.maxArrayLayers].every(value => Number.isInteger(value) && value > 0),
      "invalid-input", "Dimensional images require their qualified host-selected backend.");
    require(!dimensionalViews || backend.dimensionalViewProfile === STANDARD_DIMENSIONAL_VIEW_TRANSFER_PROFILE,
      "invalid-input", "Dimensional views require their qualified host-selected backend.");
    require(!dimensionalDepth || backend.dimensionalDepthProfile === STANDARD_DIMENSIONAL_DEPTH_TRANSFER_PROFILE,
      "invalid-input", "Dimensional depth requires its separately selected backend.");
    require(!dimensionalDepthViews || backend.dimensionalDepthViewProfile === STANDARD_DIMENSIONAL_DEPTH_VIEW_TRANSFER_PROFILE,
      "invalid-input", "Dimensional depth views require their separately selected backend.");
    const requested = limitsFor(config.limits, resourceLimits);
    const limits = Object.freeze({ ...requested, textureSize: Math.min(requested.textureSize, backend.maxTextureSize),
      ...(dimensional ? { texture3DSize: Math.min(requested.texture3DSize, backend.maxTexture3DSize),
        cubeTextureSize: Math.min(requested.cubeTextureSize, backend.maxCubeTextureSize), arrayLayers: Math.min(requested.arrayLayers, backend.maxArrayLayers) } : {}) });
    const packedCaptures = new Map(), revokedCaptures = new Set();
    const resources = new Map(), live = new Set(), contexts = new Map(), tickets = new Map(), leases = new Map(), storageReads = new Map(), uniformRanges = new Map(), revokedAccess = new Set(), revokedUniform = new Set();
    const imageViews = new Map(), imageHolds = new Map(), liveImages = new Set(), revokedImages = new Set();
    let nextGeneration = 1, nextBackingGeneration = 1, disposed = false, backingBytes = 0, gpuBytes = 0, scratchBytes = 0, stagingBytes = 0;
    const host = (name, ...args) => {
      try { return backend[name](...args); } catch { throw new ResourceFault("backend-error", `Backend ${name} failed.`); }
    };
    const alive = () => require(!disposed, "disposed", "Resource store is disposed.");
    const generation = () => {
      require(nextGeneration < Number.MAX_SAFE_INTEGER, "limit-exceeded", "Generation space exhausted.");
      return nextGeneration++;
    };
    const resource = (id) => {
      uint(id, "resourceId", true);
      const res = resources.get(id);
      require(res !== undefined, "missing-resource", "Resource ID is not public.");
      return res;
    };
    const context = (id) => {
      uint(id, "contextId", true);
      const ctx = contexts.get(id);
      require(ctx !== undefined, "missing-context", "Context ID is not live.");
      return ctx;
    };
    const membership = (ctx, res) => {
      const member = ctx.memberships.get(res.meta.id);
      require(member && member.resource === res && member.active, "missing-attachment", "Resource is not attached to this context.");
      return member;
    };
    const needBacking = (res) => {
      require(res.backing !== null, "missing-backing", "Resource has no attached backing.");
      return res.backing;
    };
    const reserveScratch = (count) => {
      require(count <= limits.scratchBytes - scratchBytes && count <= limits.cpuBytes - backingBytes - scratchBytes,
        "limit-exceeded", "Scratch/CPU byte budget exceeded.");
      scratchBytes += count;
    };
    const collect = (res) => {
      if (res.public || res.references !== 0) return;
      if (res.storage !== null) { host("destroy", res.storage); gpuBytes -= res.meta.gpuByteLength ?? res.meta.byteLength; res.storage = null; }
      live.delete(res);
    };
    const collectImage = entry => {
      if (entry.references !== 0) return;
      if (entry.allocationBytes) { host("destroy", entry.storage); gpuBytes -= entry.allocationBytes; }
      liveImages.delete(entry); entry.resource.references--; collect(entry.resource);
    };
    const imageLease = (lease, roles) => {
      const entry = leases.get(lease);
      require(entry && roles.includes(entry.role) && (["texture", "mip-texture", "depth-texture", "mip-depth-texture"].includes(entry.resource.meta.kind) ||
        dimensionalViews && entry.resource.meta.kind === "dimensional-texture" ||
        dimensionalDepthViews && entry.resource.meta.kind === "dimensional-depth-texture"),
        "invalid-lease", "Expected a retained original image lease.");
      require(entry.context.active && contexts.get(entry.context.id) === entry.context, "stale-context", "Image lease context is stale.");
      return entry;
    };
    const removeBacking = (res) => {
      if (res.backing === null) return;
      const old = res.backing;
      old.active = false; old.segments = []; backingBytes -= old.byteLength; res.backing = null;
    };
    const removeMember = (member) => {
      member.active = false;
      member.context.memberships.delete(member.resource.meta.id);
      member.resource.memberships.delete(member);
    };
    const releaseTicket = (entry) => {
      scratchBytes -= scratchCharge(entry.layout);
      entry.upload = null;
      let firstError = null;
      try { freeNativeRead(entry); } catch (error) { firstError = error; }
      entry.bytes = null;
      for (const res of entry.retained) {
        res.references--;
        try { collect(res); } catch (error) { firstError ??= error; }
      }
      if (firstError) throw firstError;
    };
    const consumeTicket = (token) => {
      const entry = tickets.get(token);
      require(entry !== undefined, "invalid-ticket", "Unknown, consumed or foreign transfer ticket.");
      require(!entry.asynchronous, "invalid-ticket", "Asynchronous tickets require asynchronous access.");
      tickets.delete(token);
      return entry;
    };
    const checkTicket = (entry) => {
      require(entry.context.active && contexts.get(entry.context.id) === entry.context &&
        entry.memberships.every((member) => member.active && member.resource.public) &&
        entry.backings.every((backing) => backing.active) &&
        entry.backingLinks.every(({ resource: res, backing }) => res.backing === backing),
      "stale-ticket", "Prepared transfer identity or attachment is stale.");
    };
    const readGpu = (res, layout) => {
      const conversion = layout.conversionBytes ?? 0;
      require(conversion <= limits.gpuBytes - gpuBytes, "limit-exceeded", "GPU conversion byte budget exceeded.");
      gpuBytes += conversion;
      try {
        const bytes = byteView(host("readback", res.storage, res.meta, layout));
        require(bytes.byteLength === layout.tightBytes, "backend-error", "Backend readback returned the wrong byte count.");
        return bytes;
      } finally { gpuBytes -= conversion; }
    };
    const uploadGpu = (res, layout, bytes) => {
      require(res.contentRevision < Number.MAX_SAFE_INTEGER, "limit-exceeded", "Storage revision space exhausted.");
      // Even a failed host upload may have issued a write before reporting error.
      res.contentRevision++;
      host("upload", res.storage, res.meta, layout, bytes);
    };
    const freeNativeRead = (entry) => {
      if (!entry.native) return;
      const native = entry.native; entry.native = null;
      stagingBytes -= stagingCharge(entry.layout); gpuBytes -= stagingCharge(entry.layout);
      host("releaseReadback", native);
    };
    const freeStorageRead = (entry) => {
      try { freeNativeRead(entry); } finally {
        scratchBytes -= scratchCharge(entry.layout); entry.bytes = null;
        entry.resource.references--; collect(entry.resource);
      }
    };
    const startRead = (entry, res) => {
      require(!entry.native, "invalid-ticket", "Readback already started.");
      require(["beginReadback", "pollReadback", "collectReadback", "releaseReadback"].every((name) => typeof backend[name] === "function"),
        "unsupported-backend", "Backend has no staged readback capability.");
      require(stagingCharge(entry.layout) <= limits.gpuBytes - gpuBytes, "limit-exceeded", "GPU staging byte budget exceeded.");
      stagingBytes += stagingCharge(entry.layout); gpuBytes += stagingCharge(entry.layout);
      try {
        const native = host("beginReadback", res.storage, res.meta, entry.layout);
        require(native !== null && typeof native === "object", "backend-error", "Backend returned no staged readback.");
        entry.native = native;
      } catch (error) {
        stagingBytes -= stagingCharge(entry.layout); gpuBytes -= stagingCharge(entry.layout); throw error;
      }
    };
    const operation = (fn) => (...args) => result(() => { alive(); return fn(...args); });
    const prepareTransfer = (contextId, decodedCommand, asynchronous = false) => {
        const ctx = context(contextId);
        const command = record(decodedCommand, ["opcode", "name", "objectType", "objectName", "byteOffset", "byteLength", "payloadDwords", "fields"], ["opcode", "fields"]);
        require([9, 43, 45].includes(command.opcode), "unsupported-command", "Only inline and checked 3D transfers execute here.");
        const copy = command.opcode === 45, inline = command.opcode === 9;
        const fields = normalizedFields(command.fields);
        require(Object.hasOwn(fields, "flags") === copy && Object.hasOwn(fields, "dataWords") === inline, "invalid-transfer", "Opcode and transfer payload disagree.");
        const payloadDwords = inline ? 11 + fields.dataWords.length : copy ? 14 : 13;
        for (const [key, expected] of [["name", inline ? "RESOURCE_INLINE_WRITE" : copy ? "COPY_TRANSFER3D" : "TRANSFER3D"], ["objectType", 0], ["objectName", "NULL"], ["byteLength", (payloadDwords + 1) * 4], ["payloadDwords", payloadDwords]]) {
          if (Object.hasOwn(command, key)) require(command[key] === expected, "invalid-transfer", "Inconsistent command metadata.");
        }
        if (Object.hasOwn(command, "byteOffset")) { uint(command.byteOffset, "byteOffset"); require(command.byteOffset % 4 === 0, "invalid-transfer", "Command byte offset is unaligned."); }
        const primary = resource(fields.resourceHandle), primaryMember = membership(ctx, primary);
        const retained = [primary], members = [primaryMember], heldBackings = [];
        let transferBacking = null;
        if (copy) {
          const staging = resource(fields.stagingResourceHandle), stagingMember = membership(ctx, staging);
          require(staging.meta.kind === "staging", "unsupported-resource", "Copy secondary resource must be staging backing.");
          transferBacking = needBacking(staging); heldBackings.push(transferBacking); retained.push(staging); members.push(stagingMember);
          // Pinned read-from-host copy also requires primary attached backing.
          if (fields.flags === 3) heldBackings.push(needBacking(primary));
        } else if (!inline) { transferBacking = needBacking(primary); heldBackings.push(transferBacking); }
        const layout = layoutFor(primary.meta, fields, inline ? fields.dataWords.length * 4 : transferBacking.byteLength, limits);
        require(tickets.size + storageReads.size + uniformRanges.size < limits.tickets, "limit-exceeded", "Prepared transfer ticket limit exceeded.");
        reserveScratch(scratchCharge(layout));
        let upload;
        try { upload = inline ? gatherInline(fields.dataWords, layout) : !asynchronous && layout.direction === "upload" ? gather(transferBacking, layout) : null; }
        catch (error) { scratchBytes -= scratchCharge(layout); throw error; }
        const ticket = Object.freeze({});
        for (const res of retained) res.references++;
        const backingLinks = inline ? [] : retained.map((res) => ({ resource: res, backing: res.backing }));
        tickets.set(ticket, { context: ctx, primary, retained, memberships: members, backings: heldBackings, backingLinks, transferBacking, layout, upload, inline, asynchronous, native: null, bytes: null });
        return success({ ticket, layout });
    };
    const store = {
      createContext: operation((id) => {
        uint(id, "contextId", true);
        require(!contexts.has(id), "context-exists", "Context ID is already live.");
        require(contexts.size < limits.contexts, "limit-exceeded", "Context count limit exceeded.");
        const ctx = { id, generation: generation(), active: true, memberships: new Map() };
        contexts.set(id, ctx);
        return success({ context: freeze({ id, generation: ctx.generation }) });
      }),
      createResource: operation((metadata) => {
        const meta = normalizeMetadata(metadata, limits, uniform, bufferRoles, mipmaps, colors, floats, packed, shared, integers, normalized, unsigned, floatingDepth, unormDepth, packedDepth, dimensional, dimensionalDepth, streamOutput, resourceLimits === PRODUCTION_RESOURCE_LIMITS);
        require(!resources.has(meta.id), "resource-exists", "Resource ID is already public.");
        require(live.size < limits.resources, "limit-exceeded", "Live/retained resource count limit exceeded.");
        const allocationBytes = meta.kind === "staging" ? 0 : meta.gpuByteLength ?? meta.byteLength;
        require(allocationBytes <= limits.gpuBytes - gpuBytes, "limit-exceeded", "GPU byte budget exceeded.");
        const gen = generation();
        if (meta.floatingDepth || meta.unormDepth || meta.packedDepth) gpuBytes += allocationBytes;
        let storage;
        try {
          storage = allocationBytes ? host("allocate", meta) : null;
          require(!allocationBytes || (storage !== null && typeof storage === "object"), "backend-error", "Backend allocation returned no storage.");
        } catch (error) { if (meta.floatingDepth || meta.unormDepth || meta.packedDepth) gpuBytes -= allocationBytes; throw error; }
        const res = { meta, generation: gen, public: true, references: 0, backing: null, memberships: new Set(), storage, contentRevision: 0 };
        resources.set(meta.id, res); live.add(res); if (!meta.floatingDepth && !meta.unormDepth && !meta.packedDepth) gpuBytes += allocationBytes;
        return success({ resource: freeze({ ...meta, generation: gen }) });
      }),
      attachContext: operation((contextId, id) => {
        const ctx = context(contextId), res = resource(id);
        require(!ctx.memberships.has(id), "already-attached", "Resource is already attached to this context.");
        const member = { context: ctx, resource: res, active: true };
        ctx.memberships.set(id, member); res.memberships.add(member);
        return success();
      }),
      detachContext: operation((contextId, id) => {
        const ctx = context(contextId), res = resource(id), member = membership(ctx, res);
        removeMember(member); return success();
      }),
      attachBacking: operation((id, segments) => {
        const res = resource(id);
        require(res.backing === null, "already-attached", "Backing is already attached.");
        let count;
        try { require(Array.isArray(segments), "invalid-input", "Backing must be an array of byte segments."); count = segments.length; }
        catch (error) { if (error instanceof ResourceFault) throw error; throw new ResourceFault("invalid-input", "Invalid segment array."); }
        require(count > 0 && count <= limits.segments, "limit-exceeded", "Backing segment count exceeds limits.");
        const views = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
          let descriptor;
          try { descriptor = Object.getOwnPropertyDescriptor(segments, String(i)); } catch { throw new ResourceFault("invalid-input", "Invalid segment entry."); }
          require(descriptor && Object.hasOwn(descriptor, "value"), "invalid-input", "Backing entries must be data properties.");
          const view = byteView(descriptor.value);
          require(view.byteLength <= limits.resourceBytes - total, "limit-exceeded", "Backing exceeds per-resource byte limit.");
          total += view.byteLength; views.push({ view, byteLength: view.byteLength });
        }
        require(total <= limits.cpuBytes - backingBytes - scratchBytes, "limit-exceeded", "Backing exceeds CPU byte budget.");
        // Proxy descriptor traps may run host code: recheck identity after input inspection.
        require(resources.get(id) === res && res.backing === null, "invalid-input", "Resource/backing changed while inspecting segments.");
        const copies = views.map(({ view, byteLength }) => {
          // A later segment descriptor trap may detach/shrink an earlier buffer.
          const current = byteView(view);
          require(current.byteLength === byteLength, "invalid-input", "Backing segment changed while inspecting segments.");
          return new Uint8Array(current);
        });
        require(nextBackingGeneration < Number.MAX_SAFE_INTEGER, "limit-exceeded", "Backing generation space exhausted.");
        res.backing = { active: true, generation: nextBackingGeneration++, byteLength: total, segments: copies };
        backingBytes += total;
        return success({ byteLength: total });
      }),
      detachBacking: operation((id) => { const res = resource(id); needBacking(res); removeBacking(res); return success(); }),
      writeBacking: operation((id, offset, input) => {
        const backing = needBacking(resource(id)), bytes = byteView(input);
        uint(offset, "offset");
        require(offset <= backing.byteLength && bytes.byteLength <= backing.byteLength - offset, "out-of-bounds", "Backing write exceeds attached bytes.");
        require(bytes.byteLength <= limits.transferBytes, "limit-exceeded", "Write exceeds transfer byte limit.");
        reserveScratch(bytes.byteLength);
        try { copySegments(backing.segments, offset, bytes, true); } finally { scratchBytes -= bytes.byteLength; }
        return success({ byteLength: bytes.byteLength });
      }),
      readBacking: operation((id, offset, length) => {
        const backing = needBacking(resource(id));
        uint(offset, "offset"); uint(length, "length");
        require(offset <= backing.byteLength && length <= backing.byteLength - offset, "out-of-bounds", "Backing read exceeds attached bytes.");
        require(length <= limits.transferBytes, "limit-exceeded", "Read exceeds transfer byte limit.");
        reserveScratch(length);
        try { const bytes = new Uint8Array(length); copySegments(backing.segments, offset, bytes, false); return success({ bytes }); }
        finally { scratchBytes -= length; }
      }),
      retainStorage: operation((contextId, id, role = "view") => {
        const ctx = context(contextId), res = resource(id); membership(ctx, res);
        require(res.storage !== null, "unsupported-resource", "Staging resources have no GPU storage.");
        require(typeof role === "string" && ["view", "surface", "depth-surface", "vertex", "index", "readback", ...(resourceLimits === PRODUCTION_RESOURCE_LIMITS ? ["query"] : []), ...(uniform ? ["uniform"] : []), ...(streamOutput ? ["stream-output"] : [])].includes(role), "invalid-input", "Unknown storage lease role.");
        require(role !== "view" || res.meta.nrSamples === 0, "unsupported-resource", "Multisample storage must be resolved before sampling.");
        require(role === "query" && res.meta.kind === "query-buffer" || role === "readback" || (bufferRoles && res.meta.kind === "standard-buffer" && ["vertex", "index", "uniform", ...(streamOutput ? ["stream-output"] : [])].includes(role)) || (role === "view" && (["texture", "mip-texture"].includes(res.meta.kind) || dimensionalViews && res.meta.kind === "dimensional-texture" || dimensionalDepthViews && res.meta.kind === "dimensional-depth-texture" || (res.meta.floatingDepth || res.meta.unormDepth || res.meta.packedDepth) && ["depth-texture", "mip-depth-texture"].includes(res.meta.kind)) && (res.meta.bind & 8) !== 0) ||
          (role === "surface" && (["texture", "mip-texture"].includes(res.meta.kind) || dimensionalColorSurfaces && res.meta.kind === "dimensional-texture" && (res.meta.format === 67 || resourceLimits === PRODUCTION_RESOURCE_LIMITS)) && (res.meta.bind & 2) !== 0) ||
          (role === "depth-surface" && (res.meta.floatingDepth || res.meta.unormDepth || res.meta.packedDepth ? (["depth-texture", "mip-depth-texture"].includes(res.meta.kind) || dimensionalDepthSurfaces && res.meta.kind === "dimensional-depth-texture") && (res.meta.bind & 1) !== 0 : res.meta.kind === "depth-texture" && res.meta.bind === 1)) ||
          (role === "vertex" && (res.meta.kind === "vertex-buffer" || uniform && res.meta.kind === "uniform-buffer")) ||
          (role === "uniform" && uniform && ["vertex-buffer", "uniform-buffer"].includes(res.meta.kind)) || (role === "index" && res.meta.kind === "index-buffer"),
        "unsupported-resource", "Storage lease role contradicts the resource binding class.");
        require(leases.size < limits.leases, "limit-exceeded", "Storage lease limit exceeded.");
        const token = Object.freeze({}); leases.set(token, { resource: res, role, ...(role === "query" || role === "uniform" || images && ["view", "surface", "depth-surface"].includes(role) ? { context: ctx } : {}) }); res.references++;
        return success({ lease: token });
      }),
      releaseStorage: operation((token) => {
        const entry = leases.get(token);
        require(entry !== undefined, "invalid-lease", "Unknown, released or foreign storage lease.");
        leases.delete(token); entry.resource.references--; collect(entry.resource); return success();
      }),
      readStorage: operation((token, requestedBox) => {
        const entry = leases.get(token);
        require(entry !== undefined, "invalid-lease", "Unknown, released or foreign storage lease.");
        const res = entry.resource, meta = res.meta;
        const fields = normalizedFields({ resourceHandle: meta.id, level: 0, usage: 0, stride: 0, layerStride: 0,
          box: requestedBox ?? { x: 0, y: 0, z: 0, width: meta.width, height: meta.height, depth: 1 }, dataOffset: 0, direction: 2 });
        const layout = layoutFor(meta, fields, meta.byteLength, limits);
        require(leases.get(token) === entry, "invalid-lease", "Storage lease changed while inspecting the box.");
        reserveScratch(scratchCharge(layout));
        try { return success({ bytes: readGpu(res, layout) }); } finally { scratchBytes -= scratchCharge(layout); }
      }),
      ...(resourceLimits === PRODUCTION_RESOURCE_LIMITS ? {
        validateQueryStorage: operation(token => {
          const entry = leases.get(token), res = entry?.resource, ctx = entry?.context;
          require(entry?.role === 'query' && res?.public && ctx?.active && contexts.get(ctx.id) === ctx && ctx.memberships.get(res.meta.id)?.resource === res,
            'stale-storage', 'Original query resource or context membership changed.');
          require(res.meta.byteLength >= 16 && (!res.backing || res.backing.byteLength >= 16), 'out-of-bounds', 'Original query result requires sixteen bytes.');
          return success();
        }),
        publishQueryStorage: operation((token, state, value) => {
          const entry = leases.get(token), res = entry?.resource, ctx = entry?.context;
          require(entry?.role === 'query' && res?.public && ctx?.active && contexts.get(ctx.id) === ctx && ctx.memberships.get(res.meta.id)?.resource === res,
            'stale-storage', 'Original query result owner changed.');
          require(res.meta.byteLength >= 16 && (!res.backing || res.backing.byteLength >= 16), 'out-of-bounds', 'Original query result requires sixteen bytes.');
          require(state === 2 && value === undefined || state === 1 && Number.isInteger(value) && value >= 0 && value <= 0xffffffff, 'invalid-input', 'Invalid original GLES query state.');
          // Pinned native offset is UNUSED: the host state always starts at0.
          // WAIT_HOST writes only state, preserving prior result words.
          const bytes = new Uint8Array(state === 1 ? 16 : 4), view = new DataView(bytes.buffer);
          view.setUint32(0, state, true);
          if (state === 1) { view.setUint32(4, 4, true); view.setBigUint64(8, BigInt(value), true); }
          const fields = normalizedFields({resourceHandle: res.meta.id, level: 0, usage: 0, stride: 0, layerStride: 0,
            box: {x: 0, y: 0, z: 0, width: bytes.length, height: 1, depth: 1}, dataOffset: 0, direction: 1});
          uploadGpu(res, layoutFor(res.meta, fields, res.meta.byteLength, limits), bytes);
          if (res.backing) copySegments(res.backing.segments, 0, bytes, true);
          return success();
        }),
      } : {}),
      prepareTransfer: operation((contextId, command) => prepareTransfer(contextId, command)),
      executeTransfer: operation((token) => {
        const entry = consumeTicket(token);
        try {
          checkTicket(entry);
          if (entry.layout.direction === "upload") uploadGpu(entry.primary, entry.layout, entry.upload);
          else scatter(entry.transferBacking, entry.layout, readGpu(entry.primary, entry.layout));
          return success({ byteLength: entry.layout.tightBytes, direction: entry.layout.direction });
        } finally { releaseTicket(entry); }
      }),
      cancelTransfer: operation((token) => { releaseTicket(consumeTicket(token)); return success(); }),
      unref: operation((id) => {
        const res = resource(id); resources.delete(id); res.public = false;
        for (const member of [...res.memberships]) removeMember(member);
        removeBacking(res); collect(res); return success();
      }),
      destroyContext: operation((id) => {
        const ctx = context(id); ctx.active = false; contexts.delete(id);
        for (const member of [...ctx.memberships.values()]) removeMember(member);
        return success();
      }),
      inspect() {
        const list = [...live].map((res) => ({ ...res.meta, generation: res.generation, public: res.public,
          backingBytes: res.backing?.byteLength ?? 0, references: res.references,
          attachments: [...res.memberships].map((member) => member.context.id).sort((a, b) => a - b) }));
        list.sort((a, b) => a.generation - b.generation);
        return success({ disposed, limits, resources: freeze(list),
          contexts: freeze([...contexts.values()].map((ctx) => ({ id: ctx.id, generation: ctx.generation, resourceIds: [...ctx.memberships.keys()].sort((a, b) => a - b) }))),
          budgets: freeze({ resources: live.size, contexts: contexts.size, storages: [...live].filter((res) => res.storage !== null).length,
            backingBytes, cpuBytes: backingBytes + scratchBytes, gpuBytes, scratchBytes, tickets: tickets.size, leases: leases.size, ...(uniform ? { uniformRanges: uniformRanges.size } : {}), ...(images ? { imageViews: liveImages.size, imageHolds: imageHolds.size } : {}), ...(streamOutput ? {packedCaptures: packedCaptures.size} : {}) }) });
      },
      dispose() {
        return result(() => {
          disposed = true;
          for (const ctx of contexts.values()) ctx.active = false;
          contexts.clear(); resources.clear();
          for (const res of live) { res.public = false; removeBacking(res); for (const member of [...res.memberships]) removeMember(member); }
          for (const entry of leases.values()) entry.resource.references--;
          leases.clear();
          let firstError = null;
          for (const [token, entry] of storageReads) {
            revokedAccess.add(token);
            try { freeStorageRead(entry); } catch (error) { firstError ??= error; }
          }
          storageReads.clear();
          for (const [token, entry] of uniformRanges) {
            revokedUniform.add(token); entry.resource.references--;
          }
          uniformRanges.clear();
          if (images) {
            for (const token of [...imageViews.keys(), ...imageHolds.keys()]) revokedImages.add(token);
            imageViews.clear();
            for (const entry of liveImages) entry.references = 0;
            for (const entry of imageHolds.values()) if (entry.source) entry.resource.references--;
            imageHolds.clear();
            for (const entry of [...liveImages]) { try { collectImage(entry); } catch (error) { firstError ??= error; } }
          }
          for (const [token, entry] of tickets) {
            if (entry.asynchronous) revokedAccess.add(token);
            try { releaseTicket(entry); } catch (error) { firstError ??= error; }
          }
          tickets.clear();
          for (const [token, entry] of packedCaptures) {
            revokedCaptures.add(token);gpuBytes -= entry.bytes;
            try {host('destroy', entry.storage);} catch(error) {firstError ??= error;}
          }
          packedCaptures.clear();
          for (const res of [...live]) { try { collect(res); } catch (error) { firstError ??= error; } }
          try { host("dispose"); } catch (error) { firstError ??= error; }
          if (firstError) throw firstError;
          return success();
        });
      },
    };
    // Host-only capability: a guest numeric ID cannot resolve native storage.
    // The lease keeps the exact allocation alive even after public unref/reuse.
    const bindings = Object.freeze({
      retainScanout: operation((id, expectedGeneration) => {
        const res = resource(id);
        require(Number.isSafeInteger(expectedGeneration) && expectedGeneration > 0 && res.generation === expectedGeneration,
          "stale-resource", "Scanout resource generation changed.");
        require(res.meta.nrSamples === 0 && res.meta.kind === "texture" && (res.meta.format === 67 || (resourceLimits === PRODUCTION_RESOURCE_LIMITS && [1, 2].includes(res.meta.format))) && (res.meta.flags === 0 || (resourceLimits === PRODUCTION_RESOURCE_LIMITS && res.meta.flags === 1)) && (res.meta.bind & 2) !== 0,
          "unsupported-resource", "Scanout requires a supported renderable RGBA8 texture.");
        require(leases.size < limits.leases, "limit-exceeded", "Storage lease limit exceeded.");
        const lease = Object.freeze({}); leases.set(lease, { resource: res, role: "scanout" }); res.references++;
        return success({ lease, metadata: res.meta, generation: res.generation });
      }),
      resolve: operation((token) => {
        const entry = leases.get(token);
        require(entry !== undefined, "invalid-lease", "Unknown, released or foreign storage lease.");
        return success({ metadata: entry.resource.meta, generation: entry.resource.generation,
          role: entry.role, storage: entry.resource.storage });
      }),
    });
    const asyncEntry = (token) => {
      const entry = storageReads.get(token) ?? tickets.get(token);
      require(entry && (entry.resource || entry.asynchronous), "invalid-ticket", "Unknown asynchronous access token.");
      return entry;
    };
    const checkAsync = (entry) => {
      if (entry.resource && !entry.scanoutSnapshot) {
        require(leases.get(entry.lease) === entry.leaseEntry && entry.resource.contentRevision === entry.revision,
          "stale-storage", "Retained storage lease or contents changed during readback.");
      } else if (!entry.resource) checkTicket(entry);
    };
    const describeTransfer = (entry) => {
      if (entry.inline) return freeze({ resource: { id: entry.primary.meta.id, generation: entry.primary.generation },
        backingGeneration: null, inline: true, layout: entry.layout });
      const destination = entry.retained.find((res) => res.backing === entry.transferBacking);
      return freeze({ resource: { id: destination.meta.id, generation: destination.generation },
        backingGeneration: entry.transferBacking.generation, layout: entry.layout });
    };
    const asyncAccess = Object.freeze({
      describeBacking: operation((id) => {
        const res = resource(id), backing = needBacking(res);
        return success({ resource: freeze({ id: res.meta.id, generation: res.generation }),
          backingGeneration: backing.generation, byteLength: backing.byteLength });
      }),
      prepareTransfer: operation((id, command) => {
        const prepared = prepareTransfer(id, command, true), entry = tickets.get(prepared.ticket);
        return success({ ticket: prepared.ticket, ...describeTransfer(entry) });
      }),
      validate: operation((token) => { checkAsync(asyncEntry(token)); return success(); }),
      provideInput: operation((token, input) => {
        const entry = asyncEntry(token); checkAsync(entry);
        require(!entry.resource && entry.layout.direction === "upload" && entry.upload === null && !entry.uploadIssued,
          "invalid-ticket", "Transfer is not awaiting upload input.");
        const bytes = byteView(input);
        require(bytes.byteLength === entry.layout.tightBytes, "invalid-input", "Upload must contain exactly the dense transfer rows.");
        entry.upload = new Uint8Array(scratchCharge(entry.layout)).subarray(0, entry.layout.tightBytes);
        entry.upload.set(bytes); return success();
      }),
      upload: operation((token) => {
        const entry = asyncEntry(token); checkAsync(entry);
        require(!entry.resource && entry.layout.direction === "upload" && entry.upload !== null,
          "invalid-ticket", "Transfer has no supplied upload input.");
        const bytes = entry.upload; entry.upload = null; entry.uploadIssued = true;
        uploadGpu(entry.primary, entry.layout, bytes); return success();
      }),
      beginTransferRead: operation((token) => {
        const entry = asyncEntry(token); checkAsync(entry);
        require(!entry.resource && entry.layout.direction === "readback", "invalid-ticket", "Transfer is not a readback.");
        startRead(entry, entry.primary); return success();
      }),
      beginStorageRead: operation((lease, requestedBox) => {
        const leaseEntry = leases.get(lease);
        require(leaseEntry, "invalid-lease", "Unknown storage lease.");
        const res = leaseEntry.resource, meta = res.meta;
        const fields = normalizedFields({ resourceHandle: meta.id, level: 0, usage: 0, stride: 0, layerStride: 0,
          box: requestedBox, dataOffset: 0, direction: 2 });
        const layout = layoutFor(meta, fields, meta.byteLength, limits);
        require(leases.get(lease) === leaseEntry, "invalid-lease", "Storage lease changed while inspecting the box.");
        require(tickets.size + storageReads.size + uniformRanges.size < limits.tickets, "limit-exceeded", "Asynchronous access count exceeded.");
        reserveScratch(scratchCharge(layout));
        const entry = { resource: res, lease, leaseEntry, revision: res.contentRevision, layout, native: null, bytes: null };
        res.references++;
        try { startRead(entry, res); }
        catch (error) { freeStorageRead(entry); throw error; }
        const ticket = Object.freeze({}); storageReads.set(ticket, entry); return success({ ticket, layout });
      }),
      // A display capture is an ordered GPU snapshot. Its own reference outlives
      // the binding lease and later texture writes; index reads keep their stricter checks.
      beginScanoutRead: operation((lease) => {
        const leaseEntry = leases.get(lease);
        require(leaseEntry?.role === "scanout", "invalid-lease", "Expected a live global scanout lease.");
        const res = leaseEntry.resource, meta = res.meta;
        const fields = normalizedFields({ resourceHandle: meta.id, level: 0, usage: 0, stride: 0, layerStride: 0,
          box: { x: 0, y: 0, z: 0, width: meta.width, height: meta.height, depth: 1 }, dataOffset: 0, direction: 2 });
        const layout = layoutFor(meta, fields, meta.byteLength, limits);
        require(tickets.size + storageReads.size + uniformRanges.size < limits.tickets, "limit-exceeded", "Asynchronous access count exceeded.");
        reserveScratch(scratchCharge(layout));
        const entry = { resource: res, scanoutSnapshot: true, layout, native: null, bytes: null };
        res.references++;
        try { startRead(entry, res); }
        catch (error) { freeStorageRead(entry); throw error; }
        const ticket = Object.freeze({}); storageReads.set(ticket, entry);
        return success({ ticket, layout, resource: freeze({ id: meta.id, generation: res.generation }) });
      }),
      poll: operation((token, discard = false) => {
        require(typeof discard === "boolean", "invalid-input", "Discard must be boolean.");
        const entry = asyncEntry(token);
        if (!discard) checkAsync(entry);
        require(entry.native, "invalid-ticket", "Readback has not started.");
        if (!host("pollReadback", entry.native)) return success({ status: "pending" });
        if (discard) return success({ status: "ready" });
        if (entry.bytes === null) {
          const bytes = byteView(host("collectReadback", entry.native));
          require(bytes.byteLength === entry.layout.tightBytes, "backend-error", "Staged readback returned the wrong length.");
          entry.bytes = bytes;
        }
        return success({ status: "ready", bytes: entry.bytes });
      }),
      release(token) {
        return result(() => {
          // Disposal keeps only bounded opaque tombstones, not allocations or payloads.
          if (disposed) {
            require(revokedAccess.delete(token), "invalid-ticket", "Unknown or already released revoked access.");
            return success();
          }
          const entry = asyncEntry(token);
          if (entry.resource) { storageReads.delete(token); freeStorageRead(entry); }
          else { tickets.delete(token); releaseTicket(entry); }
          return success();
        });
      },
      inspect() { return success({ disposed, reads: storageReads.size,
        transfers: [...tickets.values()].filter((entry) => entry.asynchronous).length, stagingBytes }); },
    });
    // A pending range is a revision-checked snapshot. Submission converts it to
    // an allocation hold: later ordered uploads are legal, but its exact native
    // allocation remains alive through the job's final GPU fence.
    const uniformEntry = token => {
      const entry = uniformRanges.get(token);
      require(entry, "invalid-range", "Unknown, released or foreign uniform range.");
      return entry;
    };
    const checkUniform = entry => {
      require(entry.mode === "pending", "invalid-range", "Uniform range is already submitted.");
      require(entry.context.active && contexts.get(entry.context.id) === entry.context &&
        leases.get(entry.lease) === entry.leaseEntry && entry.resource.contentRevision === entry.revision,
      "stale-storage", "Uniform range context, lease or GPU contents changed before drawing.");
    };
    const uniformAccess = uniform ? Object.freeze({
      capture: operation((lease, offset, byteLength) => {
        const leaseEntry = leases.get(lease);
        require(leaseEntry?.role === "uniform", "invalid-lease", "Expected a retained uniform storage lease.");
        const res = leaseEntry.resource, ctx = leaseEntry.context;
        uint(offset, "offset"); uint(byteLength, "byteLength", true);
        require(offset <= res.meta.byteLength && byteLength <= res.meta.byteLength - offset,
          "out-of-bounds", "Uniform range exceeds its retained allocation.");
        require(ctx.active && contexts.get(ctx.id) === ctx, "stale-context", "Uniform lease context is no longer live.");
        require(tickets.size + storageReads.size + uniformRanges.size < limits.tickets,
          "limit-exceeded", "Uniform range and asynchronous ticket budget exceeded.");
        const token = Object.freeze({}), entry = { resource: res, context: ctx, lease, leaseEntry,
          revision: res.contentRevision, offset, byteLength, mode: "pending" };
        res.references++; uniformRanges.set(token, entry);
        return success({ token, generation: res.generation, metadata: res.meta, storage: res.storage, offset, byteLength });
      }),
      validate: operation(token => { checkUniform(uniformEntry(token)); return success(); }),
      submit: operation(token => { const entry = uniformEntry(token); checkUniform(entry); entry.mode = "submitted"; return success(); }),
      release(token) {
        return result(() => {
          if (disposed) { require(revokedUniform.delete(token), "invalid-range", "Unknown or already released revoked uniform range."); return success(); }
          const entry = uniformEntry(token); uniformRanges.delete(token);
          entry.resource.references--; collect(entry.resource); return success();
        });
      },
      inspect() { return success({ disposed, pending: [...uniformRanges.values()].filter(entry => entry.mode === "pending").length,
        submitted: [...uniformRanges.values()].filter(entry => entry.mode === "submitted").length }); },
    }) : null;
    const imageEntry = token => {
      const entry = imageViews.get(token);
      require(entry, "invalid-view", "Unknown, released or foreign native image view.");
      imageLease(entry.lease, ["view"]); return entry;
    };
    const imageAccess = images ? Object.freeze({
      capture: operation((lease, firstLevel, lastLevel, firstLayer = 0, lastLayer = 0) => {
        const leaseEntry = imageLease(lease, ["view"]), res = leaseEntry.resource, meta = res.meta;
        uint(firstLevel, "firstLevel"); uint(lastLevel, "lastLevel");
        require(firstLevel <= lastLevel && lastLevel <= meta.lastLevel, "out-of-bounds", "Original view range exceeds retained image levels.");
        require(liveImages.size < limits.leases, "limit-exceeded", "Live/retained native image view limit exceeded.");
        if (dimensionalViews && meta.kind === "dimensional-texture" || dimensionalDepthViews && meta.kind === "dimensional-depth-texture") {
          uint(firstLayer, "firstLayer"); uint(lastLayer, "lastLayer");
          require(meta.target === 3 ? firstLayer === 0 && lastLayer === 0 : meta.target === 4 ? firstLayer === 0 && lastLayer === 5 :
            firstLayer <= lastLayer && lastLayer < meta.arraySize, "out-of-bounds", "Original view range exceeds retained image layers.");
          const selected = meta.levels.slice(firstLevel, lastLevel + 1), arraySize = meta.target === 7 ? lastLayer - firstLayer + 1 : meta.arraySize;
          const depth = meta.kind === "dimensional-depth-texture", pixelBytes = meta.pixelBytes,
            nativePixelBytes = depth ? ownedColorFormat(meta).allocationPixelBytes : ownedColorFormat(meta)?.nativePixelBytes ?? (meta.format === 2 ? 3 : 4);
          let byteLength = 0, gpuByteLength = 0;
          const levels = selected.map((source, level) => {
            const layers = meta.target === 7 ? arraySize : source.layers;
            const pixels = checkedProduct(checkedProduct(source.width, source.height, limits.resourceBytes,
              "Dimensional view plane is too large."), layers, limits.resourceBytes, "Dimensional view level is too large.");
            const bytes = checkedProduct(pixels, pixelBytes, limits.resourceBytes, "Dimensional view level is too large."),
              nativeBytes = checkedProduct(pixels, nativePixelBytes, limits.resourceBytes, "Native dimensional view level is too large.");
            require(bytes <= limits.resourceBytes - byteLength && nativeBytes <= limits.resourceBytes - gpuByteLength,
              "limit-exceeded", "Complete dimensional view exceeds resource byte limit.");
            byteLength += bytes; gpuByteLength += nativeBytes;
            return { level, width: source.width, height: source.height, layers, byteLength: bytes, gpuByteLength: nativeBytes };
          });
          const base = levels[0], metadata = freeze({ ...meta, width: base.width, height: base.height,
            depth: meta.target === 3 ? base.layers : 1, arraySize, lastLevel: lastLevel - firstLevel,
            byteLength, gpuByteLength, levels });
          const privateRange = firstLevel !== 0 || lastLevel !== meta.lastLevel || meta.target === 7 && (firstLayer !== 0 || lastLayer !== meta.arraySize - 1);
          const sharedCopyScratchBytes = privateRange && meta.sharedExponent ? checkedProduct(base.width*base.height,8,limits.gpuBytes,"Shared layered copy scratch is too large") : 0;
          const metadataWithScratch = sharedCopyScratchBytes ? freeze({...metadata,sharedCopyScratchBytes}) : metadata;
          const allocationBytes = privateRange ? gpuByteLength+sharedCopyScratchBytes : 0;
          require(allocationBytes <= limits.gpuBytes - gpuBytes, "limit-exceeded", "Native dimensional view byte budget exceeded.");
          if (depth) gpuBytes += allocationBytes;
          let storage;
          try {
            storage = allocationBytes ? host("allocate", metadataWithScratch) : res.storage;
            require(storage && typeof storage === "object", "backend-error", "Native dimensional view allocation returned no storage.");
          } catch (error) { if (depth) gpuBytes -= allocationBytes; throw error; }
          const token = Object.freeze({}), entry = { resource: res, lease, metadata:metadataWithScratch, firstLevel, lastLevel, firstLayer, storage, allocationBytes, references: 1 };
          if (!depth) gpuBytes += allocationBytes; res.references++; liveImages.add(entry); imageViews.set(token, entry);
          return success({ token, metadata:metadataWithScratch, generation: res.generation });
        }
        const width = Math.max(1, Math.floor(meta.width / 2 ** firstLevel)), height = Math.max(1, Math.floor(meta.height / 2 ** firstLevel));
        const levels = []; let byteLength = 0, gpuByteLength = 0;
        const color = Object.hasOwn(meta, "pixelBytes") ? ownedColorFormat(meta) : null;
        for (let level = 0, w = width, h = height; level <= lastLevel - firstLevel; level++) {
          const bytes = checkedProduct(checkedProduct(w, h, limits.resourceBytes, "View plane is too large."), color?.pixelBytes ?? 4, limits.resourceBytes, "View plane is too large.");
          require(bytes <= limits.resourceBytes - byteLength, "limit-exceeded", "Complete view mip chain exceeds resource byte limit.");
          let nativeBytes;
          if (color) {
            nativeBytes = checkedProduct(checkedProduct(w, h, limits.resourceBytes, "Native view plane is too large."), color.allocationPixelBytes ?? color.nativePixelBytes, limits.resourceBytes, "Native view plane is too large.");
            require(nativeBytes <= limits.resourceBytes - gpuByteLength, "limit-exceeded", "Native view mip chain exceeds resource byte limit.");
            gpuByteLength += nativeBytes;
          }
          levels.push({ level, width: w, height: h, byteLength: bytes, ...(color ? { gpuByteLength: nativeBytes } : {}) }); byteLength += bytes;
          w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
        }
        const privateRange = firstLevel !== 0 || lastLevel !== meta.lastLevel;
        const sharedCopyScratchBytes = privateRange && color?.sharedExponent ? checkedProduct(checkedProduct(width, height, limits.gpuBytes, "Shared exponent copy image is too large."), color.copyPixelBytes, limits.gpuBytes, "Shared exponent copy scratch is too large.") : 0;
        const metadata = freeze({ ...meta, kind: color?.floatingDepth || color?.unormDepth || color?.packedDepth ? lastLevel > firstLevel ? "mip-depth-texture" : "depth-texture" : lastLevel > firstLevel ? "mip-texture" : "texture", width, height,
          lastLevel: lastLevel - firstLevel, byteLength, levels, ...(color ? { gpuByteLength } : {}), ...(sharedCopyScratchBytes ? { sharedCopyScratchBytes } : {}) });
        const allocationBytes = privateRange ? (color ? gpuByteLength : byteLength) + sharedCopyScratchBytes : 0;
        require(allocationBytes <= limits.gpuBytes - gpuBytes, "limit-exceeded", "Native image view byte budget exceeded.");
        if (color?.floatingDepth || color?.unormDepth || color?.packedDepth) gpuBytes += allocationBytes;
        let storage;
        try {
          storage = allocationBytes ? host("allocate", metadata) : res.storage;
          require(storage && typeof storage === "object", "backend-error", "Native image view allocation returned no storage.");
        } catch (error) { if (color?.floatingDepth || color?.unormDepth || color?.packedDepth) gpuBytes -= allocationBytes; throw error; }
        const token = Object.freeze({}), entry = { resource: res, lease, metadata, firstLevel, lastLevel, storage, allocationBytes, references: 1 };
        if (!color?.floatingDepth && !color?.unormDepth && !color?.packedDepth) gpuBytes += allocationBytes; res.references++; liveImages.add(entry); imageViews.set(token, entry);
        return success({ token, metadata, generation: res.generation });
      }),
      markWritten: operation(lease => {
        const entry = imageLease(lease, ["surface", "depth-surface"]);
        require(entry.resource.contentRevision < Number.MAX_SAFE_INTEGER, "limit-exceeded", "Image revision space exhausted.");
        entry.resource.contentRevision++; return success();
      }),
      resolve: operation(token => { const entry = imageEntry(token); return success({ storage: entry.storage, metadata: entry.metadata, generation: entry.resource.generation }); }),
      refresh: operation(token => {
        const entry = imageEntry(token);
        if (entry.allocationBytes) host("copyTextureRange", entry.resource.storage, entry.storage, entry.metadata, entry.firstLevel,
          ...(dimensionalViews && entry.metadata.kind === "dimensional-texture" || dimensionalDepthViews && entry.metadata.kind === "dimensional-depth-texture" ? [entry.firstLayer] : []));
        return success();
      }),
      hold: operation(token => {
        const entry = imageEntry(token);
        require(imageHolds.size < limits.tickets, "limit-exceeded", "Image completion-hold count exceeded.");
        const hold = Object.freeze({}); entry.references++; imageHolds.set(hold, entry); return success({ token: hold });
      }),
      holdStorage: operation(lease => {
        const entry = imageLease(lease, ["surface", "depth-surface"]);
        require(imageHolds.size < limits.tickets, "limit-exceeded", "Image completion-hold count exceeded.");
        const token = Object.freeze({}); entry.resource.references++;
        imageHolds.set(token, { resource: entry.resource, source: true }); return success({ token, generation: entry.resource.generation });
      }),
      release(token) {
        return result(() => {
          if (disposed) { require(revokedImages.delete(token), "invalid-view", "Unknown or already released revoked image token."); return success(); }
          const entry = imageViews.get(token) ?? imageHolds.get(token);
          require(entry, "invalid-view", "Unknown, released or foreign native image token.");
          imageViews.delete(token); imageHolds.delete(token);
          if (entry.source) { entry.resource.references--; collect(entry.resource); }
          else { entry.references--; collectImage(entry); }
          return success();
        });
      },
      inspect() { return success({ disposed, views: imageViews.size, allocations: liveImages.size, holds: imageHolds.size }); },
    }) : null;
    const streamOutputAccess = streamOutput ? Object.freeze({
      allocatePacked: operation(byteLength => {
        require(Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= limits.resourceBytes && byteLength <= limits.gpuBytes - gpuBytes && packedCaptures.size < limits.tickets, 'limit-exceeded', 'Packed capture exceeds its charged native budget.');
        const metadata = Object.freeze({id: 0, target: 0, format: 64, bind: 16, width: byteLength, height: 1, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0, kind: 'standard-buffer', byteLength});
        const storage = host('allocate', metadata);if (!storage || storage.kind !== 'buffer') {if (storage) host('destroy', storage);throw new ResourceFault('backend-error', 'Packed capture did not allocate native buffer storage.');}
        const token = Object.freeze({});gpuBytes += byteLength;packedCaptures.set(token, {storage, bytes: byteLength});return success({token, storage, byteLength});
      }),
      release(token) {return result(() => {
        if (disposed) {require(revokedCaptures.delete(token), 'invalid-capture', 'Unknown or released revoked capture.');return success();}
        const entry = packedCaptures.get(token);require(entry, 'invalid-capture', 'Unknown or released packed capture.');packedCaptures.delete(token);gpuBytes -= entry.bytes;host('destroy', entry.storage);return success();
      });},
      markWritten: operation(lease => {
        const entry = leases.get(lease);require(entry && entry.role === 'stream-output' && entry.resource.storage, 'invalid-lease', 'Original capture requires its retained buffer lease.');
        require(entry.resource.contentRevision < Number.MAX_SAFE_INTEGER, 'limit-exceeded', 'Capture revision space exhausted.');entry.resource.contentRevision++;return success();
      }),
    }) : null;
    return success({ store: Object.freeze(store), bindings, asyncAccess, ...(uniform ? { uniformAccess } : {}), ...(images ? { imageAccess } : {}), ...(streamOutput ? {streamOutputAccess} : {}) });
  });
}

/** Trusted backend using actual WebGL2 storage, never a CPU storage mirror. */
export function createWebGL2TransferBackend(gl) { return createTransferBackend(gl, false); }

export function createStandardColorTransferBackend(gl) { return createTransferBackend(gl, true); }

/** Retained original texture jobs preserve raw buffer reads beside color images. */
export function createStandardTextureTransferBackend(gl) { return createTransferBackend(gl, true, true); }

export function createStandardFloatColorTransferBackend(gl) { return createTransferBackend(gl, true, true, true); }

export function createStandardPackedFloatColorTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true); }

export function createStandardSharedExponentTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true, true); }

export function createStandardIntegerColorTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true, true, true); }
export function createStandardPackedNormalizedTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true, true, true, true); }

export function createStandardPackedUnsignedTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true, true, true, true, true); }

export function createStandardFloatingDepthTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true, true, true, true, true, true); }

export function createStandardUnormDepthTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true, true, true, true, true, true, true); }

export function createStandardPackedDepthTransferBackend(gl) { return createTransferBackend(gl, true, true, true, true, true, true, true, true, true, true, true); }

export function createStandardDimensionalTransferBackend(gl) {
  return createTransferBackend(gl, true, true, true, true, true, true, true, true, true, true, true, true);
}
export function createStandardDimensionalViewTransferBackend(gl) {
  return createTransferBackend(gl, true, true, true, true, true, true, true, true, true, true, true, true, true);
}
export function createStandardDimensionalDepthTransferBackend(gl) {
  return createTransferBackend(gl, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}
export function createStandardDimensionalDepthViewTransferBackend(gl) {
  return createTransferBackend(gl, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}
export function createProductionTransferBackend(gl) {
  return createTransferBackend(gl, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
}

function createTransferBackend(gl, colors, rawBufferReadbacks = false, floats = false, packed = false, shared = false, integers = false, normalized = false, unsigned = false, floatingDepth = false, unormDepth = false, packedDepth = false, dimensional = false, dimensionalViews = false, dimensionalDepth = false, dimensionalDepthViews = false, production = false) {
  return result(() => {
    require(gl && typeof gl.getBufferSubData === "function" && typeof gl.texStorage2D === "function", "invalid-input", "A WebGL2 context is required.");
    require(!colors || gl.getExtension("EXT_render_snorm"), "unsupported-host", "Native signed color copies/readbacks require EXT_render_snorm.");
    require(!floats || gl.getExtension("EXT_color_buffer_float"), "unsupported-host", "Native floating planes require EXT_color_buffer_float.");
    const indexedMasks = normalized ? gl.getExtension("OES_draw_buffers_indexed") : null;
    let vao = null, framebuffer = null, depthProgram = null, sharedPacker = null, floatingDepthPacker = null, disposed = false;
    const allocations = new Set(), pendingReads = new Set(), dimensionalSharedPackers = new Map();
    const colorFormats = {
      16: { internal: gl.DEPTH_COMPONENT16, upload: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_SHORT },
      2: { internal: gl.RGB8, upload: gl.RGB, type: gl.UNSIGNED_BYTE },
      67: { internal: gl.RGBA8, upload: gl.RGBA, type: gl.UNSIGNED_BYTE },
      233: { internal: gl.RGB10_A2, upload: gl.RGBA, type: gl.UNSIGNED_INT_2_10_10_10_REV },
    };
    const colorFormat = (meta) => {
      const color = (colors ? byteColorFormat(meta.format) : null) || (floats ? floatColorFormat(meta.format) : null) || (packed ? packedFloatColorFormat(meta.format) : null) || (shared ? sharedExponentColorFormat(meta.format) : null) || (integers ? integerColorFormat(meta.format) : null) || (normalized ? packedNormalizedColorFormat(meta.format) : null) || (unsigned ? packedUnsignedColorFormat(meta.format) : null) || (floatingDepth ? floatingDepthFormat(meta.format) : null) || (unormDepth ? unormDepthFormat(meta.format) : null) || (packedDepth ? packedDepthFormat(meta.format) : null);
      const profile = color ? { internal: gl[color.internal], upload: gl[color.upload], type: gl[color.type], ...(color.precision || color.packedFloat ? { readType: gl.FLOAT } : {}), ...(color.integerBits ? { readType: gl[color.readType], readFormat: gl[color.readFormat] } : {}), ...(color.packedNormalized ? { readType: gl[color.readType] } : {}) } : colorFormats[meta.format];
      require(profile, "unsupported-resource", "Unsupported native texture storage format.");
      return profile;
    };
    const selectedDepthFormat = format => (packedDepth ? packedDepthFormat(format) : null) || (unormDepth ? unormDepthFormat(format) : null) || (floatingDepth ? floatingDepthFormat(format) : null);
    // Store uploads are private, dense scratch arrays. Convert in that same
    // reservation: no second CPU image or GPU shadow escapes the byte budgets.
    const nativeUpload = (format, bytes) => {
      const fixed = packedDepth ? packedDepthFormat(format) : null;
      if (fixed) {
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        for (let i = 0; i < words.length; i++) {
          const original = data.getUint32(i * 4, true);
          // Packed S8/UN24 already has the native field order. For Z24X8,
          // choose the U32 encoding around the original binary32 depth: simple
          // bit replication can lose a canonical high-half value on upload.
          words[i] = fixed.stencil ? original : Math.min(0xffff_ffff, Math.round(Math.fround((original & 0x00ff_ffff) / 0x00ff_ffff) * 0x1_0000_0000));
        }
        return words;
      }
      const depth = floatingDepth ? floatingDepthFormat(format) : null;
      if (depth) {
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        for (let i = 0; i < words.length; i++) words[i] = data.getUint32(i * 4, true);
        return depth.stencil ? words : new Float32Array(bytes.buffer, bytes.byteOffset, words.length);
      }
      const packedColor = (normalized ? packedNormalizedColorFormat(format) : null) || (unsigned ? packedUnsignedColorFormat(format) : null);
      if (packedColor) {
        const size = packedColor.pixelBytes, data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const native = size === 2 ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        for (let i = 0; i < native.length; i++) {
          const original = size === 2 ? data.getUint16(i * 2, true) : data.getUint32(i * 4, true);
          let word = 0;
          for (let lane = 0; lane < 4; lane++) {
            const field = packedColor.fields[lane], mask = 2 ** field.bits - 1;
            const value = lane === 3 && packedColor.implicitAlpha ? mask : (original >>> field.offset) & mask;
            word |= value << field.nativeOffset;
          }
          native[i] = word;
        }
        return native;
      }
      const integer = integers ? integerColorFormat(format) : null;
      if (integer) {
        const size = integer.integerBits / 8, count = bytes.length / integer.pixelBytes, nativeCount = integer.nativePixelBytes / size;
        const data = new DataView(bytes.buffer, bytes.byteOffset, count * integer.nativePixelBytes);
        const ArrayType = integer.signed ? [Int8Array, Int16Array, Int32Array][Math.log2(size)] : [Uint8Array, Uint16Array, Uint32Array][Math.log2(size)];
        const native = new ArrayType(bytes.buffer, bytes.byteOffset, count * nativeCount);
        const read = at => size === 1 ? data.getUint8(at) : size === 2 ? data.getUint16(at, true) : data.getUint32(at, true);
        // Reverse expansion protects unread original words in the charged scratch.
        for (let i = count - 1; i >= 0; i--) for (let lane = nativeCount - 1; lane >= 0; lane--)
          native[i * nativeCount + lane] = lane < integer.components ? read(i * integer.pixelBytes + lane * size) : 1;
        return native;
      }
      if (packed && packedFloatColorFormat(format) || shared && sharedExponentColorFormat(format)) {
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        for (let i = 0; i < words.length; i++) words[i] = data.getUint32(i * 4, true);
        return words;
      }
      const floating = floats ? floatColorFormat(format) : null;
      if (floating) {
        const count = bytes.length / floating.pixelBytes, size = floating.precision / 8, nativeCount = floating.nativePixelBytes / size;
        const data = new DataView(bytes.buffer, bytes.byteOffset, count * floating.nativePixelBytes);
        const read = at => size === 2 ? data.getUint16(at, true) : data.getUint32(at, true);
        const write = (at, value) => size === 2 ? data.setUint16(at, value, true) : data.setUint32(at, value, true);
        // Both pixels and lanes expand backwards in the one charged buffer.
        for (let i = count - 1; i >= 0; i--) for (let lane = nativeCount - 1; lane >= 0; lane--) {
          const word = lane < floating.components ? read(i * floating.pixelBytes + lane * size) : size === 2 ? 0x3c00 : 0x3f800000;
          write(i * floating.nativePixelBytes + lane * size, word);
        }
        return size === 2 ? new Uint16Array(bytes.buffer, bytes.byteOffset, count * nativeCount) : new Float32Array(bytes.buffer, bytes.byteOffset, count * nativeCount);
      }
      const color = colors ? byteColorFormat(format) : null;
      if (color) {
        const count = bytes.length / color.pixelBytes, native = new Uint8Array(bytes.buffer, bytes.byteOffset, count * color.nativePixelBytes);
        // Expansion walks backwards; compaction walks forwards. One pixel is
        // captured before permutation, inside the already charged reservation.
        for (let step = 0; step < count; step++) {
          const i = color.nativePixelBytes > color.pixelBytes ? count - step - 1 : step, source = i * color.pixelBytes, pixel = [bytes[source], bytes[source + 1], bytes[source + 2], bytes[source + 3]];
          for (let lane = 0; lane < color.nativePixelBytes; lane++) {
            const original = color.lanes[lane];
            native[i * color.nativePixelBytes + lane] = original === "0" ? 0 : original === "1" ? color.snorm ? 127 : 255 : pixel[original];
          }
        }
        return color.snorm ? new Int8Array(native.buffer, native.byteOffset, native.byteLength) : native;
      }
      if (format === 16) {
        const guest = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const native = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        for (let i = 0; i < native.length; i++) native[i] = guest.getUint16(i * 2, true);
        return native;
      }
      if (format === 2) {
        for (let source = 0, target = 0; source < bytes.length; source += 4, target += 3) {
          const b = bytes[source], g = bytes[source + 1], r = bytes[source + 2];
          bytes[target] = r; bytes[target + 1] = g; bytes[target + 2] = b;
        }
        return bytes.subarray(0, bytes.length / 4 * 3);
      }
      if (format === 233) {
        const guest = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const native = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        for (let i = 0; i < native.length; i++) {
          const word = guest.getUint32(i * 4, true);
          native[i] = ((word >>> 20) & 1023) | (word & 0x000ffc00) | ((word & 1023) << 20) | 0xc0000000;
        }
        return native;
      }
      return bytes;
    };
    const guestReadback = (format, bytes, nativeByteLength = bytes.length) => {
      const fixed = packedDepth ? packedDepthFormat(format) : null;
      if (fixed) {
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = nativeByteLength / fixed.readPixelBytes;
        // Compact the authoritative native depth plane forwards. The stencil
        // plane follows all depth words and stays untouched until it is read.
        for (let i = 0; i < count; i++) {
          const depth = Math.round(Math.max(0, Math.min(1, data.getFloat32(i * 4, true))) * 0x00ff_ffff);
          const original = fixed.stencil ? ((depth << 8) | bytes[count * 4 + i * 4]) >>> 0 : depth;
          data.setUint32(i * 4, original, true);
        }
        return bytes.subarray(0, count * 4);
      }
      if (unormDepth && unormDepthFormat(format)) {
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        // Only serialize authoritative native FLOAT depth. Compact forwards in
        // the charged scratch; no original CPU image supplies these values.
        for (let i = 0; i < nativeByteLength / 4; i++)
          data.setUint16(i * 2, Math.round(Math.max(0, Math.min(1, data.getFloat32(i * 4, true))) * 65535), true);
        return bytes.subarray(0, nativeByteLength / 2);
      }
      const depth = floatingDepth ? floatingDepthFormat(format) : null;
      if (depth) {
        if (!depth.stencil) return bytes;
        const count = nativeByteLength / 8, output = bytes.subarray(nativeByteLength, nativeByteLength * 2);
        // Native planes occupy the first charged half. Interleave in the second
        // half so an original depth/stencil field cannot overwrite unread bytes.
        for (let i = 0; i < count; i++) {
          output.set(bytes.subarray(i * 4, i * 4 + 4), i * 8);
          output[i * 8 + 4] = bytes[count * 4 + i * 4];
          output.fill(0, i * 8 + 5, i * 8 + 8);
        }
        return output;
      }
      const packedInteger = unsigned ? packedUnsignedColorFormat(format) : null;
      if (packedInteger) {
        const count = bytes.length / 16, native = new Uint32Array(bytes.buffer, bytes.byteOffset, count * 4);
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < count; i++) {
          // Read every native integer lane before compacting the charged buffer.
          const pixel = [native[i * 4], native[i * 4 + 1], native[i * 4 + 2], native[i * 4 + 3]];
          let word = 0;
          for (let lane = 0; lane < 4; lane++) {
            const field = packedInteger.fields[lane];
            word |= (pixel[lane] & (2 ** field.bits - 1)) << field.offset;
          }
          data.setUint32(i * 4, word, true);
        }
        return bytes.subarray(0, count * 4);
      }
      const normalizedColor = normalized ? packedNormalizedColorFormat(format) : null;
      if (normalizedColor) {
        const size = normalizedColor.pixelBytes, data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const words = size === 4 ? new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4) : null;
        for (let i = 0; i < bytes.length / 4; i++) {
          // Capture a whole native pixel before compacting this charged buffer.
          const pixel = words ? words[i] : [bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]];
          let word = 0;
          for (let lane = 0; lane < 4; lane++) {
            const field = normalizedColor.fields[lane], mask = 2 ** field.bits - 1;
            const value = lane === 3 && normalizedColor.implicitAlpha ? mask : words ? (pixel >>> field.nativeOffset) & mask : Math.round(pixel[lane] * mask / 255);
            word |= value << field.offset;
          }
          if (size === 2) data.setUint16(i * 2, word, true); else data.setUint32(i * 4, word, true);
        }
        return bytes.subarray(0, bytes.length / 4 * size);
      }
      const integer = integers ? integerColorFormat(format) : null;
      if (integer) {
        const count = bytes.length / 16, size = integer.integerBits / 8;
        const native = integer.signed ? new Int32Array(bytes.buffer, bytes.byteOffset, count * 4) : new Uint32Array(bytes.buffer, bytes.byteOffset, count * 4);
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < count; i++) for (let lane = 0; lane < integer.components; lane++) {
          const word = native[i * 4 + lane], target = i * integer.pixelBytes + lane * size;
          if (size === 1) data.setUint8(target, word);
          else if (size === 2) data.setUint16(target, word, true);
          else data.setUint32(target, word, true);
        }
        return bytes.subarray(0, count * integer.pixelBytes);
      }
      if (shared && sharedExponentColorFormat(format)) {
        const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < words.length; i++) data.setUint32(i * 4, words[i], true);
        return bytes;
      }
      if (packed && packedFloatColorFormat(format)) {
        const count = bytes.length / 16, data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < count; i++) data.setUint32(i * 4, r11g11b10FromFloatWords(data.getUint32(i * 16, true), data.getUint32(i * 16 + 4, true), data.getUint32(i * 16 + 8, true)), true);
        return bytes.subarray(0, count * 4);
      }
      const floating = floats ? floatColorFormat(format) : null;
      if (floating) {
        const count = bytes.length / 16, size = floating.precision / 8, data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < count; i++) {
          for (let lane = 0; lane < floating.components; lane++) {
            const word = data.getUint32(i * 16 + lane * 4, true), target = i * floating.pixelBytes + lane * size;
            if (size === 4) data.setUint32(target, word, true);
            else data.setUint16(target, halfFromFloatWord(word), true);
          }
        }
        return bytes.subarray(0, count * floating.pixelBytes);
      }
      const color = colors ? byteColorFormat(format) : null;
      if (color) {
        const count = bytes.length / 4;
        for (let i = 0; i < count; i++) {
          const pixel = [bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]];
          for (let lane = 0; lane < color.pixelBytes; lane++) {
            const rgba = color.lanes.indexOf(lane);
            bytes[i * color.pixelBytes + lane] = rgba < 0 ? 255 : pixel[rgba];
          }
        }
        return bytes.subarray(0, count * color.pixelBytes);
      }
      if (format === 16) {
        // GPU packing produced low/high UN16 bytes in RG; compact the same
        // charged RGBA scratch. The returned view owns that underlying image.
        for (let source = 0, target = 0; source < bytes.length; source += 4, target += 2) {
          bytes[target] = bytes[source]; bytes[target + 1] = bytes[source + 1];
        }
        return bytes.subarray(0, bytes.length / 2);
      } else if (format === 2) {
        for (let i = 0; i < bytes.length; i += 4) {
          const r = bytes[i]; bytes[i] = bytes[i + 2]; bytes[i + 2] = r; bytes[i + 3] = 255;
        }
      } else if (format === 233) {
        const native = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        const guest = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < native.length; i++) {
          const word = native[i];
          guest.setUint32(i * 4, ((word >>> 20) & 1023) | (word & 0x000ffc00) | ((word & 1023) << 20) | 0xc0000000, true);
        }
      }
      return bytes;
    };
    const check = () => {
      require(!disposed && !gl.isContextLost(), "backend-error", "WebGL context is disposed or lost.");
      const error = gl.getError();
      require(error === gl.NO_ERROR, "backend-error", `WebGL error ${error}.`);
    };
    const sharedHelper = (target=2) => {
      if (target !== 2) {
        require(production && [3,4,7].includes(target),"unsupported-resource","Dimensional shared conversion is not selected");
        if (!dimensionalSharedPackers.has(target)) dimensionalSharedPackers.set(target,createSharedExponentPacker(gl,check,require,vao,target));
        return dimensionalSharedPackers.get(target);
      }
      require(shared, "unsupported-resource", "Shared exponent GPU conversion is not selected.");
      return sharedPacker ??= createSharedExponentPacker(gl, check, require, vao);
    };
    const sharedConversion = (storage, layout) => {
      const helper = sharedHelper(), converted = helper.createScratch(layout.box.width, layout.box.height);
      try { helper.pack(converted, storage.texture, layout.level ?? 0, layout.box); return converted; }
      catch (error) { helper.releaseScratch(converted); throw error; }
    };
    const floatingDepthHelper = () => {
      require(floatingDepth, "unsupported-resource", "Floating depth GPU conversion is not selected.");
      return floatingDepthPacker ??= createFloatingDepthPacker(gl, check, require, vao, indexedMasks);
    };
    const floatingDepthConversion = (storage, meta, layout) => {
      const helper = floatingDepthHelper(), converted = helper.createScratch(layout.box.width, layout.box.height, selectedDepthFormat(meta.format).stencil, packedDepth && packedDepthFormat(meta.format)?.stencil ? gl.DEPTH24_STENCIL8 : undefined);
      try { helper.pack(converted, storage.texture, layout.level ?? 0, layout.box); return converted; }
      catch (error) { helper.releaseScratch(converted); throw error; }
    };
    const pixelState = () => {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (const parameter of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS,
        gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) gl.pixelStorei(parameter, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    };
    const initializeXAlpha = (texture, level = 0, color = null) => {
      const previous = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), mask = gl.getParameter(gl.COLOR_WRITEMASK);
      const masks = indexedMasks ? Array.from({length: gl.getParameter(gl.MAX_DRAW_BUFFERS)}, (_, index) => gl.getIndexedParameter(gl.COLOR_WRITEMASK, index)) : null;
      const scissor = gl.isEnabled(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      try {
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        require(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Packed color initialization framebuffer is incomplete.");
        gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
        if (color?.integerBits) gl[color.signed ? "clearBufferiv" : "clearBufferuiv"](gl.COLOR, 0, [0, 0, 0, 1]);
        else gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      } finally {
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previous); gl.colorMask(...mask);
        if (masks) masks.forEach((value, index) => indexedMasks.colorMaskiOES(index, ...value));
        if (scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      }
    };
    const depthPacker = () => {
      if (depthProgram) return depthProgram;
      const shaders = [], program = gl.createProgram();
      try {
        require(program, "backend-error", "Depth packing program allocation failed.");
        for (const [type, text] of [
          [gl.VERTEX_SHADER, "#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}"],
          [gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;precision highp int;uniform highp sampler2D src;uniform ivec2 origin;out vec4 color;void main(){float z=texelFetch(src,origin+ivec2(gl_FragCoord.xy),0).r;uint d=uint(floor(clamp(z,0.0,1.0)*65535.0+0.5));color=vec4(float(d&255u),float(d>>8),0.0,255.0)/255.0;}"],
        ]) {
          const shader = gl.createShader(type); require(shader, "backend-error", "Depth packing shader allocation failed.");
          shaders.push(shader); gl.shaderSource(shader, text); gl.compileShader(shader);
          require(gl.getShaderParameter(shader, gl.COMPILE_STATUS), "backend-error", "Depth packing shader compilation failed.");
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        require(gl.getProgramParameter(program, gl.LINK_STATUS), "backend-error", "Depth packing program link failed.");
        const src = gl.getUniformLocation(program, "src"), origin = gl.getUniformLocation(program, "origin");
        require(src !== null && origin !== null, "backend-error", "Depth packing uniforms are unavailable.");
        depthProgram = { program, src, origin }; return depthProgram;
      } catch (error) { if (program) gl.deleteProgram(program); throw error; }
      finally { for (const shader of shaders) gl.deleteShader(shader); }
    };
    const packDepth = (storage, box) => {
      const texture = gl.createTexture();
      let attached = false;
      try {
        require(texture, "backend-error", "Depth conversion texture allocation failed.");
        const packer = depthPacker();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, box.width, box.height);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        attached = true;
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        require(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Depth conversion framebuffer is incomplete.");
        gl.bindVertexArray(vao); gl.useProgram(packer.program); gl.viewport(0, 0, box.width, box.height);
        for (const capability of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.DITHER,
          gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) gl.disable(capability);
        gl.colorMask(true, true, true, true); gl.bindTexture(gl.TEXTURE_2D, storage.texture); gl.bindSampler(0, null);
        gl.uniform1i(packer.src, 0); gl.uniform2i(packer.origin, box.x, box.y); gl.drawArrays(gl.TRIANGLES, 0, 3);
        check(); return texture;
      } catch (error) {
        if (attached) gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        if (texture) gl.deleteTexture(texture); throw error;
      }
    };
    try {
      check();
      vao = gl.createVertexArray(); framebuffer = gl.createFramebuffer();
      require(vao && framebuffer, "backend-error", "WebGL helper allocation failed.");
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const dimensionalAccess = dimensional ? createDimensionalGpuAccess(gl, framebuffer, check, require, colorFormat, nativeUpload) : null;
      const dimensionalDepthAccess = dimensionalDepth ? createDimensionalDepthGpuAccess(gl, check, require, colorFormat, floatingDepthHelper) : null;
      check();
      const destroy = (storage) => {
        if (!allocations.has(storage)) return;
        if (storage.kind === "renderbuffer") gl.deleteRenderbuffer(storage.renderbuffer);
        else if (storage.kind === "texture") { gl.deleteTexture(storage.texture); if (storage.depthUploadBuffer) gl.deleteBuffer(storage.depthUploadBuffer); if (storage.sharedCopyScratch) sharedHelper(storage.sharedCopyScratchTarget??2).releaseScratch(storage.sharedCopyScratch); } else gl.deleteBuffer(storage.buffer);
        allocations.delete(storage);
      };
      const releaseReadback = (entry) => {
        if (!pendingReads.delete(entry)) return;
        if (entry.sync) gl.deleteSync(entry.sync);
        if (entry.buffer) gl.deleteBuffer(entry.buffer);
        if (entry.sharedConversion) sharedHelper(entry.sharedConversionTarget??2).releaseScratch(entry.sharedConversion);
        if (entry.floatingDepthConversion) floatingDepthHelper().releaseScratch(entry.floatingDepthConversion);
        if (entry.dimensionalDepthConversion) dimensionalDepthAccess.release(entry.dimensionalDepthConversion);
      };
      const backend = {
        ...(dimensionalDepth ? { dimensionalDepthProfile: STANDARD_DIMENSIONAL_DEPTH_TRANSFER_PROFILE } : {}),
        ...(dimensionalViews ? { dimensionalViewProfile: STANDARD_DIMENSIONAL_VIEW_TRANSFER_PROFILE } : {}),
        ...(dimensionalDepthViews ? { dimensionalDepthViewProfile: STANDARD_DIMENSIONAL_DEPTH_VIEW_TRANSFER_PROFILE } : {}),
        ...(dimensional ? { dimensionalProfile: STANDARD_DIMENSIONAL_TRANSFER_PROFILE,
          maxTexture3DSize: dimensionalAccess.nativeLimits.texture3DSize, maxCubeTextureSize: dimensionalAccess.nativeLimits.cubeTextureSize,
          maxArrayLayers: dimensionalAccess.nativeLimits.arrayLayers } : {}),
        maxTextureSize, ...(colors ? { colorProfile: STANDARD_COLOR_TRANSFER_PROFILE } : {}), ...(floats ? { floatProfile: STANDARD_FLOAT_COLOR_TRANSFER_PROFILE } : {}), ...(packed ? { packedFloatProfile: STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE } : {}), ...(shared ? { sharedExponentProfile: STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE } : {}), ...(integers ? { integerProfile: STANDARD_INTEGER_COLOR_TRANSFER_PROFILE } : {}), ...(normalized ? { packedNormalizedProfile: STANDARD_PACKED_NORMALIZED_TRANSFER_PROFILE } : {}), ...(unsigned ? { packedUnsignedProfile: STANDARD_PACKED_UNSIGNED_TRANSFER_PROFILE } : {}), ...(floatingDepth ? { floatingDepthProfile: STANDARD_FLOATING_DEPTH_TRANSFER_PROFILE } : {}), ...(unormDepth ? { unormDepthProfile: STANDARD_UNORM_DEPTH_TRANSFER_PROFILE } : {}), ...(packedDepth ? { packedDepthProfile: STANDARD_PACKED_DEPTH_TRANSFER_PROFILE } : {}),
        allocate(meta) {
          check();
          let storage = null;
          try {
            if (production && meta.nrSamples) {
              const internal = colorFormat(meta).internal;
              require(Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, internal, gl.SAMPLES)).includes(meta.nrSamples),
                "unsupported-resource", "Native format does not support the selected sample count.");
              const previous = gl.getParameter(gl.RENDERBUFFER_BINDING), renderbuffer = gl.createRenderbuffer();
              require(renderbuffer, "backend-error", "Native sample allocation failed.");
              storage = Object.freeze({kind:"renderbuffer",renderbuffer});
              try { gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);gl.renderbufferStorageMultisample(gl.RENDERBUFFER, meta.nrSamples, internal, meta.width, meta.height);check(); }
              finally {gl.bindRenderbuffer(gl.RENDERBUFFER, previous);}
            }
            else if (dimensionalDepth && meta.kind === "dimensional-depth-texture") storage = dimensionalDepthAccess.allocate(meta);
            else if (dimensional && meta.kind === "dimensional-texture") {
              storage = dimensionalAccess.allocate(meta);
              if (meta.sharedCopyScratchBytes) storage = {...storage,sharedCopyScratch:sharedHelper(meta.target).createScratch(meta.width,meta.height,true),sharedCopyScratchTarget:meta.target};
            }
            else if (meta.kind === "texture" || meta.kind === "mip-texture" || meta.kind === "depth-texture" || meta.kind === "mip-depth-texture") {
              if (meta.format === 16 || shared && sharedExponentColorFormat(meta.format) || floatingDepth && floatingDepthFormat(meta.format) || packedDepth && packedDepthFormat(meta.format)) require(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision >= 23,
                "unsupported-resource", "Faithful UN16 reconstruction requires highp binary32 shader precision.");
              const texture = gl.createTexture();
              require(texture !== null, "backend-error", "WebGL texture allocation failed.");
              storage = { kind: "texture", texture };
              gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
              gl.texStorage2D(gl.TEXTURE_2D, meta.lastLevel + 1, colorFormat(meta).internal, meta.width, meta.height);
              if (colors) check();
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
              if (floatingDepth && floatingDepthFormat(meta.format)?.stencil) {
                storage.depthUploadBuffer = gl.createBuffer();
                require(storage.depthUploadBuffer, "backend-error", "Floating depth upload buffer allocation failed.");
                const previous = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
                try { gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, storage.depthUploadBuffer); gl.bufferData(gl.PIXEL_UNPACK_BUFFER, meta.byteLength, gl.DYNAMIC_DRAW); check(); }
                finally { gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, previous); }
              }
              // RGB8 has implicit alpha one. RGB10_A2 needs actual stored A=3,
              // then the state executor masks destination alpha writes.
              if (meta.format === 233 || colors && ownedColorFormat(meta)?.implicitAlpha && !ownedColorFormat(meta).sharedExponent && (ownedColorFormat(meta).packedNormalized && ownedColorFormat(meta).fields[3].bits !== 0 || ownedColorFormat(meta).nativePixelBytes === 4 * (ownedColorFormat(meta).precision ?? ownedColorFormat(meta).integerBits ?? 8) / 8)) for (let level = 0; level <= meta.lastLevel; level++) initializeXAlpha(texture, level, ownedColorFormat(meta));
              if (meta.sharedCopyScratchBytes) storage.sharedCopyScratch = sharedHelper().createScratch(meta.width, meta.height, true);
              storage = Object.freeze(storage);
            } else {
              const buffer = gl.createBuffer();
              require(buffer !== null, "backend-error", "WebGL buffer allocation failed.");
              storage = Object.freeze({ kind: "buffer", buffer });
              // First bind defines WebGL's permanent element/other-data class.
              gl.bindVertexArray(vao);
              const target = meta.kind === "index-buffer" ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
              gl.bindBuffer(target, buffer); gl.bufferData(target, meta.byteLength, gl.DYNAMIC_DRAW);
              gl.bindBuffer(target, null); gl.bindVertexArray(null);
            }
            check(); allocations.add(storage); return storage;
          } catch (error) {
            if (storage?.kind === "renderbuffer") gl.deleteRenderbuffer(storage.renderbuffer);
            else if (storage?.kind === "texture") { gl.deleteTexture(storage.texture); if (storage.depthUploadBuffer) gl.deleteBuffer(storage.depthUploadBuffer); if (storage.sharedCopyScratch) sharedHelper(storage.sharedCopyScratchTarget??2).releaseScratch(storage.sharedCopyScratch); }
            else if (storage) gl.deleteBuffer(storage.buffer);
            throw error;
          }
        },
        destroy,
        copyTextureRange(source, destination, meta, firstLevel, firstLayer = 0) {
          check();
          if (dimensionalDepthViews && meta.kind === "dimensional-depth-texture") {
            for (const level of meta.levels) for (let layer = 0; layer < level.layers; layer++)
              floatingDepthHelper().copyRegion(source.texture, destination.texture, selectedDepthFormat(meta.format).stencil,
                firstLevel + level.level, level.level, { x: 0, y: 0, width: level.width, height: level.height },
                source.target, firstLayer + layer, destination.target, layer);
            return;
          }
          if (production && meta.kind === "dimensional-texture" && meta.sharedExponent) {
            sharedHelper(meta.target).copy(destination.sharedCopyScratch,source.texture,destination.texture,firstLevel,meta.levels,firstLayer); return;
          }
          if (dimensionalViews && meta.kind === "dimensional-texture") {
            copyDimensionalTextureRange(gl, source, destination, meta, firstLevel, firstLayer, check, require);
            return;
          }
          if (selectedDepthFormat(meta.format)) {
            for (const level of meta.levels) floatingDepthHelper().copyRegion(source.texture, destination.texture, selectedDepthFormat(meta.format).stencil,
              firstLevel + level.level, level.level, { x: 0, y: 0, width: level.width, height: level.height });
            return;
          }
          if (shared && sharedExponentColorFormat(meta.format)) {
            sharedHelper().copy(destination.sharedCopyScratch, source.texture, destination.texture, firstLevel, meta.levels);
            return;
          }
          const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
          const scissor = gl.isEnabled(gl.SCISSOR_TEST);
          let destinationFramebuffer = null, attached = false;
          try {
            destinationFramebuffer = gl.createFramebuffer();
            require(destinationFramebuffer, "backend-error", "Image copy framebuffer allocation failed.");
            gl.disable(gl.SCISSOR_TEST);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destinationFramebuffer); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer); gl.readBuffer(gl.COLOR_ATTACHMENT0); attached = true;
            for (const level of meta.levels) {
              gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source.texture, firstLevel + level.level);
              gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, destination.texture, level.level);
              require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE &&
                gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
              "backend-error", "Image copy framebuffer is incomplete.");
              // Matching normalized formats and identical extents preserve every
              // original texel, including RGB10_A2, through a native GPU blit.
              gl.blitFramebuffer(0, 0, level.width, level.height, 0, 0, level.width, level.height, gl.COLOR_BUFFER_BIT, gl.NEAREST); check();
            }
          } finally {
            if (attached) gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
            if (destinationFramebuffer) gl.deleteFramebuffer(destinationFramebuffer);
            if (scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
          }
        },
        upload(storage, meta, layout, bytes) {
          check(); pixelState();
          if (storage.kind === "buffer") {
            gl.bindBuffer(gl.COPY_WRITE_BUFFER, storage.buffer);
            gl.bufferSubData(gl.COPY_WRITE_BUFFER, layout.box.x, bytes);
          } else if (storage.dimensionalDepth) dimensionalDepthAccess.upload(storage, meta, layout, nativeUpload(meta.format, bytes));
          else if (storage.dimensional) dimensionalAccess.upload(storage, layout, bytes, meta);
          else {
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, storage.texture);
            const profile = colorFormat(meta);
            const native = nativeUpload(meta.format, bytes);
            if (floatingDepth && floatingDepthFormat(meta.format)?.stencil) {
              // WebGL forbids packed depth/stencil ArrayBufferView uploads. The
              // persistent, precharged PBO selects its distinct numeric offset.
              gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, storage.depthUploadBuffer);
              try {
                gl.bufferSubData(gl.PIXEL_UNPACK_BUFFER, 0, native);
                gl.texSubImage2D(gl.TEXTURE_2D, layout.level ?? 0, layout.box.x, layout.box.y, layout.box.width, layout.box.height, profile.upload, profile.type, 0);
              } finally { gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); }
            } else gl.texSubImage2D(gl.TEXTURE_2D, layout.level ?? 0, layout.box.x, layout.box.y, layout.box.width, layout.box.height,
              profile.upload, profile.type, native);
          }
          check();
        },
        readback(storage, meta, layout) {
          check(); pixelState();
          const bytes = new Uint8Array(scratchCharge(layout));
          if (storage.kind === "buffer") {
            gl.bindBuffer(gl.COPY_READ_BUFFER, storage.buffer);
            gl.getBufferSubData(gl.COPY_READ_BUFFER, layout.box.x, bytes);
          } else if (storage.dimensionalDepth) {
            let converted = null;
            try { converted = dimensionalDepthAccess.createConversion(meta, layout); dimensionalDepthAccess.read(converted, storage, meta, layout, bytes); }
            finally { if (converted) dimensionalDepthAccess.release(converted); }
          } else if (storage.dimensional && meta.sharedExponent) {
            const helper=sharedHelper(meta.target),pair=helper.createScratch(layout.box.width,layout.box.height);
            try { for(let layer=0;layer<layout.layerCount;layer++) {
              helper.pack(pair,storage.texture,layout.level,layout.box,layout.box.z+layer);
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pair.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);
              require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,"backend-error","Dimensional shared read framebuffer is incomplete");
              const n=layout.rowBytes*layout.rowCount;gl.readPixels(0,0,layout.box.width,layout.box.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes.subarray(layer*n,(layer+1)*n));
            } } finally {gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);helper.releaseScratch(pair);}
          } else if (storage.dimensional) dimensionalAccess.read(storage, layout, bytes);
          else if (selectedDepthFormat(meta.format)) {
            let converted = null;
            try { converted = floatingDepthConversion(storage, meta, layout); floatingDepthHelper().read(converted, bytes); }
            finally { if (converted) floatingDepthHelper().releaseScratch(converted); }
          } else if (shared && sharedExponentColorFormat(meta.format)) {
            let converted = null;
            try {
              converted = sharedConversion(storage, layout);
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
              gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, converted.texture, 0); gl.readBuffer(gl.COLOR_ATTACHMENT0);
              require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Shared exponent readback framebuffer is incomplete.");
              gl.readPixels(0, 0, layout.box.width, layout.box.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            } finally {
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
              if (converted) sharedHelper().releaseScratch(converted);
            }
          } else if (meta.format === 16) {
            let converted = null;
            try {
              converted = packDepth(storage, layout.box);
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer); gl.readBuffer(gl.COLOR_ATTACHMENT0);
              gl.readPixels(0, 0, layout.box.width, layout.box.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            } finally {
              if (converted) {
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
                gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
                gl.deleteTexture(converted);
              }
            }
          } else {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
            try {
              gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, storage.texture, layout.level ?? 0);
              gl.readBuffer(gl.COLOR_ATTACHMENT0);
              require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Transfer framebuffer is incomplete.");
              const profile = colorFormat(meta);
              const integer = (integers ? integerColorFormat(meta.format) : null) || (unsigned ? packedUnsignedColorFormat(meta.format) : null);
              const destination = integer ? integer.signed ? new Int32Array(bytes.buffer) : new Uint32Array(bytes.buffer) : (floats && floatColorFormat(meta.format) || packed && packedFloatColorFormat(meta.format)) ? new Float32Array(bytes.buffer) : meta.format === 233 || normalized && packedNormalizedColorFormat(meta.format)?.pixelBytes === 4 ? new Uint32Array(bytes.buffer) : colors && byteColorFormat(meta.format)?.snorm ? new Int8Array(bytes.buffer) : bytes;
              gl.readPixels(layout.box.x, layout.box.y, layout.box.width, layout.box.height, profile.readFormat ?? gl.RGBA, profile.readType ?? profile.type, destination);
            } finally {
              gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
            }
          }
          check(); return rawBufferReadbacks && storage.kind === "buffer" ? bytes : guestReadback(meta.format, bytes, layout.nativeReadBytes ?? bytes.length);
        },
        beginReadback(storage, meta, layout) {
          check(); pixelState();
          const entry = { buffer: null, sync: null, ready: false, bytes: layout.nativeReadBytes ?? scratchCharge(layout), scratchBytes: scratchCharge(layout), format: meta.format, ...(rawBufferReadbacks ? { rawBuffer: storage.kind === "buffer" } : {}) };
          pendingReads.add(entry);
          try {
            entry.buffer = gl.createBuffer();
            require(entry.buffer, "backend-error", "Readback staging allocation failed.");
            if (storage.kind === "texture") {
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, entry.buffer);
              gl.bufferData(gl.PIXEL_PACK_BUFFER, entry.bytes, gl.STREAM_READ);
              let converted = null;
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
              try {
                if (storage.dimensionalDepth) {
                  entry.dimensionalDepthConversion = dimensionalDepthAccess.createConversion(meta, layout);
                  dimensionalDepthAccess.read(entry.dimensionalDepthConversion, storage, meta, layout);
                } else if (storage.dimensional && meta.sharedExponent) {
                  const helper=sharedHelper(meta.target), pair=helper.createScratch(layout.box.width,layout.box.height);
                  entry.sharedConversion=pair; entry.sharedConversionTarget=meta.target;
                  for(let layer=0;layer<layout.layerCount;layer++) {
                    helper.pack(pair,storage.texture,layout.level,layout.box,layout.box.z+layer);
                    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pair.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);
                    require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,"backend-error","Dimensional shared read framebuffer is incomplete");
                    gl.readPixels(0,0,layout.box.width,layout.box.height,gl.RGBA,gl.UNSIGNED_BYTE,layer*layout.rowBytes*layout.rowCount);
                  }
                } else if (storage.dimensional) dimensionalAccess.read(storage, layout);
                else if (selectedDepthFormat(meta.format)) {
                  entry.floatingDepthConversion = floatingDepthConversion(storage, meta, layout);
                  floatingDepthHelper().read(entry.floatingDepthConversion, null);
                } else {
                  if (meta.format === 16) converted = packDepth(storage, layout.box);
                  if (shared && sharedExponentColorFormat(meta.format)) { entry.sharedConversion = sharedConversion(storage, layout); converted = entry.sharedConversion.texture; }
                  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
                  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, converted ?? storage.texture, converted ? 0 : layout.level ?? 0);
                  gl.readBuffer(gl.COLOR_ATTACHMENT0);
                  require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Readback framebuffer is incomplete.");
                  // Numeric offset selects the PBO overload: no CPU destination here.
                  gl.readPixels(converted ? 0 : layout.box.x, converted ? 0 : layout.box.y, layout.box.width, layout.box.height,
                    converted ? gl.RGBA : colorFormat(meta).readFormat ?? gl.RGBA, converted ? gl.UNSIGNED_BYTE : colorFormat(meta).readType ?? colorFormat(meta).type, 0);
                }
              } finally {
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                if (converted && !entry.sharedConversion) gl.deleteTexture(converted);
              }
            } else {
              // WebGL forbids copies across element-array/other-data classes.
              gl.bindVertexArray(vao);
              const target = meta.kind === "index-buffer" ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
              // Chrome 154/ANGLE reports a deferred type error for EAB *_READ staging.
              // COPY is a legal usage hint for this GPU copy; retain strict GL checks.
              gl.bindBuffer(target, entry.buffer); gl.bufferData(target, layout.tightBytes, gl.DYNAMIC_COPY);
              gl.bindBuffer(target, null); gl.bindVertexArray(null);
              gl.bindBuffer(gl.COPY_READ_BUFFER, storage.buffer);
              gl.bindBuffer(gl.COPY_WRITE_BUFFER, entry.buffer);
              gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, layout.box.x, 0, layout.tightBytes);
            }
            entry.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            require(entry.sync, "backend-error", "Readback fence allocation failed.");
            gl.flush(); check(); return entry;
          } catch (error) { releaseReadback(entry); throw error; }
        },
        pollReadback(entry) {
          check(); require(pendingReads.has(entry), "backend-error", "Unknown staged readback.");
          if (!entry.ready) {
            const status = gl.clientWaitSync(entry.sync, 0, 0);
            require(status === gl.TIMEOUT_EXPIRED || status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED,
              "backend-error", "Readback fence wait failed.");
            entry.ready = status !== gl.TIMEOUT_EXPIRED; check();
          }
          return entry.ready;
        },
        collectReadback(entry) {
          check(); require(pendingReads.has(entry) && entry.ready, "backend-error", "Readback fence has not signaled.");
          const bytes = new Uint8Array(entry.scratchBytes);
          gl.bindBuffer(gl.COPY_READ_BUFFER, entry.buffer);
          gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes.subarray(0, entry.bytes)); check(); return entry.rawBuffer ? bytes : guestReadback(entry.format, bytes, entry.bytes);
        },
        releaseReadback,
        dispose() {
          if (disposed) return;
          for (const entry of [...pendingReads]) releaseReadback(entry);
          for (const storage of [...allocations]) destroy(storage);
          if (depthProgram) {
            if (gl.getParameter(gl.CURRENT_PROGRAM) === depthProgram.program) gl.useProgram(null);
            gl.deleteProgram(depthProgram.program);
          }
          if (sharedPacker) sharedPacker.dispose();
          for(const helper of dimensionalSharedPackers.values())helper.dispose();dimensionalSharedPackers.clear();
          if (dimensionalDepthAccess) dimensionalDepthAccess.dispose();
          if (floatingDepthPacker) floatingDepthPacker.dispose();
          gl.deleteVertexArray(vao); gl.deleteFramebuffer(framebuffer); disposed = true;
        },
      };
      return success({ backend: Object.freeze(backend) });
    } catch (error) {
      if (vao) gl.deleteVertexArray(vao);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (error instanceof ResourceFault) throw error;
      throw new ResourceFault("backend-error", "WebGL backend initialization failed.");
    }
  });
}
