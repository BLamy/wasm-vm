// Content-addressed cache for the immutable, compressed bytes used during boot.

const CACHE_NAME = "wasm-vm-boot-assets-v1";
const MAX_ASSET_SIZE = 512 * 1024 * 1024;
const FALLBACK_CACHE_ORIGIN = "https://wasm-vm.invalid";

/**
 * Fetch an immutable boot asset, verifying its exact byte count and SHA-256 digest.
 *
 * The CacheStorage entry is keyed only by the expected digest.  The cached value is
 * the raw response body, which is deliberately kept compressed when the URL serves
 * compressed bytes.
 */
export async function fetchVerifiedBootAsset(descriptor, options = {}) {
  const normalized = normalizeDescriptor(descriptor, options.baseUrl);
  const fetchImpl = options.fetchImpl === undefined ? globalThis.fetch : options.fetchImpl;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const onCacheStatus = typeof options.onCacheStatus === "function" ? options.onCacheStatus : null;
  let cacheStorage = options.cacheStorage;
  let cacheStorageAccessFailed = false;
  if (cacheStorage === undefined) {
    try {
      cacheStorage = globalThis.caches;
    } catch (error) {
      cacheStorageAccessFailed = true;
      cacheStorage = null;
    }
  }

  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  return loadAsset(normalized, {
    fetchImpl,
    cacheStorage,
    baseUrl: options.baseUrl,
    onProgress,
    onCacheStatus,
    cacheStorageAccessFailed,
  });
}

async function loadAsset(
  descriptor,
  { fetchImpl, cacheStorage, baseUrl, onProgress, onCacheStatus, cacheStorageAccessFailed },
) {
  const cacheKey = makeCacheKey(descriptor.sha256, descriptor.resolvedUrl, baseUrl);
  let cache = null;
  let cacheWasCorrupt = false;

  if (cacheStorage && typeof cacheStorage.open === "function") {
    try {
      cache = await cacheStorage.open(CACHE_NAME);
    } catch (error) {
      emitCacheStatus(onCacheStatus, { role: descriptor.role, source: "unavailable", reason: "cache-open-failed" });
    }
  } else {
    emitCacheStatus(onCacheStatus, {
      role: descriptor.role,
      source: "unavailable",
      reason: cacheStorageAccessFailed ? "cache-storage-access-failed" : "cache-storage-unavailable",
    });
  }

  if (cache) {
    let cachedResponse;
    try {
      cachedResponse = await cache.match(cacheKey);
    } catch (error) {
      cache = null;
      emitCacheStatus(onCacheStatus, { role: descriptor.role, source: "unavailable", reason: "cache-read-failed" });
    }

    if (cachedResponse) {
      // This announces the source before any body bytes are consumed. A failed
      // verification below transitions to the network source.
      emitCacheStatus(onCacheStatus, { role: descriptor.role, source: "cache" });
      try {
        return await verifyResponse(cachedResponse, descriptor, onProgress);
      } catch (error) {
        cacheWasCorrupt = true;
        // Delete exactly this content-addressed key.  A bad entry must never cause a
        // broad cache clear that could evict unrelated boot assets.
        try {
          await cache.delete(cacheKey);
        } catch (deleteError) {
          emitCacheStatus(onCacheStatus, { role: descriptor.role, source: "unavailable", reason: "cache-delete-failed" });
        }
      }
    }
  }

  // Source status describes where the bytes will be read from, not whether the
  // eventual response passes verification.
  emitCacheStatus(onCacheStatus, { role: descriptor.role, source: "network" });
  const response = await fetchImpl(
    descriptor.resolvedUrl,
    { cache: cacheWasCorrupt ? "reload" : "default" },
  );
  if (!response || response.status !== 200 || response.type === "opaque") {
    throw new Error(`boot asset request was not an HTTP 200 response: ${descriptor.resolvedUrl}`);
  }

  // This verifies before any storage write, so corrupt network responses can never
  // poison the content-addressed entry.
  const bytes = await verifyResponse(response, descriptor, onProgress);

  if (cache) {
    try {
      // Put a fresh Response containing the already verified bytes.  Awaiting this
      // operation makes a successful return deterministic across a reload.
      await cache.put(cacheKey, new Response(bytes));
    } catch (error) {
      emitCacheStatus(onCacheStatus, { role: descriptor.role, source: "unavailable", reason: "cache-store-failed" });
    }
  }

  return bytes;
}

async function verifyResponse(response, descriptor, emitProgress) {
  if (!response || response.status !== 200 || response.type === "opaque") {
    throw new Error("cached boot asset response is not a usable HTTP 200 response");
  }

  const bytes = await readBounded(response, descriptor.size, emitProgressFor(emitProgress));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("WebCrypto SHA-256 is unavailable");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  const actualSha256 = toHex(new Uint8Array(digest));
  if (actualSha256 !== descriptor.sha256) {
    throw new Error(`boot asset SHA-256 mismatch: expected ${descriptor.sha256}, got ${actualSha256}`);
  }
  return bytes;
}

async function readBounded(response, expectedSize, emitProgress) {
  emitProgress(0, expectedSize);

  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("boot asset response has no readable body");
  }

  const bytes = new Uint8Array(expectedSize);
  const reader = response.body.getReader();
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = asUint8Array(value);
      if (loaded + chunk.byteLength > expectedSize) {
        throw new Error(`boot asset exceeds declared size ${expectedSize}`);
      }
      bytes.set(chunk, loaded);
      loaded += chunk.byteLength;
      emitProgress(loaded, expectedSize);
    }
  } catch (error) {
    // Attach a rejection handler without waiting for cancellation: a stream
    // implementation may keep cancel() pending after an overflow/read failure.
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch (cancelError) { /* best effort */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (loaded !== expectedSize) {
    throw new Error(`boot asset is truncated: expected ${expectedSize} bytes, got ${loaded}`);
  }
  return bytes;
}

function normalizeDescriptor(descriptor, baseUrlOption) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new TypeError("boot asset descriptor must be an object");
  }
  if (typeof descriptor.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(descriptor.sha256)) {
    throw new TypeError("boot asset sha256 must be exactly 64 lowercase hexadecimal characters");
  }
  if (!Number.isSafeInteger(descriptor.size) || descriptor.size <= 0 || descriptor.size > MAX_ASSET_SIZE) {
    throw new RangeError(`boot asset size must be a positive safe integer <= ${MAX_ASSET_SIZE}`);
  }
  if (typeof descriptor.role !== "string" || descriptor.role.length === 0) {
    throw new TypeError("boot asset role must be a non-empty string");
  }
  if (typeof descriptor.url !== "string" || descriptor.url.length === 0) {
    throw new TypeError("boot asset url must be a non-empty string");
  }

  const baseUrl = baseUrlOption === undefined ? globalThis.location?.href : baseUrlOption;
  let resolved;
  try {
    resolved = new URL(descriptor.url, baseUrl);
  } catch (error) {
    throw new TypeError("boot asset url must be an absolute http(s) URL or resolve against baseUrl");
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new TypeError("boot asset url must use http or https");
  }

  return {
    url: descriptor.url,
    resolvedUrl: resolved.href,
    sha256: descriptor.sha256,
    size: descriptor.size,
    role: descriptor.role,
  };
}

function makeCacheKey(sha256, resolvedUrl, baseUrlOption) {
  let origin = FALLBACK_CACHE_ORIGIN;
  try {
    const base = baseUrlOption === undefined ? globalThis.location?.href : baseUrlOption;
    const candidate = new URL(base ?? resolvedUrl);
    if (candidate.protocol === "http:" || candidate.protocol === "https:") origin = candidate.origin;
  } catch (error) {
    // The descriptor URL was already resolved and validated; the fallback merely
    // keeps the synthetic key same-origin when no browser location exists.
  }
  return `${origin}/__wasm-vm-boot-assets-v1/${sha256}`;
}

function emitProgressFor(onProgress) {
  return (loaded, total) => {
    try { onProgress?.(loaded, total); } catch (error) { /* callbacks cannot corrupt boot */ }
  };
}

function emitCacheStatus(onCacheStatus, status) {
  try { onCacheStatus?.(status); } catch (error) { /* callbacks cannot corrupt boot */ }
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("boot asset stream yielded a non-byte chunk");
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
