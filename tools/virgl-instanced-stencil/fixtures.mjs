import { fixture as heldFixture, setup as heldSetup } from '../virgl-ordered-stencil/fixtures.mjs';
export { state, draw, join, packet, face, clear, dsa, refs } from '../virgl-ordered-stencil/fixtures.mjs';

export function fixture(options = {}) {
  const f = heldFixture(options);
  if (f.instanceUse === 'unused' || f.instanceUse === 'absent') {
    f.vertex = f.vertex.replace('10: I2F TEMP[0].y, SV[0].xxxx', '10: MOV TEMP[0].y, IMM[2].wwww');
    if (f.instanceUse === 'absent') f.vertex = f.vertex.replace('DCL SV[0], INSTANCEID\n', '');
  }
  if (f.attributeFormat) {
    const packed = [8, 123, 172, 173].includes(f.attributeFormat);
    f.attributeStride = packed ? 4 : 16;
    f.attributeDivisor ??= 3;
    const count = f.generic ? 1 : Math.floor((Math.max(1, f.instances) - 1) / f.attributeDivisor) + 1;
    const raw = new Uint8Array(12 + count * f.attributeStride), v = new DataView(raw.buffer);
    for (let i = 0; i < count; i++) {
      if (packed) {
        const z = f.attributeFormat === 173 ? (i % 2 ? -255 : 255) & 1023 : f.attributeFormat === 8 ? 768 - i * 64 : i + 1;
        v.setUint32(12 + i * 4, ((z << 20) | 1 << 30) >>> 0, true);
      } else for (let lane = 0; lane < 4; lane++) v.setFloat32(12 + i * 16 + lane * 4, [0, 0, .75 - i / 16, 1][lane], true);
    }
    f.buffers.set(5, raw);
  }
  return f;
}

export function setup(f) {
  const raw = heldSetup(f);
  if (!f.attributeFormat) return raw;
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let at = 0; at < raw.length;) {
    const head = v.getUint32(at, true), opcode = head & 255, kind = head >>> 8 & 255, words = head >>> 16;
    if (opcode === 1 && kind === 5) {
      if (words !== 13) throw Error('original element fixture drift');
      v.setUint32(at + 44, f.attributeDivisor, true);
      v.setUint32(at + 52, f.attributeFormat, true);
    }
    if (opcode === 6) {
      if (words !== 9) throw Error('original vertex binding fixture drift');
      v.setUint32(at + 28, f.generic ? 0 : f.attributeStride, true);
    }
    at += 4 * (words + 1);
  }
  return raw;
}
