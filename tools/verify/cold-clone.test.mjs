import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./cold_clone.sh", import.meta.url));

async function fixture(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cold-clone-test-"));
  const repo = path.join(dir, "source"), parent = path.join(dir, "Docker's shared directory");
  try {
    await mkdir(repo); await mkdir(parent);
    await writeFile(path.join(repo, "input.txt"), "committed\n");
    await writeFile(path.join(repo, "Makefile"), [
      ".PHONY: proof fail", "proof:",
      '\t@test "$$(cat input.txt)" = committed',
      '\t@test -z "$${RUSTFLAGS-}$${RUSTDOCFLAGS-}$${RUST_LOG-}$${CARGO_COLD_POISON-}"',
      "\t@test ! -e dirty-only", "fail:", "\t@exit 7", "",
    ].join("\n"));
    const git = args => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git(["init", "-q"]); git(["add", "."]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "-qm", "fixture"]);
    await writeFile(path.join(repo, "input.txt"), "dirty\n");
    await writeFile(path.join(repo, "dirty-only"), "not committed\n");
    const invoke = args => spawnSync("bash", [script, ...args], { cwd: repo, encoding: "utf8",
      env: { ...process.env, RUSTFLAGS: "poison", RUSTDOCFLAGS: "poison", RUST_LOG: "poison", CARGO_COLD_POISON: "poison" } });
    await run({ repo, parent, invoke });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("selected parent preserves literal paths, committed input, scrub and retained proof", () => fixture(async ({ repo, parent, invoke }) => {
  const result = invoke(["--parent", parent, "--keep", "proof"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const children = await readdir(parent);
  assert.equal(children.length, 1);
  assert.match(children[0], /^wasm-vm-cold\./);
  assert.equal(await readFile(path.join(parent, children[0], "repo/input.txt"), "utf8"), "committed\n");
  assert.equal(await readFile(path.join(repo, "input.txt"), "utf8"), "dirty\n");
  assert.match(result.stdout, /PASSED from a pristine clone/);
}));

test("cleanup removes only owned clone and make failure remains a failure", () => fixture(async ({ parent, invoke }) => {
  await writeFile(path.join(parent, "preserve.txt"), "unrelated\n");
  for (const target of ["proof", "fail"]) {
    const result = invoke(["--parent", parent, target]);
    assert.equal(result.status === 0, target === "proof", result.stdout + result.stderr);
    if (target === "fail") assert.match(result.stderr, /FAILED/);
    assert.deepEqual(await readdir(parent), ["preserve.txt"]);
  }
}));

test("default temporary directory remains supported", () => fixture(async ({ invoke }) => {
  const result = invoke(["proof"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED from a pristine clone/);
}));

test("invalid parents, flags and nonliteral targets fail before cloning", () => fixture(async ({ parent, invoke }) => {
  for (const args of [[], ["--parent"], ["--parent", "", "proof"], ["--unknown", "proof"],
    ["--parent", path.join(parent, "absent"), "proof"], ["proof", "extra"],
    ["proof; touch injected"], ["proof $(touch injected)"], ["X=value"], ["--eval=proof:;true"]]) {
    const result = invoke(args);
    assert.equal(result.status, 2, `${JSON.stringify(args)}\n${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stdout, /cloning HEAD/);
  }
  assert.deepEqual(await readdir(parent), []);
}));
