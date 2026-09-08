import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { BASE, BASE_SHA256, BASE_SIZE, HELPER, GUEST_PATH, EPOCH, OVERLAY_SCRIPT,
  parseArguments, guardOutput, appendFileManifest, inodeCommands, dockerArguments,
  validateInodeStat, sha256File, buildResidentImage } from "./e5-t26f-resident-image.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const imageId = `sha256:${"d".repeat(64)}`;
const helper = Buffer.from("#!/bin/sh\n# Mock build input, not a playback fixture.\n");
const helperSha256 = hash(helper);
const fileManifest = `${"c".repeat(64)} 0755 /usr/libexec/wasm-vm/wasmvm-agent\ndirectory 0700 /home/desktop\n`;
const inodeStat = () => `Inode: 123 Type: regular Mode: 0444 Flags: 0x80000
Generation: 0 Version: 0x00000000:00000000
User: 0 Group: 0 Project: 0 Size: ${helper.length}
Links: 1 Blockcount: 8
${["atime", "mtime", "ctime", "crtime"].map(field => `${field}: 0x${EPOCH.toString(16)}:00000000 -- fixed`).join("\n")}
`;

async function scratch(t) {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "e5-t26f-resident-image-test-")));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  return repo;
}

// These tests exercise host orchestration, NOT ext4 or guest acceptance. Tiny byte files,
// a synthetic lstat size, and a fake Docker runner avoid building/copying a 1-GiB image.
async function fixture(t) {
  const repo = await scratch(t);
  const base = path.join(repo, BASE), helperPath = path.join(repo, HELPER);
  const out = "target/e5-t26f/resident-test", destination = path.join(repo, out);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.mkdir(path.dirname(helperPath), { recursive: true });
  await fs.writeFile(base, "base");
  await fs.writeFile(helperPath, helper);
  const packageBytes = Buffer.from("alsa-utils-1.2.11-r1\nalsa-lib-1.2.11-r0\n");
  const info = { schema: "wasm-vm.e5-t26f.desktop-image-info.v1", task: "E5-T26f", architecture: "riscv64",
    image: { path: BASE, sha256: BASE_SHA256, size: BASE_SIZE },
    packageManifest: { path: `${path.dirname(BASE)}/MANIFEST.txt`, sha256: hash(packageBytes) },
    fileManifest: { path: `${path.dirname(BASE)}/FILE-MANIFEST.txt`, sha256: hash(fileManifest) },
    startup: { inPlaceDisplayResize: false, backend: "drm", renderer: "pixman" } };
  for (const [name, bytes] of [["MANIFEST.txt", packageBytes], ["FILE-MANIFEST.txt", fileManifest], ["desktop-info.json", JSON.stringify(info)]]) {
    await fs.writeFile(path.join(path.dirname(base), name), bytes);
  }
  const calls = [], hashes = [];
  const deps = { io: { ...fs, lstat: async filename => {
    const stat = await fs.lstat(filename);
    if (filename.endsWith("/alpine-rootfs.ext4")) stat.size = BASE_SIZE;
    return stat;
  } }, hashFile: async filename => {
    hashes.push(filename);
    const bytes = await fs.readFile(filename);
    return bytes.toString() === "base" ? BASE_SHA256 : hash(bytes);
  }, run: async (command, args) => {
    calls.push({ command, args });
    if (args[0] === "image") return { stdout: `${imageId}\n`, stderr: "" };
    await fs.writeFile(path.join(destination, "alpine-rootfs.ext4"), "mock overlay bytes");
    await fs.writeFile(path.join(destination, "resident-readback.sh"), helper);
    await fs.writeFile(path.join(destination, "resident-stat.txt"), inodeStat());
    await fs.writeFile(path.join(destination, "tool-packages.log"), "e2fsprogs-1.47.0-r5\ne2fsprogs-extra-1.47.0-r5\n");
    return { stdout: "", stderr: "" };
  } };
  return { repo, base, helperPath, destination, options: { repo, out, helperSha256 }, deps, calls, hashes, info, packageBytes };
}

test("CLI requires an explicit output and exact frozen helper digest; no base override", () => {
  assert.deepEqual(parseArguments(["--out", "target/e5-t26f/run", "--helper-sha256", helperSha256]),
    { out: "target/e5-t26f/run", helperSha256 });
  for (const args of [[], ["--out", "x"], ["--helper-sha256", helperSha256],
    ["--out", "x", "--helper-sha256", helperSha256.toUpperCase()],
    ["--out", "x", "--out", "y", "--helper-sha256", helperSha256],
    ["--out", "x", "--helper-sha256", helperSha256, "--base", "other"]]) assert.throws(() => parseArguments(args));
});

test("output guard accepts only empty descendants and refuses nonempty, root, escape and symlinks without writes", async t => {
  const repo = await scratch(t), root = path.join(repo, "target/e5-t26f");
  await fs.mkdir(root, { recursive: true });
  assert.equal(await guardOutput(repo, "target/e5-t26f/new"), path.join(root, "new"));
  await fs.mkdir(path.join(root, "empty"));
  await guardOutput(repo, path.join(root, "empty"));
  await fs.writeFile(path.join(root, "empty/keep"), "user data");
  await assert.rejects(guardOutput(repo, "target/e5-t26f/empty"), /nonempty/u);
  assert.equal(await fs.readFile(path.join(root, "empty/keep"), "utf8"), "user data");
  for (const out of [root, "target/e5-t26f/../other", "target/e5-t26f/,bad", "target/e5-t26f/bad\nname"]) await assert.rejects(guardOutput(repo, out));
  await fs.symlink(path.join(root, "empty"), path.join(root, "link"));
  await assert.rejects(guardOutput(repo, "target/e5-t26f/link"), /symlink/u);
  await assert.rejects(guardOutput(repo, "target/e5-t26f/link/child"), /symlink/u);
});

test("manifest preserves every original byte and appends exactly the one read-only helper", () => {
  assert.equal(appendFileManifest(fileManifest, helperSha256), `${fileManifest}${helperSha256} 0444 ${GUEST_PATH}\n`);
  for (const original of ["", fileManifest.trimEnd(), "broken\n", fileManifest + fileManifest,
    `${fileManifest}${helperSha256} 0444 ${GUEST_PATH}\n`]) assert.throws(() => appendFileManifest(original, helperSha256));
});

test("debugfs adds one file, pins ownership/all inode times and never mounts or executes the guest helper", () => {
  const commands = inodeCommands();
  assert.equal(commands.split("\n").filter(line => line.startsWith("write ")).length, 1);
  assert.equal(commands.split("\n")[0], `write /helper ${GUEST_PATH}`);
  for (const field of ["atime", "mtime", "ctime", "crtime"]) {
    assert.ok(commands.includes(`set_inode_field ${GUEST_PATH} ${field} ${EPOCH}\n`));
    assert.ok(commands.includes(`set_inode_field ${GUEST_PATH} ${field}_extra 0\n`));
  }
  for (const value of ["mode 0100444", "uid 0", "gid 0", "generation 0"]) assert.ok(commands.includes(value));
  assert.match(OVERLAY_SCRIPT, /E2FSPROGS_FAKE_TIME=1731542400/u);
  assert.ok(OVERLAY_SCRIPT.includes("apk info -v | grep -E '^e2fsprogs(-extra)?-[0-9]' | sort"),
    "apk info with explicit package names describes packages instead of listing exact versions");
  assert.match(OVERLAY_SCRIPT, /File not found by ext2_lookup/u); // debugfs itself can exit zero on errors.
  assert.match(OVERLAY_SCRIPT, /cmp \/helper \/out\/resident-readback.sh/u);
  assert.match(OVERLAY_SCRIPT, /fsck.ext4 -f -n/u);
  assert.doesNotMatch(commands + OVERLAY_SCRIPT, /\b(?:mkdir|mount|chroot|mkfs|mke2fs|aplay)\b/u);
});

test("Docker is local, offline/unprivileged, with exactly two file RO mounts and the owned output RW", () => {
  const args = dockerArguments({ base: "/repo/base.ext4", helper: "/repo/helper.sh", out: "/repo/target/e5-t26f/new", imageId });
  const mounts = args.flatMap((value, i) => value === "--mount" ? [args[i + 1]] : []);
  assert.deepEqual(mounts, ["type=bind,src=/repo/base.ext4,dst=/base,readonly",
    "type=bind,src=/repo/helper.sh,dst=/helper,readonly", "type=bind,src=/repo/target/e5-t26f/new,dst=/out"]);
  for (const option of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges"]) assert.ok(args.includes(option));
  assert.equal(args.at(-3), imageId);
  assert.throws(() => dockerArguments({ base: "/x,bad", helper: "/h", out: "/o", imageId }));
  assert.throws(() => dockerArguments({ base: "/b", helper: "/h", out: "/o", imageId: "latest" }));
});

test("actual inode stat parser refuses wrong type, ownership, mode, size, links, generation or any timestamp", () => {
  validateInodeStat(inodeStat(), helper.length);
  for (const [from, to] of [["Type: regular", "Type: symlink"], ["Mode: 0444", "Mode: 0644"],
    ["User: 0", "User: 1000"], ["Group: 0", "Group: 1000"], ["Links: 1", "Links: 2"],
    ["Generation: 0", "Generation: 1"], [`Size: ${helper.length}`, "Size: 0"],
    ...["atime", "mtime", "ctime", "crtime"].map(field => [`${field}: 0x${EPOCH.toString(16)}:00000000`, `${field}: 0x${EPOCH.toString(16)}:00000001`])]) {
    assert.throws(() => validateInodeStat(inodeStat().replace(from, to), helper.length), from);
  }
});

test("streaming SHA256 computes actual bytes", async t => {
  const filename = path.join(await scratch(t), "bytes");
  await fs.writeFile(filename, helper);
  assert.equal(await sha256File(filename), helperSha256);
});

test("mocked build records verified provenance, exact lock/manifest and before+after source hashes", async t => {
  const f = await fixture(t);
  const info = await buildResidentImage(f.options, f.deps);
  assert.equal(f.calls.length, 2);
  assert.equal(f.hashes.filter(filename => filename === f.base).length, 2);
  assert.equal(f.hashes.filter(filename => filename === f.helperPath).length, 2);
  assert.equal(info.image.sha256, hash("mock overlay bytes"));
  assert.equal(info.image.size, BASE_SIZE);
  assert.deepEqual(info.startup, f.info.startup);
  assert.equal(info.schema, "wasm-vm.e5-t26f.desktop-image-info.v1");
  assert.equal(info.fixture.kind, "resident-aplay-v1");
  assert.equal(info.fixture.baseSha256, BASE_SHA256);
  assert.equal(info.fixture.helperSha256, helperSha256);
  assert.equal(info.fixture.readbackSha256, helperSha256);
  assert.equal(info.fixture.basePreserved, true);
  assert.equal(info.fixture.builder.imageId, imageId);
  assert.deepEqual(await fs.readFile(path.join(f.destination, "MANIFEST.txt")), f.packageBytes);
  assert.equal(await fs.readFile(path.join(f.destination, "FILE-MANIFEST.txt"), "utf8"), appendFileManifest(fileManifest, helperSha256));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.destination, "desktop-info.json"))), info);
  await assert.rejects(buildResidentImage(f.options, f.deps), /nonempty/u);
  assert.equal(f.calls.length, 2, "retry must not launch Docker");
});

test("base/helper hash and input symlink failures happen before Docker or output creation", async t => {
  for (const scenario of ["base", "helper", "symlink", "manifest"]) {
    const f = await fixture(t);
    if (scenario === "base") await fs.writeFile(f.base, "wrong base");
    if (scenario === "helper") await fs.writeFile(f.helperPath, "not the frozen helper");
    if (scenario === "manifest") await fs.appendFile(path.join(path.dirname(f.base), "MANIFEST.txt"), "drift\n");
    if (scenario === "symlink") {
      await fs.rename(f.helperPath, `${f.helperPath}.real`);
      await fs.symlink(`${f.helperPath}.real`, f.helperPath);
    }
    await assert.rejects(buildResidentImage(f.options, f.deps), /SHA256|symlink/u);
    assert.equal(f.calls.length, 0);
    await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
  }
});

test("Docker failure propagates, rehashes immutable inputs and retains partial outputs without success metadata", async t => {
  const f = await fixture(t), failure = new Error("mock fsck failure");
  const original = f.deps.run;
  f.deps.run = (command, args) => args[0] === "image" ? original(command, args) : Promise.reject(failure);
  await assert.rejects(buildResidentImage(f.options, f.deps), error => error === failure);
  assert.equal(f.hashes.filter(filename => filename === f.base).length, 2);
  assert.equal(f.hashes.filter(filename => filename === f.helperPath).length, 2);
  assert.ok((await fs.stat(path.join(f.destination, "alpine-rootfs.ext4"))).isFile());
  await assert.rejects(fs.stat(path.join(f.destination, "desktop-info.json")), { code: "ENOENT" });
  assert.match(await fs.readFile(path.join(f.destination, "build-failure.json"), "utf8"), /mock fsck failure/u);
});

test("zero-exit Docker does not excuse corrupt readback/stat, tool drift, copy mismatch or unchanged image", async t => {
  for (const scenario of ["readback", "stat", "tools", "copy", "unchanged"]) {
    const f = await fixture(t), original = f.deps.run;
    if (scenario === "copy") f.deps.io.copyFile = (_, to) => fs.writeFile(to, "bad copy", { flag: "wx" });
    f.deps.run = async (command, args) => {
      const result = await original(command, args);
      if (args[0] === "run") {
        const [name, bytes] = { readback: ["resident-readback.sh", "wrong"], stat: ["resident-stat.txt", "File not found"],
          tools: ["tool-packages.log", "e2fsprogs-NEW\n"], unchanged: ["alpine-rootfs.ext4", "base"], copy: ["unused", ""] }[scenario];
        await fs.writeFile(path.join(f.destination, name), bytes);
      }
      return result;
    };
    await assert.rejects(buildResidentImage(f.options, f.deps));
    await assert.rejects(fs.stat(path.join(f.destination, "desktop-info.json")), { code: "ENOENT" });
    assert.equal(f.hashes.filter(filename => filename === f.base).length, 2);
  }
});

test("post-run base mutation refuses publication and retains both Docker and preservation errors", async t => {
  const f = await fixture(t), original = f.deps.run;
  f.deps.run = async (command, args) => {
    if (args[0] === "image") return original(command, args);
    await fs.writeFile(f.base, "sabotaged by the mock only; real mount is read-only");
    throw new Error("first failure");
  };
  await assert.rejects(buildResidentImage(f.options, f.deps), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /first failure/u);
    assert.match(String(error.errors[1]), /base image SHA256 differs/u);
    return true;
  });
  await assert.rejects(fs.stat(path.join(f.destination, "desktop-info.json")), { code: "ENOENT" });
});
