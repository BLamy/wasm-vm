// Bounded attacks on genuine recorded v2 pages. No synthetic execution is claimed.
export async function attackWitnessPages(page, proof) {
  return page.evaluate(async proof => {
    const {SessionStore} = await import('/session-store.js');
    const {SessionGpuJournal} = await import('/session-gpu-journal.js');
    const {SessionWitnessPages, witnessCommitment, witnessExtension} = await import('/session-witness-pages.js');
    const {inventoryWitnessGraph} = await import('/session-witness-graph.js');
    const {exportSessionWitnessArchive, inspectSessionWitnessArchive, importSessionWitnessArchive} = await import('/session-witness-archives.js');
    const {inspectSessionBundle, exportSessionBundle} = await import('/session-bundles.js');
    const {indexSessionBundle, encodeBundleHeader, bundlePrefix} = await import('/session-bundle-format.js');
    const {sessionValidateManifest, sessionValidateDiskRoot, sessionValidateWitnessPage} = await import('/session-pkg/wasm_vm_session.js');
    const {checkpointHash, checkpointReference, readCheckpointObject} = await import('/session-checkpoints.js');
    const need = (ok, detail) => {if (!ok) throw Error('Witness attack: ' + detail);};
    const encoder = new TextEncoder(), decoder = new TextDecoder(), json = value => encoder.encode(JSON.stringify(value));
    const canonical = value => sessionValidateManifest(json(value));
    const store = await SessionStore.open(proof.database), report = {checks: [], mutants: []};
    const rawDb = await new Promise((resolve, reject) => {const request = indexedDB.open(proof.database); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    const raw = (table, key, replacement, remove = false) => new Promise((resolve, reject) => {
      const tx = rawDb.transaction([table], replacement === undefined && !remove ? 'readonly' : 'readwrite', {durability: 'strict'});
      let value; tx.oncomplete = () => resolve(value); tx.onabort = () => reject(tx.error);
      const object = tx.objectStore(table), request = object.get(key); request.onsuccess = () => {
        value = request.result;
        if (remove) object.delete(key); else if (replacement !== undefined) object.put(replacement, key);
      };
    });
    const retain = async (name, bytes) => {
      const response = await fetch('/__retain__/attack-' + name + '.json', {method: 'POST', body: bytes}); need(response.ok, 'retain mutant'); return response.json();
    };
    const rejected = async (name, call, pattern) => {
      let failure; try {await call();} catch (error) {failure = {message: error.message, code: error.code ?? null};}
      need(failure && (!pattern || pattern.test(failure.message)), name + ' did not fail as predicted: ' + JSON.stringify(failure));
      report.checks.push({name, status: 'rejected', ...failure}); return failure;
    };
    const original = await store.openSession(proof.id), manifest = JSON.parse(decoder.decode(original.manifest));
    const prefix = await store.openSession(proof.prefix.id), oldManifest = JSON.parse(decoder.decode(prefix.manifest));
    const chain = []; let cursor = witnessCommitment(manifest).tail;
    while (cursor) {chain.push(cursor); const page = JSON.parse(decoder.decode(await readCheckpointObject(store, cursor, 8192))); cursor = page.previous;}
    chain.reverse();
    const checkpoint = manifest.checkpoints.find(point => point.id === 'witness-40'); need(checkpoint, 'native middle checkpoint');
    // Re-hash and re-link literal pages one at a time. These are malformed storage
    // candidates, never presented as newly executed guest states.
    const mutate = async (kind, writer, id) => {
      let previous = null, before = 0, pages = 0;
      for (const [index, ref] of chain.entries()) {
        const page = JSON.parse(decoder.decode(await readCheckpointObject(store, ref, 8192)));
        if (kind === 'missing-checkpoint') page.rows = page.rows.filter(row => row.transition !== checkpoint.position.transition || row.sequence !== checkpoint.position.sequence);
        if (kind === 'checkpoint-digest') for (const row of page.rows) if (row.transition === checkpoint.position.transition && row.sequence === checkpoint.position.sequence) row.digest[0] ^= 1;
        if (kind === 'prefix-rewrite' && index === 1) page.rows[4].digest[0] ^= 1;
        if (kind === 'reverse-middle' && index === 1) page.rows.reverse();
        if (kind === 'duplicate-row' && index === 1) page.rows[1] = structuredClone(page.rows[0]);
        if (!page.rows.length) continue;
        page.before = before; page.previous = previous;
        if (kind === 'skip-page' && index === 4) page.previous = chain[1];
        if (kind === 'conflicting-length' && index === 4) page.previous = {...previous, length: String(Number(previous.length) + 1)};
        const bytes = json(page), content = checkpointReference(bytes);
        await writer.put(content, [bytes]);
        const retained = await retain(kind + '-page-' + String(index).padStart(4, '0'), bytes); report.mutants.push(retained);
        previous = content; before += page.rows.length; pages++;
      }
      const next = structuredClone(manifest); next.id = id;
      const commitment = witnessCommitment(manifest); commitment.tail = previous; commitment.count = before; commitment.pages = pages;
      next.extensions[1] = witnessExtension(commitment); const bytes = canonical(next);
      report.mutants.push(await retain(kind + '-manifest', bytes)); return bytes;
    };
    try {
      for (const kind of ['missing-checkpoint', 'checkpoint-digest', 'reverse-middle', 'duplicate-row', 'skip-page', 'conflicting-length']) {
        const id = 'attack-' + kind, writer = await store.writer(id);
        try {
          const candidate = await mutate(kind, writer, id);
          await rejected(kind, () => writer.publish(candidate), /witness|Witness|page|Page|Corrupt|digest|length|IndexOrder/);
          need(!await store.openSession(id), kind + ' published metadata');
        } finally {await writer.release();}
      }
      const prefixWriter = await store.writer(prefix.id);
      try {
        const candidate = await mutate('prefix-rewrite', prefixWriter, prefix.id);
        await rejected('rewritten-old-prefix', () => prefixWriter.publish(candidate), /committed witness prefix rewritten|incomplete witness closure\/prefix/);
        const checked = await store.openSession(prefix.id); need(checked.revision === prefix.revision && checkpointHash(checked.manifest) === checkpointHash(prefix.manifest), 'prefix changed');
        const append = structuredClone(manifest); append.id = prefix.id; const appendBytes = canonical(append);
        await rejected('publication-authorizer-abort', () => prefixWriter.publish(appendBytes, null, () => {throw Error('intentional-witness-publication-abort');}), /intentional-witness-publication-abort/);
        const checkedAbort = await store.openSession(prefix.id); need(checkedAbort.revision === prefix.revision && checkpointHash(checkedAbort.manifest) === checkpointHash(prefix.manifest), 'aborted publication changed prefix');
        const oldRow = await raw('sessions', prefix.id);
        try {
          await rejected('stale-final-cas', () => prefixWriter.publish(appendBytes, async () => {
            await raw('sessions', prefix.id, {...oldRow, revision: String(BigInt(oldRow.revision) + 1n)});
          }), /StaleCommit/);
        } finally {await raw('sessions', prefix.id, oldRow);}
      } finally {await prefixWriter.release();}
      // Remove a page used only by the final history. Reclamation must refuse the
      // entire sweep, leaving the older saved prefix and its physical chunks intact.
      const missing = chain.at(-1), object = await raw('objects', missing.sha256), before = await store.statistics();
      try {
        await raw('objects', missing.sha256, undefined, true);
        await rejected('missing-final-page-open', () => store.openSession(proof.id), /MissingObject|Corrupt/);
        await rejected('unreadable-survivor-blocks-gc', () => store.collectGarbage(), /MissingObject|Corrupt/);
        const after = await store.statistics(); need(after.chunks === before.chunks && after.payloadBytes === before.payloadBytes, 'failed mark swept chunks');
        need(await store.openSession(prefix.id), 'older prefix was damaged');
      } finally {await raw('objects', missing.sha256, object);}
      const part = object.parts[0], originalPart = await raw('chunks', part.sha256);
      try {
        const bytes = new Uint8Array(await originalPart.arrayBuffer()); bytes[bytes.length >> 1] ^= 1;
        await raw('chunks', part.sha256, new Blob([bytes]));
        await rejected('corrupt-physical-page', () => store.openSession(proof.id), /Corrupt/);
      } finally {await raw('chunks', part.sha256, originalPart);}
      for (const variant of ['wrong-final', 'wrong-initial', 'swapped-endpoints', 'finished-append', 'mixed-v1-v2', 'optional-pages']) {
        const value = structuredClone(manifest), commitment = witnessCommitment(value);
        if (variant === 'wrong-final') commitment.last.retired = String(BigInt(commitment.last.retired) + 1n);
        if (variant === 'wrong-initial') commitment.first.digest[0] ^= 1;
        if (variant === 'swapped-endpoints') [commitment.first, commitment.last] = [commitment.last, commitment.first];
        if (variant === 'finished-append') value.end.transition = String(BigInt(value.end.transition) + 1n);
        value.extensions[1] = witnessExtension(commitment);
        if (variant === 'mixed-v1-v2') value.extensions.push({kind: 'e9-exact-state-witnesses-v1', required: false, bytes: [...json([commitment.first, commitment.last])]});
        if (variant === 'optional-pages') value.extensions[1].required = false;
        await rejected(variant, () => canonical(value));
      }
      const completed = new SessionGpuJournal(store, null, manifest, proof.configuration);
      await rejected('finished-journal-refuses-staging', () => completed.stage({events:[],payloads:[]}), /GPU batch ownership\/bound/);
      const legacy = await import('/__legacy_metadata__/wasm_vm_session.js'); await legacy.default();
      await rejected('old-client-refuses-required-pages', () => legacy.sessionValidateManifest(original.manifest), /UnsupportedRequired/);
      const v1 = new Uint8Array(await fetch('/__v1_manifest__').then(response => response.arrayBuffer()));
      need(checkpointHash(legacy.sessionValidateManifest(v1)) === checkpointHash(sessionValidateManifest(v1)), 'v1 canonical semantics changed');
      report.checks.push({name: 'unchanged-v1-canonical-manifest', status: 'held', sha256: checkpointHash(v1)});
      const initial = manifest.extensions[0], buffer = new SessionWitnessPages(), firstPage = JSON.parse(decoder.decode(await readCheckpointObject(store, chain[1], 8192)));
      const wrap = {version:2,previous:chain[0],before:0xffffffff,rows:[firstPage.rows[0]]};
      await rejected('wasm-u32-page-count-overflow', () => sessionValidateWitnessPage(json(wrap)), /witness page shape/);
      const wrongOrder = {rows:firstPage.rows,before:firstPage.before,previous:firstPage.previous,version:2};
      await rejected('noncanonical-page-field-order', () => sessionValidateWitnessPage(json(wrongOrder)), /noncanonical witness page/);
      const duplicateField = '{"version":2,' + new TextDecoder().decode(json(firstPage)).slice(1);
      await rejected('duplicate-page-field', () => sessionValidateWitnessPage(encoder.encode(duplicateField)), /witness page encoding/);

      for (const row of firstPage.rows) buffer.stage(row);
      const pending = buffer.pending; need(pending === 16, 'genuine full resident page');
      await rejected('seventeenth-resident-witness', () => buffer.stage(witnessCommitment(manifest).last), /resident witness window/);
      await rejected('failed-page-staging-retryable', () => buffer.prepare({put: async () => {throw Error('intentional-staging-quota');}}), /intentional-staging-quota/);
      need(buffer.pending === 16 && buffer.committed === null, 'failed staging lost pending witnesses');
      // A labelled storage-graph fixture exercises full-map disk descendants.
      // Its added block is not a claim that the native guest wrote that block.
      const diskFixture = structuredClone(manifest); diskFixture.id = 'attack-disk-inventory';
      const rootRef = await store.objectReference(manifest.checkpoints[0].disk_root);
      const diskRoot = JSON.parse(decoder.decode(await readCheckpointObject(store, rootRef, 12*1048576)));
      const blockBytes = new Uint8Array(4096).fill(0x5a), blockRef = checkpointReference(blockBytes);
      diskRoot.blocks = [{index:'0', sha256:blockRef.sha256}];
      const rootBytes = sessionValidateDiskRoot(json(diskRoot)), newRoot = checkpointReference(rootBytes);
      for (const point of diskFixture.checkpoints) point.disk_root = newRoot.sha256;
      const diskManifest = canonical(diskFixture), diskWriter = await store.writer(diskFixture.id);
      try {
        await diskWriter.put(newRoot, [rootBytes]);
        await rejected('missing-disk-descendant-before-publication', () => diskWriter.publish(diskManifest), /Corrupt|MissingObject/);
        need(!await store.openSession(diskFixture.id), 'missing disk child published');
        await diskWriter.put(blockRef, [blockBytes]); await diskWriter.publish(diskManifest);
      } finally {await diskWriter.release();}
      const diskGraph = await inventoryWitnessGraph(store, diskManifest);
      need(diskGraph.refs.some(ref => ref.sha256===blockRef.sha256&&ref.length==='4096'), 'disk child absent from shared inventory');
      const diskArchive = await exportSessionWitnessArchive(store, diskFixture.id); await inspectSessionWitnessArchive(diskArchive.blob);
      report.diskFixture = {scope:'storage-graph metadata fixture only; not native guest disk execution',block:blockRef,root:newRoot,
        manifest:await retain('disk-inventory-manifest',diskManifest),rootBytes:await retain('disk-inventory-root',rootBytes)};
      report.checks.push({name:'complete-disk-descendant-inventory',status:'held'});
      await store.deleteSession(diskFixture.id);
      const archive = await exportSessionWitnessArchive(store, proof.id), indexed = await indexSessionBundle(archive.blob);
      await rejected('storage-archive-playback-refused', () => inspectSessionBundle(archive.blob), /storage-only witness archives/);
      await rejected('paged-playback-export-refused', () => exportSessionBundle(store, proof.id), /unsupported extension/);
      const storageManifest = indexed.header.manifest;
      const repack = async (mode) => {
        const header = structuredClone(indexed.header), entries = [];
        for (const ref of header.objects) {
          if (mode === 'missing' && ref.sha256 === chain.at(-1).sha256) continue;
          const bytes = new Uint8Array(Number(ref.length)); let at = 0;
          for await (const part of indexed.stream(ref)) {bytes.set(part, at); at += part.length;}
          if (mode === 'corrupt' && ref.sha256 === chain.at(-1).sha256) bytes[bytes.length >> 1] ^= 1;
          entries.push({ref, bytes});
        }
        if (mode === 'surplus') {const bytes = encoder.encode('unreferenced-witness-archive-object'); entries.push({ref: checkpointReference(bytes), bytes}); entries.sort((a, b) => a.ref.sha256.localeCompare(b.ref.sha256));}
        header.objects = entries.map(row => row.ref); header.uncompressedBytes = String(entries.reduce((sum, row) => sum + row.bytes.length, 0));
        const encoded = encodeBundleHeader(header); return new Blob([bundlePrefix(encoded), encoded, ...entries.map(row => new Blob([row.bytes]))]);
      };
      const invalidStore = await SessionStore.open(proof.database + '-invalid');
      try {
        for (const mode of ['missing', 'corrupt', 'surplus']) {
          const mutant = await repack(mode);
          await rejected('archive-' + mode + '-before-publication', () => importSessionWitnessArchive(invalidStore, mutant));
          need((await invalidStore.statistics()).sessions === 0 && (await invalidStore.statistics()).objects === 0, 'invalid import staged data');
        }
      } finally {await invalidStore.close();}
      const wrongScope = {...indexed.header, scope: 'playback'};
      await rejected('archive-scope-downgrade', () => encodeBundleHeader(wrongScope));
      const downgrade = {...indexed.header, portability: 'wasm-vm-installed-build-v1'};
      await rejected('archive-discriminator-downgrade', () => encodeBundleHeader(downgrade));
      const quota = await SessionStore.open(proof.database + '-quota');
      try {
        await quota.setRetention({maxBytes: 1048576, maxCheckpoints: 4096});
        await rejected('partial-real-retention-quota-import', () => importSessionWitnessArchive(quota, archive.blob), /RetentionLimit/);
        const stats = await quota.statistics(); need(stats.sessions === 0 && stats.objects > 0 && stats.payloadBytes > 0, 'quota import was not a partial stage');
        report.quota = stats;
      } finally {await quota.close();}
      const after = await store.openSession(proof.id), old = await store.openSession(prefix.id);
      need(after.revision === original.revision && checkpointHash(after.manifest) === checkpointHash(original.manifest)
        && old.revision === prefix.revision && checkpointHash(old.manifest) === checkpointHash(prefix.manifest), 'attacks changed committed histories');
      report.finalGc = await store.collectGarbage(); need(report.finalGc.collected, 'cleanup after attacks');
      report.final = {revision: after.revision, sha256: checkpointHash(after.manifest), prefixSha256: checkpointHash(old.manifest),
        archiveManifest: storageManifest.sha256, initialWitnessBytes: initial.bytes.length};
      return report;
    } finally {rawDb.close(); await store.close();}
  }, proof);
}
