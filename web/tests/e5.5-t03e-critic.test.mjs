import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";

import { fetchVerifiedBootAsset } from "../boot-asset-cache.js";
import { createOmarchyStartupLifecycle, formatOmarchyProgress } from "../omarchy-startup-state.js";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const origin = "https://app.critic.test/index.html";
const keyFor = (sha256) => `https://app.critic.test/__wasm-vm-boot-assets-v1/${sha256}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const descriptor = (bytes, overrides = {}) => ({
  url: "https://cdn.critic.test/release.bin",
  size: bytes.byteLength,
  sha256: hash(bytes),
  role: "bootSnapshot",
  ...overrides,
});

function chunkedResponse(bytes, widths) {
  let offset = 0;
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.byteLength) {
        controller.close();
        return;
      }
      const width = Math.max(1, widths[index++ % widths.length]);
      const end = Math.min(bytes.byteLength, offset + width);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  }), { status: 200 });
}

class ThrowingCache {
  constructor(entries = new Map(), failures = {}) {
    this.entries = entries;
    this.failures = failures;
    this.deleted = [];
    this.puts = [];
  }

  async match(key) {
    if (this.failures.match) throw new Error("match blocked");
    return this.entries.get(String(key))?.clone();
  }

  async delete(key) {
    this.deleted.push(String(key));
    if (this.failures.delete) throw new Error("delete blocked");
    return this.entries.delete(String(key));
  }

  async put(key, response) {
    this.puts.push(String(key));
    if (this.failures.put) throw new DOMException("quota", "QuotaExceededError");
    this.entries.set(String(key), response.clone());
  }
}

class Storage {
  constructor(cache, openFailure = false) {
    this.cache = cache;
    this.openFailure = openFailure;
  }

  async open() {
    if (this.openFailure) throw new Error("open blocked");
    return this.cache;
  }
}

test("critic: randomized chunk boundaries preserve exact hash/size enforcement", async () => {
  const bytes = Uint8Array.from({ length: 4097 }, (_, index) => (index * 73 + 19) & 0xff);
  const d = descriptor(bytes);
  const progress = [];
  const result = await fetchVerifiedBootAsset(d, {
    baseUrl: origin,
    cacheStorage: null,
    fetchImpl: async () => chunkedResponse(bytes, [1, 127, 3, 1024, 17]),
    onProgress: (loaded, total) => progress.push([loaded, total]),
  });
  assert.deepEqual(result, bytes);
  assert.equal(progress[0][0], 0);
  assert.equal(progress.at(-1)[0], bytes.byteLength);
  assert.ok(progress.every(([loaded, total], index) =>
    total === bytes.byteLength && (index === 0 || loaded >= progress[index - 1][0])));

  const sameLengthTamper = bytes.slice();
  sameLengthTamper[2048] ^= 0xff;
  await assert.rejects(fetchVerifiedBootAsset(d, {
    baseUrl: origin,
    cacheStorage: null,
    fetchImpl: async () => chunkedResponse(sameLengthTamper, [511, 2, 31]),
  }), /SHA-256 mismatch/);
});

test("critic: stale release hash cannot satisfy a new descriptor", async () => {
  const oldBytes = new TextEncoder().encode("release-old!");
  const newBytes = new TextEncoder().encode("release-new!");
  assert.equal(oldBytes.byteLength, newBytes.byteLength);
  const oldDescriptor = descriptor(oldBytes);
  const newDescriptor = descriptor(newBytes);
  const entries = new Map([[keyFor(oldDescriptor.sha256), new Response(oldBytes)]]);
  const cache = new ThrowingCache(entries);
  let requests = 0;
  const result = await fetchVerifiedBootAsset(newDescriptor, {
    baseUrl: origin,
    cacheStorage: new Storage(cache),
    fetchImpl: async () => { requests += 1; return new Response(newBytes); },
  });
  assert.deepEqual(result, newBytes);
  assert.equal(requests, 1);
  assert.equal(entries.has(keyFor(oldDescriptor.sha256)), true, "old key must not be broadly evicted");
  assert.equal(entries.has(keyFor(newDescriptor.sha256)), true);
});

test("critic: every storage failure keeps network verification and honest provenance", async () => {
  const bytes = new TextEncoder().encode("verified fallback bytes");
  const d = descriptor(bytes);
  const cases = [
    { name: "open", storage: new Storage(new ThrowingCache(), true), reason: "cache-open-failed" },
    { name: "match", storage: new Storage(new ThrowingCache(new Map(), { match: true })), reason: "cache-read-failed" },
    { name: "put", storage: new Storage(new ThrowingCache(new Map(), { put: true })), reason: "cache-store-failed" },
  ];
  for (const fixture of cases) {
    const statuses = [];
    const result = await fetchVerifiedBootAsset(d, {
      baseUrl: origin,
      cacheStorage: fixture.storage,
      fetchImpl: async () => chunkedResponse(bytes, [2, 5, 1]),
      onCacheStatus: (status) => statuses.push(status),
    });
    assert.deepEqual(result, bytes, fixture.name);
    assert.ok(statuses.some((status) => status.source === "network"), fixture.name);
    assert.ok(statuses.some((status) => status.source === "unavailable" && status.reason === fixture.reason), fixture.name);
  }
});

test("critic: failed corrupt-key deletion cannot bypass refetch verification", async () => {
  const bytes = new TextEncoder().encode("trusted immutable");
  const tampered = new TextEncoder().encode("tamperd immutable");
  assert.equal(bytes.byteLength, tampered.byteLength);
  const d = descriptor(bytes);
  const cache = new ThrowingCache(new Map([[keyFor(d.sha256), new Response(tampered)]]), { delete: true });
  const statuses = [];
  let init;
  const result = await fetchVerifiedBootAsset(d, {
    baseUrl: origin,
    cacheStorage: new Storage(cache),
    fetchImpl: async (_url, options) => { init = options; return new Response(bytes); },
    onCacheStatus: (status) => statuses.push(status),
  });
  assert.deepEqual(result, bytes);
  assert.equal(init.cache, "reload");
  assert.deepEqual(statuses.map((status) => status.source), ["cache", "unavailable", "network"]);
  assert.deepEqual(new Uint8Array(await cache.entries.get(keyFor(d.sha256)).arrayBuffer()), bytes);

  cache.entries.set(keyFor(d.sha256), new Response(tampered));
  await assert.rejects(fetchVerifiedBootAsset(d, {
    baseUrl: origin,
    cacheStorage: new Storage(cache),
    fetchImpl: async () => new Response(tampered),
  }), /SHA-256 mismatch/);
});

test("critic: queued stale timer callbacks cannot regress terminal lifecycle state", () => {
  const callbacks = [];
  const waiting = [];
  const lifecycle = createOmarchyStartupLifecycle({
    waitMs: 10,
    setTimeoutFn: (callback) => { callbacks.push(callback); return callbacks.length; },
    clearTimeoutFn: () => {}, // Simulate a callback already queued despite cancellation.
    onWaiting: () => waiting.push("waiting"),
  });
  lifecycle.state("restored");
  lifecycle.desktopReady();
  callbacks[0]();
  assert.deepEqual(waiting, []);
  assert.equal(lifecycle.isDesktopReady(), true);

  lifecycle.booting();
  lifecycle.guestReady();
  callbacks[1]();
  assert.deepEqual(waiting, ["waiting"]);
  lifecycle.state("restored");
  lifecycle.error();
  callbacks[2]();
  assert.deepEqual(waiting, ["waiting"]);
});

test("critic: done is terminal against pending waits and late ready until reboot", () => {
  const callbacks = [];
  const waiting = [];
  const lifecycle = createOmarchyStartupLifecycle({
    waitMs: 10,
    setTimeoutFn: (callback) => { callbacks.push(callback); return callbacks.length; },
    clearTimeoutFn: () => {},
    onWaiting: () => waiting.push("waiting"),
  });
  lifecycle.state("restored");
  lifecycle.state("done");
  lifecycle.guestReady();
  for (const callback of callbacks) callback();
  assert.deepEqual(waiting, [], "terminal done state was replaced by a guest-response wait");

  lifecycle.booting();
  lifecycle.guestReady();
  callbacks.at(-1)();
  assert.deepEqual(waiting, ["waiting"], "new boot did not clear the terminal latch");
});

test("critic: malformed progress cannot present a completed transfer bar", () => {
  for (const detail of [
    { phase: "bootSnapshot: unpacking", loaded: 100, total: 100 },
    { phase: "bootSnapshot: downloading", loaded: "100", total: 100 },
    { phase: "bootSnapshot: downloading", loaded: 100, total: Number.POSITIVE_INFINITY },
    { phase: "bootSnapshot: reading cache", loaded: -1, total: 100 },
  ]) {
    assert.equal(formatOmarchyProgress(detail).determinate, false);
  }
});
