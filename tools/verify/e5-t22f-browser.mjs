#!/usr/bin/env node
// Frozen engine-boundary proof using the unchanged C diagnostic image. This
// deliberately does NOT publish C's acceptance lock or waive its timing gate.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashFile, sha256, verifyChunkStore } from "./e5-t18e-publication.mjs";

const scope = ["Cargo.toml", "Cargo.lock", "crates", "tests/shared", "tools", "Makefile", "web"];
const excluded = ["web/dist/artifacts.json", "web/dist/artifacts-node-alpine.json"];
export function freezeEngineProof(repo) {
  const git = args => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  git(["ls-files", "--error-unmatch", "--", "tools/verify/e5-t22f-browser.mjs",
    "tools/verify/fixtures/e5-t22f-desktop.json", "web/dist/pkg/wasm_vm_wasm_bg.wasm"]);
  try { git(["diff", "--quiet", "HEAD", "--", ...scope, ...excluded.map(p => `:(exclude)${p}`)]); }
  catch { throw Error("engine proof sources differ from frozen HEAD"); }
  // ls-tree does not accept exclusion pathspec magic. Filter its NUL-delimited
  // entries by exact filename, retaining every other input and its object ID.
  const tree = git(["ls-tree", "-rz", "HEAD", "--", ...scope]).split("\0")
    .filter(record => !excluded.includes(record.slice(record.indexOf("\t") + 1))).join("\0");
  return { head: git(["rev-parse", "HEAD"]).trim(), treeSha256: sha256(tree) };
}

export function proofEnvironment(inherited, repo) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^(E5_T22C_|E5_DEMO_|E5_T18E_)/.test(key)));
  return { ...env, E5_T22C_ITERATION: "1", E5_T22C_PROFILE: "0", E5_T22C_CPU_PROFILE: "0", E5_T22C_INTERACTIVE: "0",
    E5_T22C_IMAGE_DIR: path.join(repo, "target/e5-t22f/desktop-image"),
    E5_T22C_CHUNKS: path.join(repo, "target/e5-t22f/chunks"),
    E5_T22C_OUT: path.join(repo, "evidence/e5-t22f/browser"),
    E5_DEMO_TASK: "E5-T22f", E5_DEMO_OUT: path.join(repo, "evidence/e5-t22f/demo") };
}

async function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const frozen = freezeEngineProof(repo), env = proofEnvironment(process.env, repo);
  const lock = JSON.parse(await readFile(path.join(repo, "tools/verify/fixtures/e5-t22f-desktop.json")));
  const image = env.E5_T22C_IMAGE_DIR, out = env.E5_T22C_OUT;
  async function verifyFixture() {
    for (const [file, key] of [["alpine-rootfs.ext4", "imageSha256"], ["MANIFEST.txt", "packageManifestSha256"], ["FILE-MANIFEST.txt", "fileManifestSha256"]])
      assert.equal(await hashFile(path.join(image, file)), lock[key], `unchanged v7 ${file}`);
    assert.equal(await hashFile(path.join(repo, "releases/kernel/6.6.63/Image")), lock.kernelSha256);
    await verifyChunkStore(env.E5_T22C_CHUNKS, lock);
  }
  await verifyFixture();
  await mkdir(out, { recursive: true });
  // C's seven functional assertions are reused, but its two-second gaps remain
  // explicitly reported. No final C verdict can be produced by this command.
  execFileSync(process.execPath, ["tools/verify/e5-t22c-guest-mode.mjs"], { cwd: repo, env, stdio: "inherit" });
  const raw = await readFile(path.join(out, "results.json")), result = JSON.parse(raw);
  assert.equal(result.head, frozen.head);
  assert.equal(result.iteration, true);
  for (const key of ["profile", "cpuProfile", "interactive"]) assert.equal(result[key], false);
  assert.equal(result.results.length, 7);
  assert.deepEqual(result.errors, []);
  for (const [file, digest] of Object.entries(result.sources)) {
    assert.equal(sha256(execFileSync("git", ["show", `${frozen.head}:${file}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 })), digest, `recorded ${file} differs from HEAD`);
  }
  execFileSync(process.execPath, ["tools/verify/e5-t18e-demo-smoke.mjs"], { cwd: repo, env, stdio: "inherit" });
  assert.deepEqual(freezeEngineProof(repo), frozen);
  await verifyFixture();
  await writeFile(path.join(out, "engine-proof.json"), JSON.stringify({ frozen, fixture: lock,
    resultSha256: sha256(raw), wasmSha256: result.sources["web/dist/pkg/wasm_vm_wasm_bg.wasm"],
    modes: result.results.map(r => ({ width: r.width, height: r.height, firstPaintMs: r.elapsed, completeMs: r.completeMs - r.started })),
    separateResizeGaps: result.gaps, certifiesE5T22c: false,
  }, null, 2) + "\n");
  console.log("E5-T22f unchanged-image browser proof passed; E5-T22c timing remains separate.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
