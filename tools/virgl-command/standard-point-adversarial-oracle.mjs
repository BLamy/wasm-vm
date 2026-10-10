// Fresh critic: literal commands/uploads and GLES point rasterization only.
// This oracle imports no renderer, compiler, worker point model or pixel result.
const f32 = Math.fround;
const need = (condition, message) => { if (!condition) throw Error(message); };
const equal = (a, b, message) => need(JSON.stringify(a) === JSON.stringify(b), message);
export const unhex = text => Uint8Array.from(text.match(/../g) ?? [], n => parseInt(n, 16));

export function originalPointState(history) {
  const contexts = new Map(); let current;
  for (const record of history) {
    if (!contexts.has(record.ctx)) contexts.set(record.ctx, { elements: new Map(), shaders: new Map(), rasterizers: new Map(), rasterizer: { bits: 0, size: 1 }, blends: new Map(), blendColor: [0, 0, 0, 0], buffers: [] });
    current = contexts.get(record.ctx);
    const raw = unhex(record.hex), v = new DataView(raw.buffer);
    for (let offset = 0; offset < raw.length;) {
      need(offset + 4 <= raw.length, 'critic literal header bounds');
      const h = v.getUint32(offset, true), count = h >>> 16, op = h & 255, kind = h >>> 8 & 255;
      need(offset + 4 * (count + 1) <= raw.length, 'critic literal payload bounds');
      const w = Array.from({ length: count }, (_, i) => v.getUint32(offset + 4 + 4 * i, true));
      if (op === 1 && kind === 5) current.elements.set(w[0], Array.from({ length: (count - 1) / 4 }, (_, i) => ({ offset: w[1 + 4 * i], divisor: w[2 + 4 * i], slot: w[3 + 4 * i], components: w[4 + 4 * i] - 27 })));
      if (op === 2 && kind === 5) current.selected = w[0];
      if (op === 6) current.buffers = Array.from({ length: count / 3 }, (_, i) => ({ stride: w[3 * i], offset: w[3 * i + 1], id: w[3 * i + 2] }));
      if (op === 11) current.index = count === 1 ? null : { id: w[0], size: w[1], offset: w[2] };
      if (op === 1 && kind === 4) current.shaders.set(w[1], new TextDecoder().decode(raw.subarray(offset + 24, offset + 24 + w[2] - 1)));
      if (op === 1 && kind === 2) current.rasterizers.set(w[0], { bits: w[1], size: v.getFloat32(offset + 12, true) });
      if (op === 2 && kind === 2) current.rasterizer = w[0] === 0 ? { bits: 0, size: 1 } : current.rasterizers.get(w[0]);
      if (op === 1 && kind === 1) current.blends.set(w[0], w[3]);
      if (op === 2 && kind === 1) current.blend = w[0] === 0 ? null : current.blends.get(w[0]);
      if (op === 14) current.blendColor = Array.from({ length: 4 }, (_, i) => v.getFloat32(offset + 4 + i * 4, true));
      if (op === 4) current.viewport = Array.from({ length: 6 }, (_, i) => v.getFloat32(offset + 8 + i * 4, true));
      if (op === 15) current.scissor = [w[1] & 65535, w[1] >>> 16, w[2] & 65535, w[2] >>> 16];
      if (op === 8) current.draw = { start: w[0], count: w[1], mode: w[2], indexed: w[3] === 1, instances: w[4], enabled: w[7] === 1, marker: w[8] };
      offset += 4 * (count + 1);
    }
  }
  need(current?.draw?.mode === 0, 'critic original POINTS'); return current;
}

export function independentPointModel(history, buffers, range) {
  const s = originalPointState(history), d = s.draw, effective = Math.max(1, d.instances), elements = s.elements.get(s.selected);
  const view = id => { const b = buffers.get(id); need(Boolean(b), 'critic original buffer exists'); return new DataView(b.buffer, b.byteOffset, b.byteLength); };
  const ids = Array.from({ length: d.count }, (_, i) => {
    if (!d.indexed) return d.start + i;
    const at = s.index.offset + i * s.index.size, v = view(s.index.id);
    return s.index.size === 1 ? v.getUint8(at) : s.index.size === 2 ? v.getUint16(at, true) : v.getUint32(at, true);
  });
  const valid = ids.filter(id => !d.enabled || id !== d.marker), min = valid.length ? Math.min(...valid) : null, max = valid.length ? Math.max(...valid) : null;
  const sentinel = d.indexed ? 2 ** (8 * s.index.size) - 1 : null;
  const normalized = d.indexed && ids.some(id => d.enabled && id === d.marker ? id !== sentinel : id === sentinel);
  const nativeBytes = new Uint8Array(normalized ? ids.length * 4 : 0);
  if (normalized) { const v = new DataView(nativeBytes.buffer); ids.forEach((id, i) => v.setUint32(i * 4, d.enabled && id === d.marker ? 0xffffffff : id, true)); }
  const vertex = s.shaders.get(0), fragment = s.shaders.get(1), immediate = vertex.match(/IMM\[0\] FLT32 \{([^}]+)\}/)?.[1].split(',').map(n => f32(Number(n)));
  const clipZ = f32(Number(vertex.match(/IMM\[1\] FLT32 \{([^,]+)/)?.[1]));
  need(Boolean(immediate) && Number.isFinite(clipZ), 'critic original projection');
  for (const operation of ['DCL SV[0], INSTANCEID', 'DCL SV[1], VERTEXID', 'I2F TEMP[0].x, SV[0].xxxx',
    'MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].yyyy, IMM[0].zzzz', 'MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx',
    'MOV OUT[0].y, IN[0].yyyy', 'MOV OUT[0].z, IMM[1].xxxx', 'SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz', 'MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww']) need(vertex.includes(operation), 'critic original vertex operation ' + operation);
  const sizeDeclared = /DCL OUT\[31\](?:\.x)?, PSIZE/.test(vertex), generic = fragment.includes('GENERIC[15]');
  if (sizeDeclared) need(vertex.includes('MOV OUT[31]'), 'critic original PSIZE write');
  const used = [0, ...(sizeDeclared ? [1] : []), ...(generic ? [15] : [])];
  const input = (which, instance, id) => { const e = elements[which], b = s.buffers[e.slot], n = !b.stride ? 0 : e.divisor ? Math.floor(instance / e.divisor) : id, out = [0, 0, 0, 1]; for (let lane = 0; lane < e.components; lane++) out[lane] = view(b.id).getFloat32(b.offset + e.offset + n * b.stride + lane * 4, true); return out; };
  const fetches = used.map(attributeIndex => { const e = elements[attributeIndex], b = s.buffers[e.slot], offset = b.offset + e.offset, constant = b.stride === 0;
    const first = valid.length ? constant || e.divisor ? 0 : min : null, last = valid.length ? constant ? 0 : e.divisor ? Math.floor((effective - 1) / e.divisor) : max : null;
    const genericValues = input(attributeIndex, 0, min ?? 0), componentWords = constant ? Array.from({ length: e.components }, (_, lane) => view(b.id).getUint32(offset + lane * 4, true)) : [];
    return { attributeIndex, resourceId: b.id, stride: b.stride, offset, components: e.components, constant, divisor: e.divisor, nativeDivisor: constant ? 0 : Math.min(65536, e.divisor), firstElement: first, lastElement: last, firstByte: first === null ? null : offset + first * b.stride, requiredEnd: last === null ? null : offset + last * b.stride + e.components * 4, ...(constant ? { genericValues, componentWords } : {}) }; });
  const pointUniform = [s.rasterizer.size, s.rasterizer.bits & (1 << 24) ? 1 : 0], winsysY = s.viewport[1] < 0 ? -1 : 1, points = [];
  for (let instance = 0; instance < effective; instance++) for (const id of valid) {
    const a = input(0, instance, id), w = f32((a[2] === id ? 1 : 0) * a[3]);
    // GLES3 clips point centers against Z; the square may cover XY-outside centers.
    if (w !== 1 || clipZ < -w || clipZ > w) continue;
    const x = f32(f32(a[0] * immediate[0]) + f32(f32(instance * immediate[1]) + immediate[2]));
    const originalSize = pointUniform[1] ? sizeDeclared ? input(1, instance, id)[0] : 1 : pointUniform[0];
    need(Number.isFinite(originalSize) && originalSize > 0, 'critic defined point size');
    const size = Math.min(range[1], Math.max(range[0], originalSize));
    const originalColor = generic ? input(15, instance, id) : [0, 0, 0, 1];
    const rgba = [(Math.imul(id, 17) & 255) / 256, originalColor[1], originalColor[2], f32(originalColor[3] + f32(instance * .0625))];
    points.push({ instance, id, x: x * s.viewport[0] + s.viewport[3], y: f32(a[1] * winsysY) * Math.abs(s.viewport[1]) + s.viewport[4], originalSize, size, rgba });
  }
  const pixel = (x, y) => {
    let rgba = [0, 0, 0, 0];
    if (s.rasterizer.bits & (1 << 14)) { const box = s.scissor; if (!box || x < box[0] || y < box[1] || x >= box[2] || y >= box[3]) return rgba; }
    for (const p of points) {
      const dx = x + .5 - p.x, dy = y + .5 - p.y;
      if (Math.abs(dx) >= p.size / 2 || Math.abs(dy) >= p.size / 2) continue;
      const coord = [.5 + dx / p.size, .5 - winsysY * dy / p.size, 0, 1]; let value;
      if (fragment.includes('0: MOV OUT[0], IMM[0]\n1: END')) value = fragment.match(/IMM\[0\] FLT32 \{([^}]+)\}/)[1].split(',').map(n => f32(Number(n)));
      else if (fragment.includes('MOV OUT[0], IN[31]')) value = p.rgba;
      else if (fragment.includes('MOV OUT[0].x, IN[31].xxxx')) value = [p.rgba[0], coord[1], coord[0], p.rgba[3]];
      else if (fragment.includes('MOV OUT[0], TEMP[0].yxwz')) value = [coord[1], coord[0], 1, 0];
      else if (fragment.includes('MOV OUT[0], TEMP[0].zwzw')) value = [0, 1, 0, 1];
      else if (fragment.includes('MOV OUT[0].xy, TEMP[0].yxxx')) value = [coord[1], coord[0], 0, 1];
      else { need(fragment.includes('MOV OUT[0], TEMP[0]'), 'critic supported original fragment body'); value = coord; }
      if (s.blend & 1) {
        need((s.blend >>> 1 & 7) === 0 && (s.blend >>> 4 & 31) === 7 && (s.blend >>> 9 & 31) === 8 && (s.blend >>> 14 & 7) === 0 && (s.blend >>> 17 & 31) === 1 && (s.blend >>> 22 & 31) === 17, 'critic original constant-color/alpha blend');
        value = value.map((n, lane) => lane === 3 ? n : f32(Math.max(0, Math.min(1, n)) * s.blendColor[lane]) + rgba[lane] / 255 * s.blendColor[3]);
      }
      rgba = value.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255));
    }
    return rgba;
  };
  return { state: s, draw: d, ids, points, effective, min, max, valid: valid.length, restarts: ids.length - valid.length, normalized, nativeBytes, nativeSize: normalized ? 4 : d.indexed ? s.index.size : 0, nativeOffset: normalized ? 0 : d.indexed ? s.index.offset : 0, pointUniform, winsysY, fetches, pixel };
}

export function independentPointPixels(raw, model, width, height) {
  need(raw.length === width * height * 4, 'critic full pixel byte count'); let maxError = 0, covered = 0; const misses = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const expected = model.pixel(x, y), observed = Array.from(raw.subarray(4 * (y * width + x), 4 * (y * width + x + 1)));
    if (expected.some(n => n)) covered++;
    const error = Math.max(...expected.map((n, lane) => Math.abs(n - observed[lane]))); maxError = Math.max(maxError, error);
    if (error > 1 && misses.length < 12) misses.push({ x, y, expected, observed, error });
  }
  return { held: misses.length === 0, pixels: width * height, covered, maxError, misses };
}

// Predictions are captured from original bytes before any observed framebuffer read.
export async function criticPointFrame(r, record, saveBlob) {
  const model = independentPointModel(r.history, r.bufferBytes, r.range), { gl, c } = r;
  const prediction = { ids: model.ids, min: model.min, max: model.max, points: model.points, fetches: model.fetches, pointUniform: model.pointUniform, winsysY: model.winsysY, sample: model.pixel(2, 3) };
  c.same(record.result.gpuComplete, true, 'critic real final point fence');
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.allocations[0].storage.texture, 0); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); for (const name of ['PACK_ROW_LENGTH', 'PACK_SKIP_PIXELS', 'PACK_SKIP_ROWS']) gl.pixelStorei(gl[name], 0); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const pixels = new Uint8Array(r.width * r.height * 4); gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.deleteFramebuffer(fb);
  const draw = record.result.draws.at(-1), buffers = [], normalized = [];
  for (const [id, original] of r.bufferBytes) {
    const generation = id === 6 ? draw.indexResourceGeneration ?? r.allocations.find(a => a.metadata.id === id).generation : draw.vertexFetches.find(a => a.resourceId === id)?.resourceGeneration ?? r.allocations.find(a => a.metadata.id === id).generation;
    const allocation = r.allocations.find(a => a.metadata.id === id && a.generation === generation), actual = new Uint8Array(original.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER, allocation.storage.buffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, actual); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    equal(Array.from(actual), Array.from(original), 'critic original physical point bytes');
    buffers.push({ resourceId: id, generation, nativeBuffer: r.trace.id(allocation.storage.buffer), blob: await saveBlob(r, actual) });
  }
  for (const n of r.normalized.filter(n => n.label === record.label)) { c.same(n.deleted, true, 'critic normalized point storage retired'); equal(Array.from(n.raw), Array.from(model.nativeBytes), 'critic physical normalized original indices'); normalized.push({ nativeBuffer: n.nativeBuffer, bytes: n.bytes, blob: await saveBlob(r, n.raw) }); }
  const calls = r.trace.calls.filter(n => n.label === record.label).map(({ program, ...n }) => n), nativeState = r.nativeState.filter(n => n.label === record.label), audit = independentPointPixels(pixels, model, r.width, r.height);
  const frame = { label: record.label, width: r.width, height: r.height, range: r.range, history: r.history.map(n => ({ ...n })), inputs: r.exchanges.map(n => ({ ...n })), prediction, native: { calls, state: nativeState, buffers, normalized }, audit, pixels: await saveBlob(r, pixels) };
  r.frames.push(frame); c.same(audit.misses, [], record.label + ' critic original point pixels');
  const instanced = model.effective > 1;
  for (const call of calls) { c.same(call.name, (model.draw.indexed ? 'drawElements' : 'drawArrays') + (instanced ? 'Instanced' : ''), 'critic native point entry'); c.same(call.args, model.draw.indexed ? [0, model.draw.count, { 1: 5121, 2: 5123, 4: 5125 }[model.nativeSize], model.nativeOffset, ...(instanced ? [model.effective] : [])] : [0, model.draw.start, model.draw.count, ...(instanced ? [model.effective] : [])], 'critic original point arguments'); }
  for (const state of nativeState) { c.same(state.pointSize, model.pointUniform, 'critic physical typed size binding'); if (state.pointCoordY !== null) c.same(state.pointCoordY, model.winsysY, 'critic physical typed orientation'); }
  c.same([draw.actualMinIndex, draw.actualMaxIndex, draw.validIndexCount, draw.restartCount, draw.vertexWork], [model.min, model.max, model.valid, model.restarts, model.draw.count * model.effective], 'critic original point bounds and work');
  c.same(gl.getError(), gl.NO_ERROR, 'critic point readback native errors'); return frame;
}
