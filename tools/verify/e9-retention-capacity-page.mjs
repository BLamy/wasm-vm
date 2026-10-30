// Browser half of the exact physical-capacity proof. The fixture import is
// deliberately outside SessionStore; every NEW byte crosses its production writer.
const need = (value, message) => {if (!value) throw Error(message);};
const gib = 1024 ** 3, mib = 1024 ** 2;
const progress = (step, extra = '') => console.log(`E9-T22m ${step} ${extra}`);
const idbTransaction = (database, stores, mode, enqueue) => new Promise((resolve, reject) => {
  const tx = database.transaction(stores, mode, mode === 'readwrite' ? {durability: 'strict'} : undefined);
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('IDB import aborted'));
  enqueue(tx);
});
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const novel = length => {
  const bytes = new Uint8Array(length);
  for (let at = 0; at < length; at += 65536) crypto.getRandomValues(bytes.subarray(at, Math.min(at + 65536, length)));
  return bytes;
};

export async function provePhysicalCapacity(config) {
  const {SessionStore, DEFAULT_SESSION_RETENTION} = await import('/session-store.js');
  const {checkRetentionCapacity} = await import('/__capacity_policy__.mjs');
  const capacityChecks = [];
  const capacity = async (phase, localBytes) => {
    const estimate = await navigator.storage.estimate();
    const host = await (await fetch('/__host_free__.json')).json();
    const receipt = checkRetentionCapacity({quota: estimate.quota, usage: estimate.usage,
      hostFreeBytes: host.bytes, localBytes, reserveBytes: config.reserveBytes});
    capacityChecks.push({phase, ...receipt});
  };
  need(DEFAULT_SESSION_RETENTION.maxBytes === 2 * gib
    && DEFAULT_SESSION_RETENTION.maxCheckpoints === 4096, 'production default changed');
  const source = await (await fetch('/__index__.json')).json();
  const metadata = Object.fromEntries(source.stores.metadata.map(row => [row.key, row.value]));
  need(metadata.payloadBytes === config.prefixBytes
    && metadata.limits.maxBytes === 8 * gib
    && metadata.limits.maxCheckpoints === 4096, 'original failed prefix metadata');
  need(source.stores.sessions.length === 1 && source.stores.sessions[0].value.revision === '637'
    && source.stores.chunks.length === 10268 && source.stores.objects.length === 2816,
  'original failed prefix graph');
  let store = await SessionStore.open(config.database);
  need((await store.statistics()).payloadBytes === 0, 'fixture database must be fresh');
  await store.close();
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(config.database, 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    for (const table of ['objects', 'sessions', 'metadata']) {
      const rows = source.stores[table];
      for (let at = 0; at < rows.length; at += 100) {
        await idbTransaction(database, [table], 'readwrite', tx => {
          for (const row of rows.slice(at, at + 100)) {
            const value = table === 'sessions'
              ? {...row.value, manifest: new Uint8Array(row.value.manifest)} : row.value;
            tx.objectStore(table).put(value, row.key);
          }
        });
      }
    }
    const chunks = source.stores.chunks;
    for (let at = 0; at < chunks.length; at += 16) {
      const batch = await Promise.all(chunks.slice(at, at + 16).map(async row => {
        const response = await fetch('/__chunk__/' + row.key + '.bin');
        need(response.ok, 'retained chunk fetch');
        const bytes = new Uint8Array(await response.arrayBuffer());
        need(bytes.length === row.bytes && await digest(bytes) === row.key,
          'retained chunk authentication ' + row.key);
        return {key: row.key, bytes};
      }));
      await idbTransaction(database, ['chunks'], 'readwrite', tx => {
        for (const row of batch) tx.objectStore('chunks').put(new Blob([row.bytes]), row.key);
      });
      if (at % 512 === 0) progress('rehydrated', `${at}/${chunks.length}`);
    }
  } finally {database.close();}
  store = await SessionStore.open(config.database);
  const seeded = await store.statistics();
  need(seeded.payloadBytes === config.prefixBytes && seeded.chunks === 10268
    && seeded.objects === 2816 && seeded.sessions === 1, 'physical prefix import');
  const original = await store.openSession(source.stores.sessions[0].key);
  need(original?.revision === '637'
    && await digest(original.manifest) === config.manifestSha256, 'prefix production reopen');
  await store.setRetention({maxBytes: config.maxBytes, maxCheckpoints: 4096});
  await store.close();
  store = await SessionStore.open(config.database);
  need((await store.statistics()).limits.maxBytes === config.maxBytes, 'durable production limit');
  progress('production retention reopened', String(config.maxBytes));
  await capacity('after-authenticated-prefix', config.maxBytes - config.prefixBytes);
  const writer = await store.writer(source.stores.sessions[0].key);
  const newObjects = [];
  const put = async length => {
    const bytes = novel(length), ref = {sha256: await digest(bytes), length: String(length)};
    await writer.put(ref, (async function* () {yield bytes;})());
    newObjects.push(ref); return ref;
  };
  try {
    // 2,048 genuinely novel 4 MiB objects add exactly 8 GiB; the final
    // 857,593-byte object lands on the new 16 GiB bound without approximation.
    for (let at = 0; at < 2048; at++) {
      if (at % 128 === 0) {
        await capacity('before-batch-' + at, Math.min(128 * 4 * mib,
          config.maxBytes - (await store.statistics()).payloadBytes));
      }
      await put(4 * mib);
      if (at === 0) need((await store.statistics()).payloadBytes > 8 * gib,
        'real append did not cross old 8 GiB limit');
      if ((at + 1) % 128 === 0) progress('novel physical bytes', `${at + 1}/2048`);
    }
    const remainder = config.maxBytes - config.prefixBytes - 2048 * 4 * mib;
    need(remainder === 857593, 'exact physical boundary arithmetic');
    const finalRef = await put(remainder);
    const atLimit = await store.statistics();
    need(atLimit.payloadBytes === config.maxBytes && atLimit.objects === 2816 + newObjects.length,
      'production store did not reach exact 16 GiB');
    const first = new Uint8Array(await (async () => {
      const parts = []; for await (const chunk of store.stream(newObjects[0])) parts.push(chunk);
      return new Blob(parts).arrayBuffer();
    })());
    need(await digest(first) === newObjects[0].sha256, 'new production object unreadable');
    const tail = new Uint8Array(await (async () => {
      const parts = []; for await (const chunk of store.stream(finalRef)) parts.push(chunk);
      return new Blob(parts).arrayBuffer();
    })());
    need(await digest(tail) === finalRef.sha256, 'boundary object unreadable');
    const before = await store.openSession(source.stores.sessions[0].key);
    let refused;
    try {await put(1); throw Error('17,179,869,185th physical byte admitted');}
    catch (error) {need(error.code === 'RetentionLimit', 'wrong one-byte refusal: ' + error); refused = error.code;}
    const after = await store.statistics();
    const published = await store.openSession(source.stores.sessions[0].key);
    need(JSON.stringify(after) === JSON.stringify(atLimit), 'rejected part changed durable statistics');
    need(published.revision === before.revision
      && await digest(published.manifest) === await digest(before.manifest),
    'rejected part changed published session');
    progress('exact new limit and atomic one-byte refusal');
    const browserAtLimit = await navigator.storage.estimate();
    need(browserAtLimit.usage >= config.maxBytes,
      'Chrome did not charge full physical payload to origin quota');
    const hostAtLimit = await (await fetch('/__host_free__.json')).json();
    await writer.release();
    const collected = await store.collectGarbage();
    need(collected.collected && collected.removedObjects === newObjects.length,
      'unpublished objects not collected');
    const afterCleanup = await store.statistics();
    need(afterCleanup.payloadBytes === config.survivorBytes
      && afterCleanup.chunks === config.survivorChunkCount
      && afterCleanup.objects === seeded.objects,
    'cleanup did not retain the exact original reachable graph');
    const survivor = await store.openSession(source.stores.sessions[0].key);
    need(survivor?.revision === '637'
      && await digest(survivor.manifest) === config.manifestSha256,
    'cleanup damaged original saved session');
    progress('original graph survived collection');
    return {seeded,atLimit,after,afterCleanup,collected,refused,capacityChecks,
      originalManifestSha256:config.manifestSha256,
      firstNewObject:newObjects[0],finalRef,novelObjectCount:newObjects.length,
      browserAtLimit, hostAtLimit,
      browserAfter: await navigator.storage.estimate()};
  } finally {await writer.release(); await store.close();}
}
