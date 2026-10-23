// Storage-only v2 witness archives. Authentication and transfer do not admit replay.
// Playback archives retain their separate native decoder/interval checks.
import init, {SessionSha256} from './session-pkg/wasm_vm_session.js';
import {SessionStore} from './session-store.js';
import {inventoryWitnessGraph} from './session-witness-graph.js';
import {BUNDLE_CHUNK_BYTES, bundleNeed as need, encodeBundleHeader, bundlePrefix, indexSessionBundle} from './session-bundle-format.js';
await init();
export const WITNESS_ARCHIVE_POLICY = 'wasm-vm-witness-storage-v2';
const decoder = new TextDecoder('utf-8', {fatal: true});
const parsed = bytes => JSON.parse(decoder.decode(bytes));
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const sameRef = (a, b) => a?.sha256 === b?.sha256 && a?.length === b?.length;
const active = signal => need(!signal?.aborted, 'witness transfer cancelled', 'BundleCancelled');
function reference(bytes) {
  const hash = new SessionSha256();
  try {hash.update(bytes); return {sha256: hash.finish(), length: String(bytes.length)};}
  finally {hash.free();}
}
async function authenticate(source, ref, signal, collect = null) {
  const hash = new SessionSha256(); let length = 0;
  try {
    for await (const part of source.stream(ref)) {
      active(signal); need(part instanceof Uint8Array && part.length > 0 && part.length <= BUNDLE_CHUNK_BYTES, 'object stream bound');
      length += part.length; need(length <= Number(ref.length), 'object length', 'BundleDigest'); hash.update(part);
      if (collect) collect.push(new Blob([part]));
    }
    need(String(length) === ref.length && hash.finish() === ref.sha256, 'object digest/length', 'BundleDigest');
  } finally {hash.free();}
}
async function small(source, ref, limit, signal) {
  need(Number(ref.length) <= limit, 'metadata object bound', 'BundleBound');
  const bytes = new Uint8Array(Number(ref.length)); let at = 0;
  for await (const part of source.stream(ref)) {
    active(signal); need(part instanceof Uint8Array && part.length > 0 && at + part.length <= bytes.length, 'metadata stream bound');
    bytes.set(part, at); at += part.length;
  }
  need(at === bytes.length && sameRef(reference(bytes), ref), 'metadata digest/length', 'BundleDigest'); return bytes;
}
export async function exportSessionWitnessArchive(store, id, options = {}) {
  need(store instanceof SessionStore, 'session store');
  return store.withReadLease(async () => {
    active(options.signal); const opened = await store.openSession(id); need(opened, 'selected recording is unavailable', 'BundleMissing');
    const checked = await inventoryWitnessGraph(store, opened.manifest, options), manifest = reference(opened.manifest);
    const objects = [...checked.refs, manifest].sort((a, b) => a.sha256.localeCompare(b.sha256));
    const header = encodeBundleHeader({version: 1, encoding: 'raw', portability: WITNESS_ARCHIVE_POLICY,
      scope: 'storage-only', manifest, objects, uncompressedBytes: String(objects.reduce((sum, ref) => sum + Number(ref.length), 0))});
    const parts = [bundlePrefix(header), header];
    for (const ref of objects) {
      active(options.signal);
      if (ref.sha256 === manifest.sha256) parts.push(new Blob([opened.manifest]));
      else await authenticate(store, ref, options.signal, parts);
    }
    return {id, manifestSha256: manifest.sha256, objects: objects.length, admission: 'storage-only',
      blob: new Blob(parts, {type: 'application/x-wasm-vm-session'})};
  });
}
async function preflight(blob, options) {
  active(options.signal); const archive = await indexSessionBundle(blob);
  need(archive.header.portability === WITNESS_ARCHIVE_POLICY, 'requires a storage-only witness archive', 'BundleCompatibility');
  for (const ref of archive.header.objects) await authenticate(archive, ref, options.signal);
  const bytes = await small(archive, archive.header.manifest, 1048576, options.signal);
  const checked = await inventoryWitnessGraph(archive, bytes, options);
  const expected = [...checked.refs, archive.header.manifest].sort((a, b) => a.sha256.localeCompare(b.sha256));
  need(JSON.stringify(expected) === JSON.stringify(archive.header.objects), 'missing or unreferenced archive object', 'BundleMissing');
  return {archive, bytes, checked};
}
export async function inspectSessionWitnessArchive(blob, options = {}) {
  const {archive, checked} = await preflight(blob, options);
  return {id: checked.manifest.id, manifestSha256: archive.header.manifest.sha256, objects: archive.header.objects.length,
    bytes: Number(archive.header.uncompressedBytes), witnesses: checked.witness.count,
    first: checked.witness.commitment.first, last: checked.witness.commitment.last,
    finished: checked.witness.commitment.finished, admission: 'storage-only'};
}
export async function importSessionWitnessArchive(store, blob, options = {}) {
  need(store instanceof SessionStore, 'session store');
  // Fully authenticate the archive and the page/index closure before staging anything.
  const {archive, bytes, checked} = await preflight(blob, options), id = checked.manifest.id;
  active(options.signal); const writer = await store.writer(id);
  try {
    need(!await store.openSession(id), 'a recording with this ID already exists', 'BundleConflict');
    for (const ref of checked.refs) {active(options.signal); await writer.put(ref, archive.stream(ref));}
    const committed = await writer.publish(bytes, null, () => active(options.signal));
    return {...committed, manifestSha256: archive.header.manifest.sha256, admission: 'storage-only'};
  } finally {await writer.release();}
}
