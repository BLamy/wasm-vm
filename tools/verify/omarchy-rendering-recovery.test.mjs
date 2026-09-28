import assert from "node:assert/strict";
import { assertPhaseAssets, assertActiveBuild } from "./omarchy-rendering-recovery.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { collectManifestAssets, essentialResponseIdentity, isNonFullProbe, resolveLocalPath, sourceKind } from "./omarchy-rendering-recovery.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");
const script = path.join(root, "tools/verify/omarchy-rendering-recovery.mjs");
const source = await fs.readFile(script, "utf8");

assert.match(source, /serviceWorkers:\s*"allow"/);
assert.match(source, /urlArg === "local"/);
assert.match(source, /Cross-Origin-Embedder-Policy/);
assert.match(source, /Cross-Origin-Opener-Policy/);
assert.match(source, /fs\.realpath\(resolved\.root\)/);
assert.match(source, /app\.html\?guest=omarchy&desktop=1#ide/);
assert.match(source, /fromServiceWorker/);
assert.match(source, /wvm:desktop-ready/);
assert.match(source, /restoredFromBootSnapshot/);
assert.match(source, /e2eShowall/);
assert.match(source, /window\.__pointer\.frames/);
assert.match(source, /backingWidth, 1280/);
assert.match(source, /guestInteractivityVerified: false/);
assert.match(source, /response\.body\(\)/);
assert.match(source, /failure\.png/);

const manifestUrl = "https://example.test/artifacts-omarchy.json";
const manifest = {
  artifacts: {
    kernel: { url: "releases/kernel/Image", sha256: "k", size: 11 },
    bootSnapshot: { url: "releases/boot-snapshot/ready.snap.gz", sha256: "r", size: 22 },
    overlayDelta: { url: "releases/boot-snapshot/overlay.bin.gz", sha256: "d", size: 33 },
  },
  chunkedImage: { key: "chunked-omarchy/manifest-deadbeef.json", sha256: "b", size: 44 },
};
const assets = collectManifestAssets(manifest, manifestUrl);
assert.equal(assets.get("https://example.test/releases/kernel/Image").role, "kernel");
assert.equal(assets.get("https://example.test/releases/boot-snapshot/ready.snap.gz").role, "ram");
assert.equal(assets.get("https://example.test/releases/boot-snapshot/overlay.bin.gz").role, "delta");
assert.equal(assets.get("https://example.test/chunked-omarchy/manifest-deadbeef.json").role, "baseManifest");
const r2Assets = collectManifestAssets(manifest, manifestUrl, "https://r2.example.test");
assert.equal(r2Assets.get("https://r2.example.test/chunked-omarchy/manifest-deadbeef.json").role, "baseManifest");
const pairedRecords = ["initial", "reload"].flatMap((phase) => [...r2Assets.values()].map((asset) => ({
  phase, assetRole: asset.role, url: asset.url, status: 200,
  sha256: asset.descriptor.sha256, bytes: asset.descriptor.size,
})));
for (const phase of ["initial", "reload"]) assertPhaseAssets(pairedRecords, r2Assets, phase);
assert.throws(() => assertPhaseAssets(pairedRecords.filter((record) => !(record.phase === "reload" && record.assetRole === "ram")), r2Assets, "reload"), /reload: ram/);
assert.throws(() => assertPhaseAssets(pairedRecords.map((record) => record.phase === "reload" && record.assetRole === "delta" ? { ...record, sha256: "stale" } : record), r2Assets, "reload"), /reload: delta/);
const active = {
  controllerScriptURL: "https://example.test/sw.js", registrationActiveURL: "https://example.test/sw.js",
  buildVersions: ["123456abcdef"], activeExecution: {
    version: "123456abcdef", cache: "wasm-vm-shell-123456abcdef", scriptURL: "https://example.test/sw.js",
  },
};
assertActiveBuild(active, "123456abcdef");
assert.throws(() => assertActiveBuild({ ...active, activeExecution: { ...active.activeExecution, version: "stale" } }, "123456abcdef"), /stale build/);
assert.throws(() => assertActiveBuild({ ...active, buildVersions: ["stale"] }, "123456abcdef"), /cache build mismatch/);
assert.equal(sourceKind("https://example.test/app?guest=omarchy"), "source");
assert.equal(sourceKind("https://example.test/releases/boot-snapshot/overlay.bin.gz"), null,
  "overlay role must come from manifest, not pathname heuristics");
assert.equal(sourceKind("https://example.test/artifacts-alpine.json"), null,
  "non-Omarchy artifact probes must not become the boot manifest");
assert.equal(sourceKind("https://example.test/chunked-omarchy/manifest-deadbeef.json"), "candidate-manifest");
assert.equal(resolveLocalPath("/releases/%2F..%2Fsecret").status, 403);
const responseRecords = [
  { phase: "initial", kind: "source", url: "https://example.test/main.js", sha256: "a" },
  { phase: "reload", kind: "source", url: "https://example.test/main.js", sha256: "a" },
];
assert.deepEqual(essentialResponseIdentity(responseRecords, "initial"), { "https://example.test/main.js:source": "a" });
assert.equal(isNonFullProbe({ method: "HEAD", range: null }), true);
assert.equal(isNonFullProbe({ method: "GET", range: "bytes=0-0" }), true);
assert.equal(isNonFullProbe({ method: "GET", range: null }), false);

const check = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
assert.equal(check.status, 0, check.stderr || check.stdout);
console.log("omarchy-rendering-recovery: focused source/syntax checks passed");
