import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, stat, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CHUNK_PREFIX,
  CHUNK_SIZE,
  checkPublicObject,
  publishChunks,
  validateLocalManifest,
} from "./publish-omarchy-chunks.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function streamingResponse(bytes, { stall = false, status = 200 } = {}) {
  let offset = 0;
  let cancelled = false;
  return {
    status,
    body: {
      getReader() {
        return {
          read() {
            if (stall) return new Promise(() => {});
            if (offset >= bytes.length) return Promise.resolve({ done: true });
            const end = Math.min(offset + 2, bytes.length);
            const value = bytes.subarray(offset, end);
            offset = end;
            return Promise.resolve({ done: false, value });
          },
          cancel() {
            cancelled = true;
            return Promise.resolve();
          },
        };
      },
      get cancelled() { return cancelled; },
      arrayBuffer() { throw new Error("streaming verifier must not call arrayBuffer"); },
    },
  };
}

const missingResponse = () => ({ status: 404 });
const keyFromUrl = (url) => new URL(url).pathname.slice(1);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "omarchy-publish-test-"));
  const chunksDir = path.join(root, "chunks");
  await mkdir(chunksDir);
  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  const first = Buffer.alloc(CHUNK_SIZE, 0x41);
  const last = Buffer.from("END");
  const firstSha = sha256(first);
  const lastSha = sha256(last);
  await writeFile(path.join(chunksDir, `${firstSha}.bin`), first);
  await writeFile(path.join(chunksDir, `${lastSha}.bin`), last);
  const manifest = {
    version: 1,
    image_len: CHUNK_SIZE * 2 + last.length,
    chunk_size: CHUNK_SIZE,
    layout: "split",
    chunks: [firstSha, firstSha, lastSha],
  };
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return { root, chunksDir, manifestPath, first, last, firstSha, lastSha };
}

async function localPublicServer(t, objects, statusOverrides = new Map()) {
  const server = createServer(async (request, response) => {
    const key = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname.slice(1));
    if (statusOverrides.has(key)) {
      response.writeHead(statusOverrides.get(key));
      response.end();
      return;
    }
    const body = objects.get(key);
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Length": body.length });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("plan validates strict split-256KiB input without network or upload", async (t) => {
  const input = await fixture(t);
  let fetchCalls = 0;
  let uploadCalls = 0;
  const result = await publishChunks({
    manifestPath: input.manifestPath,
    publish: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("plan must not perform public GET");
    },
    uploader: async () => { uploadCalls += 1; },
  });
  assert.equal(result.totalManifestChunks, 3);
  assert.equal(result.totalUniqueObjects, 2);
  assert.equal(result.totalBytes, CHUNK_SIZE + input.last.length);
  assert.equal(result.imageLength, CHUNK_SIZE * 2 + input.last.length);
  assert.equal(result.imageSha256, sha256(Buffer.concat([input.first, input.first, input.last])));
  assert.match(result.provenance.scriptSha256, /^[0-9a-f]{64}$/u);
  assert.ok(result.provenance.frozenHead === null || /^[0-9a-f]{40,64}$/u.test(result.provenance.frozenHead));
  assert.equal(fetchCalls, 0);
  assert.equal(uploadCalls, 0);
  assert.match(result.manifestKey, /^chunked-omarchy\/manifest-[0-9a-f]{64}\.json$/u);
});

test("publish skips exact public bytes, uploads 404s, and verifies immutable manifest last", async (t) => {
  const input = await fixture(t);
  const objects = new Map([[`${CHUNK_PREFIX}${input.firstSha}.bin`, input.first]]);
  const uploads = [];
  const publicBase = await localPublicServer(t, objects);
  const result = await publishChunks({
    manifestPath: input.manifestPath,
    publicBase,
    bucket: "wasm-vm-test",
    publish: true,
    uploader: async ({ bucket, key, sourcePath }) => {
      uploads.push({ bucket, key });
      objects.set(key, await readFile(sourcePath));
    },
  });
  assert.equal(result.verifiedExisting, 1);
  assert.equal(result.uploaded, 1);
  assert.equal(result.finalManifest, "uploaded-verified");
  assert.deepEqual(uploads.map(({ key }) => key), [
    `${CHUNK_PREFIX}${input.lastSha}.bin`,
    result.manifestKey,
  ]);
  assert.ok(!uploads.some(({ key }) => key === "chunked-omarchy/manifest.json"));
  assert.deepEqual(objects.get(result.manifestKey), await readFile(input.manifestPath));
});

test("a race-filled key is counted as existing, not uploaded", async (t) => {
  const input = await fixture(t);
  const manifestBytes = await readFile(input.manifestPath);
  const manifestKey = `chunked-omarchy/manifest-${sha256(manifestBytes)}.json`;
  let firstCalls = 0;
  const result = await publishChunks({
    manifestPath: input.manifestPath,
    publicBase: "http://publisher.test",
    publish: true,
    fetchImpl: async (url) => {
      const key = keyFromUrl(url);
      if (key === `${CHUNK_PREFIX}${input.firstSha}.bin`) {
        firstCalls += 1;
        return firstCalls === 1 ? missingResponse() : streamingResponse(input.first);
      }
      if (key === `${CHUNK_PREFIX}${input.lastSha}.bin`) return streamingResponse(input.last);
      if (key === manifestKey) return streamingResponse(manifestBytes);
      return missingResponse();
    },
    uploader: async () => { throw new Error("race-filled key must not invoke uploader"); },
  });
  assert.equal(result.uploaded, 0);
  assert.equal(result.racedExisting, 1);
  assert.equal(result.verifiedExisting, 1);
  assert.equal(result.finalManifest, "existing-exact");
});

test("a content-addressed mismatch fails closed before any write", async (t) => {
  const input = await fixture(t);
  const uploads = [];
  const mismatchKey = `${CHUNK_PREFIX}${input.firstSha}.bin`;
  await assert.rejects(
    publishChunks({
      manifestPath: input.manifestPath,
      publicBase: "http://publisher.test",
      publish: true,
      fetchImpl: async (url) => keyFromUrl(url) === mismatchKey
        ? streamingResponse(Buffer.from("CORRUPT"))
        : missingResponse(),
      uploader: async ({ key }) => { uploads.push(key); },
    }),
    /mismatched bytes; refusing to overwrite/u,
  );
  assert.deepEqual(uploads, []);
});

test("headers-then-stalled-body is bounded by the streaming GET timeout", async (t) => {
  const input = await fixture(t);
  const stalledKey = `${CHUNK_PREFIX}${input.firstSha}.bin`;
  const started = Date.now();
  await assert.rejects(
    publishChunks({
      manifestPath: input.manifestPath,
      publicBase: "http://publisher.test",
      publish: true,
      publicTimeoutMs: 25,
      fetchImpl: async (url) => keyFromUrl(url) === stalledKey
        ? streamingResponse(Buffer.alloc(0), { stall: true })
        : missingResponse(),
      uploader: async () => { throw new Error("must not upload after stalled preflight"); },
    }),
    /public GET timed out/u,
  );
  assert.ok(Date.now() - started < 1_000, "stalled body exceeded the bounded test timeout");
});

test("streaming verification hashes split body chunks without retaining the response", async () => {
  const bytes = Buffer.from("streamed-body");
  const result = await checkPublicObject({
    fetchImpl: async () => streamingResponse(bytes),
    publicBase: "http://publisher.test",
    key: "chunked-omarchy/chunks/example.bin",
    expectedSize: bytes.length,
    expectedSha: sha256(bytes),
  });
  assert.equal(result.state, "exact");
  assert.equal(result.size, bytes.length);
});

test("streaming verification cancels and rejects an oversized body at the cap", async () => {
  const response = streamingResponse(Buffer.from("too-large"));
  const result = await checkPublicObject({
    fetchImpl: async () => response,
    publicBase: "http://publisher.test",
    key: "chunked-omarchy/chunks/example.bin",
    expectedSize: 3,
    expectedSha: sha256(Buffer.from("abc")),
  });
  assert.equal(result.state, "mismatch");
  assert.equal(result.size, 4);
  assert.equal(response.body.cancelled, true);
});

test("404 and non-200 responses cancel their bodies before returning", async () => {
  for (const status of [404, 503]) {
    const response = streamingResponse(Buffer.from("discard-me"), { status });
    const result = await checkPublicObject({
      fetchImpl: async () => response,
      publicBase: "http://publisher.test",
      key: `chunked-omarchy/status-${status}.bin`,
      expectedSize: 4,
      expectedSha: sha256(Buffer.from("body")),
    });
    assert.equal(result.state, status === 404 ? "missing" : "error");
    assert.equal(response.body.cancelled, true, `status ${status} body was not cancelled`);
  }
});

test("stalled status-body disposal is bounded by the request timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    checkPublicObject({
      fetchImpl: async () => ({
        status: 404,
        body: { getReader: () => ({ cancel: () => new Promise(() => {}) }) },
      }),
      publicBase: "http://publisher.test",
      key: "chunked-omarchy/stalled-status.bin",
      expectedSize: 0,
      expectedSha: sha256(Buffer.alloc(0)),
      timeoutMs: 25,
    }),
    /public GET timed out/u,
  );
  assert.ok(Date.now() - started < 1_000, "stalled status-body disposal exceeded the bounded timeout");
});

test("a chunk changed after manifest preflight is rejected before its upload", async (t) => {
  const input = await fixture(t);
  const uploads = [];
  await assert.rejects(
    publishChunks({
      manifestPath: input.manifestPath,
      publicBase: "http://publisher.test",
      publish: true,
      fetchImpl: async () => missingResponse(),
      onProgress: async (event) => {
        if (event.phase === "preflight" && event.processed === 2) {
          writeFileSync(path.join(input.chunksDir, `${input.firstSha}.bin`), Buffer.from("changed"));
        }
      },
      uploader: async ({ key }) => { uploads.push(key); },
    }),
    /source size changed before upload|source SHA-256 changed before upload/u,
  );
  assert.deepEqual(uploads, []);
});

test("publisher-owned staged bytes survive original-source poisoning during handoff", async (t) => {
  const input = await fixture(t);
  const objects = new Map();
  const stagedPaths = [];
  await publishChunks({
    manifestPath: input.manifestPath,
    publicBase: "http://publisher.test",
    publish: true,
    fetchImpl: async (url) => {
      const body = objects.get(keyFromUrl(url));
      return body ? streamingResponse(body) : missingResponse();
    },
    uploader: async ({ key, sourcePath }) => {
      stagedPaths.push({ key, sourcePath, mode: (await stat(sourcePath)).mode & 0o777 });
      const stagedBytes = await readFile(sourcePath);
      if (key.endsWith(`${input.firstSha}.bin`)) {
        await writeFile(path.join(input.chunksDir, `${input.firstSha}.bin`), "poisoned-original");
      } else if (key.endsWith(`${input.lastSha}.bin`)) {
        await writeFile(path.join(input.chunksDir, `${input.lastSha}.bin`), "poisoned-original");
      }
      objects.set(key, stagedBytes);
    },
  });
  assert.equal(stagedPaths.length, 3);
  assert.ok(stagedPaths.every(({ mode }) => mode === 0o400));
  assert.ok(stagedPaths.every(({ sourcePath }) => !sourcePath.startsWith(input.root)));
  assert.deepEqual(objects.get(`${CHUNK_PREFIX}${input.firstSha}.bin`), input.first);
  assert.deepEqual(objects.get(`${CHUNK_PREFIX}${input.lastSha}.bin`), input.last);
  for (const { sourcePath } of stagedPaths) {
    await assert.rejects(stat(sourcePath), /ENOENT/u);
    await assert.rejects(stat(path.dirname(sourcePath)), /ENOENT/u);
  }
});

test("manifest mutation during public preflight prevents all chunk writes", async (t) => {
  const input = await fixture(t);
  const uploads = [];
  await assert.rejects(
    publishChunks({
      manifestPath: input.manifestPath,
      publicBase: "http://publisher.test",
      publish: true,
      fetchImpl: async () => missingResponse(),
      onProgress: (event) => {
        if (event.phase === "preflight" && event.processed === 2) {
          writeFileSync(input.manifestPath, "manifest changed before writes\n");
        }
      },
      uploader: async ({ key }) => { uploads.push(key); },
    }),
    /manifest source changed before upload/u,
  );
  assert.deepEqual(uploads, []);
});

test("post-upload verification catches bytes changed during the uploader handoff", async (t) => {
  const input = await fixture(t);
  const objects = new Map();
  await assert.rejects(
    publishChunks({
      manifestPath: input.manifestPath,
      publicBase: "http://publisher.test",
      publish: true,
      fetchImpl: async (url) => {
        const body = objects.get(keyFromUrl(url));
        return body ? streamingResponse(body) : missingResponse();
      },
      uploader: async ({ key, sourcePath }) => {
        const staged = await readFile(sourcePath);
        staged[0] ^= 0xff;
        objects.set(key, staged);
      },
    }),
    /post-upload public verification failed/u,
  );
});

test("validated manifest staging survives original-source mutation before its write", async (t) => {
  const input = await fixture(t);
  const uploads = [];
  const objects = new Map();
  const originalManifest = await readFile(input.manifestPath);
  const result = await publishChunks({
    manifestPath: input.manifestPath,
    publicBase: "http://publisher.test",
    publish: true,
    fetchImpl: async (url) => {
      const body = objects.get(keyFromUrl(url));
      return body ? streamingResponse(body) : missingResponse();
    },
    uploader: async ({ key, sourcePath }) => {
      uploads.push(key);
      objects.set(key, await readFile(sourcePath));
      if (key.endsWith(".bin")) await writeFile(input.manifestPath, "manifest changed\n");
    },
  });
  assert.equal(result.finalManifest, "uploaded-verified");
  assert.equal(uploads.filter((key) => key.endsWith(".json")).length, 1);
  assert.deepEqual(objects.get(result.manifestKey), originalManifest);
});

test("non-404 public failures stop before upload", async (t) => {
  const input = await fixture(t);
  const objects = new Map();
  const uploads = [];
  const publicBase = await localPublicServer(t, objects, new Map([[`${CHUNK_PREFIX}${input.firstSha}.bin`, 403]]));
  await assert.rejects(
    publishChunks({
      manifestPath: input.manifestPath,
      publicBase,
      publish: true,
      uploader: async () => { uploads.push(true); },
    }),
    /HTTP 403/u,
  );
  assert.equal(uploads.length, 0);
});

test("validation rejects a chunk symlink escaping the manifest directory", async (t) => {
  const input = await fixture(t);
  const outside = path.join(input.root, "outside.bin");
  await writeFile(outside, input.first);
  await unlink(path.join(input.chunksDir, `${input.firstSha}.bin`));
  await symlink(outside, path.join(input.chunksDir, `${input.firstSha}.bin`));
  await assert.rejects(validateLocalManifest(input.manifestPath), /escapes chunks directory/u);
});

test("validation rejects a non-256KiB manifest", async (t) => {
  const input = await fixture(t);
  const raw = JSON.parse(await readFile(input.manifestPath, "utf8"));
  raw.chunk_size = 128 * 1024;
  await writeFile(input.manifestPath, JSON.stringify(raw));
  await assert.rejects(validateLocalManifest(input.manifestPath), /chunk_size must be exactly 262144/u);
});
