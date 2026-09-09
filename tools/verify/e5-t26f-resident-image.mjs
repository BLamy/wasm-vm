#!/usr/bin/env node
// Build-only, offline overlay. This does not boot a guest or prove F acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = "target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4";
export const BASE_SHA256 = "5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550";
export const BASE_SIZE = 1073741824;
export const HELPER = "tools/guest/e5-t26f-resident-aplay.sh";
export const GUEST_PATH = "/usr/libexec/wasm-vm/e5t26f-resident.sh";
export const EPOCH = 1731542400;
const BUILDER = "wasm-vm-rootfs-build:local";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const exec = promisify(execFile);

export async function sha256File(filename) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest("hex");
}

export function parseArguments(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { "--out": "out", "--helper-sha256": "helperSha256" }[args[i]];
    assert.ok(key && result[key] === undefined && args[i + 1], "expected --out DIR --helper-sha256 FROZEN_SHA256 (no duplicate/unknown options)");
    result[key] = args[i + 1];
  }
  assert.ok(result.out, "explicit fresh --out directory required");
  assert.match(result.helperSha256 ?? "", /^[0-9a-f]{64}$/u, "explicit frozen --helper-sha256 required");
  return result;
}

async function noSymlinks(filename, io) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const stat = await io.lstat(current).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert.ok(!stat?.isSymbolicLink(), `refusing symlink: ${current}`);
  }
}

export async function guardOutput(repo, out, io = fs) {
  assert.ok(typeof out === "string" && out.length, "explicit fresh output required");
  const destination = path.resolve(repo, out);
  const root = path.resolve(repo, "target/e5-t26f");
  assert.ok(destination.startsWith(`${root}${path.sep}`), "output must be below target/e5-t26f");
  assert.doesNotMatch(destination, /[,\r\n\0]/u, "unsafe Docker mount path");
  await noSymlinks(destination, io);
  const entries = await io.readdir(destination).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.equal(entries.length, 0, "refusing nonempty output directory; use a fresh run directory");
  return destination;
}

export function appendFileManifest(original, helperSha256) {
  assert.match(helperSha256, /^[0-9a-f]{64}$/u);
  assert.ok(original.length > 0 && original.endsWith("\n"), "base FILE-MANIFEST must end in newline");
  const seen = new Set();
  for (const line of original.trimEnd().split("\n")) {
    const match = /^(?:[0-9a-f]{64}|directory) 0[0-7]{3} (\/[^\r\n]+)$/u.exec(line);
    assert.ok(match && !seen.has(match[1]), "malformed or duplicate FILE-MANIFEST entry");
    seen.add(match[1]);
  }
  assert.ok(!seen.has(GUEST_PATH), "resident helper already present in base manifest");
  return `${original}${helperSha256} 0444 ${GUEST_PATH}\n`;
}

export function inodeCommands() {
  const lines = [`write /helper ${GUEST_PATH}`];
  for (const [field, value] of Object.entries({ mode: "0100444", uid: 0, gid: 0, generation: 0, dtime: 0 })) {
    lines.push(`set_inode_field ${GUEST_PATH} ${field} ${value}`);
  }
  for (const field of ["atime", "mtime", "ctime", "crtime"]) {
    lines.push(`set_inode_field ${GUEST_PATH} ${field} ${EPOCH}`);
    lines.push(`set_inode_field ${GUEST_PATH} ${field}_extra 0`);
  }
  return `${lines.join("\n")}\n`;
}

export const OVERLAY_SCRIPT = `set -euo pipefail
export LC_ALL=C TZ=UTC E2FSPROGS_FAKE_TIME=${EPOCH}
debugfs -V > /out/tool-version.log 2>&1
apk info -v | grep -E '^e2fsprogs(-extra)?-[0-9]' | sort > /out/tool-packages.log
debugfs -R 'stat /usr/libexec/wasm-vm' /base > /out/parent-stat.txt 2>&1
grep -Eq 'Type: directory' /out/parent-stat.txt
debugfs -R 'stat ${GUEST_PATH}' /base > /out/absent-stat.txt 2>&1
grep -Fq 'File not found by ext2_lookup' /out/absent-stat.txt
! grep -Eq 'Inode: [0-9]+' /out/absent-stat.txt
debugfs -w -f /out/install.debugfs /out/alpine-rootfs.ext4 > /out/debugfs.log 2>&1
debugfs -R 'dump ${GUEST_PATH} /out/resident-readback.sh' /out/alpine-rootfs.ext4 >> /out/debugfs.log 2>&1
cmp /helper /out/resident-readback.sh
debugfs -R 'stat ${GUEST_PATH}' /out/alpine-rootfs.ext4 > /out/resident-stat.txt 2>&1
fsck.ext4 -f -n /out/alpine-rootfs.ext4 > /out/fsck.log 2>&1
`;

export function dockerArguments({ base, helper, out, imageId }) {
  for (const filename of [base, helper, out]) {
    assert.ok(path.isAbsolute(filename));
    assert.doesNotMatch(filename, /[,\r\n\0]/u, "unsafe Docker mount path");
  }
  assert.match(imageId, /^sha256:[0-9a-f]{64}$/u, "missing local builder image ID");
  return ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,nodev", "--user", "0:0",
    "--mount", `type=bind,src=${base},dst=/base,readonly`,
    "--mount", `type=bind,src=${helper},dst=/helper,readonly`,
    "--mount", `type=bind,src=${out},dst=/out`,
    "--entrypoint", "/bin/bash", imageId, "-c", OVERLAY_SCRIPT];
}

export function validateInodeStat(text, helperSize) {
  assert.match(text, /Type: regular\s+Mode:\s+0444\b/u, "helper mode/type differs");
  assert.match(text, /User:\s+0\s+Group:\s+0\b/u, "helper must be root:root");
  assert.match(text, /Links:\s+1\b/u, "helper must be one new regular file");
  assert.equal(Number(/\bSize:\s+(\d+)/u.exec(text)?.[1]), helperSize, "helper inode size differs");
  assert.match(text, /Generation:\s+0\b/u, "inode generation differs");
  for (const field of ["atime", "mtime", "ctime", "crtime"]) {
    assert.match(text, new RegExp(`\\b${field}: 0x${EPOCH.toString(16)}:00000000\\b`, "u"), `nonfixed ${field}`);
  }
}

// Injected command/hash/filesystem dependencies keep guard tests cheap; CLI uses real IO only.
export async function buildResidentImage({ out, helperSha256, repo = REPO }, { io = fs, hashFile = sha256File,
  run = (command, args) => exec(command, args, { timeout: 300_000, maxBuffer: 1024 * 1024 }) } = {}) {
  assert.match(helperSha256 ?? "", /^[0-9a-f]{64}$/u, "frozen helper SHA256 required");
  const destination = await guardOutput(repo, out, io); // Refusal never writes into protected outputs.
  const base = path.resolve(repo, BASE), helper = path.resolve(repo, HELPER);
  const baseDir = path.dirname(base);
  for (const filename of [base, helper, ...["desktop-info.json", "MANIFEST.txt", "FILE-MANIFEST.txt"].map(name => path.join(baseDir, name))]) {
    await noSymlinks(filename, io);
    assert.ok((await io.lstat(filename)).isFile(), `regular input required: ${filename}`);
  }
  const verifyInputs = async () => {
    assert.equal((await io.lstat(base)).size, BASE_SIZE, "base image size differs");
    assert.equal(await hashFile(base), BASE_SHA256, "base image SHA256 differs");
    assert.equal(await hashFile(helper), helperSha256, "frozen helper SHA256 differs");
  };
  await verifyInputs();
  const helperBytes = await io.readFile(helper);
  assert.equal(digest(helperBytes), helperSha256, "helper changed while reading");
  assert.ok(helperBytes.length > 0, "empty helper refused");
  const baseInfoBytes = await io.readFile(path.join(baseDir, "desktop-info.json"));
  const baseInfo = JSON.parse(baseInfoBytes);
  assert.equal(baseInfo.schema, "wasm-vm.e5-t26f.desktop-image-info.v1");
  assert.equal(baseInfo.architecture, "riscv64");
  assert.deepEqual(baseInfo.image, { path: BASE, sha256: BASE_SHA256, size: BASE_SIZE });
  const packageBytes = await io.readFile(path.join(baseDir, "MANIFEST.txt"));
  const fileBytes = await io.readFile(path.join(baseDir, "FILE-MANIFEST.txt"));
  assert.equal(baseInfo.packageManifest.path, `${path.dirname(BASE)}/MANIFEST.txt`);
  assert.equal(baseInfo.fileManifest.path, `${path.dirname(BASE)}/FILE-MANIFEST.txt`);
  assert.equal(digest(packageBytes), baseInfo.packageManifest.sha256, "base package lock SHA256 differs");
  assert.equal(digest(fileBytes), baseInfo.fileManifest.sha256, "base FILE-MANIFEST SHA256 differs");
  const appended = appendFileManifest(fileBytes.toString("utf8"), helperSha256);
  const { stdout } = await run("docker", ["image", "inspect", "--format", "{{.Id}}", BUILDER]);
  const imageId = stdout.trim();
  const args = dockerArguments({ base, helper, out: destination, imageId });
  // Recheck after preflight, then claim ownership with an exclusive marker. Never retry in-place.
  await guardOutput(repo, destination, io);
  await io.mkdir(destination, { recursive: true });
  const write = (name, bytes) => io.writeFile(path.join(destination, name), bytes, { flag: "wx" });
  await write(".e5-t26f-resident-image.json", `${JSON.stringify({ kind: "resident-aplay-v1", baseSha256: BASE_SHA256, helperSha256 })}\n`);
  let outputHash, failure;
  try {
    const image = path.join(destination, "alpine-rootfs.ext4");
    await io.copyFile(base, image, constants.COPYFILE_EXCL);
    assert.equal(await hashFile(image), BASE_SHA256, "initial image copy is not byte-identical to base");
    await write("install.debugfs", inodeCommands());
    await run("docker", args);
    assert.equal(await io.readFile(path.join(destination, "tool-packages.log"), "utf8"), "e2fsprogs-1.47.0-r5\ne2fsprogs-extra-1.47.0-r5\n", "local e2fsprogs packages differ from pinned builder");
    assert.deepEqual(await io.readFile(path.join(destination, "resident-readback.sh")), helperBytes, "installed helper readback differs");
    validateInodeStat(await io.readFile(path.join(destination, "resident-stat.txt"), "utf8"), helperBytes.length);
    assert.equal((await io.lstat(image)).size, BASE_SIZE, "output image size changed");
    outputHash = await hashFile(image);
    assert.notEqual(outputHash, BASE_SHA256, "overlay did not change the image");
    await write("MANIFEST.txt", packageBytes);
    await write("FILE-MANIFEST.txt", appended);
    assert.deepEqual(await io.readFile(path.join(destination, "MANIFEST.txt")), packageBytes, "package lock copy differs");
  } catch (error) {
    failure = error;
  } finally {
    // Also verify immutable sources when Docker, fsck, or a readback check fails.
    try { await verifyInputs(); } catch (error) {
      failure = failure ? new AggregateError([failure, error], "overlay failed and input preservation failed") : error;
    }
  }
  if (failure) {
    await write("build-failure.json", `${JSON.stringify({ acceptance: false, error: String(failure),
      causes: failure.errors?.map(String), baseSha256: BASE_SHA256, helperSha256 }, null, 2)}\n`);
    throw failure;
  }
  const relative = name => path.relative(repo, path.join(destination, name));
  const info = { ...baseInfo,
    image: { path: relative("alpine-rootfs.ext4"), sha256: outputHash, size: BASE_SIZE },
    packageManifest: { path: relative("MANIFEST.txt"), sha256: digest(packageBytes) },
    fileManifest: { path: relative("FILE-MANIFEST.txt"), sha256: digest(appended) },
    fixture: { kind: "resident-aplay-v1", helperPath: HELPER, helperSha256, helperSize: helperBytes.length,
      guestPath: GUEST_PATH, mode: "0444", uid: 0, gid: 0, epoch: EPOCH,
      basePath: BASE, baseSha256: BASE_SHA256, baseSize: BASE_SIZE, basePreserved: true,
      baseInfoSha256: digest(baseInfoBytes), baseFileManifestSha256: digest(fileBytes),
      builder: { tag: BUILDER, imageId, e2fsprogs: "1.47.0-r5" }, readbackSha256: helperSha256 } };
  await write("desktop-info.json", `${JSON.stringify(info, null, 2)}\n`);
  await write("SHA256SUMS", `${info.packageManifest.sha256}  MANIFEST.txt\n${info.fileManifest.sha256}  FILE-MANIFEST.txt\n`);
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildResidentImage(parseArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
