// Independent literal wire/row oracle. No implementation imports.
const U64 = (1n << 64n) - 1n;
const need = (condition, label) => { if (!condition) throw new Error(label); };
const u32 = value => { need(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, 'u32 oracle input'); return value; };
const u64 = value => { value = BigInt(value); need(value >= 0n && value <= U64, 'u64 oracle input'); return value; };
export const TYPES = Object.freeze({ toHost: 0x0205, fromHost: 0x0206, submit: 0x0207, destroyContext: 0x0201 });
export function header(type, { flags = 1, fence = 0n, context = 2, ring = 0 } = {}) {
  const out = new Uint8Array(24), view = new DataView(out.buffer);
  view.setUint32(0, u32(type), true); view.setUint32(4, u32(flags), true);
  view.setBigUint64(8, u64(fence), true); view.setUint32(16, u32(context), true);
  need(Number.isInteger(ring) && ring >= 0 && ring <= 255, 'ring byte'); out[20] = ring;
  return out;
}
export function submit(commands, fields = {}) {
  need(commands instanceof Uint8Array, 'literal command bytes');
  const out = new Uint8Array(32 + commands.length); out.set(header(TYPES.submit, fields));
  new DataView(out.buffer).setUint32(24, commands.length, true); out.set(commands, 32); return out;
}
export function outerTransfer(direction, { resource = 11, x = 0, y = 0, z = 0,
  width = 4, height = 4, depth = 1, offset = 0n, level = 0, stride = 16,
  layerStride = 0, ...fields } = {}) {
  need(direction === 'toHost' || direction === 'fromHost', 'literal transfer direction');
  const out = new Uint8Array(72), view = new DataView(out.buffer); out.set(header(TYPES[direction], fields));
  [x, y, z, width, height, depth].forEach((value, index) => view.setUint32(24 + index * 4, u32(value), true));
  view.setBigUint64(48, u64(offset), true);
  [resource, level, stride, layerStride].forEach((value, index) => view.setUint32(56 + index * 4, u32(value), true));
  return out;
}
export function decodeHeader(bytes) {
  need(bytes.byteLength >= 24, 'complete literal reply'); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { type: view.getUint32(0, true), flags: view.getUint32(4, true), fence: view.getBigUint64(8, true).toString(16).padStart(16, '0'),
    context: view.getUint32(16, true), ring: bytes[20], padding: [...bytes.subarray(21, 24)] };
}
// Deliberately bytewise, separately checked arithmetic and SG traversal. It emits
// physical addresses so tests can apply them to literal RAM snapshots themselves.
export function dirtyAddresses(segments, { offset, rowBytes, rowStride, rowCount }, ramStart, ramEnd) {
  const start = u64(ramStart), end = u64(ramEnd); need(start <= end, 'RAM range order');
  offset = u64(offset); rowBytes = u32(rowBytes); rowStride = u32(rowStride); rowCount = u32(rowCount);
  need(rowBytes > 0 && rowCount > 0 && rowStride >= rowBytes, 'literal non-overlapping logical rows');
  const normalized = segments.map(({ address, length }) => {
    address = u64(address); length = BigInt(u32(length));
    need(address >= start && address <= end && length <= end - address, 'entire SG segment in RAM');
    return { address, length };
  });
  const size = normalized.reduce((sum, entry) => sum + entry.length, 0n), addresses = [];
  for (let row = 0; row < rowCount; row++) for (let byte = 0; byte < rowBytes; byte++) {
    let logical = offset + BigInt(row) * BigInt(rowStride) + BigInt(byte);
    need(logical <= U64 && logical < size, 'complete dirty byte range');
    for (const segment of normalized) {
      if (logical < segment.length) { addresses.push(segment.address + logical); break; }
      logical -= segment.length;
    }
  }
  return addresses;
}
export function expectedScatter(snapshot, ramBase, addresses, dense) {
  need(addresses.length === dense.length, 'exact dense byte count');
  const result = snapshot.slice(), base = u64(ramBase);
  addresses.forEach((address, index) => { const offset = address - base; need(offset >= 0n && offset < BigInt(result.length), 'scatter snapshot range'); result[Number(offset)] = dense[index]; });
  return result;
}
