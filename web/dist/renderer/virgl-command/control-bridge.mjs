/** Explicit proof-only VirtIO bridges. Ordinary device negotiation is unchanged. */
import { PRODUCTION_RESOURCE_LIMITS, createResourceStore, createProductionResourceStore, createProductionTransferBackend, createWebGL2TransferBackend, createStandardDesktopResourceStore, createStandardPackedDepthTransferBackend, createStandardDimensionalResourceStore, createStandardDimensionalTransferBackend, createStandardDimensionalViewResourceStore, createStandardDimensionalViewTransferBackend, createStandardDimensionalDepthResourceStore, createStandardDimensionalDepthTransferBackend, createStandardDimensionalDepthViewResourceStore, createStandardDimensionalColorSurfaceResourceStore, createStandardDimensionalDepthSurfaceResourceStore, createStandardStreamOutputResourceStore, createStandardDimensionalDepthViewTransferBackend } from './resources.mjs';
import { createRetainedScanout, normalizeScanoutEvent } from './scanout.mjs';
import { createVirglStateRenderer, createVirglAsyncRenderer, createVirglStandardShadowSamplerAsyncRenderer, createVirglStandardDimensionalAsyncRenderer, createVirglStandardDimensionalViewAsyncRenderer, createVirglStandardDimensionalDepthViewAsyncRenderer, createVirglStandardDimensionalShadowAsyncRenderer, createVirglStandardDimensionalColorSurfaceAsyncRenderer, createVirglStandardDimensionalDepthSurfaceAsyncRenderer, createVirglStandardStreamOutputAsyncRenderer, createVirglProductionAsyncRenderer } from './state.mjs';

const ok = () => Object.freeze({ ok: true });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
class Fault extends Error { constructor(code, message) { super(message); this.code = code; } }
function need(value, code, message) { if (!value) throw new Fault(code, message); }
function record(value, keys, required = keys) {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid-parameter', 'Expected a data record.');
  const descriptors = Object.getOwnPropertyDescriptors(value), out = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    need(keys.includes(key) && Object.hasOwn(descriptors[key], 'value'), 'invalid-parameter', 'Unknown or accessor property.');
    out[key] = descriptors[key].value;
  }
  for (const key of required) need(Object.hasOwn(out, key), 'invalid-parameter', `Missing ${key}.`);
  return out;
}
function hex(value) {
  need(typeof value === 'string' && /^[0-9a-f]{16}$/.test(value), 'invalid-parameter', 'Expected exact hexadecimal u64.');
  return value;
}
function identity(value) {
  const id = record(value, ['id', 'generation']);
  need(Number.isInteger(id.id) && id.id > 0 && id.id <= 0xffffffff && hex(id.generation) !== '0000000000000000',
    'invalid-parameter', 'Expected nonzero identity.');
  return Object.freeze(id);
}
function bytes(value) {
  // Intrinsic accessors avoid trusting overridden typed-array properties; shared views are refused.
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  need(Object.getOwnPropertyDescriptor(proto, Symbol.toStringTag).get.call(value) === 'Uint8Array', 'invalid-parameter', 'Expected Uint8Array.');
  const buffer = Object.getOwnPropertyDescriptor(proto, 'buffer').get.call(value);
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(buffer);
  return new Uint8Array(buffer, Object.getOwnPropertyDescriptor(proto, 'byteOffset').get.call(value),
    Object.getOwnPropertyDescriptor(proto, 'byteLength').get.call(value));
}
const shapes = Object.freeze({
  createContext: ['context', 'debugName'], destroyContext: ['context'],
  createResource: ['resource', 'metadata'], attachResource: ['context', 'resource'],
  detachResource: ['context', 'resource'], attachBacking: ['resource', 'segments'],
  detachBacking: ['resource'], unrefResource: ['resource'], reset: [],
});
const META = ['id', 'target', 'format', 'bind', 'width', 'height', 'depth', 'arraySize', 'lastLevel', 'nrSamples', 'flags'];
function normalize(input, asynchronous = false, byteLimit = 4194304, segmentLimit = 256) {
  const common = record(input, ['epoch', 'type', 'context', 'resource', 'metadata', 'debugName', 'segments', 'backingGeneration'], ['epoch', 'type']);
  need(typeof common.type === 'string' && Object.hasOwn(shapes, common.type), 'invalid-parameter', 'Unknown control operation.');
  const required = ['epoch', 'type', ...shapes[common.type]];
  const event = record(common, [...required, ...(['attachBacking', 'detachBacking'].includes(common.type) ? ['backingGeneration'] : [])], required);
  if (['attachBacking', 'detachBacking'].includes(common.type) && (asynchronous || event.backingGeneration !== undefined)) {
    need(hex(event.backingGeneration) !== '0000000000000000', 'invalid-parameter', 'Backing generation must be nonzero.');
  }
  hex(event.epoch);
  if (shapes[event.type].includes('context')) event.context = identity(event.context);
  if (shapes[event.type].includes('resource')) event.resource = identity(event.resource);
  if (event.type === 'createContext') {
    event.debugName = bytes(event.debugName);
    need(event.debugName.byteLength <= 64, 'invalid-parameter', 'Debug name exceeds wire limit.');
  }
  if (event.type === 'createResource') {
    event.metadata = record(event.metadata, META);
    need(event.metadata.id === event.resource.id, 'invalid-parameter', 'Metadata identity differs.');
  }
  if (event.type === 'attachBacking') {
    need(Array.isArray(event.segments) && event.segments.length > 0 && event.segments.length <= segmentLimit,
      'invalid-parameter', 'Invalid backing segment count.');
    let total = 0;
    event.segments = event.segments.map((value) => {
      const segment = record(value, ['address', 'length', 'data']);
      hex(segment.address); segment.data = bytes(segment.data);
      need(Number.isInteger(segment.length) && segment.length > 0 && segment.length === segment.data.byteLength &&
        BigInt('0x' + segment.address) + BigInt(segment.length) <= 0x10000000000000000n,
      'invalid-parameter', 'Invalid backing range.');
      total += segment.length;
      need(total <= byteLimit, 'out-of-memory', 'Backing exceeds resource limit.');
      return segment;
    });
  }
  return event;
}
function uint(value) { need(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, 'invalid-parameter', 'Expected u32.'); return value; }
const nextHex = (value) => {
  const next = BigInt('0x' + value) + 1n;
  need(next <= 0xffffffffffffffffn, 'invalid-parameter', 'Sequence space exhausted.');
  return next.toString(16).padStart(16, '0');
};
function normalizeJob(input, resourceLimit, byteLimit = 4194304, production = false) {
  const type = Object.getOwnPropertyDescriptor(input, 'type')?.value;
  if (type === 'cancelJob') {
    const event = record(input, ['type', 'epoch', 'sequence']); hex(event.epoch); hex(event.sequence); return event;
  }
  const event = record(input, ['type', 'epoch', 'sequence', 'context', 'header', 'resources', 'kind', 'commands', 'transfer'],
    ['type', 'epoch', 'sequence', 'context', 'header', 'resources', 'kind']);
  hex(event.epoch); hex(event.sequence); event.context = identity(event.context);
  event.header = record(event.header, ['type', 'flags', 'fenceId', 'contextId', 'ringIndex']);
  for (const key of ['type', 'flags', 'contextId', 'ringIndex']) uint(event.header[key]); hex(event.header.fenceId);
  need((event.header.flags === 0 || event.header.flags === 1) && event.header.ringIndex === 0 && (event.header.contextId === event.context.id || (production && event.header.type === 0x105 && event.header.contextId === 0)),
    'invalid-parameter', 'Unsupported submission header.');
  need(Array.isArray(event.resources) && event.resources.length <= resourceLimit, 'invalid-parameter', 'Invalid accepted resource set.');
  const ids = new Set();
  event.resources = event.resources.map((entry) => {
    const resource = record(entry, ['identity', 'metadata', 'backing']); resource.identity = identity(resource.identity);
    need(!ids.has(resource.identity.id), 'invalid-parameter', 'Duplicate accepted resource.'); ids.add(resource.identity.id);
    resource.metadata = record(resource.metadata, META); for (const value of Object.values(resource.metadata)) uint(value);
    need(resource.metadata.id === resource.identity.id, 'invalid-parameter', 'Accepted metadata identity mismatch.');
    if (resource.backing !== null) {
      resource.backing = record(resource.backing, ['generation', 'byteLength']); hex(resource.backing.generation); uint(resource.backing.byteLength);
      need(resource.backing.generation !== '0000000000000000' && resource.backing.byteLength <= byteLimit, 'invalid-parameter', 'Invalid accepted backing.');
    }
    return resource;
  });
  if (event.kind === 'commands') {
    need(event.header.type === 0x207 && !Object.hasOwn(event, 'transfer') && Object.hasOwn(event, 'commands'), 'invalid-parameter', 'Invalid commands envelope.');
    const source = bytes(event.commands); need(source.byteLength <= 262144, 'invalid-parameter', 'Submission is too large.');
    event.commands = new Uint8Array(source);
  } else {
    need(event.kind === 'transfer' && !Object.hasOwn(event, 'commands') && Object.hasOwn(event, 'transfer'), 'invalid-parameter', 'Invalid transfer envelope.');
    const t = event.transfer = record(event.transfer, ['box', 'offset', 'resourceId', 'level', 'stride', 'layerStride', 'direction']);
    t.box = record(t.box, ['x', 'y', 'z', 'width', 'height', 'depth']); for (const value of Object.values(t.box)) uint(value);
    for (const key of ['resourceId', 'level', 'stride', 'layerStride', 'direction']) uint(t[key]); hex(t.offset);
    need(t.resourceId > 0 && (t.direction === 1 || t.direction === 2) && (event.header.type === (t.direction === 1 ? 0x205 : 0x206) || (production && t.direction === 1 && event.header.type === 0x105)), 'invalid-parameter', 'Transfer direction mismatch.');
    // Preserve full wire width until after the checked profile/backing bound.
    need(BigInt('0x' + t.offset) <= 0xffffffffn, 'invalid-parameter', 'Outer transfer offset cannot narrow to this profile.');
  }
  return event;
}
function transferCommands(t) {
  const words = [t.resourceId, t.level, 0, t.stride, t.layerStride, t.box.x, t.box.y, t.box.z, t.box.width, t.box.height, t.box.depth, Number(BigInt('0x' + t.offset)), t.direction];
  const raw = new Uint8Array(56), view = new DataView(raw.buffer); view.setUint32(0, 43 + (13 << 16), true);
  words.forEach((word, i) => view.setUint32(4 + i * 4, word, true)); return raw;
}
const outcomeCode = (code) => ({ 'invalid-context-id': 1, 'invalid-resource-id': 2, 'invalid-parameter': 3, 'out-of-memory': 4, unspecified: 5, 'bridge-poisoned': 6 })[code] ?? 5;
function mappedCode(code) {
  if (['limit-exceeded', 'backend-error'].includes(code)) return 'out-of-memory';
  if (['context-exists', 'duplicate-context', 'missing-context', 'stale-context'].includes(code)) return 'invalid-context-id';
  if (['resource-exists', 'missing-resource'].includes(code)) return 'invalid-resource-id';
  return 'invalid-parameter';
}
function unwrap(result) {
  need(result?.ok === true, mappedCode(result?.error?.code), result?.error?.message ?? 'Renderer operation failed.');
  return result;
}

/** Trusted host-only construction. The guest can supply only validated wire data, never these capabilities. */
export function createVirglControlBridge(options) { return createBridge(options, false); }

/** Async submission proof only; transport capabilities are trusted host functions. */
export function createVirglSubmitBridge(options) { return createBridge(options, true); }

/** Selected desktop submission owners; construction grants no production capsets. */
export function createVirglStandardDesktopSubmitBridge(options) { return createBridge(options, true, false, true); }

/** Selected original layered storage/DMA; shader/surface consumers stay gated. */
export function createVirglStandardDimensionalSubmitBridge(options) { return createBridge(options, true, false, true, true); }

/** Selected original dimensional sampler consumers; production negotiation remains separate. */
export function createVirglStandardDimensionalViewSubmitBridge(options) { return createBridge(options, true, false, true, true, true); }
/** Selected original depth allocation/DMA; dimensional depth draw consumers stay closed. */
export function createVirglStandardDimensionalDepthSubmitBridge(options) { return createBridge(options, true, false, true, true, true, true); }
/** Selected retained dimensional depth sampling; production negotiation remains gated. */
export function createVirglStandardDimensionalDepthViewSubmitBridge(options) { return createBridge(options, true, false, true, true, true, true, true); }
/** Selected original cube/array comparisons; production negotiation stays separate. */
export function createVirglStandardDimensionalShadowSubmitBridge(options) { return createBridge(options, true, false, true, true, true, true, true, true); }
/** Selected original one-layer dimensional RGBA8 surfaces; production remains gated. */
export function createVirglStandardDimensionalColorSurfaceSubmitBridge(options) { return createBridge(options, true, false, true, true, true, true, true, true, true); }

/** Selected original one-layer cube/array depth rendering; capsets remain gated. */
export function createVirglStandardDimensionalDepthSurfaceSubmitBridge(options) { return createBridge(options, true, false, true, true, true, true, true, true, true, true); }

export function createVirglStandardStreamOutputSubmitBridge(options) {return createBridge(options, true, false, true, true, true, true, true, true, true, true, true);}

/** Qualified production composition. Its caller must install the typed capset only after host qualification succeeds. */
export function createVirglProductionBridge(options) { return createBridge(options, true, true, true, true, true, true, true, true, true, true, true, true); }

export function createVirglScanoutBridge(options) { return createBridge(options, true, true); }

function createBridge(options, asynchronous, scanoutEnabled = false, desktop = false, dimensional = false, dimensionalViews = false, dimensionalDepth = false, dimensionalDepthViews = false, dimensionalShadows = false, dimensionalColorSurfaces = false, dimensionalDepthSurfaces = false, streamOutput = false, production = false) {
  let owners = null;
  try {
    const byteLimit = production ? 33554432 : 4194304;
    const config = record(options, ['gl', 'shaderBridge', 'resourceLimits', 'stateLimits', ...(asynchronous ? ['transport', 'jobLimits', 'drawLimits'] : []), ...(scanoutEnabled ? ['presenter'] : [])], ['gl', 'shaderBridge', ...(asynchronous ? ['transport'] : []), ...(scanoutEnabled ? ['presenter'] : [])]);
    if (scanoutEnabled) { const methods = config.presenter; need(methods && typeof methods === 'object', 'invalid-parameter', 'Missing presenter capability.');
      for (const key of ['rebind','enqueueOwned','inspect','readPixels','dispose']) need(typeof methods[key] === 'function', 'invalid-parameter', 'Invalid presenter capability.'); }
    const transport = asynchronous ? record(config.transport, ['gatherInput', 'scatterOutput', 'complete', ...(dimensional ? ['gatherLayeredInput', 'scatterLayeredOutput'] : [])]) : null;
    if (asynchronous) for (const key of Object.keys(transport)) need(typeof transport[key] === 'function', 'invalid-parameter', 'Missing transport method.');
    const fresh = () => {
      const { backend } = unwrap((production ? createProductionTransferBackend : dimensionalDepthViews ? createStandardDimensionalDepthViewTransferBackend : dimensionalDepth ? createStandardDimensionalDepthTransferBackend : dimensionalViews ? createStandardDimensionalViewTransferBackend : dimensional ? createStandardDimensionalTransferBackend : desktop ? createStandardPackedDepthTransferBackend : createWebGL2TransferBackend)(config.gl));
      let store;
      try {
        const created = unwrap((production ? createProductionResourceStore : streamOutput ? createStandardStreamOutputResourceStore : dimensionalDepthSurfaces ? createStandardDimensionalDepthSurfaceResourceStore : dimensionalColorSurfaces ? createStandardDimensionalColorSurfaceResourceStore : dimensionalDepthViews ? createStandardDimensionalDepthViewResourceStore : dimensionalDepth ? createStandardDimensionalDepthResourceStore : dimensionalViews ? createStandardDimensionalViewResourceStore : dimensional ? createStandardDimensionalResourceStore : desktop ? createStandardDesktopResourceStore : createResourceStore)({ backend, ...(config.resourceLimits === undefined ? {} : { limits: config.resourceLimits }) }));
        store = created.store;
        const { renderer } = unwrap((production ? createVirglProductionAsyncRenderer : streamOutput ? createVirglStandardStreamOutputAsyncRenderer : dimensionalDepthSurfaces ? createVirglStandardDimensionalDepthSurfaceAsyncRenderer : dimensionalColorSurfaces ? createVirglStandardDimensionalColorSurfaceAsyncRenderer : dimensionalShadows ? createVirglStandardDimensionalShadowAsyncRenderer : dimensionalDepthViews ? createVirglStandardDimensionalDepthViewAsyncRenderer : dimensionalViews ? createVirglStandardDimensionalViewAsyncRenderer : dimensional ? createVirglStandardDimensionalAsyncRenderer : desktop ? createVirglStandardShadowSamplerAsyncRenderer : asynchronous ? createVirglAsyncRenderer : createVirglStateRenderer)({ gl: config.gl, shaderBridge: config.shaderBridge,
          ...(production ? {primitiveAssembly: "lists"} : {}),
          ...(streamOutput ? {streamOutputAccess: created.streamOutputAccess} : {}),
          ...(desktop ? { uniformAccess: created.uniformAccess, imageAccess: created.imageAccess } : {}),
          resources: store, bindings: created.bindings, ...(asynchronous ? { asyncAccess: created.asyncAccess, ...(config.jobLimits === undefined ? {} : { jobLimits: config.jobLimits }), ...(config.drawLimits === undefined ? {} : { drawLimits: config.drawLimits }) } : {}), ...(config.stateLimits === undefined ? {} : { limits: config.stateLimits }) }));
        return Object.freeze({ store, renderer, bindings: created.bindings, ...(asynchronous ? { asyncAccess: created.asyncAccess } : {}) });
      } catch (error) { if (store) store.dispose(); else backend.dispose(); throw error; }
    };
    owners = fresh();
    let epoch = '0000000000000001', highestGeneration = '0000000000000000', poisoned = false, disposed = false, busy = false;
    const contexts = new Map(), resources = new Map();
    let pending = null, lastSequence = null, lastFailure = null, lastRendererResult = null;
    const counters = { begun: 0, completed: 0, failed: 0, cancelled: 0, exchanges: 0, inputBytes: 0, outputBytes: 0, pumps: 0, draws: 0 };
    const resolve = (map, token, code) => {
      const found = map.get(token.id);
      need(found && found.transport.generation === token.generation, code, 'Unknown or stale transport identity.');
      return found;
    };
    const scanout = scanoutEnabled ? createRetainedScanout({ getOwners: () => owners, resolveResource: (token) => resolve(resources, token, 'invalid-resource-id'),
      presenter: config.presenter, production, onFault: (error) => { poisoned = true; lastFailure = { code: 'bridge-poisoned', message: String(error?.message ?? error) }; } }) : null;
    const scanoutResult = (result) => { if (!result?.ok) throw new Fault(result?.error?.code ?? 'bridge-poisoned', result?.error?.message ?? 'Scanout operation failed.'); return result; };
    const newIdentity = (map, token, code) => {
      need(!map.has(token.id) && token.generation > highestGeneration, code, 'Duplicate or stale creation identity.');
    };
    const cleanup = () => {
      // Try both owners even if teardown fails; failed reset remains poisoned.
      let error;
      try { if (scanout) scanoutResult(scanout.reset()); } catch (caught) { error = caught; }
      try { unwrap(owners.renderer.dispose()); } catch (caught) { error = caught; }
      try { unwrap(owners.store.dispose()); } catch (caught) { error ??= caught; }
      if (error) throw error;
    };
    const beginJob = (event) => {
      need(lastSequence === null || event.sequence > lastSequence, 'invalid-parameter', 'Stale request sequence.');
      const accepted = new Map();
      for (const entry of event.resources) {
        const current = resolve(resources, entry.identity, 'invalid-resource-id');
        need(META.every((key) => current.metadata[key] === entry.metadata[key]), 'invalid-parameter', 'Accepted metadata differs from allocation.');
        if (entry.backing !== null) need(current.backing && current.backing.transportGeneration === entry.backing.generation &&
          current.backing.byteLength === entry.backing.byteLength, 'invalid-parameter', 'Accepted backing differs from attachment.');
        else need(!current.backing, 'invalid-parameter', 'Unexpected attached backing.');
        accepted.set(entry.identity.id, { transport: entry.identity, storageGeneration: current.storageGeneration,
          backing: current.backing ? { ...current.backing } : null });
      }
      let temporary = null;
      if (production && event.kind === 'transfer' && !contexts.get(event.context.id).resources.has(event.transfer.resourceId)) {
        temporary = {context:event.context.id,resource:event.transfer.resourceId};
        unwrap(owners.store.attachContext(temporary.context,temporary.resource));
      }
      const commands = event.kind === 'commands' ? event.commands : transferCommands(event.transfer);
      const started = owners.renderer.beginSubmission(event.context.id, commands, { contextId: event.context.id });
      if (!started.ok) { if (temporary) unwrap(owners.store.detachContext(temporary.context,temporary.resource)); return fail(mappedCode(started.error.code), started.error.message); }
      pending = { epoch: event.epoch, sequence: event.sequence, context: event.context, job: started.job, accepted,
        temporary, exchangeSequence: '0000000000000000', cancelled: false, status: 'ready', appliedCommands: 0, draws: 0 };
      lastSequence = event.sequence; counters.begun++; return ok();
    };
    const dmaArgs = (job, request) => {
      const resource = job.accepted.get(request.resource.id), current = resources.get(request.resource.id);
      need(resource && current && resource.transport.generation === current.transport.generation && resource.backing && current.backing,
        'invalid-resource-id', 'DMA resource is not in the accepted request.');
      need(request.resource.generation === resource.storageGeneration && current.storageGeneration === resource.storageGeneration &&
        request.backingGeneration === resource.backing.rendererGeneration && current.backing.rendererGeneration === resource.backing.rendererGeneration &&
        current.backing.transportGeneration === resource.backing.transportGeneration, 'invalid-parameter', 'Stale renderer or transport backing identity.');
      const rows = request.layout;
      for (const value of [rows.offset, rows.rowBytes, rows.rowStride, rows.rowCount, rows.tightBytes]) uint(value);
      const layered = Object.hasOwn(rows, 'layerCount');
      if (layered) {
        need(dimensional, 'invalid-parameter', 'Layered DMA requires its selected native transport.');
        uint(rows.layerStride); uint(rows.layerCount);
        need(rows.rowCount > 0 && rows.rowCount <= 16384 && rows.rowBytes > 0 && rows.rowStride >= rows.rowBytes &&
          rows.layerCount > 0 && rows.layerCount <= 2048 && rows.rowStride * rows.rowCount <= 0xffffffff &&
          rows.layerStride >= rows.rowStride * rows.rowCount && rows.rowBytes * rows.rowCount <= byteLimit &&
          rows.tightBytes === rows.rowBytes * rows.rowCount * rows.layerCount && rows.tightBytes <= byteLimit &&
          rows.offset + (rows.layerCount - 1) * rows.layerStride + (rows.rowCount - 1) * rows.rowStride + rows.rowBytes <= resource.backing.byteLength,
        'invalid-parameter', 'Invalid layered DMA row layout.');
        return [job.epoch, job.sequence, nextHex(job.exchangeSequence), resource.transport.id, resource.transport.generation,
          resource.backing.transportGeneration, BigInt(rows.offset).toString(16).padStart(16, '0'), rows.rowBytes, rows.rowStride, rows.rowCount,
          rows.layerStride, rows.layerCount];
      }
      need(rows.rowCount > 0 && rows.rowBytes > 0 && rows.rowStride >= rows.rowBytes && rows.tightBytes === rows.rowBytes * rows.rowCount &&
        rows.tightBytes <= byteLimit && rows.offset + (rows.rowCount - 1) * rows.rowStride + rows.rowBytes <= resource.backing.byteLength,
        'invalid-parameter', 'Invalid dense DMA row layout.');
      return [job.epoch, job.sequence, nextHex(job.exchangeSequence), resource.transport.id, resource.transport.generation,
        resource.backing.transportGeneration, BigInt(rows.offset).toString(16).padStart(16, '0'), rows.rowBytes, rows.rowStride, rows.rowCount];
    };
    const post = (job, code, gpuComplete, appliedCommands, draws) => {
      const result = transport.complete(job.epoch, job.sequence, job.exchangeSequence, code, gpuComplete, appliedCommands, draws);
      need(result === undefined, 'bridge-poisoned', 'Completion method must return synchronously.');
    };
    const pump = () => {
      if (busy || disposed) return fail('bridge-poisoned', 'Bridge is busy or disposed.');
      if (!pending) return poisoned ? fail('bridge-poisoned', 'Bridge requires reset.') : Object.freeze({ ok: true, status: 'idle' });
      if (poisoned && !pending.cancelled) return fail('bridge-poisoned', 'Bridge requires reset.');
      busy = true; counters.pumps++;
      const job = pending;
      try {
        const state = job.scanout ? scanoutResult(scanout.step(job.job)) : unwrap(owners.renderer.step(job.job)); job.status = state.status; job.appliedCommands = state.appliedCommands;
        need(!job.scanout || !poisoned || job.cancelled, 'bridge-poisoned', 'Scanout ownership retirement failed.');
        if (state.status === 'done') {
          if (job.temporary) { unwrap(owners.store.detachContext(job.temporary.context,job.temporary.resource)); job.temporary=null; }
          if (streamOutput) lastRendererResult = state.result;
          if (!job.cancelled) {
            const result = state.result; job.appliedCommands = result.appliedCommands; job.draws = result.draws.length;
            const uncertain = result.gpuComplete !== true;
            need(!result.ok || !uncertain, 'bridge-poisoned', 'Success requires completed GPU work.');
            if (uncertain) { poisoned = true; lastFailure = { code: result.error.code, message: result.error.message }; }
            const code = uncertain ? 6 : result.ok ? 0 : outcomeCode(mappedCode(result.error.code));
            post(job, code, result.gpuComplete, result.appliedCommands, result.draws.length);
            counters.completed++; counters.draws += result.draws.length; if (!result.ok) counters.failed++;
          }
          pending = null; return Object.freeze({ ok: true, status: job.cancelled ? 'cancelled' : 'completed', result: state.result });
        }
        if (state.status === 'needs-input') {
          const args = dmaArgs(job, state.request), input = bytes(args.length === 12 ? transport.gatherLayeredInput(...args) : transport.gatherInput(...args));
          need(input.byteLength === state.request.layout.tightBytes, 'bridge-poisoned', 'Rust gather returned the wrong byte count.');
          job.exchangeSequence = args[2];
          unwrap(owners.renderer.provideInput(job.job, state.request.token, input));
          counters.exchanges++; counters.inputBytes += input.byteLength;
        } else if (state.status === 'needs-output') {
          const request = state.request, args = dmaArgs(job, request);
          // Validate the current exchange immediately before the irreversible bus scatter.
          const current = unwrap(owners.renderer.step(job.job));
          need(current.status === 'needs-output' && current.request === request, 'bridge-poisoned', 'Output request changed before scatter.');
          const result = args.length === 12 ? transport.scatterLayeredOutput(...args, new Uint8Array(bytes(request.bytes))) : transport.scatterOutput(...args, new Uint8Array(bytes(request.bytes)));
          need(result === undefined, 'bridge-poisoned', 'Scatter must return synchronously.');
          job.exchangeSequence = args[2];
          unwrap(owners.renderer.acknowledgeOutput(job.job, request.token));
          counters.exchanges++; counters.outputBytes += request.bytes.byteLength;
        }
        return Object.freeze({ ok: true, status: state.status, epoch: job.epoch, sequence: job.sequence, exchangeSequence: job.exchangeSequence, appliedCommands: state.appliedCommands });
      } catch (error) {
        const diagnostic = owners.renderer.inspect();
        if (!job.scanout && diagnostic.ok && diagnostic.jobs?.active) { job.appliedCommands = diagnostic.jobs.appliedCommands; job.draws = diagnostic.jobs.draws; }
        poisoned = true; lastFailure = { code: 'bridge-poisoned', message: error instanceof Error ? error.message : 'Host exchange failed.' };
        // Core accepts outcome6/false against its actual consumed exchange counter,
        // even if a trusted wrapper threw after committing a scatter.
        if (!job.cancelled) {
          try { post(job, 6, false, job.appliedCommands, job.draws); counters.completed++; counters.failed++; }
          catch { lastFailure.completionRejected = true; }
          const cancelled = job.scanout ? scanout.cancel(job.job) : owners.renderer.cancel(job.job);
          if (cancelled.ok) { job.cancelled = true; counters.cancelled++; } else pending = null;
        }
        return fail('bridge-poisoned', 'Host exchange failed; reset required.');
      } finally { busy = false; }
    };
    const bridge = {
      apply(input) {
        if (busy) return fail('bridge-poisoned', 'Reentrant bridge operation.');
        if (disposed) return fail('bridge-poisoned', 'Bridge is disposed.');
        busy = true;
        let event;
        try {
          try { event = scanoutEnabled && ['bindScanout','beginScanout'].includes(Object.getOwnPropertyDescriptor(input, 'type')?.value) ? normalizeScanoutEvent(input, production) : asynchronous && (Object.getOwnPropertyDescriptor(input, 'type')?.value === 'beginJob' || Object.getOwnPropertyDescriptor(input, 'type')?.value === 'cancelJob') ? normalizeJob(input, production ? PRODUCTION_RESOURCE_LIMITS.resources : desktop ? 64 : 16, byteLimit, production) : normalize(input, asynchronous, byteLimit, production ? PRODUCTION_RESOURCE_LIMITS.segments : 256); }
          catch (error) { return fail(error instanceof Fault ? error.code : 'invalid-parameter', 'Malformed control event.'); }
          if (event.type === 'reset') {
            need(BigInt('0x' + event.epoch) === BigInt('0x' + epoch) + 1n, 'invalid-parameter', 'Reset epoch must advance once.');
            poisoned = true; epoch = event.epoch; contexts.clear(); resources.clear(); pending = null; lastSequence = null; lastFailure = null; lastRendererResult = null;
            cleanup(); owners = fresh();
            // A callback may have applied before throwing, so Rust can reuse that
            // uncommitted generation. The new epoch invalidates its old identity.
            highestGeneration = '0000000000000000'; poisoned = false; return ok();
          }
          need(event.epoch === epoch, 'invalid-parameter', 'Stale transport epoch.');
          if (event.type === 'cancelJob') {
            need(pending && pending.epoch === event.epoch && pending.sequence === event.sequence && !pending.cancelled, 'invalid-parameter', 'Unknown or consumed cancellation.');
            if (pending.scanout) scanoutResult(scanout.cancel(pending.job)); else unwrap(owners.renderer.cancel(pending.job)); pending.cancelled = true; poisoned = true; counters.cancelled++; return ok();
          }
          need(!poisoned, 'bridge-poisoned', 'Bridge requires reset.');
          need(pending === null, 'bridge-poisoned', 'Control operation overlaps a pending job.');
          const { store, renderer } = owners;
          const context = event.context, resource = event.resource;
          if (context && event.type !== 'createContext') resolve(contexts, context, 'invalid-context-id');
          if (resource && event.type !== 'createResource') resolve(resources, resource, 'invalid-resource-id');
          switch (event.type) {
            case 'bindScanout': {
              const result = scanout.bind(event);
              need(!poisoned, 'bridge-poisoned', 'Scanout ownership replacement failed.');
              return scanoutResult(result);
            }
            case 'beginScanout': {
              need(lastSequence === null || event.sequence > lastSequence, 'invalid-parameter', 'Stale request sequence.');
              const started = scanoutResult(scanout.begin(event));
              pending = { epoch: event.epoch, sequence: event.sequence, scanout: true, job: started.job, exchangeSequence: '0000000000000000', cancelled: false, status: 'ready', appliedCommands: 0, draws: 0 };
              lastSequence = event.sequence; counters.begun++; return ok();
            }
            case 'beginJob': return beginJob(event);
            case 'createContext': {
              newIdentity(contexts, context, 'invalid-context-id');
              const created = unwrap(store.createContext(context.id));
              try { unwrap(renderer.createContext(context.id)); }
              catch (error) { if (!store.destroyContext(context.id).ok) { poisoned = true; throw new Fault('bridge-poisoned', 'Context rollback failed.'); } throw error; }
              contexts.set(context.id, { transport: context, storageGeneration: created.context.generation, resources:new Set() });
              highestGeneration = context.generation; break;
            }
            case 'destroyContext':
              // Any teardown error is uncertain: do not continue with split ownership.
              if (!renderer.destroyContext(context.id).ok || !store.destroyContext(context.id).ok) {
                poisoned = true; throw new Fault('bridge-poisoned', 'Context teardown failed.');
              }
              contexts.delete(context.id); break;
            case 'createResource': {
              newIdentity(resources, resource, 'invalid-resource-id');
              const created = unwrap(store.createResource(event.metadata));
              resources.set(resource.id, { transport: resource, storageGeneration: created.resource.generation, metadata: { ...event.metadata } });
              highestGeneration = resource.generation; break;
            }
            case 'attachResource': unwrap(store.attachContext(context.id, resource.id)); contexts.get(context.id).resources.add(resource.id); break;
            case 'detachResource': unwrap(store.detachContext(context.id, resource.id)); contexts.get(context.id).resources.delete(resource.id); break;
            case 'attachBacking': {
              unwrap(store.attachBacking(resource.id, event.segments.map((s) => s.data)));
              if (asynchronous) {
                const current = resources.get(resource.id);
                try {
                  const described = unwrap(owners.asyncAccess.describeBacking(resource.id));
                  need(described.resource.generation === current.storageGeneration, 'bridge-poisoned', 'Attached renderer generation disagrees.');
                  current.backing = { transportGeneration: event.backingGeneration, rendererGeneration: described.backingGeneration, byteLength: described.byteLength };
                } catch (error) { poisoned = true; throw error; }
              }
              break;
            }
            case 'detachBacking':
              if (asynchronous) need(resources.get(resource.id).backing?.transportGeneration === event.backingGeneration, 'invalid-parameter', 'Stale backing detach identity.');
              unwrap(store.detachBacking(resource.id)); if (asynchronous) resources.get(resource.id).backing = null; break;
            case 'unrefResource':
              if (!store.unref(resource.id).ok) { poisoned = true; throw new Fault('bridge-poisoned', 'Resource teardown failed.'); }
              resources.delete(resource.id); break;
          }
          return ok();
        } catch (error) {
          if (!(error instanceof Fault) || (event?.type === 'reset' && poisoned)) {
            poisoned = true; return fail('bridge-poisoned', 'Unexpected or incomplete host operation; reset required.');
          }
          return fail(error.code, error.message);
        } finally { busy = false; }
      },
      inspect() {
        return { epoch, highestGeneration, poisoned, disposed,
          ...(asynchronous ? { pending: pending ? { epoch: pending.epoch, sequence: pending.sequence, exchangeSequence: pending.exchangeSequence, cancelled: pending.cancelled, status: pending.status } : null, counters: { ...counters }, lastFailure } : {}),
          contexts: [...contexts.values()].map((v) => ({ transport: { ...v.transport }, storageGeneration: v.storageGeneration })),
          resources: [...resources.values()].map((v) => ({ transport: { ...v.transport }, storageGeneration: v.storageGeneration, ...(asynchronous ? { backing: v.backing ? { ...v.backing } : null } : {}) })),
          ...(scanout ? { scanout: scanout.inspect() } : {}),
          ...(streamOutput ? {lastRendererResult} : {}), store: owners.store.inspect(), renderer: owners.renderer.inspect() };
      },
      dispose() {
        if (busy) return fail('bridge-poisoned', 'Reentrant disposal.');
        if (disposed) return ok();
        busy = true; disposed = true; poisoned = true; contexts.clear(); resources.clear(); pending = null;
        try { cleanup(); if (scanout) scanoutResult(scanout.dispose()); return ok(); }
        catch { return fail('bridge-poisoned', 'Host teardown failed.'); }
        finally { busy = false; }
      },
    };
    if (asynchronous) bridge.pump = pump;
    if (production) {
      const checkpointReady = () => {
        need(!busy && !disposed && !poisoned && pending === null && !config.gl.isContextLost(),
          'bridge-poisoned','Checkpoint requires a healthy idle renderer.');
        const display=scanout.inspect();
        need(display.activeCaptures===0 && display.retainedFrames===0 && display.presenter.retainedFrames===0,
          'invalid-parameter','Checkpoint requires drained presentation.');
      };
      bridge.checkpointState = () => {
        let owned=false;
        try {
          checkpointReady();busy=true;owned=true;
          const queries=unwrap(owners.renderer.checkpointQueryState()).queries;
          const contents=unwrap(owners.store.checkpointContents());
          const store=unwrap(owners.store.inspect()), renderer=unwrap(owners.renderer.inspect());
          return Object.freeze({ok:true,contents,logical:{epoch,highestGeneration,lastSequence,
            contexts:[...contexts.values()].map(v=>({transport:v.transport,storageGeneration:v.storageGeneration,resources:[...v.resources].sort((a,b)=>a-b)})),
            resources:[...resources.values()].map(v=>({transport:v.transport,storageGeneration:v.storageGeneration,metadata:v.metadata,backing:v.backing ?? null})),
            store:{resources:store.resources,contexts:store.contexts},renderer:renderer.contexts,queries,
            scanout:scanout.inspect().binding}});
        } catch(error) { return fail(error instanceof Fault?error.code:'invalid-parameter',String(error.message)); }
        finally { if(owned)busy=false; }
      };
      bridge.checkpointReady = () => {
        try { checkpointReady();unwrap(owners.renderer.checkpointQueryState());return ok(); }
        catch(error) { return fail(error instanceof Fault?error.code:'invalid-parameter',String(error.message)); }
      };
      bridge.rebaseCheckpointEpoch = (expected,next) => {
        try {
          checkpointReady();hex(expected);hex(next);
          need(expected===epoch && next>epoch && next!=='ffffffffffffffff','invalid-parameter','Stale checkpoint epoch rebase.');
          scanoutResult(scanout.rebaseCheckpointEpoch(expected,next));epoch=next;return ok();
        } catch(error) { return fail(error instanceof Fault?error.code:'invalid-parameter',String(error.message)); }
      };
      bridge.repairCheckpointScanout = async (cancelled=()=>false) => {
        let owned=false;
        try { need(typeof cancelled==='function','invalid-parameter','Invalid checkpoint cancellation capability.');checkpointReady();busy=true;owned=true;return scanoutResult(await scanout.repairCheckpointFrame(cancelled)); }
        catch(error) { return fail(error instanceof Fault?error.code:'invalid-parameter',String(error.message)); }
        finally { if(owned)busy=false; }
      };
    }
    if (scanout) bridge.present2D = (frame) => {
      if (busy || disposed || poisoned) return fail('bridge-poisoned', 'Bridge is not available for presentation.');
      busy = true; try { return scanout.present2D(frame); } finally { busy = false; }
    };
    Object.freeze(bridge);
    return Object.freeze({ ok: true, bridge, probes: Object.freeze({ owners: () => owners }) });
  } catch (error) { return fail(error instanceof Fault ? error.code : 'bridge-poisoned', error instanceof Fault ? error.message : 'Bridge construction failed.'); }
}
