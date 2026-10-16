export {selectorKeys, zeroSelectors} from '../virgl-shadow-shaders/fixtures.mjs';
import {zeroSelectors, shadowText, passFragment} from '../virgl-shadow-shaders/fixtures.mjs';
export const targets = ['3D', 'CUBE', '2D_ARRAY'];
export const returns = ['FLOAT', 'SINT', 'UINT'];
export const profile = 'virgl-webgl2-standard-dimensional-texture-gles3-v1';
export function legal(stage, target, opcode) {
  return !(stage === 'vertex' && opcode === 'TXB') &&
    !(target === 'CUBE' && opcode === 'TXF') &&
    !(target !== '3D' && opcode === 'TXP');
}
export function dimensionalText(stage, f = {}) {
  const target = f.target ?? '3D', opcode = f.opcode ?? 'TEX';
  let text = shadowText(stage, {opcode, slot: f.slot ?? 0, declaration: f.declaration ?? target,
    target, type: f.type ?? 'FLOAT', mask: f.mask ?? '', source: f.source ?? 'IN[1]'});
  if (opcode === 'TXQ') text = text.replace('IMM[1], SAMP', 'IN[1], SAMP');
  if (f.biasProbe) text = text.replace('GENERIC[0], CONSTANT', 'GENERIC[0], PERSPECTIVE');
  return text;
}
export function pairTexts(stage, f) {
  if (stage === 'vertex') return {vertexText: dimensionalText(stage, f), fragmentText: passFragment};
  return {vertexText: 'VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: MOV OUT[2], IN[2]\n3: MOV OUT[3], IN[3]\n4: END\n', fragmentText: dimensionalText(stage, f)};
}
export function dimensionalFixtures() {
  const rows = [], add = f => rows.push({...f, name: [f.stage, f.target, f.type, f.opcode, f.slot, f.label ?? ''].join('/'),
    ...pairTexts(f.stage, f), selectors: {...zeroSelectors(), unsignedMask: ['TXF', 'TXQ'].includes(f.opcode) ? 2 : 0, unsignedColorMask: 1}});
  for (const stage of ['vertex', 'fragment']) for (const target of targets) for (const type of returns)
    for (const opcode of ['TEX', 'TXL', 'TXF', 'TXD', 'TXP', 'TXQ', 'TXB']) if (legal(stage, target, opcode))
      for (const slot of [0, 7, 15]) {
        add({stage, target, type, opcode, slot, biasProbe: opcode === 'TXB', face: 0});
        if (opcode === 'TXB' && target === 'CUBE' && slot === 7) for (let face = 1; face < 6; face++)
          add({stage, target, type, opcode, slot, biasProbe: true, face, label: 'bias-face' + face});
      }
  for (const stage of ['vertex', 'fragment']) for (const target of targets) {
    for (const mask of ['x', 'y', 'z', 'w', 'xz', 'yw']) add({stage, target, type: 'FLOAT', opcode: 'TXL', slot: 7, mask, label: 'mask-' + mask});
    for (const source of ['IN[1].wzyx', '|IN[1].xyzw|', '-|IN[1].xyzw|']) add({stage, target, type: 'FLOAT', opcode: 'TEX', slot: 15, source, label: source});
  }
  for (const stage of ['vertex', 'fragment']) for (const target of targets) for (const mask of ['xyz', 'xy', 'xz', 'w'])
    add({stage, target, type: 'UINT', opcode: 'TXQ', slot: 15, mask, label: 'query-mask-' + mask});
  for (const stage of ['vertex', 'fragment']) for (const type of returns)
    add({stage, target: '2D_ARRAY', type, opcode: 'TXL', slot: 7, layerProbe: true, label: 'round-clamp-layers'});
  return rows;
}
function word(value, type) {
  if (type !== 'FLOAT') return value >>> 0;
  return new Uint32Array(new Float32Array([value]).buffer)[0];
}
// Literal data identifies mip, layer/face, row, column and component separately.
export function texel(type, level, layer, x, y) {
  const code = level * 256 + layer * 32 + y * 4 + x;
  return [0, 1, 2, 3].map(lane => type === 'FLOAT' ? code + lane / 4 : type === 'SINT' ? -(8192 + code * 4 + lane) : (0x81234000 + code * 4 + lane) >>> 0);
}
export function extent(target, level) {
  const width = Math.max(1, 4 >> level), height = width;
  return {width, height, layers: target === '3D' ? width : target === 'CUBE' ? 6 : 5};
}
export function textureInputs(f) {
  return [0, 1, 2].map(level => {
    const e = extent(f.target, level), values = [];
    for (let z = 0; z < e.layers; z++) for (let y = 0; y < e.height; y++) for (let x = 0; x < e.width; x++) values.push(...texel(f.type, level, z, x, y));
    const Constructor = f.type === 'FLOAT' ? Float32Array : f.type === 'SINT' ? Int32Array : Uint32Array;
    return {level, ...e, bytes: new Uint8Array(new Constructor(values).buffer)};
  });
}
const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const neighbors = [-2, -.49, .49, .51, 1.49, 1.51, 3.49, 3.51, 4.49, 8];
export function grid(f) { return {width: f.biasProbe ? 4 : f.layerProbe ? neighbors.length : 6, height: f.biasProbe ? 4 : 3}; }
function coordinate(f, x, y) {
  const level = ['TXL', 'TXF', 'TXQ', 'TXD'].includes(f.opcode) ? y : 0, e = extent(f.target, level), g = grid(f);
  const layer = Math.min(e.layers - 1, Math.floor(x * e.layers / g.width));
  if (f.opcode === 'TXQ') return [y, 0, 0, 0];
  if (f.opcode === 'TXF') return [x % e.width, y % e.height, layer, y];
  if (f.target === 'CUBE') return [...directions[x], f.opcode === 'TXL' ? y : .5];
  const z = f.target === '3D' ? (layer + .5) / e.layers : f.layerProbe ? neighbors[x] : layer;
  return f.opcode === 'TXP' ? [1.25, .75, z * 2, 2] : [.625, .375, z, f.opcode === 'TXL' ? y : .5];
}
export function inputBytes(f) {
  const g = grid(f), positions = [], coordinates = [], dx = [], dy = [];
  if (f.biasProbe) {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]]) {
      positions.push(2 * x - 1, 2 * y - 1, 0, 1);
      const face = f.face ?? 0;
      const c = f.target === 'CUBE' ? directions[face].map((v, axis) => v || (axis === (face < 2 ? 2 : 0) ? 2 * x - 1 : 0)) : [x, y, f.target === '3D' ? .875 : 4];
      coordinates.push(...c, 2); dx.push(0, 0, 0, 0); dy.push(0, 0, 0, 0);
    }
  } else for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    positions.push(2 * (x + .5) / g.width - 1, 2 * (y + .5) / g.height - 1, 0, 1);
    coordinates.push(...coordinate(f, x, y));
    if (f.target === '3D') dx.push(0, 0, 2 ** y / 4, 0);
    else if (f.target === 'CUBE') dx.push(...(x < 2 ? [0, 0, 2 ** y / 2] : [2 ** y / 2, 0, 0]), 0);
    else dx.push(2 ** y / 4, 0, 99, 0); // Original array derivative z is not part of ESSL's gradient.
    dy.push(0, 0, 0, 0);
  }
  const Constructor = ['TXF', 'TXQ'].includes(f.opcode) ? Uint32Array : Float32Array;
  return {...g, vertices: positions.length / 4, positions: new Uint8Array(new Float32Array(positions).buffer),
    coordinates: new Uint8Array(new Constructor(coordinates).buffer), dx: new Uint8Array(new Float32Array(dx).buffer), dy: new Uint8Array(new Float32Array(dy).buffer)};
}
export function expectedWords(f, x, y) {
  let level = ['TXL', 'TXF', 'TXQ', 'TXD'].includes(f.opcode) ? y : f.biasProbe ? 2 : 0;
  let e = extent(f.target, level), layer, tx, ty, sampled;
  if (f.opcode === 'TXQ') sampled = [e.width, e.height, f.target === 'CUBE' ? 0 : e.layers, 3];
  else if (f.biasProbe) sampled = texel(f.type, 2, f.target === '3D' ? 0 : f.target === 'CUBE' ? f.face : 4, 0, 0).map(v => word(v, f.type));
  else {
    let c = coordinate(f, x, y);
    if (f.source?.endsWith('wzyx')) c = c.reverse();
    if (f.source?.startsWith('|')) c = c.map(Math.abs);
    if (f.source?.startsWith('-|')) c = c.map(v => -Math.abs(v));
    if (f.opcode === 'TXP') c = c.map((v, lane) => lane < 3 ? v / c[3] : v);
    if (f.target === 'CUBE') {
      const major = Math.max(...c.slice(0, 3).map(Math.abs)), axis = c.slice(0, 3).findIndex(v => Math.abs(v) === major);
      layer = axis * 2 + Number(c[axis] < 0); tx = Math.floor(e.width / 2); ty = Math.floor(e.height / 2);
      // For the wzyx probe, the original direction can land off the face center.
      const [a, b] = axis === 0 ? [c[0] > 0 ? -c[2] : c[2], -c[1]] : axis === 1 ? [c[0], c[1] > 0 ? c[2] : -c[2]] : [c[2] > 0 ? c[0] : -c[0], -c[1]];
      tx = Math.min(e.width - 1, Math.floor((a / major + 1) * e.width / 2)); ty = Math.min(e.height - 1, Math.floor((b / major + 1) * e.height / 2));
    } else if (f.opcode === 'TXF') [tx, ty, layer] = c;
    else {
      tx = Math.max(0, Math.min(e.width - 1, Math.floor(c[0] * e.width))); ty = Math.max(0, Math.min(e.height - 1, Math.floor(c[1] * e.height)));
      layer = Math.max(0, Math.min(e.layers - 1, f.target === '3D' ? Math.floor(c[2] * e.layers) : Math.floor(c[2] + .5)));
    }
    sampled = texel(f.type, level, layer, tx, ty).map(v => word(v, f.type));
  }
  const out = [0x12345678, 0x80000001, 0xdeadbeef, 0xffffffff];
  for (let lane = 0; lane < 4; lane++) if (!f.mask || f.mask.includes('xyzw'[lane])) out[lane] = sampled[lane];
  return out;
}
