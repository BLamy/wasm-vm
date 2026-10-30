// Local, uncompressed session archives. Entries are addressed by digest, never a path.
export const BUNDLE_VERSION = 1;
export const BUNDLE_MAX_BYTES = 4 * 1024 ** 3;
export const BUNDLE_MAX_OBJECT_BYTES = 640 * 1024 ** 2;
export const BUNDLE_MAX_HEADER_BYTES = 8 * 1024 ** 2;
export const BUNDLE_MAX_OBJECTS = 65536;
export const BUNDLE_CHUNK_BYTES = 1024 ** 2;
const magic = 'WVBUND01', prefixBytes = 16;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const digest = /^[0-9a-f]{64}$/;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).join(',') === names.join(',');
export class SessionBundleError extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.name = 'SessionBundleError'; this.code = code; }
}
export const bundleNeed = (value, detail, code = 'BundleFormat') => {
  if (!value) throw new SessionBundleError(code, detail);
};
const need = bundleNeed;
export function bundleReference(value, max = BUNDLE_MAX_OBJECT_BYTES) {
  need(keys(value, ['sha256', 'length']) && typeof value.sha256 === 'string' && digest.test(value.sha256)
    && typeof value.length === 'string' && /^[1-9][0-9]{0,9}$/.test(value.length)
    && Number(value.length) <= max, 'object reference');
  return {sha256: value.sha256, length: value.length};
}
export function encodeBundleHeader(value) {
  const storage = value?.portability === 'wasm-vm-witness-storage-v2';
  need(keys(value, storage
    ? ['version', 'encoding', 'portability', 'scope', 'manifest', 'objects', 'uncompressedBytes']
    : ['version', 'encoding', 'portability', 'runtime', 'manifest', 'objects', 'uncompressedBytes']), 'header fields');
  need(value.version === BUNDLE_VERSION && value.encoding === 'raw'
    && (storage || value.portability === 'wasm-vm-installed-build-v1'), 'unsupported version, encoding or portability policy');
  if (storage) need(value.scope === 'storage-only', 'storage archive scope');
  else need(keys(value.runtime, ['wasm', 'gpu']) && typeof value.runtime.wasm === 'string' && digest.test(value.runtime.wasm)
    && (value.runtime.gpu === null || typeof value.runtime.gpu === 'string' && digest.test(value.runtime.gpu)), 'runtime identity');
  const manifest = bundleReference(value.manifest, 1024 ** 2);
  need(Array.isArray(value.objects) && value.objects.length > 0 && value.objects.length <= BUNDLE_MAX_OBJECTS, 'object count');
  let total = 0, previous = '', found = false;
  for (const entry of value.objects) {
    const ref = bundleReference(entry);
    need(previous < ref.sha256, 'duplicate or unordered object'); previous = ref.sha256;
    total += Number(ref.length); need(total <= BUNDLE_MAX_BYTES, 'total uncompressed size', 'BundleBound');
    if (ref.sha256 === manifest.sha256) { need(ref.length === manifest.length, 'manifest length'); found = true; }
  }
  need(found && typeof value.uncompressedBytes === 'string' && /^[1-9][0-9]{0,9}$/.test(value.uncompressedBytes)
    && value.uncompressedBytes === String(total), 'total/manifest binding');
  const bytes = encoder.encode(JSON.stringify(value));
  need(bytes.length <= BUNDLE_MAX_HEADER_BYTES, 'header size', 'BundleBound');
  return bytes;
}
export function bundlePrefix(header) {
  need(header instanceof Uint8Array && header.length > 0 && header.length <= BUNDLE_MAX_HEADER_BYTES, 'header bound');
  const bytes = new Uint8Array(prefixBytes), view = new DataView(bytes.buffer);
  bytes.set(encoder.encode(magic)); view.setUint32(8, BUNDLE_VERSION, true); view.setUint32(12, header.length, true);
  return bytes;
}
export async function indexSessionBundle(source) {
  need(source instanceof Blob, 'choose a local recording file');
  // Blob owns immutable bytes. Do not retain a caller-controlled typed-array view or file name.
  const blob = new Blob([source]), size = blob.size;
  need(size >= prefixBytes && size <= BUNDLE_MAX_BYTES + BUNDLE_MAX_HEADER_BYTES + prefixBytes, 'file size', 'BundleBound');
  const prefix = new Uint8Array(await blob.slice(0, prefixBytes).arrayBuffer()), view = new DataView(prefix.buffer);
  need(decoder.decode(prefix.subarray(0, 8)) === magic && view.getUint32(8, true) === BUNDLE_VERSION, 'archive magic/version');
  const length = view.getUint32(12, true);
  need(length > 0 && length <= BUNDLE_MAX_HEADER_BYTES && prefixBytes + length <= size, 'header size', 'BundleBound');
  const bytes = new Uint8Array(await blob.slice(prefixBytes, prefixBytes + length).arrayBuffer());
  let header;
  try { header = JSON.parse(decoder.decode(bytes)); }
  catch { throw new SessionBundleError('BundleFormat', 'header JSON'); }
  const canonical = encodeBundleHeader(header);
  need(canonical.length === bytes.length && canonical.every((byte, index) => byte === bytes[index]), 'non-canonical header');
  need(prefixBytes + length + Number(header.uncompressedBytes) === size, 'truncated or trailing archive');
  const entries = new Map(); let offset = prefixBytes + length;
  for (const ref of header.objects) {
    entries.set(ref.sha256, {ref: {...ref}, offset}); offset += Number(ref.length);
  }
  // The parsed header is private. Callers receive copies; indexed slices keep their original bounds.
  return Object.freeze({
    header: structuredClone(header),
    async objectReference(hash) {
      const entry = entries.get(hash); need(entry, 'missing referenced object', 'BundleMissing'); return {...entry.ref};
    },
    async *stream(expected) {
      const ref = bundleReference(expected), entry = entries.get(ref.sha256);
      need(entry && entry.ref.length === ref.length, 'missing or conflicting object', 'BundleMissing');
      const end = entry.offset + Number(ref.length);
      for (let at = entry.offset; at < end; at += BUNDLE_CHUNK_BYTES)
        yield new Uint8Array(await blob.slice(at, Math.min(end, at + BUNDLE_CHUNK_BYTES)).arrayBuffer());
    },
  });
}
