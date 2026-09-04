#!/usr/bin/env node

// E5-T16d: audit the measured display finalists on clean copies of the E3 Alpine riscv64 image.
// Every search and install below is executed by the riscv64 guest through the native emulator;
// the host only copies the pristine image and records the serial/evidence artifacts.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "target/release/wasm-vm");
const kernel = path.join(repo, "releases/kernel/6.6.63/Image");
const baseImage = path.join(repo, "releases/rootfs/alpine-rootfs.ext4");
const basePackageManifest = path.join(repo, "releases/rootfs/MANIFEST.txt");
const baseFileManifest = path.join(repo, "releases/rootfs/FILE-MANIFEST.txt");
const evidenceDir = path.join(repo, "evidence/e5-t16d");
const runDir = path.join(repo, "target/e5-t16d");
const timeoutMs = 45 * 60 * 1_000;
const repositories = Object.freeze([
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/main",
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/community",
]);

const candidates = Object.freeze([
  Object.freeze({
    id: "labwc-pixman",
    server: "drm",
    wm: "labwc",
    renderer: "pixman",
    packages: Object.freeze([
      "labwc",
      "foot",
      "seatd",
      "eudev",
      "udev-init-scripts",
      "pixman",
      "xkeyboard-config",
      "wlr-randr",
      "wl-clipboard",
      "font-dejavu",
    ]),
  }),
  Object.freeze({
    id: "weston-pixman",
    server: "drm",
    wm: "weston",
    renderer: "pixman",
    packages: Object.freeze([
      "weston",
      "weston-backend-drm",
      "weston-shell-desktop",
      "foot",
      "seatd",
      "eudev",
      "udev-init-scripts",
      "pixman",
      "xkeyboard-config",
      "wl-clipboard",
      "font-dejavu",
    ]),
  }),
]);

const sha256File = async (file) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});
const baseImageSha256 = await sha256File(baseImage);
const basePackageManifestSha256 = await sha256File(basePackageManifest);
const baseFileManifestSha256 = await sha256File(baseFileManifest);

for (const file of [cli, kernel, baseImage, basePackageManifest, baseFileManifest]) {
  const fileStat = await stat(file);
  assert.ok(fileStat.size > 0, `missing or empty audit input: ${file}`);
}
await mkdir(evidenceDir, { recursive: true });
await mkdir(runDir, { recursive: true });

const results = [];
for (const candidate of candidates) {
  results.push(await runCandidate(candidate));
}

const output = {
  schema: "wasm-vm.e5-t16d.package-audit.v1",
  task: "E5-T16d",
  environment: "emulator",
  architecture: "riscv64",
  source: {
    image: "releases/rootfs/alpine-rootfs.ext4",
    imageSha256: baseImageSha256,
    packageManifest: "releases/rootfs/MANIFEST.txt",
    packageManifestSha256: basePackageManifestSha256,
    fileManifest: "releases/rootfs/FILE-MANIFEST.txt",
    fileManifestSha256: baseFileManifestSha256,
    derivation: "E3 base image copied once per candidate before guest apk operations",
  },
  repositories,
  policy: {
    install: "apk add --no-cache --no-progress <package>",
    signatureVerification: "apk default signature verification",
    forbiddenInstallFlag: "--allow-untrusted",
    network: "native emulator riscv64 guest via --net-slirp",
  },
  candidates: results,
};
const outputPath = path.join(evidenceDir, "package-audit.json");
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`E5T16D_AUDIT=${JSON.stringify({
  output: path.relative(repo, outputPath),
  candidates: results.map((result) => result.id),
  architecture: output.architecture,
  repositories,
})}\n`);

async function runCandidate(candidate) {
  const imagePath = path.join(runDir, `${candidate.id}.ext4`);
  const consolePath = path.join(evidenceDir, `${candidate.id}-console.log`);
  const stderrPath = path.join(evidenceDir, `${candidate.id}-stderr.log`);
  const guestEvidencePath = path.join(evidenceDir, `${candidate.id}-guest-evidence.txt`);
  await copyFile(baseImage, imagePath);
  const imageSha256 = await sha256File(imagePath);
  assert.equal(imageSha256, baseImageSha256, `${candidate.id}: clean image copy drifted before boot`);

  const stdoutLog = createWriteStream(consolePath);
  const stderrLog = createWriteStream(stderrPath);
  const guestScript = buildGuestScript(candidate);
  const child = spawn(cli, [
    "boot",
    "--kernel", kernel,
    "--drive", `file=${imagePath}`,
    "--net-slirp",
    "--virtio-rng",
    "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi",
    "--evidence", guestEvidencePath,
    "--no-reboot",
    "--max-instrs", "150000000000",
    "--quantum", "200000",
  ], {
    cwd: repo,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let loginReached = false;
  let scriptSent = false;
  let timedOut = false;
  const append = (current, chunk) => `${current}${chunk.toString("utf8")}`.slice(-8_000_000);
  child.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
    stdoutLog.write(chunk);
    if (!loginReached && stdout.includes("wasm-vm login:")) {
      loginReached = true;
      child.stdin.write("root\n");
    }
    if (loginReached && !scriptSent && stdout.includes("wasm-vm:~#")) {
      scriptSent = true;
      child.stdin.write(guestScript);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
    stderrLog.write(chunk);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  stdoutLog.end();
  stderrLog.end();
  await Promise.all([
    new Promise((resolve) => stdoutLog.once("finish", resolve)),
    new Promise((resolve) => stderrLog.once("finish", resolve)),
  ]);

  assert.equal(timedOut, false, `${candidate.id}: audit exceeded bounded timeout`);
  assert.deepEqual(exit, { code: 0, signal: null }, `${candidate.id}: emulator failed: ${stderr.slice(-2_000)}`);
  assert.equal(loginReached, true, `${candidate.id}: guest never reached login`);
  assert.equal(scriptSent, true, `${candidate.id}: guest never reached shell`);
  assert.match(stdout, /E5T16D_PACKAGE_PASS=1/u, `${candidate.id}: signed package audit did not pass`);

  const postRunSha256 = await sha256File(imagePath);
  const manifest = extractManifest(stdout);
  const search = extractCommand(stdout, "SEARCH");
  const install = extractInstall(stdout);
  const packageInfo = extractCommand(stdout, "INFO");
  const log = {
    console: { path: path.relative(repo, consolePath), sha256: await sha256File(consolePath) },
    stderr: { path: path.relative(repo, stderrPath), sha256: await sha256File(stderrPath) },
    guestEvidence: { path: path.relative(repo, guestEvidencePath), sha256: await sha256File(guestEvidencePath) },
  };
  return {
    id: candidate.id,
    server: candidate.server,
    wm: candidate.wm,
    renderer: candidate.renderer,
    packages: [...candidate.packages],
    image: {
      path: path.relative(repo, imagePath),
      sha256: imageSha256,
      postRunSha256,
    },
    run: {
      command: "wasm-vm boot --net-slirp --virtio-rng --append root=/dev/vda --no-reboot",
      exit,
      loginReached,
      shellReached: scriptSent,
      passMarker: true,
    },
    commands: {
      update: "apk update",
      search: `apk search -v ${candidate.packages.join(" ")}`,
      add: `apk add --no-cache --no-progress ${candidate.packages.join(" ")}`,
      info: `apk info -a ${candidate.packages.join(" ")}`,
    },
    update: extractCommand(stdout, "UPDATE"),
    repositoriesObserved: extractRepositories(stdout),
    architectureObserved: extractArchitecture(stdout),
    searches: Object.fromEntries(candidate.packages.map((pkg) => [pkg, search])),
    install,
    packageInfo,
    installedManifest: manifest,
    log,
  };
}

function buildGuestScript(candidate) {
  const packages = candidate.packages.join(" ");
  return String.raw`set +e
all_ok=1
printf 'E5T16D_''BEGIN candidate=${candidate.id}\n'
printf 'E5T16D_''ARCH_BEGIN\n'
apk --print-arch 2>&1
arch_rc=$?
printf 'E5T16D_''ARCH_END rc=%s\n' "$arch_rc"
[ "$arch_rc" -eq 0 ] || all_ok=0
printf 'E5T16D_''REPOSITORIES_BEGIN\n'
cat /etc/apk/repositories 2>&1
repos_rc=$?
printf 'E5T16D_''REPOSITORIES_END rc=%s\n' "$repos_rc"
[ "$repos_rc" -eq 0 ] || all_ok=0
printf 'E5T16D_''CACHE_BEGIN\n'
ls -1 /var/cache/apk 2>&1 | sort
printf 'E5T16D_''CACHE_END\n'
printf 'E5T16D_''UPDATE_BEGIN\n'
apk update 2>&1
update_rc=$?
printf 'E5T16D_''UPDATE_END rc=%s\n' "$update_rc"
[ "$update_rc" -eq 0 ] || all_ok=0
printf 'E5T16D_''SEARCH_BEGIN packages=${packages}\n'
apk search -v ${packages} 2>&1
search_rc=$?
printf 'E5T16D_''SEARCH_END rc=%s\n' "$search_rc"
[ "$search_rc" -eq 0 ] || all_ok=0
printf 'E5T16D_''INSTALL_BEGIN command=apk add --no-cache --no-progress ${packages}\n'
apk add --no-cache --no-progress ${packages} 2>&1
install_rc=$?
printf 'E5T16D_''INSTALL_END rc=%s\n' "$install_rc"
[ "$install_rc" -eq 0 ] || all_ok=0
printf 'E5T16D_''INFO_BEGIN packages=${packages}\n'
apk info -a ${packages} 2>&1
info_rc=$?
printf 'E5T16D_''INFO_END rc=%s\n' "$info_rc"
[ "$info_rc" -eq 0 ] || all_ok=0
printf 'E5T16D_''MANIFEST_BEGIN\n'
apk info -v 2>&1 | sort
printf 'E5T16D_''MANIFEST_END\n'
if [ "$all_ok" -eq 1 ]; then
  printf 'E5T16D_''PACKAGE_PASS=1\n'
else
  printf 'E5T16D_''PACKAGE_PASS=0\n'
fi
sync
poweroff -f
`;
}

function extractArchitecture(stdout) {
  return extractBetween(stdout, "E5T16D_ARCH_BEGIN", "E5T16D_ARCH_END").trim();
}

function extractRepositories(stdout) {
  return extractBetween(stdout, "E5T16D_REPOSITORIES_BEGIN", "E5T16D_REPOSITORIES_END")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("https://"));
}

function extractCommand(stdout, kind) {
  const body = extractBetween(stdout, `E5T16D_${kind}_BEGIN`, `E5T16D_${kind}_END`);
  const end = stdout.match(new RegExp(`E5T16D_${kind}_END rc=([0-9]+)`, "u"));
  return { rc: end ? Number(end[1]) : null, output: body.trim() };
}

function extractManifest(stdout) {
  return extractBetween(stdout, "E5T16D_MANIFEST_BEGIN", "E5T16D_MANIFEST_END")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9][a-z0-9+_.-]*-[0-9][^\s]*-r[0-9]+$/u.test(line));
}

function extractInstall(stdout) {
  return extractCommand(stdout, "INSTALL");
}

function extractBetween(stdout, begin, end) {
  const beginIndex = stdout.lastIndexOf(begin);
  if (beginIndex < 0) return "";
  const start = beginIndex + begin.length;
  const endIndex = stdout.indexOf(end, start);
  return stdout.slice(start, endIndex < 0 ? stdout.length : endIndex);
}
