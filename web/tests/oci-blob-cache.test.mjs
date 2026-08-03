// E3.5-T04f — deterministic node unit tests for the content-addressed OCI layer cache core.
// Run: node --test web/tests/oci-blob-cache.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { DigestMismatch, createLayerCache, sha256HexOf } from "../oci-blob-cache.js";

const sha256hex = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bytesOf = (s) => new TextEncoder().encode(s);

// A fresh in-memory KV pair + a deterministic monotonic clock.
function makeCache(opts = {}) {
  const blobs = kv();
  const meta = kv();
  let t = 0;
  const cache = createLayerCache({ blobs, meta, sha256hex, now: () => ++t, ...opts });
  return { cache, blobs, meta };
}
function kv() {
  const m = new Map();
  return {
    async get(k) { return m.get(k); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async keys() { return [...m.keys()]; },
    _map: m,
  };
}

test("sha256HexOf parses only well-formed sha256 digests", () => {
  assert.equal(sha256HexOf(`sha256:${"a".repeat(64)}`), "a".repeat(64));
  assert.equal(sha256HexOf("sha256:xyz"), null);
  assert.equal(sha256HexOf("md5:abc"), null);
  assert.equal(sha256HexOf(123), null);
});

test("put stores a blob and get returns it (verified round-trip)", async () => {
  const { cache } = makeCache();
  const b = bytesOf("layer-bytes");
  const d = digestOf(b);
  assert.deepEqual(await cache.put(d, b), { stored: true });
  const got = await cache.get(d);
  assert.deepEqual([...got], [...b]);
  assert.equal(cache.stats().hits, 1);
});

test("put rejects bytes that do not hash to the claimed digest", async () => {
  const { cache, blobs } = makeCache();
  const wrongDigest = digestOf(bytesOf("something else"));
  await assert.rejects(() => cache.put(wrongDigest, bytesOf("actual")), DigestMismatch);
  assert.equal((await blobs.keys()).length, 0, "nothing stored under a mismatched key");
});

test("a second put of the same digest is a dedup no-op", async () => {
  const { cache } = makeCache();
  const b = bytesOf("shared base layer");
  const d = digestOf(b);
  await cache.put(d, b);
  assert.deepEqual(await cache.put(d, b), { deduped: true });
  const s = await cache.size();
  assert.equal(s.count, 1, "stored once despite two puts");
  assert.equal(cache.stats().stored, 1);
  assert.equal(cache.stats().deduped, 1);
});

test("two images sharing a base layer store the shared layer ONCE (dedupe)", async () => {
  const { cache } = makeCache();
  const base = bytesOf("BASE");
  const a = bytesOf("APP-A");
  const b = bytesOf("APP-B");
  // image A = [base, a]; image B = [base, b]
  for (const x of [base, a]) await cache.put(digestOf(x), x);
  for (const x of [base, b]) await cache.put(digestOf(x), x);
  const s = await cache.size();
  assert.equal(s.count, 3, "base + a + b — base stored once");
});

test("VERIFIED-ON-READ: a tampered stored blob is evicted and reported as a miss", async () => {
  const { cache, blobs } = makeCache();
  const b = bytesOf("trusted layer");
  const d = digestOf(b);
  await cache.put(d, b);
  // Tamper directly in the backing store: wrong bytes under a correct key.
  await blobs.put(d, bytesOf("EVIL PAYLOAD"));
  assert.equal(await cache.get(d), null, "tampered bytes are never returned");
  assert.equal(cache.stats().tamperEvictions, 1);
  assert.equal(await cache.has(d), false, "the bad entry is evicted, forcing a refetch");
});

test("meta without a blob is treated as a miss and cleaned up", async () => {
  const { cache, blobs, meta } = makeCache();
  const b = bytesOf("x");
  const d = digestOf(b);
  await cache.put(d, b);
  await blobs.delete(d); // blob gone, meta stays
  assert.equal(await cache.get(d), null);
  assert.equal((await meta.keys()).length, 0, "orphan meta dropped");
});

test("LRU eviction removes only the oldest UNPINNED blobs under the byte budget", async () => {
  // Each blob is 4 bytes; budget = 8 → at most 2 unpinned survive.
  const { cache } = makeCache({ byteBudget: 8 });
  const mk = (s) => { const x = bytesOf(s); return { x, d: digestOf(x) }; };
  const b1 = mk("aaaa"), b2 = mk("bbbb"), b3 = mk("cccc");
  await cache.put(b1.d, b1.x); // t=1
  await cache.put(b2.d, b2.x); // t=2
  await cache.get(b1.d);       // touch b1 → newer than b2
  await cache.put(b3.d, b3.x); // t triggers eviction: unpinned bytes 12 > 8 → evict LRU (b2)
  assert.equal(await cache.has(b2.d), false, "b2 (least recently used) evicted");
  assert.equal(await cache.has(b1.d), true, "b1 (recently touched) survives");
  assert.equal(await cache.has(b3.d), true, "b3 (just added) survives");
});

test("pinned blobs are never evicted even over budget", async () => {
  const { cache } = makeCache({ byteBudget: 4 });
  const mk = (s) => { const x = bytesOf(s); return { x, d: digestOf(x) }; };
  const p = mk("pppp"), q = mk("qqqq"), r = mk("rrrr");
  await cache.put(p.d, p.x);
  await cache.pin(p.d);
  await cache.put(q.d, q.x);
  await cache.put(r.d, r.x);
  assert.equal(await cache.has(p.d), true, "pinned survives");
  // Only the pinned one remains runnable; unpinned q/r evicted down to budget (which pinned exceeds).
  const s = await cache.size();
  assert.equal(s.pinnedBytes, 4);
});

test("stats surface hits/misses/dedupe/evictions", async () => {
  const { cache } = makeCache();
  const b = bytesOf("m");
  const d = digestOf(b);
  await cache.get(d);        // miss (absent)
  await cache.put(d, b);
  await cache.get(d);        // hit
  const s = cache.stats();
  assert.equal(s.misses, 1);
  assert.equal(s.hits, 1);
  assert.equal(s.stored, 1);
});
