// Preserve the real quiescent IDB rows and immutable bytes for independent interrogation.
import fs from 'node:fs/promises';
import path from 'node:path';
export async function retainSessionStore(page, database, output) {
  await fs.mkdir(output, {recursive: true});
  await page.exposeFunction('__retainSessionStoreFile', async (name, encoded) => {
    if (!/^(storage\.json|chunks\/[0-9a-f]{64}\.bin)$/.test(name)) throw Error('retained store artifact path');
    if (typeof encoded !== 'string' || encoded.length > 64 * 1048576) throw Error('retained artifact transfer bound');
    const bytes = Buffer.from(encoded, 'base64'); if (bytes.toString('base64') !== encoded) throw Error('retained artifact encoding');
    const file = path.join(output, name); await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, bytes);
  });
  return page.evaluate(async database => {
    const db = await new Promise((resolve, reject) => {const request = indexedDB.open(database); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    const saved = {database, stores: {}};
    const retain = async (name, bytes) => {
      let binary = ''; for (let at = 0; at < bytes.length; at += 16384) binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
      await __retainSessionStoreFile(name, btoa(binary));
    };
    try {
      for (const name of ['objects', 'sessions', 'metadata', 'chunks']) {
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(name), table = tx.objectStore(name), keys = table.getAllKeys(), values = table.getAll();
          tx.oncomplete = () => resolve(keys.result.map((key, index) => [key, values.result[index]])); tx.onabort = () => reject(tx.error);
        });
        saved.stores[name] = [];
        for (const [key, value] of rows) {
          if (value instanceof Blob) {
            const bytes = new Uint8Array(await value.arrayBuffer());
            await retain('chunks/' + key + '.bin', bytes); saved.stores[name].push({key, bytes: bytes.length});
          } else {
            if (value?.manifest instanceof Uint8Array) value.manifest = Array.from(value.manifest);
            saved.stores[name].push({key, value});
          }
        }
      }
      await retain('storage.json', new TextEncoder().encode(JSON.stringify(saved, null, 2)));
      return {database, counts: Object.fromEntries(Object.entries(saved.stores).map(([name, rows]) => [name, rows.length]))};
    } finally { db.close(); }
  }, database);
}
