/** Private-owner LRU with exact keys. Hashes select buckets, never identities. */
export function hashKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function createKeyCache({ entries, bytes, release = () => {} }) {
  if (![entries, bytes].every(n => Number.isSafeInteger(n) && n >= 0) || typeof release !== "function")
    throw new TypeError("Invalid bounded cache configuration.");
  const buckets = new Map(), lru = new Map();
  let residentBytes = 0;
  const counts = { requests: 0, hits: 0, misses: 0, comparisons: 0, collisions: 0,
    insertions: 0, evictions: 0, removals: 0, bypasses: 0 };
  const find = (owner, key, measured = false) => {
    for (const entry of buckets.get(hashKey(key)) ?? []) {
      if (measured) counts.comparisons++;
      if (entry.owner === owner && entry.key === key) return entry;
      if (measured) counts.collisions++;
    }
    return null;
  };
  const drop = (entry, evicted) => {
    const bucket = buckets.get(entry.hash), at = bucket.indexOf(entry);
    bucket.splice(at, 1);
    if (bucket.length === 0) buckets.delete(entry.hash);
    lru.delete(entry); residentBytes -= entry.bytes;
    counts[evicted ? "evictions" : "removals"]++;
    release(entry.value, entry.owner);
  };
  const evict = () => {
    const entry = lru.keys().next().value;
    if (!entry) return false;
    drop(entry, true); return true;
  };
  return Object.freeze({
    get(owner, key) {
      counts.requests++;
      const entry = find(owner, key, true);
      if (!entry) { counts.misses++; return null; }
      counts.hits++; lru.delete(entry); lru.set(entry, true); return entry.value;
    },
    put(owner, key, value, byteLength) {
      if (typeof key !== "string" || !Number.isSafeInteger(byteLength) || byteLength < key.length * 2 + 256)
        throw new TypeError("Cache charge must include the owned UTF16 key and entry overhead.");
      if (entries === 0 || byteLength > bytes) { counts.bypasses++; return false; }
      const previous = find(owner, key);
      if (previous) drop(previous, false);
      while (lru.size >= entries || residentBytes > bytes - byteLength) evict();
      const hash = hashKey(key), entry = { owner, key, value, bytes: byteLength, hash };
      const bucket = buckets.get(hash) ?? [];
      bucket.push(entry); buckets.set(hash, bucket); lru.set(entry, true);
      residentBytes += byteLength; counts.insertions++; return true;
    },
    remove(owner, key) { const entry = find(owner, key); if (!entry) return false; drop(entry, false); return true; },
    removeOwner(owner) { for (const entry of [...lru.keys()]) if (entry.owner === owner) drop(entry, false); },
    clear() { for (const entry of [...lru.keys()]) drop(entry, false); },
    evict,
    inspect() { return Object.freeze({ ...counts, entries: lru.size, bytes: residentBytes,
      limits: Object.freeze({ entries, bytes }) }); },
  });
}
