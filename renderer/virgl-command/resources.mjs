/** Bounded resource ownership and transfers. See resources-README.md. */
import {byteColorFormat, STANDARD_COLOR_TRANSFER_PROFILE} from "./color-images.mjs";
export const RESOURCE_LIMITS = Object.freeze({
  resources: 16, contexts: 8, segments: 256, tickets: 64, leases: 64,
  resourceBytes: 4194304, transferBytes: 4194304,
  cpuBytes: 33554432, gpuBytes: 33554432, scratchBytes: 8388608,
  textureSize: 16384,
});
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
function limitsFor(overrides = {}) {
  const supplied = record(overrides, Object.keys(RESOURCE_LIMITS), []);
  const limits = { ...RESOURCE_LIMITS, ...supplied };
  for (const key of Object.keys(limits)) require(Number.isSafeInteger(limits[key]) && limits[key] >= 0 && limits[key] <= RESOURCE_LIMITS[key],
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
function normalizeMetadata(value, limits, uniform = false, bufferRoles = false, mipmaps = false, colors = false) {
  const meta = record(value, META_KEYS);
  for (const key of META_KEYS) uint(meta[key], key, ["id", "width", "height", "depth", "arraySize"].includes(key));
  require(meta.depth === 1 && meta.arraySize === 1 && (meta.lastLevel === 0 || mipmaps && meta.target === 2 && ([2, 67, 233].includes(meta.format) || colors && byteColorFormat(meta.format))) && meta.nrSamples === 0 && meta.flags === 0,
    "unsupported-resource", mipmaps ? "Only qualified 2D levels, one layer, one sample and no flags are supported." : "Only one-level, single-layer, single-sample resources without flags are supported.");
  let kind, byteLength, levels, color, gpuByteLength;
  if (meta.target === 0 && meta.format === 64 && meta.height === 1) {
    kind = bufferRoles && (meta.bind & ~112) === 0 ? "standard-buffer" : ({ 16: "vertex-buffer", 32: "index-buffer", 524288: "staging", ...(uniform ? { 64: "uniform-buffer", 80: "uniform-buffer" } : {}) })[meta.bind];
    require(kind !== undefined, "unsupported-resource", "Unsupported buffer binding class.");
    byteLength = meta.width;
  } else if (meta.target === 2 && meta.format === 16) {
    require(meta.bind === 1, "unsupported-resource", "Required Z16 storage admits only the measured depth-surface role.");
    require(meta.width <= limits.textureSize && meta.height <= limits.textureSize, "limit-exceeded", "Depth dimensions exceed host/profile limits.");
    kind = "depth-texture";
    byteLength = checkedProduct(checkedProduct(meta.width, meta.height, limits.resourceBytes, "Depth allocation is too large."), 2,
      limits.resourceBytes, "Depth allocation is too large.");
  } else {
    color = colors ? byteColorFormat(meta.format) : null;
    const roles = meta.bind & 10, hints = (1 << 18) | (1 << 20);
    require(meta.target === 2 && ([2, 67, 233].includes(meta.format) || color) && roles !== 0 && (!color?.snorm || roles === 8) && (meta.bind & ~(10 | hints)) === 0,
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
  require(byteLength <= limits.resourceBytes, "limit-exceeded", "Resource exceeds per-resource byte limit.");
  return freeze({ ...meta, kind, byteLength, ...(levels ? { levels } : {}), ...(color ? { pixelBytes: color.pixelBytes, gpuByteLength } : {}) });
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
  uint(backingBytes, "backingByteLength");
  require(meta.kind !== "staging", "unsupported-resource", "Staging resources have no GPU transfer storage.");
  require(fields.resourceHandle === meta.id && fields.level <= meta.lastLevel, "invalid-transfer", "Resource identity or level mismatch.");
  const selected = meta.kind === "mip-texture" ? meta.levels[fields.level] : meta;
  const box = fields.box;
  for (const [origin, extent, bound] of [[box.x, box.width, selected.width], [box.y, box.height, selected.height], [box.z, box.depth, meta.depth]]) {
    require(origin <= bound && extent <= bound - origin, "out-of-bounds", "Transfer box exceeds logical resource extent.");
  }
  const depth = meta.kind === "depth-texture", texture = meta.kind === "texture" || meta.kind === "mip-texture" || depth;
  require(texture || (box.y === 0 && box.z === 0 && box.height === 1 && box.depth === 1), "invalid-transfer", "Buffer coordinates are byte-addressed one-dimensional ranges.");
  require(box.z === 0 && box.depth === 1, "invalid-transfer", "Only one 2D layer is supported.");
  const color = Object.hasOwn(meta, "pixelBytes") ? byteColorFormat(meta.format) : null;
  const pixelBytes = depth ? 2 : texture ? color?.pixelBytes ?? 4 : 1;
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
  const packedBytes = depth && direction === "readback" ? checkedProduct(tightBytes, 2, RESOURCE_LIMITS.scratchBytes, "Depth conversion exceeds scratch byte limit.") : tightBytes;
  const colorScratch = color ? checkedProduct(checkedProduct(box.width, box.height, RESOURCE_LIMITS.scratchBytes, "Color transfer is too large."), direction === "readback" ? 4 : Math.max(color.pixelBytes, color.nativePixelBytes), RESOURCE_LIMITS.scratchBytes, "Native color scratch exceeds byte limit.") : 0;
  return freeze({ kind: texture ? "texture" : "buffer", box: { ...box }, offset, rowBytes, rowCount: box.height,
    ...(meta.kind === "mip-texture" ? { level: fields.level, levelWidth: selected.width, levelHeight: selected.height } : {}),
    rowStride, layerStride, footprintBytes, requiredEnd: offset + footprintBytes, tightBytes,
    direction, ...(color ? { scratchBytes: colorScratch, stagingBytes: direction === "readback" ? colorScratch : 0 } : {}), ...(depth ? { scratchBytes: packedBytes, conversionBytes: direction === "readback" ? packedBytes : 0,
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
  for (let row = 0; row < layout.rowCount; row++) copySegments(backing.segments, layout.offset + row * layout.rowStride,
    out.subarray(row * layout.rowBytes, (row + 1) * layout.rowBytes), false);
  return out;
}
function gatherInline(words, layout) {
  const out = new Uint8Array(scratchCharge(layout)).subarray(0, layout.tightBytes);
  for (let row = 0; row < layout.rowCount; row++) for (let byte = 0; byte < layout.rowBytes; byte++) {
    const offset = row * layout.rowStride + byte;
    out[row * layout.rowBytes + byte] = (words[offset >>> 2] >>> ((offset & 3) * 8)) & 255;
  }
  return out;
}
function scatter(backing, layout, bytes) {
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

function createStore(options, uniform, bufferRoles = false, mipmaps = false, images = false, colors = false) {
  return result(() => {
    const config = record(options, ["backend", "limits"], ["backend"]), backend = config.backend;
    require(backend && typeof backend === "object", "invalid-input", "A transfer backend is required.");
    for (const method of ["allocate", "destroy", "upload", "readback", "dispose"]) require(typeof backend[method] === "function", "invalid-input", `Backend is missing ${method}.`);
    require(Number.isInteger(backend.maxTextureSize) && backend.maxTextureSize > 0, "invalid-input", "Backend must provide its texture dimension limit.");
    require(!images || typeof backend.copyTextureRange === "function", "invalid-input", "Image views require native GPU copies.");
    require(!colors || backend.colorProfile === STANDARD_COLOR_TRANSFER_PROFILE, "invalid-input", "Byte colors require the qualified native transfer backend.");
    const requested = limitsFor(config.limits);
    const limits = Object.freeze({ ...requested, textureSize: Math.min(requested.textureSize, backend.maxTextureSize) });
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
      require(entry && roles.includes(entry.role) && ["texture", "mip-texture", "depth-texture"].includes(entry.resource.meta.kind),
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
        const meta = normalizeMetadata(metadata, limits, uniform, bufferRoles, mipmaps, colors);
        require(!resources.has(meta.id), "resource-exists", "Resource ID is already public.");
        require(live.size < limits.resources, "limit-exceeded", "Live/retained resource count limit exceeded.");
        const allocationBytes = meta.kind === "staging" ? 0 : meta.gpuByteLength ?? meta.byteLength;
        require(allocationBytes <= limits.gpuBytes - gpuBytes, "limit-exceeded", "GPU byte budget exceeded.");
        const gen = generation();
        const storage = allocationBytes ? host("allocate", meta) : null;
        require(!allocationBytes || (storage !== null && typeof storage === "object"), "backend-error", "Backend allocation returned no storage.");
        const res = { meta, generation: gen, public: true, references: 0, backing: null, memberships: new Set(), storage, contentRevision: 0 };
        resources.set(meta.id, res); live.add(res); gpuBytes += allocationBytes;
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
        require(typeof role === "string" && ["view", "surface", "depth-surface", "vertex", "index", "readback", ...(uniform ? ["uniform"] : [])].includes(role), "invalid-input", "Unknown storage lease role.");
        require(role === "readback" || (bufferRoles && res.meta.kind === "standard-buffer" && ["vertex", "index", "uniform"].includes(role)) || (role === "view" && ["texture", "mip-texture"].includes(res.meta.kind) && (res.meta.bind & 8) !== 0) ||
          (role === "surface" && ["texture", "mip-texture"].includes(res.meta.kind) && (res.meta.bind & 2) !== 0) ||
          (role === "depth-surface" && res.meta.kind === "depth-texture" && res.meta.bind === 1) ||
          (role === "vertex" && (res.meta.kind === "vertex-buffer" || uniform && res.meta.kind === "uniform-buffer")) ||
          (role === "uniform" && uniform && ["vertex-buffer", "uniform-buffer"].includes(res.meta.kind)) || (role === "index" && res.meta.kind === "index-buffer"),
        "unsupported-resource", "Storage lease role contradicts the resource binding class.");
        require(leases.size < limits.leases, "limit-exceeded", "Storage lease limit exceeded.");
        const token = Object.freeze({}); leases.set(token, { resource: res, role, ...(role === "uniform" || images && ["view", "surface", "depth-surface"].includes(role) ? { context: ctx } : {}) }); res.references++;
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
            backingBytes, cpuBytes: backingBytes + scratchBytes, gpuBytes, scratchBytes, tickets: tickets.size, leases: leases.size, ...(uniform ? { uniformRanges: uniformRanges.size } : {}), ...(images ? { imageViews: liveImages.size, imageHolds: imageHolds.size } : {}) }) });
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
        require(res.meta.kind === "texture" && res.meta.format === 67 && res.meta.flags === 0 && (res.meta.bind & 2) !== 0,
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
      capture: operation((lease, firstLevel, lastLevel) => {
        const leaseEntry = imageLease(lease, ["view"]), res = leaseEntry.resource, meta = res.meta;
        uint(firstLevel, "firstLevel"); uint(lastLevel, "lastLevel");
        require(firstLevel <= lastLevel && lastLevel <= meta.lastLevel, "out-of-bounds", "Original view range exceeds retained image levels.");
        require(liveImages.size < limits.leases, "limit-exceeded", "Live/retained native image view limit exceeded.");
        const width = Math.max(1, Math.floor(meta.width / 2 ** firstLevel)), height = Math.max(1, Math.floor(meta.height / 2 ** firstLevel));
        const levels = []; let byteLength = 0, gpuByteLength = 0;
        const color = Object.hasOwn(meta, "pixelBytes") ? byteColorFormat(meta.format) : null;
        for (let level = 0, w = width, h = height; level <= lastLevel - firstLevel; level++) {
          const bytes = checkedProduct(checkedProduct(w, h, limits.resourceBytes, "View plane is too large."), color?.pixelBytes ?? 4, limits.resourceBytes, "View plane is too large.");
          require(bytes <= limits.resourceBytes - byteLength, "limit-exceeded", "Complete view mip chain exceeds resource byte limit.");
          let nativeBytes;
          if (color) {
            nativeBytes = checkedProduct(checkedProduct(w, h, limits.resourceBytes, "Native view plane is too large."), color.nativePixelBytes, limits.resourceBytes, "Native view plane is too large.");
            require(nativeBytes <= limits.resourceBytes - gpuByteLength, "limit-exceeded", "Native view mip chain exceeds resource byte limit.");
            gpuByteLength += nativeBytes;
          }
          levels.push({ level, width: w, height: h, byteLength: bytes, ...(color ? { gpuByteLength: nativeBytes } : {}) }); byteLength += bytes;
          w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
        }
        const metadata = freeze({ ...meta, kind: lastLevel > firstLevel ? "mip-texture" : "texture", width, height,
          lastLevel: lastLevel - firstLevel, byteLength, levels, ...(color ? { gpuByteLength } : {}) });
        const allocationBytes = firstLevel === 0 && lastLevel === meta.lastLevel ? 0 : color ? gpuByteLength : byteLength;
        require(allocationBytes <= limits.gpuBytes - gpuBytes, "limit-exceeded", "Native image view byte budget exceeded.");
        const storage = allocationBytes ? host("allocate", metadata) : res.storage;
        require(storage && typeof storage === "object", "backend-error", "Native image view allocation returned no storage.");
        const token = Object.freeze({}), entry = { resource: res, lease, metadata, firstLevel, lastLevel, storage, allocationBytes, references: 1 };
        gpuBytes += allocationBytes; res.references++; liveImages.add(entry); imageViews.set(token, entry);
        return success({ token, metadata, generation: res.generation });
      }),
      resolve: operation(token => { const entry = imageEntry(token); return success({ storage: entry.storage, metadata: entry.metadata, generation: entry.resource.generation }); }),
      refresh: operation(token => {
        const entry = imageEntry(token);
        if (entry.allocationBytes) host("copyTextureRange", entry.resource.storage, entry.storage, entry.metadata, entry.firstLevel);
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
    return success({ store: Object.freeze(store), bindings, asyncAccess, ...(uniform ? { uniformAccess } : {}), ...(images ? { imageAccess } : {}) });
  });
}

/** Trusted backend using actual WebGL2 storage, never a CPU storage mirror. */
export function createWebGL2TransferBackend(gl) { return createTransferBackend(gl, false); }

export function createStandardColorTransferBackend(gl) { return createTransferBackend(gl, true); }

function createTransferBackend(gl, colors) {
  return result(() => {
    require(gl && typeof gl.getBufferSubData === "function" && typeof gl.texStorage2D === "function", "invalid-input", "A WebGL2 context is required.");
    require(!colors || gl.getExtension("EXT_render_snorm"), "unsupported-host", "Native signed color copies/readbacks require EXT_render_snorm.");
    let vao = null, framebuffer = null, depthProgram = null, disposed = false;
    const allocations = new Set(), pendingReads = new Set();
    const colorFormats = {
      16: { internal: gl.DEPTH_COMPONENT16, upload: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_SHORT },
      2: { internal: gl.RGB8, upload: gl.RGB, type: gl.UNSIGNED_BYTE },
      67: { internal: gl.RGBA8, upload: gl.RGBA, type: gl.UNSIGNED_BYTE },
      233: { internal: gl.RGB10_A2, upload: gl.RGBA, type: gl.UNSIGNED_INT_2_10_10_10_REV },
    };
    const colorFormat = (meta) => {
      const color = colors ? byteColorFormat(meta.format) : null;
      const profile = color ? { internal: gl[color.internal], upload: gl[color.upload], type: gl[color.type] } : colorFormats[meta.format];
      require(profile, "unsupported-resource", "Unsupported native texture storage format.");
      return profile;
    };
    // Store uploads are private, dense scratch arrays. Convert in that same
    // reservation: no second CPU image or GPU shadow escapes the byte budgets.
    const nativeUpload = (format, bytes) => {
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
    const guestReadback = (format, bytes) => {
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
    const pixelState = () => {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (const parameter of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS,
        gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) gl.pixelStorei(parameter, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    };
    const initializeXAlpha = (texture, level = 0) => {
      const previous = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), mask = gl.getParameter(gl.COLOR_WRITEMASK);
      const scissor = gl.isEnabled(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      try {
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        require(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Packed color initialization framebuffer is incomplete.");
        gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
        gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      } finally {
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previous); gl.colorMask(...mask);
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
      check();
      const destroy = (storage) => {
        if (!allocations.has(storage)) return;
        if (storage.kind === "texture") gl.deleteTexture(storage.texture); else gl.deleteBuffer(storage.buffer);
        allocations.delete(storage);
      };
      const releaseReadback = (entry) => {
        if (!pendingReads.delete(entry)) return;
        if (entry.sync) gl.deleteSync(entry.sync);
        if (entry.buffer) gl.deleteBuffer(entry.buffer);
      };
      const backend = {
        maxTextureSize, ...(colors ? { colorProfile: STANDARD_COLOR_TRANSFER_PROFILE } : {}),
        allocate(meta) {
          check();
          let storage = null;
          try {
            if (meta.kind === "texture" || meta.kind === "mip-texture" || meta.kind === "depth-texture") {
              if (meta.format === 16) require(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision >= 23,
                "unsupported-resource", "Faithful UN16 reconstruction requires highp binary32 shader precision.");
              const texture = gl.createTexture();
              require(texture !== null, "backend-error", "WebGL texture allocation failed.");
              storage = Object.freeze({ kind: "texture", texture });
              gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
              gl.texStorage2D(gl.TEXTURE_2D, meta.lastLevel + 1, colorFormat(meta).internal, meta.width, meta.height);
              if (colors) check();
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
              // RGB8 has implicit alpha one. RGB10_A2 needs actual stored A=3,
              // then the state executor masks destination alpha writes.
              if (meta.format === 233 || colors && byteColorFormat(meta.format)?.implicitAlpha && byteColorFormat(meta.format).nativePixelBytes === 4) for (let level = 0; level <= meta.lastLevel; level++) initializeXAlpha(texture, level);
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
            if (storage?.kind === "texture") gl.deleteTexture(storage.texture);
            else if (storage) gl.deleteBuffer(storage.buffer);
            throw error;
          }
        },
        destroy,
        copyTextureRange(source, destination, meta, firstLevel) {
          check();
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
          } else {
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, storage.texture);
            const profile = colorFormat(meta);
            gl.texSubImage2D(gl.TEXTURE_2D, layout.level ?? 0, layout.box.x, layout.box.y, layout.box.width, layout.box.height,
              profile.upload, profile.type, nativeUpload(meta.format, bytes));
          }
          check();
        },
        readback(storage, meta, layout) {
          check(); pixelState();
          const bytes = new Uint8Array(scratchCharge(layout));
          if (storage.kind === "buffer") {
            gl.bindBuffer(gl.COPY_READ_BUFFER, storage.buffer);
            gl.getBufferSubData(gl.COPY_READ_BUFFER, layout.box.x, bytes);
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
              const destination = meta.format === 233 ? new Uint32Array(bytes.buffer) : colors && byteColorFormat(meta.format)?.snorm ? new Int8Array(bytes.buffer) : bytes;
              gl.readPixels(layout.box.x, layout.box.y, layout.box.width, layout.box.height, gl.RGBA, profile.type, destination);
            } finally {
              gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
            }
          }
          check(); return guestReadback(meta.format, bytes);
        },
        beginReadback(storage, meta, layout) {
          check(); pixelState();
          const entry = { buffer: null, sync: null, ready: false, bytes: scratchCharge(layout), format: meta.format };
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
                if (meta.format === 16) converted = packDepth(storage, layout.box);
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
                gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, converted ?? storage.texture, converted ? 0 : layout.level ?? 0);
                gl.readBuffer(gl.COLOR_ATTACHMENT0);
                require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Readback framebuffer is incomplete.");
                // Numeric offset selects the PBO overload: no CPU destination here.
                gl.readPixels(converted ? 0 : layout.box.x, converted ? 0 : layout.box.y, layout.box.width, layout.box.height,
                  gl.RGBA, converted ? gl.UNSIGNED_BYTE : colorFormat(meta).type, 0);
              } finally {
                gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                if (converted) gl.deleteTexture(converted);
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
          const bytes = new Uint8Array(entry.bytes);
          gl.bindBuffer(gl.COPY_READ_BUFFER, entry.buffer);
          gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes); check(); return guestReadback(entry.format, bytes);
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
