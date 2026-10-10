// Fresh D15 critic: original wire/TGSI/bytes only; no renderer, worker oracle,
// generated shader text, or descriptor/unpacker imports.
const f = Math.fround;
const bits = n => new Uint32Array(new Float32Array([n]).buffer)[0];
const fromHex = s => Uint8Array.from(s.match(/../g) ?? [], b => parseInt(b, 16));

export function originalPacked(raw, offset, format) {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (format >= 28 && format <= 31 || format === 196 || format === 200) {
    const count = format >= 28 && format <= 31 ? format - 27 : 4;
    const values = [0, 0, 0, 1], words = [];
    for (let lane = 0; lane < count; lane++) {
      values[lane] = v.getFloat32(offset + lane * 4, true);
      words.push(v.getUint32(offset + lane * 4, true));
    }
    return { values, words };
  }
  if (![8, 123, 172, 173].includes(format)) throw Error('critic original format boundary');
  let quotient = v.getUint32(offset, true);
  const fields = [];
  for (let lane = 0; lane < 4; lane++) {
    const radix = lane === 3 ? 4 : 1024;
    let value = quotient % radix;
    quotient = Math.floor(quotient / radix);
    if (format >= 172 && value >= radix / 2) value -= radix;
    if (format === 8) value /= radix - 1;
    if (format === 173) value = Math.max(-1, value / (radix / 2 - 1));
    fields.push(f(value));
  }
  return { values: fields, words: fields.map(bits) };
}

export function criticModel(history, buffers, range) {
  const contexts = new Map(); let s;
  for (const record of history) {
    if (!contexts.has(record.ctx)) contexts.set(record.ctx, { elements: new Map(), buffers: [], shaders: new Map(),
      rasters: new Map(), raster: { size: 1 }, viewport: null, index: null });
    s = contexts.get(record.ctx);
    const raw = fromHex(record.hex), v = new DataView(raw.buffer);
    for (let at = 0; at < raw.length;) {
      if (at + 4 > raw.length) throw Error('critic short packet header');
      const header = v.getUint32(at, true), op = header & 255, kind = header >>> 8 & 255, count = header >>> 16;
      if (at + (count + 1) * 4 > raw.length) throw Error('critic short packet payload');
      const w = Array.from({ length: count }, (_, i) => v.getUint32(at + (i + 1) * 4, true));
      if (op === 1 && kind === 5) s.elements.set(w[0], Array.from({ length: (count - 1) / 4 }, (_, i) =>
        ({ sourceOffset: w[1 + i * 4], divisor: w[2 + i * 4], buffer: w[3 + i * 4], format: w[4 + i * 4] })));
      if (op === 2 && kind === 5) s.selected = w[0];
      if (op === 6) s.buffers = Array.from({ length: count / 3 }, (_, i) => ({ stride: w[i * 3], offset: w[i * 3 + 1], id: w[i * 3 + 2] }));
      if (op === 11) s.index = w.length === 1 ? null : { id: w[0], size: w[1], offset: w[2] };
      if (op === 1 && kind === 4) s.shaders.set(w[1], new TextDecoder().decode(raw.subarray(at + 24, at + 24 + w[2] - 1)));
      if (op === 1 && kind === 2) s.rasters.set(w[0], { size: v.getFloat32(at + 12, true) });
      if (op === 2 && kind === 2) s.raster = s.rasters.get(w[0]) ?? { size: 1 };
      if (op === 4) s.viewport = Array.from({ length: 6 }, (_, i) => v.getFloat32(at + 8 + i * 4, true));
      if (op === 8) s.draw = { start: w[0], count: w[1], mode: w[2], indexed: w[3] === 1,
        instances: w[4], restart: w[7] === 1, marker: w[8], minHint: w[9], maxHint: w[10] };
      at += (count + 1) * 4;
    }
  }
  if (s.draw?.mode !== 0) throw Error('critic literal point boundary');
  const d = s.draw; s.effective = Math.max(1, d.instances); s.activeElements = s.elements.get(s.selected);
  const vertex = s.shaders.get(0), fragment = s.shaders.get(1);
  if (fragment !== 'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n') throw Error('critic original fragment drift');
  for (const line of ['DCL IN[0]', 'DCL SV[0], INSTANCEID', 'DCL SV[1], VERTEXID',
    'SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz', 'MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww'])
    if (!vertex.includes(line)) throw Error('critic original position body drift');
  const immediates = new Map([...vertex.matchAll(/IMM\[(\d+)\] FLT32 \{([^}]+)\}/g)].map(m => [Number(m[1]), m[2].split(',').map(n => f(Number(n)))]));
  s.imm = immediates.get(0);
  const wordMove = vertex.match(/MOV TEMP\[2\]\.x, IN\[(\d+)\]\.([xyzw]){4}/);
  const wordAdd = vertex.match(/ADD TEMP\[2\]\.x, IN\[(\d+)\]\.([xyzw]){4}, IN\[(\d+)\]\.([xyzw]){4}/);
  const colorMove = vertex.match(/MAD OUT\[1\], IN\[(\d+)\], IMM\[1\], IMM\[3\]/);
  const colorAdd = vertex.match(/ADD TEMP\[2\], IN\[(\d+)\], IN\[(\d+)\]/);
  const inputIndices = wordAdd ? [Number(wordAdd[1]), Number(wordAdd[3])] : wordMove ? [Number(wordMove[1])] :
    colorAdd ? [Number(colorAdd[1]), Number(colorAdd[2])] : colorMove ? [Number(colorMove[1])] : [];
  if (!inputIndices.length || inputIndices.some(n => n < 1 || n > 15)) throw Error('critic original color body drift');
  if (wordAdd || wordMove) for (const line of ['USHR TEMP[2], TEMP[2].xxxx, IMM[2]', 'AND TEMP[2], TEMP[2], IMM[4]',
    'U2F TEMP[2], TEMP[2]', 'MUL OUT[1], TEMP[2], IMM[0].wwww']) if (!vertex.includes(line)) throw Error('critic original word output drift');
  s.ids = Array.from({ length: d.count }, (_, n) => {
    if (!d.indexed) return d.start + n;
    const raw = buffers.get(s.index.id), v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), at = s.index.offset + n * s.index.size;
    return s.index.size === 1 ? v.getUint8(at) : s.index.size === 2 ? v.getUint16(at, true) : v.getUint32(at, true);
  });
  const valid = s.ids.filter(id => !d.restart || id !== d.marker);
  s.min = valid.length ? Math.min(...valid) : null; s.max = valid.length ? Math.max(...valid) : null;
  s.valid = valid.length; s.restarts = s.ids.length - valid.length;
  const sentinel = d.indexed ? { 1: 255, 2: 65535, 4: 4294967295 }[s.index.size] : null;
  s.normalize = s.ids.some(id => d.restart && id === d.marker ? id !== sentinel : id === sentinel);
  s.nativeSize = s.normalize ? 4 : d.indexed ? s.index.size : 0; s.nativeOffset = s.normalize ? 0 : d.indexed ? s.index.offset : 0;
  s.normalized = new Uint8Array(s.normalize ? d.count * 4 : 0);
  if (s.normalize) { const v = new DataView(s.normalized.buffer); s.ids.forEach((id, n) => v.setUint32(n * 4, d.restart && id === d.marker ? 4294967295 : id, true)); }
  const read = (index, instance, id) => {
    const e = s.activeElements[index], b = s.buffers[e.buffer], ordinal = !b.stride ? 0 : e.divisor ? Math.floor(instance / e.divisor) : id;
    return originalPacked(buffers.get(b.id), b.offset + e.sourceOffset + ordinal * b.stride, e.format);
  };
  s.fetches = [0, ...inputIndices].map(index => {
    const e = s.activeElements[index], b = s.buffers[e.buffer], integer = e.format === 196 || e.format === 200,
      packed = [8, 123, 172, 173].includes(e.format), signed = e.format === 172 || e.format === 173,
      constant = b.stride === 0, components = e.format >= 28 && e.format <= 31 ? e.format - 27 : 4,
      elementBytes = packed ? 4 : components * 4, offset = b.offset + e.sourceOffset,
      first = valid.length ? constant || e.divisor ? 0 : s.min : null,
      last = valid.length ? constant ? 0 : e.divisor ? Math.floor((s.effective - 1) / e.divisor) : s.max : null;
    const generic = constant ? read(index, 0, 0) : null;
    return { attributeIndex: index, resourceId: b.id, stride: b.stride, offset, components, sourceFormat: e.format, elementBytes,
      nativeType: integer ? e.format === 200 ? 5124 : 5125 : packed ? signed && constant ? 36255 : 33640 : 5126,
      normalized: (e.format === 8 || e.format === 173) && !(signed && !constant), constant,
      divisor: e.divisor, nativeDivisor: constant ? 0 : Math.min(e.divisor, 65536), firstElement: first, lastElement: last,
      firstByte: first === null ? null : offset + first * b.stride, requiredEnd: last === null ? null : offset + last * b.stride + elementBytes,
      ...(integer ? { integer: true, signed: e.format === 200, shaderType: e.format === 200 ? 35669 : 36296 } : {}),
      ...(generic ? { genericValues: integer ? generic.words.map(w => e.format === 200 ? w | 0 : w) : generic.values,
        componentWords: generic.words, ...(integer ? { genericWords: generic.words } : {}) } : {}) };
  });
  const viewport = s.viewport, size = Math.min(range[1], Math.max(range[0], s.raster.size));
  s.wordMode = Boolean(wordMove || wordAdd); s.pointUniform = [s.raster.size, 0]; s.points = [];
  for (let instance = 0; instance < s.effective; instance++) for (const id of valid) {
    const a = read(0, instance, id).values;
    if (f((a[2] === id ? 1 : 0) * a[3]) !== 1) continue;
    let color, nan = false;
    if (s.wordMode) {
      const lane = 'xyzw'.indexOf((wordAdd ?? wordMove)[2]), first = read(inputIndices[0], instance, id);
      const n = wordAdd ? f(first.values[lane] + read(inputIndices[1], instance, id).values['xyzw'.indexOf(wordAdd[4])]) : first.values[lane];
      const w = wordAdd ? bits(n) : first.words[lane] ?? bits(n);
      color = [w & 255, w >>> 8 & 255, w >>> 16 & 255, w >>> 24]; nan = Number.isNaN(n);
    } else {
      const values = read(inputIndices[0], instance, id).values;
      if (colorAdd) { const other = read(inputIndices[1], instance, id).values; for (let lane = 0; lane < 4; lane++) values[lane] = f(values[lane] + other[lane]); }
      const mul = immediates.get(1), add = immediates.get(3);
      color = values.map((n, lane) => Math.round(Math.max(0, Math.min(1, f(f(n * mul[lane]) + add[lane]))) * 255));
    }
    const x = f(f(a[0] * s.imm[0]) + f(f(instance * s.imm[1]) + s.imm[2]));
    s.points.push({ id, instance, x: x * Math.abs(viewport[0]) + viewport[3],
      y: a[1] * (viewport[1] < 0 ? -1 : 1) * Math.abs(viewport[1]) + viewport[4], size, color, nan });
  }
  s.pixel = (x, y) => {
    let result = { color: [0, 0, 0, 0], nan: false };
    for (const p of s.points) if (Math.abs(x + .5 - p.x) < p.size / 2 && Math.abs(y + .5 - p.y) < p.size / 2) result = { color: p.color, nan: p.nan };
    return result;
  };
  return s;
}

export function criticPixels(raw, model, width, height) {
  const misses = []; let maxError = 0, nanPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const expected = model.pixel(x, y), observed = [...raw.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];
    let error = Math.max(...observed.map((n, lane) => Math.abs(n - expected.color[lane])));
    if (expected.nan) { const w = observed[0] + observed[1] * 256 + observed[2] * 65536 + observed[3] * 16777216; error = (w & 0x7f800000) === 0x7f800000 && (w & 0x7fffff) !== 0 ? 0 : 255; nanPixels++; }
    maxError = Math.max(maxError, error);
    if (error > (model.wordMode ? 0 : 1) && misses.length < 4) misses.push({ x, y, expected, observed, error });
  }
  return { pixels: width * height, nanPixels, maxError, misses, held: misses.length === 0, portableNaNPayload: false };
}
