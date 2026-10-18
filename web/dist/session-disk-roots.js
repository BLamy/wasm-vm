// E9-T04: authenticated complete COW maps over the immutable session object store.
// Import lazily when using history; ordinary boots need no metadata Wasm initialization.
import init, {SessionSha256, sessionValidateDiskRoot, sessionAdmitDiskRoot,
  sessionDiskRootReferences} from './session-pkg/wasm_vm_session.js';
import {SessionStore, SessionStoreError} from './session-store.js';
await init();

export const DISK_ROOT_MAX_BLOCKS = 65536;
export const DISK_ROOT_MAX_BYTES = 12 * 1024 * 1024;
const BLOCK = 4096, HEADER = 61, ENTRY = 8 + BLOCK, SOURCE_CHUNK = 4 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const need = (condition, code, detail = '') => { if (!condition) throw new SessionStoreError(code, detail); };
const metadata = call => {
  try { return call(); } catch (error) { throw new SessionStoreError('DiskRoot', error.message); }
};
const hash = bytes => {
  const hasher = new SessionSha256();
  try { hasher.update(bytes); return hasher.finish(); } finally { hasher.free(); }
};
const reference = bytes => ({sha256: hash(bytes), length: String(bytes.length)});
const blockRef = block => ({sha256: block.sha256, length: String(BLOCK)});
function *chunks(bytes) {
  for (let offset = 0; offset < bytes.length; offset += SOURCE_CHUNK) yield bytes.subarray(offset, offset + SOURCE_CHUNK);
}

// Synchronous: pin every block digest before the first durable await. Mutating a later input
// view cannot silently change the root while earlier blocks are being persisted.
function indexDelta(bytes) {
  need(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer && bytes.length >= HEADER
    && bytes.length <= HEADER + DISK_ROOT_MAX_BLOCKS * ENTRY, 'Bound', 'disk delta');
  need([87, 86, 79, 68, 49].every((value, index) => bytes[index] === value), 'DiskRoot', 'delta magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(57, true);
  need(view.getUint32(5, true) === BLOCK && count <= DISK_ROOT_MAX_BLOCKS
    && bytes.length === HEADER + count * ENTRY, 'DiskRoot', 'delta shape');
  const root = {version: {major: 1, minor: 0},
    base: Array.from(bytes.subarray(17, 49), b => b.toString(16).padStart(2, '0')).join(''),
    image_len: String(view.getBigUint64(9, true)), generation: String(view.getBigUint64(49, true)), blocks: []};
  for (let index = 0; index < count; index++) {
    const offset = HEADER + index * ENTRY;
    root.blocks.push({index: String(view.getBigUint64(offset, true)), sha256: hash(bytes.subarray(offset + 8, offset + ENTRY))});
  }
  return root;
}

export class SessionDiskRoots {
  #store;
  constructor(store) { need(store instanceof SessionStore, 'Database'); this.#store = store; }

  async capture(writer, delta, imageManifest) {
    need(typeof imageManifest === 'string', 'DiskRoot', 'image manifest');
    const root = indexDelta(delta);
    const inputLength = delta.length;
    const bytes = metadata(() => sessionAdmitDiskRoot(encoder.encode(JSON.stringify(root)), imageManifest, root.generation));
    const ref = reference(bytes);
    for (let index = 0; index < root.blocks.length; index++) {
      need(delta.length === inputLength, 'SourceChanged', 'disk delta detached');
      const offset = HEADER + index * ENTRY + 8;
      await writer.put(blockRef(root.blocks[index]), [delta.subarray(offset, offset + BLOCK)]);
    }
    await writer.put(ref, chunks(bytes));
    return Object.freeze({content: Object.freeze(ref), base: root.base, imageLength: root.image_len, generation: root.generation});
  }

  async #read(ref, limit) {
    need(typeof ref?.length === 'string' && /^[1-9][0-9]{0,9}$/.test(ref.length)
      && Number(ref.length) <= limit, 'Bound', 'disk object');
    const bytes = new Uint8Array(Number(ref.length)); let offset = 0;
    for await (const part of this.#store.stream(ref)) { bytes.set(part, offset); offset += part.length; }
    need(offset === bytes.length, 'Corrupt', 'disk object length');
    return bytes;
  }

  async inspect(rootHash) {
    const ref = await this.#store.objectReference(rootHash);
    const bytes = await this.#read(ref, DISK_ROOT_MAX_BYTES);
    const canonical = metadata(() => sessionValidateDiskRoot(bytes));
    return {content: ref, bytes: canonical, root: JSON.parse(decoder.decode(canonical))};
  }

  async verify(rootHash, imageManifest, generation) {
    need(typeof imageManifest === 'string' && typeof generation === 'string', 'DiskRoot', 'exact disk binding');
    const {content, bytes} = await this.inspect(rootHash);
    const canonical = metadata(() => sessionAdmitDiskRoot(bytes, imageManifest, generation));
    for (const ref of JSON.parse(decoder.decode(metadata(() => sessionDiskRootReferences(canonical))))) {
      for await (const _ of this.#store.stream(ref)) { /* authenticate complete descendants */ }
    }
    const root = JSON.parse(decoder.decode(canonical));
    return {content, base: root.base, imageLength: root.image_len, generation: root.generation, blocks: root.blocks.length};
  }

  // A fresh WVOD1 buffer for newChunkedDiskSeeded. This never opens a persistent overlay writer.
  async restore(rootHash, imageManifest, generation) {
    need(typeof imageManifest === 'string', 'DiskRoot', 'image manifest');
    need(typeof generation === 'string', 'DiskRoot', 'generation must be an exact decimal string');
    const {bytes} = await this.inspect(rootHash);
    const canonical = metadata(() => sessionAdmitDiskRoot(bytes, imageManifest, generation));
    const root = JSON.parse(decoder.decode(canonical));
    const delta = new Uint8Array(HEADER + root.blocks.length * ENTRY), view = new DataView(delta.buffer);
    delta.set(encoder.encode('WVOD1')); view.setUint32(5, BLOCK, true);
    view.setBigUint64(9, BigInt(root.image_len), true);
    delta.set(Uint8Array.from(root.base.match(/../g), b => parseInt(b, 16)), 17);
    view.setBigUint64(49, BigInt(generation), true); view.setUint32(57, root.blocks.length, true);
    for (let index = 0; index < root.blocks.length; index++) {
      const block = root.blocks[index], offset = HEADER + index * ENTRY;
      view.setBigUint64(offset, BigInt(block.index), true);
      delta.set(await this.#read(blockRef(block), BLOCK), offset + 8);
    }
    return delta;
  }

  // Retention uses the union of all surviving session/branch roots, including their metadata.
  // This marks references only. E9-T07 owns locked, atomic publication/deletion and reclamation.
  async liveReferences(rootHashes) {
    need(Array.isArray(rootHashes) && rootHashes.length <= 4096, 'Bound', 'disk roots');
    const refs = new Map(); let total = 0;
    const add = ref => {
      const previous = refs.get(ref.sha256);
      need(!previous || previous.length === ref.length, 'Corrupt', 'conflicting disk object lengths');
      if (!previous) { total += Number(ref.length); need(total <= 4 * 1024 * 1024 * 1024, 'Bound', 'disk references'); }
      refs.set(ref.sha256, ref);
    };
    for (const rootHash of rootHashes) {
      const {content, bytes} = await this.inspect(rootHash); add(content);
      const blocks = JSON.parse(decoder.decode(metadata(() => sessionDiskRootReferences(bytes))));
      for (const block of blocks) add(block);
    }
    return [...refs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
  }
}
