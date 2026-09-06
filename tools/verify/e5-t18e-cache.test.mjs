import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeWorkerCache, assertWorkerCache } from "./e5-t18e-cache.mjs";
const name = `http://localhost/e5t18b-desktop/chunks/${"a".repeat(64)}.bin`;
const entry = (transferSize, encodedBodySize = 131072) => ({ name, transferSize, encodedBodySize, decodedBodySize: encodedBodySize });
const record = (...entries) => summarizeWorkerCache([{ url: "worker", entries }]);
test("cold worker proof requires network transfers, not page cache flags", () => {
  assertWorkerCache(record(entry(131372), entry(131372)), { disabled: true, minimumRequests: 2 });
  assert.throws(() => assertWorkerCache(record(entry(131372), entry(0)), { disabled: true }), /cold worker reused/);
});
test("warm reload must contain an actual worker cache hit", () => {
  assertWorkerCache(record(entry(0)), { disabled: false, warmReload: true });
  assert.throws(() => assertWorkerCache(record(entry(131372)), { disabled: false, warmReload: true }), /never reused/);
});
test("missing or opaque worker responses cannot count as cache proof", () => {
  assert.throws(() => assertWorkerCache(record(), { disabled: true }), /missing completed/);
  assert.throws(() => assertWorkerCache(record(entry(0, 0)), { disabled: true }), /unobservable/);
});
test("forged summary counters cannot hide a cached response", () => {
  assert.throws(() => assertWorkerCache({ ...record(entry(0)), cachedChunkRequests: 0 }, { disabled: true }));
});
test("only chunk requests count toward completed fetch coverage", () => {
  const r = record({ ...entry(131372), name: "http://localhost/loader.js" }, entry(131372));
  assert.equal(r.chunkRequests, 1);
  assert.throws(() => assertWorkerCache(r, { disabled: true, minimumRequests: 2 }), /missing completed/);
});
