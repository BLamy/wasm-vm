import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { hashFile, sha256, verifyChunkStore } from "./e5-t18e-publication.mjs";

// Build inputs, not descriptions of a result. A source edit requires a new lock
// and a freshly built matching image before it can be acceptance evidence.
export const DISPLAY_IMAGE_INPUTS = Object.freeze([
  "tools/guest/wv-display-resize.c", "tools/guest/wv-display-mode.h", "tools/guest/wv-display-query.c",
  "tools/rootfs/desktop-test-console", "tools/rootfs/start-desktop", "tools/rootfs-inner.sh",
  "tools/build-rootfs.sh", "tools/image/desktop.sh", "tools/image/build-display-tools.sh",
  "tools/image/e5-t22c/config.h", "tools/image/e5-t22c/display-tools-packages.txt",
  "tools/image/e5-t17a-desktop-packages.json",
]);

// Includes the transitive served runtime, not only the resize page's entrypoint.
// Deliberately excludes deployment-local manifests and unrelated task metadata.
const FROZEN_PATHS = [
  "Cargo.toml", "Cargo.lock", "crates", "web/*.js", "web/src", "web/*.html",
  "web/dist/*.js", "web/dist/pkg", "web/dist/*.html", "web/package.json", "web/package-lock.json",
  "web/artifacts-alpine.json", "tools/serve-dev.sh", "Makefile", ...DISPLAY_IMAGE_INPUTS,
  "tools/verify/e5-t22c*", "tools/verify/fixtures/e5-t22c*",
  "tools/verify/e5-t18d-surface.mjs", "tools/verify/e5-t18e-publication.mjs", "tools/verify/e5-t18e-demo-smoke.mjs",
];
export function verifyFrozenRuntime(repo) {
  const git = args => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  try { git(["diff", "--quiet", "HEAD", "--", ...FROZEN_PATHS]); }
  catch { throw Error("served runtime/harness differs from frozen HEAD"); }
  return { head: git(["rev-parse", "HEAD"]).trim(), treeSha256: sha256(git(["ls-tree", "-r", "HEAD", "--", ...FROZEN_PATHS])) };
}

export function assertDisplayBindings({ lock, info, packages, custom, sourceDigests, moduleSha256, querySha256 }) {
  assert.equal(lock.schema, "wasm-vm.e5-t22c.image-lock.v1");
  for (const key of ["imageSha256", "chunkManifestSha256", "packageManifestSha256", "fileManifestSha256",
    "moduleSha256", "querySha256", "westonConfigSha256"])
    assert.match(lock[key], /^[0-9a-f]{64}$/, `invalid ${key}`);
  assert.equal(info.architecture, "riscv64");
  assert.equal(info.image.sha256, lock.imageSha256, "image metadata drift");
  assert.equal(info.image.size, 1_073_741_824);
  assert.equal(info.packageManifest.sha256, lock.packageManifestSha256, "package metadata drift");
  assert.equal(info.fileManifest.sha256, lock.fileManifestSha256, "custom metadata drift");
  assert.equal(sha256(packages), lock.packageManifestSha256, "package bytes drift");
  assert.equal(sha256(custom), lock.fileManifestSha256, "custom bytes drift");
  for (const [key, value] of Object.entries({ boundedRecovery: true, inPlaceDisplayResize: true,
    backend: "drm", renderer: "pixman", autologinTty: "tty1", desktopUser: "desktop", seatdRunlevel: "default" }))
    assert.equal(info.startup[key], value, `startup ${key} drift`);
  assert.deepEqual(Object.keys(lock.sources).sort(), [...DISPLAY_IMAGE_INPUTS].sort(), "complete source lock");
  assert.deepEqual(sourceDigests, lock.sources, "image build source drift");
  assert.equal(moduleSha256, lock.moduleSha256, "rebuilt adapter ELF drift");
  assert.equal(querySha256, lock.querySha256, "rebuilt observer ELF drift");
  const entries = custom.toString().trim().split("\n").map(line => line.split(" "));
  for (const [file, mode, digest] of [
    ["/usr/lib/weston/wv-display-resize.so", "0755", moduleSha256],
    ["/usr/local/bin/wv-display-query", "0755", querySha256],
    ["/usr/local/sbin/desktop-test-console", "0755", sourceDigests["tools/rootfs/desktop-test-console"]],
    ["/etc/xdg/weston/weston.ini", "0644", lock.westonConfigSha256],
  ]) assert.deepEqual(entries.filter(entry => entry[2] === file), [[digest, mode, file]], `installed ${file} binding`);
}

export async function verifyDisplayPublication(repo, imageDir, chunks, toolsDir) {
  const lock = JSON.parse(await readFile(path.join(repo, "tools/image/e5-t22c-desktop-image.json")));
  const sourceDigests = {};
  for (const file of DISPLAY_IMAGE_INPUTS) sourceDigests[file] = await hashFile(path.join(repo, file));
  const packages = await readFile(path.join(imageDir, "MANIFEST.txt"));
  const custom = await readFile(path.join(imageDir, "FILE-MANIFEST.txt"));
  assertDisplayBindings({ lock, sourceDigests, packages, custom,
    info: JSON.parse(await readFile(path.join(imageDir, "desktop-info.json"))),
    moduleSha256: await hashFile(path.join(toolsDir, "wv-display-resize.so")),
    querySha256: await hashFile(path.join(toolsDir, "wv-display-query")),
  });
  assert.equal(await hashFile(path.join(imageDir, "alpine-rootfs.ext4")), lock.imageSha256, "ext4 drift");
  assert.deepEqual(packages, await readFile(path.join(repo, "tools/image/e5-t22c/MANIFEST.txt")), "committed packages drift");
  assert.deepEqual(custom, await readFile(path.join(repo, "tools/image/e5-t22c/FILE-MANIFEST.txt")), "committed custom files drift");
  return { ...lock, ...await verifyChunkStore(chunks, lock) };
}
