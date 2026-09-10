#!/usr/bin/env node
// Publish a validated Omarchy split-256 KiB chunk set to public R2.
// Default mode is a local, read-only plan. OAuth is delegated to Wrangler only with --publish;
// this tool never reads or prints Cloudflare credentials.

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const DEFAULT_PUBLIC_BASE = "https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev";
export const DEFAULT_BUCKET = "wasm-vm";
export const CHUNK_SIZE = 256 * 1024;
export const CONCURRENCY = 4;
export const PUBLIC_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;
export const CHUNK_PREFIX = "chunked-omarchy/chunks/";
export const MANIFEST_PREFIX = "chunked-omarchy/manifest-";
const SHA256 = /^[0-9a-f]{64}$/u;
const execFile = promisify(execFileCallback);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(message);
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function orderedImageSha256(manifest, objects) {
  const byHash = new Map(objects.map((object) => [object.hash, object]));
  const hash = createHash("sha256");
  for (const chunkHash of manifest.chunks) {
    const object = byHash.get(chunkHash);
    if (!object) fail(`manifest chunk object is unavailable: ${chunkHash}`);
    for await (const chunk of createReadStream(object.path)) hash.update(chunk);
  }
  return hash.digest("hex");
}

async function scriptProvenance() {
  const scriptPath = fileURLToPath(import.meta.url);
  let frozenHead = null;
  try {
    const result = await execFile("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
    const head = result.stdout.trim();
    if (/^[0-9a-f]{40,64}$/u.test(head)) frozenHead = head;
  } catch {
    // A copied tool can still bind its exact script digest when git metadata is unavailable.
  }
  return { scriptPath, scriptSha256: await sha256File(scriptPath), frozenHead };
}

function expectedChunkLength(imageLength, index, count) {
  const start = index * CHUNK_SIZE;
  const remaining = imageLength - start;
  return index === count - 1 ? remaining : CHUNK_SIZE;
}

function validatePublicBase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`invalid public base URL: ${value}`);
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password) {
    fail("public base must be an http(s) URL without credentials");
  }
  return parsed.href.replace(/\/+$/u, "");
}

function validateBucket(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u.test(value)) fail("invalid R2 bucket name");
  return value;
}

function publicUrl(publicBase, key) {
  return `${publicBase}/${key}`;
}

/**
 * Validate the strict split-256 KiB manifest and every unique local object.
 * The returned paths are realpath-checked so a declared object cannot escape the manifest's
 * sibling chunks directory through a symlink.
 */
export async function validateLocalManifest(manifestPath) {
  const resolvedManifest = path.resolve(manifestPath);
  const raw = await readFile(resolvedManifest);
  const rawSha = sha256(raw);
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail(`manifest is not valid JSON: ${error.message}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest must be an object");
  if (manifest.version !== 1) fail("manifest version must be 1");
  if (manifest.layout !== "split") fail("manifest layout must be split");
  if (manifest.chunk_size !== CHUNK_SIZE) fail(`manifest chunk_size must be exactly ${CHUNK_SIZE}`);
  if (!Number.isSafeInteger(manifest.image_len) || manifest.image_len <= 0) fail("manifest image_len must be a positive safe integer");
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length !== Math.ceil(manifest.image_len / CHUNK_SIZE)) {
    fail("manifest chunks length does not match image_len/chunk_size");
  }

  const objectLengths = new Map();
  for (const [index, hash] of manifest.chunks.entries()) {
    if (typeof hash !== "string" || !SHA256.test(hash)) fail(`manifest chunk ${index} is not a lowercase SHA-256 digest`);
    const length = expectedChunkLength(manifest.image_len, index, manifest.chunks.length);
    const prior = objectLengths.get(hash);
    if (prior !== undefined && prior !== length) fail(`chunk ${hash} is reused with conflicting lengths`);
    objectLengths.set(hash, length);
  }

  const chunksDir = path.resolve(path.dirname(resolvedManifest), "chunks");
  const realChunksDir = await realpath(chunksDir).catch(() => fail(`missing chunks directory: ${chunksDir}`));
  const entries = await readdir(chunksDir, { withFileTypes: true });
  const expectedNames = new Set([...objectLengths.keys()].map((hash) => `${hash}.bin`));
  for (const entry of entries) {
    if (!expectedNames.has(entry.name)) fail(`unexpected local chunk object: ${path.join(chunksDir, entry.name)}`);
    if (!entry.isFile() && !entry.isSymbolicLink()) fail(`chunk object is not a file: ${path.join(chunksDir, entry.name)}`);
  }

  const objects = [];
  for (const [hash, expectedSize] of objectLengths) {
    const filePath = path.resolve(chunksDir, `${hash}.bin`);
    if (!inside(chunksDir, filePath)) fail(`chunk path escapes chunks directory: ${filePath}`);
    const realFile = await realpath(filePath).catch(() => fail(`missing local chunk object: ${filePath}`));
    if (!inside(realChunksDir, realFile)) fail(`chunk symlink escapes chunks directory: ${filePath}`);
    const fileStat = await stat(realFile);
    if (!fileStat.isFile()) fail(`chunk object is not a regular file: ${filePath}`);
    if (fileStat.size !== expectedSize) fail(`${filePath}: expected ${expectedSize} bytes, got ${fileStat.size}`);
    const actualSha = await sha256File(realFile);
    if (actualSha !== hash) fail(`${filePath}: expected SHA-256 ${hash}, got ${actualSha}`);
    objects.push({ hash, path: realFile, chunksDir: realChunksDir, size: expectedSize, key: `${CHUNK_PREFIX}${hash}.bin` });
  }

  return {
    manifest,
    manifestPath: resolvedManifest,
    manifestBytes: raw,
    rawSha,
    imageSha256: await orderedImageSha256(manifest, objects),
    chunksDir: realChunksDir,
    objects,
    manifestKey: `${MANIFEST_PREFIX}${rawSha}.json`,
  };
}

async function disposeResponseBody(response) {
  const body = response?.body;
  if (!body) return;
  try {
    if (typeof body.cancel === "function") {
      await body.cancel();
      return;
    }
    if (typeof body.getReader === "function") {
      const reader = body.getReader();
      if (typeof reader.cancel === "function") await reader.cancel();
    }
  } catch {
    // The status code is already authoritative; disposal is best-effort cleanup.
  }
}

async function readResponseDigest(response, limit) {
  if (!response.body || typeof response.body.getReader !== "function") fail("public GET response has no streaming body");
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const length = value?.byteLength ?? 0;
    size += length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return { size, sha256: null, tooLarge: true };
    }
    hash.update(value);
  }
  return { size, sha256: hash.digest("hex"), tooLarge: false };
}

export async function checkPublicObject({ fetchImpl, publicBase, key, expectedSize, expectedSha, timeoutMs = PUBLIC_TIMEOUT_MS }) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`public GET timed out for ${key}`));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => fetchImpl(publicUrl(publicBase, key), { signal: controller.signal })),
      timeout,
    ]);
    if (response.status === 404) {
      controller.abort();
      await Promise.race([disposeResponseBody(response), timeout]);
      return { state: "missing", status: 404 };
    }
    if (response.status !== 200) {
      controller.abort();
      await Promise.race([disposeResponseBody(response), timeout]);
      return { state: "error", status: response.status };
    }
    const digest = await Promise.race([readResponseDigest(response, expectedSize), timeout]);
    const exact = !digest.tooLarge && digest.size === expectedSize && digest.sha256 === expectedSha;
    return { state: exact ? "exact" : "mismatch", status: 200, size: digest.size, sha256: digest.sha256 };
  } finally {
    clearTimeout(timer);
  }
}

function runWranglerUpload({ bucket, key, sourcePath, timeoutMs = UPLOAD_TIMEOUT_MS, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(
      "npx",
      ["--yes", "wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", sourcePath, "--remote", "-y"],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`Wrangler upload timed out for ${key}`));
    }, timeoutMs);
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`Wrangler upload failed for ${key} (exit ${code ?? "null"}, signal ${signal ?? "none"})`));
    });
  });
}

async function verifyLocalObject(object) {
  const realFile = await realpath(object.path).catch(() => fail(`missing local chunk object: ${object.path}`));
  if (!inside(object.chunksDir, realFile)) fail(`chunk symlink escapes chunks directory: ${object.path}`);
  const fileStat = await stat(realFile);
  if (!fileStat.isFile()) fail(`chunk object is not a regular file: ${object.path}`);
  if (fileStat.size !== object.size) fail(`${object.path}: source size changed before upload`);
  const actualSha = await sha256File(realFile);
  if (actualSha !== object.hash) fail(`${object.path}: source SHA-256 changed before upload`);
  return realFile;
}

async function verifyManifestSource(validated) {
  const currentManifest = await readFile(validated.manifestPath);
  if (sha256(currentManifest) !== validated.rawSha || !currentManifest.equals(validated.manifestBytes)) {
    fail(`manifest source changed before upload: ${validated.manifestPath}`);
  }
}

async function cleanupStage(stage) {
  await rm(stage.path, { force: true }).catch(() => {});
  await rmdir(stage.directory).catch(() => {});
}

async function stageChunk(object) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omarchy-publish-stage-"));
  const stagedPath = path.join(directory, `${object.hash}.bin`);
  try {
    await chmod(directory, 0o700);
    await copyFile(object.path, stagedPath, constants.COPYFILE_EXCL);
    const fileStat = await stat(stagedPath);
    const actualSha = await sha256File(stagedPath);
    if (fileStat.size !== object.size || actualSha !== object.hash) {
      fail(`${object.path}: staged source bytes failed size/hash verification`);
    }
    await chmod(stagedPath, 0o400);
    return { directory, path: stagedPath };
  } catch (error) {
    await cleanupStage({ directory, path: stagedPath });
    throw error;
  }
}

async function stageManifest(validated) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omarchy-publish-stage-"));
  const stagedPath = path.join(directory, "manifest.json");
  try {
    await chmod(directory, 0o700);
    await writeFile(stagedPath, validated.manifestBytes, { flag: "wx", mode: 0o600 });
    const fileStat = await stat(stagedPath);
    if (fileStat.size !== validated.manifestBytes.length || await sha256File(stagedPath) !== validated.rawSha) {
      fail("staged manifest bytes failed size/hash verification");
    }
    await chmod(stagedPath, 0o400);
    return { directory, path: stagedPath };
  } catch (error) {
    await cleanupStage({ directory, path: stagedPath });
    throw error;
  }
}

async function ensureUploaded({ object, bucket, publicBase, fetchImpl, uploader, timeoutMs }) {
  const before = await checkPublicObject({ fetchImpl, publicBase, key: object.key, expectedSize: object.size, expectedSha: object.hash, timeoutMs });
  if (before.state === "error") fail(`public GET failed for ${object.key}: HTTP ${before.status}`);
  if (before.state === "exact") return { state: "existing", status: before.status };
  if (before.state === "mismatch") fail(`public object exists with mismatched bytes; refusing to overwrite ${object.key}`);
  await verifyLocalObject(object);
  const stage = await stageChunk(object);
  try {
    await uploader({ bucket, key: object.key, sourcePath: stage.path });
    const after = await checkPublicObject({ fetchImpl, publicBase, key: object.key, expectedSize: object.size, expectedSha: object.hash, timeoutMs });
    if (after.state !== "exact") fail(`post-upload public verification failed for ${object.key}: ${after.state} HTTP ${after.status}`);
    return { state: "uploaded", status: after.status };
  } finally {
    await cleanupStage(stage);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

/**
 * Validate and either plan or publish a chunk set. In plan mode no public GET and no uploader are
 * called. Tests can inject fetchImpl/uploader; production publish delegates only to Wrangler.
 */
export async function publishChunks({
  manifestPath,
  publicBase = process.env.R2_PUBLIC || DEFAULT_PUBLIC_BASE,
  bucket = process.env.R2_BUCKET || DEFAULT_BUCKET,
  publish = false,
  fetchImpl = globalThis.fetch,
  uploader = runWranglerUpload,
  publicTimeoutMs = PUBLIC_TIMEOUT_MS,
  validatedManifest = null,
  provenance = null,
  onProgress = () => {},
}) {
  if (!manifestPath) fail("manifest path is required");
  publicBase = validatePublicBase(publicBase);
  bucket = validateBucket(bucket);
  if (typeof fetchImpl !== "function") fail("fetch is unavailable");
  const validated = validatedManifest || await validateLocalManifest(manifestPath);
  const sourceProvenance = provenance || await scriptProvenance();
  const result = {
    mode: publish ? "publish" : "plan",
    publicBase,
    bucket,
    manifestPath: validated.manifestPath,
    manifestSha256: validated.rawSha,
    imageSha256: validated.imageSha256,
    imageLength: validated.manifest.image_len,
    provenance: sourceProvenance,
    manifestKey: validated.manifestKey,
    totalUniqueObjects: validated.objects.length,
    totalManifestChunks: validated.manifest.chunks.length,
    totalBytes: validated.objects.reduce((sum, object) => sum + object.size, 0),
    verifiedExisting: 0,
    racedExisting: 0,
    uploaded: 0,
    finalManifest: "not-published",
  };
  if (!publish) {
    onProgress({ phase: "plan", processed: 0, total: validated.objects.length });
    return result;
  }

  // Preflight every public object before the first write. A concurrent 403/5xx must not allow a
  // different 404 object to upload and leave a partially published set behind.
  const preflight = await mapLimit(validated.objects, CONCURRENCY, async (object, index) => {
    const check = await checkPublicObject({
      fetchImpl,
      publicBase,
      key: object.key,
      expectedSize: object.size,
      expectedSha: object.hash,
      timeoutMs: publicTimeoutMs,
    });
    if (check.state === "error") fail(`public GET failed for ${object.key}: HTTP ${check.status}`);
    onProgress({ phase: "preflight", processed: index + 1, total: validated.objects.length, state: check.state });
    return { object, check };
  });
  const preflightExisting = preflight.filter(({ check }) => check.state === "exact").length;
  result.verifiedExisting = preflightExisting;
  const mismatch = preflight.find(({ check }) => check.state === "mismatch");
  if (mismatch) fail(`public object exists with mismatched bytes; refusing to overwrite ${mismatch.object.key}`);
  await mapLimit(
    preflight.filter(({ check }) => check.state !== "exact"),
    CONCURRENCY,
    async ({ object }) => verifyLocalObject(object),
  );
  await verifyManifestSource(validated);

  let processed = 0;
  const pending = preflight.filter(({ check }) => check.state !== "exact");
  const outcomes = await mapLimit(
    pending,
    CONCURRENCY,
    async ({ object }) => {
      const outcome = await ensureUploaded({ object, bucket, publicBase, fetchImpl, uploader, timeoutMs: publicTimeoutMs });
      processed += 1;
      if (outcome.state === "uploaded") result.uploaded += 1;
      else if (outcome.state === "existing") result.racedExisting += 1;
      onProgress({ phase: "chunks", processed, total: validated.objects.length, state: outcome.state });
      return outcome;
    },
  );
  assert.equal(outcomes.length, pending.length);

  const finalKey = validated.manifestKey;
  const finalBytes = validated.manifestBytes;
  const final = await checkPublicObject({
    fetchImpl,
    publicBase,
    key: finalKey,
    expectedSize: finalBytes.length,
    expectedSha: validated.rawSha,
    timeoutMs: publicTimeoutMs,
  });
  if (final.state === "error") fail(`public GET failed for immutable manifest ${finalKey}: HTTP ${final.status}`);
  if (final.state === "mismatch") fail(`immutable manifest already exists with different bytes: ${finalKey}`);
  if (final.state === "exact") {
    result.finalManifest = "existing-exact";
  } else {
    const stage = await stageManifest(validated);
    try {
      await uploader({ bucket, key: finalKey, sourcePath: stage.path });
      const verified = await checkPublicObject({
        fetchImpl,
        publicBase,
        key: finalKey,
        expectedSize: finalBytes.length,
        expectedSha: validated.rawSha,
        timeoutMs: publicTimeoutMs,
      });
      if (verified.state !== "exact") fail(`post-upload immutable manifest verification failed: ${finalKey}`);
      result.finalManifest = "uploaded-verified";
    } finally {
      await cleanupStage(stage);
    }
  }
  onProgress({ phase: "manifest", processed: validated.objects.length, total: validated.objects.length, state: result.finalManifest });
  return result;
}

async function makeReceiptDir(requested, rawSha) {
  const directory = requested
    ? path.resolve(requested)
    : path.join(repoRoot, "evidence", "omarchy-publish", `${rawSha.slice(0, 12)}-${Date.now()}-${randomBytes(3).toString("hex")}`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  return directory;
}

function parseArgs(argv) {
  const options = { manifestPath: null, publicBase: process.env.R2_PUBLIC || DEFAULT_PUBLIC_BASE, bucket: process.env.R2_BUCKET || DEFAULT_BUCKET, publish: false, receiptDir: null };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--publish") options.publish = true;
    else if (arg === "--public-base") options.publicBase = argv[++index] || fail("--public-base requires a URL");
    else if (arg === "--bucket") options.bucket = argv[++index] || fail("--bucket requires a name");
    else if (arg === "--receipt-dir") options.receiptDir = argv[++index] || fail("--receipt-dir requires a directory");
    else if (arg === "--manifest") options.manifestPath = argv[++index] || fail("--manifest requires a path");
    else if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg.startsWith("-")) fail(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (!options.manifestPath) options.manifestPath = positional.shift() || null;
  if (positional.length) fail(`unexpected argument: ${positional[0]}`);
  return options;
}

function usage() {
  return "usage: node tools/publish-omarchy-chunks.mjs MANIFEST.json [--publish] [--public-base URL] [--bucket NAME] [--receipt-dir DIR]";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`${usage()}\nDefault mode validates locally and prints a read-only plan. --publish is required for OAuth-backed Wrangler uploads.`);
    return;
  }
  if (!options.manifestPath) fail(usage());
  const validated = await validateLocalManifest(options.manifestPath);
  const provenance = await scriptProvenance();
  const receiptDir = await makeReceiptDir(options.receiptDir, validated.rawSha);
  const progressMarks = new Set();
  const onProgress = (event) => {
    if (event.phase === "plan" || event.phase === "manifest") return;
    const mark = Math.floor((event.processed / Math.max(1, event.total)) * 10);
    if (progressMarks.has(mark)) return;
    progressMarks.add(mark);
    console.log(`[omarchy-publish] ${event.processed}/${event.total} unique chunks processed`);
  };
  let result;
  try {
    result = await publishChunks({ ...options, validatedManifest: validated, provenance, onProgress });
    result.receiptDir = receiptDir;
    result.sampleKeys = [
      `${CHUNK_PREFIX}${validated.objects[0]?.hash || ""}.bin`,
      `${CHUNK_PREFIX}${validated.objects.at(-1)?.hash || ""}.bin`,
      validated.manifestKey,
    ].filter(Boolean);
    await writeFile(path.join(receiptDir, "receipt.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ ...result, receipt: path.join(receiptDir, "receipt.json") }, null, 2));
  } catch (error) {
    const failure = {
      mode: options.publish ? "publish" : "plan",
      result: "failed",
      error: error.message,
      manifestPath: path.resolve(options.manifestPath),
      manifestSha256: validated.rawSha,
      imageSha256: validated.imageSha256,
      imageLength: validated.manifest.image_len,
      provenance,
    };
    await writeFile(path.join(receiptDir, "receipt.json"), `${JSON.stringify(failure, null, 2)}\n`).catch(() => {});
    throw error;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(`[omarchy-publish] ERROR: ${error.message}`); process.exitCode = 1; });
