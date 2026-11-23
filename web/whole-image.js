// E5-T34a: whole-image prefill for chunked boots. ONE streamed request fetches the gzip of the raw
// base image, decodes it with the platform DecompressionStream straight into a preallocated buffer
// of exactly `size` bytes (never a list of pieces re-concatenated), and checks the decompressed
// size and SHA-256 before anything reaches the VM. The buffer stays in JS memory: the wasm fetch
// layer (`machine.setLocalImage`) slices one chunk at a time out of it, so the 0.5-4 GiB image
// never competes with guest RAM inside the 4 GiB wasm32 address space.

const HEX64 = /^[0-9a-f]{64}$/u;

/** Lowercase hex SHA-256 of `bytes` (WebCrypto). */
async function sha256hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A stream that replays `first` and then the rest of `reader`. */
function replay(first, reader) {
  let pending = first;
  return new ReadableStream({
    async pull(controller) {
      if (pending) {
        controller.enqueue(pending);
        pending = null;
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Fetch and verify a whole raw disk image served as a gzip file.
 *
 *   url        the `.img.gz` URL
 *   size       the exact decompressed length (the chunk manifest's `image_len`)
 *   sha256     lowercase hex SHA-256 of the decompressed image
 *   onProgress (loaded, total) in DECOMPRESSED bytes; total is always `size`
 *
 * A server that already applied `Content-Encoding: gzip` hands us decoded bytes; the gzip magic
 * (1f 8b) decides whether to decode again. Either way the result must match `size` and `sha256`
 * exactly or this throws — a short, long, or corrupt image never boots.
 */
export async function fetchWholeImage(url, { size, sha256, onProgress = () => {}, fetchImpl } = {}) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("whole image: size must be a positive integer");
  if (typeof sha256 !== "string" || !HEX64.test(sha256)) throw new Error("whole image: sha256 must be 64 lowercase hex digits");
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const resp = await doFetch(url, { cache: "default" });
  if (!resp.ok || !resp.body) throw new Error(`whole image: fetch ${url} → HTTP ${resp.status}`);

  const raw = resp.body.getReader();
  const head = await raw.read();
  if (head.done) throw new Error(`whole image: ${url} is empty`);
  const gzipped = head.value.length >= 2 && head.value[0] === 0x1f && head.value[1] === 0x8b;
  let stream = replay(head.value, raw);
  if (gzipped) stream = stream.pipeThrough(new DecompressionStream("gzip"));

  const out = new Uint8Array(size);
  const reader = stream.getReader();
  let loaded = 0;
  onProgress(0, size);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > size) {
      await reader.cancel("oversize").catch(() => {});
      throw new Error(`whole image: decompressed size exceeds the declared ${size} bytes`);
    }
    out.set(value, loaded);
    loaded += value.length;
    onProgress(loaded, size);
  }
  if (loaded !== size) {
    throw new Error(`whole image: decompressed ${loaded} bytes, expected ${size}`);
  }
  const got = await sha256hex(out);
  if (got !== sha256) {
    throw new Error(`whole image: integrity check failed: expected ${sha256}, got ${got} — refusing to boot corrupt bytes`);
  }
  return out;
}
