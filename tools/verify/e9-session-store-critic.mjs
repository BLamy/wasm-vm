// Promoted E9-T03 critic attacks. All writes use actual IndexedDB transactions.
import assert from 'node:assert/strict';

export async function checkSessionStoreCritic(page, {name, fixture}) {
  const result = await page.evaluate(async ({name, fixture}) => {
    const {SessionStore, SESSION_DATABASE_VERSION = 1} = await import('./session-store.js');
    const namespace = name + '-critic', id = 'critic-integrity';
    let store = await SessionStore.open(namespace);
    const encode = value => new TextEncoder().encode(JSON.stringify(value));
    const value = {...structuredClone(fixture.template), id};
    const writer = await store.writer(id);
    try {
      for (let repeat = 0; repeat < 2; repeat++) {
        for (const blob of fixture.blobs) await writer.put(blob.ref, [new Uint8Array(blob.bytes)]);
      }
      await writer.publish(encode(value));
    } finally { await writer.release(); }
    const original = await store.openSession(id), machine = value.checkpoints[0].machine;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(namespace);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const read = (table, key) => new Promise((resolve, reject) => {
      const request = db.transaction([table]).objectStore(table).get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const write = (table, key, value) => new Promise((resolve, reject) => {
      const tx = db.transaction([table], 'readwrite', {durability: 'strict'});
      if (value === undefined) tx.objectStore(table).delete(key);
      else tx.objectStore(table).put(value, key);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    const refused = async action => { try { await action(); return 'accepted'; } catch (error) { return error.code; } };
    const row = await read('sessions', id), object = await read('objects', machine.sha256);
    const chunkKey = object.parts[0].sha256, chunk = await read('chunks', chunkKey), faults = [];
    for (const fault of ['object-length', 'object-parts', 'cursor-zero', 'cursor-overflow']) {
      const table = fault.startsWith('object') ? 'objects' : 'sessions';
      const key = table === 'objects' ? machine.sha256 : id, saved = table === 'objects' ? object : row;
      const bad = structuredClone(saved);
      if (fault === 'object-length') bad.length = String(BigInt(bad.length) + 1n);
      if (fault === 'object-parts') bad.parts = [];
      if (fault === 'cursor-zero') bad.revision = '0';
      if (fault === 'cursor-overflow') bad.revision = '18446744073709551616';
      try {
        await write(table, key, bad);
        const code = await refused(() => store.openSession(id)), listed = await store.list();
        const durable = await read('sessions', id);
        faults.push({fault, code, playable: listed.sessions.some(session => session.id === id),
          unavailable: listed.unavailable.some(session => session.id === id),
          manifestUnchanged: String(durable.manifest) === String(row.manifest)});
      } finally { await write(table, key, saved); }
    }
    // Reuse must verify immutable existing bytes/descriptors, never overwrite corruption.
    const reuse = await store.writer(id), reuseRef = fixture.blobs.find(blob => blob.ref.sha256 === machine.sha256);
    const reuseFaults = [];
    try {
      for (const fault of ['chunk-content', 'object-content']) {
        try {
          if (fault === 'chunk-content') await write('chunks', chunkKey, new Blob([new Uint8Array(chunk.size)]));
          else {
            const bad = structuredClone(object); bad.parts[0].sha256 = '0'.repeat(64);
            await write('objects', machine.sha256, bad);
          }
          reuseFaults.push({fault, code: await refused(() => reuse.put(machine, [new Uint8Array(reuseRef.bytes)]))});
        } finally { await write('chunks', chunkKey, chunk); await write('objects', machine.sha256, object); }
      }
    } finally { await reuse.release(); }
    // Enqueue a real out-of-band transaction before the final publication transaction.
    const publication = [];
    for (const fault of ['stale-cursor', 'changed-object', 'missing-chunk']) {
      const lease = await store.writer(id), next = structuredClone(value);
      next.end.transition = String(BigInt(next.end.transition) + 1n);
      next.end.retired = String(BigInt(next.end.retired) + 1n);
      let injected;
      globalThis.__e9SessionStoreProbe = event => {
        if (event.id !== id || event.phase !== 'before-commit') return;
        if (fault === 'stale-cursor') injected = write('sessions', id, {...row, revision: String(BigInt(row.revision) + 1n)});
        if (fault === 'changed-object') {
          const bad = structuredClone(object); bad.parts[0].sha256 = '0'.repeat(64);
          injected = write('objects', machine.sha256, bad);
        }
        if (fault === 'missing-chunk') injected = write('chunks', chunkKey, undefined);
      };
      try {
        publication.push({fault, code: await refused(() => lease.publish(encode(next)))});
        await injected;
      } finally {
        delete globalThis.__e9SessionStoreProbe; await lease.release();
        await write('sessions', id, row); await write('objects', machine.sha256, object); await write('chunks', chunkKey, chunk);
      }
    }
    const platformFaults = [], originalAdd = IDBObjectStore.prototype.add;
    const objectLease = await store.writer(id);
    try {
      for (const fault of ['object-quota', 'native-constraint', 'throwing-observer']) {
        const bytes = new TextEncoder().encode('critic-' + fault);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        const ref = {sha256: digest, length: String(bytes.length)};
        IDBObjectStore.prototype.add = function (data, key) {
          if (this.name === 'objects' && key === ref.sha256) {
            if (fault === 'object-quota') throw new DOMException('critic object quota boundary', 'QuotaExceededError');
            if (fault === 'native-constraint') return originalAdd.call(this, data, machine.sha256);
          }
          return originalAdd.call(this, data, key);
        };
        if (fault === 'throwing-observer') globalThis.__e9SessionStoreProbe = () => { throw new Error('critic observer'); };
        try { platformFaults.push({fault, code: await refused(() => objectLease.put(ref, [bytes]))}); }
        finally { IDBObjectStore.prototype.add = originalAdd; delete globalThis.__e9SessionStoreProbe; }
      }
    } finally { await objectLease.release(); IDBObjectStore.prototype.add = originalAdd; }
    const restored = await store.openSession(id);
    const lease = await store.writer('critic-cancel-publish'); let released;
    globalThis.__e9SessionStoreProbe = event => {
      if (event.id === lease.id && event.phase === 'before-commit') released = lease.release();
    };
    let cancellation;
    try { cancellation = await refused(() => lease.publish(encode({...value, id: lease.id}))); await released; }
    finally { delete globalThis.__e9SessionStoreProbe; await lease.release(); }
    const cancelledRow = await store.openSession(lease.id);
    const held = await store.writer('critic-close'); await store.close();
    const close = {store: await refused(() => store.list()), writer: await refused(() => held.publish(encode(value)))};
    store = await SessionStore.open(namespace);
    const acquired = await store.writer('critic-close'); await acquired.release();
    const reopened = await store.openSession(id); await store.close(); db.close();
    const closingStore = await SessionStore.open(namespace + '-closing');
    const acquiring = closingStore.writer('closing-acquisition').then(() => 'accepted', error => error.code);
    await closingStore.close(); const closedAcquisition = await acquiring;
    const versionName = namespace + '-version', versionStore = await SessionStore.open(versionName);
    const versionLease = await versionStore.writer('version-change');
    const upgraded = await new Promise((resolve, reject) => {
      const request = indexedDB.open(versionName, SESSION_DATABASE_VERSION + 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await versionLease.release(); upgraded.close();
    const version = {closed: await refused(() => versionStore.list()), oldOpen: await refused(() => SessionStore.open(versionName))};
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(versionName);
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
    const catalogName = namespace + '-catalog', catalog = await SessionStore.open(catalogName);
    const catalogLease = await catalog.writer('catalog-overflow');
    try { for (const blob of fixture.blobs) await catalogLease.put(blob.ref, [new Uint8Array(blob.bytes)]); }
    finally { await catalogLease.release(); }
    const catalogDb = await new Promise((resolve, reject) => {
      const request = indexedDB.open(catalogName);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const seedCatalog = count => new Promise((resolve, reject) => {
      const tx = catalogDb.transaction(['sessions'], 'readwrite', {durability: 'strict'}), rows = tx.objectStore('sessions');
      rows.clear();
      for (let index = 0; index < count; index++) {
        const id = 'catalog-' + index; rows.put({id, revision: '1', manifest: encode({...value, id})}, id);
      }
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    await seedCatalog(256); const overflowing = await catalog.writer('catalog-overflow'); let catalogCommit;
    try { catalogCommit = await refused(() => overflowing.publish(encode({...value, id: overflowing.id}))); }
    finally { await overflowing.release(); }
    await seedCatalog(257); const catalogList = await refused(() => catalog.list());
    await catalog.close(); catalogDb.close();
    return {faults, reuseFaults, publication, platformFaults, cancellation, cancelledRow, close, closedAcquisition,
      version, catalogCommit, catalogList, reacquired: true,
      restored: restored.revision === original.revision && String(restored.manifest) === String(original.manifest),
      reopened: reopened.revision === original.revision && String(reopened.manifest) === String(original.manifest)};
  }, {name, fixture});
  for (const fault of result.faults) assert.deepEqual(fault, {
    fault: fault.fault, code: 'Corrupt', playable: false, unavailable: true, manifestUnchanged: true,
  });
  assert.deepEqual(result.reuseFaults, [
    {fault: 'chunk-content', code: 'Corrupt'}, {fault: 'object-content', code: 'Corrupt'},
  ]);
  assert.deepEqual(result.publication, [
    {fault: 'stale-cursor', code: 'StaleCommit'}, {fault: 'changed-object', code: 'Corrupt'},
    {fault: 'missing-chunk', code: 'Corrupt'},
  ]);
  assert.deepEqual(result.platformFaults, [
    {fault: 'object-quota', code: 'Quota'}, {fault: 'native-constraint', code: 'Storage'},
    {fault: 'throwing-observer', code: 'accepted'},
  ]);
  assert.equal(result.cancellation, 'WriterClosed'); assert.equal(result.cancelledRow, null);
  assert.deepEqual(result.close, {store: 'Closed', writer: 'WriterClosed'});
  assert.equal(result.closedAcquisition, 'Closed');
  assert.deepEqual(result.version, {closed: 'Closed', oldOpen: 'Storage'});
  assert.equal(result.catalogCommit, 'Bound'); assert.equal(result.catalogList, 'Bound');
  assert.ok(result.reacquired && result.restored && result.reopened);
  return result;
}
