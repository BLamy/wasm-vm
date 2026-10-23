// Real native state witnesses through bounded durable pages. Storage proof only;
// whole-history readers/executors and original desktop qualification remain gated.
import init, {WasmLinux} from './pkg/wasm_vm_wasm.js';
import {SessionStore} from './session-store.js';
import {SessionGpuJournal} from './session-gpu-journal.js';
import {authenticateWitnessPages} from './session-witness-pages.js';
import {inventoryWitnessGraph} from './session-witness-graph.js';
import {exportSessionWitnessArchive, inspectSessionWitnessArchive, importSessionWitnessArchive} from './session-witness-archives.js';
import {checkpointHash, readCheckpointObject} from './session-checkpoints.js';
import {GPU_CHECKPOINT_BUILD_ID} from './gpu-checkpoint-build.js';
import {attachProductionVirgl, createWorkerScanoutPresenter} from './renderer/virgl-command/production.mjs';
const encoder = new TextEncoder(), decoder = new TextDecoder();
const need = (ok, detail) => {if (!ok) throw Error('Witness page probe: ' + detail);};
const pos = value => Object.fromEntries(['transition', 'phase', 'ordinal', 'sequence', 'retired'].map(key => [key, value[key]]));
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function fetchBytes(url) {const response = await fetch(url); need(response.ok, 'asset ' + url); return new Uint8Array(await response.arrayBuffer());}
export async function runWitnessPages({database = 'wasm-vm-sessions-v1-witness-pages',
  id = 'witness-pages-' + crypto.randomUUID(), notify = () => {}, retain = async () => null, signal} = {}) {
  await init(); let vm, gpu, store, writer, journal, imported; let batchId = 0, rawIndex = 0;
  const result = {status: 'running', scope: 'Native GPU state witness storage, complete page inventory and storage-only archive transfer; playback remains unavailable',
    database, id, rawWitnesses: [], rawBatches: [], receipts: 0, checkpoints: 0, maxPendingWitnesses: 0, maxResidentRows: 0};
  const active = () => need(!signal?.aborted, 'cancelled');
  const collect = async () => {
    const batch = vm.takeExactGpuBatch(); need(batch.payloads.length === 0, 'fixture has no physical GPU readback');
    if (!batch.events.length) return;
    const ref = await retain('batch-' + String(batchId++).padStart(5, '0') + '.json',
      encoder.encode(JSON.stringify(batch.events.map(row => ({...row, bytes: [...row.bytes]})))));
    if (ref) result.rawBatches.push(ref); result.receipts += batch.events.length;
    journal.stage(batch); await journal.flush();
  };
  const raw = async point => {
    const state = vm.exactGpuSessionState(), current = vm.inputPosition(), ramDigest = point.ramDigest ? hex(point.ramDigest) : vm.softwareRamDigest();
    need(JSON.stringify(pos(point)) === JSON.stringify(pos(current)), 'actual native checkpoint/witness agrees');
    const name = 'native-' + String(rawIndex++).padStart(5, '0'), stateRef = await retain(name + '.state', state);
    const record = {...pos(point), digest: [...point.digest], ramDigest, state: stateRef,
      logicalSha256: checkpointHash(state), logicalBytes: state.length};
    const ref = await retain(name + '.json', encoder.encode(JSON.stringify(record))); if (ref) result.rawWitnesses.push(ref);
    result.maxPendingWitnesses = Math.max(result.maxPendingWitnesses, journal.witnessWindow.pending);
  };
  try {
    active(); const imageUrl = new URL('./assets/e9-gpu-journal-stream-image.json', import.meta.url);
    const imageManifest = decoder.decode(await fetchBytes(imageUrl));
    const kernelUrl = new URL('./assets/e9-gpu-journal-stream-count.bin', import.meta.url), kernel = await fetchBytes(kernelUrl);
    const wasmUrl = new URL('./pkg/wasm_vm_wasm_bg.wasm', import.meta.url), wasm = await fetchBytes(wasmUrl);
    const rendererUrl = new URL('./gpu-checkpoint-build.js', import.meta.url), renderer = await fetchBytes(rendererUrl);
    vm = WasmLinux.newExactGpuSession(kernel, imageManifest, 'console=ttyS0', () => {}, false); vm.enableJit(2);
    let presenter; presenter = createWorkerScanoutPresenter(frame => {if (frame.presentationToken) queueMicrotask(() => presenter.acknowledge(frame.presentationToken, 'superseded'));});
    gpu = await attachProductionVirgl(vm, {presenter}); const physical = gpu.inspect();
    need(physical.qualified && !physical.lost && !/SwiftShader|llvmpipe|software/i.test(physical.profile.identity), 'physical GPU profile'); result.physical = physical;
    const configuration = {version: 1, runtime: 'rv64-linux-gpu-exact-session-v1', exactGpuSession: 1, providersComplete: true,
      ramMib: 1024, bootargs: 'console=ttyS0', clock: {mode: 'icount', divider: 64, timebase_hz: '10000000', interactive: null},
      kernel: {url: kernelUrl.href, sha256: checkpointHash(kernel), length: String(kernel.length)},
      wasm: {url: wasmUrl.href, sha256: checkpointHash(wasm), length: String(wasm.length)},
      renderer: {url: rendererUrl.href, sha256: checkpointHash(renderer), length: String(renderer.length), buildId: GPU_CHECKPOINT_BUILD_ID},
      profile: gpu.checkpointProfile(), devices: JSON.parse(vm.exactGpuSessionTopology()), imageManifest,
      timeEntropyPolicy: vm.sessionSourcePolicy(), deviceCompletionPolicy: {version: 1, block: 'immutable-base-cow-v1', agent: 'owned-agent-receive-v1', capture: 'owned-s16-capture-v1'},
      networkPolicy: {version: 1, transport: 'owned-ethernet-v1', replay: 'zero-egress'}};
    result.configuration = configuration;
    store = await SessionStore.open(database); writer = await store.writer(id);
    journal = await SessionGpuJournal.create(store, writer, configuration, vm, gpu, {witnessPages: true});
    await raw(journal.initialWitness); result.checkpoints++;
    let prefix;
    for (let n = 1; n <= 129; n++) {
      active(); vm.sendInput(Uint8Array.of(97)); const outcome = vm.runChunk(128); need(!outcome.done, 'guest remains live');
      need(vm.exactDeviceRequests().length === 0, 'no unresolved external reads');
      await collect();
      if (gpu.inspect().pending) {need(gpu.pump()?.ok, 'physical GPU work'); await collect();}
      let point;
      // A full resident page, >63 genuine keyframes, then another full page and a
      // partial tail exercise distinct format bounds without changing the guest.
      if (n >= 17 && n <= 81 || n === 125) {point = await journal.captureKeyframe(vm, gpu, 'witness-' + n); result.checkpoints++;}
      else {point = vm.exactGpuSessionWitness(); await journal.observeExactWitness(point);}
      result.maxResidentRows = Math.max(result.maxResidentRows, journal.witnessWindow.peakRows);
      await raw(point);
      if (n === 81) prefix = await store.openSession(id);
      await notify({witnesses: n + 1, checkpoints: result.checkpoints}); await tick();
    }
    const final = vm.exactGpuSessionWitness(); await journal.completeExactPaged(final); await writer.release(); writer = null;
    const opened = await store.openSession(id), manifest = JSON.parse(decoder.decode(opened.manifest));
    result.saved = {id, revision: opened.revision, manifestSha256: checkpointHash(opened.manifest), manifest};
    result.initial = pos(journal.initialWitness); result.final = {...pos(final), digest: hex(final.digest)};
    result.pages = await authenticateWitnessPages(store, manifest); need(result.pages.count === 130 && result.checkpoints > 63, 'native witness/keyframe coverage');
    result.tailRows = JSON.parse(decoder.decode(await readCheckpointObject(store, result.pages.commitment.tail, 8192))).rows.length;
    need(result.tailRows >= 1 && result.tailRows < 16, 'finished partial witness tail');
    result.inventory = (await inventoryWitnessGraph(store, opened.manifest)).refs;
    // A second saved prefix shares genuine old roots. Reclamation must retain it.
    const prefixManifest = JSON.parse(decoder.decode(prefix.manifest)); prefixManifest.id = id + '-prefix';
    const {sessionValidateManifest} = await import('./session-pkg/wasm_vm_session.js');
    const prefixBytes = sessionValidateManifest(encoder.encode(JSON.stringify(prefixManifest))), oldWriter = await store.writer(prefixManifest.id);
    try {await oldWriter.publish(prefixBytes);} finally {await oldWriter.release();}
    const unfinished = await exportSessionWitnessArchive(store, prefixManifest.id); result.unfinishedArchive = await inspectSessionWitnessArchive(unfinished.blob);
    const archive = await exportSessionWitnessArchive(store, id); result.archive = await inspectSessionWitnessArchive(archive.blob);
    const archiveRef = await retain('witness-storage.wvsession', archive.blob); result.archiveFile = archiveRef;
    imported = await SessionStore.open(database + '-import'); result.imported = await importSessionWitnessArchive(imported, archive.blob);
    const reopened = await imported.openSession(id); need(checkpointHash(reopened.manifest) === checkpointHash(opened.manifest), 'exact imported manifest');
    const importedPages = await authenticateWitnessPages(imported, JSON.parse(decoder.decode(reopened.manifest)));
    need(importedPages.count === 130 && importedPages.commitment.tail.sha256 === result.pages.commitment.tail.sha256, 'all imported witnesses');
    result.importedPages = {count: importedPages.count, pages: importedPages.refs.length, tail: importedPages.commitment.tail};
    result.importedDatabase = imported.databaseName;
    result.gc = await store.collectGarbage(); need(result.gc.collected, 'complete live mark set');
    const old = await store.openSession(prefixManifest.id); need(old && checkpointHash(old.manifest) === checkpointHash(prefixBytes), 'old prefix remains intact after cleanup');
    result.prefix = {id: prefixManifest.id, manifestSha256: checkpointHash(old.manifest), revision: old.revision};
    result.listing = await store.list(); need(result.listing.sessions.every(row => row.storageOnly), 'storage-only capability marker');
    let refusal;
    try {await SessionGpuJournal.readExact(store, id, {configuration});} catch (error) {refusal = error.message;}
    need(refusal?.includes('paged GPU playback requires the bounded reader'), 'legacy reader refuses before replay'); result.playbackRefusal = refusal;
    result.status = 'passed';
  } catch (error) {result.status = 'failed'; result.error = String(error.stack ?? error);}
  finally {
    for (const [name, close] of [['renderer', () => gpu?.dispose()], ['machine', () => vm?.free()], ['writer', () => writer?.release()],
      ['imported store', () => imported?.close()], ['store', () => store?.close()]]) {
      try {await close();} catch (error) {result.status = 'failed'; result.error ??= name + ': ' + String(error);}
    }
  }
  return result;
}
