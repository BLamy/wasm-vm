// Fresh-critic oracle. Expectations use literal original commands/uploads only.
// Deliberately imports neither the renderer nor the worker assembly model.
const f32 = Math.fround;
const need = (condition, message) => { if (!condition) throw Error(message); };
const equal = (a, b, message) => need(JSON.stringify(a) === JSON.stringify(b), message);
export const unhex = text => Uint8Array.from(text.match(/../g) ?? [], n => parseInt(n, 16));

export function originalState(history) {
  const contexts = new Map(); let current;
  for (const record of history) {
    if (!contexts.has(record.ctx)) contexts.set(record.ctx, { elements: new Map(), shaders: new Map(), buffers: [], rasterizers: new Map() });
    current = contexts.get(record.ctx);
    const raw = unhex(record.hex), view = new DataView(raw.buffer);
    for (let offset = 0; offset < raw.length;) {
      need(offset + 4 <= raw.length, 'literal header bounds');
      const header = view.getUint32(offset, true), count = header >>> 16, op = header & 255, kind = header >>> 8 & 255;
      need(offset + 4 * (count + 1) <= raw.length, 'literal payload bounds');
      const words = Array.from({ length: count }, (_, i) => view.getUint32(offset + 4 + 4 * i, true));
      if (op === 1 && kind === 5) current.elements.set(words[0], Array.from({ length: (count - 1) / 4 }, (_, i) => ({ offset: words[1 + 4 * i], divisor: words[2 + 4 * i], slot: words[3 + 4 * i], components: words[4 + 4 * i] - 27 })));
      if (op === 2 && kind === 5) current.selected = words[0];
      if (op === 6) current.buffers = Array.from({ length: count / 3 }, (_, i) => ({ stride: words[3 * i], offset: words[3 * i + 1], id: words[3 * i + 2] }));
      if (op === 11) current.index = count === 1 ? null : { id: words[0], size: words[1], offset: words[2] };
      if (op === 1 && kind === 4) current.shaders.set(words[1], new TextDecoder().decode(raw.subarray(offset + 24, offset + 24 + words[2] - 1)));
      if (op === 1 && kind === 2) current.rasterizers.set(words[0], words[1]);
      if (op === 2 && kind === 2) current.rasterizer = current.rasterizers.get(words[0]);
      if (op === 8) current.draw = { start: words[0], count: words[1], mode: words[2], indexed: words[3] === 1, instances: words[4], enabled: words[7] === 1, marker: words[8] };
      offset += 4 * (count + 1);
    }
  }
  need(current?.draw, 'literal original draw exists'); return current;
}

export function primitiveGroups(mode, ids) {
  const result = [];
  if (mode === 1) { for (let i = 0; i + 1 < ids.length; i += 2) result.push([ids[i], ids[i + 1]]); }
  else if (mode === 2 || mode === 3) {
    for (let i = 1; i < ids.length; i++) result.push([ids[i - 1], ids[i]]);
    if (mode === 2 && ids.length >= 2) result.push([ids.at(-1), ids[0]]);
  } else if (mode === 4) { for (let i = 0; i + 2 < ids.length; i += 3) result.push(ids.slice(i, i + 3)); }
  else if (mode === 5) { for (let i = 2; i < ids.length; i++) result.push(i % 2 ? [ids[i - 1], ids[i - 2], ids[i]] : [ids[i - 2], ids[i - 1], ids[i]]); }
  else if (mode === 6) { for (let i = 2; i < ids.length; i++) result.push([ids[0], ids[i - 1], ids[i]]); }
  else throw Error('unsupported original primitive');
  return result;
}

export function independentModel(history, buffers) {
  const s = originalState(history), d = s.draw, effective = Math.max(1, d.instances);
  const view = id => { const raw = buffers.get(id); need(Boolean(raw), 'original buffer exists'); return new DataView(raw.buffer, raw.byteOffset, raw.byteLength); };
  const readIndex = i => {
    if (!d.indexed) return d.start + i;
    const at = s.index.offset + i * s.index.size, v = view(s.index.id);
    return s.index.size === 1 ? v.getUint8(at) : s.index.size === 2 ? v.getUint16(at, true) : v.getUint32(at, true);
  };
  const ids = Array.from({ length: d.count }, (_, i) => readIndex(i)), segments = []; let segment = [];
  for (const id of ids) { if (d.enabled && id === d.marker) { segments.push(segment); segment = []; } else segment.push(id); }
  segments.push(segment);
  const valid = segments.flat(), min = valid.length ? valid.reduce((a, b) => Math.min(a, b)) : null, max = valid.length ? valid.reduce((a, b) => Math.max(a, b)) : null;
  const groups = segments.flatMap(part => primitiveGroups(d.mode, part)), assembled = d.mode === 2 || d.mode === 6;
  const sentinel = d.indexed ? 2 ** (8 * s.index.size) - 1 : null;
  const normalized = assembled || d.indexed && ids.some(id => d.enabled && id === d.marker ? id !== sentinel : id === sentinel);
  const nativeIds = assembled ? groups.flat() : normalized ? ids.map(id => d.enabled && id === d.marker ? 0xffffffff : id) : ids;
  const nativeBytes = new Uint8Array(normalized ? nativeIds.length * 4 : 0), output = new DataView(nativeBytes.buffer);
  if (normalized) nativeIds.forEach((id, i) => output.setUint32(i * 4, id, true));
  const nativeMode = assembled ? d.mode === 2 ? 1 : 4 : d.mode, nativeIndexed = d.indexed || assembled;
  const nativeCount = assembled ? nativeIds.length : d.count, nativeSize = normalized ? 4 : d.indexed ? s.index.size : 0, nativeOffset = normalized ? 0 : d.indexed ? s.index.offset : 0;
  need(nativeCount <= d.count * 3, 'independent native expansion bound');
  const elements = s.elements.get(s.selected);
  const fetches = [0, 1, 2].map(attributeIndex => {
    const e = elements[attributeIndex], b = s.buffers[e.slot], offset = b.offset + e.offset, constant = b.stride === 0;
    const first = valid.length === 0 ? null : constant || e.divisor ? 0 : min;
    const last = valid.length === 0 ? null : constant ? 0 : e.divisor ? Math.floor((effective - 1) / e.divisor) : max;
    const genericValues = [0, 0, 0, 1], componentWords = [];
    if (constant) for (let lane = 0; lane < e.components; lane++) { genericValues[lane] = view(b.id).getFloat32(offset + lane * 4, true); componentWords.push(view(b.id).getUint32(offset + lane * 4, true)); }
    return { attributeIndex, resourceId: b.id, stride: b.stride, offset, components: e.components, divisor: e.divisor, nativeDivisor: constant ? 0 : Math.min(65536, e.divisor), constant, firstElement: first, lastElement: last,
      firstByte: first === null ? null : offset + first * b.stride, requiredEnd: last === null ? null : offset + last * b.stride + e.components * 4, ...(constant ? { genericValues, componentWords } : {}) };
  });
  const attribute = (which, instance, id) => {
    const e = elements[which], b = s.buffers[e.slot], n = b.stride === 0 ? 0 : e.divisor ? Math.floor(instance / e.divisor) : id;
    const result = [0, 0, 0, 1]; for (let lane = 0; lane < e.components; lane++) result[lane] = view(b.id).getFloat32(b.offset + e.offset + n * b.stride + lane * 4, true);
    return result;
  };
  const vertex = s.shaders.get(0), fragment = s.shaders.get(1), immediate = vertex.match(/IMM\[0\] FLT32 \{([^}]+)\}/)?.[1].split(',').map(n => f32(Number(n)));
  need(Boolean(immediate), 'literal original projection');
  for (const operation of ['DCL SV[1], VERTEXID', 'SEQ TEMP[2].x, TEMP[2].xxxx, IN[0].zzzz', 'MUL OUT[0].w, TEMP[2].xxxx, IN[0].wwww', 'ADD TEMP[1], IN[1], IN[2]', 'MUL TEMP[1], TEMP[1], IMM[1].xxxx', 'IMM[4] UINT32 {17,17,17,17}', 'UMUL TEMP[2].x, SV[1].xxxx, IMM[4].xxxx', 'AND TEMP[2].x, TEMP[2].xxxx, IMM[2].xxxx', 'MUL OUT[1].x, TEMP[2].xxxx, IMM[3].xxxx']) need(vertex.includes(operation), 'original shader operation: ' + operation);
  const smooth = fragment.includes('GENERIC[0], PERSPECTIVE'); need(smooth || fragment.includes('GENERIC[0], CONSTANT'), 'literal original interpolation');
  const color = (instance, id) => {
    const a = attribute(1, instance, id), b = attribute(2, instance, id), out = a.map((n, k) => f32(f32(n + b[k]) * .5));
    out[0] = (Math.imul(id, 17) & 255) / 256;
    return out.map(n => Math.round(Math.min(1, Math.max(0, n)) * 255));
  };
  const point = (instance, id, width, height) => {
    const p = attribute(0, instance, id); need(p[2] === id && p[3] === 1, 'original vertexID clip-W tag');
    return [(f32(f32(p[0] * immediate[0]) + f32(f32(instance * immediate[0]) + immediate[1])) + 1) * width / 2, (p[1] + 1) * height / 2];
  };
  let trianglesAndLines;
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const pixel = (x, y, width, height) => {
    if (!trianglesAndLines) trianglesAndLines = Array.from({ length: effective }, (_, instance) => groups.map(group => ({ points: group.map(id => point(instance, id, width, height)), colors: group.map(id => color(instance, id)) }))).flat();
    const p = [x + .5, y + .5]; let allowed = [[0, 0, 0, 0]], boundaryColors = [];
    for (const { points, colors } of trianglesAndLines) {
      let rgba = colors.at(-1);
      if (points.length === 3) {
        const area = cross(points[0], points[1], points[2]); if (Math.abs(area) < 1e-7) continue;
        const ccw = Boolean(s.rasterizer & 0x8000), cull = s.rasterizer >>> 8 & 3;
        if (cull === 2 && (ccw ? area > 0 : area < 0)) continue;
        const edges = [cross(points[0], points[1], p), cross(points[1], points[2], p), cross(points[2], points[0], p)].map(n => Math.sign(area) * n);
        if (!edges.every(n => n >= -1e-7)) continue;
        if (smooth) { const barycentric = [cross(points[1], points[2], p) / area, cross(points[2], points[0], p) / area, cross(points[0], points[1], p) / area]; rgba = colors[0].map((_, lane) => Math.round(barycentric.reduce((sum, n, i) => sum + n * colors[i][lane], 0))); }
        if (edges.every(n => n > 1e-7)) { allowed = [rgba]; boundaryColors = []; }
        else { boundaryColors.push(rgba); allowed.push(rgba); if (boundaryColors.length > 1) allowed = [...boundaryColors]; }
      } else {
        const [a, b] = points, dx = b[0] - a[0], dy = b[1] - a[1];
        if (dx === 0 && dy === 0) continue;
        need(Math.abs(dx) < 1e-7 || Math.abs(dy) < 1e-7, 'independent axis-aligned line domain');
        const along = Math.abs(dx) < 1e-7 ? 1 : 0, across = 1 - along;
        if (Math.abs(p[across] - a[across]) > 1e-5 || p[along] < Math.min(a[along], b[along]) - 1e-5 || p[along] > Math.max(a[along], b[along]) + 1e-5) continue;
        if (smooth) { const t = (p[along] - a[along]) / (b[along] - a[along]); rgba = colors[0].map((n, lane) => Math.round(n + t * (colors[1][lane] - n))); }
        if (Math.abs(p[along] - a[along]) > 1e-5 && Math.abs(p[along] - b[along]) > 1e-5) allowed = [rgba]; else allowed.push(rgba);
      }
    }
    return allowed;
  };
  return { state: s, draw: d, ids, segments, groups, min, max, valid: valid.length, restarts: ids.length - valid.length, effective, assembled, normalized, nativeIds, nativeBytes, nativeMode, nativeCount, nativeSize, nativeOffset, nativeIndexed, fetches, smooth, pixel };
}

export function independentPixels(raw, model, width, height) {
  need(raw.length === width * height * 4, 'full pixel byte count'); const misses = []; let maxError = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const expected = model.pixel(x, y, width, height), observed = Array.from(raw.subarray(4 * (y * width + x), 4 * (y * width + x + 1)));
    const error = Math.min(...expected.map(color => Math.max(...color.map((n, lane) => Math.abs(n - observed[lane])))));
    maxError = Math.max(maxError, error); if (error > 1 && misses.length < 8) misses.push({ x, y, expected, observed, error });
  }
  return { held: misses.length === 0, pixels: width * height, maxError, misses };
}

// Capture independently derived expectations BEFORE querying any observed pixels.
export async function criticFrame(r, record, saveBlob) {
  const model = independentModel(r.history, r.bufferBytes), { gl, c } = r;
  const prediction = { ids: model.ids, nativeIds: model.nativeIds, nativeCount: model.nativeCount, nativeMode: model.nativeMode, min: model.min, max: model.max, smooth: model.smooth,
    sample: model.pixel(3, 2, r.width, r.height) };
  c.same(record.result.gpuComplete, true, 'critic completed real native fence');
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.allocations[0].storage.texture, 0); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); for (const name of ['PACK_ROW_LENGTH', 'PACK_SKIP_PIXELS', 'PACK_SKIP_ROWS']) gl.pixelStorei(gl[name], 0); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const pixels = new Uint8Array(r.width * r.height * 4); gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.deleteFramebuffer(fb);
  const buffers = [], normalized = [], draw = record.result.draws.at(-1);
  for (const [id, original] of r.bufferBytes) {
    const generation = id === 22 ? draw.indexResourceGeneration ?? r.allocations.find(a => a.metadata.id === id).generation : draw.vertexFetches.find(a => a.resourceId === id).resourceGeneration;
    const allocation = r.allocations.find(a => a.metadata.id === id && a.generation === generation), actual = new Uint8Array(original.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER, allocation.storage.buffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, actual); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    equal(Array.from(actual), Array.from(original), 'critic actual original GPU storage');
    buffers.push({ resourceId: id, generation, nativeBuffer: r.trace.id(allocation.storage.buffer), blob: await saveBlob(r, actual) });
  }
  for (const entry of r.normalized.filter(n => n.label === record.label)) {
    c.same(entry.deleted, true, 'critic private native object retires after fence'); equal(Array.from(entry.raw), Array.from(model.nativeBytes), 'critic private physical list bytes');
    normalized.push({ nativeBuffer: entry.nativeBuffer, bytes: entry.bytes, blob: await saveBlob(r, entry.raw) });
  }
  const audit = independentPixels(pixels, model, r.width, r.height), calls = r.trace.calls.filter(call => call.label === record.label).map(({ program, ...a }) => a);
  const frame = { label: record.label, width: r.width, height: r.height, history: r.history.map(h => ({ ...h })), inputs: r.exchanges.map(e => ({ ...e })), prediction,
    native: { calls, buffers, normalized, state: r.nativeState.filter(s => s.label === record.label) }, audit, pixels: await saveBlob(r, pixels) };
  r.frames.push(frame); c.same(audit.misses, [], record.label + ' critic original pixel oracle');
  c.same(frame.native.state.map(s => s.convention), Array(calls.length).fill(0x8e4e), 'critic LAST at actual native draw');
  c.same(draw.vertexWork, model.draw.count * model.effective, 'critic original words including tails charged');
  c.same([draw.nativeCount, draw.nativeMode, draw.nativeVertexWork], [model.nativeCount, model.nativeMode, model.nativeCount * model.effective], 'critic independent native count/work');
  c.same(gl.getError(), gl.NO_ERROR, 'critic native capture error'); return frame;
}
