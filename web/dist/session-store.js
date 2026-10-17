// E9-T03: immutable chunk streaming + a last, strict IndexedDB publication transaction.
// The existing resume-snapshot database and the live disk overlay are independent.
import init, {SessionSha256, sessionValidateManifest, sessionManifestReferences,
  sessionEventReferences, sessionCheckAppend} from './session-pkg/wasm_vm_session.js';

export const SESSION_DATABASE = 'wasm-vm-sessions-v1';
export const SESSION_CHUNK_BYTES = 1024 * 1024;
const MAX_SOURCE_CHUNK = 4 * 1024 * 1024;
const MAX_BYTES = 4 * 1024 * 1024 * 1024, MAX_SESSIONS = 256, MAX_U64 = (1n << 64n) - 1n;
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
  catch (error) { fail('Manifest', error.message); }
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
  #db; #writers = new Set(); #closed = false;
  constructor(db) { need(db instanceof IDBDatabase, 'Database'); this.#db = db; }
  static async open(name = SESSION_DATABASE) {
    need(typeof name === 'string' && /^wasm-vm-sessions-v1(?:-[a-z0-9-]{1,64})?$/.test(name), 'Namespace');
    need(globalThis.indexedDB, 'Unavailable', 'IndexedDB');
    await init();
    const db = await new Promise((resolve, reject) => {
      let failed = false;
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => { for (const store of ['chunks', 'objects', 'sessions']) request.result.createObjectStore(store); };
      request.onerror = () => { failed = true; reject(wrap(request.error)); };
      request.onblocked = () => { failed = true; reject(new SessionStoreError('Blocked')); };
      request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
    });
    const store = new SessionStore(db);
    db.onversionchange = () => { store.#closed = true; for (const writer of store.#writers) void writer.release(); db.close(); };
    return store;
  }
  #active() { need(!this.#closed, 'Closed'); }
  async close() {
    this.#closed = true;
    await Promise.all([...this.#writers].map(writer => writer.release()));
    this.#db.close();
  }
  async writer(id) {
    this.#active();
    need(typeof id === 'string' && idPattern.test(id), 'SessionId');
    need(globalThis.navigator?.locks, 'OwnershipUnavailable');
    return new Promise((resolve, reject) => {
      const finished = navigator.locks.request(`wasm-vm-session-${this.#db.name}-${id}`, {ifAvailable: true}, lock => {
        if (!lock) { reject(new SessionStoreError('WriterBusy')); return; }
        if (this.#closed) { reject(new SessionStoreError('Closed')); return; }
        let release;
        const held = new Promise(done => { release = done; });
        const writer = createWriter(id, () => {
          this.#writers.delete(writer); release();
          // Resolution of the holding callback precedes the browser's lock-release ack.
          // release() must await that ack so an immediate reacquisition cannot see Busy.
          return finished;
        }, {
          part: bytes => this.#putPart(bytes, id), object: object => this.#putObject(object, id),
          publish: (bytes, active) => this.#publish(id, active, bytes),
        });
        this.#writers.add(writer); resolve(writer);
        return held;
      });
      finished.catch(error => reject(wrap(error)));
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
  async *stream(expected) {
    const ref = reference(expected), object = await this.#object(ref), hash = new SessionSha256();
    try {
      for (const part of object.parts) {
        this.#active();
        const stored = await read(this.#db, 'chunks', part.sha256);
        // Blob metadata is checked BEFORE allocating bytes, even for corrupted durable values.
        need(stored instanceof Blob && stored.size === Number(part.length) && stored.size <= SESSION_CHUNK_BYTES, 'Corrupt', part.sha256);
        const bytes = new Uint8Array(await stored.arrayBuffer());
        need(await sha256(bytes) === part.sha256, 'Corrupt', part.sha256);
        hash.update(bytes);
        yield bytes;
      }
      need(hash.finish() === ref.sha256, 'Corrupt', ref.sha256);
    } finally { hash.free(); }
  }
  async #small(expected) {
    need(Number(expected.length) <= MAX_SOURCE_CHUNK, 'Bound', 'event chunk');
    const bytes = new Uint8Array(Number(expected.length)); let at = 0;
    for await (const part of this.stream(expected)) { bytes.set(part, at); at += part.length; }
    return bytes;
  }
  async #references(parsedManifest) {
    const refs = parsed(() => sessionManifestReferences(parsedManifest.bytes)), all = new Map();
    const add = value => {
      const ref = reference(value), previous = all.get(ref.sha256);
      need(!previous || previous.length === ref.length, 'Corrupt', 'conflicting object lengths');
      all.set(ref.sha256, ref);
    };
    for (const ref of refs.blobs) add(ref);
    for (const hash of refs.roots) add(await this.#root(hash));
    for (const event of parsedManifest.value.events) {
      const bytes = await this.#small(event.content);
      for (const ref of parsed(() => sessionEventReferences(parsedManifest.bytes, bytes))) add(ref);
    }
    let total = parsedManifest.bytes.length;
    const verified = [];
    for (const ref of all.values()) {
      total += Number(ref.length); need(total <= MAX_BYTES, 'Bound', 'session bytes');
      for await (const _ of this.stream(ref)) { /* exhaust all hashes before publication/open */ }
      verified.push(await this.#object(ref));
    }
    return verified;
  }
  async openSession(id) {
    this.#active(); need(typeof id === 'string' && idPattern.test(id), 'SessionId');
    const row = await read(this.#db, 'sessions', id);
    if (!row) return null;
    need(row.id === id && typeof row.revision === 'string' && /^[1-9][0-9]{0,19}$/.test(row.revision)
      && BigInt(row.revision) <= MAX_U64, 'Corrupt', 'commit cursor');
    const decoded = manifest(row.manifest);
    need(decoded.value.id === id, 'Corrupt', 'manifest ID');
    await this.#references(decoded);
    return {id, revision: row.revision, manifest: decoded.bytes};
  }
  async list() {
    this.#active();
    const keys = await transaction(this.#db, ['sessions'], 'readonly', (tx, done) => {
      const request = tx.objectStore('sessions').getAllKeys(undefined, MAX_SESSIONS + 1);
      request.onsuccess = () => done(request.result);
    });
    need(keys.length <= MAX_SESSIONS, 'Bound', 'session count');
    const sessions = [], unavailable = [];
    for (const id of keys) {
      try {
        const opened = await this.openSession(id);
        if (!opened) continue;
        const value = JSON.parse(decoder.decode(opened.manifest));
        sessions.push({id, revision: opened.revision, begin: value.begin, end: value.end,
          mode: value.policy.mode, profile: value.policy.profile, checkpoints: value.checkpoints.length});
      } catch (error) { unavailable.push({id, code: wrap(error).code}); }
    }
    return {sessions, unavailable};
  }
  async #putPart(bytes, id) {
    const ref = {sha256: await sha256(bytes), length: String(bytes.length)};
    const added = await transaction(this.#db, ['chunks'], 'readwrite', (tx, done, abort) => {
      const store = tx.objectStore('chunks'), request = store.getKey(ref.sha256);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) { store.add(new Blob([bytes]), ref.sha256); done(true); }
          else done(false);
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
  async #publish(id, active, bytes) {
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
    const objects = await this.#references(decoded);
    active();
    probe('before-commit', id);
    await transaction(this.#db, ['sessions', 'objects', 'chunks'], 'readwrite', (tx, done, abort) => {
      let pending = 1 + objects.length;
      const checked = () => {
        if (--pending !== 0) return;
        try {
          active();
          tx.objectStore('sessions').put({id, revision: String(revision), manifest: decoded.bytes}, id);
          done({id, revision: String(revision), position: decoded.value.end});
        } catch (error) { abort(error); }
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
    async publish(bytes) { return run(() => storage.publish(bytes, active)); },
    release() {
      if (!releasing) { closed = true; releasing = Promise.allSettled([...pending]).then(unlock); }
      return releasing;
    },
  });
}
