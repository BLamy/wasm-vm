// Critic-owned wire and raster oracle. It imports no renderer, decoder, compiler,
// worker model or expected draw result. Original input bytes are its only data.
const f = Math.fround;
export function criticState(history) {
  const contexts = new Map(); let state;
  for (const record of history) {
    if (!contexts.has(record.ctx)) contexts.set(record.ctx, { layouts: new Map(), shaders: new Map() });
    state = contexts.get(record.ctx);
    const bytes = Uint8Array.from(record.hex.match(/../g) ?? [], b => parseInt(b, 16)), v = new DataView(bytes.buffer);
    for (let at = 0; at < bytes.length;) {
      if (at + 4 > bytes.length) throw new Error('critic short wire header');
      const h = v.getUint32(at, true), op = h & 255, kind = h >>> 8 & 255, n = h >>> 16;
      if (at + 4 * (n + 1) > bytes.length) throw new Error('critic short wire payload');
      const w = Array.from({ length: n }, (_, i) => v.getUint32(at + 4 * (i + 1), true));
      if (op === 1 && kind === 5) state.layouts.set(w[0], Array.from({ length: (n - 1) / 4 }, (_, i) =>
        ({ source: w[1 + i * 4], divisor: w[2 + i * 4], slot: w[3 + i * 4], lanes: w[4 + i * 4] - 27 })));
      if (op === 2 && kind === 5) state.active = w[0];
      if (op === 6) state.buffers = Array.from({ length: n / 3 }, (_, i) => ({ stride: w[i * 3], offset: w[i * 3 + 1], resource: w[i * 3 + 2] }));
      if (op === 11) state.index = n === 3 ? { resource: w[0], size: w[1], offset: w[2] } : null;
      if (op === 1 && kind === 4) state.shaders.set(w[1], new TextDecoder().decode(bytes.subarray(at + 24, at + 24 + w[2] - 1)));
      if (op === 8) state.draw = { start: w[0], count: w[1], mode: w[2], indexed: w[3] === 1, instances: Math.max(1, w[4]) };
      at += 4 * (n + 1);
    }
  }
  if (!state?.draw) throw new Error('critic needs original draw');
  return state;
}
export function criticModel(history, originals, used) {
  const s = criticState(history), d = s.draw, elements = s.layouts.get(s.active);
  const view = id => { const b = originals.get(id); return new DataView(b.buffer, b.byteOffset, b.byteLength); };
  const ids = Array.from({ length: d.count }, (_, i) => {
    if (!d.indexed) return d.start + i;
    const v = view(s.index.resource), at = s.index.offset + i * s.index.size;
    return s.index.size === 1 ? v.getUint8(at) : s.index.size === 2 ? v.getUint16(at, true) : v.getUint32(at, true);
  });
  const fetches = used.map(i => {
    const e = elements[i], b = s.buffers[e.slot], offset = b.offset + e.source, constant = b.stride === 0;
    const first = constant || e.divisor ? 0 : Math.min(...ids), last = constant ? 0 : e.divisor ? Math.floor((d.instances - 1) / e.divisor) : Math.max(...ids);
    const v = view(b.resource), words = [], generic = [0, 0, 0, 1];
    if (constant) for (let k = 0; k < e.lanes; k++) { words.push(v.getUint32(offset + k * 4, true)); generic[k] = v.getFloat32(offset + k * 4, true); }
    return { attributeIndex: i, resourceId: b.resource, components: e.lanes, constant, stride: b.stride, offset,
      divisor: e.divisor, nativeDivisor: constant ? 0 : Math.min(e.divisor, 65536), firstElement: first, lastElement: last,
      firstByte: offset + first * b.stride, requiredEnd: offset + last * b.stride + e.lanes * 4,
      ...(constant ? { componentWords: words, genericValues: generic } : {}) };
  });
  const vertex = s.shaders.get(0), fragment = s.shaders.get(1);
  if (!fragment.includes('DCL IN[0], GENERIC[0], CONSTANT') || !fragment.includes('0: MOV OUT[0], IN[0]')) throw new Error('critic expects original flat TGSI');
  const coefficient = number => vertex.match(new RegExp('IMM\\[' + number + '\\] FLT32 \\{([^}]+)\\}'))?.[1].split(',').map(n => f(Number(n)));
  const geom = coefficient(0), color = coefficient(2);
  if (JSON.stringify(geom) !== JSON.stringify([f(2 / d.instances), -1, 2, 1]) ||
      JSON.stringify(color) !== JSON.stringify([f(.5 / used.length), .03125, .0009765625, 0])) throw new Error('critic fixture coefficient drift');
  if (ids[0] % 4 !== 0 || ids.at(-1) % 4 !== 3 || ![4, 5].includes(d.mode)) throw new Error('critic fixture geometry drift');
  const rgba = (instance, id) => {
    let sum = [0, 0, 0, 0];
    for (const i of used) {
      const e = elements[i], b = s.buffers[e.slot], row = b.stride === 0 ? 0 : e.divisor ? Math.floor(instance / e.divisor) : id, v = view(b.resource);
      const lanes = [0, 0, 0, 1]; for (let k = 0; k < e.lanes; k++) lanes[k] = v.getFloat32(b.offset + e.source + row * b.stride + k * 4, true);
      sum = sum.map((n, k) => f(n + lanes[k]));
    }
    const out = sum.map(n => f(n * color[0]));
    out[1] = f(f((id & 255) * color[2]) + out[1]); out[2] = f(f((instance & 7) * color[1]) + out[2]);
    return out.map(n => Math.floor(Math.max(0, Math.min(1, n)) * 255 + .5));
  };
  return { draw: d, index: s.index, ids, fetches, rgba };
}
export function criticPixels(pixels, model, width, height) {
  if (width !== model.draw.instances * 10 || height !== 10 || pixels.length !== width * height * 4) throw new Error('critic pixel extent');
  let maxError = 0; const misses = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inst = Math.floor(x / 10), diagonal = (x % 10 + .5) / 10 + (y + .5) / height;
    const a = model.rgba(inst, model.ids[2]), b = model.rgba(inst, model.ids[model.draw.mode === 4 ? 5 : 3]);
    const expected = Math.abs(diagonal - 1) < 1e-6 ? [a, b] : [diagonal < 1 ? a : b];
    const observed = [...pixels.subarray((y * width + x) * 4, (y * width + x + 1) * 4)], error = Math.min(...expected.map(p => Math.max(...p.map((n, k) => Math.abs(n - observed[k])))));
    maxError = Math.max(maxError, error);
    if (error > 1 && misses.length < 8) misses.push({ x, y, observed, expected, error });
  }
  return { held: misses.length === 0, pixels: width * height, maxError, misses };
}
