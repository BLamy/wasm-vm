// E5-T34a: the whole-image prefill fetcher (web/whole-image.js) — one streamed gzip request decoded
// into a preallocated buffer, with hard size and SHA-256 checks. Run: node --test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { fetchWholeImage } from "../whole-image.js";

const image = new Uint8Array(300_000).map((_, i) => (i * 31 + 7) & 0xff);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const SHA = sha(image);

/** A fetch stub that serves `body` in `piece`-byte reads and records every call. */
function server(body, { status = 200, piece = 4096 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    let off = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (off >= body.length) return c.close();
        c.enqueue(body.slice(off, off + piece));
        off += piece;
      },
    });
    return new Response(status === 200 ? stream : null, { status });
  };
  return { fetchImpl, calls };
}

test("decodes a gzip image in one request, reporting decompressed progress", async () => {
  const { fetchImpl, calls } = server(gzipSync(image));
  const progress = [];
  const out = await fetchWholeImage("/img.gz", {
    size: image.length, sha256: SHA, fetchImpl, onProgress: (l, t) => progress.push([l, t]),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(out, image);
  assert.equal(out.buffer.byteLength, image.length, "single preallocated buffer, exact size");
  assert.deepEqual(progress.at(-1), [image.length, image.length]);
  assert.ok(progress.every(([, t]) => t === image.length));
});

test("accepts a body the server already gzip-decoded (Content-Encoding)", async () => {
  const { fetchImpl } = server(image);
  assert.deepEqual(await fetchWholeImage("/img.gz", { size: image.length, sha256: SHA, fetchImpl }), image);
});

test("short decompressed image is a hard error", async () => {
  const { fetchImpl } = server(gzipSync(image.slice(0, image.length - 1)));
  await assert.rejects(fetchWholeImage("/img.gz", { size: image.length, sha256: SHA, fetchImpl }),
    /decompressed 299999 bytes, expected 300000/);
});

test("long decompressed image is a hard error", async () => {
  const long = new Uint8Array(image.length + 10);
  long.set(image);
  const { fetchImpl } = server(gzipSync(long));
  await assert.rejects(fetchWholeImage("/img.gz", { size: image.length, sha256: SHA, fetchImpl }),
    /exceeds the declared 300000 bytes/);
});

test("SHA-256 mismatch is a hard error", async () => {
  const bad = image.slice();
  bad[12345] ^= 1;
  const { fetchImpl } = server(gzipSync(bad));
  await assert.rejects(fetchWholeImage("/img.gz", { size: image.length, sha256: SHA, fetchImpl }),
    /integrity check failed/);
});

test("HTTP failure and bad arguments are refused", async () => {
  await assert.rejects(fetchWholeImage("/img.gz", { size: 10, sha256: SHA, fetchImpl: server(image, { status: 404 }).fetchImpl }),
    /HTTP 404/);
  const { fetchImpl, calls } = server(image);
  await assert.rejects(fetchWholeImage("/img.gz", { size: 0, sha256: SHA, fetchImpl }), /size/);
  await assert.rejects(fetchWholeImage("/img.gz", { size: 10, sha256: "ABC", fetchImpl }), /sha256/);
  assert.equal(calls.length, 0, "argument errors never touch the network");
});
