import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../../../tools/verify/e5-t18e-publication.mjs";

const evidence = path.resolve("evidence/e5-t18e/verifier");
const source = await readFile(path.join(evidence, "reuse-guard-repaired.snapshot.txt"), "utf8");
assert.equal(sha256(source), "ac413df34da56adb631a5c4f2215626683142de37041af31f0dea686c0086112");
const inputs = new Function(`return ${source.match(/const inputs = (\[[\s\S]*?\]);/)[1]}`)();
const sourcePaths = new Function(`return ${source.match(/const sourcePaths = (\[[\s\S]*?\n\]);/)[1]}`)();
const mask = new Function(`return (${source.match(/^  const withoutProofRecipe = (.*);$/m)[1]})`)();
const current = "/Users/blamy/Documents/Codex/e5-t18e-cache-final.BHmnqG/repo";
const old = "/Users/blamy/Documents/Codex/e5-t18e-final.20gEr1/repo";
const report = { at: new Date().toISOString(), sourceSha256: sha256(source), current, old,
  scope: "Read-only expanded repaired guard preconditions, not a rerun of the frozen harness", checks: [] };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
try {
  const head = git(current, "rev-parse", "HEAD").toString().trim();
  assert.equal(head, "5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b");
  const anchor = "evidence/e5-t18e/initial/publication.json";
  const expected = git(current, "show", `${head}:${anchor}`);
  assert.deepEqual(await readFile(path.join(current, anchor)), expected);
  const actual = await readFile(path.join(old, "evidence/e5-t18e/publication.json"));
  assert.deepEqual(actual, expected);
  const previous = JSON.parse(actual);
  assert.equal(git(old, "rev-parse", "HEAD").toString().trim(), previous.head);
  assert.equal(sha256(JSON.stringify({ head: previous.head, sources: previous.sources,
    runtime: previous.runtime, publication: previous.publication })), previous.sourceBindingSha256);
  report.checks.push({ name: "named-head anchor, working anchor, prior record and prior binding", passed: true,
    currentHead: head, previousHead: previous.head, anchorSha256: sha256(expected), sourceBindingSha256: previous.sourceBindingSha256 });
  for (const [name, cwd, args] of [
    ["repaired sourcePaths HEAD guard on frozen clone", current, ["diff", "--exit-code", "HEAD", "--", ...sourcePaths]],
    ["expanded previous-to-current tracked build trees", current, ["diff", "--exit-code", previous.head, head, "--", ...inputs]],
    ["expanded current working tracked inputs", current, ["diff", "--exit-code", "HEAD", "--", ...inputs]],
  ]) {
    const output = git(cwd, ...args);
    assert.equal(output.length, 0);
    report.checks.push({ name, cwd, command: ["git", ...args], outputBytes: output.length, passed: true });
  }
  const oldMakefile = git(current, "show", `${previous.head}:Makefile`);
  const currentMakefile = await readFile(path.join(current, "Makefile"));
  assert.equal(mask(oldMakefile), mask(currentMakefile));
  report.checks.push({ name: "actual non-proof Makefile bytes match", oldSha256: sha256(oldMakefile),
    currentSha256: sha256(currentMakefile), maskedSha256: sha256(mask(oldMakefile)), passed: true });
  // This extra diagnostic is NOT a condition in the repaired reuse branch.
  // The old build generated unrelated dist outputs. Reused runtime files remain
  // covered by their prior digest checks, not a whole-old-dist cleanliness claim.
  const oldDiff = git(old, "diff", "HEAD", "--", ...inputs);
  const oldPaths = git(old, "diff", "--name-only", "HEAD", "--", ...inputs).toString().trim().split("\n").filter(Boolean);
  assert.deepEqual(oldPaths, ["web/dist/artifacts-node-alpine.json", "web/dist/artifacts.json", "web/dist/sw.js"]);
  const bound = new Set([...Object.keys(previous.sources), ...Object.keys(previous.runtime).flatMap(file => [`web/${file}`, `web/dist/${file}`])]);
  assert.ok(oldPaths.every(file => !bound.has(file)));
  report.oldGeneratedOutputDiagnostic = { scope: "Additional diagnostic only; these paths are not reused or served by the corrected proof",
    paths: oldPaths, diff: oldDiff.toString(), diffSha256: sha256(oldDiff),
    classification: "Unrelated generated dist manifests and service-worker version; no runtime/input refutation" };
  for (const cwd of [old, current]) {
    for (const ignored of [false, true]) {
      const args = ["ls-files", "--others", ...(ignored ? ["--ignored"] : []), "--exclude-standard",
        "--", ".cargo", "rust-toolchain", "rust-toolchain.toml"];
      const output = git(cwd, ...args).toString();
      assert.equal(output, "", "undeclared optional Cargo/toolchain input present");
      report.checks.push({ name: `${ignored ? "ignored" : "untracked"} optional Cargo/toolchain inputs absent`, cwd,
        command: ["git", ...args], output, passed: true });
    }
  }
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
await writeFile(path.join(evidence, "reuse-repair-frozen-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
