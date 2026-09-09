import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BASE, BASE_SHA256, BASE_SIZE, EPOCH, GUEST_PATH, guardOutput,
  appendFileManifest, validateInodeStat,
} from "./e5-t26f-resident-image.mjs";
import {
  OBSERVER_KIND, OBSERVER_SOURCE, OBSERVER_HELPER, OBSERVER_GUEST_PATH,
} from "./e5-t26f-resident-proof.mjs";
import { validateElf } from "./e5-t26f-observer-build.mjs";
import {
  OVERLAY_SCRIPT, dockerArguments, observerInodeCommands, parseArguments,
  validateObserverStat, buildObserverImage,
} from "./e5-t26f-observer-image.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const imageId = `sha256:${"d".repeat(64)}`;
const sourceBytes = Buffer.from("/* injected observer source; not a cross-build */\n");
const sourceSha256 = hash(sourceBytes);
const helperBytes = Buffer.from("#!/bin/sh\n# injected observer helper fixture\n");
const helperSha256 = hash(helperBytes);
const packages = Buffer.from("alsa-utils-1.2.11-r1\nalsa-lib-1.2.11-r0\n");
const originalFiles = `${"c".repeat(64)} 0755 /usr/libexec/wasm-vm/wasmvm-agent\ndirectory 0700 /home/desktop\n`;

function elfFixture({ interpreter = false, dynamic = false, rve = false, badLoadRange = false } = {}) {
  const phnum = 1 + Number(interpreter) + Number(dynamic);
  const codeOffset = 0x100;
  const size = 0x180;
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(0x464c457f, 0);
  bytes[4] = 2; bytes[5] = 1; bytes[6] = 1;
  bytes.writeUInt16LE(2, 16); bytes.writeUInt16LE(243, 18); bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x1000n + BigInt(codeOffset), 24);
  bytes.writeBigUInt64LE(64n, 32); bytes.writeBigUInt64LE(0n, 40);
  bytes.writeUInt32LE((rve ? 0x8 : 0) | 0x4 | 0x1, 48);
  bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(phnum, 56);
  bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(0, 60); bytes.writeUInt16LE(0, 62);
  let index = 0;
  const ph = (type, flags, offset, fileSize, memorySize) => {
    const at = 64 + index * 56; index += 1;
    bytes.writeUInt32LE(type, at); bytes.writeUInt32LE(flags, at + 4);
    bytes.writeBigUInt64LE(BigInt(offset), at + 8); bytes.writeBigUInt64LE(0x1000n, at + 16);
    bytes.writeBigUInt64LE(0x1000n, at + 24); bytes.writeBigUInt64LE(BigInt(fileSize), at + 32);
    bytes.writeBigUInt64LE(BigInt(memorySize), at + 40); bytes.writeBigUInt64LE(0x1000n, at + 48);
  };
  ph(1, 5, 0, badLoadRange ? size + 1 : size, size);
  if (interpreter) ph(3, 4, 0, 1, 1);
  if (dynamic) ph(2, 4, 0, 1, 1);
  return bytes;
}

const binaryBytes = elfFixture();
const binarySha256 = hash(binaryBytes);

function inodeStat(mode, size) {
  return `Inode: 123 Type: regular Mode: ${mode} Flags: 0x80000
Generation: 0 Version: 0x00000000:00000000
User: 0 Group: 0 Project: 0 Size: ${size}
Links: 1 Blockcount: 8
${["atime", "mtime", "ctime", "crtime"].map(field => `${field}: 0x${EPOCH.toString(16)}:00000000 -- fixed`).join("\n")}
`;
}

async function scratch(t) {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "e5-t26f-observer-image-test-")));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  return repo;
}

async function fixture(t, options = {}) {
  const repo = await scratch(t);
  const base = path.join(repo, BASE);
  const baseDir = path.dirname(base);
  const buildDir = "target/e5-t26f/observer-build";
  const build = path.join(repo, buildDir);
  const out = "target/e5-t26f/observer-image";
  const destination = path.join(repo, out);
  const helper = path.join(repo, OBSERVER_HELPER);
  const source = path.join(repo, OBSERVER_SOURCE);
  const observer = path.join(build, "e5t26f-observe");
  const buildInfoPath = path.join(build, "build-info.json");
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(path.dirname(helper), { recursive: true });
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.mkdir(build, { recursive: true });
  await fs.writeFile(base, "base");
  await fs.writeFile(helper, helperBytes);
  await fs.writeFile(source, sourceBytes);
  const baseInfo = {
    schema: "wasm-vm.e5-t26f.desktop-image-info.v1", task: "E5-T26f", architecture: "riscv64",
    image: { path: BASE, sha256: BASE_SHA256, size: BASE_SIZE },
    packageManifest: { path: `${path.dirname(BASE)}/MANIFEST.txt`, sha256: hash(packages) },
    fileManifest: { path: `${path.dirname(BASE)}/FILE-MANIFEST.txt`, sha256: hash(originalFiles) },
    startup: { inPlaceDisplayResize: false, backend: "drm", renderer: "pixman" },
  };
  await fs.writeFile(path.join(baseDir, "MANIFEST.txt"), packages);
  await fs.writeFile(path.join(baseDir, "FILE-MANIFEST.txt"), originalFiles);
  await fs.writeFile(path.join(baseDir, "desktop-info.json"), JSON.stringify(baseInfo));
  const buildInfo = {
    schema: "wasm-vm.e5-t26f.observer-build.v1",
    source: { path: OBSERVER_SOURCE, sha256: sourceSha256 },
    binary: { path: "target/e5-t26f/observer-build/e5t26f-observe", sha256: binarySha256, size: binaryBytes.length },
    target: "riscv64-linux-musl", cpu: "baseline_rv64", compiler: { version: "0.16.0", path: "/toolchain/zig", sha256: "a".repeat(64) },
    argv: ["/toolchain/zig", "cc", "-target", "riscv64-linux-musl"], epoch: EPOCH,
  };
  const buildInfoBytes = Buffer.from(`${JSON.stringify(buildInfo)}\n`);
  await fs.writeFile(observer, binaryBytes);
  await fs.writeFile(buildInfoPath, buildInfoBytes);
  const buildInfoSha256 = hash(buildInfoBytes);

  const image = path.join(destination, "alpine-rootfs.ext4");
  const hashes = [], calls = [];
  const io = {
    ...fs,
    lstat: async filename => {
      const stat = await fs.lstat(filename);
      if (filename === base) stat.size = BASE_SIZE;
      if (filename === image) stat.size = options.imageSize ?? BASE_SIZE;
      return stat;
    },
    copyFile: async (from, to) => fs.copyFile(from, to).then(async () => {
      if (options.copyMismatch) await fs.writeFile(to, "bad copy");
    }),
  };
  const hashFile = async filename => {
    hashes.push(filename);
    const bytes = await fs.readFile(filename);
    if (filename === base || (filename === image && bytes.toString() === "base")) return BASE_SHA256;
    return hash(bytes);
  };
  const run = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === "image") {
      if (options.mutate === "source") await fs.writeFile(source, Buffer.from("source mutated after preflight\n"));
      if (options.mutate === "binary") await fs.writeFile(observer, Buffer.from("binary mutated after preflight\n"));
      return { stdout: `${imageId}\n`, stderr: "" };
    }
    assert.equal(args[0], "run");
    if (options.unchanged) await fs.copyFile(base, image);
    else await fs.writeFile(image, "overlay image bytes");
    await fs.writeFile(path.join(destination, "resident-readback.sh"), helperBytes);
    await fs.writeFile(path.join(destination, "observer-readback"), binaryBytes);
    await fs.writeFile(path.join(destination, "resident-stat.txt"), inodeStat("0444", helperBytes.length));
    await fs.writeFile(path.join(destination, "observer-stat.txt"), inodeStat("0555", binaryBytes.length));
    await fs.writeFile(path.join(destination, "tool-packages.log"), "e2fsprogs-1.47.0-r5\ne2fsprogs-extra-1.47.0-r5\n");
    if (options.readback) await fs.writeFile(path.join(destination, "resident-readback.sh"), "wrong");
    if (options.observerReadback) await fs.writeFile(path.join(destination, "observer-readback"), "wrong");
    if (options.stat) await fs.writeFile(path.join(destination, "resident-stat.txt"), inodeStat("0444", 0));
    if (options.observerStat) await fs.writeFile(path.join(destination, "observer-stat.txt"), inodeStat("0555", 0));
    if (options.tools) await fs.writeFile(path.join(destination, "tool-packages.log"), "e2fsprogs-NEW\n");
    if (options.failDocker) throw options.failDocker;
    return { stdout: "", stderr: "" };
  };
  const optionsForBuilder = { repo, out, helperSha256, buildDir, buildInfoSha256 };
  return {
    repo, out, buildDir, build, destination, base, baseDir, helper, source, observer, buildInfoPath,
    helperSha256, buildInfoSha256, buildInfoBytes, baseInfo, hashes, calls, io, hashFile, run,
    optionsForBuilder,
  };
}

test("CLI is exact and has no source/base/compiler override", () => {
  assert.deepEqual(parseArguments(["--out", "target/e5-t26f/image", "--helper-sha256", helperSha256,
    "--build-dir", "target/e5-t26f/build", "--build-info-sha256", "b".repeat(64)]), {
    out: "target/e5-t26f/image", helperSha256, buildDir: "target/e5-t26f/build", buildInfoSha256: "b".repeat(64),
  });
  for (const args of [[], ["--out", "x"], ["--out", "x", "--helper-sha256", helperSha256],
    ["--out", "x", "--helper-sha256", helperSha256, "--build-dir", "target/e5-t26f/build", "--build-info-sha256", "B".repeat(64)],
    ["--out", "x", "--helper-sha256", helperSha256, "--build-dir", "target/e5-t26f/build", "--build-info-sha256", "b".repeat(64), "--base", "other"],
    ["--out", "x", "--helper-sha256", helperSha256, "--build-dir", "target/e5-t26f/build", "--build-info-sha256", "b".repeat(64), "--source", "other"]])
    assert.throws(() => parseArguments(args));
});

test("guard runs before writes and refuses root, escape, nonempty, and symlink outputs", async t => {
  const f = await fixture(t);
  const root = path.join(f.repo, "target/e5-t26f");
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, "occupied"));
  await fs.writeFile(path.join(root, "occupied/keep"), "keep");
  await fs.symlink(path.join(root, "occupied"), path.join(root, "link"));
  for (const out of [root, "target/e5-t26f/../escape", "target/e5-t26f/occupied", "target/e5-t26f/link"])
    await assert.rejects(buildObserverImage({ ...f.optionsForBuilder, out }, { io: f.io, hashFile: f.hashFile, run: f.run }));
  assert.equal(f.calls.length, 0);
  assert.equal(await fs.readFile(path.join(root, "occupied/keep"), "utf8"), "keep");
});

test("observer install commands contain exactly two fixed root-owned inode installs", () => {
  const commands = observerInodeCommands();
  assert.equal(commands.split("\n").filter(line => line.startsWith("write ")).length, 2);
  assert.match(commands, new RegExp(`write /helper ${GUEST_PATH}`));
  assert.match(commands, new RegExp(`write /observer ${OBSERVER_GUEST_PATH}`));
  assert.match(commands, new RegExp(`set_inode_field ${OBSERVER_GUEST_PATH} mode 0100555`));
  for (const guestPath of [GUEST_PATH, OBSERVER_GUEST_PATH]) {
    for (const value of ["uid 0", "gid 0", "generation 0", "dtime 0"]) assert.ok(commands.includes(`set_inode_field ${guestPath} ${value}`));
    for (const field of ["atime", "mtime", "ctime", "crtime"]) {
      assert.ok(commands.includes(`set_inode_field ${guestPath} ${field} ${EPOCH}\n`));
      assert.ok(commands.includes(`set_inode_field ${guestPath} ${field}_extra 0\n`));
    }
  }
  assert.match(commands, new RegExp(`set_inode_field ${GUEST_PATH} mode 0100444`));
});

test("Docker command is offline with three read-only source mounts and one owned RW output", () => {
  const args = dockerArguments({ base: "/repo/base", helper: "/repo/helper", observer: "/repo/observer",
    out: "/repo/target/e5-t26f/image", imageId });
  const mounts = args.flatMap((value, index) => value === "--mount" ? [args[index + 1]] : []);
  assert.deepEqual(mounts, ["type=bind,src=/repo/base,dst=/base,readonly", "type=bind,src=/repo/helper,dst=/helper,readonly",
    "type=bind,src=/repo/observer,dst=/observer,readonly", "type=bind,src=/repo/target/e5-t26f/image,dst=/out"]);
  for (const option of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges"])
    assert.ok(args.includes(option));
  assert.equal(args.at(-3), imageId);
  assert.throws(() => dockerArguments({ base: "/bad,path", helper: "/h", observer: "/o", out: "/out", imageId }));
  assert.throws(() => dockerArguments({ base: "/b", helper: "/h", observer: "/o", out: "/out", imageId: "latest" }));
});

test("ELF validator fixture is accepted and dynamic/RVE/range variants are refused", () => {
  assert.equal(validateElf(binaryBytes).machine, "RISC-V");
  for (const options of [{ interpreter: true }, { dynamic: true }, { rve: true }, { badLoadRange: true }])
    assert.throws(() => validateElf(elfFixture(options)));
});

test("observer stat validator enforces 0555, size, ownership, links, generation, and all fixed times", () => {
  validateObserverStat(inodeStat("0555", binaryBytes.length), binaryBytes.length);
  for (const [from, to] of [["Mode: 0555", "Mode: 0444"], ["User: 0", "User: 1000"],
    ["Group: 0", "Group: 1000"], ["Links: 1", "Links: 2"], ["Generation: 0", "Generation: 1"],
    [`Size: ${binaryBytes.length}`, "Size: 0"],
    ...["atime", "mtime", "ctime", "crtime"].map(field => [`${field}: 0x${EPOCH.toString(16)}:00000000`, `${field}: 0x${EPOCH.toString(16)}:00000001`])])
    assert.throws(() => validateObserverStat(inodeStat("0555", binaryBytes.length).replace(from, to), binaryBytes.length));
});

test("successful mock overlay preserves manifests byte-for-byte and publishes exact observer provenance", async t => {
  const f = await fixture(t);
  const info = await buildObserverImage(f.optionsForBuilder, { io: f.io, hashFile: f.hashFile, run: f.run });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(await fs.readFile(path.join(f.destination, "MANIFEST.txt")), packages);
  assert.equal(await fs.readFile(path.join(f.destination, "FILE-MANIFEST.txt"), "utf8"),
    appendFileManifest(originalFiles, helperSha256) + `${binarySha256} 0555 ${OBSERVER_GUEST_PATH}\n`);
  assert.deepEqual(await fs.readFile(path.join(f.destination, "observer-build-info.json")), f.buildInfoBytes);
  assert.equal(info.fixture.kind, OBSERVER_KIND);
  assert.deepEqual(info.fixture.observer, {
    guestPath: OBSERVER_GUEST_PATH, sourcePath: OBSERVER_SOURCE, sourceSha256,
    binaryPath: "target/e5-t26f/observer-build/e5t26f-observe", sha256: binarySha256,
    size: binaryBytes.length, mode: "0555", buildInfoPath: "target/e5-t26f/observer-build/build-info.json",
    buildInfoSha256: f.buildInfoSha256, readbackSha256: binarySha256,
  });
  assert.equal(info.fixture.helperPath, OBSERVER_HELPER);
  assert.equal(info.fixture.helperSha256, helperSha256);
  assert.deepEqual(await fs.readFile(path.join(f.destination, "SHA256SUMS"), "utf8").then(value => value.split("\n").filter(Boolean)), [
    `${info.packageManifest.sha256}  MANIFEST.txt`, `${info.fileManifest.sha256}  FILE-MANIFEST.txt`,
  ]);
  assert.equal(info.fixture.observer.sourceSha256, sourceSha256);
  assert.equal(info.fixture.observer.sha256, hash(binaryBytes));
});

test("overlay script and output schema retain the two-file fixture contract", () => {
  assert.match(OVERLAY_SCRIPT, /E2FSPROGS_FAKE_TIME=1731542400/u);
  assert.match(OVERLAY_SCRIPT, /debugfs -R 'dump \/usr\/libexec\/wasm-vm\/e5t26f-resident\.sh/u);
  assert.match(OVERLAY_SCRIPT, /debugfs -R 'dump \/usr\/libexec\/wasm-vm\/e5t26f-observe/u);
  assert.match(OVERLAY_SCRIPT, /cmp \/helper \/out\/resident-readback\.sh/u);
  assert.match(OVERLAY_SCRIPT, /cmp \/observer \/out\/observer-readback/u);
  assert.match(OVERLAY_SCRIPT, /fsck\.ext4 -f -n/u);
  assert.doesNotMatch(OVERLAY_SCRIPT, /\b(?:mount|chroot|mkfs|mke2fs)\b/u);
});

test("pinned e2fs/readback/stat/size failures retain partial output but publish no success metadata", async t => {
  for (const [label, options] of [
    ["readback", { readback: true }], ["observer-readback", { observerReadback: true }],
    ["stat", { stat: true }], ["observer-stat", { observerStat: true }], ["tools", { tools: true }],
    ["unchanged", { unchanged: true }], ["size", { imageSize: BASE_SIZE + 1 }], ["copy", { copyMismatch: true }],
  ]) {
    const f = await fixture(t, options);
    let caught;
    try { await buildObserverImage(f.optionsForBuilder, { io: f.io, hashFile: f.hashFile, run: f.run }); }
    catch (error) { caught = error; }
    assert.ok(caught, `${label}: expected failure`);
    await assert.rejects(fs.stat(path.join(f.destination, "desktop-info.json")), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(f.destination, "observer-build-info.json")), { code: "ENOENT" });
    const entries = await fs.readdir(f.destination).catch(error => { throw new Error(`${label}: ${error}; caught=${caught}`); });
    assert.ok(entries.includes("build-failure.json"), `${label}: missing failure record`);
    assert.match(await fs.readFile(path.join(f.destination, "build-failure.json"), "utf8"), /acceptance/, label);
  }
});

test("failed Docker retains failure and rechecks every immutable input", async t => {
  const failure = new Error("injected fsck failure");
  const f = await fixture(t, { failDocker: failure });
  await assert.rejects(buildObserverImage(f.optionsForBuilder, { io: f.io, hashFile: f.hashFile, run: f.run }), error => error === failure);
  for (const input of [f.base, f.helper, f.source, f.observer, f.buildInfoPath])
    assert.ok(f.hashes.filter(filename => filename === input).length >= 2, `input was not rechecked: ${input}`);
  assert.match(await fs.readFile(path.join(f.destination, "build-failure.json"), "utf8"), /injected fsck failure/u);
  await assert.rejects(fs.stat(path.join(f.destination, "desktop-info.json")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(f.destination, "observer-build-info.json")), { code: "ENOENT" });
});

test("source and binary mutation after preflight refuse publication", async t => {
  for (const mutation of ["source", "binary"]) {
    const f = await fixture(t, { mutate: mutation });
    await assert.rejects(buildObserverImage(f.optionsForBuilder, { io: f.io, hashFile: f.hashFile, run: f.run }));
    assert.ok(f.hashes.filter(filename => filename === (mutation === "source" ? f.source : f.observer)).length >= 2);
    await assert.rejects(fs.stat(path.join(f.destination, "desktop-info.json")), { code: "ENOENT" });
    assert.match(await fs.readFile(path.join(f.destination, "build-failure.json"), "utf8"), /acceptance/);
  }
});

test("symlinked build input is refused before Docker or output ownership", async t => {
  const f = await fixture(t);
  const real = `${f.helper}.real`;
  await fs.rename(f.helper, real);
  await fs.symlink(real, f.helper);
  await assert.rejects(buildObserverImage(f.optionsForBuilder, { io: f.io, hashFile: f.hashFile, run: f.run }), /symlink/u);
  assert.equal(f.calls.length, 0);
  await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
});
