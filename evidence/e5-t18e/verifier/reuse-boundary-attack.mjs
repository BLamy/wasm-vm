import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashFile, sha256 } from "../../../tools/verify/e5-t18e-publication.mjs";

const repo = process.cwd(), evidence = path.join(repo, "evidence/e5-t18e/verifier");
const source = await readFile(path.join(evidence, "e5-t18e-desktop-bringup.mjs.review-snapshot.txt"), "utf8");
assert.equal(sha256(source), "bbd686c740157b58520cb64c61b1b9bbdaeeca18a63d67c94477ca48114fb37e");
const begin = source.indexOf("if (reuseBuild) {");
const end = source.indexOf("} else {", begin);
assert.ok(begin >= 0 && end > begin);
const branch = source.slice(begin + "if (reuseBuild) {".length, end);
const sourcePaths = new Function(`return ${source.match(/const sourcePaths = (\[[\s\S]*?\n\]);/)[1]}`)();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const checkReuse = new AsyncFunction("deps", `
  const { assert, readFile, execFileSync, sha256, hashFile, path, mkdir, copyFile, run, reuseBuild, head } = deps;
  let imageDir, chunkDir, buildProvenance;
  ${branch}
  return { imageDir, chunkDir, buildProvenance };
`);
const seed = JSON.parse(await readFile(path.join(repo, "evidence/e5-t18e/initial/publication.json"), "utf8"));
const scratch = await mkdtemp(path.join(tmpdir(), "e5-t18e-reuse-critic-"));
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
async function check(f) {
  const calls = [];
  try {
    // The unchanged top-level HEAD guard is exercised as well as the reuse branch.
    git(f.current, "diff", "--exit-code", "HEAD", "--", ...sourcePaths);
    const result = await checkReuse({ assert, sha256, path, reuseBuild: f.old, head: git(f.current, "rev-parse", "HEAD").trim(),
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
async function attack(label, expectedAccepted, mutate = async () => {}) {
  const f = await fixture(label);
  const anchor = path.join(f.current, "evidence/e5-t18e/initial/publication.json");
  const committedAnchorSha256 = sha256(execFileSync("git", ["show", "HEAD:evidence/e5-t18e/initial/publication.json"], { cwd: f.current }));
  await mutate(f);
  const results = [await check(f), await check(f)]; // Recheck every finding with unchanged fixture bytes.
  observations.push({ label, expectedAccepted, fixture: f.root, committedAnchorSha256,
    workingAnchorSha256: await hashFile(anchor), currentStatus: git(f.current, "status", "--short"),
    results, prediction: results.every(r => r.accepted === expectedAccepted) ? "HELD" : "FAILED" });
}
await attack("unchanged-positive", true);
await attack("tracked-crate-negative", false, f => put(f.current, "crates/fixture/src/lib.rs", "pub const FIXTURE: u8 = 73;\n"));
await attack("dirty-wvrun-input", false, f => put(f.current, "tools/guest/wvrun.sh", "#!/bin/sh\nexit 73\n"));
await attack("committed-builder-input", false, async f => {
  await put(f.current, "tools/build-file-agent.sh", "#!/bin/sh\nexit 73\n");
  git(f.current, "add", "tools/build-file-agent.sh"); commit(f.current);
});
await attack("working-publication-anchor-replaced", false, async f => {
  const changed = structuredClone(f.previous);
  delete changed.sources["tools/serve-dev.sh"];
  changed.sourceBindingSha256 = sha256(JSON.stringify({ head: changed.head, sources: changed.sources,
    runtime: changed.runtime, publication: changed.publication }));
  const raw = JSON.stringify(changed, null, 2) + "\n";
  await put(f.old, "tools/serve-dev.sh", "#!/bin/sh\nexit 73\n");
  await put(f.old, "evidence/e5-t18e/publication.json", raw);
  await put(f.current, "evidence/e5-t18e/initial/publication.json", raw);
});
await attack("old-source-byte-negative", false, f => put(f.old, "tools/rootfs/start-desktop", "mutated old input\n"));
await attack("old-wasm-byte-negative", false, f => put(f.old, "web/pkg/wasm_vm_wasm_bg.wasm", "mutated old wasm\n"));
await attack("old-inline-jit-byte-negative", false, f => put(f.old, `web/${snippet}`, "export const fixtureJit = 73;\n"));
const report = { candidate: "5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b", at: new Date().toISOString(),
  sourceSha256: sha256(source), extractedReuseBranchSha256: sha256(branch), scratch,
  scope: "Actual extracted reuse branch and HEAD source guard, real fs/git on disposable fixtures; no image/browser/build invocation",
  onlyStub: "Final npm ci observer install", observations };
await writeFile(path.join(evidence, "reuse-boundary-attack.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, observations: observations.map(({ results, ...o }) => ({ ...o,
  results: results.map(({ calls, ...r }) => r) })) }, null, 2));
