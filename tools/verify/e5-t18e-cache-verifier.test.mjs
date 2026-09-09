import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

// The override is only for a verifier-owned disposable mutation copy.
const subject = process.env.E5_T18E_CACHE_SUBJECT
  ? pathToFileURL(process.env.E5_T18E_CACHE_SUBJECT)
  : new URL("./e5-t18e-cache.mjs", import.meta.url);
const { assertWorkerCache } = await import(subject);
const name = `http://127.0.0.1/e5t18b-desktop/chunks/${"a".repeat(64)}.bin`;
const network = { name, transferSize: 131372, encodedBodySize: 131072, decodedBodySize: 131072 };
const cached = { ...network, transferSize: 0 };

// Counters are specified independently; do not generate goldens with the subject.
test("verifier: completed-fetch coverage cannot pass on an empty or truncated observer", () => {
  const empty = { workers: [], chunkRequests: 0, cachedChunkRequests: 0, networkChunkRequests: 0, unknownChunkRequests: 0 };
  assert.throws(() => assertWorkerCache(empty, { disabled: true, minimumRequests: 2 }), /missing completed/);
  const partial = { workers: [{ url: "dedicated-worker", entries: [network] }],
    chunkRequests: 1, cachedChunkRequests: 0, networkChunkRequests: 1, unknownChunkRequests: 0 };
  assert.throws(() => assertWorkerCache(partial, { disabled: true, minimumRequests: 2 }), /missing completed/);
});

test("verifier: real-worker-shaped reuse is rejected cold and admitted warm", () => {
  const record = { workers: [{ url: "dedicated-worker", entries: [network, cached] }],
    chunkRequests: 2, cachedChunkRequests: 1, networkChunkRequests: 1, unknownChunkRequests: 0 };
  assert.throws(() => assertWorkerCache(record, { disabled: true, minimumRequests: 2 }), /cold worker reused HTTP cache/);
  assertWorkerCache(record, { disabled: false, warmReload: true, minimumRequests: 2 });
  assert.throws(() => assertWorkerCache({ ...record, cachedChunkRequests: 0, networkChunkRequests: 2 },
    { disabled: true, minimumRequests: 2 }), { code: "ERR_ASSERTION" });
});
