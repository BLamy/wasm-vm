#!/usr/bin/env node
// Offline two-file guest fixture overlay. No boot, runtime tuning or F acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, BASE_SHA256, BASE_SIZE, GUEST_PATH, EPOCH, guardOutput,
  sha256File, appendFileManifest, inodeCommands, validateInodeStat } from "./e5-t26f-resident-image.mjs";
import { OBSERVER_KIND, OBSERVER_SOURCE, OBSERVER_HELPER, OBSERVER_GUEST_PATH } from "./e5-t26f-resident-proof.mjs";
import { validateElf } from "./e5-t26f-observer-build.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILDER = "wasm-vm-rootfs-build:local";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const exec = promisify(execFile);

export function parseArguments(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { "--out": "out", "--helper-sha256": "helperSha256",
      "--build-dir": "buildDir", "--build-info-sha256": "buildInfoSha256" }[args[i]];
    assert.ok(key && result[key] === undefined && args[i + 1], "explicit output, helper SHA, build directory and build-info SHA required");
    result[key] = args[i + 1];
  }
  assert.ok(result.out && result.buildDir);
  for (const key of ["helperSha256", "buildInfoSha256"]) assert.match(result[key] ?? "", /^[0-9a-f]{64}$/u);
  return result;
}

export function observerInodeCommands() {
  return inodeCommands() + inodeCommands().replaceAll(GUEST_PATH, OBSERVER_GUEST_PATH)
    .replace("write /helper ", "write /observer ").replace("mode 0100444", "mode 0100555");
}

export const OVERLAY_SCRIPT = `set -euo pipefail
export LC_ALL=C TZ=UTC E2FSPROGS_FAKE_TIME=${EPOCH}
debugfs -V > /out/tool-version.log 2>&1
apk info -v | grep -E '^e2fsprogs(-extra)?-[0-9]' | sort > /out/tool-packages.log
debugfs -R 'stat /usr/libexec/wasm-vm' /base > /out/parent-stat.txt 2>&1
grep -Eq 'Type: directory' /out/parent-stat.txt
for file in ${GUEST_PATH} ${OBSERVER_GUEST_PATH}; do
  debugfs -R "stat $file" /base > /out/absent-stat.txt 2>&1
  grep -Fq 'File not found by ext2_lookup' /out/absent-stat.txt
  ! grep -Eq 'Inode: [0-9]+' /out/absent-stat.txt
done
debugfs -w -f /out/install.debugfs /out/alpine-rootfs.ext4 > /out/debugfs.log 2>&1
debugfs -R 'dump ${GUEST_PATH} /out/resident-readback.sh' /out/alpine-rootfs.ext4 >> /out/debugfs.log 2>&1
debugfs -R 'dump ${OBSERVER_GUEST_PATH} /out/observer-readback' /out/alpine-rootfs.ext4 >> /out/debugfs.log 2>&1
cmp /helper /out/resident-readback.sh
cmp /observer /out/observer-readback
debugfs -R 'stat ${GUEST_PATH}' /out/alpine-rootfs.ext4 > /out/resident-stat.txt 2>&1
debugfs -R 'stat ${OBSERVER_GUEST_PATH}' /out/alpine-rootfs.ext4 > /out/observer-stat.txt 2>&1
fsck.ext4 -f -n /out/alpine-rootfs.ext4 > /out/fsck.log 2>&1
`;

export function dockerArguments({ base, helper, observer, out, imageId }) {
  for (const value of [base, helper, observer, out]) {
    assert.ok(path.isAbsolute(value)); assert.doesNotMatch(value, /[,\r\n\0]/u);
  }
  assert.match(imageId, /^sha256:[0-9a-f]{64}$/u);
  return ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,nodev", "--user", "0:0",
    "--mount", `type=bind,src=${base},dst=/base,readonly`,
    "--mount", `type=bind,src=${helper},dst=/helper,readonly`,
    "--mount", `type=bind,src=${observer},dst=/observer,readonly`,
    "--mount", `type=bind,src=${out},dst=/out`,
    "--entrypoint", "/bin/bash", imageId, "-c", OVERLAY_SCRIPT];
}

export function validateObserverStat(text, size) {
  assert.match(text, /Type: regular\s+Mode:\s+0555\b/u, "observer must be read-only executable");
  validateInodeStat(text.replace(/Mode:\s+0555\b/u, "Mode: 0444"), size);
}

export async function buildObserverImage({ out, helperSha256, buildDir, buildInfoSha256, repo = REPO },
  { io = fs, hashFile = sha256File, run = (cmd, args) => exec(cmd, args, { timeout: 300_000, maxBuffer: 1024 * 1024 }) } = {}) {
  for (const sha of [helperSha256, buildInfoSha256]) assert.match(sha ?? "", /^[0-9a-f]{64}$/u);
  const destination = await guardOutput(repo, out, io);
  const build = path.resolve(repo, buildDir), taskRoot = path.resolve(repo, "target/e5-t26f");
  assert.ok(build.startsWith(`${taskRoot}${path.sep}`), "build input must be below task outputs");
  assert.notEqual(build, destination, "image output must not overwrite the compiled build");
  const base = path.resolve(repo, BASE), helper = path.resolve(repo, OBSERVER_HELPER);
  const source = path.resolve(repo, OBSERVER_SOURCE), observer = path.join(build, "e5t26f-observe");
  const buildInfoPath = path.join(build, "build-info.json"), baseDir = path.dirname(base);
  const regular = async filename => {
    assert.equal(await io.realpath(filename), filename, "symlinked input refused");
    assert.ok((await io.lstat(filename)).isFile(), "regular input required");
  };
  for (const file of [base, helper, source, observer, buildInfoPath,
    ...["desktop-info.json", "MANIFEST.txt", "FILE-MANIFEST.txt"].map(name => path.join(baseDir, name))]) await regular(file);
  const buildBytes = await io.readFile(buildInfoPath);
  assert.equal(digest(buildBytes), buildInfoSha256, "build provenance SHA differs");
  const compiled = JSON.parse(buildBytes);
  assert.equal(compiled.schema, "wasm-vm.e5-t26f.observer-build.v1");
  assert.equal(compiled.source.path, OBSERVER_SOURCE);
  assert.equal(compiled.binary.path, path.relative(repo, observer));
  assert.equal(compiled.target, "riscv64-linux-musl");
  const verifyInputs = async () => {
    assert.equal((await io.lstat(base)).size, BASE_SIZE);
    for (const [file, sha] of [[base, BASE_SHA256], [helper, helperSha256], [source, compiled.source.sha256],
      [observer, compiled.binary.sha256], [buildInfoPath, buildInfoSha256]]) {
      await regular(file); assert.match(sha ?? "", /^[0-9a-f]{64}$/u);
      assert.equal(await hashFile(file), sha, `frozen input SHA differs: ${file}`);
    }
  };
  await verifyInputs();
  const helperBytes = await io.readFile(helper), binaryBytes = await io.readFile(observer);
  assert.equal(digest(helperBytes), helperSha256); assert.ok(helperBytes.length > 0);
  assert.equal(digest(binaryBytes), compiled.binary.sha256);
  assert.equal(binaryBytes.length, compiled.binary.size); validateElf(binaryBytes);
  const baseInfoBytes = await io.readFile(path.join(baseDir, "desktop-info.json"));
  const baseInfo = JSON.parse(baseInfoBytes);
  assert.equal(baseInfo.schema, "wasm-vm.e5-t26f.desktop-image-info.v1");
  assert.equal(baseInfo.architecture, "riscv64");
  assert.deepEqual(baseInfo.image, { path: BASE, sha256: BASE_SHA256, size: BASE_SIZE });
  const packages = await io.readFile(path.join(baseDir, "MANIFEST.txt"));
  const files = await io.readFile(path.join(baseDir, "FILE-MANIFEST.txt"));
  for (const [entry, name, bytes] of [[baseInfo.packageManifest, "MANIFEST.txt", packages],
    [baseInfo.fileManifest, "FILE-MANIFEST.txt", files]]) {
    assert.equal(entry.path, `${path.dirname(BASE)}/${name}`); assert.equal(digest(bytes), entry.sha256);
  }
  assert.ok(!files.toString().split("\n").some(line => line.endsWith(` ${OBSERVER_GUEST_PATH}`)), "observer already present in base manifest");
  const appended = appendFileManifest(files.toString(), helperSha256) + `${compiled.binary.sha256} 0555 ${OBSERVER_GUEST_PATH}\n`;
  const { stdout } = await run("docker", ["image", "inspect", "--format", "{{.Id}}", BUILDER]);
  const imageId = stdout.trim(), args = dockerArguments({ base, helper, observer, out: destination, imageId });
  await guardOutput(repo, destination, io); await io.mkdir(destination, { recursive: true });
  const write = (name, bytes) => io.writeFile(path.join(destination, name), bytes, { flag: "wx" });
  await write(".e5-t26f-observer-image.json", JSON.stringify({ kind: OBSERVER_KIND, helperSha256, buildInfoSha256 }) + "\n");
  let imageSha256, failure;
  try {
    const image = path.join(destination, "alpine-rootfs.ext4");
    await io.copyFile(base, image, constants.COPYFILE_EXCL);
    assert.equal(await hashFile(image), BASE_SHA256, "initial base copy differs");
    await write("install.debugfs", observerInodeCommands()); await run("docker", args);
    assert.equal(await io.readFile(path.join(destination, "tool-packages.log"), "utf8"), "e2fsprogs-1.47.0-r5\ne2fsprogs-extra-1.47.0-r5\n");
    assert.deepEqual(await io.readFile(path.join(destination, "resident-readback.sh")), helperBytes);
    assert.deepEqual(await io.readFile(path.join(destination, "observer-readback")), binaryBytes);
    validateInodeStat(await io.readFile(path.join(destination, "resident-stat.txt"), "utf8"), helperBytes.length);
    validateObserverStat(await io.readFile(path.join(destination, "observer-stat.txt"), "utf8"), binaryBytes.length);
    assert.equal((await io.lstat(image)).size, BASE_SIZE);
    imageSha256 = await hashFile(image); assert.notEqual(imageSha256, BASE_SHA256);
    await write("MANIFEST.txt", packages); await write("FILE-MANIFEST.txt", appended);
    await write("observer-build-info.json", buildBytes);
  } catch (error) { failure = error; }
  finally {
    try { await verifyInputs(); } catch (error) {
      failure = failure ? new AggregateError([failure, error], "overlay and immutable input checks failed") : error;
    }
  }
  if (failure) {
    await write("build-failure.json", JSON.stringify({ acceptance: false, error: String(failure), causes: failure.errors?.map(String) }, null, 2) + "\n");
    throw failure;
  }
  const relative = name => path.relative(repo, path.join(destination, name));
  const info = { ...baseInfo, image: { path: relative("alpine-rootfs.ext4"), sha256: imageSha256, size: BASE_SIZE },
    packageManifest: { path: relative("MANIFEST.txt"), sha256: digest(packages) },
    fileManifest: { path: relative("FILE-MANIFEST.txt"), sha256: digest(appended) },
    fixture: { kind: OBSERVER_KIND, helperPath: OBSERVER_HELPER, helperSha256, helperSize: helperBytes.length,
      guestPath: GUEST_PATH, mode: "0444", uid: 0, gid: 0, epoch: EPOCH, readbackSha256: helperSha256,
      basePath: BASE, baseSha256: BASE_SHA256, baseSize: BASE_SIZE, basePreserved: true,
      baseInfoSha256: digest(baseInfoBytes), baseFileManifestSha256: digest(files),
      builder: { tag: BUILDER, imageId, e2fsprogs: "1.47.0-r5" },
      observer: { guestPath: OBSERVER_GUEST_PATH, sourcePath: OBSERVER_SOURCE, sourceSha256: compiled.source.sha256,
        binaryPath: compiled.binary.path, sha256: compiled.binary.sha256, size: binaryBytes.length, mode: "0555",
        buildInfoPath: path.relative(repo, buildInfoPath), buildInfoSha256, readbackSha256: compiled.binary.sha256 } } };
  await write("desktop-info.json", JSON.stringify(info, null, 2) + "\n");
  await write("SHA256SUMS", `${info.packageManifest.sha256}  MANIFEST.txt\n${info.fileManifest.sha256}  FILE-MANIFEST.txt\n`);
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildObserverImage(parseArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
