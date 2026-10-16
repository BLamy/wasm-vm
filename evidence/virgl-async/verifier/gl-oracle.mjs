// Independent verifier instrumentation. This does not replace WebGL operations.
export function createGlOracle(native) {
  const events = [], violations = [], ids = new WeakMap(), buffers = new Map(), syncs = new Map();
  const bindings = new Map(), vaoBindings = new Map([[null, null]]), openProducers = [];
  const cached = new Map();
  let nextId = 1, strict = false, currentVao = null, forcedTimeouts = 0, failNextWait = false;
  const id = (object) => {
    if (object === null || object === undefined) return null;
    if (!ids.has(object)) ids.set(object, nextId++);
    return ids.get(object);
  };
  const add = (op, data = {}) => { const event = { event: events.length + 1, op, strict, ...data }; events.push(event); return event; };
  const demand = (condition, message, event) => {
    if (condition) return;
    const failure = { event: event.event, message }; violations.push(failure);
    throw new Error(`Independent GL oracle at event ${event.event}: ${message}`);
  };
  const binding = (target) => target === native.ELEMENT_ARRAY_BUFFER ? vaoBindings.get(currentVao) ?? null : bindings.get(target) ?? null;
  const statistics = () => ({
    events: events.length, violations: [...violations],
    liveBuffers: [...buffers.values()].filter((buffer) => !buffer.deleted).length,
    liveSyncs: [...syncs.values()].filter((sync) => !sync.deleted).length,
    counts: Object.fromEntries([...new Set(events.map((event) => event.op))].map((op) => [op, events.filter((event) => event.op === op).length])),
  });
  const invoke = (name, args) => {
    if (name === 'createBuffer') {
      const object = native.createBuffer(...args);
      const event = add(name, { buffer: id(object) });
      if (object) buffers.set(object, { id: id(object), type: 'undefined', deleted: false, byteLength: 0, producer: null, created: event.event });
      return object;
    }
    if (name === 'deleteBuffer') {
      const buffer = buffers.get(args[0]);
      add(name, { buffer: id(args[0]), alreadyDeleted: buffer?.deleted ?? null });
      const result = native.deleteBuffer(...args);
      if (buffer) buffer.deleted = true;
      return result;
    }
    if (name === 'bindVertexArray') {
      const result = native.bindVertexArray(...args); currentVao = args[0];
      if (!vaoBindings.has(currentVao)) vaoBindings.set(currentVao, null);
      add(name, { vao: id(currentVao) }); return result;
    }
    if (name === 'bindBuffer') {
      const [target, object] = args, buffer = buffers.get(object);
      const copy = target === native.COPY_READ_BUFFER || target === native.COPY_WRITE_BUFFER;
      const type = target === native.ELEMENT_ARRAY_BUFFER ? 'element' : 'other';
      const event = add(name, { target, buffer: id(object), previousType: buffer?.type ?? null });
      if (strict && buffer) {
        demand(!buffer.deleted, 'binding a deleted buffer', event);
        demand(buffer.type === 'undefined' || copy || buffer.type === type, 'WebGL buffer class mismatch', event);
      }
      const result = native.bindBuffer(...args);
      if (buffer?.type === 'undefined') buffer.type = type;
      if (target === native.ELEMENT_ARRAY_BUFFER) vaoBindings.set(currentVao, object); else bindings.set(target, object);
      return result;
    }
    if (name === 'bufferData') {
      const object = binding(args[0]), buffer = buffers.get(object);
      const size = typeof args[1] === 'number' ? args[1] : args[1]?.byteLength ?? 0;
      add(name, { target: args[0], buffer: id(object), bytes: size });
      const result = native.bufferData(...args);
      if (buffer) { buffer.byteLength = size; buffer.producer = null; }
      return result;
    }
    if (name === 'copyBufferSubData') {
      const source = binding(args[0]), destination = binding(args[1]);
      const src = buffers.get(source), dst = buffers.get(destination);
      const event = add(name, { source: id(source), destination: id(destination), sourceType: src?.type ?? null,
        destinationType: dst?.type ?? null, sourceOffset: args[2], destinationOffset: args[3], bytes: args[4] });
      if (strict) {
        demand(source !== destination, 'staging copy must own a separate buffer', event);
        demand(src && dst && src.type === dst.type, 'copy crosses element/other WebGL classes', event);
      }
      const result = native.copyBufferSubData(...args);
      if (strict && dst) { dst.producer = { event: event.event, fence: null }; openProducers.push(dst.producer); }
      return result;
    }
    if (name === 'readPixels') {
      const destination = binding(native.PIXEL_PACK_BUFFER), dst = buffers.get(destination);
      const event = add(name, { x: args[0], y: args[1], width: args[2], height: args[3],
        destination: id(destination), numericOffset: typeof args[6] === 'number', offset: typeof args[6] === 'number' ? args[6] : null });
      if (strict) {
        demand(dst && !dst.deleted && dst.type === 'other', 'texture readback lacks an owned other-data PBO', event);
        demand(typeof args[6] === 'number', 'texture readback used synchronous CPU overload', event);
      }
      const result = native.readPixels(...args);
      if (strict && dst) { dst.producer = { event: event.event, fence: null }; openProducers.push(dst.producer); }
      return result;
    }
    if (name === 'fenceSync') {
      const object = native.fenceSync(...args);
      const event = add(name, { sync: id(object), condition: args[0], flags: args[1], producers: openProducers.map((producer) => producer.event) });
      if (object) {
        const entry = { id: id(object), event: event.event, deleted: false, signaled: false, signalEvent: null };
        syncs.set(object, entry);
        for (const producer of openProducers.splice(0)) producer.fence = entry;
      }
      return object;
    }
    if (name === 'clientWaitSync') {
      const entry = syncs.get(args[0]);
      const event = add(name, { sync: id(args[0]), flags: args[1], timeout: args[2] });
      if (strict) {
        demand(args[1] === 0 && args[2] === 0, 'wait must have zero flags and timeout', event);
        demand(entry && !entry.deleted, 'wait targets an unknown/deleted sync', event);
      }
      // Actual native wait always runs; deterministic suppression never invents readiness.
      const observed = native.clientWaitSync(...args);
      let returned = observed;
      if (failNextWait) { failNextWait = false; returned = native.WAIT_FAILED; }
      else if (forcedTimeouts > 0) { forcedTimeouts--; returned = native.TIMEOUT_EXPIRED; }
      Object.assign(event, { observed, returned });
      if (entry && (returned === native.ALREADY_SIGNALED || returned === native.CONDITION_SATISFIED)) {
        entry.signaled = true; entry.signalEvent = event.event;
      }
      return returned;
    }
    if (name === 'getBufferSubData') {
      const object = binding(args[0]), buffer = buffers.get(object), producer = buffer?.producer;
      const event = add(name, { target: args[0], buffer: id(object), offset: args[1], bytes: args[2]?.byteLength ?? null,
        producer: producer?.event ?? null, fence: producer?.fence?.event ?? null, signal: producer?.fence?.signalEvent ?? null });
      if (strict) {
        demand(producer && producer.fence && producer.fence.signaled, 'CPU collection preceded matching staging fence signal', event);
        demand(!buffer.deleted, 'CPU collection uses deleted staging', event);
      }
      return native.getBufferSubData(...args);
    }
    if (name === 'deleteSync') {
      const entry = syncs.get(args[0]);
      add(name, { sync: id(args[0]), alreadyDeleted: entry?.deleted ?? null });
      const result = native.deleteSync(...args);
      if (entry) entry.deleted = true;
      return result;
    }
    if (name === 'finish') {
      const event = add(name);
      if (strict) demand(false, 'finish is forbidden on asynchronous path', event);
      return native.finish(...args);
    }
    if (['drawElements', 'bufferSubData', 'texSubImage2D', 'flush'].includes(name)) add(name,
      name === 'drawElements' ? { mode: args[0], count: args[1], type: args[2], offset: args[3] } : {});
    return native[name](...args);
  };
  const gl = new Proxy(native, { get(_target, name) {
    const value = native[name];
    if (typeof value !== 'function') return value;
    if (!cached.has(name)) cached.set(name, (...args) => invoke(name, args));
    return cached.get(name);
  } });
  return Object.freeze({ gl, events, statistics,
    setStrict(value) { strict = value; add('scope', { enabled: value }); },
    delayWaits(count) { forcedTimeouts = count; },
    failWait() { failNextWait = true; },
    checkpoint(label) { return add('checkpoint', { label, stats: statistics() }); },
  });
}
