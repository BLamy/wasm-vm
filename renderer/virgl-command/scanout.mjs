/** Retained proof scanout: guest completion and actual canvas retirement are separate. */
const ok = (fields = {}) => Object.freeze({ ok: true, ...fields });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
class Fault extends Error { constructor(code, message) { super(message); this.code = code; } }
function need(value, message, code = 'invalid-parameter') { if (!value) throw new Fault(code, message); }
function record(value, keys, required = keys) {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected data record.');
  const ds = Object.getOwnPropertyDescriptors(value), out = {};
  for (const key of Reflect.ownKeys(ds)) { need(keys.includes(key) && Object.hasOwn(ds[key], 'value'), 'Unknown or accessor field.'); out[key] = ds[key].value; }
  for (const key of required) need(Object.hasOwn(out, key), `Missing ${key}.`);
  return out;
}
const uint = (v) => { need(Number.isInteger(v) && v >= 0 && v <= 0xffffffff, 'Expected u32.'); return v; };
const hex = (v) => { need(typeof v === 'string' && /^[0-9a-f]{16}$/.test(v), 'Expected exact hexadecimal u64.'); return v; };
const nextHex = (v) => { const n = BigInt('0x' + v) + 1n; need(n <= 0xffffffffffffffffn, 'Presentation generation exhausted.'); return n.toString(16).padStart(16, '0'); };
const META = ['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
function identity(value) { const id = record(value, ['id','generation']); need(uint(id.id) > 0 && hex(id.generation) !== '0000000000000000', 'Invalid resource identity.'); return Object.freeze(id); }
function binding(value) {
  const b = record(value, ['generation','rect','target']); need(hex(b.generation) !== '0000000000000000', 'Binding generation must be nonzero.');
  b.rect = record(b.rect, ['x','y','width','height']); Object.values(b.rect).forEach(uint);
  const kind = Object.getOwnPropertyDescriptor(b.target, 'kind')?.value;
  if (kind === 'disabled') b.target = record(b.target, ['kind']);
  else if (kind === '2d') {
    b.target = record(b.target, ['kind','resourceId','format','width','height']);
    for (const key of ['resourceId','format','width','height']) need(uint(b.target[key]) > 0, 'Invalid 2D target.');
    need((b.target.format === 1 || b.target.format === 2) && b.target.width <= 16384 && b.target.height <= 16384 && b.target.width * b.target.height <= 67108864, 'Unsupported 2D target.');
    need(b.rect.width > 0 && b.rect.height > 0 && b.rect.x + b.rect.width <= b.target.width && b.rect.y + b.rect.height <= b.target.height, '2D binding is out of bounds.');
  } else {
    need(kind === 'renderer', 'Unknown scanout target kind.');
    b.target = record(b.target, ['kind','resource','metadata']); b.target.resource = identity(b.target.resource);
    const m = b.target.metadata = record(b.target.metadata, META); Object.values(m).forEach(uint); Object.freeze(m);
    need(m.id === b.target.resource.id && m.target === 2 && m.format === 67 && m.bind === 10 && m.depth === 1 && m.arraySize === 1 && m.lastLevel === 0 && m.nrSamples === 0 && m.flags === 0 && m.width > 0 && m.height > 0 && m.width * m.height <= 1048576, 'Unsupported renderer scanout.');
    need(b.rect.x === 0 && b.rect.y === 0 && b.rect.width === m.width && b.rect.height === m.height, 'Only whole-resource renderer scanout is supported.');
  }
  Object.freeze(b.rect); Object.freeze(b.target); return Object.freeze(b);
}
export function normalizeScanoutEvent(input) {
  const type = Object.getOwnPropertyDescriptor(input, 'type')?.value;
  need(type === 'bindScanout' || type === 'beginScanout', 'Unknown scanout event.');
  const event = record(input, type === 'bindScanout' ? ['type','epoch','binding'] : ['type','epoch','sequence','header','binding']);
  hex(event.epoch); event.binding = binding(event.binding);
  if (type === 'beginScanout') {
    hex(event.sequence); event.header = record(event.header, ['type','flags','fenceId','contextId','ringIndex']);
    for (const key of ['type','flags','contextId','ringIndex']) uint(event.header[key]); hex(event.header.fenceId);
    need(event.header.type === 0x104 && (event.header.flags === 0 || event.header.flags === 1) && event.header.contextId === 0 && event.header.ringIndex === 0 && event.binding.target.kind === 'renderer', 'Invalid scanout flush header.');
  }
  if (event.header) Object.freeze(event.header); return Object.freeze(event);
}
function sameBinding(a, b) {
  return a.generation === b.generation && ['x','y','width','height'].every((k) => a.rect[k] === b.rect[k]) && a.target.kind === b.target.kind &&
    a.target.resource.id === b.target.resource.id && a.target.resource.generation === b.target.resource.generation && META.every((k) => a.target.metadata[k] === b.target.metadata[k]);
}
function unwrap(value) {
  if (!value?.ok) throw new Fault(['limit-exceeded','backend-error'].includes(value?.error?.code) ? 'out-of-memory' : 'invalid-parameter', value?.error?.message ?? 'Scanout dependency failed.');
  return value;
}
function pixelWords(value) {
  const proto = Object.getPrototypeOf(Uint32Array.prototype);
  need(Object.getOwnPropertyDescriptor(proto, Symbol.toStringTag).get.call(value) === 'Uint32Array', 'Expected Uint32Array words.');
  const buffer = Object.getOwnPropertyDescriptor(proto, 'buffer').get.call(value);
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(buffer);
  const offset = Object.getOwnPropertyDescriptor(proto, 'byteOffset').get.call(value), length = Object.getOwnPropertyDescriptor(proto, 'length').get.call(value);
  return new Uint32Array(buffer, offset, length);
}
function convertRgba(bytes, width, height) {
  need(bytes instanceof Uint8Array && bytes.byteLength === width * height * 4 && bytes.byteOffset % 4 === 0, 'Invalid RGBA readback size.');
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, width * height);
  // The renderer returns little-endian RGBA; the established browser contract is BGRA words.
  for (let i = 0; i < words.length; i++) { const word = words[i]; words[i] = (word & 0xff00ff00) | ((word & 255) << 16) | ((word >>> 16) & 255); }
  for (let row = 0; row < Math.floor(height / 2); row++) {
    const sourceRow = height - 1 - row;
    for (let x = 0; x < width; x++) { const a = row * width + x, b = sourceRow * width + x, temporary = words[a]; words[a] = words[b]; words[b] = temporary; }
  }
  return words;
}

export function createRetainedScanout({ getOwners, resolveResource, presenter, onFault }) {
  let current = null, localGeneration = '0000000000000000', disposed = false;
  const jobs = new Set(), held = new Set(), retirements = [];
  const counters = { bound: 0, captures: 0, captureReady: 0, queued: 0, drawn: 0, superseded: 0, cancelled: 0, failed: 0,
    readbackBytes: 0, rgbaConversionBytes: 0, rowMoveBytes: 0, borrowed2dCopyBytes: 0 };
  const retire = (entry, receipt) => {
    if (entry.retired) return;
    entry.retired = true; counters[receipt.status]++;
    if (entry.ticket) { held.delete(entry); unwrap(entry.owner.asyncAccess.release(entry.ticket)); entry.ticket = null; }
    retirements.push({ epoch: entry.epoch, sequence: entry.sequence ?? null, bindingGeneration: entry.binding.generation,
      resource: entry.binding.target.kind === 'renderer' ? entry.binding.target.resource : { id: entry.binding.target.resourceId },
      status: receipt.status, presentation: receipt.presentation ?? null });
    if (retirements.length > 256) retirements.shift();
  };
  const safeRetire = (entry, receipt) => { try { retire(entry, receipt); } catch (error) { onFault(error); } };
  const dropBinding = () => { if (current?.lease) { unwrap(current.owner.store.releaseStorage(current.lease)); current.lease = null; } };
  const invalidate = () => { const next = nextHex(localGeneration); unwrap(presenter.rebind(next)); localGeneration = next; };
  const release = (entry) => { if (entry.ticket) { unwrap(entry.owner.asyncAccess.release(entry.ticket)); entry.ticket = null; held.delete(entry); } };
  const api = {
    bind(event) {
      need(!disposed, 'Scanout is disposed.', 'bridge-poisoned');
      need(!current || event.epoch !== current.epoch || event.binding.generation > current.binding.generation, 'Stale scanout binding.');
      const accepted = { epoch: event.epoch, binding: event.binding, owner: getOwners(), lease: null };
      if (event.binding.target.kind === 'renderer') {
        const target = event.binding.target, res = resolveResource(target.resource);
        need(META.every((key) => res.metadata[key] === target.metadata[key]), 'Scanout metadata differs from allocation.');
        accepted.lease = unwrap(accepted.owner.bindings.retainScanout(target.resource.id, res.storageGeneration)).lease;
      }
      try { invalidate(); } catch (error) { if (accepted.lease) accepted.owner.store.releaseStorage(accepted.lease); onFault(error); throw error; }
      try { dropBinding(); } catch (error) { if (accepted.lease) accepted.owner.store.releaseStorage(accepted.lease); onFault(error); throw error; }
      current = accepted; counters.bound++; return ok();
    },
    begin(event) {
      need(current && current.epoch === event.epoch && sameBinding(current.binding, event.binding), 'Flush refers to a stale binding.');
      resolveResource(event.binding.target.resource);
      need(jobs.size === 0 && held.size < 2, 'Scanout capture budget exceeded.', 'out-of-memory');
      const job = { epoch: event.epoch, sequence: event.sequence, binding: current.binding, owner: current.owner, lease: current.lease,
        ticket: null, phase: 'ready', cancelled: false, retired: false, presenterGeneration: localGeneration };
      jobs.add(job); return ok({ job });
    },
    step(job) {
      need(jobs.has(job), 'Unknown scanout job.');
      if (job.phase === 'ready') {
        if (job.cancelled) { jobs.delete(job); return ok({ status: 'done', result: { ok: false, error: { code: 'cancelled', message: 'Scanout cancelled.' }, gpuComplete: true, appliedCommands: 0, draws: [] } }); }
        const started = job.owner.asyncAccess.beginScanoutRead(job.lease);
        if (!started.ok) { jobs.delete(job); return ok({ status: 'done', result: { ...started, gpuComplete: started.error.code !== 'backend-error', appliedCommands: 0, draws: [] } }); }
        job.ticket = started.ticket; job.phase = 'waiting-gpu'; held.add(job); counters.captures++;
        return ok({ status: 'waiting-gpu', appliedCommands: 0 });
      }
      const polled = job.owner.asyncAccess.poll(job.ticket, job.cancelled);
      if (!polled.ok) { release(job); jobs.delete(job); return ok({ status: 'done', result: { ...polled, gpuComplete: false, appliedCommands: 0, draws: [] } }); }
      if (polled.status === 'pending') return ok({ status: 'waiting-gpu', appliedCommands: 0 });
      jobs.delete(job);
      if (job.cancelled) { release(job); return ok({ status: 'done', result: { ok: false, error: { code: 'cancelled', message: 'Scanout cancelled.' }, gpuComplete: true, appliedCommands: 0, draws: [] } }); }
      const { width, height } = job.binding.target.metadata, bytes = polled.bytes;
      counters.captureReady++; counters.readbackBytes += bytes.byteLength;
      const pixels = convertRgba(bytes, width, height); counters.rgbaConversionBytes += bytes.byteLength; counters.rowMoveBytes += Math.floor(height / 2) * 2 * width * 4;
      const queued = presenter.enqueueOwned({ bindingGeneration: job.presenterGeneration,
        frame: { scanout: 0, format: 1, rect: { x: 0, y: 0, width, height }, resourceWidth: width, resourceHeight: height, pixels } }, (receipt) => safeRetire(job, receipt));
      if (!queued.ok) { release(job); return ok({ status: 'done', result: { ...queued, gpuComplete: true, appliedCommands: 0, draws: [] } }); }
      job.phase = 'queued'; counters.queued++;
      return ok({ status: 'done', result: { ok: true, gpuComplete: true, appliedCommands: 0, draws: [] } });
    },
    cancel(job) { need(jobs.has(job) && !job.cancelled, 'Unknown or cancelled scanout job.'); job.cancelled = true; return ok(); },
    present2D(input) {
      const frame = record(input, ['scanout','format','rect','resourceWidth','resourceHeight','pixels']);
      if (frame.scanout === null) return ok();
      need(current?.binding.target.kind === '2d' && frame.scanout === 0, '2D frame has no current 2D scanout.');
      const target = current.binding.target;
      need(frame.format === target.format && frame.resourceWidth === target.width && frame.resourceHeight === target.height, '2D frame differs from current binding.');
      const source = pixelWords(frame.pixels); need(source.length === target.width * target.height, 'Wrong 2D frame size.');
      const pixels = new Uint32Array(source); counters.borrowed2dCopyBytes += pixels.byteLength;
      const entry = { epoch: current.epoch, binding: current.binding, ticket: null, retired: false };
      const queued = presenter.enqueueOwned({ bindingGeneration: localGeneration, frame: { ...frame, pixels } }, (receipt) => safeRetire(entry, receipt));
      if (queued.ok) counters.queued++;
      return queued.ok ? ok() : queued;
    },
    reset() {
      invalidate();
      for (const job of [...held]) release(job);
      jobs.clear(); dropBinding(); current = null; return ok();
    },
    dispose() { if (disposed) return ok(); api.reset(); disposed = true; return presenter.dispose(); },
    inspect() { return { disposed, binding: current ? { epoch: current.epoch, ...current.binding } : null, localGeneration,
      activeCaptures: jobs.size, retainedFrames: held.size, ...counters, retirements: [...retirements], presenter: presenter.inspect() }; },
  };
  return Object.freeze(Object.fromEntries(Object.entries(api).map(([key, fn]) => [key, (...args) => {
    try { return fn(...args); } catch (error) {
      if (error instanceof Fault || ['invalid-context-id','invalid-resource-id','invalid-parameter'].includes(error?.code)) return fail(error.code, error.message);
      onFault(error); return fail('bridge-poisoned', String(error?.message ?? error));
    }
  }])));
}
