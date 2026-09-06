import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashFile, sha256 } from "../../../tools/verify/e5-t18e-publication.mjs";

const repo = process.cwd(), evidence = path.join(repo, "evidence/e5-t18e/verifier");
const source = await readFile(path.join(evidence, "reuse-final-guard.snapshot.txt"), "utf8");
assert.equal(sha256(source), "e4aba2537476b5ed093cf729991693f1dd0adf581dcaa390f8284620566df816");
const begin = source.indexOf("if (reuseBuild) {");
const end = source.indexOf("} else {", begin);
assert.ok(begin >= 0 && end > begin);
const branch = source.slice(begin + "if (reuseBuild) {".length, end);
const sourcePaths = new Function(`return ${source.match(/const sourcePaths = (\[[\s\S]*?\n\]);/)[1]}`)();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const checkReuse = new AsyncFunction("deps", `
  const { repo, assert, readFile, execFileSync, sha256, hashFile, path, mkdir, copyFile, run, reuseBuild, head } = deps;
  let imageDir, chunkDir, buildProvenance;
  ${branch}
  return { imageDir, chunkDir, buildProvenance };
`);
const seed = JSON.parse(await readFile(path.join(repo, "evidence/e5-t18e/initial/publication.json"), "utf8"));
const scratch = await mkdtemp(path.join(tmpdir(), "e5-t18e-final-guard-"));
const snippet = "pkg/snippets/wasm-vm-wasm-0a6604668439f3ad/inline0.js";
const git = (directory, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args],
  { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = directory => git(directory, "-c", "user.name=Disposable verifier fixture", "-c", "user.email=fixture@invalid.example",
  "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Disposable verifier fixture only");
async function put(root, file, bytes) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), bytes);
}
async function fixture(label) {
  const root = path.join(scratch, label), old = path.join(root, "old"), current = path.join(root, "current");
  await mkdir(old, { recursive: true });
  git(old, "init", "--quiet");
  for (const file of sourcePaths) await put(old, file, `fixture source: ${file}\n`);
  for (const file of Object.keys(seed.runtime)) {
    await put(old, `web/${file}`, `fixture runtime: ${file}\n`);
    await put(old, `web/dist/${file}`, `fixture runtime: ${file}\n`);
  }
  for (const base of ["web", "web/dist"]) await put(old, `${base}/${snippet}`, "export const fixtureJit = 1;\n");
  await put(old, "crates/fixture/src/lib.rs", "pub const FIXTURE: u8 = 1;\n");
  for (const file of ["tools/guest/wvrun.sh", "tools/build-file-agent.sh", "tools/build-agent.sh", "tools/build-wvseccomp.sh"])
    await put(old, file, await readFile(path.join(repo, file)));
  await put(old, "Makefile", "BUILD_FLAGS := original\n\nweb-dist:\n\t@echo original-build\n\nverify-E5-T18e:\n\tnode original-proof.mjs\n\nnext-target:\n\t@true\n");
  for (const file of ["tools/zig-riscv64-linux-musl.sh", ".cargo/config.toml", "rust-toolchain.toml"])
    await put(old, file, await readFile(path.join(repo, file)));
  for (const file of ["web/dist/artifacts-node-alpine.json", "web/dist/artifacts.json", "web/dist/sw.js"])
    await put(old, file, "fixture generated output baseline\n");
  git(old, "add", "."); commit(old);
  const previous = { head: git(old, "rev-parse", "HEAD").trim(), sources: {}, runtime: {},
    publication: { imageDir: "fixture-image", chunkDir: "fixture-chunks" } };
  for (const file of Object.keys(seed.sources)) previous.sources[file] = await hashFile(path.join(old, file));
  for (const file of Object.keys(seed.runtime)) previous.runtime[file] = await hashFile(path.join(old, "web", file));
  previous.sourceBindingSha256 = sha256(JSON.stringify(previous));
  const raw = JSON.stringify(previous, null, 2) + "\n";
  await put(old, "evidence/e5-t18e/publication.json", raw);
  git(root, "clone", "--quiet", "--no-hardlinks", old, current);
  await put(current, "evidence/e5-t18e/initial/publication.json", raw);
  git(current, "add", "evidence/e5-t18e/initial/publication.json"); commit(current);
  return { root, old, current, previous, raw };
}
async function check(f, { branchOnly = false } = {}) {
  const calls = [];
  try {
    // The unchanged top-level HEAD guard is exercised as well as the reuse branch.
    if (!branchOnly) git(f.current, "diff", "--exit-code", "HEAD", "--", ...sourcePaths);
    const result = await checkReuse({ repo: f.current, assert, sha256, path, reuseBuild: f.old, head: git(f.current, "rev-parse", "HEAD").trim(),
      readFile: (file, ...args) => readFile(path.resolve(f.current, file), ...args),
      hashFile: file => hashFile(path.resolve(f.current, file)),
      mkdir: (file, ...args) => mkdir(path.resolve(f.current, file), ...args),
      copyFile: (from, to) => copyFile(path.resolve(f.current, from), path.resolve(f.current, to)),
      execFileSync: (command, args, options = {}) => {
        calls.push({ command, args, cwd: options.cwd || f.current });
        return execFileSync(command, args, { cwd: f.current, stdio: ["ignore", "pipe", "pipe"], ...options });
      },
      run: async (command, args) => {
        assert.deepEqual([command, args], ["npm", ["ci", "--prefix", "web", "--ignore-scripts", "--no-audit", "--no-fund"]]);
        calls.push({ command, args, skipped: "Final observer dependency install only; no guard replaced" });
      },
    });
    return { accepted: true, result, calls };
  } catch (error) { return { accepted: false, error: String(error), calls }; }
}
const observations = [];
async function attack(label, expectedAccepted, mutate = async () => {}, options = {}) {
  const f = await fixture(label);
  const anchor = path.join(f.current, "evidence/e5-t18e/initial/publication.json");
  const committedAnchorSha256 = sha256(execFileSync("git", ["show", "HEAD:evidence/e5-t18e/initial/publication.json"], { cwd: f.current }));
  await mutate(f);
  const results = [await check(f, options), await check(f, options)]; // Recheck every finding with unchanged fixture bytes.
  observations.push({ label, expectedAccepted, options, fixture: f.root, committedAnchorSha256,
    workingAnchorSha256: await hashFile(anchor), currentStatus: git(f.current, "status", "--short"),
    results, prediction: results.every(r => r.accepted === expectedAccepted) ? "HELD" : "FAILED" });
}
await attack("unchanged-positive", true);
await attack("old-generated-dist-positive", true, async f => {
  for (const file of ["web/dist/artifacts-node-alpine.json", "web/dist/artifacts.json", "web/dist/sw.js"])
    await put(f.old, file, "fixture generated output refreshed\n");
});
for (const checkout of ["current", "old"]) {
  for (const ignored of [false, true]) {
    for (const [label, file, bytes] of [
      ["cargo-config", ".cargo/config", '[build]\nrustflags = ["--cfg", "verifier_changed_input"]\n'],
      ["toolchain", "rust-toolchain", "nightly\n"],
    ]) {
      await attack(`${checkout}-${ignored ? "ignored" : "untracked"}-${label}`, false, async f => {
        await put(f[checkout], file, bytes);
        if (ignored) await put(f[checkout], ".git/info/exclude", `${file}\n`);
        const hidden = git(f[checkout], "ls-files", "--others", "--exclude-standard", "--", file).trim();
        assert.equal(hidden, ignored ? "" : file, "fixture ignore policy differs from the intended case");
      });
    }
  }
}
await attack("old-dirty-transitive-build-script", false,
  f => put(f.old, "tools/build-file-agent.sh", "#!/bin/sh\nexit 73\n"));
const inputs = new Function(`return ${source.match(/const inputs = (\[[\s\S]*?\]);/)[1]}`)();
const original = "/Users/blamy/Documents/Codex/e5-t18e-final.20gEr1/repo";
const actualOldInputCommand = ["git", "diff", "--exit-code", "HEAD", "--", ...inputs, ":!web/dist"];
const actualOldOutput = execFileSync(actualOldInputCommand[0], actualOldInputCommand.slice(1),
  { cwd: original, stdio: ["ignore", "pipe", "pipe"] });
assert.equal(actualOldOutput.length, 0);
const report = { head: "0d966c1fb8ef31e05c2bca52e1a191d9de235af3", at: new Date().toISOString(),
  sourceSha256: sha256(source), extractedReuseBranchSha256: sha256(branch), scratch,
  scope: "Final identified reuse-guard delta only; real fs/git fixtures; no build or browser",
  onlyStub: "Final npm ci observer install", observations,
  actualOldCheckout: { path: original, command: actualOldInputCommand, outputBytes: actualOldOutput.length, passed: true },
  passed: observations.every(o => o.prediction === "HELD") };
await writeFile(path.join(evidence, "reuse-final-guard-attack.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, observations: observations.map(o => ({
  label: o.label, prediction: o.prediction, accepted: o.results.map(r => r.accepted),
  errors: o.results.map(r => r.error?.split("\n")[0]), fixture: o.fixture,
})) }, null, 2));
if (!report.passed) process.exitCode = 1;
