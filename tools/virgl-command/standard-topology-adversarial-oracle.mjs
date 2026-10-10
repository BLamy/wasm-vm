// Fresh critic model: literal wire, original uploads and declared shader math.
// No renderer, decoder, compiler, fixture generator or worker-oracle imports.
const f32 = Math.fround;
const clear = [0, 0, 0, 0];
export function literalPackets(hex) {
  const raw = Uint8Array.from(hex.match(/../g) ?? [], s => parseInt(s, 16));
  const view = new DataView(raw.buffer), packets = [];
  for (let offset = 0; offset < raw.length;) {
    if (raw.length - offset < 4) throw Error('truncated literal header');
    const header = view.getUint32(offset, true), count = header >>> 16;
    if (count * 4 > raw.length - offset - 4) throw Error('truncated literal words');
    const words = Array.from({length: count}, (_, i) => view.getUint32(offset + 4 + i * 4, true));
    packets.push({op: header & 255, kind: (header >>> 8) & 255, words, offset,
      bytes: raw.subarray(offset + 4, offset + 4 + count * 4)});
    offset += (count + 1) * 4;
  }
  return packets;
}
export function literalAdmission(hex, legacy = false) {
  try {
    for (const p of literalPackets(hex)) {
      if (p.op !== 8 || p.kind !== 0 || p.words.length !== 12) return false;
      const w = p.words;
      if (!(legacy ? [4, 5] : [1, 2, 3, 4, 5, 6]).includes(w[2]) || w[3] > 1 ||
          (legacy && w[4] !== 1) || w[5] !== 0 || w[6] !== 0 || w[7] !== 0 ||
          w[8] !== 0 || w[11] !== 0 || w[0] > 0xffffffff - w[1] || w[9] > w[10]) return false;
    }
    return true;
  } catch { return false; }
}
function stateFromWire(history) {
  const contexts = new Map(); let state;
  for (const record of history) {
    if (!contexts.has(record.ctx)) contexts.set(record.ctx, {elements: new Map(), stages: new Map()});
    state = contexts.get(record.ctx);
    for (const p of literalPackets(record.hex)) {
      const w = p.words;
      if (p.op === 1 && p.kind === 5) state.elements.set(w[0], Array.from({length: (w.length - 1) / 4}, (_, i) =>
        ({source: w[1 + i * 4], divisor: w[2 + i * 4], slot: w[3 + i * 4], components: w[4 + i * 4] - 27})));
      if (p.op === 2 && p.kind === 5) state.selected = w[0];
      if (p.op === 6) state.buffers = Array.from({length: w.length / 3}, (_, i) => ({stride: w[i * 3], offset: w[i * 3 + 1], id: w[i * 3 + 2]}));
      if (p.op === 11) state.index = {id: w[0], size: w[1], offset: w[2]};
      if (p.op === 1 && p.kind === 4) state.stages.set(w[1], new TextDecoder().decode(p.bytes.subarray(20, 20 + w[2] - 1)));
      if (p.op === 4) {
        const raw = new Uint32Array(w.slice(1)); const v = new DataView(raw.buffer);
        state.viewport = Array.from({length: 6}, (_, i) => v.getFloat32(i * 4, true));
      }
      if (p.op === 8) state.draw = {start: w[0], count: w[1], mode: w[2], indexed: w[3] === 1, instances: w[4], minHint: w[9], maxHint: w[10]};
    }
  }
  if (!state?.draw) throw Error('literal draw absent');
  return state;
}
export function independentTopology(history, storage, {skipPixels = false} = {}) {
  const s = stateFromWire(history), d = s.draw, n = Math.max(1, d.instances);
  const bytes = id => {const b = storage.get(id); if (!b) throw Error('original storage absent ' + id); return new DataView(b.buffer, b.byteOffset, b.byteLength);};
  const ids = Array.from({length: d.count}, (_, i) => {
    if (!d.indexed) return d.start + i;
    const v = bytes(s.index.id), at = s.index.offset + i * s.index.size;
    return s.index.size === 1 ? v.getUint8(at) : s.index.size === 2 ? v.getUint16(at, true) : v.getUint32(at, true);
  });
  const min = Math.min(...ids), max = Math.max(...ids), elements = s.elements.get(s.selected);
  const fetches = elements.map((e, attributeIndex) => {
    const b = s.buffers[e.slot], offset = b.offset + e.source, constant = b.stride === 0;
    const first = constant || e.divisor ? 0 : min, last = constant ? 0 : e.divisor ? Math.floor((n - 1) / e.divisor) : max;
    const generic = [0, 0, 0, 1], words = [];
    if (constant) for (let lane = 0; lane < e.components; lane++) {generic[lane] = bytes(b.id).getFloat32(offset + lane * 4, true); words.push(bytes(b.id).getUint32(offset + lane * 4, true));}
    return {attributeIndex, resourceId: b.id, stride: b.stride, offset, components: e.components, constant,
      divisor: e.divisor, nativeDivisor: constant ? 0 : Math.min(e.divisor, 65536), firstElement: first, lastElement: last,
      firstByte: offset + first * b.stride, requiredEnd: offset + last * b.stride + e.components * 4,
      ...(constant ? {genericValues: generic, componentWords: words} : {})};
  });
  if (skipPixels) return {draw: d, index: s.index, effective: n, ids, min, max, fetches};
  const input = (attribute, instance, id) => {
    const e = elements[attribute], b = s.buffers[e.slot], out = [0, 0, 0, 1];
    const index = b.stride === 0 ? 0 : e.divisor ? Math.floor(instance / e.divisor) : id;
    for (let k = 0; k < e.components; k++) out[k] = bytes(b.id).getFloat32(b.offset + e.source + index * b.stride + k * 4, true);
    return out;
  };
  const vertex = s.stages.get(0), fragment = s.stages.get(1);
  const instructions = vertex.split('\n').filter(line => /^\d+:/.test(line)).map(line => line.replace(/^\d+: /, ''));
  const expected = ['I2F TEMP[0].x, SV[0].xxxx', 'MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].xxxx, IMM[0].yyyy',
    'MOV OUT[0], IN[0]', 'MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx',
    'ADD TEMP[1], IN[1], IN[2]', 'MUL OUT[1], TEMP[1], IMM[1].xxxx', 'END'];
  if (JSON.stringify(instructions) !== JSON.stringify(expected) || fragment !== 'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n') throw Error('independent source shader domain');
  const immediate = index => vertex.match(new RegExp('IMM\\[' + index + '\\] FLT32 \\{([^}]+)\\}'))[1].split(',').map(x => f32(Number(x)));
  const coeff = immediate(0), factor = immediate(1)[0], [sx, sy, , tx, ty] = s.viewport;
  const instances = Array.from({length: n}, (_, instance) => {
    const points = ids.map(id => {
      const v = input(0, instance, id), clipx = f32(f32(v[0] * coeff[0]) + f32(f32(instance * coeff[0]) + coeff[1]));
      return [clipx * sx + tx, v[1] * Math.abs(sy) + ty];
    });
    const a = input(1, instance, ids[0]), b = input(2, instance, ids[0]);
    const rgba = a.map((v, k) => Math.round(255 * Math.max(0, Math.min(1, f32(f32(v + b[k]) * factor)))));
    return {points, rgba};
  });
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const candidate = (x, y) => {
    const p = [x + .5, y + .5], alternatives = [];
    for (const {points, rgba} of instances) {
      if (d.mode === 6) {
        let onBoundary = 0;
        for (let i = 1; i + 1 < points.length; i++) {
          const triangle = [points[0], points[i], points[i + 1]], area = cross(...triangle);
          if (Math.abs(area) < 1e-7) continue;
          const sides = [cross(triangle[0], triangle[1], p), cross(triangle[1], triangle[2], p), cross(triangle[2], triangle[0], p)].map(v => v * Math.sign(area));
          if (sides.every(v => v > 1e-7)) return {colors: [rgba], strict: true, reason: 'fan interior'};
          if (sides.every(v => v >= -1e-7)) onBoundary++;
        }
        if (onBoundary > 1) return {colors: [rgba], strict: true, reason: 'shared fan edge'};
        if (onBoundary === 1) alternatives.push(rgba);
      } else {
        const segments = [];
        if (d.mode === 1) for (let i = 0; i + 1 < points.length; i += 2) segments.push([points[i], points[i + 1]]);
        else if ([2, 3].includes(d.mode)) {
          for (let i = 0; i + 1 < points.length; i++) segments.push([points[i], points[i + 1]]);
          if (d.mode === 2 && points.length > 1) segments.push([points.at(-1), points[0]]);
        } else throw Error('independent mode outside core topology claim');
        for (const [a, b] of segments) {
          const dx = b[0] - a[0], dy = b[1] - a[1];
          if (Math.abs(dx) + Math.abs(dy) < 1e-7) continue;
          if (Math.abs(dx) > 1e-7 && Math.abs(dy) > 1e-7) throw Error('independent line domain must be axis aligned');
          const major = Math.abs(dx) > 1e-7 ? 0 : 1, minor = 1 - major;
          if (Math.abs(p[minor] - a[minor]) > 1e-5 || p[major] < Math.min(a[major], b[major]) - 1e-5 || p[major] > Math.max(a[major], b[major]) + 1e-5) continue;
          if (Math.abs(p[major] - a[major]) > 1e-5 && Math.abs(p[major] - b[major]) > 1e-5) return {colors: [rgba], strict: true, reason: 'line interior'};
          alternatives.push(rgba);
        }
      }
    }
    return {colors: [clear, ...alternatives], strict: alternatives.length === 0, reason: alternatives.length ? 'declared endpoint/outer boundary' : 'outside'};
  };
  return {draw: d, index: s.index, effective: n, ids, min, max, fetches, instances, candidate};
}
export function compareIndependent(raw, model, width, height) {
  const misses = []; let maxError = 0, strict = 0, alternatives = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const expected = model.candidate(x, y), observed = [...raw.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];
    const error = Math.min(...expected.colors.map(color => Math.max(...color.map((value, lane) => Math.abs(value - observed[lane])))));
    maxError = Math.max(maxError, error); if (expected.strict) strict++; else alternatives++;
    if (error > 1 && misses.length < 6) misses.push({x, y, expected: expected.colors, observed, error, reason: expected.reason});
  }
  return {held: misses.length === 0, pixels: width * height, strictPixels: strict, alternativePixels: alternatives, maxError, misses};
}
