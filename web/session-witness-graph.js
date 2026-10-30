// One complete authenticated closure for paged publication/open, GC and storage transfer.
import init, {SessionSha256, sessionValidateManifest, sessionValidateLocalManifest,
  sessionManifestReferences, sessionLocalManifestReferences, sessionEventReferences, sessionLocalEventReferences,
  sessionCheckAppend, sessionCheckLocalAppend,
  sessionValidateDiskRoot, sessionDiskRootReferences} from './session-pkg/wasm_vm_session.js';
import {authenticateWitnessPages, witnessCommitment} from './session-witness-pages.js';
import {decodeKeyframeDescriptor, isKeyframeDescriptorPrefix, inspectRamDeltaChunk} from './session-keyframes.js';
import {BUNDLE_CHUNK_BYTES, bundleNeed as need, bundleReference} from './session-bundle-format.js';
import {checkWitnessGraphLimit} from './session-witness-graph-limits.js';
await init();
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
async function gpuCheckpointWitness(source, point, row, manifest, signal) {
  if (!manifest.machine.gpu) return;
  let frame = point.machine, prefix;
  for await (const part of source.stream(frame)) {prefix = part.subarray(0, 8); break;}
  if (isKeyframeDescriptorPrefix(prefix)) frame = decodeKeyframeDescriptor(await small(source, frame, 1048576, signal)).frame;
  // The envelope header is bounded even when the native full frame contains large RAM.
  const bytes = new Uint8Array(Math.min(Number(frame.length), 32 + 16384)); let at = 0;
  for await (const part of source.stream(frame)) {
    active(signal); const take = Math.min(part.length, bytes.length - at); bytes.set(part.subarray(0, take), at); at += take;
    if (at === bytes.length) break;
  }
  need(at >= 32, 'GPU witness frame header'); const view = new DataView(bytes.buffer);
  const magic = decoder.decode(bytes.subarray(0, 8)), length = view.getUint32(12, true);
  need(['WVGPUB01', 'WVGPUD01'].includes(magic) && view.getUint32(8, true) === 1
    && length > 0 && length <= 16384 && at >= 32 + length, 'GPU witness frame version/length');
  const meta = parsed(bytes.subarray(32, 32 + length));
  need(meta.version === 1 && meta.runtime === manifest.machine.vm_build && meta.rendererSha256 === point.gpu?.sha256
    && ['transition', 'phase', 'ordinal', 'sequence', 'retired'].every(key => meta.position?.[key] === row[key])
    && meta.stateSha256 === row.digest.map(byte => byte.toString(16).padStart(2, '0')).join(''), 'GPU checkpoint witness digest/identity');
}
export async function inventoryWitnessGraph(source, manifestBytes, {signal, previous = null, scope = 'archive'} = {}) {
  active(signal);
  const local = scope === 'local';
  // The archive codec remains authoritative for portable transfers. Its
  // aggregate failure is presented as the archive's stable typed bound.
  let canonical;
  try {canonical = (local ? sessionValidateLocalManifest : sessionValidateManifest)(manifestBytes);}
  catch (error) {
    if (!local && /TooLarge\("session payload"\)/.test(String(error.message)))
      need(false, 'archive session payload bound', 'BundleBound');
    throw error;
  }
  need(equal(canonical, manifestBytes), 'non-canonical manifest'); const manifest = parsed(canonical);
  need(witnessCommitment(manifest), 'required paged witnesses', 'BundleCompatibility');
  checkWitnessGraphLimit(scope, manifestBytes.length, 0);
  if (previous) (local ? sessionCheckLocalAppend : sessionCheckAppend)(new TextEncoder().encode(JSON.stringify(previous)), canonical);
  const refs = new Map(); let total = manifestBytes.length;
  const add = value => {
    const ref = bundleReference(value), previous = refs.get(ref.sha256);
    need(!previous || previous.length === ref.length, 'conflicting referenced lengths');
    if (!previous) {total += Number(ref.length); checkWitnessGraphLimit(scope, total, refs.size + 1); refs.set(ref.sha256, ref);}
  };
  const direct = parsed((local ? sessionLocalManifestReferences : sessionManifestReferences)(canonical)); for (const ref of direct.blobs) add(ref);
  const witness = await authenticateWitnessPages(source, manifest, {previous, onReference: add, onCheckpoint: (point, row) => gpuCheckpointWitness(source, point, row, manifest, signal)});
  for (const hash of direct.roots) {
    const ref = await source.objectReference(hash); add(ref);
    const bytes = await small(source, ref, 12 * 1048576, signal), root = parsed(sessionValidateDiskRoot(bytes));
    need(root.base === manifest.machine.base_image, 'historical root base');
    for (const ref of parsed(sessionDiskRootReferences(bytes))) add(ref);
  }
  for (const event of manifest.events) {
    const bytes = await small(source, event.content, 4 * 1048576, signal);
    for (const ref of parsed((local ? sessionLocalEventReferences : sessionEventReferences)(canonical, bytes))) add(ref);
  }
  let checkpointPrevious = null, depth = 0;
  for (const point of manifest.checkpoints) {
    active(signal); let prefix;
    for await (const part of source.stream(point.machine)) {prefix = part.subarray(0, 8); break;}
    if (isKeyframeDescriptorPrefix(prefix)) {
      const delta = decodeKeyframeDescriptor(await small(source, point.machine, 1048576, signal));
      need(checkpointPrevious && delta.depth === depth + 1 && sameRef(delta.parent, checkpointPrevious.machine)
        && delta.ramBytes === manifest.machine.ram_bytes, 'checkpoint ancestry');
      add(delta.frame); let last = -1, pages = 0;
      for (const ref of delta.chunks) {
        add(ref); const shape = inspectRamDeltaChunk(await small(source, ref, 4 * 1048576, signal), delta.ramBytes, last);
        last = shape.last; pages += shape.count;
      }
      need(pages === delta.dirtyPages, 'RAM delta page count'); depth = delta.depth;
    } else {
      need(prefix && ['WVKEYB01', 'WVEXACT1', 'WVGPUB01'].includes(decoder.decode(prefix)), 'full checkpoint base/version');
      depth = 0;
    }
    checkpointPrevious = point;
  }
  for (const ref of refs.values()) await authenticate(source, ref, signal);
  // Required v2 marks this as storage, not an executable native-plan admission.
  return {manifest, refs: [...refs.values()], witness};
}
