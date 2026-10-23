// Complete local archives of finished exact recordings. Import publishes one manifest last.
import initMetadata, {SessionSha256, sessionValidateManifest, sessionManifestReferences,
  sessionEventReferences, sessionCanonicalImage, sessionValidateDiskRoot,
  sessionAdmitDiskRoot} from './session-pkg/wasm_vm_session.js';
import initMachine, {WasmLinux} from './pkg/wasm_vm_wasm.js';
import {SessionStore} from './session-store.js';
import {validateSessionWitnesses} from './session-witnesses.js';
import {checkpointHash, checkpointReference, readCheckpointObject,
  decodeSoftwareKeyframeBase, decodeSoftwareDeltaCheckpoint} from './session-checkpoints.js';
import {decodeKeyframeDescriptor, isKeyframeDescriptorPrefix, inspectRamDeltaChunk} from './session-keyframes.js';
import {SessionInputJournal} from './session-inputs.js';
import {SessionGpuJournal} from './session-gpu-journal.js';
import {decodeGpuExactFrame, validateGpuConfiguration} from './session-gpu-replay-format.js';
import {encodeCheckpointData, decodeCheckpointData} from './renderer/virgl-command/checkpoint-codec.mjs';
import {GPU_CHECKPOINT_BUILD_ID, SOFTWARE_CHECKPOINT_WASM_SHA256,
  SOFTWARE_CHECKPOINT_WASM_BYTES} from './gpu-checkpoint-build.js';
import {BUNDLE_MAX_BYTES, BUNDLE_MAX_OBJECTS, BUNDLE_CHUNK_BYTES, bundleNeed as need,
  bundleReference, encodeBundleHeader, bundlePrefix, indexSessionBundle} from './session-bundle-format.js';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const json = value => encoder.encode(JSON.stringify(value));
const parsed = bytes => JSON.parse(decoder.decode(bytes));
const equal = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const samePosition = (a, b) => ['transition', 'retired', 'phase', 'ordinal', 'sequence'].every(key => a[key] === b[key]);
const comparePosition = (a, b) => {
  for (const [x, y] of [[BigInt(a.transition), BigInt(b.transition)], [a.phase === 'before' ? 0 : 1, b.phase === 'before' ? 0 : 1],
    [a.ordinal, b.ordinal], [BigInt(a.sequence), BigInt(b.sequence)]]) if (x !== y) return x < y ? -1 : 1;
  return 0;
};
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const hashBytes = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const active = signal => need(!signal?.aborted, 'local transfer cancelled', 'BundleCancelled');
const refSame = (a, b) => a?.sha256 === b?.sha256 && a?.length === b?.length;
const exactVersion = version => version?.major === 1 && version?.minor === 0;

async function authenticate(store, ref, signal, collect = null) {
  const hasher = new SessionSha256(); let total = 0;
  try {
    for await (const part of store.stream(ref)) {
      active(signal); total += part.length;
      need(part instanceof Uint8Array && part.length > 0 && part.length <= BUNDLE_CHUNK_BYTES
        && total <= Number(ref.length), 'object stream bound');
      hasher.update(part);
      if (collect) collect.push(new Blob([part]));
    }
    need(total === Number(ref.length) && hasher.finish() === ref.sha256, 'object digest/length', 'BundleDigest');
  } finally { hasher.free(); }
}
async function nativeMetadata(bytes, full, gpu, ramBytes, signal) {
  need(bytes.length >= 84 && bytes.length <= (gpu ? 512 : 300) * 1048576, 'native section bound');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(decoder.decode(bytes.subarray(0, 8)) === 'WVMRESU1' && view.getUint32(8, true) === 1, 'native version');
  const end = bytes.length - (gpu ? 84 : 0), tags = new Set(); let at = 84, position;
  while (at < end) {
    active(signal); need(at + 8 <= end, 'native section header');
    const tag = view.getUint32(at, true), length = view.getUint32(at + 4, true); at += 8;
    need(tag >= 1 && tag <= 22 && tag !== 17 && !tags.has(tag) && length <= end - at, 'unsupported, duplicate or truncated native section');
    tags.add(tag);
    if (tag === 18) {
      need(length >= 44 && decoder.decode(bytes.subarray(at, at + 8)) === 'WVCLK001'
        && view.getUint32(at + 8, true) === 1, 'native session clock version');
      position = {transition: String(view.getBigUint64(at + 12, true)), retired: String(view.getBigUint64(at + 20, true)),
        ordinal: Number(view.getBigUint64(at + 28, true)), sequence: String(view.getBigUint64(at + 36, true)), phase: 'before'};
    }
    if (tag === 2) {
      let p = at, expanded = 0, runs = 0;
      while (p < at + length) {
        need(p + 5 <= at + length, 'sparse RAM header'); const kind = bytes[p], size = view.getUint32(p + 1, true); p += 5;
        need((kind === 0 || kind === 1) && size > 0 && size <= ramBytes - expanded, 'sparse RAM expansion bound');
        expanded += size; if (kind === 1) { need(size <= at + length - p, 'sparse RAM payload'); p += size; }
        if (++runs % 16384 === 0) { await tick(); active(signal); }
      }
      need(p === at + length && expanded === ramBytes, 'sparse RAM size');
    }
    at += length;
  }
  need(at === end && tags.has(2) === full && tags.has(22) === gpu
    && [1, 3, 4, 5, 8, 9, 18, 19, 20, 21].every(tag => tags.has(tag)), 'required native sections');
  return {core: hex(bytes.subarray(12, 44)), base: hex(bytes.subarray(44, 76)),
    generation: String(view.getBigUint64(76, true)), position};
}
async function gpuHardwareProfile(profile, signal) {
  active(signal);
  const {qualifyVirglHost} = await import('./renderer/virgl-command/production.mjs');
  const {selectCheckpointProfile} = await import('./renderer/virgl-command/checkpoint-profile.mjs');
  const canvas = new OffscreenCanvas(1, 1), gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true});
  try { const actual = await qualifyVirglHost(gl); active(signal); selectCheckpointProfile(actual, profile); }
  finally { gl?.getExtension('WEBGL_lose_context')?.loseContext(); }
}

// Decode every reachable state, not only the initial snapshot. Each candidate is
// private and never calls run/step; the GPU sink grants no physical-work callback.
async function decodeKeyframes(store, manifest, configuration, read, frames, kernel, {signal, onProgress}) {
  const gpu = manifest.machine.gpu !== null;
  const make = () => {
    const machine = gpu ? WasmLinux.newExactGpuSession(kernel, configuration.imageManifest, configuration.bootargs, () => {}, true)
      : WasmLinux.newExactSession(kernel, configuration.imageManifest, configuration.bootargs, () => {}, true);
    if (configuration.branchOrigin) machine.markExactBranchReplayOffline();
    return machine;
  };
  for (let index = 0; index < frames.length; index++) {
    active(signal); const entry = frames[index], point = entry.point, owners = []; let candidate = make();
    try {
      const bytes = await readCheckpointObject(store, entry.frame, undefined, {signal});
      if (entry.descriptor) {
        const base = await readCheckpointObject(store, frames[entry.base].frame, undefined, {signal});
        if (gpu) {const frame = decodeGpuExactFrame(base); candidate.seedExactGpuRam(frame.native, hashBytes(frame.meta.rendererSha256));}
        else {
          candidate.prepareSoftwareKeyframeCandidate();
          if (decoder.decode(base.subarray(0, 8)) === 'WVEXACT1') candidate.seedSoftwareRamFromExactStart(base);
          else candidate.seedSoftwareRamFromCheckpoint(base);
        }
        for (let cursor = entry.base + 1; cursor <= index; cursor++) {
          const delta = frames[cursor].descriptor; need(delta, 'missing delta in reconstruction chain');
          for (const ref of delta.chunks) {
            active(signal); const part = await readCheckpointObject(store, ref, 4 * 1048576, {signal});
            const shape = inspectRamDeltaChunk(part, manifest.machine.ram_bytes);
            need(candidate.applySoftwareRamDeltaChunk(part) === shape.count, 'native RAM page application');
          }
          need(candidate.softwareRamDigest() === delta.ramSha256, 'reconstructed RAM digest', 'BundleDigest');
          if (!gpu) {
            const frame = await readCheckpointObject(store, frames[cursor].frame, undefined, {signal});
            const parts = decodeSoftwareDeltaCheckpoint(frame);
            candidate.restoreSoftwareDeltaKeyframe(frame, parts.contextBytes, hashBytes(delta.ramSha256));
          }
          active(signal);
        }
      }
      if (gpu) {
        const frame = decodeGpuExactFrame(bytes), end = frames[index + 1]?.point.position ?? manifest.end;
        const events = read.receipts.filter(value => BigInt(value.sequence) > BigInt(point.position.sequence) && comparePosition(value, end) <= 0);
        const witnesses = read.witnesses.filter(value => comparePosition(value, point.position) >= 0 && comparePosition(value, end) <= 0);
        need(witnesses.length && samePosition(witnesses[0], point.position) && samePosition(witnesses.at(-1), end), 'GPU interval witness endpoints');
        const payloads = new Map(); let payloadBytes = 0;
        for (const event of events) if (event.body && !payloads.has(event.body.sha256)) {
          payloadBytes += Number(event.body.length); need(payloadBytes <= 64 * 1048576 && payloads.size < 256, 'GPU interval payload bound');
          const payload = await readCheckpointObject(store, event.body, 32 * 1048576, {signal});
          payloads.set(event.body.sha256, {sha256: hashBytes(event.body.sha256), length: payload.length, bytes: payload});
        }
        // Use the accepted native GPU restorer with the saved caps, but do not
        // dispatch the archive's GPU operations or execute any guest instruction.
        candidate.attachVirgl(Uint32Array.from(configuration.profile.hostWords), Uint32Array.from(configuration.profile.formatRoles),
          configuration.profile.renderer, event => {if (event.ownedTransport) owners.push(event.ownedTransport);});
        candidate.beginExactReplay(frame.native, events, witnesses, end, {pending: frame.pending, output: frame.output},
          {version: 1, rendererDigest: hashBytes(frame.meta.rendererSha256), ramDigest: frame.meta.full ? null : hashBytes(frame.meta.ramSha256), payloads: [...payloads.values()]});
      } else {
        let resume, queues;
        if (entry.descriptor) {
          resume = candidate.exactSessionWitness(true).resume; queues = candidate.exactSessionHostQueues();
          const previous = candidate; candidate = null; previous.free(); candidate = make();
        } else if (decoder.decode(bytes.subarray(0, 8)) === 'WVEXACT1') {
          resume = read.initialResume; queues = read.initialQueues;
        } else {
          const frame = decodeSoftwareKeyframeBase(bytes); resume = frame.native; queues = {pending: frame.input, output: frame.output};
        }
        const digest = checkpointHash(resume), committed = read.witnesses.find(value => samePosition(value, point.position));
        if (committed) need(hex(committed.digest) === digest, 'software keyframe state witness', 'BundleDigest');
        const witnesses = [{...point.position, digest: hashBytes(digest)}, ...read.witnesses.filter(value => comparePosition(value, point.position) > 0)];
        candidate.beginExactReplay(resume, read.receipts.filter(value => BigInt(value.sequence) > BigInt(point.position.sequence)), witnesses, manifest.end, queues);
      }
      need(samePosition(candidate.inputPosition(), point.position), 'decoder retired or changed the selected position');
      active(signal); onProgress(`Decoded keyframe ${index + 1} of ${frames.length}`);
    } finally {candidate?.free(); for (const owner of owners) owner.free();}
  }
}

async function walkRecording(store, manifestBytes, {signal, onProgress = () => {}, checkHardware = false} = {}) {
  active(signal); const canonical = sessionValidateManifest(manifestBytes);
  need(equal(canonical, manifestBytes), 'non-canonical manifest'); const manifest = parsed(canonical), gpu = manifest.machine.gpu !== null;
  need(exactVersion(manifest.version) && exactVersion(manifest.policy.event_version) && exactVersion(manifest.policy.checkpoint_version)
    && manifest.policy.boundary_version === 1 && manifest.policy.mode === 'exact-replay'
    && manifest.machine.initramfs === null && manifest.machine.harts === 1
    && manifest.policy.profile === (gpu ? 'rv64-linux-gpu-v1' : 'rv64-linux-software-v1'),
  'only supported finished exact recording versions can be transferred', 'BundleCompatibility');
  need(manifest.machine.wasm_build === SOFTWARE_CHECKPOINT_WASM_SHA256, 'incompatible installed Wasm build', 'BundleCompatibility');
  const witnesses = validateSessionWitnesses(manifest, {finished: true}), refs = new Map(); let total = manifestBytes.length;
  const add = value => {
    const ref = bundleReference(value), previous = refs.get(ref.sha256);
    need(!previous || previous.length === ref.length, 'conflicting referenced lengths');
    if (!previous) { total += Number(ref.length); need(total <= BUNDLE_MAX_BYTES && refs.size < BUNDLE_MAX_OBJECTS - 1, 'recording size/object count', 'BundleBound'); refs.set(ref.sha256, ref); }
  };
  const direct = parsed(sessionManifestReferences(manifestBytes));
  for (const ref of direct.blobs) add(ref);
  const asset = role => { const entry = manifest.assets.find(value => value.role === role); need(entry, 'missing ' + role + ' asset', 'BundleMissing'); return entry.content; };
  const configuration = parsed(await readCheckpointObject(store, asset('vm'), gpu ? 8 * 1048576 : 1048576, {signal}));
  need(manifest.assets.length === (gpu ? 5 : 4) && configuration.version === 1 && configuration.providersComplete === true
    && configuration.wasm?.sha256 === SOFTWARE_CHECKPOINT_WASM_SHA256 && configuration.wasm?.length === String(SOFTWARE_CHECKPOINT_WASM_BYTES)
    && refSame(asset('wasm'), {sha256: configuration.wasm.sha256, length: configuration.wasm.length})
    && refSame(asset('kernel'), {sha256: configuration.kernel?.sha256, length: configuration.kernel?.length})
    && Number(configuration.kernel.length) <= 64 * 1048576
    && refSame(asset('base'), checkpointReference(sessionCanonicalImage(configuration.imageManifest))), 'asset/configuration identity', 'BundleCompatibility');
  if (gpu) {
    validateGpuConfiguration(configuration);
    need(configuration.renderer.buildId === GPU_CHECKPOINT_BUILD_ID
      && refSame(asset('gpu-renderer'), {sha256: configuration.renderer.sha256, length: configuration.renderer.length}), 'incompatible installed GPU build', 'BundleCompatibility');
    const stamp = await readCheckpointObject(store, asset('gpu-renderer'), 1048576, {signal});
    need(decoder.decode(stamp).includes(`GPU_CHECKPOINT_BUILD_ID="${GPU_CHECKPOINT_BUILD_ID}"`), 'retained renderer build stamp');
  } else {
    need(configuration.runtime === 'rv64-linux-exact-session-v1' && configuration.exactSession === 1 && configuration.ramMib === 256
      && configuration.clock?.mode === 'icount' && configuration.clock.divider === 10 && configuration.clock.interactive === null,
    'incompatible installed software profile', 'BundleCompatibility');
  }
  const roots = new Map();
  for (const hash of direct.roots) {
    active(signal); const ref = await store.objectReference(hash); add(ref);
    const bytes = await readCheckpointObject(store, ref, 12 * 1048576, {signal}), root = parsed(sessionValidateDiskRoot(bytes));
    // These exact runtimes store private COW pages in native SESSION_DEVICES.
    // Their separate T14 root is an empty immutable-base binding, not a legacy overlay.
    need(root.blocks.length === 0, 'legacy overlay roots are not part of this exact runtime', 'BundleCompatibility');
    need(equal(bytes, sessionAdmitDiskRoot(bytes, configuration.imageManifest, root.generation)), 'historical disk root identity');
    roots.set(hash, root);
  }
  for (const chunk of manifest.events) {
    active(signal); const bytes = await readCheckpointObject(store, chunk.content, 4 * 1048576, {signal});
    for (const ref of parsed(sessionEventReferences(manifestBytes, bytes))) add(ref);
  }
  const readStore = {...store, stream: ref => store.stream(ref), openSession: async id => {
    need(id === manifest.id, 'archive session ID'); return {id, revision: '1', manifest: manifestBytes};
  }};
  const read = gpu ? await SessionGpuJournal.readExact(readStore, manifest.id, {configuration})
    : await SessionInputJournal.readExact(readStore, manifest.id, {configuration});
  let depth = 0, previous = null, core = null, baseIndex = 0;
  const keyframes = [];
  const rendererChecks = new Map();
  for (const point of manifest.checkpoints) {
    active(signal); let prefix;
    for await (const part of store.stream(point.machine)) { prefix = part.subarray(0, 8); break; }
    let bytes, delta = null, full;
    if (isKeyframeDescriptorPrefix(prefix)) {
      delta = decodeKeyframeDescriptor(await readCheckpointObject(store, point.machine, 1048576, {signal}));
      need(previous && delta.depth === depth + 1 && refSame(delta.parent, previous.machine)
        && delta.ramBytes === manifest.machine.ram_bytes, 'keyframe ancestry'); depth = delta.depth; full = false;
      add(delta.frame); bytes = await readCheckpointObject(store, delta.frame, undefined, {signal});
      let last = -1, pages = 0;
      for (const ref of delta.chunks) {
        add(ref); const shape = inspectRamDeltaChunk(await readCheckpointObject(store, ref, 4 * 1048576, {signal}), delta.ramBytes, last);
        last = shape.last; pages += shape.count;
      }
      need(pages === delta.dirtyPages, 'RAM delta page count');
    } else { depth = 0; full = true; bytes = await readCheckpointObject(store, point.machine, undefined, {signal}); }
    let native, coordinate;
    if (gpu) {
      const frame = decodeGpuExactFrame(bytes); native = frame.native; coordinate = frame.meta.position;
      need(frame.meta.full === full && frame.meta.runtime === manifest.machine.vm_build && frame.meta.rendererSha256 === point.gpu?.sha256
        && (!delta || frame.meta.ramSha256 === delta.ramSha256), 'GPU checkpoint/renderer identity');
      const committed = witnesses.find(value => samePosition(value, coordinate));
      need(committed && hex(Uint8Array.from(committed.digest)) === frame.meta.stateSha256, 'GPU state witness');
      if (!rendererChecks.has(point.gpu.sha256)) {
        const renderer = await readCheckpointObject(store, point.gpu, 256 * 1048576, {signal}), view = new DataView(renderer.buffer, renderer.byteOffset, renderer.byteLength);
        need(renderer.length >= 48 && decoder.decode(renderer.subarray(0, 8)) === 'WVGJRN01' && view.getUint32(8, true) === 1
          && view.getUint32(12, true) === renderer.length - 48 && checkpointHash(renderer.subarray(0, -32)) === hex(renderer.subarray(-32)), 'renderer version/envelope');
        const payload = decodeCheckpointData(renderer.subarray(16, -32));
        need(payload.schema === 'production-gpu-journal-v1' && checkpointHash(encodeCheckpointData(payload.profile)) === manifest.machine.gpu.profile
          && typeof payload.logical?.epoch === 'string' && Array.isArray(payload.frames) && payload.frames.length <= 100000, 'renderer profile/version/epoch');
        for (const event of payload.frames) decodeCheckpointData(event);
        rendererChecks.set(point.gpu.sha256, payload.logical.epoch);
      }
      need(rendererChecks.get(point.gpu.sha256) === frame.meta.rendererEpoch, 'renderer epoch differs');
    } else if (decoder.decode(bytes.subarray(0, 8)) === 'WVEXACT1') {
      need(previous === null && full, 'exact initial frame placement'); native = read.initialResume; coordinate = manifest.begin;
    } else {
      const frame = full ? decodeSoftwareKeyframeBase(bytes) : decodeSoftwareDeltaCheckpoint(bytes);
      need(frame.context.runtime === manifest.machine.vm_build && frame.context.kernel === manifest.machine.kernel
        && frame.context.ram_bytes === manifest.machine.ram_bytes && frame.base === manifest.machine.base_image
        && JSON.stringify(frame.context.clock) === JSON.stringify(manifest.policy.clock), 'software checkpoint identity');
      native = frame.native; coordinate = frame.context.position;
    }
    const meta = await nativeMetadata(native, full, gpu, Number(manifest.machine.ram_bytes), signal);
    need(samePosition(coordinate, point.position) && samePosition(meta.position, point.position)
      && meta.base === manifest.machine.base_image && meta.generation === roots.get(point.disk_root)?.generation
      && (core === null || core === meta.core), 'native keyframe position/build/disk binding');
    if (full) baseIndex = keyframes.length;
    keyframes.push({point, descriptor: delta, frame: delta ? delta.frame : point.machine, base: baseIndex});
    core = meta.core; previous = point; onProgress(`Checking keyframe ${point.id}`);
  }
  for (const ref of refs.values()) { active(signal); await authenticate(store, ref, signal); }
  // Exercise the accepted native decoder against a disposable owner; retire no guest instruction.
  active(signal); const kernel = await readCheckpointObject(store, asset('kernel'), 64 * 1048576, {signal});
  await decodeKeyframes(store, manifest, configuration, read, keyframes, kernel, {signal, onProgress});
  if (gpu && checkHardware) await gpuHardwareProfile(configuration.profile, signal);
  active(signal);
  return {manifest, refs: [...refs.values()], runtime: {wasm: SOFTWARE_CHECKPOINT_WASM_SHA256, gpu: gpu ? GPU_CHECKPOINT_BUILD_ID : null}};
}

export async function exportSessionBundle(store, id, options = {}) {
  need(store instanceof SessionStore, 'session store'); await initMetadata(); await initMachine();
  return store.withReadLease(async () => {
    active(options.signal); const opened = await store.openSession(id); need(opened, 'selected recording is unavailable', 'BundleMissing');
    const checked = await walkRecording(store, opened.manifest, options), manifest = checkpointReference(opened.manifest);
    const objects = [...checked.refs, manifest].sort((a, b) => a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0);
    const header = encodeBundleHeader({version: 1, encoding: 'raw', portability: 'wasm-vm-installed-build-v1', runtime: checked.runtime,
      manifest, objects, uncompressedBytes: String(objects.reduce((sum, ref) => sum + Number(ref.length), 0))});
    const parts = [bundlePrefix(header), header]; let count = 0;
    for (const ref of objects) {
      active(options.signal);
      if (ref.sha256 === manifest.sha256) parts.push(new Blob([opened.manifest]));
      else await authenticate(store, ref, options.signal, parts);
      options.onProgress?.(`Exporting object ${++count} of ${objects.length}`);
    }
    active(options.signal); return {id, manifestSha256: manifest.sha256, objects: objects.length,
      blob: new Blob(parts, {type: 'application/x-wasm-vm-session'})};
  });
}
async function preflight(source, options) {
  await initMetadata(); await initMachine(); active(options.signal);
  const archive = await indexSessionBundle(source);
  need(archive.header.portability === 'wasm-vm-installed-build-v1',
    'storage-only witness archives are not admitted for playback', 'BundleCompatibility');
  need(archive.header.runtime.wasm === SOFTWARE_CHECKPOINT_WASM_SHA256
    && (archive.header.runtime.gpu === null || archive.header.runtime.gpu === GPU_CHECKPOINT_BUILD_ID), 'incompatible installed build', 'BundleCompatibility');
  let count = 0;
  for (const ref of archive.header.objects) {
    await authenticate(archive, ref, options.signal); options.onProgress?.(`Authenticating object ${++count} of ${archive.header.objects.length}`);
  }
  const bytes = await readCheckpointObject(archive, archive.header.manifest, 1048576, {signal: options.signal});
  const checked = await walkRecording(archive, bytes, {...options, checkHardware: true});
  need(JSON.stringify(checked.runtime) === JSON.stringify(archive.header.runtime), 'archive runtime/profile mismatch', 'BundleCompatibility');
  const expected = [...checked.refs, archive.header.manifest].sort((a, b) => a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0);
  need(JSON.stringify(expected) === JSON.stringify(archive.header.objects), 'missing or unreferenced archive object', 'BundleMissing');
  return {archive, bytes, checked};
}
export async function inspectSessionBundle(source, options = {}) {
  const {archive, checked} = await preflight(source, options);
  return {id: checked.manifest.id, manifestSha256: archive.header.manifest.sha256,
    objects: archive.header.objects.length, bytes: Number(archive.header.uncompressedBytes), runtime: {...checked.runtime}};
}
export async function importSessionBundle(store, source, options = {}) {
  need(store instanceof SessionStore, 'session store');
  const {archive, bytes, checked} = await preflight(source, options), id = checked.manifest.id;
  active(options.signal); const writer = await store.writer(id);
  try {
    need(!await store.openSession(id), 'a recording with this ID already exists', 'BundleConflict');
    let count = 0;
    for (const ref of checked.refs) {
      active(options.signal); await writer.put(ref, archive.stream(ref));
      options.onProgress?.(`Importing object ${++count} of ${checked.refs.length}`);
    }
    active(options.signal);
    // Revocation is checked synchronously in the strict final transaction as well.
    const committed = await writer.publish(bytes, null, () => active(options.signal));
    return {...committed, manifestSha256: archive.header.manifest.sha256, objects: checked.refs.length};
  } finally { await writer.release(); }
}
