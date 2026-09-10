#!/usr/bin/env node
// T03g: an isolated two-byte LP_NUM_THREADS candidate; no release writes.
import assert from "node:assert/strict";
import { execFile as callbackExec } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { BASE_SHA256, BASE_SIZE, DEFAULT_SOURCE, DECLARED_FILES, parsePhysicalBlock } from "./omarchy-softpipe-candidate.mjs";

const execFile = promisify(callbackExec);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const OLD = Buffer.from("LP_NUM_THREADS=1");
export const NEW = Buffer.from("LP_NUM_THREADS=0");
const DEBUGFS = "sha256:6df4c3fafd2db3b394b7e1836dc626fedbd57706330edc6c5a66f488f081791a";
const BLOCK_SIZE = 4096;
const HASH = /^[0-9a-f]{64}$/u;

export function planThreadPatch({ pathname, data, metadata }) {
  assert.ok(DECLARED_FILES.includes(pathname), "undeclared environment path");
  assert.ok(Buffer.isBuffer(data) && data.length === metadata.size && data.length <= BLOCK_SIZE);
  assert.equal(metadata.blockCount, 8, "expected one ext4 data block");
  assert.ok(Number.isSafeInteger(metadata.physicalBlock) && metadata.physicalBlock > 0);
  const at = data.indexOf(OLD);
  assert.ok(at >= 0 && data.indexOf(OLD, at + 1) < 0, "expected exactly one LP_NUM_THREADS=1");
  assert.equal(OLD.length, NEW.length);
  const offset = metadata.physicalBlock * BLOCK_SIZE + at + OLD.length - 1;
  assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset < BASE_SIZE);
  return { path: pathname, absoluteOffset: offset, length: 1, oldHex: "31", newHex: "30", metadata };
}

export function expectedBlock(base, offset, patches) {
  const here = patches.filter(patch => patch.absoluteOffset >= offset && patch.absoluteOffset < offset + base.length);
  if (!here.length) return { bytes: base, changed: 0 };
  const bytes = Buffer.from(base);
  for (const patch of here) {
    assert.equal(patch.length, 1); assert.equal(patch.oldHex, "31"); assert.equal(patch.newHex, "30");
    const at = patch.absoluteOffset - offset;
    assert.equal(bytes[at], 0x31, "planned source byte is not 1");
    bytes[at] = 0x30;
  }
  return { bytes, changed: here.length };
}

async function hashFile(filename) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(filename)) digest.update(bytes);
  return digest.digest("hex");
}

export async function verifyImages(source, candidate, patches) {
  assert.equal(patches.length, 2);
  assert.notEqual(patches[0].absoluteOffset, patches[1].absoluteOffset);
  const sourceHash = createHash("sha256"), candidateHash = createHash("sha256");
  const a = createReadStream(source, { highWaterMark: 1024 * 1024 });
  const b = createReadStream(candidate, { highWaterMark: 1024 * 1024 });
  const iterator = b[Symbol.asyncIterator]();
  let offset = 0, changed = 0;
  try {
    for await (const original of a) {
      const next = await iterator.next();
      assert.equal(next.done, false, "candidate truncated");
      const actual = next.value;
      assert.equal(actual.length, original.length);
      sourceHash.update(original); candidateHash.update(actual);
      const expected = expectedBlock(original, offset, patches);
      assert.ok(actual.equals(expected.bytes), "candidate differs outside the two prescribed bytes");
      changed += expected.changed; offset += original.length;
    }
    assert.equal((await iterator.next()).done, true, "candidate has trailing bytes");
  } finally { a.destroy(); b.destroy(); }
  assert.equal(offset, BASE_SIZE); assert.equal(changed, 2);
  const sourceSha256 = sourceHash.digest("hex"), candidateSha256 = candidateHash.digest("hex");
  assert.equal(sourceSha256, BASE_SHA256, "source changed during preparation");
  return { sourceSha256, candidateSha256, changedBytes: changed, size: offset };
}

function metadataFrom(stat, physicalBlock) {
  const number = (regex) => { const match = stat.match(regex); assert.ok(match, `missing stat field ${regex}`); return Number(match[1]); };
  return {
    inode: number(/\bInode:\s+(\d+)/u), mode: stat.match(/\bMode:\s+([0-7]+)/u)?.[1],
    uid: number(/\bUser:\s+(\d+)/u), gid: number(/\bGroup:\s+(\d+)/u),
    size: number(/\bSize:\s+(\d+)/u), blockCount: number(/\bBlockcount:\s+(\d+)/u), physicalBlock,
  };
}

export async function prepareThreadCandidate({ source, out }) {
  source = path.resolve(source); out = path.resolve(out);
  assert.equal(await fs.realpath(source), source, "source path must not contain symlinks");
  assert.equal(await fs.realpath(path.dirname(out)), path.dirname(out), "output parent must be an existing canonical directory");
  assert.ok(!/[\r\n:]/u.test(source), "source path cannot alter a Docker volume specification");
  const info = await fs.lstat(source);
  assert.ok(info.isFile() && !info.isSymbolicLink()); assert.equal(info.size, BASE_SIZE);
  assert.equal(await hashFile(source), BASE_SHA256, "source is not the verified SDR image");
  await fs.mkdir(out, { mode: 0o700 }); // Exclusive: preserve every earlier candidate/run.
  const candidate = path.join(out, "omarchy-profile-lp0.ext4");
  const commands = [];
  const run = async (command, args, options = {}) => {
    const result = await execFile(command, args, { maxBuffer: 1024 * 1024, ...options });
    commands.push({ command, args, stdout: Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout,
      stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr });
    return result.stdout;
  };
  const inspect = async (image, pathname) => {
    const debugfs = async (expression) => run("docker", ["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "-v", `${image}:/image:ro`, DEBUGFS, "debugfs", "-R", expression, "/image"]);
    const stat = String(await debugfs(`stat ${pathname}`));
    const block = parsePhysicalBlock(String(await debugfs(`bmap ${pathname} 0`)));
    const data = Buffer.from(await debugfs(`cat ${pathname}`));
    return { pathname, stat, data, metadata: metadataFrom(stat, block) };
  };
  const sourceFiles = [];
  for (const pathname of DECLARED_FILES) sourceFiles.push(await inspect(source, pathname));
  const patches = sourceFiles.map(planThreadPatch);
  assert.notEqual(patches[0].absoluteOffset, patches[1].absoluteOffset);
  // This task is recorded on the Mac; failure never falls back to overwriting.
  await run("cp", ["-c", source, candidate]);
  const handle = await fs.open(candidate, "r+");
  try {
    for (const patch of patches) {
      const byte = Buffer.alloc(1);
      assert.equal((await handle.read(byte, 0, 1, patch.absoluteOffset)).bytesRead, 1);
      assert.equal(byte[0], 0x31);
      assert.equal((await handle.write(Buffer.from([0x30]), 0, 1, patch.absoluteOffset)).bytesWritten, 1);
    }
  } finally { await handle.close(); }
  const hashes = await verifyImages(source, candidate, patches);
  const metadata = [];
  for (const before of sourceFiles) {
    const after = await inspect(candidate, before.pathname);
    assert.deepEqual(after.metadata, before.metadata, "inode ownership/mode/allocation changed");
    assert.equal(after.stat, before.stat, "ext4 inode metadata changed");
    assert.deepEqual(after.data, Buffer.from(before.data.toString("utf8").replace(OLD.toString(), NEW.toString())));
    metadata.push({ path: before.pathname, source: before.metadata, candidate: after.metadata, stat: before.stat });
  }
  assert.match(hashes.candidateSha256, HASH);
  const receipt = { schema: "wasm-vm.e5.5-t03g.thread-candidate.v1", task: "E5.5-T03g", result: "passed",
    source: { path: path.relative(repo, source), size: BASE_SIZE, sha256: hashes.sourceSha256 },
    candidate: { path: path.relative(repo, candidate), size: BASE_SIZE, sha256: hashes.candidateSha256 },
    changedBytes: hashes.changedBytes, debugfsImageId: DEBUGFS, patches, metadata, commands };
  await fs.writeFile(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  return receipt;
}

async function main() {
  const args = process.argv.slice(2);
  assert.equal(args.shift(), "prepare", "usage: omarchy-thread-candidate.mjs prepare --out NEW_DIR [--source IMAGE]");
  const opts = { source: path.join(repo, DEFAULT_SOURCE) };
  while (args.length) { const key = args.shift(); assert.ok(["--out", "--source"].includes(key) && args.length); opts[key.slice(2)] = args.shift(); }
  assert.ok(opts.out);
  const receipt = await prepareThreadCandidate(opts);
  console.log(JSON.stringify({ task: receipt.task, result: receipt.result, candidate: receipt.candidate, patches: receipt.patches }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
