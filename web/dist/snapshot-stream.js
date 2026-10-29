// Inflate authenticated compressed bytes into one Wasm-owned snapshot allocation.
// The full expanded snapshot never enters a JavaScript ArrayBuffer or Blob.
export const MAX_SNAPSHOT_BYTES = 1024 * 1024 * 1024;
export const MAX_COPY_BYTES = 256 * 1024;
const INPUT_CHUNK_BYTES = 64 * 1024;

export async function stageGzipSnapshot(bytes, descriptor, createBuffer) {
  const expected = descriptor?.uncompressedSize;
  const digest = descriptor?.uncompressedSha256;
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(expected) || expected < 84 ||
      expected > MAX_SNAPSHOT_BYTES || !/^[0-9a-f]{64}$/.test(digest ?? "")) {
    throw new Error("invalid streamed snapshot length/digest descriptor");
  }
  let buffer = createBuffer(expected);
  let reader;
  const stats = { expandedBytes: 0, maxCopyBytes: 0, copies: 0 };
  try {
    let offset = 0;
    // Blob([bytes]) can duplicate compressed input. Backpressure keeps the source bounded too.
    const input = new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) { controller.close(); return; }
        const end = Math.min(bytes.length, offset + INPUT_CHUNK_BYTES);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    });
    reader = input.pipeThrough(new DecompressionStream("gzip")).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break; // gzip CRC/trailer must validate before the buffer can be returned.
      if (!(value instanceof Uint8Array) || value.length > expected - stats.expandedBytes) {
        throw new Error("streamed snapshot exceeds declared length");
      }
      for (let at = 0; at < value.length; at += MAX_COPY_BYTES) {
        const part = value.subarray(at, at + MAX_COPY_BYTES);
        buffer.append(part);
        stats.maxCopyBytes = Math.max(stats.maxCopyBytes, part.length);
        stats.copies++;
      }
      stats.expandedBytes += value.length;
    }
    if (stats.expandedBytes !== expected || buffer.byteLength() !== expected) {
      throw new Error("streamed snapshot is truncated");
    }
    if (buffer.sha256() !== digest) throw new Error("streamed snapshot digest differs");
    const result = { buffer, stats };
    buffer = null; // caller owns it until the consuming restore call.
    return result;
  } finally {
    if (reader) {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* best effort */ }
      try { reader.releaseLock(); } catch { /* preserve failure and release staging below */ }
    }
    buffer?.free();
  }
}
