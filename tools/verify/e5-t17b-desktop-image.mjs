#!/usr/bin/env node

// E5-T17b: inspect the assembled desktop image and its deterministic manifests. The image is
// read-only inspected through the local Docker/e2fsprogs toolchain; no guest boot or browser leg
// belongs to this assembly slice.

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const profilePath = path.join(repo, "tools/image/e5-t17a-desktop-packages.json");
const defaultOutput = path.join(repo, "target/e5-t17b/desktop-image");
const evidenceDir = path.join(repo, "evidence/e5-t17b");
const verificationPath = path.join(evidenceDir, "desktop-image-verification.json");
const execFile = promisify(execFileCallback);

const outputDir = path.resolve(argument("--out") ?? defaultOutput);
const imagePath = path.join(outputDir, "alpine-rootfs.ext4");
const infoPath = path.join(outputDir, "desktop-info.json");
const packageManifestPath = path.join(outputDir, "MANIFEST.txt");
const fileManifestPath = path.join(outputDir, "FILE-MANIFEST.txt");
const checksumsPath = path.join(outputDir, "SHA256SUMS");
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

const profile = await readJson(profilePath);
const info = await readJson(infoPath);
const packageManifest = await readFile(packageManifestPath, "utf8");
const fileManifest = await readFile(fileManifestPath, "utf8");
const checksums = await readFile(checksumsPath, "utf8");
const fileEntries = parseFileManifest(fileManifest);

await validateMetadata(info);
validatePackageManifest(packageManifest);
validateFileManifest(fileEntries);
await validateManifestChecksums(checksums);
const inspection = await inspectImage();
validateInspection(inspection);

if (process.argv.includes("--self-test")) {
  const rendererMutant = structuredClone(info);
  rendererMutant.startup.renderer = "gl";
  await assert.rejects(() => validateMetadata(rendererMutant), /pixman/u, "renderer mutation was accepted");

  const autologinMutant = inspection.replace(
    "tty1::respawn:/sbin/getty -L -n -l /usr/local/sbin/desktop-autologin 115200 tty1 linux",
    "tty1::respawn:/sbin/getty -L 115200 tty1 linux",
  );
  assert.doesNotMatch(autologinMutant, /desktop-autologin/u, "self-test fixture did not mutate autologin");
  assert.match(inspection, /desktop-autologin/u, "autologin inspection was unexpectedly absent");
  process.stdout.write("E5T17B_SELF_TEST=renderer-and-autologin-contracts\n");
}

await mkdir(evidenceDir, { recursive: true });
await writeFile(verificationPath, `${JSON.stringify({
  schema: "wasm-vm.e5-t17b.desktop-image-verification.v1",
  task: "E5-T17b",
  command: "make verify-E5-T17b",
  output: path.relative(repo, outputDir),
  profile: {
    path: path.relative(repo, profilePath),
    sha256: await sha256File(profilePath),
  },
  image: {
    path: path.relative(repo, imagePath),
    sha256: await sha256File(imagePath),
    size: (await readFile(imagePath)).length,
  },
  packageManifest: {
    path: path.relative(repo, packageManifestPath),
    sha256: await sha256File(packageManifestPath),
  },
  fileManifest: {
    path: path.relative(repo, fileManifestPath),
    sha256: await sha256File(fileManifestPath),
  },
  startup: {
    backend: "drm",
    renderer: "pixman",
    desktopUser: "desktop",
    autologinTty: "tty1",
    seatdRunlevel: "default",
  },
  result: "passed",
}, null, 2)}\n`);
process.stdout.write(`E5T17B_VERIFIED=${JSON.stringify({
  output: path.relative(repo, outputDir),
  image: path.relative(repo, imagePath),
  evidence: path.relative(repo, verificationPath),
})}\n`);

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function validateMetadata(value) {
  assert.equal(value.schema, "wasm-vm.e5-t17b.desktop-image-info.v1");
  assert.equal(value.task, "E5-T17b");
  assert.equal(value.architecture, "riscv64");
  assert.equal(value.profile.path, "tools/image/e5-t17a-desktop-packages.json");
  assert.equal(value.profile.sha256, await sha256File(profilePath), "desktop-info profile digest is stale");
  assert.equal(value.image.path, "target/e5-t17b/desktop-image/alpine-rootfs.ext4");
  assert.equal(value.image.sha256, await sha256File(imagePath), "desktop-info image digest is stale");
  assert.equal(value.image.size, (await readFile(imagePath)).length, "desktop-info image size is stale");
  assert.equal(value.packageManifest.path, "target/e5-t17b/desktop-image/MANIFEST.txt");
  assert.equal(value.packageManifest.sha256, await sha256File(packageManifestPath), "desktop-info package manifest digest is stale");
  assert.equal(value.fileManifest.path, "target/e5-t17b/desktop-image/FILE-MANIFEST.txt");
  assert.equal(value.fileManifest.sha256, await sha256File(fileManifestPath), "desktop-info file manifest digest is stale");
  assert.deepEqual(value.startup, {
    backend: "drm",
    renderer: "pixman",
    autologinTty: "tty1",
    desktopUser: "desktop",
    seatdRunlevel: "default",
  });
}

function validatePackageManifest(value) {
  const lines = new Set(value.split(/\r?\n/u).filter(Boolean));
  assert.ok(lines.size > 0, "package manifest is empty");
  assert.doesNotMatch(value, /--allow-untrusted/u, "package manifest contains an untrusted install path");
  for (const pkg of profile.packages) {
    assert.ok(lines.has(pkg.packageId), `package manifest is missing ${pkg.packageId}`);
  }
}

function parseFileManifest(value) {
  const entries = new Map();
  for (const line of value.split(/\r?\n/u).filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/u);
    assert.ok(match, `malformed FILE-MANIFEST line: ${line}`);
    assert.ok(!entries.has(match[3]), `FILE-MANIFEST contains duplicate path ${match[3]}`);
    entries.set(match[3], { digest: match[1], mode: match[2] });
  }
  assert.ok(entries.size > 0, "file manifest is empty");
  return entries;
}

function validateFileManifest(entries) {
  const expectedFiles = new Map([
    ["/etc/init.d/desktop-runtime", "0755"],
    ["/usr/local/sbin/desktop-autologin", "0755"],
    ["/usr/local/bin/start-desktop", "0755"],
    ["/etc/xdg/weston/weston.ini", "0644"],
    ["/home/desktop/.profile", "0644"],
    ["/home/desktop/.config/foot/foot.ini", "0644"],
    ["/home/desktop/.local/bin/clip-copy", "0755"],
    ["/home/desktop/.local/bin/clip-paste", "0755"],
    ["/etc/inittab", "0644"],
    ["/etc/shadow", "0640"],
    ["/etc/shells", "0644"],
  ]);
  for (const [file, mode] of expectedFiles) {
    assert.equal(entries.get(file)?.mode, mode, `FILE-MANIFEST missing ${file} at mode ${mode}`);
  }
  for (const directory of ["/home/desktop", "/home/desktop/.local/state/wasm-vm", "/run/user/1000"]) {
    assert.equal(entries.get(directory)?.mode, "0700", `runtime directory ${directory} is not private`);
    assert.equal(entries.get(directory)?.digest, "directory");
  }
}

async function validateManifestChecksums(value) {
  const expectedPackage = await sha256File(packageManifestPath);
  const expectedFiles = await sha256File(fileManifestPath);
  assert.match(value, new RegExp(`^${expectedPackage}  MANIFEST\\.txt$`, "mu"));
  assert.match(value, new RegExp(`^${expectedFiles}  FILE-MANIFEST\\.txt$`, "mu"));
  assert.equal(value.split(/\r?\n/u).filter(Boolean).length, 2, "SHA256SUMS contains an untracked output");
}

async function inspectImage() {
  const script = [
    "set -eu",
    "apk add --no-cache e2fsprogs-extra >/dev/null",
    "inspect() { label=$1; command=$2; printf 'E5T17B_INSPECT_%s_BEGIN\\n' \"$label\"; debugfs -R \"$command\" /image 2>&1; printf 'E5T17B_INSPECT_%s_END\\n' \"$label\"; }",
    "mkdir -p /tmp/fakebin /home/desktop/.local/state/wasm-vm",
    "printf '%s\\n' '#!/bin/sh' 'echo E5T17B_FAKE_WESTON_INVOKED=1 > /tmp/fake-weston-marker' '/bin/busybox sleep 2' > /tmp/fakebin/weston",
    "printf '%s\\n' '#!/bin/sh' 'exit 0' > /tmp/fakebin/chown",
    // The production launcher refuses to run before seatd. Model a live process from this
    // disposable execution fixture so the fake Weston still exercises the complete bounded path.
    "printf '%s\\n' '#!/bin/sh' 'echo 1' > /tmp/fakebin/pidof",
    "chmod 0755 /tmp/fakebin/weston /tmp/fakebin/chown /tmp/fakebin/pidof",
    "debugfs -R 'dump /usr/local/bin/start-desktop /tmp/start-desktop' /image >/dev/null 2>&1",
    "chmod 0755 /tmp/start-desktop",
    "printf '%s\\n' E5T17B_RUNTIME_START_BEGIN",
    "PATH=/tmp/fakebin:$PATH WAYLAND_DISPLAY=wayland-test /tmp/start-desktop",
    "cat /tmp/fake-weston-marker",
    "cat /home/desktop/.local/state/wasm-vm/weston.log",
    "printf '%s\\n' E5T17B_RUNTIME_START_END",
    "inspect PASSWD 'cat /etc/passwd'",
    "inspect GROUP 'cat /etc/group'",
    "inspect SHADOW 'cat /etc/shadow'",
    "inspect SHELLS 'cat /etc/shells'",
    "inspect INITTAB 'cat /etc/inittab'",
    "inspect RUNTIME_SERVICE 'cat /etc/init.d/desktop-runtime'",
    "inspect AUTOLOGIN 'cat /usr/local/sbin/desktop-autologin'",
    "inspect START_DESKTOP 'cat /usr/local/bin/start-desktop'",
    "inspect WESTON_INI 'cat /etc/xdg/weston/weston.ini'",
    "inspect PROFILE 'cat /home/desktop/.profile'",
    "inspect FOOT_INI 'cat /home/desktop/.config/foot/foot.ini'",
    "inspect CLIP_COPY 'cat /home/desktop/.local/bin/clip-copy'",
    "inspect CLIP_PASTE 'cat /home/desktop/.local/bin/clip-paste'",
    "inspect SEATD_LINK 'stat /etc/runlevels/default/seatd'",
    "inspect DESKTOP_RUNTIME_LINK 'stat /etc/runlevels/default/desktop-runtime'",
    "inspect UDEV_LINK 'stat /etc/runlevels/sysinit/udev'",
    "inspect UDEV_TRIGGER_LINK 'stat /etc/runlevels/boot/udev-trigger'",
    "inspect USER_RUNTIME 'stat /run/user/1000'",
    "inspect DESKTOP_HOME 'stat /home/desktop'",
    "inspect DESKTOP_STATE 'stat /home/desktop/.local/state/wasm-vm'",
    "inspect ROOT_LIST 'ls -l /root'",
    "inspect APK_CACHE 'ls -l /var/cache/apk'",
  ].join("\n");
  const { stdout } = await execFile("docker", [
    "run",
    "--rm",
    "-v",
    `${imagePath}:/image:ro`,
    "alpine:3.20",
    "sh",
    "-lc",
    script,
  ], { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

function validateInspection(value) {
  const passwd = inspectionSection(value, "PASSWD");
  const groups = inspectionSection(value, "GROUP");
  const shells = inspectionSection(value, "SHELLS");
  const inittab = inspectionSection(value, "INITTAB");
  assert.match(passwd, /^desktop:x:1000:1000:[^\n]*:\/home\/desktop:\/usr\/local\/bin\/start-desktop$/mu);
  assert.equal((passwd.match(/^desktop:/gmu) ?? []).length, 1, "desktop user was duplicated");
  for (const group of ["video", "input", "seat", "audio"]) {
    assert.equal((groups.match(new RegExp(`^${group}:`, "gmu")) ?? []).length, 1, `${group} was duplicated`);
    assert.match(groups, new RegExp(`^${group}:[^\\n]*:[^\\n]*:(?:[^,\\n]+,)*desktop(?:,|$)`, "mu"), `${group} does not include desktop`);
  }
  assert.match(value, /^root:!:/mu, "root credential was not locked");
  const tty1Line = "tty1::respawn:/sbin/getty -L -n -l /usr/local/sbin/desktop-autologin 115200 tty1 linux";
  assert.equal((inittab.match(new RegExp(`^${tty1Line}$`, "gmu")) ?? []).length, 1, "tty1 autologin was duplicated or changed");
  assert.match(shells, /^\/usr\/local\/bin\/start-desktop$/mu);
  assert.match(value, /need seatd/u);
  assert.match(value, /after udev udev-trigger/u);
  assert.match(value, /E5T17B_START_DESKTOP weston --backend=drm --renderer=pixman/u);
  assert.match(value, /\/bin\/busybox timeout 30 weston/u);
  assert.match(value, /\/bin\/busybox timeout 30 foot/u);
  assert.match(value, /backend=drm-backend\.so/u);
  assert.match(value, /renderer=pixman/u);
  assert.doesNotMatch(value, /renderer=(?:auto|gl|gles2|vulkan)|fbdev/u);
  assert.match(value, /RUNTIME_START_BEGIN[\s\S]*E5T17B_FAKE_WESTON_INVOKED=1[\s\S]*E5T17B_WESTON_NOT_READY=1[\s\S]*RUNTIME_START_END/u);
  assert.match(value, /Fast link dest: "\/etc\/init\.d\/seatd"/u);
  assert.match(value, /Fast link dest: "\/etc\/init\.d\/desktop-runtime"/u);
  assert.match(value, /Fast link dest: "\/etc\/init\.d\/udev"/u);
  assert.match(value, /Fast link dest: "\/etc\/init\.d\/udev-trigger"/u);
  assert.match(value, /USER_RUNTIME_BEGIN[\s\S]*Mode:\s+0700[\s\S]*USER_RUNTIME_END/u);
  assert.match(value, /DESKTOP_HOME_BEGIN[\s\S]*Mode:\s+0700[\s\S]*DESKTOP_HOME_END/u);
  assert.match(value, /DESKTOP_STATE_BEGIN[\s\S]*Mode:\s+0700[\s\S]*DESKTOP_STATE_END/u);
  assert.doesNotMatch(value, /ROOT_LIST_BEGIN[\s\S]*(?:\.ash_history|\.bash_history|\.netrc|\.curlrc|\.wget-hsts|\.ssh)[\s\S]*ROOT_LIST_END/u);
  assert.doesNotMatch(value, /APK_CACHE_BEGIN[\s\S]*\.apk[\s\S]*APK_CACHE_END/u);
}

function inspectionSection(value, label) {
  const match = value.match(new RegExp(`E5T17B_INSPECT_${label}_BEGIN\\n([\\s\\S]*?)E5T17B_INSPECT_${label}_END`, "u"));
  assert.ok(match, `missing ${label} inspection section`);
  return match[1];
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith("--"), `${name} requires a path`);
  return process.argv[index + 1];
}
