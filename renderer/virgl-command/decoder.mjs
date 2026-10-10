/** Bounded, side-effect-free VirGL 1.3.0 wire decoding. See README.md. */
export const PROFILE = "virgl-tiny-commands-v1";
export const STANDARD_PROFILE = "virgl-standard-commands-v1";
export const LIMITS = Object.freeze({
  submissionBytes: 262144,
  commands: 4096,
  shaderTextBytes: 49152,
  shaderTokens: 8192,
  vertexElements: 16,
  vertexBuffers: 16,
  samplerSlots: 32,
  constantSlots: 15,
  constantWords: 184,
  vertexConstantWords: 512,
  shaderBufferSlots: 16,
  imageSlots: 32,
  atomicBufferSlots: 16,
});
export const STANDARD_LIMITS = Object.freeze({ ...LIMITS, constantWords: 2048, vertexConstantWords: 2048 });

// Original pinned VirGL enums. Descriptors are shared by wire admission,
// native pointers, actual fetch bounds and retained stride-zero reads.
const FLOATING_VERTEX_FORMATS = Object.freeze(Object.fromEntries([
  [28, 4, "FLOAT", "float"], [32, 4, "UNSIGNED_INT", "unorm"],
  [36, 4, "UNSIGNED_INT", "uscaled"], [40, 4, "INT", "snorm"],
  [44, 4, "INT", "sscaled"], [48, 2, "UNSIGNED_SHORT", "unorm"],
  [52, 2, "UNSIGNED_SHORT", "uscaled"], [56, 2, "SHORT", "snorm"],
  [60, 2, "SHORT", "sscaled"], [64, 1, "UNSIGNED_BYTE", "unorm"],
  [69, 1, "UNSIGNED_BYTE", "uscaled"], [74, 1, "BYTE", "snorm"],
  [82, 1, "BYTE", "sscaled"], [91, 2, "HALF_FLOAT", "half"],
].flatMap(([base, scalarBytes, type, kind]) => Array.from({ length: 4 }, (_, lane) => {
  const format = base + lane, components = lane + 1;
  return [format, Object.freeze({ format, components, scalarBytes,
    elementBytes: components * scalarBytes, type, kind, normalized: kind === "unorm" || kind === "snorm" })];
}))));
export const floatingVertexFormat = format => Number.isInteger(format) && Object.hasOwn(FLOATING_VERTEX_FORMATS, format) ? FLOATING_VERTEX_FORMATS[format] : null;
const INTEGER_VERTEX_FORMATS = Object.freeze(Object.fromEntries([
  [177, 1, "UNSIGNED_BYTE", "uint"], [181, 1, "BYTE", "sint"],
  [185, 2, "UNSIGNED_SHORT", "uint"], [189, 2, "SHORT", "sint"],
  [193, 4, "UNSIGNED_INT", "uint"], [197, 4, "INT", "sint"],
].flatMap(([base, scalarBytes, type, kind]) => Array.from({ length: 4 }, (_, lane) => {
  const format = base + lane, components = lane + 1;
  return [format, Object.freeze({ format, components, scalarBytes,
    elementBytes: components * scalarBytes, type, kind, normalized: false, integer: true })];
}))));
const PACKED_VERTEX_FORMATS = Object.freeze(Object.fromEntries([
  [8, "UNSIGNED_INT_2_10_10_10_REV", "unorm"], [123, "UNSIGNED_INT_2_10_10_10_REV", "uscaled"],
  [172, "INT_2_10_10_10_REV", "sscaled"], [173, "INT_2_10_10_10_REV", "snorm"],
].map(([format, type, kind]) => [format, Object.freeze({ format, components: 4, scalarBytes: 4,
  elementBytes: 4, type, kind, normalized: kind === "unorm" || kind === "snorm", packed: true })])));
export const vertexFormat = format => floatingVertexFormat(format) ??
  (Number.isInteger(format) && Object.hasOwn(INTEGER_VERTEX_FORMATS, format) ? INTEGER_VERTEX_FORMATS[format] :
    Number.isInteger(format) && Object.hasOwn(PACKED_VERTEX_FORMATS, format) ? PACKED_VERTEX_FORMATS[format] : null);

const COMMAND_NAMES = Object.freeze({
  1: "CREATE_OBJECT", 2: "BIND_OBJECT", 3: "DESTROY_OBJECT",
  4: "SET_VIEWPORT_STATE", 5: "SET_FRAMEBUFFER_STATE", 6: "SET_VERTEX_BUFFERS",
  7: "CLEAR", 8: "DRAW_VBO", 9: "RESOURCE_INLINE_WRITE", 10: "SET_SAMPLER_VIEWS", 11: "SET_INDEX_BUFFER",
  12: "SET_CONSTANT_BUFFER", 13: "SET_STENCIL_REF", 14: "SET_BLEND_COLOR",
  15: "SET_SCISSOR_STATE",
  18: "BIND_SAMPLER_STATES", 22: "SET_POLYGON_STIPPLE", 24: "SET_SAMPLE_MASK",
  25: "SET_STREAMOUT_TARGETS", 28: "SET_SUB_CTX", 29: "CREATE_SUB_CTX",
  30: "DESTROY_SUB_CTX", 31: "BIND_SHADER", 32: "SET_TESS_STATE",
  33: "SET_MIN_SAMPLES", 34: "SET_SHADER_BUFFERS", 35: "SET_SHADER_IMAGES",
  38: "SET_FRAMEBUFFER_STATE_NO_ATTACH", 40: "SET_ATOMIC_BUFFERS",
  43: "TRANSFER3D", 44: "END_TRANSFERS", 45: "COPY_TRANSFER3D",
  46: "SET_TWEAKS", 52: "LINK_SHADER",
});
const OBJECT_NAMES = Object.freeze([
  "NULL", "BLEND", "RASTERIZER", "DSA", "SHADER", "VERTEX_ELEMENTS",
  "SAMPLER_VIEW", "SAMPLER_STATE", "SURFACE",
]);
const STAGE_NAMES = Object.freeze(["vertex", "fragment", "geometry", "tessControl", "tessEvaluation", "compute"]);
const MAX_U32 = 0xffffffff;
const MAX_I32 = 0x7fffffff;
// Pinned pipe_blendfactor values. Dual-source factors remain outside this profile.
const BLEND_FACTORS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 23, 24]);

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function failure(code, message, byteOffset = 0, opcode = null) {
  return freeze({ ok: false, error: { code, message, byteOffset, opcode } });
}
class DecodeFault extends Error {
  constructor(code, message, byteOffset, opcode) {
    super(message);
    this.result = failure(code, message, byteOffset, opcode);
  }
}

/** Indexes in Packet match the pinned protocol: header=0, first payload word=1. */
class Packet {
  constructor(view, byteOffset, opcode, length, standard = false) {
    this.view = view;
    this.byteOffset = byteOffset;
    this.opcode = opcode;
    this.length = length;
    this.standard = standard;
  }
  fail(code, message) { throw new DecodeFault(code, message, this.byteOffset, this.opcode); }
  require(condition, code, message) { if (!condition) this.fail(code, message); }
  exact(length) { this.require(this.length === length, "payload-length", `Expected ${length} payload dwords.`); }
  atLeast(length) { this.require(this.length >= length, "payload-length", `Expected at least ${length} payload dwords.`); }
  u(index) {
    // A programming error here must never silently read the next packet.
    this.require(index >= 1 && index <= this.length, "payload-length", "Field exceeds packet payload.");
    return this.view.getUint32(this.byteOffset + index * 4, true);
  }
  i(index) { return this.u(index) | 0; }
  f(index) {
    this.u(index);
    const value = this.view.getFloat32(this.byteOffset + index * 4, true);
    this.require(Number.isFinite(value), "invalid-value", "Non-finite float field.");
    return value;
  }
  words(start, count) { return Array.from({ length: count }, (_, i) => this.u(start + i)); }
  floats(start, count) { return Array.from({ length: count }, (_, i) => this.f(start + i)); }
  zero(start, count, message) {
    for (let i = 0; i < count; i++) this.require(this.u(start + i) === 0, "unsupported-feature", message);
  }
  handle(index) {
    const value = this.u(index);
    this.require(value !== 0, "invalid-value", "A nonzero handle is required.");
    return value;
  }
  stage(index) {
    const value = this.u(index);
    this.require(value < STAGE_NAMES.length, "invalid-enum", "Unknown shader stage.");
    return value;
  }
  boolean(index) {
    const value = this.u(index);
    this.require(value <= 1, "invalid-value", "Boolean field must be zero or one.");
    return value === 1;
  }
  mask(value, allowed) { this.require((value & ~allowed) === 0, "invalid-value", "Reserved flag bits must be zero."); }
  arrayCount(prefix, width, maximum) {
    this.atLeast(prefix);
    this.require((this.length - prefix) % width === 0, "payload-length", "Partial array element.");
    const count = (this.length - prefix) / width;
    this.require(count <= maximum, "limit-exceeded", "Array exceeds profile count limit.");
    return count;
  }
  slotRange(start, count, maximum) {
    this.require(start <= maximum && count <= maximum - start, "limit-exceeded", "Array slot range exceeds profile limit.");
  }
}

function decodeBlend(p, handle) {
  p.exact(11);
  const bits = p.u(2);
  p.mask(bits, 31);
  p.mask(p.u(3), 15);
  p.require((bits & ~4) === 0 && p.u(3) === 0, "unsupported-feature", "Only optional dithering and RT0 blending are supported.");
  const renderTargets = Array.from({ length: 8 }, (_, index) => {
    const word = p.u(4 + index);
    p.mask(word, 0x7fffffff);
    const rt = {
      blendEnable: Boolean(word & 1), rgbFunction: (word >>> 1) & 7,
      rgbSourceFactor: (word >>> 4) & 31, rgbDestinationFactor: (word >>> 9) & 31,
      alphaFunction: (word >>> 14) & 7, alphaSourceFactor: (word >>> 17) & 31,
      alphaDestinationFactor: (word >>> 22) & 31, colorMask: (word >>> 27) & 15,
    };
    if (index > 0) p.require(word === 0, "unsupported-feature", "Only RT0 may carry blend state.");
    else {
      p.require(rt.rgbFunction <= 4 && rt.alphaFunction <= 4,
        "unsupported-feature", "Unknown blend equation.");
      for (const [factor, source] of [[rt.rgbSourceFactor, true], [rt.rgbDestinationFactor, false],
        [rt.alphaSourceFactor, true], [rt.alphaDestinationFactor, false]]) {
        p.require((!rt.blendEnable && factor === 0) || BLEND_FACTORS.has(factor) && (source || factor !== 6),
          "unsupported-feature", "Unknown, dual-source or invalid destination blend factor.");
      }
    }
    return rt;
  });
  return { handle, independentBlendEnable: false, logicopEnable: false, dither: Boolean(bits & 4),
    alphaToCoverage: false, alphaToOne: false, logicopFunction: 0, renderTargets };
}

function decodeRasterizer(p, handle) {
  p.exact(9);
  const bits = p.u(2);
  // The selected standard facet binds fixed/per-vertex native point size.
  // Generic sprite-coordinate replacement remains outside this boundary.
  const allowed = 2 | 64 | 128 | (3 << 8) | (1 << 14) | (1 << 15) | (1 << 29) | (1 << 30) | (p.standard ? 1 << 24 : 0);
  p.require((bits & ~allowed) === 0 && (bits & 2) !== 0 && (bits & (1 << 29)) !== 0,
    "unsupported-feature", "Unsupported rasterizer feature or coordinate convention.");
  const cullFace = (bits >>> 8) & 3;
  p.require(cullFace === 0 || cullFace === 2, "unsupported-feature", "Only no culling or back-face culling is supported.");
  const pointSize = p.f(3), spriteCoordEnable = p.u(4), stipple = p.u(5), lineWidth = p.f(6);
  const offsetUnits = p.f(7), offsetScale = p.f(8), offsetClamp = p.f(9);
  p.require((p.standard ? Number.isFinite(pointSize) && pointSize > 0 : pointSize === 1) && spriteCoordEnable === 0 && stipple === 0xffff && lineWidth === 1 &&
    offsetUnits === 0 && offsetScale === 0 && offsetClamp === 0,
  "unsupported-feature", "Unsupported point, line, clip or polygon-offset state.");
  return { handle, flatshade: false, depthClip: true, clipHalfZ: false, rasterizerDiscard: false,
    flatshadeFirst: false, lightTwoSide: false, spriteCoordMode: Boolean(bits & 64),
    pointQuadRasterization: Boolean(bits & 128), cullFace, fillFront: 0, fillBack: 0,
    scissor: Boolean(bits & (1 << 14)), frontCcw: Boolean(bits & (1 << 15)),
    clampVertexColor: false, clampFragmentColor: false, offsetLine: false, offsetPoint: false,
    offsetTri: false, polygonSmooth: false, polygonStippleEnable: false, pointSmooth: false,
    pointSizePerVertex: Boolean(bits & (1 << 24)), multisample: false, lineSmooth: false, lineStippleEnable: false,
    lineLastPixel: false, halfPixelCenter: true, bottomEdgeRule: Boolean(bits & (1 << 30)), forcePerSampleInterpolation: false,
    pointSize, spriteCoordEnable, lineStipplePattern: 0xffff, lineStippleFactor: 0,
    clipPlaneEnable: 0, lineWidth, offsetUnits, offsetScale, offsetClamp };
}

function decodeDsa(p, handle) {
  p.exact(5);
  p.mask(p.u(2), 0xf1f);
  p.mask(p.u(3), 0x1fffffff);
  p.mask(p.u(4), 0x1fffffff);
  const alphaReference = p.f(5);
  const depth = p.u(2);
  p.require((depth & ~31) === 0, "unsupported-feature", "Alpha testing is outside this profile.");
  p.zero(3, 2, "Stencil testing requires unsupported stencil storage.");
  p.require(alphaReference === 0, "unsupported-feature", "Inactive alpha reference must be zero.");
  const stencil = () => ({ enabled: false, function: 0, failOperation: 0, depthPassOperation: 0,
    depthFailOperation: 0, valueMask: 0, writeMask: 0 });
  return { handle, depthEnable: Boolean(depth & 1), depthWriteMask: Boolean(depth & 2), depthFunction: (depth >>> 2) & 7,
    alphaEnable: false, alphaFunction: 0, alphaReference, stencil: [stencil(), stencil()] };
}

function decodeShader(p, handle) {
  p.atLeast(5);
  const stage = p.stage(2), offset = p.u(3), tokenCount = p.u(4), streamOutputCount = p.u(5);
  p.require(stage <= 1, "unsupported-feature", "Only vertex and fragment shader creation is supported.");
  p.require((offset & 0x80000000) === 0, "unsupported-feature", "Shader continuations are unsupported.");
  p.require(streamOutputCount === 0, "unsupported-feature", "Shader stream output is unsupported.");
  const declaredTextBytes = offset;
  p.require(declaredTextBytes >= 2, "invalid-value", "Shader text must include text and its terminal NUL.");
  p.require(declaredTextBytes <= LIMITS.shaderTextBytes + 1 && tokenCount >= 1 && tokenCount <= LIMITS.shaderTokens,
    "limit-exceeded", "Shader text or token count exceeds profile limits.");
  p.exact(5 + Math.ceil(declaredTextBytes / 4));
  const start = p.byteOffset + 24;
  let text = "";
  for (let index = 0; index < declaredTextBytes - 1; index++) {
    const byte = p.view.getUint8(start + index);
    p.require(byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126),
      "invalid-value", "Shader text must be printable ASCII without embedded NUL.");
    text += String.fromCharCode(byte);
  }
  for (let index = declaredTextBytes - 1; index < (p.length - 5) * 4; index++) {
    p.require(p.view.getUint8(start + index) === 0, "invalid-value", "Shader terminal NUL and alignment padding must be zero.");
  }
  return { handle, stage, stageName: STAGE_NAMES[stage], declaredTextBytes, tokenCount, streamOutputCount, text };
}

function decodeSamplerState(p, handle) {
  p.exact(9);
  const bits = p.u(2);
  p.mask(bits, 0x01ffbbff); // bit 10 and bit 14 are reserved in the pinned header.
  const wrapS = bits & 7, wrapT = (bits >>> 3) & 7, wrapR = (bits >>> 6) & 7;
  const minImageFilter = (bits >>> 9) & 1, minMipFilter = (bits >>> 11) & 3, magImageFilter = (bits >>> 13) & 1;
  const compareMode = (bits >>> 15) & 1, compareFunction = (bits >>> 16) & 7;
  const seamlessCubeMap = Boolean(bits & (1 << 19)), maxAnisotropy = (bits >>> 20) & 31;
  p.require(wrapS === 2 && wrapT === 2 && [0, 2].includes(wrapR) && minMipFilter === 2 &&
    compareMode === 0 && maxAnisotropy === 0, "unsupported-feature", "Only clamp-edge 2D nearest/linear non-mip samplers are supported.");
  const lodBias = p.f(3), minLod = p.f(4), maxLod = p.f(5), borderColor = p.words(6, 4);
  p.require(lodBias === 0 && minLod === 0 && maxLod >= 0, "unsupported-feature", "Unsupported sampler LOD state.");
  p.zero(6, 4, "Inactive sampler border color must be zero.");
  return { handle, wrapS, wrapT, wrapR, minImageFilter, minMipFilter, magImageFilter,
    compareMode, compareFunction, seamlessCubeMap, maxAnisotropy, lodBias, minLod, maxLod, borderColor };
}

function decodeObject(p, objectType) {
  p.atLeast(1);
  const handle = p.handle(1);
  switch (objectType) {
    case 1: return decodeBlend(p, handle);
    case 2: return decodeRasterizer(p, handle);
    case 3: return decodeDsa(p, handle);
    case 4: return decodeShader(p, handle);
    case 5: {
      const count = p.arrayCount(1, 4, LIMITS.vertexElements);
      const elements = Array.from({ length: count }, (_, index) => {
        const start = 2 + index * 4;
        const sourceOffset = p.u(start), instanceDivisor = p.u(start + 1), vertexBufferIndex = p.u(start + 2), sourceFormat = p.u(start + 3);
        p.require(vertexBufferIndex < LIMITS.vertexBuffers, "limit-exceeded", "Vertex buffer index exceeds profile limit.");
        const format = vertexFormat(sourceFormat);
        p.require(p.standard ? format !== null : instanceDivisor === 0 && [28, 29, 30, 31].includes(sourceFormat), "unsupported-feature",
          p.standard ? "Unsupported standard vertex format." : "Only per-vertex R32 through RGBA32_FLOAT elements are supported.");
        // Standard alignment is checked on the effective buffer+element offset,
        // so individually unaligned offsets may sum to a valid native pointer.
        p.require((p.standard || sourceOffset % 4 === 0) && sourceOffset <= MAX_U32 - format.elementBytes,
          "invalid-value", p.standard ? "Vertex element end must fit u32." : "Vertex element offset must be float-aligned and its end must fit u32.");
        return { sourceOffset, instanceDivisor, vertexBufferIndex, sourceFormat };
      });
      return { handle, elements };
    }
    case 6: {
      p.exact(6);
      const resourceHandle = p.handle(2), packedFormat = p.u(3), format = packedFormat & 0xffffff, target = packedFormat >>> 24;
      p.require([2, 67, 233].includes(format) && target === 2, "unsupported-feature", "Only required normalized color 2D sampler views are supported.");
      p.zero(4, 2, "Only level zero, layer zero sampler views are supported.");
      const packedSwizzle = p.u(6);
      p.mask(packedSwizzle, 0xfff);
      const swizzle = Array.from({ length: 4 }, (_, i) => (packedSwizzle >>> (i * 3)) & 7);
      p.require(swizzle.every((component) => component <= 5), "invalid-enum", "Unknown swizzle component.");
      return { handle, resourceHandle, format, target, firstLayer: 0, lastLayer: 0, firstLevel: 0, lastLevel: 0, swizzle };
    }
    case 7: return decodeSamplerState(p, handle);
    case 8: {
      p.exact(5);
      const resourceHandle = p.handle(2), format = p.u(3), level = p.u(4), layers = p.u(5);
      p.require([2, 16, 67, 233].includes(format) && level === 0 && layers === 0, "unsupported-feature", "Only required level zero, layer zero color or Z16 surfaces are supported.");
      return { handle, resourceHandle, format, level, firstLayer: 0, lastLayer: 0 };
    }
    default: p.fail("unsupported-object", "Unknown or unsupported object type.");
  }
}

function decodeTransfer(p, copy, inline = false) {
  if (inline) p.atLeast(12); else p.exact(copy ? 14 : 13);
  const resourceHandle = p.handle(1), level = p.u(2), usage = p.u(3), stride = p.u(4), layerStride = p.u(5);
  // Pinned vrend_decode_transfer_common ignores usage; preserve this opaque word.
  // In particular, do not interpret modern Mesa flags using the old renderer enum.
  p.require(level === 0, "unsupported-feature", "Only level zero transfers are supported.");
  const box = { x: p.u(6), y: p.u(7), z: p.u(8), width: p.u(9), height: p.u(10), depth: p.u(11) };
  for (const [origin, extent] of [[box.x, box.width], [box.y, box.height], [box.z, box.depth]]) {
    p.require(extent > 0 && extent <= MAX_I32 && origin <= MAX_I32 - extent,
      "invalid-value", "Transfer box is negative, empty or overflows signed coordinates.");
  }
  p.require(box.z === 0 && box.depth === 1, "unsupported-feature", "Only buffer or single-layer 2D transfers are supported.");
  const rowSpan = stride * (box.height - 1);
  p.require(rowSpan <= MAX_U32, "invalid-value", "Transfer row arithmetic overflows u32.");
  const common = { resourceHandle, level, usage, stride, layerStride, box };
  if (inline) return { ...common, dataWords: p.words(12, p.length - 11) };
  if (copy) {
    const stagingResourceHandle = p.handle(12), stagingOffset = p.u(13), flags = p.u(14);
    p.mask(flags, 3);
    p.require(flags === 1 || flags === 3, "unsupported-feature", "Copy transfers must be synchronized.");
    p.require(stagingOffset <= MAX_U32 - rowSpan, "invalid-value", "Staging offset arithmetic overflows u32.");
    return { ...common, stagingResourceHandle, stagingOffset, flags, synchronized: true, readFromHost: Boolean(flags & 2) };
  }
  const dataOffset = p.u(12), direction = p.u(13);
  p.require(direction === 1 || direction === 2, "invalid-enum", "Unknown transfer direction.");
  p.require(dataOffset <= MAX_U32 - rowSpan, "invalid-value", "Transfer offset arithmetic overflows u32.");
  return { ...common, dataOffset, direction };
}

function decodeHandles(p) {
  const count = p.arrayCount(2, 1, LIMITS.samplerSlots), stage = p.stage(1), startSlot = p.u(2);
  p.slotRange(startSlot, count, LIMITS.samplerSlots);
  const handles = p.words(3, count);
  p.require(stage <= 1 || handles.every((handle) => handle === 0), "unsupported-feature", "Unsupported shader stages accept only zero bindings.");
  return { stage, startSlot, handles };
}

function decodeInactiveBuffers(p, atomic) {
  const prefix = atomic ? 1 : 2, maximum = atomic ? LIMITS.atomicBufferSlots : LIMITS.shaderBufferSlots;
  const count = p.arrayCount(prefix, 3, maximum), stage = atomic ? null : p.stage(1), startSlot = p.u(prefix);
  p.slotRange(startSlot, count, maximum);
  p.zero(prefix + 1, count * 3, "Shader storage and atomic buffers accept only fully zero reset entries.");
  const buffers = Array.from({ length: count }, () => ({ offset: 0, length: 0, resourceHandle: 0 }));
  return atomic ? { startSlot, buffers } : { stage, startSlot, buffers };
}

function decodeFields(p, objectType) {
  switch (p.opcode) {
    case 1: return decodeObject(p, objectType);
    case 2:
      p.exact(1);
      p.require([1, 2, 3, 5].includes(objectType), "unsupported-object", "This object type is not bound with BIND_OBJECT.");
      return { handle: p.u(1) };
    case 3: p.exact(1); return { handle: p.handle(1) };
    case 4: {
      const count = p.arrayCount(1, 6, 1), startSlot = p.u(1);
      p.slotRange(startSlot, count, 1);
      return { startSlot, viewports: Array.from({ length: count }, (_, index) => ({ scale: p.floats(2 + index * 6, 3), translate: p.floats(5 + index * 6, 3) })) };
    }
    case 5: {
      p.atLeast(2);
      const colorBufferCount = p.u(1), depthStencilSurface = p.u(2);
      p.require(colorBufferCount <= 1, "unsupported-feature", "Only one color attachment is supported.");
      p.exact(2 + colorBufferCount);
      return { colorBufferCount, depthStencilSurface, colorSurfaces: p.words(3, colorBufferCount) };
    }
    case 6: {
      const count = p.arrayCount(0, 3, LIMITS.vertexBuffers);
      return { buffers: Array.from({ length: count }, (_, index) => ({ stride: p.u(1 + index * 3), offset: p.u(2 + index * 3), resourceHandle: p.u(3 + index * 3) })) };
    }
    case 7: {
      p.exact(8);
      const buffers = p.u(1), colorWords = p.words(2, 4), color = p.floats(2, 4);
      p.require(buffers !== 0 && (buffers & ~5) === 0, "unsupported-feature", "Only color attachment zero and Z16 depth clear are supported.");
      const depth = p.view.getFloat64(p.byteOffset + 24, true), stencil = p.u(8);
      p.require(Number.isFinite(depth) && depth >= 0 && depth <= 1 && stencil <= 255,
        "invalid-value", "Invalid clear depth or stencil value.");
      return { buffers, colorWords, color, depth, stencil };
    }
    case 8: {
      p.exact(12);
      const fields = { start: p.u(1), count: p.u(2), mode: p.u(3), indexed: p.boolean(4), instanceCount: p.u(5),
        indexBias: p.i(6), startInstance: p.u(7), primitiveRestart: p.boolean(8), restartIndex: p.u(9),
        minIndex: p.u(10), maxIndex: p.u(11), countFromStreamOutput: p.u(12) };
      p.require((p.standard ? [0, 1, 2, 3, 4, 5, 6] : [4, 5]).includes(fields.mode) && (p.standard || fields.instanceCount === 1) && fields.indexBias === 0 &&
        fields.startInstance === 0 && (p.standard ? (fields.primitiveRestart ? fields.indexed : fields.restartIndex === 0) :
          !fields.primitiveRestart && fields.restartIndex === 0) && fields.countFromStreamOutput === 0,
      "unsupported-feature", p.standard ? "Only core points, lines and triangles with indexed restart and without base offsets or stream output are supported." :
        "Only ordinary triangles/strips without instancing, restart or stream output are supported.");
      p.require(fields.start <= MAX_U32 - fields.count && fields.minIndex <= fields.maxIndex,
        "invalid-value", "Invalid draw count/index range.");
      return fields;
    }
    case 9: return decodeTransfer(p, false, true);
    case 10: case 18: return decodeHandles(p);
    case 11: {
      p.require(p.length === 1 || p.length === 3, "payload-length", "Index buffer payload must have one or three words.");
      const resourceHandle = p.u(1);
      if (p.length === 1) {
        p.require(resourceHandle === 0, "invalid-value", "A bound index buffer requires index size and offset.");
        return { resourceHandle, indexSize: 0, offset: 0 };
      }
      p.handle(1);
      const indexSize = p.u(2), offset = p.u(3);
      p.require((p.standard ? [1, 2, 4] : [2]).includes(indexSize), "unsupported-feature",
        p.standard ? "Only u8/u16/u32 index buffers are supported." : "Only u16 index buffers are supported.");
      p.require(offset % indexSize === 0, "invalid-value", "Index buffer offset must be aligned.");
      return { resourceHandle, indexSize, offset };
    }
    case 12: {
      const limits = p.standard ? STANDARD_LIMITS : LIMITS;
      const stage = p.stage(1), count = p.arrayCount(2, 1, stage === 0 ? limits.vertexConstantWords : limits.constantWords), index = p.u(2);
      p.require(index < LIMITS.constantSlots, "limit-exceeded", "Constant buffer slot exceeds profile limit.");
      p.require(count % 4 === 0, "payload-length", "Inline constants must contain whole vec4 values.");
      p.require(count === 0 || (stage <= 1 && index === 0), "unsupported-feature", "Active constants require VS/FS slot zero.");
      return { stage, index, words: p.words(3, count), ...(p.standard ? {} : { values: p.floats(3, count) }) };
    }
    case 13:
      p.exact(1); p.mask(p.u(1), 0xffff);
      return { front: p.u(1) & 255, back: p.u(1) >>> 8 };
    case 14: p.exact(4); return { color: p.floats(1, 4) };
    case 15: {
      const count = p.arrayCount(1, 2, 1), startSlot = p.u(1);
      p.slotRange(startSlot, count, 1);
      return { startSlot, scissors: Array.from({ length: count }, (_, index) => {
        const min = p.u(2 + index * 2), max = p.u(3 + index * 2);
        const bounds = { minX: min & 65535, minY: min >>> 16, maxX: max & 65535, maxY: max >>> 16 };
        p.require(bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY, "invalid-value", "Scissor bounds are reversed.");
        return bounds;
      }) };
    }
    case 22:
      p.exact(32);
      for (let i = 1; i <= 32; i++) p.require(p.u(i) === MAX_U32, "unsupported-feature", "Only the inactive all-ones polygon stipple is supported.");
      return { pattern: p.words(1, 32) };
    case 24: p.exact(1); p.require(p.u(1) === MAX_U32, "unsupported-feature", "Only a full sample mask is supported."); return { mask: p.u(1) };
    case 25: p.exact(1); p.zero(1, 1, "Only empty stream-output reset is supported."); return { appendBitmask: 0, handles: [] };
    case 28: case 29: case 30: p.exact(1); return { subContextId: p.u(1) };
    case 31: {
      p.exact(2);
      const handle = p.u(1), stage = p.stage(2);
      p.require(stage <= 1 || handle === 0, "unsupported-feature", "Unsupported shader stages accept only unbinds.");
      return { handle, stage };
    }
    case 32: {
      p.exact(6);
      const factors = p.floats(1, 6);
      p.require(factors.every((value) => value === 1), "unsupported-feature", "Only default inactive tessellation factors are supported.");
      return { outer: factors.slice(0, 4), inner: factors.slice(4) };
    }
    case 33:
      p.exact(1); p.require(p.u(1) <= 1, "unsupported-feature", "Sample shading is unsupported."); return { minSamples: p.u(1) };
    case 34: return decodeInactiveBuffers(p, false);
    case 35: {
      const count = p.arrayCount(2, 5, LIMITS.imageSlots), stage = p.stage(1), startSlot = p.u(2);
      p.slotRange(startSlot, count, LIMITS.imageSlots);
      p.zero(3, count * 5, "Shader images accept only fully zero reset entries.");
      return { stage, startSlot, images: Array.from({ length: count }, () => ({ format: 0, access: 0, layerOffset: 0, levelSize: 0, resourceHandle: 0 })) };
    }
    case 38: {
      p.exact(2);
      const dimensions = p.u(1), packedLayers = p.u(2);
      p.mask(packedLayers, 0xffffff);
      p.require(packedLayers === 0, "unsupported-feature", "Layered or multisample framebuffer defaults are unsupported.");
      return { width: dimensions & 0xffff, height: dimensions >>> 16, layers: 0, samples: 0 };
    }
    case 40: return decodeInactiveBuffers(p, true);
    case 43: return decodeTransfer(p, false);
    case 44: return { paddingDwords: p.length };
    case 45: return decodeTransfer(p, true);
    case 46: {
      p.exact(2);
      const id = p.u(1), value = p.u(2);
      p.require((id === 1 && value === 1) || (id === 2 && value === 1024), "unsupported-feature", "Unknown or unsupported renderer tweak.");
      return { id, value };
    }
    case 52:
      p.exact(6); p.zero(3, 4, "Only vertex/fragment shader linkage is supported.");
      return { vertexHandle: p.u(1), fragmentHandle: p.u(2), geometryHandle: 0, tessControlHandle: 0, tessEvaluationHandle: 0, computeHandle: 0 };
    default: p.fail("unsupported-command", "Unknown or unsupported command.");
  }
}

function provenanceLabels(provenance) {
  if (provenance === null || typeof provenance !== "object") return null;
  const labels = { sourceSha256: null, event: null, contextId: null };
  // Host-owned labels must be data properties; descriptor values do not invoke getters.
  let descriptors;
  try {
    if (Array.isArray(provenance)) return null;
    descriptors = Object.getOwnPropertyDescriptors(provenance);
  } catch { return null; }
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(labels, key) || !Object.hasOwn(descriptor, "value")) return null;
    const value = descriptor.value;
    if (value == null) continue;
    if (key === "sourceSha256") {
      if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return null;
    } else if (!Number.isSafeInteger(value) || value < 0 || (key === "contextId" && value > MAX_U32)) return null;
    labels[key] = value;
  }
  return labels;
}

/** Returns one frozen complete submission, or a frozen structured error. */
export function decodeSubmission(bytes, provenance = {}) {
  return decode(bytes, provenance, false);
}

/** Selected only by the standard host factory; no wire/provenance selector. */
export function decodeStandardSubmission(bytes, provenance = {}) {
  return decode(bytes, provenance, true);
}

function decode(bytes, provenance, standard) {
  let byteLength, buffer, byteOffset;
  try {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const tag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag).get.call(bytes);
    if (tag !== "Uint8Array") return failure("invalid-input", "Input must be a Uint8Array byte view.");
    byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get.call(bytes);
    byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get.call(bytes);
    buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get.call(bytes);
    // ArrayBuffer's intrinsic rejects shared buffers, including cross-realm ones.
    Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get.call(buffer);
  } catch {
    return failure("invalid-input", "Input must be an attached, non-shared Uint8Array byte view.");
  }
  if (byteLength > LIMITS.submissionBytes) return failure("limit-exceeded", "Submission exceeds byte limit.");
  if (byteLength % 4 !== 0) return failure("unaligned-submission", "Submission byte length must be dword aligned.");
  const labels = provenanceLabels(provenance);
  if (labels === null) return failure("invalid-provenance", "Expected optional SHA256, event and contextId data labels.");
  let view;
  try {
    // Snapshot the exact view, including nonzero/unaligned host offsets. No mutable view escapes.
    const copy = new Uint8Array(byteLength);
    copy.set(new Uint8Array(buffer, byteOffset, byteLength));
    view = new DataView(copy.buffer);
  } catch {
    return failure("invalid-input", "Input view is detached or unavailable.");
  }
  const commands = [];
  try {
    for (let offset = 0; offset < byteLength;) {
      const header = view.getUint32(offset, true), opcode = header & 255, objectType = (header >>> 8) & 255, payloadDwords = header >>> 16;
      const packetByteLength = (payloadDwords + 1) * 4;
      const p = new Packet(view, offset, opcode, payloadDwords, standard);
      p.require(commands.length < LIMITS.commands, "limit-exceeded", "Submission exceeds packet count limit.");
      p.require(packetByteLength <= byteLength - offset, "truncated-payload", "Packet payload exceeds submission.");
      p.require(Object.hasOwn(COMMAND_NAMES, opcode), "unsupported-command", "Unknown or unsupported command.");
      if (opcode >= 1 && opcode <= 3) p.require(objectType >= 1 && objectType < OBJECT_NAMES.length, "unsupported-object", "Unknown or unsupported object type.");
      else p.require(objectType === 0, "invalid-object-type", "Non-object commands require a zero object-type byte.");
      const fields = decodeFields(p, objectType);
      commands.push({ opcode, name: COMMAND_NAMES[opcode], objectType, objectName: OBJECT_NAMES[objectType],
        byteOffset: offset, byteLength: packetByteLength, payloadDwords, fields });
      offset += packetByteLength;
    }
  } catch (error) {
    if (error instanceof DecodeFault) return error.result;
    throw error; // Unexpected implementation defects are not disguised as guest errors.
  }
  return freeze({ ok: true, profile: standard ? STANDARD_PROFILE : PROFILE, ...labels, byteLength, commands });
}
