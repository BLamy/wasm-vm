// Explicit proof presenter. The established presentation controller and scheduler stay unchanged.
import { PresentationController } from './presentation.js';

const MAX_BYTES = 268435456; // Existing ordinary 2D resource limit; renderer textures remain capped at 4 MiB.
const ok = (fields = {}) => Object.freeze({ ok: true, ...fields });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
class Fault extends Error { constructor(code, message) { super(message); this.code = code; } }
function need(value, message) { if (!value) throw new Fault('invalid-parameter', message); }
function record(value, keys, required = keys) {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected data record.');
  const descriptors = Object.getOwnPropertyDescriptors(value), result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    need(keys.includes(key) && Object.hasOwn(descriptors[key], 'value'), 'Unknown or accessor field.');
    result[key] = descriptors[key].value;
  }
  for (const key of required) need(Object.hasOwn(result, key), `Missing ${key}.`);
  return result;
}
function generation(value) { need(typeof value === 'string' && /^[0-9a-f]{16}$/.test(value), 'Expected exact hexadecimal generation.'); return value; }
function ownedFrame(input) {
  const f = record(input, ['scanout', 'format', 'rect', 'resourceWidth', 'resourceHeight', 'pixels']);
  need(f.scanout === 0 && (f.format === 1 || f.format === 2), 'Unsupported presentation scanout or format.');
  const width = f.resourceWidth, height = f.resourceHeight;
  need(Number.isSafeInteger(width) && width > 0 && width <= 16384 && Number.isSafeInteger(height) && height > 0 && height <= 16384 && width * height <= MAX_BYTES / 4, 'Frame dimensions exceed the bounded profile.');
  const rect = record(f.rect, ['x', 'y', 'width', 'height']);
  need(Object.values(rect).every(Number.isSafeInteger) && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= width && rect.y + rect.height <= height, 'Invalid frame damage.');
  const proto = Object.getPrototypeOf(Uint32Array.prototype);
  need(Object.getOwnPropertyDescriptor(proto, Symbol.toStringTag).get.call(f.pixels) === 'Uint32Array', 'Expected owned Uint32Array pixels.');
  const buffer = Object.getOwnPropertyDescriptor(proto, 'buffer').get.call(f.pixels);
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(buffer);
  const offset = Object.getOwnPropertyDescriptor(proto, 'byteOffset').get.call(f.pixels), length = Object.getOwnPropertyDescriptor(proto, 'length').get.call(f.pixels);
  need(length === width * height, 'Pixel count differs from frame dimensions.');
  return Object.freeze({ ...f, rect: Object.freeze(rect), pixels: new Uint32Array(buffer, offset, length) });
}

/** enqueueOwned transfers trusted host ownership; callers must not mutate accepted pixels. */
export function createVirglScanoutPresenter(options) {
  let controller;
  try {
    const config = record(options, ['canvas', 'requestFrame', 'cancelFrame', 'controllerOptions'], ['canvas']);
    const controllerOptions = record(config.controllerOptions ?? {}, ['defaultBackend', 'width', 'height', 'canvas2dOptions', 'webgl2Options', 'backendFactories'], []);
    const requestFrame = config.requestFrame ?? globalThis.requestAnimationFrame?.bind(globalThis);
    const cancelFrame = config.cancelFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis);
    need(typeof requestFrame === 'function' && typeof cancelFrame === 'function', 'Animation frame callbacks are required.');
    let bindingGeneration = '0000000000000000', pending = null, scheduled = null, delivery = null, disposed = false, busy = false;
    const errors = [], remember = (message) => { errors.push(message); if (errors.length > 256) errors.shift(); }, counters = { queued: 0, drawn: 0, superseded: 0, cancelled: 0, failed: 0,
      controllerOwnershipCopyBytes: 0, presentationUploadBytes: 0, backendStagingCopyBytes: 0, imageDataCopyBytes: 0 };
    controller = new PresentationController(config.canvas, { ...controllerOptions, scheduleFrames: false,
      onPresent(record) { if (delivery && record.drawn) delivery.presentation = record; } });
    const settle = (entry, status) => {
      if (entry.settled) return;
      entry.settled = true; counters[status]++; entry.frame = null;
      try { entry.onRetired(Object.freeze({ token: entry.token, status, ...(entry.presentation ? { presentation: entry.presentation } : {}) })); }
      catch (error) { remember(`retirement callback: ${String(error?.message ?? error)}`); }
      entry.onRetired = null;
    };
    const cancelScheduled = () => { const token = scheduled; scheduled = null; if (token) { token.active = false; cancelFrame(token.id); } };
    const deliver = (token) => {
      if (scheduled !== token || !token.active || disposed) return;
      scheduled = null; token.active = false;
      const entry = pending; pending = null;
      if (!entry) return;
      busy = true;
      try {
        if (entry.generation !== bindingGeneration) { settle(entry, 'cancelled'); return; }
        delivery = entry;
        counters.controllerOwnershipCopyBytes += entry.frame.pixels.byteLength;
        const accepted = controller.present(entry.frame);
        delivery = null;
        if (accepted && entry.presentation?.drawn) {
          const bytes = entry.presentation.bytes;
          counters.presentationUploadBytes += bytes;
          counters.backendStagingCopyBytes += entry.presentation.backend === 'webgl2' ? entry.frame.pixels.byteLength : bytes;
          if (entry.presentation.backend === 'canvas2d') counters.imageDataCopyBytes += bytes;
          settle(entry, 'drawn');
        } else settle(entry, 'failed');
      } catch (error) { remember(`delivery: ${String(error?.message ?? error)}`); settle(entry, 'failed'); }
      finally { delivery = null; busy = false; }
    };
    const operation = (fn) => (...args) => {
      if (disposed || busy) return fail('bridge-poisoned', 'Presenter is disposed or busy.');
      busy = true;
      try { return fn(...args); }
      catch (error) { return fail(error instanceof Fault ? error.code : 'unspecified', error instanceof Error ? error.message : 'Presenter operation failed.'); }
      finally { busy = false; }
    };
    const presenter = {
      rebind: operation((next) => {
        generation(next); need(next > bindingGeneration, 'Binding generation must advance.');
        // Clear retained recovery pixels before publishing the new binding.
        controller.clear(); cancelScheduled();
        const old = pending; pending = null; bindingGeneration = next;
        if (old) settle(old, 'cancelled');
        return ok();
      }),
      enqueueOwned: operation((input, onRetired) => {
        const value = record(input, ['bindingGeneration', 'frame']); generation(value.bindingGeneration);
        need(value.bindingGeneration === bindingGeneration && bindingGeneration !== '0000000000000000', 'Stale presentation binding.');
        need(typeof onRetired === 'function', 'Retirement callback is required.');
        const frame = ownedFrame(value.frame), entry = { generation: bindingGeneration, frame, token: Object.freeze({}), onRetired, settled: false, presentation: null };
        // Acquire the scheduler before replacing ownership. Synchronous fake callbacks are rejected.
        if (!scheduled) {
          const token = { active: true, id: null }; let arming = true, synchronous = false;
          try { token.id = requestFrame(() => { if (arming) synchronous = true; else deliver(token); }); }
          finally { arming = false; }
          if (synchronous) { token.active = false; cancelFrame(token.id); throw new Fault('invalid-parameter', 'Animation callback must be asynchronous.'); }
          scheduled = token;
        }
        const old = pending; pending = entry; counters.queued++;
        if (old) settle(old, 'superseded');
        return ok({ token: entry.token });
      }),
      inspect() { return Object.freeze({ disposed, bindingGeneration, ...counters, pending: pending ? 1 : 0,
        ownedBytes: pending?.frame?.pixels.byteLength ?? 0, scheduled: scheduled !== null, controller: controller.snapshot(), errors: [...errors] }); },
      readPixels: operation(() => ok({ bytes: controller.readPixels() })),
      get canvas() { return controller.canvas; },
      dispose() {
        if (busy) return fail('bridge-poisoned', 'Reentrant presenter disposal.');
        if (disposed) return ok();
        busy = true; disposed = true;
        try { cancelScheduled(); const old = pending; pending = null; if (old) settle(old, 'cancelled'); controller.clear(); controller.dispose(); return ok(); }
        catch (error) { return fail('unspecified', String(error?.message ?? error)); }
        finally { busy = false; }
      },
    };
    return ok({ presenter: Object.freeze(presenter) });
  } catch (error) { controller?.dispose(); return fail(error instanceof Fault ? error.code : 'invalid-parameter', String(error?.message ?? error)); }
}
