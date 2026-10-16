// Fresh critic: expectations come only from literal packets and original bytes.
// No renderer, decoder, shader compiler, or observed-pixel import.
export const fromHex = text => Uint8Array.from(text.match(/../g) ?? [], x => parseInt(x, 16));
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const f = Math.fround;
export function literalRestartAdmission(hex, legacy = false) {
  const raw = fromHex(hex), v = view(raw);
  for (let at = 0; at < raw.length;) {
    if (at + 4 > raw.length) return false;
    const h = v.getUint32(at, true), count = h >>> 16;
    if ((h & 65535) !== 8 || count !== 12 || at + 4 * (count + 1) > raw.length) return false;
    const w = Array.from({length: count}, (_, n) => v.getUint32(at + 4 * (n + 1), true));
    if (w[3] > 1 || w[7] > 1 || w[5] || w[6] || w[11] || w[0] > 0xffffffff - w[1] || w[9] > w[10]) return false;
    if (legacy ? ![4, 5].includes(w[2]) || w[4] !== 1 || w[7] || w[8] :
      w[2] < 1 || w[2] > 6 || (w[7] ? w[3] !== 1 : w[8] !== 0)) return false;
    at += 4 * (count + 1);
  }
  return raw.length > 0;
}

export function independentRestart(history, original, used = [0, 1, 2]) {
  const contexts = new Map(); let state;
  for (const record of history) {
    if (!contexts.has(record.ctx)) contexts.set(record.ctx, {elements: new Map(), buffers: [], shaders: new Map()});
    state = contexts.get(record.ctx);
    const raw = fromHex(record.hex), v = view(raw);
    for (let at = 0; at < raw.length;) {
      if (at + 4 > raw.length) throw Error('critic literal short header');
      const h = v.getUint32(at, true), count = h >>> 16, opcode = h & 255, type = h >>> 8 & 255;
      if (at + 4 * (count + 1) > raw.length) throw Error('critic literal short command');
      const w = Array.from({length: count}, (_, n) => v.getUint32(at + 4 * (n + 1), true));
      if (opcode === 1 && type === 5) state.elements.set(w[0], Array.from({length: (count - 1) / 4}, (_, n) => ({
        sourceOffset: w[1 + 4 * n], divisor: w[2 + 4 * n], slot: w[3 + 4 * n], components: w[4 + 4 * n] - 27,
      })));
      if (opcode === 2 && type === 5) state.selected = w[0];
      if (opcode === 6) state.buffers = Array.from({length: count / 3}, (_, n) => ({stride: w[n * 3], offset: w[n * 3 + 1], id: w[n * 3 + 2]}));
      if (opcode === 11) state.index = {id: w[0], size: w[1], offset: w[2]};
      if (opcode === 1 && type === 4) state.shaders.set(w[1], new TextDecoder().decode(raw.slice(at + 24, at + 24 + w[2] - 1)));
      if (opcode === 8) state.draw = {start: w[0], count: w[1], mode: w[2], indexed: w[3] === 1, instances: w[4],
        enabled: w[7] === 1, marker: w[8], minHint: w[9], maxHint: w[10]};
      at += 4 * (count + 1);
    }
  }
  const {draw, index} = state;
  if (!draw?.indexed || !index) throw Error('critic expects indexed restart fixture');
  const data = id => view(original.get(id)), iv = data(index.id), ids = [];
  const readIndex = at => index.size === 1 ? iv.getUint8(at) : index.size === 2 ? iv.getUint16(at, true) : iv.getUint32(at, true);
  let min = null, max = null, valid = 0, restarts = 0, normalize = false;
  const segments = [[]], fixed = {1: 255, 2: 65535, 4: 0xffffffff}[index.size];
  for (let n = 0; n < draw.count; n++) {
    const id = readIndex(index.offset + n * index.size); ids.push(id);
    if (draw.enabled && id === draw.marker) {restarts++; normalize ||= id !== fixed; segments.push([]);}
    else {valid++; min = min === null ? id : Math.min(min, id); max = max === null ? id : Math.max(max, id); normalize ||= id === fixed; segments.at(-1).push(id);}
  }
  const normalized = new Uint8Array(normalize ? draw.count * 4 : 0);
  ids.forEach((id, n) => {if (normalize) view(normalized).setUint32(n * 4, draw.enabled && id === draw.marker ? 0xffffffff : id, true);});
  const effective = Math.max(1, draw.instances), active = state.elements.get(state.selected);
  const fetches = used.map(attributeIndex => {
    const e = active[attributeIndex], b = state.buffers[e.slot], offset = b.offset + e.sourceOffset, constant = b.stride === 0;
    const firstElement = valid === 0 ? null : e.divisor || constant ? 0 : min;
    const lastElement = valid === 0 ? null : constant ? 0 : e.divisor ? Math.floor((effective - 1) / e.divisor) : max;
    const genericValues = [0, 0, 0, 1], componentWords = [];
    if (constant) for (let k = 0; k < e.components; k++) {genericValues[k] = data(b.id).getFloat32(offset + k * 4, true); componentWords.push(data(b.id).getUint32(offset + k * 4, true));}
    return {attributeIndex, resourceId: b.id, stride: b.stride, offset, components: e.components, divisor: e.divisor,
      nativeDivisor: constant ? 0 : Math.min(e.divisor, 65536), constant, firstElement, lastElement,
      firstByte: firstElement === null ? null : offset + firstElement * b.stride,
      requiredEnd: lastElement === null ? null : offset + lastElement * b.stride + e.components * 4,
      ...(constant ? {genericValues, componentWords} : {})};
  });
  const vertex = state.shaders.get(0), fragment = state.shaders.get(1);
  for (const line of ['DCL SV[1], VERTEXID', 'I2F TEMP[2].x, SV[1].xxxx', 'SEQ TEMP[2].x, TEMP[2].xxxx, IN[0].zzzz',
    'MUL OUT[0].w, TEMP[2].xxxx, IN[0].wwww', 'ADD TEMP[1], IN[1], IN[2]', 'MOV OUT[1], TEMP[1]'])
    if (!vertex.includes(line)) throw Error('critic original vertex-ID/color fixture guard drift');
  if (!fragment.includes('DCL IN[0], GENERIC[0], CONSTANT')) throw Error('critic original constant flat color drift');
  const imm = vertex.match(/IMM\[0\] FLT32 \{([^}]+)\}/)[1].split(',').map(Number);
  const input = (attributeIndex, instance, id) => {
    const e = active[attributeIndex], b = state.buffers[e.slot], element = b.stride === 0 ? 0 : e.divisor ? Math.floor(instance / e.divisor) : id;
    const values = [0, 0, 0, 1], v = data(b.id);
    for (let lane = 0; lane < e.components; lane++) values[lane] = v.getFloat32(b.offset + e.sourceOffset + element * b.stride + lane * 4, true);
    return values;
  };
  const point = (instance, id, width, height) => {
    const p = input(0, instance, id);
    if (p[2] !== id || p[3] !== 1) throw Error('critic native vertex-ID tag drift');
    const x = f(f(p[0] * f(imm[0])) + f(f(instance * f(imm[0])) + f(imm[1])));
    return [(x + 1) * width / 2, (p[1] + 1) * height / 2];
  };
  const color = (instance, id) => {
    const a = input(1, instance, id), b = input(2, instance, id);
    return a.map((x, lane) => Math.round(255 * Math.max(0, Math.min(1, f(f(x + b[lane]) * .5)))));
  };
  const assemble = segment => {
    const result = [], count = segment.length;
    if (draw.mode === 1) for (let n = 0; n + 1 < count; n += 2) result.push(segment.slice(n, n + 2));
    else if (draw.mode === 2 || draw.mode === 3) {
      for (let n = 1; n < count; n++) result.push([segment[n - 1], segment[n]]);
      if (draw.mode === 2 && count > 1) result.push([segment[count - 1], segment[0]]);
    } else if (draw.mode === 4) for (let n = 0; n + 2 < count; n += 3) result.push(segment.slice(n, n + 3));
    else if (draw.mode === 5) for (let n = 2; n < count; n++) result.push(segment.slice(n - 2, n + 1));
    else if (draw.mode === 6) for (let n = 2; n < count; n++) result.push([segment[0], segment[n - 1], segment[n]]);
    else throw Error('critic unsupported primitive');
    return result;
  };
  const primitives = segments.flatMap(assemble), edge = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  let compiledSize, compiled = [];
  const compileGeometry = (width, height) => {
    const size = width + ':' + height; if (size === compiledSize) return;
    compiledSize = size; compiled = []; const unique = new Set();
    for (let instance = 0; instance < effective; instance++) for (const primitive of primitives) {
      const points = primitive.map(id => point(instance, id, width, height)), rgba = color(instance, primitive.at(-1));
      if (primitive.some(id => JSON.stringify(color(instance, id)) !== JSON.stringify(rgba))) throw Error('critic fixture exceeds constant-per-instance flat-color authority');
      if (points.length === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1]) continue;
      if (points.length === 3 && Math.abs(edge(points[0], points[1], points[2])) < 1e-7) continue;
      const key = JSON.stringify([points, rgba]); if (unique.has(key)) continue; unique.add(key);
      compiled.push({points, rgba});
    }
  };
  const pixel = (x, y, width, height) => {
    compileGeometry(width, height);
    const p = [x + .5, y + .5], optional = []; let sharedTriangles = 0;
    for (const {points, rgba} of compiled) {
      if (points.length === 2) {
        const [a, b] = points, horizontal = a[1] === b[1], vertical = a[0] === b[0];
        if (horizontal && vertical) continue;
        if (!horizontal && !vertical) throw Error('critic fixture requires axis-aligned lines');
        const axis = horizontal ? 0 : 1, orthogonal = 1 - axis;
        if (Math.abs(p[orthogonal] - a[orthogonal]) > 1e-6 || p[axis] < Math.min(a[axis], b[axis]) - 1e-6 || p[axis] > Math.max(a[axis], b[axis]) + 1e-6) continue;
        if (Math.abs(p[axis] - a[axis]) > 1e-6 && Math.abs(p[axis] - b[axis]) > 1e-6) return [rgba];
        optional.push(rgba);
      } else {
        const area = edge(points[0], points[1], points[2]); if (Math.abs(area) < 1e-7) continue;
        const sign = Math.sign(area), edges = [edge(points[0], points[1], p), edge(points[1], points[2], p), edge(points[2], points[0], p)].map(x => x * sign);
        if (edges.every(x => x > 1e-7)) return [rgba];
        if (edges.every(x => x >= -1e-7)) {optional.push(rgba); sharedTriangles++;}
      }
    }
    // Only declared GLES3 bounded half-open line endpoints/external triangle edges
    // have alternatives. Strict interiors/outside and shared triangle edges are exact.
    return sharedTriangles > 1 ? optional : [[0, 0, 0, 0], ...optional];
  };
  return {draw, index, ids, min, max, valid, restarts, normalize, normalized, fetches, segments, effective,
    nativeSize: normalize ? 4 : index.size, nativeOffset: normalize ? 0 : index.offset, pixel};
}

export function compareRestartPixels(bytes, model, width, height) {
  if (bytes.length !== width * height * 4) throw Error('critic full framebuffer byte length');
  let maxError = 0; const misses = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const expected = model.pixel(x, y, width, height), observed = [...bytes.subarray(4 * (y * width + x), 4 * (y * width + x + 1))];
    const error = Math.min(...expected.map(color => Math.max(...color.map((n, lane) => Math.abs(n - observed[lane])))));
    maxError = Math.max(maxError, error); if (error > 1 && misses.length < 8) misses.push({x, y, expected, observed, error});
  }
  return {pixels: width * height, maxError, misses, held: misses.length === 0};
}
