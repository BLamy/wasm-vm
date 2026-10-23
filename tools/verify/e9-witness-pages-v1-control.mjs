// Genuine bounded v1 GPU archive control; keeps the old admission path exercised.
export async function controlV1WitnessArchives(page, proof) {
  return page.evaluate(async proof => {
    const {default: init, WasmLinux} = await import('/pkg/wasm_vm_wasm.js'); await init();
    const {SessionStore} = await import('/session-store.js'), {SessionGpuJournal} = await import('/session-gpu-journal.js');
    const {exportSessionBundle, inspectSessionBundle, importSessionBundle} = await import('/session-bundles.js');
    const {attachProductionVirgl, createWorkerScanoutPresenter} = await import('/renderer/virgl-command/production.mjs');
    const {checkpointHash} = await import('/session-checkpoints.js');
    const need = (ok, detail) => {if (!ok) throw Error('v1 archive control: ' + detail);};
    let vm, gpu, writer, store, destination; const result = {status: 'running', database: proof.database + '-v1'};
    try {
      const configuration = structuredClone(proof.configuration), kernel = new Uint8Array(await fetch(configuration.kernel.url).then(r => r.arrayBuffer()));
      need(checkpointHash(kernel) === configuration.kernel.sha256, 'real pinned guest');
      vm = WasmLinux.newExactGpuSession(kernel, configuration.imageManifest, configuration.bootargs, () => {}, false); vm.enableJit(2);
      let presenter; presenter = createWorkerScanoutPresenter(frame => {if (frame.presentationToken) queueMicrotask(() => presenter.acknowledge(frame.presentationToken, 'superseded'));});
      gpu = await attachProductionVirgl(vm, {presenter}); configuration.profile = gpu.checkpointProfile();
      store = await SessionStore.open(result.database); writer = await store.writer('legacy-v1');
      const journal = await SessionGpuJournal.create(store, writer, configuration, vm, gpu), initial = journal.initialWitness;
      vm.sendInput(Uint8Array.of(97)); vm.runChunk(8192); const batch = vm.takeExactGpuBatch();
      need(batch.payloads.length === 0 && batch.events.length > 0, 'real native v1 input'); journal.stage(batch); await journal.flush();
      const final = await journal.captureKeyframe(vm, gpu, 'legacy-end'); await journal.completeExact(final, [initial, final]);
      await writer.release(); writer = null; gpu.dispose(); gpu = null; vm.free(); vm = null;
      const opened = await store.openSession('legacy-v1'), manifest = JSON.parse(new TextDecoder().decode(opened.manifest));
      need(manifest.extensions[1].kind === 'e9-exact-state-witnesses-v1', 'unchanged v1 completion');
      const archive = await exportSessionBundle(store, 'legacy-v1'); result.inspection = await inspectSessionBundle(archive.blob);
      destination = await SessionStore.open(result.database + '-import'); result.imported = await importSessionBundle(destination, archive.blob);
      const copied = await destination.openSession('legacy-v1'); need(checkpointHash(copied.manifest) === checkpointHash(opened.manifest), 'v1 import identity');
      const response = await fetch('/__retain__/legacy-v1.wvsession', {method: 'POST', body: archive.blob}); need(response.ok, 'retain old schema archive'); result.archive = await response.json();
      result.manifestSha256 = checkpointHash(opened.manifest); result.extensionBytes = manifest.extensions[1].bytes.length;
      result.events = batch.events.length; result.importedDatabase = destination.databaseName;
      result.status = 'passed'; return result;
    } finally {
      gpu?.dispose(); vm?.free(); await writer?.release(); await destination?.close(); await store?.close();
    }
  }, proof);
}
