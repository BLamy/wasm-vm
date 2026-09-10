#!/usr/bin/env node
// Materialize the manifest-pinned desktop RAM image without putting 192 MiB in Git.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(repo, "web/artifacts-omarchy.json"), "utf8"));
const artifact = manifest.artifacts.bootSnapshot;
const relative = "releases/boot-snapshot/omarchy-ready.snap.gz";
assert.equal(artifact.url, relative, "expected a source manifest, not a rewritten deploy manifest");
assert.match(artifact.sha256, /^[a-f0-9]{64}$/u);
assert.ok(Number.isSafeInteger(artifact.size) && artifact.size > 0);
const destination = path.join(repo, relative);
async function verify(filename) {
  assert.equal((await fs.stat(filename)).size, artifact.size, `${filename}: size mismatch`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  assert.equal(hash.digest("hex"), artifact.sha256, `${filename}: SHA-256 mismatch`);
}
let exists = false;
try { await fs.access(destination); exists = true; } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (exists) {
  // Never overwrite a different local candidate or hide corrupt release bytes.
  await verify(destination);
  console.log(`Omarchy snapshot already exact: ${artifact.sha256}`);
} else {
  const url = `https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/${artifact.sha256}/${relative}`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download-${randomBytes(8).toString("hex")}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
    assert.ok(response.ok && response.body, `snapshot download failed: HTTP ${response.status}`);
    await pipeline(response.body, createWriteStream(temporary, { flags: "wx" }));
    await verify(temporary);
    // link is exclusive: a concurrently created destination is never replaced.
    await fs.link(temporary, destination);
    console.log(`Downloaded and verified Omarchy snapshot: ${artifact.sha256}`);
  } finally {
    await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}
