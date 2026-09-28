import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import { fetchVerifiedBootAsset } from "../boot-asset-cache.js";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const text = (value) => new TextEncoder().encode(value);

async function sha256(bytes) {
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function descriptor(bytes, overrides = {}) {
  return {
    url: "https://cdn.example.test/boot/image.gz",
    sha256: await sha256(bytes),
    size: bytes.byteLength,
    role: "bootSnapshot",
    ...overrides,
  };
}

class FakeCache {
  constructor({ quota = false } = {}) {
    this.entries = new Map();
    this.putCount = 0;
    this.deleteCount = 0;
    this.quota = quota;
  }

  async match(key) {
    const response = this.entries.get(String(key));
    return response?.clone();
  }

  async put(key, response) {
    this.putCount += 1;
    if (this.quota) throw new DOMException("quota", "QuotaExceededError");
    this.entries.set(String(key), response.clone());
  }

  async delete(key) {
    this.deleteCount += 1;
    return this.entries.delete(String(key));
  }
}

class FakeCacheStorage {
  constructor(cache = new FakeCache()) {
    this.cache = cache;
    this.names = [];
    this.openCount = 0;
  }

  async open(name) {
    this.openCount += 1;
    this.names.push(name);
    return this.cache;
  }
}

function response(bytes) {
  return new Response(bytes, { status: 200 });
}

function fetchSequence(responses) {
  let calls = 0;
  const callsWithInit = [];
  const fetchImpl = async (url, init) => {
    callsWithInit.push({ url, init });
    const next = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return typeof next === "function" ? next(url, init) : next;
  };
  return { fetchImpl, calls: () => calls, callsWithInit };
}

test("cold then warm boot loads once and reuses verified bytes", async () => {
  const bytes = text("compressed boot bytes");
  const d = await descriptor(bytes);
  const storage = new FakeCacheStorage();
  const network = fetchSequence([response(bytes)]);
  const statuses = [];
  const progress = [];
  const events = [];
  const fetchImpl = async (...args) => {
    events.push(["fetch"]);
    return network.fetchImpl(...args);
  };
  const first = await fetchVerifiedBootAsset(d, {
    fetchImpl,
    cacheStorage: storage,
    baseUrl: "https://app.example.test/index.html",
    onProgress: (loaded, total) => {
      progress.push([loaded, total]);
      events.push(["progress", loaded]);
    },
    onCacheStatus: (status) => {
      statuses.push(status);
      events.push(["status", status.source]);
    },
  });
  const second = await fetchVerifiedBootAsset(d, {
    fetchImpl,
    cacheStorage: storage,
    baseUrl: "https://app.example.test/index.html",
    onProgress: (loaded, total) => {
      events.push(["progress", loaded]);
      assert.equal(total, bytes.byteLength);
    },
    onCacheStatus: (status) => {
      statuses.push(status);
      events.push(["status", status.source]);
    },
  });

  assert.deepEqual([...first], [...bytes]);
  assert.deepEqual([...second], [...bytes]);
  assert.equal(network.calls(), 1);
  assert.deepEqual(statuses.map((status) => status.source), ["network", "cache"]);
  assert.deepEqual(progress.at(-1), [bytes.byteLength, bytes.byteLength]);
  assert.deepEqual(events, [
    ["status", "network"],
    ["fetch"],
    ["progress", 0],
    ["progress", bytes.byteLength],
    ["status", "cache"],
    ["progress", 0],
    ["progress", bytes.byteLength],
  ]);
  assert.equal(storage.names[0], "wasm-vm-boot-assets-v1");
  const key = [...storage.cache.entries.keys()][0];
  assert.match(key, new RegExp(`^https://app\\.example\\.test/.*${d.sha256}$`));
});

test("a URL change with the same hash is a cache hit, while a different hash misses", async () => {
  const firstBytes = text("shared immutable bytes");
  const secondBytes = text("different immutable bytes");
  const first = await descriptor(firstBytes, { url: "https://cdn.example.test/v1/image.gz" });
  const sameHashNewUrl = { ...first, url: "https://cdn.example.test/v2/image.gz" };
  const second = await descriptor(secondBytes, { url: "https://cdn.example.test/v2/image.gz" });
  const storage = new FakeCacheStorage();
  const network = fetchSequence([response(firstBytes), response(secondBytes)]);

  await fetchVerifiedBootAsset(first, { fetchImpl: network.fetchImpl, cacheStorage: storage });
  await fetchVerifiedBootAsset(sameHashNewUrl, { fetchImpl: network.fetchImpl, cacheStorage: storage });
  await fetchVerifiedBootAsset(second, { fetchImpl: network.fetchImpl, cacheStorage: storage });

  assert.equal(network.calls(), 2);
});

test("a tampered cached entry is evicted exactly and refetched with HTTP cache reload", async () => {
  const bytes = text("trusted bytes");
  const tampered = text("tampered bytes");
  const d = await descriptor(bytes);
  const storage = new FakeCacheStorage();
  const network = fetchSequence([response(bytes), response(bytes)]);
  const events = [];
  const fetchImpl = async (...args) => {
    events.push(["fetch"]);
    return network.fetchImpl(...args);
  };

  await fetchVerifiedBootAsset(d, {
    fetchImpl,
    cacheStorage: storage,
    baseUrl: "https://app.example.test/index.html",
    onProgress: (loaded) => events.push(["progress", loaded]),
    onCacheStatus: (status) => events.push(["status", status.source]),
  });
  const key = [...storage.cache.entries.keys()][0];
  storage.cache.entries.set(key, response(tampered));
  await fetchVerifiedBootAsset(d, {
    fetchImpl,
    cacheStorage: storage,
    baseUrl: "https://app.example.test/index.html",
    onProgress: (loaded) => events.push(["progress", loaded]),
    onCacheStatus: (status) => events.push(["status", status.source]),
  });

  assert.equal(network.calls(), 2);
  assert.equal(network.callsWithInit[1].init.cache, "reload");
  assert.equal(storage.cache.deleteCount, 1);
  assert.deepEqual(events, [
    ["status", "network"],
    ["fetch"],
    ["progress", 0],
    ["progress", bytes.byteLength],
    ["status", "cache"],
    ["progress", 0],
    ["status", "network"],
    ["fetch"],
    ["progress", 0],
    ["progress", bytes.byteLength],
  ]);
  assert.deepEqual(
    [...new Uint8Array(await storage.cache.entries.get(key).arrayBuffer())],
    [...bytes],
  );
});

test("a corrupt network response is rejected and never cached", async () => {
  const expected = text("expected bytes");
  const corrupt = new Uint8Array(expected.length);
  corrupt.fill(7);
  const d = await descriptor(expected);
  const storage = new FakeCacheStorage();
  const network = fetchSequence([response(corrupt)]);

  await assert.rejects(
    fetchVerifiedBootAsset(d, { fetchImpl: network.fetchImpl, cacheStorage: storage }),
    /SHA-256 mismatch/,
  );
  assert.equal(storage.cache.putCount, 0);
  assert.equal(storage.cache.entries.size, 0);
});

test("non-200 and opaque network responses are rejected without a cache write", async () => {
  const bytes = text("http response");
  const d = await descriptor(bytes);
  const storage = new FakeCacheStorage();
  const responses = [
    new Response(bytes, { status: 404 }),
    { status: 200, type: "opaque" },
  ];
  for (const next of responses) {
    await assert.rejects(
      fetchVerifiedBootAsset(d, {
        fetchImpl: async () => next,
        cacheStorage: storage,
      }),
      /not an HTTP 200 response/,
    );
  }
  assert.equal(storage.cache.putCount, 0);
  assert.equal(storage.cache.entries.size, 0);
});

test("missing and quota-failing storage gracefully fall back to network", async () => {
  const bytes = text("network fallback");
  const d = await descriptor(bytes);
  const missingStatuses = [];
  const missingNetwork = fetchSequence([response(bytes)]);
  const missingResult = await fetchVerifiedBootAsset(d, {
    fetchImpl: missingNetwork.fetchImpl,
    cacheStorage: null,
    onCacheStatus: (status) => missingStatuses.push(status),
  });
  assert.deepEqual([...missingResult], [...bytes]);
  assert.deepEqual(missingStatuses.map((status) => status.source), ["unavailable", "network"]);

  const quotaCache = new FakeCache({ quota: true });
  const quotaStatuses = [];
  const quotaNetwork = fetchSequence([response(bytes), response(bytes)]);
  await fetchVerifiedBootAsset(d, {
    fetchImpl: quotaNetwork.fetchImpl,
    cacheStorage: new FakeCacheStorage(quotaCache),
    onCacheStatus: (status) => quotaStatuses.push(status),
  });
  assert.equal(quotaCache.putCount, 1);
  assert.deepEqual(quotaStatuses.map((status) => status.source), ["network", "unavailable"]);
});

test("network and cached streams reject overflow and truncation", async () => {
  const bytes = text("exact bytes");
  const d = await descriptor(bytes);
  const storage = new FakeCacheStorage();
  const overflow = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes.byteLength + 1));
      controller.close();
    },
  }), { status: 200 });
  const makeTruncated = () => new Response(bytes.subarray(0, bytes.byteLength - 1), { status: 200 });

  await assert.rejects(
    fetchVerifiedBootAsset(d, {
      fetchImpl: async () => overflow,
      cacheStorage: storage,
      baseUrl: "https://app.example.test/index.html",
    }),
    /exceeds declared size/,
  );
  await assert.rejects(
    fetchVerifiedBootAsset(d, {
      fetchImpl: async () => makeTruncated(),
      cacheStorage: storage,
      baseUrl: "https://app.example.test/index.html",
    }),
    /truncated/,
  );

  await assert.rejects(
    fetchVerifiedBootAsset(d, {
      fetchImpl: async () => new Response(null, { status: 200 }),
      cacheStorage: null,
    }),
    /no readable body/,
  );

  const cacheKey = `https://app.example.test/__wasm-vm-boot-assets-v1/${d.sha256}`;
  storage.cache.entries.set(cacheKey, makeTruncated());
  await assert.rejects(
    fetchVerifiedBootAsset(d, {
      fetchImpl: async () => makeTruncated(),
      cacheStorage: storage,
      baseUrl: "https://app.example.test/index.html",
    }),
    /truncated/,
  );
  assert.equal(storage.cache.deleteCount, 1);
});

test("invalid descriptors are rejected before fetch", async () => {
  const bytes = text("descriptor");
  const good = await descriptor(bytes);
  const invalid = [
    { ...good, sha256: good.sha256.toUpperCase() },
    { ...good, sha256: good.sha256.slice(1) },
    { ...good, size: 0 },
    { ...good, size: Number.MAX_SAFE_INTEGER + 1 },
    { ...good, size: 512 * 1024 * 1024 + 1 },
    { ...good, url: "data:text/plain,not-http" },
    { ...good, url: "ftp://example.test/image" },
    { ...good, url: undefined },
    { ...good, role: "" },
    { ...good, role: undefined },
    { ...good, url: "/relative/image" },
  ];
  let calls = 0;
  for (const value of invalid) {
    await assert.rejects(
      fetchVerifiedBootAsset(value, { fetchImpl: async () => { calls += 1; return response(bytes); } }),
    );
  }
  assert.equal(calls, 0);
});

test("concurrent same-hash requests do not share buffers or weaken size validation", async () => {
  const bytes = text("deduplicated bytes");
  const d = await descriptor(bytes);
  const wrongSize = { ...d, size: d.size + 1 };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(bytes);
  };
  const [first, second] = await Promise.allSettled([
    fetchVerifiedBootAsset(d, { fetchImpl, cacheStorage: null }),
    fetchVerifiedBootAsset(wrongSize, { fetchImpl, cacheStorage: null }),
  ]);
  assert.equal(first.status, "fulfilled");
  assert.deepEqual([...first.value], [...bytes]);
  assert.equal(second.status, "rejected");
  assert.match(second.reason.message, /truncated/);
  assert.equal(calls, 2);
});

test("a throwing default caches property reports unavailable and still fetches", async () => {
  const bytes = text("security error fallback");
  const d = await descriptor(bytes);
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const statuses = [];
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  try {
    const result = await fetchVerifiedBootAsset(d, {
      fetchImpl: async () => response(bytes),
      onCacheStatus: (status) => statuses.push(status),
    });
    assert.deepEqual([...result], [...bytes]);
  } finally {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else delete globalThis.caches;
  }
  assert.deepEqual(statuses.map((status) => status.source), ["unavailable", "network"]);
  assert.equal(statuses[0].reason, "cache-storage-access-failed");
});
