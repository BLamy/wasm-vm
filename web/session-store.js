// E9-T03: immutable chunk streaming + a last, strict IndexedDB publication transaction.
// The existing resume-snapshot database and the live disk overlay are independent.
import init, {SessionSha256, sessionValidateManifest, sessionManifestReferences,
  sessionEventReferences, sessionCheckAppend, sessionValidateDiskRoot,
  sessionDiskRootReferences} from './session-pkg/wasm_vm_session.js';
import {decodeKeyframeDescriptor, isKeyframeDescriptorPrefix,
  KEYFRAME_MAX_DESCRIPTOR_BYTES} from './session-keyframes.js';
import {validateSessionWitnesses} from './session-witnesses.js';
import {witnessCommitment} from './session-witness-pages.js';
import {inventoryWitnessGraph} from './session-witness-graph.js';

export const SESSION_DATABASE = 'wasm-vm-sessions-v1';
export const SESSION_CHUNK_BYTES = 1024 * 1024;
export const SESSION_DATABASE_VERSION = 2;
export const DEFAULT_SESSION_RETENTION = Object.freeze({maxBytes: 2 * 1024 ** 3, maxCheckpoints: 4096});
const MAX_SOURCE_CHUNK = 4 * 1024 * 1024;
const MAX_BYTES = 4 * 1024 * 1024 * 1024, MAX_SESSIONS = 256, MAX_U64 = (1n << 64n) - 1n;
const MAX_GC_OBJECTS = 262144, MAX_GC_CHUNKS = 1048576, MAX_DISK_ROOT_BYTES = 12 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', {fatal: true});
const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((value, index) => value === b[index]);
const hashPattern = /^[0-9a-f]{64}$/;
const idPattern = /^[A-Za-z0-9_.:/-]{1,64}$/;

export class SessionStoreError extends Error {
  constructor(code, detail = '') { super(`${code}${detail ? ': ' + detail : ''}`); this.name = 'SessionStoreError'; this.code = code; }
}
const fail = (code, detail) => { throw new SessionStoreError(code, detail); };
const need = (condition, code, detail) => { if (!condition) fail(code, detail); };
const wrap = error => error instanceof SessionStoreError ? error : new SessionStoreError(error?.name === 'QuotaExceededError' ? 'Quota' : 'Storage', String(error?.message ?? error));
function retention(value) {
  need(value && Object.keys(value).sort().join(',') === 'maxBytes,maxCheckpoints'
    && Number.isSafeInteger(value.maxBytes) && value.maxBytes >= SESSION_CHUNK_BYTES && value.maxBytes <= 64 * 1024 ** 3
    && Number.isSafeInteger(value.maxCheckpoints) && value.maxCheckpoints >= 1 && value.maxCheckpoints <= 4096, 'Retention');
  return {maxBytes: value.maxBytes, maxCheckpoints: value.maxCheckpoints};
}
function payloadBytes(value) { need(Number.isSafeInteger(value) && value >= 0, 'Corrupt', 'payload usage'); return value; }

// Writers hold a shared maintenance lease for their entire staging/publication lifetime.
// Cleanup never queues behind them: ifAvailable makes a busy origin an explicit retry state.
function holdLock(name, mode, active, busy) {
  need(globalThis.navigator?.locks, 'OwnershipUnavailable');
  return new Promise((resolve, reject) => {
    let unlock;
    const held = new Promise(done => { unlock = done; });
    const finished = navigator.locks.request(name, {mode, ifAvailable: true}, lock => {
      if (!lock) { reject(new SessionStoreError(busy)); return; }
      try { active(); } catch (error) { reject(error); return; }
      resolve(Object.freeze({release: () => { unlock(); return finished; }}));
      return held;
    });
    finished.catch(error => reject(wrap(error)));
  });
}
function reference(value) {
  need(value && Object.keys(value).sort().join(',') === 'length,sha256'
    && typeof value.sha256 === 'string' && hashPattern.test(value.sha256)
    && typeof value.length === 'string' && /^[1-9][0-9]{0,9}$/.test(value.length)
    && Number(value.length) <= MAX_BYTES, 'Reference');
  return {sha256: value.sha256, length: value.length};
}
function manifest(bytes) {
  need(bytes instanceof Uint8Array && bytes.byteLength <= 1024 * 1024, 'Manifest');
  try { const canonical = sessionValidateManifest(bytes); return {bytes: canonical, value: JSON.parse(decoder.decode(canonical))}; }
  catch (error) {
    const failure = new SessionStoreError('Manifest', error.message), hash = new SessionSha256();
    try {hash.update(bytes); failure.reference = {sha256: hash.finish(), length: String(bytes.length)};}
    finally {hash.free();}
    throw failure;
  }
}
function parsed(call) { try { return JSON.parse(decoder.decode(call())); } catch (error) { fail('Manifest', error.message); } }
function probe(phase, id, hash = null) {
  // A synchronous observer can pause the actual JS execution in DevTools for crash proofs.
  // It cannot influence data or swallow a storage failure; absent in ordinary operation.
  try { globalThis.__e9SessionStoreProbe?.({phase, id, hash}); } catch { /* observer only */ }
}
async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

function transaction(db, names, mode, enqueue) {
  return new Promise((resolve, reject) => {
    let tx, result, failure;
    try {
      tx = mode === 'readwrite' ? db.transaction(names, mode, {durability: 'strict'}) : db.transaction(names, mode);
      if (mode === 'readwrite' && tx.durability !== 'strict') { tx.abort(); fail('DurabilityUnavailable'); }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? wrap(tx.error));
      tx.onerror = () => {}; // onabort is the single settlement point.
      const abort = error => { failure = wrap(error); try { tx.abort(); } catch { reject(failure); } };
      enqueue(tx, value => { result = value; }, abort);
    } catch (error) { try { tx?.abort(); } catch { /* already settled */ } reject(wrap(error)); }
  });
}
function read(db, store, key) {
  return transaction(db, [store], 'readonly', (tx, done) => {
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => done(request.result);
  });
}
function descriptor(value, expected) {
  const ref = reference(expected);
  need(value && Object.keys(value).sort().join(',') === 'length,parts,sha256,version'
    && value.version === 1 && value.sha256 === ref.sha256 && value.length === ref.length
    && Array.isArray(value.parts) && value.parts.length >= 1 && value.parts.length <= 4096, 'Corrupt', ref.sha256);
  let length = 0;
  for (const [index, part] of value.parts.entries()) {
    reference(part);
    const size = Number(part.length);
    need(size <= SESSION_CHUNK_BYTES && (index === value.parts.length - 1 || size === SESSION_CHUNK_BYTES), 'Corrupt', 'chunk shape');
    length += size;
  }
  need(length === Number(ref.length), 'Corrupt', 'object length');
  return value;
}

export class SessionStore {
  #db; #writers = new Set(); #readers = new Set(); #closed = false;
  constructor(db) { need(db instanceof IDBDatabase, 'Database'); this.#db = db; }
  get databaseName() { return this.#db.name; }
  static async open(name = SESSION_DATABASE) {
    need(typeof name === 'string' && /^wasm-vm-sessions-v1(?:-[a-z0-9-]{1,64})?$/.test(name), 'Namespace');
    need(globalThis.indexedDB, 'Unavailable', 'IndexedDB');
    await init();
    const db = await new Promise((resolve, reject) => {
      let failed = false, upgradeFailure;
      const request = indexedDB.open(name, SESSION_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        try {
          for (const store of ['chunks', 'objects', 'sessions', 'metadata']) {
            if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
          }
          const metadata = request.transaction.objectStore('metadata');
          metadata.put({...DEFAULT_SESSION_RETENTION}, 'limits');
          let usage = 0;
          const cursor = request.transaction.objectStore('chunks').openCursor();
          cursor.onsuccess = () => {
            try {
              if (!cursor.result) { metadata.put(usage, 'payloadBytes'); return; }
              const value = cursor.result.value;
              // Metadata only: migration never allocates the old payloads or changes history.
              usage += value instanceof Blob ? value.size : 0;
              payloadBytes(usage); cursor.result.continue();
            } catch (error) { upgradeFailure = wrap(error); request.transaction.abort(); }
          };
        } catch (error) { upgradeFailure = wrap(error); request.transaction.abort(); }
      };
      request.onerror = () => { failed = true; reject(upgradeFailure ?? wrap(request.error)); };
      request.onblocked = () => { failed = true; reject(new SessionStoreError('Blocked')); };
      request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
    });
    const store = new SessionStore(db);
    db.onversionchange = () => { store.#closed = true; for (const reader of store.#readers) reader.revoke('Closed'); for (const writer of store.#writers) void writer.release(); db.close(); };
    return store;
  }
  #active() { need(!this.#closed, 'Closed'); }
  async close() {
    this.#closed = true;
    const readers = [...this.#readers];
    for (const reader of readers) reader.revoke('Closed');
    await Promise.all([...this.#writers].map(writer => writer.release()).concat(readers.map(reader => reader.done)));
    this.#db.close();
  }
  async writer(id) {
    this.#active();
    need(typeof id === 'string' && idPattern.test(id), 'SessionId');
    const maintenance = await this.#maintenance('shared');
    let owned;
    try {
      owned = await holdLock(`wasm-vm-session-${this.#db.name}-${id}`, 'exclusive', () => this.#active(), 'WriterBusy');
      this.#active();
      const writer = createWriter(id, () => {
        this.#writers.delete(writer);
        return owned.release().finally(() => maintenance.release());
      }, {
        part: bytes => this.#putPart(bytes, id), object: object => this.#putObject(object, id),
        publish: (bytes, active, beforeCommit, authorize) => this.#publish(id, active, bytes, beforeCommit, authorize),
      });
      this.#writers.add(writer); return writer;
    } catch (error) { if (owned) await owned.release(); await maintenance.release(); throw wrap(error); }
  }
  #maintenance(mode) {
    this.#active();
    return holdLock(`wasm-vm-session-maintenance-${this.#db.name}`, mode, () => this.#active(), 'MaintenanceBusy');
  }
  async withReadLease(callback) {
    need(typeof callback === 'function', 'ReadLease');
    const lease = await this.#maintenance('shared');
    try { this.#active(); return await callback(); }
    finally { await lease.release(); }
  }
  // Freeze one durable session as well as its reachable chunks. The callback's
  // authorization is revoked on abort, close, version change or callback exit.
  async withSessionReadLease(id, {signal} = {}, callback) {
    this.#active();
    need(typeof id === 'string' && idPattern.test(id), 'SessionId');
    need(typeof callback === 'function' && (signal === undefined || typeof signal?.aborted === 'boolean'
      && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function'), 'ReadLease');
    let live = true, rejectRevoked, finish, maintenance, owned;
    const revoked = new Promise((resolve, reject) => {rejectRevoked = reject;});
    // Revocation can race lock acquisition before the work/race is installed.
    void revoked.catch(() => {});
    const done = new Promise(resolve => {finish = resolve;});
    const reader = {done, revoke: code => {if (live) {live = false; rejectRevoked(new SessionStoreError(code, 'session read revoked'));}}};
    const active = () => {this.#active(); need(live && !signal?.aborted, 'ReadLeaseRevoked');};
    const abort = () => reader.revoke('Cancelled');
    this.#readers.add(reader);
    try {
      active(); maintenance = await this.#maintenance('shared'); active();
      owned = await holdLock(`wasm-vm-session-${this.#db.name}-${id}`, 'shared', active, 'WriterBusy'); active();
      signal?.addEventListener('abort', abort, {once: true}); active();
      const work = Promise.resolve().then(() => {active(); return callback(active);});
      const result = await Promise.race([work, revoked]); active(); return result;
    } finally {
      live = false;
      try {signal?.removeEventListener('abort', abort);}
      finally {
        try {await owned?.release();}
        finally {
          try {await maintenance?.release();}
          finally {this.#readers.delete(reader); finish();}
        }
      }
    }
  }
  async statistics() {
    this.#active();
    return transaction(this.#db, ['metadata', 'sessions', 'objects', 'chunks'], 'readonly', (tx, done, abort) => {
      const result = {}, fields = [['metadata', 'limits'], ['metadata', 'payloadBytes'], ['sessions', null], ['objects', null], ['chunks', null]];
      let pending = fields.length;
      for (const [table, key] of fields) {
        const request = key ? tx.objectStore(table).get(key) : tx.objectStore(table).count();
        request.onsuccess = () => {
          try {
            result[key ?? table] = request.result;
            if (--pending === 0) done({limits: retention(result.limits), payloadBytes: payloadBytes(result.payloadBytes),
              sessions: result.sessions, objects: result.objects, chunks: result.chunks});
          } catch (error) { abort(error); }
        };
      }
    });
  }
  async setRetention(value) {
    this.#active(); const limits = retention(value);
    return transaction(this.#db, ['metadata'], 'readwrite', (tx, done) => {
      tx.objectStore('metadata').put(limits, 'limits'); done(limits);
    });
  }
  async #object(expected) {
    this.#active();
    return descriptor(await read(this.#db, 'objects', expected.sha256), expected);
  }
  async #root(hash) {
    need(typeof hash === 'string' && hashPattern.test(hash), 'Reference');
    const value = await read(this.#db, 'objects', hash);
    need(value, 'MissingObject', hash);
    descriptor(value, {sha256: hash, length: value.length});
    return {sha256: hash, length: value.length};
  }
  async objectReference(hash) {
    this.#active();
    return this.#root(hash);
  }
  async *stream(expected, {signal} = {}) {
    const ref = reference(expected), active = () => {this.#active(); need(!signal?.aborted, 'Cancelled');};
    active(); const hash = new SessionSha256();
    try {
      const object = await this.#object(ref); active();
      for (const part of object.parts) {
        active(); const stored = await read(this.#db, 'chunks', part.sha256); active();
        // Check Blob metadata before allocation and cancellation at every asynchronous edge.
        need(stored instanceof Blob && stored.size === Number(part.length) && stored.size <= SESSION_CHUNK_BYTES, 'Corrupt', part.sha256);
        const bytes = new Uint8Array(await stored.arrayBuffer()); active();
        const digest = await sha256(bytes); active(); need(digest === part.sha256, 'Corrupt', part.sha256);
        hash.update(bytes); yield bytes; active();
      }
      need(hash.finish() === ref.sha256, 'Corrupt', ref.sha256);
    } catch (error) {
      if (error instanceof SessionStoreError) error.reference ??= ref;
      throw error;
    } finally { hash.free(); }
  }

  async #bytes(expected, limit) {
    need(Number(expected.length) <= limit, 'Bound', 'metadata object');
    const bytes = new Uint8Array(Number(expected.length)); let at = 0;
    for await (const part of this.stream(expected)) { bytes.set(part, at); at += part.length; }
    return bytes;
  }
  #small(expected) { return this.#bytes(expected, MAX_SOURCE_CHUNK); }
  async #objectPrefix(expected) {
    for await (const part of this.stream(expected)) return part.subarray(0,8);
    fail('Corrupt','empty keyframe object');
  }
  async #references(parsedManifest, previous = null, {signal} = {}) {
    const active = () => {this.#active(); need(!signal?.aborted, 'Cancelled');};
    const store = this; let lastReference = null;
    const source = {
      async *stream(ref) {active(); lastReference = ref; for await (const part of store.stream(ref, {signal})) {active(); yield part; active();} active();},
      async objectReference(hash) {active(); lastReference = {sha256: hash}; const ref = await store.objectReference(hash); active(); lastReference = ref; return ref;},
    };
    active();
    if (witnessCommitment(parsedManifest.value)) {
      let graph;
      try {graph = await inventoryWitnessGraph(source, parsedManifest.bytes, {previous, signal}); active();}
      catch (error) {
        if (['Cancelled', 'Closed'].includes(error.code)) throw error;
        const failure = new SessionStoreError('Corrupt', error.message);
        failure.reference = error.reference ?? lastReference; throw failure;
      }
      const objects = [];
      for (const ref of graph.refs) {active(); objects.push(await this.#object(ref)); active();}
      return objects;
    }
    const refs = parsed(() => sessionManifestReferences(parsedManifest.bytes)), all = new Map();
    const add = value => {
      const ref = reference(value), previous = all.get(ref.sha256);
      need(!previous || previous.length === ref.length, 'Corrupt', 'conflicting object lengths');
      all.set(ref.sha256, ref);
    };
    for (const ref of refs.blobs) add(ref);
    for (const hash of refs.roots) add(await this.#root(hash));
    let priorKind = 'none', priorDepth = 0;
    for (const [index,checkpoint] of parsedManifest.value.checkpoints.entries()) {
      const prefix=await this.#objectPrefix(checkpoint.machine);
      if (isKeyframeDescriptorPrefix(prefix)) {
        need(index>0 && (priorKind==='keyframe-full' || priorKind==='delta'), 'Corrupt', 'keyframe base missing');
        let descriptor;
        try {descriptor=decodeKeyframeDescriptor(await this.#bytes(checkpoint.machine,KEYFRAME_MAX_DESCRIPTOR_BYTES));}
        catch(error){fail('Corrupt',error.message);}
        const parent=parsedManifest.value.checkpoints[index-1].machine;
        need(descriptor.depth===priorDepth+1
          && descriptor.parent.sha256===parent.sha256 && descriptor.parent.length===parent.length
          && descriptor.ramBytes===parsedManifest.value.machine.ram_bytes,
        'Corrupt','keyframe ancestor/identity');
        add(descriptor.frame);
        for(const chunk of descriptor.chunks)add(chunk);
        priorKind='delta';priorDepth=descriptor.depth;
      } else if (prefix.length===8 && (['WVKEYB01','WVEXACT1'].includes(decoder.decode(prefix))
        || (decoder.decode(prefix)==='WVGPUB01' && parsedManifest.value.machine.gpu!==null
          && parsedManifest.value.policy.mode==='exact-replay'))) {
        priorKind='keyframe-full';priorDepth=0;
      } else {priorKind='other';priorDepth=0;}
    }
    for (const event of parsedManifest.value.events) {
      const bytes = await this.#small(event.content);
      for (const ref of parsed(() => sessionEventReferences(parsedManifest.bytes, bytes))) add(ref);
    }
    let total = parsedManifest.bytes.length;
    const verified = [];
    for (const ref of all.values()) {
      total += Number(ref.length); need(total <= MAX_BYTES, 'Bound', 'session bytes');
      for await (const _ of source.stream(ref)) { /* exhaust all hashes before publication/open */ }
      verified.push(await this.#object(ref));
    }
    return verified;
  }
  async #session(id) {
    this.#active(); need(typeof id === 'string' && idPattern.test(id), 'SessionId');
    const row = await read(this.#db, 'sessions', id);
    if (!row) return null;
    need(row.id === id && typeof row.revision === 'string' && /^[1-9][0-9]{0,19}$/.test(row.revision)
      && BigInt(row.revision) <= MAX_U64, 'Corrupt', 'commit cursor');
    const decoded = manifest(row.manifest);
    need(decoded.value.id === id, 'Corrupt', 'manifest ID');
    return {row, decoded};
  }
  async openSession(id, {signal} = {}) {
    const active = () => {this.#active(); need(!signal?.aborted, 'Cancelled');};
    active(); const found = await this.#session(id); active();
    if (!found) return null;
    await this.#references(found.decoded, null, {signal}); active();
    return {id, revision: found.row.revision, manifest: found.decoded.bytes};
  }
  async #sessionKeys() {
    this.#active();
    const keys = await transaction(this.#db, ['sessions'], 'readonly', (tx, done) => {
      const request = tx.objectStore('sessions').getAllKeys(undefined, MAX_SESSIONS + 1);
      request.onsuccess = () => done(request.result);
    });
    need(keys.length <= MAX_SESSIONS, 'Bound', 'session count');
    return keys;
  }
  async list() {
    const keys = await this.#sessionKeys();
    const sessions = [], unavailable = [];
    for (const id of keys) {
      try {
        const opened = await this.openSession(id);
        if (!opened) continue;
        const value = JSON.parse(decoder.decode(opened.manifest));
        sessions.push({id, revision: opened.revision, begin: value.begin, end: value.end,
          mode: value.policy.mode, profile: value.policy.profile, checkpoints: value.checkpoints.length,
          ...(witnessCommitment(value) ? {storageOnly: true, pagedWitnesses: {version: 2,
            count: witnessCommitment(value).count, finished: witnessCommitment(value).finished}} : {})});
      } catch (error) { unavailable.push({id, code: wrap(error).code}); }
    }
    return {sessions, unavailable};
  }
  async deleteSession(id) {
    this.#active(); need(typeof id === 'string' && idPattern.test(id), 'SessionId');
    const lease = await this.#maintenance('exclusive');
    try {
      const deleted = await transaction(this.#db, ['sessions'], 'readwrite', (tx, done) => {
        const rows = tx.objectStore('sessions'), request = rows.getKey(id);
        request.onsuccess = () => { if (request.result !== undefined) rows.delete(id); done(request.result !== undefined); };
      });
      // A crash here leaves harmless orphans. No surviving reference was changed; a later
      // cleanup recomputes the complete mark set instead of trusting a half-written journal.
      probe('gc-metadata-deleted', id);
      try { return {deleted, ...await this.#collect()}; }
      catch (error) { const failure = wrap(error); return {deleted, collected: false, error: {code: failure.code, detail: failure.message}}; }
    } finally { await lease.release(); }
  }
  async collectGarbage() {
    const lease = await this.#maintenance('exclusive');
    try { return await this.#collect(); }
    finally { await lease.release(); }
  }
  async #collect() {
    const objects = new Map(), parts = new Map();
    const add = object => {
      const previous = objects.get(object.sha256);
      need(!previous || JSON.stringify(previous) === JSON.stringify(object), 'Corrupt', 'conflicting live objects');
      objects.set(object.sha256, object);
      need(objects.size <= MAX_GC_OBJECTS, 'Bound', 'cleanup object count');
    };
    // Never use list(): it intentionally omits incomplete histories. An unreadable survivor
    // must block reclamation, otherwise its temporarily missing root could erase shared data.
    for (const id of await this.#sessionKeys()) {
      const found = await this.#session(id); need(found, 'Corrupt', 'surviving session disappeared');
      const decoded = found.decoded;
      // GPU keyframes name their complete pair directly in checkpoint.gpu; #references
      // authenticates that blob before this mark pass, while roots cover its historical disk.
      // v1 witnesses are reference-free. Required v2 pages are fully authenticated and
      // marked by #references; unsupported extensions must still stop cleanup.
      try { if (!witnessCommitment(decoded.value)) validateSessionWitnesses(decoded.value); }
      catch (error) { fail('UnsupportedRetention', error.message); }
      for (const object of await this.#references(decoded)) add(object);
      if (witnessCommitment(decoded.value)) continue; // The shared paged graph already includes every disk block.
      const roots = parsed(() => sessionManifestReferences(decoded.bytes)).roots;
      for (const hash of roots) {
        const ref = await this.#root(hash), bytes = await this.#bytes(ref, MAX_DISK_ROOT_BYTES);
        let canonical;
        try { canonical = sessionValidateDiskRoot(bytes); } catch (error) { fail('DiskRoot', error.message); }
        need(JSON.parse(decoder.decode(canonical)).base === decoded.value.machine.base_image, 'Corrupt', 'disk root base');
        for (const block of parsed(() => sessionDiskRootReferences(canonical))) {
          for await (const _ of this.stream(block)) { /* authenticate all complete-map descendants */ }
          add(await this.#object(block));
        }
      }
    }
    for (const object of objects.values()) for (const part of object.parts) {
      const previous = parts.get(part.sha256);
      need(!previous || previous.length === part.length, 'Corrupt', 'conflicting live parts');
      parts.set(part.sha256, part); need(parts.size <= MAX_GC_CHUNKS, 'Bound', 'cleanup chunk count');
    }
    probe('gc-marked', 'gc');
    const result = await transaction(this.#db, ['objects', 'chunks', 'metadata'], 'readwrite', (tx, done, abort) => {
      let pending = 2, seenObjects = 0, seenChunks = 0, usage = 0, reclaimedBytes = 0, removedObjects = 0, removedChunks = 0;
      const finished = () => {
        if (--pending !== 0) return;
        try {
          need(seenObjects === objects.size && seenChunks === parts.size, 'Corrupt', 'live data changed during cleanup');
          tx.objectStore('metadata').put(payloadBytes(usage), 'payloadBytes');
          probe('gc-before-sweep-commit', 'gc');
          done({collected: true, payloadBytes: usage, reclaimedBytes, removedObjects, removedChunks});
        } catch (error) { abort(error); }
      };
      for (const table of ['objects', 'chunks']) {
        const request = tx.objectStore(table).openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (!cursor) { finished(); return; }
            if (table === 'objects') {
              const expected = objects.get(cursor.key);
              if (expected) {
                need(JSON.stringify(cursor.value) === JSON.stringify(expected), 'Corrupt', 'live object changed during cleanup'); seenObjects++;
              } else { cursor.delete(); removedObjects++; }
            } else {
              const expected = parts.get(cursor.key), value = cursor.value;
              if (expected) {
                need(value instanceof Blob && value.size === Number(expected.length), 'Corrupt', 'live chunk changed during cleanup');
                usage = payloadBytes(usage + value.size); seenChunks++;
              } else { cursor.delete(); removedChunks++; reclaimedBytes += value instanceof Blob ? value.size : 0; }
            }
            cursor.continue();
          } catch (error) { abort(error); }
        };
      }
    });
    probe('gc-sweep-durable', 'gc'); return result;
  }
  async #putPart(bytes, id) {
    const ref = {sha256: await sha256(bytes), length: String(bytes.length)};
    const added = await transaction(this.#db, ['chunks', 'metadata'], 'readwrite', (tx, done, abort) => {
      const store = tx.objectStore('chunks'), request = store.getKey(ref.sha256);
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) { done(false); return; }
          const metadata = tx.objectStore('metadata'), limits = metadata.get('limits'), usage = metadata.get('payloadBytes');
          let pending = 2;
          const checked = () => {
            if (--pending !== 0) return;
            try {
              const next = payloadBytes(payloadBytes(usage.result) + bytes.length);
              need(next <= retention(limits.result).maxBytes, 'RetentionLimit', 'saved data byte budget');
              store.add(new Blob([bytes]), ref.sha256); metadata.put(next, 'payloadBytes'); done(true);
            } catch (error) { abort(error); }
          };
          limits.onsuccess = usage.onsuccess = checked;
        } catch (error) { abort(error); }
      };
    });
    if (!added) {
      const stored = await read(this.#db, 'chunks', ref.sha256);
      need(stored instanceof Blob && stored.size === bytes.length && stored.size <= SESSION_CHUNK_BYTES, 'Corrupt', ref.sha256);
      need(sameBytes(new Uint8Array(await stored.arrayBuffer()), bytes), 'Corrupt', ref.sha256);
    }
    probe('chunk-durable', id, ref.sha256);
    return ref;
  }
  async #putObject(object, id) {
    const ref = {sha256: object.sha256, length: object.length};
    descriptor(object, ref);
    const added = await transaction(this.#db, ['objects'], 'readwrite', (tx, done, abort) => {
      const store = tx.objectStore('objects'), request = store.getKey(object.sha256);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) { store.add(object, object.sha256); done(true); }
          else done(false);
        } catch (error) { abort(error); }
      };
    });
    if (!added) {
      const previous = await read(this.#db, 'objects', object.sha256);
      descriptor(previous, ref);
      need(JSON.stringify(previous) === JSON.stringify(object), 'Corrupt', object.sha256);
    }
    probe('object-durable', id, object.sha256);
  }
  async #publish(id, active, bytes, beforeCommit, authorize) {
    const decoded = manifest(bytes);
    need(decoded.value.id === id, 'SessionId');
    const previous = await read(this.#db, 'sessions', id);
    if (previous) {
      need(previous.id === id && typeof previous.revision === 'string'
        && /^[1-9][0-9]{0,19}$/.test(previous.revision) && BigInt(previous.revision) <= MAX_U64, 'Corrupt', 'commit cursor');
      try { sessionCheckAppend(previous.manifest, decoded.bytes); }
      catch (error) { fail('NotAppend', error.message); }
    }
    const revision = previous ? BigInt(previous.revision) + 1n : 1n;
    need(revision <= MAX_U64, 'Overflow');
    const objects = await this.#references(decoded, previous ? manifest(previous.manifest).value : null);
    active();
    probe('before-commit', id);
    // The caller may revalidate a device owner after all asynchronous object checks.
    if (beforeCommit) await beforeCommit();
    active();
    await transaction(this.#db, ['sessions', 'objects', 'chunks', 'metadata'], 'readwrite', (tx, done, abort) => {
      let pending = 2 + objects.length;
      const checked = () => {
        if (--pending !== 0) return;
        try {
          probe('before-final-authorize', id);
          active();
          // Recheck revocable ownership in the same synchronous turn as the final put.
          // beforeCommit may await; this final authorizer must never yield.
          if (authorize) {
            const result = authorize();
            need(!result || typeof result.then !== 'function', 'PublicationGuard', 'final authorizer must be synchronous');
          }
          tx.objectStore('sessions').put({id, revision: String(revision), manifest: decoded.bytes}, id);
          done({id, revision: String(revision), position: decoded.value.end});
        } catch (error) { abort(error); }
      };
      const limits = tx.objectStore('metadata').get('limits');
      limits.onsuccess = () => {
        try { need(decoded.value.checkpoints.length <= retention(limits.result).maxCheckpoints, 'RetentionLimit', 'restore point budget'); checked(); }
        catch (error) { abort(error); }
      };
      const request = tx.objectStore('sessions').get(id);
      request.onsuccess = () => {
        const current = request.result;
        if (previous ? !current || current.revision !== previous.revision || !sameBytes(current.manifest, previous.manifest) : current) { abort(new SessionStoreError('StaleCommit')); return; }
        if (!previous) {
          const count = tx.objectStore('sessions').count(); pending++;
          count.onsuccess = () => { if (count.result >= MAX_SESSIONS) abort(new SessionStoreError('Bound', 'session count')); else checked(); };
        }
        checked();
      };
      for (const object of objects) {
        const request = tx.objectStore('objects').get(object.sha256);
        request.onsuccess = () => {
          if (JSON.stringify(request.result) !== JSON.stringify(object)) { abort(new SessionStoreError('Corrupt', object.sha256)); return; }
          for (const part of object.parts) {
            pending++;
            const request = tx.objectStore('chunks').getKey(part.sha256);
            request.onsuccess = () => { if (request.result !== part.sha256) abort(new SessionStoreError('Corrupt', part.sha256)); else checked(); };
          }
          checked();
        };
      }
    });
    probe('commit-durable', id);
    return {id: id, revision: String(revision), position: decoded.value.end};
  }
}

function createWriter(id, unlock, storage) {
  let closed = false, releasing;
  const pending = new Set();
  const active = () => need(!closed, 'WriterClosed');
  const run = callback => {
    active(); need(pending.size === 0, 'WriterBusy');
    const result = callback(); pending.add(result);
    result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  };
  // The lease is an immutable capability: callers cannot retarget its session ID or invoke
  // publication without ownership. Mutation helpers remain private on SessionStore.
  return Object.freeze({
    id,
    async put(expected, source) {
      return run(async () => {
        const ref = reference(expected), hash = new SessionSha256(), parts = [], buffer = new Uint8Array(SESSION_CHUNK_BYTES);
        let length = 0, used = 0;
        try {
          for await (const bytes of source) {
            active();
            need(bytes instanceof Uint8Array && bytes.length >= 1 && bytes.length <= MAX_SOURCE_CHUNK, 'Bound', 'source chunk');
            const inputLength = bytes.length;
            need(length + inputLength <= Number(ref.length), 'Length');
            let at = 0;
            while (at < inputLength) {
              need(bytes.length === inputLength, 'SourceChanged');
              const count = Math.min(inputLength - at, buffer.length - used);
              buffer.set(bytes.subarray(at, at + count), used);
              // Hash the owned bytes that will be persisted, including across an await when
              // a caller supplied a mutable view. A changed/detached source cannot bind stale data.
              hash.update(buffer.subarray(used, used + count));
              used += count; at += count; length += count;
              if (used === buffer.length) { parts.push(await storage.part(buffer)); used = 0; active(); }
            }
          }
          need(length === Number(ref.length), 'Length'); need(hash.finish() === ref.sha256, 'Digest');
          if (used) parts.push(await storage.part(buffer.subarray(0, used)));
          active(); await storage.object({version: 1, sha256: ref.sha256, length: ref.length, parts});
          return ref;
        } finally { hash.free(); }
      });
    },
    async publish(bytes, beforeCommit = null, authorize = null) {
      need((beforeCommit === null || typeof beforeCommit === 'function')
        && (authorize === null || typeof authorize === 'function'), 'PublicationGuard');
      return run(() => storage.publish(bytes, active, beforeCommit, authorize));
    },
    release() {
      if (!releasing) { closed = true; releasing = Promise.allSettled([...pending]).then(unlock); }
      return releasing;
    },
  });
}
