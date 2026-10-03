/** Bounded resource ownership and transfers. See resources-README.md. */
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
function normalizeMetadata(value, limits) {
  const meta = record(value, META_KEYS);
  for (const key of META_KEYS) uint(meta[key], key, ["id", "width", "height", "depth", "arraySize"].includes(key));
  require(meta.depth === 1 && meta.arraySize === 1 && meta.lastLevel === 0 && meta.nrSamples === 0 && meta.flags === 0,
    "unsupported-resource", "Only one-level, single-layer, single-sample resources without flags are supported.");
  let kind, byteLength;
  if (meta.target === 0 && meta.format === 64 && meta.height === 1) {
    kind = ({ 16: "vertex-buffer", 32: "index-buffer", 524288: "staging" })[meta.bind];
    require(kind !== undefined, "unsupported-resource", "Unsupported buffer binding class.");
    byteLength = meta.width;
  } else {
    require(meta.target === 2 && meta.format === 67 && meta.bind === 10,
      "unsupported-resource", "Only RGBA8 2D renderable sampler textures are supported.");
    require(meta.width <= limits.textureSize && meta.height <= limits.textureSize, "limit-exceeded", "Texture dimensions exceed host/profile limits.");
    kind = "texture";
    byteLength = checkedProduct(checkedProduct(meta.width, meta.height, limits.resourceBytes, "Texture allocation is too large."), 4,
      limits.resourceBytes, "Texture allocation is too large.");
  }
  require(byteLength <= limits.resourceBytes, "limit-exceeded", "Resource exceeds per-resource byte limit.");
  return freeze({ ...meta, kind, byteLength });
}
function normalizedFields(value) {
  const allowed = [...COMMON_KEYS, "dataOffset", "direction", "stagingResourceHandle", "stagingOffset", "flags", "synchronized", "readFromHost"];
  const fields = record(value, allowed, COMMON_KEYS);
  for (const key of COMMON_KEYS.filter((key) => key !== "box")) uint(fields[key], key, key === "resourceHandle");
  fields.box = record(fields.box, BOX_KEYS);
  for (const key of BOX_KEYS) uint(fields.box[key], key, ["width", "height", "depth"].includes(key));
  const copy = Object.hasOwn(fields, "flags");
  if (copy) {
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
  require(fields.resourceHandle === meta.id && fields.level === 0, "invalid-transfer", "Resource identity or level mismatch.");
  const box = fields.box;
  for (const [origin, extent, bound] of [[box.x, box.width, meta.width], [box.y, box.height, meta.height], [box.z, box.depth, meta.depth]]) {
    require(origin <= bound && extent <= bound - origin, "out-of-bounds", "Transfer box exceeds logical resource extent.");
  }
  const texture = meta.kind === "texture";
  require(texture || (box.y === 0 && box.z === 0 && box.height === 1 && box.depth === 1), "invalid-transfer", "Buffer coordinates are byte-addressed one-dimensional ranges.");
  require(box.z === 0 && box.depth === 1, "invalid-transfer", "Only one 2D layer is supported.");
  const rowBytes = checkedProduct(box.width, texture ? 4 : 1, limits.transferBytes, "Transfer row exceeds byte limit.");
  const defaultStride = checkedProduct(meta.width, texture ? 4 : 1, U32, "Default stride overflows u32.");
  const rowStride = fields.stride || defaultStride;
  require(rowStride >= rowBytes, "out-of-bounds", "Row stride overlaps the transferred row.");
  const minimumLayer = checkedProduct(rowStride, box.height, U32, "Layer stride calculation overflows u32.");
  const layerStride = fields.layerStride || checkedProduct(rowStride, meta.height, U32, "Default layer stride overflows u32.");
  require(layerStride >= minimumLayer, "out-of-bounds", "Layer stride overlaps transferred rows.");
  const span = checkedProduct(box.height - 1, rowStride, U32, "Row footprint overflows u32.");
  require(rowBytes <= U32 - span, "out-of-bounds", "Transfer footprint overflows u32.");
  const footprintBytes = span + rowBytes;
  const offset = Object.hasOwn(fields, "flags") ? fields.stagingOffset : fields.dataOffset;
  require(offset <= backingBytes && footprintBytes <= backingBytes - offset, "out-of-bounds", "Transfer exceeds backing bytes.");
  require(footprintBytes <= limits.transferBytes, "limit-exceeded", "Strided transfer footprint exceeds byte limit.");
  const tightBytes = checkedProduct(rowBytes, box.height, limits.transferBytes, "Tight transfer exceeds byte limit.");
  return freeze({ kind: texture ? "texture" : "buffer", box: { ...box }, offset, rowBytes, rowCount: box.height,
    rowStride, layerStride, footprintBytes, requiredEnd: offset + footprintBytes, tightBytes,
    direction: (fields.direction === 2 || fields.flags === 3) ? "readback" : "upload" });
}

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
  const out = new Uint8Array(layout.tightBytes);
  for (let row = 0; row < layout.rowCount; row++) copySegments(backing.segments, layout.offset + row * layout.rowStride,
    out.subarray(row * layout.rowBytes, (row + 1) * layout.rowBytes), false);
  return out;
}
function scatter(backing, layout, bytes) {
  for (let row = 0; row < layout.rowCount; row++) copySegments(backing.segments, layout.offset + row * layout.rowStride,
    bytes.subarray(row * layout.rowBytes, (row + 1) * layout.rowBytes), true);
}

export function createResourceStore(options) {
  return result(() => {
    const config = record(options, ["backend", "limits"], ["backend"]), backend = config.backend;
    require(backend && typeof backend === "object", "invalid-input", "A transfer backend is required.");
    for (const method of ["allocate", "destroy", "upload", "readback", "dispose"]) require(typeof backend[method] === "function", "invalid-input", `Backend is missing ${method}.`);
    require(Number.isInteger(backend.maxTextureSize) && backend.maxTextureSize > 0, "invalid-input", "Backend must provide its texture dimension limit.");
    const requested = limitsFor(config.limits);
    const limits = Object.freeze({ ...requested, textureSize: Math.min(requested.textureSize, backend.maxTextureSize) });
    const resources = new Map(), live = new Set(), contexts = new Map(), tickets = new Map(), leases = new Map();
    let nextGeneration = 1, disposed = false, backingBytes = 0, gpuBytes = 0, scratchBytes = 0;
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
      if (res.storage !== null) { host("destroy", res.storage); gpuBytes -= res.meta.byteLength; res.storage = null; }
      live.delete(res);
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
      scratchBytes -= entry.layout.tightBytes;
      entry.upload = null;
      let firstError = null;
      for (const res of entry.retained) {
        res.references--;
        try { collect(res); } catch (error) { firstError ??= error; }
      }
      if (firstError) throw firstError;
    };
    const consumeTicket = (token) => {
      const entry = tickets.get(token);
      require(entry !== undefined, "invalid-ticket", "Unknown, consumed or foreign transfer ticket.");
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
      const bytes = byteView(host("readback", res.storage, res.meta, layout));
      require(bytes.byteLength === layout.tightBytes, "backend-error", "Backend readback returned the wrong byte count.");
      return bytes;
    };
    const operation = (fn) => (...args) => result(() => { alive(); return fn(...args); });
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
        const meta = normalizeMetadata(metadata, limits);
        require(!resources.has(meta.id), "resource-exists", "Resource ID is already public.");
        require(live.size < limits.resources, "limit-exceeded", "Live/retained resource count limit exceeded.");
        const allocationBytes = meta.kind === "staging" ? 0 : meta.byteLength;
        require(allocationBytes <= limits.gpuBytes - gpuBytes, "limit-exceeded", "GPU byte budget exceeded.");
        const gen = generation();
        const storage = allocationBytes ? host("allocate", meta) : null;
        require(!allocationBytes || (storage !== null && typeof storage === "object"), "backend-error", "Backend allocation returned no storage.");
        const res = { meta, generation: gen, public: true, references: 0, backing: null, memberships: new Set(), storage };
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
        res.backing = { active: true, byteLength: total, segments: copies };
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
        require(typeof role === "string" && ["view", "surface", "vertex", "index", "readback"].includes(role), "invalid-input", "Unknown storage lease role.");
        require(leases.size < limits.leases, "limit-exceeded", "Storage lease limit exceeded.");
        const token = Object.freeze({}); leases.set(token, { resource: res, role }); res.references++;
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
        reserveScratch(layout.tightBytes);
        try { return success({ bytes: readGpu(res, layout) }); } finally { scratchBytes -= layout.tightBytes; }
      }),
      prepareTransfer: operation((contextId, decodedCommand) => {
        const ctx = context(contextId);
        const command = record(decodedCommand, ["opcode", "name", "objectType", "objectName", "byteOffset", "byteLength", "payloadDwords", "fields"], ["opcode", "fields"]);
        require(command.opcode === 43 || command.opcode === 45, "unsupported-command", "Only TRANSFER3D and COPY_TRANSFER3D execute here.");
        const copy = command.opcode === 45;
        for (const [key, expected] of [["name", copy ? "COPY_TRANSFER3D" : "TRANSFER3D"], ["objectType", 0], ["objectName", "NULL"], ["byteLength", copy ? 60 : 56], ["payloadDwords", copy ? 14 : 13]]) {
          if (Object.hasOwn(command, key)) require(command[key] === expected, "invalid-transfer", "Inconsistent command metadata.");
        }
        if (Object.hasOwn(command, "byteOffset")) { uint(command.byteOffset, "byteOffset"); require(command.byteOffset % 4 === 0, "invalid-transfer", "Command byte offset is unaligned."); }
        const fields = normalizedFields(command.fields);
        require(Object.hasOwn(fields, "flags") === copy, "invalid-transfer", "Opcode and transfer payload disagree.");
        const primary = resource(fields.resourceHandle), primaryMember = membership(ctx, primary);
        const retained = [primary], members = [primaryMember], heldBackings = [];
        let transferBacking;
        if (copy) {
          const staging = resource(fields.stagingResourceHandle), stagingMember = membership(ctx, staging);
          require(staging.meta.kind === "staging", "unsupported-resource", "Copy secondary resource must be staging backing.");
          transferBacking = needBacking(staging); heldBackings.push(transferBacking); retained.push(staging); members.push(stagingMember);
          // Pinned read-from-host copy also requires primary attached backing.
          if (fields.flags === 3) heldBackings.push(needBacking(primary));
        } else { transferBacking = needBacking(primary); heldBackings.push(transferBacking); }
        const layout = layoutFor(primary.meta, fields, transferBacking.byteLength, limits);
        require(tickets.size < limits.tickets, "limit-exceeded", "Prepared transfer ticket limit exceeded.");
        reserveScratch(layout.tightBytes);
        let upload;
        try { upload = layout.direction === "upload" ? gather(transferBacking, layout) : null; }
        catch (error) { scratchBytes -= layout.tightBytes; throw error; }
        const ticket = Object.freeze({});
        for (const res of retained) res.references++;
        const backingLinks = retained.map((res) => ({ resource: res, backing: res.backing }));
        tickets.set(ticket, { context: ctx, primary, retained, memberships: members, backings: heldBackings, backingLinks, transferBacking, layout, upload });
        return success({ ticket, layout });
      }),
      executeTransfer: operation((token) => {
        const entry = consumeTicket(token);
        try {
          checkTicket(entry);
          if (entry.layout.direction === "upload") host("upload", entry.primary.storage, entry.primary.meta, entry.layout, entry.upload);
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
            backingBytes, cpuBytes: backingBytes + scratchBytes, gpuBytes, scratchBytes, tickets: tickets.size, leases: leases.size }) });
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
          for (const entry of tickets.values()) { try { releaseTicket(entry); } catch (error) { firstError ??= error; } }
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
      resolve: operation((token) => {
        const entry = leases.get(token);
        require(entry !== undefined, "invalid-lease", "Unknown, released or foreign storage lease.");
        return success({ metadata: entry.resource.meta, generation: entry.resource.generation,
          role: entry.role, storage: entry.resource.storage });
      }),
    });
    return success({ store: Object.freeze(store), bindings });
  });
}

/** Trusted backend using actual WebGL2 storage, never a CPU storage mirror. */
export function createWebGL2TransferBackend(gl) {
  return result(() => {
    require(gl && typeof gl.getBufferSubData === "function" && typeof gl.texStorage2D === "function", "invalid-input", "A WebGL2 context is required.");
    let vao = null, framebuffer = null, disposed = false;
    const allocations = new Set();
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
      const backend = {
        maxTextureSize,
        allocate(meta) {
          check();
          let storage = null;
          try {
            if (meta.kind === "texture") {
              const texture = gl.createTexture();
              require(texture !== null, "backend-error", "WebGL texture allocation failed.");
              storage = Object.freeze({ kind: "texture", texture });
              gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
              gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, meta.width, meta.height);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
        upload(storage, meta, layout, bytes) {
          check(); pixelState();
          if (storage.kind === "buffer") {
            gl.bindBuffer(gl.COPY_WRITE_BUFFER, storage.buffer);
            gl.bufferSubData(gl.COPY_WRITE_BUFFER, layout.box.x, bytes);
          } else {
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, storage.texture);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, layout.box.x, layout.box.y, layout.box.width, layout.box.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          }
          check();
        },
        readback(storage, meta, layout) {
          check(); pixelState();
          const bytes = new Uint8Array(layout.tightBytes);
          if (storage.kind === "buffer") {
            gl.bindBuffer(gl.COPY_READ_BUFFER, storage.buffer);
            gl.getBufferSubData(gl.COPY_READ_BUFFER, layout.box.x, bytes);
          } else {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
            try {
              gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, storage.texture, 0);
              gl.readBuffer(gl.COLOR_ATTACHMENT0);
              require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Transfer framebuffer is incomplete.");
              gl.readPixels(layout.box.x, layout.box.y, layout.box.width, layout.box.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            } finally {
              gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
            }
          }
          check(); return bytes;
        },
        dispose() {
          if (disposed) return;
          for (const storage of [...allocations]) destroy(storage);
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
