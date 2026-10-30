// Ordinary built-browser component recordings, inside the existing acceptance page.
export async function recordNetworkComponents(page) {
  return page.evaluate(async () => {
    const {WasmMachine, SessionNetworkLease} = await import('./pkg/wasm_vm_wasm.js');
    const {SessionStore} = await import('./session-store.js');
    const {SessionInputJournal} = await import('./session-inputs.js');
    const {checkpointHash, readCheckpointObject} = await import('./session-checkpoints.js');
    const {sessionValidateManifest, sessionEventReferences, sessionManifestReferences} = await import('./session-pkg/wasm_vm_session.js');
    const {encodeNetworkEvent, splitNetworkEvent, openNetworkProvider, NetworkReplay} = await import('./session-network.js');
    const need = (ok, why) => { if (!ok) throw Error('network component proof: ' + why); };
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    const upload = async (name, bytes) => {
      const response = await fetch('./__network-proof/components/' + name, {method: 'POST', body: bytes});
      need(response.ok, 'retained original ' + name); return response.json();
    };
    const refuse = async (label, operation, expected) => {
      let message;
      try { await operation(); } catch (error) { message = String(error); }
      need(message, label + ' must refuse'); need(message.includes(expected), label + ' refusal cause'); return {label, message};
    };
    const original = globalThis.__networkCaptureReport;
    need(original?.status === 'passed', 'original real-guest proof');
    const template = JSON.parse(decoder.decode(original.persisted.manifest));
    const configRef = template.assets.find(asset => asset.role === 'vm').content;
    const configObject = original.persisted.objects.find(object => object.ref.sha256 === configRef.sha256);
    need(configObject && checkpointHash(configObject.bytes) === configRef.sha256, 'authenticated configuration');
    const configuration = JSON.parse(decoder.decode(configObject.bytes));
    const elf = new Uint8Array(await (await fetch('./assets/e9-network-capture.elf')).arrayBuffer());
    const baseManifest = JSON.parse(configuration.imageManifest);
    const policy = {version: 1, base: {identity: template.machine.base_image, sectors: '1', chunk_bytes: 512,
      chunks: [{sha256: baseManifest.chunks[0], length: 512}]}, agent: false, capture: false};
    const fresh = (replay, network = true) => {
      const machine = new WasmMachine(16);
      machine.loadElf(elf); machine.startEventClock(1, 1);
      machine.installDeviceSession(JSON.stringify(policy), replay);
      if (network) machine.installNetworkSession(replay);
      machine.setTrace(true); return machine;
    };
    const run = (machine, target, budget) => {
      while (BigInt(machine.eventPosition().transition) < BigInt(target)) machine.runEventUntil(String(target), budget);
    };
    const accept = (machine, bytes, id = '') => {
      const lease = machine.leaseNetworkRequest(id);
      try { machine.completeNetworkEvent(lease, bytes); } finally { lease.free(); }
      const receipts = machine.takeNetworkDeliveries(); need(receipts.length === 1, 'one receipt'); return receipts[0];
    };
    const overlay = initial => {
      const disk = new Uint8Array(61), view = new DataView(disk.buffer);
      disk.set(encoder.encode('WVOD1')); view.setUint32(5, 4096, true); view.setBigUint64(9, 512n, true);
      disk.set(initial.subarray(44, 76), 17); disk.set(initial.subarray(76, 84), 49); return disk;
    };
    const report = {kind: 'ordinary worker component evidence; no independent verdict', outcomes: [], refusals: []};
    const inactive = fresh(false, false), factoryMachine = fresh(false);
    try {
      const before = inactive.saveEventCheckpoint();
      report.refusals.push(await refuse('inactive cursor', () => inactive.networkCursor(), 'Inactive'));
      need(checkpointHash(inactive.saveEventCheckpoint()) === checkpointHash(before), 'inactive cursor is read-only');
      const initial = factoryMachine.saveEventCheckpoint(), free = SessionNetworkLease.prototype.free;
      let frees = 0, factories = 0;
      SessionNetworkLease.prototype.free = function () { frees++; return free.call(this); };
      try {
        report.refusals.push(await refuse('recording factory throws', () => openNetworkProvider(factoryMachine, () => {
          factories++; throw Error('ordinary factory construction failed');
        }), 'ordinary factory construction failed'));
      } finally { SessionNetworkLease.prototype.free = free; }
      need(frees === 1 && factories === 1, 'factory cleanup frees the actual native lease once');
      need(factoryMachine.networkCursor() === '0' && checkpointHash(factoryMachine.saveEventCheckpoint()) === checkpointHash(initial), 'factory failure leaves state/cursor');
      const reserved = encodeNetworkEvent(4); reserved[8] = 255;
      report.refusals.push(await refuse('reserved browser event kind', () => splitNetworkEvent(reserved), 'event kind'));
      report.factory = {factories, frees, unchanged: await upload('factory-unchanged.resume', initial), cursor: '0'};
      report.reservedEvent = await upload('reserved-event.bin', reserved);

      const wide = initial.slice(), view = new DataView(wide.buffer), cursor = 9007199254740999n;
      let clock = false, network = false;
      for (let at = 84; at < wide.length;) {
        const tag = view.getUint32(at, true), length = view.getUint32(at + 4, true), payload = at + 8;
        if (tag === 18) { view.setBigUint64(payload + 36, cursor, true); view.setBigUint64(payload + 44, cursor, true); clock = true; }
        if (tag === 21) { view.setBigUint64(payload + 16, cursor, true); network = true; }
        at += 8 + length;
      }
      need(clock && network, 'wide cursor fixture sections');
      factoryMachine.restoreEventCheckpoint(wide);
      need(factoryMachine.networkCursor() === String(cursor), 'exact native-to-Wasm decimal cursor above 2^53');
      need(checkpointHash(factoryMachine.saveEventCheckpoint()) === checkpointHash(wide), 'cursor allocation/free leaves state');
      report.wideCursor = {value: factoryMachine.networkCursor(), frame: await upload('wide-cursor.resume', wide)};
    } finally { inactive.free(); factoryMachine.free(); }

    const database = 'wasm-vm-sessions-v1-network-components';
    let store = await SessionStore.open(database);
    let good, goodInitial, firstReceipt;
    try {
      for (const result of [1, 2]) {
        const id = 'result-' + result, machine = fresh(false), replay = fresh(true);
        let writer = await store.writer(id);
        try {
          const initial = machine.saveEventCheckpoint();
          const journal = await SessionInputJournal.createWitness(store, writer, configuration, initial, overlay(initial), new Uint8Array(), new Uint8Array());
          run(machine, 1024, 31);
          const request = machine.networkRequests()[0]; need(request?.id === '1', 'actual guest send');
          const receipts = [accept(machine, encodeNetworkEvent(1, {id: request.id, result, payload: request.frame}), request.id),
            accept(machine, encodeNetworkEvent(3, {id: '3', result: 60 + result}))];
          journal.stage(receipts); await journal.flush();
          need(machine.networkCursor() === '2', 'cursor equals two actual accepted outcomes');
          const final = machine.saveEventCheckpoint(), trace = machine.takeTrace();
          await writer.release(); writer = null; await store.close(); store = await SessionStore.open(database);
          const opened = await store.openSession(id), reopened = await SessionInputJournal.read(store, id);
          need(reopened.receipts.length === 2 && JSON.stringify(reopened.receipts.map(r => [r.outcome, [...r.bytes]])) === JSON.stringify(receipts.map(r => [r.outcome, [...r.bytes]])), 'durable failed/cancelled/link bytes');
          const eventBytes = await readCheckpointObject(store, reopened.manifest.events[0].content, 4194304);
          const statuses = JSON.parse(decoder.decode(eventBytes)).map(event => event.status);
          need(JSON.stringify(statuses) === JSON.stringify([result === 1 ? 'failed' : 'cancelled', 'failed']), 'durable result status selection');
          replay.restoreEventCheckpoint(initial);
          const driver = new NetworkReplay(replay, reopened.receipts, '1024', '2'); driver.run(7);
          const replayFrame = replay.saveEventCheckpoint(), replayTrace = replay.takeTrace();
          need(driver.state === 'completed' && checkpointHash(replayFrame) === checkpointHash(final) && replayTrace === trace, 'offline result replay frame/trace');
          const references = new Map();
          for (const index of reopened.manifest.events) {
            references.set(index.content.sha256, index.content);
            const bytes = await readCheckpointObject(store, index.content, 4194304);
            for (const ref of JSON.parse(decoder.decode(sessionEventReferences(opened.manifest, bytes)))) references.set(ref.sha256, ref);
          }
          const owned = JSON.parse(decoder.decode(sessionManifestReferences(opened.manifest)));
          for (const ref of owned.blobs) references.set(ref.sha256, ref);
          for (const hash of owned.roots) references.set(hash, await store.objectReference(hash));
          const objects = [];
          for (const ref of references.values()) objects.push({ref, bytes: await upload('objects/' + ref.sha256, await readCheckpointObject(store, ref, 300 * 1048576))});
          const rows = [];
          for (const [index, receipt] of receipts.entries()) rows.push({...receipt, bytes: await upload(id + '-event-' + index + '.bin', receipt.bytes)});
          report.outcomes.push({result, statuses, cursor: machine.networkCursor(), position: machine.eventPosition(),
            initial: await upload(id + '-initial.resume', initial), final: await upload(id + '-final.resume', final),
            replay: await upload(id + '-replay.resume', replayFrame), trace: await upload(id + '-original.trace', trace),
            replayTrace: await upload(id + '-replay.trace', replayTrace), manifest: await upload(id + '-manifest.json', opened.manifest), receipts: rows, objects});
          if (result === 1) { good = reopened.manifest; goodInitial = initial; firstReceipt = receipts[0]; }
        } finally { if (writer) await writer.release(); machine.free(); replay.free(); }
      }

      const originalManifest = await store.openSession('result-1');
      const writer = await store.writer('result-1'); let puts = 0, publications = 0;
      try {
        const counted = {id: writer.id, put: (...args) => { puts++; return writer.put(...args); }, publish: (...args) => { publications++; return writer.publish(...args); }};
        const wrong = structuredClone(configuration); wrong.networkPolicy.replay = 'live';
        report.refusals.push(await refuse('wrong network policy before publication', () => SessionInputJournal.createWitness(store, counted, wrong, goodInitial, overlay(goodInitial), new Uint8Array(), new Uint8Array()), 'frozen network policy'));
        const unchanged = await store.openSession('result-1');
        need(puts === 0 && publications === 0 && unchanged.revision === originalManifest.revision && checkpointHash(unchanged.manifest) === checkpointHash(originalManifest.manifest), 'wrong policy leaves durable manifest/cursor');
      } finally { await writer.release(); }
      report.policyPublication = {puts, publications, unchangedManifest: await upload('wrong-policy-unchanged-manifest.json', originalManifest.manifest)};

      const absentWriter = await store.writer('without-network');
      try {
        const absent = structuredClone(configuration); delete absent.networkPolicy;
        const journal = await SessionInputJournal.createWitness(store, absentWriter, absent, goodInitial, overlay(goodInitial), new Uint8Array(), new Uint8Array());
        const before = await store.openSession('without-network'), end = journal.end;
        report.refusals.push(await refuse('network source absent during stage', () => journal.stage([firstReceipt]), 'source adapter is absent from this prefix'));
        need(journal.pending === 0 && JSON.stringify(journal.end) === JSON.stringify(end), 'stage refusal preserves journal');
        const after = await store.openSession('without-network');
        need(after.revision === before.revision && checkpointHash(after.manifest) === checkpointHash(before.manifest), 'stage refusal preserves publication');
        report.absentSource = {pending: journal.pending, end, manifest: await upload('absent-network-unchanged-manifest.json', after.manifest)};
      } finally { await absentWriter.release(); }

      const missing = structuredClone(good); missing.id = 'missing-reader-network'; missing.policy.required_inputs = missing.policy.required_inputs.filter(source => source !== 'network');
      const missingWriter = await store.writer(missing.id);
      try { await missingWriter.publish(sessionValidateManifest(encoder.encode(JSON.stringify(missing)))); } finally { await missingWriter.release(); }
      const before = await store.openSession(missing.id);
      report.refusals.push(await refuse('network source absent during durable read', () => SessionInputJournal.read(store, missing.id), 'source adapter is absent from this prefix'));
      const after = await store.openSession(missing.id), originalAfter = await store.openSession('result-1');
      need(after.revision === before.revision && checkpointHash(after.manifest) === checkpointHash(before.manifest), 'read refusal is read-only');
      need(originalAfter.revision === originalManifest.revision && checkpointHash(originalAfter.manifest) === checkpointHash(originalManifest.manifest), 'good parent prefix unchanged');
      report.absentRead = {manifest: await upload('absent-reader-unchanged-manifest.json', before.manifest), revision: before.revision};
      report.status = 'passed'; return report;
    } finally { await store.close(); }
  });
}
