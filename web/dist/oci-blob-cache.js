// E3.5-T04f: content-addressed OCI layer cache — the deterministic core, pure and storage-agnostic
// (a browser leaf backs it with IndexedDB; unit tests back it with in-memory maps). OCI blobs are
// immutable and content-addressed (sha256 digest = key), which is the EASY persistence case: no
// generations, no write-back races — just put-once / get-forever, deduped across images by digest,
// plus VERIFIED-ON-READ (re-hash on load; a corrupted stored blob is evicted + reported as a miss so
// the caller refetches, never trusted/unpacked). LRU eviction removes only UNPINNED blobs under a
// byte budget; a pinned blob (an image the user actually ran) survives eviction and stays runnable.
//
// The `blobs`/`meta` stores are injected async key-value maps so this file has zero platform coupling:
//   blobs: { get(k)->Uint8Array|undefined, put(k,bytes), delete(k), keys()->Promise<string[]> }
//   meta:  { get(k)->object|undefined,     put(k,obj),    delete(k), keys()->Promise<string[]> }
//   sha256hex(bytes) -> Promise<hex string>   (crypto.subtle in the browser; node:crypto in tests)
//   now() -> number                            (monotonic tick for LRU; injectable for determinism)

export class DigestMismatch extends Error {
  constructor(expected, got) {
    super(`digest mismatch: expected ${expected}, got sha256:${got}`);
    this.name = "DigestMismatch";
    this.expected = expected;
    this.got = got;
  }
}

/** Parse "sha256:<hex>" → lowercase hex, or null if not a well-formed sha256 digest. */
export function sha256HexOf(digest) {
  if (typeof digest !== "string") return null;
  const m = /^sha256:([0-9a-f]{64})$/.exec(digest.toLowerCase());
  return m ? m[1] : null;
}

export function createLayerCache({ blobs, meta, sha256hex, byteBudget = Infinity, now = defaultNow } = {}) {
  if (!blobs || !meta || typeof sha256hex !== "function") {
    throw new TypeError("createLayerCache requires { blobs, meta, sha256hex }");
  }
  const stats = { hits: 0, misses: 0, stored: 0, deduped: 0, evictions: 0, tamperEvictions: 0 };

  async function has(digest) {
    return (await meta.get(digest)) !== undefined;
  }

  // Store bytes under their content digest. Rejects bytes that do not hash to `digest` (never stores
  // wrong-bytes-under-a-key). A second put of an already-present digest is a dedup no-op (just bumps
  // recency) — pulling an image whose layers are already cached transfers/stores nothing new.
  async function put(digest, bytes) {
    const wantHex = sha256HexOf(digest);
    if (!wantHex) throw new TypeError(`not a sha256 digest: ${digest}`);
    if (await has(digest)) {
      await touch(digest);
      stats.deduped++;
      return { deduped: true };
    }
    const gotHex = await sha256hex(bytes);
    if (gotHex !== wantHex) throw new DigestMismatch(digest, gotHex);
    await blobs.put(digest, bytes);
    await meta.put(digest, { size: bytes.length, lastAccess: now(), pinned: false });
    stats.stored++;
    await evictToBudget();
    return { stored: true };
  }

  // Read + VERIFY. A missing entry, a meta/blob inconsistency, or bytes that no longer hash to the
  // digest (tamper) all return null after evicting the bad entry — the caller refetches. Never hands
  // back unverified bytes.
  async function get(digest) {
    const m = await meta.get(digest);
    if (m === undefined) {
      stats.misses++;
      return null;
    }
    const bytes = await blobs.get(digest);
    if (bytes === undefined) {
      await del(digest); // meta without blob — inconsistent, drop it
      stats.misses++;
      return null;
    }
    const wantHex = sha256HexOf(digest);
    const gotHex = await sha256hex(bytes);
    if (gotHex !== wantHex) {
      await del(digest);
      stats.tamperEvictions++;
      stats.misses++;
      return null;
    }
    await touch(digest);
    stats.hits++;
    return bytes;
  }

  async function pin(digest) {
    await setPinned(digest, true);
  }
  async function unpin(digest) {
    await setPinned(digest, false);
  }

  async function del(digest) {
    await blobs.delete(digest);
    await meta.delete(digest);
  }

  // Remove least-recently-used UNPINNED blobs until the unpinned total is within budget. Pinned blobs
  // are never evicted (a ran image stays offline-runnable). Returns the digests evicted.
  async function evictToBudget() {
    if (!(byteBudget < Infinity)) return [];
    const records = await allRecords();
    let unpinnedBytes = records.reduce((n, r) => n + (r.pinned ? 0 : r.size), 0);
    const evicted = [];
    // LRU order: oldest lastAccess first; pinned excluded.
    const victims = records
      .filter((r) => !r.pinned)
      .sort((a, b) => a.lastAccess - b.lastAccess || (a.digest < b.digest ? -1 : 1));
    for (const v of victims) {
      if (unpinnedBytes <= byteBudget) break;
      await del(v.digest);
      unpinnedBytes -= v.size;
      evicted.push(v.digest);
      stats.evictions++;
    }
    return evicted;
  }

  async function size() {
    const records = await allRecords();
    return {
      count: records.length,
      bytes: records.reduce((n, r) => n + r.size, 0),
      pinnedBytes: records.reduce((n, r) => n + (r.pinned ? r.size : 0), 0),
    };
  }

  function getStats() {
    return { ...stats };
  }

  // --- internals ---
  async function touch(digest) {
    const m = await meta.get(digest);
    if (m !== undefined) await meta.put(digest, { ...m, lastAccess: now() });
  }
  async function setPinned(digest, pinned) {
    const m = await meta.get(digest);
    if (m !== undefined) await meta.put(digest, { ...m, pinned });
  }
  async function allRecords() {
    const keys = await meta.keys();
    const out = [];
    for (const digest of keys) {
      const m = await meta.get(digest);
      if (m !== undefined) out.push({ digest, ...m });
    }
    return out;
  }

  return { has, put, get, pin, unpin, delete: del, evictToBudget, size, stats: getStats };
}

let _tick = 0;
function defaultNow() {
  // Monotonic counter (not wall-clock) so LRU ordering is stable and Date-free.
  return ++_tick;
}
