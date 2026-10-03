/** Proof-only synchronous VirtIO control adapter; no production capabilities or submissions. */
import { createResourceStore, createWebGL2TransferBackend } from './resources.mjs';
import { createVirglStateRenderer } from './state.mjs';

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
function normalize(input) {
  const common = record(input, ['epoch', 'type', 'context', 'resource', 'metadata', 'debugName', 'segments'], ['epoch', 'type']);
  need(typeof common.type === 'string' && Object.hasOwn(shapes, common.type), 'invalid-parameter', 'Unknown control operation.');
  const event = record(common, ['epoch', 'type', ...shapes[common.type]]);
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
    need(Array.isArray(event.segments) && event.segments.length > 0 && event.segments.length <= 256,
      'invalid-parameter', 'Invalid backing segment count.');
    let total = 0;
    event.segments = event.segments.map((value) => {
      const segment = record(value, ['address', 'length', 'data']);
      hex(segment.address); segment.data = bytes(segment.data);
      need(Number.isInteger(segment.length) && segment.length > 0 && segment.length === segment.data.byteLength &&
        BigInt('0x' + segment.address) + BigInt(segment.length) <= 0x10000000000000000n,
      'invalid-parameter', 'Invalid backing range.');
      total += segment.length;
      need(total <= 4194304, 'out-of-memory', 'Backing exceeds resource limit.');
      return segment;
    });
  }
  return event;
}
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
export function createVirglControlBridge(options) {
  let owners = null;
  try {
    const config = record(options, ['gl', 'shaderBridge', 'resourceLimits', 'stateLimits'], ['gl', 'shaderBridge']);
    const fresh = () => {
      const { backend } = unwrap(createWebGL2TransferBackend(config.gl));
      let store;
      try {
        const created = unwrap(createResourceStore({ backend, ...(config.resourceLimits === undefined ? {} : { limits: config.resourceLimits }) }));
        store = created.store;
        const { renderer } = unwrap(createVirglStateRenderer({ gl: config.gl, shaderBridge: config.shaderBridge,
          resources: store, bindings: created.bindings, ...(config.stateLimits === undefined ? {} : { limits: config.stateLimits }) }));
        return Object.freeze({ store, renderer, bindings: created.bindings });
      } catch (error) { if (store) store.dispose(); else backend.dispose(); throw error; }
    };
    owners = fresh();
    let epoch = '0000000000000001', highestGeneration = '0000000000000000', poisoned = false, disposed = false, busy = false;
    const contexts = new Map(), resources = new Map();
    const resolve = (map, token, code) => {
      const found = map.get(token.id);
      need(found && found.transport.generation === token.generation, code, 'Unknown or stale transport identity.');
      return found;
    };
    const newIdentity = (map, token, code) => {
      need(!map.has(token.id) && token.generation > highestGeneration, code, 'Duplicate or stale creation identity.');
    };
    const cleanup = () => {
      // Try both owners even if teardown fails; failed reset remains poisoned.
      let error;
      try { unwrap(owners.renderer.dispose()); } catch (caught) { error = caught; }
      try { unwrap(owners.store.dispose()); } catch (caught) { error ??= caught; }
      if (error) throw error;
    };
    const bridge = Object.freeze({
      apply(input) {
        if (busy) return fail('bridge-poisoned', 'Reentrant bridge operation.');
        if (disposed) return fail('bridge-poisoned', 'Bridge is disposed.');
        busy = true;
        let event;
        try {
          try { event = normalize(input); }
          catch (error) { return fail(error instanceof Fault ? error.code : 'invalid-parameter', 'Malformed control event.'); }
          if (event.type === 'reset') {
            need(BigInt('0x' + event.epoch) === BigInt('0x' + epoch) + 1n, 'invalid-parameter', 'Reset epoch must advance once.');
            poisoned = true; epoch = event.epoch; contexts.clear(); resources.clear();
            cleanup(); owners = fresh();
            // A callback may have applied before throwing, so Rust can reuse that
            // uncommitted generation. The new epoch invalidates its old identity.
            highestGeneration = '0000000000000000'; poisoned = false; return ok();
          }
          need(event.epoch === epoch, 'invalid-parameter', 'Stale transport epoch.');
          need(!poisoned, 'bridge-poisoned', 'Bridge requires reset.');
          const { store, renderer } = owners;
          const context = event.context, resource = event.resource;
          if (context && event.type !== 'createContext') resolve(contexts, context, 'invalid-context-id');
          if (resource && event.type !== 'createResource') resolve(resources, resource, 'invalid-resource-id');
          switch (event.type) {
            case 'createContext': {
              newIdentity(contexts, context, 'invalid-context-id');
              const created = unwrap(store.createContext(context.id));
              try { unwrap(renderer.createContext(context.id)); }
              catch (error) { if (!store.destroyContext(context.id).ok) { poisoned = true; throw new Fault('bridge-poisoned', 'Context rollback failed.'); } throw error; }
              contexts.set(context.id, { transport: context, storageGeneration: created.context.generation });
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
              resources.set(resource.id, { transport: resource, storageGeneration: created.resource.generation });
              highestGeneration = resource.generation; break;
            }
            case 'attachResource': unwrap(store.attachContext(context.id, resource.id)); break;
            case 'detachResource': unwrap(store.detachContext(context.id, resource.id)); break;
            case 'attachBacking': unwrap(store.attachBacking(resource.id, event.segments.map((s) => s.data))); break;
            case 'detachBacking': unwrap(store.detachBacking(resource.id)); break;
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
          contexts: [...contexts.values()].map((v) => ({ transport: { ...v.transport }, storageGeneration: v.storageGeneration })),
          resources: [...resources.values()].map((v) => ({ transport: { ...v.transport }, storageGeneration: v.storageGeneration })),
          store: owners.store.inspect(), renderer: owners.renderer.inspect() };
      },
      dispose() {
        if (busy) return fail('bridge-poisoned', 'Reentrant disposal.');
        if (disposed) return ok();
        busy = true; disposed = true; poisoned = true; contexts.clear(); resources.clear();
        try { cleanup(); return ok(); }
        catch { return fail('bridge-poisoned', 'Host teardown failed.'); }
        finally { busy = false; }
      },
    });
    return Object.freeze({ ok: true, bridge, probes: Object.freeze({ owners: () => owners }) });
  } catch (error) { return fail(error instanceof Fault ? error.code : 'bridge-poisoned', error instanceof Fault ? error.message : 'Bridge construction failed.'); }
}
